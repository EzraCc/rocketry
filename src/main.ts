import { computeBarrowman, stabilityMargin } from "./physics/aero/barrowman.js";
import { renderSchematicSvg } from "./ui/schematic/render.js";
import { defaultRocket } from "./model/rocket.js";
import type { Component } from "./model/component.js";

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

const rocket = { ...defaultRocket(), name: "M1 demo rocket", components: demoComponents, dryCg: 0.24 };

const mach = 0.3;
const { cna, cpX, refDiameter } = computeBarrowman(rocket.components, mach);
const margin = stabilityMargin(cpX, rocket.dryCg, refDiameter);

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.innerHTML = `
    <h1>${rocket.name}</h1>
    <p>Static Barrowman results at Mach ${mach} (nose+tube+3 fins, no motor yet — M1 checkpoint)</p>
    <ul>
      <li>Total CNa: ${cna.toFixed(3)} /rad</li>
      <li>CP: ${(cpX * 1000).toFixed(1)} mm from nose tip</li>
      <li>CG (manual): ${(rocket.dryCg * 1000).toFixed(1)} mm from nose tip</li>
      <li>Reference diameter: ${(refDiameter * 1000).toFixed(1)} mm</li>
      <li>Stability margin: ${margin.toFixed(2)} calibers ${margin > 0 ? "(stable)" : "(unstable)"}</li>
    </ul>
    ${renderSchematicSvg(rocket.components, cpX, rocket.dryCg)}
  `;
}
