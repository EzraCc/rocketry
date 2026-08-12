/**
 * End-to-end sanity check: parse a real .ork file through the actual
 * unzip+parse pipeline, then run the result through the real physics
 * (computeBarrowman) -- same "verify with real data, not just does it run"
 * pattern as validate-loc-iv.ts.
 *
 * Usage: npx tsx scripts/validate-ork-import.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { unzipOrkXml } from "../src/formats/ork/unzip.js";
import { parseOrkXml } from "../src/formats/ork/parse.js";
import { computeBarrowman } from "../src/physics/aero/barrowman.js";

// parseOrkXml uses the browser-native DOMParser (present in the real shipped
// app and in vitest's jsdom test environment) -- this plain-Node script needs
// the same polyfill vitest gives tests, dev-tooling only, not shipped.
globalThis.DOMParser = new JSDOM().window.DOMParser;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const files = ["A simple model rocket.ork", "Base drag hack (short-wide).ork", "Three stage low power rocket.ork"];
  for (const file of files) {
    const bytes = fs.readFileSync(path.resolve(__dirname, "../sim-files/ork", file));
    const xml = await unzipOrkXml(bytes);
    const parsed = parseOrkXml(xml);
    const { cna, cpX, refDiameter } = computeBarrowman(parsed.components, 0.3);

    console.log(`\n=== ${file} ===`);
    console.log(`name: ${parsed.name}`);
    console.log(`components: ${parsed.components.map((c) => c.type).join(", ")}`);
    console.log(`motor: ${parsed.motor ? `${parsed.motor.manufacturer} ${parsed.motor.designation}` : "(none)"}`);
    console.log(`warnings: ${parsed.warnings.length ? parsed.warnings.join(" | ") : "(none)"}`);
    console.log(`CNa=${cna.toFixed(3)} /rad, CP=${(cpX * 1000).toFixed(1)}mm, refDiameter=${(refDiameter * 1000).toFixed(1)}mm`);

    if (!Number.isFinite(cna) || !Number.isFinite(cpX) || cna <= 0) {
      throw new Error(`Sanity check failed for ${file}: non-finite or non-positive CNa/CP`);
    }
  }
  console.log("\nAll files produced finite, positive CNa and a CP position — sanity check passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
