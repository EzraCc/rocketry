/**
 * Generates the real multi-model rocketry:ascentResults payload (the exact
 * envelope splashcast's embed listener receives, see src/ui/embed.ts /
 * runEmbedMultiModelSim in src/main.ts) for a real flight: LOC-IV X2 (real
 * RockSim geometry + mass/CG from public/library/loc/LOC-IV X2.rkt, not a
 * hand-transcribed placeholder) on an AeroTech K400C, using Hutto's real
 * captured wind data for target date 2026-08-15.
 *
 * Caveat surfaced in the output itself: the only 8/15 file present is the
 * T-1 capture (splash_zones_captured_2026-08-14.json, made the day before
 * launch) -- per manifest.json there is no T-0 (day-of) capture for this
 * date, so this is the closest available data, not literally T-0.
 *
 * Hour and launch-rod length aren't specified by the request, so this uses
 * the same hour (13:00) already exercised in this feature's own acceptance
 * testing, and this app's own default launch rod length (1.0 m) -- both
 * called out explicitly in _meta so they're easy to override and rerun.
 *
 * Usage: npx tsx scripts/export-hutto-0815-loc-iv-k400.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// parseRocksimXml needs a global DOMParser (normally supplied by the browser,
// or by vitest's jsdom test environment) -- this script runs under plain
// node via tsx, so polyfill it before importing anything that uses it.
(globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM().window.DOMParser;

const { parseRocksimXml } = await import("../src/formats/rocksim/parse.js");
const { computeBarrowman } = await import("../src/physics/aero/barrowman.js");
const { checkStability } = await import("../src/physics/aero/stability-check.js");
const { simulateFlight3D } = await import("../src/physics/sim/engine3d.js");
const { buildAscentPath } = await import("../src/physics/sim/ascent-path.js");
const { parseSplashcastWindData } = await import("../src/physics/wind/splashcast-import.js");
const { defaultRocket } = await import("../src/model/rocket.js");
const { downloadThrustSamples, searchMotors } = await import("../src/physics/motor/thrustcurve-client.js");
type Rocket = import("../src/model/rocket.js").Rocket;
type SelectedMotor = import("../src/model/rocket.js").SelectedMotor;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOUR = 13; // not specified by the request -- matches this feature's own acceptance testing

async function main() {
  // --- Real rocket geometry + mass/CG, parsed straight from the real RockSim file ---
  const rktPath = path.resolve(__dirname, "../public/library/loc/LOC-IV X2.rkt");
  const rocksimXml = fs.readFileSync(rktPath, "utf-8");
  const parsed = parseRocksimXml(rocksimXml);
  if (parsed.unsupportedFeatures.length > 0) {
    console.warn(`Note: unsupported features in this file: ${parsed.unsupportedFeatures.join(", ")}`);
  }
  if (parsed.estimatedDryCgM === undefined) {
    throw new Error("LOC-IV X2.rkt didn't resolve a dry CG -- can't compute stability without it.");
  }

  // --- Real motor, fetched live from ThrustCurve.org ---
  const candidates = await searchMotors({ manufacturer: "AeroTech", designation: "K400C", maxResults: 1 });
  if (candidates.length === 0) throw new Error("AeroTech K400C not found on ThrustCurve.org");
  const meta = candidates[0]!;
  const samples = await downloadThrustSamples(meta.motorId);
  const MM = 0.001;
  const motor: SelectedMotor = {
    motorId: meta.motorId,
    designation: meta.designation,
    manufacturer: meta.manufacturer,
    diameter: meta.diameter * MM,
    length: meta.length * MM,
    totalMassKg: (meta.totalWeightG ?? 0) / 1000,
    propellantMassKg: (meta.propWeightG ?? 0) / 1000,
    samples: samples.samples,
    delay: 0,
  };

  // --- Real wind: Hutto, target date 2026-08-15 (only capture on file is T-1, see header) ---
  const windPath = path.resolve(
    "/home/ezrac/github/splashcast/site/data/hutto/live/2026-08-15/splash_zones_captured_2026-08-14.json",
  );
  const windJson = JSON.parse(fs.readFileSync(windPath, "utf-8"));
  const windData = parseSplashcastWindData(windJson);
  const models = windData.modelsForHour(HOUR);
  if (models.length === 0) throw new Error(`No wind models available for hour ${HOUR} in the 8/15 Hutto capture.`);

  const motorMountComponent = parsed.components.find((c) => c.type === "bodytube" && c.isMotorMount);
  const bodyComponents = parsed.components.filter((c) => c.type === "bodytube" || c.type === "nosecone" || c.type === "transition");
  const motorMountId = motorMountComponent?.id ?? bodyComponents[bodyComponents.length - 1]?.id ?? "";

  const baseRocket: Rocket = {
    ...defaultRocket(),
    name: parsed.name,
    components: parsed.components,
    dryMass: parsed.estimatedDryMassKg,
    dryCg: parsed.estimatedDryCgM,
    motorMount: { componentId: motorMountId, motorOverhang: 0 },
    motor,
    launchRodLength: defaultRocket().launchRodLength, // 1.0 m -- not specified by the request, this app's own default
    launchAltitude: windData.siteElevationM,
  };

  const { cpX, refDiameter } = computeBarrowman(baseRocket.components, 0.3);
  const stability = checkStability(cpX, baseRocket.dryCg, refDiameter, true);

  // --- One sim per available model, exactly matching runEmbedMultiModelSim in src/main.ts ---
  const results: { model: string; ascentPath: ReturnType<typeof buildAscentPath> }[] = [];
  for (const model of models) {
    const windProfile = windData.profileFor(HOUR, model);
    const modelRocket: Rocket = { ...baseRocket, windProfile };
    const flight = simulateFlight3D(modelRocket);
    results.push({ model, ascentPath: buildAscentPath(flight, modelRocket) });
  }

  const payload = {
    type: "rocketry:ascentResults",
    rocketName: baseRocket.name,
    parseWarnings: parsed.warnings,
    stability,
    results,
  };

  const FT_PER_M = 3.28084;
  const output = {
    _meta: {
      generatedBy: "scripts/export-hutto-0815-loc-iv-k400.ts",
      generatedAt: new Date().toISOString(),
      rocket: baseRocket.name,
      rocketSource: "public/library/loc/LOC-IV X2.rkt (real RockSim geometry + mass/CG, not a placeholder)",
      motor: `${motor.manufacturer} ${motor.designation}`,
      windSource: "splashcast/site/data/hutto/live/2026-08-15/splash_zones_captured_2026-08-14.json",
      caveats: [
        "Requested as \"T-0\" weather for 8/15, but per splashcast's own manifest.json there is no T-0 (day-of) capture for this target date -- only a T-1 capture (made 2026-08-14, one day before) exists. This is that T-1 capture, the closest available data, not literally T-0.",
        `Hour not specified in the request -- used ${HOUR}:00, the hour already exercised in this feature's own acceptance testing. Available hours for this file: ${windData.hours.join(", ")}.`,
        `Launch rod length not specified -- used this app's own default (${defaultRocket().launchRodLength} m), not a real rail-length spec for this rocket/motor combo.`,
        "dryMass/dryCg come straight from the .rkt file's own RockSim-computed values (parseRocksimXml), not a manual override.",
      ],
    },
    rocket: {
      name: baseRocket.name,
      dryMassKg: baseRocket.dryMass,
      dryCgM: baseRocket.dryCg,
      motor: { designation: motor.designation, manufacturer: motor.manufacturer, totalMassKg: motor.totalMassKg, propellantMassKg: motor.propellantMassKg },
      launchAltitudeM: baseRocket.launchAltitude,
      launchRodLengthM: baseRocket.launchRodLength,
    },
    postMessagePayload: payload,
    summary: {
      hour: HOUR,
      models,
      stabilityMarginCal: stability.margin,
      flyable: stability.flyable,
      perModelApogee: results.map((r) => {
        const apogeeWp = r.ascentPath.waypoints.find((w) => w.type === "APOGEE");
        return {
          model: r.model,
          apogeeAltitudeFt: apogeeWp ? apogeeWp.altitude * FT_PER_M : null,
          apogeeAltitudeM: apogeeWp ? apogeeWp.altitude : null,
        };
      }),
    },
  };

  const outPath = path.resolve(__dirname, "../sim-files/hutto-0815-loc-iv-k400-ascent-results.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`Stability: ${stability.margin.toFixed(2)} cal, flyable=${stability.flyable}`);
  for (const row of output.summary.perModelApogee) {
    console.log(`  ${row.model}: apogee ${row.apogeeAltitudeFt?.toFixed(0)} ft`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
