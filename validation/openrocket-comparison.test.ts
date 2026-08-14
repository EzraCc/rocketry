// @vitest-environment jsdom
/**
 * Compares our own engine's output against real OpenRocket Java simulations, for a curated set of
 * rocket+motor cases (see openrocket-oracle/rockets.json). Fixtures are pre-generated and
 * committed (openrocket-oracle/fixtures/openrocket/*.json, fixtures/motors/*.json) -- this test
 * itself is offline/hermetic like every other test in this project, no network or Java needed to
 * run it. Regenerate fixtures with:
 *   validation/openrocket-oracle/run.sh
 *   npx tsx validation/openrocket-oracle/fetch-motor-fixtures.ts
 * (see openrocket-oracle/README.md for what each does and why).
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { computeBarrowman } from "../src/physics/aero/barrowman.js";
import { parseRocksimXml } from "../src/formats/rocksim/parse.js";
import { simulateFlight3D } from "../src/physics/sim/engine3d.js";
import { motorAxialPosition } from "../src/physics/mass/combined-mass.js";
import { defaultRocket, type Rocket, type SelectedMotor } from "../src/model/rocket.js";
import { isBodyComponent, type Component } from "../src/model/component.js";
import type { MotorSearchResult, ThrustSample } from "../src/physics/motor/thrustcurve-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OPENROCKET_FIXTURES_DIR = path.join(__dirname, "fixtures/openrocket");
const MOTOR_FIXTURES_DIR = path.join(__dirname, "fixtures/motors");

// Matches Part 2 (rocksim-embedded-cp.test.ts) and the live UI's own reference speed (see
// renderRocketSection/renderFlightResultHtml in src/main.ts) -- the actually safety-relevant
// rail-exit speed (~100fps), not an arbitrary "typical flight" number.
const COMPARISON_MACH = 0.1;

interface OpenRocketFixture {
  label: string;
  rocketPath: string;
  motorManufacturer: string;
  motorDesignation: string;
  cpXMm: number;
  cgAtLiftoffMm: number;
  massAtLiftoffKg: number;
  refDiameterMm: number;
  stabilityMarginCalibers: number;
  apogeeAltitudeM: number;
  apogeeTimeS: number;
  maxVelocityMs: number;
  maxMach: number;
  maxAccelerationMs2: number;
}

function loadMotor(label: string): SelectedMotor {
  const { meta, samples } = JSON.parse(fs.readFileSync(path.join(MOTOR_FIXTURES_DIR, `${label}.json`), "utf-8")) as {
    meta: MotorSearchResult;
    samples: ThrustSample[];
  };
  return {
    motorId: meta.motorId,
    designation: meta.designation,
    manufacturer: meta.manufacturer,
    diameter: (meta.diameter ?? 0) / 1000,
    length: (meta.length ?? 0) / 1000,
    totalMassKg: (meta.totalWeightG ?? 0) / 1000,
    propellantMassKg: (meta.propWeightG ?? 0) / 1000,
    samples,
    delay: 0,
  };
}

// Same motor-mount-selection rule as applyParsedRocket in src/main.ts: prefer a component
// RockSim's own IsMotorMount flag identified, falling back to the last body component.
function findMotorMountId(components: Component[]): string {
  const bodyComponents = components.filter(isBodyComponent);
  const flagged = components.find((c) => c.type === "bodytube" && c.isMotorMount);
  return (flagged ?? bodyComponents[bodyComponents.length - 1])?.id ?? "";
}

const relError = (ours: number, theirs: number) => Math.abs(ours - theirs) / Math.abs(theirs);

// Tolerances calibrated against the actual measured spread for these 6 cases (not guessed --
// see git history for the raw numbers), not picked to be "safely loose":
//   CP error:        1.6% - 7.3%   (all 6 cases)
//   max velocity/Mach error: 1.0% - 8.7%   (all 6 cases)
//   apogee altitude error:   3.7% - 26.8%  (all 6 cases)
// CP and velocity/Mach cluster tightly -- OpenRocket's own stability calculator doesn't have this
// project's interference-factor correction either, and small formula-detail differences (e.g. the
// Galejs body-lift term this project deliberately omits) explain the rest. Apogee altitude has a
// distinctly wider spread than velocity/Mach at the SAME instant -- consistent with small
// per-step differences (this project's thin-shell inertia estimate vs. OpenRocket's
// material-density-based one; dry mass/CG here is back-solved from OpenRocket's own loaded values
// rather than independently measured) compounding over a long ballistic coast to apogee, worse for
// higher/longer flights, rather than a single large error at one instant. Set apogee's tolerance
// wide enough to comfortably cover that, while velocity/Mach and CP stay meaningfully tighter --
// this is a regression/sanity net catching real bugs (a wrong sign, a missing drag term, an
// order-of-magnitude error), not a bit-for-bit parity requirement.
const CP_TOLERANCE = 0.1;
const VELOCITY_TOLERANCE = 0.15;
const APOGEE_TOLERANCE = 0.3;

const fixtureFiles = fs.readdirSync(OPENROCKET_FIXTURES_DIR).filter((f) => f.endsWith(".json"));

describe.each(fixtureFiles)("%s vs. real OpenRocket Java simulation", (file) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(OPENROCKET_FIXTURES_DIR, file), "utf-8")) as OpenRocketFixture;
  const xml = fs.readFileSync(path.join(REPO_ROOT, fixture.rocketPath), "utf-8");
  const parsed = parseRocksimXml(xml);
  const motor = loadMotor(fixture.label);

  it(`CP within ${(CP_TOLERANCE * 100).toFixed(0)}%`, () => {
    const { cpX } = computeBarrowman(parsed.components, COMPARISON_MACH);
    const ourCpMm = cpX * 1000;
    expect(relError(ourCpMm, fixture.cpXMm), `our CP ${ourCpMm.toFixed(1)}mm vs OpenRocket's ${fixture.cpXMm.toFixed(1)}mm`).toBeLessThan(
      CP_TOLERANCE,
    );
  });

  it(`apogee altitude within ${(APOGEE_TOLERANCE * 100).toFixed(0)}%, max velocity within ${(VELOCITY_TOLERANCE * 100).toFixed(0)}%`, () => {
    const motorMountId = findMotorMountId(parsed.components);
    const rocketForMotorPosition: Rocket = {
      ...defaultRocket(),
      components: parsed.components,
      motorMount: { componentId: motorMountId, motorOverhang: 0 },
      motor,
    };
    const pos = motorAxialPosition(rocketForMotorPosition);
    if (!pos) throw new Error(`motorAxialPosition returned null for ${fixture.label} -- motor mount not found/positioned`);

    // Back-solve dry mass/CG from OpenRocket's own LOADED mass/CG at liftoff, via the identical
    // moment-conservation math this project's own UI already uses (rederiveDryCg in main.ts) --
    // both engines then fly from the same loaded configuration, rather than each guessing an
    // independent dry mass.
    const loadedMassKg = fixture.massAtLiftoffKg;
    const loadedCgM = fixture.cgAtLiftoffMm / 1000;
    const dryMassKg = loadedMassKg - motor.totalMassKg;
    const dryCgM = (loadedMassKg * loadedCgM - motor.totalMassKg * pos.cgX) / dryMassKg;

    const rocket: Rocket = { ...rocketForMotorPosition, dryMass: dryMassKg, dryCg: dryCgM };
    const result = simulateFlight3D(rocket);

    expect(
      relError(result.apogeeAltitude, fixture.apogeeAltitudeM),
      `our apogee ${result.apogeeAltitude.toFixed(1)}m vs OpenRocket's ${fixture.apogeeAltitudeM.toFixed(1)}m`,
    ).toBeLessThan(APOGEE_TOLERANCE);

    expect(
      relError(result.maxVelocity, fixture.maxVelocityMs),
      `our max velocity ${result.maxVelocity.toFixed(1)}m/s vs OpenRocket's ${fixture.maxVelocityMs.toFixed(1)}m/s`,
    ).toBeLessThan(VELOCITY_TOLERANCE);
  });
});
