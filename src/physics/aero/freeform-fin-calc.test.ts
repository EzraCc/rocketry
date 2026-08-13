import { describe, expect, it } from "vitest";
import { freeformFinAero } from "./freeform-fin-calc.js";
import type { FreeformFinSet } from "../../model/component.js";

// LOC PK-48 LOC-IV fin (RockSim <CustomFinSet>, sim-files/LOC/PK-48 LOC-IV.rkt),
// converted from mm to m. This is the exact fixture used to validate the
// whole-rocket comparison against RockSim's own stored BarromanXN (see
// scripts/validate-loc-iv.ts and the commit that added this calculator).
const MM = 0.001;
const locIVFin: FreeformFinSet = {
  type: "freeformfinset",
  id: "f1",
  name: "LOC-IV fins",
  finCount: 3,
  points: [
    [171.45 * MM, 0],
    [206.375 * MM, 31.75 * MM],
    [206.375 * MM, 107.95 * MM],
    [142.875 * MM, 107.95 * MM],
    [0, 0],
  ],
  thickness: 3 * MM,
  cantAngle: 0,
  axialOffsetFromParentBottom: 0,
};

describe("freeformFinAero — LOC-IV fixture", () => {
  const bodyRadius = (101.6 / 2) * MM;
  const refArea = Math.PI * bodyRadius * bodyRadius;
  const mach = 0.001; // near-zero "static" reference, matching RockSim's displayed CP

  it("produces positive CNa and a CP within the fin's chordwise extent", () => {
    const { cna, cpX } = freeformFinAero(locIVFin, bodyRadius, mach, refArea);
    expect(cna).toBeGreaterThan(0);
    expect(cpX).toBeGreaterThan(0);
    expect(cpX).toBeLessThan(0.21); // less than the ~206mm max chordwise extent
  });

  it("matches the values recorded from the validated one-off script run", () => {
    // Exact reproduction check: scripts/validate-loc-iv.ts reported
    // finSetCna=9.5720, finSetCpX(local)=1112.64-1017.27=95.37mm on the run
    // that this module was promoted from. Locks in a regression baseline.
    const { cna, cpX } = freeformFinAero(locIVFin, bodyRadius, mach, refArea);
    expect(cna).toBeCloseTo(9.572, 2);
    expect(cpX * 1000).toBeCloseTo(95.37, 0);
  });

  it("degrades gracefully for a degenerate (too-few-point) polygon", () => {
    const degenerate: FreeformFinSet = { ...locIVFin, points: [[0, 0], [0.05, 0]] };
    const { cna, cpX } = freeformFinAero(degenerate, bodyRadius, mach, refArea);
    expect(cna).toBe(0);
    expect(cpX).toBe(0);
  });
});
