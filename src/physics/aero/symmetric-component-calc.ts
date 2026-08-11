import { aftRadius, foreRadius, type BodyComponent } from "../../model/component.js";
import { bodyComponentVolume } from "../geometry/rocket-geometry.js";

/**
 * Barrowman slender-body CNa/CP for a nose cone, body tube, or transition
 * (incl. boat tail). Port of SymmetricComponentCalc.java:118-148:
 *   A0 = pi*foreRadius^2, A1 = pi*aftRadius^2
 *   CNa = 2*(A1-A0)
 *   CPx = (length*A1 - fullVolume) / (A1-A0)   [local to the component's own fore end]
 * Body tubes (foreRadius==aftRadius) contribute CNa=0 (no shoulder discontinuity).
 * The Galejs body-lift term (planform-area based, small) is deferred for MVP.
 */
export function symmetricComponentAero(c: BodyComponent): { cna: number; cpX: number } {
  const r0 = foreRadius(c);
  const r1 = aftRadius(c);
  const a0 = Math.PI * r0 * r0;
  const a1 = Math.PI * r1 * r1;
  const denom = a1 - a0;

  if (Math.abs(denom) < 1e-12) {
    return { cna: 0, cpX: c.length / 2 };
  }

  const cna = 2 * denom;
  const volume = bodyComponentVolume(c);
  const cpX = (c.length * a1 - volume) / denom;
  return { cna, cpX };
}
