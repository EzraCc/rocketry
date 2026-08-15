import type { Rocket } from "../../model/rocket.js";
import * as V from "../../model/vec3.js";
import type { Vec3 } from "../../model/vec3.js";
import { windAt, type WindProfile } from "../../model/wind.js";
import type { IsaAtmosphere } from "../atmosphere/isa-model.js";
import { computeDragFromGeometry, type DragGeometry } from "../aero/drag-calc.js";
import { computeBarrowman } from "../aero/barrowman.js";
import { getThrustAt } from "../motor/motor-model.js";
import { combinedMassAt } from "../mass/combined-mass.js";
import { combinedInertiaAt, computeDryInertiaModel, type DryInertiaModel } from "../mass/inertia-estimate.js";
import type { MassCurve } from "../mass/motor-mass-curve.js";
import type { Sim3DState } from "./types3d.js";

const G = 9.80665;
const STALL_ANGLE = (20 * Math.PI) / 180; // rad, matches the linear-theory CNa validity limit used elsewhere in this project

/**
 * OpenRocket's own RK4SimulationStepper.PITCH_YAW_RANDOM: a small random perturbation added to
 * the pitch and yaw moment coefficients EVERY force evaluation (its own comment: "to prevent
 * over-perfect flight"). Without it, a perfectly symmetric rocket in a perfectly noise-free,
 * no-wind simulation flies a mathematically exact straight line even when only barely stable --
 * the nudge is what reveals that fragility, rather than a bid at "more realistic" flight per se.
 * See computeDerivative3D's own doc comment for how this gets applied here.
 */
const PITCH_YAW_RANDOM = 0.0005;

export interface Sim3DContext {
  rocket: Rocket;
  massCurve: MassCurve | null;
  atmosphere: IsaAtmosphere;
  dragGeometry: DragGeometry;
  dryInertiaModel: DryInertiaModel;
  rodDirection: Vec3; // unit vector
  windProfile: WindProfile | null;
  /** Seeded PRNG for the pitch/yaw stability-margin nudge (see PITCH_YAW_RANDOM) -- null (the
   * default, via buildSim3DContext's own optional param) disables it entirely, keeping every
   * existing caller's deterministic, reproducible output unchanged. */
  rng: (() => number) | null;
}

export function buildSim3DContext(
  rocket: Rocket,
  massCurve: MassCurve | null,
  atmosphere: IsaAtmosphere,
  dragGeometry: DragGeometry,
  rng: (() => number) | null = null,
): Sim3DContext {
  const rodAngle = rocket.launchRodAngle;
  const azimuth = rocket.launchRodDirection;
  const rodDirection: Vec3 = {
    x: Math.sin(rodAngle) * Math.sin(azimuth),
    y: Math.sin(rodAngle) * Math.cos(azimuth),
    z: Math.cos(rodAngle),
  };
  return {
    rocket,
    massCurve,
    atmosphere,
    dragGeometry,
    dryInertiaModel: computeDryInertiaModel(rocket),
    rodDirection,
    windProfile: rocket.windProfile,
    rng,
  };
}

/**
 * An arbitrary orthonormal basis for the plane perpendicular to `axis` -- used to turn OpenRocket's
 * own separate body-frame pitch(Y)/yaw(X) moment-coefficient perturbations into a single
 * perpendicular-torque equivalent, since this project (unlike OpenRocket) has no roll degree of
 * freedom to anchor a canonical body-frame orientation. The absolute orientation of perp1/perp2
 * doesn't matter physically: both components are independently redrawn every call anyway (see
 * computeDerivative3D), so this is equivalent to a genuinely random 2D vector in that plane either way.
 */
function perpendicularBasis(axis: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(axis.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const perp1 = V.normalize(V.cross(axis, helper));
  const perp2 = V.cross(axis, perp1); // already unit length -- axis and perp1 are orthonormal
  return [perp1, perp2];
}

export interface Derivative3D {
  dPosition: Vec3;
  dVelocity: Vec3;
  dAxis: Vec3;
  dAngularVelocity: Vec3;
  thrust: number;
  drag: number;
  mass: number;
  mach: number;
  aoaRad: number;
}

export function computeDerivative3D(ctx: Sim3DContext, t: number, state: Sim3DState): Derivative3D {
  const { rocket, massCurve, atmosphere, dragGeometry, dryInertiaModel, rodDirection, windProfile } = ctx;
  const { position, velocity, axis, angularVelocity } = state;

  const massState = massCurve ? combinedMassAt(rocket, massCurve, t) : { mass: rocket.dryMass, cgX: rocket.dryCg };
  const mass = massState.mass;
  const thrust = rocket.motor && massCurve ? getThrustAt(rocket.motor, t) : 0;

  const absoluteAltitude = rocket.launchAltitude + Math.max(position.z, 0);
  const atm = atmosphere.at(absoluteAltitude);
  const weightVec: Vec3 = { x: 0, y: 0, z: -mass * G };

  const onRod = V.dot(position, rodDirection) < rocket.launchRodLength;
  const weightAlongRod = -V.dot(weightVec, rodDirection); // resisting component (positive)

  // On-pad hold: mirrors M3's ground-hold logic, generalized to the rod direction.
  if (position.z <= 0 && V.dot(velocity, rodDirection) <= 0 && thrust <= weightAlongRod) {
    return { dPosition: V.ZERO, dVelocity: V.ZERO, dAxis: V.ZERO, dAngularVelocity: V.ZERO, thrust, drag: 0, mass, mach: 0, aoaRad: 0 };
  }

  const wind = windProfile ? windAt(windProfile, absoluteAltitude) : { vx: 0, vy: 0 };
  const windVelocity: Vec3 = { x: wind.vx, y: wind.vy, z: 0 };
  const relativeAirspeed = V.sub(velocity, windVelocity);
  const speed = V.length(relativeAirspeed);
  const mach = speed / atm.speedOfSound;

  const dragResult = computeDragFromGeometry(dragGeometry, speed, mach, atm);
  const q = 0.5 * atm.density * speed * speed;
  const dragForceMag = dragResult.cd * q * dragGeometry.refArea;
  const dragForce = speed > 1e-6 ? V.scale(V.normalize(relativeAirspeed), -dragForceMag) : V.ZERO;

  const thrustForce = V.scale(axis, thrust);

  // Barrowman CP at this Mach -- CP position itself never depends on AOA (matches OpenRocket's own
  // fin CP-shift formula, Mach-only), so this first pass is enough to get the lever arm needed to
  // compute the real local AOA below, before the fin CNa1 term that DOES need it (supersonically)
  // is evaluated a second time, just below, with that real value.
  const barrowmanForCp = computeBarrowman(rocket.components, mach);
  const leverArm = V.scale(axis, massState.cgX - barrowmanForCp.cpX); // CG -> CP

  // Single unified local-flow-at-CP calculation: this is what produces BOTH the restoring
  // moment (from the CG's translational crossflow) AND aerodynamic damping (from the
  // rotation-induced local velocity at the CP), from one physically consistent local AOA,
  // rather than two separately-derived terms.
  const rotationalVelocityAtCp = V.cross(angularVelocity, leverArm);
  const localFlowAtCp = V.add(relativeAirspeed, rotationalVelocityAtCp);
  const perpAtCp = V.perpendicularComponent(localFlowAtCp, axis);
  const perpMag = V.length(perpAtCp);
  const axialComponent = V.dot(relativeAirspeed, axis);
  const localAoa = Math.atan2(perpMag, axialComponent);
  const clampedAoa = Math.min(localAoa, STALL_ANGLE);

  // Second pass, now that the real local AOA is known -- only changes anything supersonically (see
  // fin-calc.ts's finCNa1): the fin normal-force-slope's K2*alpha+K3*alpha² terms are themselves
  // AOA-dependent there, unlike the purely-Mach-dependent subsonic/CP formulas above.
  const barrowman = computeBarrowman(rocket.components, mach, clampedAoa);

  const normalForceMag = barrowman.cna * clampedAoa * q * barrowman.refArea;
  const normalForceDir = perpMag > 1e-9 ? V.scale(perpAtCp, -1 / perpMag) : V.ZERO;
  const normalForce = V.scale(normalForceDir, normalForceMag);

  const totalForce = V.add(V.add(V.add(thrustForce, dragForce), weightVec), normalForce);

  if (onRod) {
    const accelAlongRod = V.dot(totalForce, rodDirection) / mass;
    return {
      dPosition: velocity,
      dVelocity: V.scale(rodDirection, accelAlongRod),
      dAxis: V.ZERO,
      dAngularVelocity: V.ZERO,
      thrust,
      drag: dragForceMag,
      mass,
      mach,
      aoaRad: 0, // locked to the rod — AOA can't manifest as rotation, not meaningful to report
    };
  }

  let torque = V.cross(leverArm, normalForce);
  // Pitch/yaw stability-margin nudge (see PITCH_YAW_RANDOM's own doc comment) -- ported as an
  // equivalent perpendicular-torque perturbation rather than OpenRocket's own separate body-frame
  // Cm/Cyaw coefficients (see perpendicularBasis's own doc comment for why: no roll DOF here to
  // anchor a canonical body frame). Drawn fresh on every call, matching OpenRocket's own
  // calculateForces being invoked once per RK4 sub-stage (k1..k4), not once per whole step.
  if (ctx.rng) {
    const [perp1, perp2] = perpendicularBasis(axis);
    const momentScale = q * barrowman.refArea * barrowman.refDiameter;
    const pitchPerturbation = PITCH_YAW_RANDOM * 2 * (ctx.rng() - 0.5) * momentScale;
    const yawPerturbation = PITCH_YAW_RANDOM * 2 * (ctx.rng() - 0.5) * momentScale;
    torque = V.add(torque, V.add(V.scale(perp1, pitchPerturbation), V.scale(perp2, yawPerturbation)));
  }
  const inertia = combinedInertiaAt(rocket, dryInertiaModel, massCurve, massState.cgX, t);
  const dAngularVelocity = V.scale(torque, 1 / inertia);
  const dAxis = V.cross(angularVelocity, axis);

  return {
    dPosition: velocity,
    dVelocity: V.scale(totalForce, 1 / mass),
    dAxis,
    dAngularVelocity,
    thrust,
    drag: dragForceMag,
    mass,
    mach,
    // AOA is physically meaningless (and atan2 gets numerically noisy) when relative airspeed is
    // near zero (e.g. right at/through the velocity zero-crossing at apogee) — report 0 rather
    // than a spurious near-180deg reading. This doesn't affect the actual dynamics: q (and hence
    // normalForceMag) already naturally vanishes at low speed regardless of what AOA is computed.
    aoaRad: speed > 0.5 ? localAoa : 0,
  };
}
