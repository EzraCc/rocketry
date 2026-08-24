# External references

Every external source this project's physics or data draws from, with
license/permission status and a link. Complementary to `DEVIATIONS.md`,
which cites OpenRocket sources inline per-formula (file:line, exact
quotes) — that convention stays as-is for OpenRocket specifically. This
file is the project-wide index, covering everything else too.

For sources investigated as *candidates* but not yet ported into any
formula, see `research/candidates/` — one file per source, with the
actual equations/data extracted, an honest accuracy/difficulty estimate,
and citations precise enough for independent verification (report/page/
equation number). This file links to them; it doesn't duplicate their
content.

## OpenRocket

GPLv3, extensively ported since this project's own relicense to GPLv3 (see
`LICENSE`). See `DEVIATIONS.md` for the itemized, file:line-cited list of
what's ported vs. deliberately different vs. still open.

- Repository: https://github.com/openrocket/openrocket

## NACA/NASA Technical Reports

All confirmed individually public domain via their own NTRS citation page
(never assumed from a search snippet) — NTRS's standard rights statement
for these is **"Work of the US Gov. Public Use Permitted."**

| Report | Title | Status |
|---|---|---|
| NACA Report 1307 | Fin normal-force interference (Kbf) | **Ported** — see `src/physics/aero/fin-calc.ts`, cited inline |
| NACA RM L9I30 (1949) | Zero-lift drag of fin-stabilized bodies of revolution, position-of-max-diameter sweep | Candidate, fully read — `research/candidates/naca-rm-l9i30.md` |
| NASA TN D-7228 (Jorgensen, 1973) | Slender-body aero 0°-90° AOA, viscous crossflow method | Candidate, fully read — `research/candidates/jorgensen-tn-d7228.md`. **Directly relevant**: the likely real lineage behind the already-ported Galejs body-lift term |
| NACA TN 2858 (Henderson, 1952) | Supersonic wave drag of delta wings, varying thickness ratio | Candidate, fully read — **negative finding, dead end**: delta-wing-specific (point apex, zero tip chord), doesn't generalize to rocketry's trapezoidal/freeform fins; data model has no per-span thickness distribution to consume it anyway — `research/candidates/naca-tn-2858.md` |
| NASA TN D-6996 (Jorgensen, 1973) | "State-of-the-knowledge" Cdn(Mn, Ren) crossflow-drag plots for circular cylinders, plus η (finite-cylinder correction) vs. L/d | Candidate, fully read — found by chasing TN D-7228's own reference list (this is TN D-7228's "reference 9"). **Directly relevant**: resolves the missing Cdn/η data dependency flagged in the TN D-7228 writeup, though only as digitized plot data, not a closed-form fit — `research/candidates/jorgensen-1972-cdn-curve.md` |
| NACA RM E51C06 (Cohen, 1951) | Afterbody shape/fineness-ratio drag effects | Candidate, fully read — **positive finding**: rocketry's ported `boattailPressureCd()` hard-zeros for boattail fineness ≥3, but this report's own wind-tunnel data on a fineness-5.08 boattail measures a real, nonzero `Cd,p` (~0.02-0.06) — a quantified gap, not a ready fix — `research/candidates/naca-rm-e51c06.md` |
| NASA CR-2835 (Nichols, 1977) | Compiled missile aerodynamic data (30 declassified Langley reports) | Candidate, fully read — **mostly out of scope** (guided-missile canard/tail control-surface data, no rocketry analog), but one configuration (TM X-2831, a fin-stabilized 105-mm projectile with no control surfaces) gives a clean, dimensioned validation dataset (Cd,o/CLα/Xac vs. Mach 1.5-2.5) — `research/candidates/nasa-cr-2835.md` |
| NASA TP-1070 (Wilmoth, 1977) | Transonic boattail flow-separation computation, framed around a separation "turning angle" | Candidate, fully read — real and on-topic but doesn't resolve the question: circular-arc geometry (not rocketry's conical taper model), subsonic/transonic only (never supersonic), and its own data shows separation angle vs. chord angle is Mach-coupled, not a single threshold. Names two more specific, unaccessed sources (Presz 1974 thesis, Page 1961 book chapter) — `research/candidates/nasa-tp-1070.md` |
| NASA TN D-6789 (Compton, 1972) | Boattail-angle (3°/5°/10°) × length/diameter drag data, Mach 1.83/2.20 (jet-off subset) | Candidate, found via search, not yet read — `research/candidates/boattail-steepness-ntrs-search.md` |
| NASA TM X-3109 (Rom & Bober, 1974) | Subsonic boattail pressure distribution, viscous interaction | Candidate, found via search, not yet read, lower priority (subsonic only, documented convergence issues) — `research/candidates/boattail-steepness-ntrs-search.md` |

## Barrowman's 1967 thesis

"The Practical Calculation of the Aerodynamic Characteristics of Slender
Finned Vehicles," James S. Barrowman, NASA-sponsored. Public domain
(Internet Archive, NTRS). The ur-source both OpenRocket's classical
Barrowman implementation and this project's own port are built on.
rocketry currently cites OpenRocket's *implementation* of this
(`FinSetCalc.java` etc. via `DEVIATIONS.md`), not the primary thesis
directly — worth adding as a primary citation if the thesis is ever read
directly for this project's own purposes.

## Missile DATCOM — fully excluded (software AND documentation)

Vukelich et al., "Missile Datcom," AFWAL-TR-86-3091, Volumes I (Final
Report, 1988) and II (User's Manual, revised through 2014).

- **Compiled software: excluded.** Genuinely ITAR export-controlled —
  distributed only directly by AFRL to vetted, certified U.S. entities.
  Never accessed, referenced, or used in any form by this project.
- **Documentation: also excluded, as of 2026-08-18 — not an ITAR
  question, a Claude/Anthropic Usage Policy one.** A 2026-08-17
  primary-source review found the Final Report and User's Manual
  themselves carry an explicit, repeated "Approved for public release;
  distribution unlimited" statement (no ITAR/EAR legend anywhere in their
  front matter) — legally distinct from the restricted software. That
  finding stands as accurate. But on reflection, working with a document
  developed specifically for missile aerodynamic prediction sits closer to
  a line an AI usage policy may draw more conservatively than export-
  control law does, even when nothing extracted from it would itself
  describe weapons design or delivery systems. Rather than resolve that
  judgment call in this project's favor, the documentation is excluded
  too — full stop, independent of its ITAR status. See
  `.claude/plans/rasaero-transonic-physics.md`'s "Missile DATCOM: REVISED
  2026-08-17, then excluded again 2026-08-18" section for the complete
  history (both the ITAR finding and the reason it was overridden).
  Whatever partial notes existed from the brief read that happened before
  this was caught have been deleted, not just left unlinked.

## Hoerner, "Fluid-Dynamic Drag"

Sighard V. Hoerner, self-published, 1965. **Copyrighted, not public
domain** — unlike every NACA/NASA/DATCOM source above. This project's
standing rule: cite specific page/section/table numbers, reimplement any
underlying relationship independently, never reproduce text/tables/figures
verbatim. See `research/candidates/hoerner-fluid-dynamic-drag.md` — in
practice, the one gap this project traced to a Hoerner citation (surface-
roughness friction floor) turned out to be fully specified by OpenRocket's
own already-public GPLv3 source code, so no direct access to the book
itself was needed or attempted.

## ThrustCurve.org

Real motor thrust-curve data (search + download API), `src/physics/motor/
thrustcurve-client.ts`. Check https://www.thrustcurve.org's own
terms-of-use page for exact API usage terms rather than assuming — not
independently re-verified for this file.

## Vendor `.rkt` library (339 files: LOC Precision, Apogee, Mach1, Wildman)

**Needs the user's own input to fill in accurately — not researchable
externally.** What permission was actually granted, by whom, and in what
form is not currently written down anywhere in this repo; project history
references informal/verbal vendor permission ("I can ask the vendors for
permission there, it's a small community and I know the people"). Flagged
as a real, pre-existing gap, independent of the transonic-physics research
that prompted this file's creation.

## Splashcast integration

Sibling project (`github.com/EzraCc/splashcast`), separate license, no
code sharing — embedded via a visible `<iframe>` specifically to avoid
GPLv3 propagation into a non-GPLv3 codebase. See `tmp/splashcast-*.md` and
`.claude/plans/embed-config-cache.md` for the integration contract.

## Explicitly excluded

- Missile DATCOM's compiled software (see above — documentation only).
- **NSWC TR-81-156, "Aerodynamic Design Manual for Tactical Weapons"**
  (Mason, Devan, Moore, McMillan; Naval Surface Warfare Center, July
  1981) — excluded 2026-08-20, same reasoning as Missile DATCOM's
  documentation exclusion (see above): a document developed specifically
  for tactical-weapons aerodynamic prediction, independent of its ITAR/
  distribution status (not checked, since the category concern alone was
  decisive). This is the source of the "Payne correlation" for boattail
  drag named (but not equationed) in Missile DATCOM's own Volume I — never
  read, never accessed beyond its public bibliographic citation (title/
  authors/date, found via general web search, not the document itself).
  See `.claude/plans/boattail-steepness-validation.md` for the full
  research trail.
- RASAero's own internal algorithm — closed-source freeware, never
  published, never reverse-engineered. Its own methodology paper (Rogers &
  Cooper, 2011) describes *what effects* it captures, never the underlying
  math. See `.claude/plans/rasaero-transonic-physics.md` for the full
  research trail.
