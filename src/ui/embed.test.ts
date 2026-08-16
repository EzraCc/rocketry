import { describe, expect, it } from "vitest";
import { buildAscentResultMessage, buildErrorMessage, parseEmbedParams } from "./embed.js";
import type { StabilityCheck } from "../physics/aero/stability-check.js";
import type { AscentPath } from "../physics/sim/ascent-path.js";

describe("parseEmbedParams", () => {
  it("returns null when embed isn't exactly \"1\" (normal mode)", () => {
    expect(parseEmbedParams(new URLSearchParams(""))).toBeNull();
    expect(parseEmbedParams(new URLSearchParams("embed=0"))).toBeNull();
    expect(parseEmbedParams(new URLSearchParams("embed=true"))).toBeNull();
    // Even with the other params present, embed itself must be exactly "1".
    expect(parseEmbedParams(new URLSearchParams("embed=yes&windUrl=x&hour=1&parentOrigin=y"))).toBeNull();
  });

  it("parses a fully valid embed URL", () => {
    const params = parseEmbedParams(
      new URLSearchParams("embed=1&windUrl=https%3A%2F%2Fexample.com%2Fw.json&hour=13&parentOrigin=http%3A%2F%2Flocalhost%3A8000"),
    );
    expect(params).toEqual({
      windUrl: "https://example.com/w.json",
      hour: 13,
      parentOrigin: "http://localhost:8000",
    });
  });

  it("accepts a negative hour (no assumption that hour is always non-negative)", () => {
    const params = parseEmbedParams(new URLSearchParams("embed=1&windUrl=https://x&hour=-1&parentOrigin=http://y"));
    expect(params).toEqual({ windUrl: "https://x", hour: -1, parentOrigin: "http://y" });
  });

  it("missing windUrl: error with parentOrigin preserved (postMessage-able)", () => {
    const result = parseEmbedParams(new URLSearchParams("embed=1&hour=13&parentOrigin=http://localhost:8000"));
    expect(result).toEqual({ error: "Missing required windUrl parameter.", parentOrigin: "http://localhost:8000" });
  });

  it("missing parentOrigin: error with parentOrigin explicitly null (no safe postMessage target)", () => {
    const result = parseEmbedParams(new URLSearchParams("embed=1&windUrl=https://x&hour=13"));
    expect(result).toEqual({ error: "Missing required parentOrigin parameter.", parentOrigin: null });
  });

  it("missing hour: error with parentOrigin preserved", () => {
    const result = parseEmbedParams(new URLSearchParams("embed=1&windUrl=https://x&parentOrigin=http://y"));
    expect(result).toMatchObject({ parentOrigin: "http://y" });
    expect((result as { error: string }).error).toMatch(/hour/i);
  });

  it("non-integer hour: error, not silently coerced (e.g. NaN)", () => {
    const result = parseEmbedParams(new URLSearchParams("embed=1&windUrl=https://x&hour=thirteen&parentOrigin=http://y"));
    expect(result).toMatchObject({ parentOrigin: "http://y" });
    expect((result as { error: string }).error).toMatch(/hour/i);
  });

  it("float hour: rejected, not truncated -- an ambiguous input should error, not guess", () => {
    const result = parseEmbedParams(new URLSearchParams("embed=1&windUrl=https://x&hour=13.5&parentOrigin=http://y"));
    expect(result).toMatchObject({ parentOrigin: "http://y" });
    expect((result as { error: string }).error).toMatch(/hour/i);
  });
});

describe("buildAscentResultMessage", () => {
  it("assembles the exact rocketry:ascentResult envelope, passing StabilityCheck through unchanged (real field name \"margin\", not \"marginCalibers\")", () => {
    const stability: StabilityCheck = { margin: 1.5, flyable: true, warnings: [] };
    const ascentPath: AscentPath = {
      waypoints: [],
      path: [],
      segments: [],
      windShear: { ground: { vx: 0, vy: 0, speed: 0, directionFromDeg: 0 }, aloft: { vx: 0, vy: 0, speed: 0, directionFromDeg: 0 }, speedDeltaMs: 0, directionDeltaDeg: 0 },
    };
    const msg = buildAscentResultMessage("My Rocket", ["warning 1"], stability, ascentPath);
    expect(msg).toEqual({
      type: "rocketry:ascentResult",
      rocketName: "My Rocket",
      parseWarnings: ["warning 1"],
      stability,
      ascentPath,
    });
    expect((msg.stability as { marginCalibers?: number }).marginCalibers).toBeUndefined();
  });

  it("includes stability.flyable=false as-is -- never gates or blocks a marginal/unstable result", () => {
    const stability: StabilityCheck = { margin: -0.3, flyable: false, warnings: ["NOT FLYABLE: ..."] };
    const ascentPath: AscentPath = {
      waypoints: [],
      path: [],
      segments: [],
      windShear: { ground: { vx: 0, vy: 0, speed: 0, directionFromDeg: 0 }, aloft: { vx: 0, vy: 0, speed: 0, directionFromDeg: 0 }, speedDeltaMs: 0, directionDeltaDeg: 0 },
    };
    const msg = buildAscentResultMessage("Marginal Rocket", [], stability, ascentPath);
    expect(msg.stability.flyable).toBe(false);
    expect(msg.stability.warnings).toEqual(["NOT FLYABLE: ..."]);
  });
});

describe("buildErrorMessage", () => {
  it("assembles the exact rocketry:error envelope", () => {
    expect(buildErrorMessage("Could not load wind data for hour 13")).toEqual({
      type: "rocketry:error",
      message: "Could not load wind data for hour 13",
    });
  });
});
