import type { BodyTube, Component, Transition, TrapezoidalFinSet } from "../../model/component.js";
import type { Shape } from "../../physics/geometry/shapes.js";

/**
 * RASAero (.CDX1) parser. Plain XML text, not zipped (like .rkt, unlike
 * .ork). Verified against OpenRocket's own Java RASAero importer
 * (core/src/main/java/info/openrocket/core/file/rasaero/**), not guessed —
 * and cross-checked against three real .CDX1 files bundled as OR's own test
 * fixtures (core/src/test/resources/file/rasaero/importt/*.CDX1).
 *
 * The user's own observation motivating this parser held up: RASAero really
 * is the simplest of the three formats to import, in the sense that matters
 * most here — no per-component mass/density tree, no motor-mount plumbing,
 * no recovery hardware to skip past. What replaces that simplicity is
 * genuine GEOMETRIC complexity .ork/.rkt don't have: a FinCan is not just a
 * body tube with fins, it's a shoulder transition (from the parent tube's
 * diameter up to the fin can's own) PLUS a tube PLUS fins, and RASAero fins
 * only ever mount on a FinCan, BoatTail, or (per real fixture evidence)
 * directly on a plain BodyTube -- never freeform, matching RASAero's own
 * restriction to trapezoidal fins.
 *
 * A genuinely useful simplification confirmed directly from OpenRocket's own
 * source: RASAeroHandler.java's importer NEVER reads the <Location> element
 * on any component (BodyTube/Transition/FinCan/BoatTail) -- every component
 * is simply appended in document order. This matches this project's own
 * flat sequential Component[] stacking exactly, so no axial-offset
 * conversion is needed for body components at all (unlike .rkt, which needed
 * a real, verified sign-convention fix for exactly this).
 */

const IN_TO_M = 1 / 39.37; // RASAeroCommonConstants.OPENROCKET_TO_RASAERO_LENGTH, transcribed exactly

export interface ParsedRasaeroRocket {
  name: string;
  components: Component[];
  /** RASAero files carry no motor data at all -- always empty, same as RockSim. */
  warnings: string[];
}

function directChild(el: Element, tag: string): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName === tag) return child;
  }
  return null;
}

function text(el: Element, tag: string): string | null {
  const child = directChild(el, tag);
  return child ? (child.textContent ?? "").trim() : null;
}

function num(el: Element, tag: string, fallback: number): number {
  const raw = text(el, tag);
  if (raw === null) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function lengthM(el: Element, tag: string, fallback = 0): number {
  return num(el, tag, fallback / IN_TO_M) * IN_TO_M;
}

function radiusFromDiaM(el: Element, tag: string, fallback = 0): number {
  return lengthM(el, tag, fallback * 2) / 2;
}

/**
 * RASAero's own shape names -> {this project's shape, shapeParameter}.
 * Transcribed exactly from RASAeroCommonConstants.java's
 * RASAeroNoseConeShapeMap / RASAERO_TO_OPENROCKET_SHAPE_PARAMETER --
 * deliberately non-obvious in two places: "Von Karman Ogive" maps to HAACK
 * (param 0), not our "ogive" shape, and RASAero's own "Parabolic" name maps
 * to POWER (param 0.5), not this project's "parabolic" shape at all.
 */
const SHAPE_MAP: Record<string, { shape: Shape; shapeParameter: number }> = {
  Conical: { shape: "conical", shapeParameter: 0 },
  "Tangent Ogive": { shape: "ogive", shapeParameter: 1 },
  "Von Karman Ogive": { shape: "haack", shapeParameter: 0 },
  "Power Law": { shape: "power", shapeParameter: 0 }, // overridden by the sibling <PowerLaw> element if present
  "LV-Haack": { shape: "haack", shapeParameter: 0.33 },
  Parabolic: { shape: "power", shapeParameter: 0.5 },
  Elliptical: { shape: "ellipsoid", shapeParameter: 0 },
};

function parseNoseCone(el: Element, warnings: string[]): NoseConeAndFin {
  const rawShape = text(el, "Shape") ?? "Tangent Ogive";
  const mapped = SHAPE_MAP[rawShape];
  if (!mapped) warnings.push(`Nose cone: unrecognized shape "${rawShape}", defaulting to ogive`);
  const shape = mapped?.shape ?? "ogive";
  let shapeParameter = mapped?.shapeParameter ?? 1;
  if (rawShape === "Power Law") shapeParameter = num(el, "PowerLaw", shapeParameter);

  return {
    component: {
      type: "nosecone",
      id: "Nose cone",
      name: "Nose cone",
      shape,
      shapeParameter,
      length: lengthM(el, "Length", 0),
      aftRadius: radiusFromDiaM(el, "Diameter", 0),
      thickness: 0.002, // RASAero doesn't specify wall thickness; matches OpenRocket's own importer's arbitrary default
    },
    fin: null,
  };
}

interface NoseConeAndFin {
  component: Component;
  fin: TrapezoidalFinSet | null;
}

/**
 * A fin's <Location> is documented (FinHandler.java) as "the location of the
 * front of the fin relative to the bottom of the body tube". Working through
 * OpenRocket's own AxialMethod.BOTTOM conversion algebraically
 * (axialOffset = -Location + rootChord, then this project's established
 * BOTTOM-mode formula parentLength - rootChord + axialOffset) the rootChord
 * terms cancel exactly, leaving a clean identity: offset from the parent's
 * fore end = parentLength - Location. Verified against two independent real
 * fixtures (Show-off.CDX1's FinCan fin, Complex.Two-Stage.CDX1's plain
 * BodyTube fin): both put the fin's trailing edge exactly flush with the
 * parent's aft end, the physically expected case.
 */
function parseFin(el: Element, parentLength: number, warnings: string[]): TrapezoidalFinSet | null {
  const rootChord = lengthM(el, "Chord", 0);
  if (rootChord < 1e-9) {
    warnings.push("Fin with zero root chord, skipped");
    return null;
  }
  const location = lengthM(el, "Location", 0);
  return {
    type: "finset",
    id: "Fin",
    name: "Fin",
    finCount: Math.round(num(el, "Count", 3)),
    rootChord,
    tipChord: lengthM(el, "TipChord", 0),
    sweepLength: lengthM(el, "SweepDistance", 0),
    span: lengthM(el, "Span", 0),
    thickness: lengthM(el, "Thickness", 0.003),
    cantAngle: 0, // RASAero's Fin element has no cant field at all -- it doesn't model fin cant/spin-stabilization
    axialOffsetFromParentBottom: parentLength - location,
  };
}

function parseBodyTube(el: Element, warnings: string[]): NoseConeAndFin {
  const length = lengthM(el, "Length", 0);
  const finEl = directChild(el, "Fin");
  const bodyTube: BodyTube = {
    type: "bodytube",
    id: "Body tube",
    name: "Body tube",
    length,
    radius: radiusFromDiaM(el, "Diameter", 0),
    thickness: 0.002,
    isMotorMount: false, // RASAero has no motor-mount concept at all -- every import falls back to the last body component, same as an .ork/.rkt file that never flags one either
  };
  return { component: bodyTube, fin: finEl ? parseFin(finEl, length, warnings) : null };
}

function parseTransition(el: Element): NoseConeAndFin {
  // RASAero transitions (and boattails) are always conical -- TransitionHandler.java hardcodes this; there's no <Shape> element to read at all.
  const transition: Transition = {
    type: "transition",
    id: "Transition",
    name: "Transition",
    shape: "conical",
    shapeParameter: 0,
    length: lengthM(el, "Length", 0),
    foreRadius: radiusFromDiaM(el, "Diameter", 0),
    aftRadius: radiusFromDiaM(el, "RearDiameter", 0),
    thickness: 0.002,
  };
  return { component: transition, fin: null };
}

function parseBoatTail(el: Element, warnings: string[]): NoseConeAndFin {
  const length = lengthM(el, "Length", 0);
  const finEl = directChild(el, "Fin");
  const transition: Transition = {
    type: "transition",
    id: "Boattail",
    name: "Boattail",
    shape: "conical",
    shapeParameter: 0,
    length,
    foreRadius: radiusFromDiaM(el, "Diameter", 0),
    aftRadius: radiusFromDiaM(el, "RearDiameter", 0),
    thickness: 0.002,
  };
  return { component: transition, fin: finEl ? parseFin(finEl, length, warnings) : null };
}

/**
 * "A RASAero fin can is basically a body tube with fins on that slides over
 * another body tube. The start of the fin can is a transition from the outer
 * diameter of the fin can tube[...] to the outer diameter of the parent
 * tube." (FinCanHandler.java's own doc comment.) Represented here as exactly
 * that, sequentially: a shoulder Transition (foreRadius=InsideDiameter/2,
 * matching OpenRocket's own choice to read this directly from the file
 * rather than cross-check it against whatever the previous component's
 * actual radius is) followed immediately by a BodyTube carrying the fins.
 * This project's flat single-stack model doesn't need OpenRocket's own
 * "recessed pod" machinery -- a FinCan always immediately follows its parent
 * tube here, which is the case both real fixture files actually exercise.
 */
function parseFinCan(el: Element, warnings: string[]): Component[] {
  const length = lengthM(el, "Length", 0);
  const outerRadius = radiusFromDiaM(el, "Diameter", 0);
  const shoulder: Transition = {
    type: "transition",
    id: "Fin can shoulder",
    name: "Fin can shoulder",
    shape: "conical",
    shapeParameter: 0,
    length: lengthM(el, "ShoulderLength", 0),
    foreRadius: radiusFromDiaM(el, "InsideDiameter", outerRadius),
    aftRadius: outerRadius,
    thickness: 0.002,
  };
  const tube: BodyTube = {
    type: "bodytube",
    id: "Fin can tube",
    name: "Fin can tube",
    length,
    radius: outerRadius,
    thickness: 0.002,
    isMotorMount: false,
  };
  const finEl = directChild(el, "Fin");
  const fin = finEl ? parseFin(finEl, length, warnings) : null;
  return fin ? [shoulder, tube, fin] : [shoulder, tube];
}

const SKIPPED_TAGS = new Set(["Surface", "CP", "ModifiedBarrowman", "Turbulence", "SustainerNozzle", "Booster1Nozzle", "Booster2Nozzle", "UseBooster1", "UseBooster2", "Comments"]);

export function parseRasaeroXml(xmlText: string, fileName?: string): ParsedRasaeroRocket {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(`Failed to parse .CDX1 XML: ${parserError.textContent ?? "unknown error"}`);
  }

  const design = doc.getElementsByTagName("RocketDesign")[0];
  if (!design) {
    throw new Error("No <RocketDesign> element found — not a valid .CDX1 file");
  }

  // RASAero files carry no rocket name at all (OpenRocket's own importer uses the filename
  // instead -- see RASAeroLoader.loadFromStream's `fileName` parameter) -- do the same.
  const name = fileName?.replace(/\.CDX1$/i, "") || "Imported rocket";

  const warnings: string[] = [];
  const components: Component[] = [];

  for (const el of Array.from(design.children)) {
    const tag = el.tagName;

    if (tag === "NoseCone") {
      const { component, fin } = parseNoseCone(el, warnings);
      components.push(component);
      if (fin) components.push(fin);
      continue;
    }
    if (tag === "BodyTube") {
      const { component, fin } = parseBodyTube(el, warnings);
      components.push(component);
      if (fin) components.push(fin);
      continue;
    }
    if (tag === "Transition") {
      components.push(parseTransition(el).component);
      continue;
    }
    if (tag === "BoatTail") {
      const { component, fin } = parseBoatTail(el, warnings);
      components.push(component);
      if (fin) components.push(fin);
      continue;
    }
    if (tag === "FinCan") {
      components.push(...parseFinCan(el, warnings));
      continue;
    }
    if (tag === "Booster") {
      // A Booster is a separate stage (see BoosterHandler.java: "A booster in RASAero is an
      // OpenRocket AxialStage") -- stop here, single-stage only, matching .ork/.rkt's own scope.
      warnings.push("This rocket has booster stage(s) below the sustainer — only the sustainer is imported (single-stage only, per this tool's scope).");
      break;
    }
    if (!SKIPPED_TAGS.has(tag)) {
      warnings.push(`Unsupported component type "${tag}", skipped`);
    }
  }

  return { name, components, warnings };
}
