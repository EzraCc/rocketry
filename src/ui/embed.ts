import type { StabilityCheck } from "../physics/aero/stability-check.js";
import type { AscentPath } from "../physics/sim/ascent-path.js";
import type { OutboundRocketConfig } from "./rocket-cache.js";
import type { DescentDevice } from "../formats/rocksim/parse.js";
import { descentRate } from "../physics/mass/descent-rate.js";

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
  /**
   * Opt-in, set by the CALLER (splashcast), not inferred here -- when `autoSend=1`, rocketry skips
   * its own manual "Send to splashcast" review gate (see updateEmbedSendButton/
   * sendCurrentReviewToSplashcast in main.ts) and posts the multi-model result the moment the local
   * sim completes, same as clicking the button would. Meant for splashcast's own background
   * prefetch loads (fetching OTHER hours' results ahead of time, with a rocket+motor the visitor has
   * already reviewed and approved once interactively) -- nobody's watching those, so a button that's
   * never clicked would just mean the prefetch never actually delivers anything. Defaults to false
   * (require the manual click) whenever the param is absent or not exactly "1", so every existing
   * caller keeps today's review-gated behavior unless it explicitly opts into skipping it.
   */
  autoSend: boolean;
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

  return { windUrl, hour: Number.parseInt(hourRaw, 10), parentOrigin, autoSend: search.get("autoSend") === "1" };
}

export interface ModelAscentResult {
  model: string;
  ascentPath: AscentPath;
}

/**
 * One recovery device's descent info, shaped for splashcast's own drift calculation -- it needs a
 * descent rate per device to predict drift, not just canopy area/CD (which is what this project
 * already computed for its own display -- see renderDescentDevicesSection in main.ts -- but never
 * sent anywhere). `deployAltitudeM` is currently ALWAYS null: no parser in this project extracts a
 * reliable design-time deployment altitude from any supported file format. RockSim (.rkt) design
 * data has no such field on a `<Parachute>`/`<Streamer>` at all -- only a saved simulation run's own
 * event log (`<SimulationEventList>`), which reflects whatever one specific past run happened to do,
 * not general design intent, and isn't extracted here for that reason (confirmed OpenRocket's own
 * RockSim importer doesn't attempt this either). Included as a field anyway (not omitted) so
 * splashcast's own schema is stable now and doesn't need to change again if/when a real source shows
 * up later -- splashcast is expected to let the visitor fill in/edit a real value on its own side
 * when this is null, same as it would for a device this project couldn't compute a rate for at all.
 */
export interface OutboundDescentDevice {
  role: "drogue" | "main";
  type: "parachute" | "streamer";
  descentRateMs: number;
  deployAltitudeM: number | null;
}

/** Builds the descentDevices array for buildAscentResultsMessage from the active rocket's own parsed recovery devices (see DescentDevice) plus the same descending-mass/air-density inputs renderDescentDevicesSection already uses for its own display -- one shared descentRate() calculation, not two independently-maintained copies of the same physics. */
export function buildOutboundDescentDevices(devices: DescentDevice[], descentMassKg: number, airDensityKgM3: number): OutboundDescentDevice[] {
  return devices.map((d) => ({
    role: d.role,
    type: d.type,
    descentRateMs: descentRate(d, descentMassKg, airDensityKgM3),
    deployAltitudeM: null,
  }));
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
 *
 * `descentDevices` (optional, see OutboundDescentDevice's own doc comment) is likewise a single
 * top-level field, not duplicated per model -- descent rate depends on descending mass and launch-
 * site air density, neither of which varies by forecast model. Omitted when the active rocket has no
 * parsed recovery devices at all (e.g. RASAero/.ork uploads -- descent-device extraction is RockSim-
 * only today, see activeDescentDevices' own doc comment in main.ts), same "absent means nothing to
 * attach" convention as rocketConfig.
 */
export function buildAscentResultsMessage(
  rocketName: string,
  parseWarnings: string[],
  stability: StabilityCheck,
  results: ModelAscentResult[],
  rocketConfig?: OutboundRocketConfig,
  descentDevices?: OutboundDescentDevice[],
): {
  type: "rocketry:ascentResults";
  rocketName: string;
  parseWarnings: string[];
  stability: StabilityCheck;
  results: ModelAscentResult[];
  rocketConfig?: OutboundRocketConfig;
  descentDevices?: OutboundDescentDevice[];
} {
  return { type: "rocketry:ascentResults", rocketName, parseWarnings, stability, results, rocketConfig, descentDevices };
}

/** Assembles the exact `rocketry:error` postMessage envelope. `message` should be specific enough to show directly to the splashcast visitor (see the contract's own guidance), not a raw stack trace. */
export function buildErrorMessage(message: string): { type: "rocketry:error"; message: string } {
  return { type: "rocketry:error", message };
}
