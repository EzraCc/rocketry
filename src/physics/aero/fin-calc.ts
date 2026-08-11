import type { TrapezoidalFinSet } from "../../model/component.js";

/**
 * Trapezoidal fin-set Barrowman CNa/CP, MVP-simplified for subsonic flight.
 *
 * OpenRocket computes this by looping over each individual fin (evaluated at
 * its own roll angle) and summing sin^2(theta-angle) weighted contributions
 * (FinSetCalc.java:104-116). For N>=2 evenly-spaced fins that sum is
 * *exactly* independent of wind roll angle theta — verified here against
 * OpenRocket's own FinSetCalcTest fixture (Estes Alpha III, root=0.05,
 * tip=0.03, sweep=0.02, span=0.05): the 4-fin/3-fin expected CNa ratio is
 * 32.195911/24.146933 = 1.33333... = 4/3 exactly, matching a bare
 * (finCount/2) aggregate factor (interference factor is 1.0 for both since
 * finCount<=4). So for N>=2 this closed form is not an approximation of
 * OpenRocket's result, it's algebraically the same sum.  N=1 is a rare edge
 * case (omitted from MVP; would need explicit roll-angle tracking).
 */

const CNA_SUBSONIC = 0.9;

export interface FinAeroResult {
  cna: number; // already normalized by reference area
  cpX: number; // axial position from the fin root's leading edge
}

export function trapezoidFinAero(
  fin: TrapezoidalFinSet,
  bodyRadius: number,
  mach: number,
  refArea: number,
): FinAeroResult {
  const { rootChord, tipChord, sweepLength, span, finCount } = fin;
  const finArea = (span * (rootChord + tipChord)) / 2;

  if (finArea < 1e-9 || span < 1e-9 || refArea < 1e-9 || finCount < 1) {
    return { cna: 0, cpX: rootChord / 4 };
  }

  // Mid-chord sweep cosine (Diederich-style sweep correction for CNa1).
  const midChordDx = sweepLength + tipChord / 2 - rootChord / 2;
  const cosGamma = span / Math.hypot(span, midChordDx);

  const cna1 = finCNa1(span, finArea, cosGamma, mach, refArea);

  // Closed-form trapezoid MAC.
  const taper = rootChord > 1e-12 ? tipChord / rootChord : 0;
  const macLength = ((2 / 3) * rootChord * (1 + taper + taper * taper)) / (1 + taper);
  const macSpanPos = ((span / 3) * (1 + 2 * taper)) / (1 + taper);
  const macLead = span > 1e-12 ? macSpanPos * (sweepLength / span) : 0;

  const tau = bodyRadius / (span + bodyRadius);
  const bodyFactor = bodyFinInterferenceFactor(Number.isFinite(tau) ? tau : 0, mach);
  const finCountFactor = multiFinInterferenceFactor(finCount);

  const cna = cna1 * (finCount / 2) * finCountFactor * bodyFactor;

  // Subsonic CP: quarter-chord of the MAC. (Supersonic/transonic CP shift is
  // deliberately not modeled for MVP — flagged elsewhere with a Mach warning.)
  const cpX = macLead + 0.25 * macLength;

  return { cna, cpX };
}

/** Single-fin CNa slope (subsonic-only; transonic/supersonic clamped to the M=0.9 value for MVP). */
function finCNa1(span: number, finArea: number, cosGamma: number, mach: number, refArea: number): number {
  const m = Math.min(mach, CNA_SUBSONIC);
  const term = (span * span) / (finArea * cosGamma);
  return (2 * Math.PI * span * span) / (1 + Math.sqrt(1 + (1 - m * m) * term * term)) / refArea;
}

/** Multi-fin interference factor (FinSetCalc.java: 1..4 -> 1.0, 5-8 -> table, >8 -> 0.75). */
function multiFinInterferenceFactor(finCount: number): number {
  switch (finCount) {
    case 1:
    case 2:
    case 3:
    case 4:
      return 1.0;
    case 5:
      return 0.948;
    case 6:
      return 0.913;
    case 7:
      return 0.854;
    case 8:
      return 0.81;
    default:
      return 0.75;
  }
}

/**
 * Body-fin interference correction — the CORRECTED formula (reciprocal
 * NACA-1307 identity, (1+tau)^2 subsonic) rather than OpenRocket's currently
 * shipped `1+tau`. See PR openrocket/openrocket#3220 (merged then reverted
 * for an unrelated CI issue, not a correctness issue); values verified
 * against that PR's own FinBodyInterferenceTest.java (tau=0.25 -> 1.5625 at
 * M<=0.9, 1.40625 at M=1.2, 1.25 at M>=1.5).
 */
export function bodyFinInterferenceFactor(tau: number, mach: number): number {
  const finInBodyFactor = 1 + tau;
  const CNA_SUPERSONIC = 1.5;
  if (mach <= CNA_SUBSONIC) return finInBodyFactor * finInBodyFactor;
  if (mach >= CNA_SUPERSONIC) return finInBodyFactor;
  const bodyInFinFactor = tau * finInBodyFactor;
  const weight = (CNA_SUPERSONIC - mach) / (CNA_SUPERSONIC - CNA_SUBSONIC);
  return finInBodyFactor + weight * bodyInFinFactor;
}
