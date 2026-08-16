# rocketry

**Live site: https://ezracc.github.io/rocketry/**

A browser-based flight simulator for basic model/high-power rockets (nose cone, body tubes,
transitions/boat tails, trapezoidal or freeform fins). Client-side TypeScript, no backend — the
whole app, including the 3D flight simulation, runs in the browser (via a Web Worker for the
actual integration).

This is an independent project — not a fork, submodule, or dependent package of OpenRocket.
Licensed under **GPLv3** (see `LICENSE`), matching OpenRocket's own license, so physics can
directly follow OpenRocket's own published algorithms — classical Barrowman component buildup,
transonic/supersonic fin normal-force and center-of-pressure models, the Galejs body-lift term,
and more ported straight from its source — rather than maintaining an independently re-derived
model. A handful of deliberate, documented deviations remain where this project does something
different on purpose (e.g. a corrected fin-body interference factor); every one of them, and why,
is cataloged in `DEVIATIONS.md`. Accuracy is checked directly against real OpenRocket Java
simulations and RockSim's own embedded data for a curated set of real rocket+motor cases — see the
validation report (`public/validation-report.html`, served at `/validation-report.html`, linked
from the site's own footer), generated from `validation/`, regenerate with
`validation/openrocket-oracle/run.sh` + `npx tsx validation/openrocket-oracle/fetch-motor-fixtures.ts`
+ `npx tsx validation/build-report.ts`.

## What it does

- **Rocket library**: 339 real vendor `.rkt` (RockSim) simfiles (LOC Precision, Apogee, Mach1,
  Wildman), browsable by vendor/diameter/name, or upload your own `.ork` (OpenRocket), `.rkt`
  (RockSim), or `.CDX1` (RASAero) file.
- **Motor search**: live search against [ThrustCurve.org](https://www.thrustcurve.org)'s API
  (no backend, CORS is open) — thrust curve, mass curve (real per-sample propellant mass when the
  motor's own source file has one, otherwise derived from total/propellant weight), diameter
  filtered to what physically fits the rocket's own motor mount.
- **CP/CG**: CP is always independently computed from the rocket's geometry (classical Barrowman),
  editable with a one-click "use simfile CP" pull from the source file's own last-computed value
  when available. Dry CG is estimated from the file's own per-part mass/CG data (or a whole-stage
  known-mass override when the file has one), closing the chicken-and-egg gap of needing a real
  motor installed to measure CG before you've even picked one — always overridable with a real
  measurement.
- **Flight simulation**: 3D ascent-to-apogee integration (thrust, drag, wind, weathercocking),
  charted (altitude/speed/Mach/tilt), with recovery-device descent rate estimates.
- **Scope**: single-stage rockets with standard nosecone/body/transition geometry and trapezoidal
  or freeform fins. External pods, tube fins, ring tails, cluster motor mounts, and multi-stage
  designs are detected and flagged as not currently supported (shown view/download-only) rather
  than silently simulated wrong.

## Dev

    npm install
    npm run dev            # dev server
    npm test                # vitest unit + validation suite
    npm run build            # production build (tsc -b && vite build) -> dist/
    npm run build:library    # regenerate public/library/manifest.json after adding/removing .rkt files

## Project layout

- `src/main.ts` — the whole UI (imperative DOM rendering, no framework).
- `src/formats/` — `.rkt`/`.ork`/`.CDX1` parsers.
- `src/physics/` — aero (Barrowman), mass/CG, motor, atmosphere, and the 3D sim engine.
- `src/worker/` — Web Worker wrapper so the flight sim doesn't block the UI thread.
- `public/library/` — the vendor `.rkt` library + generated manifest.
- `validation/` — cross-checks against real OpenRocket Java simulations and RockSim's own embedded
  data; see `validation/openrocket-oracle/README.md`.
