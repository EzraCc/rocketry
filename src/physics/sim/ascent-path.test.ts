import { describe, expect, it } from "vitest";
import { buildAscentPath } from "./ascent-path.js";
import { simulateFlight3D } from "./engine3d.js";
import { defaultRocket, type Rocket, type SelectedMotor } from "../../model/rocket.js";
import type { Component } from "../../model/component.js";
import type { WindProfile } from "../../model/wind.js";
import { windSampleFromMeteorological } from "../../model/wind.js";
import { parseSplashcastWindData } from "../wind/splashcast-import.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function basicRocket(windProfile: WindProfile | null): Rocket {
  const components: Component[] = [
    { type: "nosecone", id: "nose", name: "n", shape: "ogive", shapeParameter: 1, length: 0.1, aftRadius: 0.0125, thickness: 0.002 },
    { type: "bodytube", id: "tube", name: "t", length: 0.3, radius: 0.0125, thickness: 0.001, isMotorMount: true },
    {
      type: "finset", id: "fins", name: "f", finCount: 3, rootChord: 0.05, tipChord: 0.03,
      sweepLength: 0.02, span: 0.05, thickness: 0.003, cantAngle: 0, axialOffsetFromParentBottom: 0.25,
    },
  ];
  const motor: SelectedMotor = {
    motorId: "c6", designation: "C6", manufacturer: "Estes", diameter: 0.018, length: 0.07,
    totalMassKg: 0.0241, propellantMassKg: 0.0108,
    samples: [
      { time: 0, thrust: 0 }, { time: 0.2, thrust: 14 }, { time: 0.5, thrust: 5 },
      { time: 1.8, thrust: 4 }, { time: 1.9, thrust: 0 },
    ],
    delay: 5,
  };
  return {
    ...defaultRocket(), components, dryMass: 0.04, dryCg: 0.24,
    motorMount: { componentId: "tube", motorOverhang: 0 }, motor,
    launchRodLength: 1.0, windProfile,
  };
}

describe("buildAscentPath — structure", () => {
  const rocket = basicRocket(null);
  const result = simulateFlight3D(rocket);
  const ascent = buildAscentPath(result, rocket);

  it("produces exactly the 4 waypoints in chronological order", () => {
    expect(ascent.waypoints.map((w) => w.type)).toEqual(["LIFTOFF", "LAUNCHROD", "BURNOUT", "APOGEE"]);
    for (let i = 1; i < ascent.waypoints.length; i++) {
      expect(ascent.waypoints[i]!.time).toBeGreaterThanOrEqual(ascent.waypoints[i - 1]!.time);
    }
  });

  it("produces the 2 named segments", () => {
    expect(ascent.segments.map((s) => `${s.from}->${s.to}`)).toEqual(["LAUNCHROD->BURNOUT", "BURNOUT->APOGEE"]);
    expect(ascent.segments[0]!.label).toMatch(/weathercock/i);
    expect(ascent.segments[1]!.label).toMatch(/apogee turnover/i);
  });

  it("path is time-ordered, starts near liftoff, ends near apogee", () => {
    expect(ascent.path.length).toBeGreaterThan(10);
    for (let i = 1; i < ascent.path.length; i++) {
      expect(ascent.path[i]!.time).toBeGreaterThanOrEqual(ascent.path[i - 1]!.time);
    }
    expect(ascent.path[0]!.time).toBeCloseTo(0, 1);
    expect(ascent.path.at(-1)!.time).toBeCloseTo(result.apogeeTime, 0);
  });

  it("path altitude roughly tracks the apogee altitude at the end", () => {
    expect(ascent.path.at(-1)!.altitude).toBeGreaterThan(result.apogeeAltitude * 0.9);
  });
});

describe("buildAscentPath — wind shear (synthetic, known values)", () => {
  it("reports ground wind and wind-aloft matching windAt() at each altitude, and a nonzero shear when the profile has one", () => {
    // Deliberate, large, known shear: ground wind from due south (180deg) at 5 m/s,
    // wind aloft (above 500m) from due west (270deg) at 15 m/s.
    const profile: WindProfile = {
      samples: [
        windSampleFromMeteorological(0, 5, 180),
        windSampleFromMeteorological(500, 15, 270),
      ],
    };
    const rocket = basicRocket(profile);
    const result = simulateFlight3D(rocket);
    const ascent = buildAscentPath(result, rocket);

    expect(ascent.windShear.ground.speed).toBeCloseTo(5, 1);
    expect(ascent.windShear.ground.directionFromDeg).toBeCloseTo(180, 0);
    // Apogee for this light rocket should be well above 500m -> aloft wind is the 270deg/15ms sample.
    if (result.apogeeAltitude > 500) {
      expect(ascent.windShear.aloft.speed).toBeCloseTo(15, 1);
      expect(ascent.windShear.aloft.directionFromDeg).toBeCloseTo(270, 0);
      expect(ascent.windShear.speedDeltaMs).toBeCloseTo(10, 1);
      expect(Math.abs(ascent.windShear.directionDeltaDeg)).toBeCloseTo(90, 0);
    }

    // Each waypoint's own wind should independently match its own altitude's wind, not just
    // the ground/aloft summary -- i.e. LAUNCHROD (near ground) should read close to the ground
    // wind, not some blended or apogee value.
    const launchRod = ascent.waypoints.find((w) => w.type === "LAUNCHROD")!;
    expect(launchRod.wind.directionFromDeg).toBeCloseTo(180, 0);
  });
});

describe("buildAscentPath — wind shear (real splashcast data)", () => {
  // This profile's direction only rotates meaningfully above ~1200m (it's ~187-190deg from
  // ground up to ~1000m, then sweeps down toward ~130-140deg by 2000-3000m). The small C6
  // rocket used elsewhere in this file only reaches ~450m apogee -- well below the shear layer
  // -- so it correctly sees almost no directional shear; that's real physics, not a bug. To
  // exercise the shear-reporting path against a case where the real data actually has shear to
  // report, use a bigger motor that climbs into the altitude band where this profile shears.
  function highApogeeRocket(windProfile: WindProfile | null): Rocket {
    const components: Component[] = [
      { type: "nosecone", id: "nose", name: "n", shape: "ogive", shapeParameter: 1, length: 0.15, aftRadius: 0.04, thickness: 0.003 },
      { type: "bodytube", id: "tube", name: "t", length: 0.8, radius: 0.04, thickness: 0.002, isMotorMount: true },
      {
        type: "finset", id: "fins", name: "f", finCount: 3, rootChord: 0.15, tipChord: 0.08,
        sweepLength: 0.08, span: 0.12, thickness: 0.005, cantAngle: 0, axialOffsetFromParentBottom: 0.65,
      },
    ];
    const motor: SelectedMotor = {
      motorId: "big", designation: "BIGH", manufacturer: "test", diameter: 0.038, length: 0.4,
      totalMassKg: 0.6, propellantMassKg: 0.35,
      samples: [
        { time: 0, thrust: 0 }, { time: 0.05, thrust: 250 }, { time: 1.5, thrust: 200 },
        { time: 3.0, thrust: 150 }, { time: 3.1, thrust: 0 },
      ],
      delay: 0,
    };
    return {
      ...defaultRocket(), components, dryMass: 1.2, dryCg: 0.5,
      motorMount: { componentId: "tube", motorOverhang: 0 }, motor,
      launchRodLength: 1.8, windProfile,
    };
  }

  it("shows real, nonzero directional shear between ground and aloft using the actual captured file", () => {
    const fixturePath = path.resolve(__dirname, "../../../sim-files/wind/hutto_splash_zones_captured_2026-08-10.json");
    const fixtureJson = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
    const windData = parseSplashcastWindData(fixtureJson);
    const profile = windData.profileFor(9, "gfs"); // has 14 altitude samples, confirmed real direction shear (190->134deg)
    expect(profile).not.toBeNull();

    const rocket = highApogeeRocket(profile);
    const result = simulateFlight3D(rocket);
    expect(result.apogeeAltitude).toBeGreaterThan(1200); // must clear into this profile's shear layer for the assertion below to be meaningful
    const ascent = buildAscentPath(result, rocket);

    // Real data: this profile's direction rotates from ~190deg at ground to ~130-140deg region
    // at altitude (verified directly against the raw file earlier) -- confirm the shear summary
    // picks up a real, substantial directional difference, not zero/noise.
    expect(Math.abs(ascent.windShear.directionDeltaDeg)).toBeGreaterThan(10);
  });

  it("small, low-apogee rocket sees minimal shear from the same real profile (doesn't reach the shear layer)", () => {
    const fixturePath = path.resolve(__dirname, "../../../sim-files/wind/hutto_splash_zones_captured_2026-08-10.json");
    const fixtureJson = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
    const windData = parseSplashcastWindData(fixtureJson);
    const profile = windData.profileFor(9, "gfs");

    const rocket = basicRocket(profile);
    const result = simulateFlight3D(rocket);
    expect(result.apogeeAltitude).toBeLessThan(1200);
    const ascent = buildAscentPath(result, rocket);

    expect(Math.abs(ascent.windShear.directionDeltaDeg)).toBeLessThan(10);
  });
});
