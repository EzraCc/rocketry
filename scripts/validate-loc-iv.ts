/**
 * One-off validation script: load the geometry from
 * sim-files/LOC/PK-48 Loc-IV.rkt by hand (no RockSim parser yet — that's
 * M5), run it through the existing M1 Barrowman physics, and compare the
 * resulting CP against RockSim's own stored BarromanXN value for this file.
 *
 * NOTE: the fin set in this file is a RockSim <CustomFinSet> (a 5-point
 * clipped-delta polygon, not a plain trapezoid), so this script computes the
 * fin's CNa/CP directly from its actual point list via strip integration,
 * rather than forcing it through the MVP's trapezoid-only fin calculator.
 * That's more code than the trapezoid path but it's an honest comparison —
 * force-fitting a trapezoid to a non-trapezoidal outline would silently bias
 * the result.
 */
import { symmetricComponentAero } from "../src/physics/aero/symmetric-component-calc.js";
import { bodyFinInterferenceFactor } from "../src/physics/aero/fin-calc.js";
import type { NoseCone, BodyTube } from "../src/model/component.js";

const MM = 0.001; // RockSim units are mm; convert to meters throughout.

// --- Geometry transcribed directly from the .rkt file (see sim-files/LOC/) ---

const noseCone: NoseCone = {
  type: "nosecone",
  id: "nose",
  name: "Nose cone",
  shape: "ogive", // ShapeCode=1 -> OGIVE (verified against RockSimNoseConeCode.java)
  shapeParameter: 1, // RockSim ogives are always tangent; ShapeParameter is unused for OGIVE
  length: 325.12 * MM,
  aftRadius: (101.6 / 2) * MM, // BaseDia/2
  thickness: 3.175 * MM,
};

const tube1: BodyTube = {
  type: "bodytube",
  id: "tube1",
  name: "Body tube (fwd)",
  length: 279.4 * MM,
  radius: (101.6 / 2) * MM,
  thickness: 0,
  isMotorMount: false,
};

const tube2: BodyTube = {
  type: "bodytube",
  id: "tube2",
  name: "Body tube (aft, carries fins)",
  length: 584.2 * MM,
  radius: (101.6 / 2) * MM,
  thickness: 0,
  isMotorMount: false,
};

// Axial start (from nose tip) of each body component, by stacking.
const noseX0 = 0;
const tube1X0 = noseX0 + noseCone.length; // 325.12mm
const tube2X0 = tube1X0 + tube1.length; // 604.52mm

// Fin set: <CustomFinSet>, Station=1017.27mm (absolute), attached to tube2
// (tube2 spans 604.52 to 1188.72mm). Fin-local x=0 is the root leading edge;
// Xb=412.75mm is the offset from tube2's start, consistent with
// 604.52+412.75=1017.27 matching the reported Station.
const finRootX0 = tube2X0 + 412.75 * MM;
const bodyRadiusAtFin = (101.6 / 2) * MM; // constant-radius tube here, no interpolation needed

// PointList (mm, fin-local x=chordwise from root LE, y=spanwise from root):
// "171.45,0|206.375,31.75|206.375,107.95|142.875,107.95|0,0|"
// Implicit closing edge from the last point (0,0) back to the first
// (171.45,0) is the root chord.
const finPolygonMm: [number, number][] = [
  [171.45, 0],
  [206.375, 31.75],
  [206.375, 107.95],
  [142.875, 107.95],
  [0, 0],
];

// --- Strip-integrate the actual polygon (not a trapezoid approximation) ---

function polygonChordAt(y: number): { xLE: number; xTE: number } {
  // Split the closed polygon (via the implicit closing edge) into its
  // leading-edge chain (x increasing... really: points ordered root TE -> tip
  // TE region -> tip LE region -> root LE) and find the two edges that
  // straddle spanwise position y on each "side" of the outline.
  const closed = [...finPolygonMm, finPolygonMm[0]!];
  const xsAtY: number[] = [];
  for (let i = 0; i < closed.length - 1; i++) {
    const [x0, y0] = closed[i]!;
    const [x1, y1] = closed[i + 1]!;
    if ((y0 <= y && y <= y1) || (y1 <= y && y <= y0)) {
      if (Math.abs(y1 - y0) < 1e-9) continue; // horizontal edge, skip (handled by neighbors)
      const t = (y - y0) / (y1 - y0);
      xsAtY.push(x0 + t * (x1 - x0));
    }
  }
  if (xsAtY.length < 2) return { xLE: 0, xTE: 0 };
  return { xLE: Math.min(...xsAtY), xTE: Math.max(...xsAtY) };
}

const span = 107.95; // mm, = SemiSpan field
const N = 400;
let area = 0; // mm^2
let areaChord2 = 0; // for MAC length
let areaY = 0; // for MAC spanwise position
let areaLE = 0; // for MAC leading-edge x position
let sumCosGamma = 0;
let prevMidX: number | null = null;
let prevY: number | null = null;
let cosGammaSamples = 0;

for (let i = 0; i <= N; i++) {
  const y = (i / N) * span;
  const { xLE, xTE } = polygonChordAt(y);
  const chord = xTE - xLE;
  const w = i === 0 || i === N ? 0.5 : 1;
  const dy = span / N;
  area += w * chord * dy;
  areaChord2 += w * chord * chord * dy;
  areaY += w * y * chord * dy;
  areaLE += w * xLE * chord * dy;

  const midX = (xLE + xTE) / 2;
  if (prevMidX !== null && prevY !== null) {
    const dMidX = midX - prevMidX;
    const dYStep = y - prevY;
    const hyp = Math.hypot(dMidX, dYStep);
    if (hyp > 1e-9) {
      sumCosGamma += dYStep / hyp;
      cosGammaSamples++;
    }
  }
  prevMidX = midX;
  prevY = y;
}

const finArea = area; // mm^2 (single fin, one side — matches OpenRocket's getPlanformArea convention)
const macLength = areaChord2 / area;
const macSpanPos = areaY / area;
const macLead = areaLE / area;
const cosGamma = sumCosGamma / cosGammaSamples;

console.log("--- Fin polygon strip-integration results ---");
console.log(`finArea (single fin): ${finArea.toFixed(1)} mm^2  (RockSim doesn't report this directly)`);
console.log(`macLength: ${macLength.toFixed(2)} mm`);
console.log(`macSpanPos: ${macSpanPos.toFixed(2)} mm`);
console.log(`macLead: ${macLead.toFixed(2)} mm`);
console.log(`cosGamma (avg mid-chord sweep cosine): ${cosGamma.toFixed(4)}`);

// --- CNa1 (single fin, subsonic, "static"/near-zero-Mach reference) ---
const mach = 0.001;
const refDiameterM = 101.6 * MM; // widest body diameter
const refAreaM2 = Math.PI * (refDiameterM / 2) ** 2;
const spanM = span * MM;
const finAreaM2 = finArea * MM * MM;
const cna1 = (2 * Math.PI * spanM * spanM) /
  (1 + Math.sqrt(1 + (1 - mach * mach) * ((spanM * spanM) / (finAreaM2 * cosGamma)) ** 2)) /
  refAreaM2;

const finCount = 3;
const tau = bodyRadiusAtFin / (spanM + bodyRadiusAtFin);
const bodyFactor = bodyFinInterferenceFactor(tau, mach); // MVP-corrected (1+tau)^2 formula
const finCountInterference = 1.0; // finCount<=4 -> no reduction
const finSetCna = cna1 * (finCount / 2) * finCountInterference * bodyFactor;
const finSetCpXLocal = macLead * MM + 0.25 * macLength * MM; // from fin root LE
const finSetCpXAbs = finRootX0 + finSetCpXLocal;

console.log("\n--- Fin set aero (MVP-corrected body interference) ---");
console.log(`finSetCna: ${finSetCna.toFixed(4)} /rad`);
console.log(`finSetCpX (from nose tip): ${(finSetCpXAbs / MM).toFixed(2)} mm`);
console.log(`tau: ${tau.toFixed(4)}, bodyFactor(corrected): ${bodyFactor.toFixed(4)}, classical(1+tau): ${(1 + tau).toFixed(4)}`);

// --- Whole-rocket combination (nose + 2 tubes + fins) ---
const noseAero = symmetricComponentAero(noseCone, refAreaM2);
const tube1Aero = symmetricComponentAero(tube1, refAreaM2);
const tube2Aero = symmetricComponentAero(tube2, refAreaM2);

const contributions = [
  { name: "Nose cone", cna: noseAero.cna, cpX: noseX0 + noseAero.cpX },
  { name: "Body tube 1", cna: tube1Aero.cna, cpX: tube1X0 + tube1Aero.cpX },
  { name: "Body tube 2", cna: tube2Aero.cna, cpX: tube2X0 + tube2Aero.cpX },
  { name: "Fin set (corrected)", cna: finSetCna, cpX: finSetCpXAbs },
];

let cnaSum = 0;
let cnaXSum = 0;
for (const c of contributions) {
  cnaSum += c.cna;
  cnaXSum += c.cna * c.cpX;
  console.log(`${c.name}: CNa=${c.cna.toFixed(4)} /rad, CP=${(c.cpX / MM).toFixed(2)} mm`);
}
const totalCpX = cnaXSum / cnaSum;

console.log("\n=== TOTAL (rocketry M1 physics) ===");
console.log(`Total CNa: ${cnaSum.toFixed(4)} /rad`);
console.log(`Total CP: ${(totalCpX / MM).toFixed(2)} mm from nose tip`);

console.log("\n=== Also compute with classical (uncorrected) (1+tau) body interference, for reference ===");
const finSetCnaClassical = cna1 * (finCount / 2) * finCountInterference * (1 + tau);
const cnaSumClassical = noseAero.cna + tube1Aero.cna + tube2Aero.cna + finSetCnaClassical;
const cnaXSumClassical =
  noseAero.cna * (noseX0 + noseAero.cpX) +
  tube1Aero.cna * (tube1X0 + tube1Aero.cpX) +
  tube2Aero.cna * (tube2X0 + tube2Aero.cpX) +
  finSetCnaClassical * finSetCpXAbs;
console.log(`Total CNa (classical): ${cnaSumClassical.toFixed(4)} /rad`);
console.log(`Total CP (classical): ${(cnaXSumClassical / cnaSumClassical / MM).toFixed(2)} mm`);

console.log("\n=== RockSim's own stored values for this file ===");
console.log("BarromanXN (RockSim's classical-Barrowman CP): 899.247 mm");
console.log("BarrowmanCNa (RockSim's classical-Barrowman CNa): 8.90536 /rad");
console.log("RockSimXN (RockSim's proprietary extended-method CP): 972.645 mm");
console.log("RockSimCNa (RockSim's proprietary extended-method CNa): 13.0284 /rad");
