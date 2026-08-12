/**
 * M3 scope: ascent to apogee, no wind, straight-up launch (per the project
 * plan — this deliberately isolates thrust/drag/mass-integration bugs from
 * aero-moment/AOA bugs before M4 adds wind/weathercocking/rotation). The
 * state is therefore a simple 1D vertical problem (altitude + vertical
 * velocity along the launch axis) rather than the full 3D/6DOF state a
 * general flight sim needs — M4 generalizes this once rotation/wind enter
 * the picture.
 */

export interface FlightEvent {
  type: "LIFTOFF" | "LAUNCHROD" | "BURNOUT" | "APOGEE";
  time: number; // s
  altitude: number; // m AGL
}

export interface SimSample {
  time: number; // s
  altitude: number; // m AGL
  velocity: number; // m/s, positive = up
  acceleration: number; // m/s^2
  mach: number;
  mass: number; // kg
  thrust: number; // N
  drag: number; // N
}

export interface SimResult {
  samples: SimSample[];
  events: FlightEvent[];
  apogeeAltitude: number; // m AGL
  apogeeTime: number; // s
  maxVelocity: number; // m/s
  maxAcceleration: number; // m/s^2
  maxMach: number;
  burnoutAltitude: number | null;
  burnoutVelocity: number | null;
  warnings: string[];
}
