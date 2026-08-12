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

  const cna = combineFinSetCna(cna1, finCount, bodyRadius, span, mach);

  // Subsonic CP: quarter-chord of the MAC. (Supersonic/transonic CP shift is
  // deliberately not modeled for MVP — flagged elsewhere with a Mach warning.)
  const cpX = macLead + 0.25 * macLength;

  return { cna, cpX };
}

/** Single-fin CNa slope (subsonic-only; transonic/supersonic clamped to the M=0.9 value for MVP). */
export function finCNa1(span: number, finArea: number, cosGamma: number, mach: number, refArea: number): number {
  const m = Math.min(mach, CNA_SUBSONIC);
  const term = (span * span) / (finArea * cosGamma);
  return (2 * Math.PI * span * span) / (1 + Math.sqrt(1 + (1 - m * m) * term * term)) / refArea;
}

/**
 * Combines a single fin's CNa1 into the whole fin-set's CNa: the (finCount/2)
 * aggregate (see module doc comment for why this is exact, not approximate,
 * for N>=2 evenly-spaced fins), the multi-fin interference table, the
 * corrected fin-in-body-presence factor, and — new — the body-in-fin-presence
 * (Kbf) contribution: normal force induced ON THE BODY by the fins, which
 * classical Barrowman omits (see bodyInFinPresenceFactor doc comment).
 *
 * Kbf is applied using the same (finCount/2 * multi-fin-interference)
 * aggregate used for the fins' own force. NACA 1307's K_B(W) is derived for
 * a 2-panel wing-body case; there's no published N-fin generalization, so
 * reusing the fin-side aggregation convention here is a reasonable,
 * documented engineering extension, not directly-verified NACA 1307 content
 * for N>2. Folded directly into this single returned CNa (rather than kept
 * as a separate body-attributed term) as a simplification: the induced body
 * lift is treated as acting at the fin's own CP, not the true (slightly
 * different, Mach-cone-dependent) body-surface region NACA 1307 describes —
 * reasonable for MVP but worth revisiting if CP accuracy near the fin root
 * turns out to matter more than this.
 *
 * Kbf is subsonic-only (mach <= 0.9): the NACA 1307 closed form it comes
 * from is only stated to hold in that regime, and extrapolating it past
 * that without a separate validated supersonic formula would be a guess.
 */
export function combineFinSetCna(
  cna1: number,
  finCount: number,
  bodyRadius: number,
  span: number,
  mach: number,
): number {
  const tau = Number.isFinite(bodyRadius / (span + bodyRadius)) ? bodyRadius / (span + bodyRadius) : 0;
  const finCountFactor = multiFinInterferenceFactor(finCount);
  const aggregateCna1 = cna1 * (finCount / 2) * finCountFactor;

  const bodyFactor = bodyFinInterferenceFactor(tau, mach);
  const finCna = aggregateCna1 * bodyFactor;

  const bodyInducedCna = mach <= CNA_SUBSONIC ? aggregateCna1 * bodyInFinPresenceFactor(tau) : 0;

  return finCna + bodyInducedCna;
}

/** Multi-fin interference factor (FinSetCalc.java: 1..4 -> 1.0, 5-8 -> table, >8 -> 0.75). */
export function multiFinInterferenceFactor(finCount: number): number {
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
 * Exact subsonic slender-body-theory fin(wing)-in-presence-of-body factor,
 * K_W(B) — Pitts, Nielsen & Kaattari, NACA Report 1307 (1953), equation (14),
 * transcribed directly from the report (pdas.com/refs/rep1307.pdf, p.570) —
 * not the `(1+tau)^2` approximation this project previously used (that
 * approximation is what OpenRocket's own PR openrocket/openrocket#3220 used
 * as its "corrected" formula; NACA 1307's exact closed form is a further,
 * more accurate correction beyond that PR, not a re-derivation of it).
 * `tau` = bodyRadius/(bodyRadius+span), i.e. NACA 1307's own `r/s` (body
 * radius to semispan-from-axis ratio) — this project's existing `tau`
 * definition already matches that ratio exactly, no conversion needed.
 *
 * Numerically: at tau=0.25 this gives ~1.206, vs. ~1.563 from the old
 * (1+tau)^2 approximation — the squared approximation was a real
 * overestimate of the fin-in-body-presence boost, not just a rougher
 * version of the same number.
 *
 * Verified against the report's own two closed-form limits: x->0 (all-fin,
 * no body) -> 1; x->1 (vanishing exposed fin) -> 2 — see fin-calc.test.ts.
 */
export function finInBodyPresenceFactor(tau: number): number {
  const x = Math.min(Math.max(tau, 0), 1);
  if (x < 1e-6) return 1;
  if (x > 1 - 1e-6) return 2;
  const term1 = (1 + x ** 4) * (0.5 * Math.atan(0.5 * (1 / x - x)) + Math.PI / 4);
  const term2 = x * x * (1 / x - x + 2 * Math.atan(x));
  const numerator = (2 / Math.PI) * (term1 - term2);
  const denominator = (1 - x) * (1 - x);
  return numerator / denominator;
}

/**
 * Exact subsonic body-in-presence-of-fin(wing) factor, K_B(W) — NACA 1307
 * equation (21). This is "Kbf": the normal force carried onto the BODY by
 * the fins, which classical Barrowman (and OpenRocket, by its own admission
 * — see doc/techdoc/techdoc.pdf §3.2.2: "the normal force on the body due to
 * the presence of fins... is therefore ignored") omits entirely.
 *
 * Rather than transcribe equation (21) separately, this uses the closed
 * identity visible by comparing (14) and (21) directly (both share the same
 * bracketed term, and (1-x^2)^2/(1-x)^2 = (1+x)^2):
 *   K_W(B) + K_B(W) = (1+tau)^2
 * Cross-checked against the report's own stated limits: tau->0 gives
 * K_B(W)->0 ("combination is all wing"); tau->1 gives K_B(W)=K_W(B)=2
 * ("lift on the body due to the wing is the same as the lift on the wing
 * itself") — both match exactly, see fin-calc.test.ts.
 */
export function bodyInFinPresenceFactor(tau: number): number {
  const x = Math.min(Math.max(tau, 0), 1);
  return (1 + x) * (1 + x) - finInBodyPresenceFactor(x);
}

/**
 * Body-fin interference correction for the FIN's own CNa — the CORRECTED
 * subsonic formula (exact NACA-1307 K_W(B) above) rather than OpenRocket's
 * currently-shipped `1+tau`, or this project's own earlier `(1+tau)^2`
 * approximation. Transonic/supersonic blending structure is unchanged from
 * before (still anchored on the simple `1+tau` factor at M>=1.5 — a proper
 * supersonic K_W(B) closed form would need separate linear-supersonic-theory
 * charts from NACA 1307 not yet transcribed here, so this project doesn't
 * claim supersonic accuracy beyond what it already had).
 */
export function bodyFinInterferenceFactor(tau: number, mach: number): number {
  const finInBodyFactor = 1 + tau;
  const CNA_SUPERSONIC = 1.5;
  if (mach <= CNA_SUBSONIC) return finInBodyPresenceFactor(tau);
  if (mach >= CNA_SUPERSONIC) return finInBodyFactor;
  const transonicBlendTerm = tau * finInBodyFactor;
  const weight = (CNA_SUPERSONIC - mach) / (CNA_SUPERSONIC - CNA_SUBSONIC);
  return finInBodyFactor + weight * transonicBlendTerm;
}
