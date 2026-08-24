# NTRS search pass — boattail steepness / minimum-taper-length / separation criteria

Scope: search and metadata-verification only, not full reads (same
convention as `ntrs-search-pass.md`) — flag worth-reading candidates for a
follow-up pass, don't read everything now. Searched specifically for the
gap the user identified 2026-08-19: OpenRocket/rocketry have no validation
or warning for a boattail that's too steep (short length relative to its
diameter reduction), unlike a real risk of flow separation a steep taper
would carry. This is distinct from `naca-rm-e51c06.md`'s finding (drag-
formula accuracy for an already-gentle boattail) — this search is about
whether a geometric steepness/separation criterion exists in the clean
literature at all.

**The most obvious lead, the "Payne correlation" (NSWC TR-81-156), was
excluded rather than read** — see `boattail-steepness-validation.md`'s
Decisions section and `REFERENCES.md`. It's titled "Aerodynamic Design
Manual for Tactical Weapons," categorically the same kind of document as
the excluded Missile DATCOM. This search pass looks for the same kind of
information from clean (non-tactical-weapons-specific) NACA/NASA sources
instead.

## Candidates found, each individually verified public domain via NTRS

### 1. NASA TP-1070 (Wilmoth, 1977) — most directly on-topic: an actual separation-turning-angle criterion

"Computation of Transonic Boattail Flow with Separation." R. G. Wilmoth,
NASA Langley Research Center, December 1977.

- NTRS: https://ntrs.nasa.gov/citations/19780005074
- **Public-domain status, quoted directly**: Distribution Limits "Public".
  Copyright Notice: "Work of the US Gov. Public Use Permitted."
- **Relevance**: couples a transonic full-potential-flow solver with a
  boundary-layer/separation model. Per its own abstract, the empirical
  separation model "enabled reasonable shock-induced separation
  predictions when separation location and turning angle were specified"
  — i.e., this report's own framing is explicitly in terms of a **turning
  angle** (closely related to boattail half-angle/steepness) as the
  parameter that governs whether separation occurs. This is the most
  direct conceptual match to "how steep is too steep" found in this pass.
  Caveat from its own abstract: the separation model "performed well up to
  a free-stream Mach number of about 0.90" — i.e., its best-validated range
  is high-subsonic/low-transonic, not the fully supersonic regime
  NACA-RM-E51C06 and the fin-CP pole work (issue #3196-adjacent, in the
  `openrocket` repo, unrelated project) have been focused on. Whether it
  still gives a usable *geometric* threshold (vs. a full CFD-style
  procedure) isn't yet known — not read beyond its abstract in this pass.
- **Recommendation: read first.** Best conceptual match, but need to
  confirm whether it yields a simple, usable rule (e.g., a maximum
  boattail half-angle before its separation model activates) or only a
  full computational procedure — the latter would be a much bigger lift
  to port than a threshold check.

### 2. NASA TN D-6789 (Compton, 1972) — a real angle × length/diameter parametric drag dataset

"Jet Effects on the Drag of Conical Afterbodies at Supersonic Speeds."
W. B. Compton III, NASA Langley Research Center, July 1972.

- NTRS: https://ntrs.nasa.gov/citations/19720019347
- **Public-domain status, quoted directly**: Distribution Limits "Public".
  Copyright Notice: "Work of the US Gov. Public Use Permitted."
- **Relevance**: tests **boattail angles of 3°, 5°, and 10°** at
  **length-to-diameter ratios of 1.0, 0.8, and 0.6**, at Mach 1.83 and
  2.20, with data presented for the **jet-off condition separately** from
  a range of jet pressure ratios. The jet-off subset isolates pure
  boattail-geometry drag behavior — directly relevant, unlike
  `ntrs-search-pass.md`'s earlier (correct, for a *different* purpose)
  call that jet-effects papers weren't relevant to rocketry's coasting-
  flight case; here the jet-off data specifically is exactly what's
  needed, the jet-on data simply isn't used. This is the closest thing
  found in this pass to a real "here's what several actual steepnesses
  cost you in drag" dataset — at only two Mach numbers and three
  angle/ratio combinations each, so it's a sparse grid, not a general fit.
- **Recommendation: read second.** Good complement to TP-1070 — concrete
  numbers for a small grid of actual steepnesses, even if it doesn't
  supply a general closed-form criterion by itself.

### 3. NASA TM X-3109 (Rom & Bober, 1974) — lower priority, subsonic-only with noted convergence issues

"Calculations of the Pressure Distribution on Axisymmetric Boattails
Including Effects of Viscous Interactions and Exhaust Jets in Subsonic
Flow." J. Rom (Technion) and L. J. Bober (NASA Lewis), September 1974.

- NTRS: https://ntrs.nasa.gov/citations/19740024298
- **Public-domain status, quoted directly**: Distribution Limits "Public".
  Copyright Notice: "Work of the US Gov. Public Use Permitted."
- **Relevance**: a coupled inviscid/boundary-layer pressure-distribution
  method for boattails, but **subsonic only** (per its own title) — off
  the Mach range this project's transonic/supersonic work has been
  focused on — and its own abstract admits "convergence could not be
  obtained" in some cases, an honest red flag about the method's
  robustness.
- **Recommendation: lower priority.** Wrong Mach regime for this specific
  gap (which centers on transonic/supersonic taper steepness, where real
  rockets actually see boattail separation risk) and the method's own
  documented convergence problems make it a less promising lead than the
  other two.

## Candidates seen but not prioritized (found via search, not further checked)

- "Jet effects on boattail pressure drag of isolated ejector nozzles"
  (NTRS 19690017598) and "Reynolds number effects on boattail drag of
  exhaust nozzles" (NTRS 19740017699) — both nozzle/ejector/exhaust-
  focused like the excluded parts of Compton's own paper; not chased
  since Compton's jet-OFF data already gives a cleaner isolated-boattail
  signal without needing to first factor out jet effects.
- "Effect on base drag of recessing the bases of conical afterbodies"
  (NTRS 19680027582) — a different geometric variable (recessed base, not
  taper angle/length); not relevant to this specific question.

## Recommendation for next steps

Read **NASA TP-1070** (Wilmoth) first — check specifically whether its
separation model reduces to a usable geometric threshold or stays a full
computational procedure. If it gives a usable angle/turning-angle
criterion, **NASA TN D-6789** (Compton)'s jet-off angle×length/diameter
grid would be a good independent numeric cross-check on the same question.
