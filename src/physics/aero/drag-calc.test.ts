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

describe("computeDrag — pressure/wave drag (transonic bug fix)", () => {
  // Real regression coverage for the missing-transonic-drag bug: a user reported a flight
  // reaching Mach 3 / 40km on a motor that "couldn't do that on its own." Root cause: this
  // project's drag model had zero nose/transition pressure (wave) drag at any Mach, so total CD
  // barely changed near Mach 1 instead of rising sharply -- letting simulated rockets keep
  // accelerating well past what a real rocket on the same motor could achieve.
  const tangentOgiveRocket = (): Component[] => [
    { type: "nosecone", id: "n", name: "n", shape: "ogive", shapeParameter: 1, length: 0.32512, aftRadius: 0.0508, thickness: 0.003 },
    { type: "bodytube", id: "t", name: "t", length: 0.8, radius: 0.0508, thickness: 0.002, isMotorMount: true },
  ];

  it("has zero pressure drag for a constant-radius body tube (no shape change -> no pressure drag)", () => {
    const tubeOnly: Component[] = [{ type: "bodytube", id: "t", name: "t", length: 0.3, radius: 0.0125, thickness: 0.001, isMotorMount: true }];
    const result = computeDrag(tubeOnly, 300, 0.9, atm.at(0));
    expect(result.cdPressure).toBe(0);
  });

  it("real transonic bug fix: pressure drag is genuinely nonzero right around Mach 1 for a real tangent-ogive nose, even though the naive endpoint values there are both ~0", () => {
    // This is the exact regression the bug fix targets: a tangent ogive (shapeParameter=1, the
    // most common real nose cone parameterization -- e.g. this project's own LOC-IV fixture) has
    // sinphi very close to 0, so a value-only interpolation between its M=1 and M=1.3 anchors
    // would come out ~0 throughout -- missing the real "sound barrier" drag rise entirely, which
    // instead comes from a large, sinphi-independent DERIVATIVE at M=1 (see
    // growingShapePressureCd's doc comment). Assert the actual physical signature: pressure drag
    // rises well above its own M=1 endpoint value somewhere in the transonic bulge.
    const components = tangentOgiveRocket();
    const atMach1 = computeDrag(components, 340, 1.0, atm.at(0));
    const atBulgePeak = computeDrag(components, 340 * 1.08, 1.08, atm.at(0));
    expect(atBulgePeak.cdPressure).toBeGreaterThan(atMach1.cdPressure * 5);
    expect(atBulgePeak.cdPressure).toBeGreaterThan(0.01);
  });

  it("total CD is noticeably higher at the transonic peak than at a matched subsonic point (the qualitative fix: drag should rise sharply approaching Mach 1, not stay flat)", () => {
    const components = tangentOgiveRocket();
    const subsonic = computeDrag(components, 340 * 0.5, 0.5, atm.at(0));
    const transonicPeak = computeDrag(components, 340 * 1.08, 1.08, atm.at(0));
    expect(transonicPeak.cd).toBeGreaterThan(subsonic.cd * 1.1);
  });

  it("pressure drag is continuous (no jump) across the M=1.3 boundary between the Hermite blend and the exact supersonic formula", () => {
    const components = tangentOgiveRocket();
    const justBelow = computeDrag(components, 340 * 1.2999, 1.2999, atm.at(0));
    const justAbove = computeDrag(components, 340 * 1.3001, 1.3001, atm.at(0));
    expect(justBelow.cdPressure).toBeCloseTo(justAbove.cdPressure, 3);
  });

  it("boat tail (narrowing transition) pressure drag: zero for a long/slender fineness ratio >= 3, matching OR's own cutoff", () => {
    const withLongBoattail: Component[] = [
      { type: "bodytube", id: "t", name: "t", length: 0.3, radius: 0.05, thickness: 0.002, isMotorMount: true },
      { type: "transition", id: "bt", name: "bt", shape: "conical", shapeParameter: 0, length: 0.5, foreRadius: 0.05, aftRadius: 0.03, thickness: 0.002 }, // fineness = 0.5/(2*0.02) = 12.5
    ];
    const result = computeDrag(withLongBoattail, 340, 1.0, atm.at(0));
    // Isolate the boattail's own contribution: compare against the same rocket without it.
    const withoutBoattail: Component[] = [withLongBoattail[0]!];
    const base = computeDrag(withoutBoattail, 340, 1.0, atm.at(0));
    expect(result.cdPressure).toBeCloseTo(base.cdPressure, 6);
  });

  it("boat tail pressure drag is nonzero for a stubby (low fineness ratio) boat tail", () => {
    const withStubbyBoattail: Component[] = [
      { type: "bodytube", id: "t", name: "t", length: 0.3, radius: 0.05, thickness: 0.002, isMotorMount: true },
      { type: "transition", id: "bt", name: "bt", shape: "conical", shapeParameter: 0, length: 0.02, foreRadius: 0.05, aftRadius: 0.03, thickness: 0.002 }, // fineness = 0.02/(2*0.02) = 0.5
    ];
    const result = computeDrag(withStubbyBoattail, 340, 1.0, atm.at(0));
    expect(result.cdPressure).toBeGreaterThan(0);
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
