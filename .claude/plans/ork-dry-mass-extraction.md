Status: done
Priority: high
Type: bug-fix
Last updated: 2026-08-24

# .ork import never computed dry mass (Callisto showed 1.76oz vs OpenRocket's 36.6oz)

## Context

User reported: loading Callisto showed dry mass 1.76oz; OpenRocket itself
reports 36.6oz dry for the same file. Noted the file has mass overrides on
individual components, not one single total-mass field, and asked what was
happening.

Traced it: 1.76oz = 0.05kg exactly (`applyParsedRocket`'s hardcoded
placeholder dry mass, converted to oz) — `.ork` parsing never computed
`estimatedDryMassKg` at ALL (no such field even existed on
`ParsedOrkRocket`), so every `.ork` upload silently fell back to the
generic 50g placeholder regardless of what mass data the file actually
carried. Same root-cause shape as the two bugs fixed earlier this session
(`ork-motor-import-fixes.md`, `ork-descent-device-extraction.md`): a field
`parseRocksimXml` (.rkt) computes that `parseOrkXml` (.ork) never did.

Checked the actual file: it DOES carry a single effective total-mass
override, just not where the user expected it — the `<stage>` element
itself has `<overridemass>1.0375925454600001</overridemass>` +
`<overridesubcomponentsmass>true</overridesubcomponentsmass>` (1.0375925454600001
kg = 36.5999... oz, matching OpenRocket's own reading almost to the decimal).
The per-component overrides the user noticed (nose cone, shock cord,
parachute) are real but moot for the total — OpenRocket's own
`getSectionMass()` semantics (read directly from
`RocketComponent.java`, the sibling `openrocket` repo, read-only reference
only) short-circuit at the first `overridesubcomponentsmass=true` found
walking down from the stage, never even inspecting the components below it.

## Tasks

- [x] Read `RocketComponent.java`'s `getMass()`/`getSectionMass()` (upstream
      OpenRocket source, reference only, never edited) to get the override
      semantics exactly right: `overridemass` replaces a component's own
      contribution; `overridesubcomponentsmass=true` additionally replaces
      the WHOLE subtree total, without recursing into children at all.
- [x] Confirmed via `RocketComponentSaver.java` that `<overridemass>`/
      `<overridesubcomponentsmass>` are only ever written when the override
      is actually active — their presence alone is the "is this overridden"
      signal, no separate enabled flag.
- [x] Confirmed via `MassComponentSaver.java` vs. `NoseConeSaver`/
      `TransitionSaver`/`BodyTubeSaver`/the ring savers/`ParachuteSaver`/
      `StreamerSaver`/`ShockCordSaver` that ONLY `<masscomponent>` carries an
      unconditional `<mass>` tag — every shaped component's mass is
      recomputed live by OpenRocket from material density x shape volume on
      every load, never cached in the file. Reproducing that (a distinct
      volume integral per nosecone/transition shape, plus tube/ring/canopy
      formulas) is NOT implemented here — scoped out as a real, flagged gap
      rather than attempted partially.
- [x] Implemented `computeSectionMassKg` in `src/formats/ork/parse.ts`:
      recursive walk from the imported stage, matching
      `getMass()`/`getSectionMass()` exactly, treating `<stage>` as a
      zero-mass grouping node and `<podset>`/`<parallelstage>` as
      out-of-scope (same single-stage exclusion `walkStage`'s own geometry
      parsing already applies). Returns `{massKg, fullyAccounted,
      unknownNames}` — `fullyAccounted` is false if ANY un-overridden shaped
      component is reached, since an undercounted-but-plausible-looking
      dry mass is worse than none for something stability/safety-relevant.
- [x] `ParsedOrkRocket.estimatedDryMassKg` set only when fully accounted;
      otherwise left undefined (falls back to the existing 50g placeholder,
      same as before this fix for files this doesn't help) with a new
      explicit warning naming which components couldn't be accounted for.
- [x] New tests in `src/formats/ork/parse.test.ts`: Callisto resolves to
      1.0375925454600001 kg (36.6oz) with no dry-mass warning; "A simple
      model rocket.ork" (no stage-level override) stays undefined with an
      explanatory warning. Updated that fixture's own pre-existing "no
      warnings expected" assertion, since it now correctly gets one.
- [x] Full suite green: 32 files / 673 tests, `tsc --noEmit` clean.

## Decisions

- Deliberately did NOT implement shape+material volume-based mass
  computation for nosecone/bodytube/transition/finset/rings/canopies in
  this pass — real scope (OpenRocket's own `MassCalculator` implements a
  distinct volume integral per nosecone shape type alone), and unnecessary
  for the reported bug, which a file WITH adequate overrides (this one)
  doesn't need at all. Flagged as a real future improvement if a common
  real-world file turns out to rely on OpenRocket's live shape calc with NO
  overrides anywhere — those files still fall back to the pre-existing 50g
  placeholder (no regression, just no improvement) until that's built.
- `fullyAccounted` is strict (all-or-nothing) rather than "best effort" —
  a partial sum that silently omits an unmeasured nosecone would look like
  a real number while actually being a dangerous undercount for stability
  margin/flight-sim purposes. Matches this project's existing "CG is never
  guessed" philosophy, applied the same way to mass.

## Detours

None — direct continuation of this session's `.ork`-import-gap thread,
found by checking mass computation the same way the mount-diameter and
descent-device gaps were found (compare what parseRocksimXml computes vs.
what parseOrkXml does for the same field).

## Open questions

None outstanding for the reported bug. Not yet verified live in the browser
by the user (only unit/fixture-level) — pending redeploy + re-test.
