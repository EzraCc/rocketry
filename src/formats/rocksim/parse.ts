import type { Component, FreeformFinSet, TrapezoidalFinSet } from "../../model/component.js";
import type { Shape } from "../../physics/geometry/shapes.js";

/**
 * RockSim (.rkt) parser. Unlike .ork this is plain XML text, not a zip
 * container — no unzip step needed.
 *
 * Verified against OpenRocket's own Java RockSim importer
 * (core/src/main/java/info/openrocket/core/file/rocksim/**), not guessed:
 * tag names/constants from RockSimCommonConstants.java, shape code mapping
 * from RockSimNoseConeCode.java, axial-offset sign handling from
 * PositionDependentHandler.java + FinSetHandler.java, and unit conversions
 * (mm->m /1000, diameter-in-mm->radius-in-m /2000) from the same. Also
 * cross-checked directly against the one real .rkt file already in this repo
 * (sim-files/LOC/PK-48 LOC-IV.rkt, the source of the hand-transcribed
 * locIvComponents fixture in src/main.ts).
 */

const MM_TO_M = 1 / 1000;
const DIA_MM_TO_RADIUS_M = 1 / 2000;
const DEG_TO_RAD = Math.PI / 180;

export interface ParsedRocksimRocket {
  name: string;
  components: Component[];
  /** RockSim files carry no motor data at all (only mount geometry) — always empty; motor selection is always the caller's job, same as for .ork. */
  warnings: string[];
  /**
   * Sum of every <CalcMass> element found anywhere in the file (kg), 0 if
   * none present. RockSim computes and caches this per-part from that part's
   * own <Density>/<Material> and geometry — including internal hardware this
   * project doesn't model aerodynamically (couplers, centering rings,
   * bulkheads, motor mount tube, recovery gear), which really does add to
   * what the motor has to lift. Summing it is NOT the same as porting
   * OpenRocket's own material-density mass calculator (RockSimHandler.java's
   * importer ignores these cached fields entirely and recomputes mass itself
   * from the same density/geometry inputs, only honoring the file's
   * <Stage3Mass>-style override when it's nonzero) — that calculator is
   * explicitly out of this project's MVP scope. This is a cheaper, honest
   * middle ground: real numbers already sitting in the file, not a guess,
   * used as a much better prefill than an arbitrary placeholder — a rocket
   * this size (see the LOC-IV fixture) is off by 20x+ from a 50g default.
   * Deliberately NOT attempting the equivalent for CG: unlike CalcMass
   * (a plain sum, no coordinate frame involved), each part's <CalcCG> is
   * local to that part's own fore end, and nested/internal parts' <Xb>
   * offsets are relative to a parent that isn't always resolvable from this
   * flat per-tag scan — getting that wrong would bias the derived CG
   * forward (parts skipped are concentrated aft, near the fins), which
   * makes the rocket look falsely MORE stable, the wrong direction to get
   * wrong silently. CG stays the caller's/user's responsibility.
   */
  estimatedDryMassKg: number;
}

function directChild(el: Element, tag: string): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName === tag) return child;
  }
  return null;
}

function directChildren(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName === tag);
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
  return num(el, tag, fallback / MM_TO_M) * MM_TO_M;
}

function radiusFromDiaM(el: Element, tag: string, fallback = 0): number {
  return num(el, tag, fallback / DIA_MM_TO_RADIUS_M) * DIA_MM_TO_RADIUS_M;
}

/**
 * RockSim's own shape-code enum, transcribed exactly from
 * RockSimNoseConeCode.java — deliberately non-obvious (codes 2 and 3 both
 * map to ellipsoid; code 2 is internally named "PARABOLIC" in RockSim's own
 * enum despite mapping to ellipsoid, while code 5 "PARABOLIC_SERIES" maps to
 * this project's actual "parabolic" shape) — not something to reconstruct
 * from guessing.
 */
const SHAPE_CODE_MAP: Record<number, Shape> = {
  0: "conical",
  1: "ogive",
  2: "ellipsoid",
  3: "ellipsoid",
  4: "power",
  5: "parabolic",
  6: "haack",
};
const SHAPE_PARAMETER_CODES = new Set([4, 5, 6]); // POWER_SERIES, PARABOLIC_SERIES, HAACK -- matches NoseConeHandler.java's own gate

/**
 * RockSim/OpenRocket's own importer ignores <ShapeParameter> entirely for
 * ogive (only power/parabolic/haack read it — see NoseConeHandler.java's own
 * gate above) because OpenRocket's internal ogive shape is always a fixed
 * tangent ogive with no variable parameter. This project's own ogive
 * (shapes.ts), however, DOES use the parameter meaningfully (a secant/tangent
 * blend, param=1 meaning "classic tangent ogive"). So unlike OR, this project
 * can't just leave shapeParameter at a throwaway default for ogive -- it must
 * be explicitly set to 1 (tangent), not left at 0, or the nose profile (and
 * hence its CP, though not its CNa -- CNa only depends on end areas) comes
 * out wrong. Caught via a real regression test (parse.test.ts) comparing
 * against the independently hand-transcribed LOC-IV fixture, which already
 * used shapeParameter=1 for its ogive nose cone.
 */
function parseShapeCode(el: Element): { shape: Shape; shapeParameter: number } {
  const code = Math.round(num(el, "ShapeCode", 2));
  const shape = SHAPE_CODE_MAP[code] ?? "ellipsoid"; // RockSimNoseConeCode.fromCode's own fallback is PARABOLIC(2) -> ellipsoid
  const shapeParameter = shape === "ogive" ? 1 : SHAPE_PARAMETER_CODES.has(code) ? num(el, "ShapeParameter", 0) : 0;
  return { shape, shapeParameter };
}

/**
 * Converts RockSim's <Xb> + <LocationMode> (a component's position relative
 * to its parent) into this project's axialOffsetFromParentBottom (offset
 * from the parent's own FORE end — see the .ork parser's identical-purpose
 * finAxialOffset for the general convention).
 *
 * LocationMode: 0=FRONT_OF_OWNING_PART (offset from parent's fore end,
 * unmodified -- also the default when the tag is absent, per
 * PositionDependentHandler.java's own field default), 1=FROM_TIP_OF_NOSE
 * (absolute, from the whole rocket's nose tip), 2=BACK_OF_OWNING_PART
 * (offset from parent's aft end).
 *
 * BACK_OF_OWNING_PART's sign is NOT the mirror of .ork's method="bottom" --
 * RockSim's raw Xb is POSITIVE-forward-of-flush-aft (subtracted), while
 * .ork's raw value is added directly. This is a real, documented OpenRocket
 * quirk (see PositionDependentHandler.java's `-1.0d * positionValue` and its
 * own comment referencing openrocket/openrocket#881) -- transcribed exactly,
 * not derived by symmetry with the .ork case.
 */
function axialOffset(el: Element, parentLength: number, childLength: number, parentAbsoluteX0: number): number {
  const locationMode = text(el, "LocationMode");
  const xb = num(el, "Xb", 0) * MM_TO_M;
  const mode = locationMode === null ? 0 : Math.round(Number.parseFloat(locationMode));

  if (mode === 2) return parentLength - childLength - xb; // BACK_OF_OWNING_PART
  if (mode === 1) return xb - parentAbsoluteX0; // FROM_TIP_OF_NOSE (absolute)
  return xb; // FRONT_OF_OWNING_PART (default)
}

function parseFinSet(el: Element, parentLength: number, parentAbsoluteX0: number, warnings: string[]): TrapezoidalFinSet | FreeformFinSet | null {
  const name = text(el, "Name") ?? "Fin set";
  const shapeCode = Math.round(num(el, "ShapeCode", 0));
  const finCount = Math.round(num(el, "FinCount", 3));
  const thickness = lengthM(el, "Thickness", 0.003);
  const cantAngle = num(el, "CantAngle", 0) * DEG_TO_RAD; // unverified unit -- see module doc comment
  const commonOffset = (rootChord: number) => axialOffset(el, parentLength, rootChord, parentAbsoluteX0);

  if (shapeCode === 0) {
    const rootChord = lengthM(el, "RootChord", 0);
    return {
      type: "finset",
      id: name,
      name,
      finCount,
      rootChord,
      tipChord: lengthM(el, "TipChord", 0),
      sweepLength: lengthM(el, "SweepDistance", 0),
      span: lengthM(el, "SemiSpan", 0),
      thickness,
      cantAngle,
      axialOffsetFromParentBottom: commonOffset(rootChord),
    };
  }

  if (shapeCode === 2) {
    const raw = text(el, "PointList") ?? "";
    const points: [number, number][] = raw
      .split("|")
      .filter((p) => p.length > 0)
      .map((pair) => {
        const [x, y] = pair.split(",");
        return [Number.parseFloat(x ?? "0") * MM_TO_M, Number.parseFloat(y ?? "0") * MM_TO_M] as [number, number];
      });
    const rootChord = points.filter(([, y]) => Math.abs(y) < 1e-9).reduce((max, [x]) => Math.max(max, x), 0);
    return {
      type: "freeformfinset",
      id: name,
      name,
      finCount,
      points,
      thickness,
      cantAngle,
      axialOffsetFromParentBottom: commonOffset(rootChord),
    };
  }

  // shapeCode === 1 is elliptical -- not supported by this project's Component model.
  warnings.push(`${name}: elliptical fins are not supported, skipped`);
  return null;
}

/** Whether this component (or any nested inner tube inside it) has <IsMotorMount>1</IsMotorMount> anywhere in its subtree. */
function hasMotorMount(el: Element): boolean {
  return Array.from(el.getElementsByTagName("IsMotorMount")).some((n) => (n.textContent ?? "").trim() === "1");
}

/** Fin sets found as direct children of this component's own <AttachedParts> (fins are always nested there in real RockSim files, never deeper). */
function finsOf(el: Element, parentLength: number, parentAbsoluteX0: number, warnings: string[]): (TrapezoidalFinSet | FreeformFinSet)[] {
  const attached = directChild(el, "AttachedParts");
  if (!attached) return [];
  return [...directChildren(attached, "FinSet"), ...directChildren(attached, "CustomFinSet")]
    .map((finEl) => parseFinSet(finEl, parentLength, parentAbsoluteX0, warnings))
    .filter((f): f is TrapezoidalFinSet | FreeformFinSet => f !== null);
}

const SKIPPED_BUT_KNOWN_TAGS = new Set([
  "Ring", "MassObject", "Parachute", "Streamer", "LaunchLug", "TubeFinSet", "ExternalPod", "RingTail",
]);

/** Walks one stage's direct part elements in document order, mirroring parseOrkXml's walkStage. */
function walkStageParts(stageEl: Element, warnings: string[]): Component[] {
  const out: Component[] = [];
  let x = 0; // running absolute position of the part currently being placed, for LocationMode=1 (FROM_TIP_OF_NOSE)

  for (const el of Array.from(stageEl.children)) {
    const tag = el.tagName;
    const name = text(el, "Name") ?? tag;

    if (tag === "NoseCone") {
      const { shape, shapeParameter } = parseShapeCode(el);
      const length = lengthM(el, "Len", 0);
      out.push({
        type: "nosecone",
        id: name,
        name,
        shape,
        shapeParameter,
        length,
        aftRadius: radiusFromDiaM(el, "BaseDia", 0),
        thickness: lengthM(el, "WallThickness", 0.002),
      });
      out.push(...finsOf(el, length, x, warnings));
      x += length;
      continue;
    }

    if (tag === "BodyTube") {
      const length = lengthM(el, "Len", 0);
      out.push({
        type: "bodytube",
        id: name,
        name,
        length,
        radius: radiusFromDiaM(el, "OD", 0),
        thickness: lengthM(el, "WallThickness", 0.001),
        isMotorMount: text(el, "IsMotorMount") === "1" || hasMotorMount(el),
      });
      out.push(...finsOf(el, length, x, warnings));
      x += length;
      continue;
    }

    if (tag === "Transition") {
      const { shape, shapeParameter } = parseShapeCode(el);
      const length = lengthM(el, "Len", 0);
      out.push({
        type: "transition",
        id: name,
        name,
        shape,
        shapeParameter,
        length,
        foreRadius: radiusFromDiaM(el, "FrontDia", 0),
        aftRadius: radiusFromDiaM(el, "RearDia", 0),
        thickness: lengthM(el, "WallThickness", 0.002),
      });
      out.push(...finsOf(el, length, x, warnings));
      x += length;
      continue;
    }

    if (tag === "FinSet" || tag === "CustomFinSet") {
      warnings.push(`${name}: fin set found with no parent body component, skipped`);
      continue;
    }

    if (tag !== "SubAssembly" && !SKIPPED_BUT_KNOWN_TAGS.has(tag)) {
      warnings.push(`${name}: unsupported component type "${tag}", skipped`);
    }
    // Not aero geometry this project models -- nothing further to do (no nested motor-mount
    // lookup needed here since these tags aren't body components fins could attach to, and
    // RockSim inner tubes always live inside a BodyTube's own AttachedParts, already covered above).
  }
  return out;
}

export function parseRocksimXml(xmlText: string): ParsedRocksimRocket {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(`Failed to parse .rkt XML: ${parserError.textContent ?? "unknown error"}`);
  }

  const design = doc.getElementsByTagName("RocketDesign")[0];
  if (!design) {
    throw new Error("No <RocketDesign> element found — not a valid .rkt file");
  }

  const warnings: string[] = [];
  const name = text(design, "Name") ?? "Imported rocket";

  // RockSim numbers stages top-down: a single-stage rocket's parts are in Stage3Parts (the
  // sustainer); Stage2Parts/Stage1Parts are the boosters below it, present only for multi-stage
  // designs. See RocketDesignHandler.java's own comment: "In Rocksim stages are from the top
  // down, so a single stage rocket is actually stage '3'."
  const stage3 = doc.getElementsByTagName("Stage3Parts")[0];
  const stage2 = doc.getElementsByTagName("Stage2Parts")[0];
  const stage1 = doc.getElementsByTagName("Stage1Parts")[0];

  if (!stage3 || stage3.children.length === 0) {
    throw new Error("No parts found in Stage3Parts (sustainer) — not a supported .rkt file");
  }
  const extraStages = [stage2, stage1].filter((s) => s && s.children.length > 0).length;
  if (extraStages > 0) {
    warnings.push(`This rocket has booster stage(s) below the sustainer — only the sustainer (Stage3Parts) is imported (single-stage only, per this tool's scope).`);
  }

  const components = walkStageParts(stage3, warnings);

  const estimatedDryMassKg =
    Array.from(design.getElementsByTagName("CalcMass")).reduce((sum, el) => sum + (Number.parseFloat(el.textContent ?? "0") || 0), 0) / 1000;

  return { name, components, warnings, estimatedDryMassKg };
}
