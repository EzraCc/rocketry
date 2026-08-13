/**
 * Validation script: geometry from sim-files/LOC/PK-48 LOC-IV.rkt (transcribed
 * by hand — no RockSim parser yet, that's M5), run through the real physics
 * modules (same code path as src/main.ts's demo page), compared against
 * RockSim's own stored CP/CNa values for this exact file.
 *
 * The fin is a RockSim <CustomFinSet> (a 5-point clipped-delta polygon, not a
 * plain trapezoid) — carried through as a FreeformFinSet and strip-integrated
 * exactly rather than approximated as a trapezoid (see
 * src/physics/aero/freeform-fin-calc.ts).
 */
import { computeBarrowman } from "../src/physics/aero/barrowman.js";
import type { Component } from "../src/model/component.js";

const MM = 0.001; // RockSim units are mm; convert to meters throughout.

const locIvComponents: Component[] = [
  {
    type: "nosecone",
    id: "loc-nose",
    name: "Nose cone",
    shape: "ogive", // ShapeCode=1 -> OGIVE (verified against RockSimNoseConeCode.java)
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
    // PointList from the .rkt file: "171.45,0|206.375,31.75|206.375,107.95|142.875,107.95|0,0|"
    points: [
      [171.45 * MM, 0],
      [206.375 * MM, 31.75 * MM],
      [206.375 * MM, 107.95 * MM],
      [142.875 * MM, 107.95 * MM],
      [0, 0],
    ],
    thickness: 3 * MM,
    cantAngle: 0,
    axialOffsetFromParentBottom: 412.75 * MM, // Xb, offset from tube2's start
  },
];

const mach = 0.001; // near-zero "static" reference, matching RockSim's displayed CP
const result = computeBarrowman(locIvComponents, mach);

console.log("=== rocketry (this project) ===");
console.log(`Total CNa: ${result.cna.toFixed(4)} /rad`);
console.log(`Total CP: ${(result.cpX * 1000).toFixed(2)} mm from nose tip`);
console.log(`Reference diameter: ${(result.refDiameter * 1000).toFixed(2)} mm`);

console.log("\n=== RockSim's own stored values for this file ===");
console.log("BarromanXN (RockSim's classical-Barrowman CP): 899.247 mm");
console.log("BarrowmanCNa (RockSim's classical-Barrowman CNa): 8.90536 /rad");
console.log("RockSimXN (RockSim's proprietary extended-method CP): 972.645 mm");
console.log("RockSimCNa (RockSim's proprietary extended-method CNa): 13.0284 /rad");

console.log("\n=== Delta vs RockSim classical Barrowman ===");
console.log(`ΔCP: ${(result.cpX * 1000 - 899.247).toFixed(2)} mm (${(((result.cpX * 1000 - 899.247) / 899.247) * 100).toFixed(1)}%)`);
