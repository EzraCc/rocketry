import { interpolateAt } from "../motor/interpolation.js";
import type { SimResult3D } from "./types3d.js";

/**
 * Parses ThrustCurve.org's own `delays` field (e.g. "6,8,10,12,14", or "P" for a plugged motor
 * with no ejection charge at all) into the motor's actual selectable delay values, in seconds.
 * Works identically whether the motor's delay is a set of fixed cataloged variants (delayAdjustable
 * false — e.g. separate F40-6/F40-8 SKUs) or a single adjustable grain trimmed with a physical
 * drilling tool (delayAdjustable true — e.g. K400C's "-14A", trimmable down in the spacer kit's own
 * increments): ThrustCurve.org already enumerates the exact selectable values either way, so no
 * separate branch is needed here for the two delay types.
 */
export function parseAvailableDelays(delaysRaw: string): number[] {
  return delaysRaw
    .split(",")
    .map((s) => Number.parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

/**
 * How much further past apogee simulateFlight3D needs to coast (its own `coastPastApogeeS`
 * option) to have real velocity samples covering every candidate delay in a motor's own delays
 * list, including the longest one. Call this against an initial (non-coasting) sim run's own
 * apogeeTime, then re-run with the returned value before calling recommendDelay -- keeps the
 * (cheap, but non-zero) extra integration opt-in rather than paying it on every flight-sim call.
 */
export function requiredCoastPastApogeeS(delaysRaw: string, burnoutTimeS: number, apogeeTimeS: number, bufferS = 1): number {
  const delays = parseAvailableDelays(delaysRaw);
  if (delays.length === 0) return 0;
  const maxEjectionTimeS = burnoutTimeS + delays[delays.length - 1]!;
  return Math.max(0, maxEjectionTimeS - apogeeTimeS) + bufferS;
}

export interface DelayOption {
  delaySeconds: number;
  ejectionTimeS: number; // from liftoff: burnoutTimeS + delaySeconds
  deploySpeedMs: number; // |velocity| at ejection, interpolated from the sim's own samples
  beforeApogee: boolean;
}

export interface DelayRecommendation {
  /** True when the motor's own delays field is "P" (plugged) -- no ejection charge at all, a timed delay isn't applicable and dual-deploy electronics (or a fixed-delay swap) is the only option. */
  plugged: boolean;
  /** One entry per numeric value in the motor's own delays list, sorted ascending by delay. Empty if plugged or unparseable. */
  options: DelayOption[];
  recommendedDelaySeconds: number | null;
  warnings: string[];
}

// Candidates within this fraction of the best (minimum) deployment speed found are treated as a
// "near-even split" -- see recommendDelay's own doc comment for why the tiebreak then prefers the
// longer delay rather than the literal argmin.
const NEAR_TIE_RELATIVE_TOLERANCE = 0.1;

/**
 * Recommends which of a motor's own available ejection delays gets closest to a real
 * minimum-speed deployment, using the flight sim's OWN simulated speed-vs-time curve near apogee
 * (via engine3d.ts's coastPastApogeeS) rather than a symmetric-time-from-apogee approximation.
 * That distinction matters: drag decelerates the ascent MORE aggressively than it accelerates the
 * (unparachuted, still-coasting) descent, apogee itself shifts under weathercocking, and neither
 * asymmetry is captured by a naive |ejectionTime - apogeeTime| minimization -- so this reads the
 * real simulated speed at each candidate's own ejection time instead of assuming symmetry.
 *
 * `result` must already cover every candidate delay's ejection time -- i.e. have been produced by
 * simulateFlight3D with a `coastPastApogeeS` at least requiredCoastPastApogeeS's own return value
 * for this same motor/burnout/apogee. A candidate whose ejection time falls after the last
 * simulated sample (coast window too short, or the rocket already hit the ground) is dropped with
 * a warning rather than silently guessed at.
 *
 * Tiebreak: among candidates within NEAR_TIE_RELATIVE_TOLERANCE of the best deployment speed
 * found, prefers the LONGER delay -- ejecting slightly late (already falling, confirmably past the
 * true peak) is judged the safer side of a near-even split than ejecting slightly early (still
 * ascending, apogee not actually reached yet). This is a stated product preference, not something
 * derived from the physics itself.
 */
export function recommendDelay(delaysRaw: string, burnoutTimeS: number, result: SimResult3D): DelayRecommendation {
  const plugged = delaysRaw.trim().toUpperCase() === "P";
  const delays = parseAvailableDelays(delaysRaw);

  if (delays.length === 0) {
    return {
      plugged,
      options: [],
      recommendedDelaySeconds: null,
      warnings: plugged ? [] : [`Motor's own delay listing ("${delaysRaw}") has no usable numeric value.`],
    };
  }

  const times = result.samples.map((s) => s.time);
  const speeds = result.samples.map((s) => s.speed);
  const lastSampleTime = times.length > 0 ? times[times.length - 1]! : 0;

  const warnings: string[] = [];
  const options: DelayOption[] = [];
  for (const delaySeconds of delays) {
    const ejectionTimeS = burnoutTimeS + delaySeconds;
    if (ejectionTimeS > lastSampleTime + 1e-6) {
      warnings.push(
        `${delaySeconds}s delay ejects at t=${ejectionTimeS.toFixed(1)}s, past the last simulated sample (t=${lastSampleTime.toFixed(1)}s) -- excluded (re-run with a longer coastPastApogeeS to include it, or the rocket has already landed by then).`,
      );
      continue;
    }
    options.push({
      delaySeconds,
      ejectionTimeS,
      deploySpeedMs: interpolateAt(times, speeds, ejectionTimeS),
      beforeApogee: ejectionTimeS < result.apogeeTime,
    });
  }

  if (options.length === 0) {
    return { plugged, options, recommendedDelaySeconds: null, warnings };
  }

  const bestSpeed = Math.min(...options.map((o) => o.deploySpeedMs));
  const nearTies = options.filter((o) => o.deploySpeedMs <= bestSpeed * (1 + NEAR_TIE_RELATIVE_TOLERANCE));
  const recommended = nearTies.reduce((longest, o) => (o.delaySeconds > longest.delaySeconds ? o : longest), nearTies[0]!);

  return { plugged, options, recommendedDelaySeconds: recommended.delaySeconds, warnings };
}
