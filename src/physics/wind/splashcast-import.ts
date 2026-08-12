import { windSampleFromMeteorological, type WindProfile } from "../../model/wind.js";

/**
 * Parser for the JSON format produced by the user's separate "splashcast"
 * launch-day drift/splashdown-zone predictor, which itself pulls a
 * multi-model wind ensemble (GFS/ECMWF/GEM/ICON/...) from Open-Meteo.
 *
 * Confirmed schema (cross-checked against three real captured files —
 * different launch sites, same structure):
 *   wind_profiles: { [hourOfDay: string]: { [model: string]: [altitudeFt, speedMph, directionFromDeg][] } }
 *   wind_hours: number[]               -- hours for which wind_profiles has data
 *   descent_params.site_elev_ft: number -- launch site ground elevation (MSL)
 *
 * Cross-validated unit/format assumptions: wind_profiles[hour][model][0] (the
 * ground-level sample) exactly matches the separately-reported
 * wind.hourly[hour][model].{speed,direction}, confirming the triple order
 * and that altitude=0 means ground level AT THE SITE (i.e. AGL, matching
 * this project's own altitude convention), and speed is in mph (matching the
 * file's own `wind_nogo_mph` field naming).
 */

const FT_TO_M = 0.3048;
const MPH_TO_MS = 0.44704;

export interface SplashcastWindData {
  siteElevationM: number;
  hours: number[];
  modelsForHour(hour: number): string[];
  profileFor(hour: number, model: string): WindProfile | null;
}

interface RawSplashcastJson {
  wind_hours?: unknown;
  wind_profiles?: Record<string, Record<string, unknown>>;
  descent_params?: { site_elev_ft?: unknown };
}

function isTripleArray(value: unknown): value is [number, number, number][] {
  return (
    Array.isArray(value) &&
    value.every((t) => Array.isArray(t) && t.length === 3 && t.every((n) => typeof n === "number"))
  );
}

export function parseSplashcastWindData(json: unknown): SplashcastWindData {
  const raw = json as RawSplashcastJson;
  const siteElevFt = typeof raw.descent_params?.site_elev_ft === "number" ? raw.descent_params.site_elev_ft : 0;
  const siteElevationM = siteElevFt * FT_TO_M;

  const hours = Array.isArray(raw.wind_hours) ? raw.wind_hours.filter((h): h is number => typeof h === "number") : [];
  const windProfiles = raw.wind_profiles ?? {};

  return {
    siteElevationM,
    hours,

    modelsForHour(hour: number): string[] {
      const forHour = windProfiles[String(hour)];
      if (!forHour) return [];
      return Object.keys(forHour).filter((model) => isTripleArray(forHour[model]));
    },

    profileFor(hour: number, model: string): WindProfile | null {
      const forHour = windProfiles[String(hour)];
      const triples = forHour?.[model];
      if (!isTripleArray(triples) || triples.length === 0) return null;

      const samples = triples
        .map(([altitudeFt, speedMph, directionFromDeg]) =>
          windSampleFromMeteorological(altitudeFt * FT_TO_M, speedMph * MPH_TO_MS, directionFromDeg),
        )
        .sort((a, b) => a.altitude - b.altitude);

      return { samples, label: `${model.toUpperCase()} @ ${hour}:00` };
    },
  };
}
