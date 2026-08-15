import { stabilityMargin } from "./barrowman.js";

/**
 * Flyability check on top of the raw stability margin. Thresholds match
 * common rocketry convention: CG behind (aft of) CP is an outright
 * instability (won't fly straight); under 1 caliber is a commonly-cited
 * "minimum recommended" margin, treated here as a caution rather than a
 * hard failure since some rockets genuinely fly fine below it (a high-base-
 * drag design effectively adds damping/restoring behavior beyond what the
 * static CP-CG margin alone captures); over 3 calibers is "overstable" —
 * flies straight but weathercocks aggressively and can be hard to control
 * or turn sharply into wind near apogee.
 *
 * Deliberately ignored when there's no motor loaded: an un-motored rocket
 * can't fly at all regardless of its margin, and the design typically isn't
 * finalized yet at that point (dry CG might still be a placeholder).
 */
export interface StabilityCheck {
  margin: number; // calibers
  flyable: boolean;
  warnings: string[];
}

export const LOW_MARGIN_THRESHOLD = 1; // calibers
const OVERSTABLE_THRESHOLD = 3; // calibers

export function checkStability(cpX: number, cgX: number, refDiameter: number, hasMotor: boolean): StabilityCheck {
  const margin = stabilityMargin(cpX, cgX, refDiameter);

  if (!hasMotor) {
    return { margin, flyable: true, warnings: [] };
  }

  if (margin < 0) {
    return {
      margin,
      flyable: false,
      warnings: [
        `NOT FLYABLE: CG is behind (aft of) CP (margin ${margin.toFixed(2)} cal) — this rocket is aerodynamically unstable and will not fly straight.`,
      ],
    };
  }

  const warnings: string[] = [];
  if (margin < LOW_MARGIN_THRESHOLD) {
    warnings.push(
      `Low static margin (${margin.toFixed(2)} cal, below the commonly-recommended ${LOW_MARGIN_THRESHOLD} cal minimum). Some rockets fly fine below this — high base drag (e.g. a wide flat aft end) can add restoring behavior the static CP-CG margin alone doesn't capture — but treat it as a caution, not a guarantee.`,
    );
  }
  if (margin > OVERSTABLE_THRESHOLD) {
    warnings.push(
      `Overstable (${margin.toFixed(2)} cal, above ${OVERSTABLE_THRESHOLD} cal) — flies straight but weathercocks aggressively and may be hard to control or turn sharply into wind, especially near apogee.`,
    );
  }

  return { margin, flyable: true, warnings };
}
