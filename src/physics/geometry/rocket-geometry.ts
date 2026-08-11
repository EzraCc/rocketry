import { integratePlanform, integrateVolume, shapeRadius } from "./shapes.js";
import {
  aftRadius,
  foreRadius,
  isBodyComponent,
  isFinSet,
  type BodyComponent,
  type Component,
} from "../../model/component.js";

/**
 * Radius of a body component (nose cone / body tube / transition) at local
 * axial position x in [0, length], measured from the component's own fore
 * end. Body tubes are handled directly (constant radius); nose cones and
 * transitions delegate to the shape functions, generalized to arbitrary
 * fore/aft radius by offsetting the (fore=0 -> r) shape profile.
 *
 * Generalization: a growing transition (fore < aft) is fore + shape(x)*(aft-fore).
 * A shrinking transition / boat tail (fore > aft) is the mirror image: aft +
 * shape(length-x)*(fore-aft).
 */
export function bodyComponentRadius(c: BodyComponent, x: number): number {
  if (c.type === "bodytube") return c.radius;

  const r0 = foreRadius(c);
  const r1 = aftRadius(c);
  const length = c.length;
  if (length <= 0) return Math.max(r0, r1);

  if (r0 <= r1) {
    const delta = r1 - r0;
    return r0 + shapeRadius(c.shape, x, delta, length, c.shapeParameter);
  }
  const delta = r0 - r1;
  return r1 + shapeRadius(c.shape, length - x, delta, length, c.shapeParameter);
}

export function bodyComponentVolume(c: BodyComponent, divisions = 200): number {
  return integrateVolume((x) => bodyComponentRadius(c, x), c.length, divisions);
}

export function bodyComponentPlanform(
  c: BodyComponent,
  divisions = 200,
): { area: number; centroid: number } {
  return integratePlanform((x) => bodyComponentRadius(c, x), c.length, divisions);
}

export interface PlacedComponent {
  component: Component;
  /** Axial position (m from the nose tip) of the component's own fore end / root leading edge. */
  x0: number;
}

/**
 * Stacks components nose-to-tail in array order. Body components (nose
 * cone/tube/transition) consume axial length in the stack; a fin set attaches
 * to the body component immediately preceding it in the array (its axial
 * position is that parent's x0 plus the fin's own offset) and does not
 * itself advance the stack.
 */
export function placeComponents(components: Component[]): PlacedComponent[] {
  const placed: PlacedComponent[] = [];
  let x = 0;
  let lastBodyX0 = 0;
  for (const c of components) {
    if (isFinSet(c)) {
      placed.push({ component: c, x0: lastBodyX0 + c.axialOffsetFromParentBottom });
      continue;
    }
    placed.push({ component: c, x0: x });
    lastBodyX0 = x;
    x += c.length;
  }
  return placed;
}

export function overallLength(components: Component[]): number {
  return components.filter(isBodyComponent).reduce((sum, c) => sum + c.length, 0);
}

/** Reference diameter for CNa/CD normalization: 2x the largest body radius (OpenRocket's default "MAXIMUM" mode). */
export function referenceDiameter(components: Component[]): number {
  let maxR = 0;
  for (const c of components) {
    if (!isBodyComponent(c)) continue;
    maxR = Math.max(maxR, foreRadius(c), aftRadius(c));
  }
  return 2 * maxR;
}

/** Body radius at the fin set's root leading edge — needed for fin-body interference (tau). */
export function finRootBodyRadius(placed: PlacedComponent[], finIndex: number): number {
  const fin = placed[finIndex];
  if (!fin || !isFinSet(fin.component)) return 0;
  // Find the body component this fin is attached to: the nearest preceding body component.
  for (let i = finIndex - 1; i >= 0; i--) {
    const entry = placed[i];
    if (entry && isBodyComponent(entry.component)) {
      return bodyComponentRadius(entry.component, fin.x0 - entry.x0);
    }
  }
  return 0;
}
