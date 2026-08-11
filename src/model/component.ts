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
  /** Axial offset of the fin root's leading edge from the parent's aft end (usually 0). */
  axialOffsetFromParentBottom: number;
}

export type Component = NoseCone | BodyTube | Transition | TrapezoidalFinSet;

export type BodyComponent = NoseCone | BodyTube | Transition;

export function isBodyComponent(c: Component): c is BodyComponent {
  return c.type === "nosecone" || c.type === "bodytube" || c.type === "transition";
}

export function componentLength(c: Component): number {
  return c.type === "finset" ? c.rootChord : c.length;
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
