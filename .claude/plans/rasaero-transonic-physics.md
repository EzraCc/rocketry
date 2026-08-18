Status: research phase done, awaiting direction on implementation
Priority: medium
Type: research
Last updated: 2026-08-18

# RASAero-informed transonic/supersonic physics: research findings + reference-tracking infrastructure

## Context

Since the GPLv3 relicense, `rocketry` has been directly porting OpenRocket's
own published algorithms (fin CNa1/CP-shift through transonic/supersonic,
Galejs body lift, Mach friction correction) rather than independently
re-deriving everything. The user asked whether the same approach could
extend to RASAero — a widely-respected rocket aerodynamics tool known for
strong transonic/supersonic/hypersonic predictions — and specifically
whether its underlying datasets are public, whether we have (or can
compile) enough information to add this physics, whether we can copy data
into the library or must reference it externally, and asked for a durable
reference list of every external source used project-wide, including reuse
permissions, as the project extends beyond what it's ported from OpenRocket.

That last point surfaced a real, independent gap: **no such reference list
exists today.** DEVIATIONS.md cites OpenRocket sources inline per-formula
(file:line, exact quotes) — that convention works well and stays as-is — but
there is no project-wide index of external data sources and their licensing
status. The 339 vendor `.rkt` library files, ThrustCurve.org's API, and every
NACA/NASA report already cited inline (e.g. NACA Report 1307 in fin-calc.ts)
have no consolidated attribution/permissions record anywhere.

**Parked 2026-08-15**: the user needed to work on splashcast integration
first (see `splashcast-embed-mode.md`). Nothing below is started; resume by
re-reading this file in full.

## Key research findings

**RASAero itself cannot be "ported."** It's closed-source freeware (Rogers
Aeroscience / Charles E. Rogers). Its own methodology paper (Rogers & Cooper,
2011, read in full) never discloses the actual transonic/supersonic/
hypersonic formulas — it describes *what effects* are captured (fin sweep,
airfoil shape, nose/fin bluntness, forward CP shift at high Mach, launch-lug
drag) and *what data* it was calibrated against (NACA/NASA wind tunnel data,
"published professional aerodynamic data for missiles," unnamed "professional
engineering method aerodynamic analysis programs"), but not the math itself.
There is no source code, published formula set, or API to draw from — nothing
analogous to OpenRocket's GPLv3 repo. Its own validation-data citations
(e.g. a 1961 Vought Astronautics report, a 1960 Aerojet-General wind tunnel
report) are old contractor documents, not publicly available.

**Missile DATCOM: REVISED 2026-08-17, then EXCLUDED AGAIN 2026-08-18 —
final state: fully excluded, software and documentation both.** (Jump to
the bottom of this subsection for the final decision if you just need the
current state — the history is kept below since it's genuinely
instructive: an accurate ITAR finding does not automatically mean a
source is in scope.) The original 2026-08-15 finding below (kept for
history, now superseded) was based on general secondhand
characterizations, not the primary documents themselves. On 2026-08-17
the user asked for real research into the actual government stance, since
it seemed strange for a genuinely ITAR-controlled paper to be published
with usable formulas intact. Fetched primary DTIC documents directly (via archive.org's
full-text mirrors of the same DTIC accession numbers — apps.dtic.mil
itself blocks automated fetches, a generic bot-block, not evidence of
restriction; archive.org hosting the identical text openly for years is
itself corroborating evidence it isn't access-controlled):

- **AD-A211086** ("Missile Datcom, Volume I — Final Report," AFWAL-TR-86-
  3091, 1988): Report Documentation Page states verbatim **"Approved for
  public release; distribution unlimited"** and **"has been reviewed by
  the Office of Public Affairs (ASD/PA) and is releasable to the National
  Technical Information Service (NTIS)... At NTIS, it will be available
  to the general public, including foreign nations."** No ITAR/EAR/DoD-
  5230.25 warning anywhere in the front matter.
- **AD-A237817** ("Missile Datcom User's Manual, Rev 4/91"): identical
  language, same NTIS/"including foreign nations" statement, no export
  legend. The same "distribution unlimited" statement recurs across every
  revision found on DTIC from 1988 through the 2014 revision (AD1000581)
  — a sustained, repeated public-release determination across 25+ years,
  not a one-off oversight.
- Volume I is a methods-selection justification document (some formulas,
  not a complete equation set); **Volume II (User's Manual) is where the
  actual detailed equations/implementation guidance live** — and carries
  the same public-release statement.
- The government's own position genuinely distinguishes the SOFTWARE
  (still restricted — distributed only directly by AFRL to vetted,
  ITAR-certified U.S. entities; this part is unchanged and rocketry was
  never going to use compiled DATCOM code anyway, same as every other
  source here — always independently reimplemented) from the
  DOCUMENTATION (explicitly, repeatedly cleared for public release,
  including to foreign nationals). Secondary sources (Wikipedia included)
  describe the software restriction accurately but don't surface this
  distinction — it only showed up by reading the primary documents'
  actual front matter.

~~**Revised decision, confirmed by the user 2026-08-17**: software/code
stays fully excluded (unchanged). The Final Report and User's Manual are
now an allowed source — read in full, cite specifically (report/volume/
page), reimplement formulas independently, never redistribute the PDF
itself or claim DATCOM's own proprietary validation datasets (old
contractor wind-tunnel data it was calibrated against) as this project's
own — same discipline already applied to every other public source here.~~
— **superseded again, 2026-08-18.** The ITAR finding above is still
accurate as far as it goes (the documentation genuinely is public-release,
distinct from the restricted software) — nothing about the primary-source
research was wrong. But the user raised a separate, sharper concern after
a brief read of Volume I had already begun under the 2026-08-17 decision:
passing an ITAR/export-control check doesn't mean a source is necessarily
within what Anthropic's own Usage Policy is comfortable with, and that's
a judgment call this project isn't positioned to resolve in its own favor,
especially for a document developed specifically for missile aerodynamic
prediction — regardless of the fact that nothing extracted from it (named
methods for nose-bluntness and boattail drag, no equations) described
weapons design or delivery systems itself. Checked Anthropic's actual
Usage Policy directly rather than guessing (its weapons-restriction
language covers producing/designing weapons and "weaponization and
delivery processes," not general aerodynamic physics) — nothing found
there technically prohibited the partial read that had already happened,
but the user's call was to not rely on that reading and exclude the
source entirely regardless, which is the more conservative and simpler
rule to actually follow going forward. **Final decision: Missile DATCOM
is excluded in full — software AND documentation, no distinction.** The
partial research file from the brief read (`research/candidates/missile-
datcom-manual.md`) was deleted, not just unlinked. This entire multi-step
DATCOM detour (excluded -> revised to partially usable -> excluded again)
is kept here, struck through rather than erased, specifically so a future
session doesn't redo the same research and arrive back at the same
overridden conclusion.

~~Per the user's explicit decision: full exclusion, code and manuals
both. Nothing sourced from Missile DATCOM in any form, ever, for this
project.~~ — superseded 2026-08-17, see above. The general ITAR
distribution-controlled characterization below (historical framing, kept
for context) still correctly describes the SOFTWARE; it just isn't the
whole picture once the manuals' own separate public-release status is
accounted for: "should not be distributed outside of the country,"
historically supplied free by USAF only to American defense contractors —
true of the compiled program, not of the Final Report/User's Manual.

**What IS genuinely public and clean:**
- **NASA/NACA Technical Reports (NTRS, ntrs.nasa.gov)** — confirmed "Work of
  the US Gov. Public Use Permitted," freely downloadable PDFs, no export-
  control shadow. Already found one directly on-topic candidate:
  **NACA-RM-L9I30** (Hart & Katz, 1949, Langley Aeronautical Lab) — "Flight
  Investigations at High-Subsonic, Transonic, and Supersonic Speeds to
  Determine Zero-Lift Drag of Fin-Stabilized Bodies of Revolution having
  Fineness Ratios of 12.5, 8.91, and 6.04 and Varying Positions of Maximum
  Diameter." NTRS almost certainly has more directly relevant reports for
  fin/nose bluntness drag, boattail/launch-lug supersonic drag, and airfoil-
  shape drag effects — a proper search pass (Phase B below) is needed to find
  them, verify each one's own public-domain status individually (don't
  assume — check per-report, as done for the one above), and read them in
  full before any formula gets extracted.
- **Barrowman's own 1967 thesis** ("The Practical Calculation of the
  Aerodynamic Characteristics of Slender Finned Vehicles," NASA-sponsored) —
  confirmed public domain, on Internet Archive and NTRS. This is the
  ur-source both OpenRocket's classical Barrowman implementation AND
  RASAero's own "standard Barrowman method" option are built on. rocketry
  currently cites OpenRocket's *implementation* of this (FinSetCalc.java
  etc.), never the primary source directly — worth adding as a primary
  citation in its own right. **Confirmed directly from OpenRocket's own
  LaTeX technical-doc source** (`openrocket/doc/techdoc/chapter-aerodynamic-
  properties.tex`, read in full) that Barrowman's own 1966/67 work already
  included a supersonic fin CNa/CP extension (a third-order expansion) and a
  supersonic body-drag extension (second-order shock-expansion) — not a
  purely-subsonic method as commonly assumed. It has a real, documented
  limit though: the body shock-expansion method "cannot handle areas with a
  slope larger than ~30°." OpenRocket's own doc also flags several gaps as
  still-open TODOs even in *their* implementation — e.g. "no comprehensive
  data set of shoulder pressure drag at supersonic velocities was found,"
  and a literal `% TODO: FUTURE: supersonic shock wave drag???` for fin
  trailing-edge drag — meaning some of what we'd want isn't a "port this
  from OpenRocket, we just haven't gotten to it yet" situation; OpenRocket
  itself never solved it either, so going to primary literature is the only
  path for those specific gaps, not a shortcut we're skipping.
- **Two more specific, already-identified, high-value sources** (found via
  OpenRocket's own techdoc bibliography citations, both distinct from and
  more recent/general than Barrowman, confirming they exist and are the
  right places to look — full public-domain/access verification still
  needed before use, per Phase B below):
  - **Jorgensen, NASA TN D-7228 (1973)** — "A method for estimating static
    aerodynamic characteristics for slender bodies of circular and
    noncircular cross section alone and with lifting surfaces at angles of
    attack from 0° to 90°." Genuinely more modern than Barrowman (6 years
    later), NOT Barrowman-branded, covers subsonic through low-hypersonic,
    and builds on H. Julian Allen's 1950s NACA viscous-crossflow theory —
    almost certainly the real lineage behind the "body viscous crossflow"
    improvement RASAero's own paper credits itself with. On NTRS
    (ntrs.nasa.gov/citations/19730012271), likely public domain like every
    other NACA/NASA report checked so far, but confirm individually.
  - **Hoerner, "Fluid-Dynamic Drag"** — a classic, still-authoritative,
    continuously-cited drag reference text (not NASA/government, so NOT
    automatically public domain — a real copyrighted book, self-published by
    Sighard Hoerner) that OpenRocket's own techdoc cites directly for nose
    cone pressure-drag data. Usable the same way OpenRocket/rocketry already
    cite copyrighted textbooks: reference specific equations/page numbers
    inline, reimplement independently, never reproduce text/figures
    verbatim — same "practice, don't republish" pattern already used
    throughout this project.
- ~~**Missile DATCOM Final Report + User's Manual**~~ — excluded again,
  2026-08-18, see above. ITAR-clean per direct primary-source verification,
  but excluded anyway on Anthropic Usage Policy grounds regardless of that
  finding. Not a candidate source for this project, full stop.
- **USAF Digital DATCOM (aircraft)** — public domain, but aircraft-focused,
  not rocket/missile-specific. The rocket/missile-specific variant (Missile
  DATCOM) is excluded in full as of 2026-08-18 (see above), so this
  aircraft variant isn't a fallback either — same Usage Policy reasoning
  applies to any DATCOM family member developed for missile/weapons
  aerodynamic prediction. Not a candidate source for this project.

**Why "Barrowman" still gets used as an umbrella brand for improvements that
aren't his own work** (a direct question the user asked, worth recording):
within the hobby/amateur-rocketry community specifically, "the Barrowman
method" has become shorthand for the whole CP-by-component-summation
*framework* Barrowman introduced, not literally "formulas Barrowman himself
derived." RASAero's own "Rogers Modified Barrowman," and a separately-found
DTIC paper literally titled "The Modified Barrowman Method," both fold in
real, separately-authored physics (Kbf from NACA 1307, Galejs' 1999 body
lift, Jorgensen/Allen-lineage crossflow) under that umbrella name because
they're extending Barrowman's original component-summation structure, not
because the added physics is Barrowman's own. There isn't a single newer
"definitive" replacement paper — the field is a patchwork of separately-
authored corrections layered onto Barrowman's original framework (this
project's own Galejs and NACA-1307-Kbf ports are exactly that pattern
already), plus, for genuinely comprehensive modern coverage, large
maintained programs (Missile DATCOM, CFD/panel methods) rather than a single
citable paper — though Missile DATCOM itself is excluded in full (software
and documentation both, see above), so it's mentioned here only to explain
the terminology, not as an available source.

## Recommended approach (per user's choice: new physics from public sources, not a RASAero-output validation oracle for now)

Two deliverables, both research/infrastructure — **no physics implementation
in this pass**, since the actual formulas haven't been extracted from any
source yet (that needs full readings of specific reports, which is its own
follow-up scope once candidates are confirmed).

### 1. `REFERENCES.md` (new, top-level, alongside `DEVIATIONS.md`)

A consolidated, scannable index of every external source this project's
physics/data draws from — complementary to (not a replacement for)
DEVIATIONS.md's existing per-formula inline citations. One entry per source:
what it is, what it's used for, license/permission status, and a link.
Sections:

- **OpenRocket** — GPLv3, extensively ported since the relicense; point to
  DEVIATIONS.md for the itemized list of what's ported vs. deviated.
- **NACA/NASA Technical Reports** — one line per report actually used in
  code today (NACA Report 1307 already cited in fin-calc.ts) plus, after
  Phase B, the newly-identified candidates — report number, title, year,
  NTRS link, "Public Use Permitted" status.
- **Barrowman's 1967 thesis** — primary-source citation, public domain.
- **ThrustCurve.org** — API usage terms (check their site's own terms-of-use
  page for exact language rather than assuming).
- **Vendor `.rkt` library (339 files, LOC/Apogee/Mach1/Wildman)** — **needs
  the user's own input to fill in accurately**, not something I can research
  externally: what permission was actually granted, by whom, and in what
  form (the project's own history references informal/verbal vendor
  permission — "I can ask the vendors for permission there, it's a small
  community and I know the people" — which as of now isn't written down
  anywhere in the repo). Flagging this as a real, pre-existing gap this
  effort surfaces, independent of RASAero.
- ~~**Missile DATCOM (revised 2026-08-17)** — Final Report + User's Manual
  usable (explicit, repeated "distribution unlimited" clearance, see
  above); compiled software still excluded.~~ — superseded 2026-08-18,
  excluded again in full, see "Key research findings" above.
- **Explicitly excluded** — Missile DATCOM in full, software AND
  documentation both (final, 2026-08-18), and RASAero's own internal
  algorithm (not published, not reverse-engineered).

### 2. Literature research pass (Phase B) — identify, verify, and scope candidate NACA/NASA sources

For each of the effects RASAero's own paper says it captures that rocketry
doesn't have yet (fin/nose bluntness drag, boattail/launch-lug supersonic
drag, fin airfoil-shape drag effects, forward CP shift at very high Mach —
distinct from the transonic/supersonic fin CNa1/CP-shift already ported from
OpenRocket this session):

- Read the four now-identified candidates in full and verify each
  individually — NACA-RM-L9I30 (fin-stabilized body transonic/supersonic
  drag), Jorgensen's NASA TN D-7228 (slender-body aero to 90° AOA,
  subsonic-hypersonic, likely the real source behind Galejs/RASAero's
  crossflow claims), Hoerner's Fluid-Dynamic Drag (nose/fin drag data,
  copyrighted but citable-and-reimplementable like any textbook), and
  Missile DATCOM's Volume II User's Manual (AD-A237817 or the 2014
  revision AD1000581 — check which is more current/complete; this is
  where the actual equations live, per the 2026-08-17 revision above) —
  then search NTRS for further on-topic reports the same way (fin/nose
  bluntness, boattail/launch-lug supersonic drag, airfoil-shape drag
  effects), verifying each one's public-domain status individually via
  its own NTRS citation page (not assumed from a search snippet).
- Produce a DEVIATIONS.md-style writeup (either a new file, e.g.
  `TRANSONIC-EXTENSIONS.md`, or a new appendix section) for each candidate:
  what gap it closes, the source report (with link), a plain-English summary
  of the effect, roughly how much it'd move accuracy, and honest implementation
  difficulty — mirroring the rigor of the original `openrocket-parity-audit`
  branch's own findings, verified against the actual report text rather than
  a secondhand summary.
- Add each identified (but not-yet-implemented) source to `REFERENCES.md` as
  soon as it's confirmed, so the reference list stays accurate even before
  any code lands.

**Explicitly out of scope for this plan**: extracting specific formulas and
implementing them in `fin-calc.ts`/`drag-calc.ts`. That's real, separate work
(matching this session's established pattern: read the primary source in
full, verify the math independently before trusting it, port faithfully with
inline citations) that should be its own follow-up plan once Phase B's
candidate list is confirmed with the user — likely one candidate report at a
time, same cadence as the OpenRocket ports.

## Tasks

- [x] Write `REFERENCES.md` (top-level, repo root) — OpenRocket, NACA 1307,
      Barrowman thesis, ThrustCurve.org, vendor `.rkt` library (flagged as
      needing user input), Missile DATCOM's software-excluded/documentation-
      usable split, Hoerner's copyright-discipline note, all 6 new candidates
- [x] Read NACA-RM-L9I30 in full (page images, not OCR — scanned 1949 doc),
      verified public-domain status directly from its NTRS page — real
      quantitative finding: max-diameter position ~55-60% of body length
      roughly halves supersonic drag vs. 20% — `research/candidates/naca-rm-l9i30.md`
- [x] Read Jorgensen NASA TN D-7228 in full (page images), verified public-domain
      status — confirmed this IS the real physics lineage behind the
      already-ported Galejs body-lift term (same sin²(AOA) crossflow
      structure); rocketry uses a flat constant K=1.1 where this method
      uses a real Mach/Reynolds-dependent Cdn — `research/candidates/jorgensen-tn-d7228.md`
- [x] Researched Hoerner "Fluid-Dynamic Drag" citation — **corrected** the
      2026-08-15 research's own mischaracterization (it's surface-roughness
      friction data, not nose pressure drag); fully specified from
      OpenRocket's own public GPLv3 source, no book access needed —
      `research/candidates/hoerner-fluid-dynamic-drag.md`
- [x] Read Missile DATCOM documentation — caught and corrected a wrong
      assumption mid-read (Volume II is an input-reference manual with no
      equations; Volume I "Final Report" is where methods live), re-fetched
      Volume I, found named underlying methods (Devan nose-bluntness,
      Van Dyke/SOSE and the "Payne correlation"/NSWC TR-81-156 for boattail)
      but not their full equations — honestly flagged as a partial read,
      not glossed over — `research/candidates/missile-datcom-manual.md`
- [x] NTRS search pass — 3 new verified-public-domain candidates found
      (NACA TN 2858 fin-thickness wave drag, NACA RM E51C06 afterbody drag,
      NASA CR-2835 compiled missile data), not yet read in full —
      `research/candidates/ntrs-search-pass.md`
- [x] Scoping docs written as one file per candidate in `research/candidates/`
      (gap closed, source, math extracted, accuracy impact, implementation
      difficulty, other-relevant-physics, honest uncertainty flags) rather
      than a single combined doc — six sources, each substantial enough to
      warrant its own file
- [ ] Report findings to user, get direction on which (if any) to implement first

## Decisions

- New physics from public NACA/NASA literature, not a RASAero-output
  validation oracle, for this first pass (user's explicit choice — the
  oracle approach remains a good later follow-up, not discarded).
- ~~Missile DATCOM fully excluded — code and manuals both — per explicit
  user decision after discussing the code-vs-documentation ITAR
  nuance.~~ — superseded 2026-08-17: primary-source research (DTIC
  documents read directly, not a secondhand characterization) found the
  Final Report and User's Manual carry an explicit, repeated "approved for
  public release; distribution unlimited" statement across 25+ years of
  revisions, with no ITAR/export legend anywhere in their front matter —
  a real, deliberate government public-release determination for the
  documentation specifically, distinct from the software's own genuinely
  restricted AFRL-direct distribution.
- ~~Missile DATCOM, revised: compiled software excluded (unchanged). Final
  Report + User's Manual usable as a public-domain-equivalent source —
  read in full, cite specifically, reimplement formulas independently,
  never redistribute the PDF or claim DATCOM's own proprietary validation
  data as this project's own — confirmed by the user 2026-08-17.~~ —
  superseded 2026-08-18: the ITAR/public-release finding behind this was
  accurate, but the user decided a document developed specifically for
  missile aerodynamic prediction sits closer to a line Anthropic's Usage
  Policy may draw more conservatively than export-control law does, and
  chose not to resolve that judgment call in this project's favor.
- **Missile DATCOM (final, 2026-08-18): excluded in full — software AND
  documentation, no distinction.** Nothing sourced from Missile DATCOM in
  any form, ever, for this project. The partial research file from the
  brief read that happened under the 2026-08-17 decision
  (`research/candidates/missile-datcom-manual.md`) was deleted, not just
  unlinked. See `REFERENCES.md`'s "Missile DATCOM" section and the "Key
  research findings" section above for the full history — kept
  struck-through rather than erased so a future session doesn't redo the
  same research and land back on the same overridden conclusion.

## Open questions

- Vendor `.rkt` library permission terms — needs the user's own input, not
  researchable externally.
- Whether `REFERENCES.md` should be built before or interleaved with the
  Phase B literature pass (leaning: build the skeleton first with what's
  already known, add rows as Phase B confirms each new source).
