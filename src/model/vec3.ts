/** Minimal 3D vector math — world frame convention used throughout M4: x=East, y=North, z=up (AGL). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 1e-12 ? scale(a, 1 / len) : { x: 0, y: 0, z: 0 };
}

/** Component of `a` perpendicular to unit vector `axis`. */
export function perpendicularComponent(a: Vec3, axis: Vec3): Vec3 {
  return sub(a, scale(axis, dot(a, axis)));
}

/** The classic RK4 weighted blend (k1+2k2+2k3+k4)/6, applied component-wise. */
export function rk4Blend(k1: Vec3, k2: Vec3, k3: Vec3, k4: Vec3): Vec3 {
  return {
    x: (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6,
    y: (k1.y + 2 * k2.y + 2 * k3.y + k4.y) / 6,
    z: (k1.z + 2 * k2.z + 2 * k3.z + k4.z) / 6,
  };
}
