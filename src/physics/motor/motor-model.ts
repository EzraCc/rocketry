import type { SelectedMotor } from "../../model/rocket.js";
import { interpolateAt, trapezoidalIntegral } from "./interpolation.js";

/** Instantaneous thrust (N) at motor-relative time t (s), linearly interpolated between samples. */
export function getThrustAt(motor: SelectedMotor, t: number): number {
  const times = motor.samples.map((s) => s.time);
  const thrusts = motor.samples.map((s) => s.thrust);
  return interpolateAt(times, thrusts, t);
}

/** Burn time (s) — time of the last thrust sample. */
export function burnTime(motor: SelectedMotor): number {
  const times = motor.samples.map((s) => s.time);
  return times.length > 0 ? times[times.length - 1]! : 0;
}

/** Total impulse (N*s), trapezoidal-integrated from the thrust curve — should match ThrustCurve.org's reported totImpulseNs. */
export function totalImpulse(motor: SelectedMotor): number {
  const times = motor.samples.map((s) => s.time);
  const thrusts = motor.samples.map((s) => s.thrust);
  return trapezoidalIntegral(times, thrusts);
}
