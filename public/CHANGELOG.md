# Changelog

Scoped specifically to changes that affect **computed flight numbers** (CP, dry/loaded CG, mass,
apogee, velocity, stability margin, or anything else the [validation
report](public/validation-report.html) or the app itself shows a user) — not a general commit log
(`git log` already does that). The validation report stamps itself with the commit it was
generated at; anything listed below with a commit *after* that stamp means the report is stale for
that specific change and should be regenerated:

```
validation/openrocket-oracle/run.sh
npx tsx validation/openrocket-oracle/fetch-motor-fixtures.ts
npx tsx validation/build-report.ts
```

Add an entry here whenever a change would move any of those numbers, even slightly — that's the
whole point: a reader should be able to look at the report's stamped commit, scan down to that
point in this list, and know immediately whether anything since then matters.

## 2026-08-15

- `91eca90` — Ported OpenRocket's own supersonic/transonic fin CNa1 model, fin CP-shift model, and
  fin pressure/base drag (previously entirely absent for fins) from `FinSetCalc.java`, replacing
  formulas that were held flat past Mach 0.9 (see DEVIATIONS.md #2/#4). Changes CP, CNa, drag, and
  hence apogee/velocity/stability margin for any flight that reaches Mach>0.9 — no effect on purely
  subsonic flights. Resolved both previously-known supersonic apogee discrepancies in
  `openrocket-comparison.test.ts` (mach1-chimera-bt60-j285, mach1-chimera-98mm-m685w).
- `ca31526` — Fixed a real dry-mass/CG bug: RockSim's `<UseKnownCG>1</UseKnownCG>` overrides a
  shaped part's mass too, not just its CG — this parser only ever read it as CG-only. Changes
  `estimatedDryMassKg`/`estimatedDryCgM` for any RockSim file with a real weighed-part override
  (confirmed to matter for at least LOC-IV and Wasserfall (2.5 in) in the library).
- `54ce9ef` — Motor mass/CG calculations now prefer a real motor data file's own header weight over
  ThrustCurve.org's separately-maintained catalog figure, when they disagree (routine, ~40% of
  real-data motors per a survey done this session). Changes loaded mass/CG and hence stability
  margin for any rocket using a real-per-sample-data motor where the two sources drift.
- `902e28a` — Added a sanity check that falls back to the derived (spec-anchored) motor mass curve
  when a motor's real per-sample data disagrees with its own published propellant weight, instead
  of trusting it unconditionally. Changes which motor mass curve gets used for the (rare) files this
  applies to.

## 2026-08-14

- `57f8786` — Fixed the rocket-stats panel and the flight-sim results panel using two different
  motor mass values (spec weight vs. the real mass curve) for the same motor, which could show two
  different stability margins for the same rocket+motor. Changes the rocket-stats panel's loaded
  CG/mass to match what the flight sim actually simulates.
- `94ea90d` — Motor mass-vs-time curves now use a motor's own real per-sample propellant mass data
  (RockSim/.rse source files) when available, instead of always deriving an estimate from total/
  propellant weight. Changes the mass curve (and hence combined CG over the burn) for any motor with
  real per-sample data.
- `18c89dd` — Default launch rod length changed from 1m to 7ft (now user-adjustable). Changes
  rail-exit velocity/tip-off behavior for every simulation that doesn't explicitly set its own rod
  length.
- `5b34308` — Recovery-device descent rate now reads air density from the rocket's own launch site
  altitude instead of a hardcoded sea-level constant. Changes descent rate for any launch site
  entered above sea level.

---

*(Entries before this file existed aren't backfilled — the validation report was regenerated
alongside this file's creation, so its stamped commit already reflects everything above.)*
