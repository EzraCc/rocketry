Status: paused
Priority: medium
Type: research
Last updated: 2026-08-20

# Boattail steepness/minimum-taper-length validation

## Context

Surfaced 2026-08-19 while discussing `rasaero-transonic-physics.md`'s
NACA-RM-E51C06 finding (rocketry's ported `boattailPressureCd()` under-
predicts drag for *gentle* boattails, fineness ≥3). The user separately
recalled that OpenRocket has a different, unaddressed hole in the same
area: no validation or warning for a boattail that's too *steep* — no
minimum-length-per-diameter-reduction check, unlike the flow-separation
risk a real steep taper would carry. Confirmed directly against the
OpenRocket source (`Warning.java`, `Transition.java`,
`SymmetricComponentCalc.java`): no such warning type exists. The closest
existing warning, `DIAMETER_DISCONTINUITY`, only fires for a hard radius
*step* between components with no taper at all — a different, more
extreme case than a steep-but-continuous taper. Checked GitHub for an
existing OpenRocket issue on this specifically — found #2200 ("Support
boattails"), which is an unrelated component-modeling feature request
(nesting a boattail inside an adjacent stage), not this gap.

This is a genuinely separate question from `rasaero-transonic-physics.md`
(geometry validation / missing warning, not drag-formula accuracy for an
already-reasonable geometry) — tracked as its own plan file rather than
folded into that one, per this project's one-file-per-topic convention.

## Tasks

- [x] Chase down the "Payne correlation" (NSWC TR-81-156), the boattail-
      drag source named but not equationed in Missile DATCOM's own Volume
      I (from the now-deleted `missile-datcom-manual.md` research) —
      **excluded**, not read. Found via general web search (title/authors/
      date only, never the document itself) that it's titled "Aerodynamic
      Design Manual for Tactical Weapons" (Mason, Devan, Moore, McMillan;
      NSWC, July 1981) — categorically the same kind of document as the
      excluded Missile DATCOM. Flagged to the user rather than deciding
      unilaterally; user chose exclusion, same reasoning as the Missile
      DATCOM call (2026-08-18): developed specifically for tactical-
      weapons aerodynamic prediction, decisive regardless of ITAR/
      distribution status, which was not even checked.
- [x] Fresh NTRS search for boattail steepness / minimum-taper-length /
      flow-separation criteria, from clean (non-tactical-weapons-specific)
      NACA/NASA sources. Three candidates found, each individually
      verified public domain: **NASA TP-1070** (Wilmoth, 1977 — transonic
      boattail separation model, framed around a "separation location and
      turning angle" — best conceptual match, not yet read beyond its
      abstract), **NASA TN D-6789** (Compton, 1972 — jet-off drag data for
      boattail angles 3°/5°/10° at three length/diameter ratios, Mach
      1.83/2.20 — a real if sparse angle-vs-drag grid), **NASA TM X-3109**
      (Rom & Bober, 1974 — lower priority, subsonic-only, documented
      convergence issues) — `research/candidates/boattail-steepness-ntrs-search.md`
- [x] Read NASA TP-1070 (Wilmoth, 1977) in full — real and on-topic, but
      complicates rather than resolves the question. Boattails tested are
      circular-arc profiles (not straight cones like rocketry's own
      taper model), validated only subsonic/transonic (M∞≤0.96, never
      supersonic), and its own headline result (Figure 4) shows separation
      angle vs. boattail chord angle is Mach- and geometry-coupled, not a
      single threshold — steepest-tested config (17°) was NOT the worst by
      this metric. Names two more specific prior criteria (Presz 1974 PhD
      thesis; Page 1961 book chapter) neither of which is NASA/NACA-hosted
      or accessed in this pass — a different, unresolved access question,
      not the tactical-weapons category concern that excluded Payne/NSWC —
      `research/candidates/nasa-tp-1070.md`
- [ ] Report findings to user, get direction on next steps.

**Paused 2026-08-20**: user is stepping away to work on other things.
Nothing further started beyond what's checked above. Resume by re-reading
this file in full, then TP-1070's own candidate doc for the Presz/Page
access question before deciding whether to chase either, or pivot to
Compton's TN D-6789 instead.

## Decisions

- **NSWC TR-81-156 excluded (2026-08-20)**, same reasoning as Missile
  DATCOM's documentation exclusion — see `REFERENCES.md`'s "Explicitly
  excluded" section for the durable record.

## Open questions

- Whether a genuine minimum-taper-length/separation criterion exists in
  the clean (non-tactical-weapons) NACA/NASA literature at all, or whether
  this ends up another negative finding like NACA-TN-2858 — not yet known,
  pending the fresh search.
