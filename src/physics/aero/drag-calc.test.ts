import { describe, expect, it } from "vitest";
import { computeDrag } from "./drag-calc.js";
import { IsaAtmosphere } from "../atmosphere/isa-model.js";
import type { Component } from "../../model/component.js";

function simpleRocket(): Component[] {
  return [
    {
      type: "nosecone",
      id: "nose",
      name: "n",
      shape: "conical",
      shapeParameter: 1,
      length: 0.1,
      aftRadius: 0.0125,
      thickness: 0.002,
    },
    {
      type: "bodytube",
      id: "tube",
      name: "t",
      length: 0.3,
      radius: 0.0125,
      thickness: 0.001,
      isMotorMount: true,
    },
    {
      type: "finset",
      id: "fins",
      name: "f",
      finCount: 3,
      rootChord: 0.05,
      tipChord: 0.03,
      sweepLength: 0.02,
      span: 0.05,
      thickness: 0.003,
      cantAngle: 0,
      axialOffsetFromParentBottom: 0.25,
    },
  ];
}

const atm = new IsaAtmosphere();

describe("computeDrag — sanity", () => {
  it("produces a plausible total CD for a basic subsonic rocket (0.2-1.5 range)", () => {
    const result = computeDrag(simpleRocket(), 50, 50 / atm.at(0).speedOfSound, atm.at(0));
    expect(result.cd).toBeGreaterThan(0.2);
    expect(result.cd).toBeLessThan(1.5);
  });

  it("Reynolds number scales linearly with velocity", () => {
    const r1 = computeDrag(simpleRocket(), 20, 0.06, atm.at(0));
    const r2 = computeDrag(simpleRocket(), 40, 0.12, atm.at(0));
    expect(r2.reynoldsNumber / r1.reynoldsNumber).toBeCloseTo(2, 6);
  });

  it("skin friction coefficient decreases with Reynolds number within the laminar regime", () => {
    const slower = computeDrag(simpleRocket(), 5, 0.015, atm.at(0));
    const faster = computeDrag(simpleRocket(), 10, 0.03, atm.at(0));
    expect(slower.reynoldsNumber).toBeLessThan(5.39e5);
    expect(faster.reynoldsNumber).toBeLessThan(5.39e5);
    expect(faster.cdFriction).toBeLessThan(slower.cdFriction);
  });

  it("skin friction coefficient decreases with Reynolds number well within the turbulent regime", () => {
    // Note: the standard turbulent correlation (1/(1.5*lnRe-5.6)^2 - 1700/Re) is NOT
    // monotonic immediately after the laminar/turbulent transition (it has a small
    // hump right past Re~5.39e5 before resuming its decrease) -- that's a known
    // characteristic of this widely-used formula, not a bug here, so this test
    // deliberately picks two points well past that transition region.
    const slower = computeDrag(simpleRocket(), 200, 0.6, atm.at(0));
    const faster = computeDrag(simpleRocket(), 2000, 6, atm.at(0));
    expect(slower.reynoldsNumber).toBeGreaterThan(2e6);
    expect(faster.cdFriction).toBeLessThan(slower.cdFriction);
  });

  it("base drag coefficient is continuous across Mach 1 (0.25 from both sides)", () => {
    const justBelow = computeDrag(simpleRocket(), 340, 0.999, atm.at(0));
    const justAbove = computeDrag(simpleRocket(), 341, 1.001, atm.at(0));
    expect(justBelow.cdBase).toBeCloseTo(justAbove.cdBase, 3);
  });

  it("returns zero drag for a rocket with no body components (degenerate/empty)", () => {
    const result = computeDrag([], 50, 0.15, atm.at(0));
    expect(result.cd).toBe(0);
  });
});

describe("computeDrag — wetted area sanity (via analytic body shapes)", () => {
  it("a constant-radius body tube's wetted area matches the exact cylinder lateral-area formula (2*pi*r*L)", () => {
    // Isolate the tube: same total-wetted-area machinery, single component.
    const tubeOnly: Component[] = [
      { type: "bodytube", id: "t", name: "t", length: 0.3, radius: 0.0125, thickness: 0.001, isMotorMount: true },
    ];
    // Drag doesn't expose wettedArea directly, so cross-check indirectly: cdFriction should match
    // what frictionCoefficient(Re) * (2*pi*r*L) / refArea predicts, since refArea = pi*r^2 for this tube alone.
    const velocity = 50;
    const result = computeDrag(tubeOnly, velocity, velocity / atm.at(0).speedOfSound, atm.at(0));
    const r = 0.0125;
    const length = 0.3;
    const analyticWettedArea = 2 * Math.PI * r * length;
    const refArea = Math.PI * r * r;
    const kinematicViscosity = atm.at(0).dynamicViscosity / atm.at(0).density;
    const re = (velocity * length) / kinematicViscosity;
    const cf = re < 1e4 ? 1.33e-2 : re < 5.39e5 ? 1.328 / Math.sqrt(re) : 1 / (1.5 * Math.log(re) - 5.6) ** 2 - 1700 / re;
    const expectedCdFriction = (cf * analyticWettedArea) / refArea;
    expect(result.cdFriction).toBeCloseTo(expectedCdFriction, 4);
  });
});
