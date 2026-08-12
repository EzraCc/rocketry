import { describe, expect, it } from "vitest";
import { checkStability } from "./stability-check.js";

const REF_DIAMETER = 0.025; // 25mm, arbitrary but fixed for these tests

describe("checkStability — no motor loaded", () => {
  it("ignores everything (flyable, no warnings) regardless of margin, when there's no motor", () => {
    // CG behind CP (would normally be "not flyable") but no motor -> ignored.
    const result = checkStability(0.3, 0.5, REF_DIAMETER, false);
    expect(result.flyable).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.margin).toBeCloseTo((0.3 - 0.5) / REF_DIAMETER, 9); // margin is still reported, just not flagged
  });
});

describe("checkStability — CG behind CP (unstable)", () => {
  it("flags not flyable when CG is aft of CP", () => {
    const cpX = 0.3;
    const cgX = 0.35; // CG aft of CP -> negative margin
    const result = checkStability(cpX, cgX, REF_DIAMETER, true);
    expect(result.margin).toBeLessThan(0);
    expect(result.flyable).toBe(false);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toMatch(/NOT FLYABLE/);
  });

  it("does not also emit a low-margin warning alongside not-flyable (mutually exclusive)", () => {
    const result = checkStability(0.3, 0.35, REF_DIAMETER, true);
    expect(result.warnings.length).toBe(1);
  });
});

describe("checkStability — low margin (0 to 1 caliber)", () => {
  it("warns for a small positive margin under 1 caliber", () => {
    const cpX = 0.3;
    const cgX = 0.3 - REF_DIAMETER * 0.5; // 0.5 caliber margin
    const result = checkStability(cpX, cgX, REF_DIAMETER, true);
    expect(result.margin).toBeCloseTo(0.5, 6);
    expect(result.flyable).toBe(true);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toMatch(/Low static margin/);
    expect(result.warnings[0]).toMatch(/base drag/); // the caveat the user specifically asked for
  });

  it("warns at exactly the boundary just under 1 caliber", () => {
    const cpX = 0.3;
    const cgX = 0.3 - REF_DIAMETER * 0.99;
    const result = checkStability(cpX, cgX, REF_DIAMETER, true);
    expect(result.warnings.length).toBe(1);
  });
});

describe("checkStability — normal range (1 to 3 calibers)", () => {
  it("no warnings for a margin comfortably in the typical recommended range", () => {
    const cpX = 0.3;
    const cgX = 0.3 - REF_DIAMETER * 2; // 2 caliber margin
    const result = checkStability(cpX, cgX, REF_DIAMETER, true);
    expect(result.margin).toBeCloseTo(2, 6);
    expect(result.flyable).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("no warning exactly at the low-margin boundary (1 caliber)", () => {
    const cpX = 0.3;
    const cgX = 0.3 - REF_DIAMETER * 1;
    const result = checkStability(cpX, cgX, REF_DIAMETER, true);
    expect(result.warnings).toEqual([]);
  });

  it("no warning just under the overstable boundary (~3 calibers)", () => {
    const cpX = 0.3;
    const cgX = 0.3 - REF_DIAMETER * 2.99;
    const result = checkStability(cpX, cgX, REF_DIAMETER, true);
    expect(result.warnings).toEqual([]);
  });
});

describe("checkStability — overstable (above 3 calibers)", () => {
  it("warns for a large margin", () => {
    const cpX = 0.3;
    const cgX = 0.3 - REF_DIAMETER * 4; // 4 caliber margin
    const result = checkStability(cpX, cgX, REF_DIAMETER, true);
    expect(result.margin).toBeCloseTo(4, 6);
    expect(result.flyable).toBe(true);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toMatch(/Overstable/);
  });
});
