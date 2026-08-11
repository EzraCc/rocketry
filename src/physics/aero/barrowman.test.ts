import { describe, expect, it } from "vitest";
import { computeBarrowman, stabilityMargin } from "./barrowman.js";
import type { Component } from "../../model/component.js";

// A simple, generic single-stage rocket: ogive nose + body tube + 3 trapezoidal
// fins at the tail. Not tied to a specific OpenRocket fixture — this is a
// sanity/integration check of the combiner logic (stacking, CP weighting,
// stability sign), not a regression test against exact numbers.
function simpleRocket(): Component[] {
  return [
    {
      type: "nosecone",
      id: "nose",
      name: "Nose cone",
      shape: "ogive",
      shapeParameter: 1,
      length: 0.1,
      aftRadius: 0.0125,
      thickness: 0.002,
    },
    {
      type: "bodytube",
      id: "tube",
      name: "Body tube",
      length: 0.3,
      radius: 0.0125,
      thickness: 0.001,
      isMotorMount: true,
    },
    {
      type: "finset",
      id: "fins",
      name: "Fins",
      finCount: 3,
      rootChord: 0.05,
      tipChord: 0.03,
      sweepLength: 0.02,
      span: 0.05,
      thickness: 0.003,
      cantAngle: 0,
      axialOffsetFromParentBottom: 0.25, // fin root leading edge near the tube's aft end
    },
  ];
}

describe("computeBarrowman — simple nose+tube+fins rocket", () => {
  it("produces positive total CNa and a CP downstream of the nose", () => {
    const result = computeBarrowman(simpleRocket(), 0.3);
    expect(result.cna).toBeGreaterThan(0);
    expect(result.cpX).toBeGreaterThan(0.1); // aft of the nose cone
    expect(result.cpX).toBeLessThan(0.4); // within the overall rocket length
  });

  it("reference diameter matches the body tube (widest point)", () => {
    const result = computeBarrowman(simpleRocket(), 0.3);
    expect(result.refDiameter).toBeCloseTo(0.025, 9);
  });

  it("CP moves aft as fins are enlarged (more tail-weighted CNa)", () => {
    const rocket = simpleRocket();
    const base = computeBarrowman(rocket, 0.3);

    const biggerFins = simpleRocket();
    const finComponent = biggerFins.find((c) => c.type === "finset");
    if (finComponent && finComponent.type === "finset") {
      finComponent.span *= 3;
    }
    const bigger = computeBarrowman(biggerFins, 0.3);

    expect(bigger.cpX).toBeGreaterThan(base.cpX);
  });

  it("stabilityMargin is positive when CG is forward of CP (stable) and negative when aft (unstable)", () => {
    const result = computeBarrowman(simpleRocket(), 0.3);
    const stableCg = result.cpX - 0.05; // CG forward of CP
    const unstableCg = result.cpX + 0.05; // CG aft of CP
    expect(stabilityMargin(result.cpX, stableCg, result.refDiameter)).toBeGreaterThan(0);
    expect(stabilityMargin(result.cpX, unstableCg, result.refDiameter)).toBeLessThan(0);
  });
});
