import type { FreeformFinSet } from "../../model/component.js";
import { combineFinSetCna, finCNa1 } from "./fin-calc.js";
import type { FinAeroResult } from "./fin-calc.js";

/**
 * Barrowman CNa/CP for an arbitrary-outline fin, by strip-integrating the
 * actual polygon (chord(y), MAC, sweep) rather than fitting a trapezoid.
 * Promoted from scripts/validate-loc-iv.ts, where this was validated against
 * a real RockSim CustomFinSet.
 *
 * Body-fin interference has since moved to the exact NACA 1307 K_W(B)/K_B(W)
 * formulas (see fin-calc.ts), which include the Kbf body-lift-due-to-fins
 * term classical Barrowman (and RockSim's own "BarromanXN") omit. Against
 * this same LOC-IV fixture that shifts whole-rocket CP from ~0.6% off
 * RockSim's classical BarromanXN (899.2mm, the old comparison point) to 5.2%
 * off it (946.4mm) — but only 2.7% off RockSim's own proprietary "extended"
 * method (RockSimXN, 972.6mm), which itself models interference beyond
 * classical Barrowman. Moving substantially closer to the extended value
 * while moving away from the classical one is a real signal the added
 * physics is capturing something RockSim's extended method also captures,
 * not just noise — but it does mean this fixture no longer cross-checks
 * against BarromanXN as tightly as it once did, by design.
 */
export function freeformFinAero(
  fin: FreeformFinSet,
  bodyRadius: number,
  mach: number,
  refArea: number,
  divisions = 400,
): FinAeroResult {
  const span = fin.points.reduce((max, [, y]) => Math.max(max, y), 0);
  if (span < 1e-9 || refArea < 1e-9 || fin.finCount < 1 || fin.points.length < 3) {
    return { cna: 0, cpX: 0 };
  }

  const closed = [...fin.points, fin.points[0]!];
  const chordAt = (y: number): { xLE: number; xTE: number } => {
    const xs: number[] = [];
    for (let i = 0; i < closed.length - 1; i++) {
      const [x0, y0] = closed[i]!;
      const [x1, y1] = closed[i + 1]!;
      if ((y0 <= y && y <= y1) || (y1 <= y && y <= y0)) {
        if (Math.abs(y1 - y0) < 1e-12) continue; // horizontal edge, neighbors cover it
        const t = (y - y0) / (y1 - y0);
        xs.push(x0 + t * (x1 - x0));
      }
    }
    if (xs.length < 2) return { xLE: 0, xTE: 0 };
    return { xLE: Math.min(...xs), xTE: Math.max(...xs) };
  };

  let area = 0;
  let areaChord2 = 0;
  let areaLE = 0;
  let sumCosGamma = 0;
  let cosGammaSamples = 0;
  let prevMidX: number | null = null;
  let prevY: number | null = null;
  const dy = span / divisions;

  for (let i = 0; i <= divisions; i++) {
    const y = (i / divisions) * span;
    const { xLE, xTE } = chordAt(y);
    const chord = xTE - xLE;
    const w = i === 0 || i === divisions ? 0.5 : 1;
    area += w * chord * dy;
    areaChord2 += w * chord * chord * dy;
    areaLE += w * xLE * chord * dy;

    const midX = (xLE + xTE) / 2;
    if (prevMidX !== null && prevY !== null) {
      const hyp = Math.hypot(midX - prevMidX, y - prevY);
      if (hyp > 1e-9) {
        sumCosGamma += (y - prevY) / hyp;
        cosGammaSamples++;
      }
    }
    prevMidX = midX;
    prevY = y;
  }

  if (area < 1e-12 || cosGammaSamples === 0) {
    return { cna: 0, cpX: 0 };
  }

  const finArea = area;
  const macLength = areaChord2 / area;
  const macLead = areaLE / area;
  const cosGamma = sumCosGamma / cosGammaSamples;

  const cna1 = finCNa1(span, finArea, cosGamma, mach, refArea);
  const cna = combineFinSetCna(cna1, fin.finCount, bodyRadius, span, mach);
  const cpX = macLead + 0.25 * macLength;

  return { cna, cpX };
}
