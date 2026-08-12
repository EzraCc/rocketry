import type { Rocket } from "../../model/rocket.js";
import { IsaAtmosphere } from "../atmosphere/isa-model.js";
import { computeDragGeometry } from "../aero/drag-calc.js";
import { deriveMotorMassCurve } from "../mass/motor-mass-curve.js";
import { burnTime } from "../motor/motor-model.js";
import { computeDerivative, type SimContext } from "./derivatives.js";
import { rk4Step } from "./rk4-stepper.js";
import type { FlightEvent, SimResult, SimSample } from "./types.js";

const DT = 0.01; // s, max step — fine enough for typical hobby/high-power motor thrust curves
const MAX_TIME = 300; // s, safety cap against a runaway/non-terminating simulation
const EPS = 1e-9;

/**
 * Simulates ascent to apogee: no wind, launch straight up along the vertical
 * axis (per the project plan's M3 scope — this deliberately isolates
 * thrust/drag/mass-integration correctness from aero-moment/AOA/rotation,
 * which M4 adds). Stops at apogee; no descent/recovery modeling (also M4+).
 */
export function simulateAscent(rocket: Rocket): SimResult {
  const warnings: string[] = [];
  const massCurve = rocket.motor ? deriveMotorMassCurve(rocket.motor) : null;
  const atmosphere = new IsaAtmosphere({
    altitude: rocket.launchAltitude,
    temperature: rocket.launchTemperature,
    pressure: rocket.launchPressure,
  });
  const dragGeometry = computeDragGeometry(rocket.components);
  const ctx: SimContext = { rocket, massCurve, atmosphere, dragGeometry };

  const bt = rocket.motor ? burnTime(rocket.motor) : 0;
  // A fixed-step RK4 substep that straddles a sharp thrust-curve discontinuity blends its
  // derivative evaluations across the jump, smearing it slightly. Snapping step boundaries to
  // land exactly on each thrust-curve sample time (as well as burnout) avoids ever stepping
  // over one mid-step, matching the approach used elsewhere in this space (see the project's
  // OpenRocket research notes: it queues per-sample pseudo-events to force step boundaries at
  // thrust-curve knots for exactly this reason).
  const boundaryTimes = (rocket.motor?.samples.map((s) => s.time) ?? []).filter((st) => st > EPS).sort((a, b) => a - b);

  const samples: SimSample[] = [];
  const events: FlightEvent[] = [];
  let liftoffFired = false;
  let launchRodFired = false;
  let burnoutFired = false;
  let maxVelocity = 0;
  let maxAcceleration = 0;
  let maxMach = 0;
  let burnoutAltitude: number | null = null;
  let burnoutVelocity: number | null = null;

  let t = 0;
  let altitude = 0;
  let velocity = 0;

  const pushSample = (time: number, alt: number, vel: number): void => {
    const d = computeDerivative(ctx, time, alt, vel);
    samples.push({ time, altitude: alt, velocity: vel, acceleration: d.dVelocity, mach: d.mach, mass: d.mass, thrust: d.thrust, drag: d.drag });
    maxVelocity = Math.max(maxVelocity, vel);
    maxAcceleration = Math.max(maxAcceleration, Math.abs(d.dVelocity));
    maxMach = Math.max(maxMach, d.mach);
  };

  pushSample(t, altitude, velocity);

  if (!rocket.motor) {
    warnings.push("No motor selected — the rocket sits on the pad with zero thrust.");
    return { samples, events, apogeeAltitude: 0, apogeeTime: 0, maxVelocity: 0, maxAcceleration: 0, maxMach: 0, burnoutAltitude: null, burnoutVelocity: null, warnings };
  }

  let apogeeReached = false;
  let apogeeAltitude = 0;
  let apogeeTime = 0;

  const nextBoundary = (time: number): number => {
    for (const bTime of boundaryTimes) {
      if (bTime > time + EPS) return bTime;
    }
    return Infinity;
  };

  while (t < MAX_TIME) {
    const prevAltitude = altitude;
    const prevVelocity = velocity;

    const dt = Math.min(DT, nextBoundary(t) - t);
    const next = rk4Step(ctx, t, { altitude, velocity }, dt);
    const nextT = t + dt;

    if (!liftoffFired && prevVelocity <= 0 && next.velocity > 0) {
      liftoffFired = true;
      events.push({ type: "LIFTOFF", time: nextT, altitude: next.altitude });
    }

    if (liftoffFired && !launchRodFired && next.altitude >= rocket.launchRodLength) {
      launchRodFired = true;
      events.push({ type: "LAUNCHROD", time: nextT, altitude: next.altitude });
    }

    if (!burnoutFired && nextT >= bt - EPS) {
      burnoutFired = true;
      burnoutAltitude = next.altitude;
      burnoutVelocity = next.velocity;
      events.push({ type: "BURNOUT", time: nextT, altitude: next.altitude });
      if (!liftoffFired) {
        // Motor is spent and the rocket never lifted off (too heavy for this motor) — it
        // never will now, no point burning through the rest of MAX_TIME.
        t = nextT;
        altitude = next.altitude;
        velocity = next.velocity;
        pushSample(t, altitude, velocity);
        break;
      }
    }

    if (liftoffFired && prevVelocity > 0 && next.velocity <= 0) {
      // Linear-interpolate between the last two samples for a precise apogee, rather than
      // being limited to step resolution.
      const frac = prevVelocity / (prevVelocity - next.velocity);
      apogeeTime = t + frac * dt;
      apogeeAltitude = prevAltitude + frac * (next.altitude - prevAltitude);
      apogeeReached = true;
      events.push({ type: "APOGEE", time: apogeeTime, altitude: apogeeAltitude });
      pushSample(nextT, next.altitude, next.velocity);
      break;
    }

    t = nextT;
    altitude = next.altitude;
    velocity = next.velocity;
    pushSample(t, altitude, velocity);
  }

  if (!liftoffFired) {
    warnings.push("Rocket never lifted off — thrust never exceeded weight.");
  } else if (!apogeeReached) {
    warnings.push(`Simulation did not reach apogee within ${MAX_TIME}s — results may be incomplete.`);
    apogeeAltitude = maxVelocity > 0 ? altitude : 0;
    apogeeTime = t;
  }

  return {
    samples,
    events,
    apogeeAltitude,
    apogeeTime,
    maxVelocity,
    maxAcceleration,
    maxMach,
    burnoutAltitude,
    burnoutVelocity,
    warnings,
  };
}
