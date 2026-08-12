import type { Rocket } from "../../model/rocket.js";
import { isBodyComponent } from "../../model/component.js";
import { placeComponents } from "../geometry/rocket-geometry.js";
import { getMotorMassAt, type MassCurve } from "./motor-mass-curve.js";

export interface MotorAxialPosition {
  foreX: number; // m from nose tip
  aftX: number;
  cgX: number; // fixed at motor.length/2 from its fore end — no CG-vs-time data available (see plan)
}

/**
 * Axial position of the motor within the rocket: mounted at the aft end of
 * its mount component, offset by motorOverhang (how far the motor protrudes
 * past the mount's own aft end) — matches OpenRocket's motor-mount
 * convention.
 */
export function motorAxialPosition(rocket: Rocket): MotorAxialPosition | null {
  if (!rocket.motor) return null;
  const placed = placeComponents(rocket.components);
  const mount = placed.find((p) => p.component.id === rocket.motorMount.componentId);
  if (!mount || !isBodyComponent(mount.component)) return null;

  const mountAftX = mount.x0 + mount.component.length;
  const aftX = mountAftX + rocket.motorMount.motorOverhang;
  const foreX = aftX - rocket.motor.length;
  const cgX = foreX + rocket.motor.length / 2;
  return { foreX, aftX, cgX };
}

export interface CombinedMassState {
  mass: number; // kg
  cgX: number; // m from nose tip
}

/** Combines the manual dry mass/CG with the motor's mass(t)/fixed-CG at simulation time t, via the standard weighted-average CG formula. */
export function combinedMassAt(rocket: Rocket, massCurve: MassCurve, t: number): CombinedMassState {
  const pos = motorAxialPosition(rocket);
  if (!rocket.motor || !pos) {
    return { mass: rocket.dryMass, cgX: rocket.dryCg };
  }

  const motorMass = getMotorMassAt(massCurve, t);
  const totalMass = rocket.dryMass + motorMass;
  if (totalMass < 1e-9) {
    return { mass: 0, cgX: rocket.dryCg };
  }
  const cgX = (rocket.dryMass * rocket.dryCg + motorMass * pos.cgX) / totalMass;
  return { mass: totalMass, cgX };
}
