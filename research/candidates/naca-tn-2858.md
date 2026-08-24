# NACA TN 2858 — supersonic wave drag of delta wings with linearly varying thickness ratio (negative finding)

## Source

Henderson, Arthur, Jr.: "Supersonic Wave Drag of Nonlifting Delta Wings with
Linearly Varying Thickness Ratio." NACA TN 2858, Langley Aeronautical
Laboratory, December 1952.

- NTRS: https://ntrs.nasa.gov/citations/19930083608
- PDF: https://ntrs.nasa.gov/api/citations/19930083608/downloads/19930083608.pdf
- **Public-domain status, quoted directly from the NTRS citation page**:
  Copyright Notice: "Work of the US Gov. Public Use Permitted."
- 52-page 1952 scan, very poor OCR text layer (heavy character-substitution
  garbling — e.g. "m" for various Greek letters, "iii" for the overbarred
  m̄ parameter — equations unreadable as extracted text). Read in full via
  PyMuPDF page-image rendering (3x zoom), the same approach used for
  NACA-RM-L9I30. 6 pages of body text (Summary/Introduction/Symbols/
  Analysis/two comparison-criterion sections/Concluding Remarks), two short
  appendices (derivation details + the F/G/H-function definitions), and the
  rest figures/plots. Every body-text page and the key figures (1, 5) were
  read directly from rendered images; the appendix B function listings
  (pages 27-32, dense multi-line closed-form expressions) were confirmed to
  exist and to define the F1/F2/F3, G1/G2/G3, H1/H2/H3 functions referenced
  in the main text, but not individually transcribed digit-by-digit — not
  needed given this report's negative-finding conclusion below (see
  "Uncertainty flags").

## Gap this addresses

rocketry's fin pressure/base drag (`finPressureDragCd`/`finBaseDragCd` in
`src/physics/aero/fin-calc.ts`, exact ports of OpenRocket's
`FinSetCalc.calculatePressureCD`/`calculateComponentBaseCD`) computes a
drag *coefficient* keyed only to fin cross-section category
(square/rounded/airfoil) and Mach number — never to the fin's actual
thickness-to-chord ratio. Thickness itself only enters as an absolute
length in the area-scaling term `span * thickness / refArea`; the
coefficient multiplying that area is thickness-ratio-independent. This TN
was flagged in the prior NTRS search pass (`ntrs-search-pass.md`, item 1)
as the one candidate in that batch with a real closed-form wave-drag
equation driven by thickness-ratio shape, rather than a qualitative or
category-only result — worth a full read specifically to check whether it
could add that missing thickness-ratio term.

## The data

**This is not a general wave-drag formula for an arbitrary thin
lifting-surface planform. It is a delta-wing-specific result, and the
paper's own geometry (Figure 1, read directly) makes that concrete rather
than a labeling choice:**

- The planform is a true delta wing: both the leading edge and the
  "ridge line" (the locus of each streamwise station's point of maximum
  thickness) are straight lines radiating from a **common apex point**,
  at two different semiapex angles (`ε_LE` for the leading edge, `ε_RL`
  for the ridge line; `r = ε_LE/ε_RL`). The wing tip is a point — chord
  goes to zero there. This is fundamentally different from a
  trapezoidal fin (nonzero tip chord, no common apex for LE/TE/ridge
  line) or a freeform outline.
- Airfoil section is a symmetric double-wedge (biconvex diamond) — flat
  facets from leading edge to the ridge line and from the ridge line to
  the trailing edge, each facet's slope set by `t(y)/2` over the
  corresponding fore/aft chord fraction (equations 5a/5b, `p.5`, read
  directly).
- "Linearly varying thickness ratio" specifically means: local
  thickness-to-local-chord ratio `t(y)/c(y) = t_r/c_r + 2m̄y` is linear
  in the spanwise coordinate `y` (equation 4). Combined with the
  fixed-percent-chord ridge line, this makes the *ridge line's absolute
  height* trace a parabola across the span (stated explicitly in the
  Introduction and shown in Figure 3) — a specific, narrow shape family,
  not "any thickness distribution."
- The closed-form drag results (equations 24/26/28, `CD·β/τ² = F/G/H
  functions of (r,b)` depending on which of three Mach-cone-position
  cases applies) come from integrating the linearized supersonic
  source-distribution potential (equation 3, Puckett's method, ref. 1 —
  Puckett, "Supersonic Wave Drag of Thin Airfoils," J. Aero. Sci. 1946)
  over regions whose boundaries are Mach lines drawn **from the wing
  apex** (Figure 5's three integration-region cases, `b`⋛`1`, `a`⋛`1` —
  read directly). Those integration limits are geometrically tied to the
  apex-radiating leading edge and ridge line; they do not carry over to a
  planform with a finite tip chord without a distinct re-derivation NOT
  present in this paper.
- Even *within* its own applicability domain (true delta wings), the
  paper's headline result is a **comparative ratio**, not a standalone
  absolute-CD formula meant for direct use: `CD/CD'` (variable- vs.
  constant-thickness-ratio delta wing of identical planform, `r`, `b`,
  and either identical projected frontal area or identical internal
  volume — equations 33/41). The one absolute formula in the paper
  (`CD'β/τ'² = F1`, equation 32, for the *constant*-thickness-ratio
  delta wing) reduces to Puckett's own already-published 1946 baseline
  result when `m̄ = 0` (stated explicitly, p.16, and independently
  verifiable since it's a well-known result) — i.e. the genuinely *new*
  contribution of TN 2858 is specifically the spanwise-taper refinement
  on top of that baseline, not a new base formula.
- **The magnitude of that refinement, per the paper's own Concluding
  Remarks (p.23, quoted directly)**: on a fixed-frontal-area basis, drag
  reduction from optimizing the spanwise thickness taper is small to
  negligible in the practically realistic regime — "drag reduction which
  can be realized in this range is small" (subsonic ridge line case) and
  literally zero-benefit ("essentially optimum" to leave thickness ratio
  constant) when both leading edge and ridge line are supersonic. On an
  internal-volume-fixed basis the paper reports somewhat larger figures
  (8-20%), but only for shapes at or near the boundary of what the paper
  itself calls "not always practical or real" (concluding remarks, p.22)
  — the worked numerical example on p.22 explicitly states that an
  "unrealistic" `m̄` value area is where the larger drag-reduction numbers
  live, with the actually-computed realistic case giving a *1.77-1.89×
  drag increase*, not a reduction, when root thickness is simply
  increased under either delta-comparison convention. This is a small,
  second-order, comparative refinement result for one narrow planform
  family, not a general "thickness ratio drives supersonic fin drag by X%"
  formula.

## Accuracy impact

**None, directly.** This does not supply a formula that can be substituted
into or added onto rocketry's existing `finPressureDragCd`/
`finBaseDragCd`, because:
1. It only covers delta (point-apex, zero-tip-chord) planforms.
   rocketry's fin model is `TrapezoidalFinSet` (finite root/tip chord,
   sweep, span — never zero tip chord by construction) and
   `FreeformFinSet` (arbitrary outline). Neither maps onto this paper's
   geometry.
2. Even setting planform aside, rocketry's `Component` model stores a
   single scalar `thickness` per fin set (`FinDragGeometry.thickness:
   number` in `fin-calc.ts`) — there is no per-span-station thickness or
   thickness-ratio *distribution* in the data model at all. This paper's
   entire subject is how drag responds to *varying* that distribution
   spanwise; rocketry has no input that could drive such a term even if
   the planform match existed.
3. The refinement this paper quantifies, even where technically
   applicable, is second-order on top of an already-idealized biconvex
   double-wedge baseline (itself not rocketry's fin cross-section model,
   which is square/rounded/airfoil categories) — small enough that the
   paper's own conclusions call the realistic-case benefit "small" in the
   supersonic-both regime and flag the larger-percentage cases as
   physically unrealistic shapes.

## Implementation difficulty

**Not applicable — no implementation path from this report as written.**
Adopting anything from this paper for rocketry would require, at minimum:
(a) adding a true delta-wing-shaped fin-set type to the data model (not
currently supported, and no existing candidate/gap in DEVIATIONS.md asks
for one), (b) adding a per-span thickness-distribution input to that new
type, and (c) a wholly separate re-derivation of the source-distribution
integral (equation 3) over a trapezoidal or freeform integration region if
the goal were instead to generalize the *method* rather than use this
paper's delta-specific closed form directly — none of which this report
provides. This is a dead end for the immediate gap, not a scoped port
candidate.

## Other relevant physics

- The underlying tool — linearized supersonic source-distribution wave-drag
  theory (Puckett's method, the paper's own reference 1) — is a genuinely
  general technique in principle: it works from the same governing
  equation (1) and boundary condition (2)/(3) for *any* thin nonlifting
  symmetric surface, delta or otherwise. TN 2858 is simply one particular
  application of it (delta planform, double-wedge section, linear spanwise
  taper) chosen for its closed-form tractability, not evidence that the
  general method itself is delta-only. If fin-thickness wave drag becomes
  a real priority later, the productive path would be chasing Puckett's
  original 1946 paper (ref. 1 here: Puckett, A. E., "Supersonic Wave Drag
  of Thin Airfoils," J. Aero. Sci., vol. 13, no. 9, Sept. 1946, pp.
  475-484) directly, since it's the more general source and may already
  cover swept/tapered (non-delta) planforms that TN 2858 itself doesn't
  — this was not checked in this pass (out of scope: this task was
  specifically to read TN 2858, not chase its own references further).
- Confirms, independently, that classical linear supersonic wing theory
  treats sweep of the leading edge *and* of the thickness-distribution
  ridge line as two independently-tunable parameters (`ε_LE`, `ε_RL`) —
  consistent with how rocketry's own `finCNa1` supersonic K1/K2/K3 terms
  and `finCpShiftFraction` already treat fin sweep as the dominant
  supersonic shape parameter (`fin-calc.ts`), just for lift/CP rather than
  wave drag. No new insight for those existing formulas, but a mild
  independent confirmation their general theoretical lineage is sound.

## Uncertainty flags

- Appendix B's F/G/H-function closed forms (pages 27-32) were confirmed to
  exist and to be dense multi-term algebraic/logarithmic/inverse-trig
  expressions in `(r,b)`, consistent with the main text's description, but
  were not transcribed term-by-term — irrelevant to this report's
  conclusion (the planform mismatch alone rules out use, regardless of the
  functions' exact form), so full transcription wasn't a good use of
  effort here. If a future pass ever finds a genuine rocketry use for a
  true delta-wing fin shape, those pages would need a dedicated close read
  at that point.
- The 8-20% "internal volume basis" drag-reduction figures (p.23,
  conclusion 2) were read directly from the report's own stated
  conclusions, not independently re-derived from equations (33)/(41) —
  taken at face value from the primary source, standard practice for a
  report's own stated summary of its own results, but flagged since this
  pass didn't re-run the algebra to confirm the percentage independently.
- Pages 6-15 (the detailed Case I/II/III integral derivations, equations
  6-23) were read via OCR text extraction plus spot-checked page renders
  rather than every single line rendered as an image — sufficient to
  confirm the apex-anchored Mach-cone integration-region structure (the
  fact that matters for the generalizability question this task asked),
  but not a page-by-page verification of every intermediate algebraic
  step in that stretch.

## Verdict

**Documented dead end for this project's specific fin-shape model, not a
usable formula.** Real, correctly-verified-public-domain, correctly-read
1952 NACA physics — but delta-wing-specific by construction (point apex
shared by leading edge and thickness-ridge line, zero tip chord), and even
within that narrow domain the quantified benefit of the paper's own
contribution (spanwise-linear taper vs. constant thickness ratio) is small
in the realistic regime. Does not generalize to rocketry's actual
`TrapezoidalFinSet`/`FreeformFinSet` shapes, and rocketry's data model
(single scalar thickness per fin set) couldn't consume a thickness-ratio
*distribution* term even if the planform matched. This closes out the
"Gap 3" fin-thickness-drag lead from `ntrs-search-pass.md` as a negative
result rather than leaving it open.
