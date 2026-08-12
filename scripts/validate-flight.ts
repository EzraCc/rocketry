/**
 * End-to-end validation: fetch a real motor from ThrustCurve.org, build a
 * simple rocket around it, and run the actual M3 flight integrator. Reports
 * apogee/max-velocity/max-Mach and basic sanity commentary, plus timing (the
 * engine does a nontrivial amount of RK4 work per run and needs to stay fast
 * enough for interactive use in the browser).
 */
import { searchMotors, downloadThrustSamples } from "../src/physics/motor/thrustcurve-client.js";
import { simulateAscent } from "../src/physics/sim/engine.js";
import { defaultRocket, type Rocket, type SelectedMotor } from "../src/model/rocket.js";
import type { Component } from "../src/model/component.js";

async function runFor(query: { manufacturer: string; designation: string }, dryMassG: number) {
  const results = await searchMotors({ ...query, maxResults: 1 });
  const meta = results[0];
  if (!meta || meta.totalWeightG === undefined || meta.propWeightG === undefined) {
    console.log(`Skipping ${query.manufacturer} ${query.designation}: not found or missing weight data`);
    return;
  }
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

  const components: Component[] = [
    { type: "nosecone", id: "nose", name: "n", shape: "ogive", shapeParameter: 1, length: 0.12, aftRadius: meta.diameter / 2 / 1000, thickness: 0.002 },
    { type: "bodytube", id: "tube", name: "t", length: 0.35, radius: meta.diameter / 2 / 1000, thickness: 0.001, isMotorMount: true },
    {
      type: "finset", id: "fins", name: "f", finCount: 3, rootChord: 0.06, tipChord: 0.03,
      sweepLength: 0.03, span: 0.06, thickness: 0.003, cantAngle: 0, axialOffsetFromParentBottom: 0.29,
    },
  ];
  const rocket: Rocket = {
    ...defaultRocket(),
    components,
    dryMass: dryMassG / 1000,
    dryCg: 0.22,
    motorMount: { componentId: "tube", motorOverhang: 0 },
    motor,
    launchRodLength: 1.0,
  };

  const t0 = performance.now();
  const result = simulateAscent(rocket);
  const elapsedMs = performance.now() - t0;

  console.log(`\n=== ${meta.manufacturer} ${meta.designation} in a ${dryMassG}g dry-mass rocket ===`);
  console.log(`Total impulse: ${meta.totImpulseNs} N*s, burn time: ${meta.burnTimeS}s`);
  console.log(`Apogee: ${result.apogeeAltitude.toFixed(1)} m at t=${result.apogeeTime.toFixed(2)}s`);
  console.log(`Max velocity: ${result.maxVelocity.toFixed(1)} m/s, max Mach: ${result.maxMach.toFixed(3)}`);
  console.log(`Max acceleration: ${result.maxAcceleration.toFixed(1)} m/s^2 (${(result.maxAcceleration / 9.80665).toFixed(1)}g)`);
  console.log(`Events: ${result.events.map((e) => `${e.type}@${e.time.toFixed(2)}s/${e.altitude.toFixed(1)}m`).join(", ")}`);
  console.log(`Warnings: ${result.warnings.length ? result.warnings.join("; ") : "(none)"}`);
  console.log(`Simulation wall time: ${elapsedMs.toFixed(1)} ms for ${result.samples.length} samples`);
}

async function main() {
  // A light rocket with a small motor (classic combo, order-of-magnitude apogee is well known
  // to be in the tens-to-low-hundreds of meters range).
  await runFor({ manufacturer: "Estes", designation: "C6" }, 40);
  // A heavier-duty combo: mid-power motor in a heavier rocket, apogee should be substantially
  // higher (hundreds of meters) but still well subsonic.
  await runFor({ manufacturer: "AeroTech", designation: "F44W" }, 250);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
