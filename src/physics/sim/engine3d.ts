import type { Rocket } from "../../model/rocket.js";
import * as V from "../../model/vec3.js";
import { IsaAtmosphere } from "../atmosphere/isa-model.js";
import { computeDragGeometry } from "../aero/drag-calc.js";
import { deriveMotorMassCurve } from "../mass/motor-mass-curve.js";
import { burnTime } from "../motor/motor-model.js";
import { buildSim3DContext, computeDerivative3D, type Sim3DContext } from "./derivatives3d.js";
import { rk4Step3D } from "./rk4-stepper3d.js";
import type { FlightEvent3D, Sim3DState, SimResult3D, SimSample3D } from "./types3d.js";

const DT = 0.01; // s, max step
const DT_ON_ROD = 0.001; // s, finer step while still on the rod — an RK4 step whose sub-stages
// straddle the rod-clearance moment blends locked-vs-free physics inconsistently within that one
// step, producing a small spurious rotation right at the transition; a finer step there (matching
// the spirit of real tools' rod fine-stepping, e.g. ~10+ substeps across the rod) keeps that error negligible.
const MAX_TIME = 300; // s, safety cap
const EPS = 1e-9;

// Barrowman's CNa/CP formulas (the entire aero model here) are a linear,
// subsonic slender-body/thin-airfoil theory — they have no mechanism for
// shock formation, boundary-layer separation, or the real CP shift through
// transonic (well documented in missile aerodynamics: CP moves substantially
// aft from ~M0.8 to ~M1.2, then forward again into supersonic). RASAero's own
// documentation cites transonic drag rise beginning around M0.8, reaching
// full rise by M0.9 — this project uses the same M0.8 threshold as "outside
// this model's validated range" rather than silently extrapolating a theory
// past where it's derived to hold.
const MACH_VALIDITY_LIMIT = 0.8;

function tiltFromVerticalDeg(axis: V.Vec3): number {
  const cosTilt = Math.max(-1, Math.min(1, axis.z)); // dot(axis, (0,0,1))
  return (Math.acos(cosTilt) * 180) / Math.PI;
}

/**
 * M4: ascent to apogee with wind, weathercocking, and a launch-rod
 * rotational constraint — the full generalization of M3's straight-up-only
 * integrator. See engine.ts (M3) for the simpler 1D reference this reduces
 * to when there's no wind and the rocket launches perfectly vertical
 * (verified as a regression test in engine3d.test.ts).
 */
export function simulateFlight3D(rocket: Rocket): SimResult3D {
  const warnings: string[] = [];
  const massCurve = rocket.motor ? deriveMotorMassCurve(rocket.motor) : null;
  const atmosphere = new IsaAtmosphere({
    altitude: rocket.launchAltitude,
    temperature: rocket.launchTemperature,
    pressure: rocket.launchPressure,
  });
  const dragGeometry = computeDragGeometry(rocket.components);
  const ctx: Sim3DContext = buildSim3DContext(rocket, massCurve, atmosphere, dragGeometry);

  const bt = rocket.motor ? burnTime(rocket.motor) : 0;
  const boundaryTimes = (rocket.motor?.samples.map((s) => s.time) ?? []).filter((st) => st > EPS).sort((a, b) => a - b);
  const nextBoundary = (time: number): number => {
    for (const bTime of boundaryTimes) {
      if (bTime > time + EPS) return bTime;
    }
    return Infinity;
  };

  const samples: SimSample3D[] = [];
  const events: FlightEvent3D[] = [];
  let liftoffFired = false;
  let launchRodFired = false;
  let burnoutFired = false;
  let maxVelocity = 0;
  let maxAcceleration = 0;
  let maxMach = 0;
  let maxAoaDeg = 0;
  let maxTiltFromVerticalDeg = 0;
  let burnoutAltitude: number | null = null;
  let tiltAtBurnoutDeg: number | null = null;

  let t = 0;
  let state: Sim3DState = { position: V.ZERO, velocity: V.ZERO, axis: ctx.rodDirection, angularVelocity: V.ZERO };

  const pushSample = (time: number, s: Sim3DState): void => {
    const d = computeDerivative3D(ctx, time, s);
    const speed = V.length(s.velocity);
    const accelMag = V.length(d.dVelocity);
    const tilt = tiltFromVerticalDeg(s.axis);
    const aoaDeg = (d.aoaRad * 180) / Math.PI;
    samples.push({
      time,
      position: s.position,
      velocity: s.velocity,
      axis: s.axis,
      angularVelocity: s.angularVelocity,
      altitude: s.position.z,
      speed,
      aoaDeg,
      tiltFromVerticalDeg: tilt,
      mach: d.mach,
      mass: d.mass,
      thrust: d.thrust,
      drag: d.drag,
    });
    maxVelocity = Math.max(maxVelocity, speed);
    maxAcceleration = Math.max(maxAcceleration, accelMag);
    maxMach = Math.max(maxMach, d.mach);
    maxAoaDeg = Math.max(maxAoaDeg, aoaDeg);
    maxTiltFromVerticalDeg = Math.max(maxTiltFromVerticalDeg, tilt);
  };

  pushSample(t, state);

  if (!rocket.motor) {
    warnings.push("No motor selected — the rocket sits on the pad with zero thrust.");
    return {
      samples, events, apogeeAltitude: 0, apogeeTime: 0, maxVelocity: 0, maxAcceleration: 0, maxMach: 0,
      maxAoaDeg: 0, maxTiltFromVerticalDeg: 0, tiltAtBurnoutDeg: null, burnoutAltitude: null, warnings,
    };
  }

  let apogeeReached = false;
  let apogeeAltitude = 0;
  let apogeeTime = 0;

  while (t < MAX_TIME) {
    const prevPositionZ = state.position.z;
    const prevVelocityZ = state.velocity.z;

    const maxStep = launchRodFired ? DT : DT_ON_ROD;
    const dt = Math.min(maxStep, nextBoundary(t) - t);
    const next = rk4Step3D(ctx, t, state, dt);
    const nextT = t + dt;

    if (!liftoffFired && V.dot(state.velocity, ctx.rodDirection) <= 0 && V.dot(next.velocity, ctx.rodDirection) > 0) {
      liftoffFired = true;
      events.push({ type: "LIFTOFF", time: nextT, altitude: next.position.z });
    }

    if (liftoffFired && !launchRodFired && V.dot(next.position, ctx.rodDirection) >= rocket.launchRodLength) {
      launchRodFired = true;
      events.push({ type: "LAUNCHROD", time: nextT, altitude: next.position.z });
    }

    if (!burnoutFired && nextT >= bt - EPS) {
      burnoutFired = true;
      burnoutAltitude = next.position.z;
      tiltAtBurnoutDeg = tiltFromVerticalDeg(next.axis);
      events.push({ type: "BURNOUT", time: nextT, altitude: next.position.z });
      if (!liftoffFired) {
        t = nextT;
        state = next;
        pushSample(t, state);
        break;
      }
    }

    if (liftoffFired && prevVelocityZ > 0 && next.velocity.z <= 0) {
      const frac = prevVelocityZ / (prevVelocityZ - next.velocity.z);
      apogeeTime = t + frac * dt;
      apogeeAltitude = prevPositionZ + frac * (next.position.z - prevPositionZ);
      apogeeReached = true;
      events.push({ type: "APOGEE", time: apogeeTime, altitude: apogeeAltitude });
      pushSample(nextT, next);
      break;
    }

    t = nextT;
    state = next;
    pushSample(t, state);
  }

  if (!liftoffFired) {
    warnings.push("Rocket never lifted off — thrust never exceeded weight.");
  } else if (!apogeeReached) {
    warnings.push(`Simulation did not reach apogee within ${MAX_TIME}s — results may be incomplete.`);
    apogeeAltitude = maxVelocity > 0 ? state.position.z : 0;
    apogeeTime = t;
  }

  // Checked at burnout (not the flight-wide max) since tilt legitimately approaches ~90deg near
  // ANY sufficiently stable rocket's own apogee as vertical velocity vanishes — that's correct
  // physics, not instability. Large tilt already present by burnout (still under thrust / high
  // dynamic pressure) is the genuine red flag.
  if (tiltAtBurnoutDeg !== null && tiltAtBurnoutDeg > 45) {
    warnings.push(`Large tilt from vertical by burnout (${tiltAtBurnoutDeg.toFixed(0)}°) — the rocket may be unstable/tumbling rather than weathercocking normally.`);
  }

  if (maxMach > MACH_VALIDITY_LIMIT) {
    warnings.push(
      `Peak Mach ${maxMach.toFixed(2)} exceeds ~${MACH_VALIDITY_LIMIT} — CP/CNa here use a linear subsonic (Barrowman) aerodynamic model with no transonic/supersonic CP-shift modeling. Stability margin and weathercocking results above this Mach should be treated as unreliable, not just approximate.`,
    );
  }

  return {
    samples,
    events,
    apogeeAltitude,
    apogeeTime,
    maxVelocity,
    maxAcceleration,
    maxMach,
    maxAoaDeg,
    maxTiltFromVerticalDeg,
    tiltAtBurnoutDeg,
    burnoutAltitude,
    warnings,
  };
}
