import type { Component, FinCrossSection, FreeformFinSet, TrapezoidalFinSet } from "../../model/component.js";
import type { Shape } from "../../physics/geometry/shapes.js";
import type { DescentDevice } from "../rocksim/parse.js";

const DEG_TO_RAD = Math.PI / 180;
const KNOWN_SHAPES: Shape[] = ["conical", "ogive", "ellipsoid", "power", "parabolic", "haack"];

export interface OrkMotorRef {
  manufacturer: string;
  designation: string;
}

export interface ParsedOrkRocket {
  name: string;
  components: Component[];
  /** The default flight configuration's motor (manufacturer+designation), for a ThrustCurve.org search — null if the file has no motor selected. */
  motor: OrkMotorRef | null;
  /** The actual motor mount tube's own inner diameter (m), when one is found — see extractMotorMountDiameterM's own doc comment. Undefined if the file has no <motormount> tag at all. */
  motorMountDiameterM?: number;
  /** Recovery devices found in the imported (sustainer) stage, classified main/drogue — see extractDescentDevices's own doc comment for how. */
  descentDevices: DescentDevice[];
  warnings: string[];
  /** OpenRocket's own last-computed CP (m from nose tip), read from a saved simulation's flight data -- see extractEmbeddedCpM's own doc comment. Undefined if the file has no saved simulation with a usable CP value. */
  embeddedCpM?: number;
}

/** First direct child element with a given (lowercase) tag name — not a deep query, since .ork nests same-named tags (e.g. nested <subcomponents>) at every level. */
function directChild(el: Element, tag: string): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName.toLowerCase() === tag) return child;
  }
  return null;
}

function directChildren(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName.toLowerCase() === tag);
}

/** The <subcomponents> element's own direct children, or [] if absent. */
function subcomponentsOf(el: Element): Element[] {
  const sub = directChild(el, "subcomponents");
  return sub ? Array.from(sub.children) : [];
}

function text(el: Element, tag: string): string | null {
  const child = directChild(el, tag);
  return child ? (child.textContent ?? "").trim() : null;
}

/** Handles OpenRocket's `radius`/`foreradius`/`aftradius` values, which are sometimes literally the string "auto" or "auto <number>" (auto-fit to the adjoining component) rather than a bare number. */
function numberMaybeAuto(el: Element, tag: string, fallback: number): number {
  const raw = text(el, tag);
  if (raw === null) return fallback;
  const stripped = raw.startsWith("auto") ? raw.slice(4).trim() : raw;
  const n = Number.parseFloat(stripped);
  return Number.isFinite(n) ? n : fallback;
}

function number(el: Element, tag: string, fallback: number): number {
  const raw = text(el, tag);
  if (raw === null) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseShape(el: Element, warnings: string[], componentName: string): { shape: Shape; shapeParameter: number } {
  const raw = (text(el, "shape") ?? "ogive").toLowerCase();
  const shape = KNOWN_SHAPES.includes(raw as Shape) ? (raw as Shape) : "ogive";
  if (shape !== raw) {
    warnings.push(`${componentName}: unrecognized shape "${raw}", defaulting to ogive`);
  }
  const shapeParameter = number(el, "shapeparameter", 1);
  return { shape, shapeParameter };
}

/**
 * Converts OpenRocket's <axialoffset method="bottom|top|middle">value</axialoffset>
 * (fin position relative to its parent tube, measured from the named
 * reference edge) into this project's axialOffsetFromParentBottom field,
 * which despite its name is stored as an absolute offset from the parent's
 * own FORE end (see rocket-geometry.ts's placeComponents — it adds this
 * value directly to the parent's x0). Verified against this project's own
 * hand-built fixtures: a fin flush with a tube's aft end (OR's
 * method="bottom" value=0) is stored here as (parentLength - finRootChord).
 */
function finAxialOffset(el: Element, parentLength: number, finRootChord: number, warnings: string[], name: string): number {
  const offsetEl = directChild(el, "axialoffset");
  const method = offsetEl?.getAttribute("method") ?? "bottom";
  const value = offsetEl ? Number.parseFloat((offsetEl.textContent ?? "0").trim()) : 0;
  const v = Number.isFinite(value) ? value : 0;

  switch (method) {
    case "bottom":
      return parentLength - finRootChord + v;
    case "top":
      return v;
    case "middle":
      return (parentLength - finRootChord) / 2 + v;
    default:
      warnings.push(`${name}: unsupported axialoffset method "${method}", treating as measured from the parent's fore end`);
      return v;
  }
}

/** OpenRocket's <crosssection> stores the FinSet.CrossSection enum name lowercased (e.g. "square"/"rounded"/"airfoil") -- confirmed via DocumentConfig.findEnum's own lowercasing. Absent (the common case -- most sample files never write it) defaults to "square", matching FinSet's own Java default. */
function parseCrossSection(el: Element): FinCrossSection {
  const raw = text(el, "crosssection");
  if (raw === "rounded" || raw === "airfoil") return raw;
  return "square";
}

function parseTrapezoidFinSet(el: Element, parentLength: number, warnings: string[]): TrapezoidalFinSet {
  const name = text(el, "name") ?? "Fin set";
  const rootChord = number(el, "rootchord", 0);
  return {
    type: "finset",
    id: text(el, "id") ?? name,
    name,
    finCount: Math.round(number(el, "fincount", 3)),
    rootChord,
    tipChord: number(el, "tipchord", 0),
    sweepLength: number(el, "sweeplength", 0),
    span: number(el, "height", 0), // OpenRocket calls fin span "height"
    thickness: number(el, "thickness", 0.003),
    cantAngle: number(el, "cant", 0) * DEG_TO_RAD,
    crossSection: parseCrossSection(el),
    axialOffsetFromParentBottom: finAxialOffset(el, parentLength, rootChord, warnings, name),
  };
}

function parseFreeformFinSet(el: Element, parentLength: number, warnings: string[]): FreeformFinSet {
  const name = text(el, "name") ?? "Fin set";
  const pointsEl = directChild(el, "finpoints");
  const points: [number, number][] = pointsEl
    ? directChildren(pointsEl, "point").map((p) => [
        Number.parseFloat(p.getAttribute("x") ?? "0"),
        Number.parseFloat(p.getAttribute("y") ?? "0"),
      ])
    : [];
  const rootChord = points.filter(([, y]) => Math.abs(y) < 1e-9).reduce((max, [x]) => Math.max(max, x), 0);
  return {
    type: "freeformfinset",
    id: text(el, "id") ?? name,
    name,
    finCount: Math.round(number(el, "fincount", 3)),
    points,
    thickness: number(el, "thickness", 0.003),
    cantAngle: number(el, "cant", 0) * DEG_TO_RAD,
    crossSection: parseCrossSection(el),
    axialOffsetFromParentBottom: finAxialOffset(el, parentLength, rootChord, warnings, name),
  };
}

/** Fin sets found as direct children of this body component's own <subcomponents> (real .ork files always nest fins there, never deeper). */
function finsOf(el: Element, parentLength: number, warnings: string[]): (TrapezoidalFinSet | FreeformFinSet)[] {
  return subcomponentsOf(el)
    .map((child) => {
      const tag = child.tagName.toLowerCase();
      if (tag === "trapezoidfinset") return parseTrapezoidFinSet(child, parentLength, warnings);
      if (tag === "freeformfinset") return parseFreeformFinSet(child, parentLength, warnings);
      return null;
    })
    .filter((f): f is TrapezoidalFinSet | FreeformFinSet => f !== null);
}

/** Whether this body component (or anything nested inside it, e.g. an inner tube) hosts a motor mount. */
function hasMotorMount(el: Element): boolean {
  return el.getElementsByTagName("motormount").length > 0;
}

/**
 * The motor mount's own inner diameter (m) — the tube the motor actually slides into, which is
 * routinely much narrower than the rocket's outer airframe (e.g. a 38mm motor riding in an inner
 * tube inside a 54mm-airframe rocket, like PML's Callisto). Distinct from hasMotorMount's deep
 * search: that flags whichever top-level Component (nosecone/bodytube/transition — this project has
 * no separate inner-tube Component type) conceptually "owns" the motor, which for a real dual-deploy
 * build is the OUTER body tube, not the actual mount. Used to pre-fill/constrain the ThrustCurve.org
 * search's diameter filter — getting this wrong (falling back to the outer airframe diameter)
 * silently returns zero search results for a real, correctly-loaded motor.
 *
 * Finds whichever element in the whole document has a direct <motormount> child (usually an
 * <innertube>, occasionally the outer <bodytube> itself on a minimum-diameter build with no
 * separate mount tube) and reads ITS OWN diameter/thickness tags -- <innertube> stores
 * <outerradius>, <bodytube> stores <radius> (also nominally an outer radius, per this file's
 * existing bodytube parsing above) -- inner diameter = 2 * (outer radius - wall thickness),
 * matching parseRocksimXml's extractMotorMountDiameterM convention of using the mount tube's own
 * inner diameter (RockSim stores that directly as <ID>; .ork doesn't have an inner-diameter field,
 * so it's derived here instead).
 */
function extractMotorMountDiameterM(rocketEl: Element): number | undefined {
  const tube = Array.from(rocketEl.getElementsByTagName("*")).find((el) => directChild(el, "motormount"));
  if (!tube) return undefined;
  const isInnerTube = tube.tagName.toLowerCase() === "innertube";
  const outerRadius = isInnerTube ? number(tube, "outerradius", 0) : numberMaybeAuto(tube, "radius", 0);
  const thickness = number(tube, "thickness", 0);
  const innerRadius = outerRadius - thickness;
  return innerRadius > 0 ? innerRadius * 2 : undefined;
}

const SUPPORTED_BODY_TAGS = new Set(["nosecone", "bodytube", "transition"]);
const SKIPPED_BUT_KNOWN_TAGS = new Set([
  "stage", "parachute", "streamer", "shockcord", "masscomponent", "launchlug", "railbutton",
  "centeringring", "innertube", "tubecoupler", "engineblock", "bulkhead", "parallelstage", "podset",
]);

/**
 * Walks a stage's <subcomponents> in document order, emitting this project's
 * flat Component[] (body components interleaved with the fin sets attached
 * to them — matching placeComponents' "fin attaches to nearest preceding
 * body component" convention). Only nosecone/bodytube/transition/fins are
 * geometry this project models (per the MVP scope); anything else
 * (parachutes, mass components, inner tubes, pods, additional stages, ...)
 * is skipped for geometry but still scanned for a motor mount / nested fins
 * where relevant (inner tubes commonly carry the motor mount inside an
 * outer body tube, e.g. OpenRocket's own example rockets).
 */
function walkStage(stageEl: Element, warnings: string[]): Component[] {
  const out: Component[] = [];
  for (const el of subcomponentsOf(stageEl)) {
    const tag = el.tagName.toLowerCase();
    const name = text(el, "name") ?? tag;

    if (tag === "nosecone") {
      const { shape, shapeParameter } = parseShape(el, warnings, name);
      const length = number(el, "length", 0);
      out.push({
        type: "nosecone",
        id: text(el, "id") ?? name,
        name,
        shape,
        shapeParameter,
        length,
        aftRadius: numberMaybeAuto(el, "aftradius", 0),
        thickness: number(el, "thickness", 0.002),
      });
      out.push(...finsOf(el, length, warnings));
      continue;
    }

    if (tag === "bodytube") {
      const length = number(el, "length", 0);
      out.push({
        type: "bodytube",
        id: text(el, "id") ?? name,
        name,
        length,
        radius: numberMaybeAuto(el, "radius", 0),
        thickness: number(el, "thickness", 0.001),
        isMotorMount: hasMotorMount(el),
      });
      out.push(...finsOf(el, length, warnings));
      continue;
    }

    if (tag === "transition") {
      const { shape, shapeParameter } = parseShape(el, warnings, name);
      const length = number(el, "length", 0);
      out.push({
        type: "transition",
        id: text(el, "id") ?? name,
        name,
        shape,
        shapeParameter,
        length,
        foreRadius: numberMaybeAuto(el, "foreradius", 0),
        aftRadius: numberMaybeAuto(el, "aftradius", 0),
        thickness: number(el, "thickness", 0.002),
      });
      out.push(...finsOf(el, length, warnings));
      continue;
    }

    if (tag === "trapezoidfinset" || tag === "freeformfinset") {
      // A fin set found directly under the STAGE (not under a body component) has no parent
      // tube to attach to in this project's model — shouldn't happen in real files (fins are
      // always nested inside the tube they're mounted on) but skip defensively rather than crash.
      warnings.push(`${name}: fin set found with no parent body component, skipped`);
      continue;
    }

    if (!SUPPORTED_BODY_TAGS.has(tag) && !SKIPPED_BUT_KNOWN_TAGS.has(tag)) {
      warnings.push(`${name}: unsupported component type "${tag}", skipped`);
    }
    // Not aero geometry this project models, but may still hold a nested motor mount
    // (e.g. an inner tube) or, in principle, subcomponents worth a closer look later —
    // neither adds geometry, so there's nothing further to do here.
  }
  return out;
}

/**
 * OpenRocket's own last-computed CP, read from a saved simulation's per-timestep flight data --
 * .ork has no separate "static CP" field, CP only ever appears as one column among many in a
 * simulation's own time-series <databranch> (types="...,CP location,..." + one comma-separated
 * <datapoint> per timestep). Undefined until the rocket leaves the launch rod -- confirmed real,
 * not a parsing gap: OpenRocket itself records "CP location" as NaN for every datapoint before the
 * "launchrod" event fires, even at t=0 (verified directly against a real saved .ork simulation) --
 * so this takes the FIRST non-NaN value, which lands at the first point past rod exit, a natural
 * match for this project's own reference Mach (0.1, ~100fps rail-exit speed) even though it isn't
 * computed by asking for that Mach specifically. Values are already in this project's own SI base
 * unit (meters) -- .ork stores flight data in plain SI, unlike RockSim's mm convention.
 *
 * Prefers a simulation whose saved data is still status="uptodate" (reflects the CURRENT rocket
 * geometry, not a stale edit); falls back to the first simulation regardless of status if none are
 * marked uptodate, since a possibly-stale number still beats none for "whatever is there."
 * Undefined if the file has no saved simulations, or none ever recorded a CP location value.
 */
function extractEmbeddedCpM(doc: Document): number | undefined {
  const simulations = Array.from(doc.getElementsByTagName("simulation"));
  if (simulations.length === 0) return undefined;
  const simulation = simulations.find((s) => s.getAttribute("status") === "uptodate") ?? simulations[0]!;

  const flightData = directChild(simulation, "flightdata");
  const dataBranch = flightData ? directChild(flightData, "databranch") : null;
  if (!dataBranch) return undefined;

  const cpIndex = (dataBranch.getAttribute("types") ?? "").split(",").indexOf("CP location");
  if (cpIndex === -1) return undefined;

  for (const point of directChildren(dataBranch, "datapoint")) {
    const raw = (point.textContent ?? "").split(",")[cpIndex];
    const n = raw === undefined ? Number.NaN : Number.parseFloat(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Recovery devices (<parachute>/<streamer>) nested anywhere inside the given stage element,
 * classified main/drogue. Unlike parseRocksimXml's own extractDescentDevices (which has to guess
 * from the part's name, since RockSim's own file format has no drogue/main flag at all),
 * OpenRocket's native .ork format writes an explicit `<isdrogue>true</isdrogue>` tag whenever a
 * device is flagged as the drogue (confirmed directly against
 * RecoveryDeviceSaver.java -- only ever written when true, omitted otherwise) -- read that first,
 * and only fall back to the same size-based heuristic RockSim parsing uses (of multiple devices with
 * no explicit flag at all, the smallest becomes the drogue) for files where isdrogue was never set
 * on anything. A single device with nothing else present just stays "main" (the common
 * single-deploy case) -- matches parseRocksimXml's own convention exactly, since both feed the same
 * DescentDevice[] shape onward to the rest of this project (mass/descent-rate calc, splashcast
 * payload).
 *
 * OpenRocket's own <parachute> has no spill-hole concept (confirmed against ParachuteSaver.java --
 * unlike RockSim's own format, which does) -- full disk diameter is the whole drag area. <cd> is
 * sometimes literally "auto" (OpenRocket computes it itself rather than storing a fixed value) --
 * same "auto <value>|auto" pattern numberMaybeAuto already handles elsewhere in this file, but with
 * no fallback OpenRocket-computed value available here, so this falls back to the same fixed
 * defaults (0.8 parachute / 0.6 streamer) parseRocksimXml's own extractDescentDevices uses for its
 * own "DragCoefficient" tag, which is never literally "auto" in that format but is sometimes just
 * absent.
 */
function extractDescentDevices(stageEl: Element): DescentDevice[] {
  const devices: { type: "parachute" | "streamer"; dragAreaM2: number; dragCoefficient: number; isDrogue: boolean }[] = [];

  const cd = (el: Element, defaultCd: number): number => {
    const raw = text(el, "cd");
    if (raw === null || raw === "auto") return defaultCd;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : defaultCd;
  };

  for (const el of Array.from(stageEl.getElementsByTagName("parachute"))) {
    const diameterM = number(el, "diameter", 0);
    const areaM2 = Math.PI * (diameterM / 2) ** 2;
    if (areaM2 <= 0) continue;
    devices.push({ type: "parachute", dragAreaM2: areaM2, dragCoefficient: cd(el, 0.8), isDrogue: text(el, "isdrogue") === "true" });
  }
  for (const el of Array.from(stageEl.getElementsByTagName("streamer"))) {
    const lengthM = number(el, "striplength", 0);
    const widthM = number(el, "stripwidth", 0);
    const areaM2 = lengthM * widthM;
    if (areaM2 <= 0) continue;
    devices.push({ type: "streamer", dragAreaM2: areaM2, dragCoefficient: cd(el, 0.6), isDrogue: text(el, "isdrogue") === "true" });
  }

  const explicitDrogues = devices.filter((d) => d.isDrogue);
  const provisionalMains = devices.filter((d) => !d.isDrogue);
  provisionalMains.sort((a, b) => b.dragAreaM2 - a.dragAreaM2);
  const reassignedDrogue = explicitDrogues.length === 0 && provisionalMains.length > 1 ? provisionalMains.pop() : undefined;

  const result: DescentDevice[] = [];
  for (const d of explicitDrogues) result.push({ type: d.type, role: "drogue", dragAreaM2: d.dragAreaM2, dragCoefficient: d.dragCoefficient });
  for (const d of provisionalMains) result.push({ type: d.type, role: "main", dragAreaM2: d.dragAreaM2, dragCoefficient: d.dragCoefficient });
  if (reassignedDrogue) result.push({ type: reassignedDrogue.type, role: "drogue", dragAreaM2: reassignedDrogue.dragAreaM2, dragCoefficient: reassignedDrogue.dragCoefficient });
  return result;
}

/** The manufacturer+designation of the DEFAULT flight configuration's motor, if any. */
function findDefaultMotor(doc: Document): OrkMotorRef | null {
  const configs = Array.from(doc.getElementsByTagName("motorconfiguration"));
  const defaultConfig = configs.find((c) => c.getAttribute("default") === "true") ?? configs[0];
  const configId = defaultConfig?.getAttribute("configid");
  if (!configId) return null;

  const motors = Array.from(doc.getElementsByTagName("motor"));
  const motorEl = motors.find((m) => m.getAttribute("configid") === configId);
  if (!motorEl) return null;

  const manufacturer = text(motorEl, "manufacturer");
  const designation = text(motorEl, "designation");
  if (!manufacturer || !designation) return null;
  return { manufacturer, designation };
}

export function parseOrkXml(xmlText: string): ParsedOrkRocket {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(`Failed to parse .ork XML: ${parserError.textContent ?? "unknown error"}`);
  }

  const rocketEl = doc.getElementsByTagName("rocket")[0];
  if (!rocketEl) {
    throw new Error("No <rocket> element found — not a valid .ork file");
  }

  const warnings: string[] = [];
  const name = text(rocketEl, "name") ?? "Imported rocket";
  const stages = Array.from(directChild(rocketEl, "subcomponents")?.children ?? []).filter(
    (c) => c.tagName.toLowerCase() === "stage",
  );

  if (stages.length === 0) {
    throw new Error("No stages found in .ork file");
  }
  if (stages.length > 1) {
    warnings.push(`This rocket has ${stages.length} stages — only the first (sustainer) stage is imported (single-stage only, per this tool's scope).`);
  }

  const components = walkStage(stages[0]!, warnings);
  const motor = findDefaultMotor(doc);
  const motorMountDiameterM = extractMotorMountDiameterM(rocketEl);
  const descentDevices = extractDescentDevices(stages[0]!);
  const embeddedCpM = extractEmbeddedCpM(doc);

  return { name, components, motor, motorMountDiameterM, descentDevices, warnings, embeddedCpM };
}
