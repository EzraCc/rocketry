import type { Rocket } from "../../model/rocket.js";
import type { IsaAtmosphere } from "../atmosphere/isa-model.js";
import { computeDragFromGeometry, type DragGeometry } from "../aero/drag-calc.js";
import { getThrustAt } from "../motor/motor-model.js";
import { combinedMassAt } from "../mass/combined-mass.js";
import type { MassCurve } from "../mass/motor-mass-curve.js";

const G = 9.80665; // m/s^2, standard gravity (constant with altitude — see plan's stated simplification)

export interface Derivative {
  dAltitude: number; // = velocity
  dVelocity: number; // = acceleration
  thrust: number;
  drag: number;
  mass: number;
  mach: number;
}

/**
 * Precomputed, per-simulation-run constants passed into every derivative
 * evaluation, so the expensive parts (drag geometry's numeric wetted-area
 * integration, reference area) are computed once rather than at every RK4
 * substep.
 */
export interface SimContext {
  rocket: Rocket;
  massCurve: MassCurve | null; // null when no motor is selected (freefall/no-thrust sanity case)
  atmosphere: IsaAtmosphere;
  dragGeometry: DragGeometry;
}

export function computeDerivative(ctx: SimContext, t: number, altitude: number, velocity: number): Derivative {
  const { rocket, massCurve, atmosphere, dragGeometry } = ctx;

  const massState = massCurve ? combinedMassAt(rocket, massCurve, t) : { mass: rocket.dryMass, cgX: rocket.dryCg };
  const mass = massState.mass;
  const thrust = rocket.motor && massCurve ? getThrustAt(rocket.motor, t) : 0;

  const absoluteAltitude = rocket.launchAltitude + Math.max(altitude, 0);
  const atm = atmosphere.at(absoluteAltitude);
  const weight = mass * G;

  // On-pad hold: the rocket can't sink below the ground, and while net force
  // is still non-positive it just sits there (normal force from the pad
  // balances gravity+any sub-liftoff thrust) rather than the integrator
  // computing a spurious downward acceleration into the ground.
  if (altitude <= 0 && velocity <= 0 && thrust <= weight) {
    return { dAltitude: 0, dVelocity: 0, thrust, drag: 0, mass, mach: 0 };
  }

  const mach = Math.abs(velocity) / atm.speedOfSound;
  const dragResult = computeDragFromGeometry(dragGeometry, Math.abs(velocity), mach, atm);
  const dynamicPressure = 0.5 * atm.density * velocity * velocity;
  const dragForce = dragResult.cd * dynamicPressure * dragGeometry.refArea;
  const dragSigned = velocity >= 0 ? -dragForce : dragForce; // always opposes motion

  const acceleration = (thrust + dragSigned - weight) / mass;

  return { dAltitude: velocity, dVelocity: acceleration, thrust, drag: dragForce, mass, mach };
}
