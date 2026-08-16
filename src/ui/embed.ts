import type { StabilityCheck } from "../physics/aero/stability-check.js";
import type { AscentPath } from "../physics/sim/ascent-path.js";

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

/** Assembles the exact `rocketry:ascentResult` postMessage envelope -- one place so it can't drift between call sites (there's only one right now, but the shape itself is the contract, worth pinning down explicitly). */
export function buildAscentResultMessage(
  rocketName: string,
  parseWarnings: string[],
  stability: StabilityCheck,
  ascentPath: AscentPath,
): { type: "rocketry:ascentResult"; rocketName: string; parseWarnings: string[]; stability: StabilityCheck; ascentPath: AscentPath } {
  return { type: "rocketry:ascentResult", rocketName, parseWarnings, stability, ascentPath };
}

/** Assembles the exact `rocketry:error` postMessage envelope. `message` should be specific enough to show directly to the splashcast visitor (see the contract's own guidance), not a raw stack trace. */
export function buildErrorMessage(message: string): { type: "rocketry:error"; message: string } {
  return { type: "rocketry:error", message };
}
