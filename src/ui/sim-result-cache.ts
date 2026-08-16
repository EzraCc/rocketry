import type { AscentPath } from "../physics/sim/ascent-path.js";

/**
 * Caches individual (forecast content, hour, model, rocket+motor) -> AscentPath results in
 * localStorage, so scrubbing splashcast's own time slider back to an hour already simulated earlier
 * in the same browsing session (a real, expected usage pattern -- "was it better at 9am or 11am?")
 * returns the previous result instantly instead of re-running a real numerical flight simulation
 * for a combination that's already been computed. Each iframe reopen fetches windUrl fresh (see
 * wireEmbedMode in main.ts) and re-simulates hour-by-hour/model-by-model in runEmbedMultiModelSim --
 * this cache sits in front of that per-model simulation step.
 *
 * Cache key includes a content hash of the actual fetched forecast JSON (not just its URL, and not
 * a manually-maintained "forecast version" field) -- deliberately, so "the forecast got updated"
 * invalidates automatically and correctly the moment the JSON's own content differs, with no
 * splashcast-side cooperation needed and no risk of trusting a stale/reused URL. A byte-identical
 * refetch (nothing changed) hashes the same and correctly reuses the cache; genuinely new forecast
 * data hashes differently and correctly forces a rerun -- see hashString/buildSimCacheKey.
 */

const STORAGE_KEY = "rocketry:simResultCache:v1";
// One forecast file's wind_hours is typically ~10 hours x up to 6 models -- 60 covers a full day's
// worth of distinct hour/model combinations for one rocket+motor+forecast combo without ballooning
// localStorage usage (a real AscentPath is ~15-20 KB serialized, so 60 entries is roughly 1 MB,
// comfortably under a typical 5+ MB per-origin quota even alongside the separate rocket/motor cache
// in src/ui/rocket-cache.ts).
const MAX_ENTRIES = 60;

interface SimResultCacheEntry {
  key: string;
  savedAt: string;
  ascentPath: AscentPath;
}

/**
 * FNV-1a, 32-bit -- not cryptographic, doesn't need to be: only used to cheaply/synchronously tell
 * "this forecast JSON is the same as before" from "it changed" for a cache key. crypto.subtle.digest
 * is async and real collision-resistance is unnecessary overkill for that job.
 */
export function hashString(s: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function buildSimCacheKey(parts: { forecastFingerprint: string; hour: number; model: string; rocketFingerprint: string }): string {
  return `${parts.forecastFingerprint}:${parts.hour}:${parts.model}:${parts.rocketFingerprint}`;
}

function readAll(): SimResultCacheEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SimResultCacheEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: SimResultCacheEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Soft cache -- a write failure (quota, private browsing, disabled storage) just means the next
    // lookup misses and re-simulates, same as any other cache miss.
  }
}

export function loadCachedSimResult(key: string): AscentPath | null {
  return readAll().find((e) => e.key === key)?.ascentPath ?? null;
}

/** Inserts/replaces this key's entry and evicts the OLDEST entries first (simple insertion-order eviction, not real LRU -- good enough for a same-day scrubbing session, not meant to accumulate indefinitely across many different launch days). */
export function saveCachedSimResult(key: string, ascentPath: AscentPath): void {
  const entries = readAll().filter((e) => e.key !== key);
  entries.push({ key, savedAt: new Date().toISOString(), ascentPath });
  while (entries.length > MAX_ENTRIES) entries.shift();
  writeAll(entries);
}

export function clearSimResultCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Soft cache -- see writeAll's own comment.
  }
}
