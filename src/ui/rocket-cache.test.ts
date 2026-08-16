// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { buildOutboundRocketConfig, clearCachedConfig, loadCachedConfig, saveCachedConfig, type CachedRocketConfig } from "./rocket-cache.js";

const LIBRARY_CONFIG: CachedRocketConfig = {
  version: 1,
  savedAt: "2026-08-16T12:00:00.000Z",
  rocketSource: { kind: "library", entryId: "loc-iv-x2", displayName: "LOC-IV X2" },
  overrides: { dryMassKg: 1.7, cgM: 0.8, cgOverriddenByUser: false, cpOverrideM: undefined, cpOverrideSource: null, launchRodLengthM: 2.1336 },
  motor: {
    motorId: "5f4294d20002310000000450",
    meta: { motorId: "5f4294d20002310000000450", manufacturer: "AeroTech", manufacturerAbbrev: "AeroTech", designation: "K400C", commonName: "K400", impulseClass: "K", diameter: 54, length: 359, type: "SU" } as never,
    samples: [{ time: 0, thrust: 546 }],
    sourceFormat: "RASP",
    sourceQuality: "cert",
  },
};

afterEach(() => {
  clearCachedConfig();
});

describe("saveCachedConfig / loadCachedConfig / clearCachedConfig", () => {
  it("round-trips a full config exactly", () => {
    saveCachedConfig(LIBRARY_CONFIG);
    expect(loadCachedConfig()).toEqual(LIBRARY_CONFIG);
  });

  it("returns null when nothing has been saved", () => {
    expect(loadCachedConfig()).toBeNull();
  });

  it("clearCachedConfig removes it -- a subsequent load returns null", () => {
    saveCachedConfig(LIBRARY_CONFIG);
    clearCachedConfig();
    expect(loadCachedConfig()).toBeNull();
  });

  it("a version mismatch is treated as no cache, not thrown/crashed", () => {
    localStorage.setItem("rocketry:lastConfig:v1", JSON.stringify({ ...LIBRARY_CONFIG, version: 2 }));
    expect(loadCachedConfig()).toBeNull();
  });

  it("malformed JSON is treated as no cache, not thrown/crashed", () => {
    localStorage.setItem("rocketry:lastConfig:v1", "{not valid json");
    expect(loadCachedConfig()).toBeNull();
  });

  it("a plain non-object value (e.g. a bare number) is treated as no cache", () => {
    localStorage.setItem("rocketry:lastConfig:v1", "42");
    expect(loadCachedConfig()).toBeNull();
  });

  it("round-trips an upload-sourced config, including its parsed shape", () => {
    const uploadConfig: CachedRocketConfig = {
      ...LIBRARY_CONFIG,
      rocketSource: {
        kind: "upload",
        fileName: "my-rocket.ork",
        displayName: "My Rocket",
        parsed: { name: "My Rocket", components: [], warnings: ["multi-stage file, only sustainer imported"] },
      },
      motor: null,
    };
    saveCachedConfig(uploadConfig);
    expect(loadCachedConfig()).toEqual(uploadConfig);
  });
});

describe("buildOutboundRocketConfig", () => {
  it("combines rocket + motor into one human-friendly label", () => {
    const outbound = buildOutboundRocketConfig(LIBRARY_CONFIG);
    expect(outbound.label).toBe("LOC-IV X2 + AeroTech K400C");
    expect(outbound.rocketSource).toEqual({ kind: "library", entryId: "loc-iv-x2" });
    expect(outbound.motorId).toBe("5f4294d20002310000000450");
    expect(outbound.overrides).toEqual(LIBRARY_CONFIG.overrides);
  });

  it("falls back to just the rocket name when no motor is cached yet", () => {
    const outbound = buildOutboundRocketConfig({ ...LIBRARY_CONFIG, motor: null });
    expect(outbound.label).toBe("LOC-IV X2");
    expect(outbound.motorId).toBeNull();
  });

  it("an upload-sourced config's outbound descriptor carries no parsed geometry, just {kind: \"upload\"}", () => {
    const uploadConfig: CachedRocketConfig = {
      ...LIBRARY_CONFIG,
      rocketSource: { kind: "upload", fileName: "x.ork", displayName: "Uploaded Rocket", parsed: { name: "Uploaded Rocket", components: [], warnings: [] } },
    };
    const outbound = buildOutboundRocketConfig(uploadConfig);
    expect(outbound.label).toBe("Uploaded Rocket + AeroTech K400C");
    expect(outbound.rocketSource).toEqual({ kind: "upload" });
  });
});
