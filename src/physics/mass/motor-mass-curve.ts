import type { SelectedMotor } from "../../model/rocket.js";
import { interpolateAt } from "../motor/interpolation.js";

/**
 * Derives a motor mass-vs-time curve from just the thrust curve plus total/
 * propellant weight — port of OpenRocket's AbstractMotorLoader.calculateMass()
 * (core/src/main/java/info/openrocket/core/file/motor/AbstractMotorLoader.java:70-108),
 * used because ThrustCurve.org (like the RASP .eng format OpenRocket's method
 * was written for) doesn't provide an explicit mass-vs-time curve — only
 * total weight and propellant weight.
 *
 * Assumes mass loss is proportional to cumulative thrust impulse (constant
 * effective exhaust velocity): trapezoidal-integrate thrust between each pair
 * of samples to get a per-interval "impulse" dm, sum for total impulse, then
 * scale so the total mass lost across the whole curve equals the propellant
 * mass exactly.
 */
export interface MassCurve {
  time: number[];
  mass: number[]; // kg
}

export function deriveMotorMassCurve(motor: SelectedMotor): MassCurve {
  const { samples, totalMassKg, propellantMassKg } = motor;
  const n = samples.length;

  if (n === 0) {
    return { time: [0], mass: [totalMassKg] };
  }
  if (n === 1) {
    return { time: [samples[0]!.time], mass: [totalMassKg] };
  }

  const dm: number[] = [];
  let totalImpulseProxy = 0;
  for (let i = 0; i < n - 1; i++) {
    const dt = samples[i + 1]!.time - samples[i]!.time;
    const segment = 0.5 * (samples[i]!.thrust + samples[i + 1]!.thrust) * dt;
    dm.push(segment);
    totalImpulseProxy += segment;
  }

  const scale = totalImpulseProxy > 1e-12 ? propellantMassKg / totalImpulseProxy : 0;

  const time: number[] = [samples[0]!.time];
  const mass: number[] = [totalMassKg];
  let running = totalMassKg;
  for (let i = 0; i < dm.length; i++) {
    running = Math.max(running - dm[i]! * scale, totalMassKg - propellantMassKg);
    time.push(samples[i + 1]!.time);
    mass.push(running);
  }

  return { time, mass };
}

export function getMotorMassAt(curve: MassCurve, t: number): number {
  return interpolateAt(curve.time, curve.mass, t);
}
