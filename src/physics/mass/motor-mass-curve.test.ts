import { describe, expect, it } from "vitest";
import { deriveMotorMassCurve, getMotorMassAt } from "./motor-mass-curve.js";
import type { SelectedMotor } from "../../model/rocket.js";

// Roughly an Estes C6-shaped curve (not exact data, just plausible: a spike then a tail-off).
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

describe("deriveMotorMassCurve", () => {
  const curve = deriveMotorMassCurve(motor);

  it("mass(0) equals total (launch) mass", () => {
    expect(getMotorMassAt(curve, 0)).toBeCloseTo(motor.totalMassKg, 9);
  });

  it("mass(burnout) equals total - propellant (burnout/dry mass)", () => {
    const burnout = motor.samples[motor.samples.length - 1]!.time;
    expect(getMotorMassAt(curve, burnout)).toBeCloseTo(motor.totalMassKg - motor.propellantMassKg, 6);
  });

  it("mass is monotonically non-increasing over time", () => {
    for (let i = 1; i < curve.mass.length; i++) {
      expect(curve.mass[i]!).toBeLessThanOrEqual(curve.mass[i - 1]! + 1e-12);
    }
  });

  it("never drops below the dry (burnout) mass, even past the curve's end", () => {
    expect(getMotorMassAt(curve, motor.samples[motor.samples.length - 1]!.time + 5)).toBeCloseTo(
      motor.totalMassKg - motor.propellantMassKg,
      6,
    );
  });

  it("total mass lost across the whole curve equals propellant mass exactly (by construction of the scaling step)", () => {
    const lost = curve.mass[0]! - curve.mass[curve.mass.length - 1]!;
    expect(lost).toBeCloseTo(motor.propellantMassKg, 9);
  });
});

describe("deriveMotorMassCurve — degenerate cases", () => {
  it("handles a motor with no samples", () => {
    const curve = deriveMotorMassCurve({ ...motor, samples: [] });
    expect(getMotorMassAt(curve, 0)).toBeCloseTo(motor.totalMassKg, 9);
  });

  it("handles a motor with a single sample", () => {
    const curve = deriveMotorMassCurve({ ...motor, samples: [{ time: 0, thrust: 0 }] });
    expect(getMotorMassAt(curve, 0)).toBeCloseTo(motor.totalMassKg, 9);
  });
});
