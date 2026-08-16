import type { Component } from "../model/component.js";
import type { DescentDevice } from "../formats/rocksim/parse.js";
import type { MotorSearchResult, ThrustSample, MotorMassBasis } from "../physics/motor/thrustcurve-client.js";

/**
 * Caches the last-used rocket + motor + manual overrides in localStorage, purely so a repeat embed
 * visitor (splashcast's iframe is fully torn down and rebuilt on every modal close/open, but always
 * from this SAME origin -- see splashcast/site/assets/js/app.js's openAscentSimModal/
 * closeAscentSimModal) doesn't have to redo rocket pick + motor search + CG/mass/CP entry every
 * single time just to see how drift shifts as the forecast updates through the day. Purely a soft
 * convenience -- never load-bearing, so every read/write here fails silently rather than throwing
 * (private browsing, storage disabled, quota, or a schema this version doesn't recognize all just
 * mean "no cache," not an error).
 */

const STORAGE_KEY = "rocketry:lastConfig:v1";

/** Mirrors applyParsedRocket's own parameter shape (src/main.ts) plus `warnings`, which that function doesn't take directly (each call site sets activeParseWarnings itself) but a restore path needs to reproduce. */
export interface CachedParsedRocket {
  name: string;
  components: Component[];
  warnings: string[];
  estimatedDryMassKg?: number;
  estimatedDryCgM?: number;
  dryMassBreakdown?: { name: string; massKg: number; cgXM: number }[];
  motorMountDiameterM?: number;
  unsupportedFeatures?: string[];
  embeddedCpM?: number;
  descentDevices?: DescentDevice[];
}

export type CachedRocketSource =
  | { kind: "library"; entryId: string; displayName: string }
  | { kind: "upload"; parsed: CachedParsedRocket; fileName: string; displayName: string };

export interface CachedOverrides {
  dryMassKg: number;
  cgM: number;
  cgOverriddenByUser: boolean;
  cpOverrideM?: number;
  cpOverrideSource: "manual" | "simfile" | null;
  launchRodLengthM: number;
}

export interface CachedMotor {
  motorId: string;
  meta: MotorSearchResult;
  samples: ThrustSample[];
  realMassBasis?: MotorMassBasis;
  sourceFormat: string;
  sourceQuality: string;
}

export interface CachedRocketConfig {
  version: 1;
  savedAt: string;
  rocketSource: CachedRocketSource;
  overrides: CachedOverrides;
  motor: CachedMotor | null;
}

export function saveCachedConfig(config: CachedRocketConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Soft cache -- see this file's own header comment.
  }
}

export function loadCachedConfig(): CachedRocketConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) return null;
    return parsed as CachedRocketConfig;
  } catch {
    return null;
  }
}

export function clearCachedConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Soft cache -- see this file's own header comment.
  }
}

/** The compact, postMessage-sized descriptor sent outbound in rocketry:ascentResults (see src/ui/embed.ts) -- deliberately omits the motor's own thrust-curve `samples` (a splashcast-side consumer has no use for the raw curve, only for knowing/showing which rocket+motor is currently active; re-deriving a full restore from this alone would need one downloadThrustSamples(motorId) call, same cost as a normal motor pick). */
export interface OutboundRocketConfig {
  /** Human-friendly, ready to display as-is -- e.g. "LOC-IV X2 + AeroTech K400C", or just the rocket name alone if no motor's picked yet. */
  label: string;
  rocketSource: { kind: "library"; entryId: string } | { kind: "upload" };
  motorId: string | null;
  overrides: CachedOverrides;
}

export function buildOutboundRocketConfig(cached: CachedRocketConfig): OutboundRocketConfig {
  const rocketLabel = cached.rocketSource.displayName;
  const motorLabel = cached.motor ? `${cached.motor.meta.manufacturer} ${cached.motor.meta.designation}` : null;

  return {
    label: motorLabel ? `${rocketLabel} + ${motorLabel}` : rocketLabel,
    rocketSource: cached.rocketSource.kind === "library" ? { kind: "library", entryId: cached.rocketSource.entryId } : { kind: "upload" },
    motorId: cached.motor?.motorId ?? null,
    overrides: cached.overrides,
  };
}
