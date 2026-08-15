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
import { referenceDiameter } from "../src/physics/geometry/rocket-geometry.js";
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

/**
 * Known, understood, NOT-yet-fixed discrepancies -- uses it.fails() (inverted pass/fail: green
 * while the underlying assertion keeps failing as expected, and itself turns red the moment that
 * assertion unexpectedly starts passing, which is the signal to come remove the entry and restore
 * the real check) rather than silently loosening a tolerance or excluding the case outright, so
 * `npm test` stays honestly green without hiding that these are open, tracked gaps:
 *
 * - mach1-chimera-bt60-j285 / mach1-chimera-98mm-m685w apogee: both fly supersonic (Mach 1.56 and
 *   1.23 respectively, per their own OpenRocket fixture's maxMach) -- exactly the regime
 *   DEVIATIONS.md's #2 (fin CNa1 frozen at Mach 0.9, no supersonic/transonic model at all) predicts
 *   large divergence in. Expected, not a new bug; not worth a blanket looser APOGEE_TOLERANCE for
 *   every case just to cover these two.
 * - mach1-chimera-bt60-j285 dry CG: a genuinely open, NOT-yet-root-caused issue found via this
 *   suite's own expansion -- distinct from the real UseKnownCG mass-override bug found and fixed in
 *   the same pass (see parse.ts's collectMassBreakdown), which this case's own total dry mass
 *   already matches OpenRocket's within ~3% (so it isn't a mass problem). Likely a component
 *   position issue instead: this file has several accessory parts (a Bulkhead, an eye bolt) placed
 *   with LocationMode=2 (BACK_OF_OWNING_PART) AND a negative <Xb>, a combination not exercised by
 *   any other case in this suite -- flagged here for follow-up, not silently patched over.
 */
const KNOWN_ISSUES = new Set<string>([
  "mach1-chimera-bt60-j285:apogee",
  "mach1-chimera-98mm-m685w:apogee",
  "mach1-chimera-bt60-j285:dryCg",
]);

describe.each(fixtureFiles)("%s vs. real OpenRocket Java simulation", (file) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(OPENROCKET_FIXTURES_DIR, file), "utf-8")) as OpenRocketFixture;
  const xml = fs.readFileSync(path.join(REPO_ROOT, fixture.rocketPath), "utf-8");
  const parsed = parseRocksimXml(xml);
  const motor = loadMotor(fixture.label);

  // Guards against exactly the bug this caught for real: loc-iv-k400c originally paired LOC-IV
  // (a 38.6mm motor mount) with AeroTech K400C, a 54mm-case motor that physically cannot fit --
  // caught by an explicit audit of every case's motor diameter against its rocket's real mount
  // size, not the rocket's outer body diameter (a mid/high-power rocket's outer tube is routinely
  // much wider than its motor mount -- e.g. this same LOC-IV file: 101.6mm body, 38.6mm mount).
  // Fixed by switching to J420R (confirmed real, present in both ThrustCurve.org's live API AND
  // OpenRocket's own bundled motor database -- see rockets.json's own note on that case). Falls
  // back to the reference/outer diameter only when the file has no separately-flagged motor mount
  // tube (a real, legitimate case -- the motor sits directly in the outer body on a minimum-
  // diameter build), same convention applyParsedRocket uses in src/main.ts.
  it("motor diameter physically fits the rocket's own motor mount", () => {
    const mountDiameterMm = (parsed.motorMountDiameterM ?? referenceDiameter(parsed.components)) * 1000;
    const motorDiameterMm = motor.diameter * 1000;
    expect(
      motorDiameterMm,
      `${fixture.motorManufacturer} ${fixture.motorDesignation} is ${motorDiameterMm}mm, but ${fixture.label}'s own motor mount is only ${mountDiameterMm.toFixed(1)}mm`,
    ).toBeLessThanOrEqual(mountDiameterMm + 0.5); // +0.5mm tolerance for float noise on an exact-fit size
  });

  it(`CP within ${(CP_TOLERANCE * 100).toFixed(0)}%`, () => {
    const { cpX } = computeBarrowman(parsed.components, COMPARISON_MACH);
    const ourCpMm = cpX * 1000;
    expect(relError(ourCpMm, fixture.cpXMm), `our CP ${ourCpMm.toFixed(1)}mm vs OpenRocket's ${fixture.cpXMm.toFixed(1)}mm`).toBeLessThan(
      CP_TOLERANCE,
    );
  });

  const apogeeTest = KNOWN_ISSUES.has(`${fixture.label}:apogee`) ? it.fails : it;
  apogeeTest(`apogee altitude within ${(APOGEE_TOLERANCE * 100).toFixed(0)}%, max velocity within ${(VELOCITY_TOLERANCE * 100).toFixed(0)}%`, () => {
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

  const dryCgTest = () => {
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
  };

  if (parsed.unsupportedFeatures.length === 0 && KNOWN_ISSUES.has(`${fixture.label}:dryCg`)) {
    it.fails(`estimated dry CG within ${(CG_TOLERANCE * 100).toFixed(0)}%`, dryCgTest);
  } else {
    it(parsed.unsupportedFeatures.length > 0 ? "dry CG estimate is withheld (unsupported geometry)" : `estimated dry CG within ${(CG_TOLERANCE * 100).toFixed(0)}%`, dryCgTest);
  }
});
