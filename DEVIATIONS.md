# Deviations from OpenRocket

## Why this document exists

rocketry's physics was originally built as an **independent re-derivation** of
OpenRocket's algorithms — a deliberate choice, made early in the project, to
avoid depending on or copying GPL-licensed code. That constraint is gone: this
project is now itself licensed GPLv3 (see `LICENSE`), specifically so it can
reuse or closely follow OpenRocket's own methods instead of maintaining a
parallel, independently-derived physics model.

This document is the result of a systematic side-by-side comparison of every
physics file in `src/physics/` against the equivalent code in OpenRocket's
real Java source (`core/src/main/java/info/openrocket/core/`). For every
place the two tools would compute a **different number** for the same rocket,
this document explains what differs, why, how much it matters, and whether
it's worth changing.

**Every specific formula and code excerpt below was read directly from both
projects' current source** (not summarized from memory or from either
project's own comments taken at face value) as of 2026-08-15. Where
rocketry's own code comments describe OpenRocket's behavior, that description
was independently checked against OpenRocket's actual Java rather than
trusted — a few small corrections to that effect are noted inline.

## How to read this

Each item is written in two layers: a plain-English summary anyone can follow
("this makes the rocket look slightly more stable than it really is"), then
the technical detail underneath for anyone who wants to verify it against the
source directly. Each item ends with a verdict:

- **Keep (rocketry-original)** — a real improvement or design choice with no
  OpenRocket equivalent to revert to. Not a gap.
- **Keep (deliberate, justified)** — rocketry does something different from
  OpenRocket on purpose, for a documented, physically-reasoned cause.
- **Port candidate** — an undocumented gap where OpenRocket's method is
  better-justified or simply more complete, and adopting it is now
  unblocked by the GPLv3 relicense.
- **Open question** — both sides made a reasonable but different judgment
  call on an underspecified problem; neither is clearly "more correct,"
  so this is a product decision, not a bug fix.

---

## Top findings, ranked by how much they'd actually change a result

| # | What | Where | Why it matters | Verdict |
|---|---|---|---|---|
| [1](#1-the-plain-body-tube-contributes-zero-lift---openrocket-gives-it-a-real-and-often-large-one) | ~~Plain body tubes contribute **zero** lift in rocketry; OpenRocket gives them a real, often large one (the "Galejs" term)~~ **Ported 2026-08-15** | aero | Dynamic-simulation-only, not the static display — see the item's own 2026-08-15 update for why the original "shifts CP/stability margin" claim here was itself wrong | ~~Port candidate~~ **Done** |
| [2](#2-fin-lift-is-frozen-at-its-mach-09-value-for-every-faster-speed) | ~~Fin lift coefficient is frozen at its Mach-0.9 value for every faster speed; no transonic/supersonic model at all~~ **Ported 2026-08-15** | aero | Large, systematic error above M≈0.9 | ~~Keep (deliberate, documented, warning-gated)~~ **Done** |
| [3](#3-how-pitch-and-yaw-damping-is-modeled-is-fundamentally-different) | How pitch/yaw "wobble damping" is modeled is fundamentally different between the two tools | sim | Affects weathercocking/oscillation behavior, especially in gusty wind or at high angle of attack | Open question |
| [4](#4-fins-contribute-no-drag-from-their-own-leading-blunt-edges-or-trailing-edges) | ~~Fins contribute no drag from their own leading/blunt edges or trailing edges~~ **Ported 2026-08-15** | aero | Underestimates total drag, especially for square-cut (unbeveled) fins — a common beginner-kit fin style | ~~Port candidate~~ **Done** |
| [5](#5-drag-has-no-speed-of-sound-compressibility-correction-or-surface-roughness-model) | Drag has no speed-of-sound compressibility correction (**ported 2026-08-15**) or surface-roughness model (still open — needs a per-component "finish" input this project doesn't collect) | aero | Small-to-moderate systematic drag underestimate at higher speeds/Reynolds numbers | **Done** (Mach term) / Port candidate (roughness) |
| [6](#6-drag-always-points-exactly-opposite-the-oncoming-air-openrocket-keeps-it-locked-to-the-rockets-own-body-axis) | Drag always points exactly opposite the oncoming air; OpenRocket keeps it locked to the rocket's own body axis | aero/sim | Only matters at real angle-of-attack (wind, weathercocking) — up to 30% drag-magnitude difference there | Open question (structural, not a quick fix) |
| [7](#7-nothing-ever-nudges-a-borderline-stable-rocket-off-course) | ~~Nothing ever nudges a borderline-stable rocket off course~~ **Ported 2026-08-15** | sim | A rocket sitting right at the edge of "stable enough" may fly perfectly straight in simulation even when it's genuinely marginal | ~~Port candidate~~ **Done** |
| [8](#8-the-fins-own-center-of-pressure-is-frozen-at-quarter-chord) | ~~The fin's own center of pressure is frozen at "quarter chord" above Mach 0.5~~ **Ported 2026-08-15** | aero | A real, currently-unwarned gap between M 0.5–0.8 | ~~Keep (documented)~~ **Done** |
| [9](#9-a-hot-or-cold-launch-day-is-handled-oppositely-by-the-two-tools-above-11-km) | A hot or cold launch day is handled *oppositely* by the two tools above 11 km altitude | atmosphere | Only matters for high-altitude (11km+) flights on an unusual-weather day | Open question |
| [10](#10-the-fin-in-body-interference-boost-uses-a-more-precise-textbook-formula) | The fin-in-body "interference boost" uses a more precise textbook formula than OpenRocket's simplified one, plus an entirely new term OpenRocket admittedly omits | aero | Small-to-moderate, and cited/verified against the source textbook | Keep (deliberate, justified) |
| [11](#11-real-per-sample-motor-mass-data-is-cross-checked-against-the-motors-own-published-weight) | Real per-sample motor mass data is cross-checked against the motor's own published weight before being trusted | motor | Catches a real data-quality bug (found this session) that OpenRocket itself doesn't guard against | Keep (rocketry-original — better than OR here) |

---

## 1. The plain body tube contributes zero lift — OpenRocket gives it a real, and often large, one

**Plain English:** Picture the rocket tipped slightly sideways into the
wind — nose pointed a few degrees off the direction it's actually moving.
Fins obviously push back against that (that's what makes a rocket
"weathercock," turning back into the wind). OpenRocket says the plain
cylindrical body tube *also* pushes back a meaningful amount, just from air
flowing along its slightly-angled length — a real, textbook aerodynamic
effect (credited to Galejs, a NASA-era researcher). rocketry currently
assumes the bare body tube contributes nothing at all. Since this "push"
acts near the middle of the body tube — usually well forward of the fins —
leaving it out doesn't just get the total force wrong, it shifts *where*
the whole rocket's center of pressure sits, which is exactly the number the
stability margin (the "how safe is this to fly" figure) is built from.

**Technical detail:** In OpenRocket, every symmetric component (nose cone,
transition, *and* plain body tube) gets a body-lift contribution from
`SymmetricComponentCalc.getLiftCP` (`aerodynamics/barrowman/SymmetricComponentCalc.java:180-197`):

```java
protected CoordinateIF getLiftCP(FlightConditions conditions, WarningSet warnings) {
    double mul = 1;
    if ((conditions.getMach() < 0.05) && (conditions.getAOA() > Math.PI / 4)) {
        mul = pow2(conditions.getMach() / 0.05);
    }
    return new Coordinate(planformCenter, 0, 0, mul * BODY_LIFT_K * planformArea / conditions.getRefArea() *
            conditions.getSinAOA() * conditions.getSincAOA());
}
```

with `BODY_LIFT_K = 1.1`, called unconditionally for a plain body tube
(`isTube` branch, line 155: `cp = getLiftCP(conditions, warnings);`), and
`planformArea` for a `BodyTube` is confirmed (`rocketcomponent/BodyTube.java:341-343`)
to be exactly `length × diameter`.

rocketry's `symmetricComponentAero` (`aero/symmetric-component-calc.ts`)
returns `cna = 0, cpX = length/2` whenever fore radius equals aft radius —
i.e., for every plain body tube. The module's own doc comment already flags
this as deferred ("The Galejs body-lift term (planform-area based, small) is
deferred for MVP") — but **"small" undersells it**. Worked through the
formula above: near zero angle of attack, `sin(AOA)·sinc(AOA) → AOA`, so
the effective normal-force-slope contribution from a bare body tube alone
comes out to roughly `1.1 × (length × diameter) / (π·radius²) ≈ 1.4 ×
(length/diameter)`. For a typical hobby-rocket body tube with a
length-to-diameter ratio of 15–25, that's a CNa contribution in the
**20–35 per radian** range — comparable to, or larger than, a whole fin
set's own contribution.

**Verdict: Port candidate.** This looks like a real OpenRocket feature that
was consciously deferred, not an artifact of independent re-derivation — the
formula is short and self-contained (no lookup tables needed), and it
directly affects the stability margin, the single most safety-relevant
number this tool produces.

---

**Update 2026-08-15 — Ported, and this analysis's own claim above was wrong.**
The `sin(AOA)·sinc(AOA) → AOA` step above is correct as far as it goes, but
it's the WEIGHT OpenRocket assigns this term in its CP-averaging, not the
term's actual contribution to CN — OpenRocket's `forces.setCN(cp.getWeight()
* AOA)` multiplies that weight by AOA a SECOND time. Carried all the way
through: `CN_bodylift(AOA) = K·planformArea/refArea · sin(AOA)·sinc(AOA) ·
AOA = K·planformArea/refArea · sin²(AOA)` — quadratic in AOA, not linear.
That means it contributes **exactly zero at AOA=0**, not the ~20–35/rad
figure claimed above (which was this analysis's own arithmetic error, caught
only after porting it: an early implementation added that as a constant
small-angle-limit CNa, which measurably moved rocketry's own static CP AWAY
from real OpenRocket's Java output once checked against
`openrocket-comparison.test.ts`'s real fixtures — all generated at AOA=0,
where real OpenRocket's own equivalent figure is ALSO exactly zero).

Ported correctly in `symmetricComponentAero` (now takes an `alphaRad`
parameter, same pattern as the fin CNa1 port): zero at alpha=0 (every static
display this project shows — the CP stat, the stability margin — is
completely unaffected, contrary to this item's original framing above), real
and second-order-significant during actual dynamic simulation at nonzero
AOA (`derivatives3d.ts`'s second Barrowman pass). See
`symmetric-component-calc.ts`'s own doc comment for the full derivation.

---

## 2. Fin lift is frozen at its Mach-0.9 value for every faster speed

**Plain English:** How hard a fin "bites" the air (and how far forward or
back its own center of pressure sits) genuinely changes as a rocket
approaches and crosses the speed of sound — this is real, well-studied
aerodynamics, not a minor correction. rocketry currently just freezes both
numbers at whatever they were at Mach 0.9 and uses that same frozen value
forever, no matter how much faster the rocket actually goes. rocketry
already displays a warning above Mach 0.8 telling you results may not be
trustworthy, so this is a known, disclosed limitation — not a silent bug.

**Technical detail:** rocketry's `finCNa1` (`aero/fin-calc.ts`) does
`const m = Math.min(mach, CNA_SUBSONIC)` (`CNA_SUBSONIC = 0.9`) — for any
Mach at or above 0.9 it reuses the M=0.9 closed-form value unchanged.
OpenRocket's `FinSetCalc.calculateFinCNa1` has three actual regimes
(`aerodynamics/barrowman/FinSetCalc.java:417-453`): the same closed form
below M=0.9; a supersonic model at M≥1.5 using precomputed `K1`/`K2`/`K3`
lookup tables where CNa1 itself depends on angle of attack
(`finArea*(K1(M) + K2(M)*alpha + K3(M)*alpha²)/refArea`); and a
cubic-polynomial-matched transonic blend in between. Fin center-of-pressure
position has the same shape of gap — see item 8 below.

~~**Verdict: Keep for now (deliberate, documented, warning-gated)** — this is
an honest, disclosed MVP scope cut, not an oversight. If/when higher-power,
faster-flying rockets become a priority, OpenRocket's K1/K2/K3 tables are
compact static data and are now a legitimate port target.~~

**Update 2026-08-15 — Ported.** `finCNa1` (`aero/fin-calc.ts`) now has all
three regimes: the unchanged subsonic closed form below M=0.9; the classical
K1/K2/K3 linearized supersonic thin-wing coefficients at M≥1.5, evaluated as
closed forms directly (not table-interpolated — a strict accuracy
improvement over OpenRocket's own 0.1-Mach-increment lookup table); and an
exact port of OpenRocket's 5-constraint transonic polynomial blend in
between (value+slope matched at both ends, plus zero second-derivative at
M=0.9). Since K2/K3 are themselves angle-of-attack-dependent, the flight
sim (`derivatives3d.ts`) now computes Barrowman twice per timestep — once at
alpha=0 to get the (AOA-independent) CP for the lever-arm calculation, once
at the real computed AOA for the force magnitude. See CHANGELOG.md
(`91eca90`) and `openrocket-comparison.test.ts`, which no longer needs
`KNOWN_ISSUES` entries for the two previously-failing supersonic apogee
cases.

---

## 3. How pitch and yaw damping is modeled is fundamentally different

**Plain English:** When a rocket gets knocked off-axis (by a wind gust, or
naturally overshooting as it "weathercocks" back into stable flight), two
things happen: a restoring force pushes it back straight, and a separate
*damping* effect keeps it from over-correcting and oscillating back and
forth like a spring. rocketry gets this damping "for free" from the same
physics that computes the restoring force — a mathematically clean approach.
OpenRocket instead uses a separate, explicitly **hand-tuned** formula for
damping (the code literally multiplies the whole thing by 3, with a comment
saying this was tuned by hand to get "more realistic apogee turn" behavior)
that has nothing to do with its own lift/CP calculation. Neither approach is
obviously "more correct" — OpenRocket's is empirically tuned against
real-world flight behavior but not derived from first principles; rocketry's
is physically elegant but has never been tuned against real flights the way
OpenRocket's has.

**Technical detail:** OpenRocket's damping
(`aerodynamics/barrowman/BarrowmanStabilityCalculator.java:108-126,331-364`)
computes a moment purely as a function of body geometry and rotation rate,
independent of the CN/CP calculation:

```java
mul = 0.275 * cacheDiameter / (refArea*refLength) * (cgx⁴ + (length-cgx)⁴)
mul += Σ_fins 0.6·min(finCount,4)·finPlanformArea·|finMidchordX-cgx|³ / (refArea*refLength)
mul *= 3   // "Higher damping yields much more realistic apogee turn"
pitchDampingMoment = min(mul·(pitchRate/velocity)², Cm)  // capped so it can't reverse the restoring moment
```

rocketry (`sim/derivatives3d.ts`) instead folds the rotation rate directly
into the local angle-of-attack seen at the center of pressure
(`rotationalVelocityAtCp = angularVelocity × leverArm`, added into the
relative airspeed before computing normal force) — the same normal-force
calculation used for the restoring moment automatically produces damping too,
as a side effect of one physically-consistent local-flow picture, rather
than as a second, separately-derived term.

**Verdict: Open question.** This is a genuine, structural difference in how
a hard, underspecified sub-problem is modeled. OpenRocket's version is
tuned against observed flight behavior (note the explicit `*3` fudge
factor); rocketry's is more physically principled but unverified against
real flights. Worth a deliberate product decision — do we want rocketry's
approach, or port OpenRocket's tuned-but-ad-hoc one? — rather than treating
either as simply "the bug."

---

## 4. Fins contribute no drag from their own leading/blunt edges or trailing edges

**Plain English:** A fin's leading edge (whichever way it's shaped — sharp,
rounded, or just cut flat with a saw) creates drag as it pushes through the
air, and a blunt trailing edge creates more drag from the low-pressure
"wake" behind it. rocketry currently doesn't account for either — fins only
contribute the (comparatively small) skin-friction drag of air rubbing
along their flat surfaces. This especially matters for square-cut,
unbeveled fins — a common style on basic/beginner kits — where OpenRocket's
own formula treats that leading-edge drag as substantial.

**Technical detail:** rocketry's `computeDragGeometry`
(`aero/drag-calc.ts`) explicitly skips fins in its pressure-drag loop
(`if (!isBodyComponent(c)) continue;`). OpenRocket computes real fin
pressure/leading-edge drag (`FinSetCalc.calculatePressureCD`, lines
623-661 — Mach-dependent, and different depending on whether the fin
cross-section is modeled as airfoil/rounded/square) and real trailing-edge
base drag (`calculateComponentBaseCD`, lines 663-685 — square gets the full
value, rounded gets half, airfoil gets none).

~~**Verdict: Port candidate.** Undocumented gap, not a deliberate cut. Likely
means simulated flights currently reach somewhat higher altitude/velocity
than a real flight would, especially for basic, square-fin kits — the exact
same failure mode this project's own drag module was originally built to
fix for nose cones.~~

**Update 2026-08-15 — Ported.** `finPressureDragCd`/`finBaseDragCd`
(`aero/fin-calc.ts`) are exact transcriptions of
`calculatePressureCD`/`calculateComponentBaseCD`, summed into
`DragGeometry` in `drag-calc.ts` alongside the existing body pressure
terms. Needed each fin's cross-section (square/rounded/airfoil), so
`FinCrossSection` was added to the `Component` model, parsed from RockSim's
`<TipShapeCode>` and OpenRocket's own `<crosssection>` (defaulting to
"square" — RockSim's own default, and the highest-drag/most conservative
choice — when a source file doesn't specify one). See CHANGELOG.md
(`91eca90`).

---

## 5. Drag has no speed-of-sound compressibility correction or surface-roughness model

**Plain English:** Two more real effects OpenRocket models that rocketry
doesn't yet: (a) how close a rocket is to the speed of sound changes how
much friction drag its skin experiences, not just how much pressure drag it
gets from its shape; (b) a rough, unfinished body tube surface (vs. a
sanded/painted one) genuinely creates more drag, and at higher speeds this
roughness effect can become the dominant source of friction drag entirely,
overtaking the smooth-surface formula rocketry currently always uses.

**Technical detail:** rocketry's `frictionCoefficient` (`aero/drag-calc.ts`)
takes only Reynolds number as an input — no Mach term anywhere. OpenRocket's
`calculateFrictionCoefficient` (`aerodynamics/BarrowmanDragCalculator.java:185-233`)
applies a Reynolds-and-Mach-dependent multiplier on top of the same base
formula (e.g., at Mach 0.9 with Re > 3×10⁶, an 8% reduction that grows
toward supersonic). Separately, OpenRocket computes a per-component
roughness-limited friction floor keyed to a "finish" setting (polished,
smooth, unfinished, rough) that rocketry's data model has no concept of at
all.

**Verdict: Port candidate** for the Mach correction (compact, self-contained
formula, low risk). The roughness model is a larger effort — it also needs a
per-component "finish" input rocketry doesn't currently collect — worth
flagging as a real gap but a bigger lift.

---

**Update 2026-08-15 — Mach correction ported; roughness model still open.**
`drag-calc.ts`'s `frictionCoefficient` now applies OpenRocket's own
`calculateFrictionCoefficient` compressibility multiplier (the
`isPerfectFinish()==true` branch specifically, matching rocketry's existing
base Cf formula, which was already an exact match for that same branch —
confirmed by direct comparison, not assumed). The roughness-floor model
(OpenRocket's separate per-component "finish" logic) is unchanged and still
needs that data-model addition first — genuinely out of scope for this pass,
not overlooked.

---

## 6. Drag always points exactly opposite the oncoming air; OpenRocket keeps it locked to the rocket's own body axis

**Plain English:** When a rocket is flying dead straight into the wind,
this distinction doesn't matter — the two conventions agree. But once a
rocket is tipped at a real angle relative to the air it's moving through
(gusty wind, aggressive weathercocking), the two tools disagree on both how
big the drag force is and which direction it points. OpenRocket also
increases the drag it applies along the body by up to 30% at moderate
tip angles — an effect rocketry doesn't have at all.

**Technical detail:** OpenRocket resolves aerodynamic force into
body-fixed-axis components: normal force perpendicular to the body, and a
separate axial (drag) force strictly along the body's own long axis, where
the axial drag coefficient itself gets an angle-of-attack-dependent boost
(`aerodynamics/BarrowmanDragCalculator.calculateAxialCD`, matched-derivative
cubics reaching a 1.3× multiplier around 17° angle of attack). rocketry
computes a single drag vector that points directly opposite the *actual*
relative-airspeed vector, with no angle-of-attack multiplier, plus a
separate perpendicular normal force.

**Verdict: Open question, structural.** This is a foundational architectural
difference (not a one-line fix — it touches how CD, CN, and angle of attack
interact throughout the whole force-composition step), not an
oversight. Both conventions are physically legitimate; reconciling them
would be a real redesign of `derivatives3d.ts`'s force model, only worth
doing if angle-of-attack accuracy in gusty/aggressive-weathercocking
scenarios becomes a priority.

---

## 7. Nothing ever nudges a borderline-stable rocket off course

**Plain English:** OpenRocket deliberately adds a tiny bit of random
"jitter" to every simulated flight — not to be more realistic exactly, but
specifically so that a rocket sitting right on the edge of "stable enough"
actually *shows* it during simulation. A perfectly symmetric rocket flown
in a perfectly noise-free simulation with no wind will fly a mathematically
perfect straight line even if it's genuinely only barely stable — the
random nudge is what reveals that fragility. rocketry has no equivalent, so
a marginal rocket with no wind input might look perfectly fine in
simulation when a small real-world imperfection would actually cause it to
diverge.

**Technical detail:** OpenRocket's `RK4SimulationStepper.calculateForces`
(lines 515-518) adds a small seeded-random perturbation every step:
`Cm += PITCH_YAW_RANDOM·2·(random()-0.5)` with `PITCH_YAW_RANDOM = 0.0005`,
commented "to prevent over-perfect flight." rocketry has no analogous
mechanism anywhere in `engine3d.ts`/`rk4-stepper3d.ts`; wind is currently the
only source of any asymmetric input, so a no-wind flight is the specific gap.

**Verdict: Port candidate.** This isn't really a "should we match OpenRocket"
question so much as a real capability gap worth closing on its own
merits — it directly affects how well this tool can reveal a genuinely
marginal design. Needs a seeded RNG (for reproducible results), matching the
spirit of OpenRocket's own approach.

---

**Update 2026-08-15 — Ported.** `derivatives3d.ts` now adds an equivalent
random perpendicular-torque perturbation (`seeded-random.ts` supplies the
deterministic PRNG), redrawn on every force evaluation — matching
OpenRocket's own `calculateForces` being invoked once per RK4 sub-stage
(k1..k4), not once per whole step. Ported as a single perpendicular-torque
vector rather than OpenRocket's own separate body-frame pitch(Cm)/yaw(Cyaw)
coefficients, since this project has no roll degree of freedom to anchor a
canonical body-frame orientation the way OpenRocket's own formulation
assumes — physically equivalent either way, since both components are
independently redrawn every call regardless of orientation. Opt-in via
`simulateFlight3D`'s new `randomSeed` option (undefined = disabled, the
default, keeping every existing caller fully deterministic) rather than
on by default. See CHANGELOG.md (`dd57e9d`).

---

## 8. The fin's own center of pressure is frozen at "quarter chord"

**Plain English:** A fin's own center of pressure — where along its chord
the aerodynamic force effectively acts — isn't fixed; it shifts backward as
speed increases, well before reaching the speed of sound. rocketry keeps it
pinned at a fixed "quarter of the way back" point at every speed.
rocketry's own Mach-related warning doesn't appear until Mach 0.8, but
OpenRocket's fin-CP model actually starts departing from that same "quarter
chord" assumption at Mach 0.5 — meaning there's a real, currently-unwarned
gap in the 0.5–0.8 range.

**Technical detail:** rocketry's fin CP is always
`macLead + 0.25 × macLength` (`aero/fin-calc.ts`), all Mach. OpenRocket's
`calculateCPPos` (`FinSetCalc.java:518-549`) only matches that quarter-chord
value below M=0.5; between M=0.5 and M=2 it uses a fifth-order polynomial
(matched in value and slope at both ends), and above M=2 an aspect-ratio-based
empirical formula.

~~**Verdict: Keep (documented scope cut)**, but the Mach-validity warning
threshold is worth tightening from 0.8 to 0.5 to match where the real gap
actually starts, or the gap itself is a reasonably contained port (the
polynomial's six coefficients are directly computable from fin aspect
ratio).~~

**Update 2026-08-15 — Ported.** `finCpShiftFraction` (`aero/fin-calc.ts`)
is an exact transcription of `calculateCPPos`/`calculatePoly`: quarter-chord
below M=0.5 (unchanged), OpenRocket's hardcoded degree-5
Mathematica-derived polynomial (a function of fin aspect ratio) between
M=0.5 and M=2, and the aspect-ratio-based empirical formula above M=2. The
Mach-validity warning threshold question is now moot — the gap this item
described no longer exists. See CHANGELOG.md (`91eca90`).

---

## 9. A hot or cold launch day is handled *oppositely* by the two tools above 11 km

**Plain English:** If you launch on an unusually hot day (or from a
high-altitude launch site), how does that warm bias fade — or not — as the
rocket climbs into the upper atmosphere? rocketry currently assumes the
warm/cool offset from "standard" conditions stays constant no matter how
high the rocket goes. OpenRocket does the opposite: it deliberately
recalculates things so the atmosphere snaps back to the exact standard
value by 11km altitude, regardless of how unusual the launch day was. This
only matters for flights that reach 11km+ on an unusually hot/cold/
high-altitude launch day — most hobby flights never get there.

**Technical detail:** rocketry's `buildLayers` (`atmosphere/isa-model.ts`)
computes a virtual sea-level temperature from the launch-site conditions
using the standard −0.0065 K/m lapse rate, then continues that same
standard rate through the standard atmosphere layers above it — so a
launch-day anomaly persists as a constant offset indefinitely. OpenRocket's
`ExtendedISAModel` constructor instead *solves for* a custom lapse rate
specifically chosen so a straight line from the launch point lands exactly
on the standard 216.65K tropopause value at 11km, by construction erasing
any launch-day anomaly by that altitude.

**Verdict: Open question.** There's no single obviously-correct convention
for extrapolating non-standard surface conditions through an idealized
atmosphere model — this is a genuine judgment call both projects made
differently, not a case where one side is right and the other wrong. Worth a
deliberate decision now that OpenRocket's specific approach could be ported
directly, but not an obvious "fix."

**Deferred 2026-08-15** — deliberately, not overlooked. Waiting until wind's
own splashcast integration lands (real launch-day weather-forecast data),
since that's more directly relevant to deciding this than picking a
convention in the abstract now. Also low urgency on its own: most hobby
flights never reach 11km.

---

## 10. The fin-in-body interference boost uses a more precise textbook formula

**Plain English:** Being close to the body tube makes a fin generate more
lift than it would sitting in open air by itself — sometimes called
"interference." OpenRocket accounts for this with a simple, approximate
formula. rocketry uses the exact closed-form textbook version (from a 1953
NACA report), which is measurably more accurate, plus an entirely separate
effect — force pushed onto the *body* by the fins' presence — that
OpenRocket's own technical documentation admits it doesn't model at all.

**Technical detail:** OpenRocket's shipped formula
(`FinSetCalc.java:150-156`) is `cna *= 1 + tau` (a squared version,
`(1+tau)²`, exists in the same file but is commented out with a "too
optimistic??" note, and is not active — this is a real, direct correction
to a comparison rocketry's own earlier code comments made against a
different, since-reverted OpenRocket pull request, not something newly
found here). rocketry's `finInBodyPresenceFactor` uses the full NACA Report
1307 equation (14) closed form instead, and a separate, cited
`bodyInFinPresenceFactor` (equation 21) captures the fin→body force
OpenRocket's own technical doc (§3.2.2) explicitly says it ignores. Both are
verified in rocketry's own test suite against the source report's stated
mathematical limits.

**Verdict: Keep (deliberate, justified).** Real, cited engineering reasoning
with verified limiting behavior — this is what independent re-derivation
done well looks like, not an artifact to revert.

---

## 11. Real per-sample motor mass data is cross-checked against the motor's own published weight

**Plain English:** Some motor data files include a real, measured
mass-vs-time curve (not just an estimate) — great when it's right. This
session, a real published motor (AeroTech J435WS) turned up with an
internally inconsistent file: its own moment-by-moment mass data disagreed
with its own advertised propellant weight by nearly a quarter. OpenRocket
would have silently trusted that bad data. rocketry now checks a motor's own
real data against its own published weight before trusting it, and falls
back to a safer estimate (with a visible warning) when they don't roughly
agree.

**Technical detail:** OpenRocket's `RockSimMotorLoader` accepts real
per-sample mass/CG data whenever it's simply a valid, finite number — no
cross-check against the motor's own published propellant weight.
rocketry's `motor-mass-curve.ts` adds a 2% consistency check
(`realDataMatchesPublishedPropellantMass`) before trusting that data,
falling back to the spec-anchored derived estimate and surfacing a visible
warning (naming which data source is actually being used) when it fails.

**Verdict: Keep — this is a rocketry-original improvement over OpenRocket,**
not a gap to close. No revert applicable; there's nothing in OpenRocket to
revert to.

---

## Everything else checked and found equivalent, deliberately out of scope, or too minor to prioritize

The full research pass also covered and confirmed as **exact matches** (no
deviation at all): the CNa-weighted CP-averaging formula; the `finCount/2`
aggregate multi-fin CNa formula; symmetric-component shoulder CNa/CP;
motor total-impulse and thrust-curve interpolation; base drag and
ogive/conical pressure-drag formulas including their transonic blending
(with the specific subtlety, already correctly noted in rocketry's own
comments, that OpenRocket's near-Mach-1 anchor point is *not* scaled by the
same multiplier the supersonic region is); and the on-pad/on-launch-rod hold
logic.

Also reviewed and found to be **deliberate, reasonably-scoped, and already
self-documented** cuts, not worth prioritizing further: no launch lugs, rail
buttons, tube fins, multi-stage, or parallel-pod support (a hard scope
limit tied to rocketry's own data model); no roll dynamics or roll damping
(ties to the no-cant-angle-input scope limit); atmosphere modeling capped at
32km (comfortably above this project's target rocket sizes); no Coriolis
acceleration or latitude-dependent gravity (both negligible for hobby-rocket
flight durations/altitudes); geometric vs. geopotential altitude in the
atmosphere layer lookup (sub-0.5% at any altitude this project targets); no
post-apogee tumbling flight mode (still moot for the general flight sim,
which stops at apogee by design — engine3d.ts's own `coastPastApogeeS` option,
added 2026-08-15 for delay-recommendation.ts, is a narrow unparachuted-coast
extension for evaluating ejection-delay choices, not a general descent/
recovery/tumbling model); no humidity modeling (OpenRocket's own default is also dry
air); a fixed 0.01s integration step vs. OpenRocket's adaptive
(rotation-rate-aware) stepping (rocketry's fixed step is already finer than
OpenRocket's own default, though OpenRocket's adaptive refinement during
fast rotational transients has no rocketry equivalent); a linear
speed-of-sound/viscosity fit (OpenRocket) vs. exact thermodynamic formulas
(rocketry) — rocketry's version is arguably more accurate here, not less;
no cross-fin-set interference accounting for rockets with multiple
overlapping fin sets (affects a data-model case rocketry doesn't support
yet); the specific numerical discretization scheme used for freeform
(non-trapezoidal) fin outlines (should agree with OpenRocket to well under
1% for any normal fin shape); and rocketry's inertia-tensor model, which is
a genuinely different from-scratch design with no OpenRocket equivalent to
compare against at all (OpenRocket derives inertia from real per-component
material density; rocketry works from a single user-entered mass/CG figure
by design, since it has no per-component material system).
