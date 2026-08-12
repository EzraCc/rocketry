import type { Vec3 } from "../../model/vec3.js";

/**
 * M4: full 3D translation + rotation (still no roll — see fin-calc.ts's
 * finding that the aggregate fin normal-force is exactly independent of
 * roll angle for N>=2 fins, so roll dynamics are never tracked here).
 * `axis` is the unit vector pointing in the nose direction; `angularVelocity`
 * is perpendicular to axis. World frame: x=East, y=North, z=up (AGL).
 */
export interface Sim3DState {
  position: Vec3;
  velocity: Vec3;
  axis: Vec3;
  angularVelocity: Vec3;
}

export interface FlightEvent3D {
  type: "LIFTOFF" | "LAUNCHROD" | "BURNOUT" | "APOGEE";
  time: number;
  altitude: number;
}

export interface SimSample3D {
  time: number;
  position: Vec3;
  velocity: Vec3;
  axis: Vec3;
  angularVelocity: Vec3;
  altitude: number; // m AGL (= position.z)
  speed: number; // m/s, ground-relative
  aoaDeg: number; // angle of attack, degrees
  tiltFromVerticalDeg: number; // angle of the body axis from straight up, degrees — the "weathercock angle"
  mach: number;
  mass: number;
  thrust: number;
  drag: number;
}

export interface SimResult3D {
  samples: SimSample3D[];
  events: FlightEvent3D[];
  apogeeAltitude: number;
  apogeeTime: number;
  maxVelocity: number;
  maxAcceleration: number;
  maxMach: number;
  maxAoaDeg: number;
  /** Flight-wide max tilt from vertical. Note: this legitimately approaches ~90deg for ANY
   * sufficiently stable rocket near its own apogee, as vertical velocity vanishes and the
   * relative airspeed becomes dominated by horizontal wind — NOT an instability signal by
   * itself. tiltAtBurnoutDeg below is the more meaningful number for judging weathercocking
   * severity / catching genuine instability. */
  maxTiltFromVerticalDeg: number;
  /** Tilt from vertical at the BURNOUT event — the meaningful weathercocking-severity checkpoint, unconfounded by the near-apogee low-speed effect above. Null if the motor never burned out (e.g. never lifted off). */
  tiltAtBurnoutDeg: number | null;
  burnoutAltitude: number | null;
  warnings: string[];
}
