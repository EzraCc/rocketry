// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { buildSimCacheKey, clearSimResultCache, hashString, loadCachedSimResult, saveCachedSimResult } from "./sim-result-cache.js";
import type { AscentPath } from "../physics/sim/ascent-path.js";

const EMPTY_PATH: AscentPath = {
  waypoints: [],
  path: [],
  segments: [],
  windShear: { ground: { vx: 0, vy: 0, speed: 0, directionFromDeg: 0 }, aloft: { vx: 0, vy: 0, speed: 0, directionFromDeg: 0 }, speedDeltaMs: 0, directionDeltaDeg: 0 },
};

afterEach(() => {
  clearSimResultCache();
});

describe("hashString", () => {
  it("is deterministic -- same input always hashes the same", () => {
    expect(hashString("hello world")).toBe(hashString("hello world"));
  });

  it("distinguishes different content (a real forecast update produces a different hash)", () => {
    expect(hashString('{"wind":1}')).not.toBe(hashString('{"wind":2}'));
  });
});

describe("buildSimCacheKey", () => {
  it("produces a distinct key per (forecast, hour, model, rocket) combination", () => {
    const base = { forecastFingerprint: "f1", hour: 9, model: "gfs", rocketFingerprint: "r1" };
    expect(buildSimCacheKey(base)).toBe(buildSimCacheKey(base));
    expect(buildSimCacheKey(base)).not.toBe(buildSimCacheKey({ ...base, hour: 11 }));
    expect(buildSimCacheKey(base)).not.toBe(buildSimCacheKey({ ...base, model: "ecmwf" }));
    expect(buildSimCacheKey(base)).not.toBe(buildSimCacheKey({ ...base, forecastFingerprint: "f2" }));
    expect(buildSimCacheKey(base)).not.toBe(buildSimCacheKey({ ...base, rocketFingerprint: "r2" }));
  });
});

describe("saveCachedSimResult / loadCachedSimResult", () => {
  it("round-trips a result under its key", () => {
    const key = buildSimCacheKey({ forecastFingerprint: "f1", hour: 9, model: "gfs", rocketFingerprint: "r1" });
    saveCachedSimResult(key, EMPTY_PATH);
    expect(loadCachedSimResult(key)).toEqual(EMPTY_PATH);
  });

  it("returns null for a key that was never saved (a genuine cache miss, e.g. scrubbing to a new hour)", () => {
    expect(loadCachedSimResult("never-saved-key")).toBeNull();
  });

  it("re-saving the same key replaces its entry rather than duplicating it", () => {
    const key = buildSimCacheKey({ forecastFingerprint: "f1", hour: 9, model: "gfs", rocketFingerprint: "r1" });
    saveCachedSimResult(key, EMPTY_PATH);
    const updated: AscentPath = { ...EMPTY_PATH, segments: [] };
    saveCachedSimResult(key, updated);
    expect(loadCachedSimResult(key)).toEqual(updated);
  });

  it("a scrub-back scenario: hour 9 cached, hour 11 computed+cached, scrubbing back to 9 still returns the original hour-9 result untouched", () => {
    const key9 = buildSimCacheKey({ forecastFingerprint: "f1", hour: 9, model: "gfs", rocketFingerprint: "r1" });
    const key11 = buildSimCacheKey({ forecastFingerprint: "f1", hour: 11, model: "gfs", rocketFingerprint: "r1" });
    const path9: AscentPath = { ...EMPTY_PATH, path: [{ time: 0, position: { x: 0, y: 0, z: 0 }, altitude: 9, tiltFromVerticalDeg: 0 }] };
    const path11: AscentPath = { ...EMPTY_PATH, path: [{ time: 0, position: { x: 0, y: 0, z: 0 }, altitude: 11, tiltFromVerticalDeg: 0 }] };
    saveCachedSimResult(key9, path9);
    saveCachedSimResult(key11, path11);
    expect(loadCachedSimResult(key9)).toEqual(path9);
    expect(loadCachedSimResult(key11)).toEqual(path11);
  });

  it("a forecast update (different content hash) at the SAME hour/model/rocket is a cache miss, forcing a rerun", () => {
    const staleKey = buildSimCacheKey({ forecastFingerprint: hashString("old forecast json"), hour: 9, model: "gfs", rocketFingerprint: "r1" });
    saveCachedSimResult(staleKey, EMPTY_PATH);
    const freshKey = buildSimCacheKey({ forecastFingerprint: hashString("new forecast json"), hour: 9, model: "gfs", rocketFingerprint: "r1" });
    expect(loadCachedSimResult(freshKey)).toBeNull();
  });

  it("clearSimResultCache empties it", () => {
    const key = buildSimCacheKey({ forecastFingerprint: "f1", hour: 9, model: "gfs", rocketFingerprint: "r1" });
    saveCachedSimResult(key, EMPTY_PATH);
    clearSimResultCache();
    expect(loadCachedSimResult(key)).toBeNull();
  });

  it("evicts the oldest entry once the cap is exceeded", () => {
    // Cap is 60 -- write 61 distinct keys and confirm the very first one is gone while the most
    // recent one (and one from the middle) survive.
    for (let i = 0; i < 61; i++) {
      saveCachedSimResult(buildSimCacheKey({ forecastFingerprint: "f1", hour: i, model: "gfs", rocketFingerprint: "r1" }), EMPTY_PATH);
    }
    expect(loadCachedSimResult(buildSimCacheKey({ forecastFingerprint: "f1", hour: 0, model: "gfs", rocketFingerprint: "r1" }))).toBeNull();
    expect(loadCachedSimResult(buildSimCacheKey({ forecastFingerprint: "f1", hour: 30, model: "gfs", rocketFingerprint: "r1" }))).toEqual(EMPTY_PATH);
    expect(loadCachedSimResult(buildSimCacheKey({ forecastFingerprint: "f1", hour: 60, model: "gfs", rocketFingerprint: "r1" }))).toEqual(EMPTY_PATH);
  });
});
