import type { Shape } from "../physics/geometry/shapes.js";

export interface NoseCone {
  type: "nosecone";
  id: string;
  name: string;
  shape: Shape;
  shapeParameter: number;
  length: number; // m
  aftRadius: number; // m (foreRadius is implicitly 0)
  thickness: number; // m, schematic only — not used for mass (mass is manual)
}

export interface BodyTube {
  type: "bodytube";
  id: string;
  name: string;
  length: number; // m
  radius: number; // m, outer
  thickness: number; // m
  isMotorMount: boolean;
}

/** Also represents a boat tail when aftRadius < foreRadius. */
export interface Transition {
  type: "transition";
  id: string;
  name: string;
  shape: Shape;
  shapeParameter: number;
  length: number; // m
  foreRadius: number; // m
  aftRadius: number; // m
  thickness: number; // m
}

/**
 * Fin leading-edge/tip profile, for pressure and base drag (see drag-calc.ts's finPressureDragCd/
 * finBaseDragCd) -- "square" (a plain cut sheet, no shaping) is the default when a source file
 * doesn't specify one (matches RockSim's own TipShapeCode default), a reasonable assumption for a
 * basic/beginner kit's unshaped fins, and the higher-drag of the three options rather than silently
 * under-predicting drag for a shape that hasn't actually been confirmed.
 */
export type FinCrossSection = "square" | "rounded" | "airfoil";

export interface TrapezoidalFinSet {
  type: "finset";
  id: string;
  name: string;
  finCount: number;
  rootChord: number; // m
  tipChord: number; // m
  sweepLength: number; // m, axial offset of tip leading edge from root leading edge
  span: number; // m ("height" in .ork)
  thickness: number; // m
  cantAngle: number; // rad
  crossSection?: FinCrossSection;
  /** Axial offset of the fin root's leading edge from the parent's aft end (usually 0). */
  axialOffsetFromParentBottom: number;
}

/**
 * Arbitrary-outline fin (e.g. RockSim CustomFinSet / OpenRocket FreeformFinSet).
 * `points` is the fin outline in local coordinates (x=chordwise from the root
 * leading edge, y=spanwise from the root), matching the convention used to
 * validate this against a real RockSim file — see scripts/validate-loc-iv.ts.
 * The polygon closes implicitly from the last point back to the first.
 */
export interface FreeformFinSet {
  type: "freeformfinset";
  id: string;
  name: string;
  finCount: number;
  points: [number, number][]; // m
  thickness: number; // m
  cantAngle: number; // rad
  crossSection?: FinCrossSection;
  axialOffsetFromParentBottom: number;
}

export type FinSet = TrapezoidalFinSet | FreeformFinSet;

export type Component = NoseCone | BodyTube | Transition | FinSet;

export type BodyComponent = NoseCone | BodyTube | Transition;

export function isBodyComponent(c: Component): c is BodyComponent {
  return c.type === "nosecone" || c.type === "bodytube" || c.type === "transition";
}

export function isFinSet(c: Component): c is FinSet {
  return c.type === "finset" || c.type === "freeformfinset";
}

/** Fin span (max spanwise extent), needed for tau/interference regardless of fin shape. */
export function finSetSpan(f: FinSet): number {
  if (f.type === "finset") return f.span;
  return f.points.reduce((max, [, y]) => Math.max(max, y), 0);
}

/** Fin root chord length (x-extent along y=0), used for schematic layout/axial length accounting. */
export function finSetRootChord(f: FinSet): number {
  if (f.type === "finset") return f.rootChord;
  const rootXs = f.points.filter(([, y]) => Math.abs(y) < 1e-9).map(([x]) => x);
  if (rootXs.length === 0) return f.points.reduce((max, [x]) => Math.max(max, x), 0);
  return Math.max(...rootXs) - Math.min(...rootXs);
}

export function componentLength(c: Component): number {
  return isFinSet(c) ? finSetRootChord(c) : c.length;
}

/** Planform (one-side) area of a single fin — used for both CNa (via drag/fin calculators) and wetted-area drag calculations. */
export function finSetPlanformArea(f: FinSet): number {
  if (f.type === "finset") return (f.span * (f.rootChord + f.tipChord)) / 2;
  // Shoelace formula for the closed polygon (last point implicitly connects back to the first).
  const pts = f.points;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
}

/** Radius at the fore (nose-ward) end of a body component. */
export function foreRadius(c: BodyComponent): number {
  if (c.type === "nosecone") return 0;
  if (c.type === "bodytube") return c.radius;
  return c.foreRadius;
}

/** Radius at the aft (tail-ward) end of a body component. */
export function aftRadius(c: BodyComponent): number {
  if (c.type === "nosecone") return c.aftRadius;
  if (c.type === "bodytube") return c.radius;
  return c.aftRadius;
}
