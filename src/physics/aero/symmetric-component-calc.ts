import { aftRadius, foreRadius, type BodyComponent } from "../../model/component.js";
import { bodyComponentPlanform, bodyComponentVolume } from "../geometry/rocket-geometry.js";

/**
 * OpenRocket's own empirical Galejs body-lift coefficient
 * (SymmetricComponentCalc.BODY_LIFT_K) -- see bodyLiftCna's own doc comment.
 */
const BODY_LIFT_K = 1.1;

/**
 * `sin(alpha)*sinc(alpha)` (= sin(alpha)^2/alpha), OpenRocket's own literal expression
 * (SymmetricComponentCalc.getLiftCP's own comment: "sin(aoa)^2 / aoa") -- NOT the same as the
 * small-angle-limit "1" a bare sinc(alpha) would approach. This whole quantity -> 0 as alpha -> 0
 * (it's O(alpha), not O(1)) -- see bodyLiftCna's own doc comment for why that matters.
 */
function sinAlphaSincAlpha(alphaRad: number): number {
  const a = Math.abs(alphaRad);
  if (a < 1e-9) return 0;
  const s = Math.sin(a);
  return (s * s) / a;
}

/**
 * Galejs body-lift CNa contribution, added to EVERY symmetric component in OpenRocket -- not just
 * plain body tubes, which is where this project's own gap was most visible (a tube's own shape
 * term is exactly zero, so it used to report zero lift outright) but not the full extent of the
 * port: OpenRocket's own SymmetricComponentCalc.getLiftCP is called unconditionally for nose
 * cones and transitions too, then CNa-weighted-averaged with the shape's own term via the same
 * combination rule this project's own computeBarrowman already uses for whole-rocket CP.
 *
 * **This term contributes EXACTLY ZERO at alpha=0** -- confirmed the hard way: an earlier version
 * of this port treated it as a plain small-angle-limit CONSTANT (K*planformArea/refArea), which
 * moved this project's own static CP measurably further from real OpenRocket output, not closer,
 * once checked against openrocket-comparison.test.ts's real Java-simulation fixtures (all of which
 * are generated at AOA=0 -- see RocketryOracle.java, which never calls conditions.setAOA). Working
 * through OpenRocket's OWN final CN formula end to end (`forces.setCN(cp.getWeight() * AOA)`,
 * where `cp.getWeight()` is this term's own `sin(AOA)*sinc(AOA)` factor) shows why: OpenRocket's
 * literal CN contribution from body lift is `K*planformArea/refArea * sin(AOA)^2` -- QUADRATIC in
 * AOA, not linear -- so it has no representation at all in a linearized "CN = CNa*alpha" theory at
 * alpha=0 itself; it only exists as alpha moves away from zero. (A first attempt at this comment
 * mistook the raw `sin(alpha)*sinc(alpha)` WEIGHT field, which does behave like alpha for small
 * alpha, for the final CN itself, which is that weight multiplied by alpha AGAIN -- hence
 * quadratic, not linear. Recorded here so this mistake doesn't get made twice.)
 *
 * Practically: this means body lift is invisible in every STATIC display this project shows
 * (computed at alpha=0 by convention -- the UI's CP stat, the stability margin, the whole
 * validation suite) exactly like real OpenRocket's own equivalent figures are -- it only affects
 * the actual DYNAMIC flight simulation (derivatives3d.ts's second Barrowman pass, at the real
 * computed AOA each step), where it's a genuine, if second-order, contribution to the restoring
 * moment. OpenRocket's own AOA-dependent damping correction on this term (active only above
 * AOA=45 degrees) is not ported -- this project's own 20-degree stall-angle clamp
 * (derivatives3d.ts) means that branch can never actually fire here.
 */
function bodyLiftCna(planformArea: number, refArea: number, alphaRad: number): number {
  return BODY_LIFT_K * (planformArea / refArea) * sinAlphaSincAlpha(alphaRad);
}

/**
 * Barrowman slender-body CNa/CP for a nose cone, body tube, or transition
 * (incl. boat tail). Port of SymmetricComponentCalc.java:118-148:
 *   A0 = pi*foreRadius^2, A1 = pi*aftRadius^2
 *   CNa = 2*(A1-A0) / refArea   [normalized to a dimensionless per-radian slope,
 *                                 same convention FinSetCalc uses internally —
 *                                 verified against a real rocket's RockSim file,
 *                                 which stores the well-known Barrowman invariant
 *                                 CNa=2.0 for a pointed nose cone when refArea
 *                                 equals its own base area]
 *   CPx = (length*A1 - fullVolume) / (A1-A0)   [local to the component's own fore end]
 * plus the Galejs body-lift term (bodyLiftCna above, alpha-dependent -- see its own doc
 * comment), combined via the standard CNa-weighted CP average -- matching OpenRocket's own
 * Coordinate.average(), the same rule this project's computeBarrowman already uses to combine
 * components. At alphaRad=0 (every static display caller's default), body lift is exactly zero
 * and this reduces to precisely the pre-port formula.
 */
export function symmetricComponentAero(
  c: BodyComponent,
  refArea: number,
  alphaRad = 0,
): { cna: number; cpX: number } {
  if (refArea < 1e-12) {
    return { cna: 0, cpX: c.length / 2 };
  }

  const r0 = foreRadius(c);
  const r1 = aftRadius(c);
  const a0 = Math.PI * r0 * r0;
  const a1 = Math.PI * r1 * r1;
  const denom = a1 - a0;

  const { area: planformArea, centroid: planformCenter } = bodyComponentPlanform(c);
  const liftCna = bodyLiftCna(planformArea, refArea, alphaRad);

  if (Math.abs(denom) < 1e-12) {
    // Plain tube: no shoulder discontinuity, so only the body-lift term contributes (matches
    // OpenRocket's own isTube branch, which calls getLiftCP alone with no averaging).
    return liftCna > 1e-12 ? { cna: liftCna, cpX: planformCenter } : { cna: 0, cpX: c.length / 2 };
  }

  const shapeCna = (2 * denom) / refArea;
  const volume = bodyComponentVolume(c);
  const shapeCpX = (c.length * a1 - volume) / denom;

  const totalCna = shapeCna + liftCna;
  const cpX = Math.abs(totalCna) > 1e-12 ? (shapeCpX * shapeCna + planformCenter * liftCna) / totalCna : (shapeCpX + planformCenter) / 2;
  return { cna: totalCna, cpX };
}
