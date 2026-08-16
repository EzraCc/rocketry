import "@picocss/pico/css/pico.indigo.min.css";
import "./style.css";
import { computeBarrowman, stabilityMargin } from "./physics/aero/barrowman.js";
import { overallLength, referenceDiameter } from "./physics/geometry/rocket-geometry.js";
import { checkStability, LOW_MARGIN_THRESHOLD, type StabilityCheck } from "./physics/aero/stability-check.js";
import { previewNoseWeight, solveNoseWeight } from "./physics/mass/nose-weight.js";
import { renderSchematicSvg } from "./ui/schematic/render.js";
import { defaultRocket, type Rocket, type SelectedMotor } from "./model/rocket.js";
import { isBodyComponent, type Component } from "./model/component.js";
import { unzipOrkXml } from "./formats/ork/unzip.js";
import { parseOrkXml } from "./formats/ork/parse.js";
import { parseRocksimXml, type DescentDevice } from "./formats/rocksim/parse.js";
import { parseRasaeroXml } from "./formats/rasaero/parse.js";
import { IsaAtmosphere } from "./physics/atmosphere/isa-model.js";
import {
  searchMotors,
  downloadThrustSamples,
  downloadInitialThrusts,
  getMotorMetadata,
  type MotorSearchResult,
  type ThrustSample,
  type MotorMassBasis,
} from "./physics/motor/thrustcurve-client.js";
import { burnTime, getThrustAt, totalImpulse } from "./physics/motor/motor-model.js";
import { deriveMotorMassCurve, getMotorMassAt } from "./physics/mass/motor-mass-curve.js";
import { combinedMassAt, motorAxialPosition } from "./physics/mass/combined-mass.js";
import type { SimResult3D } from "./physics/sim/types3d.js";
import { renderFlightChart, renderThrustCurveChart, clearAllChartCursors, isScrubLocked, setScrubLockListener } from "./ui/charts/flight-chart.js";
import { simulateFlight3DInWorker } from "./worker/sim-worker-client.js";
import { windAt, constantWindProfile, type WindProfile } from "./model/wind.js";
import { parseSplashcastWindData, type SplashcastWindData } from "./physics/wind/splashcast-import.js";
import { buildAscentPath } from "./physics/sim/ascent-path.js";
import { parseEmbedParams, buildAscentResultsMessage, buildErrorMessage, type EmbedParams, type ModelAscentResult } from "./ui/embed.js";
import {
  saveCachedConfig,
  loadCachedConfig,
  clearCachedConfig,
  buildOutboundRocketConfig,
  type CachedRocketConfig,
  type CachedParsedRocket,
} from "./ui/rocket-cache.js";
import { hashString, buildSimCacheKey, loadCachedSimResult, saveCachedSimResult } from "./ui/sim-result-cache.js";
import {
  getUnitSystem,
  setUnitSystem,
  type UnitSystem,
  fmtLength,
  fmtAltitude,
  fmtRocketLength,
  fmtMass,
  fmtVelocity,
  fmtForce,
  fmtImpulse,
  massToInput,
  massFromInput,
  massInputUnitLabel,
  lengthInputUnitLabel,
  lengthToInput,
  lengthFromInput,
  altitudeInputUnitLabel,
  altitudeToInput,
  altitudeFromInput,
} from "./ui/units.js";

/**
 * One entry in the pre-generated `public/library/manifest.json` — a small
 * index (name/vendor/path/rounded dimensions) covering every curated
 * vendor rocket, loaded eagerly so the browse/filter UI is instant, while
 * the actual per-rocket geometry (a real .rkt file, fetched and parsed on
 * demand — see applyParsedRocket) is only fetched once a user actually
 * selects that entry. Compiled from vendor-published files with
 * permission: LOC Precision (1), Apogee (2), Mach1 (108 after removing
 * exact-duplicate saves), Wildman (153 after content-based dedup — see the
 * curation notes in this project's session history for why a naive
 * filename or overall-size dedup would have wrongly merged distinct
 * rockets that happen to share a common airframe tube).
 */
interface LibraryDescentDevice {
  type: "parachute" | "streamer";
  role: "main" | "drogue";
  dragAreaM2: number;
  dragCoefficient: number;
}

interface LibraryManifestEntry {
  id: string;
  vendor: string;
  name: string;
  path: string; // relative to the site root, e.g. "library/apogee/Zephyr.rkt"
  diameterMm: number;
  lengthMm: number;
  warnings: boolean;
  /** Undefined when the file has no separately-flagged motor mount tube — the motor sits directly in the outer body (common on minimum-diameter builds); fall back to diameterMm in that case. */
  motorMountDiameterMm?: number;
  descentDevices: LibraryDescentDevice[];
}

let libraryManifest: LibraryManifestEntry[] = [];

/**
 * Nearest half-inch nominal tube size. Rockets built on "the same" nominal
 * diameter still measure a millimeter or two apart depending on
 * construction (cardboard vs. fiberglass, thin- vs. thick-wall) — bucketing
 * at half-inch resolution collapses that construction noise into one
 * filterable category instead of spawning a near-duplicate 0.0x" bucket per
 * rocket, while still keeping genuinely different tube sizes (which differ
 * by much more than half an inch in this library) apart.
 */
function nominalDiameterIn(mm: number): number {
  return Math.round((mm / 25.4) * 2) / 2;
}

async function loadLibraryManifest(): Promise<LibraryManifestEntry[]> {
  const res = await fetch("library/manifest.json");
  if (!res.ok) throw new Error(`Failed to load the rocket library manifest (HTTP ${res.status})`);
  return (await res.json()) as LibraryManifestEntry[];
}

/**
 * Builds and sets activeRocket from a freshly-parsed .rkt/.ork/.CDX1 result
 * — shared by both the library-select path (fetch + parseRocksimXml) and
 * the file-upload path, since both need the identical motor-mount
 * detection and mass-prefill rules (never guess CG; prefer a file's own
 * estimatedDryMassKg over the generic placeholder when available).
 */
function applyParsedRocket(
  parsed: {
    name: string;
    components: Component[];
    estimatedDryMassKg?: number;
    estimatedDryCgM?: number;
    dryMassBreakdown?: { name: string; massKg: number; cgXM: number }[];
    motorMountDiameterM?: number;
    unsupportedFeatures?: string[];
    embeddedCpM?: number;
    descentDevices?: DescentDevice[];
  },
  source: string,
  displayName?: string,
): void {
  activeUnsupportedFeatures = parsed.unsupportedFeatures ?? [];
  activeEstimatedDryCgM = parsed.estimatedDryCgM;
  activeEmbeddedCpM = parsed.embeddedCpM;
  activeCpOverrideM = undefined;
  cpOverrideSource = null;
  activeDescentDevices = parsed.descentDevices ?? [];
  const motorMountComponent = parsed.components.find((c) => c.type === "bodytube" && c.isMotorMount);
  const bodyComponents = parsed.components.filter(isBodyComponent);
  const motorMountId = motorMountComponent?.id ?? bodyComponents[bodyComponents.length - 1]?.id ?? "";

  // Only .rkt files carry a real motor-mount-tube diameter (see parseRocksimXml's
  // motorMountDiameterM doc comment) -- .ork/.CDX1 uploads and files with no separately-flagged
  // inner tube fall back to the reference (outer body) diameter, which for a minimum-diameter
  // build genuinely IS what the motor sits in.
  activeMotorMountDiameterMm = (parsed.motorMountDiameterM ?? referenceDiameter(parsed.components)) * 1000;
  syncMotorMountUi();

  activeRocket = {
    ...defaultRocket(),
    // Library selections pass the manifest's curated name (human-verified, matches what the
    // browse/search UI showed) rather than the file's own internal RockSim <Name> tag, which is
    // sometimes cryptic or inconsistent with it (e.g. one real case: "LOC-1 Magnum" internally vs.
    // "LOC-I Magnum" on the vendor's own site -- a 1/I typo in the file, not a display bug). File
    // uploads have no curated name to fall back to, so they keep using the file's own name.
    name: displayName ?? parsed.name,
    components: parsed.components,
    motorMount: { componentId: motorMountId, motorOverhang: 0 },
  };

  // estimatedDryMassKg (RockSim's own <CalcMass> sum, see parse.ts) is structural-only -- it never
  // includes a motor, which matches what's shown by default (dry mass, until a motor's picked).
  // With no estimate in the file, keep whatever base dry mass is already set rather than resetting
  // to the 50g placeholder on every rocket switch.
  if (parsed.estimatedDryMassKg && parsed.estimatedDryMassKg > 0) {
    baseDryMassKg = parsed.estimatedDryMassKg;
  } else if (!baseDryMassKg || baseDryMassKg <= 0) {
    baseDryMassKg = 0.05;
  }
  activeDryMassKg = baseDryMassKg;
  dryMassOverriddenViaLoadedEdit = false;
  activeLoadedCgM = 0; // reset -- autoDeriveLoadedCg (inside rederiveDryCg) fills this from activeEstimatedDryCgM when available
  cgOverriddenByUser = false;
  noseWeightUi = { targetMarginCal: LOW_MARGIN_THRESHOLD, addedMassKg: null, massManuallySet: false, xNoseM: null };
  rederiveDryCg();

  activeRocketSource = source;
}

/**
 * The rocket the motor-select/flight-sim section below actually runs
 * against — starts empty (see initLibrary, which loads a real default
 * asynchronously) and is replaced wholesale by picking a library entry or
 * uploading a real .ork/.rkt/.CDX1 file. Kept as a single mutable binding
 * (rather than threading a rocket parameter through selectMotor et al.)
 * since this file's whole render flow is already imperative DOM
 * manipulation, not a framework with real state management.
 */
let activeRocket: Rocket = defaultRocket();
/**
 * Set by selectLibraryEntry, cleared by wireOrkImport's upload handler -- the currently-active
 * rocket's own library manifest entry, when it came from the library (not an upload, which the
 * user already has a copy of locally). Only source of a download link for the raw file: this
 * project's own stop-gap for editing (view/verify/tweak the real .rkt in RockSim or a text editor,
 * then re-upload) until in-app editing exists -- also makes this site useful as a place to just
 * find real sim files, independent of running anything here.
 */
let activeLibraryEntry: LibraryManifestEntry | null = null;
/**
 * The parsed shape of the currently-active UPLOADED rocket (null when the active rocket came from
 * the library instead, or nothing's loaded yet) -- set alongside `activeLibraryEntry = null` in
 * wireOrkImport's upload handler, cleared alongside `activeLibraryEntry = entry` in
 * selectLibraryEntry, same mutually-exclusive pairing. Exists purely so saveCurrentConfigToCache
 * (see src/ui/rocket-cache.ts) can cache an upload's already-parsed geometry directly -- there's no
 * stable ID for an uploaded file the way a library entry has one, so the cache holds the small
 * parsed result itself rather than trying to re-identify/re-fetch the original file later.
 */
let lastUploadedParsedRocket: CachedParsedRocket | null = null;
let lastUploadedFileName: string | null = null;
let activeRocketSource = "Loading the rocket library…";
/** Set by applyParsedRocket — the actual motor-fitting diameter (mm), used to pre-fill and constrain the motor search's diameter filter. Real value when available, else the rocket's own reference (outer body) diameter. */
let activeMotorMountDiameterMm: number | null = null;
/**
 * Set by applyParsedRocket from parseRocksimXml's own unsupportedFeatures (empty for .ork/.CDX1
 * uploads, which have no such concept) -- geometry (external pods, tube fins, ring tails, cluster
 * motor mounts, multiple stages) this tool can locate in a file but doesn't model well enough to
 * simulate correctly. Non-empty blocks motor search/flight simulation (see
 * updateMotorSectionAvailability) while still showing the rocket's basic info and CP; the file
 * itself is still viewable/downloadable regardless.
 */
let activeUnsupportedFeatures: string[] = [];

/** The active file's own non-fatal parse warnings (e.g. "multi-stage file, only sustainer imported") -- shown inline once at load time already; also threaded into embed mode's own postMessage payload (AscentResult.parseWarnings) so a splashcast visitor sees the same caveats this UI would show them. Set directly at each applyParsedRocket call site (both already have `parsed.warnings` in scope there for their own inline display), not inside applyParsedRocket itself -- its own parameter type doesn't carry warnings through, and duplicating that plumbing for one assignment isn't worth it. */
let activeParseWarnings: string[] = [];

/**
 * The active file's own last-computed CP, when it has one -- parseRocksimXml's embeddedCpM
 * (RockSim's proprietary extended-method CP, <RockSimXN>) or parseOrkXml's embeddedCpM (OpenRocket's
 * own saved post-rod-exit CP from a saved simulation). Undefined for RASAero uploads (no such field
 * in that format) or any RockSim/OpenRocket file that's never had one computed. Set by
 * applyParsedRocket; only consumed by the CP stat's "Use simfile CP" button (renderCpStat).
 */
let activeEmbeddedCpM: number | undefined;
/**
 * Manual override for the CP stat (renderCpStat) -- undefined means "show the freshly computed
 * value" (this project's own default and, before this override existed, the ONLY value ever shown
 * -- see the cp-method-info panel). Set either by typing a real number directly (pencil icon) or by
 * one-click pulling in activeEmbeddedCpM ("Use simfile CP"); cpOverrideSource distinguishes which,
 * purely for the "(from file)" vs. plain display annotation. Reset on every fresh rocket load.
 *
 * Display-only: unlike activeLoadedCgM, this never feeds into the actual flight simulation --
 * simulateFlight3D always uses its own freshly-computed Barrowman CP internally regardless of what
 * this shows, same as before this override existed. Only the stat card, the stability-margin
 * figure, and the schematic's CP marker read this.
 */
let activeCpOverrideM: number | undefined;
let cpOverrideSource: "manual" | "simfile" | null = null;

/**
 * Recovery devices (drogue/main parachutes, streamers) found in the active file -- only RockSim
 * (.rkt) files carry these (parseRocksimXml's own descentDevices; .ork/RASAero parsers don't
 * extract this yet), so empty for uploads of those formats. Set by applyParsedRocket, read by
 * renderDescentDevicesSection to compute/show each device's descent rate.
 */
let activeDescentDevices: DescentDevice[] = [];

/**
 * Dry (motor-out) mass — what a library/file load actually reports, and
 * what's directly editable (pencil icon on the mass stat card). Loaded mass
 * is never entered directly; once a motor's selected, it's computed as
 * activeDryMassKg + motor.totalMassKg and shown instead, itself editable
 * (editing it just back-solves activeDryMassKg by subtracting the motor's
 * mass again — see the mass-stat-edit wiring).
 *
 * CG stays loaded-primary (activeLoadedCgM below) -- activeRocket.dryCg is
 * always derived from it (never entered directly), same shape as mass.
 * Originally there was no per-file dry CG at all, so activeLoadedCgM always
 * started unset (0), forcing manual entry. RockSim files now carry a real
 * geometry-derived dry CG estimate (parseRocksimXml's estimatedDryCgM, the
 * chicken-and-egg fix -- previously stability could only be checked AFTER
 * measuring a real rocket with a real motor installed, which a still-
 * shopping-for-a-motor user can't do yet) -- see activeEstimatedDryCgM and
 * autoDeriveLoadedCg below for how that seeds activeLoadedCgM without
 * removing the ability to enter a real measured value instead.
 */
let activeDryMassKg = 0.05;
/** The dry mass exactly as loaded from the current file (or the 50g placeholder if the file had none) — never changed by editing, only by loading a new rocket. What the mass stat's reset icon reverts to, and what a motor CHANGE (not just a re-edit) reverts to if the loaded-mass field was the thing last edited (see dryMassOverriddenViaLoadedEdit) — that back-solve is only valid for the motor it was solved against. */
let baseDryMassKg = 0.05;
/** True only when activeDryMassKg's current value came from editing LOADED mass (a motor was selected at edit time, so the entered figure got back-solved into a dry mass entangled with that specific motor's own mass). False after a fresh file load, a direct dry-mass edit (motor-independent — stays valid across motor changes), or a reset. Checked by selectMotor: switching motors while this is true means the back-solved dry mass is stale for the new motor, so it reverts to baseDryMassKg first. */
let dryMassOverriddenViaLoadedEdit = false;
let activeLoadedCgM = 0; // 0 = unset (no estimate AND no manual entry) -- see autoDeriveLoadedCg
/**
 * The active file's own geometry-derived dry CG (parseRocksimXml's estimatedDryCgM) — undefined
 * for RASAero files (a different, non-tree-based parser with no such data) and for RockSim files
 * with unsupportedFeatures (pods/tube fins/ring tails/cluster mounts/multi-stage, where the
 * estimate itself is withheld — see parse.ts). Set by applyParsedRocket, read by
 * autoDeriveLoadedCg; never written anywhere else.
 */
let activeEstimatedDryCgM: number | undefined;
/**
 * True once the user has directly typed a CG value via the pencil-icon edit — from then on,
 * autoDeriveLoadedCg leaves activeLoadedCgM alone (a real measurement always wins over a
 * geometry-derived estimate) until the reset icon or a fresh file load clears it again.
 */
let cgOverriddenByUser = false;

/**
 * State for the "Balance this rocket" nose-weight panel (see renderNoseWeightSection). Kept as one
 * small object (not scattered `let`s) since it's reset together on every rocket load.
 *
 * `addedMassKg`/`massManuallySet`: while `massManuallySet` is false, the panel always shows the
 * FRESHLY auto-solved mass for the current targetMarginCal (recomputed on every render -- moving
 * target as other things change, e.g. editing CG elsewhere). Once the user types directly into the
 * mass field, `massManuallySet` flips true and `addedMassKg` freezes at whatever they entered,
 * surviving re-renders, until they touch targetMarginCal again (which explicitly asks for a fresh
 * auto-solve) or apply/close the panel.
 */
interface NoseWeightUiState {
  targetMarginCal: number;
  addedMassKg: number | null;
  massManuallySet: boolean;
  /** null = use the smart default (see defaultNoseWeightXM); set once the user adjusts the position field. */
  xNoseM: number | null;
}
let noseWeightUi: NoseWeightUiState = { targetMarginCal: LOW_MARGIN_THRESHOLD, addedMassKg: null, massManuallySet: false, xNoseM: null };

/**
 * A motor's actual mass at ignition, per its own mass curve -- NOT motor.totalMassKg (the
 * catalog/spec weight from ThrustCurve.org's metadata). For a real-per-sample-data motor
 * (RockSim/.rse source), the file's own first sample can report slightly less propellant than the
 * spec sheet's rounded propWeightG, so the two aren't always identical. Every rocket-section mass/
 * CG/stability figure below uses THIS (not the spec weight) specifically so it agrees with the
 * flight sim's own combinedMassAt(rocket, massCurve, 0) -- before this existed the two panels
 * could show different stability margins for the same rocket+motor, confirmed for a real case
 * (LOC-IV / AeroTech J435: 1.46 cal in the rocket stats vs. 1.55 cal in the flight sim results).
 * For a derived (non-real-data) mass curve this is exactly motor.totalMassKg anyway --
 * deriveMotorMassCurveFromImpulse's own first point is defined as totalMassKg -- so this is a
 * strict accuracy improvement with no behavior change for the common (RASP-sourced) case.
 */
function motorLoadedMassKg(motor: SelectedMotor): number {
  return getMotorMassAt(deriveMotorMassCurve(motor), 0);
}

/** Everything selectMotor pulls down for one motor, cached in lastMotorSelection and threaded through buildSelectedMotor -- kept as one object (rather than separate meta/samples/realMassBasis parameters) so every call site updates together when a new field's added, and so callers can't accidentally pass a realMassBasis from a DIFFERENT motor selection than the meta/samples it goes with. */
interface MotorSelection {
  meta: MotorSearchResult;
  samples: ThrustSample[];
  /** The winning source file's own header total/propellant weight, when it's a RockSim file with a parseable header -- see downloadThrustSamples/MotorMassBasis's own doc comment. Deliberately NOT used for hybrid motors (see buildSelectedMotor) -- pending a look at whether "propellant mass" means the same thing for a hybrid's separately-tanked oxidizer as it does for a solid motor's single grain. */
  realMassBasis?: MotorMassBasis;
  sourceFormat: string;
  sourceQuality: string;
}

/** Builds a SelectedMotor from ThrustCurve.org search/download data — shared by rederiveDryCg (below) and renderMotorDetailHtml, so both construct the exact same motor object from the same inputs. */
function buildSelectedMotor(selection: MotorSelection): SelectedMotor {
  const { meta, samples, realMassBasis } = selection;
  // Hybrids are out of scope for v1 (see isHybridMotor) -- don't apply the file's-own-header
  // preference to them even when a RockSim source happens to have one, since it's not yet confirmed
  // "propellant mass" in a hybrid's file means the same thing (solid fuel grain only? fuel + the
  // separately-tanked oxidizer?) that it does for a single-grain solid motor. Catalog weight only.
  const massBasis = meta.type === "hybrid" ? undefined : realMassBasis;
  return {
    motorId: meta.motorId,
    designation: meta.designation,
    manufacturer: meta.manufacturer,
    diameter: (meta.diameter ?? 0) / 1000,
    length: (meta.length ?? 0) / 1000,
    totalMassKg: massBasis?.totalMassKg ?? (meta.totalWeightG ?? 0) / 1000,
    propellantMassKg: massBasis?.propellantMassKg ?? (meta.propWeightG ?? 0) / 1000,
    samples,
    delay: 0,
  };
}

/**
 * Whether flight simulation should be blocked for the CURRENT rocket+motor combination -- either
 * reason is sufficient on its own (unsupported rocket geometry, see activeUnsupportedFeatures; or a
 * hybrid motor, see isHybridMotor), and both can independently apply at once. Single source of
 * truth for every runFlightSim call site, so a future third reason only needs adding here once.
 */
function flightSimBlocked(): boolean {
  return activeUnsupportedFeatures.length > 0 || (lastMotorSelection !== null && isHybridMotor(lastMotorSelection.meta));
}

/** Hybrid motors (separately-tanked liquid/gaseous oxidizer + solid fuel grain) are out of scope for v1 -- flagged the same way an unsupported rocket geometry is (see activeUnsupportedFeatures): motor search/detail still works (a user can still want to see one), but flight simulation is blocked. Reason: this app's mass-curve and Isp-consistency logic (deriveMotorMassCurve, motorLoadedMassKg) was built and verified against solid-motor data, where "propellant mass" unambiguously means the one consumable grain -- a hybrid's oxidizer is tanked and loaded separately, drains on its own schedule, and isn't necessarily what a file's own propWt/propellant-remaining curve is even tracking. Revisit once that's actually been checked against real hybrid data, rather than guessing. */
function isHybridMotor(meta: MotorSearchResult): boolean {
  return meta.type === "hybrid";
}

/**
 * Re-derives activeRocket's internal dryCg from the user-entered dry mass,
 * loaded CG, and whichever motor is currently selected (lastMotorSelection),
 * by simple moment conservation: loadedMass*loadedCg = dryMass*dryCg +
 * motorMass*motorCgX, and loadedMass = dryMass + motorMass — dryMass itself
 * is never derived here (it's a direct user input, activeDryMassKg), only
 * dryCg is solved for. Call this whenever dry mass, loaded CG, or the
 * selected motor changes, since all three affect the split.
 */
/**
 * Set by rederiveDryCg whenever the entered dry mass is implausibly small next to the selected
 * motor's own mass -- a real failure mode caught by testing, not hypothetical: dryCg (which
 * divides by dry mass) swings wildly for a near-zero dry mass, silently producing nonsense
 * positions past the rocket's own length with no indication anything was wrong. Shown in the
 * motor detail panel, the one place that's re-rendered exactly when this can change (a motor
 * being selected or dry mass/loaded CG edited).
 */
let loadedMassWarning: string | null = null;

/**
 * Refreshes activeLoadedCgM from the file's own estimatedDryCgM (activeEstimatedDryCgM) and the
 * current motor selection, UNLESS the user has directly entered a CG value (cgOverriddenByUser) --
 * the forward direction of rederiveDryCg's own back-solve below (dry+motor -> loaded), used to
 * seed a real number instead of leaving the CG stat flagged "Not set" whenever the source file
 * provides one. No motor selected yet means loaded==dry (nothing to blend in), matching how the
 * back-solve below already treats activeLoadedCgM as the dry figure directly in that case. Called
 * at the top of rederiveDryCg so every existing call site (file load, motor selection, dry-mass
 * edits) picks this up automatically without each needing to know about it.
 */
function autoDeriveLoadedCg(): void {
  if (cgOverriddenByUser || activeEstimatedDryCgM === undefined) return;
  const motor = lastMotorSelection ? buildSelectedMotor(lastMotorSelection) : null;
  if (!motor) {
    activeLoadedCgM = activeEstimatedDryCgM;
    return;
  }
  const pos = motorAxialPosition({ ...activeRocket, motor });
  if (!pos) {
    activeLoadedCgM = activeEstimatedDryCgM;
    return;
  }
  const motorMassKg = motorLoadedMassKg(motor);
  const loadedMassKg = activeDryMassKg + motorMassKg;
  activeLoadedCgM = (activeDryMassKg * activeEstimatedDryCgM + motorMassKg * pos.cgX) / loadedMassKg;
}

function rederiveDryCg(): void {
  autoDeriveLoadedCg();
  loadedMassWarning = null;
  if (activeLoadedCgM <= 0) {
    activeRocket = { ...activeRocket, dryMass: activeDryMassKg, dryCg: 0 };
    return;
  }
  const motor = lastMotorSelection ? buildSelectedMotor(lastMotorSelection) : null;
  const pos = motor ? motorAxialPosition({ ...activeRocket, motor }) : null;
  if (!motor || !pos) {
    activeRocket = { ...activeRocket, dryMass: activeDryMassKg, dryCg: activeLoadedCgM };
    return;
  }
  // Below zero is nonsensical (a negative dry mass); below ~2% of loaded mass is technically
  // positive but still an unmistakable sign of a units/typo mistake, not a real featherweight
  // airframe -- dryCg divides by dry mass, so either case swings it wildly (verified directly:
  // 13g "dry mass" alongside a 1487g motor produced a derived CG past the rocket's own physical
  // length, with no indication anything was wrong until this check existed).
  const motorMassKg = motorLoadedMassKg(motor);
  const loadedMassKg = activeDryMassKg + motorMassKg;
  const minPlausibleDryMassKg = Math.max(0.02 * loadedMassKg, 0.002);
  if (activeDryMassKg < minPlausibleDryMassKg) {
    loadedMassWarning = `Dry mass (${fmtMass(activeDryMassKg)}) is implausibly small next to the selected motor's own mass (${fmtMass(motorMassKg)}) — check for a units mistake. Derived dry CG will be unreliable until it's fixed.`;
  }
  const dryCg = (loadedMassKg * activeLoadedCgM - motorMassKg * pos.cgX) / activeDryMassKg;
  activeRocket = { ...activeRocket, dryMass: activeDryMassKg, dryCg };
}

/**
 * `infoId`, when given, adds a small click-to-toggle info button next to the
 * label — NOT a hover tooltip (Pico's data-tooltip popup was too small for
 * anything longer than a few words, unusable for real explanatory text).
 * The button only references infoId; the actual expanded content is a
 * separate block the caller renders elsewhere (see renderInfoPanel) — kept
 * apart because the content belongs below the whole stats grid, not crammed
 * into one cramped stat cell.
 */
function stat(label: string, value: string, infoId?: string): string {
  const info = infoId
    ? ` <a href="#" data-info-toggle="${infoId}" aria-expanded="false" aria-controls="${infoId}" aria-label="What does this mean?">ⓘ</a>`
    : "";
  return `<div><strong>${value}</strong><br /><small>${label}${info}</small></div>`;
}

/** The collapsed-by-default content block a stat()'s infoId button reveals — rendered separately, below the stats grid (see this file's wireInfoToggles for the click handling). */
function renderInfoPanel(id: string, title: string, bodyHtml: string): string {
  return `<div id="${id}" class="info-panel" hidden><strong>${title}</strong><p>${bodyHtml}</p></div>`;
}

/**
 * One-time (not per-render) delegated click handler for every `[data-info-toggle]` button —
 * `renderRocketSection`'s whole HTML gets replaced on every re-render (rocket change, unit
 * toggle), so listeners attached directly to its buttons would need re-wiring each time; binding
 * on the stable #app ancestor instead means this only needs to run once at startup.
 */
function wireInfoToggles(): void {
  document.querySelector("#app")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-info-toggle]");
    if (!btn) return;
    e.preventDefault();
    const panel = document.getElementById(btn.dataset["infoToggle"]!);
    if (!panel) return;
    const nowHidden = !panel.hasAttribute("hidden");
    panel.toggleAttribute("hidden", nowHidden);
    btn.setAttribute("aria-expanded", String(!nowHidden));
  });
}

/**
 * Delegated (same #app pattern as wireInfoToggles) click handler for the chart-scrub reset button
 * — needed because touch scrubbing (see wireTouchScrub in flight-chart.ts) deliberately leaves the
 * crosshair/legend readout in place after lifting a finger, rather than auto-clearing like a mouse
 * moving away would; this is the only way to dismiss it on a touch device. Also registers with
 * flight-chart.ts's own scrub-lock tracking (setScrubLockListener) so the button only shows up once
 * there's actually a pinned reading to clear, rather than sitting there unconditionally -- same
 * reset-icon convention as the mass/CG/CP stat cards, not a permanent full-width button.
 */
function wireChartCursorReset(): void {
  document.querySelector("#app")?.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("#chart-cursor-reset")) return;
    clearAllChartCursors();
  });
  setScrubLockListener((locked) => {
    const btn = document.getElementById("chart-cursor-reset");
    if (btn) btn.hidden = !locked;
  });
}

/**
 * idPrefixes whose next commit() should be SKIPPED -- set on mousedown for a `[data-stat-extra]`
 * button (a reset/"use simfile value" button, whose own click handler makes the real state change
 * instead), consumed (deleted) by the very next commit() call for that prefix.
 *
 * Exists because `e.preventDefault()` on that same mousedown -- the textbook fix for "clicking a
 * button shouldn't blur the input first" -- turned out NOT to reliably stop it here: confirmed
 * directly (console tracing a live click) that clicking "Use simfile CP" still fires a focusout on
 * the CP input, but only AFTER that button's own click handler has already run and re-rendered
 * (removing the still-focused old input is what triggers the browser's blur, arriving as a delayed
 * follow-up, not synchronously with the click). The stale DISPLAYED value (the plain computed CP,
 * not any override) would then commit as a bogus "manual" override, silently overwriting the
 * correct one the click handler had just set. A real, reproducible bug this session (reported as
 * "editing CG changed CP" -- misleading, since it's this race during a PRIOR "Use simfile CP" click
 * that actually corrupts activeCpOverrideM; editing CG was simply the next re-render to expose it).
 *
 * Deliberately NOT also cleared inside the stat-extra button's own click handler -- that was the
 * first fix attempted, and it broke this: the delayed stray focusout above arrives AFTER that
 * handler returns, so clearing the flag early left nothing to catch it. Consumption happens
 * exclusively in commit() itself, whenever that delayed focusout actually arrives.
 */
const suppressNextCommit = new Set<string>();

/**
 * Generic delegated wiring (same #app-ancestor pattern as wireInfoToggles) for a pencil-icon
 * inline-edit stat: click `#{idPrefix}-edit-btn` to swap `#{idPrefix}-value` for
 * `#{idPrefix}-input`, commit on blur or Enter. Shared by the mass/CG/CP stat cards below, which
 * differ only in what committing the entered number actually does (mass back-solves against a
 * possibly-selected motor; CG/CP don't) — that's supplied by the caller as onCommit.
 *
 * Any element tagged `[data-stat-extra="{idPrefix}"]` (a reset button, a "use simfile value"
 * button, etc.) is revealed alongside the input on edit-start. Its mousedown both calls
 * preventDefault() (stops the blur when the browser DOES cooperate) AND arms suppressNextCommit
 * (stops the resulting stray commit when it doesn't) -- belt and suspenders, since only the second
 * one turned out to be reliable (see suppressNextCommit's own doc comment).
 */
function wireInlineEditStat(idPrefix: string, onCommit: (rawInputValue: number) => void): void {
  const appEl = document.querySelector("#app");
  if (!appEl) return;

  appEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(`#${idPrefix}-edit-btn`);
    if (!btn) return;
    const valueEl = document.getElementById(`${idPrefix}-value`);
    const inputEl = document.getElementById(`${idPrefix}-input`) as HTMLInputElement | null;
    if (!valueEl || !inputEl) return;
    btn.hidden = true;
    valueEl.hidden = true;
    inputEl.hidden = false;
    document.querySelectorAll<HTMLElement>(`[data-stat-extra="${idPrefix}"]`).forEach((el) => {
      el.hidden = false;
    });
    inputEl.focus();
    inputEl.select();
  });

  appEl.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest(`[data-stat-extra="${idPrefix}"]`)) {
      e.preventDefault();
      suppressNextCommit.add(idPrefix);
    }
  });

  const commit = (): void => {
    if (suppressNextCommit.delete(idPrefix)) return; // a stat-extra button's own click handler is making the real change instead
    const inputEl = document.getElementById(`${idPrefix}-input`) as HTMLInputElement | null;
    if (!inputEl || inputEl.hidden) return; // not in edit mode -- nothing to commit
    onCommit(Number(inputEl.value) || 0);
  };

  // focusout (not blur) so this can live on the delegated #app listener -- blur doesn't bubble.
  appEl.addEventListener("focusout", (e) => {
    if ((e.target as HTMLElement).id === `${idPrefix}-input`) commit();
  });
  appEl.addEventListener("keydown", (e) => {
    const ke = e as KeyboardEvent;
    if ((ke.target as HTMLElement).id === `${idPrefix}-input` && ke.key === "Enter") {
      ke.preventDefault();
      (ke.target as HTMLElement).blur(); // triggers the focusout handler above
    }
  });
}

/**
 * Snapshots the currently-active rocket + motor + manual overrides into localStorage (see
 * src/ui/rocket-cache.ts) -- called after every point that already mutates one of those pieces
 * (a fresh rocket load, a motor pick, or a CG/mass/CP/launch-rod-length edit) so a later embed-mode
 * visit in the same browser can skip straight back to "just rerun with today's weather" instead of
 * redoing the whole setup (see restoreCachedConfigIfEmbedded). A no-op until a rocket's actually
 * loaded (activeRocket.components.length === 0 at startup, before initLibrary/an upload resolves).
 */
function saveCurrentConfigToCache(): void {
  if (activeRocket.components.length === 0) return;

  const rocketSource: CachedRocketConfig["rocketSource"] | null = activeLibraryEntry
    ? { kind: "library", entryId: activeLibraryEntry.id, displayName: activeRocket.name }
    : lastUploadedParsedRocket
      ? { kind: "upload", parsed: lastUploadedParsedRocket, fileName: lastUploadedFileName ?? "uploaded file", displayName: activeRocket.name }
      : null;
  if (!rocketSource) return; // nothing identifiable to cache yet (shouldn't happen once components.length > 0, but no source to replay is no source to save)

  saveCachedConfig({
    version: 1,
    savedAt: new Date().toISOString(),
    rocketSource,
    overrides: {
      dryMassKg: activeDryMassKg,
      cgM: activeLoadedCgM,
      cgOverriddenByUser,
      cpOverrideM: activeCpOverrideM,
      cpOverrideSource,
      launchRodLengthM: activeLaunchRodLengthM,
    },
    motor: lastMotorSelection
      ? {
          motorId: lastMotorSelection.meta.motorId,
          meta: lastMotorSelection.meta,
          samples: lastMotorSelection.samples,
          realMassBasis: lastMotorSelection.realMassBasis,
          sourceFormat: lastMotorSelection.sourceFormat,
          sourceQuality: lastMotorSelection.sourceQuality,
        }
      : null,
  });
}

/** Re-renders everything downstream of a dry-mass change: the stats card, the motor table's T:W column, and (if a motor's selected) the motor detail panel + flight sim. Shared by the mass stat's commit and its reset. */
function afterDryMassChanged(): void {
  rederiveDryCg();
  renderActiveRocketDisplay();
  // The motor search table's T:W column is computed against activeDryMassKg (see
  // computeThrustToWeight) -- refresh it too, or it'd keep flagging ratios against the stale
  // pre-edit mass.
  renderAndWireResults();
  if (lastMotorSelection) {
    const rocketWithMotor = renderMotorDetailAndMountChart(lastMotorSelection.meta, lastMotorSelection.samples);
    // Motor search/detail stays available for unsupported-geometry rockets (a user can still want
    // to know what a motor looks like -- thrust curve, mass, real ThrustCurve.org data, none of
    // which depends on the rocket it'd be attached to) -- only the actual flight simulation is
    // gated, since that's the part this project's aero model can't trust for that geometry (see
    // activeUnsupportedFeatures' own doc comment).
    if (rocketWithMotor && !flightSimBlocked()) void runFlightSim(rocketWithMotor);
  }
  saveCurrentConfigToCache();
}

/**
 * Wires the mass stat card's pencil-icon edit (writes back to activeDryMassKg — if a motor's
 * selected, the entered figure is understood as LOADED mass, matching what's displayed, and the
 * motor's own mass is subtracted back out before storing) plus its reset icon, which discards any
 * edit and reverts to baseDryMassKg (the dry mass exactly as loaded from the file).
 */
function wireMassStatEdit(): void {
  wireInlineEditStat("mass-stat", (rawInputValue) => {
    const enteredKg = massFromInput(rawInputValue);
    const motor = lastMotorSelection ? buildSelectedMotor(lastMotorSelection) : null;
    activeDryMassKg = Math.max(motor ? enteredKg - motorLoadedMassKg(motor) : enteredKg, 0);
    // Only a LOADED-mass edit (motor selected at edit time) is motor-entangled -- a direct
    // dry-mass edit stays valid no matter what motor gets picked next.
    dryMassOverriddenViaLoadedEdit = motor !== null;
    afterDryMassChanged();
  });

  document.querySelector("#app")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("#mass-stat-reset-btn");
    if (!btn) return;
    activeDryMassKg = baseDryMassKg;
    dryMassOverriddenViaLoadedEdit = false;
    afterDryMassChanged();
  });
}

/**
 * Dry mass (no motor selected) or loaded mass (dry + selected motor) — same editable stat card
 * either way, just relabeled/recomputed depending on whether a motor's known. Editing it always
 * writes back to activeDryMassKg (see wireMassStatEdit), subtracting the motor's mass back out
 * first if one's selected — so the user only ever has one number to think about at a time: "how
 * much does this weigh right now," whether that's the bare airframe or the thing on the pad. The
 * reset icon (only shown while editing) discards the edit and goes back to the file's dry mass.
 */
function renderMassStat(rocket: Rocket): string {
  const motor = lastMotorSelection ? buildSelectedMotor(lastMotorSelection) : null;
  const label = motor ? "Loaded mass" : "Dry mass";
  const displayKg = motor ? rocket.dryMass + motorLoadedMassKg(motor) : rocket.dryMass;
  return `
    <div>
      <strong
        ><span id="mass-stat-value">${fmtMass(displayKg)}</span
        ><button type="button" id="mass-stat-edit-btn" class="edit-pencil" aria-label="Edit ${label.toLowerCase()}">✏️</button
        ><input type="number" inputmode="decimal" id="mass-stat-input" class="inline-edit-stat-input" value="${massToInput(displayKg).toFixed(2)}" min="0" step="1" hidden
        /><button type="button" id="mass-stat-reset-btn" data-stat-extra="mass-stat" class="edit-pencil" aria-label="Reset to the file's dry mass" title="Reset to ${fmtMass(baseDryMassKg)} (this file's dry mass)" hidden>↺</button
      ></strong>
      <br /><small id="mass-stat-label">${label}</small>
    </div>
  `;
}

/**
 * Dry CG (no motor selected) or loaded CG (dry + selected motor's own mass/position, same
 * moment-conservation blend rederiveDryCg uses in reverse) — mirrors renderMassStat's dry/loaded
 * duality exactly. Auto-filled from the file's own geometry-derived estimate
 * (activeEstimatedDryCgM, via autoDeriveLoadedCg) when available and not yet overridden --
 * RockSim files with supported geometry only; RASAero files and unsupported-geometry RockSim files
 * have no such estimate and keep the original manual-entry-required behavior (flagged with <mark>,
 * this project's one number that genuinely has no computed fallback in that case).
 *
 * Exactly three states, each with its own small icon (title-attribute tooltip, not inline text --
 * keeps the compact stat card from wrapping): 🧮 CALCULATED (activeEstimatedDryCgM, summed from
 * this file's own per-part mass/position data by this project's OWN parser -- genuinely computed,
 * not literally read from a stored CG tag the way CP's own "(from file)" override is, which is why
 * this uses a different icon/word than CP's; see collectMassBreakdown in rocksim/parse.ts), 📏
 * OVERRIDDEN (cgOverriddenByUser -- a real measured/preferred value, entered via the pencil icon),
 * and <mark>Not set</mark> (neither -- no estimate available and nothing entered yet). There's no
 * fourth state: activeLoadedCgM is only ever nonzero via one of the first two paths (see
 * autoDeriveLoadedCg/rederiveDryCg).
 */
function renderCgStat(): string {
  const motor = lastMotorSelection ? buildSelectedMotor(lastMotorSelection) : null;
  const label = motor ? "Loaded CG" : "Dry CG";
  const hasCg = activeLoadedCgM > 0;
  const isEstimate = hasCg && !cgOverriddenByUser && activeEstimatedDryCgM !== undefined;
  const stateIcon = !hasCg
    ? ""
    : isEstimate
      ? ` <span title="Calculated from this file's own per-part mass/position data" aria-label="Calculated from file">🧮</span>`
      : ` <span title="Manually entered / measured" aria-label="Manually entered">📏</span>`;
  const valueHtml = hasCg ? `${fmtLength(activeLoadedCgM)}${stateIcon}` : `<mark>Not set — measure &amp; enter</mark>`;
  return `
    <div>
      <strong
        ><span id="cg-stat-value">${valueHtml}</span
        ><button type="button" id="cg-stat-edit-btn" class="edit-pencil" aria-label="Edit ${label.toLowerCase()}">✏️</button
        ><input type="number" inputmode="decimal" id="cg-stat-input" class="inline-edit-stat-input" value="${hasCg ? lengthToInput(activeLoadedCgM).toFixed(2) : ""}" placeholder="${lengthInputUnitLabel()}" min="0" step="0.1" hidden
        /><button type="button" id="cg-stat-reset-btn" data-stat-extra="cg-stat" class="edit-pencil" aria-label="Reset to the file's estimated CG" title="${activeEstimatedDryCgM !== undefined ? "Reset to this file's geometry-derived estimate" : "Clear"}" hidden>↺</button
      ></strong>
      <br /><small id="cg-stat-label">${label} (from nose)</small>
    </div>
  `;
}

/** Wires the CG stat card's pencil-icon edit — a direct, manual entry (dry CG if no motor's selected, loaded CG if one is, same convention as the mass stat's own edit) that always wins over any file-derived estimate (see cgOverriddenByUser). The reset icon discards the override and goes back to autoDeriveLoadedCg's own estimate (or to "Not set" if the file has none). */
function wireCgStatEdit(): void {
  wireInlineEditStat("cg-stat", (rawInputValue) => {
    activeLoadedCgM = lengthFromInput(rawInputValue);
    cgOverriddenByUser = true;
    rederiveDryCg();
    renderActiveRocketDisplay();
    if (lastMotorSelection) {
      const rocketWithMotor = renderMotorDetailAndMountChart(lastMotorSelection.meta, lastMotorSelection.samples);
      // Motor search/detail stays available for unsupported-geometry rockets (a user can still want
    // to know what a motor looks like -- thrust curve, mass, real ThrustCurve.org data, none of
    // which depends on the rocket it'd be attached to) -- only the actual flight simulation is
    // gated, since that's the part this project's aero model can't trust for that geometry (see
    // activeUnsupportedFeatures' own doc comment).
    if (rocketWithMotor && !flightSimBlocked()) void runFlightSim(rocketWithMotor);
    }
    saveCurrentConfigToCache();
  });

  document.querySelector("#app")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("#cg-stat-reset-btn");
    if (!btn) return;
    cgOverriddenByUser = false;
    activeLoadedCgM = activeEstimatedDryCgM ?? 0;
    rederiveDryCg();
    renderActiveRocketDisplay();
    if (lastMotorSelection) {
      const rocketWithMotor = renderMotorDetailAndMountChart(lastMotorSelection.meta, lastMotorSelection.samples);
      // Motor search/detail stays available for unsupported-geometry rockets (a user can still want
    // to know what a motor looks like -- thrust curve, mass, real ThrustCurve.org data, none of
    // which depends on the rocket it'd be attached to) -- only the actual flight simulation is
    // gated, since that's the part this project's aero model can't trust for that geometry (see
    // activeUnsupportedFeatures' own doc comment).
    if (rocketWithMotor && !flightSimBlocked()) void runFlightSim(rocketWithMotor);
    }
    saveCurrentConfigToCache();
  });
}

/**
 * CP -- always independently computed by default (computeBarrowman, `computedCpM`; never read from
 * the source file, see the cp-method-info panel), but overridable: a real measured/preferred value
 * via the pencil icon, or the source file's own last-computed CP pulled in with one click ("Use
 * simfile CP" -- shown only when activeEmbeddedCpM is available: RockSim's proprietary
 * extended-method CP for .rkt, OpenRocket's own saved post-rod-exit CP for .ork; undefined for
 * RASAero uploads or a file that's never had one computed). The reset icon (shown once overridden,
 * either way) discards the override and goes back to the always-available computed value.
 */
function renderCpStat(computedCpM: number): string {
  const displayCpM = activeCpOverrideM ?? computedCpM;
  const sourceNote = cpOverrideSource === "simfile" ? ` <small>(from file)</small>` : "";
  const info = ` <a href="#" data-info-toggle="cp-method-info" aria-expanded="false" aria-controls="cp-method-info" aria-label="What does this mean?">ⓘ</a>`;
  return `
    <div>
      <strong
        ><span id="cp-stat-value">${fmtLength(displayCpM)}${sourceNote}</span
        ><button type="button" id="cp-stat-edit-btn" class="edit-pencil" aria-label="Edit CP">✏️</button
        ><input type="number" inputmode="decimal" id="cp-stat-input" class="inline-edit-stat-input" value="${lengthToInput(displayCpM).toFixed(2)}" placeholder="${lengthInputUnitLabel()}" min="0" step="0.1" hidden
        /><button type="button" id="cp-stat-reset-btn" data-stat-extra="cp-stat" class="edit-pencil" aria-label="Reset to the computed CP" title="Reset to ${fmtLength(computedCpM)} (this project's own computed CP)" hidden>↺</button>${
          activeEmbeddedCpM !== undefined
            ? `<button type="button" id="cp-stat-simfile-btn" data-stat-extra="cp-stat" class="edit-pencil" aria-label="Use the file's own CP" title="Use this file's own last-computed CP (${fmtLength(activeEmbeddedCpM)})" hidden>📄</button>`
            : ""
        }</strong>
      <br /><small id="cp-stat-label">Computed CP${info}</small>
    </div>
  `;
}

/**
 * Wires the CP stat card's pencil-icon edit (a direct, always-display-only manual entry -- see
 * activeCpOverrideM's own doc comment) plus its reset icon (discards the override, back to the
 * freshly computed value) and, when the active file has one, its "Use simfile CP" button (pulls in
 * activeEmbeddedCpM directly, one click, no typing).
 */
function wireCpStatEdit(): void {
  wireInlineEditStat("cp-stat", (rawInputValue) => {
    activeCpOverrideM = lengthFromInput(rawInputValue);
    cpOverrideSource = "manual";
    renderActiveRocketDisplay();
    saveCurrentConfigToCache();
  });

  document.querySelector("#app")?.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("#cp-stat-reset-btn")) return;
    activeCpOverrideM = undefined;
    cpOverrideSource = null;
    renderActiveRocketDisplay();
    saveCurrentConfigToCache();
  });

  document.querySelector("#app")?.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("#cp-stat-simfile-btn") || activeEmbeddedCpM === undefined) return;
    activeCpOverrideM = activeEmbeddedCpM;
    cpOverrideSource = "simfile";
    renderActiveRocketDisplay();
    saveCurrentConfigToCache();
  });
}

const NOSE_WEIGHT_PANEL_ID = "nose-weight-panel";
// Forward enough of the nose cone's own length for near-maximal leverage (minimal mass needed),
// but not the literal zero-volume tip, which most real nose cones can't hold ballast at. Always
// user-adjustable via the panel's own position field.
const DEFAULT_NOSE_WEIGHT_FRACTION = 0.2;

function noseConeLengthM(rocket: Rocket): number {
  const nose = rocket.components[0];
  return nose && nose.type === "nosecone" ? nose.length : 0;
}

function defaultNoseWeightXM(rocket: Rocket): number {
  const length = noseConeLengthM(rocket);
  return length > 0 ? length * DEFAULT_NOSE_WEIGHT_FRACTION : 0;
}

/**
 * "Balance this rocket" -- lets a user add nose weight to hit a target stability margin, either by
 * auto-solving the mass needed (editing the target margin) or by entering a specific real weight
 * and seeing what margin it actually achieves (editing the mass field directly -- see
 * NoseWeightUiState's own doc comment for how the two interact). Rendered right after the stats
 * grid, not inside it (see renderRocketSection) -- it reads as a tool acting ON the numbers above,
 * not one more number among them.
 *
 * When the CURRENT margin is already negative (unflyable), this renders already expanded and
 * flagged in the same red-banner style as the flight-sim "NOT FLYABLE" warning (checkStability) --
 * the point of surfacing it here is so a user hitting a negative margin sees the fix in the same
 * glance, not a second click away.
 */
function renderNoseWeightSection(rocket: Rocket, cpX: number, refDiameter: number, currentMarginCal: number): string {
  const motor = lastMotorSelection ? buildSelectedMotor(lastMotorSelection) : null;
  const motorPos = motor ? motorAxialPosition({ ...rocket, motor }) : null;
  const motorMassKg = motor ? motorLoadedMassKg(motor) : 0;
  const motorCgXM = motorPos?.cgX ?? 0;

  const xNoseM = noseWeightUi.xNoseM ?? defaultNoseWeightXM(rocket);
  const noseLengthM = noseConeLengthM(rocket);

  const solved = solveNoseWeight(cpX, refDiameter, rocket.dryMass, rocket.dryCg, motorMassKg, motorCgXM, noseWeightUi.targetMarginCal, xNoseM);
  const effectiveAddedMassKg = noseWeightUi.massManuallySet
    ? (noseWeightUi.addedMassKg ?? 0)
    : Number.isFinite(solved.addedMassKg)
      ? solved.addedMassKg
      : 0;
  const preview = previewNoseWeight(cpX, refDiameter, rocket.dryMass, rocket.dryCg, motorMassKg, motorCgXM, effectiveAddedMassKg, xNoseM);

  const unstable = currentMarginCal < 0;

  const toggleHtml = unstable
    ? `<p style="padding: 0.75rem; border-radius: var(--pico-border-radius); background: var(--pico-del-color, #c0392b);">
        <a href="#" data-info-toggle="${NOSE_WEIGHT_PANEL_ID}" aria-expanded="true" aria-controls="${NOSE_WEIGHT_PANEL_ID}" style="color: white; font-weight: bold;">
          ⚠ Unstable (CG is ${Math.abs(currentMarginCal).toFixed(2)} cal aft of CP) — ⚖ Balance this rocket
        </a>
      </p>`
    : `<p><a href="#" data-info-toggle="${NOSE_WEIGHT_PANEL_ID}" aria-expanded="false" aria-controls="${NOSE_WEIGHT_PANEL_ID}">⚖ Add nose weight to adjust stability margin</a></p>`;

  const massUnit = massInputUnitLabel();
  const lengthUnit = lengthInputUnitLabel();

  const feasibilityWarning = !solved.feasible
    ? `<p><mark>This position is too far aft to ever reach ${noseWeightUi.targetMarginCal.toFixed(2)} cal — move the weight further forward.</mark></p>`
    : "";

  return `
    ${toggleHtml}
    <div id="${NOSE_WEIGHT_PANEL_ID}" class="info-panel" ${unstable ? "" : "hidden"}>
      <strong>Balance this rocket</strong>
      <p>
        Adds a point mass near the nose to move the loaded (liftoff) CG forward. Since CP doesn't
        depend on mass, this solves directly for the mass needed — no trial and error.
      </p>
      <div class="grid">
        <label>Target margin (cal)
          <input type="number" inputmode="decimal" id="nose-weight-target-input" min="0" step="0.1" value="${noseWeightUi.targetMarginCal.toFixed(2)}" />
        </label>
        <label>Weight position (${lengthUnit} from nose tip)
          <input type="number" inputmode="decimal" id="nose-weight-position-input" min="0" max="${lengthToInput(noseLengthM).toFixed(2)}" step="0.1" value="${lengthToInput(xNoseM).toFixed(2)}" />
        </label>
        <label>Added mass (${massUnit})
          <input type="number" inputmode="decimal" id="nose-weight-mass-input" min="0" step="0.1" value="${massToInput(effectiveAddedMassKg).toFixed(2)}" />
        </label>
      </div>
      ${feasibilityWarning}
      <p>
        <strong>Resulting margin: <span style="color: ${preview.newMarginCal > 0 ? "var(--pico-ins-color, #2a8f4d)" : "var(--pico-del-color, #c0392b)"};">${preview.newMarginCal.toFixed(2)} cal</span></strong>
        ${!noseWeightUi.massManuallySet && solved.feasible ? ` <small>(auto-solved for ${noseWeightUi.targetMarginCal.toFixed(2)} cal target)</small>` : ""}
      </p>
      <button type="button" id="nose-weight-apply-btn" ${effectiveAddedMassKg > 0 ? "" : "disabled"}>
        Apply — add ${fmtMass(effectiveAddedMassKg)} at ${fmtLength(xNoseM)} from the nose tip
      </button>
    </div>
  `;
}

/**
 * Delegated (same #app pattern as wireInfoToggles) input/click handling for the nose-weight
 * panel's three fields and its Apply button. `input` (not `change`) so the "Resulting margin"
 * readout updates live as the user types, matching every other live-computed figure in this app.
 */
function wireNoseWeightPanel(): void {
  const appEl = document.querySelector("#app");
  if (!appEl) return;

  appEl.addEventListener("input", (e) => {
    const target = e.target as HTMLElement;
    if (target.id === "nose-weight-target-input") {
      noseWeightUi.targetMarginCal = Number((target as HTMLInputElement).value) || 0;
      noseWeightUi.massManuallySet = false; // an explicit ask for a fresh auto-solve
      renderActiveRocketDisplay();
    } else if (target.id === "nose-weight-position-input") {
      noseWeightUi.xNoseM = Math.max(0, lengthFromInput(Number((target as HTMLInputElement).value) || 0));
      renderActiveRocketDisplay();
    } else if (target.id === "nose-weight-mass-input") {
      noseWeightUi.addedMassKg = Math.max(0, massFromInput(Number((target as HTMLInputElement).value) || 0));
      noseWeightUi.massManuallySet = true;
      renderActiveRocketDisplay();
    }
  });

  appEl.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("#nose-weight-apply-btn")) return;

    const motor = lastMotorSelection ? buildSelectedMotor(lastMotorSelection) : null;
    const motorPos = motor ? motorAxialPosition({ ...activeRocket, motor }) : null;
    const motorMassKg = motor ? motorLoadedMassKg(motor) : 0;
    const motorCgXM = motorPos?.cgX ?? 0;
    const { cpX, refDiameter } = computeBarrowman(activeRocket.components, 0.1);
    const displayCpX = activeCpOverrideM ?? cpX;

    const xNoseM = noseWeightUi.xNoseM ?? defaultNoseWeightXM(activeRocket);
    const solved = solveNoseWeight(displayCpX, refDiameter, activeRocket.dryMass, activeRocket.dryCg, motorMassKg, motorCgXM, noseWeightUi.targetMarginCal, xNoseM);
    const effectiveAddedMassKg = noseWeightUi.massManuallySet
      ? (noseWeightUi.addedMassKg ?? 0)
      : Number.isFinite(solved.addedMassKg)
        ? solved.addedMassKg
        : 0;
    if (effectiveAddedMassKg <= 0) return;

    const preview = previewNoseWeight(displayCpX, refDiameter, activeRocket.dryMass, activeRocket.dryCg, motorMassKg, motorCgXM, effectiveAddedMassKg, xNoseM);

    activeDryMassKg += effectiveAddedMassKg;
    activeLoadedCgM = displayCpX - preview.newMarginCal * refDiameter;
    cgOverriddenByUser = true;
    noseWeightUi = { targetMarginCal: noseWeightUi.targetMarginCal, addedMassKg: null, massManuallySet: false, xNoseM: null };
    afterDryMassChanged();
  });
}

function renderRocketSection(rocket: Rocket, mach: number, subtitle: string): string {
  const { cpX, refDiameter } = computeBarrowman(rocket.components, mach);
  // The displayed/stability-relevant CP: a user override (manual entry or "Use simfile CP") when
  // set, else the freshly computed value -- see activeCpOverrideM's own doc comment for why this
  // never reaches the actual flight sim, only this display/margin/schematic path.
  const displayCpX = activeCpOverrideM ?? cpX;
  // Loaded CG, exactly as entered -- not rocket.dryCg, which is a derived, internal-only quantity
  // (see rederiveDryCg) meant for the mass-curve/flight-sim machinery, not display. A stability
  // check against the loaded configuration is also the more meaningful one here: it's the
  // configuration that actually flies, not a hypothetical motor-less one.
  const hasCg = activeLoadedCgM > 0;
  const margin = hasCg ? stabilityMargin(displayCpX, activeLoadedCgM, refDiameter) : null;

  // Schematic motor shading -- foreX/aftX already account for motorOverhang (an HP motor's thrust
  // ring protruding past the mount's own aft end), so no separate handling needed here.
  const schematicMotor = lastMotorSelection ? buildSelectedMotor(lastMotorSelection) : null;
  const schematicMotorPos = schematicMotor ? motorAxialPosition({ ...rocket, motor: schematicMotor }) : null;
  const schematicMotorInfo =
    schematicMotor && schematicMotorPos
      ? { foreX: schematicMotorPos.foreX, aftX: schematicMotorPos.aftX, radius: schematicMotor.diameter / 2 }
      : undefined;

  const stats = [
    stat("Length", fmtRocketLength(overallLength(rocket.components))),
    renderMassStat(rocket),
    renderCpStat(cpX),
    renderCgStat(),
    stat("Ref. diameter", fmtLength(refDiameter)),
    // Always mm, not run through fmtLength's cm/in toggle -- same reasoning as the motor search's
    // own mount-diameter note and its Diameter column: this is the number that determines what
    // motor physically fits, and mm is how motor case sizes are actually named/discussed (a "38mm"
    // motor), not a value anyone thinks of in cm or inches.
    activeMotorMountDiameterMm !== null ? stat("Motor mount", `${activeMotorMountDiameterMm.toFixed(1)}mm`) : "",
    margin !== null
      ? stat(
          "Stability margin",
          `<span style="color: ${margin > 0 ? "var(--pico-ins-color, #2a8f4d)" : "var(--pico-del-color, #c0392b)"};">${margin.toFixed(2)} cal (${margin > 0 ? "stable" : "unstable"})</span>`,
        )
      : "",
  ]
    .filter(Boolean)
    .join("");

  return `
    <article>
      <header>
        <h2>${rocket.name}</h2>
        <p>${subtitle} · static Barrowman results at Mach ${mach}${hasCg ? "" : " — loaded mass/CG not entered, so no stability margin is shown"}</p>
        ${
          activeLibraryEntry
            ? `<p><a href="${activeLibraryEntry.path}" download="${activeLibraryEntry.path.split("/").pop()}">⭳ Download Simfile</a> — browser editing not supported. You'll need to edit and re-upload the file.</p>`
            : ""
        }
      </header>
      ${
        activeUnsupportedFeatures.length > 0
          ? `<p><mark>Not currently supported: ${activeUnsupportedFeatures.join(", ")}. Flight simulation is disabled for this rocket — CP above is still computed from its geometry, motor search still works, and the original file is still viewable/downloadable above.</mark></p>`
          : ""
      }
      <div class="grid stats-grid">${stats}</div>
      ${margin !== null ? renderNoseWeightSection(rocket, displayCpX, refDiameter, margin) : ""}
      ${renderInfoPanel(
        "cp-method-info",
        "How Computed CP is calculated",
        `Computed by default independently from this rocket's geometry — never read from the source file (.ork/.rkt/.CDX1), regardless of format. Method: classical Barrowman component buildup (nose/transition/tube + fin CNa/CP), a corrected fin-body interference factor, the Galejs body-lift term, and OpenRocket's own transonic/supersonic fin CNa1 and CP-shift models (valid to Mach 5). Overridable (pencil icon) with a real measured/preferred value, or with the source file's own last-computed CP in one click ("Use simfile CP", shown only when the file has one) -- RockSim's proprietary extended-method CP for .rkt, OpenRocket's own saved post-rod-exit CP for .ork.`,
      )}
      <figure class="schematic">
        ${renderSchematicSvg(rocket.components, displayCpX, hasCg ? activeLoadedCgM : undefined, schematicMotorInfo)}
      </figure>
      ${renderDescentDevicesSection()}
    </article>
  `;
}

const STANDARD_GRAVITY_MS2 = 9.80665; // matches isa-model.ts's own G0

/**
 * Drogue/main descent rate for each recovery device found in the file (parseRocksimXml's own
 * descentDevices -- RockSim only, see activeDescentDevices' own doc comment), via the standard
 * terminal-velocity equation v = sqrt(2*m*g / (rho*Cd*A)). Requires a motor to be selected: the
 * descending mass is the rocket's dry mass PLUS the spent motor casing (loaded mass minus
 * propellant, since the propellant itself is long gone by the time a chute opens) -- not just dry
 * mass, which would leave the spent casing's real weight out and understate the rate, and not full
 * loaded mass either, which would still be carrying propellant that's already burned by then.
 *
 * Air density is looked up at activeRocket.launchAltitude (site elevation MSL, the same field the
 * real ascent simulation already uses -- see engine3d.ts/derivatives.ts), NOT a hardcoded sea-level
 * constant -- a higher site means thinner air, means a REAL descent rate faster than a sea-level
 * calc would predict. There's no UI to set launchAltitude yet (it's always 0 today; splashcast
 * import parses a real site_elev_ft but isn't wired into the live app -- see
 * splashcast-import.ts/wireWindImport's own TODO), so this is currently equivalent to sea level in
 * practice, but reads the correct field so it's already right the moment site elevation lands, with
 * nothing further to fix here. Deployment-altitude-specific density (drogue near apogee vs. main
 * much lower) is a further refinement this doesn't attempt.
 *
 * Requested specifically so these numbers can be handed to splashcast (the external launch-day
 * wind/drift predictor this project's own wind import already reads FROM -- see
 * splashcast-import.ts), which needs a descent rate per device to predict drift, not just canopy
 * area/CD.
 */
function renderDescentDevicesSection(): string {
  if (activeDescentDevices.length === 0) return "";
  const motor = lastMotorSelection ? buildSelectedMotor(lastMotorSelection) : null;
  const descentMassKg = motor ? activeDryMassKg + (motor.totalMassKg - motor.propellantMassKg) : null;
  const airDensityKgM3 = new IsaAtmosphere().at(activeRocket.launchAltitude).density;

  const rows = activeDescentDevices
    .map((d) => {
      const rate =
        descentMassKg !== null
          ? Math.sqrt((2 * descentMassKg * STANDARD_GRAVITY_MS2) / (airDensityKgM3 * d.dragCoefficient * d.dragAreaM2))
          : null;
      const label = `${d.role === "drogue" ? "Drogue" : "Main"} ${d.type}`;
      return `<tr><td>${label}</td><td>${d.dragAreaM2.toFixed(3)} m²</td><td>${d.dragCoefficient.toFixed(2)}</td><td>${rate !== null ? fmtVelocity(rate) : "—"}</td></tr>`;
    })
    .join("");

  return `
    <details>
      <summary>Recovery devices (${activeDescentDevices.length}, descent rate at launch-site air density)</summary>
      <figure>
        <table>
          <thead><tr><th>Device</th><th>Drag area</th><th>Drag coefficient</th><th>Descent rate</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </figure>
      ${
        descentMassKg === null
          ? `<p><small>Select a motor to see descent rates. Spent motor mass affects the calculation.</small></p>`
          : ""
      }
    </details>
  `;
}

// --- Search filter defaults + URL param sync ---
// Filters are reflected in the URL only when they differ from these
// defaults, so a plain visit to the page keeps a clean URL, but changing any
// filter (or loading a URL someone shared) makes the state shareable/bookmarkable.
const FILTER_DEFAULTS = {
  manufacturer: "AeroTech",
  diameter: "",
  type: "",
  impulseClass: "",
  commonName: "",
} as const;

type FilterKey = keyof typeof FILTER_DEFAULTS;

const FILTER_ELEMENT_IDS: Record<FilterKey, string> = {
  manufacturer: "motor-mfg",
  diameter: "motor-diameter",
  type: "motor-type",
  impulseClass: "motor-impulse-class",
  commonName: "motor-common-name",
};

function filterElement(key: FilterKey): HTMLInputElement | HTMLSelectElement | null {
  return document.getElementById(FILTER_ELEMENT_IDS[key]) as HTMLInputElement | HTMLSelectElement | null;
}

function urlFilterValue(key: FilterKey): string {
  return new URLSearchParams(location.search).get(key) ?? FILTER_DEFAULTS[key];
}

/** Rewrites the URL query string via replaceState (so it doesn't spam browser history) — takes a callback rather than a full params object so callers only touch the keys they own, leaving everything else (e.g. the "rocket" param set by syncSelectedRocketToUrl) untouched. */
function updateUrlParams(mutate: (params: URLSearchParams) => void): void {
  const params = new URLSearchParams(location.search);
  mutate(params);
  const query = params.toString();
  history.replaceState(null, "", query ? `${location.pathname}?${query}` : location.pathname);
}

/** Writes current filter values into the URL query string, omitting anything still at its default. Only ever touches its own FILTER_DEFAULTS keys (via updateUrlParams) -- rebuilding the whole query string from scratch here would silently drop the unrelated "rocket" param. */
function syncFormToUrl(): void {
  updateUrlParams((params) => {
    for (const key of Object.keys(FILTER_DEFAULTS) as FilterKey[]) {
      const value = filterElement(key)?.value.trim() ?? "";
      if (value && value !== FILTER_DEFAULTS[key]) params.set(key, value);
      else params.delete(key);
    }
  });
}

/**
 * Human-scannable id for a library entry, used as the "rocket" URL param — vendor + name,
 * lowercased with runs of non-alphanumerics collapsed to a single "-" (e.g. "LOC" + "Big Nuke 3E"
 * -> "loc-big-nuke-3e"). Only a-z0-9- ever appears in the result, so it never needs
 * percent-encoding in a query string (unlike the manifest path, which contains "/" and spaces --
 * URLSearchParams renders those as %2F and + on write, exactly the "ugly, can't scan it" URL this
 * replaces). Not the manifest path itself: ids are assigned sequentially at manifest-generation
 * time and shift whenever the library's entry count changes, so path was already the right stable
 * choice to key off of -- this just encodes it
 * more readably, resolved back to a real entry by matching this same slug (see
 * findLibraryEntryBySlug) rather than by decoding it back into a literal path.
 */
function slugifyLibraryEntry(entry: LibraryManifestEntry): string {
  const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slugify(entry.vendor)}-${slugify(entry.name)}`;
}

/** Resolves a "rocket" URL param back to a manifest entry by matching slugifyLibraryEntry -- the inverse of that function, not a path decode (see its doc comment for why). */
function findLibraryEntryBySlug(manifest: LibraryManifestEntry[], slug: string): LibraryManifestEntry | undefined {
  return manifest.find((e) => slugifyLibraryEntry(e) === slug);
}

/** Writes the selected library rocket's slug (see slugifyLibraryEntry) into the URL's "rocket" param, so the exact rocket (not the vendor/diameter/name search filters used to find it) is shareable/bookmarkable and re-selected on load — see initLibrary. */
function syncSelectedRocketToUrl(entry: LibraryManifestEntry): void {
  updateUrlParams((params) => params.set("rocket", slugifyLibraryEntry(entry)));
}

const motorSectionHtml = `
  <article>
    <header>
      <h2>Motor data <small>(ThrustCurve.org)</small></h2>
      <p>
        Search <a href="https://www.thrustcurve.org" target="_blank" rel="noopener">ThrustCurve.org</a> live from the
        browser — no backend, CORS is open on their API — and attach a real motor to your rocket above
        (the library selection by default, or whatever you imported).
        Shows its thrust curve and its mass curve -- the real per-sample propellant mass when the motor's own
        source file has one (RockSim/.rse files do), otherwise derived from total/propellant weight
        assuming mass loss is proportional to cumulative thrust impulse -- and the combined rocket
        mass/CG at ignition, mid-burn, and burnout.
      </p>
    </header>
    <div id="motor-section-unsupported-notice" hidden></div>
    <form id="motor-search-form">
      <div class="grid">
        <label>Manufacturer
          <select id="motor-mfg" aria-busy="true"><option value="">Loading…</option></select>
        </label>
        <label>Diameter (mm)
          <select id="motor-diameter" aria-busy="true"><option value="">Loading…</option></select>
        </label>
        <label>Type
          <select id="motor-type" aria-busy="true"><option value="">Loading…</option></select>
        </label>
        <label>Impulse class
          <select id="motor-impulse-class" aria-busy="true"><option value="">Loading…</option></select>
        </label>
        <label>Common name
          <input id="motor-common-name" type="text" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${urlFilterValue("commonName")}" placeholder="e.g. C6, K400" />
        </label>
      </div>
      <p id="motor-mount-note"><small></small></p>
      <label>
        <input type="checkbox" id="motor-adapter-checkbox" />
        Use motor adapter — allow smaller motors too (e.g. a 75mm mount can adapt down to 54 or 38mm)
      </label>
      <button type="submit">Search</button>
    </form>
    <div id="motor-results"></div>
    <div id="motor-detail"></div>
  </article>
`;

function optionsHtml(values: string[], selected?: string): string {
  const any = `<option value="">Any</option>`;
  const rest = values
    .map((v) => `<option value="${v}"${v === selected ? " selected" : ""}>${v}</option>`)
    .join("");
  return any + rest;
}

/**
 * ThrustCurve.org's own metadata.diameters includes a handful of clearly-bogus entries (values
 * like 10100, 13000mm — over a meter across, not a real motor size, presumably a data-entry
 * error for a specific listing) alongside the real standard case sizes (6mm up through 161mm).
 * Filtering to <200mm is a real, verified sanity bound (checked live against the actual API
 * response), not an arbitrary guess -- every genuine motor diameter is well under that.
 */
let standardMotorDiametersMm: number[] = [];

/** Nearest entry in standardMotorDiametersMm to a raw (e.g. geometry-derived) mm value — needed because ThrustCurve.org's diameter filter only matches its own exact standard values, not arbitrary measured numbers. */
function nearestStandardDiameterMm(mm: number): number | null {
  if (standardMotorDiametersMm.length === 0) return null;
  return standardMotorDiametersMm.reduce((best, d) => (Math.abs(d - mm) < Math.abs(best - mm) ? d : best));
}

/** Standard diameters at or below a mount size, largest first — the search space for "use motor adapter" (a motor sized for a smaller mount always fits a bigger one via an adapter). */
function standardDiametersAtOrBelow(mm: number): number[] {
  const nearest = nearestStandardDiameterMm(mm);
  if (nearest === null) return [];
  return standardMotorDiametersMm.filter((d) => d <= nearest).sort((a, b) => b - a);
}

/** Updates the motor-mount note text and (re)syncs the Diameter select to the active rocket's mount — called whenever a rocket loads or the metadata (hence the select's options) finishes loading, so whichever happens first still ends up consistent. */
function syncMotorMountUi(): void {
  const noteEl = document.querySelector<HTMLElement>("#motor-mount-note small");
  const diaEl = document.querySelector<HTMLSelectElement>("#motor-diameter");
  if (!noteEl) return;
  if (activeMotorMountDiameterMm === null) {
    noteEl.textContent = "";
    return;
  }
  const nearest = nearestStandardDiameterMm(activeMotorMountDiameterMm);
  // Motor mount diameter is always mm, not run through fmtLength's cm/in toggle -- same reasoning
  // as the motor search results' Diameter column. Leads with the nearest standard motor class (the
  // figure that actually matters for picking a motor), with the raw measured ID as a secondary
  // parenthetical -- NOT framed as "rounded to the closest size," which reads as flagging a
  // discrepancy that needs explaining. A tube's real ID is routinely a fraction of a mm off its
  // nominal motor class (a 38mm motor needs some clearance to physically slide into a 38.x mm
  // tube) -- normal manufacturing reality, not something to call out every time.
  noteEl.textContent = `Motor mount: ${nearest !== null ? `${nearest}mm` : `${activeMotorMountDiameterMm.toFixed(1)}mm`}${
    nearest !== null ? ` (measured ID ${activeMotorMountDiameterMm.toFixed(1)}mm)` : ""
  } — larger sizes disabled, they physically won't fit. Check "use motor adapter" to also allow smaller motors.`;
  if (!diaEl) return;

  // A motor wider than the mount can't physically go in, adapter or not (the adapter checkbox is
  // the other direction -- a smaller motor shimmed up to fit a bigger mount). +0.5mm tolerance so
  // an exact-fit standard size (e.g. a 38mm option on a 38.6mm mount) isn't disabled by float noise.
  for (const opt of Array.from(diaEl.options)) {
    if (opt.value === "") continue; // "Any" always stays enabled
    opt.disabled = Number(opt.value) > activeMotorMountDiameterMm + 0.5;
  }
  if (nearest !== null && [...diaEl.options].some((o) => o.value === String(nearest))) {
    diaEl.value = String(nearest);
  }
}

async function loadMotorMetadata(): Promise<void> {
  const mfgEl = document.querySelector<HTMLSelectElement>("#motor-mfg");
  const diaEl = document.querySelector<HTMLSelectElement>("#motor-diameter");
  const typeEl = document.querySelector<HTMLSelectElement>("#motor-type");
  const classEl = document.querySelector<HTMLSelectElement>("#motor-impulse-class");
  if (!mfgEl || !diaEl || !typeEl || !classEl) return;

  try {
    const metadata = await getMotorMetadata();
    mfgEl.innerHTML = optionsHtml(metadata.manufacturers.map((m) => m.abbrev), urlFilterValue("manufacturer"));
    diaEl.innerHTML = optionsHtml(metadata.diameters.map((d) => String(d)), urlFilterValue("diameter"));
    typeEl.innerHTML = optionsHtml(metadata.types, urlFilterValue("type"));
    classEl.innerHTML = optionsHtml(metadata.impulseClasses, urlFilterValue("impulseClass"));
    standardMotorDiametersMm = metadata.diameters.filter((d) => d < 200).sort((a, b) => a - b);
    syncMotorMountUi();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const el of [mfgEl, diaEl, typeEl, classEl]) {
      el.innerHTML = `<option value="">(failed to load: ${message})</option>`;
    }
  } finally {
    for (const el of [mfgEl, diaEl, typeEl, classEl]) {
      el.removeAttribute("aria-busy");
    }
  }
}

/** ThrustCurve.org numeric fields are sometimes missing and often carry float noise (e.g. 19.099999999999998) — format defensively. */
function num(value: number | undefined | null, digits = 2, unit = ""): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}${unit}`;
}

// --- Sortable results table ---
interface MotorColumn {
  key: string;
  label: string;
  format: (m: MotorSearchResult) => string;
  value: (m: MotorSearchResult) => string | number | undefined;
}

const STANDARD_GRAVITY = 9.80665; // m/s^2 -- for converting loaded mass to weight (thrust:weight ratio is a force:force comparison, not force:mass)

/**
 * Initial (ignition) thrust per motorId — NOT the same as MotorSearchResult.maxThrustN (the
 * burn-wide peak, which for many motors, especially progressive-burn BP ones, happens well after
 * ignition, not at t=0). Search metadata alone doesn't carry this; it's batch-fetched from each
 * motor's actual thrust curve (see loadInitialThrustsForCurrentResults) after a search returns,
 * one request covering every result row rather than one download per row.
 */
let initialThrustByMotorId = new Map<string, number>();
let initialThrustLoading = false;

/** Fetches initial thrust for every motor in currentResults, in one batched request -- guards against a slower, now-superseded fetch overwriting a newer search's results if the user searches again before this one lands. */
async function loadInitialThrustsForCurrentResults(): Promise<void> {
  const forResults = currentResults;
  const ids = forResults.map((m) => m.motorId);
  if (ids.length === 0) return;
  initialThrustLoading = true;
  renderAndWireResults();
  try {
    const fetched = await downloadInitialThrusts(ids);
    if (currentResults !== forResults) return; // a newer search superseded this one -- discard
    initialThrustByMotorId = fetched;
  } catch {
    // Leave initialThrustByMotorId as-is -- initial-thrust/T:W columns just show "—" for these
    // motors rather than failing the whole search-results display over one batch-fetch error.
  } finally {
    if (currentResults === forResults) initialThrustLoading = false;
    renderAndWireResults();
  }
}

/**
 * Thrust:weight ratio using loaded weight (this rocket's current dry mass + the row's own motor
 * mass) and the motor's effective INITIAL thrust (see initialThrustByMotorId/computeInitialThrustN
 * above — an impulse-weighted average over the first ~0.5s of burn, not a single sample or the
 * burn-wide peak) — the moment right off the pad is what the safety threshold below is actually
 * checking. Thresholds are the standard hobby-rocketry safety guidance:
 * below 3:1 the rocket may not clear the launch rod with stable velocity (a real hazard, not just
 * underperformance) — nogo. 3-5:1 is flyable but marginal. 5-7:1 is a normal, unremarkable ratio.
 * Above 7:1 is comfortably brisk. Returns null when the motor's weight isn't published, or initial
 * thrust hasn't been fetched/found yet — nothing to flag without real numbers for both sides.
 */
function computeThrustToWeight(m: MotorSearchResult): { ratio: number; label: string; color: string } | null {
  if (m.totalWeightG === undefined || m.totalWeightG === null || Number.isNaN(m.totalWeightG)) return null;
  const initialThrustN = initialThrustByMotorId.get(m.motorId);
  if (initialThrustN === undefined) return null;
  const loadedMassKg = activeDryMassKg + m.totalWeightG / 1000;
  const loadedWeightN = loadedMassKg * STANDARD_GRAVITY;
  if (loadedWeightN <= 0) return null;
  const ratio = initialThrustN / loadedWeightN;
  if (ratio < 3) return { ratio, label: "nogo", color: "var(--pico-del-color, #c0392b)" };
  if (ratio < 5) return { ratio, label: "marginal", color: "#b8860b" };
  if (ratio <= 7) return { ratio, label: "ok", color: "inherit" };
  return { ratio, label: "good", color: "var(--pico-ins-color, #2a8f4d)" };
}

const MOTOR_COLUMNS: MotorColumn[] = [
  {
    key: "motor",
    label: "Motor",
    format: (m) => `<a href="#" data-motor-index="__I__"><strong>${m.manufacturer} ${m.designation}</strong></a>`,
    value: (m) => `${m.manufacturer} ${m.designation}`,
  },
  {
    key: "diameter",
    label: "Diameter",
    // Motor diameter is always mm, not run through fmtLength's cm/in toggle -- "38mm"/"54mm" are
    // how these are named and talked about in the hobby regardless of the page's unit setting.
    format: (m) => (m.diameter === undefined || m.diameter === null || Number.isNaN(m.diameter) ? "—" : `${m.diameter.toFixed(0)}mm`),
    value: (m) => m.diameter,
  },
  { key: "type", label: "Type", format: (m) => m.type, value: (m) => m.type },
  { key: "class", label: "Class", format: (m) => m.impulseClass, value: (m) => m.impulseClass },
  {
    key: "totImpulse",
    label: "Total impulse",
    format: (m) => (m.totImpulseNs === undefined || m.totImpulseNs === null || Number.isNaN(m.totImpulseNs) ? "—" : fmtImpulse(m.totImpulseNs)),
    value: (m) => m.totImpulseNs,
  },
  { key: "burnTime", label: "Burn time", format: (m) => num(m.burnTimeS, 2, " s"), value: (m) => m.burnTimeS },
  {
    key: "totalWeight",
    label: "Total weight",
    format: (m) => (m.totalWeightG === undefined || m.totalWeightG === null || Number.isNaN(m.totalWeightG) ? "—" : fmtMass(m.totalWeightG / 1000)),
    value: (m) => m.totalWeightG,
  },
  {
    key: "avgThrust",
    label: "Avg thrust",
    format: (m) => (m.avgThrustN === undefined || m.avgThrustN === null || Number.isNaN(m.avgThrustN) ? "—" : fmtForce(m.avgThrustN)),
    value: (m) => m.avgThrustN,
  },
  {
    key: "initialThrust",
    label: "Initial thrust",
    format: (m) => {
      const v = initialThrustByMotorId.get(m.motorId);
      if (v !== undefined) return fmtForce(v);
      return initialThrustLoading ? "…" : "—";
    },
    value: (m) => initialThrustByMotorId.get(m.motorId),
  },
  {
    key: "thrustToWeight",
    label: "T:W (loaded)",
    format: (m) => {
      const tw = computeThrustToWeight(m);
      return tw ? `<span style="color: ${tw.color};">${tw.ratio.toFixed(1)}:1 — ${tw.label}</span>` : "—";
    },
    value: (m) => computeThrustToWeight(m)?.ratio,
  },
];

let currentResults: MotorSearchResult[] = [];
let sortState: { key: string; dir: 1 | -1 } | null = null;

/** Display order of MOTOR_COLUMNS' keys — reorderable by dragging a header (see wireColumnDragReorder). Starts as MOTOR_COLUMNS' own declared order and persists across searches/re-renders, since it's a user preference, not per-search state. */
let motorColumnOrder: string[] = MOTOR_COLUMNS.map((c) => c.key);

function orderedMotorColumns(): MotorColumn[] {
  return motorColumnOrder.map((key) => MOTOR_COLUMNS.find((c) => c.key === key)).filter((c): c is MotorColumn => c !== undefined);
}

/** Nogo motors (T:W < 3:1 for this rocket) are hidden by default -- a real safety threshold, not just a sort preference, so burying it at the bottom of a long sorted list isn't enough. Toggled via the "Show nogo motors" link rendered in renderMotorResults. */
let showNogoMotors = false;

function compareValues(a: string | number | undefined, b: string | number | undefined, dir: 1 | -1): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1; // missing data always sorts last, regardless of direction
  if (b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * dir;
  return String(a).localeCompare(String(b)) * dir;
}

function sortedResults(): MotorSearchResult[] {
  if (!sortState) return currentResults;
  const column = MOTOR_COLUMNS.find((c) => c.key === sortState!.key);
  if (!column) return currentResults;
  return [...currentResults].sort((a, b) => compareValues(column.value(a), column.value(b), sortState!.dir));
}

function renderMotorResults(): string {
  if (currentResults.length === 0) return "<p>No motors found.</p>";
  const sorted = sortedResults();
  const nogoCount = sorted.filter((m) => computeThrustToWeight(m)?.label === "nogo").length;
  const visible = showNogoMotors ? sorted : sorted.filter((m) => computeThrustToWeight(m)?.label !== "nogo");

  const toggleNote =
    nogoCount > 0
      ? `<p><small>${
          showNogoMotors
            ? `Showing all ${sorted.length} motors, including ${nogoCount} flagged nogo.`
            : `${nogoCount} nogo motor${nogoCount === 1 ? "" : "s"} hidden by default (thrust:weight below 3:1, per safety guidance).`
        } <a href="#" id="toggle-nogo-motors">${showNogoMotors ? "Hide nogo motors" : "Show nogo motors"}</a></small></p>`
      : "";

  if (visible.length === 0) {
    return `${toggleNote}<p>All ${sorted.length} matching motors are flagged nogo for this rocket's current weight.</p>`;
  }

  const columns = orderedMotorColumns();
  const rows = visible
    .map((m) => {
      const realIndex = currentResults.indexOf(m);
      const cells = columns.map((c) => `<td>${c.format(m).replace("__I__", String(realIndex))}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const headers = columns
    .map((c) => {
      const arrow = sortState?.key === c.key ? (sortState.dir === 1 ? " ▲" : " ▼") : "";
      return `<th class="sortable-th" draggable="true" data-sort-key="${c.key}" data-col-key="${c.key}" title="Click to sort, drag to reorder">${c.label}${arrow}</th>`;
    })
    .join("");
  return `
    ${toggleNote}
    <figure>
      <table>
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </figure>
  `;
}

function renderAndWireResults(): void {
  const resultsEl = document.querySelector<HTMLDivElement>("#motor-results");
  if (!resultsEl) return;
  // A full innerHTML replacement below throws away the old <figure> (and whatever scroll position
  // it had) and builds a brand-new one at (0, 0) -- capture the old scroll offset first and
  // restore it on the new one, or every sort-click/nogo-toggle/etc re-render would silently snap
  // the table back to its top-left, undoing whatever the user had scrolled to.
  const prevFigure = resultsEl.querySelector("figure");
  const prevScrollLeft = prevFigure?.scrollLeft ?? 0;
  const prevScrollTop = prevFigure?.scrollTop ?? 0;
  resultsEl.innerHTML = renderMotorResults();
  const newFigure = resultsEl.querySelector("figure");
  if (newFigure) {
    newFigure.scrollLeft = prevScrollLeft;
    newFigure.scrollTop = prevScrollTop;
  }
  resultsEl.querySelectorAll<HTMLAnchorElement>("a[data-motor-index]").forEach((a) => {
    a.addEventListener("click", (evt) => {
      evt.preventDefault();
      const idx = Number(a.dataset["motorIndex"]);
      const meta = currentResults[idx];
      if (meta) void selectMotor(meta);
    });
  });
  resultsEl.querySelectorAll<HTMLTableCellElement>("th[data-sort-key]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset["sortKey"]!;
      sortState = sortState?.key === key ? { key, dir: sortState.dir === 1 ? -1 : 1 } : { key, dir: 1 };
      renderAndWireResults();
    });
  });
  resultsEl.querySelector<HTMLAnchorElement>("#toggle-nogo-motors")?.addEventListener("click", (evt) => {
    evt.preventDefault();
    showNogoMotors = !showNogoMotors;
    renderAndWireResults();
  });
  wireColumnDragReorder(resultsEl);
}

/**
 * Native HTML5 drag-and-drop to reorder motor table columns — no library needed for a single
 * flat row of headers. Dropping column A onto column B moves A to B's current position (not a
 * swap), matching how dragging a column in a spreadsheet behaves.
 */
let draggedMotorColumnKey: string | null = null;

function wireColumnDragReorder(resultsEl: HTMLElement): void {
  resultsEl.querySelectorAll<HTMLTableCellElement>("th[data-col-key]").forEach((th) => {
    th.addEventListener("dragstart", (evt) => {
      draggedMotorColumnKey = th.dataset["colKey"] ?? null;
      (evt as DragEvent).dataTransfer?.setData("text/plain", draggedMotorColumnKey ?? "");
      if ((evt as DragEvent).dataTransfer) (evt as DragEvent).dataTransfer!.effectAllowed = "move";
    });
    th.addEventListener("dragover", (evt) => {
      evt.preventDefault(); // required for this element to be a valid drop target
      if ((evt as DragEvent).dataTransfer) (evt as DragEvent).dataTransfer!.dropEffect = "move";
    });
    th.addEventListener("drop", (evt) => {
      evt.preventDefault();
      const targetKey = th.dataset["colKey"];
      if (!draggedMotorColumnKey || !targetKey || draggedMotorColumnKey === targetKey) return;
      const fromIdx = motorColumnOrder.indexOf(draggedMotorColumnKey);
      const toIdx = motorColumnOrder.indexOf(targetKey);
      if (fromIdx === -1 || toIdx === -1) return;
      motorColumnOrder.splice(fromIdx, 1);
      motorColumnOrder.splice(toIdx, 0, draggedMotorColumnKey);
      draggedMotorColumnKey = null;
      renderAndWireResults();
    });
  });
}

/** The last motor a user actually selected, cached so a unit-toggle can re-render its detail panel without re-fetching from ThrustCurve.org. */
let lastMotorSelection: MotorSelection | null = null;

/**
 * Surfaces MassCurve.inconsistentRealData (see its own doc comment) as a visible, always-shown
 * callout, not just a silent fallback -- a motor whose own source file disagrees with its own
 * published propellant weight is worth knowing about on its own merits (it's a data problem with
 * that specific ThrustCurve.org file, not something to quietly paper over), not only because of the
 * fallback this app happens to take. Shows the actual numbers, not just "something's off", so the
 * user can judge for themselves rather than take the mismatch on faith.
 */
function renderMassDataInconsistencyWarning(info: { firstSampleKg: number; publishedPropellantMassKg: number }): string {
  const deltaKg = info.publishedPropellantMassKg - info.firstSampleKg;
  const deltaPct = (deltaKg / info.publishedPropellantMassKg) * 100;
  return `
    <div class="callout-warning">
      <strong>⚠ This motor's source file has inconsistent mass data</strong>
      <p>
        Its real per-sample propellant-mass curve starts at ${fmtMass(info.firstSampleKg)}, but the motor's own
        published propellant mass is ${fmtMass(info.publishedPropellantMassKg)} — most likely a stale mass curve
        left over from an earlier revision of this motor's file on ThrustCurve.org, not an error in this app.
        The real per-sample data is <strong>not</strong> being used for this reason: mass/CG below are instead
        estimated from total/propellant weight assuming mass loss proportional to thrust impulse, the same
        method used for motors that never had real per-sample data to begin with.
      </p>
      <table>
        <tbody>
          <tr><td>Published propellant mass</td><td>${fmtMass(info.publishedPropellantMassKg)}</td></tr>
          <tr><td>Real curve's first sample</td><td>${fmtMass(info.firstSampleKg)}</td></tr>
          <tr><td>Difference</td><td>${fmtMass(deltaKg)} (${deltaPct.toFixed(1)}%)</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Surfaces a gap between the motor's ThrustCurve.org catalog weight and the actual source file's
 * own header weight that this app is simulating with -- common (surveyed 24 real motors H-O impulse
 * class: 8/20 non-hybrid motors disagreed by >2%, up to 7%), not a sign of a broken file, just two
 * separately-maintained records for the same motor drifting apart. Named which source/quality file
 * is actually driving the sim (per the user's own ask: "let users know which of the thrust curves we
 * are using when these things disagree") rather than just showing two numbers with no indication of
 * which one won. Silently returns "" when there's no real mass basis (RASP-sourced motor, or a
 * hybrid -- see buildSelectedMotor) or the gap is small enough to be unremarkable.
 */
function renderMassBasisDriftWarning(motor: SelectedMotor, meta: MotorSearchResult, selection: MotorSelection): string {
  if (!selection.realMassBasis || meta.propWeightG === undefined || meta.propWeightG === null || meta.propWeightG <= 0) return "";
  const catalogPropKg = meta.propWeightG / 1000;
  const deltaKg = motor.propellantMassKg - catalogPropKg;
  const deltaPct = (deltaKg / catalogPropKg) * 100;
  if (Math.abs(deltaPct) < 3) return "";
  const fileKind = selection.sourceFormat === "RockSim" ? "RockSim (.rse)" : selection.sourceFormat;
  return `
    <div class="callout-warning">
      <strong>⚠ This motor's data source disagrees with ThrustCurve.org's catalog figure</strong>
      <p>
        Simulating with the <strong>${fileKind}, ${selection.sourceQuality}-quality</strong> source file's own
        published weight, not ThrustCurve.org's separately-listed catalog figure below — the file's own number is
        used because it's what its real per-sample mass curve (when it has one) was actually built from, and stays
        internally consistent with it. A few percent of drift between an individual submitted file and the
        catalog is routine (different submissions for the same motor can report slightly different numbers), not
        necessarily an error.
      </p>
      <table>
        <tbody>
          <tr><td>ThrustCurve.org catalog propellant mass</td><td>${fmtMass(catalogPropKg)}</td></tr>
          <tr><td>${fileKind} file's own propellant mass (used here)</td><td>${fmtMass(motor.propellantMassKg)}</td></tr>
          <tr><td>Difference</td><td>${fmtMass(Math.abs(deltaKg))} (${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%)</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderMotorDetailHtml(meta: MotorSearchResult, samples: ThrustSample[]): { html: string; rocketWithMotor: Rocket } {
  // lastMotorSelection is already set to this exact (meta, samples) by the caller (selectMotor) --
  // built from THAT (not meta/samples alone) so realMassBasis/sourceFormat/sourceQuality come along
  // too. Re-derive activeRocket's dry CG against THIS motor before building rocketWithMotor, so a
  // motor swap correctly changes how much of the loaded CG gets attributed to the airframe.
  const motor = buildSelectedMotor(lastMotorSelection!);
  rederiveDryCg();

  const rocketWithMotor: Rocket = { ...activeRocket, motor, windProfile: activeWindProfile, launchRodLength: activeLaunchRodLengthM };
  const massCurve = deriveMotorMassCurve(motor);
  const bt = burnTime(motor);
  const midT = bt / 2;

  const massAt = (t: number) => combinedMassAt(rocketWithMotor, massCurve, t);
  const start = massAt(0);
  const mid = massAt(midT);
  const end = massAt(bt);

  const html = `
    <h3>${meta.manufacturer} ${meta.designation}</h3>
    ${loadedMassWarning ? `<p><mark>${loadedMassWarning}</mark></p>` : ""}
    ${massCurve.inconsistentRealData ? renderMassDataInconsistencyWarning(massCurve.inconsistentRealData) : ""}
    ${renderMassBasisDriftWarning(motor, meta, lastMotorSelection!)}
    <p>Thrust curve: ${samples.length} samples, burn time ${bt.toFixed(2)}s.
      Total impulse (integrated from curve): ${fmtImpulse(totalImpulse(motor))}
      (ThrustCurve.org reports ${meta.totImpulseNs === undefined || meta.totImpulseNs === null ? "—" : fmtImpulse(meta.totImpulseNs)}).
      Peak thrust: ${fmtForce(Math.max(...samples.map((s) => s.thrust)))}.</p>
    <figure><div id="thrust-curve-chart"></div></figure>
    <figure>
      <table>
        <thead>
          <tr><th></th><th>t=0 (ignition)</th><th>t=${midT.toFixed(2)}s (mid-burn)</th><th>t=${bt.toFixed(2)}s (burnout)</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Thrust</td>
            <td>${fmtForce(getThrustAt(motor, 0))}</td>
            <td>${fmtForce(getThrustAt(motor, midT))}</td>
            <td>${fmtForce(getThrustAt(motor, bt))}</td>
          </tr>
          <tr>
            <td>Motor mass</td>
            <td>${fmtMass(getMotorMassAt(massCurve, 0))}</td>
            <td>${fmtMass(getMotorMassAt(massCurve, midT))}</td>
            <td>${fmtMass(getMotorMassAt(massCurve, bt))}</td>
          </tr>
          <tr>
            <td>Combined rocket mass</td>
            <td>${fmtMass(start.mass)}</td>
            <td>${fmtMass(mid.mass)}</td>
            <td>${fmtMass(end.mass)}</td>
          </tr>
          <tr>
            <td>Combined rocket CG</td>
            <td>${fmtLength(start.cgX)}</td>
            <td>${fmtLength(mid.cgX)}</td>
            <td>${fmtLength(end.cgX)}</td>
          </tr>
        </tbody>
      </table>
    </figure>
    <div id="flight-sim-section">${
      activeUnsupportedFeatures.length > 0
        ? `<p><mark>Flight simulation not available: ${activeUnsupportedFeatures.join(", ")}.</mark> This rocket's geometry isn't modeled well enough for a trustworthy simulation yet -- the motor data above is still real (its own thrust/mass curve doesn't depend on the rocket it's attached to).</p>`
        : isHybridMotor(meta)
          ? `<p><mark>Flight simulation not available: hybrid motors aren't supported yet.</mark> This motor's own thrust/mass data above is still real -- only simulating a rocket flying on it is blocked, since this app's mass-curve modeling was built and checked against solid-motor data, not a hybrid's separately-tanked oxidizer.</p>`
          : `<p aria-busy="true">Simulating flight…</p>`
    }</div>
  `;
  return { html, rocketWithMotor };
}

/**
 * Renders the motor detail panel into #motor-detail and mounts its thrust-curve chart — shared by
 * every place that re-renders the panel (initial selection, dry mass/CG edits, unit toggle) so the
 * chart doesn't need remounting separately at each call site. Returns rocketWithMotor for callers
 * that also need to re-run the flight sim; null if #motor-detail isn't in the DOM.
 */
function renderMotorDetailAndMountChart(meta: MotorSearchResult, samples: ThrustSample[]): Rocket | null {
  const detailEl = document.querySelector<HTMLDivElement>("#motor-detail");
  if (!detailEl) return null;
  const { html, rocketWithMotor } = renderMotorDetailHtml(meta, samples);
  detailEl.innerHTML = html;
  renderThrustCurveChart("thrust-curve-chart", samples);
  return rocketWithMotor;
}

async function selectMotor(meta: MotorSearchResult): Promise<void> {
  const detailEl = document.querySelector<HTMLDivElement>("#motor-detail");
  if (!detailEl) return;
  detailEl.innerHTML = `<p aria-busy="true">Loading thrust curve for ${meta.manufacturer} ${meta.designation}…</p>`;

  if (
    meta.totalWeightG === undefined ||
    meta.totalWeightG === null ||
    meta.propWeightG === undefined ||
    meta.propWeightG === null
  ) {
    detailEl.innerHTML = `<p><mark>${meta.manufacturer} ${meta.designation} is missing weight data on ThrustCurve.org — can't compute a mass curve for it. Pick a different motor.</mark></p>`;
    return;
  }

  try {
    const { samples, realMassBasis, sourceFormat, sourceQuality } = await downloadThrustSamples(meta.motorId);
    // If the LOADED mass field was what got edited (a motor was already selected at edit time),
    // the dry mass currently stored is back-solved against that OLD motor's own mass and isn't
    // meaningful for a different one -- revert to the file's base dry mass before applying this
    // motor, so its "Loaded mass" is base dry + this motor, not a stale carried-over figure. A
    // direct dry-mass edit (dryMassOverriddenViaLoadedEdit false) is motor-independent and stays.
    let dryMassReverted = false;
    if (dryMassOverriddenViaLoadedEdit) {
      activeDryMassKg = baseDryMassKg;
      dryMassOverriddenViaLoadedEdit = false;
      dryMassReverted = true;
    }
    lastMotorSelection = { meta, samples, realMassBasis, sourceFormat, sourceQuality };
    const rocketWithMotor = renderMotorDetailAndMountChart(meta, samples);
    // The mass stat card switches from "Dry mass" to "Loaded mass" (dry + this motor's mass) once
    // a motor's known -- re-render it here, not just the motor detail panel above, or it'd keep
    // showing the stale dry-only figure/label until some unrelated re-render happened to fire.
    renderActiveRocketDisplay();
    // If dry mass just got reverted above, the search results table's T:W column (computed
    // against activeDryMassKg) needs refreshing too, or it'd keep showing ratios flagged against
    // the stale, now-discarded back-solved mass.
    if (dryMassReverted) renderAndWireResults();
    // Motor search/detail stays available for unsupported-geometry rockets (a user can still want
    // to know what a motor looks like -- thrust curve, mass, real ThrustCurve.org data, none of
    // which depends on the rocket it'd be attached to) -- only the actual flight simulation is
    // gated, since that's the part this project's aero model can't trust for that geometry (see
    // activeUnsupportedFeatures' own doc comment).
    if (rocketWithMotor && !flightSimBlocked()) void runFlightSim(rocketWithMotor);
    saveCurrentConfigToCache();
  } catch (err) {
    detailEl.innerHTML = `<p><mark>Failed to load thrust curve: ${err instanceof Error ? err.message : String(err)}</mark></p>`;
  }
}

/**
 * Set whenever a simulation actually runs, so a unit toggle can re-render
 * the same result under new formatting (rerenderFlightResultOnly) without
 * paying for another worker round-trip — the physics doesn't depend on
 * display units, only what's shown does. Same module-level-mutable-state
 * pattern as activeRocket/lastMotorSelection elsewhere in this file.
 */
let lastFlightResult: SimResult3D | null = null;
let lastFlightRocket: Rocket | null = null;
let lastFlightElapsedMs = 0;
/** Guards against a stale response overwriting a newer request's result if two runFlightSim calls overlap (e.g. rapid motor reselection). */
let flightSimRequestSeq = 0;

const FLIGHT_CHART_IDS = { altitude: "chart-altitude", speedMach: "chart-speed-mach", tilt: "chart-tilt" };

function mountFlightCharts(): void {
  if (lastFlightResult) renderFlightChart(FLIGHT_CHART_IDS, lastFlightResult.samples);
}

/**
 * Embed mode's own "send to splashcast" button (see #embed-send-btn in the bootstrap template /
 * style.css) -- deliberately NOT automatic BY DEFAULT. Sending the moment a motor's picked gave a
 * visitor no chance to actually look over the flight-sim result (apogee, stability, charts) before
 * it went to splashcast; this button (or, when embedState.autoSend is set, runFlightSim itself --
 * see sendCurrentReviewToSplashcast's own call sites) is now the ONLY thing that triggers
 * runEmbedMultiModelSim/postToEmbedParent on success. A cache-restored rocket+motor
 * (restoreCachedConfigIfEmbedded) still auto-RUNS the local sim for review -- it doesn't auto-SEND
 * either, unless autoSend is set.
 *
 * `sentForFlightResult` tracks WHICH result (by reference -- lastFlightResult is replaced wholesale
 * by every successful runFlightSim, never mutated in place) has actually been sent, so any new local
 * sim (a fresh motor pick, a CG/mass/rod-length edit) correctly flips the button back to "needs
 * sending" even though it's the same DOM element just being relabeled.
 */
let sentForFlightResult: SimResult3D | null = null;
let embedSendInFlight = false;

function updateEmbedSendButton(): void {
  const btn = document.querySelector<HTMLButtonElement>("#embed-send-btn");
  if (!btn) return;
  // windData/windContentFingerprint gate matches runEmbedMultiModelSim's own early-return exactly --
  // without it, a click here would silently no-op (nothing computed, nothing posted) while the
  // button still flipped to "sent," which would be a lie. In practice wind almost always finishes
  // loading well before a visitor gets through picking a rocket + motor, but don't rely on that.
  if (!embedState?.windData || !embedState.windContentFingerprint || !lastFlightResult || !lastFlightRocket) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.disabled = embedSendInFlight;
  const alreadySent = sentForFlightResult === lastFlightResult;
  btn.dataset.sent = String(alreadySent && !embedSendInFlight);
  btn.textContent = embedSendInFlight
    ? "Sending flight data to splashcast…"
    : alreadySent
      ? "✓ Sent to splashcast — send again"
      : "📤 Send to splashcast";
}

/** The actual send step -- shared by the button's click handler and runFlightSim's own autoSend path (embedState.autoSend, see EmbedParams's own doc comment for who sets this and why). Always updates the button's visible state around the request, even in autoSend mode -- harmless (nobody's necessarily watching a background/prefetch load), and keeps it correct for anyone who IS. */
async function sendCurrentReviewToSplashcast(rocket: Rocket): Promise<void> {
  embedSendInFlight = true;
  updateEmbedSendButton();
  try {
    await runEmbedMultiModelSim(rocket);
    sentForFlightResult = lastFlightResult;
  } finally {
    embedSendInFlight = false;
    updateEmbedSendButton();
  }
}

function wireEmbedSendButton(): void {
  document.querySelector("#embed-send-btn")?.addEventListener("click", () => {
    if (embedSendInFlight || !lastFlightRocket) return;
    void sendCurrentReviewToSplashcast(lastFlightRocket);
  });
}

/** Runs the (potentially expensive, many-thousand-substep) 3D ascent sim in a Web Worker and renders the result into #flight-sim-section once it resolves. */
async function runFlightSim(rocket: Rocket): Promise<void> {
  const el = document.querySelector<HTMLDivElement>("#flight-sim-section");
  if (!el) return;
  const requestId = ++flightSimRequestSeq;
  try {
    const t0 = performance.now();
    const result = await simulateFlight3DInWorker(rocket);
    const elapsedMs = performance.now() - t0;
    if (requestId !== flightSimRequestSeq) return; // superseded by a newer request
    lastFlightResult = result;
    lastFlightRocket = rocket;
    lastFlightElapsedMs = elapsedMs;
    el.innerHTML = renderFlightResultHtml(rocket, result, elapsedMs);
    mountFlightCharts();
    // This single-profile result is only for the local display above -- the actual splashcast
    // handoff runs its OWN independent sim per available forecast model (see runEmbedMultiModelSim's
    // own doc comment on why: splashcast wants every model's ascent path, not just whichever one
    // happened to be active locally). Not triggered automatically UNLESS splashcast explicitly asked
    // for that (embedState.autoSend, its own background/prefetch loads -- see EmbedParams's doc
    // comment) -- otherwise this just updates the button, leaving the actual send to that click (see
    // #embed-send-btn's own doc comment for why a visitor gets to review first).
    if (embedState?.autoSend) {
      void sendCurrentReviewToSplashcast(rocket);
    } else {
      updateEmbedSendButton();
    }
  } catch (err) {
    if (requestId !== flightSimRequestSeq) return;
    el.innerHTML = `<p><mark>Flight simulation failed: ${err instanceof Error ? err.message : String(err)}</mark></p>`;
    // A failed sim leaves nothing reviewable -- hide the send button rather than leaving it
    // pointing at a stale prior result the visitor can no longer see on screen.
    const btn = document.querySelector<HTMLButtonElement>("#embed-send-btn");
    if (btn) btn.hidden = true;
    if (embedState) {
      postToEmbedParent(buildErrorMessage(`Flight simulation failed: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
}

/** Re-renders the LAST COMPUTED flight result under the current unit system, without re-running the simulation (a pure unit toggle doesn't change the underlying SI physics). No-op if no simulation has completed yet. */
function rerenderFlightResultOnly(): void {
  if (!lastFlightResult || !lastFlightRocket) return;
  const el = document.querySelector<HTMLDivElement>("#flight-sim-section");
  if (!el) return;
  el.innerHTML = renderFlightResultHtml(lastFlightRocket, lastFlightResult, lastFlightElapsedMs);
  mountFlightCharts();
}

/**
 * Stability at LAUNCH (full propellant load), not dry -- for a typical aft-mounted motor, CG is
 * furthest aft (least stable) at liftoff and moves forward as propellant burns, so liftoff is the
 * safety-relevant worst case to check, not burnout. Mach 0.1 (~100fps) -- the actually safety-
 * relevant rail-exit speed, not an arbitrary "typical flight" number. CP shifts slightly aft (more
 * stable-looking) as Mach rises in the subsonic band (traced to the fin CNa1 compressibility term
 * in fin-calc.ts, which nose/body CNa has no equivalent of) -- checking stability at a higher Mach
 * than this would be mildly optimistic relative to the moment stability actually matters most.
 * Shared by renderFlightResultHtml (display) and runFlightSim's embed-mode postMessage hook, so
 * the number a splashcast visitor gets matches exactly what this project's own UI would show for
 * the same rocket/motor.
 */
function computeLiftoffStability(rocket: Rocket): StabilityCheck {
  const massCurve = rocket.motor ? deriveMotorMassCurve(rocket.motor) : null;
  const launchCgX = massCurve ? combinedMassAt(rocket, massCurve, 0).cgX : rocket.dryCg;
  const { cpX, refDiameter } = computeBarrowman(rocket.components, 0.1);
  return checkStability(cpX, launchCgX, refDiameter, rocket.motor !== null);
}

function renderFlightResultHtml(rocket: Rocket, result: SimResult3D, elapsedMs: number): string {
  const stability = computeLiftoffStability(rocket);

  const notFlyableHtml = !stability.flyable
    ? `<p style="padding: 0.75rem; border-radius: var(--pico-border-radius); background: var(--pico-del-color, #c0392b); color: white;"><strong>⚠ ${stability.warnings[0]}</strong></p>`
    : "";
  const stabilityWarningsHtml = stability.flyable && stability.warnings.length
    ? `<p>${stability.warnings.map((w) => `<mark>${w}</mark>`).join(" ")}</p>`
    : "";

  const warningsHtml = result.warnings.length
    ? `<p>${result.warnings.map((w) => `<mark>${w}</mark>`).join(" ")}</p>`
    : "";

  const windLabel = rocket.windProfile ? "wind on" : "calm (no wind)";
  const stats = [
    stat(
      "Static margin at launch",
      `<span style="color: ${stability.margin > 0 ? "var(--pico-ins-color, #2a8f4d)" : "var(--pico-del-color, #c0392b)"};">${stability.margin.toFixed(2)} cal (${stability.margin > 0 ? "stable" : "unstable"})</span>`,
    ),
    stat("Apogee", fmtAltitude(result.apogeeAltitude)),
    stat("Time to apogee", `${result.apogeeTime.toFixed(2)} s`),
    stat("Max velocity", fmtVelocity(result.maxVelocity)),
    stat("Max Mach", result.maxMach.toFixed(3)),
    stat("Max acceleration", `${(result.maxAcceleration / 9.80665).toFixed(1)} g`),
    stat("Tilt at burnout", result.tiltAtBurnoutDeg !== null ? `${result.tiltAtBurnoutDeg.toFixed(1)}°` : "—"),
  ].join("");

  const eventsRows = result.events
    .map((e) => `<tr><td>${e.type}</td><td>${e.time.toFixed(2)} s</td><td>${fmtAltitude(e.altitude)}</td><td>${fmtVelocity(e.speed)}</td></tr>`)
    .join("");

  // A motor's guaranteed here (runFlightSim is never called without one -- see flightSimBlocked's
  // own call sites), so this is just "which rocket+motor pairing is this result for," not a null
  // check -- helpful once a user's compared a few different motors/rockets in a row and the numbers
  // alone don't say which combination they're looking at anymore.
  const motorLabel = rocket.motor ? `${rocket.motor.manufacturer} ${rocket.motor.designation}` : "an unknown motor";
  const article = /^[aeiou]/i.test(motorLabel) ? "an" : "a";

  return `
    <div class="section-divider"></div>
    <h3>Flight simulation <small>(ascent to apogee, ${windLabel})</small></h3>
    <p class="flight-sim-subject">${rocket.name} on ${article} ${motorLabel}</p>
    ${notFlyableHtml}
    ${stabilityWarningsHtml}
    <p><small>
      Tilt from vertical at burnout is the meaningful weathercocking-severity number — tilt
      naturally approaches ~90° for <em>any</em> stable rocket near its own apogee, as vertical
      velocity vanishes and the relative airspeed becomes dominated by the horizontal wind, so
      the flight-wide max isn't a useful stability indicator by itself.
    </small></p>
    ${warningsHtml}
    <div class="grid stats-grid">${stats}</div>
    <p>
      <small>Press and drag (or tap and hold) on a chart to scrub through the flight.</small>
      <button type="button" id="chart-cursor-reset" class="edit-pencil" aria-label="Clear chart scrub" title="Clear the pinned scrub reading" ${isScrubLocked() ? "" : "hidden"}>↺</button>
    </p>
    <div class="grid flight-charts-grid">
      <div id="chart-altitude" class="flight-chart"></div>
      <div id="chart-speed-mach" class="flight-chart"></div>
      <div id="chart-tilt" class="flight-chart"></div>
    </div>
    <figure>
      <table>
        <thead><tr><th>Event</th><th>Time</th><th>Altitude</th><th>Velocity</th></tr></thead>
        <tbody>${eventsRows}</tbody>
      </table>
    </figure>
    <p><small>${result.samples.length} integration samples, computed in ${elapsedMs.toFixed(1)} ms.</small></p>
  `;
}

async function performSearch(): Promise<void> {
  const resultsEl = document.querySelector<HTMLDivElement>("#motor-results");
  const submitBtn = document.querySelector<HTMLButtonElement>("#motor-search-form button[type=submit]");
  if (!resultsEl) return;

  const mfg = filterElement("manufacturer")?.value.trim() ?? "";
  const diameter = filterElement("diameter")?.value.trim() ?? "";
  const type = filterElement("type")?.value.trim() ?? "";
  const impulseClass = filterElement("impulseClass")?.value.trim() ?? "";
  const commonName = filterElement("commonName")?.value.trim() ?? "";
  const useAdapter = document.querySelector<HTMLInputElement>("#motor-adapter-checkbox")?.checked ?? false;

  const baseQuery = {
    manufacturer: mfg || undefined,
    commonName: commonName || undefined,
    type: type || undefined,
    impulseClass: impulseClass || undefined,
  };

  resultsEl.innerHTML = '<p aria-busy="true">Searching…</p>';
  submitBtn?.setAttribute("aria-busy", "true");
  try {
    // "Use motor adapter": ThrustCurve.org's diameter filter only accepts one exact value per
    // request (confirmed against the live API — no array/range support), so searching "this mount
    // size or smaller" means one request per standard diameter at or below the mount, merged and
    // deduped by motorId. Ignores the plain Diameter select in that case (adapter is the broader
    // query); with it unchecked, behaves exactly as before -- a single request at whatever
    // diameter is selected.
    if (useAdapter && activeMotorMountDiameterMm !== null) {
      const candidates = standardDiametersAtOrBelow(activeMotorMountDiameterMm);
      const resultSets = await Promise.all(candidates.map((d) => searchMotors({ ...baseQuery, diameter: d })));
      const merged = new Map<string, MotorSearchResult>();
      for (const results of resultSets) for (const r of results) merged.set(r.motorId, r);
      currentResults = [...merged.values()];
    } else {
      currentResults = await searchMotors({ ...baseQuery, diameter: diameter ? Number(diameter) : undefined });
    }
    sortState = null;
    initialThrustByMotorId = new Map();
    renderAndWireResults();
    void loadInitialThrustsForCurrentResults();
  } catch (err) {
    resultsEl.innerHTML = `<p><mark>Search failed: ${err instanceof Error ? err.message : String(err)}</mark></p>`;
  } finally {
    submitBtn?.removeAttribute("aria-busy");
  }
}

function wireMotorSearch(): void {
  const form = document.querySelector<HTMLFormElement>("#motor-search-form");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    syncFormToUrl();
    void performSearch();
  });

  for (const key of Object.keys(FILTER_DEFAULTS) as FilterKey[]) {
    const el = filterElement(key);
    el?.addEventListener(el.tagName === "SELECT" ? "change" : "input", syncFormToUrl);
  }
}

/**
 * Embed-mode state (see ui/embed.ts's own doc comment for the full splashcast contract). Resolved
 * once at bootstrap from the URL, before the first render, since renderWindSectionHtml/
 * renderWindBodyHtml need to know which of three states to show synchronously: normal manual-wind
 * entry (both null), a config error (embedConfigError set), or a valid embed session that's either
 * still loading its wind data (embedState set, windData still null) or ready (embedState.windData
 * set -- every available model gets simulated automatically, no picker to wait on here).
 */
interface EmbedState {
  parentOrigin: string;
  windUrl: string;
  hour: number;
  windData: SplashcastWindData | null;
  /** A content hash (see src/ui/sim-result-cache.ts's hashString) of the raw fetched windUrl JSON text -- null until the fetch resolves, alongside windData. Used as the sim-result cache's own "did the forecast actually change" key, so a byte-identical refetch of the SAME hour still hits the cache while a genuinely updated forecast correctly forces a rerun. */
  windContentFingerprint: string | null;
  /** From EmbedParams.autoSend (src/ui/embed.ts) -- splashcast's own explicit opt-in for a background/prefetch load, skipping the manual "Send to splashcast" review gate entirely (see runFlightSim's own use of this). */
  autoSend: boolean;
}
let embedState: EmbedState | null = null;
let embedConfigError: { message: string; parentOrigin: string | null } | null = null;
/** Set by restoreCachedConfigIfEmbedded when a cache-restored rocket+motor is ready to auto-run but wind data hasn't finished loading yet; cleared and fired by wireEmbedMode's own wind-load success handler once it has (see both functions' own doc comments -- restoring and wind-loading race, so whichever finishes second is the one that actually triggers the sim). */
let pendingEmbedAutoRunRocket: Rocket | null = null;

/** postMessage to embed mode's own parentOrigin -- a no-op outside embed mode (nothing to report to) or when a config error left no known parentOrigin to report to (see parseEmbedParams's own doc comment on that split). Never '*' -- always the exact origin embed mode was given. */
function postToEmbedParent(message: ReturnType<typeof buildAscentResultsMessage> | ReturnType<typeof buildErrorMessage>): void {
  const target = embedState?.parentOrigin ?? embedConfigError?.parentOrigin;
  if (!target || !window.parent) return;
  window.parent.postMessage(message, target);
}

/**
 * The part of the "Launch settings" article that varies by mode -- manual wind entry (normal), an
 * informational note (valid embed session -- no picker: splashcast's own `selectedModels` toggle
 * already shows/hides individual models on ITS side once it has every available model's own ascent
 * path, so there's nothing for a visitor to pick here), a loading placeholder (embed session, wind
 * fetch in flight), or an error (embed config error, or the wind fetch/parse itself failing).
 * Re-rendered into #wind-body once the async wind fetch settles (see wireEmbedMode); the rest of
 * the article (header, launch rod length) never changes shape between modes.
 */
function renderWindBodyHtml(): string {
  if (embedConfigError) {
    return `<p><mark>${embedConfigError.message}</mark></p>`;
  }
  if (embedState) {
    if (!embedState.windData) {
      return `<p aria-busy="true">Loading wind data for hour ${embedState.hour}…</p>`;
    }
    const models = embedState.windData.modelsForHour(embedState.hour);
    const cached = loadCachedConfig();
    return `
      <p><small>
        Real forecast wind for hour ${embedState.hour}:00, from splashcast --
        ${models.length} model${models.length === 1 ? "" : "s"} available (${models.map((m) => m.toUpperCase()).join(", ")}).
        Pick a rocket and motor below; every available model gets simulated and sent to splashcast, which shows or hides each one on its own side.
      </small></p>
      ${
        cached
          ? `<p><small>Remembered from your last visit: ${buildOutboundRocketConfig(cached).label}. <button type="button" id="clear-cached-rocket-btn" class="outline secondary">Clear &amp; start over</button></small></p>`
          : ""
      }
    `;
  }
  return `
    <div class="grid">
      <label>Constant wind speed (<span id="wind-speed-unit-label">m/s</span>) <input type="number" inputmode="decimal" id="wind-manual-speed" value="0" min="0" step="0.5" /></label>
      <label>From direction (deg, compass) <input type="number" inputmode="numeric" id="wind-manual-direction" value="0" min="0" max="360" step="5" /></label>
      <div style="align-self: end;">
        <button type="button" id="wind-manual-apply">Use constant wind</button>
      </div>
    </div>
    <p id="wind-active-label"><small>Currently: calm (no wind).</small></p>
  `;
}

function renderWindSectionHtml(): string {
  return `
  <article>
    <header>
      <h2>Launch settings</h2>
      <p>
        ${
          embedState || embedConfigError
            ? "Wind comes from splashcast's own launch-day forecast in embed mode, replacing manual entry."
            : `Sets the wind and launch rod length used by the flight simulation above (re-select a motor
        after changing either to re-run with the new setting) — a plain constant wind for now. Real
        altitude-varying wind comes from splashcast (the launch-day wind/drift predictor) when this
        app is embedded there, replacing manual entry.`
        }
      </p>
    </header>
    <div id="wind-body">${renderWindBodyHtml()}</div>
    <div class="grid">
      <label>Launch rod length (<span id="launch-rod-unit-label">m</span>) <input type="number" inputmode="decimal" id="launch-rod-length-input" min="0" step="0.5" /></label>
    </div>
  </article>
`;
}

let activeWindProfile: WindProfile | null = null;
/**
 * Launch rod length (m), a launch-site condition like wind -- persists across rocket switches
 * (never reset in applyParsedRocket, same as activeWindProfile), user-adjustable (see
 * wireLaunchRodInput). Defaults to 7ft (2.1336m): a common mid/high-power rail length, and
 * meaningfully longer than defaultRocket()'s own generic 1m default -- rod length affects rail-exit
 * velocity and hence how much of the rocket's own weathercocking/off-rail tip-off shows up in a
 * flight result, so leaving it at a short default silently understated it.
 */
let activeLaunchRodLengthM = 7 * 0.3048;

function updateActiveWindLabel(): void {
  const labelEl = document.querySelector<HTMLParagraphElement>("#wind-active-label");
  if (!labelEl) return;
  if (!activeWindProfile || activeWindProfile.samples.length === 0) {
    labelEl.innerHTML = "<small>Currently: calm (no wind).</small>";
    return;
  }
  const ground = windAt(activeWindProfile, 0);
  const label = activeWindProfile.label ?? "constant wind";
  labelEl.innerHTML = `<small>Currently: ${label} — ${fmtVelocity(ground.speed)} from ${ground.directionFromDeg.toFixed(0)}° at ground level.</small>`;
}

/** Updates the wind-speed input's unit label and converts its current value to the new unit system, preserving the underlying wind (doesn't change what "apply" would set). */
function updateWindManualUnitDisplay(): void {
  const labelEl = document.querySelector<HTMLSpanElement>("#wind-speed-unit-label");
  const speedEl = document.querySelector<HTMLInputElement>("#wind-manual-speed");
  if (!labelEl || !speedEl) return;
  labelEl.textContent = getUnitSystem() === "metric" ? "m/s" : "mph";
  // If a wind profile is actually active, that's the authoritative source for what number to
  // show (converted to the new unit). If not (nothing applied yet), there's no committed value
  // to convert from -- leave the field's raw number as-is, only the label changes.
  if (activeWindProfile) {
    const ms = windAt(activeWindProfile, 0).speed;
    speedEl.value = (getUnitSystem() === "metric" ? ms : ms * 2.23694).toFixed(1);
  }
}

function wireWindImport(): void {
  const manualSpeedEl = document.querySelector<HTMLInputElement>("#wind-manual-speed");
  const manualDirEl = document.querySelector<HTMLInputElement>("#wind-manual-direction");
  const manualApplyBtn = document.querySelector<HTMLButtonElement>("#wind-manual-apply");
  if (!manualSpeedEl || !manualDirEl || !manualApplyBtn) return;

  manualApplyBtn.addEventListener("click", () => {
    const rawSpeed = Number(manualSpeedEl.value) || 0;
    const speedMs = getUnitSystem() === "metric" ? rawSpeed : rawSpeed * 0.44704;
    const direction = Number(manualDirEl.value) || 0;
    activeWindProfile = speedMs > 0 ? constantWindProfile(speedMs, direction) : null;
    updateActiveWindLabel();
    // A flight sim already run reflects whatever wind was active AT THE TIME -- without this,
    // the only way to see a wind change take effect was to reselect a motor (which happens to
    // rebuild the rocket-with-motor object and re-run the sim as a side effect of an unrelated
    // action). Re-run directly here instead, if there's a motor to run it against.
    if (lastMotorSelection) {
      const motor = buildSelectedMotor(lastMotorSelection);
      void runFlightSim({ ...activeRocket, motor, windProfile: activeWindProfile, launchRodLength: activeLaunchRodLengthM });
    }
  });
}

/** Updates the launch-rod-length input's unit label and displayed value from activeLaunchRodLengthM -- called both at startup and on every unit toggle (same pattern as updateWindManualUnitDisplay), so the field always shows the actual active value converted to the current unit system, not a stale one left over from a previous unit. */
function updateLaunchRodLengthUnitDisplay(): void {
  const labelEl = document.querySelector<HTMLSpanElement>("#launch-rod-unit-label");
  const inputEl = document.querySelector<HTMLInputElement>("#launch-rod-length-input");
  if (!labelEl || !inputEl) return;
  labelEl.textContent = altitudeInputUnitLabel();
  inputEl.value = altitudeToInput(activeLaunchRodLengthM).toFixed(1);
}

/** Wires the launch-rod-length input -- unlike wind (speed+direction bundled behind an explicit "apply" button, since both need to be set together), this is a single independent value, so it commits live on change/blur rather than needing its own button. */
function wireLaunchRodInput(): void {
  const inputEl = document.querySelector<HTMLInputElement>("#launch-rod-length-input");
  if (!inputEl) return;

  inputEl.addEventListener("change", () => {
    const raw = Number(inputEl.value);
    if (!Number.isFinite(raw) || raw <= 0) {
      updateLaunchRodLengthUnitDisplay(); // revert the field to the last valid value
      return;
    }
    activeLaunchRodLengthM = altitudeFromInput(raw);
    // Same "re-run if a motor's already selected" pattern as wind's own apply handler -- a flight
    // sim already run reflects whatever rod length was active AT THE TIME.
    if (lastMotorSelection) {
      const motor = buildSelectedMotor(lastMotorSelection);
      void runFlightSim({ ...activeRocket, motor, windProfile: activeWindProfile, launchRodLength: activeLaunchRodLengthM });
    }
    saveCurrentConfigToCache();
  });
}

const orkSectionHtml = `
  <article>
    <header>
      <h2>Rocket</h2>
      <p>
        Select a rocket simfile from the library, or upload your own (.ork, .rkt, or .CDX1). 
      </p>
    </header>
    <details id="library-picker">
      <summary role="button" class="outline">Browse the rocket library</summary>
      <div class="grid">
        <label>Vendor <select id="lib-filter-vendor"><option value="">Any</option></select></label>
        <label>Diameter <select id="lib-filter-diameter"><option value="">Any</option></select></label>
        <label>Name <input type="text" id="lib-filter-name" placeholder="e.g. Darkstar" /></label>
      </div>
      <div id="library-results"><p><small>Filter by vendor, diameter, or name above to browse.</small></p></div>
    </details>
    <div class="grid" style="margin-top:1em;">
      <label>Or upload a file
        <input type="file" id="ork-file-input" accept=".ork,.rkt,.CDX1" />
      </label>
    </div>
    <div id="ork-warnings"></div>
    <div id="active-rocket-display"></div>
  </article>
`;

function renderActiveRocketDisplay(): void {
  const el = document.querySelector<HTMLDivElement>("#active-rocket-display");
  if (!el) return;
  // Mach 0.1 (~100fps) -- see renderFlightResultHtml's identical comment: the safety-relevant
  // rail-exit speed, not an arbitrary "typical flight" number.
  el.innerHTML = renderRocketSection(activeRocket, 0.1, activeRocketSource);
  updateMotorSectionAvailability();
}

/**
 * Shows an informational (non-blocking) notice when the active rocket has activeUnsupportedFeatures
 * (external pods, tube fins, ring tails, cluster motor mounts, multiple stages -- see its own doc
 * comment). Motor search/browsing stays fully available regardless -- a user can still want to know
 * what a motor looks like (thrust curve, mass, real ThrustCurve.org data) independent of whether
 * this project's aero model can simulate the rocket it'd go in. Only the actual flight simulation is
 * blocked (see the runFlightSim call sites, each gated on activeUnsupportedFeatures directly) --
 * this tool's aero/mass model has no representation for that geometry, so running a sim would
 * silently produce a wrong answer rather than a missing one. Called every time the active rocket
 * changes (renderActiveRocketDisplay), since that's the one thing that can flip
 * activeUnsupportedFeatures.
 */
function updateMotorSectionAvailability(): void {
  const noticeEl = document.querySelector<HTMLDivElement>("#motor-section-unsupported-notice");
  if (!noticeEl) return;

  const unsupported = activeUnsupportedFeatures.length > 0;
  noticeEl.hidden = !unsupported;
  noticeEl.innerHTML = unsupported
    ? `<p><mark>Not currently supported: ${activeUnsupportedFeatures.join(", ")}.</mark> This rocket's geometry isn't modeled well enough for a trustworthy flight simulation yet -- motor search still works, so you can still look up a motor's own data.</p>`
    : "";
}

function wireOrkImport(): void {
  const fileInput = document.querySelector<HTMLInputElement>("#ork-file-input");
  const warningsEl = document.querySelector<HTMLDivElement>("#ork-warnings");
  if (!fileInput || !warningsEl) return;

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    warningsEl.innerHTML = '<p aria-busy="true">Parsing…</p>';

    void (async () => {
      try {
        // Only .ork carries an embedded motor reference -- RockSim and RASAero files have no
        // motor data at all, only mount geometry (parseRocksimXml/parseRasaeroXml's results have
        // no `motor` field to begin with). Widened to include every optional field
        // applyParsedRocket/CachedParsedRocket can carry (not just the 4 always read directly
        // below) so this same `parsed` can also be handed straight to saveCurrentConfigToCache
        // without re-deriving a second, narrower view of the same parse result.
        let parsed: CachedParsedRocket;
        let motor: { manufacturer: string; designation: string } | null;
        if (lowerName.endsWith(".rkt")) {
          parsed = parseRocksimXml(await file.text());
          motor = null;
        } else if (lowerName.endsWith(".cdx1")) {
          parsed = parseRasaeroXml(await file.text(), file.name);
          motor = null;
        } else {
          const orkParsed = parseOrkXml(await unzipOrkXml(await file.arrayBuffer()));
          parsed = orkParsed;
          motor = orkParsed.motor;
        }

        applyParsedRocket(parsed, `Uploaded: ${file.name}`);
        activeParseWarnings = parsed.warnings;
        activeLibraryEntry = null; // an uploaded file has no library manifest entry to link a download to
        lastUploadedParsedRocket = parsed;
        lastUploadedFileName = file.name;

        const massNote = parsed.estimatedDryMassKg && parsed.estimatedDryMassKg > 0
          ? ` Dry mass prefilled at ${fmtMass(activeDryMassKg)} from the file's own (structural-only) component masses — check it, then set loaded CG below (pencil icons on each figure — CG is never guessed).`
          : " Set dry mass and loaded CG below (pencil icons on each figure — CG is never guessed).";
        const parseNote = parsed.warnings.length
          ? parsed.warnings.map((w) => `<mark>${w}</mark>`).join(" ")
          : `<small>Parsed ${parsed.components.length} components successfully.</small>`;
        warningsEl.innerHTML = `<p>${parseNote}${massNote}</p>`;

        renderActiveRocketDisplay();
        renderAndWireResults(); // this rocket's dry mass changed -- keep the motor table's T:W column in sync
        saveCurrentConfigToCache();

        if (motor) {
          const mfgEl = filterElement("manufacturer");
          const nameEl = filterElement("commonName");
          if (mfgEl) mfgEl.value = motor.manufacturer;
          // motor.designation is the .ork file's own <designation> value (e.g. "C6") -- simple
          // enough in practice to work fine as a commonName search too, given forgiving matching.
          if (nameEl) nameEl.value = motor.designation;
          syncFormToUrl();
          void performSearch();
          warningsEl.innerHTML += `<p><small>File's default motor was ${motor.manufacturer} ${motor.designation} — pre-filled the motor search below.</small></p>`;
        }
      } catch (err) {
        warningsEl.innerHTML = `<p><mark>Failed to import: ${err instanceof Error ? err.message : String(err)}</mark></p>`;
      }
    })();
  });
}

/** Populates the vendor/diameter filter <select>s from whatever's actually in the loaded manifest — never hardcoded, so a future library addition (new vendor, new diameter class) just works without a UI change. */
function populateLibraryFilterOptions(): void {
  const vendorSelect = document.querySelector<HTMLSelectElement>("#lib-filter-vendor");
  const diameterSelect = document.querySelector<HTMLSelectElement>("#lib-filter-diameter");
  if (!vendorSelect || !diameterSelect) return;

  const vendors = [...new Set(libraryManifest.map((e) => e.vendor))].sort();
  vendorSelect.innerHTML = `<option value="">Any</option>${vendors.map((v) => `<option value="${v}">${v}</option>`).join("")}`;

  const diameters = [...new Set(libraryManifest.map((e) => nominalDiameterIn(e.diameterMm)))].sort((a, b) => a - b);
  diameterSelect.innerHTML = `<option value="">Any</option>${diameters.map((d) => `<option value="${d}">${d}" (${(d * 25.4).toFixed(0)}mm class)</option>`).join("")}`;
}

/**
 * Live client-side filter over the already-loaded manifest (no network
 * round-trip per keystroke, unlike the ThrustCurve.org motor search) —
 * shows nothing until at least one filter is active, per this library's
 * design: with 260+ entries, an unfiltered dump isn't useful, and the
 * empty state should read as "search me," not "broken."
 */
interface LibraryColumn {
  key: string;
  label: string;
  format: (e: LibraryManifestEntry) => string;
  value: (e: LibraryManifestEntry) => string | number | undefined;
}

// Sort by the raw underlying number (diameterMm/lengthMm), not the rounded/formatted display
// value (nominal-inch bucket, cm-or-in string) -- two entries that round to the same displayed
// bucket should still order consistently by their real size, not tie/shuffle arbitrarily.
const LIBRARY_COLUMNS: LibraryColumn[] = [
  { key: "vendor", label: "Vendor", format: (e) => e.vendor, value: (e) => e.vendor },
  { key: "name", label: "Name", format: (e) => e.name, value: (e) => e.name },
  { key: "diameter", label: "Diameter", format: (e) => `${nominalDiameterIn(e.diameterMm)}"`, value: (e) => e.diameterMm },
  { key: "length", label: "Length", format: (e) => fmtRocketLength(e.lengthMm / 1000), value: (e) => e.lengthMm },
];

let librarySortState: { key: string; dir: 1 | -1 } | null = null;

function sortedLibraryMatches(matches: LibraryManifestEntry[]): LibraryManifestEntry[] {
  if (!librarySortState) return matches;
  const column = LIBRARY_COLUMNS.find((c) => c.key === librarySortState!.key);
  if (!column) return matches;
  return [...matches].sort((a, b) => compareValues(column.value(a), column.value(b), librarySortState!.dir));
}

function renderLibraryResults(): void {
  const resultsEl = document.querySelector<HTMLDivElement>("#library-results");
  const vendorSelect = document.querySelector<HTMLSelectElement>("#lib-filter-vendor");
  const diameterSelect = document.querySelector<HTMLSelectElement>("#lib-filter-diameter");
  const nameInput = document.querySelector<HTMLInputElement>("#lib-filter-name");
  if (!resultsEl || !vendorSelect || !diameterSelect || !nameInput) return;

  const vendor = vendorSelect.value;
  const diameter = diameterSelect.value ? Number(diameterSelect.value) : null;
  const nameQuery = nameInput.value.trim().toLowerCase();

  if (!vendor && diameter === null && !nameQuery) {
    resultsEl.innerHTML = "<p><small>Filter by vendor, diameter, or name above to browse.</small></p>";
    return;
  }

  const matches = libraryManifest.filter((e) => {
    if (vendor && e.vendor !== vendor) return false;
    if (diameter !== null && nominalDiameterIn(e.diameterMm) !== diameter) return false;
    if (nameQuery && !e.name.toLowerCase().includes(nameQuery)) return false;
    return true;
  });

  if (matches.length === 0) {
    resultsEl.innerHTML = "<p><small>No matches.</small></p>";
    return;
  }

  const sorted = sortedLibraryMatches(matches);
  const rows = sorted
    .slice(0, 200) // a broad filter (e.g. vendor-only) can still match 100+; cap the DOM cost, name/diameter narrows it down fast
    .map((e) => {
      const cells = LIBRARY_COLUMNS.map((c) => `<td>${c.format(e)}</td>`).join("");
      return `<tr>${cells}<td><a href="#" data-lib-id="${e.id}">Select</a></td></tr>`;
    })
    .join("");
  const truncatedNote = matches.length > 200 ? `<p><small>${matches.length} matches, showing first 200 — narrow the filter to see more.</small></p>` : "";

  const headers = LIBRARY_COLUMNS.map((c) => {
    const arrow = librarySortState?.key === c.key ? (librarySortState.dir === 1 ? " ▲" : " ▼") : "";
    return `<th class="sortable-th" data-sort-key="${c.key}">${c.label}${arrow}</th>`;
  }).join("");

  resultsEl.innerHTML = `
    ${truncatedNote}
    <figure>
      <table>
        <thead><tr>${headers}<th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </figure>
  `;

  resultsEl.querySelectorAll<HTMLAnchorElement>("a[data-lib-id]").forEach((a) => {
    a.addEventListener("click", (evt) => {
      evt.preventDefault();
      const entry = libraryManifest.find((e) => e.id === a.dataset["libId"]);
      if (!entry) return;
      void selectLibraryEntry(entry).then(() => syncSelectedRocketToUrl(entry));
    });
  });
  resultsEl.querySelectorAll<HTMLTableCellElement>("th[data-sort-key]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset["sortKey"]!;
      librarySortState = librarySortState?.key === key ? { key, dir: librarySortState.dir === 1 ? -1 : 1 } : { key, dir: 1 };
      renderLibraryResults();
    });
  });
}

/** Fetches and parses the selected library entry's real .rkt file (only now, not for all 260+ entries up front) and makes it the active rocket. */
async function selectLibraryEntry(entry: LibraryManifestEntry): Promise<void> {
  const warningsEl = document.querySelector<HTMLDivElement>("#ork-warnings");
  const pickerEl = document.querySelector<HTMLDetailsElement>("#library-picker");
  if (warningsEl) warningsEl.innerHTML = `<p aria-busy="true">Loading ${entry.name}…</p>`;

  try {
    const res = await fetch(entry.path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseRocksimXml(await res.text());
    applyParsedRocket(parsed, `From the library: ${entry.vendor} — ${entry.name}`, entry.name);
    activeParseWarnings = parsed.warnings;
    activeLibraryEntry = entry;
    lastUploadedParsedRocket = null; // mutually exclusive with a library pick -- see its own doc comment
    lastUploadedFileName = null;

    if (warningsEl) {
      const parseNote = parsed.warnings.length
        ? parsed.warnings.map((w) => `<mark>${w}</mark>`).join(" ")
        : `<small>Loaded "${entry.name}" from the library.</small>`;
      warningsEl.innerHTML = `<p>${parseNote}</p>`;
    }
    if (pickerEl) pickerEl.open = false;
    renderActiveRocketDisplay();
    renderAndWireResults(); // this rocket's dry mass changed -- keep the motor table's T:W column in sync
    saveCurrentConfigToCache();
  } catch (err) {
    if (warningsEl) warningsEl.innerHTML = `<p><mark>Failed to load ${entry.name}: ${err instanceof Error ? err.message : String(err)}</mark></p>`;
  }
}

function wireLibraryPicker(): void {
  const vendorSelect = document.querySelector<HTMLSelectElement>("#lib-filter-vendor");
  const diameterSelect = document.querySelector<HTMLSelectElement>("#lib-filter-diameter");
  const nameInput = document.querySelector<HTMLInputElement>("#lib-filter-name");
  if (!vendorSelect || !diameterSelect || !nameInput) return;

  vendorSelect.addEventListener("change", renderLibraryResults);
  diameterSelect.addEventListener("change", renderLibraryResults);
  nameInput.addEventListener("input", renderLibraryResults);
}

/**
 * Loads the manifest and populates the browse UI — runs once at startup. A "rocket" URL param (set
 * by selectLibraryEntry whenever a user actually picks one) takes priority when present and still
 * resolves to a real manifest entry, so a shared/bookmarked link opens directly on that rocket;
 * otherwise nothing is auto-selected -- a fresh visit lands on the plain browse/upload UI with no
 * rocket preloaded, rather than always defaulting to LOC-IV.
 */
async function initLibrary(): Promise<void> {
  try {
    libraryManifest = await loadLibraryManifest();
    populateLibraryFilterOptions();
    wireLibraryPicker();

    const urlRocketSlug = new URLSearchParams(location.search).get("rocket");
    const urlEntry = urlRocketSlug ? findLibraryEntryBySlug(libraryManifest, urlRocketSlug) : undefined;
    if (urlEntry) {
      await selectLibraryEntry(urlEntry);
    } else {
      // No rocket auto-loaded -- the initial "Loading the rocket library…" placeholder (set at
      // module scope) would otherwise sit there forever once loading actually finishes.
      activeRocketSource = "Browse the library below, or upload a file, to get started.";
      renderActiveRocketDisplay();
    }
  } catch (err) {
    activeRocketSource = `Failed to load the rocket library: ${err instanceof Error ? err.message : String(err)} — upload a file instead.`;
    renderActiveRocketDisplay();
  }
}

// --- Metric/imperial toggle ---
/** "units" URL param values -- short and human-typeable (matching the button labels themselves), not the internal "metric"/"imperial" strings. */
function unitSystemToUrlValue(system: UnitSystem): "cm" | "in" {
  return system === "metric" ? "cm" : "in";
}
function urlValueToUnitSystem(value: "cm" | "in"): UnitSystem {
  return value === "cm" ? "metric" : "imperial";
}
/** Matches units.ts's own default (imperial) -- kept out of the URL when selected, same "clean URL for default state" rule as the motor filter params, so only an explicit switch to metric shows up as ?units=cm. */
const UNITS_URL_DEFAULT: "cm" | "in" = "in";

/** Applies a "units" URL param (cm/in), if present, before the very first render -- so the toggle's initial aria-current and every formatted value on the page are correct from the start, not flashing from the imperial default to metric (or vice versa) right after load. */
function applyUnitsFromUrl(): void {
  const value = new URLSearchParams(location.search).get("units");
  if (value === "cm" || value === "in") setUnitSystem(urlValueToUnitSystem(value));
}

function renderUnitToggleHtml(): string {
  const system = getUnitSystem();
  return `
    <div role="group" id="unit-toggle" aria-label="Units">
      <button type="button" data-unit="metric" aria-current="${system === "metric"}">cm</button>
      <button type="button" data-unit="imperial" aria-current="${system === "imperial"}">in</button>
    </div>
  `;
}

/** Re-renders every currently-populated section so a unit toggle takes effect everywhere at once — mass and CG stat cards have no separate unit-label elements to sync, they re-render their formatted values directly via renderActiveRocketDisplay below. */
function refreshAllUnitDisplays(): void {
  renderActiveRocketDisplay();
  if (libraryManifest.length > 0) renderLibraryResults();
  renderAndWireResults();
  if (lastMotorSelection) {
    renderMotorDetailAndMountChart(lastMotorSelection.meta, lastMotorSelection.samples);
    rerenderFlightResultOnly();
  }
  updateWindManualUnitDisplay();
  updateActiveWindLabel();
  updateLaunchRodLengthUnitDisplay();
}

function wireUnitToggle(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>("#unit-toggle button[data-unit]");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const system = btn.dataset["unit"] as UnitSystem;
      if (system === getUnitSystem()) return;
      setUnitSystem(system);
      buttons.forEach((b) => b.setAttribute("aria-current", String(b === btn)));
      refreshAllUnitDisplays();
      updateUrlParams((params) => {
        const urlValue = unitSystemToUrlValue(system);
        if (urlValue === UNITS_URL_DEFAULT) params.delete("units");
        else params.set("units", urlValue);
      });
    });
  });
}

/**
 * Resolves embed-mode state from the URL synchronously, BEFORE the first app.innerHTML render --
 * renderWindSectionHtml/renderWindBodyHtml read embedState/embedConfigError directly, so this must
 * run before that first render, not alongside the other wire*() calls that run after it (see
 * wireEmbedMode below for the async/side-effecting half of embed setup).
 */
function resolveEmbedParamsAtBootstrap(): void {
  const parsed = parseEmbedParams(new URLSearchParams(location.search));
  if (parsed === null) return; // normal mode, nothing to do
  if ("error" in parsed) {
    embedConfigError = { message: parsed.error, parentOrigin: parsed.parentOrigin };
    return;
  }
  embedState = { parentOrigin: parsed.parentOrigin, windUrl: parsed.windUrl, hour: parsed.hour, windData: null, windContentFingerprint: null, autoSend: parsed.autoSend };
}

/** Re-renders just the #wind-body slot -- same targeted-update pattern as #motor-results/#library-results elsewhere in this file, so an async wind-data update doesn't disturb the rest of the (already-interacted-with) page. */
function rerenderWindBody(): void {
  const el = document.querySelector<HTMLDivElement>("#wind-body");
  if (el) el.innerHTML = renderWindBodyHtml();
}

/**
 * The async/side-effecting half of embed setup -- called once after the initial render (see the
 * bootstrap below). Posts the config-error message (if any) now that there's a parent frame to
 * post to, and kicks off the wind fetch+parse for a valid embed session. No model-picker wiring --
 * there's no picker (see renderWindBodyHtml's own doc comment); once wind data loads, the FIRST
 * available model becomes activeWindProfile purely so this project's own local UI (the single
 * flight-sim-results panel a visitor sees while embedded) has something representative to show --
 * the actual multi-model work happens independently in runEmbedMultiModelSim, using every
 * available model, not just this one.
 */
function wireEmbedMode(): void {
  if (embedConfigError) {
    postToEmbedParent(buildErrorMessage(embedConfigError.message));
    return;
  }
  if (!embedState) return;

  const { windUrl, hour } = embedState;
  void fetch(windUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`Wind data request failed (HTTP ${res.status}).`);
      return res.text();
    })
    .then((text) => {
      // Fetched as text (not res.json() directly) so the RAW bytes can be hashed for the sim-result
      // cache's own "did the forecast actually change" key (see sim-result-cache.ts) -- re-serializing
      // the parsed object back to JSON to hash it would risk key-order drift producing a spurious
      // "changed" hash for byte-identical data.
      const windContentFingerprint = hashString(text);
      const data = parseSplashcastWindData(JSON.parse(text));
      const models = data.modelsForHour(hour);
      if (models.length === 0) {
        throw new Error(`No wind data available for hour ${hour}.`);
      }
      embedState!.windData = data;
      embedState!.windContentFingerprint = windContentFingerprint;
      activeWindProfile = data.profileFor(hour, models[0]!);
      updateActiveWindLabel();
      rerenderWindBody();
      // Covers the (unlikely but possible) case where a visitor finishes picking a rocket+motor --
      // and so already has a local result to review -- before this wind fetch itself resolves; the
      // send button was hidden until now (see updateEmbedSendButton's own windData gate).
      updateEmbedSendButton();
      // A cache-restored rocket+motor (see restoreCachedConfigIfEmbedded) may have finished BEFORE
      // this wind fetch resolved, in which case it left a rocket here waiting for wind data to
      // actually run against -- fire it now that wind's ready. Ordering the other way (wind first,
      // restore later) is handled on restore's own side instead (see its own doc comment).
      if (pendingEmbedAutoRunRocket) {
        const rocket = pendingEmbedAutoRunRocket;
        pendingEmbedAutoRunRocket = null;
        void runFlightSim(rocket);
      }
    })
    .catch((err) => {
      const reason = err instanceof Error ? err.message : String(err);
      const message = `Could not load wind data for hour ${hour}: ${reason}`;
      embedConfigError = { message, parentOrigin: embedState!.parentOrigin };
      embedState = null; // fall back to the error-body branch in renderWindBodyHtml
      postToEmbedParent(buildErrorMessage(message));
      rerenderWindBody();
    });
}

/**
 * A rocket's own sim-relevant state, fingerprinted for the sim-result cache's cache key (see
 * sim-result-cache.ts) -- everything on Rocket EXCEPT windProfile (that's covered separately, via
 * the forecast content hash + model + hour, since the same rocket gets simulated against several
 * different wind profiles per call here). Deliberately the raw Rocket object, not a hand-picked list
 * of fields: whatever actually feeds simulateFlight3D (components, mass, CG, motor, launch rod
 * length, launch altitude) automatically stays covered without this needing to be kept in sync by
 * hand as those fields evolve. cpOverrideM/cpOverrideSource are correctly NOT included here since
 * they're not part of Rocket at all -- display-only, never fed to the sim (see their own doc
 * comments in main.ts) -- so editing CP correctly does NOT invalidate this fingerprint.
 */
function computeSimFingerprint(rocket: Rocket): string {
  const { windProfile: _windProfile, ...rest } = rocket;
  return hashString(JSON.stringify(rest));
}

/**
 * Runs the flight sim once per forecast model actually available for embedState's own hour (not a
 * fixed count, not user-chosen -- see renderWindBodyHtml's own doc comment), collecting one
 * AscentPath per model, and posts them all together as a single rocketry:ascentResults message.
 * Stability is rocket-geometry-only (never depends on wind), so it's computed once, not per model.
 * A single model's own sim throwing doesn't take down the rest -- skipped with a console warning,
 * not a fatal error, since the other models' own runs are independently valid regardless. Only
 * posts an error if EVERY model failed (nothing usable to send at all).
 *
 * Checks the sim-result cache (see sim-result-cache.ts) before actually simulating each model --
 * scrubbing splashcast's own time slider back to an hour already visited earlier in this browsing
 * session, with the same rocket+motor+overrides and an unchanged forecast, returns the previous
 * result instantly instead of re-running a real numerical simulation for identical inputs.
 */
async function runEmbedMultiModelSim(rocket: Rocket): Promise<void> {
  if (!embedState?.windData || !embedState.windContentFingerprint) return;
  const { windData, hour, windContentFingerprint } = embedState;
  const models = windData.modelsForHour(hour);
  const rocketFingerprint = computeSimFingerprint(rocket);

  const results: ModelAscentResult[] = [];
  for (const model of models) {
    const cacheKey = buildSimCacheKey({ forecastFingerprint: windContentFingerprint, hour, model, rocketFingerprint });
    const cached = loadCachedSimResult(cacheKey);
    if (cached) {
      results.push({ model, ascentPath: cached });
      continue;
    }
    try {
      const windProfile = windData.profileFor(hour, model);
      const modelRocket: Rocket = { ...rocket, windProfile };
      const result = await simulateFlight3DInWorker(modelRocket);
      const ascentPath = buildAscentPath(result, modelRocket);
      results.push({ model, ascentPath });
      saveCachedSimResult(cacheKey, ascentPath);
    } catch (err) {
      console.warn(`Skipping model "${model}" in embed multi-model sim:`, err);
    }
  }

  if (results.length === 0) {
    postToEmbedParent(buildErrorMessage(`Flight simulation failed for every available model (${models.join(", ")}).`));
    return;
  }

  const stability = computeLiftoffStability(rocket);
  const cachedConfig = loadCachedConfig();
  const rocketConfig = cachedConfig ? buildOutboundRocketConfig(cachedConfig) : undefined;
  postToEmbedParent(buildAscentResultsMessage(rocket.name, activeParseWarnings, stability, results, rocketConfig));
}

/**
 * Snapshot restore counterpart to saveCurrentConfigToCache -- reapplies a cached rocket+motor+
 * overrides config (see src/ui/rocket-cache.ts) in embed mode ONLY, so a repeat splashcast-embed
 * visit in the same browser skips straight back to "just rerun with today's weather" instead of
 * redoing the whole rocket pick / motor search / CG-mass-CP entry every single time (splashcast
 * fully tears down and rebuilds the iframe on every modal close/open, but always from this same
 * origin -- see this feature's own plan file for the confirmed details). Deliberately scoped to
 * embed mode -- normal browsing already has its own `?rocket=` URL-param auto-load (initLibrary),
 * and layering a second silent auto-restore mechanism on top of that in normal mode would make it
 * ambiguous which one "won" on any given visit.
 *
 * Called once, after initLibrary() has resolved (so a library-sourced cache entry can be looked up
 * in the now-populated libraryManifest) -- see the bootstrap below. A no-op if something's already
 * loaded (e.g. a `?rocket=` URL param initLibrary itself already handled) or if there's nothing
 * cached yet.
 */
async function restoreCachedConfigIfEmbedded(): Promise<void> {
  if (!embedState) return;
  if (activeRocket.components.length > 0) return; // something already loaded -- don't clobber it
  const cached = loadCachedConfig();
  if (!cached) return;

  if (cached.rocketSource.kind === "library") {
    const entryId = cached.rocketSource.entryId;
    const entry = libraryManifest.find((e) => e.id === entryId);
    if (!entry) return; // soft cache -- the library entry was renamed/removed since, just skip silently
    await selectLibraryEntry(entry);
  } else {
    const { parsed, fileName } = cached.rocketSource;
    applyParsedRocket(parsed, `Restored from your last session (uploaded: ${fileName})`, parsed.name);
    activeParseWarnings = parsed.warnings;
    activeLibraryEntry = null;
    lastUploadedParsedRocket = parsed;
    lastUploadedFileName = fileName;
    renderActiveRocketDisplay();
    renderAndWireResults();
  }

  applyRestoredOverridesAndMotor(cached);
  // The rocket-load step above (selectLibraryEntry/applyParsedRocket) triggers its own
  // saveCurrentConfigToCache internally, using module state AS OF THAT MOMENT -- lastMotorSelection
  // hasn't been restored yet at that point, so it saves a motor-less snapshot, clobbering the very
  // cache entry this function is restoring FROM. Re-save now that every piece (rocket, overrides,
  // motor) is actually in place, so the on-disk cache ends up correct regardless of what happened
  // in between.
  saveCurrentConfigToCache();
}

/** The override-reapply + motor-restore half of restoreCachedConfigIfEmbedded, split out since the library and upload branches above both need to run it identically once the base rocket itself is loaded. */
function applyRestoredOverridesAndMotor(cached: CachedRocketConfig): void {
  activeDryMassKg = cached.overrides.dryMassKg;
  activeLoadedCgM = cached.overrides.cgM;
  cgOverriddenByUser = cached.overrides.cgOverriddenByUser;
  activeCpOverrideM = cached.overrides.cpOverrideM;
  cpOverrideSource = cached.overrides.cpOverrideSource;
  activeLaunchRodLengthM = cached.overrides.launchRodLengthM;
  dryMassOverriddenViaLoadedEdit = false; // a restored mass is a fresh baseline, not entangled with any specific motor's own mass
  rederiveDryCg();
  updateLaunchRodLengthUnitDisplay();
  renderActiveRocketDisplay();

  if (!cached.motor) return;
  lastMotorSelection = {
    meta: cached.motor.meta,
    samples: cached.motor.samples,
    realMassBasis: cached.motor.realMassBasis,
    sourceFormat: cached.motor.sourceFormat,
    sourceQuality: cached.motor.sourceQuality,
  };
  const rocketWithMotor = renderMotorDetailAndMountChart(cached.motor.meta, cached.motor.samples);
  renderActiveRocketDisplay();
  if (!rocketWithMotor || flightSimBlocked()) return;

  if (embedState?.windData) {
    void runFlightSim(rocketWithMotor);
  } else {
    // Wind hasn't finished loading yet -- wireEmbedMode's own wind-load success handler picks this
    // up and fires it once it has (see pendingEmbedAutoRunRocket's own doc comment).
    pendingEmbedAutoRunRocket = rocketWithMotor;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  applyUnitsFromUrl(); // before building HTML below, so the toggle + every formatted value start correct
  resolveEmbedParamsAtBootstrap(); // before building HTML below, so renderWindSectionHtml sees the right mode
  app.innerHTML = `
    ${renderUnitToggleHtml()}
    <button type="button" id="embed-send-btn" hidden></button>
    <main class="container">
      <hgroup>
        <h1>🚀 rocketry — flight simulator</h1>
        <p>
          A web flight simulator for basic rockets. Licensed GPLv3, matching
          <a href="https://github.com/openrocket/openrocket" target="_blank" rel="noopener">OpenRocket</a>,
          so physics can directly follow OpenRocket's own published algorithms (many ported
          straight from its source, e.g. fin normal-force and center-of-pressure through transonic
          and supersonic flight) rather than maintaining an independently re-derived model, with a
          handful of deliberate, documented deviations where this project does something different
          on purpose.
          Report issues and/or share real flight data with Ezra. Real data improves simulators.
          <a href="validation-report.html" target="_blank" rel="noopener">Validation report</a> ·
          <a href="deviations.html" target="_blank" rel="noopener">Deviations from OpenRocket</a>.
        </p>
      </hgroup>
      <div class="alpha-notice">
        <strong>⚠ Alpha — presented for testing, not a replacement for established simulators.</strong>
        This is an early-stage project shared for feedback, not a validated substitute for
        OpenRocket, RockSim, or RASAero. Cross-check anything safety-relevant (stability margin,
        motor selection) against a mature simulator before relying on it for a real flight.
      </div>
      ${orkSectionHtml}
      ${renderWindSectionHtml()}
      ${motorSectionHtml}
    </main>
  `;
  renderActiveRocketDisplay();
  wireOrkImport();
  wireMotorSearch();
  wireWindImport();
  wireEmbedMode();
  wireEmbedSendButton();
  wireLaunchRodInput();
  updateLaunchRodLengthUnitDisplay();
  wireUnitToggle();
  wireInfoToggles();
  wireMassStatEdit();
  wireCgStatEdit();
  wireCpStatEdit();
  wireNoseWeightPanel();
  wireChartCursorReset();
  document.querySelector("#app")?.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("#clear-cached-rocket-btn")) return;
    clearCachedConfig();
    rerenderWindBody();
  });
  void initLibrary().then(() => {
    if (embedState) void restoreCachedConfigIfEmbedded();
  });
  const urlParams = new URLSearchParams(location.search);
  const hadUrlFilters = (Object.keys(FILTER_DEFAULTS) as FilterKey[]).some((k) => urlParams.has(k));
  void loadMotorMetadata().then(() => {
    // A shared/bookmarked search URL should actually run the search, not just preselect the filters.
    if (hadUrlFilters) void performSearch();
  });
}
