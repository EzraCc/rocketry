import type { Component } from "../../model/component.js";
import type { AtmosphericConditions } from "../atmosphere/isa-model.js";
import { baseRadius, overallLength, referenceDiameter, totalWettedArea } from "../geometry/rocket-geometry.js";

/**
 * Drag coefficient: skin friction (Reynolds-number-based Cf on the rocket's
 * wetted area) + base drag (Mach-dependent, on the blunt aft-end area). Both
 * are well-established, independently-derivable aerodynamics correlations
 * (not transcribed from any specific tool's source), matching the two
 * dominant real contributors for a basic finned rocket with an open/flat aft
 * end. Nose/shoulder pressure drag is a smaller secondary-order term and is
 * deliberately deferred (documented, not silently ignored) for MVP scope,
 * matching how the CP calculation similarly defers the small Galejs body-lift
 * term.
 */
export interface DragResult {
  cd: number;
  cdFriction: number;
  cdBase: number;
  reynoldsNumber: number;
}

/**
 * Geometry-derived constants (reference area, wetted area, base area,
 * length) that don't change during a flight. computeDrag() below recomputes
 * these every call for one-off/test use, which is fine in isolation — but
 * they involve numeric Simpson's-rule integration over each body component
 * (see integrateWettedArea), which is too expensive to redo at every RK4
 * substep of a flight simulation (potentially 10^5+ calls). The simulator
 * should call computeDragGeometry() ONCE per rocket and reuse it via
 * computeDragFromGeometry() for every step.
 */
export interface DragGeometry {
  refArea: number;
  wettedArea: number;
  baseArea: number;
  length: number;
}

export function computeDragGeometry(components: Component[]): DragGeometry {
  const refDiameter = referenceDiameter(components);
  const refArea = Math.PI * (refDiameter / 2) ** 2;
  const wettedArea = totalWettedArea(components);
  const base = baseRadius(components);
  const baseArea = Math.PI * base * base;
  const length = overallLength(components);
  return { refArea, wettedArea, baseArea, length };
}

/** Reynolds-number-based skin-friction coefficient (classic flat-plate correlations). */
function frictionCoefficient(reynoldsNumber: number): number {
  if (reynoldsNumber < 1e4) return 1.33e-2; // low-Re floor, avoids the 1/sqrt(Re) singularity near Re=0
  if (reynoldsNumber < 5.39e5) return 1.328 / Math.sqrt(reynoldsNumber); // laminar flat plate
  const logRe = Math.log(reynoldsNumber);
  return 1 / Math.pow(1.5 * logRe - 5.6, 2) - 1700 / reynoldsNumber; // turbulent flat plate
}

/** Mach-dependent base drag coefficient, referenced to base area (Barrowman's commonly-used empirical fit). */
function baseDragCoefficient(mach: number): number {
  if (mach <= 1) return 0.12 + 0.13 * mach * mach;
  return 0.25 / mach;
}

export function computeDragFromGeometry(
  geometry: DragGeometry,
  velocity: number, // m/s, airspeed magnitude
  mach: number,
  atmosphere: AtmosphericConditions,
): DragResult {
  if (geometry.refArea < 1e-12) return { cd: 0, cdFriction: 0, cdBase: 0, reynoldsNumber: 0 };

  const kinematicViscosity = atmosphere.dynamicViscosity / atmosphere.density;
  const reynoldsNumber = kinematicViscosity > 1e-12 ? (velocity * geometry.length) / kinematicViscosity : 0;

  const cf = frictionCoefficient(reynoldsNumber);
  const cdFriction = (cf * geometry.wettedArea) / geometry.refArea;
  const cdBase = (baseDragCoefficient(mach) * geometry.baseArea) / geometry.refArea;

  return { cd: cdFriction + cdBase, cdFriction, cdBase, reynoldsNumber };
}

/** Convenience one-shot version (recomputes geometry every call — fine for tests/one-off use, not for a simulation loop). */
export function computeDrag(
  components: Component[],
  velocity: number,
  mach: number,
  atmosphere: AtmosphericConditions,
): DragResult {
  return computeDragFromGeometry(computeDragGeometry(components), velocity, mach, atmosphere);
}
