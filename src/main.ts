import "@picocss/pico/css/pico.indigo.min.css";
import "./style.css";
import { computeBarrowman, stabilityMargin } from "./physics/aero/barrowman.js";
import { renderSchematicSvg } from "./ui/schematic/render.js";
import { defaultRocket, type Rocket, type SelectedMotor } from "./model/rocket.js";
import type { Component } from "./model/component.js";
import {
  searchMotors,
  downloadThrustSamples,
  getMotorMetadata,
  type MotorSearchResult,
} from "./physics/motor/thrustcurve-client.js";
import { burnTime, getThrustAt, totalImpulse } from "./physics/motor/motor-model.js";
import { deriveMotorMassCurve, getMotorMassAt } from "./physics/mass/motor-mass-curve.js";
import { combinedMassAt } from "./physics/mass/combined-mass.js";
import { simulateAscent } from "./physics/sim/engine.js";

const MM = 0.001;

// M1 demo rocket: ogive nose + body tube + 3 trapezoidal fins. Static
// CP/stability only — no motor, no flight sim yet (that's M2/M3).
const demoComponents: Component[] = [
  {
    type: "nosecone",
    id: "nose",
    name: "Nose cone",
    shape: "ogive",
    shapeParameter: 1,
    length: 0.1,
    aftRadius: 0.0125,
    thickness: 0.002,
  },
  {
    type: "bodytube",
    id: "tube",
    name: "Body tube",
    length: 0.3,
    radius: 0.0125,
    thickness: 0.001,
    isMotorMount: true,
  },
  {
    type: "finset",
    id: "fins",
    name: "Fins",
    finCount: 3,
    rootChord: 0.05,
    tipChord: 0.03,
    sweepLength: 0.02,
    span: 0.05,
    thickness: 0.003,
    cantAngle: 0,
    axialOffsetFromParentBottom: 0.25,
  },
];

const demoRocket: Rocket = {
  ...defaultRocket(),
  name: "M1 demo rocket",
  components: demoComponents,
  dryCg: 0.24,
  motorMount: { componentId: "tube", motorOverhang: 0 },
};

// Real-world validation rocket: LOC Precision "PK-48 LOC-IV" (sim-files/LOC/PK-48 Loc-IV.rkt).
// Geometry transcribed from that RockSim file; the fin is a RockSim
// CustomFinSet (a 5-point clipped-delta polygon), carried through exactly via
// FreeformFinSet rather than approximated as a trapezoid. See
// scripts/validate-loc-iv.ts for the original derivation and
// src/physics/aero/freeform-fin-calc.test.ts for the regression fixture.
const locIvComponents: Component[] = [
  {
    type: "nosecone",
    id: "loc-nose",
    name: "Nose cone",
    shape: "ogive",
    shapeParameter: 1,
    length: 325.12 * MM,
    aftRadius: (101.6 / 2) * MM,
    thickness: 3.175 * MM,
  },
  {
    type: "bodytube",
    id: "loc-tube1",
    name: "Body tube (fwd)",
    length: 279.4 * MM,
    radius: (101.6 / 2) * MM,
    thickness: 0,
    isMotorMount: false,
  },
  {
    type: "bodytube",
    id: "loc-tube2",
    name: "Body tube (aft, carries fins)",
    length: 584.2 * MM,
    radius: (101.6 / 2) * MM,
    thickness: 0,
    isMotorMount: false,
  },
  {
    type: "freeformfinset",
    id: "loc-fins",
    name: "Fin set (RockSim CustomFinSet)",
    finCount: 3,
    points: [
      [171.45 * MM, 0],
      [206.375 * MM, 31.75 * MM],
      [206.375 * MM, 107.95 * MM],
      [142.875 * MM, 107.95 * MM],
      [0, 0],
    ],
    thickness: 3 * MM,
    cantAngle: 0,
    axialOffsetFromParentBottom: 412.75 * MM,
  },
];

const locIvRocket: Rocket = {
  ...defaultRocket(),
  name: 'LOC Precision "PK-48 LOC-IV"',
  components: locIvComponents,
  dryCg: 0, // not entered — mass/CG is manual per this tool's design; omitted here, so no stability margin is shown below
};

function stat(label: string, value: string): string {
  return `<div><strong>${value}</strong><br /><small>${label}</small></div>`;
}

function renderRocketSection(
  rocket: Rocket,
  mach: number,
  subtitle: string,
  knownCp?: { label: string; mm: number }[],
): string {
  const { cna, cpX, refDiameter } = computeBarrowman(rocket.components, mach);
  const hasCg = rocket.dryCg > 0;
  const margin = hasCg ? stabilityMargin(cpX, rocket.dryCg, refDiameter) : null;

  const stats = [
    stat("Total CNa", `${cna.toFixed(3)} /rad`),
    stat("Computed CP", `${(cpX * 1000).toFixed(1)} mm`),
    hasCg ? stat("CG (manual)", `${(rocket.dryCg * 1000).toFixed(1)} mm`) : "",
    stat("Ref. diameter", `${(refDiameter * 1000).toFixed(1)} mm`),
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
      const deltaMm = cpX * 1000 - k.mm;
      const deltaPct = (deltaMm / k.mm) * 100;
      return `<tr><td>${k.label}</td><td>${k.mm.toFixed(1)} mm</td><td>${deltaMm >= 0 ? "+" : ""}${deltaMm.toFixed(1)} mm (${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%)</td></tr>`;
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
  designation: "",
} as const;

type FilterKey = keyof typeof FILTER_DEFAULTS;

const FILTER_ELEMENT_IDS: Record<FilterKey, string> = {
  manufacturer: "motor-mfg",
  diameter: "motor-diameter",
  type: "motor-type",
  impulseClass: "motor-impulse-class",
  designation: "motor-designation",
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
        browser — no backend, CORS is open on their API — and attach a real motor to the "${demoRocket.name}" above.
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
        <label>Diameter
          <select id="motor-diameter" aria-busy="true"><option value="">Loading…</option></select>
        </label>
        <label>Type
          <select id="motor-type" aria-busy="true"><option value="">Loading…</option></select>
        </label>
        <label>Impulse class
          <select id="motor-impulse-class" aria-busy="true"><option value="">Loading…</option></select>
        </label>
        <label>Designation
          <input id="motor-designation" type="text" value="${urlFilterValue("designation")}" placeholder="e.g. C6" />
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
  { key: "diameter", label: "Diameter", format: (m) => num(m.diameter, 0, " mm"), value: (m) => m.diameter },
  { key: "type", label: "Type", format: (m) => m.type, value: (m) => m.type },
  { key: "class", label: "Class", format: (m) => m.impulseClass, value: (m) => m.impulseClass },
  {
    key: "totImpulse",
    label: "Total impulse",
    format: (m) => num(m.totImpulseNs, 2, " N·s"),
    value: (m) => m.totImpulseNs,
  },
  { key: "burnTime", label: "Burn time", format: (m) => num(m.burnTimeS, 2, " s"), value: (m) => m.burnTimeS },
  {
    key: "totalWeight",
    label: "Total weight",
    format: (m) => num(m.totalWeightG, 1, " g"),
    value: (m) => m.totalWeightG,
  },
  {
    key: "propWeight",
    label: "Propellant weight",
    format: (m) => num(m.propWeightG, 1, " g"),
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
    const motor: SelectedMotor = {
      motorId: meta.motorId,
      designation: meta.designation,
      manufacturer: meta.manufacturer,
      diameter: meta.diameter / 1000,
      length: meta.length / 1000,
      totalMassKg: meta.totalWeightG / 1000,
      propellantMassKg: meta.propWeightG / 1000,
      samples,
      delay: 0,
    };

    const rocketWithMotor: Rocket = { ...demoRocket, motor };
    const massCurve = deriveMotorMassCurve(motor);
    const bt = burnTime(motor);
    const midT = bt / 2;

    const massAt = (t: number) => combinedMassAt(rocketWithMotor, massCurve, t);
    const start = massAt(0);
    const mid = massAt(midT);
    const end = massAt(bt);

    detailEl.innerHTML = `
      <h3>${meta.manufacturer} ${meta.designation}</h3>
      <p>Thrust curve: ${samples.length} samples, burn time ${bt.toFixed(2)}s.
        Total impulse (integrated from curve): ${totalImpulse(motor).toFixed(2)} N·s
        (ThrustCurve.org reports ${num(meta.totImpulseNs, 2, " N·s")}).
        Peak thrust: ${Math.max(...samples.map((s) => s.thrust)).toFixed(1)} N.</p>
      <figure>
        <table>
          <thead>
            <tr><th></th><th>t=0 (ignition)</th><th>t=${midT.toFixed(2)}s (mid-burn)</th><th>t=${bt.toFixed(2)}s (burnout)</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Thrust</td>
              <td>${getThrustAt(motor, 0).toFixed(1)} N</td>
              <td>${getThrustAt(motor, midT).toFixed(1)} N</td>
              <td>${getThrustAt(motor, bt).toFixed(1)} N</td>
            </tr>
            <tr>
              <td>Motor mass</td>
              <td>${(getMotorMassAt(massCurve, 0) * 1000).toFixed(1)} g</td>
              <td>${(getMotorMassAt(massCurve, midT) * 1000).toFixed(1)} g</td>
              <td>${(getMotorMassAt(massCurve, bt) * 1000).toFixed(1)} g</td>
            </tr>
            <tr>
              <td>Combined rocket mass</td>
              <td>${(start.mass * 1000).toFixed(1)} g</td>
              <td>${(mid.mass * 1000).toFixed(1)} g</td>
              <td>${(end.mass * 1000).toFixed(1)} g</td>
            </tr>
            <tr>
              <td>Combined rocket CG</td>
              <td>${(start.cgX * 1000).toFixed(1)} mm</td>
              <td>${(mid.cgX * 1000).toFixed(1)} mm</td>
              <td>${(end.cgX * 1000).toFixed(1)} mm</td>
            </tr>
          </tbody>
        </table>
      </figure>
      ${renderFlightSimSection(rocketWithMotor)}
    `;
  } catch (err) {
    detailEl.innerHTML = `<p><mark>Failed to load thrust curve: ${err instanceof Error ? err.message : String(err)}</mark></p>`;
  }
}

function renderFlightSimSection(rocket: Rocket): string {
  const t0 = performance.now();
  const result = simulateAscent(rocket);
  const elapsedMs = performance.now() - t0;

  const warningsHtml = result.warnings.length
    ? `<p>${result.warnings.map((w) => `<mark>${w}</mark>`).join(" ")}</p>`
    : "";

  const stats = [
    stat("Apogee", `${result.apogeeAltitude.toFixed(1)} m`),
    stat("Time to apogee", `${result.apogeeTime.toFixed(2)} s`),
    stat("Max velocity", `${result.maxVelocity.toFixed(1)} m/s`),
    stat("Max Mach", result.maxMach.toFixed(3)),
    stat("Max acceleration", `${(result.maxAcceleration / 9.80665).toFixed(1)} g`),
  ].join("");

  const eventsRows = result.events
    .map((e) => `<tr><td>${e.type}</td><td>${e.time.toFixed(2)} s</td><td>${e.altitude.toFixed(1)} m</td></tr>`)
    .join("");

  return `
    <h3>Flight simulation <small>(ascent to apogee, no wind — M3)</small></h3>
    ${warningsHtml}
    <div class="grid stats-grid">${stats}</div>
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
  const designation = filterElement("designation")?.value.trim() ?? "";

  resultsEl.innerHTML = '<p aria-busy="true">Searching…</p>';
  submitBtn?.setAttribute("aria-busy", "true");
  try {
    currentResults = await searchMotors({
      manufacturer: mfg || undefined,
      designation: designation || undefined,
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

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.innerHTML = `
    <main class="container">
      <hgroup>
        <h1>🚀 rocketry</h1>
        <p>A from-scratch, client-side flight simulator for basic rockets — M1/M2 checkpoint</p>
      </hgroup>
      ${renderRocketSection(demoRocket, 0.3, "Synthetic demo rocket")}
      ${renderRocketSection(locIvRocket, 0.001, "Real rocket, transcribed from sim-files/LOC/PK-48 Loc-IV.rkt", [
        { label: "RockSim classical Barrowman CP (BarromanXN)", mm: 899.247 },
        { label: "RockSim proprietary extended-method CP (RockSimXN)", mm: 972.645 },
      ])}
      ${motorSectionHtml}
    </main>
  `;
  wireMotorSearch();
  const urlParams = new URLSearchParams(location.search);
  const hadUrlFilters = (Object.keys(FILTER_DEFAULTS) as FilterKey[]).some((k) => urlParams.has(k));
  void loadMotorMetadata().then(() => {
    // A shared/bookmarked search URL should actually run the search, not just preselect the filters.
    if (hadUrlFilters) void performSearch();
  });
}
