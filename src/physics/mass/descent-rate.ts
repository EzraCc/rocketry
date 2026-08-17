import type { DescentDevice } from "../../formats/rocksim/parse.js";

const STANDARD_GRAVITY_MS2 = 9.80665; // matches isa-model.ts's own G0

/**
 * Terminal (constant) descent velocity under one recovery device: v = sqrt(2*m*g / (rho*Cd*A)).
 * `descentMassKg` is the descending mass at THIS point in the flight -- for a spent rocket under
 * chute, that's dry mass plus the spent motor casing (loaded mass minus propellant, since the
 * propellant itself is long gone by ejection), not bare dry mass (understates it) or full loaded
 * mass (still counts burned propellant). See main.ts's renderDescentDevicesSection for how that's
 * derived from the active rocket + motor.
 */
export function descentRate(device: DescentDevice, descentMassKg: number, airDensityKgM3: number): number {
  return Math.sqrt((2 * descentMassKg * STANDARD_GRAVITY_MS2) / (airDensityKgM3 * device.dragCoefficient * device.dragAreaM2));
}
