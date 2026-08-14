import type { SelectedMotor } from "../../model/rocket.js";
import { interpolateAt } from "../motor/interpolation.js";

/**
 * Motor mass-vs-time curve. Two sources, in priority order (see deriveMotorMassCurve):
 *
 * 1. Real per-sample data -- when every one of the motor's own thrust samples carries a real
 *    propellantMassRemainingKg (ThrustCurve.org's RockSim-format .rse source files carry this;
 *    see thrustcurve-client.ts's ThrustSample.propellantMassRemainingKg doc comment), total mass at
 *    each sample is just casing mass + that sample's own real propellant-remaining value -- no
 *    derivation or scaling, straight from the file.
 * 2. Derived estimate -- OpenRocket's AbstractMotorLoader.calculateMass() port (see below), used
 *    when real per-sample mass isn't available (RASP .eng source files -- the majority, including
 *    most "cert" data -- have no such field, plain time/thrust pairs only).
 */
export interface MassCurve {
  time: number[];
  mass: number[]; // kg
}

/**
 * Real-data path: total mass at each sample = casing mass (totalMassKg - propellantMassKg, fixed)
 * plus that exact sample's own propellantMassRemainingKg. No trapezoidal integration or scaling --
 * every point is the file's own value, not a model of one.
 */
function massCurveFromRealPropellantData(motor: SelectedMotor): MassCurve {
  const casingMassKg = motor.totalMassKg - motor.propellantMassKg;
  return {
    time: motor.samples.map((s) => s.time),
    mass: motor.samples.map((s) => casingMassKg + s.propellantMassRemainingKg!),
  };
}

/**
 * Derives a motor mass-vs-time curve from just the thrust curve plus total/
 * propellant weight — port of OpenRocket's AbstractMotorLoader.calculateMass()
 * (core/src/main/java/info/openrocket/core/file/motor/AbstractMotorLoader.java:70-108),
 * used as a fallback when the motor's source file has no real per-sample mass data (see
 * MassCurve's own doc comment) -- the situation OpenRocket's own method was written for, since RASP
 * .eng (the format most ThrustCurve.org "cert" data uses) never carries a mass-vs-time curve, only
 * total weight and propellant weight.
 *
 * Assumes mass loss is proportional to cumulative thrust impulse (constant
 * effective exhaust velocity): trapezoidal-integrate thrust between each pair
 * of samples to get a per-interval "impulse" dm, sum for total impulse, then
 * scale so the total mass lost across the whole curve equals the propellant
 * mass exactly.
 */
function deriveMotorMassCurveFromImpulse(motor: SelectedMotor): MassCurve {
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

export function deriveMotorMassCurve(motor: SelectedMotor): MassCurve {
  if (motor.samples.length > 0 && motor.samples.every((s) => s.propellantMassRemainingKg !== undefined)) {
    return massCurveFromRealPropellantData(motor);
  }
  return deriveMotorMassCurveFromImpulse(motor);
}

export function getMotorMassAt(curve: MassCurve, t: number): number {
  return interpolateAt(curve.time, curve.mass, t);
}
