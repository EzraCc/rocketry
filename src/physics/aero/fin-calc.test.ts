import { describe, expect, it } from "vitest";
import { bodyFinInterferenceFactor, trapezoidFinAero } from "./fin-calc.js";
import type { TrapezoidalFinSet } from "../../model/component.js";

// Ported directly from OpenRocket's FinBodyInterferenceTest.java (PR #3220,
// merged then reverted for an unrelated CI issue — the formula itself was
// not disputed). tau=0.25 fixed test cases.
describe("bodyFinInterferenceFactor (ported from FinBodyInterferenceTest.java)", () => {
  const TAU = 0.25;
  const EPS = 1e-9;

  it("includes body contribution at subsonic speeds", () => {
    expect(bodyFinInterferenceFactor(TAU, 0.5)).toBeCloseTo(1.5625, 9);
    expect(bodyFinInterferenceFactor(TAU, 0.9)).toBeCloseTo(1.5625, 9);
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
