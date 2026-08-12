import { describe, expect, it } from "vitest";
import {
  bodyFinInterferenceFactor,
  bodyInFinPresenceFactor,
  finInBodyPresenceFactor,
  trapezoidFinAero,
} from "./fin-calc.js";
import type { TrapezoidalFinSet } from "../../model/component.js";

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
