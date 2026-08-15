/**
 * Global metric/imperial display toggle. Every formatter here takes a value
 * in this project's internal SI base unit (m, kg, m/s, N, N·s) and returns a
 * formatted string with the unit suffix — callers never branch on the unit
 * system themselves, so "convert throughout" means "call these instead of
 * .toFixed() + a hardcoded suffix," not a scattered set of if/else blocks.
 *
 * Deliberately module-level mutable state (not a parameter threaded through
 * every render function) — this file's whole rendering approach is already
 * imperative DOM manipulation (see activeRocket's own doc comment in
 * main.ts), so a single toggle-able global fits the existing pattern rather
 * than fighting it.
 */

export type UnitSystem = "metric" | "imperial";

let current: UnitSystem = "imperial";

export function getUnitSystem(): UnitSystem {
  return current;
}

export function setUnitSystem(system: UnitSystem): void {
  current = system;
}

const M_TO_IN = 1 / 0.0254;
const M_TO_FT = 1 / 0.3048;
const KG_TO_OZ = 35.27396195;
const KG_TO_LB = 2.20462262;
const MS_TO_MPH = 1 / 0.44704;
const N_TO_LBF = 1 / 4.4482216153;

/**
 * Thousands-grouped number formatting for every fmt* function below -- imperial gets the
 * US-style comma ("20,250"), metric gets a plain space, the SI/ISO-31-0 recommended digit-group
 * separator for scientific/technical writing (a comma or period there is ambiguous, since either
 * one is also a DECIMAL separator in some locales; a space isn't). Deliberately hand-rolled rather
 * than Number.toLocaleString(): locale grouping behavior (and even data availability) varies across
 * JS engines/environments, where this always produces the same, predictable result -- decimal point
 * stays "." either way, only the thousands separator and its character change.
 */
function groupThousands(value: number, digits: number): string {
  const separator = current === "metric" ? " " : ",";
  const [intPart, decPart] = Math.abs(value).toFixed(digits).split(".");
  const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  const sign = value < 0 ? "-" : "";
  return decPart ? `${sign}${grouped}.${decPart}` : `${sign}${grouped}`;
}

/**
 * Small-scale length — component dimensions, CP/CG, diameters: cm (metric,
 * 2 decimals — the same 0.1mm resolution the old mm-based version had) or
 * in (imperial). Was mm; switched to cm so length figures shown together
 * (this, fmtRocketLength) don't visually mix mm and cm side by side.
 */
export function fmtLength(m: number, digits?: number): string {
  if (current === "metric") return `${groupThousands(m * 100, digits ?? 2)} cm`;
  return `${groupThousands(m * M_TO_IN, digits ?? 2)} in`;
}

/**
 * Rocket-scale length — overall rocket length, library search results:
 * cm (metric) or in (imperial). Distinct from fmtLength (mm/in, for
 * component-scale dimensions like CP/CG/diameter) and fmtAltitude (m/ft,
 * for trajectory-scale heights) — this project's library spans roughly
 * 33cm to 7m, where mm is too fine-grained (four-plus digits) and m reads
 * as near-zero for anything under a meter; cm is the size hobbyists
 * actually use when describing a rocket's length ("it's about 120cm"),
 * matching how imperial builders talk in inches, not feet, at this scale.
 */
export function fmtRocketLength(m: number, digits?: number): string {
  if (current === "metric") return `${groupThousands(m * 100, digits ?? 1)} cm`;
  return `${groupThousands(m * M_TO_IN, digits ?? 1)} in`;
}

/** Large-scale length — altitude, apogee: m (metric) or ft (imperial). */
export function fmtAltitude(m: number, digits?: number): string {
  if (current === "metric") return `${groupThousands(m, digits ?? 1)} m`;
  return `${groupThousands(m * M_TO_FT, digits ?? 0)} ft`;
}

/** Mass — motor/component/combined mass: g (metric) or oz (imperial). */
export function fmtMass(kg: number, digits?: number): string {
  if (current === "metric") return `${groupThousands(kg * 1000, digits ?? 1)} g`;
  return `${groupThousands(kg * KG_TO_OZ, digits ?? 2)} oz`;
}

/** Larger-scale mass — liftoff weight if ever needed at kg/lb scale: kg (metric) or lb (imperial). */
export function fmtMassLarge(kg: number, digits?: number): string {
  if (current === "metric") return `${groupThousands(kg, digits ?? 2)} kg`;
  return `${groupThousands(kg * KG_TO_LB, digits ?? 2)} lb`;
}

/** Velocity — flight/wind speed: m/s (metric) or mph (imperial). */
export function fmtVelocity(ms: number, digits?: number): string {
  if (current === "metric") return `${groupThousands(ms, digits ?? 1)} m/s`;
  return `${groupThousands(ms * MS_TO_MPH, digits ?? 1)} mph`;
}

/** Force — thrust: N (metric) or lbf (imperial). */
export function fmtForce(n: number, digits?: number): string {
  if (current === "metric") return `${groupThousands(n, digits ?? 1)} N`;
  return `${groupThousands(n * N_TO_LBF, digits ?? 2)} lbf`;
}

/** Impulse — total/motor impulse: N·s (metric) or lbf·s (imperial). */
export function fmtImpulse(ns: number, digits?: number): string {
  if (current === "metric") return `${groupThousands(ns, digits ?? 2)} N·s`;
  return `${groupThousands(ns * N_TO_LBF, digits ?? 2)} lbf·s`;
}

// --- Editable-input helpers: the number an <input> should show/parse, and the unit-label text next to it. ---
// Unlike the fmt* functions above (SI in, formatted string out), these keep the numeric value and
// unit label separate since an <input type="number"> needs a bare editable number, not a suffixed string.

export function massInputUnitLabel(): string {
  return current === "metric" ? "g" : "oz";
}

/** kg -> the number to show in a mass input field. */
export function massToInput(kg: number): number {
  return current === "metric" ? kg * 1000 : kg * KG_TO_OZ;
}

/** The number typed into a mass input field -> kg. */
export function massFromInput(raw: number): number {
  return current === "metric" ? raw / 1000 : raw / KG_TO_OZ;
}

export function lengthInputUnitLabel(): string {
  return current === "metric" ? "cm" : "in";
}

/** m -> the number to show in a length input field. */
export function lengthToInput(m: number): number {
  return current === "metric" ? m * 100 : m * M_TO_IN;
}

/** The number typed into a length input field -> m. */
export function lengthFromInput(raw: number): number {
  return current === "metric" ? raw / 100 : raw / M_TO_IN;
}

// --- Large-scale editable inputs: m (metric) or ft (imperial) -- same altitude-scale convention as
// fmtAltitude, for things measured in whole meters/feet (launch rod length, site elevation) rather
// than component-scale cm/in.

export function altitudeInputUnitLabel(): string {
  return current === "metric" ? "m" : "ft";
}

/** m -> the number to show in an altitude-scale input field. */
export function altitudeToInput(m: number): number {
  return current === "metric" ? m : m * M_TO_FT;
}

/** The number typed into an altitude-scale input field -> m. */
export function altitudeFromInput(raw: number): number {
  return current === "metric" ? raw : raw / M_TO_FT;
}

// --- Chart-axis helpers: bare numeric value (no suffix, uPlot draws its own axis labels) plus
// the unit label text for the axis title — same large-scale altitude/velocity conventions as
// fmtAltitude/fmtVelocity above, split apart because a chart axis needs a plain number series.

export function altitudeAxisUnitLabel(): string {
  return current === "metric" ? "m" : "ft";
}

export function altitudeAxisValue(m: number): number {
  return current === "metric" ? m : m * M_TO_FT;
}

export function velocityAxisUnitLabel(): string {
  return current === "metric" ? "m/s" : "mph";
}

export function velocityAxisValue(ms: number): number {
  return current === "metric" ? ms : ms * MS_TO_MPH;
}

export function forceAxisUnitLabel(): string {
  return current === "metric" ? "N" : "lbf";
}

export function forceAxisValue(n: number): number {
  return current === "metric" ? n : n * N_TO_LBF;
}
