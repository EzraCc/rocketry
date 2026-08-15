import { describe, expect, it } from "vitest";
import { previewNoseWeight, solveNoseWeight } from "./nose-weight.js";

describe("solveNoseWeight", () => {
  it("solves for the mass needed to hit a target margin, and it actually achieves it (round-trip via previewNoseWeight)", () => {
    // CP=1.0m, refDiameter=0.1m, dry 0.5kg@0.6m, a heavy, far-aft motor (1.5kg@1.3m) pulls loaded
    // CG well aft of CP, below the target margin of 1.0cal (loadedCg=1.125m -> margin=-1.25cal).
    const cpX = 1.0, refDiameter = 0.1, dryMass = 0.5, dryCg = 0.6, motorMass = 1.5, motorCg = 1.3;
    const target = 1.0;
    const sol = solveNoseWeight(cpX, refDiameter, dryMass, dryCg, motorMass, motorCg, target, 0.05);

    expect(sol.currentMarginCal).toBeLessThan(target);
    expect(sol.feasible).toBe(true);
    expect(sol.addedMassKg).toBeGreaterThan(0);
    expect(sol.newMarginCal).toBeCloseTo(target, 9);

    // Round-trip: previewing exactly the solved added mass should reproduce the same target margin.
    const preview = previewNoseWeight(cpX, refDiameter, dryMass, dryCg, motorMass, motorCg, sol.addedMassKg, 0.05);
    expect(preview.newMarginCal).toBeCloseTo(target, 6);
    expect(preview.newDryMassKg).toBeCloseTo(sol.newDryMassKg, 9);
    expect(preview.newDryCgM).toBeCloseTo(sol.newDryCgM, 9);
  });

  it("adds nothing when the target margin is already met", () => {
    const sol = solveNoseWeight(1.0, 0.1, 0.5, 0.6, 0.3, 0.9, 1.0, 0.05); // margin already 2.875cal
    expect(sol.addedMassKg).toBe(0);
    expect(sol.newDryMassKg).toBe(0.5);
    expect(sol.newDryCgM).toBe(0.6);
    expect(sol.newMarginCal).toBeCloseTo(sol.currentMarginCal, 9);
  });

  it("is infeasible when the nose position isn't forward enough of the target CG", () => {
    // Target CG = cpX - target*refDiameter = 1.0 - 1.0*0.1 = 0.9m. A "nose" position at 0.95m
    // (AFT of that) can never pull the CG forward of 0.9m no matter how much mass sits there.
    const sol = solveNoseWeight(1.0, 0.1, 0.5, 0.95, 1.5, 0.95, 1.0, 0.95);
    expect(sol.feasible).toBe(false);
    expect(sol.addedMassKg).toBe(Infinity);
  });

  // Mirrors the real-world case that prompted this feature: a rocket + motor combination with a
  // genuinely NEGATIVE static margin (CG aft of CP -- unflyable as-is), solved back to a safe
  // positive target.
  it("recovers a negative (unstable) starting margin to a safe positive target", () => {
    // CP=1.2m, refDiameter=0.15m (150mm-class airframe), dry 3.0kg@1.0m, a heavy motor
    // (2.5kg@1.5m) pulls loaded CG well aft of CP -> negative margin.
    const cpX = 1.2, refDiameter = 0.15, dryMass = 3.0, dryCg = 1.0, motorMass = 2.5, motorCg = 1.5;
    const loadedCg = (dryMass * dryCg + motorMass * motorCg) / (dryMass + motorMass);
    expect((cpX - loadedCg) / refDiameter).toBeLessThan(0); // confirm the setup is genuinely unstable

    const sol = solveNoseWeight(cpX, refDiameter, dryMass, dryCg, motorMass, motorCg, 1.0, 0.05);
    expect(sol.currentMarginCal).toBeLessThan(0);
    expect(sol.feasible).toBe(true);
    expect(sol.addedMassKg).toBeGreaterThan(0);
    expect(sol.newMarginCal).toBeCloseTo(1.0, 9);

    // The new dry CG should have moved forward relative to the original.
    expect(sol.newDryCgM).toBeLessThan(dryCg);
  });

  it("a more forward nose position needs less added mass for the same target margin", () => {
    const args = [1.2, 0.15, 3.0, 1.0, 2.5, 1.5, 1.0] as const;
    const closerToTip = solveNoseWeight(...args, 0.02);
    const fartherIn = solveNoseWeight(...args, 0.15);
    expect(closerToTip.addedMassKg).toBeLessThan(fartherIn.addedMassKg);
  });

  it("handles zero reference diameter without dividing by zero", () => {
    const sol = solveNoseWeight(1.0, 0, 0.5, 0.6, 0.3, 0.9, 1.0, 0.05);
    expect(sol.currentMarginCal).toBe(0);
    expect(Number.isFinite(sol.currentMarginCal)).toBe(true);
  });

  it("with no motor (motorMassKg=0), behaves as a purely dry-rocket balance", () => {
    const sol = solveNoseWeight(1.0, 0.1, 0.5, 0.95, 0, 0, 1.0, 0.05);
    // loadedMass=dryMass, loadedCg=dryCg -- margin = (1.0-0.95)/0.1 = 0.5cal, below target 1.0.
    expect(sol.currentMarginCal).toBeCloseTo(0.5, 9);
    expect(sol.addedMassKg).toBeGreaterThan(0);
    expect(sol.newMarginCal).toBeCloseTo(1.0, 9);
  });
});

describe("previewNoseWeight", () => {
  it("adding zero mass leaves dry mass/CG and margin unchanged", () => {
    const preview = previewNoseWeight(1.0, 0.1, 0.5, 0.6, 0.3, 0.9, 0, 0.05);
    expect(preview.newDryMassKg).toBe(0.5);
    expect(preview.newDryCgM).toBe(0.6);
    const loadedCg = (0.5 * 0.6 + 0.3 * 0.9) / 0.8;
    expect(preview.newMarginCal).toBeCloseTo((1.0 - loadedCg) / 0.1, 9);
  });

  it("more added mass at the same forward position monotonically improves margin", () => {
    const small = previewNoseWeight(1.2, 0.15, 3.0, 1.0, 2.5, 1.5, 0.05, 0.05);
    const large = previewNoseWeight(1.2, 0.15, 3.0, 1.0, 2.5, 1.5, 0.2, 0.05);
    expect(large.newMarginCal).toBeGreaterThan(small.newMarginCal);
  });
});
