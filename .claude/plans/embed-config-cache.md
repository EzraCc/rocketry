Status: done
Priority: medium
Type: refinement
Last updated: 2026-08-16

# Streamline repeat embed-mode calls (same rocket+motor, changing weather)

## Context

Anticipated real usage: someone opens the splashcast embed modal several
times in one day to see how drift shifts as forecasts update, using the
SAME rocket + motor every time. Today's embed flow makes them redo the
whole setup every single time: pick/upload the rocket, search + download
the motor, and re-enter any manual CP/CG/mass overrides — even though only
the wind actually changed. Splashcast fully tears down and rebuilds the
`<iframe>` on every modal close/open (`ascentSimIframe.src = ''` on close,
confirmed in `splashcast/site/assets/js/app.js:2254-2272`), so every reopen
is a genuine fresh page load with no in-memory state carried over.

The user wants this streamlined: cache the rocket+motor config so repeat
calls skip straight to "just rerun with today's weather," persist manual
CP/CG/mass overrides (not just what came from the file), and asked
specifically whether that could also be exposed via URL params or in the
JSON postMessage payload — plus wants an explicit easy-vs-heavier-lift
breakdown before committing to scope.

## Key facts from exploration

- **No caching/persistence exists anywhere in this codebase today** —
  grepped for `localStorage`/`sessionStorage`/`indexedDB`: zero matches.
  The only state-survives-a-reload mechanism is the URL query string
  (`rocket=` library slug, `units`, 5 motor-search filter params), which is
  bookmarkability, not caching — every page load still re-fetches/re-parses
  from scratch.
- **Since the iframe always loads from the same rocketry origin** (even
  though torn down/rebuilt on every modal open), `localStorage` set during
  one embed session IS visible on the next embed open in the same browser
  — no splashcast cooperation needed for a same-browser, same-day cache.
- **Library rocket** (`selectLibraryEntry`, `src/main.ts:2399-2424`): keyed
  by a stable `LibraryManifestEntry.id`/`path` — cheap to replay. In fact
  `initLibrary()` (`src/main.ts:2444-2464`) already restores a library
  rocket from a `?rocket=<slug>` URL param today, unconditionally, even in
  embed mode — an existing seam this plan reuses rather than duplicating.
- **Uploaded rocket** (`wireOrkImport`, `src/main.ts:2219-2280`): only raw
  file bytes are read, no stable ID is ever captured. The fix isn't caching
  the raw file — it's caching the already-*parsed* result. `applyParsedRocket`
  (`src/main.ts:117-178`) takes a small, self-contained shape (components +
  a handful of scalars) that's cheap to serialize directly (~1-4 KB per
  rocket, confirmed against real library files) and replay without ever
  touching the original bytes again.
- **Motor** (`selectMotor`, `src/main.ts:1722-1769`): `SelectedMotor.motorId`
  is a stable ThrustCurve.org key, but `selectMotor` currently requires a
  `MotorSearchResult` (`meta`) from a prior search, not just an ID — so the
  cache needs to hold the whole `MotorSelection` (`meta`, `samples`,
  `realMassBasis`, `sourceFormat`, `sourceQuality` — `src/main.ts:324-331`),
  not just the ID, to skip the network entirely on restore. Real motor
  thrust-curves are tiny (~1.5-2 KB for a K400C, worst-case realistic outlier
  ~15-25 KB) — no storage-budget concern.
- **Overrides live in independent module-level state**, all reset by
  `applyParsedRocket`: `activeDryMassKg`/`baseDryMassKg` (mass, no icon
  distinction), `activeLoadedCgM`/`cgOverriddenByUser` (CG, drives the
  🧮/📏 icon), `activeCpOverrideM`/`cpOverrideSource` (CP, display-only —
  never feeds the sim), plus `activeLaunchRodLengthM` (not reset by
  `applyParsedRocket`, persists across rocket switches already). All are
  plain numbers/flags — trivial to serialize.
- **Trigger today**: `runFlightSim` (`src/main.ts:1791-1817`) already has
  `if (embedState) void runEmbedMultiModelSim(rocket)` at line 1809 — fires
  on every (re-)sim regardless of what caused it. A cache-restore flow needs
  no changes here; it just needs to reach `runFlightSim` once rocket+motor
  are both restored and wind data has loaded — no "user clicked motor
  search result" event exists to hang restoration off of, since none of
  that UI gets touched on a cached revisit.
- **Splashcast today** (`site/assets/js/app.js`): persists nothing beyond
  cosmetic UI prefs (map layer, color hues) via flat `localStorage` keys.
  Never reads `rocketName` from the postMessage payload (received into
  memory, never displayed). Builds the iframe `src` fresh via
  `URLSearchParams` at modal-open time (`app.js:2256-2262`) — adding a new
  query param there would be a trivial one-line change on their end, but
  there is currently zero UI to surface a remembered rocket to a visitor.

## Tiered breakdown (as requested)

**Tier 1 — Easy. Rocketry-only, no contract change, no splashcast changes.**
Cache the full rocket+motor+overrides config in `localStorage` (new module,
e.g. `src/ui/rocket-cache.ts`, pure save/load/clear functions on a single
versioned key). Save after every point that already mutates the relevant
state (`applyParsedRocket` call sites, `selectMotor`, the CG/mass/CP/rod-
length edit handlers). On bootstrap, **in embed mode only**, check for a
cached config; if present, replay it directly (`applyParsedRocket`/
`selectLibraryEntry` for the rocket, set `lastMotorSelection` directly for
the motor — no network needed for either), reapply overrides on top, then
call `runFlightSim` once wind data has also loaded — producing the same
"just rerun with today's weather" experience with zero clicks. A "start
over" control clears the cache. This alone fully solves the stated
scenario (same browser, same day, same rocket+motor) with no cross-repo
work.

**Tier 2 — Medium. Additive payload field + optional URL-param restore,
needs splashcast-side follow-up to actually round-trip.**
(a) Add an optional `rocketConfig` field to the `rocketry:ascentResults`
postMessage envelope (`src/ui/embed.ts`) — a compact descriptor (library
`entryId` or the small parsed-upload shape, `motorId` only — not the full
thrust-curve `samples`, to keep it postMessage-sized — plus the same
overrides object) built from the same shape Tier 1 already assembles.
Cheap, additive, doesn't touch splashcast. (b) Optionally also add a new
inbound URL param that, when present, feeds the exact same restore
function Tier 1 built (just from a URL param instead of localStorage), so
if splashcast ever wants to own persistence explicitly (cross-device, or a
visible "current rocket" UI of their own) the plumbing already exists on
rocketry's side. The actual payoff — splashcast storing (a) and replaying
it as (b) on the next modal open — is separate-repo work in a future
splashcast session; today splashcast has no UI at all for showing/managing
a remembered rocket, so this is dead capability until that's built.

**Tier 3 — Heavier lift, not needed for the stated scenario. Named for
completeness, not recommended now:**
- Multiple saved rocket/motor profiles + a picker UI (someone rotating
  between several rockets, not just reusing one) — still client-only, but
  real new UI surface.
- Cross-device/account sync — this app has zero backend today; would need
  one. Out of scope unless explicitly wanted.
- Library-content staleness detection (a cached `entryId` pointing at a
  `.rkt` that's since changed) — no content-hash exists to check against
  today; a cached config is inherently soft (worst case: silently a little
  stale, user notices and picks again), not worth solving up front.

## Approved scope for this pass

Build **Tier 1 in full**, plus **Tier 2(a) only** (the additive outbound
`rocketConfig` payload field — cheap, matches what was asked, unlocks
future splashcast work without committing to it). Defer Tier 2(b)'s inbound
URL-param restore and any splashcast-side work to a later, explicitly
separate session — building the inbound path now would be untested dead
code until splashcast actually sends something back.

## Design (Tier 1 + 2a)

**New module `src/ui/rocket-cache.ts`** (pure logic, unit-testable, no DOM
— matches this project's `src/ui/embed.ts` convention):
- `interface CachedRocketConfig { version: 1; savedAt: string; rocketSource: {kind:"library"; entryId; displayName} | {kind:"upload"; parsed: <applyParsedRocket's param shape>; fileName; displayName}; overrides: {dryMassKg; cgM; cgOverriddenByUser; cpOverrideM?; cpOverrideSource; launchRodLengthM}; motor: {motorId; meta; samples; realMassBasis?; sourceFormat; sourceQuality} | null }`
- `saveCachedConfig(config: CachedRocketConfig): void` / `loadCachedConfig(): CachedRocketConfig | null` (returns null on missing/unparseable/version-mismatch — never throws) / `clearCachedConfig(): void`, all against one versioned `localStorage` key (e.g. `"rocketry:lastConfig:v1"`).
- `buildOutboundRocketConfig(cached: CachedRocketConfig): object` — strips `samples` down to just `motorId` for the postMessage-sized variant (Tier 2a), and strips an upload's `parsed` geometry down to just `{kind: "upload"}` (implementation refinement vs. the original design sketch: since Tier 2(b) replay is explicitly deferred, there's no current consumer for a few KB of duplicate component data on every single postMessage -- the descriptor still reports upload-vs-library truthfully, just without payload the geometry itself yet). Also includes a `label: string` field — a single human-friendly display string (e.g. `"LOC-IV X2 + AeroTech K400C"`, combining the rocket's display name with `${motor.meta.manufacturer} ${motor.meta.designation}`) — so splashcast can show "currently testing: ..." without needing to reconstruct one from separate fields itself. `null` motor (no motor picked yet) falls back to just the rocket name alone.

**`src/main.ts` changes:**
- One small helper, `saveCurrentConfigToCache()`, reading the current
  module-level state (`activeRocket`, `activeLibraryEntry`, the override
  vars, `lastMotorSelection`) into a `CachedRocketConfig` and calling
  `saveCachedConfig`. Called at the end of: both `applyParsedRocket` call
  sites (`selectLibraryEntry`, `wireOrkImport`'s handler), `selectMotor`'s
  success path, and the CG/mass/CP/launch-rod-length edit-commit handlers
  (`wireCgStatEdit`, `wireMassStatEdit`, `wireCpStatEdit`,
  `wireLaunchRodInput`).
- New `restoreCachedConfigIfEmbedded(): Promise<void>`, called from the
  bootstrap sequence after `initLibrary()` is wired but before/alongside
  `wireEmbedMode()`. Only runs when `embedState` is set. Loads the cache;
  if a library-sourced rocket, looks up the entry in the now-loaded
  `libraryManifest` and calls `selectLibraryEntry` (small, always-fresh
  re-fetch of just the `.rkt` text — no staleness risk); if upload-sourced,
  calls `applyParsedRocket` directly with the cached parsed shape (no
  network, no re-parse). Reapplies the overrides object on top (these get
  reset by `applyParsedRocket`/`selectLibraryEntry`, so must be reapplied
  after). If a cached motor is present, sets `lastMotorSelection` directly
  (no `downloadThrustSamples` call) and renders the motor detail/mount
  chart the same way `selectMotor` does internally.
- **Sequencing**: restoring rocket+motor doesn't by itself trigger a sim —
  needs `embedState.windData` to be loaded too (`runEmbedMultiModelSim`
  early-returns without it). Structure this as: restore sets a "pending
  auto-run" rocket once ready; `wireEmbedMode()`'s existing wind-load
  `.then()` branch checks for it and calls `runFlightSim` from there if
  both are ready by then (handles wind data arriving either before or
  after the (fast, local, no-network) cache restore completes).
- `runFlightSim`'s existing `if (embedState) void runEmbedMultiModelSim(rocket)`
  hook (line 1809) needs no changes — the new auto-run path reaches it the
  same way a normal motor pick does.
- `runEmbedMultiModelSim`: extend `buildAscentResultsMessage`'s call with
  the new optional `rocketConfig` field (Tier 2a), built via
  `buildOutboundRocketConfig` from whatever's currently cached.
- Visible "clear cached rocket / start over" control in the embed wind
  section, calling `clearCachedConfig()` — otherwise a restored config is
  sticky forever with no way to deliberately switch rockets mid-session.

**`src/ui/embed.ts` changes:** extend `buildAscentResultsMessage`'s return
type with an optional `rocketConfig?: object` field — additive, so existing
consumers (splashcast's current listener) are unaffected either way.

## Scope addition: sim-result caching (added mid-implementation, 2026-08-16)

While implementing the above, the user raised a second, related problem:
splashcast's own time slider lets a visitor scrub back and forth across a
launch day (e.g. check drift at 9am, then 11am, then back to 9am) — each
reopen of the ascent-sim modal is a fresh iframe load with a specific
`hour` baked into the URL (see `openAscentSimModal` in splashcast's
`app.js`). Tier 1 above makes the rocket+motor auto-restore on each reopen,
but the actual 6-model flight simulation was still being recomputed from
scratch every time, even when scrubbing back to an hour (and rocket/motor/
overrides) already simulated earlier in the same session — real, wasted
CPU for a byte-identical result.

**New module `src/ui/sim-result-cache.ts`**: a second, separate localStorage
cache (`rocketry:simResultCache:v1`), keyed by
`(forecastContentHash, hour, model, rocketFingerprint)` -> `AscentPath`.

- **Forecast content hash, not a manually-maintained version field**: the
  user's own initial framing suggested adding explicit
  location/date/time/forecast-date fields to "the forecast array." Went
  with a content hash of the raw fetched `windUrl` JSON text instead
  (`hashString`, FNV-1a) — strictly simpler (no schema change needed on
  splashcast's side at all) and more robust (a genuinely updated forecast
  automatically produces a different hash and correctly forces a rerun,
  with no risk of trusting a URL or date field that turns out not to have
  changed when the underlying content did). Computed once per wind fetch in
  `wireEmbedMode` (fetched as `.text()` specifically, not `.json()`, so the
  hash is over the exact bytes rather than a reserialized/potentially
  reordered copy) and stored on `embedState.windContentFingerprint`.
- **Rocket fingerprint**: `computeSimFingerprint(rocket)` hashes the
  `Rocket` object itself (minus `windProfile`, which is handled separately
  via hour+model+forecast hash) — deliberately the raw object, not a
  hand-picked field list, so it can't silently fall out of sync with
  whatever `simulateFlight3D` actually reads. Confirmed CP overrides
  correctly do NOT invalidate this (they're display-only, never part of
  `Rocket` — see `activeCpOverrideM`'s own doc comment in main.ts).
- **`runEmbedMultiModelSim`** now checks the cache per model before calling
  `simulateFlight3DInWorker`, and saves after a fresh compute. Cap of 60
  entries (~one full day's `wind_hours` x 6 models for one rocket/motor
  combo), oldest-first eviction — an `AscentPath` is ~15-20 KB serialized,
  so this stays well under a typical per-origin storage quota even
  alongside the separate rocket/motor cache.

**Verified for real** (Playwright, real browser, real live Hutto 8/15 T-1
forecast — `splash_zones_captured_2026-08-14.json`, the only capture on
file for that target date, same file used for Tier 1's own verification):
hour=9 fresh compute (with real UI interaction: library pick, motor search,
motor select) ~7.9s; reloading the SAME hour=9 (auto-restore, zero UI
interaction) ~577ms with byte-identical apogee altitudes across all 6
models, confirming a real cache hit rather than coincidental deterministic
re-computation; hour=11 (genuinely new, auto-restore only, no UI
interaction) ~2.6s with apogees that genuinely differ from hour=9 (no false
cache collision); scrubbing back to hour=9 a second time ~576ms again with
results matching the very first hour=9 run exactly. Also fixed a real bug
found during this verification: `selectLibraryEntry`'s own
`saveCurrentConfigToCache()` call (added for the normal live-editing flow)
was firing mid-restore, before the motor got reapplied, clobbering the
on-disk rocket/motor cache with a motor-less snapshot — fixed by
re-calling `saveCurrentConfigToCache()` once more at the end of
`restoreCachedConfigIfEmbedded`, after every piece is back in place.

## Tasks

- [x] `src/ui/rocket-cache.ts`: `CachedRocketConfig` type, `saveCachedConfig`/`loadCachedConfig`/`clearCachedConfig`, `buildOutboundRocketConfig`
- [x] `src/ui/rocket-cache.test.ts`: save/load/clear round-trip, version-mismatch -> null, malformed JSON -> null -- 10 tests
- [x] `src/ui/embed.ts`: add optional `rocketConfig` field to `buildAscentResultsMessage`'s envelope
- [x] `src/ui/embed.test.ts`: extend envelope tests for the new optional field -- 15 tests total
- [x] `main.ts`: `saveCurrentConfigToCache()` + wire into applyParsedRocket call sites, selectMotor, and the 4 override edit handlers
- [x] `main.ts`: `restoreCachedConfigIfEmbedded()` + bootstrap wiring + wind-load sequencing for auto-run
- [x] `main.ts`: "clear cached rocket / start over" control in the embed wind section
- [x] `src/ui/sim-result-cache.ts` + `.test.ts` (scope addition, see above) -- 10 tests
- [x] `main.ts`: `computeSimFingerprint`, cache-check/save in `runEmbedMultiModelSim`, `windContentFingerprint` on `EmbedState`
- [x] `npx tsc --noEmit` + full `npx vitest run` -- 657 passed, 31 files
- [x] Real-browser Playwright acceptance test against real live Hutto 8/15
      T-1 forecast data: fresh load -> pick rocket+motor -> capture result;
      reload same embed URL -> auto-restore + auto-run with zero UI
      interaction, rocketConfig label correct, sim-result cache hit
      (byte-identical apogees, ~577ms vs. ~7.9s); reload with a different
      hour -> genuinely new computation (different apogees, no false cache
      hit); reload back to the original hour -> cache hit again (the
      scrub-back scenario); "clear cached config" confirmed to actually
      clear it (a further reload shows the empty state again)
- [x] Commit + push + verify live on GitHub Pages

## Decisions

- Scope explicitly limited to Tier 1 + Tier 2(a) (see "Approved scope for
  this pass" above) -- Tier 2(b) (inbound URL-param restore) and any
  splashcast-side round-trip work are deferred, not rejected.
- Cache restore is gated to **embed mode only** for this pass -- not
  extended to normal (non-embed) browsing, to avoid ambiguity with the
  existing `?rocket=` URL-param auto-load mechanism in normal mode.
- Sim-result caching (added mid-implementation, see its own section above)
  uses a forecast CONTENT hash rather than the user's own initially
  proposed explicit location/date/time/forecast-date fields -- a
  deliberate substitution, not an oversight: strictly simpler (zero
  splashcast-side schema change needed) and more robust (automatically
  correct on any real content change, no manually-maintained version field
  to keep in sync). Flagged to the user as part of this work.

## Open questions

- None blocking. Tier 2(b) + splashcast-side work: revisit once there's a
  concrete reason to want cross-device/session persistence or a
  splashcast-visible "current rocket" indicator.
