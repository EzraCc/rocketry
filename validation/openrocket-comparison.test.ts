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
// Measured spread for the 5 supported cases (Cerberus is flagged unsupportedFeatures and excluded
// -- see its own test below): 1.3% - 9.5%. LOC-IV's high end isn't a position bug (its own parts
// were individually cross-checked against RockSim's own per-part <Station> ground truth and match
// exactly) -- OpenRocket recomputes mass from material density/geometry rather than using RockSim's
// own cached per-part mass this project reads, so some divergence between the two dry-mass models
// is expected on top of any real position error. Wide enough to comfortably cover that known gap,
// still tight enough to catch a real bug (wrong sign, a part dropped/double-counted).
const CG_TOLERANCE = 0.15;

// Same back-solve every flight-level test here needs: OpenRocket's own LOADED mass/CG at liftoff
// (real Java sim output) plus this project's own motor axial position (geometry only, not mass),
// via the identical moment-conservation math this project's own UI uses (rederiveDryCg in main.ts).
function backSolveDryCg(fixture: OpenRocketFixture, motor: SelectedMotor, motorCgXM: number): number {
  const loadedMassKg = fixture.massAtLiftoffKg;
  const loadedCgM = fixture.cgAtLiftoffMm / 1000;
  const dryMassKg = loadedMassKg - motor.totalMassKg;
  return (loadedMassKg * loadedCgM - motor.totalMassKg * motorCgXM) / dryMassKg;
}

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

    // Both engines then fly from the same loaded configuration, rather than each guessing an
    // independent dry mass.
    const dryCgM = backSolveDryCg(fixture, motor, pos.cgX);
    const dryMassKg = fixture.massAtLiftoffKg - motor.totalMassKg;

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

  it(parsed.unsupportedFeatures.length > 0 ? "dry CG estimate is withheld (unsupported geometry)" : `estimated dry CG within ${(CG_TOLERANCE * 100).toFixed(0)}%`, () => {
    if (parsed.unsupportedFeatures.length > 0) {
      // Cerberus's own ExternalPod has no <Len> tag of its own -- RockSim derives its bounding
      // length from its nested children, which this parser doesn't attempt (see
      // ParsedRocksimRocket's unsupportedFeatures doc comment). Asserting undefined here (rather
      // than skipping this case) locks in that the parser withholds an estimate it can't back,
      // instead of silently returning a wrong one.
      expect(parsed.estimatedDryCgM).toBeUndefined();
      return;
    }

    const motorMountId = findMotorMountId(parsed.components);
    const rocketForMotorPosition: Rocket = {
      ...defaultRocket(),
      components: parsed.components,
      motorMount: { componentId: motorMountId, motorOverhang: 0 },
      motor,
    };
    const pos = motorAxialPosition(rocketForMotorPosition);
    if (!pos) throw new Error(`motorAxialPosition returned null for ${fixture.label} -- motor mount not found/positioned`);

    const orDryCgM = backSolveDryCg(fixture, motor, pos.cgX);
    const ourDryCgMm = parsed.estimatedDryCgM! * 1000;
    expect(
      relError(ourDryCgMm, orDryCgM * 1000),
      `our estimated dry CG ${ourDryCgMm.toFixed(1)}mm vs OpenRocket's back-solved ${(orDryCgM * 1000).toFixed(1)}mm`,
    ).toBeLessThan(CG_TOLERANCE);
  });
});
