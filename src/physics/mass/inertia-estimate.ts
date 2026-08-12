import type { Rocket } from "../../model/rocket.js";
import { finSetPlanformArea, isBodyComponent, isFinSet, type Component } from "../../model/component.js";
import { bodyComponentWettedArea, placeComponents } from "../geometry/rocket-geometry.js";
import { motorAxialPosition } from "./combined-mass.js";
import { getMotorMassAt, type MassCurve } from "./motor-mass-curve.js";

/**
 * Transverse (pitch/yaw) rotational inertia estimate. There is no
 * OpenRocket equivalent to port here — OpenRocket derives inertia from
 * material density x volume per component (masscalc/MassCalculator.java),
 * which this project deliberately doesn't do (mass/CG are manual, per the
 * project's scope). This is a genuine from-scratch design, not a port, and
 * was flagged from the start as the single highest-judgment piece of the
 * whole project.
 *
 * Roll inertia is NOT modeled at all — this simulator never tracks roll
 * (see fin-calc.ts: the aggregate fin normal-force is exactly independent
 * of roll angle for N>=2 evenly-spaced fins), so only the transverse axis
 * (same by symmetry for any direction perpendicular to the body axis)
 * matters for the pitch/yaw dynamics M4 needs.
 *
 * Method: distribute the user's total dry mass across components
 * proportional to each component's wetted area (a "uniform areal density"
 * shell assumption — reasonable first-order approximation for typical
 * hobby-rocket construction where wall material is roughly similar across
 * the airframe), each lump placed at its own component's axial midpoint.
 * That shape's own centroid generally won't exactly equal the user's
 * entered dry CG (real rockets aren't uniform-density shells — nose weight,
 * avionics bays, etc. shift it) — rather than silently accept that
 * inconsistency, the whole lumped distribution is rigidly shifted so its
 * centroid exactly matches the entered dry CG, preserving the *shape* of
 * the estimate while guaranteeing consistency with the one number the user
 * actually specified. Each lump is then treated as a point mass (its own
 * "self" rotational inertia is dropped) — for a slender rocket, transverse
 * inertia is overwhelmingly dominated by parallel-axis mass*distance^2
 * terms over the rocket's full length, not by any single component's own
 * local extent, so this is a reasonable simplification, not corner-cutting
 * on the dominant term.
 *
 * The motor is similarly treated as a point mass at its own axial position
 * (from combined-mass.ts), with its known time-varying mass from the M2
 * mass curve.
 */

interface MassLump {
  x: number; // m from nose tip
  mass: number; // kg
}

export interface DryInertiaModel {
  /** Transverse inertia (kg*m^2) of the dry structure alone, about its OWN dry CG (fixed — recomputed once per rocket). */
  structureInertiaAboutDryCg: number;
  dryCg: number;
  dryMass: number;
}

function componentMidpoint(placedX0: number, length: number): number {
  return placedX0 + length / 2;
}

function structureMassLumps(rocket: Rocket): MassLump[] {
  const placed = placeComponents(rocket.components);
  const weighted: { x: number; weight: number }[] = [];

  placed.forEach((entry) => {
    const c = entry.component;
    if (isBodyComponent(c)) {
      const weight = bodyComponentWettedArea(c);
      if (weight > 1e-12) weighted.push({ x: componentMidpoint(entry.x0, c.length), weight });
    } else if (isFinSet(c)) {
      // All fins in the set together; midpoint of the root chord is a reasonable proxy for a fin's own axial centroid.
      const rootChord = c.type === "finset" ? c.rootChord : Math.max(...c.points.map(([x]) => x), 0);
      const weight = c.finCount * finSetPlanformArea(c) * 2; // both sides
      if (weight > 1e-12) weighted.push({ x: componentMidpoint(entry.x0, rootChord), weight });
    }
  });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight < 1e-12 || rocket.dryMass <= 0) return [];

  const rawLumps: MassLump[] = weighted.map((w) => ({ x: w.x, mass: (w.weight / totalWeight) * rocket.dryMass }));
  const rawCentroid = rawLumps.reduce((sum, l) => sum + l.x * l.mass, 0) / rocket.dryMass;
  const shift = rocket.dryCg - rawCentroid;
  return rawLumps.map((l) => ({ x: l.x + shift, mass: l.mass }));
}

/** Computes the (fixed, rocket-geometry-only) dry structure inertia model — call once per rocket, not per timestep. */
export function computeDryInertiaModel(rocket: Rocket): DryInertiaModel {
  const lumps = structureMassLumps(rocket);
  if (lumps.length === 0) {
    // Fallback when there's no usable geometry (e.g. empty component list): treat the dry mass
    // as a thin uniform rod over the rocket's overall length, the standard textbook approximation
    // when no better distribution information is available.
    const length = overallLengthFallback(rocket.components);
    const inertia = length > 1e-6 ? (rocket.dryMass * length * length) / 12 : 0;
    return { structureInertiaAboutDryCg: inertia, dryCg: rocket.dryCg, dryMass: rocket.dryMass };
  }
  const inertia = lumps.reduce((sum, l) => sum + l.mass * (l.x - rocket.dryCg) ** 2, 0);
  return { structureInertiaAboutDryCg: inertia, dryCg: rocket.dryCg, dryMass: rocket.dryMass };
}

function overallLengthFallback(components: Component[]): number {
  return components.filter(isBodyComponent).reduce((sum, c) => sum + c.length, 0);
}

/**
 * Combined transverse inertia at simulation time t, re-based (parallel axis
 * theorem) to the current combined CG, which moves as the motor burns.
 */
export function combinedInertiaAt(
  rocket: Rocket,
  dryModel: DryInertiaModel,
  massCurve: MassCurve | null,
  combinedCgX: number,
  t: number,
): number {
  const structureAtCombinedCg =
    dryModel.structureInertiaAboutDryCg + dryModel.dryMass * (dryModel.dryCg - combinedCgX) ** 2;

  if (!rocket.motor || !massCurve) return Math.max(structureAtCombinedCg, 1e-9);

  const pos = motorAxialPosition(rocket);
  if (!pos) return Math.max(structureAtCombinedCg, 1e-9);

  const motorMass = getMotorMassAt(massCurve, t);
  const motorAtCombinedCg = motorMass * (pos.cgX - combinedCgX) ** 2;

  return Math.max(structureAtCombinedCg + motorAtCombinedCg, 1e-9);
}
