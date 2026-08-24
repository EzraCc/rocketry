Status: done
Priority: high
Type: bug-fix
Last updated: 2026-08-24

# .ork motor import: mount diameter, designation, manufacturer, stale state

## Context

User reported four bugs while testing `sim-files/misc/PML_Callisto.ork` (a
real 38mm-motor-in-a-54mm-airframe dual-deploy rocket, motor Cesaroni
247H143-13A):

1. Motor search returns 0 results for a motor that's actually loaded in the
   file — the diameter filter was using the airframe's outer diameter, not
   the actual mount tube's.
2. CTI's designation format (`247H143-13A` = total impulse + class + avg
   thrust + delay + adjustable flag, all packed together) was passed
   straight through to ThrustCurve.org's commonName field, which wants just
   `H143`.
3. Manufacturer prefill ("AT"/"CTI"-style abbreviations, or a file's own
   full name like "Cesaroni Technology") wasn't mapped to ThrustCurve.org's
   own abbrev values used by the `<select>`, so it silently failed to
   select anything.
4. Loading a new rocket (file upload or library pick) didn't clear the
   previously-selected motor — its mass kept getting added into the new
   rocket's loaded-mass figure. Reported on mobile (stale "Big Nuke 3E"
   motor mass surviving a Callisto upload) and, in a related but distinct
   form, on desktop (reloading the same file after picking a motor).

## Tasks

- [x] Fix #1: `src/formats/ork/parse.ts` — added `extractMotorMountDiameterM`,
      which finds whichever element has a direct `<motormount>` child
      (usually a nested `<innertube>`, not the outer `<bodytube>`
      `hasMotorMount`'s deep search flags) and computes ITS OWN inner
      diameter (outer radius − thickness). Returned as `motorMountDiameterM`
      on `ParsedOrkRocket`, same field name/units `parseRocksimXml` already
      uses for `.rkt` files, so `main.ts`'s `applyParsedRocket` picks it up
      with no further change beyond a stale comment fix.
- [x] Fix #2: `src/main.ts` — added `normalizeMotorDesignation()`, strips
      the trailing `-<delay><flags>` suffix and then a leading run of
      digits immediately before a letter (CTI's total-impulse prefix) — a
      general heuristic, not CTI-specific, verified harmless on AeroTech/
      Estes/fractional-class designations too.
- [x] Fix #3: `src/main.ts` — added `resolveManufacturerAbbrev()` (checks a
      small hardcoded alias table for spellings ThrustCurve.org's own
      metadata doesn't cover at all — the user's own "AT"/"CTI" examples —
      then falls back to matching the live-fetched manufacturer list by
      exact name/abbrev, then substring). `motorManufacturersMeta` module
      state populated once in `loadMotorMetadata`.
- [x] Fix #4: `src/main.ts`'s `applyParsedRocket` — resets
      `lastMotorSelection = null` and clears the stale `#motor-detail`
      panel FIRST, before applying any of the new rocket's own data. Single
      shared entry point for both the file-upload and library-select paths,
      so both get the fix uniformly.
- [x] New fixture test: `src/formats/ork/parse.test.ts`, using the user's
      own `sim-files/misc/PML_Callisto.ork` directly (not copied into the
      `sim-files/ork/` OpenRocket-example-rockets fixture dir) — confirms
      `motorMountDiameterM` resolves to ~38.6mm, not the ~57.8mm outer
      airframe.
- [x] Full suite green: `vitest run` — 32 files / 669 tests passing,
      including the new fixture test. `tsc --noEmit` clean.

## Decisions

- Designation-stripping regex is deliberately general (not gated on
  manufacturer) — verified against AeroTech ("J350W-14A" → "J350W"), Estes
  ("C6-5" → "C6"), and fractional-class ("1/4A3-3T" → "1/4A3") designations
  as well as CTI's, since ThrustCurve.org's commonName convention (no
  hyphen, no leading total-impulse digits) is manufacturer-independent.
- Manufacturer resolution uses the live-fetched ThrustCurve.org metadata
  list (name+abbrev pairs) as its primary source rather than a large
  hardcoded thesaurus — only the two spellings the user explicitly named
  ("AT", "CTI") that AREN'T themselves valid ThrustCurve.org abbrevs get a
  hardcoded alias entry. Keeps the mapping correct for every manufacturer
  ThrustCurve.org actually has, not just the ones anticipated in advance.
- `applyParsedRocket`'s reset also clears the `#motor-detail` DOM panel
  (not just the `lastMotorSelection` variable) — same root cause (a motor
  selection tied to the PREVIOUS rocket left visible/active after switching)
  and cheap to fix alongside it. Deliberately did NOT reset the motor
  search filter fields (manufacturer/diameter/commonName selects) or
  `currentResults` — no evidence those cause an actual wrong-number bug
  the way the stale mass and stale detail panel do, and a library-load
  that clobbered a user's in-progress manual search filters would be an
  unrequested behavior change.

## Detours

None.

## Open questions

None outstanding — user has not yet re-tested in the browser; flagged to
them that a UI smoke-test (upload Callisto, confirm search finds
247H143-13A, confirm loaded mass reflects only Callisto + whatever motor is
picked) is still worth doing even though the unit/fixture tests pass.
