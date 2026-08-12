import { describe, expect, it } from "vitest";
import { parseSplashcastWindData } from "./splashcast-import.js";
import { windAt } from "../../model/wind.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "../../../sim-files/wind/hutto_splash_zones_captured_2026-08-10.json");
const fixtureJson = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

describe("parseSplashcastWindData — real captured file (sim-files/wind/hutto_...)", () => {
  const data = parseSplashcastWindData(fixtureJson);

  it("extracts the launch site elevation converted from feet to meters", () => {
    // descent_params.site_elev_ft = 646.3 in this file.
    expect(data.siteElevationM).toBeCloseTo(646.3 * 0.3048, 3);
  });

  it("extracts the available wind hours (8am-5pm local)", () => {
    expect(data.hours).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it("lists the models available for a given hour", () => {
    const models = data.modelsForHour(9);
    expect(models).toEqual(expect.arrayContaining(["gfs", "ecmwf", "gem", "icon"]));
  });

  it("returns null for a model/hour combination with no data", () => {
    expect(data.profileFor(9, "not-a-real-model")).toBeNull();
    expect(data.profileFor(3, "gfs")).toBeNull(); // 3am not in wind_hours
  });

  it("parses the GFS profile for hour 9 with correct unit conversions", () => {
    // Raw source: wind_profiles["9"]["gfs"][0] = [0, 9.3, 190.0] (altitude ft, speed mph, direction deg),
    // cross-validated against wind.hourly["9"]["gfs"] = {speed: 9.3, direction: 190.0} in the same file.
    const profile = data.profileFor(9, "gfs");
    expect(profile).not.toBeNull();
    expect(profile!.samples.length).toBeGreaterThan(5);
    expect(profile!.samples[0]!.altitude).toBeCloseTo(0, 6);

    const groundWind = windAt(profile!, 0);
    expect(groundWind.speed).toBeCloseTo(9.3 * 0.44704, 3);
    expect(groundWind.directionFromDeg).toBeCloseTo(190.0, 1);
  });

  it("samples are sorted by ascending altitude", () => {
    const profile = data.profileFor(9, "gfs")!;
    for (let i = 1; i < profile.samples.length; i++) {
      expect(profile.samples[i]!.altitude).toBeGreaterThan(profile.samples[i - 1]!.altitude);
    }
  });

  it("produces a plausible interpolated wind speed at a mid-profile altitude (~1854m raw ft point in the source)", () => {
    // Raw source: wind_profiles["9"]["gfs"] includes [1854, 17.0, 190.0] almost exactly.
    const profile = data.profileFor(9, "gfs")!;
    const w = windAt(profile, 1854 * 0.3048);
    expect(w.speed).toBeCloseTo(17.0 * 0.44704, 1);
  });

  it("parses every declared hour/model combination without throwing", () => {
    for (const hour of data.hours) {
      for (const model of data.modelsForHour(hour)) {
        const profile = data.profileFor(hour, model);
        expect(profile).not.toBeNull();
        expect(profile!.samples.length).toBeGreaterThan(0);
        for (const s of profile!.samples) {
          expect(Number.isFinite(s.vx)).toBe(true);
          expect(Number.isFinite(s.vy)).toBe(true);
          expect(Number.isFinite(s.altitude)).toBe(true);
        }
      }
    }
  });
});
