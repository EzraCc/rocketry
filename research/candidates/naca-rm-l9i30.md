# NACA RM L9I30 — zero-lift drag of fin-stabilized bodies of revolution, position-of-max-diameter sweep

## Source

Hart, Roger G., and Katz, Ellis R.: "Flight Investigations at High-Subsonic,
Transonic, and Supersonic Speeds to Determine Zero-Lift Drag of
Fin-Stabilized Bodies of Revolution having Fineness Ratios of 12.5, 8.91,
and 6.04 and Varying Positions of Maximum Diameter." NACA RM L9I30, Langley
Aeronautical Laboratory, November 30, 1949.

- NTRS: https://ntrs.nasa.gov/citations/20050019251
- PDF: https://ntrs.nasa.gov/api/citations/20050019251/downloads/20050019251.pdf
- **Public-domain status, quoted directly from the NTRS citation page**:
  Distribution Limits: "Public". Copyright Notice: "Work of the US Gov.
  Public Use Permitted."
- Originally classified CONFIDENTIAL; declassification stamp visible on
  page 2 of the scan itself: "Classification cancelled (or changed to)
  Unclassified... By Authority of NASA TechPubAnnouncement... 21 Oct 55."
  The black-bar redactions visible throughout the scan (covering
  "CONFIDENTIAL" stamps and some header/footer text) are leftover
  declassification-review artifacts, not missing/withheld scientific
  content — every data curve, table, and conclusion is intact and legible.
- 38 pages total (6 pages of body text, the rest figures). Read in full
  (rendered to page images with PyMuPDF, since the PDF is a 1949 scan with
  no reliable text layer — OCR text alone garbled the plotted curves and
  the redaction bars).

## Gap this addresses

rocketry currently has no data-driven treatment of *where along a body's
length the maximum diameter sits* as a drag factor. Its transonic/
supersonic pressure-drag model (`src/physics/aero/drag-calc.ts`,
`growingShapePressureCd` at line 211 and `boattailPressureCd` at line 238)
is an exact port of OpenRocket's own `calculatePressureCD`, driven by local
shoulder half-angle and fineness ratio at each shape transition — it has no
independent real-flight-test validation specific to *the position-of-max-
diameter question this report answers directly*.

## The data

Body shape: parabolic-arc nose and afterbody, meeting at the station of
maximum diameter.

```
0 < x < KL:   d = D - 2a(KL - x)²      (eq. 1)
KL < x < L:   d = D - 2b(KL - x)²      (eq. 2)
```
`D` = max diameter (7.5 in for every test body), `K` = station of max
diameter as a fraction of body length `L`, `a`/`b` = shape parameters
(in⁻¹, tabulated per configuration on p.3 of the report — 12 combinations
of fineness ratio {12.5, 8.91, 6.04} × K {0.20, 0.40, 0.60, 0.80}).

**Important caveat on how to read the CD values below**: this report's
`C_D` is the **total drag of the whole configuration — body + 3 fins (45°
sweptback, 1.69 sq ft exposed area) + interference — not body-alone**
(explicitly stated, p.4: "Drag coefficients have been based on body frontal
area... and represent the total drag of the configurations including fin
and interference drag"). There is no pressure/fin-alone breakdown in this
report (p.2: "the lack of pressure and fin drag data for the configurations
of these tests precludes a comprehensive analysis"). **This means these
numbers cannot be substituted directly as a body-alone pressure-drag term
in rocketry's per-component model** — they're a real, flight-test-measured
TOTAL-drag benchmark for a specific, precisely-defined shape family, useful
for validation/comparison, not a drop-in formula.

Method: real rocket-boosted models (3.25 in Mk. 7 sustainer + 5 in HVAR
booster), Wallops Island, Doppler radar drag reduction, body-length
Reynolds numbers 20×10⁶ to 85×10⁶ — genuine flight data, not a wind-tunnel
or theoretical estimate.

**Quantitative result (Figure 13, read directly off the plotted curves —
axis gridlines at 0.1 CD increments, so treat these as ±0.01–0.02
precision, not exact digitized values):**

| Fineness ratio | K=0.20 | K=0.40 | K=0.60 (min) | K=0.80 | M |
|---|---|---|---|---|---|
| 6.04 | 0.49 | 0.32 | **0.28** | 0.38 | 1.20 |
| 8.91 | 0.38 | 0.23 | **0.19** | 0.27 | 1.20 |
| 12.5 | 0.29 | 0.20 | **0.195** | 0.21 | 1.20 |
| 6.04 | ~0.55+ (off chart top) | 0.32 | **0.27** | 0.35 | 1.40 |
| 8.91 | 0.39 | 0.22 | **0.19** | 0.25 | 1.40 |
| 12.5 | 0.29 | 0.195 | **0.185** | 0.20 | 1.40 |

(M=1.55 curves are visually almost identical to M=1.40 in the report —
CD has essentially plateaued by then for all configurations.)

**Conclusions, quoted/paraphrased from the report's own Conclusions
section (p.5-6), all independently consistent with the table above:**
1. At supersonic speeds, K=0.60 (max diameter at 60% of body length) gave
   the least drag for every fineness ratio tested.
2. Position of maximum diameter has its *greatest* effect on drag for
   *low* fineness ratio bodies (K=0.20 vs K=0.60 is roughly a **2× drag
   penalty** at FR=6.04, but only ~1.5× at FR=12.5).
3. For a given position of maximum diameter, FR=12.5 bodies had the least
   drag at supersonic speed but the *most* at subsonic speed (a real
   crossover, not a monotonic "longer is always better" relationship).
4. Force-break Mach number (where drag rise begins) increases with
   increasing fineness ratio, for every K tested.
5. At subsonic speeds, the optimal K is NOT always 0.60 — the report
   explicitly flags the FR=12.5 group as an example where K=0.60 gave the
   *most* subsonic drag despite being best supersonically (p.5).

## Accuracy impact

Not a direct accuracy improvement to any existing formula — it's an
independent, real flight-test benchmark for TOTAL drag of a specific,
well-defined parametric body+fin shape family, which rocketry doesn't
currently have (its existing validation suite, `validation/openrocket-
comparison.test.ts`, checks against OpenRocket's own outputs, not against
independent flight-test data). Two realistic uses:
1. **Validation**: build the 12 exact test geometries (equations 1-2 +
   the parameter table, all in this file) in rocketry, add the same fins,
   run rocketry's own drag model, and compare predicted vs. measured CD
   across M=0.8–1.6. A close match would be real, independent evidence the
   whole transonic/supersonic pressure-drag pipeline is sound beyond the
   OpenRocket-output comparisons already in place; a systematic gap would
   point at exactly which regime (K value, fineness ratio) needs work.
2. **Design guidance**: the K≈0.55–0.60 minimum-drag result is a genuine,
   actionable, real-world design principle rocketry could surface to users
   designing a supersonic-capable rocket (e.g. a note/warning if a parsed
   rocket's max-diameter station is far from that range) — independent of
   whether the underlying drag formula itself changes at all.

## Implementation difficulty

- **Validation use**: low-medium. The 12 shapes are fully specified by
  closed-form equations + a parameter table — building them as `Component[]`
  test fixtures is mechanical. Digitizing the comparison curves precisely
  (beyond the ±0.01–0.02 gridline-reading precision here) would need
  higher-resolution page renders or careful pixel-measurement against the
  axes, not attempted in this pass.
- **Formula extraction for drag-calc.ts directly**: not applicable — see
  the total-vs-body-alone caveat above. There's no clean equation to port;
  this is empirical flight data for a specific shape family, and it doesn't
  decompose the way rocketry's own model does.

## Other relevant physics (beyond this specific gap)

- The report's own References section cites two earlier, closely-related
  papers by the same author, not yet checked: Katz, "Flight Investigation
  at High-Subsonic, Transonic, and Supersonic Speeds to Determine Zero-Lift
  Drag of Bodies of Revolution Having Fineness Ratio of 6.04 and Varying
  Positions of Maximum Diameter," NACA RM L9F02, 1949; and Katz, "Results
  of Flight Tests at Supersonic Speeds to Determine the Effect of Body Nose
  Fineness Ratio on Body and Wing Drag," NACA RM L7B19, 1947 — the second
  one specifically isolates *nose* fineness ratio's effect on drag, which
  could be directly relevant to rocketry's nose-cone-shape drag handling.
  Worth a follow-up NTRS lookup, not done in this pass.
- The subsonic-vs-supersonic K optimum *crossover* (conclusion 3/5 above)
  is a genuinely non-obvious, real result — worth keeping in mind for ANY
  future "optimize this rocket's shape" feature, since a single "always do
  X" rule would be wrong depending on the target flight regime.

## Uncertainty flags

- CD values in the table above were read directly off 1949 hand-plotted
  curves on a 0.1-CD-gridline chart (Figure 13, panels a/b/c) — treat as
  ±0.01–0.02, not exact. Good enough to confirm the qualitative pattern and
  rough magnitude, not precise enough for a tight numerical validation
  tolerance without re-digitizing from a higher-resolution scan.
  Individual-curve figures (8, 9, 10 — CD vs Mach per configuration) were
  spot-checked (fineness-12.5/K=0.20 and fineness-8.91/K=0.40 in this pass)
  but not all 12 were individually transcribed; Figure 13's three summary
  panels were prioritized since they directly answer the position-of-max-
  diameter question in one place.
- No pressure or fin-alone breakdown exists in this report at all (stated
  limitation, not an extraction gap on this end) — confirmed by the text,
  not assumed.
- Figures 4-7 (photographs, Reynolds number vs. Mach) and figures 8a(c-d)/
  9(a,c,d)/10/11/12 (the per-configuration and per-fineness-ratio grouped
  curves) were not all individually read in this pass — Figure 13's three
  panels were sufficient to extract the report's central, actionable
  result. A future pass could digitize the remaining curves for a fuller
  CD(M) dataset per configuration if the validation use case (above)
  proceeds.
