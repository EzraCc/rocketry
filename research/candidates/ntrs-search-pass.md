# NTRS search pass — additional candidates beyond the 4 already read in this batch

Scope: search only, not full reads (per this task's own scope — flag
worth-reading candidates for a future pass, don't read everything now).
Searched for NACA/NASA reports covering fin/nose bluntness drag, boattail/
afterbody supersonic drag, fin airfoil-thickness drag, and CP shift at
high Mach — specifically to fill gaps the other four candidates in this
batch (NACA-RM-L9I30, Jorgensen TN D-7228, Hoerner, Missile DATCOM) left
open or only partially resolved.

## Candidates found, each individually verified public domain

### 1. NACA-TN-2858 — fills the fin-thickness wave-drag gap directly

Henderson, Arthur, Jr.: "Supersonic Wave Drag of Nonlifting Delta Wings
with Linearly Varying Thickness Ratio." NACA TN 2858, December 1952.

- NTRS: https://ntrs.nasa.gov/citations/19930083608
- **Public-domain status, quoted**: "Work of the US Gov. Public Use
  Permitted."
- **Relevance**: this is a closed-form linear-theory WAVE DRAG calculation
  for a delta-wing planform with a specified thickness-ratio distribution
  — directly on-topic for "Gap 3" (fin airfoil-section/thickness drag),
  which neither Jorgensen's TN D-7228 nor Missile DATCOM's documentation
  resolved in this same research batch (see their own writeups' "Uncertainty
  flags"/"Other relevant physics"). Delta-wing-specific, not a generic
  fin shape — would need checking whether the method generalizes to
  rocketry's actual fin shapes (trapezoidal/freeform) or is delta-specific.
- **Recommendation: worth a full read next**, specifically because it's
  the one candidate in this whole batch (across all 5 research threads)
  that looks like it could directly close the fin-thickness-drag gap with
  an actual closed-form equation, rather than a qualitative/empirical
  result or a named-but-unread reference.

### 2. NACA-RM-E51C06 — complements NACA-RM-L9I30's boattail/max-diameter findings

Cohen, Robert J.: "Aerodynamic Characteristics of Four Bodies of
Revolution Showing Some Effects of Afterbody Shape and Fineness Ratio at
Free-Stream Mach Numbers from 1.50 to 1.99." NACA RM E51C06, May 1951.

- NTRS: https://ntrs.nasa.gov/citations/19930086608
- **Public-domain status, quoted**: "Work of the US Gov. Public Use
  Permitted."
- **Relevance**: real flight/wind-tunnel data on afterbody (boattail)
  shape and fineness ratio effects on drag — same general topic as
  NACA-RM-L9I30 (already fully read in this batch) but focused specifically
  on the AFTERBODY/boattail region rather than whole-body max-diameter
  position. Complementary, not redundant.
- **Recommendation**: worth a read if the boattail-drag gap (also flagged
  in the Missile DATCOM writeup, via the unread "Payne correlation" /
  NSWC TR-81-156 lead) becomes a priority — two independent leads on the
  same gap now exist.

### 3. NASA-CR-2835 — broad compiled reference, possible validation resource

Nichols, J. O. (Auburn University, under NASA contract): "Analysis and
Compilation of Missile Aerodynamic Data. Volume 1: Data Presentation and
Analysis." NASA CR-2835, May 1977.

- NTRS: https://ntrs.nasa.gov/citations/19770021140
- **Public-domain status, quoted directly (checked individually despite
  being a university/contractor report, not authored by NASA/NACA staff
  directly — per this task's own instruction not to assume)**: "Work of
  the US Gov. Public Use Permitted."
- **Relevance**: a broad compilation of missile aerodynamic data (M≈0.2-4.63,
  various air-to-air/surface-to-air/cruise-missile configurations) — not a
  single-effect methodology paper like the others, but potentially a rich
  independent VALIDATION dataset (same spirit as using NACA-RM-L9I30's own
  flight-test curves as a validation benchmark, see that writeup) across a
  wider range of real configurations.
- **Recommendation**: lower priority for formula-extraction, but flag for
  the validation use case if that direction is pursued.

## Candidates seen but not prioritized (found via search, not further checked)

- "Jet effects on the drag of conical afterbodies at supersonic speeds"
  (NTRS 19720019347) and similar jet-effects/afterbody papers — mostly
  about rocket-EXHAUST-PLUME interaction with the boattail, not relevant
  to rocketry's own coasting/no-thrust boattail drag case (rocketry models
  drag during coast and during powered flight, but these papers' specific
  focus is nozzle-plume/boattail interaction, a different physical
  question). Not recommended.
- "Supersonic aerodynamic characteristics of a series of wrap-around-fin
  missile configurations" (NTRS 19770013089) — wrap-around fins are a real
  military-missile fin style rocketry doesn't model (it models flat/
  trapezoidal fin sets); not relevant.
- Several NACA-RM-10 wind-tunnel pressure-measurement reports — likely
  useful for someone building a full CFD-style validation, but not an
  obvious near-term fit for rocketry's Barrowman-style component model.

## Recommendation for next steps (across this whole 5-source research batch)

If continuing this research line, the two most concrete, well-scoped next
reads are: **NACA-TN-2858** (fin-thickness wave drag — the one unresolved
gap with a promising closed-form-looking candidate) and, if boattail drag
specifically becomes a priority, either **NACA-RM-E51C06** or chasing down
**NSWC TR-81-156** (the "Payne correlation" named in Missile DATCOM's own
Volume I, not yet independently verified as accessible/public).
