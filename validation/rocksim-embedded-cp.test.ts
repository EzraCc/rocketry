// @vitest-environment jsdom
/**
 * Whole-library CP regression against RockSim's OWN stored calculation — no Java, no user
 * action, runs in every `npm test`.
 *
 * Every .rkt file carries RockSim's own last-computed CP as a static tag written when the file
 * was saved:
 *   <BarromanXN>0,899.247,0,0</BarromanXN>   (top-level, motor-independent -- pure geometry)
 * (confirmed directly against public/library/loc/PK-48 LOC-IV.rkt, and matches what
 * LIBRARY_KNOWN_CP in src/main.ts already hand-transcribes for that one file). Neither
 * RockSimLoader.java (OpenRocket's own importer) nor our own parseRocksimXml reads this tag --
 * it just sits there in every file we ship, unused, until now.
 *
 * This test extracts it from every library file that has a real (non-zero) value -- 322 of 339,
 * confirmed by direct survey -- and checks it against our own computeBarrowman for the exact
 * same geometry. it.each (not one aggregate assertion) so a single bad file fails on its own
 * line and can be re-run in isolation cheaply:
 *   npx vitest run validation/rocksim-embedded-cp.test.ts -t "Big Nuke 3E"
 *
 * TOLERANCE, and why it's 20% not something tighter: surveyed the full error distribution once
 * (see git history / re-run the debug loop below if this needs re-deriving) and found a clean,
 * ~4.5x gap in the data itself, not a chosen cutoff:
 *   - Rockets where parseRocksimXml found real fin components: errors form a smooth, continuous
 *     distribution from <1% up to 16.1%, entirely consistent with this project's own documented,
 *     INTENTIONAL deviation from stock Barrowman -- the corrected fin-body interference factor
 *     (see fin-calc.ts) increases fin CNa relative to RockSim's uncorrected calculation, pulling
 *     CP aft by an amount that naturally varies with each rocket's fin geometry. Every single one
 *     of these cases has our CP MORE AFT than RockSim's, zero exceptions -- exactly the signature
 *     a real, systematic, intentional difference should have, not random noise.
 *   - Rockets where parseRocksimXml found ZERO fin components: errors are 72.9%-115.7%, a
 *     completely different regime. Root-caused directly: these files mount their fins as
 *     "AttachedParts" (RockSim's pod/strap-on-part mechanism -- e.g. wildman/USS Andromeda.rkt's
 *     large decorative "sails" are literally an AttachedParts child of a body tube, not a normal
 *     FinSet sibling), which this project's parser has never supported -- explicitly out of scope
 *     per this project's original plan ("single-stack, no-pods case in scope"). A fin-less
 *     Barrowman calculation is missing its dominant CP-aft contributor entirely, hence the huge
 *     divergence. This is a real, known, documented gap -- not a bug to silently paper over, but
 *     also not something to block this suite on fixing right now (a real parser feature, not a
 *     quick fix) -- so those cases are called out explicitly below instead of asserted against.
 * 20% sits cleanly in the gap between these two clusters: comfortably covers every real
 * fin-parsed case's expected divergence, while still catching the "no fins parsed at all" failure
 * mode (or any other future bug of similar magnitude) as a hard failure.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { computeBarrowman } from "../src/physics/aero/barrowman.js";
import { parseRocksimXml } from "../src/formats/rocksim/parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY_DIR = path.resolve(__dirname, "../public/library");

// Mach 0.1 (~100fps, off-the-rail) -- matches the live UI's own reference speed (see
// renderRocketSection/renderFlightResultHtml in main.ts). CP barely moves across the low-subsonic
// band in this project's own model (traced and measured: ~0.02-0.03 calibers between 100fps and
// Mach 0.3), and RockSim's own reference Mach for BarromanXN isn't documented anywhere findable --
// this is well inside the tolerance below regardless of the exact low Mach either tool used.
const COMPARISON_MACH = 0.1;

// Same tag ANY .rkt file's whole-rocket CP lives in, confirmed directly against real files --
// not the per-component BarrowmanXN (different, correctly-spelled tag, one per part, holding
// each component's own local contribution, not the rocket-wide total).
function extractEmbeddedCpMm(xml: string): number | null {
  const match = xml.match(/<BarromanXN>([^<]*)<\/BarromanXN>/);
  if (!match) return null;
  const parts = match[1]!.split(",");
  const cp = Number(parts[1]);
  if (!Number.isFinite(cp) || cp === 0) return null;
  return cp;
}

interface LibraryCase {
  label: string;
  filePath: string;
}

function collectLibraryRktFiles(): LibraryCase[] {
  const cases: LibraryCase[] = [];
  for (const vendorDir of fs.readdirSync(LIBRARY_DIR, { withFileTypes: true })) {
    if (!vendorDir.isDirectory()) continue;
    const vendorPath = path.join(LIBRARY_DIR, vendorDir.name);
    for (const fileName of fs.readdirSync(vendorPath)) {
      if (!fileName.toLowerCase().endsWith(".rkt")) continue;
      cases.push({ label: `${vendorDir.name}/${fileName}`, filePath: path.join(vendorPath, fileName) });
    }
  }
  return cases;
}

const CP_TOLERANCE = 0.2;

const allFiles = collectLibraryRktFiles();
const casesWithEmbeddedCp = allFiles
  .map((c) => ({ ...c, xml: fs.readFileSync(c.filePath, "utf-8") }))
  .map((c) => ({ ...c, embeddedCpMm: extractEmbeddedCpMm(c.xml) }))
  .filter((c): c is LibraryCase & { xml: string; embeddedCpMm: number } => c.embeddedCpMm !== null)
  .map((c) => {
    const parsed = parseRocksimXml(c.xml);
    const hasFins = parsed.components.some((comp) => comp.type === "finset" || comp.type === "freeformfinset");
    const { cpX } = computeBarrowman(parsed.components, COMPARISON_MACH);
    const ourCpMm = cpX * 1000;
    const relError = Math.abs(ourCpMm - c.embeddedCpMm) / c.embeddedCpMm;
    return { ...c, hasFins, ourCpMm, relError };
  });

const finnedCases = casesWithEmbeddedCp.filter((c) => c.hasFins);
const finlessCases = casesWithEmbeddedCp.filter((c) => !c.hasFins);

describe("RockSim embedded CP vs. our own computeBarrowman (whole library)", () => {
  it(`found a real embedded CP in most of the library (sanity check on the extraction itself)`, () => {
    // A hard floor, not the exact count (339/322) -- the library grows over time; this just
    // catches extractEmbeddedCpMm itself breaking (e.g. a RockSim XML format change) before it
    // silently makes every case below a false "skipped, no embedded value" pass.
    expect(casesWithEmbeddedCp.length).toBeGreaterThan(allFiles.length * 0.8);
  });

  it.each(finnedCases.map((c) => [c.label, c] as const))("%s", (_label, c) => {
    expect(c.relError, `our CP ${c.ourCpMm.toFixed(1)}mm vs. RockSim's own ${c.embeddedCpMm}mm`).toBeLessThan(CP_TOLERANCE);
  });

  // Known, documented gap (see the file header) -- fins mounted via RockSim's AttachedParts/pod
  // mechanism aren't parsed at all, so these are EXPECTED to diverge wildly (72.9%-115.7%
  // observed) until that parser feature exists. Listed explicitly (not silently dropped) so a
  // future fix is easy to find and re-enable, and so the count itself is visible -- if this list
  // grows unexpectedly, that's worth noticing.
  it(`lists the known AttachedParts/pod fin-mount gap (currently ${finlessCases.length} files, all expected to diverge wildly)`, () => {
    for (const c of finlessCases) {
      expect(c.relError, `${c.label}: our CP ${c.ourCpMm.toFixed(1)}mm vs. RockSim's own ${c.embeddedCpMm}mm (no fin components parsed -- likely AttachedParts/pod-mounted fins, unsupported)`).toBeGreaterThan(CP_TOLERANCE);
    }
  });
});
