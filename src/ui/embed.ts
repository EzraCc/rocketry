import type { StabilityCheck } from "../physics/aero/stability-check.js";
import type { AscentPath } from "../physics/sim/ascent-path.js";
import type { OutboundRocketConfig } from "./rocket-cache.js";

/**
 * "Embed mode" -- gated behind `?embed=1` on the existing single-page app, for splashcast
 * (github.com/EzraCc/splashcast) to load this app in a visible, interactive `<iframe>` rather than
 * vendoring rocketry's own GPLv3 code into its own (non-GPLv3) runtime. Full contract:
 * splashcast/.claude/plans/rocketry-flight-sim-integration.md (splashcast's own side, already
 * built) / rocketry/tmp/splashcast-integration.md (this side's own copy of the same contract).
 *
 * Pure logic only -- no DOM, no fetch -- kept separate from main.ts so the parsing/validation edge
 * cases and the exact postMessage envelope shape are unit-testable in isolation.
 */

export interface EmbedParams {
  windUrl: string;
  hour: number;
  parentOrigin: string;
}

/**
 * Returns null when `embed` isn't exactly "1" (normal mode -- every other param is irrelevant).
 * When `embed=1`, `windUrl`/`hour`/`parentOrigin` are all required; a missing/malformed one is a
 * config error the caller must handle explicitly (see this function's own return type -- there's
 * no "partially valid" embed state). Deliberately returns null rather than throwing: the caller
 * needs to distinguish "not embed mode at all" from "embed mode, but broken," since only the
 * latter should render an error state, and even that split (config error with no known
 * parentOrigin to postMessage to, vs. one with a parentOrigin we CAN report to) is the caller's own
 * responsibility -- see main.ts's own handling.
 */
export function parseEmbedParams(search: URLSearchParams): EmbedParams | { error: string; parentOrigin: string | null } | null {
  if (search.get("embed") !== "1") return null;

  const windUrl = search.get("windUrl");
  const hourRaw = search.get("hour");
  const parentOrigin = search.get("parentOrigin");

  if (!windUrl) return { error: "Missing required windUrl parameter.", parentOrigin };
  if (!parentOrigin) return { error: "Missing required parentOrigin parameter.", parentOrigin: null };
  if (hourRaw === null || !/^-?\d+$/.test(hourRaw)) {
    return { error: `Missing or invalid hour parameter (got ${hourRaw === null ? "nothing" : JSON.stringify(hourRaw)}).`, parentOrigin };
  }

  return { windUrl, hour: Number.parseInt(hourRaw, 10), parentOrigin };
}

export interface ModelAscentResult {
  model: string;
  ascentPath: AscentPath;
}

/**
 * Assembles the `rocketry:ascentResults` (plural) postMessage envelope -- one ascent path PER
 * forecast model actually available for the requested hour (splashcast's own `selectedModels`
 * show/hide toggle already operates on "all available models, all start selected" for the descent
 * side -- see app.js -- so rocketry sends every available model's own ascent path rather than
 * picking one, and splashcast applies that same toggle to these too, matching each one to the
 * descent path it already computes independently per model). Never a subset chosen on this side:
 * which models are even available varies by how far out the launch is (e.g. HRRR only inside 48h),
 * so "available" is already the real constraint, not something to filter further.
 *
 * `stability` is a single top-level field, not duplicated per model -- the static margin depends
 * only on CP/CG geometry, never on wind, so every model would report the exact same value; sending
 * it once avoids N identical copies and makes that invariant explicit rather than implicit.
 *
 * `rocketConfig` (optional, added for the repeat-visitor caching feature -- see
 * src/ui/rocket-cache.ts) is a compact, human-labeled descriptor of the rocket+motor+overrides that
 * produced this result. Additive-only: omitted entirely (`undefined`, not present in the JSON when
 * serialized) whenever the caller has no cached config to attach, so a consumer that predates this
 * field (splashcast's own listener, at time of writing) is entirely unaffected either way. Not yet
 * consumed on the inbound side by anything in this repo -- see rocket-cache.ts's own header comment
 * for the deferred "splashcast stores this and passes it back" follow-up this unlocks.
 */
export function buildAscentResultsMessage(
  rocketName: string,
  parseWarnings: string[],
  stability: StabilityCheck,
  results: ModelAscentResult[],
  rocketConfig?: OutboundRocketConfig,
): {
  type: "rocketry:ascentResults";
  rocketName: string;
  parseWarnings: string[];
  stability: StabilityCheck;
  results: ModelAscentResult[];
  rocketConfig?: OutboundRocketConfig;
} {
  return { type: "rocketry:ascentResults", rocketName, parseWarnings, stability, results, rocketConfig };
}

/** Assembles the exact `rocketry:error` postMessage envelope. `message` should be specific enough to show directly to the splashcast visitor (see the contract's own guidance), not a raw stack trace. */
export function buildErrorMessage(message: string): { type: "rocketry:error"; message: string } {
  return { type: "rocketry:error", message };
}
