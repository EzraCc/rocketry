# OpenRocket Java validation oracle

Runs real rocket+motor combinations through OpenRocket's actual Java `core` module (headless,
no GUI) and writes the results — CP, liftoff CG/stability, apogee altitude/time, max velocity/
Mach/acceleration — as JSON fixtures in `../fixtures/openrocket/`, consumed by
`../openrocket-comparison.test.ts` to check this project's own independently re-derived physics
against.

## Why this exists

`rocketry`'s aerodynamics/simulation code is an independent re-derivation of OpenRocket's own
Barrowman implementation (see this project's own header credit) — not a port, and with at least
one deliberate deviation already (the corrected fin-body interference factor). Up until this
harness, the only cross-check was a handful of hand-picked scripts comparing one file's CP against
RockSim's own stored value. This gives a repeatable, real, automated comparison against the actual
reference implementation, for a curated set of rocket+motor cases.

## Running it

```sh
validation/openrocket-oracle/run.sh
```

That's the one command to remember — it locates the sibling `openrocket` checkout automatically
(assumes the usual `~/github/rocketry` + `~/github/openrocket` layout; override with
`OPENROCKET_REPO_DIR=/path/to/openrocket` if yours differs), builds against `openrocket`'s already-
resolved Gradle dependencies, and overwrites every JSON file in `../fixtures/openrocket/`. A rerun
after a small code change is fast (a few seconds, Gradle daemon + incremental compile) — this is
meant to be cheap enough to run every time a case is added or something looks wrong, not a
one-shot script.

To add or change a case, edit `rockets.json` (label, rocket file path relative to the `rocketry`
repo root, motor designation) and rerun. No Java knowledge needed for that part.

## What it does NOT touch

**Never modifies the `openrocket` repo.** That repo is used strictly as read-only reference
material (re-deriving its physics independently, not copying its GPLv3 code — see this project's
own plan for why). `RocketryOracle.java` lives here, in `rocketry`; `init.gradle` is an *external*
Gradle init script (`-I` flag) that adds a throwaway `:core:runRocketryOracle` task at invocation
time, compiling this file against `openrocket`'s own test sourceSet purely to reuse its already-
resolved dependencies (crucially the SQLite JDBC driver the bundled motor database needs) — nothing
is written back into that checkout, and nothing here is a permanent part of its build.

## Design notes worth knowing before touching `RocketryOracle.java`

A few things that don't work the way you'd guess from OpenRocket's public API surface alone —
confirmed by reading the actual source, not assumed, after they broke silently at first:

- **A freshly-loaded `.rkt` has no real flight configuration.** `rocket.getSelectedConfiguration()`
  returns a DEFAULT sentinel configuration whose id is special-cased to silently no-op on
  `FlightConfigurableParameterSet.set()` (used internally by motor attachment) — every motor-attach
  call would appear to succeed and do nothing. Fix: `rocket.createFlightConfiguration(null)` +
  `rocket.setSelectedConfiguration(...)` first, to get a real, non-default configuration id.
- **`FlightConfiguration` defaults every stage to inactive** (`_setAllStages(false)` in its
  constructor) — without `config.setAllStages()`, the motor mount is never found as "active",
  motor or no motor.
- **`mount.setMotorConfig(...)` alone doesn't notify anything** — `FlightConfiguration` keeps its
  own separate cached copy of "which motors exist", only rebuilt inside its `update()` method,
  which nothing calls automatically in a headless context (no GUI listener chain wired up). Skip
  either `fireComponentChangeEvent(MOTOR_CHANGE)` or `config.update()` and the simulation aborts
  with "No motors defined" despite the motor being genuinely attached.
- **Motors are plugged** (`Motor.PLUGGED_DELAY`, no ejection charge ever fires) — this project's
  own engine only models ascent-to-apogee with no recovery deployment at all, and an unplugged
  motor's ejection charge could fire before apogee (if its delay is shorter than time-to-apogee),
  changing the drag profile mid-boost-arc. Not an apples-to-apples comparison otherwise.
- **Stability margin is computed directly from CP/CG/diameter**, not read from OpenRocket's own
  `TYPE_STABILITY` data series — that series is `NaN` at t=0 in every case tried (a
  dynamic-pressure-dependent calculation dividing by zero velocity). `(cp - cg) / refDiameter` is
  exactly this project's own `stabilityMargin()` formula anyway, so it's the more directly
  comparable number, not a workaround changing what's measured.
- **RockSim's `IsMotorMount` flag is unreliable in ~2-3% of real files** — including, concretely,
  this project's own `PK-48 LOC-IV.rkt` reference fixture. `findMotorMount()` falls back to the
  last `BodyTube` in the tree when nothing was flagged, matching `parseRocksimXml`'s own identical
  fallback (see its doc comments) for the identical reason.

## Comparison Mach

CP is computed at Mach 0.1 (~100fps), matching the live UI's own reference speed (see
`renderRocketSection`/`renderFlightResultHtml` in `src/main.ts`) and
`../rocksim-embedded-cp.test.ts`'s comparison Mach — chosen because that's the actually
safety-relevant rail-exit speed, not an arbitrary "typical flight" number (see the Mach-CP
investigation this was derived from, in this project's session history / `src/physics/aero/
fin-calc.ts`'s comments on the compressibility term).
