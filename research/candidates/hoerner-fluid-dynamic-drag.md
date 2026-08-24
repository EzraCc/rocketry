# Hoerner, "Fluid-Dynamic Drag" — surface-roughness friction floor

## Source and copyright status (read this before using anything below)

Sighard V. Hoerner, "Fluid-Dynamic Drag: Practical Information on
Aerodynamic Drag and Hydrodynamic Resistance," self-published, 1965 (still
in print / reprinted). **This is a copyrighted, commercially-sold book —
NOT public domain, unlike every NACA/NASA report in this research batch.**
This project's standing rule for it: cite specific page/section/table
numbers, reimplement any underlying relationship independently, and never
reproduce its own text, tables, or figures verbatim. Nothing in this file
quotes or transcribes content from the book itself — see below for why
that turned out not to be necessary.

## Correction to this plan's own earlier research (2026-08-15)

The prior research pass (recorded in `.claude/plans/rasaero-transonic-
physics.md`) characterized OpenRocket's Hoerner citation as being for
**"nose cone pressure-drag data."** Checked directly against OpenRocket's
own source this time (`core/src/main/java/info/openrocket/core/
rocketcomponent/ExternalComponent.java`, read in full) — **that
characterization was wrong.** OpenRocket's own code comments (lines 27-32
and 48-56) cite Hoerner (alongside "the Thesis," an unidentified secondary
source, not chased down in this pass) specifically for **surface-roughness
equivalent sand-grain height values**, used in the SKIN-FRICTION drag
floor, not nose pressure drag at all. Correcting the record here since a
future reader (including an OpenRocket developer verifying this) would
otherwise be sent looking in the wrong place entirely.

## Gap this addresses

Rocketry's own `src/physics/aero/drag-calc.ts` already documents this
exact gap in its own code comment (line 154-161, `machCompressibilityMultiplier`'s
doc comment) and in `DEVIATIONS.md` item 5 ("Drag has no speed-of-sound
compressibility correction... or surface-roughness model" — the Mach part
is done, "the roughness model is a larger effort... still open"):
rocketry's friction-drag calculation (`baseFrictionCoefficient`,
`frictionCoefficient`) always uses the smooth-surface flat-plate Cf
formula — the exact equivalent of OpenRocket's `isPerfectFinish()==true`
branch — with no per-component "finish" (rough / painted / polished /
etc.) input to ever trigger a rougher, higher-Cf floor.

## The data and formula — fully specified, and it turns out NOT to need book access at all

Traced OpenRocket's actual roughness-floor implementation directly
(`BarrowmanDragCalculator.java`, read in full) — **this is GPLv3 OpenRocket
source, freely portable exactly like every other OpenRocket algorithm
already ported into rocketry, with no Hoerner-copyright entanglement at
all** (the book is Hoerner's; OpenRocket's own derived formula and Java
constants are OpenRocket's, GPLv3, already legally clean for this project
to reuse the same way `drag-calc.ts` already does for the pressure-drag
and Mach-compressibility terms).

**Equivalent sand-grain roughness height per finish** (`ExternalComponent.
Finish` enum, `core/.../rocketcomponent/ExternalComponent.java:35-49`):

| Finish | Roughness height |
|---|---|
| Rough | 500 μm |
| Rough, unfinished | 250 μm |
| Unfinished | 150 μm |
| Regular paint | 60 μm |
| Smooth paint | 20 μm |
| Optimum paint | 5 μm |
| Polished (aircraft sheet-metal) | 2 μm |
| Finished/polished | 0.5 μm |
| Mirror | 0 μm |

**Roughness-limited Cf floor** (`BarrowmanDragCalculator.java:124-126`):
```
roughnessLimitedCf = 0.032 * (roughnessHeightM / bodyReferenceLengthM)^0.2 * roughnessMachCorrection(mach)
```

**A SEPARATE Mach correction from the one rocketry already ported** —
same overall 0.9-1.1 linear-blend shape as `machCompressibilityMultiplier`
in `drag-calc.ts`, but numerically different coefficients (`0.18` here vs.
`0.045`/`0.1` there) — confirmed by reading both side by side, not
assumed identical (`BarrowmanDragCalculator.java:251-262`):
```
mach < 0.9:  roughnessMachCorrection = 1 - 0.1 * mach²
mach > 1.1:  roughnessMachCorrection = 1 / (1 + 0.18 * mach²)
else:        linear blend between the two endpoint values at mach=0.9/1.1
```

**How the floor combines with the smooth-surface Cf**
(`BarrowmanDragCalculator.java:127-138`):
```
if isPerfectFinish (rocketry's current, only, implicit mode):
    componentCf = (Re > 1e6 AND roughnessLimitedCf > Cf_smooth) ? roughnessLimitedCf : Cf_smooth
else (not currently modeled in rocketry at all):
    componentCf = max(Cf_smooth, roughnessLimitedCf)
```
The `isPerfectFinish` rocket-wide flag (vs. per-component override) is
itself an OpenRocket UI setting, not something rocketry has a UI concept
of yet — rocketry's own doc comment already correctly identifies its
current behavior as the `isPerfectFinish()==true` branch specifically.

## Accuracy impact

Real and potentially significant for anything that ISN'T smooth/polished —
DEVIATIONS.md's own existing writeup already states this plainly: "the
roughness effect can become the dominant source of friction drag
entirely" for a rough/unfinished surface at high Reynolds number (large
rockets, high speed) — rocketry currently always assumes the smooth-
surface floor never binds, which is optimistic (under-predicts drag) for
any rocket that isn't finished to "optimum paint" or better.

## Implementation difficulty

**Low-medium, and no external data source is needed at all** — this
correction is now fully specified above, straight from OpenRocket's own
public GPLv3 code (constants + formula), same standing as any other
OpenRocket port in this project. What's needed:
1. A per-component (or, simplest first cut, per-rocket) "finish" field —
   this project's own `Component`/`Rocket` model has no such field yet
   (confirmed: no `finish`/`roughness` match anywhere in `src/model/`).
2. `roughnessLimitedCf` + `roughnessMachCorrection` as two small new
   functions in `drag-calc.ts`, alongside the existing friction functions.
3. The `max(Cf, roughnessLimitedCf)` combination logic (OpenRocket's
   non-`isPerfectFinish` branch — rocketry would need to decide whether to
   support the `isPerfectFinish` mode-switch too, or just always apply the
   floor once a finish is selected).
4. UI: at minimum a single dropdown (mirroring OpenRocket's own Finish
   enum labels) — a genuinely small, self-contained UI addition, not a big
   surface area change.

## Other relevant physics

- The unidentified "Thesis" OpenRocket's own comment cites alongside
  Hoerner (`ExternalComponent.java:29`, `:51`) was not chased down in this
  pass — likely a rocketry-relevant graduate thesis (possibly on hobby-
  rocket drag specifically, given the context), worth a follow-up look if
  the roughness model is actually implemented, since it might have
  rocket-specific (not just generic aerospace) surface-finish guidance.
- Nose-cone pressure drag (what this citation was originally,
  *incorrectly*, thought to be about) remains a genuinely open question —
  rocketry's `growingShapePressureCd` doesn't model nose bluntness/shape-
  specific pressure drag beyond the OpenRocket-ported half-angle formula.
  If Hoerner's book DOES cover this elsewhere (plausible — it's a broad,
  comprehensive drag reference), that's a separate, not-yet-researched
  question from the roughness-floor finding above.

## Uncertainty flags

- The "Thesis" cross-reference in OpenRocket's own comment is unidentified
  — not a blocker for the roughness-floor implementation above (which is
  fully specified from OpenRocket's own code independent of it), but worth
  resolving if a deeper dive into OpenRocket's own sourcing is ever wanted.
- Did not attempt to access Hoerner's book itself in any form (correctly,
  per the copyright-discipline instructions for this task) — everything
  above is sourced from OpenRocket's own already-public GPLv3
  implementation, not from the book directly. If Hoerner's own text is
  ever wanted for independent verification (e.g. by an OpenRocket
  developer with a physical/legitimate digital copy), the relevant
  content would be wherever Hoerner's book covers "equivalent sand
  roughness" for skin friction — not independently located to a specific
  page/chapter in this pass.
