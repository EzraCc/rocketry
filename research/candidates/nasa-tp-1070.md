# NASA TP-1070 — transonic boattail separation (real criterion exists, but not directly portable)

## Source

Wilmoth, Richard G.: "Computation of Transonic Boattail Flow With
Separation." NASA Technical Paper 1070, Langley Research Center, December
1977.

- NTRS: https://ntrs.nasa.gov/citations/19780005074
- PDF: https://ntrs.nasa.gov/api/citations/19780005074/downloads/19780005074.pdf
- **Public-domain status, quoted directly**: Distribution Limits "Public".
  Copyright Notice: "Work of the US Gov. Public Use Permitted."
- 67-page 1977 scan, clean OCR text layer for prose (`page.get_text()`
  readable throughout), figures/tables rendered as page images (3x zoom)
  where the OCR couldn't represent plotted data or table structure. Read:
  Summary, Symbols, Numerical Method, the full Results and Discussion
  (Separation Model, Comparisons With Experiment, Viscous-Inviscid
  Interactions, Sensitivity to Computational Grid Size), Concluding
  Remarks, full References list (all 20, read directly to chase two named
  criteria — see below), Table I (boattail geometry, image-rendered), and
  Figure 4 (the separation-angle-vs-Mach plot central to this report's
  relevance here, image-rendered). Not individually re-digitized: Figures
  1-3, 6-15 (grid diagrams, individual pressure/drag comparison plots for
  each of 8 Mach numbers × 4 configurations) — this report's own text
  summarizes their conclusions clearly enough that pixel-level redigitizing
  wasn't a good use of effort for this specific question.

## Gap this addresses

Opened as its own plan (`boattail-steepness-validation.md`) after the user
noted OpenRocket/rocketry have no validation or warning for an
aerodynamically too-steep boattail — no minimum-length-per-diameter-
reduction check. Flagged in the prior search pass
(`boattail-steepness-ntrs-search.md`) as the best conceptual match found,
since its own abstract frames its separation model around a "separation
location and turning angle" — closely related to steepness.

## The data

**This is a genuinely relevant, on-topic report — but it complicates the
question rather than handing over a simple threshold.**

**Geometry class**: all five tested configurations (Table I, read as a
page image) are **circular-arc boattails** — a curved profile defined by
an arc radius `R_c`, not a straight conical taper. Parametrized by
`x_l/d_m` (boattail length / max diameter), `d_b/d_m` (base/max diameter
ratio), `R_c/d_m` (arc radius / max diameter), and `β_c` (the **chord
angle** — the angle of the straight line connecting the boattail's start
and end points, i.e. an *average* steepness, not a uniform local angle).
Five configurations tested, `β_c` = 17.03°, 13.77°, 7.89°, 11.03°, 8.25°.

**This matters directly for portability**: a circular arc's *local* slope
is steepest right at the shoulder (where it meets the cylindrical
forebody) and shallowest near the base (tangent into the boattail-
simulator junction) — unlike a cone, whose slope is uniform along its
whole length. rocketry's (and OpenRocket's) ported `boattailPressureCd()`
computes `fineness` from a single length/diameter-change ratio, implicitly
treating the taper as a uniform cone. Wilmoth's `β_c` (chord angle) is a
different quantity than either rocketry's `fineness` or a true local
separation-driving angle — none of the three map onto each other by a
simple conversion.

**Mach range**: entirely subsonic/transonic, `M∞` = 0.40 to 0.96 across
all figures and data tables read. The Summary and this report's own
abstract state the separation model "performed well up to a free-stream
Mach number of about 0.90." **Never supersonic** — a real gap relative to
the actual concern (rockets typically care about boattail behavior at
transonic-through-supersonic flight, the same regime NACA-RM-E51C06 and
this project's fin-CP-pole discussion, in the unrelated `openrocket` repo,
have both been focused on).

**Figure 4** ("Variation of discriminating streamline separation angle
with local Mach number at separation," read as a page image) is the
report's most directly relevant result: plots `θ_s` (the actual separation
angle observed/inferred at the point of flow separation) against `M_s`
(the *local* Mach number at that separation point — not the free-stream
Mach number) for four of the five configurations (`β_c` = 17.0°, 13.8°,
11.0°, 8.2°). **The relationship is not simple or monotonic**: all four
configurations' `θ_s` converge toward a common ~3-4° as `M_s → 1`, but
diverge substantially as `M_s` decreases — the 11.0° configuration (not
the steepest, 17.0°) shows the *highest* peak `θ_s` (~18° near `M_s≈0.7`),
while the 17.0° (steepest) configuration sits at the *bottom* of the
spread at comparable `M_s`. **A boattail's own raw chord angle does not
rank directly against this separation-relevant metric** in this data —
the relevant quantity is Mach- and geometry-coupled, not a single
steepness number.

**Two named, citable prior criteria this report compares against, neither
independently verified in this pass**:
- **Presz (1974)** — "Turbulent Boundary Layer Separation of Axisymmetric
  Afterbodies," Ph.D. thesis, University of Connecticut. A University
  thesis, not a NASA/NACA report — different access/licensing situation,
  not checked for public availability in this pass.
  Its data range is shown in Figure 4 as a shaded band roughly
  10-14° across `M_s = 0.4-0.9`.
- **Page (1961)** — "A Theory for Incipient Separation," in *Developments
  in Mechanics*, Vol. 1 (Lay & Malvern, eds.), Plenum Press, pp. 563-577.
  **A copyrighted 1961 academic book chapter, not a NASA/NACA/government
  report — not on NTRS, not public domain, not accessed in this pass.**
  This is the actual named "Page separation criterion" plotted (as a
  dashed dropping-then-rising curve) in Figure 4 — Wilmoth's paper cites
  and compares against it but does not reproduce its underlying closed-form
  equation. Getting the actual formula would require direct access to this
  specific 1961 book, a meaningfully different and harder access problem
  than every NACA/NASA-hosted source read in this project so far.

## Accuracy impact

**Confirms the underlying physical concern is real** (steep/short
boattails do carry a genuine, separation-driven aerodynamic risk, backed
by real wind-tunnel-anchored analysis, not just intuition) but **does not
supply a ready design rule**. The three things that would be needed for a
simple "minimum length per diameter reduction" check — (1) a direct
function of boattail geometry alone (not requiring the local Mach number
at an a-priori-unknown separation point), (2) supersonic validity, (3) a
freely accessible closed form — are each individually missing from this
specific report, though items are scattered across its citation trail.

## Implementation difficulty

**High, if pursued from this report alone.** Wilmoth's own method is a
coupled viscous-inviscid iterative CFD procedure (a modified Reshotko-
Tucker boundary-layer technique coupled to a relaxation solver for the
full potential equation) — not something to port as a simple check. Using
it as a lookup (Figure 4's curves directly) would mean: (a) generalizing
from circular-arc-specific `β_c` to whatever taper shape rocketry actually
needs to check, (b) working entirely in the subsonic/transonic band this
report validates (leaving supersonic boattails, arguably the more common
rocket case, uncovered), and (c) still needing the *local* Mach number at
the point of separation, which isn't a simple geometry-only input. A
"minimum length per diameter reduction" rule as literally described by the
user would need a different, more direct source — likely one of the named
criteria (Presz or Page) themselves, if accessible, rather than Wilmoth's
CFD comparison of them.

## Other relevant physics

- Confirms (Concluding Remarks, read directly) the method's own biggest
  weakness is exactly the shock-induced-separation case — "approximating
  the discriminating streamline as a straight line between separation and
  reattachment for shock-induced separation is indeed subject to
  question" — an honest, self-disclosed limitation of the closest thing
  this literature offers to a general method.
- References 2-13 in this report's own bibliography are a small
  mini-survey of *other* 1975-1977 transonic-boattail CFD papers (Chow/
  Bober/Anderson; Yaros; Cosner/Bower; Yaeger; Holst — all AIAA conference
  papers, not NASA report numbers, so a different and likely harder access
  situation than NTRS-hosted sources) — not chased down in this pass, but
  worth knowing this was an active multi-group research topic in exactly
  that period if a deeper CFD-level treatment is ever wanted.

## Uncertainty flags

- **Figure 4's `θ_s` values are eyeballed off a 3x-zoom page-image
  render**, not pixel-digitized — same caveat, same reason, as every
  other plot-reading in this project's candidate docs.
- **Presz's thesis and Page's book chapter were not independently
  retrieved or read in this pass** — both are non-NASA/NACA sources with
  their own access/licensing questions not yet resolved, flagged rather
  than assumed accessible or assumed excluded. Explicitly NOT the same
  category-of-document concern that excluded the Payne/NSWC correlation
  (these are academic thesis/book sources about general aerodynamics, not
  documents developed specifically for tactical-weapons prediction) — but
  a different, real access question (copyright/availability) that would
  need its own check before reading either.
- The exact relationship (if any) between Wilmoth's circular-arc `β_c`
  (chord angle) and a straight-cone `fineness` ratio (as rocketry/
  OpenRocket's ported formula uses) was not derived in this pass — flagged
  as a real conversion gap, not assumed to be a simple substitution.

## Verdict

**Confirms the concern is physically real and points at genuinely relevant
named prior work (Presz, Page), but does not itself supply a usable
design rule for rocketry.** The report's own headline result (Figure 4)
shows the relationship between boattail steepness and separation risk is
Mach- and geometry-coupled, not a single threshold — and even the two
named criteria it compares against are not freely accessible from NTRS.
Getting an actual minimum-length-per-diameter-reduction rule would need a
follow-up specifically chasing Presz's thesis or Page's book chapter
(different access questions than anything read in this project to date),
not further reading of Wilmoth's own CFD-comparison paper.
