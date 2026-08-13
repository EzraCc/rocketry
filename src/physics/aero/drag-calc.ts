import { aftRadius, foreRadius, isBodyComponent, type BodyComponent, type Component } from "../../model/component.js";
import type { AtmosphericConditions } from "../atmosphere/isa-model.js";
import { bodyComponentRadius, baseRadius, overallLength, referenceDiameter, totalWettedArea } from "../geometry/rocket-geometry.js";

/**
 * Drag coefficient: skin friction (Reynolds-number-based Cf on the rocket's
 * wetted area), base drag (Mach-dependent, on the blunt aft-end area), and
 * pressure/wave drag on nose cones, boat tails, and widening transitions.
 *
 * The pressure/wave term was originally deferred as "a smaller secondary-
 * order term" (true subsonically, where friction dominates) — but that
 * framing missed that it becomes the DOMINANT drag term through transonic
 * and into supersonic flight, which a Barrowman-class linear aero model
 * already can't predict CP/CNa for reliably (see engine3d.ts's Mach-validity
 * warning). Without it, a rocket that reaches Mach 0.8+ saw its drag
 * effectively flatten out instead of rising sharply, letting simulated
 * flights reach unrealistic velocity/altitude a real rocket on the same
 * motor couldn't achieve — a real, reported bug, not a hypothetical gap.
 *
 * The nose/transition formula below is transcribed from OpenRocket's own
 * SymmetricComponentCalc.calculatePressureCD / calculateOgiveNoseInterpolator
 * (core/src/main/java/info/openrocket/core/aerodynamics/barrowman/
 * SymmetricComponentCalc.java) for the closed-form conical/ogive case
 * specifically (OR's other nose shapes use NASA TR-R-100 experimental lookup
 * tables instead of a closed form — not transcribed here; this project
 * applies the same closed-form ogive/conical formula to every shape as a
 * documented approximation, using each shape's own local tip slope, rather
 * than the full per-shape empirical table system). M<1 and M>=1.3 are exact
 * transcriptions; M∈[1,1.3) uses a cubic Hermite blend matching OR's own
 * value+derivative anchors at both ends (see growingShapePressureCd's own
 * doc comment for why the derivatives, not just the endpoint values, are
 * what actually matter here). The boat-tail and Mach-dependent base-drag
 * formulas are exact transcriptions throughout.
 */
export interface DragResult {
  cd: number;
  cdFriction: number;
  cdBase: number;
  cdPressure: number;
  reynoldsNumber: number;
}

interface PressureDragTerm {
  frontalArea: number; // m^2
  growing: boolean; // true: nose cone or widening transition; false: boat tail (narrowing transition)
  sinphi: number; // used only if growing -- sine of the local tip slope near the base
  mul: number; // used only if growing -- ogive shape-parameter multiplier (1.0 for conical / non-ogive shapes)
  fineness: number; // used only if !growing (boat tail fineness ratio)
}

/**
 * Geometry-derived constants (reference area, wetted area, base area,
 * length, pressure-drag terms) that don't change during a flight.
 * computeDrag() below recomputes these every call for one-off/test use,
 * which is fine in isolation — but they involve numeric Simpson's-rule
 * integration over each body component (see integrateWettedArea), which is
 * too expensive to redo at every RK4 substep of a flight simulation
 * (potentially 10^5+ calls). The simulator should call
 * computeDragGeometry() ONCE per rocket and reuse it via
 * computeDragFromGeometry() for every step.
 */
export interface DragGeometry {
  refArea: number;
  wettedArea: number;
  baseArea: number;
  length: number;
  pressureTerms: PressureDragTerm[];
}

const EPS = 1e-9;

/**
 * Sine of the local tangent half-angle near a growing shape's base —
 * evaluated numerically at 99% of the component's length, generic across
 * every shape this project supports. OR hard-codes this to exactly 0 for a
 * perfect tangent ogive (param=1) instead of evaluating it, presumably to
 * dodge a numerical edge case in OR's own closed-form radius function right
 * at the point of tangency. This project's own bodyComponentRadius is
 * well-behaved there (checked directly: gives a small, positive, finite
 * value for a real tangent ogive, not NaN or a sign flip), so there's no
 * numerical reason to special-case it here — and doing so matters: forcing
 * sinphi to exactly 0 doesn't just zero the endpoint pressure-drag values,
 * it *also* zeroes the OTHERWISE-substantial transonic derivative term in
 * growingShapePressureCd (see that function's doc comment), which is real
 * physics being thrown away for the single most common real nose cone
 * parameterization, not a negligible simplification.
 */
function sinPhiNearBase(c: BodyComponent): number {
  if (c.length <= 0) return 0;
  const aft = aftRadius(c);
  const r99 = bodyComponentRadius(c, 0.99 * c.length);
  const dr = aft - r99;
  return dr / Math.hypot(dr, 0.01 * c.length);
}

/** Ogive shape-parameter multiplier from OR's calculateOgiveNoseInterpolator — 1.0 for conical (param=0) and every non-ogive shape (not meaningful outside the ogive family, so left neutral rather than misapplied). */
function ogiveMultiplier(c: BodyComponent): number {
  if (c.type !== "bodytube" && c.shape === "ogive") {
    const p = c.shapeParameter;
    return 0.72 * (p - 0.5) * (p - 0.5) + 0.82;
  }
  return 1;
}

export function computeDragGeometry(components: Component[]): DragGeometry {
  const refDiameter = referenceDiameter(components);
  const refArea = Math.PI * (refDiameter / 2) ** 2;
  const wettedArea = totalWettedArea(components);
  const base = baseRadius(components);
  const baseArea = Math.PI * base * base;
  const length = overallLength(components);

  const pressureTerms: PressureDragTerm[] = [];
  for (const c of components) {
    if (!isBodyComponent(c)) continue;
    const r0 = foreRadius(c);
    const r1 = aftRadius(c);
    if (Math.abs(r1 - r0) < EPS) continue; // body tube (or a degenerate transition) -- no pressure drag contribution

    const frontalArea = Math.PI * Math.abs(r1 * r1 - r0 * r0);
    if (r1 > r0) {
      pressureTerms.push({ frontalArea, growing: true, sinphi: sinPhiNearBase(c), mul: ogiveMultiplier(c), fineness: 0 });
    } else {
      const fineness = c.length / (2 * Math.abs(r1 - r0));
      pressureTerms.push({ frontalArea, growing: false, sinphi: 0, mul: 1, fineness });
    }
  }

  return { refArea, wettedArea, baseArea, length, pressureTerms };
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

/**
 * Pressure/wave drag coefficient for a growing shape (nose cone or widening
 * transition), referenced to ITS OWN frontal area — transcribed from OR's
 * calculateOgiveNoseInterpolator: exact in the M<1 and M>=1.3 regions (no
 * singularity risk there), and a cubic Hermite blend in between matching
 * OR's own value+derivative anchors at M=1 and M=1.3 (OR's own PolyInterpolator
 * call with 4 arguments is exactly this: two values, two derivatives, one
 * cubic). The derivatives matter, not just the endpoint values: for a near-
 * tangent ogive (sinphi close to 0, the single most common real nose cone
 * parameterization) both endpoint VALUES are close to zero, but the
 * derivative at M=1 is large and essentially sinphi-independent
 * (4/(GAMMA+1) with sinphi~0) -- so the real transonic drag bump comes
 * entirely from that slope, not the endpoints. A naive straight-line blend
 * between two near-zero points misses this bump completely, which was the
 * actual root cause of this project's under-predicted transonic/supersonic
 * drag (see module doc comment) surviving an earlier, value-only version of
 * this function even after this whole pressure-drag term was added.
 */
function growingShapePressureCd(mach: number, sinphi: number, mul: number): number {
  const GAMMA = 1.4;
  const cd0 = 0.8 * sinphi * sinphi; // OR: cdMach0 (bare -- OR doesn't scale this anchor by mul either)
  const cd1 = sinphi; // OR: cdMach1 (bare)
  const cd1_3 = 2.1 * sinphi * sinphi + 0.6019 * sinphi; // OR: cdMach1_3 (bare)
  const deriv1 = (4 / (GAMMA + 1)) * (1 - 0.5 * cd1); // OR's given derivative at M=1
  const deriv1_3 = -1.1341 * sinphi; // OR's given derivative at M=1.3

  if (mach >= 1.3) {
    return mul * (2.1 * sinphi * sinphi + (0.5 * sinphi) / Math.sqrt(mach * mach - 1));
  }
  if (mach >= 1) {
    const dx = 0.3;
    const t = (mach - 1) / dx;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return mul * (h00 * cd1 + h10 * dx * deriv1 + h01 * cd1_3 + h11 * dx * deriv1_3);
  }
  const t = Math.max(0, Math.min(1, mach));
  return mul * (cd0 + t * (cd1 - cd0));
}

/** Pressure drag coefficient for a boat tail (narrowing transition), referenced to ITS OWN frontal area — exact transcription of OR's calculatePressureCD boat-tail branch. */
function boattailPressureCd(mach: number, fineness: number): number {
  if (fineness >= 3) return 0;
  const cd = baseDragCoefficient(mach);
  if (fineness <= 1) return cd;
  return (cd * (3 - fineness)) / 2;
}

export function computeDragFromGeometry(
  geometry: DragGeometry,
  velocity: number, // m/s, airspeed magnitude
  mach: number,
  atmosphere: AtmosphericConditions,
): DragResult {
  if (geometry.refArea < 1e-12) return { cd: 0, cdFriction: 0, cdBase: 0, cdPressure: 0, reynoldsNumber: 0 };

  const kinematicViscosity = atmosphere.dynamicViscosity / atmosphere.density;
  const reynoldsNumber = kinematicViscosity > 1e-12 ? (velocity * geometry.length) / kinematicViscosity : 0;

  const cf = frictionCoefficient(reynoldsNumber);
  const cdFriction = (cf * geometry.wettedArea) / geometry.refArea;
  const cdBase = (baseDragCoefficient(mach) * geometry.baseArea) / geometry.refArea;

  let cdPressure = 0;
  for (const term of geometry.pressureTerms) {
    const areaFraction = term.frontalArea / geometry.refArea;
    const termCd = term.growing ? growingShapePressureCd(mach, term.sinphi, term.mul) : boattailPressureCd(mach, term.fineness);
    cdPressure += termCd * areaFraction;
  }

  return { cd: cdFriction + cdBase + cdPressure, cdFriction, cdBase, cdPressure, reynoldsNumber };
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
