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
   * The sustainer's dry mass (kg), 0 if unavailable. Two possible sources, checked in this order
   * (see parseRocksimXml's own comment at the point this is decided):
   *
   * 1. RockSim's own whole-stage "known mass" override (<UseKnownMass>1</UseKnownMass> +
   *    <Stage3Mass>) -- a real scale measurement the file's author entered, preferred whenever
   *    present since it doesn't depend on this parser's own per-part sum being right.
   * 2. Sum of every <CalcMass>/<KnownMass> entry in the sustainer stage's part tree -- see
   *    dryMassBreakdown's doc comment for exactly how this is computed (a real tree-walk, not a
   *    flat document scan; this field is the sum of that breakdown's own massKg values). RockSim
   *    computes and caches this per-part from that part's own <Density>/<Material> and geometry --
   *    including internal hardware this project doesn't model aerodynamically (couplers, centering
   *    rings, bulkheads, motor mount tube, recovery gear), which really does add to what the motor
   *    has to lift. This is NOT the same as porting OpenRocket's own material-density mass
   *    calculator (RockSimHandler.java's importer ignores these cached fields entirely and
   *    recomputes mass itself) -- that's explicitly out of this project's MVP scope. This is a
   *    cheaper, honest middle ground: real numbers already sitting in the file, not a guess -- but
   *    only as good as RockSim's own per-part density assumptions, which a known-mass override
   *    (source 1) exists specifically to correct for when they're off (confirmed real, not
   *    hypothetical: the library's own Zephyr.rkt has a known mass 38% lighter than this parser's
   *    own tree-sum -- see parseRocksimXml).
   */
  estimatedDryMassKg: number;
  /**
   * Mass-weighted dry CG (m from nose tip), or undefined if unavailable. Same two sources/priority
   * as estimatedDryMassKg above (RockSim's <Stage3CG> known-mass-override pairing, else the
   * tree-walk's own moment sum) -- see dryMassBreakdown for how each tree-walk part's absolute
   * position is resolved when that's the source in use.
   */
  estimatedDryCgM?: number;
  /**
   * Every mass-contributing part found in the sustainer stage's tree — not
   * just the top-level body components this parser turns into aerodynamic
   * Components, but everything nested inside their <AttachedParts> too
   * (fins, couplers, centering rings, bulkheads, the motor mount tube,
   * recovery gear, mass objects), at ANY nesting depth (confirmed real:
   * some files nest an AttachedParts part inside another AttachedParts
   * part's own AttachedParts). Each entry's cgXM is that part's OWN
   * <CalcCG> (local to that part's fore end, confirmed directly: a
   * Bulkhead's CalcCG is exactly half its own Len, matching a
   * uniform-density flat disc) resolved to an ABSOLUTE position by walking
   * back through its ancestor chain's own axialOffset()s to the nose tip --
   * the identical position-resolution logic finsOf/axialOffset already use
   * for fins, generalized to every attached part, not just fins.
   *
   * This generalization is exactly what estimatedDryMassKg's own doc
   * comment used to say was NOT being attempted for CG ("nested/internal
   * parts' <Xb> offsets are relative to a parent that isn't always
   * resolvable from this flat per-tag scan") -- that limitation was about a
   * flat per-tag scan specifically; a real recursive tree-walk (this) does
   * resolve it, by construction, the same way the rest of this parser
   * already resolves nested component positions.
   *
   * Cross-checked against OpenRocket's own independently-computed dry CG
   * for 6 real library files (see validation/openrocket-comparison.test.ts)
   * before this was trusted for anything CG-related.
   *
   * Empty (not just unused) whenever estimatedDryMassKg/estimatedDryCgM came from RockSim's own
   * known-mass override instead -- it wouldn't sum to that total, and showing a per-part table that
   * visibly doesn't add up to the number above it would read as a bug, not a feature.
   */
  dryMassBreakdown: { name: string; massKg: number; cgXM: number }[];
  /**
   * Inner diameter (m) of the actual motor mount tube — what size motor
   * physically fits, which can be much smaller than the rocket's own outer
   * body diameter (e.g. the LOC-IV fixture: 101.6mm body, 38.6mm motor
   * mount). Found via the same <IsMotorMount> flag as isMotorMount above,
   * but reading the flagged tube's own <ID> rather than just noting which
   * outer component it belongs to — undefined if no component has the flag
   * set (see hasMotorMount's own doc comment: real files sometimes leave it
   * unset even on an unambiguous motor mount tube, e.g. this project's own
   * LOC-IV reference file). Callers should fall back to the reference/outer
   * body diameter in that case, same as this parser's own motor-mount
   * *detection* already does elsewhere (isMotorMount on the aft-most tube).
   */
  motorMountDiameterM?: number;
  /** Recovery devices found anywhere in the file, classified main/drogue — see extractDescentDevices's doc comment for how. */
  descentDevices: DescentDevice[];
  /**
   * Human-readable list of geometry this parser can locate but doesn't model well enough to
   * simulate: external pods, tube fins, ring tails, and multi-stage designs (this tool's scope is
   * single-stage, standard nosecone/body/transition + trapezoidal or freeform fins). Empty for
   * supported files.
   *
   * Non-empty specifically means: don't trust estimatedDryCgM (see its own doc comment — the
   * position-resolution logic below has no correct way to size an ExternalPod's own bounding
   * length, since RockSim gives it no <Len> tag of its own, only nested children; confirmed
   * directly on Wildman Cerberus, off by 2.4 calibers vs. OpenRocket's own dry CG before this was
   * caught), and don't run a flight simulation at all — this project's aero model has no
   * representation for pods/tube fins/ring tails, and multi-stage means only the sustainer is even
   * parsed. Callers should block simulation and show the file as view/download-only.
   */
  unsupportedFeatures: string[];
  /** RockSim's own last-computed CP (m from nose tip), via its proprietary extended method -- see extractEmbeddedCpM's own doc comment. Undefined if the file never had one computed. Independent of unsupportedFeatures/estimatedDryCgM's gating -- this is RockSim's own number, not derived from this parser's own tree-walk, so it's exposed regardless of geometry support. */
  embeddedCpM?: number;
}

export interface DescentDevice {
  type: "parachute" | "streamer";
  role: "main" | "drogue";
  /** Effective drag area (m^2): a parachute's disk area minus its spill hole, or a streamer's length x width. */
  dragAreaM2: number;
  dragCoefficient: number;
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

/**
 * RockSim's own per-part sequential identifier (present and unique across every part in a real
 * file, confirmed directly — 12 parts, SerialNo 1-12, including fins), used as this project's
 * Component.id instead of the display <Name>, which routinely collides: 160/339 library files
 * have at least one duplicate part name (e.g. LOC-IV alone has two body tubes both literally named
 * "Body tube"). This was a REAL bug, not hypothetical: the one place this project looks a
 * component up by id (motorAxialPosition in combined-mass.ts, resolving which body tube the motor
 * sits in) was silently matching the WRONG tube whenever the intended one wasn't the first with
 * that name — for LOC-IV specifically, this put the assumed motor position ~580mm forward of
 * reality (the misidentified tube's full length), a multi-caliber error in derived dry CG.
 * Falls back to the display name (this project's previous behavior) if SerialNo is ever absent.
 */
function uniqueId(el: Element, name: string): string {
  return text(el, "SerialNo") ?? name;
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
      id: uniqueId(el, name),
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
      id: uniqueId(el, name),
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

/**
 * Inner diameter of the actual motor-mount tube, searched across the whole
 * document (not just the sustainer stage — the flag lives on whichever
 * tube RockSim's own UI had it checked on, wherever that tube sits in the
 * part tree). Takes the FIRST flagged tube found; real single-stage files
 * only ever have one.
 *
 * Falls back to matching an inner tube (<IsInsideTube>1</IsInsideTube>)
 * whose own <PartDesc> mentions "motor mount" if no tube has the flag set —
 * a real, verified case, not a hypothetical: this project's own LOC-IV
 * reference file has an unambiguous motor mount tube (PartDesc "Motor
 * mount tube", a real EngineOverhang value, ID matching a standard 38mm
 * motor) with <IsMotorMount> left at 0, apparently never checked in
 * RockSim's own UI when the file was built. Still returns undefined (for
 * the caller to fall back to the reference/outer body diameter) if neither
 * signal finds anything — true for files with no separate inner mount tube
 * at all (the motor sits directly in the outer body, common on minimum-
 * diameter builds).
 */
function extractMotorMountDiameterM(design: Element): number | undefined {
  const flag = Array.from(design.getElementsByTagName("IsMotorMount")).find((n) => (n.textContent ?? "").trim() === "1");
  let tube: Element | undefined = flag?.parentElement ?? undefined;
  if (!tube) {
    tube = Array.from(design.getElementsByTagName("BodyTube")).find(
      (el) => text(el, "IsInsideTube") === "1" && /motor mount/i.test(text(el, "PartDesc") ?? ""),
    );
  }
  if (!tube) return undefined;
  const id = num(tube, "ID", 0);
  return id > 0 ? id * MM_TO_M : undefined;
}

/**
 * RockSim's own last-computed CP via its PROPRIETARY extended method -- <RockSimXN>, a
 * document-level, motor-independent tag (comma-separated per-stage values, mm; this parser only
 * handles the sustainer, i.e. index 1 -- same convention/position as <BarromanXN>, see
 * rocksim-embedded-cp.test.ts's own extractEmbeddedCpMm). Distinct from RockSim's OWN classical
 * Barrowman CP (<BarromanXN>, closer to but not identical to this parser's own computeBarrowman) --
 * RockSim's extended/proprietary method includes corrections this project doesn't implement, hence
 * "proprietary." Present whenever the file's author has ever opened/viewed the CP calculation in
 * RockSim (which computes it automatically); 0/absent means never computed, or geometry with no
 * fins (RockSim leaves it 0 rather than omitting the tag).
 */
function extractEmbeddedCpM(design: Element): number | undefined {
  const raw = text(design, "RockSimXN");
  if (raw === null) return undefined;
  const mm = Number.parseFloat(raw.split(",")[1] ?? "");
  return Number.isFinite(mm) && mm !== 0 ? mm * MM_TO_M : undefined;
}

/**
 * Every <Parachute>/<Streamer> anywhere in the document, classified
 * main/drogue. RockSim has no dedicated "this is the drogue" flag; real
 * files distinguish them by naming the part "Drogue ..." (verified against
 * a real dual-deploy fixture) — matched here case-insensitively. Anything
 * not explicitly named as a drogue is provisionally "main"; if more than
 * one device ends up provisional (no explicit drogue found, or multiple
 * plain-named devices), the smallest by drag area is reassigned to
 * "drogue" and the largest stays "main" — a drogue is, definitionally,
 * the smaller/faster-falling one, so size is a physically grounded
 * tiebreak, not a guess. A single device with nothing else present just
 * stays "main" (the common single-deploy case).
 */
function extractDescentDevices(design: Element): DescentDevice[] {
  const devices: { name: string; type: "parachute" | "streamer"; dragAreaM2: number; dragCoefficient: number }[] = [];

  for (const el of Array.from(design.getElementsByTagName("Parachute"))) {
    const diaM = num(el, "Dia", 0) * MM_TO_M;
    const spillM = num(el, "SpillHoleDia", 0) * MM_TO_M;
    const areaM2 = Math.PI * ((diaM / 2) ** 2 - (spillM / 2) ** 2);
    if (areaM2 <= 0) continue;
    devices.push({ name: text(el, "Name") ?? "", type: "parachute", dragAreaM2: areaM2, dragCoefficient: num(el, "DragCoefficient", 0.8) });
  }
  for (const el of Array.from(design.getElementsByTagName("Streamer"))) {
    const lenM = num(el, "Len", 0) * MM_TO_M;
    const widthM = num(el, "Width", 0) * MM_TO_M;
    const areaM2 = lenM * widthM;
    if (areaM2 <= 0) continue;
    devices.push({ name: text(el, "Name") ?? "", type: "streamer", dragAreaM2: areaM2, dragCoefficient: num(el, "DragCoefficient", 0.6) });
  }

  const explicitDrogues = devices.filter((d) => /drogue/i.test(d.name));
  const provisionalMains = devices.filter((d) => !/drogue/i.test(d.name));
  provisionalMains.sort((a, b) => b.dragAreaM2 - a.dragAreaM2);
  const reassignedDrogue = provisionalMains.length > 1 ? provisionalMains.pop() : undefined;

  const result: DescentDevice[] = [];
  for (const d of explicitDrogues) result.push({ type: d.type, role: "drogue", dragAreaM2: d.dragAreaM2, dragCoefficient: d.dragCoefficient });
  for (const d of provisionalMains) result.push({ type: d.type, role: "main", dragAreaM2: d.dragAreaM2, dragCoefficient: d.dragCoefficient });
  if (reassignedDrogue) result.push({ type: reassignedDrogue.type, role: "drogue", dragAreaM2: reassignedDrogue.dragAreaM2, dragCoefficient: reassignedDrogue.dragCoefficient });
  return result;
}

/** Fin sets found as direct children of this component's own <AttachedParts> (fins are always nested there in real RockSim files, never deeper). */
function finsOf(el: Element, parentLength: number, parentAbsoluteX0: number, warnings: string[]): (TrapezoidalFinSet | FreeformFinSet)[] {
  const attached = directChild(el, "AttachedParts");
  if (!attached) return [];
  return [...directChildren(attached, "FinSet"), ...directChildren(attached, "CustomFinSet")]
    .map((finEl) => parseFinSet(finEl, parentLength, parentAbsoluteX0, warnings))
    .filter((f): f is TrapezoidalFinSet | FreeformFinSet => f !== null);
}

/**
 * This element's own <CalcMass>/<CalcCG> contribution (if any) plus every part nested inside its
 * <AttachedParts>, recursively (arbitrarily deep — confirmed real: some files nest an
 * AttachedParts part inside another AttachedParts part's own AttachedParts). Generalizes
 * finsOf/axialOffset's own position-resolution logic to every attached part, not just fins — same
 * <Xb>/<LocationMode> handling, just applied uniformly regardless of tag name.
 *
 * `el`'s own contribution uses `parentAbsoluteX0` directly (the caller has already resolved el's
 * own absolute position before calling this) — this function's job is just el's own CalcMass/CalcCG
 * plus recursing into whatever's attached to it.
 */
function collectMassBreakdown(
  el: Element,
  elLength: number,
  elAbsoluteX0: number,
  out: { name: string; massKg: number; cgXM: number }[],
): void {
  // Parts with no shape/material to compute from (MassObject -- ballast, altimeters, trackers,
  // shock cords) always have CalcMass=0 and rely on a user-entered KnownMass instead; RockSim
  // itself falls back the same way, so skipping CalcMass===0 parts entirely would silently drop
  // real mass (confirmed: Patriot BT50's "Nose Weight" MassObject is 28.3g of user-entered ballast
  // with CalcMass=0).
  const calcMassG = num(el, "CalcMass", 0);
  const knownMassG = num(el, "KnownMass", 0);
  const massG = calcMassG > 0 ? calcMassG : knownMassG;
  if (massG > 0) {
    // A shaped part's CalcCG is a genuine local offset from its own fore end (confirmed: a
    // Bulkhead's CalcCG is exactly half its own Len). A KnownMass-only part (no shape) has no such
    // offset to add on top of its own Xb-resolved placement -- its <KnownCG> looked like a further
    // local refinement at first (same field name/units as CalcCG) but isn't: surveyed 862
    // UseKnownCG=1 MassObjects library-wide and 88% have KnownCG numerically identical to Xb (a
    // redundant mirror of the object's own placement, not an independent offset); treating it as
    // additive double-counted that placement (confirmed on LOC-IV's "NW-15" shock cord: Xb=288.9mm
    // relative to its parent resolves to the correct absolute Station of 893.4mm on its own, but
    // adding KnownCG on top pushed it to 1182mm, a bogus 289mm-aft error). Its <Len> can't stand in
    // for a real local offset either -- confirmed nonsensical for a point-mass accessory: that same
    // NW-15 entry has Len=6096mm (a shock cord's own unrolled length), 5x the whole rocket's length.
    // A KnownMass part's own resolved placement is simply its full CG position, no correction.
    const localCgM = calcMassG > 0 ? num(el, "CalcCG", 0) * MM_TO_M : 0;
    out.push({ name: text(el, "Name") ?? el.tagName, massKg: massG / 1000, cgXM: elAbsoluteX0 + localCgM });
  }

  const attached = directChild(el, "AttachedParts");
  if (!attached) return;
  for (const child of Array.from(attached.children)) {
    // Fins measure their own length as RootChord (matches finsOf's own commonOffset convention,
    // since axialOffset's BACK_OF_OWNING_PART case needs the child's true length to subtract);
    // everything else (rings, couplers, bulkheads, inner tubes, mass objects) uses Len, defaulting
    // to 0 for anything without one (treated as a point at its own Xb offset — a reasonable
    // simplification for small hardware, not a real source of error at whole-rocket scale).
    const isFin = child.tagName === "FinSet" || child.tagName === "CustomFinSet";
    const childLength = isFin ? lengthM(child, "RootChord", 0) : lengthM(child, "Len", 0);
    const childAbsoluteX0 = elAbsoluteX0 + axialOffset(child, elLength, childLength, elAbsoluteX0);
    collectMassBreakdown(child, childLength, childAbsoluteX0, out);
  }
}

const SKIPPED_BUT_KNOWN_TAGS = new Set([
  "Ring", "MassObject", "Parachute", "Streamer", "LaunchLug", "TubeFinSet", "ExternalPod", "RingTail",
]);

/** Walks one stage's direct part elements in document order, mirroring parseOrkXml's walkStage. Also collects every mass-contributing part (top-level components AND everything nested in their AttachedParts) into dryMassBreakdown -- see ParsedRocksimRocket's doc comment for why this needs a real tree-walk, not a flat scan. */
function walkStageParts(stageEl: Element, warnings: string[]): { components: Component[]; dryMassBreakdown: { name: string; massKg: number; cgXM: number }[] } {
  const out: Component[] = [];
  const dryMassBreakdown: { name: string; massKg: number; cgXM: number }[] = [];
  let x = 0; // running absolute position of the part currently being placed, for LocationMode=1 (FROM_TIP_OF_NOSE)

  for (const el of Array.from(stageEl.children)) {
    const tag = el.tagName;
    const name = text(el, "Name") ?? tag;

    if (tag === "NoseCone") {
      const { shape, shapeParameter } = parseShapeCode(el);
      const length = lengthM(el, "Len", 0);
      out.push({
        type: "nosecone",
        id: uniqueId(el, name),
        name,
        shape,
        shapeParameter,
        length,
        aftRadius: radiusFromDiaM(el, "BaseDia", 0),
        thickness: lengthM(el, "WallThickness", 0.002),
      });
      out.push(...finsOf(el, length, x, warnings));
      collectMassBreakdown(el, length, x, dryMassBreakdown);
      x += length;
      continue;
    }

    if (tag === "BodyTube") {
      const length = lengthM(el, "Len", 0);
      out.push({
        type: "bodytube",
        id: uniqueId(el, name),
        name,
        length,
        radius: radiusFromDiaM(el, "OD", 0),
        thickness: lengthM(el, "WallThickness", 0.001),
        isMotorMount: text(el, "IsMotorMount") === "1" || hasMotorMount(el),
      });
      out.push(...finsOf(el, length, x, warnings));
      collectMassBreakdown(el, length, x, dryMassBreakdown);
      x += length;
      continue;
    }

    if (tag === "Transition") {
      const { shape, shapeParameter } = parseShapeCode(el);
      const length = lengthM(el, "Len", 0);
      out.push({
        type: "transition",
        id: uniqueId(el, name),
        name,
        shape,
        shapeParameter,
        length,
        foreRadius: radiusFromDiaM(el, "FrontDia", 0),
        aftRadius: radiusFromDiaM(el, "RearDia", 0),
        thickness: lengthM(el, "WallThickness", 0.002),
      });
      out.push(...finsOf(el, length, x, warnings));
      collectMassBreakdown(el, length, x, dryMassBreakdown);
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
  return { components: out, dryMassBreakdown };
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

  // This tool's scope is single-stage, standard nosecone/body/transition + trapezoidal or
  // freeform fins -- these tag names are geometry it can locate in the file but not model
  // correctly (see unsupportedFeatures' own doc comment for why, and ParsedRocksimRocket's for the
  // concrete Cerberus case that surfaced this).
  const UNSUPPORTED_TAGS: Record<string, string> = {
    ExternalPod: "external pods",
    TubeFinSet: "tube fins",
    RingTail: "ring tails",
  };
  const unsupportedFeatures = Object.entries(UNSUPPORTED_TAGS)
    .filter(([tag]) => stage3.getElementsByTagName(tag).length > 0)
    .map(([, label]) => label);
  if (extraStages > 0) unsupportedFeatures.push("multiple stages");

  const { components, dryMassBreakdown } = walkStageParts(stage3, warnings);

  // Cluster motor mounts: more than one tube flagged IsMotorMount=1 anywhere in the sustainer's
  // tree, at any depth (a top-level body tube directly flagged, or two+ inner tubes nested inside
  // one -- confirmed both patterns exist in the library, e.g. Trivecta/Karman Lines Transport,
  // though those specific files are already caught by the ExternalPod check above; this raw scan
  // catches a cluster mount that isn't pod-based too).
  const motorMountFlagCount = Array.from(stage3.getElementsByTagName("IsMotorMount")).filter(
    (n) => (n.textContent ?? "").trim() === "1",
  ).length;
  if (motorMountFlagCount > 1) unsupportedFeatures.push("cluster motor mounts");

  // RockSim has its own whole-stage "known mass/CG" override -- a real scale/balance measurement
  // the file's own author entered (RocketDesign's <UseKnownMass>1</UseKnownMass>, paired with
  // <Stage3Mass>/<Stage3CG> for the sustainer specifically; RockSim numbers stages top-down, same
  // as Stage3Parts above), which RockSim itself uses INSTEAD of summing the per-part
  // Calc/KnownMass tree below when set. Checked first and preferred over the tree-walk sum: a real
  // measurement of the assembled airframe is strictly more trustworthy than this parser's own
  // per-part sum, which depends on every part's own density/geometry being modeled correctly by
  // RockSim in the first place -- confirmed concretely on the library's own Zephyr.rkt (real case,
  // not hypothetical): UseKnownMass=1, Stage3Mass=1096g, Stage3CG=927.1mm, while this parser's own
  // component sum computed 1508g/958.0mm -- a 38% mass overcount from summing parts whose
  // individual density assumptions don't hold up, that the file's own author had already measured
  // around by entering a real known mass/CG directly. 12/339 library files set this flag.
  //
  // The per-part dryMassBreakdown is withheld (not just left inconsistent with the total) when
  // this override applies -- it wouldn't sum to the authoritative Stage3Mass/CG figure, and showing
  // a breakdown that visibly doesn't add up to the number above it would read as a bug, not a
  // feature. components (this parser's aerodynamic geometry) is entirely unaffected either way --
  // this override is mass/CG-only, RockSim has no equivalent "known CP" concept.
  const useKnownMass = text(design, "UseKnownMass") === "1";
  const knownStage3MassG = num(design, "Stage3Mass", 0);

  let estimatedDryMassKg: number;
  let estimatedDryCgM: number | undefined;
  let finalDryMassBreakdown: { name: string; massKg: number; cgXM: number }[];

  if (useKnownMass && knownStage3MassG > 0) {
    estimatedDryMassKg = knownStage3MassG / 1000;
    estimatedDryCgM = num(design, "Stage3CG", 0) * MM_TO_M;
    finalDryMassBreakdown = [];
  } else {
    estimatedDryMassKg = dryMassBreakdown.reduce((sum, part) => sum + part.massKg, 0);
    const totalMoment = dryMassBreakdown.reduce((sum, part) => sum + part.massKg * part.cgXM, 0);
    estimatedDryCgM = unsupportedFeatures.length === 0 && estimatedDryMassKg > 0 ? totalMoment / estimatedDryMassKg : undefined;
    finalDryMassBreakdown = dryMassBreakdown;
  }

  const motorMountDiameterM = extractMotorMountDiameterM(design);
  const descentDevices = extractDescentDevices(design);
  const embeddedCpM = extractEmbeddedCpM(design);

  return {
    name,
    components,
    warnings,
    estimatedDryMassKg,
    estimatedDryCgM,
    dryMassBreakdown: finalDryMassBreakdown,
    motorMountDiameterM,
    descentDevices,
    unsupportedFeatures,
    embeddedCpM,
  };
}
