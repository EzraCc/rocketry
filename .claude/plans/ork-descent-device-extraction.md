Status: done
Priority: high
Type: bug-fix
Last updated: 2026-08-24

# .ork import never extracted recovery devices (splashcast never saw dual/single-deploy changes)

## Context

User asked: after sending a Callisto file (single-deploy) to splashcast,
they didn't see the parachute config change from dual to single deploy, or
the descent rates update — was that finished and committed, or waiting on
splashcast's side?

Traced it: NOT waiting on splashcast. `git log` confirms "Send drogue/main
descent rate to splashcast" (`aae108f`, 2026-08-16) is committed and
already on `origin/main` — that part of the pipeline is real and live. The
actual gap is upstream of it: `src/formats/ork/parse.ts` never extracted
recovery devices at all. `descentDevices` extraction (`extractDescentDevices`)
only ever existed in `src/formats/rocksim/parse.ts` (.rkt files);
`ParsedOrkRocket` had no `descentDevices` field, so
`applyParsedRocket`'s `activeDescentDevices = parsed.descentDevices ?? []`
silently fell to `[]` for every `.ork` upload — the exact same class of gap
as the motor-mount-diameter bug fixed earlier this session
(`ork-motor-import-fixes.md`), just for a different field. splashcast
receiving an empty list (rather than an updated single-device payload)
would explain it not visibly changing from a previously-sent dual-deploy
config.

## Tasks

- [x] Confirmed via `git log`/`git show` that the descent-rate-to-splashcast
      commit is real, committed, and already on `origin/main` — not the
      source of the gap.
- [x] Confirmed via source read that `.ork` parsing had no descent-device
      extraction of any kind (RockSim-only).
- [x] Checked OpenRocket's own saver source (read-only reference, in the
      sibling `openrocket` repo, never edited) for the real .ork schema:
      `ParachuteSaver.java`/`StreamerSaver.java`/`RecoveryDeviceSaver.java`
      — confirmed `<diameter>`/`<cd>` (parachute, no spill-hole concept,
      unlike RockSim's format), `<striplength>`/`<stripwidth>` (streamer),
      and critically an explicit `<isdrogue>true</isdrogue>` flag written
      whenever a device is flagged as the drogue — better than RockSim's
      own format, which has no such flag and forces
      `extractDescentDevices` (rocksim) to guess from the part's name.
- [x] Implemented `extractDescentDevices` in `src/formats/ork/parse.ts`:
      reads the explicit `<isdrogue>` flag first, falls back to RockSim
      parser's same size-based heuristic (smallest of multiple = drogue)
      only for files where no device has the flag set at all. Added
      `descentDevices: DescentDevice[]` to `ParsedOrkRocket` (shares the
      `DescentDevice` type already defined in `rocksim/parse.ts`, same
      convention `motorMountDiameterM` follows).
- [x] Wired into `parseOrkXml`'s return value, scoped to the imported
      (sustainer) stage only, matching this project's existing
      single-stage-only .ork scope.
- [x] New tests in `src/formats/ork/parse.test.ts`: Callisto (single
      parachute, explicit `<cd>1.55</cd>`, no `<isdrogue>` -> "main",
      correct drag area) and "A simple model rocket.ork" (`<cd>auto</cd>`
      -> falls back to the 0.8 default). 8/8 passing.
- [x] Full suite green: 32 files / 671 tests, `tsc --noEmit` clean.

## Decisions

- No dual-deploy `.ork` fixture existed in the repo to test the
  `<isdrogue>` branch directly (all three vendored `sim-files/ork/` example
  rockets and the user's own Callisto file are single-deploy) — the
  `<isdrogue>` handling itself is grounded directly in OpenRocket's own
  saver source (quoted/cited above), not just inferred from a file, so
  this wasn't blocked on finding one, but flagged here as a real testing
  gap: if a dual-deploy `.ork` fixture becomes available later, add a test
  exercising the explicit-flag path (not just the size-heuristic fallback,
  which the RockSim-side tests already cover).

## Detours

None — this session's earlier `ork-motor-import-fixes.md` work directly
motivated checking .ork parsing for other RockSim-only gaps once this
question came up, but wasn't itself a detour from anything active.

## Open questions

- Not yet verified end-to-end against a live splashcast embed session (only
  unit/fixture-level). Worth the user re-testing: upload a dual-deploy
  .ork, send to splashcast, confirm it now shows two devices; then upload
  Callisto (single-deploy) and confirm it updates to one.
