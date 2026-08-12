import type { Component, FreeformFinSet, TrapezoidalFinSet } from "../../model/component.js";
import type { Shape } from "../../physics/geometry/shapes.js";

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
  warnings: string[];
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

  return { name, components, motor, warnings };
}
