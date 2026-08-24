# NACA RM E51C06 — boattail/afterbody drag and CP wind-tunnel data (positive finding: a real, quantified gap in rocketry's ported boattail formula)

## Source

Cohen, Robert J.: "Aerodynamic Characteristics of Four Bodies of Revolution
Showing Some Effects of Afterbody Shape and Fineness Ratio at Free-Stream
Mach Numbers from 1.50 to 1.99." NACA RM E51C06, Lewis Flight Propulsion
Laboratory, May 22, 1951.

- NTRS: https://ntrs.nasa.gov/citations/19930086608
- PDF: https://ntrs.nasa.gov/api/citations/19930086608/downloads/19930086608.pdf
- **Public-domain status, quoted directly from the NTRS citation page**:
  Distribution Limits: "Public". Copyright Notice: "Work of the US Gov.
  Public Use Permitted." Declassification information: none indicated in
  NTRS's own metadata.
- **Worth flagging explicitly, unlike every other source read in this batch
  so far**: the physical PDF carries a struck-through "CONFIDENTIAL"
  classification stamp on every page header and footer — this is a
  Korean-War-era Research Memorandum that was originally classified and
  later declassified by NACA's own stamping process (routine practice for
  RM-series reports of this vintage). Checked directly against NTRS's
  current citation metadata rather than assuming the stamp implies any
  ongoing restriction: current Distribution Limits is "Public" with no
  declassification caveat, same rights statement as every other source in
  this project's reference list. Confirmed clean, but recorded here since
  it's a materially different provenance story than the other read sources
  (which were never classified at all) and this project's own standard is
  to verify individually, not assume.
- 32-page 1951 scan, badly garbled OCR text layer (heavy character
  substitution, e.g. "IWCA" for "NACA," "8~/S~" for "S_b/S_max") but legible
  enough for prose skimming. Read: title page, full Summary, Symbols list
  (page 3, rendered as an image — confirms all coefficients including
  boattail surface pressure drag `Cd,p` are referenced to `S_max`, the
  body's own maximum cross-sectional area, the standard convention for this
  report family), Methods and Procedure, Results and Discussion (all of it,
  via OCR text plus spot-check image renders), Summary of Results, and
  Table I (model contour equations and ordinates, rendered as an image —
  needed to extract exact boattail geometry, see below). Figures read as
  3x-zoom page-image renders: Figure 4 (CP location vs. AOA, cylindrical vs.
  boattail) and Figure 9 (drag-coefficient breakdown vs. Mach, all four
  models plus an external NACA RM-10 reference body). Not individually
  digitized: Figures 2/3/5-8/10-11 (lift, pitching-moment, base-pressure
  detail plots) beyond what the prose summarizes — this report's genuinely
  new contribution for rocketry's purposes is the boattail pressure-drag
  and CP-shift data specifically, not the full lift-curve dataset, so those
  weren't a good use of effort to re-digitize here.

## Gap this addresses

Recommended in `ntrs-search-pass.md` as a complement to `naca-rm-l9i30.md`
(already read, whole-body max-diameter-position drag finding), specifically
for the boattail/afterbody region. Directly relevant to rocketry's
`boattailPressureCd()` in `src/physics/aero/drag-calc.ts` (lines 238-243) —
an exact port of OpenRocket's own `SymmetricComponentCalc` boat-tail
pressure-drag branch:

```ts
function boattailPressureCd(mach: number, fineness: number): number {
  if (fineness >= 3) return 0;
  const cd = baseDragCoefficient(mach);
  if (fineness <= 1) return cd;
  return (cd * (3 - fineness)) / 2;
}
```

where `fineness = c.length / (2 * Math.abs(r1 - r0))` — the boattail
segment's own local length-to-radius-change ratio. This formula asserts a
**hard zero** for any boattail with `fineness >= 3`: a sufficiently gradual
taper is modeled as contributing no pressure drag of its own at all,
independent of Mach number.

## The data

**Extracted the exact geometry of this report's own boattail models from
Table I** (read as a page image, not OCR — the equations and ordinate
tables are dense and OCR-unreliable) to compute their `fineness` value in
rocketry's own terms, for a direct, same-convention comparison:

- Model 1 (fineness-ratio-12.2 body, `S_b/S_max = 0.367`): boattail spans
  model station 61.25 to 73.25 (length 12.0), radius 3.000 → 1.818
  (radius change 1.182).
- Model 3 (fineness-ratio-14.2 body, same `S_b/S_max = 0.367`): boattail
  spans station 73.00 to 85.00 (length 12.0), radius 3.000 → 1.818 — **the
  identical local taper shape as model 1**, just appended after a longer
  upstream cylindrical section (hence the different whole-body fineness
  ratio).

Computed fineness the same way rocketry does: `fineness = length / (2 *
|Δr|) = 12.0 / (2 * 1.182) = 5.076` for both models. **This is well above
rocketry's `fineness >= 3` zero-cutoff.**

**Figure 9(d)** ("Boattail surface pressure drag," `Cd,p`, referenced to
`S_max` — confirmed from the Symbols page, the same reference-area
convention as rocketry's `refArea`, making this a clean apples-to-apples
comparison) shows, read directly off the 3x-zoom page render, roughly flat
across Mach 1.50–1.99:

| Model | Body fineness | Boattail fineness (computed) | Measured Cd,p |
|---|---|---|---|
| 1 | 12.2 | 5.076 | **~0.05–0.06** |
| 3 | 14.2 | 5.076 (same local shape) | **~0.02–0.025** |

**Both are clearly nonzero**, despite both having a boattail fineness well
past rocketry's zero-cutoff threshold of 3. rocketry's ported formula would
predict `Cd,p = 0` for either.

**A second, independent finding, not implied by the formula's structure at
all**: models 1 and 3 have the *exact same local boattail geometry*
(same length, same radius change, same fineness) — the only difference is
the length of straight cylindrical body ahead of the boattail. Yet the
measured `Cd,p` differs by roughly 2-2.5x between them (~0.05-0.06 vs.
~0.02-0.025). rocketry's `boattailPressureCd(mach, fineness)` takes only
the boattail's own local fineness as input — it has no way to represent an
upstream-body-length dependence, but this report's own data shows that
dependence is real and not small.

**Context from Figure 9(a)** (total drag coefficient): boattailing (models
1/3) reduces total CD from ~0.25 (cylindrical models 2/4) to ~0.15–0.18 — a
roughly 30-40% total-drag reduction at these Mach numbers, driven mostly by
the base-drag reduction (Figure 9(b): cylindrical models' base `Cd,b` ≈
0.15-0.17 vs. boattail models' ≈ 0-0.05) partially offset by the fore-drag
increase (Figure 9(c): boattail ≈0.15-0.17 vs. cylindrical ≈0.10). The
missing `Cd,p` term (~0.05-0.06 for model 1) is a meaningful fraction —
roughly a quarter to a third — of that model's *total* drag coefficient,
not a negligible rounding-level effect.

**Center-of-pressure / method-accuracy finding (Figure 4, text pp. 8, read
directly)**: comparing measured CP location against both linearized
potential theory and "the method of reference 1" (Allen's viscous-crossflow
method — same lineage as rocketry's already-ported Jorgensen/Galejs body
lift term):
- For **cylindrical** afterbody models, potential theory predicts CP
  location fairly accurately.
- For **boattailed** models, potential theory places CP too far forward at
  every Mach number and AOA tested; **Allen's method (reference 1) tracks
  the boattail CP shift with angle of attack "reasonably well"** but is
  itself consistently too far forward of the base at every condition
  tested.
- Quoted directly (p.8): cylindrical-afterbody CP shifted rearward by "about
  4 percent of the model length" as Mach rose 1.50→1.99; boattail-model CP
  shifted rearward by "approximately 18 percent of the body length at the
  low angles of attack to 10 percent at the higher angles of attack" over
  the same Mach range — a much larger, AOA-dependent effect for boattailed
  bodies that neither theory fully captures.

## Accuracy impact

**Real and quantified, not speculative.** For any rocket with a boattail
whose local fineness ratio is ≥3 (a fairly common case — gentle boattails
are common on multi-stage rockets, e.g. a stage's aft closure tapering down
to a smaller-diameter interstage or motor mount), rocketry's current model
predicts **zero** additional pressure drag from that surface, while this
report's actual wind-tunnel data on a fineness-5.08 boattail shows a
nonzero `Cd,p` of order 0.02-0.06 (`S_max`-referenced) — roughly a quarter
to a third of that specific configuration's total drag coefficient. This
isn't a edge-case/extrapolation concern; fineness 5.08 is squarely inside
the range rocketry's formula treats as "zero contribution," and it's not
an unusually slender boattail shape.

The CP-shift finding is a second, independent gap: rocketry's own
Allen/Jorgensen-lineage crossflow method (already ported for body lift) is
shown by this report's own data to be systematically CP-forward-biased for
boattailed bodies specifically, even though it tracks the *trend* with AOA
reasonably well — a real, quantified limitation of a method rocketry
already relies on, not a new method to add.

## Implementation difficulty

**Medium.** This report does not supply a general closed-form
`Cd,p(fineness, Mach)` formula that could directly replace rocketry's
zero-cutoff — it's wind-tunnel data for exactly two (local-geometry-
identical) boattail configurations at four Mach numbers, not a fitted
curve. Concretely, closing this gap would need either:
1. A literature search for a general boattail pressure-drag correlation
   that doesn't hard-zero at moderate fineness (the "Payne correlation" /
   NSWC TR-81-156, named but not equationed in `missile-datcom-manual.md`,
   remains the most promising unread lead for this specific purpose — this
   report doesn't replace that need, it just confirms the need is real), or
2. Treating this report's own two data points as an empirical correction
   factor specifically for gentle (fineness > 3) boattails, acknowledging
   it's based on only two tested geometries at one narrow Mach range
   (1.50-1.99) and won't generalize with confidence outside that.
Either path is a real, separate implementation task — not something to
extract directly from this report alone.

## Other relevant physics

- The report's own comparison against "NACA RM-10 (references 2 and 3)" —
  a previously-published body with a different boattail — in the same
  Figure 9, and the Summary's mention of "decreasing the boattail
  convergence from 0.174 to 0.074," indicates this was part of a longer
  NACA Lewis research program on afterbody shape, not a standalone study.
  References 2/3 (the RM-10 reports) weren't chased down in this pass —
  flagged as a possible further lead if boattail drag becomes a priority,
  since they may contain the wider convergence-ratio sweep this single
  report only partially shows.
- Confirms (independently of Jorgensen/TN-D6996) that Allen's crossflow
  method has known, real, quantified limitations specifically for
  non-cylindrical (boattailed) afterbodies — useful corroborating context
  for how much confidence to place in rocketry's own Galejs/Jorgensen-
  lineage body-lift term for tapered aft sections.

## Uncertainty flags

- **All `Cd,p` and CP-location numbers above are eyeballed off 3x-zoom page
  renders of a 1951 hand-plotted figure**, not pixel-digitized — same
  caveat and same reason (gridline density, not source reliability) as
  every other plot-reading in this project's candidate docs. Treat as
  order-of-magnitude/shape-confirmed, not production-ready constants.
- The exact definition of "boattail convergence" (the 0.174/0.074 figure
  quoted in the Summary) was not found explicitly defined on the Symbols
  page and wasn't chased further — flagged rather than guessed at.
- Models 1 and 3's *local* boattail geometries were confirmed identical by
  direct computation from Table I's own equations/ordinates (high
  confidence, this is arithmetic on the report's own numbers, not a
  plot-reading), but *why* the measured `Cd,p` differs between them by
  ~2-2.5x (upstream boundary-layer state? Reynolds number difference —
  Table II shows model 3's test Re is meaningfully higher than model 1's
  at every Mach number? interference from the longer forebody's own
  shock structure?) was not analyzed in this pass — reported as an
  observed effect, not an explained one.
- References 2/3 (NACA RM-10 reports) and the "method of reference 1"
  (Allen's original method) were cited but not independently read in this
  pass — treated as this report's own secondary sources, consistent with
  how `jorgensen-1972-cdn-curve.md` treats TN D-6996's own reference list.

## Verdict

**Positive finding — a real, quantified, well-evidenced gap in rocketry's
currently-ported boattail pressure-drag formula**, unlike TN-2858's dead
end. rocketry's `boattailPressureCd()` zero-cutoff at `fineness >= 3` is
contradicted by this report's own wind-tunnel data on a fineness-5.08
boattail (measured `Cd,p` ≈0.02-0.06, not zero) — a discrepancy worth
roughly a quarter to a third of that configuration's total drag
coefficient, not a rounding-level effect. Does not, by itself, supply a
ready replacement formula (it's two data points, not a curve fit) — closing
this gap needs either the still-unread "Payne correlation" lead or a
dedicated empirical-correction pass built on this report's own numbers,
scoped as separate follow-up work, not bundled into this research pass.
