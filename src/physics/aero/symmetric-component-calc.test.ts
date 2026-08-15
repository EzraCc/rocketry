import { describe, expect, it } from "vitest";
import { symmetricComponentAero } from "./symmetric-component-calc.js";
import { bodyComponentPlanform } from "../geometry/rocket-geometry.js";
import type { NoseCone } from "../../model/component.js";

const BODY_LIFT_K = 1.1; // mirrors symmetric-component-calc.ts's own constant, for independent verification

describe("symmetricComponentAero — analytic conical nose cone", () => {
  // Universal Barrowman invariant: CNa=2.0 for ANY pointed nose cone shape,
  // for any length/fineness ratio, when normalized by its own base area —
  // this is exactly what a real rocket's RockSim file reports for its nose
  // cone (<BarrowmanCNa>2.</BarrowmanCNa>), which is what caught the missing
  // refArea normalization bug here (was previously returning the raw,
  // unnormalized 2*(A1-A0) in m^2). Still exactly true at the default
  // alphaRad=0 -- see symmetricComponentAero's own doc comment: the Galejs
  // body-lift addition is genuinely zero at zero AOA (confirmed against real
  // OpenRocket output, not assumed), so this static-display invariant is
  // completely unaffected by that port.
  it("CNa = 2.0 exactly when refArea == own base area, for any shape/fineness (at alpha=0)", () => {
    const r = 0.05;
    const refArea = Math.PI * r * r;
    for (const [shape, param, length] of [
      ["conical", 1, 0.2],
      ["ogive", 1, 0.2],
      ["ellipsoid", 1, 0.15],
      ["power", 0.5, 0.25],
      ["haack", 1 / 3, 0.3],
    ] as const) {
      const cone: NoseCone = {
        type: "nosecone",
        id: "n1",
        name: "cone",
        shape,
        shapeParameter: param,
        length,
        aftRadius: r,
        thickness: 0.002,
      };
      const { cna } = symmetricComponentAero(cone, refArea);
      expect(cna, `shape=${shape}`).toBeCloseTo(2.0, 3);
    }
  });

  it("conical CP at 2/3 of length (classic Barrowman result, independent of refArea normalization)", () => {
    const r = 0.05;
    const length = 0.2;
    const cone: NoseCone = {
      type: "nosecone",
      id: "n1",
      name: "cone",
      shape: "conical",
      shapeParameter: 1,
      length,
      aftRadius: r,
      thickness: 0.002,
    };
    const { cpX } = symmetricComponentAero(cone, Math.PI * r * r);
    expect(cpX).toBeCloseTo((2 / 3) * length, 4);
  });

  // Nonzero AOA is where the Galejs port actually shows up (see its own doc comment on why it's
  // exactly zero at rest) -- verified here independently via bodyComponentPlanform, not tuned to
  // whatever the implementation happens to produce.
  it("at nonzero AOA, CNa exceeds the classical 2.0 by the Galejs contribution", () => {
    const r = 0.05;
    const length = 0.2;
    const refArea = Math.PI * r * r;
    const cone: NoseCone = { type: "nosecone", id: "n1", name: "cone", shape: "conical", shapeParameter: 1, length, aftRadius: r, thickness: 0.002 };
    const alpha = 0.1; // rad, ~5.7deg -- comfortably inside the stall-angle clamp real flight ever reaches
    const { cna } = symmetricComponentAero(cone, refArea, alpha);
    const { area: planformArea } = bodyComponentPlanform(cone);
    const sinAlphaSincAlpha = (Math.sin(alpha) * Math.sin(alpha)) / alpha;
    const expected = 2.0 + BODY_LIFT_K * (planformArea / refArea) * sinAlphaSincAlpha;
    expect(cna).toBeCloseTo(expected, 6);
    expect(cna).toBeGreaterThan(2.0);
  });
});

describe("symmetricComponentAero — Galejs body lift (plain body tube)", () => {
  const tube = {
    type: "bodytube" as const,
    id: "t1",
    name: "tube",
    length: 0.3,
    radius: 0.02,
    thickness: 0.001,
    isMotorMount: false,
  };
  const refArea = Math.PI * 0.02 * 0.02;

  // Matches the pre-port behavior exactly -- see symmetricComponentAero's own doc comment: body
  // lift is genuinely zero at alpha=0 (confirmed against real OpenRocket's own AOA=0 fixtures, not
  // assumed), same as this project's own STATIC CP/stability-margin display always uses. An
  // earlier version of this port got this wrong (treated it as a nonzero small-angle-limit
  // constant) and measurably moved CP away from real OpenRocket output -- see the function's own
  // doc comment for the full story.
  it("foreRadius == aftRadius, alpha=0 (default): CNa = 0, unchanged from before this port", () => {
    const { cna, cpX } = symmetricComponentAero(tube, refArea);
    expect(cna).toBeCloseTo(0, 9);
    expect(cpX).toBeCloseTo(tube.length / 2, 9);
  });

  it("at nonzero AOA, a plain tube now has real CNa from the Galejs term alone", () => {
    const alpha = 0.1;
    const { cna, cpX } = symmetricComponentAero(tube, refArea, alpha);
    const { area: planformArea, centroid: planformCenter } = bodyComponentPlanform(tube);
    const sinAlphaSincAlpha = (Math.sin(alpha) * Math.sin(alpha)) / alpha;
    expect(cna).toBeCloseTo(BODY_LIFT_K * (planformArea / refArea) * sinAlphaSincAlpha, 9);
    expect(cna).toBeGreaterThan(0);
    // A uniform-radius tube's planform is a plain rectangle -- centroid exactly at its midpoint,
    // matching the closed-form BodyTube.java result this numeric integration should reproduce
    // exactly (constant integrand, no discretization error).
    expect(planformCenter).toBeCloseTo(tube.length / 2, 9);
    expect(cpX).toBeCloseTo(tube.length / 2, 9);
  });

  it("at a fixed nonzero AOA, scales linearly with the tube's own planform area (length x diameter)", () => {
    const short = { ...tube, length: 0.2 };
    const long = { ...tube, length: 0.4 };
    const alpha = 0.1;
    const cnaShort = symmetricComponentAero(short, refArea, alpha).cna;
    const cnaLong = symmetricComponentAero(long, refArea, alpha).cna;
    expect(cnaLong / cnaShort).toBeCloseTo(2, 6); // double the length -> double the planform area -> double the CNa
  });

  it("grows with AOA (not constant) -- a real, second-order-in-alpha effect, not a linear slope", () => {
    const small = symmetricComponentAero(tube, refArea, 0.05).cna;
    const large = symmetricComponentAero(tube, refArea, 0.2).cna;
    expect(large).toBeGreaterThan(small);
  });
});
