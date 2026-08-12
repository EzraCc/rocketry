/**
 * Altitude-varying wind profile. Wind is stored as horizontal velocity
 * VECTOR components (East/North) rather than separate speed+direction,
 * specifically so that interpolating between two altitude samples is a
 * plain linear blend of vx/vy — interpolating speed and (compass) direction
 * separately would need special-cased circular interpolation to handle
 * wraparound correctly (e.g. blending 350° and 10° must give ~0°, not 180°);
 * blending the vector components sidesteps that entirely and is standard
 * practice for wind data.
 */
export interface WindSample {
  altitude: number; // m AGL (relative to the launch site, not sea level)
  vx: number; // m/s, horizontal wind velocity, East-positive
  vy: number; // m/s, horizontal wind velocity, North-positive
}

export interface WindProfile {
  samples: WindSample[]; // must be sorted by altitude ascending
  label?: string; // e.g. "GFS @ 14:00" — for display only
}

export interface WindVector {
  vx: number;
  vy: number;
  speed: number;
  directionFromDeg: number; // meteorological convention: compass bearing the wind is blowing FROM
}

/**
 * Builds a wind sample from meteorological speed/direction (the convention
 * weather data — including Open-Meteo/splashcast — is reported in):
 * direction is the compass bearing the wind is blowing FROM (0=N, 90=E,
 * clockwise), so the actual velocity vector points the opposite way
 * (bearing+180).
 */
export function windSampleFromMeteorological(altitude: number, speedMs: number, directionFromDeg: number): WindSample {
  const towardDeg = (directionFromDeg + 180) % 360;
  const towardRad = (towardDeg * Math.PI) / 180;
  return { altitude, vx: speedMs * Math.sin(towardRad), vy: speedMs * Math.cos(towardRad) };
}

function toWindVector(vx: number, vy: number): WindVector {
  const speed = Math.hypot(vx, vy);
  // Inverse of windSampleFromMeteorological's sin/cos assignment.
  const towardDeg = ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360;
  const directionFromDeg = (towardDeg + 180) % 360;
  return { vx, vy, speed, directionFromDeg };
}

/** Linearly interpolates the wind velocity vector at a given AGL altitude (clamped to the profile's own range at the ends). */
export function windAt(profile: WindProfile, altitude: number): WindVector {
  const samples = profile.samples;
  if (samples.length === 0) return toWindVector(0, 0);
  if (samples.length === 1 || altitude <= samples[0]!.altitude) return toWindVector(samples[0]!.vx, samples[0]!.vy);
  const last = samples[samples.length - 1]!;
  if (altitude >= last.altitude) return toWindVector(last.vx, last.vy);

  let lower = samples[0]!;
  let upper = last;
  for (let i = 0; i < samples.length - 1; i++) {
    if (samples[i]!.altitude <= altitude && altitude <= samples[i + 1]!.altitude) {
      lower = samples[i]!;
      upper = samples[i + 1]!;
      break;
    }
  }
  const span = upper.altitude - lower.altitude;
  const frac = span > 1e-9 ? (altitude - lower.altitude) / span : 0;
  return toWindVector(lower.vx + frac * (upper.vx - lower.vx), lower.vy + frac * (upper.vy - lower.vy));
}

/** A single constant wind vector, everywhere — the simplest possible "profile," for a manually-entered constant wind speed/direction. */
export function constantWindProfile(speedMs: number, directionFromDeg: number): WindProfile {
  return { samples: [windSampleFromMeteorological(0, speedMs, directionFromDeg)] };
}
