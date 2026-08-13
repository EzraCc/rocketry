/**
 * Generates a real ascent-path JSON file for splashcast to test its handoff
 * integration against, using:
 *   - real rocket geometry: LOC Precision "PK-48 LOC-IV" (already transcribed
 *     from sim-files/LOC/PK-48 LOC-IV.rkt and validated against RockSim's own
 *     stored CP in scripts/validate-loc-iv.ts)
 *   - a real motor, fetched live from ThrustCurve.org (not synthetic)
 *   - real wind data, from the actual captured splashcast file
 *     (sim-files/wind/hutto_splash_zones_captured_2026-08-10.json)
 *
 * dryMass/dryCg are NOT from a real spec sheet — this tool's design has
 * mass/CG entered manually, and no published dry-weight figure for this kit
 * was available here, so they're reasonable placeholder estimates (documented
 * in the output JSON itself under `_meta.caveats`). Swap in the user's real
 * high-altitude rocket file once available and rerun this script unchanged.
 *
 * Usage: npx tsx scripts/export-ascent-path.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { computeBarrowman, stabilityMargin } from "../src/physics/aero/barrowman.js";
import { checkStability } from "../src/physics/aero/stability-check.js";
import { simulateFlight3D } from "../src/physics/sim/engine3d.js";
import { buildAscentPath } from "../src/physics/sim/ascent-path.js";
import { parseSplashcastWindData } from "../src/physics/wind/splashcast-import.js";
import { defaultRocket, type Rocket, type SelectedMotor } from "../src/model/rocket.js";
import type { Component } from "../src/model/component.js";
import { downloadThrustSamples, searchMotors } from "../src/physics/motor/thrustcurve-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MM = 0.001;

const locIvComponents: Component[] = [
  { type: "nosecone", id: "loc-nose", name: "Nose cone", shape: "ogive", shapeParameter: 1, length: 325.12 * MM, aftRadius: (101.6 / 2) * MM, thickness: 3.175 * MM },
  { type: "bodytube", id: "loc-tube1", name: "Body tube (fwd)", length: 279.4 * MM, radius: (101.6 / 2) * MM, thickness: 0, isMotorMount: false },
  { type: "bodytube", id: "loc-tube2", name: "Body tube (aft, carries fins + motor)", length: 584.2 * MM, radius: (101.6 / 2) * MM, thickness: 0, isMotorMount: true },
  {
    type: "freeformfinset", id: "loc-fins", name: "Fin set (RockSim CustomFinSet)", finCount: 3,
    points: [[171.45 * MM, 0], [206.375 * MM, 31.75 * MM], [206.375 * MM, 107.95 * MM], [142.875 * MM, 107.95 * MM], [0, 0]],
    thickness: 3 * MM, cantAngle: 0, axialOffsetFromParentBottom: 412.75 * MM,
  },
];

async function main() {
  // --- Real motor, fetched live from ThrustCurve.org ---
  // K400C: 54mm K-class, 3.2s burn, 493g propellant / 1194g total -- fits this
  // rocket's aft tube and is a realistic choice for a 4" MPR airframe like this.
  const candidates = await searchMotors({ manufacturer: "AeroTech", designation: "K400C", maxResults: 1 });
  if (candidates.length === 0) throw new Error("K400C not found on ThrustCurve.org");
  const meta = candidates[0]!;
  const samples = await downloadThrustSamples(meta.motorId);
  const motor: SelectedMotor = {
    motorId: meta.motorId,
    designation: meta.designation,
    manufacturer: meta.manufacturer,
    diameter: meta.diameter * MM,
    length: meta.length * MM,
    totalMassKg: (meta.totalWeightG ?? 0) / 1000,
    propellantMassKg: (meta.propWeightG ?? 0) / 1000,
    samples,
    delay: 0,
  };

  // --- Dry mass/CG: placeholder estimate (see file header) ---
  // Pick a CG that lands at a normal, flyable static margin (not right at a
  // boundary) so this file exercises the ordinary case, not an edge case.
  const { cpX, refDiameter } = computeBarrowman(locIvComponents, 0.3);
  const dryMass = 1.7; // kg, ESTIMATED -- no published spec sheet consulted
  const dryCg = cpX - refDiameter * 1.5; // ESTIMATED -- placed 1.5 cal forward of CP (mid-range "normal" margin)

  const rocket: Rocket = {
    ...defaultRocket(),
    name: 'LOC Precision "PK-48 LOC-IV" + AeroTech K400C (test fixture)',
    components: locIvComponents,
    dryMass,
    dryCg,
    motorMount: { componentId: "loc-tube2", motorOverhang: 0 },
    motor,
    launchRodLength: 2.4, // m, ~8ft rail -- typical for this class
    launchAltitude: 646.3 * 0.3048, // m ASL, real site elevation from the wind fixture (Hutto, TX)
  };

  // --- Real wind, from the actual captured splashcast file ---
  const fixturePath = path.resolve(__dirname, "../sim-files/wind/hutto_splash_zones_captured_2026-08-10.json");
  const fixtureJson = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
  const windData = parseSplashcastWindData(fixtureJson);
  const windProfile = windData.profileFor(9, "gfs");
  rocket.windProfile = windProfile;

  // --- Simulate + build ascent path ---
  const result = simulateFlight3D(rocket);
  const ascent = buildAscentPath(result, rocket);
  const combinedCg = dryCg; // launch-time CG approximation used for the stability check, matching src/main.ts
  const stability = checkStability(cpX, combinedCg, refDiameter, true);

  const FT_PER_M = 3.28084;
  const output = {
    _meta: {
      generatedBy: "scripts/export-ascent-path.ts",
      generatedAt: new Date().toISOString(),
      rocket: rocket.name,
      motor: `${motor.manufacturer} ${motor.designation}`,
      windSource: "sim-files/wind/hutto_splash_zones_captured_2026-08-10.json, hour=9, model=gfs",
      caveats: [
        "dryMass (1.7 kg) and dryCg are ESTIMATED placeholders, not from a real spec sheet -- rocketry's design has mass/CG entered manually, not computed.",
        "This is a schema/integration test fixture, not a validated flight prediction. Swap in a real high-altitude rocket file when available and rerun this script.",
        "Stability margin below uses dryCg as a stand-in for launch-time (motor-loaded) CG -- see instructions doc.",
      ],
    },
    rocket: {
      name: rocket.name,
      dryMassKg: dryMass,
      dryCgM: dryCg,
      motor: { designation: motor.designation, manufacturer: motor.manufacturer, totalMassKg: motor.totalMassKg, propellantMassKg: motor.propellantMassKg },
      launchAltitudeM: rocket.launchAltitude,
      launchRodLengthM: rocket.launchRodLength,
    },
    stability: {
      marginCalibers: stability.margin,
      flyable: stability.flyable,
      warnings: stability.warnings,
    },
    summary: {
      apogeeAltitudeFt: result.apogeeAltitude * FT_PER_M,
      apogeeAltitudeM: result.apogeeAltitude,
      apogeeTimeS: result.apogeeTime,
      burnoutAltitudeFt: (result.burnoutAltitude ?? 0) * FT_PER_M,
      burnoutAltitudeM: result.burnoutAltitude,
      tiltAtBurnoutDeg: result.tiltAtBurnoutDeg,
      maxVelocityMs: result.maxVelocity,
      maxMach: result.maxMach,
      warnings: result.warnings,
    },
    windShear: ascent.windShear,
    waypoints: ascent.waypoints,
    segments: ascent.segments,
    path: ascent.path,
  };

  const outPath = path.resolve(__dirname, "../sim-files/ascent-path-export.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`Apogee: ${output.summary.apogeeAltitudeFt.toFixed(0)} ft AGL at t=${output.summary.apogeeTimeS.toFixed(1)}s`);
  console.log(`Stability: ${output.stability.marginCalibers.toFixed(2)} cal, flyable=${output.stability.flyable}`);
  console.log(`Wind shear: ${output.windShear.speedDeltaMs.toFixed(1)} m/s, ${output.windShear.directionDeltaDeg.toFixed(0)}deg`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
