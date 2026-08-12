import { computeDerivative, type SimContext } from "./derivatives.js";

export interface Rk4State {
  altitude: number;
  velocity: number;
}

/** Classic 4-stage Runge-Kutta step for the (altitude, velocity) state. */
export function rk4Step(ctx: SimContext, t: number, state: Rk4State, dt: number): Rk4State {
  const k1 = computeDerivative(ctx, t, state.altitude, state.velocity);
  const k2 = computeDerivative(
    ctx,
    t + dt / 2,
    state.altitude + (k1.dAltitude * dt) / 2,
    state.velocity + (k1.dVelocity * dt) / 2,
  );
  const k3 = computeDerivative(
    ctx,
    t + dt / 2,
    state.altitude + (k2.dAltitude * dt) / 2,
    state.velocity + (k2.dVelocity * dt) / 2,
  );
  const k4 = computeDerivative(ctx, t + dt, state.altitude + k3.dAltitude * dt, state.velocity + k3.dVelocity * dt);

  return {
    altitude: state.altitude + (dt / 6) * (k1.dAltitude + 2 * k2.dAltitude + 2 * k3.dAltitude + k4.dAltitude),
    velocity: state.velocity + (dt / 6) * (k1.dVelocity + 2 * k2.dVelocity + 2 * k3.dVelocity + k4.dVelocity),
  };
}
