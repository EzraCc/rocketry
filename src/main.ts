import "@picocss/pico/css/pico.indigo.min.css";
import "./style.css";
import { computeBarrowman, stabilityMargin } from "./physics/aero/barrowman.js";
import { checkStability } from "./physics/aero/stability-check.js";
import { renderSchematicSvg } from "./ui/schematic/render.js";
import { defaultRocket, type Rocket, type SelectedMotor } from "./model/rocket.js";
import { isBodyComponent, type Component } from "./model/component.js";
import { unzipOrkXml } from "./formats/ork/unzip.js";
import { parseOrkXml } from "./formats/ork/parse.js";
import { parseRocksimXml } from "./formats/rocksim/parse.js";
import { parseRasaeroXml } from "./formats/rasaero/parse.js";
import {
  searchMotors,
  downloadThrustSamples,
  getMotorMetadata,
  type MotorSearchResult,
  type ThrustSample,
} from "./physics/motor/thrustcurve-client.js";
import { burnTime, getThrustAt, totalImpulse } from "./physics/motor/motor-model.js";
import { deriveMotorMassCurve, getMotorMassAt } from "./physics/mass/motor-mass-curve.js";
import { combinedMassAt } from "./physics/mass/combined-mass.js";
import type { SimResult3D } from "./physics/sim/types3d.js";
import { renderFlightChart } from "./ui/charts/flight-chart.js";
import { simulateFlight3DInWorker } from "./worker/sim-worker-client.js";
import { parseSplashcastWindData, type SplashcastWindData } from "./physics/wind/splashcast-import.js";
import { windAt, constantWindProfile, type WindProfile } from "./model/wind.js";
import {
  getUnitSystem,
  setUnitSystem,
  type UnitSystem,
  fmtLength,
  fmtAltitude,
  fmtMass,
  fmtVelocity,
  fmtForce,
  fmtImpulse,
  massInputUnitLabel,
  massToInput,
  massFromInput,
  lengthInputUnitLabel,
  lengthToInput,
  lengthFromInput,
} from "./ui/units.js";

const MM = 0.001;

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
interface LibraryManifestEntry {
  id: string;
  vendor: string;
  name: string;
  path: string; // relative to the site root, e.g. "library/apogee/Zephyr.rkt"
  diameterMm: number;
  lengthMm: number;
  warnings: boolean;
}

let libraryManifest: LibraryManifestEntry[] = [];

/**
 * Reference CP values to show for library entries with a known-good
 * independent value to compare against (currently just LOC-IV, validated
 * elsewhere in this project against RockSim's own stored CP) — keyed by
 * manifest PATH, not id: ids are assigned sequentially at manifest-generation
 * time (see scripts that rebuild public/library/manifest.json), so they
 * shift whenever that vendor's entry count changes; path is the one thing
 * guaranteed stable across regenerations for the same underlying file.
 */
const LIBRARY_KNOWN_CP: Record<string, { label: string; mm: number }[]> = {
  "library/loc/PK-48 LOC-IV.rkt": [
    { label: "RockSim classical Barrowman CP (BarromanXN)", mm: 899.247 },
    { label: "RockSim proprietary extended-method CP (RockSimXN)", mm: 972.645 },
  ],
};

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
  parsed: { name: string; components: Component[]; estimatedDryMassKg?: number },
  source: string,
  knownCp?: { label: string; mm: number }[],
  displayName?: string,
): void {
  const motorMountComponent = parsed.components.find((c) => c.type === "bodytube" && c.isMotorMount);
  const bodyComponents = parsed.components.filter(isBodyComponent);
  const motorMountId = motorMountComponent?.id ?? bodyComponents[bodyComponents.length - 1]?.id ?? "";
  const massEl = document.querySelector<HTMLInputElement>("#ork-dry-mass");
  const dryMass =
    parsed.estimatedDryMassKg && parsed.estimatedDryMassKg > 0 ? parsed.estimatedDryMassKg : massFromInput(Number(massEl?.value) || 50);

  activeRocket = {
    ...defaultRocket(),
    // Library selections pass the manifest's curated name (human-verified, matches what the
    // browse/search UI showed) rather than the file's own internal RockSim <Name> tag, which is
    // sometimes cryptic or inconsistent with it (e.g. one real case: "LOC-1 Magnum" internally vs.
    // "LOC-I Magnum" on the vendor's own site -- a 1/I typo in the file, not a display bug). File
    // uploads have no curated name to fall back to, so they keep using the file's own name.
    name: displayName ?? parsed.name,
    components: parsed.components,
    dryMass,
    dryCg: 0, // forces the user to actually enter it -- never guessed from geometry
    motorMount: { componentId: motorMountId, motorOverhang: 0 },
  };
  activeKnownCp = knownCp;
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
/** Reference CP values to show alongside the active rocket, when it came from a library entry with known-good values to compare against — cleared when a file is uploaded instead. */
let activeKnownCp: { label: string; mm: number }[] | undefined;
let activeRocketSource = "Loading the rocket library…";

function stat(label: string, value: string): string {
  return `<div><strong>${value}</strong><br /><small>${label}</small></div>`;
}

function renderRocketSection(rocket: Rocket, mach: number, subtitle: string, knownCp?: { label: string; mm: number }[]): string {
  const { cpX, refDiameter } = computeBarrowman(rocket.components, mach);
  const hasCg = rocket.dryCg > 0;
  const margin = hasCg ? stabilityMargin(cpX, rocket.dryCg, refDiameter) : null;

  const stats = [
    stat("Computed CP", fmtLength(cpX)),
    hasCg ? stat("CG (manual)", fmtLength(rocket.dryCg)) : "",
    stat("Ref. diameter", fmtLength(refDiameter)),
    margin !== null
      ? stat(
          "Stability margin",
          `<span style="color: ${margin > 0 ? "var(--pico-ins-color, #2a8f4d)" : "var(--pico-del-color, #c0392b)"};">${margin.toFixed(2)} cal (${margin > 0 ? "stable" : "unstable"})</span>`,
        )
      : "",
  ]
    .filter(Boolean)
    .join("");

  const knownCpRows = (knownCp ?? [])
    .map((k) => {
      const kM = k.mm * MM;
      const deltaM = cpX - kM;
      const deltaPct = (deltaM / kM) * 100;
      return `<tr><td>${k.label}</td><td>${fmtLength(kM)}</td><td>${deltaM >= 0 ? "+" : ""}${fmtLength(deltaM)} (${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%)</td></tr>`;
    })
    .join("");

  return `
    <article>
      <header>
        <h2>${rocket.name}</h2>
        <p>${subtitle} · static Barrowman results at Mach ${mach}${hasCg ? "" : " — mass/CG not entered, so no stability margin is shown"}</p>
      </header>
      <div class="grid stats-grid">${stats}</div>
      ${
        knownCpRows
          ? `<figure>
              <table>
                <thead><tr><th>Known CP (reference)</th><th>Value</th><th>Δ vs. computed</th></tr></thead>
                <tbody>${knownCpRows}</tbody>
              </table>
            </figure>`
          : ""
      }
      <figure class="schematic">
        ${renderSchematicSvg(rocket.components, cpX, hasCg ? rocket.dryCg : undefined)}
      </figure>
    </article>
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

/** Writes current filter values into the URL query string (via replaceState, so it doesn't spam browser history), omitting anything still at its default. */
function syncFormToUrl(): void {
  const params = new URLSearchParams();
  for (const key of Object.keys(FILTER_DEFAULTS) as FilterKey[]) {
    const value = filterElement(key)?.value.trim() ?? "";
    if (value && value !== FILTER_DEFAULTS[key]) params.set(key, value);
  }
  const query = params.toString();
  history.replaceState(null, "", query ? `${location.pathname}?${query}` : location.pathname);
}

const motorSectionHtml = `
  <article>
    <header>
      <h2>Motor data <small>(ThrustCurve.org)</small></h2>
      <p>
        Search <a href="https://www.thrustcurve.org" target="_blank" rel="noopener">ThrustCurve.org</a> live from the
        browser — no backend, CORS is open on their API — and attach a real motor to your rocket above
        (the library selection by default, or whatever you imported).
        Shows its thrust curve, its derived mass curve (ThrustCurve.org has no mass-vs-time data, only total /
        propellant weight, so mass loss is derived assuming it's proportional to cumulative thrust impulse), and the
        combined rocket mass/CG at ignition, mid-burn, and burnout.
      </p>
    </header>
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
          <input id="motor-common-name" type="text" value="${urlFilterValue("commonName")}" placeholder="e.g. C6, K400" />
        </label>
      </div>
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
    format: (m) => (m.diameter === undefined || m.diameter === null || Number.isNaN(m.diameter) ? "—" : fmtLength(m.diameter / 1000, 0)),
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
    key: "propWeight",
    label: "Propellant weight",
    format: (m) => (m.propWeightG === undefined || m.propWeightG === null || Number.isNaN(m.propWeightG) ? "—" : fmtMass(m.propWeightG / 1000)),
    value: (m) => m.propWeightG,
  },
];

let currentResults: MotorSearchResult[] = [];
let sortState: { key: string; dir: 1 | -1 } | null = null;

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
  const rows = sortedResults()
    .map((m) => {
      const realIndex = currentResults.indexOf(m);
      const cells = MOTOR_COLUMNS.map((c) => `<td>${c.format(m).replace("__I__", String(realIndex))}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const headers = MOTOR_COLUMNS.map((c) => {
    const arrow = sortState?.key === c.key ? (sortState.dir === 1 ? " ▲" : " ▼") : "";
    return `<th class="sortable-th" data-sort-key="${c.key}">${c.label}${arrow}</th>`;
  }).join("");
  return `
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
  resultsEl.innerHTML = renderMotorResults();
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
}

/** The last motor a user actually selected, cached so a unit-toggle can re-render its detail panel without re-fetching from ThrustCurve.org. */
let lastMotorSelection: { meta: MotorSearchResult; samples: ThrustSample[] } | null = null;

function renderMotorDetailHtml(meta: MotorSearchResult, samples: ThrustSample[]): { html: string; rocketWithMotor: Rocket } {
  const motor: SelectedMotor = {
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

  const rocketWithMotor: Rocket = { ...activeRocket, motor, windProfile: activeWindProfile };
  const massCurve = deriveMotorMassCurve(motor);
  const bt = burnTime(motor);
  const midT = bt / 2;

  const massAt = (t: number) => combinedMassAt(rocketWithMotor, massCurve, t);
  const start = massAt(0);
  const mid = massAt(midT);
  const end = massAt(bt);

  const html = `
    <h3>${meta.manufacturer} ${meta.designation}</h3>
    <p>Thrust curve: ${samples.length} samples, burn time ${bt.toFixed(2)}s.
      Total impulse (integrated from curve): ${fmtImpulse(totalImpulse(motor))}
      (ThrustCurve.org reports ${meta.totImpulseNs === undefined || meta.totImpulseNs === null ? "—" : fmtImpulse(meta.totImpulseNs)}).
      Peak thrust: ${fmtForce(Math.max(...samples.map((s) => s.thrust)))}.</p>
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
    <div id="flight-sim-section"><p aria-busy="true">Simulating flight…</p></div>
  `;
  return { html, rocketWithMotor };
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
    const samples = await downloadThrustSamples(meta.motorId);
    lastMotorSelection = { meta, samples };
    const { html, rocketWithMotor } = renderMotorDetailHtml(meta, samples);
    detailEl.innerHTML = html;
    void runFlightSim(rocketWithMotor);
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

const FLIGHT_CHART_IDS = { altitude: "chart-altitude", speed: "chart-speed", mach: "chart-mach", tilt: "chart-tilt" };

function mountFlightCharts(): void {
  if (lastFlightResult) renderFlightChart(FLIGHT_CHART_IDS, lastFlightResult.samples);
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
  } catch (err) {
    if (requestId !== flightSimRequestSeq) return;
    el.innerHTML = `<p><mark>Flight simulation failed: ${err instanceof Error ? err.message : String(err)}</mark></p>`;
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

function renderFlightResultHtml(rocket: Rocket, result: SimResult3D, elapsedMs: number): string {
  // Stability check uses the CG AT LAUNCH (full propellant load), not the dry CG -- for a
  // typical aft-mounted motor, CG is furthest aft (least stable) at liftoff and moves forward
  // as propellant burns, so liftoff is the safety-relevant worst case to check, not burnout.
  const massCurve = rocket.motor ? deriveMotorMassCurve(rocket.motor) : null;
  const launchCgX = massCurve ? combinedMassAt(rocket, massCurve, 0).cgX : rocket.dryCg;
  const { cpX, refDiameter } = computeBarrowman(rocket.components, 0.3);
  const stability = checkStability(cpX, launchCgX, refDiameter, rocket.motor !== null);

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
    stat("Static margin at launch", `${stability.margin.toFixed(2)} cal`),
    stat("Apogee", fmtAltitude(result.apogeeAltitude)),
    stat("Time to apogee", `${result.apogeeTime.toFixed(2)} s`),
    stat("Max velocity", fmtVelocity(result.maxVelocity)),
    stat("Max Mach", result.maxMach.toFixed(3)),
    stat("Max acceleration", `${(result.maxAcceleration / 9.80665).toFixed(1)} g`),
    stat("Tilt at burnout", result.tiltAtBurnoutDeg !== null ? `${result.tiltAtBurnoutDeg.toFixed(1)}°` : "—"),
  ].join("");

  const eventsRows = result.events
    .map((e) => `<tr><td>${e.type}</td><td>${e.time.toFixed(2)} s</td><td>${fmtAltitude(e.altitude)}</td></tr>`)
    .join("");

  return `
    <h3>Flight simulation <small>(ascent to apogee, ${windLabel} — M4)</small></h3>
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
    <div class="grid flight-charts-grid">
      <div id="chart-altitude" class="flight-chart"></div>
      <div id="chart-speed" class="flight-chart"></div>
      <div id="chart-mach" class="flight-chart"></div>
      <div id="chart-tilt" class="flight-chart"></div>
    </div>
    <figure>
      <table>
        <thead><tr><th>Event</th><th>Time</th><th>Altitude</th></tr></thead>
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

  resultsEl.innerHTML = '<p aria-busy="true">Searching…</p>';
  submitBtn?.setAttribute("aria-busy", "true");
  try {
    currentResults = await searchMotors({
      manufacturer: mfg || undefined,
      commonName: commonName || undefined,
      diameter: diameter ? Number(diameter) : undefined,
      type: type || undefined,
      impulseClass: impulseClass || undefined,
    });
    sortState = null;
    renderAndWireResults();
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

const windSectionHtml = `
  <article>
    <header>
      <h2>Wind data</h2>
      <p>
        Sets the wind used by the flight simulation above (re-select a motor after changing wind
        to re-run with the new setting). Either enter a plain constant wind, or upload a
        <code>splash_zones_captured_*.json</code> file (from the splashcast launch-day predictor,
        itself a multi-model wind ensemble pulled from Open-Meteo) for real altitude-varying data —
        this upload is a stand-in for testing only; once wired into splashcast, splashcast pulls
        real wind data itself and passes it to this tool's library API directly, no file needed.
      </p>
    </header>
    <div class="grid">
      <label>Constant wind speed (<span id="wind-speed-unit-label">m/s</span>) <input type="number" id="wind-manual-speed" value="0" min="0" step="0.5" /></label>
      <label>From direction (deg, compass) <input type="number" id="wind-manual-direction" value="0" min="0" max="360" step="5" /></label>
      <div style="align-self: end;">
        <button type="button" id="wind-manual-apply">Use constant wind</button>
      </div>
    </div>
    <p id="wind-active-label"><small>Currently: calm (no wind).</small></p>
    <hr />
    <input type="file" id="wind-file-input" accept=".json,application/json" />
    <div id="wind-controls" style="display:none; margin-top:1em;">
      <div class="grid">
        <label>Hour <select id="wind-hour"></select></label>
        <label>Model <select id="wind-model"></select></label>
      </div>
    </div>
    <div id="wind-result"></div>
  </article>
`;

let currentWindData: SplashcastWindData | null = null;
let activeWindProfile: WindProfile | null = null;

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

function renderWindProfileTable(): void {
  const resultEl = document.querySelector<HTMLDivElement>("#wind-result");
  const hourEl = document.querySelector<HTMLSelectElement>("#wind-hour");
  const modelEl = document.querySelector<HTMLSelectElement>("#wind-model");
  if (!resultEl || !hourEl || !modelEl || !currentWindData) return;

  const hour = Number(hourEl.value);
  const model = modelEl.value;
  const profile = currentWindData.profileFor(hour, model);
  if (!profile) {
    resultEl.innerHTML = "<p>No profile for that hour/model.</p>";
    return;
  }

  const rows = profile.samples
    .map((s) => {
      const w = windAt(profile, s.altitude);
      return `<tr>
        <td>${fmtAltitude(s.altitude)} AGL</td>
        <td>${fmtVelocity(w.speed)}</td>
        <td>${w.directionFromDeg.toFixed(0)}°</td>
      </tr>`;
    })
    .join("");

  resultEl.innerHTML = `
    <p>Site elevation: ${fmtAltitude(currentWindData.siteElevationM)}. ${profile.label}, ${profile.samples.length} altitude samples.</p>
    <figure>
      <table>
        <thead><tr><th>Altitude (AGL)</th><th>Speed</th><th>Direction (from)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </figure>
  `;
}

function wireWindImport(): void {
  const fileInput = document.querySelector<HTMLInputElement>("#wind-file-input");
  const controlsEl = document.querySelector<HTMLDivElement>("#wind-controls");
  const hourEl = document.querySelector<HTMLSelectElement>("#wind-hour");
  const modelEl = document.querySelector<HTMLSelectElement>("#wind-model");
  const resultEl = document.querySelector<HTMLDivElement>("#wind-result");
  const manualSpeedEl = document.querySelector<HTMLInputElement>("#wind-manual-speed");
  const manualDirEl = document.querySelector<HTMLInputElement>("#wind-manual-direction");
  const manualApplyBtn = document.querySelector<HTMLButtonElement>("#wind-manual-apply");
  if (!fileInput || !controlsEl || !hourEl || !modelEl || !resultEl || !manualSpeedEl || !manualDirEl || !manualApplyBtn) return;

  manualApplyBtn.addEventListener("click", () => {
    const rawSpeed = Number(manualSpeedEl.value) || 0;
    const speedMs = getUnitSystem() === "metric" ? rawSpeed : rawSpeed * 0.44704;
    const direction = Number(manualDirEl.value) || 0;
    activeWindProfile = speedMs > 0 ? constantWindProfile(speedMs, direction) : null;
    updateActiveWindLabel();
  });

  const applySelectedProfile = (): void => {
    if (!currentWindData) return;
    const profile = currentWindData.profileFor(Number(hourEl.value), modelEl.value);
    activeWindProfile = profile;
    updateActiveWindLabel();
    renderWindProfileTable();
  };

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    resultEl.innerHTML = '<p aria-busy="true">Parsing…</p>';
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        currentWindData = parseSplashcastWindData(json);
        if (currentWindData.hours.length === 0) {
          resultEl.innerHTML = "<p><mark>No wind_hours found — is this a splashcast splash_zones_captured_*.json file?</mark></p>";
          controlsEl.style.display = "none";
          return;
        }
        hourEl.innerHTML = currentWindData.hours.map((h) => `<option value="${h}">${h}:00</option>`).join("");
        const updateModels = () => {
          const models = currentWindData!.modelsForHour(Number(hourEl.value));
          modelEl.innerHTML = models.map((m) => `<option value="${m}">${m.toUpperCase()}</option>`).join("");
        };
        updateModels();
        controlsEl.style.display = "";
        hourEl.onchange = () => {
          updateModels();
          applySelectedProfile();
        };
        modelEl.onchange = applySelectedProfile;
        applySelectedProfile();
      } catch (err) {
        resultEl.innerHTML = `<p><mark>Failed to parse file: ${err instanceof Error ? err.message : String(err)}</mark></p>`;
        controlsEl.style.display = "none";
      }
    };
    reader.readAsText(file);
  });
}

const orkSectionHtml = `
  <article>
    <header>
      <h2>Your rocket</h2>
      <p>
        Pick a known rocket from the library, or upload a real OpenRocket <code>.ork</code>, RockSim
        <code>.rkt</code>, or RASAero <code>.CDX1</code> file — nose cone, body tube(s),
        transition/boat tail/fin can, and trapezoidal or freeform fins are imported (single-stage
        only; multi-stage files use just the first/sustainer stage). Mass and CG stay manual, per
        this tool's design — enter them below. For .ork files, the file's own default motor
        selection pre-fills the motor search further down (RockSim and RASAero files carry no motor
        data at all, only mount geometry, so you'll need to search for a motor yourself either way).
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
    <div class="grid" id="ork-mass-cg-controls" style="margin-top:1em;">
      <label>Dry mass (<span id="mass-unit-label">g</span>) <input type="number" id="ork-dry-mass" value="50" min="0" step="1" /></label>
      <label>Dry CG (<span id="length-unit-label">mm</span> from nose) <input type="number" id="ork-dry-cg" value="0" min="0" step="1" /></label>
    </div>
    <div id="active-rocket-display"></div>
  </article>
`;

function renderActiveRocketDisplay(): void {
  const el = document.querySelector<HTMLDivElement>("#active-rocket-display");
  if (!el) return;
  el.innerHTML = renderRocketSection(activeRocket, 0.3, activeRocketSource, activeKnownCp);
}

/** Sets the mass/CG input fields' displayed values from the active rocket's stored SI values, in whatever unit system is currently selected. */
function syncMassCgInputsFromActiveRocket(): void {
  const massEl = document.querySelector<HTMLInputElement>("#ork-dry-mass");
  const cgEl = document.querySelector<HTMLInputElement>("#ork-dry-cg");
  if (massEl) massEl.value = massToInput(activeRocket.dryMass).toFixed(2);
  if (cgEl) cgEl.value = activeRocket.dryCg > 0 ? lengthToInput(activeRocket.dryCg).toFixed(2) : "0";
}

function wireOrkImport(): void {
  const fileInput = document.querySelector<HTMLInputElement>("#ork-file-input");
  const warningsEl = document.querySelector<HTMLDivElement>("#ork-warnings");
  const controlsEl = document.querySelector<HTMLDivElement>("#ork-mass-cg-controls");
  const massEl = document.querySelector<HTMLInputElement>("#ork-dry-mass");
  const cgEl = document.querySelector<HTMLInputElement>("#ork-dry-cg");
  if (!fileInput || !warningsEl || !controlsEl || !massEl || !cgEl) return;

  const applyMassCg = (): void => {
    const dryMass = massFromInput(Number(massEl.value) || 0);
    const dryCg = lengthFromInput(Number(cgEl.value) || 0);
    activeRocket = { ...activeRocket, dryMass, dryCg };
    renderActiveRocketDisplay();
  };
  massEl.addEventListener("input", applyMassCg);
  cgEl.addEventListener("input", applyMassCg);

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    warningsEl.innerHTML = '<p aria-busy="true">Parsing…</p>';

    void (async () => {
      try {
        // Only .ork carries an embedded motor reference -- RockSim and RASAero files have no
        // motor data at all, only mount geometry (parseRocksimXml/parseRasaeroXml's results have
        // no `motor` field to begin with).
        let parsed: { name: string; components: Component[]; warnings: string[]; estimatedDryMassKg?: number };
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

        applyParsedRocket(parsed, `Uploaded: ${file.name}`, undefined);

        controlsEl.style.display = "";
        const massNote =
          parsed.estimatedDryMassKg && parsed.estimatedDryMassKg > 0
            ? ` Dry mass prefilled at ${fmtMass(parsed.estimatedDryMassKg)} from the file's own component masses — check it, then set CG below (never guessed).`
            : " Set dry mass and CG below (never guessed).";
        const parseNote = parsed.warnings.length
          ? parsed.warnings.map((w) => `<mark>${w}</mark>`).join(" ")
          : `<small>Parsed ${parsed.components.length} components successfully.</small>`;
        warningsEl.innerHTML = `<p>${parseNote}${massNote}</p>`;

        syncMassCgInputsFromActiveRocket();
        renderActiveRocketDisplay();

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
        controlsEl.style.display = "none";
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

  const rows = matches
    .slice(0, 200) // a broad filter (e.g. vendor-only) can still match 100+; cap the DOM cost, name/diameter narrows it down fast
    .map(
      (e) =>
        `<tr><td>${e.vendor}</td><td>${e.name}</td><td>${nominalDiameterIn(e.diameterMm)}"</td><td>${fmtAltitude(e.lengthMm / 1000)}</td><td><a href="#" data-lib-id="${e.id}">Select</a></td></tr>`,
    )
    .join("");
  const truncatedNote = matches.length > 200 ? `<p><small>${matches.length} matches, showing first 200 — narrow the filter to see more.</small></p>` : "";

  resultsEl.innerHTML = `
    ${truncatedNote}
    <figure>
      <table>
        <thead><tr><th>Vendor</th><th>Name</th><th>Diameter</th><th>Length</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </figure>
  `;

  resultsEl.querySelectorAll<HTMLAnchorElement>("a[data-lib-id]").forEach((a) => {
    a.addEventListener("click", (evt) => {
      evt.preventDefault();
      const entry = libraryManifest.find((e) => e.id === a.dataset["libId"]);
      if (entry) void selectLibraryEntry(entry);
    });
  });
}

/** Fetches and parses the selected library entry's real .rkt file (only now, not for all 260+ entries up front) and makes it the active rocket. */
async function selectLibraryEntry(entry: LibraryManifestEntry): Promise<void> {
  const warningsEl = document.querySelector<HTMLDivElement>("#ork-warnings");
  const controlsEl = document.querySelector<HTMLDivElement>("#ork-mass-cg-controls");
  const pickerEl = document.querySelector<HTMLDetailsElement>("#library-picker");
  if (warningsEl) warningsEl.innerHTML = `<p aria-busy="true">Loading ${entry.name}…</p>`;

  try {
    const res = await fetch(entry.path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseRocksimXml(await res.text());
    applyParsedRocket(parsed, `From the library: ${entry.vendor} — ${entry.name}`, LIBRARY_KNOWN_CP[entry.path], entry.name);

    if (controlsEl) controlsEl.style.display = "";
    if (warningsEl) {
      const parseNote = parsed.warnings.length
        ? parsed.warnings.map((w) => `<mark>${w}</mark>`).join(" ")
        : `<small>Loaded "${entry.name}" from the library.</small>`;
      warningsEl.innerHTML = `<p>${parseNote}</p>`;
    }
    if (pickerEl) pickerEl.open = false;
    syncMassCgInputsFromActiveRocket();
    renderActiveRocketDisplay();
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

/** Loads the manifest, populates the browse UI, and picks LOC-IV as the initial active rocket (the one entry with independently-verified known-good CP values to show alongside this tool's own computed CP by default) — runs once at startup. */
async function initLibrary(): Promise<void> {
  try {
    libraryManifest = await loadLibraryManifest();
    populateLibraryFilterOptions();
    wireLibraryPicker();

    const defaultEntry = libraryManifest.find((e) => e.path === "library/loc/PK-48 LOC-IV.rkt") ?? libraryManifest[0];
    if (defaultEntry) await selectLibraryEntry(defaultEntry);
  } catch (err) {
    activeRocketSource = `Failed to load the rocket library: ${err instanceof Error ? err.message : String(err)} — upload a file instead.`;
    renderActiveRocketDisplay();
  }
}

// --- Metric/imperial toggle ---
const unitToggleHtml = `
  <div role="group" id="unit-toggle" style="display:inline-flex; margin-top:0.5em;">
    <button type="button" data-unit="metric" aria-current="true">Metric</button>
    <button type="button" data-unit="imperial">Imperial</button>
  </div>
`;

/** Updates the mass/CG input unit labels + values (without changing the underlying rocket) and re-renders every currently-populated section so a unit toggle takes effect everywhere at once. */
function refreshAllUnitDisplays(): void {
  const massLabelEl = document.querySelector<HTMLSpanElement>("#mass-unit-label");
  const lengthLabelEl = document.querySelector<HTMLSpanElement>("#length-unit-label");
  if (massLabelEl) massLabelEl.textContent = massInputUnitLabel();
  if (lengthLabelEl) lengthLabelEl.textContent = lengthInputUnitLabel();
  syncMassCgInputsFromActiveRocket();

  renderActiveRocketDisplay();
  if (libraryManifest.length > 0) renderLibraryResults();
  renderAndWireResults();
  if (lastMotorSelection) {
    const detailEl = document.querySelector<HTMLDivElement>("#motor-detail");
    if (detailEl) {
      detailEl.innerHTML = renderMotorDetailHtml(lastMotorSelection.meta, lastMotorSelection.samples).html;
      rerenderFlightResultOnly();
    }
  }
  updateWindManualUnitDisplay();
  updateActiveWindLabel();
  if (currentWindData) renderWindProfileTable();
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
    });
  });
}

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.innerHTML = `
    <main class="container">
      <hgroup>
        <h1>🚀 rocketry</h1>
        <p>A from-scratch, client-side flight simulator for basic rockets — M1/M2 checkpoint</p>
        ${unitToggleHtml}
      </hgroup>
      ${orkSectionHtml}
      ${windSectionHtml}
      ${motorSectionHtml}
    </main>
  `;
  syncMassCgInputsFromActiveRocket();
  renderActiveRocketDisplay();
  wireOrkImport();
  wireMotorSearch();
  wireWindImport();
  wireUnitToggle();
  void initLibrary();
  const urlParams = new URLSearchParams(location.search);
  const hadUrlFilters = (Object.keys(FILTER_DEFAULTS) as FilterKey[]).some((k) => urlParams.has(k));
  void loadMotorMetadata().then(() => {
    // A shared/bookmarked search URL should actually run the search, not just preselect the filters.
    if (hadUrlFilters) void performSearch();
  });
}
