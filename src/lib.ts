/**
 * Public library surface — what a consumer like splashcast gets from the
 * IIFE/UMD bundle (as `window.Rocketry`) or the ESM build. Everything below
 * re-exports existing internal modules; this file adds no new physics, only
 * the three convenience entry points (simulateFromOrk / simulateFromRocksim /
 * simulateFromRasaero) that wrap the usual multi-step flow (parse -> attach
 * motor -> simulate -> shape into a path) behind a single call, matching the
 * handoff shape
 * splashcast's descent side already expects to extend (see
 * sim-files/ascent-path-export.json / .README.md, which prototypes this
 * exact output against a real fixture).
 */
import { unzipOrkXml } from "./formats/ork/unzip.js";
import { parseOrkXml } from "./formats/ork/parse.js";
import { parseRocksimXml } from "./formats/rocksim/parse.js";
import { parseRasaeroXml } from "./formats/rasaero/parse.js";
import { isBodyComponent, type Component } from "./model/component.js";
import { defaultRocket, type Rocket, type SelectedMotor } from "./model/rocket.js";
import type { WindProfile } from "./model/wind.js";
import { computeBarrowman } from "./physics/aero/barrowman.js";
import { checkStability, type StabilityCheck } from "./physics/aero/stability-check.js";
import { simulateFlight3D } from "./physics/sim/engine3d.js";
import { buildAscentPath, type AscentPath } from "./physics/sim/ascent-path.js";
import type { SimResult3D } from "./physics/sim/types3d.js";

export interface SimulateOptions {
  /** Manual mass/CG — this project never computes these from material density; the caller must supply them (e.g. from a form). */
  dryMassKg: number;
  dryCgM: number; // m from nose tip
  /** A fully resolved motor (already downloaded via searchMotors + downloadThrustSamples below) — motor *selection* is left to the caller's own UI. */
  motor: SelectedMotor;
  windProfile?: WindProfile | null;
  launchRodLengthM?: number;
  launchAltitudeM?: number;
}

export interface SimulateFromOrkOptions extends SimulateOptions {
  /** Raw bytes of the uploaded .ork file. */
  orkBytes: ArrayBuffer | Uint8Array;
}

export interface SimulateFromRocksimOptions extends SimulateOptions {
  /** Text content of the uploaded .rkt file (plain XML, not zipped — unlike .ork). */
  rocksimXml: string;
}

export interface SimulateFromRasaeroOptions extends SimulateOptions {
  /** Text content of the uploaded .CDX1 file (plain XML, not zipped — same as .rkt). */
  rasaeroXml: string;
  /** RASAero files carry no rocket name at all — OpenRocket's own importer uses the filename instead; do the same here if you have it. */
  fileName?: string;
}

export interface AscentResult {
  rocketName: string;
  /** Non-fatal notes from parsing (e.g. "multi-stage file, only sustainer imported") — surface these to the user, don't discard them. */
  parseWarnings: string[];
  stability: StabilityCheck;
  flight: SimResult3D;
  ascentPath: AscentPath;
}

function simulateFromComponents(name: string, components: Component[], warnings: string[], options: SimulateOptions): AscentResult {
  const motorMountComponent = components.find((c) => c.type === "bodytube" && c.isMotorMount);
  const bodyComponents = components.filter(isBodyComponent);
  const motorMountId = motorMountComponent?.id ?? bodyComponents[bodyComponents.length - 1]?.id ?? "";

  const rocket: Rocket = {
    ...defaultRocket(),
    name,
    components,
    dryMass: options.dryMassKg,
    dryCg: options.dryCgM,
    motorMount: { componentId: motorMountId, motorOverhang: 0 },
    motor: options.motor,
    windProfile: options.windProfile ?? null,
    launchRodLength: options.launchRodLengthM ?? 1.0,
    launchAltitude: options.launchAltitudeM ?? 0,
  };

  const { cpX, refDiameter } = computeBarrowman(rocket.components, 0.3);
  const stability = checkStability(cpX, rocket.dryCg, refDiameter, true);

  const flight = simulateFlight3D(rocket);
  const ascentPath = buildAscentPath(flight, rocket);

  return { rocketName: name, parseWarnings: warnings, stability, flight, ascentPath };
}

/**
 * The one-call handoff: .ork bytes + a resolved motor + (optional) wind in,
 * a full ascent simulation out. Throws if the file can't be parsed/unzipped
 * (see unzipOrkXml/parseOrkXml) — callers should catch and surface that to
 * the user rather than assume success.
 */
export async function simulateFromOrk(options: SimulateFromOrkOptions): Promise<AscentResult> {
  const xml = await unzipOrkXml(options.orkBytes);
  const parsed = parseOrkXml(xml);
  return simulateFromComponents(parsed.name, parsed.components, parsed.warnings, options);
}

/**
 * Same handoff as simulateFromOrk, for RockSim (.rkt) files. RockSim files
 * carry no motor data at all (only mount geometry), unlike .ork — the
 * `motor` option here was always going to be the caller's responsibility
 * regardless of file format, so the shape is identical either way.
 */
export function simulateFromRocksim(options: SimulateFromRocksimOptions): AscentResult {
  const parsed = parseRocksimXml(options.rocksimXml);
  return simulateFromComponents(parsed.name, parsed.components, parsed.warnings, options);
}

/**
 * Same handoff as simulateFromOrk, for RASAero (.CDX1) files. Also carries
 * no motor data (only mount geometry) — same as RockSim.
 */
export function simulateFromRasaero(options: SimulateFromRasaeroOptions): AscentResult {
  const parsed = parseRasaeroXml(options.rasaeroXml, options.fileName);
  return simulateFromComponents(parsed.name, parsed.components, parsed.warnings, options);
}

// --- Building blocks, exposed directly so a caller isn't limited to the one-shot flow above ---
export { unzipOrkXml } from "./formats/ork/unzip.js";
export { parseOrkXml, type ParsedOrkRocket, type OrkMotorRef } from "./formats/ork/parse.js";
export { parseRocksimXml, type ParsedRocksimRocket } from "./formats/rocksim/parse.js";
export { parseRasaeroXml, type ParsedRasaeroRocket } from "./formats/rasaero/parse.js";
export { searchMotors, downloadThrustSamples, getMotorMetadata, type MotorSearchResult, type MotorMetadata } from "./physics/motor/thrustcurve-client.js";
export { parseSplashcastWindData, type SplashcastWindData } from "./physics/wind/splashcast-import.js";
export { windSampleFromMeteorological, constantWindProfile, windAt, type WindVector, type WindSample } from "./model/wind.js";
export { simulateFlight3D } from "./physics/sim/engine3d.js";
export { buildAscentPath } from "./physics/sim/ascent-path.js";
export { computeBarrowman, stabilityMargin } from "./physics/aero/barrowman.js";
export { checkStability } from "./physics/aero/stability-check.js";
export { defaultRocket } from "./model/rocket.js";
export type { Rocket, SelectedMotor } from "./model/rocket.js";
export type { WindProfile } from "./model/wind.js";
export type { Component } from "./model/component.js";
export type { SimResult3D, SimSample3D, FlightEvent3D } from "./physics/sim/types3d.js";
export type { AscentPath, Waypoint, WaypointType, PathPoint, Segment, WindShearSummary } from "./physics/sim/ascent-path.js";
