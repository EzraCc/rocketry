/**
 * ThrustCurve.org API v1 client — https://www.thrustcurve.org/info/api.html
 *
 * Confirmed working directly from a browser (or Node) with no backend proxy:
 * CORS is fully open (access-control-allow-origin reflects the request
 * origin, methods GET/POST/PUT/DELETE, credentials true — verified via curl
 * against the live API). `download.json` with `data:"samples"` returns
 * pre-parsed {time, thrust} points directly as JSON, so no RASP .eng text
 * parsing is needed for this path.
 */
const API_BASE = "https://www.thrustcurve.org/api/v1";

export interface MotorSearchResult {
  motorId: string;
  manufacturer: string;
  manufacturerAbbrev: string;
  designation: string;
  commonName: string;
  impulseClass: string;
  diameter: number; // mm
  length: number; // mm
  type: string;
  avgThrustN: number;
  maxThrustN: number;
  totImpulseNs: number;
  burnTimeS: number;
  // ThrustCurve.org omits these for some entries (e.g. certain very small/vintage motors) — genuinely optional.
  totalWeightG?: number;
  propWeightG?: number;
  delays: string;
}

interface SearchResponse {
  results: MotorSearchResult[];
}

export async function searchMotors(query: {
  manufacturer?: string;
  /**
   * ThrustCurve.org's `commonName` search field (e.g. "K400", "C6") is
   * forgiving — case-insensitive and matches the simplified name without a
   * propellant-type suffix. Its `designation` field (e.g. "K400C") is an
   * exact match only — searching designation:"K400" against a real motor
   * designated "K400C" returns zero results. Confirmed directly against the
   * live API, not assumed: commonName is the right field for a user-facing
   * search box.
   */
  commonName?: string;
  diameter?: number; // mm
  type?: string;
  impulseClass?: string;
  maxResults?: number;
}): Promise<MotorSearchResult[]> {
  const res = await fetch(`${API_BASE}/search.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxResults: 20, ...query }),
  });
  if (!res.ok) {
    throw new Error(`ThrustCurve.org search failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as SearchResponse;
  return data.results ?? [];
}

export interface MotorMetadata {
  manufacturers: { name: string; abbrev: string }[];
  types: string[];
  diameters: number[]; // mm
  impulseClasses: string[];
}

interface MetadataResponse {
  manufacturers: { name: string; abbrev: string }[];
  certOrgs: { name: string; abbrev: string }[];
  types: string[];
  diameters: number[];
  impulseClasses: string[];
}

/** Fetches the valid filter values for search — used to populate select boxes (manufacturer/diameter/type/impulseClass) rather than free-text guessing. */
export async function getMotorMetadata(): Promise<MotorMetadata> {
  const res = await fetch(`${API_BASE}/metadata.json`);
  if (!res.ok) {
    throw new Error(`ThrustCurve.org metadata fetch failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as MetadataResponse;
  return {
    manufacturers: data.manufacturers,
    types: data.types,
    diameters: data.diameters,
    impulseClasses: data.impulseClasses,
  };
}

export interface ThrustSample {
  time: number;
  thrust: number;
}

interface DownloadResult {
  motorId: string;
  simfileId: string;
  format: string;
  source: string;
  samples?: ThrustSample[];
}

interface DownloadResponse {
  results: DownloadResult[];
}

/** Downloads pre-parsed thrust-curve samples for a motor. Prefers a "cert" source file if multiple exist, per ThrustCurve.org's own source-quality ordering. */
export async function downloadThrustSamples(motorId: string): Promise<ThrustSample[]> {
  const res = await fetch(`${API_BASE}/download.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motorIds: [motorId], data: "samples" }),
  });
  if (!res.ok) {
    throw new Error(`ThrustCurve.org download failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as DownloadResponse;
  const withSamples = data.results.filter((r): r is DownloadResult & { samples: ThrustSample[] } =>
    Array.isArray(r.samples) && r.samples.length > 0,
  );
  if (withSamples.length === 0) {
    throw new Error(`No thrust-curve data files available for motor ${motorId}`);
  }
  const sourceRank = (source: string): number =>
    source === "cert" ? 0 : source === "mfr" ? 1 : 2;
  withSamples.sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
  return withSamples[0]!.samples;
}
