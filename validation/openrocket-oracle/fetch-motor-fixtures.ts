/**
 * Fetches and caches the real ThrustCurve.org data for every motor in rockets.json, into
 * validation/fixtures/motors/<label>.json. Run this whenever rockets.json changes, NOT as part of
 * `npm test` -- ../openrocket-comparison.test.ts reads these cached files instead of hitting the
 * network on every run, keeping the actual test suite fast/offline/hermetic like every other test
 * in this project.
 *
 * Usage: npx tsx validation/openrocket-oracle/fetch-motor-fixtures.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { searchMotors, downloadThrustSamples } from "../../src/physics/motor/thrustcurve-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROCKETS_JSON = path.resolve(__dirname, "rockets.json");
const OUT_DIR = path.resolve(__dirname, "../fixtures/motors");

// ThrustCurve.org's commonName search matches the simplified name without a propellant-type
// suffix (confirmed elsewhere in this project) -- strip a probable "<letter-class><number>" prefix
// out of a full designation like "K400C"/"H120-RL" to get a search term likely to find it, then
// confirm with an EXACT (manufacturer, designation) match among the results rather than trusting
// the fuzzy search alone. Manufacturer is required, not optional: multiple vendors can share a
// bare designation (confirmed directly -- ThrustCurve.org has both an Estes and a Quest Aerospace
// "C6") -- without pinning it, this script and RocketryOracle.java's own findMotors() call could
// each independently resolve a DIFFERENT physical motor sharing the same designation string.
function commonNameGuess(designation: string): string {
  const m = designation.match(/^[A-Za-z]+[0-9]+/);
  return m ? m[0] : designation;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(ROCKETS_JSON, "utf-8")) as {
    label: string;
    motorManufacturer: string;
    motorDesignation: string;
  }[];

  let okCount = 0;
  let failCount = 0;
  for (const entry of manifest) {
    process.stdout.write(`${entry.label} (${entry.motorManufacturer} ${entry.motorDesignation})... `);
    try {
      const results = await searchMotors({
        manufacturer: entry.motorManufacturer,
        commonName: commonNameGuess(entry.motorDesignation),
        maxResults: 50,
      });
      const match = results.find((r) => r.designation.toUpperCase() === entry.motorDesignation.toUpperCase());
      if (!match) {
        throw new Error(
          `no exact designation match among ${results.length} results for manufacturer "${entry.motorManufacturer}" commonName "${commonNameGuess(entry.motorDesignation)}"`,
        );
      }
      const { samples } = await downloadThrustSamples(match.motorId);
      fs.writeFileSync(path.join(OUT_DIR, `${entry.label}.json`), JSON.stringify({ meta: match, samples }, null, 2));
      console.log(`ok (${match.manufacturer} ${match.designation}, ${samples.length} samples)`);
      okCount++;
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
      failCount++;
    }
  }

  console.log(`\n${okCount} ok, ${failCount} failed, ${manifest.length} total`);
  if (failCount > 0) process.exit(1);
}

void main();
