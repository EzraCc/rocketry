import { describe, expect, it } from "vitest";
import { shapeRadius, shapeVolume, type Shape } from "./shapes.js";

const ALL_SHAPES: Shape[] = ["conical", "ogive", "ellipsoid", "power", "parabolic", "haack"];

describe("shapeRadius endpoints", () => {
  const r = 0.05;
  const length = 0.2;

  for (const shape of ALL_SHAPES) {
    it(`${shape}: r(0)=0, r(length)=r`, () => {
      const param = shape === "haack" ? 1 / 3 : shape === "power" ? 0.5 : 1;
      expect(shapeRadius(shape, 0, r, length, param)).toBeCloseTo(0, 9);
      expect(shapeRadius(shape, length, r, length, param)).toBeCloseTo(r, 9);
    });

    it(`${shape}: monotonically nondecreasing`, () => {
      const param = shape === "haack" ? 1 / 3 : shape === "power" ? 0.5 : 1;
      let prev = 0;
      for (let i = 0; i <= 20; i++) {
        const x = (i / 20) * length;
        const rx = shapeRadius(shape, x, r, length, param);
        expect(rx).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = rx;
      }
    });
  }
});

describe("shapeVolume analytic checks", () => {
  it("conical volume matches (1/3)*pi*r^2*L exactly", () => {
    const r = 0.05;
    const length = 0.2;
    const analytic = (1 / 3) * Math.PI * r * r * length;
    expect(shapeVolume("conical", r, length, 1)).toBeCloseTo(analytic, 6);
  });

  it("ellipsoid (half-ellipsoid) volume matches (2/3)*pi*r^2*L", () => {
    const r = 0.05;
    const length = 0.2;
    const analytic = (2 / 3) * Math.PI * r * r * length;
    expect(shapeVolume("ellipsoid", r, length, 1)).toBeCloseTo(analytic, 5);
  });

  it("tangent ogive volume is between conical and ellipsoid (bulges out less than half-ellipsoid, more than cone)", () => {
    const r = 0.05;
    const length = 0.2;
    const coneVol = (1 / 3) * Math.PI * r * r * length;
    const ellipsoidVol = (2 / 3) * Math.PI * r * r * length;
    const ogiveVol = shapeVolume("ogive", r, length, 1);
    expect(ogiveVol).toBeGreaterThan(coneVol);
    expect(ogiveVol).toBeLessThan(ellipsoidVol);
  });
});
