Status: backlog
Priority: medium
Type: new-feature
Last updated: 2026-08-17

# Launch rod angle + direction (weathercocking mitigation)

## Context

Real-world practice: tilting the launch rod a few degrees away from
vertical, into the wind, reduces how far a rocket weathercocks off
vertical during boost. rocketry currently always launches dead vertical --
no way to set a rod angle or direction, in the UI or via the embed/
splashcast handoff. Raised by the user after noticing it was missing;
not urgent, filed for later since weekly usage is constrained right now.

**Good news, confirmed by a quick grep (not a full investigation):** the
physics side already supports this. `Rocket` (`src/model/rocket.ts:28-29`)
already has `launchRodAngle` (rad from vertical) and `launchRodDirection`
(rad, azimuth) fields, and `derivatives3d.ts:48-49` already reads and uses
both for the on-rod phase of the simulation. `defaultRocket()` just
hardcodes both to `0` (vertical), and there is currently **no UI anywhere**
in `main.ts` to set either to anything else -- this looks like a pure UI
gap, not a missing physics capability. That claim isn't fully verified
(haven't traced exactly how derivatives3d.ts uses the two values, whether
sign/units conventions are right, or whether anything downstream assumes
vertical-only), just enough to size the work as plausibly small.

## Rough shape of the work (not fully thought through)

- Two new inputs next to launch rod length in the "Launch settings"
  article (`renderWindSectionHtml`/`wireLaunchRodInput` in `main.ts`) --
  angle (deg from vertical) and direction (compass deg), same commit-on-
  change pattern as `activeLaunchRodLengthM`.
- New `activeLaunchRodAngle`/`activeLaunchRodDirection` module state,
  threaded into `activeRocket` the same way rod length already is, feeding
  every `runFlightSim` call site.
- Sanity-check derivatives3d.ts's actual use of these two fields before
  building UI on top of them -- confirm sign conventions, and whether
  "into the wind" needs to be computed FROM the active wind profile
  (auto-suggest a direction) or is purely a manual entry either way.
- Stability/weathercocking-related copy elsewhere in the app may currently
  assume vertical launch implicitly -- worth a text sweep once the feature
  itself is built, not before.
- Open question, not resolved here: should embed mode expose this at all
  (e.g. splashcast auto-suggesting a rod angle/direction from its own wind
  data), or is this manual-entry-only, out of scope for the splashcast
  handoff for now? Punt until the base feature exists.

## Detours

- **2026-08-17: trig-vs-full-sim check, done and answered.** Before
  building any UI, ran a quick throwaway script (3 real rockets --
  LOC-IV X2, Mach1 Chimera BT60, Wildman Wasserfall 4in -- real H/I/K
  motors, real Hutto 8/15 wind) comparing a real physics rerun at a 5°
  rod tilt (into the wind) against a naive "just rotate the apogee point
  by h*tan(angle)" trig shortcut on top of one vertical sim. Result: trig
  consistently UNDERESTIMATES real drift by 30-45% across all 3 (43%,
  32%, 32%), because tilt-at-burnout roughly DOUBLES rather than just
  adding the rod's own tilt on top -- rod tilt and wind-driven AOA
  interact through the whole boost phase, not a static geometric
  relationship. **Conclusion: this app needs a real rerun of the physics
  engine per rod angle -- no cheap trig shortcut will hold up.** Directly
  answers the sizing question this feature will face once built (can a
  "try a few angles" UI reuse one cached sim, or does each angle need its
  own worker run) -- it needs its own run, same cost as any other
  rocket/motor/override change already does. Script was discarded (not
  committed, was throwaway) once the answer was clear -- no need to keep
  re-running it.

## Tasks

- [ ] Trace derivatives3d.ts's actual use of launchRodAngle/launchRodDirection (sign/units conventions)
- [ ] Add angle + direction inputs to the launch settings UI, wired like launch rod length
- [ ] Thread the new state into activeRocket / every runFlightSim call site
- [ ] Decide whether/how embed mode exposes or auto-suggests this (open question above)
- [ ] Sweep weathercocking/stability copy for vertical-launch assumptions
- [ ] Unit test: nonzero rod angle/direction visibly changes on-rod initial velocity / early trajectory (mirror existing wind-direction tests in engine3d.test.ts)
- [ ] Manual/Playwright check: angling into a nonzero constant wind measurably reduces tilt-at-burnout vs. rod angle 0 in the same wind

## Decisions

- None yet -- this is an unstarted backlog item, filed after a short
  (deliberately not-fully-thought-through) planning pass.

## Open questions

- Splashcast/embed exposure (auto-suggest vs. manual-only) -- see above,
  punt until the base feature exists.
