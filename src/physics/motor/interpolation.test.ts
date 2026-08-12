import { describe, expect, it } from "vitest";
import { interpolateAt, trapezoidalIntegral } from "./interpolation.js";

describe("interpolateAt", () => {
  const times = [0, 1, 2, 4];
  const values = [0, 10, 10, 2];

  it("returns exact sample values at sample times", () => {
    expect(interpolateAt(times, values, 0)).toBe(0);
    expect(interpolateAt(times, values, 1)).toBe(10);
    expect(interpolateAt(times, values, 4)).toBe(2);
  });

  it("linearly interpolates between samples", () => {
    expect(interpolateAt(times, values, 3)).toBeCloseTo(6, 9); // halfway 10->2
  });

  it("clamps outside the range to endpoint values", () => {
    expect(interpolateAt(times, values, -1)).toBe(0);
    expect(interpolateAt(times, values, 10)).toBe(2);
  });

  it("snaps to endpoint within tolerance of a sample time (avoids float boundary noise)", () => {
    expect(interpolateAt(times, values, 1 + 1e-6)).toBe(10);
    expect(interpolateAt(times, values, 1 - 1e-6)).toBe(10);
  });

  it("handles a single-sample series", () => {
    expect(interpolateAt([5], [42], 100)).toBe(42);
  });

  it("handles an empty series", () => {
    expect(interpolateAt([], [], 5)).toBe(0);
  });
});

describe("trapezoidalIntegral", () => {
  it("integrates a constant function exactly", () => {
    expect(trapezoidalIntegral([0, 1, 2, 3], [5, 5, 5, 5])).toBeCloseTo(15, 9);
  });

  it("integrates a triangular pulse exactly (area = 0.5*base*height)", () => {
    expect(trapezoidalIntegral([0, 1, 2], [0, 10, 0])).toBeCloseTo(10, 9);
  });
});
