import * as V from "../../model/vec3.js";
import { computeDerivative3D, type Sim3DContext } from "./derivatives3d.js";
import type { Sim3DState } from "./types3d.js";

interface StateDelta {
  dPosition: V.Vec3;
  dVelocity: V.Vec3;
  dAxis: V.Vec3;
  dAngularVelocity: V.Vec3;
}

function addState(state: Sim3DState, d: StateDelta, scale: number): Sim3DState {
  return {
    position: V.add(state.position, V.scale(d.dPosition, scale)),
    velocity: V.add(state.velocity, V.scale(d.dVelocity, scale)),
    axis: V.add(state.axis, V.scale(d.dAxis, scale)),
    angularVelocity: V.add(state.angularVelocity, V.scale(d.dAngularVelocity, scale)),
  };
}

/**
 * Classic 4-stage Runge-Kutta step for the full 3D (position, velocity,
 * axis, angularVelocity) state. Re-normalizes axis at the end — it should
 * stay unit length, but RK4's blended update can drift it slightly.
 */
export function rk4Step3D(ctx: Sim3DContext, t: number, state: Sim3DState, dt: number): Sim3DState {
  const k1 = computeDerivative3D(ctx, t, state);
  const k2 = computeDerivative3D(ctx, t + dt / 2, addState(state, k1, dt / 2));
  const k3 = computeDerivative3D(ctx, t + dt / 2, addState(state, k2, dt / 2));
  const k4 = computeDerivative3D(ctx, t + dt, addState(state, k3, dt));

  const dPosition = V.rk4Blend(k1.dPosition, k2.dPosition, k3.dPosition, k4.dPosition);
  const dVelocity = V.rk4Blend(k1.dVelocity, k2.dVelocity, k3.dVelocity, k4.dVelocity);
  const dAxis = V.rk4Blend(k1.dAxis, k2.dAxis, k3.dAxis, k4.dAxis);
  const dAngularVelocity = V.rk4Blend(k1.dAngularVelocity, k2.dAngularVelocity, k3.dAngularVelocity, k4.dAngularVelocity);

  const next = addState(state, { dPosition, dVelocity, dAxis, dAngularVelocity }, dt);
  return { ...next, axis: V.normalize(next.axis) };
}
