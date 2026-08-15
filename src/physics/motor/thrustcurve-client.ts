/**
 * ThrustCurve.org API v1 client — https://www.thrustcurve.org/info/api.html
 *
 * Confirmed working directly from a browser (or Node) with no backend proxy:
 * CORS is fully open (access-control-allow-origin reflects the request
 * origin, methods GET/POST/PUT/DELETE, credentials true — verified via curl
 * against the live API). `download.json` with `data:"both"` returns
 * pre-parsed {time, thrust} points directly as JSON (no RASP .eng text
 * parsing needed for that part) PLUS the base64-encoded raw source file --
 * decoded/parsed here only for RockSim-format (.rse) files, which carry a
 * real per-sample propellant-mass-remaining value RASP (.eng) files don't
 * (see downloadThrustSamples/parseRseEngDataMassKg and
 * ThrustSample.propellantMassRemainingKg).
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
  // Present on a 400: a specific, actionable message ("Invalid commonName value \"435\"." --
  // e.g. missing the required impulse-class letter prefix, confirmed directly against the live
  // API) that's far more useful to show a user than the bare HTTP status.
  error?: string;
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
  // A 400 here is near-always a malformed filter value (e.g. a commonName search missing its
  // impulse-class letter prefix, like "435" instead of "J435" -- confirmed directly against the
  // live API), not a rate limit or outage; ThrustCurve.org's own error text says exactly what's
  // wrong, so read the body even on failure and surface that instead of a bare HTTP status.
  const data = (await res.json().catch(() => null)) as SearchResponse | null;
  if (!res.ok) {
    throw new Error(data?.error ? `ThrustCurve.org rejected this search: ${data.error}` : `ThrustCurve.org search failed: ${res.status} ${res.statusText}`);
  }
  return data?.results ?? [];
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
  /**
   * Propellant mass REMAINING at this instant (kg, counting down to 0 by burnout) -- real,
   * file-sourced data, not derived. Only ever present for RockSim-format (.rse) source files,
   * which carry a real <eng-data t="..." f="..." m="..." cg="..."/> per sample (confirmed directly
   * against a real file, e.g. AeroTech J340M -- m starts at the motor's own propWt and counts down
   * to 0 exactly at burnout). RASP (.eng) format files -- the majority, including most "cert"
   * source data -- have no such field, plain time/thrust pairs only; undefined in that case, and
   * deriveMotorMassCurve (motor-mass-curve.ts) falls back to its own impulse-proportional estimate.
   */
  propellantMassRemainingKg?: number;
}

interface DownloadResult {
  motorId: string;
  simfileId: string;
  format: string;
  source: string;
  samples?: ThrustSample[];
  /** Base64-encoded raw source file (requested via data:"both" alongside samples) -- only decoded/parsed when format is "RockSim", to pull each sample's own real propellant-mass-remaining value (see ThrustSample.propellantMassRemainingKg). */
  data?: string;
}

interface DownloadResponse {
  results: DownloadResult[];
  error?: string; // present on a 400, e.g. "No motor IDs specified to download files for."
}

export interface MotorMassBasis {
  totalMassKg: number;
  propellantMassKg: number;
}

export interface DownloadedThrustCurve {
  samples: ThrustSample[];
  /** Which source file ThrustCurve.org actually gave us -- e.g. "RockSim" / "cert" -- surfaced in
   * the UI so the user can see which curve is driving the simulation when its own numbers disagree
   * with ThrustCurve.org's catalog record (see MotorMassBasis's own doc comment). */
  sourceFormat: string;
  sourceQuality: string;
  /**
   * The winning RockSim (.rse) source file's own header total/propellant weight (initWt/propWt,
   * grams in the file, converted to kg here) -- the exact numbers its <eng-data> mass curve was
   * generated from (auto-calc-mass="1" in every real file checked -- this "real per-sample data" is
   * RockSim's own derived curve, not measured telemetry). Present whenever the winning source is a
   * RockSim file with a parseable header, regardless of whether the curve itself passed
   * deriveMotorMassCurve's self-consistency check.
   *
   * Deliberately NOT the same as this motor's ThrustCurve.org catalog totalWeightG/propWeightG --
   * surveyed 24 real motors (H through O impulse class) and found the file's own header always
   * exactly matches its own <eng-data> curve start, but disagrees with the separately-maintained
   * catalog figure by >2% in 10/24 cases (two by 39% and 78%). Using the file's own numbers here
   * avoids treating that routine cross-source drift as a data problem -- it isn't one, it's just two
   * different records for the same motor. See main.ts's renderMassBasisDriftWarning for where the
   * (much rarer, and worth surfacing) gap between this and the catalog gets shown to the user.
   */
  realMassBasis?: MotorMassBasis;
}

/**
 * Extracts a RockSim-format (.rse) file's own header total/propellant weight (initWt/propWt) --
 * see DownloadedThrustCurve.realMassBasis for why this is read separately from ThrustCurve.org's
 * catalog metadata. Returns null if undecodable or the <engine ...> tag/attributes aren't found --
 * matches parseRseEngDataMassKg's own all-or-nothing philosophy for real data.
 */
export function parseRseEngineHeaderWeights(base64Data: string): MotorMassBasis | null {
  let xml: string;
  try {
    xml = atob(base64Data);
  } catch {
    return null;
  }
  // [ \t] (not \b) after "engine" -- a plain word-boundary match also matches the wrapping
  // <engine-database>/<engine-list> tags every file starts with (confirmed directly: "engine-"
  // still crosses a \b boundary at the hyphen), which sit before the real <engine ...> tag and would
  // otherwise "win" the match with an empty/wrong attribute string.
  const engineMatch = xml.match(/<engine[ \t]([^>]*)>/);
  if (!engineMatch) return null;
  const attrs = engineMatch[1]!;
  const initWtMatch = attrs.match(/\binitWt="([^"]*)"/);
  const propWtMatch = attrs.match(/\bpropWt="([^"]*)"/);
  const initWtG = initWtMatch ? Number.parseFloat(initWtMatch[1]!) : Number.NaN;
  const propWtG = propWtMatch ? Number.parseFloat(propWtMatch[1]!) : Number.NaN;
  if (!Number.isFinite(initWtG) || !Number.isFinite(propWtG)) return null;
  return { totalMassKg: initWtG / 1000, propellantMassKg: propWtG / 1000 };
}

/**
 * Parses propellant-mass-remaining (kg) out of a RockSim-format (.rse) raw file's own
 * <eng-data t="..." m="..."/> entries, in document order -- the SAME entries ThrustCurve.org's own
 * "samples" extraction is built from for this format (confirmed directly: for a real motor, the
 * "samples" time/thrust values matched this file's own <eng-data> t/f values exactly, point for
 * point), so zipping these masses onto the samples array by index is a straight 1:1 correspondence,
 * not a separate/re-interpolated time series. Returns null (not a partial/best-effort array) if the
 * file can't be decoded, has no <eng-data> tags, or any tag is missing a numeric m= value -- an
 * all-or-nothing real curve, never a mix of real and guessed points.
 */
export function parseRseEngDataMassKg(base64Data: string): number[] | null {
  let xml: string;
  try {
    xml = atob(base64Data);
  } catch {
    return null;
  }
  const tags = Array.from(xml.matchAll(/<eng-data\b([^/>]*)\/>/g));
  if (tags.length === 0) return null;
  const massesKg: number[] = [];
  for (const tag of tags) {
    const match = tag[1]!.match(/\bm="([^"]*)"/);
    const massG = match ? Number.parseFloat(match[1]!) : Number.NaN;
    if (!Number.isFinite(massG)) return null;
    massesKg.push(massG / 1000);
  }
  return massesKg;
}

/** Downloads pre-parsed thrust-curve samples for a motor, plus each sample's own real propellant-mass-remaining and the source file's own header weights when the winning source file has them (see ThrustSample.propellantMassRemainingKg and DownloadedThrustCurve.realMassBasis). Prefers a "cert" source file if multiple exist, per ThrustCurve.org's own source-quality ordering -- unaffected by which file happens to carry real mass data, since curve quality/certification matters more than that. */
export async function downloadThrustSamples(motorId: string): Promise<DownloadedThrustCurve> {
  const res = await fetch(`${API_BASE}/download.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motorIds: [motorId], data: "both" }),
  });
  const data = (await res.json().catch(() => null)) as DownloadResponse | null;
  if (!res.ok) {
    throw new Error(data?.error ? `ThrustCurve.org rejected this download: ${data.error}` : `ThrustCurve.org download failed: ${res.status} ${res.statusText}`);
  }
  const withSamples = (data?.results ?? []).filter((r): r is DownloadResult & { samples: ThrustSample[] } =>
    Array.isArray(r.samples) && r.samples.length > 0,
  );
  if (withSamples.length === 0) {
    throw new Error(`No thrust-curve data files available for motor ${motorId}`);
  }
  const sourceRank = (source: string): number =>
    source === "cert" ? 0 : source === "mfr" ? 1 : 2;
  withSamples.sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
  const winner = withSamples[0]!;

  if (winner.format === "RockSim" && winner.data) {
    const massesKg = parseRseEngDataMassKg(winner.data);
    const headerWeights = parseRseEngineHeaderWeights(winner.data) ?? undefined;
    // Only trust the zip-by-index when counts match exactly -- ThrustCurve.org's own "samples"
    // extraction and this file's raw <eng-data> tags are normally the same points, but falling
    // back to derivation (rather than guessing an alignment) if that ever isn't true is safer than
    // risking a mass value attached to the wrong time.
    if (massesKg && massesKg.length === winner.samples.length) {
      return {
        samples: winner.samples.map((s, i) => ({ ...s, propellantMassRemainingKg: massesKg[i] })),
        sourceFormat: winner.format,
        sourceQuality: winner.source,
        realMassBasis: headerWeights,
      };
    }
    return { samples: winner.samples, sourceFormat: winner.format, sourceQuality: winner.source, realMassBasis: headerWeights };
  }
  return { samples: winner.samples, sourceFormat: winner.format, sourceQuality: winner.source };
}

/**
 * Effective initial thrust: total impulse delivered in the first INITIAL_WINDOW_S of the burn
 * (trapezoidal-integrated, linearly interpolating the boundary sample), divided by that window's
 * duration -- an impulse-weighted average, not a single sample.
 *
 * A single-sample "first thrust value above zero" was tried first and is wrong: digitized curves
 * (RASP/RockSim) commonly carry a couple of sparse, noisy points on the rising edge right at
 * ignition before the curve settles into its real burn profile. Confirmed directly against a real
 * motor (AeroTech J435WS): its first non-zero sample is 11N at t=0.029s, while the curve is
 * already at 528-694N by t=0.036-0.048s and stays roughly 550-700N through the rest of the
 * window -- a single-sample pick reported this well-regarded, perfectly flyable J-class motor at
 * a nonsense ~0.1:1 thrust:weight ratio. Integrating impulse over a real time window makes a
 * handful of noisy microseconds-wide samples contribute almost nothing to the result, landing
 * on ~560N for the same motor -- consistent with its burn profile and its ~442N reported average.
 *
 * If the whole burn is shorter than the window, integrates the whole thing (equivalent to
 * avgThrustN, at that point) rather than reading past the end of the curve.
 */
const INITIAL_THRUST_WINDOW_S = 0.5;

function computeInitialThrustN(samples: ThrustSample[]): number {
  if (samples.length === 0) return 0;
  const burnTime = samples[samples.length - 1]!.time;
  const windowEnd = Math.min(INITIAL_THRUST_WINDOW_S, burnTime);
  if (windowEnd <= 0) return samples[0]!.thrust;

  let impulse = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (a.time >= windowEnd) break;
    const thrustAtSegEnd =
      b.time > windowEnd ? a.thrust + (b.thrust - a.thrust) * ((windowEnd - a.time) / (b.time - a.time)) : b.thrust;
    const segEnd = Math.min(b.time, windowEnd);
    impulse += ((a.thrust + thrustAtSegEnd) / 2) * (segEnd - a.time);
  }
  return impulse / windowEnd;
}

/**
 * Batch-fetches just enough of each motor's thrust curve to compute its effective initial thrust
 * (see computeInitialThrustN — an impulse-weighted average over the first
 * INITIAL_THRUST_WINDOW_S, not the burn-wide peak; those aren't the same motor, e.g. many BP
 * motors have their peak partway through the burn) for every motor in one request, rather than
 * one download.json round-trip per row of a search-results table. `download.json` accepts an
 * array of motorIds directly (confirmed against the live API), so this is the same endpoint as
 * downloadThrustSamples, just requesting many motors' samples at once instead of one motor's full
 * curve.
 *
 * Motors ThrustCurve.org has no data file for are silently omitted from the result map (not
 * thrown) -- a partial table is more useful than failing the whole batch over one bad motor.
 */
export async function downloadInitialThrusts(motorIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (motorIds.length === 0) return out;

  const res = await fetch(`${API_BASE}/download.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motorIds, data: "samples" }),
  });
  const data = (await res.json().catch(() => null)) as DownloadResponse | null;
  if (!res.ok) {
    throw new Error(data?.error ? `ThrustCurve.org rejected this download: ${data.error}` : `ThrustCurve.org download failed: ${res.status} ${res.statusText}`);
  }

  const sourceRank = (source: string): number =>
    source === "cert" ? 0 : source === "mfr" ? 1 : 2;
  const bestByMotor = new Map<string, DownloadResult & { samples: ThrustSample[] }>();
  for (const r of data?.results ?? []) {
    if (!Array.isArray(r.samples) || r.samples.length === 0) continue;
    const existing = bestByMotor.get(r.motorId);
    if (!existing || sourceRank(r.source) < sourceRank(existing.source)) {
      bestByMotor.set(r.motorId, r as DownloadResult & { samples: ThrustSample[] });
    }
  }

  for (const [motorId, result] of bestByMotor) {
    out.set(motorId, computeInitialThrustN(result.samples));
  }
  return out;
}
