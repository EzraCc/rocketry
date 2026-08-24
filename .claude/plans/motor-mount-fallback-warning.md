Status: done
Priority: medium
Type: bug-fix
Last updated: 2026-08-24

# Warn when no motor mount is flagged in the source file (silent fallback today)

## Context

Surfaced while investigating Wildman Junior: user reported that BOTH real
OpenRocket and RockSim error/warn on that file, saying nothing is flagged
as a motor mount — asked whether OUR parser also reads zero for it.

Checked directly: no, it doesn't. Both `parseRocksimXml` and `parseOrkXml`
find 2 structural components flagged `isMotorMount` for Wildman Junior (a
forward "Engine Mount" tube and an aft tube containing a nested adapter
sleeve) — our raw-flag-based detection isn't hitting the same "nothing
flagged" outcome the real tools apparently do (likely some conflicting/
overlapping-flag invalidation logic in RockSim/OpenRocket's own code,
never confirmed further — Wildman Junior itself was separately dropped as
a test case per the user's own call, since it errors in the real tools
too and isn't a reliable benchmark).

That said, the underlying ask (warn when a file has genuinely ZERO
motor-mount flags anywhere, rather than silently assuming) is real and
well-justified independent of Wildman Junior: `applyParsedRocket`
(`src/main.ts`) already had a silent fallback --
`bodyComponents[bodyComponents.length - 1]` -- for exactly this case, with
no warning shown. A direct scan of this project's own 339-file vendored
`.rkt` library found **27 files (~8%) already hit this fallback silently**,
including "Bull Puppy 2.2 Rocket Kit.rkt", one of the three files used
earlier this session as a "clean, fully supported" `.rkt`-vs-`.ork` cross-
check case -- its own motor mount diameter had been coming from an
unflagged assumption the whole time, correctly as it turns out, but with
nothing telling the user that was happening.

## Tasks

- [x] Confirmed Wildman Junior isn't a "we also read zero" case -- both
      parsers find 2 flagged components, not 0.
- [x] Scanned the full 339-file `.rkt` library directly: 27 files have zero
      `isMotorMount` components and rely on the silent last-body-component
      fallback.
- [x] Added the warning in `applyParsedRocket` (the single shared entry
      point for both the file-upload and library-select paths, and both
      `.rkt`/`.ork` formats) -- widened its `parsed` parameter type to
      include `warnings: string[]` and pushes onto it directly when
      `motorMountComponent` is undefined but a fallback exists: `No motor
      mount was flagged in this file -- assuming "<name>" (the aftmost body
      component) is the motor mount.` Kept the existing fallback behavior
      unchanged (still assumes the aftmost body component) -- just makes it
      visible instead of silent.
- [x] Verified directly: Bull Puppy 2.2 (zero flags) triggers the
      fallback+warning condition (aftmost component is actually a
      Transition, not a BodyTube, in that file -- confirmed the warning
      logic is correctly type-agnostic); Striker Rocket (has a real flag)
      does not.
- [x] Full suite green: 32 files / 673 tests, `tsc --noEmit` clean. (No
      new automated test added for the warning text itself --
      `applyParsedRocket`/`main.ts` is untested UI glue per this project's
      existing convention; verified via a throwaway script instead, same
      as the underlying fallback logic's own lack of direct test coverage.)

## Decisions

- Kept the fallback ASSUMPTION itself unchanged (aftmost body component is
  virtually always right for a real rocket) -- this is purely a visibility
  fix, not a behavior change. Reverted, separately, an earlier attempt at
  making the underlying cluster/multi-position DETECTION smarter for
  Wildman Junior specifically -- dropped per the user's own call once real
  OpenRocket/RockSim were confirmed to also error on that file, making it
  an unreliable file to design detection logic around.

## Detours

Branched off from the RockSim-vs-`.ork` cross-check work
(`ork-dry-mass-extraction.md`'s follow-up investigation) once Wildman
Junior's real-tool error came up. Not itself part of that plan's original
scope, tracked separately since it applies uniformly to both formats and
isn't really about dry mass.

## Open questions

None.
