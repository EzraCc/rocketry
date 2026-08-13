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

let current: UnitSystem = "metric";

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

/** Small-scale length — component dimensions, CP/CG, diameters: mm (metric) or in (imperial). */
export function fmtLength(m: number, digits?: number): string {
  if (current === "metric") return `${(m * 1000).toFixed(digits ?? 1)} mm`;
  return `${(m * M_TO_IN).toFixed(digits ?? 2)} in`;
}

/** Large-scale length — altitude, apogee: m (metric) or ft (imperial). */
export function fmtAltitude(m: number, digits?: number): string {
  if (current === "metric") return `${m.toFixed(digits ?? 1)} m`;
  return `${(m * M_TO_FT).toFixed(digits ?? 0)} ft`;
}

/** Mass — motor/component/combined mass: g (metric) or oz (imperial). */
export function fmtMass(kg: number, digits?: number): string {
  if (current === "metric") return `${(kg * 1000).toFixed(digits ?? 1)} g`;
  return `${(kg * KG_TO_OZ).toFixed(digits ?? 2)} oz`;
}

/** Larger-scale mass — liftoff weight if ever needed at kg/lb scale: kg (metric) or lb (imperial). */
export function fmtMassLarge(kg: number, digits?: number): string {
  if (current === "metric") return `${kg.toFixed(digits ?? 2)} kg`;
  return `${(kg * KG_TO_LB).toFixed(digits ?? 2)} lb`;
}

/** Velocity — flight/wind speed: m/s (metric) or mph (imperial). */
export function fmtVelocity(ms: number, digits?: number): string {
  if (current === "metric") return `${ms.toFixed(digits ?? 1)} m/s`;
  return `${(ms * MS_TO_MPH).toFixed(digits ?? 1)} mph`;
}

/** Force — thrust: N (metric) or lbf (imperial). */
export function fmtForce(n: number, digits?: number): string {
  if (current === "metric") return `${n.toFixed(digits ?? 1)} N`;
  return `${(n * N_TO_LBF).toFixed(digits ?? 2)} lbf`;
}

/** Impulse — total/motor impulse: N·s (metric) or lbf·s (imperial). */
export function fmtImpulse(ns: number, digits?: number): string {
  if (current === "metric") return `${ns.toFixed(digits ?? 2)} N·s`;
  return `${(ns * N_TO_LBF).toFixed(digits ?? 2)} lbf·s`;
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
  return current === "metric" ? "mm" : "in";
}

/** m -> the number to show in a length input field. */
export function lengthToInput(m: number): number {
  return current === "metric" ? m * 1000 : m * M_TO_IN;
}

/** The number typed into a length input field -> m. */
export function lengthFromInput(raw: number): number {
  return current === "metric" ? raw / 1000 : raw / M_TO_IN;
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
