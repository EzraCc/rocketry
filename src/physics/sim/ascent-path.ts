import type { Rocket } from "../../model/rocket.js";
import type { Vec3 } from "../../model/vec3.js";
import { windAt, type WindVector } from "../../model/wind.js";
import type { SimResult3D, SimSample3D } from "./types3d.js";

/**
 * Shapes a raw M4 flight trajectory into named waypoints + a resampled path
 * curve — the handoff shape splashcast's descent side already uses (its
 * `simulate()` produces an altitude-stepped drift path with named deploy
 * points; this is the ascent-side equivalent). The physics doesn't change —
 * every value here is read directly off the already-computed trajectory —
 * this module is purely about presenting "what actually happened during
 * boost and coast" as something a 3D viewer (or a person) can follow,
 * rather than a single rail-to-apogee line.
 */

export type WaypointType = "LIFTOFF" | "LAUNCHROD" | "BURNOUT" | "APOGEE";

export interface Waypoint {
  type: WaypointType;
  label: string;
  time: number; // s
  position: Vec3; // m, world frame (x=East, y=North, z=up AGL)
  altitude: number; // m AGL
  tiltFromVerticalDeg: number;
  aoaDeg: number;
  speed: number; // m/s, ground-relative
  /** Wind at this waypoint's altitude — this is what makes "weathercocking into ground wind" vs. "turning into wind aloft" a claim backed by actual data, not narration. */
  wind: WindVector;
}

export interface PathPoint {
  time: number;
  position: Vec3;
  altitude: number;
  tiltFromVerticalDeg: number;
}

export interface Segment {
  from: WaypointType;
  to: WaypointType;
  label: string;
  description: string;
}

export interface WindShearSummary {
  ground: WindVector; // wind at launch altitude
  aloft: WindVector; // wind at apogee altitude
  speedDeltaMs: number; // aloft - ground
  directionDeltaDeg: number; // shortest signed angular difference, aloft - ground, in [-180, 180]
}

export interface AscentPath {
  waypoints: Waypoint[];
  path: PathPoint[];
  segments: Segment[];
  windShear: WindShearSummary;
}

const WAYPOINT_LABELS: Record<WaypointType, string> = {
  LIFTOFF: "Liftoff",
  LAUNCHROD: "Rail/rod exit",
  BURNOUT: "Motor burnout",
  APOGEE: "Apogee",
};

function windVectorAt(rocket: Rocket, altitude: number): WindVector {
  if (!rocket.windProfile) return { vx: 0, vy: 0, speed: 0, directionFromDeg: 0 };
  return windAt(rocket.windProfile, rocket.launchAltitude + Math.max(altitude, 0));
}

function nearestSample(samples: SimSample3D[], time: number): SimSample3D | null {
  if (samples.length === 0) return null;
  return samples.reduce((closest, s) => (Math.abs(s.time - time) < Math.abs(closest.time - time) ? s : closest));
}

/** Shortest signed angular difference b-a, in degrees, wrapped to [-180, 180]. */
function angularDelta(a: number, b: number): number {
  let d = ((b - a + 180) % 360) - 180;
  if (d < -180) d += 360;
  return d;
}

/**
 * @param pathPoints target number of resampled path points (evenly spaced in time
 *   from launch to apogee) — a fixed count keeps the curve a reasonable, consistent
 *   size for visualization regardless of how long or short the actual flight is.
 */
export function buildAscentPath(result: SimResult3D, rocket: Rocket, pathPoints = 80): AscentPath {
  // FlightEvent3D's type union is exactly WaypointType (LIFTOFF/LAUNCHROD/BURNOUT/APOGEE),
  // so every event the engine produces is directly usable as a waypoint.
  const waypoints: Waypoint[] = result.events
    .map((e) => {
      const sample = nearestSample(result.samples, e.time);
      const wind = windVectorAt(rocket, e.altitude);
      return {
        type: e.type,
        label: WAYPOINT_LABELS[e.type],
        time: e.time,
        position: sample?.position ?? { x: 0, y: 0, z: e.altitude },
        altitude: e.altitude,
        tiltFromVerticalDeg: sample?.tiltFromVerticalDeg ?? 0,
        aoaDeg: sample?.aoaDeg ?? 0,
        speed: sample?.speed ?? 0,
        wind,
      };
    });

  const segments: Segment[] = [];
  const byType = new Map(waypoints.map((w) => [w.type, w]));
  const launchRod = byType.get("LAUNCHROD");
  const burnout = byType.get("BURNOUT");
  const apogee = byType.get("APOGEE");

  if (launchRod && burnout) {
    segments.push({
      from: "LAUNCHROD",
      to: "BURNOUT",
      label: "Weathercocking into ground wind",
      description: `Rotation unlocks at rail exit; under power the rocket weathercocks toward the ${launchRod.wind.speed.toFixed(1)} m/s wind from ${launchRod.wind.directionFromDeg.toFixed(0)}° at ground level, reaching ${burnout.tiltFromVerticalDeg.toFixed(1)}° tilt by burnout.`,
    });
  }
  if (burnout && apogee) {
    segments.push({
      from: "BURNOUT",
      to: "APOGEE",
      label: "Apogee turnover into wind aloft",
      description: `Coasting under gravity and drag alone, vertical velocity bleeds off toward zero and the relative airspeed becomes dominated by the ${apogee.wind.speed.toFixed(1)} m/s wind from ${apogee.wind.directionFromDeg.toFixed(0)}° at apogee altitude — a different wind than at ground level if the profile has shear — so the rocket tips further, reaching ${apogee.tiltFromVerticalDeg.toFixed(1)}° right at apogee.`,
    });
  }

  // Evenly resample in time (not altitude — altitude isn't monotonic if the rocket noses
  // over hard, and a fixed point count is simpler/more robust across very different flight
  // durations than a fixed altitude step would be).
  const apogeeTime = result.apogeeTime > 0 ? result.apogeeTime : (result.samples.at(-1)?.time ?? 0);
  const path: PathPoint[] = [];
  for (let i = 0; i < pathPoints; i++) {
    const t = (i / (pathPoints - 1)) * apogeeTime;
    const sample = nearestSample(result.samples, t);
    if (sample) {
      path.push({ time: sample.time, position: sample.position, altitude: sample.altitude, tiltFromVerticalDeg: sample.tiltFromVerticalDeg });
    }
  }

  const groundWind = windVectorAt(rocket, 0);
  const aloftWind = windVectorAt(rocket, result.apogeeAltitude);
  const windShear: WindShearSummary = {
    ground: groundWind,
    aloft: aloftWind,
    speedDeltaMs: aloftWind.speed - groundWind.speed,
    directionDeltaDeg: angularDelta(groundWind.directionFromDeg, aloftWind.directionFromDeg),
  };

  return { waypoints, path, segments, windShear };
}
