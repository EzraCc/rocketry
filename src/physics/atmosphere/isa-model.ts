/**
 * International Standard Atmosphere (ISA), layered troposphere/stratosphere
 * model, extended to start from arbitrary launch-site conditions rather than
 * standard sea level.
 *
 * Standard ISA layers (base altitude h_b, base temperature T_b, lapse rate L):
 *   0:      0m,  288.15 K, -0.0065 K/m   (troposphere)
 *   1:  11000m,  216.65 K,  0            (tropopause, isothermal)
 *   2:  20000m,  216.65 K, +0.001  K/m   (stratosphere)
 * Covers 0-32km, comfortably above any basic-rocket apogee this project targets.
 *
 * For a non-standard launch site (altitude/temperature/pressure differ from
 * the standard values), the base of the first layer is shifted so the model
 * matches the given conditions exactly at the launch altitude, then the same
 * layer-chaining algorithm continues upward using the standard lapse rates —
 * i.e. a hot/low-pressure launch day stays a constant offset warmer/thinner
 * all the way up, rather than snapping back to pure standard ISA above 11km.
 * This is a simplification (not benchmarked bit-for-bit against any specific
 * other tool's exact convention, unlike the Barrowman ports elsewhere in this
 * project) but is physically reasonable and exactly matches standard ISA when
 * launchAltitude=0 with standard sea-level conditions (verified in tests).
 */

const G0 = 9.80665; // m/s^2, standard gravity
const R_SPECIFIC = 287.053; // J/(kg*K), specific gas constant for dry air
const GAMMA = 1.4; // ratio of specific heats for air

const STANDARD_T0 = 288.15; // K
const STANDARD_P0 = 101325; // Pa

interface Layer {
  baseAltitude: number; // m
  baseTemperature: number; // K
  lapseRate: number; // K/m
  basePressure: number; // Pa
}

/** Standard layer base altitudes/temperatures/lapse rates, before any launch-site pressure/temperature offset is applied. */
const STANDARD_LAYER_DEFS = [
  { baseAltitude: 0, baseTemperature: 288.15, lapseRate: -0.0065 },
  { baseAltitude: 11000, baseTemperature: 216.65, lapseRate: 0 },
  { baseAltitude: 20000, baseTemperature: 216.65, lapseRate: 0.001 },
];

export interface AtmosphericConditions {
  temperature: number; // K
  pressure: number; // Pa
  density: number; // kg/m^3
  speedOfSound: number; // m/s
  dynamicViscosity: number; // Pa*s (Sutherland's law)
}

export interface LaunchSiteConditions {
  altitude: number; // m MSL
  temperature: number; // K
  pressure: number; // Pa
}

/** Pressure at a point `deltaH` above a layer's base, via the standard barometric formulas (isothermal vs. non-zero lapse rate). */
function pressureAtOffset(baseTemperature: number, basePressure: number, lapseRate: number, deltaH: number): number {
  if (Math.abs(lapseRate) < 1e-12) {
    return basePressure * Math.exp((-G0 * deltaH) / (R_SPECIFIC * baseTemperature));
  }
  const topTemperature = baseTemperature + lapseRate * deltaH;
  return basePressure * Math.pow(topTemperature / baseTemperature, -G0 / (R_SPECIFIC * lapseRate));
}

/** Builds the full layer table (with each layer's base pressure chained from the launch-site conditions) for a given launch site. */
function buildLayers(site: LaunchSiteConditions): Layer[] {
  const def0 = STANDARD_LAYER_DEFS[0]!;
  // T(h) = T_b + L*h  =>  T_b = T(launchAltitude) - L*launchAltitude — the sea-level-equivalent
  // temperature that, under the standard layer-0 lapse rate, reproduces the given launch-site
  // temperature at the given launch altitude.
  const effectiveT0 = site.temperature - def0.lapseRate * site.altitude;
  const effectiveP0 = site.pressure / Math.pow(site.temperature / effectiveT0, -G0 / (R_SPECIFIC * def0.lapseRate));

  const layers: Layer[] = [
    { baseAltitude: def0.baseAltitude, baseTemperature: effectiveT0, lapseRate: def0.lapseRate, basePressure: effectiveP0 },
  ];
  for (let i = 1; i < STANDARD_LAYER_DEFS.length; i++) {
    const prev = layers[i - 1]!;
    const def = STANDARD_LAYER_DEFS[i]!;
    const basePressure = pressureAtOffset(prev.baseTemperature, prev.basePressure, prev.lapseRate, def.baseAltitude - prev.baseAltitude);
    layers.push({ baseAltitude: def.baseAltitude, baseTemperature: def.baseTemperature, lapseRate: def.lapseRate, basePressure });
  }
  return layers;
}

/** Sutherland's law for the dynamic viscosity of air as a function of temperature. */
function sutherlandViscosity(temperatureK: number): number {
  const MU0 = 1.716e-5; // Pa*s at T0
  const T0 = 273.15; // K
  const S = 110.4; // K, Sutherland's constant for air
  return MU0 * Math.pow(temperatureK / T0, 1.5) * ((T0 + S) / (temperatureK + S));
}

export class IsaAtmosphere {
  private readonly layers: Layer[];

  constructor(site: LaunchSiteConditions = { altitude: 0, temperature: STANDARD_T0, pressure: STANDARD_P0 }) {
    this.layers = buildLayers(site);
  }

  private layerFor(altitude: number): Layer {
    let match = this.layers[0]!;
    for (const layer of this.layers) {
      if (altitude >= layer.baseAltitude) match = layer;
    }
    return match;
  }

  /** @param altitude m MSL (absolute, not AGL) */
  at(altitude: number): AtmosphericConditions {
    const layer = this.layerFor(altitude);
    const deltaH = altitude - layer.baseAltitude;
    const temperature = layer.baseTemperature + layer.lapseRate * deltaH;
    const pressure = pressureAtOffset(layer.baseTemperature, layer.basePressure, layer.lapseRate, deltaH);
    const density = pressure / (R_SPECIFIC * temperature);
    const speedOfSound = Math.sqrt(GAMMA * R_SPECIFIC * temperature);
    const dynamicViscosity = sutherlandViscosity(temperature);
    return { temperature, pressure, density, speedOfSound, dynamicViscosity };
  }
}
