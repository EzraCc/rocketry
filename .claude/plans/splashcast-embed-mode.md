Status: done
Priority: high
Type: new-feature
Last updated: 2026-08-16

# rocketry "embed mode" for the splashcast integration

## Context

`splashcast` (sibling repo, `/home/ezrac/github/splashcast`) currently
approximates boost-phase weathercocking with a manual rail-angle dial. It
wants to replace that with a real ascent-path simulation from `rocketry`.
Both repos stay fully separate (no code sharing — rocketry is GPLv3, ports
OpenRocket's own algorithms; bundling that into splashcast would force a
license change). The integration is a **visible, interactive `<iframe>`**:
splashcast embeds rocketry's own existing UI, the visitor picks a real
rocket + motor there, and rocketry `postMessage`s the result back.

**Splashcast's own side is already fully built and committed** (confirmed by
reading `splashcast/site/assets/js/app.js` and `descent3d.js` directly — the
modal, iframe wiring, `postMessage` listener, and consumer rendering all
exist and are waiting). The task on this side is exactly what
`tmp/splashcast-integration.md` (and its more detailed twin,
`splashcast/.claude/plans/rocketry-flight-sim-integration.md`, read in full)
specifies: a new "embed mode" gated behind a URL flag on the existing
single-page app.

## Verified against current code (not just the spec's prose)

- `src/lib.ts`'s `AscentResult` (`rocketName`, `parseWarnings`, `stability`,
  `flight`, `ascentPath`) and `src/physics/sim/ascent-path.ts`'s `AscentPath`
  (`waypoints`/`path`/`segments`/`windShear`) field shapes match the spec's
  JSON envelope exactly, field-for-field.
- `parseSplashcastWindData()` (`src/physics/wind/splashcast-import.ts`) is
  unchanged and ready — parses the exact splashcast JSON shape already.
- **One real discrepancy found and resolved**: the spec's example JSON shows
  `stability: { marginCalibers: 1.5, ... }`, but `StabilityCheck` (`src/
  physics/aero/stability-check.ts`) actually has a field named `margin`, not
  `marginCalibers`. Checked splashcast's own consumer code directly
  (`descent3d.js`) — it only ever reads `stability.warnings`, never touches
  the margin field by any name. **Resolution: pass `StabilityCheck` through
  as-is (`margin`), matching the spec's own controlling instruction ("no new
  fields to invent, just wrap the existing result") over its illustrative
  example JSON.** No compatibility risk either way, confirmed by evidence,
  not assumption.
- `runFlightSim(rocket)` (`src/main.ts`) is the right hook point: on success
  it sets `lastFlightResult`/`lastFlightRocket`; on failure it already has a
  catch block. Both need an embed-mode branch added.
- `windSectionHtml`'s existing copy (`src/main.ts` ~line 1967) says wind will
  come "through this tool's library API" — stale now that the design is an
  iframe, not a `src/lib.ts` API consumer. Small copy fix while in there.
- `buildAscentPath` is not currently imported into `main.ts` — needs adding.

## Design

**New small module: `src/ui/embed.ts`** (pure logic, unit-testable, matching
this project's convention of keeping `main.ts` as DOM/orchestration glue and
pure logic in dedicated modules):
- `parseEmbedParams(search: URLSearchParams): EmbedParams | null` — reads
  `embed`/`windUrl`/`hour`/`parentOrigin`; returns `null` if `embed` isn't
  `"1"` (normal mode). If `embed=1` but `windUrl`/`hour`/`parentOrigin` is
  missing or `hour` isn't a valid integer, that's a config error with no
  reliable postMessage target in the missing-`parentOrigin` case — render an
  inline error, don't attempt `postMessage`. If `parentOrigin` IS present but
  something else is missing/malformed, post an error to it rather than
  silently falling back to normal mode.
- `buildAscentResultMessage(rocketName, parseWarnings, stability, ascentPath): object`
  — assembles `{type: "rocketry:ascentResult", ...}` exactly, one place so
  the envelope shape can't drift between call sites.
- `buildErrorMessage(message: string): object` — `{type: "rocketry:error", message}`.

**`src/main.ts` changes:**
- At bootstrap (alongside the existing `URLSearchParams(location.search)`
  handling near the end of the file), call `parseEmbedParams`. If non-null,
  enter embed mode: `fetch(windUrl)` → `parseSplashcastWindData()` →
  `.modelsForHour(hour)`. Any failure at any of these three steps →
  `postMessage(buildErrorMessage(...), parentOrigin)` + inline error state,
  matching spec item 1/2.
- Render a model picker (radio buttons, reusing existing form styling) from
  the resolved model list. Selecting one calls `.profileFor(hour, model)` and
  sets it as the active wind profile for the existing simulate flow — same
  role `activeWindProfile` already plays for manual wind, so the simplest
  correct wiring is to set `activeWindProfile` directly from the embed
  picker instead of `wireWindImport`'s manual-entry path.
- In embed mode, don't render the manual constant-speed/direction fields
  (`windSectionHtml`'s `#wind-manual-speed`/`#wind-manual-direction`/
  `#wind-manual-apply`) at all — swap in the model-picker markup instead, in
  the same `<article>` slot. Rocket-library browsing/upload and motor search
  UI are untouched (spec item 4 — already correct if left alone).
- In `runFlightSim`'s success branch (after `lastFlightResult = result`), in
  embed mode: build the `AscentPath` (`buildAscentPath(result, rocket)`) and
  `StabilityCheck` (same `computeBarrowman` + `checkStability` + liftoff-CG
  pattern `renderFlightResultHtml` already uses, so the posted margin/
  warnings match what the UI itself would show), wrap with
  `buildAscentResultMessage`, and `postMessage` to `parentOrigin` —
  regardless of `stability.flyable` (spec item 5, explicit). Wrap this
  post-success step in its own try/catch — if `buildAscentPath` itself
  throws, post an error instead of leaving the promise's success path to
  silently fail.
- In `runFlightSim`'s existing catch branch, in embed mode: also
  `postMessage(buildErrorMessage(...), parentOrigin)` alongside the existing
  inline error render (spec item 6).
- Fix `windSectionHtml`'s stale "library API" sentence.

## Tasks

- [x] `src/ui/embed.ts`: `parseEmbedParams`, `buildAscentResultMessage`, `buildErrorMessage`
- [x] `src/ui/embed.test.ts`: unit tests for the above (param edge cases, envelope shape) -- 11 passing
- [x] `main.ts`: bootstrap embed-mode detection + wind fetch/parse/model-list flow
- [x] `main.ts`: model-picker UI, wired to `activeWindProfile`, replacing manual wind fields in embed mode
- [x] `main.ts`: `runFlightSim` success-path `postMessage` hook (with its own try/catch)
- [x] `main.ts`: `runFlightSim` catch-path `postMessage` hook
- [x] Fix stale `windSectionHtml` copy
- [x] Manual acceptance test (real browser via Playwright, real live splashcast JSON URL, message
      listener) — success case: wind loads, 6-model picker populates (GFS/ECMWF/GEM/ICON/ARPEGE/
      HRRR), model selection updates active wind, a real LOC-IV X2 + AeroTech motor pick runs a sim
      and posts a well-formed `rocketry:ascentResult` (verified full payload shape, including
      `stability.margin` -- not `marginCalibers` -- matches). Error cases: bad windUrl (404), bad
      hour (not in data), and missing `parentOrigin` (inline error only, confirmed NO postMessage
      attempted) all behave exactly as designed.
- [x] Commit, push, verify live on GitHub Pages against production splashcast --
      `https://ezracc.github.io/rocketry/?embed=1&windUrl=...&hour=13&parentOrigin=
      https://ezracc.github.io` confirmed live: wind loads, 6-model picker populates,
      identical to local dev verification.

## Verification

- `npx tsc --noEmit` + `npx vitest run`.
- **The spec's own acceptance test, run for real, not just described**:
  `npm run dev`, load `http://localhost:5173/?embed=1&windUrl=<a real,
  currently-published splashcast JSON URL>&hour=13&parentOrigin=
  http://localhost:8000` in a real browser (Playwright, matching this
  session's established pattern for verifying UI work), with a
  `window.addEventListener('message', ...)` listener registered to capture
  what's posted. Confirm: wind loads, model picker populates, a real
  rocket+motor selection runs a simulation, and a well-formed
  `rocketry:ascentResult` is captured — then deliberately force a bad
  `windUrl`/`hour` and confirm a well-formed `rocketry:error` instead.
- Real splashcast JSON URL to test against:
  `https://ezracc.github.io/splashcast/data/hutto/live/2026-08-15/splash_zones_captured_2026-08-14.json`
  (check `https://ezracc.github.io/splashcast/data/<site>/manifest.json` if
  this one has aged out by the time this is implemented).
- After verification: commit on rocketry's `main` (this repo already has
  CI/CD wired to GitHub Pages, so a push deploys automatically — confirm the
  live embed URL works against production splashcast too, not just local
  dev, before considering this done).

## Open questions

- None currently — spec is fully verified against both sides' actual code,
  the one real discrepancy (`marginCalibers` vs `margin`) is resolved by
  evidence (splashcast's consumer never reads that field either way).
