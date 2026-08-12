import { describe, expect, it } from "vitest";
import * as V from "./vec3.js";

describe("vec3", () => {
  it("cross product of X and Y axes is Z (right-handed)", () => {
    const r = V.cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(r).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("dot product of perpendicular vectors is zero", () => {
    expect(V.dot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0);
  });

  it("normalize produces a unit vector", () => {
    const n = V.normalize({ x: 3, y: 4, z: 0 });
    expect(V.length(n)).toBeCloseTo(1, 9);
    expect(n.x).toBeCloseTo(0.6, 9);
    expect(n.y).toBeCloseTo(0.8, 9);
    expect(n.z).toBeCloseTo(0, 9);
  });

  it("perpendicularComponent removes the along-axis part entirely", () => {
    const axis = { x: 0, y: 0, z: 1 };
    const v = { x: 3, y: 4, z: 5 };
    const perp = V.perpendicularComponent(v, axis);
    expect(V.dot(perp, axis)).toBeCloseTo(0, 9);
    expect(perp).toEqual({ x: 3, y: 4, z: 0 });
  });

  it("normalize of a zero vector returns zero, not NaN", () => {
    const n = V.normalize({ x: 0, y: 0, z: 0 });
    expect(n).toEqual({ x: 0, y: 0, z: 0 });
  });
});
