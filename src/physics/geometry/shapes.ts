/**
 * Nose cone / transition shape functions.
 *
 * Every shape is defined for a component whose radius grows from 0 at x=0 to
 * `r` at x=`length` (i.e. as if it were a nose cone). `Transition` (fore/aft
 * radius both nonzero) reuses these by treating the smaller-radius end as the
 * local origin and reflecting/offsetting as needed (see rocket-geometry.ts).
 */

export type Shape =
  | "conical"
  | "ogive"
  | "ellipsoid"
  | "power"
  | "parabolic"
  | "haack";

/** Radius at axial position x in [0, length], growing from 0 to r. */
export function shapeRadius(
  shape: Shape,
  x: number,
  r: number,
  length: number,
  param: number,
): number {
  if (length <= 0) return r;
  const t = clamp01(x / length);

  switch (shape) {
    case "conical":
      return r * t;

    case "ogive": {
      // Tangent ogive (classic circular-arc profile) at param=1: circle
      // radius rho chosen so the arc is tangent to the cylindrical body at
      // x=length and passes through the tip at x=0. Algebraically,
      // rho=(r^2+L^2)/(2r) gives y(0)=0 and y(L)=r exactly (verified below).
      const rhoTangent = (r * r + length * length) / (2 * r);
      const y0 = Math.sqrt(Math.max(0, rhoTangent * rhoTangent - length * length));
      const tangentProfile = (xx: number): number =>
        Math.sqrt(
          Math.max(0, rhoTangent * rhoTangent - (length - xx) * (length - xx)),
        ) - y0;
      const k = clamp(param, 0, 1);
      const tangentVal = tangentProfile(x);
      if (k >= 0.999) return clamp(tangentVal, 0, r);
      // For param<1, OpenRocket produces a blunter (more secant-like)
      // profile; approximated here as a blend toward the conical profile,
      // which preserves the y(0)=0 / y(L)=r endpoints exactly for any k.
      const conicalVal = r * t;
      return clamp(k * tangentVal + (1 - k) * conicalVal, 0, r);
    }

    case "ellipsoid":
      return r * Math.sqrt(1 - (1 - t) * (1 - t));

    case "power": {
      const n = clamp(param, 0, 1);
      return r * Math.pow(t, n);
    }

    case "parabolic": {
      const k = clamp(param, 0, 1);
      return (r * (2 * t - k * t * t)) / (2 - k);
    }

    case "haack": {
      const k = clamp(param, 0, 1 / 3);
      const theta = Math.acos(1 - 2 * t);
      const val =
        (theta - Math.sin(2 * theta) / 2 + k * Math.pow(Math.sin(theta), 3)) /
        Math.PI;
      return r * Math.sqrt(Math.max(0, val));
    }
  }
}

/**
 * Volume of the solid of revolution formed by rotating an arbitrary radius
 * function r(x) about the axis over [0, length], via Simpson's rule. This is
 * the generic engine reused for both plain nose-cone shapes (fore=0) and
 * general fore/aft transitions (see rocket-geometry.ts), which is why it
 * takes a radius function rather than a Shape directly.
 */
export function integrateVolume(
  radiusFn: (x: number) => number,
  length: number,
  divisions = 200,
): number {
  if (length <= 0) return 0;
  const n = divisions % 2 === 0 ? divisions : divisions + 1;
  const h = length / n;
  const areaAtX = (x: number): number => {
    const rx = radiusFn(x);
    return Math.PI * rx * rx;
  };
  let sum = areaAtX(0) + areaAtX(length);
  for (let i = 1; i < n; i++) {
    const x = i * h;
    const coeff = i % 2 === 0 ? 2 : 4;
    sum += coeff * areaAtX(x);
  }
  return (h / 3) * sum;
}

/**
 * Planform (side-view projected) area under r(x), i.e. integral of 2*r(x)dx,
 * plus its x-weighted centroid. Used for the (optional, MVP-deferred) Galejs
 * body-lift correction — kept here so it's available if needed later.
 */
export function integratePlanform(
  radiusFn: (x: number) => number,
  length: number,
  divisions = 200,
): { area: number; centroid: number } {
  if (length <= 0) return { area: 0, centroid: length / 2 };
  const n = divisions;
  const h = length / n;
  let area = 0;
  let moment = 0;
  for (let i = 0; i <= n; i++) {
    const x = i * h;
    const w = i === 0 || i === n ? 0.5 : 1;
    const rx = radiusFn(x);
    area += w * 2 * rx * h;
    moment += w * 2 * rx * h * x;
  }
  return { area, centroid: area > 0 ? moment / area : length / 2 };
}

/** Volume of a plain nose-cone-style shape (fore radius = 0). */
export function shapeVolume(
  shape: Shape,
  r: number,
  length: number,
  param: number,
  divisions = 200,
): number {
  if (length <= 0 || r <= 0) return 0;
  return integrateVolume((x) => shapeRadius(shape, x, r, length, param), length, divisions);
}

/** Planform area/centroid of a plain nose-cone-style shape (fore radius = 0). */
export function shapePlanform(
  shape: Shape,
  r: number,
  length: number,
  param: number,
  divisions = 200,
): { area: number; centroid: number } {
  if (length <= 0 || r <= 0) return { area: 0, centroid: length / 2 };
  return integratePlanform((x) => shapeRadius(shape, x, r, length, param), length, divisions);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
