/**
 * Validation script: fetch a real motor from the live ThrustCurve.org API,
 * run it through the actual physics modules, and check the results against
 * ThrustCurve.org's own reported stats (totImpulseNs, totalWeightG,
 * propWeightG) — same validation approach used for the LOC-IV rocket
 * (scripts/validate-loc-iv.ts), but for the motor-data side of M2.
 */
import { searchMotors, downloadThrustSamples } from "../src/physics/motor/thrustcurve-client.js";
import { totalImpulse, burnTime, getThrustAt } from "../src/physics/motor/motor-model.js";
import { deriveMotorMassCurve, getMotorMassAt } from "../src/physics/mass/motor-mass-curve.js";
import type { SelectedMotor } from "../src/model/rocket.js";

async function main() {
  const query = { manufacturer: "Estes", designation: "C6", maxResults: 5 };
  console.log(`Searching ThrustCurve.org for`, query);
  const results = await searchMotors(query);
  console.log(`Found ${results.length} result(s)`);
  const motorMeta = results[0];
  if (!motorMeta) throw new Error("No motor found");
  console.log(motorMeta);

  const samples = await downloadThrustSamples(motorMeta.motorId);
  console.log(`\nDownloaded ${samples.length} thrust samples`);

  const motor: SelectedMotor = {
    motorId: motorMeta.motorId,
    designation: motorMeta.designation,
    manufacturer: motorMeta.manufacturer,
    diameter: motorMeta.diameter / 1000,
    length: motorMeta.length / 1000,
    totalMassKg: motorMeta.totalWeightG / 1000,
    propellantMassKg: motorMeta.propWeightG / 1000,
    samples,
    delay: 0,
  };

  console.log("\n=== Thrust curve ===");
  console.log(`burnTime: ${burnTime(motor).toFixed(3)} s  (ThrustCurve.org reports: ${motorMeta.burnTimeS} s)`);
  console.log(
    `totalImpulse (trapezoidal integration of our thrust curve): ${totalImpulse(motor).toFixed(3)} N*s  (ThrustCurve.org reports: ${motorMeta.totImpulseNs} N*s)`,
  );
  console.log(`thrust at t=0.1s: ${getThrustAt(motor, 0.1).toFixed(2)} N`);
  console.log(`max sample thrust: ${Math.max(...samples.map((s) => s.thrust)).toFixed(2)} N  (ThrustCurve.org reports maxThrustN: ${motorMeta.maxThrustN})`);

  console.log("\n=== Mass curve (derived — ThrustCurve.org has no mass-vs-time data) ===");
  const massCurve = deriveMotorMassCurve(motor);
  console.log(`mass(0): ${(getMotorMassAt(massCurve, 0) * 1000).toFixed(2)} g  (should equal totalWeightG: ${motorMeta.totalWeightG} g)`);
  const bt = burnTime(motor);
  console.log(
    `mass(burnout=${bt.toFixed(3)}s): ${(getMotorMassAt(massCurve, bt) * 1000).toFixed(2)} g  (should equal totalWeightG-propWeightG: ${(motorMeta.totalWeightG - motorMeta.propWeightG).toFixed(2)} g)`,
  );
  console.log(`mass(0.3s): ${(getMotorMassAt(massCurve, 0.3) * 1000).toFixed(2)} g (mid-burn, sanity check — should be between the two endpoints)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
