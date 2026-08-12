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
  totalWeightG: number;
  propWeightG: number;
  delays: string;
}

interface SearchResponse {
  results: MotorSearchResult[];
}

export async function searchMotors(query: {
  manufacturer?: string;
  designation?: string;
  diameter?: number;
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
