import { describe, expect, it } from "vitest";
import { windAt, windSampleFromMeteorological, type WindProfile } from "./wind.js";

describe("windSampleFromMeteorological — direction convention", () => {
  // Meteorological direction = compass bearing the wind blows FROM. The
  // resulting velocity vector must point the opposite way.
  it("wind from due north (0deg) blows toward due south", () => {
    const s = windSampleFromMeteorological(0, 10, 0);
    expect(s.vx).toBeCloseTo(0, 6);
    expect(s.vy).toBeCloseTo(-10, 6);
  });

  it("wind from due east (90deg) blows toward due west", () => {
    const s = windSampleFromMeteorological(0, 10, 90);
    expect(s.vx).toBeCloseTo(-10, 6);
    expect(s.vy).toBeCloseTo(0, 6);
  });

  it("wind from due south (180deg) blows toward due north", () => {
    const s = windSampleFromMeteorological(0, 10, 180);
    expect(s.vx).toBeCloseTo(0, 6);
    expect(s.vy).toBeCloseTo(10, 6);
  });

  it("wind from due west (270deg) blows toward due east", () => {
    const s = windSampleFromMeteorological(0, 10, 270);
    expect(s.vx).toBeCloseTo(10, 6);
    expect(s.vy).toBeCloseTo(0, 6);
  });
});

describe("windAt — round trip and interpolation", () => {
  it("recovers the same speed/direction from a single-sample profile at any altitude", () => {
    const profile: WindProfile = { samples: [windSampleFromMeteorological(0, 12.3, 217)] };
    for (const alt of [0, 500, 5000]) {
      const w = windAt(profile, alt);
      expect(w.speed).toBeCloseTo(12.3, 6);
      expect(w.directionFromDeg).toBeCloseTo(217, 3);
    }
  });

  it("clamps to the boundary sample below the minimum and above the maximum altitude", () => {
    const profile: WindProfile = {
      samples: [windSampleFromMeteorological(1000, 5, 180), windSampleFromMeteorological(3000, 15, 180)],
    };
    expect(windAt(profile, -500).speed).toBeCloseTo(5, 6);
    expect(windAt(profile, 10000).speed).toBeCloseTo(15, 6);
  });

  it("linearly interpolates speed at the midpoint between two same-direction samples", () => {
    const profile: WindProfile = {
      samples: [windSampleFromMeteorological(1000, 5, 180), windSampleFromMeteorological(3000, 15, 180)],
    };
    const mid = windAt(profile, 2000);
    expect(mid.speed).toBeCloseTo(10, 6);
    expect(mid.directionFromDeg).toBeCloseTo(180, 3);
  });

  it("handles compass wraparound correctly (350deg and 10deg should blend through 0deg, not 180deg)", () => {
    const profile: WindProfile = {
      samples: [windSampleFromMeteorological(1000, 10, 350), windSampleFromMeteorological(3000, 10, 10)],
    };
    const mid = windAt(profile, 2000);
    // Should be ~0deg (or 360deg), not ~180deg -- this is exactly what vector-based
    // interpolation is for for.
    const normalized = mid.directionFromDeg > 180 ? mid.directionFromDeg - 360 : mid.directionFromDeg;
    expect(Math.abs(normalized)).toBeLessThan(5);
  });

  it("returns zero wind for an empty profile", () => {
    const w = windAt({ samples: [] }, 1000);
    expect(w.speed).toBe(0);
  });
});
