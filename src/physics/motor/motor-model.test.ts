import { describe, expect, it } from "vitest";
import { burnTime, getThrustAt, totalImpulse } from "./motor-model.js";
import type { SelectedMotor } from "../../model/rocket.js";

const motor: SelectedMotor = {
  motorId: "test",
  designation: "C6",
  manufacturer: "Estes",
  diameter: 0.018,
  length: 0.07,
  totalMassKg: 0.0241,
  propellantMassKg: 0.0108,
  samples: [
    { time: 0, thrust: 0 },
    { time: 0.2, thrust: 14 },
    { time: 0.5, thrust: 5 },
    { time: 1.8, thrust: 4 },
    { time: 1.9, thrust: 0 },
  ],
  delay: 5,
};

describe("motor-model", () => {
  it("getThrustAt returns exact sample values and interpolates between them", () => {
    expect(getThrustAt(motor, 0.2)).toBeCloseTo(14, 9);
    expect(getThrustAt(motor, 0.35)).toBeCloseTo(9.5, 9); // halfway 14->5
  });

  it("getThrustAt is zero before ignition and after burnout", () => {
    expect(getThrustAt(motor, -1)).toBe(0);
    expect(getThrustAt(motor, 10)).toBe(0);
  });

  it("burnTime is the last sample's time", () => {
    expect(burnTime(motor)).toBeCloseTo(1.9, 9);
  });

  it("totalImpulse matches manual trapezoidal calculation", () => {
    // 0.5*(0+14)*0.2 + 0.5*(14+5)*0.3 + 0.5*(5+4)*1.3 + 0.5*(4+0)*0.1
    const expected = 0.5 * 14 * 0.2 + 0.5 * 19 * 0.3 + 0.5 * 9 * 1.3 + 0.5 * 4 * 0.1;
    expect(totalImpulse(motor)).toBeCloseTo(expected, 9);
  });
});
