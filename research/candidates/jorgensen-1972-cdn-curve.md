# NASA TN D-6996 — Jorgensen's "state-of-the-knowledge" Cdn(Mn, Ren) plots (reference 9 of TN D-7228)

## Source

Jorgensen, Leland H.: "Prediction of Static Aerodynamic Characteristics for
Space-Shuttle-Like and Other Bodies at Angles of Attack From 0° to 180°."
NASA TN D-6996, Ames Research Center, January 1973 (Ames report no. A-4500).

- NTRS: https://ntrs.nasa.gov/citations/19730006261
- PDF: https://ntrs.nasa.gov/api/citations/19730006261/downloads/19730006261.pdf
- **Public-domain status, quoted directly**: NTRS citation page — Distribution
  Limits: "Public". Copyright Notice: "Work of the US Gov. Public Use
  Permitted." Independently cross-checked against the report's own Standard
  Form 298 (page 2 of the PDF, block 18, Distribution Statement): **"Unclassified
  — Unlimited."** Never classified — same status as TN D-7228, published from
  the start with no declassification history.
- 44 numbered pages (50-page PDF including cover/blank pages), a 1973 scan
  with a genuinely usable (if visually messy — words frequently run together,
  no spaces) OCR text layer — `page.get_text()` via PyMuPDF returned readable
  prose for essentially every page, unlike TN D-7228's page-image-only
  approach. The four key figures (crossflow-drag plots, Figs. 1-4) were
  additionally rendered to page images (PyMuPDF, 3x zoom) and read visually,
  since plotted-curve data can't be extracted from a text layer at all. Read:
  cover, SF298, table of contents, Summary, Introduction, the full "Procedure
  and Formulas" section including all of the "Crossflow drag coefficient,"
  "Crossflow drag proportionality factor," and "Relative influence of
  crossflow terms" subsections, Figures 1-5 (visually), the Reynolds-number
  verification section (pp. 30-33), Concluding Remarks, and the full
  Reference list (48 entries). Not read in detail: the Appendix (tangent-ogive
  geometry formulas — not relevant here, already covered via TN D-7228) and
  Figures 6-19 (elliptic-cross-section tables, the nine-body comparison plots,
  and the shuttle-body Reynolds-number-effect plot) beyond what's summarized
  in the prose.

## How this was found

Confirmed directly from TN D-7228's own reference list (p.14 of that report,
read from the rendered page image, not assumed): **reference 9 is exactly
this report**, cited verbatim as "Jorgensen, Leland H.: Prediction of Static
Aerodynamic Characteristics for Space-Shuttle-Like and Other Bodies at Angles
of Attack From 0° to 180°. NASA TN D-6996, 1973." This is a same-year (1973),
same-author, same-institution predecessor report — not the ~1971-1972 report
originally guessed at in this task's framing; TN D-6996 was submitted to
Ames in **August 1972** (per its own closing line, p.33: "Ames Research
Center... Moffett Field, California, August 9, 1972") and published in
January 1973, three months before TN D-7228's April 1973 publication — so
the "~1971-1972 Jorgensen report" framing was directionally correct even
though the print date reads 1973.

## Gap this addresses

Directly closes the one blocking dependency flagged in
[`jorgensen-tn-d7228.md`](jorgensen-tn-d7228.md)'s own "Implementation
difficulty" and "Uncertainty flags" sections: TN D-7228's equations (1) and
(7) need `Cdn(Mn, Ren)` — the crossflow drag coefficient of a 2-D circular
cylinder — and explicitly delegate that data to "reference 9" rather than
including it. This report **is** reference 9, and it is exactly the compiled
"state-of-the-knowledge plots" TN D-7228 refers to, in the author's own words
(TN D-6996, p.4): *"For circular cylinders, 'state-of-the-knowledge' plots
have been prepared for the variation of Cdn with Mn and Ren (figs. 1-3)."*
It also supplies the crossflow drag **proportionality factor** η vs.
length-to-diameter ratio (Fig. 4) — the second piece TN D-7228 flagged as
needed for subsonic Mach ("η ... needs a length/width-ratio lookup at
subsonic Mach") but did not itself provide numbers for.

Both reports use identical notation and near-identical governing equations
(TN D-6996 eq. 1/4/5 for `CN`/`Cm` at 0°-180° are the same functional form as
TN D-7228 eq. 1, just generalized to the full angle range with the `α'`
substitution for α>90°) — confirming these are the same physical model, not
just two loosely related reports.

## The data

**This report does not give a closed-form fit for Cdn(Mn, Ren) anywhere —
it is purely graphical.** Three figures, each visually read from a 3x-zoom
page render (not the text layer, which cannot represent plotted curves):

### Figure 1 — Cdn vs. crossflow Mach number Mn (p.5 of the report)

Compiled from six experimental sources (references 10-15: Lindsey NACA Rep.
619; Stack NACA ACR 1941; Gowen & Perkins NACA TN 2960; Walter & Lange NAVORD
Rep. 2854; Penland NACA TN 3861; Welsh — flight test — NACA TN 2941) plus two
theoretical reference curves. Approximate values read directly off the
plotted curve (gridlines at 0.4 major/finer minor divisions on both axes —
treat as **±0.05-0.1**, not exact, especially in the sharp-dip and peak
regions):

| Mn | Cdn | Regime / source |
|---|---|---|
| 0.0 | ~1.15 | low-subsonic baseline |
| 0.2 | ~1.2 | Lindsey (circles) |
| 0.3 | ~0.4 | Stack (squares) — sharp drop begins |
| 0.35 | ~0.3 | Stack — trough, explicitly labeled on the figure as "crossflow Reynolds number in critical Reynolds number range" |
| 0.4 | ~0.4 | Stack — recovering |
| 0.5 | ~1.0 | steep recovery |
| 0.6 | ~1.4 | Gowen & Perkins (diamonds) |
| 0.7 | ~1.6 | Gowen & Perkins — local peak |
| 0.8 | ~1.5 | slight pullback |
| 0.9-1.0 | ~2.1 | Welsh flight test (dashed) — the transonic peak |
| 1.2 | ~1.75 | falling from the transonic peak |
| 1.4 | ~1.55 | |
| 2.0 | ~1.45 | |
| 2.4-2.8 | ~1.35-1.4 | Walter & Lange (triangles) |
| 3.2-4.8 | ~1.3-1.35 | approaching the Newtonian asymptote |
| 5-7 (inset detail chart) | ~1.2-1.3 | Penland at Mn≈6.86: Cdn≈1.2 |

**Theory curves also plotted, and these ARE closed forms**:
- Newtonian flow: **Cdn = 4/3 ≈ 1.333** (Mach-independent constant — the
  classical 2-D Newtonian-impact result for a circular cylinder).
- Modified Newtonian flow: **Cdn = (2/3)·Cp,stag(Mn)**, where Cp,stag is the
  stagnation-point pressure coefficient behind a normal shock (standard
  compressible-flow/Rayleigh-Pitot relation, a function of Mn alone) — this
  curve is Mach-dependent, starting below the data (~1.0 near Mn≈1.2) and
  asymptotically converging toward the data and the Newtonian value at high
  Mn.

The critical takeaway, stated by the report itself and visually obvious in
the figure: **Cdn is emphatically not a single constant** — it swings from
~1.2 down to ~0.2-0.3 and back up past 2.0 across the transonic range alone,
which is exactly the physical richness rocketry's current flat
`BODY_LIFT_K = 1.1` constant cannot represent.

### Figure 2 — Cdn vs. crossflow Reynolds number Ren, subcritical (Mn ≤ 0.4) (p.6)

The classical 2-D circular-cylinder "drag crisis" curve (compiled from refs.
11, 16-21: Relf, Wieselsberger NACA TN 84, Polhamus NASA TR R-29, Roshko J.
Fluid Mech. 1961, Schmidt NASA TM X-57,779, Jones/Cincotta/Walker NASA TR
R-300). Log-Re₁ x-axis (10⁴-10⁷), fine engineering-paper gridlines
(**±0.02-0.05** precision):

| Ren | Cdn | Note |
|---|---|---|
| 1×10⁴ | ~1.15 | |
| 3×10⁴-1×10⁵ | ~1.2 | flat plateau (Wieselsberger) |
| 1.5×10⁵ | ~1.15 | drop begins |
| 2×10⁵ | ~0.9 | |
| 2.5×10⁵ | ~0.6 | |
| 3×10⁵-4×10⁵ | ~0.25-0.4 | steep drop-crisis region |
| 4×10⁵-5×10⁵ | **~0.2 (minimum)** | text quotes "between about 0.15 and 0.30" |
| 7×10⁵ | ~0.3 | Polhamus |
| 1×10⁶ | ~0.35 | start of wide shaded uncertainty band |
| 2×10⁶ | ~0.45 | |
| 3×10⁶ | ~0.5 | |
| 5×10⁶ | ~0.6 | |
| 1×10⁷ | ~0.55-0.8 | wide shaded band (Roshko upper bound ~0.8) |

Report's own quoted text nails down the two landmark values precisely (p.5):
*"Cdn ≃ 1.2 for laminar boundary-layer flow and separation just before the
critical Reynolds number of about Ren = 2×10⁵... From the low Cdn value
between about 0.15 and 0.30, Cdn increases gradually, at least for increase
in Ren up to about 5×10⁶."* The report explicitly flags real, sizeable
**uncertainty** in the supercritical region (Ren > 2×10⁵) via the shaded band
in the figure itself — not a clean single-valued curve there.

### Figure 3 — Cdn vs. Ren, supercritical, parametrized by Mn = 0.25-0.50 (p.6)

Reproduced directly from Jones, Cincotta & Walker (NASA TR R-300, ref. 21) —
freon-gas wind-tunnel data reaching Ren up to 10⁸. Shows a real, distinct
per-Mach-number local peak (Cdn spiking to ~0.6-1.2 around Ren = 5-7×10⁶
depending on Mn) before settling to Cdn ≈ 0.55-0.65 by Ren ≈ 10⁷ — the report
explicitly defers interpretation to the source (p.7: "The reader is referred
to reference 21 for their interpretation of these Cdn results"). Genuinely
noisier/less clean than Figure 2; not independently re-digitized beyond this
general shape in this pass.

### Figure 4 — Crossflow drag proportionality factor η vs. length-to-diameter ratio (p.7)

This is the **second missing piece** flagged in `jorgensen-tn-d7228.md`
(η, the finite- vs. infinite-cylinder crossflow-drag ratio, subsonic Mach
only — supersonic/hypersonic η≈1 was already confirmed in that file). Two
near-identical curves (circular cylinder at Ren=88,000, and flat plate at
Ren=68,000-170,000), from Goldstein's "Modern Developments in Fluid Dynamics"
(ref. 22, 1938) — gridlines at intervals of 4 on x, 0.2 on y (**±0.02-0.03**):

| L/d | η |
|---|---|
| 2 | ~0.58 |
| 4 | ~0.62 |
| 6 | ~0.64 |
| 8 | ~0.66 |
| 10 | ~0.68 |
| 12 | ~0.70 |
| 16 | ~0.72 |
| 20 | ~0.76 |
| 28 | ~0.78 |
| 40 | ~0.82 |

Report's own caveat (p.7, quoted directly): *"In spite of a dearth of η data
throughout the subsonic Mach number regime, the results given in figure 4
have been used to successfully predict, for most engineering purposes, the
aerodynamic characteristics of bodies of revolution at subsonic Mach numbers."*
This curve was measured at essentially incompressible, very-low-subsonic Mach
only (refs. 22-23) — there is no Mach dependence built in at all, just an
L/d lookup, applied uniformly across the subsonic range as an engineering
approximation.

## Accuracy impact

Same underlying impact already identified in `jorgensen-tn-d7228.md` §
"Accuracy impact" — this file supplies the actual numbers that make that
impact realizable rather than aspirational. Concretely: Figure 1 shows Cdn
swinging by more than a factor of 5 (from ~0.3 up to ~2.1) across a
realistic hobby/high-power rocket Mach range (Mn = crossflow Mach = M∞·sinα,
so even modest α at transonic M∞ lands squarely in this range) — rocketry's
flat `BODY_LIFT_K=1.1` cannot represent any of that variation. The
low-Reynolds-number "drag crisis" trough (Figure 2, Cdn dropping to ~0.2-0.3)
is also directly relevant: body-tube crossflow Reynolds numbers for
typical hobby-rocket diameters at flight speeds can plausibly sit in or near
that critical range, meaning the constant-K model could be off by roughly
4-5x in the wrong direction for exactly the diameter/speed combinations
common in this domain — this is a bigger, more concrete number than the
"real, but not yet quantified" framing in the parent doc.

## Implementation difficulty

**Still medium, not low — the data dependency is now resolved, but only as
graphical/tabular data, not a formula.** What changed: the "one real data
dependency... NOT yet resolved" flagged in `jorgensen-tn-d7228.md` now has
concrete numbers (the tables above). What's still required before this could
become code:
- **No closed-form fit exists in either Jorgensen report.** A real
  implementation needs either (a) a lookup table + interpolation (most
  faithful to the source, but needs many more digitized points than
  extracted in this pass — the tables above are illustrative/coarse, not a
  production-ready dataset), or (b) a independently-sourced curve fit to the
  same classical cylinder-drag-crisis data (several exist in the broader
  aerodynamics literature, e.g. Hoerner's or standard textbook Cd(Re) fits
  for circular cylinders — `hoerner-fluid-dynamic-drag.md` in this same
  directory may already have exactly this, worth cross-checking before
  building a new table from these two reports' plots).
- **Higher-precision digitization** would be needed for either path — the
  values above were read by eye off 3x-zoom page renders, sufficient to
  confirm shape and rough magnitude (consistent with how
  `naca-rm-l9i30.md` treats its own comparably precise plot-reading) but not
  tight enough for a production numerical table without a further, more
  careful re-digitization pass (pixel-level curve tracing).
- **η (Figure 4) has the same limitation** — a coarse table above, same
  need for tighter digitization or an independent closed-form source before
  use.
- The Mn-Ren joint dependence (Figures 2 vs. 3) is itself awkward to
  implement cleanly: Figure 2 covers Mn≤0.4 as one curve (Mn treated as
  negligible), Figure 3 gives distinct curves per discrete Mn from 0.25-0.50,
  and Figure 1 covers everything but is only valid where Reynolds effects are
  small. There's no single unified `Cdn(Mn, Ren)` surface in the source — it's
  three separate 2-D slices the reader is expected to reconcile by
  engineering judgment, which is a real design decision for any port, not
  just a data-extraction problem.

## Other relevant physics

- TN D-7228 (the report this file directly follows up on) has its own,
  separate reference list (Table 4, p.14 of that report) of sources for
  Cdn data for **noncircular** cross sections (elliptic, square-with-rounded-
  corners, etc.) — Lindsey (ref. 10 shared with this report), Polhamus (refs.
  18/44/45), Delany & Sorensen (ref. 44 = ref. 13 in `naca-rm-l9i30.md`'s own
  numbering — same underlying NACA TN 3038 report, already in this project's
  candidate list as `hoerner-fluid-dynamic-drag.md`'s neighbor). Not read in
  this pass — noncircular cross sections are out of scope for rocketry's
  circular-body-tube use case, but worth knowing this exists if noncircular
  fuselages/airframes are ever supported.
- TN D-6996 itself is written specifically for the shuttle-booster reentry
  problem (0°-180° angle of attack, very high subsonic-to-hypersonic Mach
  spread on a single flight) — its Reynolds-number-effect section (pp. 30-33,
  Figure 19) documents a real, large, experimentally-verified effect: for a
  flat-bottomed shuttle-type body, increasing Re from 10⁵ to 10⁶ was measured
  to cut normal-force coefficient at α≈90° by up to 75%, a striking
  real-world confirmation that the critical-Reynolds-number "drag crisis"
  isn't just a 2-D-cylinder theoretical curiosity — it visibly changes
  whole-body aerodynamics. Only reaches the α=35°-75° range in the cited
  experimental data (ref. 3, Jorgensen & Brownson NASA TN D-6615, 1972 — a
  Reynolds-number/body-corner-radius study, not read in this pass) — a
  possible further-follow-up if very-high-α, low-Mach behavior ever becomes
  relevant to rocketry (e.g. post-apogee tumbling, currently explicitly
  out-of-scope per `DEVIATIONS.md`'s "Everything else checked" section).
- The report's Concluding Remarks explicitly flag that its whole approach
  (Allen's crossflow method) has essentially no experimental verification
  above α≈20° for the CN/Cm prediction itself, independent of the Cdn-curve
  question — a real, honestly-disclosed limitation of the underlying method,
  not just an implementation detail of this specific data.

## Uncertainty flags

- **All numeric values in the tables above are eyeballed off page-image
  renders of 1972-vintage hand-plotted figures, not pixel-measured or
  algorithmically digitized.** Treat every number as an order-of-magnitude/
  shape confirmation, not a production-ready dataset — explicitly flagged
  the same way `naca-rm-l9i30.md` flags its own comparable Figure-13
  readings, and for the same reason (gridline density, not source
  reliability, is the limiting factor).
- **No closed-form Cdn(Mn, Ren) fit exists in this report or in TN D-7228** —
  confirmed directly by reading both reports' full text, not inferred from
  absence. Any eventual rocketry implementation needs either a genuine
  lookup-table port (more digitization work than done here) or a
  cross-check against a different source that does supply a fit (Hoerner's
  book, already a rocketry candidate doc, is the obvious next check — not
  done in this pass, kept in scope as research-only per this task's
  instructions).
- Figures 6-19 of TN D-6996 (the actual nine-body computed-vs-experimental
  comparison, and the detailed shuttle-body Reynolds-number verification
  plot) were not individually digitized in this pass — summarized from the
  report's own prose only, same caveat pattern as `jorgensen-tn-d7228.md`'s
  treatment of ITS figures 7-16.
- Figure 3's per-Mach-number curves are visually noisier and less confidently
  read than Figures 1/2/4 — the report itself defers their physical
  interpretation to the original source (ref. 21) rather than explaining the
  local peak, and this pass did not chase that source down.
- References 10-21 (the primary experimental sources Figures 1-3 are
  compiled from: Lindsey, Stack, Gowen & Perkins, Walter & Lange, Penland,
  Welsh, Relf, Wieselsberger, Polhamus, Roshko, Schmidt, Jones/Cincotta/
  Walker) were identified by full citation from this report's own reference
  list but **not independently tracked down and read** — TN D-6996 is being
  treated here as an adequate compiled/secondary source for this data, the
  same way TN D-7228 itself treats TN D-6996. This is one link further from
  the truly original raw data than this project's usual "read the primary
  source directly" standard, and is flagged explicitly rather than glossed
  over — if the coarse-precision digitization above ever needs replacing
  with something tighter, going to one of these original sources (most were
  publicly-issued NACA/NASA reports themselves) would be the way to do it,
  not re-digitizing this report's compiled plots.
