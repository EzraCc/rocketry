# NASA TN D-7228 — Jorgensen slender-body method (viscous crossflow), 0°-90° AOA

## Source

Jorgensen, Leland H.: "A Method for Estimating Static Aerodynamic
Characteristics for Slender Bodies of Circular and Noncircular Cross
Section Alone and With Lifting Surfaces at Angles of Attack from 0° to
90°." NASA TN D-7228, Ames Research Center, April 1973.

- NTRS: https://ntrs.nasa.gov/citations/19730012271
- PDF: https://ntrs.nasa.gov/api/citations/19730012271/downloads/19730012271.pdf
- **Public-domain status, quoted directly**: NTRS citation page —
  "Work of the US Gov. Public Use Permitted." Report's own Standard Form
  298, block 18 (Distribution Statement): **"Unclassified — Unlimited."**
  Never classified at all (unlike NACA-RM-L9I30, which was declassified
  later) — this one was public from publication.
- 40-page scanned PDF, no reliable text layer (rendered to page images
  with PyMuPDF and read directly — same approach as NACA-RM-L9I30). Read:
  cover, SF298, table of contents, Summary, Introduction, the full
  "Procedure and Formulas" section (body-alone method, general case,
  winged-body special case), Figure 1 (elliptic cross-section ratio
  curves), and the "Computation of Aerodynamic Characteristics" +
  "Comparison of Computed With Experimental" sections. Not read in full:
  the detailed comparison figures/plots themselves (7-16) and the
  reference list (p.14) — see Uncertainty flags.

## Gap this addresses — and a real, direct connection to existing rocketry code

**This is the actual lineage behind rocketry's existing Galejs body-lift
term** (`src/physics/aero/symmetric-component-calc.ts`, `BODY_LIFT_K =
1.1`, quadratic-in-AOA body lift, `sinAlphaSincAlpha` helper — see that
file's own extensive doc comment about the mistake made and corrected
while porting it). Confirmed by actually reading the math, not assumed:

**Jorgensen's equation (1)** (p.3, body-alone, constant cross-section):
```
CN = (Ab/Ar) sin(2α) cos(α/2) (CN/CNo)_SB
   + η·Cdn·(Ap/Ar)·sin²(α) (CN/CNo)_Newt
```
The **first term** is slender-body potential theory (this is the same
family as Barrowman's own linear CNα — `sin(2α)cos(α/2) ≈ 2α` for small α,
recovering the familiar linear result). The **second term** is the viscous
crossflow contribution, and it is **exactly** the same functional shape as
rocketry's own Galejs term: quadratic in `sin(α)` (i.e. in AOA for small
angles), scaled by planform area ratio `Ap/Ar` — this is the same physical
mechanism (Allen's viscous crossflow theory), just parameterized
differently:
- **Galejs (rocketry's current code)**: a single constant `K = 1.1`
  multiplying the planform-area quadratic term.
- **Jorgensen (this report)**: `η · Cdn(Mn, Ren)` in the same slot — a
  REAL, physically-grounded, Mach-and-Reynolds-dependent crossflow drag
  coefficient of an actual 2-D circular cylinder, not a single fitted
  constant. `η` (crossflow drag proportionality factor, finite- vs.
  infinite-length cylinder) ≈ 1 at supersonic/hypersonic Mach (stated
  directly, p.4: "for bodies at supersonic and hypersonic free-stream Mach
  numbers, experience to date has shown that it is best to assume η = 1"),
  needs a length/width-ratio lookup at subsonic Mach.

**Crossflow Mach/Reynolds numbers** (eq. 5-6, p.4):
```
Mn = M∞ sin(α)      (crossflow Mach number)
Ren = Re sin(α)      (crossflow Reynolds number)
```

**General case, variable cross-section along body length** (eq. 7-9, p.5)
— the form actually relevant to a real rocket (not just a cone), directly
analogous to how Barrowman's own CP-summation integrates component
contributions:
```
CN = [sin(2α)cos(α/2) / Ar] ∫₀ˡ (Cn/Cno)_SB (dA/dx) dx
   + [2η·Cdn·sin²α / Ar] ∫₀ˡ (Cn/Cno)_Newt · r dx
```
(and the analogous integral for Cm, eq. 8, weighted by `(xm - x)` for
moment). This is the generalized, integrate-along-the-body form of
exactly the same two-term structure — a **direct, provable generalization
of what rocketry's Galejs port currently does as a single lumped term**.

**Center of pressure** falls out directly (eq. 4): `xac = (xm/X - Cm/CN)·X`.

## Accuracy impact

Real, and reasonably well-quantified by the report's own validation (see
below), but the direct improvement is specifically to the crossflow term's
own coefficient, not a wholesale replacement: swapping rocketry's constant
`BODY_LIFT_K = 1.1` for a real `Cdn(Mn, Ren)` curve would make the body-lift
term correctly vary with Mach and Reynolds number instead of being flat —
most relevant at high AOA / high weathercocking cases and across a wide
Mach range (transonic crossflow drag rise is a real, documented effect for
2-D cylinders, currently invisible to rocketry's constant-K model).

**Validation quoted directly from the report (p.11)**: "there is very good
agreement of the computed with the experimental results" for bodies of
l/d=6 and 10 at M=1.98, and l/d=10 at M=3.88, "effects of cross section
(a/b), fineness ratio (l/d), and Mach number on all of the aerodynamic
characteristics are predicted so well" — and separately, agreement was
also confirmed at α from 0° to 180° (M=2.86) for cylinder/cone-cylinder/
ogive-cylinder bodies in the reference this report cites (its own
"reference 9" — Jorgensen's earlier 1972 report, not yet independently
read here). This method is **experimentally validated by NASA's own
comparison**, not a purely theoretical proposal.

## Implementation difficulty

**Medium — the equations are fully in hand, but one real data dependency
is NOT yet resolved.** The functional form (eq. 1/7/9) is completely
specified and directly portable. What's missing: the actual `Cdn(Mn, Ren)`
crossflow-drag-of-a-cylinder curve values, which this report explicitly
delegates to "reference 9" (Jorgensen's own earlier, 1972 report — not the
one read in this pass) for the "state-of-the-knowledge plots." **This is a
well-known, classical curve in aerodynamics** (2-D circular cylinder drag
coefficient vs. Reynolds number, extended to compressible/transonic Mach
regimes) — likely findable from a few different public sources (this
report's own reference 9, or a standard aerodynamics text), but not
independently verified/extracted in this pass. Implementing this
improvement needs that follow-up read before any code changes.

## Other relevant physics (beyond the immediate Galejs connection)

- Equations 7-9's **integrate-along-the-body** structure (rather than one
  lumped planform term) could, in principle, let rocketry's body-lift term
  vary correctly for bodies with non-constant local diameter derivative
  (e.g. a boattail or shoulder) rather than treating the whole body's
  planform area as one lump — worth keeping in mind if the Galejs term is
  ever revisited for accuracy beyond just the Cdn constant.
- The winged-body extension (eq. 7-8's own text, p.5) explicitly flags that
  slender-body theory's first term "is not applicable, as written, for
  winged-body sections where the body dA/dx values are zero or negative"
  and points to a DIFFERENT reference (its own "reference 16") for a
  vortex-interference correction — a real, documented limitation of this
  whole family of methods for wing-body interference at high AOA, relevant
  context if rocketry's own fin-body interference handling (Kbf, NACA 1307)
  is ever extended to very high AOA.
- The special-case elliptic-cone-with-triangular-wing section (eq. 10, p.6)
  is not directly relevant to rocketry's circular-body fins today, but
  confirms the same crossflow framework extends cleanly to lifting-surface
  cases if ever needed.

## Uncertainty flags

- The specific `Cdn(Mn, Ren)` curve values are NOT extracted in this pass
  — flagged clearly above as the one real blocking dependency for actual
  implementation, not glossed over.
- Figures 7-16 (the actual computed-vs-experimental comparison plots) were
  not individually digitized — the validation claim above is quoted from
  the report's own prose summary of those figures, not independently
  re-verified against the plotted data points.
- The reference list (p.14, references 1-22) was not read — several are
  cited by number in the text (e.g. "reference 9," "reference 16," "reference
  17" for the triangular-wing modification factor) and would need to be
  looked up individually for a complete picture, particularly reference 9
  for the Cdn curve data noted above.
