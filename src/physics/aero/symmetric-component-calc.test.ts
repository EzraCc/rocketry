import { describe, expect, it } from "vitest";
import { symmetricComponentAero } from "./symmetric-component-calc.js";
import type { NoseCone } from "../../model/component.js";

describe("symmetricComponentAero — analytic conical nose cone", () => {
  it("CNa = 2*pi*r^2 and CP at 2/3 of length (classic Barrowman conical result)", () => {
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
    const { cna, cpX } = symmetricComponentAero(cone);
    expect(cna).toBeCloseTo(2 * Math.PI * r * r, 6);
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
    const { cna } = symmetricComponentAero(tube);
    expect(cna).toBeCloseTo(0, 9);
  });
});
