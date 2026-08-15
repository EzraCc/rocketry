import { describe, expect, it } from "vitest";
import {
  bodyFinInterferenceFactor,
  bodyInFinPresenceFactor,
  finInBodyPresenceFactor,
  finBaseDragCd,
  finCNa1,
  finCpShiftFraction,
  finPressureDragCd,
  freeformFinDragGeometry,
  trapezoidFinAero,
  trapezoidFinDragGeometry,
  type FinDragGeometry,
} from "./fin-calc.js";
import type { FreeformFinSet, TrapezoidalFinSet } from "../../model/component.js";

const relError = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

// NACA Report 1307 (Pitts, Nielsen & Kaattari, 1953), equations (14) and
// (21), transcribed from pdas.com/refs/rep1307.pdf p.570/572. These are the
// report's own stated closed-form limits, not values we invented — real
// exactness checks, not just "does it run."
describe("finInBodyPresenceFactor / bodyInFinPresenceFactor (NACA 1307 eq. 14/21 limits)", () => {
  it("tau->0: all-fin, no body -> K_W(B)=1, K_B(W)=0", () => {
    expect(finInBodyPresenceFactor(0)).toBeCloseTo(1, 6);
    expect(bodyInFinPresenceFactor(0)).toBeCloseTo(0, 6);
  });

  it("tau->1: vanishing exposed fin -> K_W(B)=K_B(W)=2 (body acts as a reflection plane)", () => {
    expect(finInBodyPresenceFactor(1)).toBeCloseTo(2, 6);
    expect(bodyInFinPresenceFactor(1)).toBeCloseTo(2, 6);
  });

  it("satisfies the closed identity K_W(B) + K_B(W) = (1+tau)^2 at an interior point", () => {
    const tau = 0.25;
    expect(finInBodyPresenceFactor(tau) + bodyInFinPresenceFactor(tau)).toBeCloseTo((1 + tau) ** 2, 9);
  });

  it("at tau=0.25, is substantially below the old (1+tau)^2 approximation (~1.206 vs ~1.563)", () => {
    // Documents the real, material change from switching to the exact formula —
    // not a rounding difference. See fin-calc.ts doc comment.
    expect(finInBodyPresenceFactor(0.25)).toBeCloseTo(1.2065, 3);
  });
});

describe("bodyFinInterferenceFactor (subsonic now uses the exact NACA 1307 K_W(B))", () => {
  const TAU = 0.25;
  const EPS = 1e-9;

  it("uses the exact K_W(B) at subsonic speeds (supersedes the old (1+tau)^2 approximation)", () => {
    expect(bodyFinInterferenceFactor(TAU, 0.5)).toBeCloseTo(finInBodyPresenceFactor(TAU), 9);
    expect(bodyFinInterferenceFactor(TAU, 0.9)).toBeCloseTo(finInBodyPresenceFactor(TAU), 9);
  });

  it("blends body contribution through transonic speeds", () => {
    expect(bodyFinInterferenceFactor(TAU, 1.2)).toBeCloseTo(1.40625, 9);
  });

  it("retains classical fin-in-body correction at supersonic speeds", () => {
    expect(bodyFinInterferenceFactor(TAU, 1.5)).toBeCloseTo(1.25, EPS);
    expect(bodyFinInterferenceFactor(TAU, 3.0)).toBeCloseTo(1.25, EPS);
  });
});

// Estes Alpha III fin geometry from OpenRocket's FinSetCalcTest.java.
// OpenRocket's own expected values (computed by looping per-fin over roll
// angle and summing): 3 fins -> CNa=24.146933, 4 fins -> CNa=32.195911.
// Ratio 32.195911/24.146933 = 1.333333... = 4/3 exactly, which is what a
// closed-form (finCount/2) aggregate predicts for N>=2 evenly-spaced fins
// (both cases have finCount<=4 so the multi-fin interference factor is 1.0
// in both, isolating the finCount/2 relationship). This is the property we
// can verify without needing the rocket's exact bodyRadius/refArea/mach.
describe("trapezoidFinAero — finCount aggregation matches OpenRocket's per-fin sum", () => {
  const baseFin: Omit<TrapezoidalFinSet, "finCount"> = {
    type: "finset",
    id: "f1",
    name: "fins",
    rootChord: 0.05,
    tipChord: 0.03,
    sweepLength: 0.02,
    span: 0.05,
    thickness: 0.003,
    cantAngle: 0,
    axialOffsetFromParentBottom: 0,
  };

  it("4-fin / 3-fin CNa ratio is exactly 4/3, independent of bodyRadius/mach", () => {
    for (const bodyRadius of [0.01, 0.02, 0.05]) {
      for (const mach of [0, 0.3, 0.8]) {
        const refArea = Math.PI * 0.02 * 0.02;
        const fin3 = trapezoidFinAero({ ...baseFin, finCount: 3 }, bodyRadius, mach, refArea);
        const fin4 = trapezoidFinAero({ ...baseFin, finCount: 4 }, bodyRadius, mach, refArea);
        expect(fin4.cna / fin3.cna).toBeCloseTo(4 / 3, 9);
      }
    }
  });

  it("CNa is positive and CP lies within the root-chord-ish region for a simple trapezoid", () => {
    const result = trapezoidFinAero({ ...baseFin, finCount: 3 }, 0.02, 0.3, Math.PI * 0.02 * 0.02);
    expect(result.cna).toBeGreaterThan(0);
    expect(result.cpX).toBeGreaterThan(0);
    expect(result.cpX).toBeLessThan(baseFin.rootChord + baseFin.sweepLength + baseFin.tipChord);
  });
});

// Real fin geometry (same as baseFin above): span=0.05, rootChord=0.05, tipChord=0.03,
// midChordDx=0.01, cosGamma=span/hypot(span,midChordDx).
const SPAN = 0.05;
const FIN_AREA = (0.05 * (0.05 + 0.03)) / 2; // 0.002
const COS_GAMMA = SPAN / Math.hypot(SPAN, 0.01);
const REF_AREA = Math.PI * 0.02 * 0.02;

// The transonic (0.9<M<1.5) and CP-shift (0.5<M<2) blends are the highest-risk part of this port
// (a real 5-constraint matrix solve, not a textbook 4-constraint Hermite cubic) -- verified here by
// checking the blend actually satisfies its own constraints (continuity AND derivative-matching at
// both ends), not just "does it run and return a plausible-looking number."
describe("finCNa1 — supersonic/transonic port (OpenRocket FinSetCalc.calculateFinCNa1)", () => {
  it("is continuous in VALUE across the subsonic/transonic boundary (M=0.9)", () => {
    const justBelow = finCNa1(SPAN, FIN_AREA, COS_GAMMA, 0.9 - 1e-6, REF_AREA);
    const justAbove = finCNa1(SPAN, FIN_AREA, COS_GAMMA, 0.9 + 1e-6, REF_AREA);
    expect(justAbove).toBeCloseTo(justBelow, 4);
  });

  it("is continuous in SLOPE across the subsonic/transonic boundary (M=0.9)", () => {
    const h = 1e-5;
    const slopeBelow = (finCNa1(SPAN, FIN_AREA, COS_GAMMA, 0.9, REF_AREA) - finCNa1(SPAN, FIN_AREA, COS_GAMMA, 0.9 - h, REF_AREA)) / h;
    const slopeAbove = (finCNa1(SPAN, FIN_AREA, COS_GAMMA, 0.9 + h, REF_AREA) - finCNa1(SPAN, FIN_AREA, COS_GAMMA, 0.9, REF_AREA)) / h;
    expect(slopeAbove).toBeCloseTo(slopeBelow, 1);
  });

  it("is continuous in VALUE across the transonic/supersonic boundary (M=1.5), at alpha=0", () => {
    const justBelow = finCNa1(SPAN, FIN_AREA, COS_GAMMA, 1.5 - 1e-6, REF_AREA, 0);
    const justAbove = finCNa1(SPAN, FIN_AREA, COS_GAMMA, 1.5 + 1e-6, REF_AREA, 0);
    expect(justAbove).toBeCloseTo(justBelow, 4);
  });

  it("is continuous in SLOPE across the transonic/supersonic boundary (M=1.5), at alpha=0", () => {
    const h = 1e-5;
    const slopeBelow = (finCNa1(SPAN, FIN_AREA, COS_GAMMA, 1.5, REF_AREA) - finCNa1(SPAN, FIN_AREA, COS_GAMMA, 1.5 - h, REF_AREA)) / h;
    const slopeAbove = (finCNa1(SPAN, FIN_AREA, COS_GAMMA, 1.5 + h, REF_AREA) - finCNa1(SPAN, FIN_AREA, COS_GAMMA, 1.5, REF_AREA)) / h;
    expect(slopeAbove).toBeCloseTo(slopeBelow, 1);
  });

  // NOT tested here: the interpolator's own p''(0.9)=0 constraint. Verified independently (a
  // from-scratch Python re-implementation, isolated from this project's own code) that the 5x5
  // matrix solve genuinely satisfies all 5 of its constraints, INCLUDING that one, for a fixed set
  // of constraint values. But OpenRocket's own subD (the transonic derivative anchor at M=0.9) is
  // deliberately evaluated at the CURRENT query mach, not fixed at 0.9 (see
  // cna1TransonicDerivative's own doc comment) -- so the "polynomial" this function evaluates
  // literally changes shape at every mach, and a finite-difference second derivative across that
  // moving target has no reason to land near zero. That's not a bug to test for here; it's the
  // documented, deliberately-preserved quirk of the real formula being ported.

  it("matches the K1-only supersonic formula exactly at alpha=0", () => {
    const mach = 2.5;
    const beta = Math.sqrt(mach * mach - 1);
    const k1 = 2 / beta;
    const expected = (FIN_AREA * k1) / REF_AREA;
    expect(finCNa1(SPAN, FIN_AREA, COS_GAMMA, mach, REF_AREA, 0)).toBeCloseTo(expected, 9);
  });

  it("alpha clamps to the stall angle (20deg) supersonically, matching OpenRocket's own clamp", () => {
    const mach = 2.5;
    const atStall = finCNa1(SPAN, FIN_AREA, COS_GAMMA, mach, REF_AREA, (20 * Math.PI) / 180);
    const pastStall = finCNa1(SPAN, FIN_AREA, COS_GAMMA, mach, REF_AREA, (45 * Math.PI) / 180);
    expect(pastStall).toBeCloseTo(atStall, 9);
  });
});

describe("finCpShiftFraction — supersonic/transonic CP shift port (OpenRocket FinSetCalc.calculateCPPos/calculatePoly)", () => {
  const AR = 4; // representative aspect ratio

  it("is exactly quarter-chord (0.25) at and below Mach 0.5", () => {
    expect(finCpShiftFraction(0.3, AR)).toBeCloseTo(0.25, 9);
    expect(finCpShiftFraction(0.5, AR)).toBeCloseTo(0.25, 9);
  });

  it("matches the empirical formula exactly at and above Mach 2", () => {
    const beta = Math.sqrt(2 * 2 - 1);
    const expected = (AR * beta - 0.67) / (2 * AR * beta - 1);
    expect(finCpShiftFraction(2, AR)).toBeCloseTo(expected, 9);
    expect(finCpShiftFraction(3, AR)).toBeCloseTo((AR * Math.sqrt(8) - 0.67) / (2 * AR * Math.sqrt(8) - 1), 9);
  });

  // Both boundary tests below deliberately avoid evaluating finCpShiftFraction AT the exact
  // boundary Mach for a finite-difference estimate: the hardcoded 0.25 (below 0.5) and the
  // empirical formula (at/above 2) agree with the polynomial's own p(0.5)/p(2) only to the
  // polynomial's own coefficient precision (6 significant figures, "calculated analytically in
  // Mathematica" per OpenRocket's own comment) -- a real but tiny (~1e-5) residual gap that a
  // same-order-of-magnitude finite-difference h would amplify into a large spurious slope reading.
  // Using two points on the SAME side of the boundary sidesteps that entirely.
  it("has ~zero slope approaching M=0.5 from above (matches p'(0.5)=0)", () => {
    const h = 1e-4;
    const slopeJustAbove = (finCpShiftFraction(0.5 + 2 * h, AR) - finCpShiftFraction(0.5 + h, AR)) / h;
    expect(slopeJustAbove).toBeCloseTo(0, 3);
  });

  it("polynomial slope approaching M=2 from below matches the empirical formula's own slope there", () => {
    const h = 1e-4;
    const slopeJustBelow = (finCpShiftFraction(2 - h, AR) - finCpShiftFraction(2 - 2 * h, AR)) / h;
    const f = (m: number) => {
      const beta = Math.sqrt(m * m - 1);
      return (AR * beta - 0.67) / (2 * AR * beta - 1);
    };
    const empiricalSlopeAt2 = (f(2 + h) - f(2 - h)) / (2 * h);
    expect(slopeJustBelow).toBeCloseTo(empiricalSlopeAt2, 2);
  });
});

describe("trapezoidFinDragGeometry / freeformFinDragGeometry — Mach-independent fin drag geometry", () => {
  const baseFin: TrapezoidalFinSet = {
    type: "finset",
    id: "f1",
    name: "fins",
    finCount: 3,
    rootChord: 0.05,
    tipChord: 0.03,
    sweepLength: 0,
    span: 0.05,
    thickness: 0.003,
    cantAngle: 0,
    axialOffsetFromParentBottom: 0,
  };

  it("cosGammaLead is 1 for an unswept leading edge", () => {
    const geom = trapezoidFinDragGeometry(baseFin);
    expect(geom?.cosGammaLead).toBeCloseTo(1, 9);
  });

  it("cosGammaLead is < 1 for a swept leading edge, matching span/hypot(span, sweepLength)", () => {
    const swept = { ...baseFin, sweepLength: 0.02 };
    const geom = trapezoidFinDragGeometry(swept);
    expect(geom?.cosGammaLead).toBeCloseTo(swept.span / Math.hypot(swept.span, swept.sweepLength), 9);
  });

  it("defaults crossSection to square when unspecified", () => {
    expect(trapezoidFinDragGeometry(baseFin)?.crossSection).toBe("square");
  });

  it("passes through an explicit crossSection", () => {
    expect(trapezoidFinDragGeometry({ ...baseFin, crossSection: "airfoil" })?.crossSection).toBe("airfoil");
  });

  it("returns null for a degenerate (zero-area) fin", () => {
    expect(trapezoidFinDragGeometry({ ...baseFin, rootChord: 0, tipChord: 0 })).toBeNull();
  });

  // A rectangular (unswept) freeform outline should report the same span and an
  // (approximately) unswept cosGammaLead as its trapezoidal equivalent.
  const rectFin: FreeformFinSet = {
    type: "freeformfinset",
    id: "f2",
    name: "fins",
    finCount: 3,
    points: [
      [0, 0],
      [0.05, 0],
      [0.05, 0.05],
      [0, 0.05],
    ],
    thickness: 0.003,
    cantAngle: 0,
    axialOffsetFromParentBottom: 0,
  };

  it("freeform: cosGammaLead is ~1 for a rectangular (unswept) outline", () => {
    const geom = freeformFinDragGeometry(rectFin);
    expect(geom?.span).toBeCloseTo(0.05, 6);
    expect(geom?.cosGammaLead).toBeCloseTo(1, 3);
  });

  it("freeform: cosGammaLead is < 1 for a swept leading edge", () => {
    const swept: FreeformFinSet = {
      ...rectFin,
      points: [
        [0, 0],
        [0.05, 0],
        [0.07, 0.05],
        [0.02, 0.05],
      ],
    };
    const geom = freeformFinDragGeometry(swept);
    expect(geom?.cosGammaLead).toBeLessThan(1);
    expect(geom?.cosGammaLead).toBeCloseTo(0.05 / Math.hypot(0.05, 0.02), 2);
  });
});

// Exact transcription checks against OpenRocket's FinSetCalc.calculatePressureCD /
// calculateComponentBaseCD -- verifies the branch structure (cross-section selection,
// finCount/area scaling) rather than re-deriving the underlying correlations.
describe("finPressureDragCd / finBaseDragCd (OpenRocket FinSetCalc port)", () => {
  const REF_AREA = Math.PI * 0.02 * 0.02;
  const geom = (crossSection: FinDragGeometry["crossSection"], finCount = 1): FinDragGeometry => ({
    span: 0.05,
    thickness: 0.003,
    cosGammaLead: 1,
    crossSection,
    finCount,
  });

  it("square cross-section uses the stagnation-CD formula (0.85x scale at M=0)", () => {
    const cd = finPressureDragCd(geom("square"), 0, REF_AREA);
    const expectedSingleFinCd = 0.85 * 1 * (0.05 * 0.003) / REF_AREA; // stagnationCd(0)=1
    expect(cd).toBeCloseTo(expectedSingleFinCd, 9);
  });

  it("airfoil/rounded is exactly continuous across M=1 (both branches share the same anchor value there)", () => {
    const belowAt1 = finPressureDragCd(geom("rounded"), 1 - 1e-6, REF_AREA);
    const aboveAt1 = finPressureDragCd(geom("rounded"), 1 + 1e-6, REF_AREA);
    expect(aboveAt1).toBeCloseTo(belowAt1, 4);
  });

  // M=0.9 is NOT exactly continuous here -- transcribed directly from OpenRocket's own
  // calculatePressureCD, whose "mach < 0.9" branch ((1-M^2)^-0.417 - 1) and "mach < 1" branch
  // (1 - 1.785*(M-0.9)) are two independently-fitted empirical correlations that happen to nearly,
  // but not exactly, agree at their shared boundary (~0.13% of the underlying cd, before scaling) --
  // a real property of the source formula, not a porting bug (verified: cd(0.9^-)~=0.9987 vs the
  // second branch's own cd(0.9)=1.0 exactly). Bounded loosely rather than tightly to document this
  // rather than mask it.
  it("airfoil/rounded is approximately continuous across M=0.9 (small real gap in OpenRocket's own fit)", () => {
    const belowAt09 = finPressureDragCd(geom("airfoil"), 0.9 - 1e-6, REF_AREA);
    const aboveAt09 = finPressureDragCd(geom("airfoil"), 0.9 + 1e-6, REF_AREA);
    expect(relError(aboveAt09, belowAt09)).toBeLessThan(0.005);
  });

  it("scales linearly with finCount", () => {
    const one = finPressureDragCd(geom("airfoil", 1), 0.5, REF_AREA);
    const four = finPressureDragCd(geom("airfoil", 4), 0.5, REF_AREA);
    expect(four).toBeCloseTo(one * 4, 9);
  });

  it("cosGammaLead reduces pressure drag quadratically (a slanted leading edge)", () => {
    const unswept = finPressureDragCd(geom("airfoil"), 0.5, REF_AREA);
    const swept = finPressureDragCd({ ...geom("airfoil"), cosGammaLead: 0.8 }, 0.5, REF_AREA);
    expect(swept).toBeCloseTo(unswept * 0.8 * 0.8, 9);
  });

  it("base drag: SQUARE gets the full baseCd, ROUNDED half, AIRFOIL zero", () => {
    const baseCd = 0.2;
    const squareCd = finBaseDragCd(geom("square"), baseCd, REF_AREA);
    const roundedCd = finBaseDragCd(geom("rounded"), baseCd, REF_AREA);
    const airfoilCd = finBaseDragCd(geom("airfoil"), baseCd, REF_AREA);
    expect(roundedCd).toBeCloseTo(squareCd / 2, 9);
    expect(airfoilCd).toBe(0);
    expect(squareCd).toBeCloseTo((baseCd * (0.05 * 0.003)) / REF_AREA, 9);
  });

  it("base drag scales linearly with finCount", () => {
    const one = finBaseDragCd(geom("square", 1), 0.2, REF_AREA);
    const three = finBaseDragCd(geom("square", 3), 0.2, REF_AREA);
    expect(three).toBeCloseTo(one * 3, 9);
  });
});
