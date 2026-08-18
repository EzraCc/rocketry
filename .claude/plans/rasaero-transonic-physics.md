Status: backlog
Priority: medium
Type: research
Last updated: 2026-08-17

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

**Missile DATCOM: REVISED 2026-08-17 — software excluded, documentation
usable.** The original 2026-08-15 finding below (kept for history, now
superseded) was based on general secondhand characterizations, not the
primary documents themselves. On 2026-08-17 the user asked for real
research into the actual government stance, since it seemed strange for a
genuinely ITAR-controlled paper to be published with usable formulas
intact. Fetched primary DTIC documents directly (via archive.org's
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

**Revised decision, confirmed by the user 2026-08-17**: software/code
stays fully excluded (unchanged). The Final Report and User's Manual are
now an allowed source — read in full, cite specifically (report/volume/
page), reimplement formulas independently, never redistribute the PDF
itself or claim DATCOM's own proprietary validation datasets (old
contractor wind-tunnel data it was calibrated against) as this project's
own — same discipline already applied to every other public source here.

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
- **Missile DATCOM Final Report + User's Manual (AD-A211086 / AD-A237817,
  or the 2014 revision AD1000581 — check which is most current/complete
  before reading)** — REVISED 2026-08-17, see above: the actually
  rocket/missile-specific DATCOM variant's documentation, not the aircraft-
  only Digital DATCOM below. Explicitly, repeatedly cleared "approved for
  public release; distribution unlimited" across 25+ years of revisions
  (verified directly from primary front-matter text, not a secondhand
  characterization). Volume II (User's Manual) is where the real
  equations live. Software/compiled program stays excluded. Not yet read
  in full — added to Phase B's candidate list below.
- **USAF Digital DATCOM (aircraft)** — public domain, but aircraft-focused,
  not rocket/missile-specific, so limited direct applicability now that the
  actually-relevant Missile DATCOM variant's own documentation is usable
  (see above). Available as a secondary cross-reference only if a specific
  need arises.

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
citable paper — the rocket-specific one of those, Missile DATCOM, has its
own documentation now usable per the 2026-08-17 revision above (software
itself still excluded).

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
- **Missile DATCOM (revised 2026-08-17)** — Final Report + User's Manual
  usable (explicit, repeated "distribution unlimited" clearance, see
  above); compiled software still excluded.
- **Explicitly excluded** — Missile DATCOM's compiled software (not the
  documentation, see above), and RASAero's own internal algorithm (not
  published, not reverse-engineered).

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

- [ ] Write `REFERENCES.md` (OpenRocket, NACA 1307, Barrowman thesis,
      ThrustCurve.org, vendor `.rkt` library — needs user input, Missile
      DATCOM's revised software-excluded/documentation-usable split noted
      explicitly)
- [ ] Read NACA-RM-L9I30 in full, verify public-domain status individually
- [ ] Read Jorgensen NASA TN D-7228 in full, verify public-domain status
- [ ] Read relevant Hoerner "Fluid-Dynamic Drag" sections, confirm citation approach
- [ ] Read Missile DATCOM Volume II User's Manual in full (AD-A237817 or
      AD1000581) -- the equations, per the 2026-08-17 revision
- [ ] NTRS search pass for fin/nose bluntness, boattail/launch-lug supersonic
      drag, airfoil-shape drag effects — verify each candidate individually
- [ ] Write scoping doc (new file or DEVIATIONS.md appendix) for each
      candidate: gap closed, source, plain-English summary, accuracy impact,
      implementation difficulty
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
- Missile DATCOM, revised: compiled software excluded (unchanged). Final
  Report + User's Manual usable as a public-domain-equivalent source —
  read in full, cite specifically, reimplement formulas independently,
  never redistribute the PDF or claim DATCOM's own proprietary validation
  data as this project's own — confirmed by the user 2026-08-17.

## Open questions

- Vendor `.rkt` library permission terms — needs the user's own input, not
  researchable externally.
- Whether `REFERENCES.md` should be built before or interleaved with the
  Phase B literature pass (leaning: build the skeleton first with what's
  already known, add rows as Phase B confirms each new source).
