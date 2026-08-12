/**
 * Generic linear interpolation over a time-ordered (time[], value[]) series —
 * port of ThrustCurveMotor.java's "pseudo-index" scheme (getIndex /
 * getIndexFraction / interpolateAtIndex, lines ~341-395): find the two
 * bracketing samples, linear-blend between them, snapping to an exact
 * endpoint value within a small tolerance to avoid float boundary noise at
 * exact sample times. Shared by both thrust(t) lookups (motor-model.ts) and
 * mass(t) lookups (motor-mass-curve.ts), since both are the same kind of
 * series.
 */
const SNAP_TOLERANCE = 1e-4;

export function interpolateAt(times: number[], values: number[], t: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (n === 1) return values[0]!;
  if (t <= times[0]!) return values[0]!;
  if (t >= times[n - 1]!) return values[n - 1]!;

  // Last index whose time <= t (linear scan; motor curves are short, no need for binary search).
  let lower = 0;
  for (let i = 0; i < n - 1; i++) {
    if (times[i]! <= t) lower = i;
    else break;
  }
  const upper = lower + 1;
  const tLower = times[lower]!;
  const tUpper = times[upper]!;

  let frac = tUpper > tLower ? (t - tLower) / (tUpper - tLower) : 0;
  if (frac < SNAP_TOLERANCE) frac = 0;
  if (frac > 1 - SNAP_TOLERANCE) frac = 1;

  return values[lower]! * (1 - frac) + values[upper]! * frac;
}

/** Trapezoidal integral of a (time[], value[]) series — used for total impulse and mass-curve derivation. */
export function trapezoidalIntegral(times: number[], values: number[]): number {
  let sum = 0;
  for (let i = 0; i < times.length - 1; i++) {
    const dt = times[i + 1]! - times[i]!;
    sum += 0.5 * (values[i]! + values[i + 1]!) * dt;
  }
  return sum;
}
