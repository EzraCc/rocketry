import { describe, expect, it } from "vitest";
import { descentRate } from "./descent-rate.js";
import type { DescentDevice } from "../../formats/rocksim/parse.js";

const MAIN: DescentDevice = { type: "parachute", role: "main", dragAreaM2: 1.0, dragCoefficient: 0.8 };

describe("descentRate", () => {
  it("matches the standard terminal-velocity formula for round numbers", () => {
    // v = sqrt(2*m*g / (rho*Cd*A)) -- m=1kg, rho=1.225 (sea level), Cd=0.8, A=1 m^2
    const v = descentRate(MAIN, 1, 1.225);
    const expected = Math.sqrt((2 * 1 * 9.80665) / (1.225 * 0.8 * 1));
    expect(v).toBeCloseTo(expected, 10);
  });

  it("heavier descending mass falls faster", () => {
    const light = descentRate(MAIN, 1, 1.225);
    const heavy = descentRate(MAIN, 2, 1.225);
    expect(heavy).toBeGreaterThan(light);
  });

  it("more drag area (bigger canopy) falls slower", () => {
    const small: DescentDevice = { ...MAIN, dragAreaM2: 0.5 };
    const big: DescentDevice = { ...MAIN, dragAreaM2: 2.0 };
    expect(descentRate(big, 1, 1.225)).toBeLessThan(descentRate(small, 1, 1.225));
  });

  it("thinner air (higher altitude) means a faster descent rate for the same device/mass", () => {
    const seaLevel = descentRate(MAIN, 1, 1.225);
    const thinnerAir = descentRate(MAIN, 1, 0.9);
    expect(thinnerAir).toBeGreaterThan(seaLevel);
  });

  it("a drogue (small area) falls faster than a main (large area) for the same mass -- real dual-deploy shape", () => {
    const drogue: DescentDevice = { type: "parachute", role: "drogue", dragAreaM2: 0.1, dragCoefficient: 0.8 };
    const main: DescentDevice = { type: "parachute", role: "main", dragAreaM2: 1.0, dragCoefficient: 0.8 };
    expect(descentRate(drogue, 1.5, 1.225)).toBeGreaterThan(descentRate(main, 1.5, 1.225));
  });
});
