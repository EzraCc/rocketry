# NASA CR-2835 — compiled missile aero data (mostly out of scope; one genuinely usable validation case)

## Source

Nichols, James O. (Auburn University, under NASA contract): "Analysis and
Compilation of Missile Aerodynamic Data. Volume 1: Data Presentation and
Analysis." NASA CR-2835, May 1977.

- NTRS: https://ntrs.nasa.gov/citations/19770021140
- PDF: https://ntrs.nasa.gov/api/citations/19770021140/downloads/19770021140.pdf
- **Public-domain status, quoted directly from the NTRS citation page**:
  "Work of the US Gov. Public Use Permitted" — checked individually despite
  being a university/contractor report rather than NASA/NACA in-house
  authorship, per this project's own standing rule not to assume. The
  report's own Foreword additionally states its entire purpose is
  compiling *recently declassified* Langley missile data for public
  dissemination ("The declassification of a number of technical documents
  which contain missile aerodynamic data... prompted the work reported
  herein") — consistent with, not contradicting, the current public status.
- 116-page 1977 scan, good OCR text layer (`page.get_text()` returned
  clean, readable prose for essentially every text page — noticeably
  better than the 1950s-vintage sources in this batch). Read in full via
  text extraction: Foreword, Summary, Symbols, Introduction, Apparatus and
  Tests, Method of Data Presentation, Data Analysis (all subsections), and
  the full "Summary of Configurations" section (the drawing-index pages
  covering all 30 source documents' vehicle shapes). Spot-checked several
  individual configuration data pages as page-image renders (3x/2.5x zoom)
  to verify format and pull actual numbers, rather than reading all ~90
  pages of per-configuration plots — see "Scope of this read" below for
  why that's the appropriate depth here, not a shortcut.

## Gap this addresses / how this was scoped

Flagged in `ntrs-search-pass.md` as "a broad compilation of missile
aerodynamic data... not a single-effect methodology paper like the others,
but potentially a rich independent VALIDATION dataset... lower priority
for formula-extraction, but flag for the validation use case." This read
confirms that framing was accurate, and sharpens it considerably.

## What this report actually is

Thirty separate NASA Langley technical memoranda, each reporting wind-tunnel
data (Langley 8-ft transonic tunnel and Unitary Plan wind tunnel, Mach
~0.2–4.7 depending on configuration, Reynolds number ~6.5–9.8×10⁶/m) for a
**guided missile or drone configuration**, compiled into one summary
document with one drawing plus a handful of standardized plots
(`C_D,o`, `C_D,b`, `C_Lα`, `X_ac/ℓ`, sideslip derivatives, and — the bulk
of the actual content — **control-surface effectiveness**: pitch/roll/yaw
control derivatives for canards, tails, and ailerons).

**Read the full "Summary of Configurations" drawing index (all 30
vehicles) specifically to check applicability to rocketry's own passively
fin-stabilized, uncontrolled model** — this is the key finding: the
overwhelming majority are winged and/or canard/tail-controlled air-to-air,
surface-to-air, air-to-surface, cruise, and target-drone vehicles (the
Table of Contents' own category headers). These have active control
surfaces (deflectable canards, tails, ailerons) and often cruciform
wing/fin arrangements with ramjet/nacelle inlets — a fundamentally
different aerodynamic problem than rocketry's Barrowman-style fixed-fin,
uncontrolled body, and the report's own bulk content (roll/yaw control
effectiveness, cross-coupling, sideslip derivatives) has no analog in
rocketry's model at all.

**One configuration is a genuine exception**: the last category in the
drawing index, "PROJECTILE" (report pp.103-104, this file's own Figures
76-77), is **TM X-2831, a wind-tunnel model of a 105-mm gun-launched
projectile** — an ogive-nosed, tapered, 6-fin-stabilized body with **no
control surfaces, no wings, no canards, no propulsion inlet**. This is
structurally close to a passively-stabilized rocket, unlike every other
configuration in this compilation.

## The data (the one usable case: TM X-2831)

Figure 76 gives full dimensioned geometry (cm): overall length 89.438,
body diameter (max) ~10.57, ogive nose, a short boattail/flare transition,
and a 6-fin tail section, in three nose-length variants ("0.5 cal.,"
"1.0 cal.," "1.5 cal. configurations" — presumably nose length in body
calibers, exact definition not chased down further in this pass).

Figure 77 (read as a page-image render) gives, for all three
nose-length variants, at zero AOA, Mach ~1.5–2.5:

| Quantity | Range read off the plot |
|---|---|
| `C_D,o` (zero-AOA drag, `S_max`-referenced per this report's own convention) | ~0.22 (minimum, near M≈1.7-1.8) rising to ~0.28-0.3 at M=1.5 and again toward M≈2.5 |
| `C_Lα` (lift-curve slope, per degree) | ~0.052-0.055 minimum near M≈1.7-2, rising to ~0.06-0.07 by M=2.5 |
| `X_ac/ℓ` (aerodynamic center, fraction of body length from nose) | ~0.42-0.5, shallow minimum near M≈2 |

All three nose-length variants track closely together on every plot — nose
length in this narrow range has only a mild effect on any of the three
parameters, per the figure's own closely-bunched curves.

## Accuracy impact

**Not a formula source — a validation dataset**, same character as
`naca-rm-l9i30.md`'s own use case, but for a different body shape/Mach
range. This gives rocketry an independent, precisely-dimensioned,
real-wind-tunnel-tested check on `C_D,o`, `C_Lα`, and CP location for a
simple fin-stabilized body at Mach 1.5-2.5 — useful as a sanity check on
the combined Barrowman + already-ported drag model's supersonic
predictions for a realistic geometry, rather than a source of any new
physics or correction term.

## Implementation difficulty

**Low, if pursued as a validation case; not applicable as a formula
source.** Building this into a validation check would mean: constructing
the TM X-2831 geometry (dimensions already fully given in Figure 76) as a
rocketry `Component` stack, running it through the existing drag/CNa/CP
pipeline at Mach 1.5-2.5, and comparing against the three digitized curves
above. This is a real but modest task (geometry entry + a comparison
script), not a physics-formula port — flagged as a possible follow-up, not
attempted in this research-only pass per this task's own scope.

## Other relevant physics

- The report's Data Analysis section notes (p.7, read directly) that
  lift-curve slopes "tend to increase with angle of attack while they
  decrease with increasing Mach number at supersonic speeds," and flags
  that the underlying data across all 30 configurations "should not be
  difficult to formulate equations to fit" — a general observation about
  curve-fittability, not a specific formula, and not chased further here
  since it's about the guided-missile configurations that are out of scope
  for rocketry, not about the one relevant projectile case.
- None of the report's own 30 source TMs (the underlying detailed reports,
  as opposed to this compiled summary) were independently tracked down or
  read — this report is being used here exactly as it presents itself, a
  compiled secondary summary, consistent with how `jorgensen-1972-cdn-
  curve.md` treats TN D-6996's own upstream references.

## Uncertainty flags

- **All numeric values above are eyeballed off a 2.5x-zoom page-image
  render of a 1977 plotted figure**, not pixel-digitized — same caveat,
  same reason, as every other plot-reading in this project's candidate
  docs.
- The exact geometric definition of "0.5/1.0/1.5 CAL. CONFIG." (presumably
  nose or ogive length in body calibers) was not confirmed from the source
  report's own text — read only from the figure's drawing and legend, not
  chased into TM X-2831 itself (which wasn't independently retrieved; this
  pass relied on CR-2835's own compiled summary, consistent with this
  report's own stated purpose).
- The other ~29 configurations were surveyed only at the drawing/category
  level (confirmed guided/winged/controlled from their outline drawings
  and the report's own category labels), not individually read
  page-by-page — a deliberate scope decision given 90+ pages of
  control-effectiveness data with no clear rocketry application, not an
  oversight. If a future need arises for missile control-surface data
  specifically (not currently anything rocketry models), this report would
  need a second, deeper pass.

## Verdict

**Mostly out of scope — this is a compiled reference for guided-missile
control-surface aerodynamics, not passively-stabilized rocket
aerodynamics, and the bulk of its content (canard/tail/aileron
effectiveness, roll/yaw/sideslip derivatives) has no rocketry analog at
all.** One real exception: TM X-2831, a 105-mm fin-stabilized projectile
with no control surfaces, gives a clean, fully-dimensioned, independently
useful validation dataset (`C_D,o`, `C_Lα`, `X_ac/ℓ` vs. Mach 1.5-2.5) —
worth keeping as a possible future validation check on rocketry's existing
supersonic drag/CP model, not as a source of new physics. Confirms the
original `ntrs-search-pass.md` "lower priority, validation use case"
framing was correct, and narrows it to one specific, usable case rather
than the whole 116-page document.
