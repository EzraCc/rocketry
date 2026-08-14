/**
 * Generates public/validation-report.html -- a static, human-readable comparison of this
 * project's own computed values against real OpenRocket Java simulations (validation/fixtures/
 * openrocket/*.json) and RockSim's own embedded CP (the same two data sources
 * openrocket-comparison.test.ts and rocksim-embedded-cp.test.ts already check against, just
 * rendered as a page instead of a pass/fail assertion). Run with:
 *   npx tsx validation/build-report.ts
 * and commit the regenerated public/validation-report.html -- it's a static asset (not built by
 * Vite), served as-is at /validation-report.html.
 *
 * RockSim only ever contributes a CP column here -- its own saved simulations use motors this
 * project doesn't necessarily have thrust data for, and comparing full flight results against it
 * was explicitly out of scope for this whole validation effort (see openrocket-comparison.test.ts's
 * own doc comment) -- so every RockSim cell outside CP is "—", not a missing/broken number.
 *
 * "Ours" here is the FULL pipeline a real user gets (this project's own estimatedDryCgM/
 * estimatedDryMassKg feeding its own simulateFlight3D), not the isolated-aero-only numbers
 * openrocket-comparison.test.ts's flight test uses (which back-solves dry mass/CG from OpenRocket's
 * own loaded values, to isolate aero/sim differences from this project's own CG-estimation
 * accuracy). This page is meant to show "how close is what a user actually sees," which is a
 * slightly different (and slightly less flattering, since CG-estimation error compounds into it)
 * question than "how close is the aero model alone."
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
// jsdom ships no type declarations and this project has no @types/jsdom -- the existing test files
// avoid this via vitest's own "@vitest-environment jsdom" pragma, not available to a plain script.
// @ts-expect-error see above
import { JSDOM } from "jsdom";
// parseRocksimXml uses the browser DOMParser global -- polyfill it for this plain Node script
// (a real test file would use @vitest-environment jsdom instead, but this runs via plain tsx).
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = new JSDOM().window.DOMParser as unknown as typeof DOMParser;
import { parseRocksimXml } from "../src/formats/rocksim/parse.js";
import { computeBarrowman } from "../src/physics/aero/barrowman.js";
import { simulateFlight3D } from "../src/physics/sim/engine3d.js";
import { motorAxialPosition } from "../src/physics/mass/combined-mass.js";
import { defaultRocket, type Rocket, type SelectedMotor } from "../src/model/rocket.js";
import { isBodyComponent, type Component } from "../src/model/component.js";
import type { MotorSearchResult, ThrustSample } from "../src/physics/motor/thrustcurve-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OPENROCKET_FIXTURES_DIR = path.join(__dirname, "fixtures/openrocket");
const MOTOR_FIXTURES_DIR = path.join(__dirname, "fixtures/motors");
const ROCKETS_JSON = path.join(__dirname, "openrocket-oracle/rockets.json");
const OUTPUT_PATH = path.join(REPO_ROOT, "public/validation-report.html");

// Matches Part 1/2/3's own reference speed (see openrocket-comparison.test.ts) -- the
// safety-relevant rail-exit speed (~100fps), not an arbitrary "typical flight" number.
const COMPARISON_MACH = 0.1;

interface RocketCase {
  label: string;
  rocketPath: string;
  motorManufacturer: string;
  motorDesignation: string;
  note: string;
}

interface OpenRocketFixture {
  cpXMm: number;
  cgAtLiftoffMm: number;
  massAtLiftoffKg: number;
  apogeeAltitudeM: number;
  maxVelocityMs: number;
}

// Same top-level, motor-independent <BarromanXN> tag rocksim-embedded-cp.test.ts reads -- RockSim's
// own last-computed CP, cached in every file that's ever had a simulation run/saved in RockSim.
function extractEmbeddedCpMm(xml: string): number | null {
  const match = xml.match(/<BarromanXN>([^<]*)<\/BarromanXN>/);
  if (!match) return null;
  const parts = match[1]!.split(",");
  const value = Number.parseFloat(parts[1] ?? "");
  return Number.isFinite(value) && value !== 0 ? value : null;
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

// Same rule as applyParsedRocket in src/main.ts: prefer a component RockSim's own IsMotorMount flag
// identified, falling back to the last body component.
function findMotorMountId(components: Component[]): string {
  const bodyComponents = components.filter(isBodyComponent);
  const flagged = components.find((c) => c.type === "bodytube" && c.isMotorMount);
  return (flagged ?? bodyComponents[bodyComponents.length - 1])?.id ?? "";
}

interface MetricValues {
  ours: number | null;
  or: number | null;
  rocksim: number | null;
}

interface ReportRow {
  label: string;
  rocketName: string;
  motorLabel: string;
  cpMm: MetricValues;
  dryCgMm: MetricValues;
  loadedCgMm: MetricValues;
  maxVelocityMs: MetricValues;
  apogeeM: MetricValues;
}

const rocketCases = JSON.parse(fs.readFileSync(ROCKETS_JSON, "utf-8")) as RocketCase[];
const rows: ReportRow[] = [];

for (const rocketCase of rocketCases) {
  const fixturePath = path.join(OPENROCKET_FIXTURES_DIR, `${rocketCase.label}.json`);
  if (!fs.existsSync(fixturePath)) continue; // no real OpenRocket data for this case -- skip rather than show all-blank

  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as OpenRocketFixture;
  const xml = fs.readFileSync(path.join(REPO_ROOT, rocketCase.rocketPath), "utf-8");
  const parsed = parseRocksimXml(xml);
  const motor = loadMotor(rocketCase.label);

  const oursCpMm = computeBarrowman(parsed.components, COMPARISON_MACH).cpX * 1000;
  const rocksimCpMm = extractEmbeddedCpMm(xml);

  const motorMountId = findMotorMountId(parsed.components);
  const rocketForMotorPosition: Rocket = {
    ...defaultRocket(),
    components: parsed.components,
    motorMount: { componentId: motorMountId, motorOverhang: 0 },
    motor,
  };
  const pos = motorAxialPosition(rocketForMotorPosition);

  // OpenRocket's own dry CG isn't a field the fixture carries directly -- back-solve it from its
  // real LOADED mass/CG at liftoff via moment conservation, same math src/main.ts's
  // autoDeriveLoadedCg uses in reverse (and openrocket-comparison.test.ts's backSolveDryCg).
  const orDryMassKg = fixture.massAtLiftoffKg - motor.totalMassKg;
  const orDryCgM = pos ? (fixture.massAtLiftoffKg * (fixture.cgAtLiftoffMm / 1000) - motor.totalMassKg * pos.cgX) / orDryMassKg : null;

  const oursDryCgM = parsed.estimatedDryCgM ?? null;
  let oursLoadedCgM: number | null = null;
  let oursApogeeM: number | null = null;
  let oursMaxVelocityMs: number | null = null;

  if (oursDryCgM !== null && pos && parsed.estimatedDryMassKg > 0) {
    const oursLoadedMassKg = parsed.estimatedDryMassKg + motor.totalMassKg;
    oursLoadedCgM = (parsed.estimatedDryMassKg * oursDryCgM + motor.totalMassKg * pos.cgX) / oursLoadedMassKg;

    const rocket: Rocket = { ...rocketForMotorPosition, dryMass: parsed.estimatedDryMassKg, dryCg: oursDryCgM };
    const result = simulateFlight3D(rocket);
    oursApogeeM = result.apogeeAltitude;
    oursMaxVelocityMs = result.maxVelocity;
  }

  rows.push({
    label: rocketCase.label,
    rocketName: rocketCase.rocketPath.split("/").pop()!.replace(/\.rkt$/i, ""),
    motorLabel: `${rocketCase.motorManufacturer} ${rocketCase.motorDesignation}`,
    cpMm: { ours: oursCpMm, or: fixture.cpXMm, rocksim: rocksimCpMm },
    dryCgMm: { ours: oursDryCgM !== null ? oursDryCgM * 1000 : null, or: orDryCgM !== null ? orDryCgM * 1000 : null, rocksim: null },
    loadedCgMm: { ours: oursLoadedCgM !== null ? oursLoadedCgM * 1000 : null, or: fixture.cgAtLiftoffMm, rocksim: null },
    maxVelocityMs: { ours: oursMaxVelocityMs, or: fixture.maxVelocityMs, rocksim: null },
    apogeeM: { ours: oursApogeeM, or: fixture.apogeeAltitudeM, rocksim: null },
  });
}

// --- Rendering ---

function fmtNum(n: number | null, digits: number, unit: string): string {
  return n === null ? "—" : `${n.toFixed(digits)}${unit}`;
}

/** One metric cell: each available source on its own line, then Ours-vs-OR delta (numeric + %) as the last line -- OR is the external reference every "ours" figure in this project is checked against elsewhere (see openrocket-comparison.test.ts), so it's the natural delta baseline here too, not RockSim (CP-only, not always present). */
function renderMetricCell(values: MetricValues, digits: number, unit: string): string {
  const lines: string[] = [];
  lines.push(`<span class="src">Ours</span> ${fmtNum(values.ours, digits, unit)}`);
  lines.push(`<span class="src">OR</span> ${fmtNum(values.or, digits, unit)}`);
  if (values.rocksim !== null) lines.push(`<span class="src">RockSim</span> ${fmtNum(values.rocksim, digits, unit)}`);
  if (values.ours !== null && values.or !== null && values.or !== 0) {
    const deltaAbs = values.ours - values.or;
    const deltaPct = (deltaAbs / Math.abs(values.or)) * 100;
    const sign = deltaAbs >= 0 ? "+" : "";
    const cls = Math.abs(deltaPct) > 20 ? "delta delta-high" : "delta";
    lines.push(`<span class="${cls}">Δ ${sign}${deltaAbs.toFixed(digits)}${unit} (${sign}${deltaPct.toFixed(1)}%)</span>`);
  }
  return lines.join("<br />");
}

const tableRows = rows
  .map(
    (r) => `
      <tr>
        <th scope="row">${r.rocketName}<br /><small>${r.motorLabel}</small></th>
        <td>${renderMetricCell(r.cpMm, 1, " mm")}</td>
        <td>${renderMetricCell(r.dryCgMm, 1, " mm")}</td>
        <td>${renderMetricCell(r.loadedCgMm, 1, " mm")}</td>
        <td>${renderMetricCell(r.maxVelocityMs, 1, " m/s")}</td>
        <td>${renderMetricCell(r.apogeeM, 1, " m")}</td>
      </tr>`,
  )
  .join("");

const generatedAt = new Date().toISOString().slice(0, 10);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>rocketry — validation report</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1a1a1a; --muted: #666666; --border: #dddddd;
    --head-bg: #f4f4f5; --delta-high: #c0392b; --link: #2f6feb;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #14161a; --fg: #e8e8e8; --muted: #9a9a9a; --border: #33363b; --head-bg: #1e2126; --delta-high: #ff6b6b; --link: #6ea8fe; }
  }
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 1.5rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
  .subtitle { color: var(--muted); margin: 0 0 1rem; font-size: 0.9rem; }
  a { color: var(--link); }
  .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 6px; max-width: 100%; }
  table { border-collapse: collapse; width: 100%; min-width: 900px; font-size: 0.85rem; }
  th, td { padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; white-space: nowrap; }
  thead th { position: sticky; top: 0; background: var(--head-bg); z-index: 2; white-space: normal; }
  tbody th[scope="row"] { position: sticky; left: 0; background: var(--bg); z-index: 1; border-right: 1px solid var(--border); }
  thead th:first-child { position: sticky; left: 0; z-index: 3; }
  .src { color: var(--muted); font-size: 0.75rem; display: inline-block; width: 3.6rem; }
  .delta { color: var(--muted); font-size: 0.78rem; }
  .delta-high { color: var(--delta-high); font-weight: 600; }
  footer { margin-top: 1.5rem; color: var(--muted); font-size: 0.8rem; }
</style>
</head>
<body>
  <h1>rocketry — validation report</h1>
  <p class="subtitle">
    This project's own computed values vs. real OpenRocket (Java) simulations and RockSim's own embedded CP,
    for ${rows.length} real rocket+motor cases. CP compared at Mach ${COMPARISON_MACH} (~100fps, the safety-relevant rail-exit speed).
    "Ours" is the full pipeline a real user sees (this project's own geometry-derived dry CG/mass feeding its own flight sim),
    not an isolated aero-only comparison. RockSim contributes CP only (see this report's generation script for why).
    Deltas are Ours vs. OpenRocket. Generated ${generatedAt} from
    <a href="https://github.com/openrocket/openrocket" target="_blank" rel="noopener">OpenRocket</a>-derived fixtures — see
    <code>validation/</code> in the repo for how.
  </p>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Rocket / Motor</th>
          <th>CP</th>
          <th>Dry CG</th>
          <th>Loaded CG</th>
          <th>Max velocity</th>
          <th>Apogee</th>
        </tr>
      </thead>
      <tbody>${tableRows}
      </tbody>
    </table>
  </div>
  <footer>rocketry is an independent, GPL-avoiding re-derivation of OpenRocket's Barrowman physics — see the project README for details.</footer>
</body>
</html>
`;

fs.writeFileSync(OUTPUT_PATH, html);
console.log(`Wrote ${OUTPUT_PATH} (${rows.length} rows)`);
