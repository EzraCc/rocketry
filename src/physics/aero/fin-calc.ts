import type { FinCrossSection, FreeformFinSet, TrapezoidalFinSet } from "../../model/component.js";

/** Matches derivatives3d.ts's own STALL_ANGLE (independently defined there too, same value -- see
 * that file's own comment on why: this project doesn't have a shared physics-constants module, and
 * duplicating one clearly-labeled constant is simpler than introducing a cross-module dependency
 * between the sim engine and the aero layer just to share it). Used here to clamp the angle of
 * attack fed into the supersonic fin CNa1 term below, matching OpenRocket's own
 * min(AOA, PI-AOA, STALL_ANGLE) clamp. */
const FIN_STALL_ANGLE = (20 * Math.PI) / 180;

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
const CNA_SUPERSONIC = 1.5;
const GAMMA = 1.4; // air's specific heat ratio
const CNA_SUPERSONIC_B = Math.pow(CNA_SUPERSONIC * CNA_SUPERSONIC - 1, 1.5);

export interface FinAeroResult {
  cna: number; // already normalized by reference area
  cpX: number; // axial position from the fin root's leading edge
}

export function trapezoidFinAero(
  fin: TrapezoidalFinSet,
  bodyRadius: number,
  mach: number,
  refArea: number,
  alphaRad = 0,
): FinAeroResult {
  const { rootChord, tipChord, sweepLength, span, finCount } = fin;
  const finArea = (span * (rootChord + tipChord)) / 2;

  if (finArea < 1e-9 || span < 1e-9 || refArea < 1e-9 || finCount < 1) {
    return { cna: 0, cpX: rootChord / 4 };
  }

  // Mid-chord sweep cosine (Diederich-style sweep correction for CNa1).
  const midChordDx = sweepLength + tipChord / 2 - rootChord / 2;
  const cosGamma = span / Math.hypot(span, midChordDx);

  const cna1 = finCNa1(span, finArea, cosGamma, mach, refArea, alphaRad);

  // Closed-form trapezoid MAC.
  const taper = rootChord > 1e-12 ? tipChord / rootChord : 0;
  const macLength = ((2 / 3) * rootChord * (1 + taper + taper * taper)) / (1 + taper);
  const macSpanPos = ((span / 3) * (1 + 2 * taper)) / (1 + taper);
  const macLead = span > 1e-12 ? macSpanPos * (sweepLength / span) : 0;

  const cna = combineFinSetCna(cna1, finCount, bodyRadius, span, mach);

  // Aspect ratio convention (2*span²/finArea, not span²/finArea): treats the exposed fin plus its
  // mirror image across the body as one full wing, matching classical wing aspect-ratio
  // definitions (AR = b²/S with b the FULL span) -- see finCpShiftFraction's own doc comment.
  const aspectRatio = (2 * span * span) / finArea;
  const cpX = macLead + finCpShiftFraction(mach, aspectRatio) * macLength;

  return { cna, cpX };
}

/**
 * Single-fin CNa slope. Subsonic (M<=0.9): unchanged closed form. Supersonic (M>=1.5): classical
 * linearized supersonic thin-wing theory (the K1/K2/K3 form below, same theoretical lineage
 * Barrowman's own subsonic method extends — not an OpenRocket invention), valid to M=5. Transonic
 * (0.9<M<1.5): a degree-4 polynomial matched to both endpoints' value AND slope, plus the
 * subsonic-side second derivative, exactly reproducing OpenRocket's own FinSetCalc.calculateFinCNa1
 * (aerodynamics/barrowman/FinSetCalc.java) -- ported directly rather than re-derived, including the
 * one aspect of it that looks like it could be a typo but isn't (see cna1TransonicDerivative's own
 * comment) -- fidelity to the real, tested tool matters more here than what might look "more
 * correct" in isolation.
 *
 * `alphaRad` (angle of attack) only matters supersonically -- K2/K3 are themselves AOA-dependent
 * terms, clamped the same way OpenRocket clamps them (min(|AOA|, stall angle); OpenRocket's own
 * min(AOA, PI-AOA, STALL_ANGLE) never hits its PI-AOA branch for a rocket flying forward, so it's
 * omitted here as dead code for that case, not a missed term).
 */
export function finCNa1(span: number, finArea: number, cosGamma: number, mach: number, refArea: number, alphaRad = 0): number {
  if (mach <= CNA_SUBSONIC) {
    return cna1Subsonic(mach, span, finArea, cosGamma, refArea);
  }

  const alpha = Math.min(Math.abs(alphaRad), FIN_STALL_ANGLE);

  if (mach >= CNA_SUPERSONIC) {
    return (finArea * (k1(mach) + k2(mach) * alpha + k3(mach) * alpha * alpha)) / refArea;
  }

  // Transonic blend -- see interpolateCna1Transonic's own doc comment for the exact constraint set.
  const subV = cna1Subsonic(CNA_SUBSONIC, span, finArea, cosGamma, refArea);
  const subD = cna1TransonicDerivative(mach, span, finArea, cosGamma, refArea);
  const superV = (finArea * (k1(CNA_SUPERSONIC) + k2(CNA_SUPERSONIC) * alpha + k3(CNA_SUPERSONIC) * alpha * alpha)) / refArea;
  const superD = ((-finArea / refArea) * 2 * CNA_SUPERSONIC) / CNA_SUPERSONIC_B;
  return interpolateCna1Transonic(mach, subV, superV, subD, superD);
}

function cna1Subsonic(mach: number, span: number, finArea: number, cosGamma: number, refArea: number): number {
  const term = (span * span) / (finArea * cosGamma);
  return (2 * Math.PI * span * span) / (1 + Math.sqrt(1 + (1 - mach * mach) * term * term)) / refArea;
}

/**
 * The subsonic-side derivative anchor for the transonic blend below -- ported exactly as
 * OpenRocket's own FinSetCalc.java has it, including evaluating `sq` at the fixed subsonic anchor
 * (M=0.9) while the rest of the expression uses the CURRENT (transonic) `mach`, not 0.9 -- looks
 * inconsistent at a glance (an analytic derivative *at* M=0.9 shouldn't depend on the current M at
 * all), but this is what the real, shipped, tested tool actually computes, not a bug to "fix" here.
 */
function cna1TransonicDerivative(mach: number, span: number, finArea: number, cosGamma: number, refArea: number): number {
  const term = (span * span) / (finArea * cosGamma);
  const sq = Math.sqrt(1 + (1 - CNA_SUBSONIC * CNA_SUBSONIC) * term * term);
  return (2 * mach * Math.PI * Math.pow(span, 6)) / (Math.pow(finArea * cosGamma, 2) * refArea * sq * Math.pow(1 + sq, 2));
}

/** Classical linearized supersonic thin-wing normal-force-slope coefficients (beta = Prandtl-Glauert-style compressibility factor sqrt(M²-1)) -- OpenRocket's own K1/K2/K3, precomputed there as a lookup table interpolated at 0.1 Mach increments; evaluated directly here instead (these are smooth closed forms, no numerical reason to approximate them with a table -- a strict accuracy improvement over OpenRocket's own table-interpolation error, not a behavior change in spirit). */
function k1(mach: number): number {
  return 2 / Math.sqrt(mach * mach - 1);
}
function k2(mach: number): number {
  const beta = Math.sqrt(mach * mach - 1);
  return ((GAMMA + 1) * Math.pow(mach, 4) - 4 * beta * beta) / (4 * Math.pow(beta, 4));
}
function k3(mach: number): number {
  const beta = Math.sqrt(mach * mach - 1);
  return (
    ((GAMMA + 1) * Math.pow(mach, 8) +
      (2 * GAMMA * GAMMA - 7 * GAMMA - 5) * Math.pow(mach, 6) +
      10 * (GAMMA + 1) * Math.pow(mach, 4) +
      8) /
    (6 * Math.pow(beta, 7))
  );
}

/**
 * A general small linear-system solver (Gaussian elimination with partial pivoting) -- used once,
 * at module load, to build the fixed interpolation matrix below, mirroring OpenRocket's own
 * PolyInterpolator (util/PolyInterpolator.java), which does the identical real-time matrix-inversion
 * approach in Java. Not needed per-call: the constraint x-positions (0.9, 1.5) never change, only
 * the constraint VALUES do, so the expensive part (building + inverting the matrix) happens once.
 */
function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const pv = m[col]![col]!;
    for (let c = col; c <= n; c++) m[col]![c] = m[col]![c]! / pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]!;
      for (let c = col; c <= n; c++) m[r]![c] = m[r]![c]! - factor * m[col]![c]!;
    }
  }
  return m.map((row) => row[n]!);
}

/**
 * The exact inverse of OpenRocket's own cnaInterpolator constraint matrix (FinSetCalc.java) --
 * degree-4 polynomial in Mach satisfying 5 constraints: value at M=0.9 and M=1.5, first derivative
 * at M=0.9 and M=1.5, AND second derivative at M=0.9 fixed at zero (that 5th constraint, not just a
 * plain 4-constraint cubic Hermite, is why this needs a real matrix solve rather than a textbook
 * Hermite-basis formula). Each row of this inverse gives one polynomial coefficient (constant term
 * first) as a fixed linear combination of the 5 constraint values, computed once here since the
 * constraint x-positions (0.9, 1.5) are fixed constants, not per-call inputs.
 */
const CNA1_TRANSONIC_INVERSE: number[][] = (() => {
  const x0 = CNA_SUBSONIC;
  const x1 = CNA_SUPERSONIC;
  // Row order matches the value vector [subV, superV, subD, superD, 0] used at call time.
  const matrix = [
    [1, x0, x0 * x0, x0 ** 3, x0 ** 4], // p(x0)
    [1, x1, x1 * x1, x1 ** 3, x1 ** 4], // p(x1)
    [0, 1, 2 * x0, 3 * x0 * x0, 4 * x0 ** 3], // p'(x0)
    [0, 1, 2 * x1, 3 * x1 * x1, 4 * x1 ** 3], // p'(x1)
    [0, 0, 2, 6 * x0, 12 * x0 * x0], // p''(x0)
  ];
  const identity = [1, 0, 0, 0, 0].map((_, i) => matrix.map((_row, j) => (i === j ? 1 : 0)));
  return matrix.map((_, rowIdx) => solveLinearSystem(matrix, identity[rowIdx]!));
})();

function interpolateCna1Transonic(mach: number, subV: number, superV: number, subD: number, superD: number): number {
  const values = [subV, superV, subD, superD, 0];
  let result = 0;
  let machPower = 1;
  for (let coeffIdx = 0; coeffIdx < 5; coeffIdx++) {
    let coeff = 0;
    for (let i = 0; i < 5; i++) coeff += CNA1_TRANSONIC_INVERSE[i]![coeffIdx]! * values[i]!;
    result += coeff * machPower;
    machPower *= mach;
  }
  return result;
}

/**
 * Fin center-of-pressure position as a fraction along the MAC (0.25 = quarter chord). Quarter-chord
 * below Mach 0.5; an aspect-ratio-based empirical formula above Mach 2 (f(M) = (ar*beta-0.67) /
 * (2*ar*beta-1), beta = sqrt(M²-1)); a fifth-order polynomial in between, matched in value AND
 * slope at both ends, with the SECOND and THIRD derivatives also matched to zero at M=2 -- an exact
 * transcription of OpenRocket's own FinSetCalc.calculatePoly(), whose six coefficients (as
 * functions of aspect ratio) were derived analytically in Mathematica and hardcoded rather than
 * solved at runtime; ported as literal numeric constants here for the same reason.
 */
export function finCpShiftFraction(mach: number, aspectRatio: number): number {
  if (mach <= 0.5) return 0.25;
  if (mach >= 2) {
    const beta = Math.sqrt(mach * mach - 1);
    return (aspectRatio * beta - 0.67) / (2 * aspectRatio * beta - 1);
  }
  const ar = aspectRatio;
  const denom = Math.pow(1 - 3.4641 * ar, 2);
  const poly = [
    (9.16049 * (-0.588838 + ar) * (-0.20624 + ar)) / denom,
    (-31.6049 * (-0.705375 + ar) * (-0.198476 + ar)) / denom,
    (55.3086 * (-0.711482 + ar) * (-0.196772 + ar)) / denom,
    (-39.5062 * (-0.72074 + ar) * (-0.194245 + ar)) / denom,
    (12.8395 * (-0.725688 + ar) * (-0.19292 + ar)) / denom,
    (-1.58025 * (-0.728769 + ar) * (-0.192105 + ar)) / denom,
  ];
  let result = 0;
  let x = 1;
  for (const c of poly) {
    result += c * x;
    x *= mach;
  }
  return result;
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

/**
 * Mach-only geometry needed for a fin set's pressure/base drag — deliberately
 * separate from the per-timestep CNa/CP calculators above (trapezoidFinAero /
 * freeformFinAero) since drag-calc.ts's DragGeometry is built ONCE per
 * rocket and reused every RK4 substep (see that file's own doc comment);
 * none of span/thickness/cosGammaLead/crossSection/finCount depend on Mach
 * or AOA, so there's no reason to recompute them per-step.
 */
export interface FinDragGeometry {
  span: number; // m
  thickness: number; // m
  cosGammaLead: number; // leading-edge sweep cosine (1 = unswept)
  crossSection: FinCrossSection;
  finCount: number;
}

export function trapezoidFinDragGeometry(fin: TrapezoidalFinSet): FinDragGeometry | null {
  const { rootChord, tipChord, sweepLength, span, thickness, finCount } = fin;
  const finArea = (span * (rootChord + tipChord)) / 2;
  if (finArea < 1e-9 || span < 1e-9 || finCount < 1) return null;
  const cosGammaLead = span / Math.hypot(span, sweepLength);
  return { span, thickness, cosGammaLead, crossSection: fin.crossSection ?? "square", finCount };
}

/**
 * Same leading-edge-tracing approach as freeformFinAero's own mid-chord
 * cosGamma accumulator, but following xLE(y) instead of the chord midpoint —
 * cosGammaLead is specifically a leading-edge sweep, per OpenRocket's own
 * FinSetCalc (calculatePressureCD uses cosGammaLead, not the mid-chord
 * cosGamma calculateFinCNa1 uses). Kept as its own small pass rather than
 * folded into freeformFinAero: this is Mach-independent geometry computed
 * once at rocket-build time (see FinDragGeometry's own doc comment), while
 * freeformFinAero re-runs every timestep.
 */
export function freeformFinDragGeometry(fin: FreeformFinSet, divisions = 400): FinDragGeometry | null {
  const span = fin.points.reduce((max, [, y]) => Math.max(max, y), 0);
  if (span < 1e-9 || fin.finCount < 1 || fin.points.length < 3) return null;

  const closed = [...fin.points, fin.points[0]!];
  const leadingEdgeAt = (y: number): number => {
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
    return xs.length === 0 ? 0 : Math.min(...xs);
  };

  let sumCosGamma = 0;
  let samples = 0;
  let prevX: number | null = null;
  let prevY: number | null = null;
  for (let i = 0; i <= divisions; i++) {
    const y = (i / divisions) * span;
    const x = leadingEdgeAt(y);
    if (prevX !== null && prevY !== null) {
      const hyp = Math.hypot(x - prevX, y - prevY);
      if (hyp > 1e-9) {
        sumCosGamma += (y - prevY) / hyp;
        samples++;
      }
    }
    prevX = x;
    prevY = y;
  }

  if (samples === 0) return null;
  const cosGammaLead = sumCosGamma / samples;
  return { span, thickness: fin.thickness, cosGammaLead, crossSection: fin.crossSection ?? "square", finCount: fin.finCount };
}

/**
 * Rayleigh-Pitot/isentropic stagnation-pressure-coefficient approximation —
 * OpenRocket's own BarrowmanDragCalculator.calculateStagnationCD, used both
 * for a blunt (SQUARE cross-section) fin's leading-edge drag below and,
 * separately, nose/shoulder stagnation drag elsewhere in OR (not needed
 * here — this project's body pressure drag already has its own from-source
 * nose formula, see drag-calc.ts).
 */
function calculateStagnationCd(mach: number): number {
  const base =
    mach <= 1
      ? 1 + (mach * mach) / 4 + Math.pow(mach, 4) / 40
      : 1.84 - 0.76 / (mach * mach) + 0.166 / Math.pow(mach, 4) + 0.035 / Math.pow(mach, 6);
  return 0.85 * base;
}

/**
 * Fin leading-edge pressure drag, exact transcription of OpenRocket's
 * FinSetCalc.calculatePressureCD: a Mach-dependent round-leading-edge
 * correlation for AIRFOIL/ROUNDED cross-sections, or the blunt stagnation-CD
 * formula for SQUARE, scaled by cosGammaLead² (a slanted leading edge sees
 * less effective dynamic pressure) and span*thickness/refArea (each fin's
 * own leading-edge frontal-area fraction of the reference area). Summed
 * across finCount fins here (OR's own caller, BarrowmanDragCalculator,
 * multiplies a single fin's CD by its instance count — see this project's
 * combineFinSetCna for the same finCount-aggregation pattern on the CNa
 * side) since this project's DragResult is already a single whole-rocket
 * total, unlike OR's per-component force map.
 */
export function finPressureDragCd(geometry: FinDragGeometry, mach: number, refArea: number): number {
  if (refArea < 1e-12) return 0;
  let cd: number;
  if (geometry.crossSection === "square") {
    cd = calculateStagnationCd(mach);
  } else if (mach < 0.9) {
    cd = Math.pow(1 - mach * mach, -0.417) - 1;
  } else if (mach < 1) {
    cd = 1 - 1.785 * (mach - 0.9);
  } else {
    cd = 1.214 - 0.502 / (mach * mach) + 0.1095 / Math.pow(mach, 4);
  }
  cd *= geometry.cosGammaLead * geometry.cosGammaLead;
  cd *= (geometry.span * geometry.thickness) / refArea;
  return cd * geometry.finCount;
}

/**
 * Fin trailing-edge (base) drag, exact transcription of OpenRocket's
 * FinSetCalc.calculateComponentBaseCD: SQUARE gets the full Mach-dependent
 * base-drag coefficient (same `baseCd` the body's own blunt-base drag uses —
 * see drag-calc.ts's baseDragCoefficient, passed in here rather than
 * recomputed, since the caller already has it for the body term), ROUNDED
 * gets half of it (a rounded trailing edge partially recovers pressure),
 * AIRFOIL is assumed to have zero base drag (tapers to a thin trailing
 * edge, no separated base region). Same span*thickness/refArea scaling and
 * finCount summation as finPressureDragCd above.
 */
export function finBaseDragCd(geometry: FinDragGeometry, baseCd: number, refArea: number): number {
  if (refArea < 1e-12) return 0;
  let cd: number;
  if (geometry.crossSection === "square") {
    cd = baseCd;
  } else if (geometry.crossSection === "rounded") {
    cd = baseCd / 2;
  } else {
    return 0; // airfoil: assumed zero base drag
  }
  cd *= (geometry.span * geometry.thickness) / refArea;
  return cd * geometry.finCount;
}
