/**
 * Scans every vendor folder under public/library/ (each a flat set of real
 * .rkt files, no nesting — see main.ts's LibraryManifestEntry doc comment
 * for the curation process behind them), parses each with the same
 * parseRocksimXml the browser uses, and (re)writes:
 *   - public/library/manifest.json — the small eagerly-loaded index the
 *     browse/filter UI in main.ts reads at startup (vendor, name, path,
 *     diameter, length, whether the file had import warnings).
 *   - public/library/INDEX.md — a human-readable table of the same data,
 *     grouped by vendor, for browsing the library without running the app.
 *
 * Run this after adding, removing, or renaming any file under
 * public/library/<vendor>/ — nothing else regenerates these automatically.
 *
 * Usage: npm run build:library
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = new JSDOM().window.DOMParser as unknown as typeof DOMParser;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const libraryDir = path.join(repoRoot, "public", "library");

const { parseRocksimXml } = await import("../src/formats/rocksim/parse.js");
const { overallLength, referenceDiameter } = await import("../src/physics/geometry/rocket-geometry.js");

interface ManifestDescentDevice {
  type: "parachute" | "streamer";
  role: "main" | "drogue";
  dragAreaM2: number;
  dragCoefficient: number;
}

interface ManifestEntry {
  id: string;
  vendor: string;
  name: string;
  path: string;
  diameterMm: number;
  lengthMm: number;
  warnings: boolean;
  /** Undefined when the file has no separately-flagged motor mount tube — caller falls back to diameterMm (the motor sits directly in the outer body, common on minimum-diameter builds). */
  motorMountDiameterMm?: number;
  descentDevices: ManifestDescentDevice[];
}

function nominalDiameterIn(mm: number): number {
  return Math.round((mm / 25.4) * 2) / 2;
}

// public/library/<dir>/ -> the display name shown in the UI's vendor filter and "From the
// library: <vendor> — <name>" subtitle. Folder names are lowercase/slug-like (filesystem
// convention); this is the one place that maps a folder to its real vendor name -- add new
// vendors here when their folder is added, or they'll show up capitalized-as-is instead.
const VENDOR_DISPLAY_NAMES: Record<string, string> = {
  loc: "LOC Precision",
  apogee: "Apogee",
  mach1: "Mach1",
  wildman: "Wildman",
};

function vendorDisplayName(dir: string): string {
  return VENDOR_DISPLAY_NAMES[dir] ?? dir;
}

const vendorDirs = fs
  .readdirSync(libraryDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const entries: ManifestEntry[] = [];
let failures = 0;

for (const vendorDir of vendorDirs) {
  const files = fs.readdirSync(path.join(libraryDir, vendorDir)).filter((f) => f.toLowerCase().endsWith(".rkt"));
  const vendorEntries: ManifestEntry[] = [];

  for (const file of files) {
    const relPath = `library/${vendorDir}/${file}`;
    const xml = fs.readFileSync(path.join(libraryDir, vendorDir, file), "utf-8");
    try {
      const parsed = parseRocksimXml(xml);
      if (parsed.components.length === 0) throw new Error("zero components");
      const lengthMm = overallLength(parsed.components) * 1000;
      const diameterMm = referenceDiameter(parsed.components) * 1000;
      if (!(diameterMm > 0) || !(lengthMm > 0)) throw new Error(`bad geometry (L=${lengthMm}, D=${diameterMm})`);
      vendorEntries.push({
        id: "", // assigned below, after sorting, so ids stay a stable-looking sequence within each vendor
        vendor: vendorDisplayName(vendorDir),
        name: path.basename(file, ".rkt"),
        path: relPath,
        diameterMm: Math.round(diameterMm * 10) / 10,
        lengthMm: Math.round(lengthMm * 10) / 10,
        warnings: parsed.warnings.length > 0,
        motorMountDiameterMm: parsed.motorMountDiameterM ? Math.round(parsed.motorMountDiameterM * 1000 * 10) / 10 : undefined,
        descentDevices: parsed.descentDevices.map((d) => ({
          type: d.type,
          role: d.role,
          dragAreaM2: Math.round(d.dragAreaM2 * 1e5) / 1e5,
          dragCoefficient: d.dragCoefficient,
        })),
      });
    } catch (err) {
      failures++;
      console.log(`FAILED: ${relPath} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // A vendor's own well-known "default" rocket (matched by display name, if present) sorts first
  // within that vendor purely so its id stays short/memorable — main.ts never relies on this
  // ordering itself (see LIBRARY_KNOWN_CP and initLibrary's default-rocket lookup, both keyed by
  // path, not id, specifically so a re-sort here can't silently break either).
  const vendorSlug = vendorDir.toLowerCase();
  vendorEntries.sort((a, b) => a.diameterMm - b.diameterMm || a.name.localeCompare(b.name));
  vendorEntries.forEach((e, i) => {
    e.id = `${vendorSlug}-${i}`;
  });
  entries.push(...vendorEntries);
}

fs.writeFileSync(path.join(libraryDir, "manifest.json"), JSON.stringify(entries));
console.log(`\nmanifest.json: ${entries.length} entries across ${vendorDirs.length} vendors (${failures} failures)`);

// --- human-readable index ---
const byVendor = new Map<string, ManifestEntry[]>();
for (const e of entries) {
  if (!byVendor.has(e.vendor)) byVendor.set(e.vendor, []);
  byVendor.get(e.vendor)!.push(e);
}

const MM_TO_IN = 1 / 25.4;
let md = `# Rocket library index\n\n`;
md += `Auto-generated by \`npm run build:library\` from \`public/library/manifest.json\` — do not hand-edit, re-run the script instead.\n\n`;
md += `${entries.length} rockets across ${byVendor.size} vendors.\n\n`;

// A drag area doesn't have a "diameter" for a streamer, but expressing it as the diameter of an
// equivalent flat disk of the same area is a reasonable, comparable-across-types display number.
function equivalentDiaIn(areaM2: number): string {
  return ((2 * Math.sqrt(areaM2 / Math.PI)) * (1 / 0.0254)).toFixed(0);
}

function recoveryLabel(devices: ManifestDescentDevice[]): string {
  if (devices.length === 0) return "—";
  return devices
    .slice()
    .sort((a, b) => (a.role === "main" ? -1 : 1) - (b.role === "main" ? -1 : 1))
    .map((d) => `${d.role} ${equivalentDiaIn(d.dragAreaM2)}in ${d.type === "streamer" ? "streamer" : "chute"}`)
    .join(", ");
}

for (const vendor of [...byVendor.keys()].sort()) {
  const vendorEntries = byVendor.get(vendor)!.slice().sort((a, b) => a.diameterMm - b.diameterMm || a.name.localeCompare(b.name));
  md += `## ${vendor} (${vendorEntries.length})\n\n`;
  md += `| Name | Diameter | Length | Motor mount | Recovery | File |\n|---|---|---|---|---|---|\n`;
  for (const e of vendorEntries) {
    const diaIn = nominalDiameterIn(e.diameterMm).toFixed(2).replace(/\.?0+$/, "");
    const lenIn = (e.lengthMm * MM_TO_IN).toFixed(1);
    const lenCm = (e.lengthMm / 10).toFixed(1);
    const warn = e.warnings ? " ⚠️" : "";
    const mount = e.motorMountDiameterMm ? `${e.motorMountDiameterMm.toFixed(0)}mm` : "— (uses outer body)";
    md += `| ${e.name}${warn} | ${diaIn}" (${e.diameterMm.toFixed(0)}mm) | ${lenIn}in (${lenCm}cm) | ${mount} | ${recoveryLabel(e.descentDevices)} | \`${e.path}\` |\n`;
  }
  md += `\n`;
}
md += `⚠️ = multi-stage source file; only the sustainer stage was imported (single-stage scope).\n`;

fs.writeFileSync(path.join(libraryDir, "INDEX.md"), md);
console.log(`INDEX.md: ${(md.length / 1024).toFixed(1)} KB`);

if (failures > 0) process.exitCode = 1;
