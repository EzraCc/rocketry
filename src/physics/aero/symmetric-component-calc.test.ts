import { describe, expect, it } from "vitest";
import { symmetricComponentAero } from "./symmetric-component-calc.js";
import type { NoseCone } from "../../model/component.js";

describe("symmetricComponentAero — analytic conical nose cone", () => {
  // Universal Barrowman invariant: CNa=2.0 for ANY pointed nose cone shape,
  // for any length/fineness ratio, when normalized by its own base area —
  // this is exactly what a real rocket's RockSim file reports for its nose
  // cone (<BarrowmanCNa>2.</BarrowmanCNa>), which is what caught the missing
  // refArea normalization bug here (was previously returning the raw,
  // unnormalized 2*(A1-A0) in m^2).
  it("CNa = 2.0 exactly when refArea == own base area, for any shape/fineness", () => {
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
});

describe("symmetricComponentAero — body tube contributes zero CNa", () => {
  it("foreRadius == aftRadius -> CNa = 0", () => {
    const tube = {
      type: "bodytube" as const,
      id: "t1",
      name: "tube",
      length: 0.3,
      radius: 0.02,
      thickness: 0.001,
      isMotorMount: false,
    };
    const { cna } = symmetricComponentAero(tube, Math.PI * 0.02 * 0.02);
    expect(cna).toBeCloseTo(0, 9);
  });
});
