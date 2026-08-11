import { computeBarrowman, stabilityMargin } from "./physics/aero/barrowman.js";
import { renderSchematicSvg } from "./ui/schematic/render.js";
import { defaultRocket, type Rocket } from "./model/rocket.js";
import type { Component } from "./model/component.js";

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
  name: 'LOC Precision "PK-48 LOC-IV" (real rocket, from sim-files/LOC/PK-48 Loc-IV.rkt)',
  components: locIvComponents,
  dryCg: 0, // not entered — mass/CG is manual per this tool's design; omitted here, so no stability margin is shown below
};

function renderRocketSection(
  rocket: Rocket,
  mach: number,
  knownCp?: { label: string; mm: number }[],
): string {
  const { cna, cpX, refDiameter } = computeBarrowman(rocket.components, mach);
  const hasCg = rocket.dryCg > 0;
  const margin = hasCg ? stabilityMargin(cpX, rocket.dryCg, refDiameter) : null;

  const knownCpRows = (knownCp ?? [])
    .map((k) => {
      const deltaMm = cpX * 1000 - k.mm;
      const deltaPct = (deltaMm / k.mm) * 100;
      return `<li>${k.label}: ${k.mm.toFixed(1)} mm (Δ ${deltaMm >= 0 ? "+" : ""}${deltaMm.toFixed(1)} mm, ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%)</li>`;
    })
    .join("");

  return `
    <section style="margin-bottom: 3em;">
      <h2>${rocket.name}</h2>
      <p>Static Barrowman results at Mach ${mach}${hasCg ? "" : " — mass/CG not entered for this rocket, so no stability margin is shown"}</p>
      <ul>
        <li>Total CNa: ${cna.toFixed(3)} /rad</li>
        <li>Computed CP: ${(cpX * 1000).toFixed(1)} mm from nose tip</li>
        ${hasCg ? `<li>CG (manual): ${(rocket.dryCg * 1000).toFixed(1)} mm from nose tip</li>` : ""}
        <li>Reference diameter: ${(refDiameter * 1000).toFixed(1)} mm</li>
        ${margin !== null ? `<li>Stability margin: ${margin.toFixed(2)} calibers ${margin > 0 ? "(stable)" : "(unstable)"}</li>` : ""}
      </ul>
      ${knownCpRows ? `<p>Known CP values (for comparison):</p><ul>${knownCpRows}</ul>` : ""}
      ${renderSchematicSvg(rocket.components, cpX, hasCg ? rocket.dryCg : undefined)}
    </section>
  `;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.innerHTML = `
    <h1>rocketry — M1 checkpoint</h1>
    ${renderRocketSection(demoRocket, 0.3)}
    ${renderRocketSection(locIvRocket, 0.001, [
      { label: "RockSim classical Barrowman CP (BarromanXN)", mm: 899.247 },
      { label: "RockSim proprietary extended-method CP (RockSimXN)", mm: 972.645 },
    ])}
  `;
}
