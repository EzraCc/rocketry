import { describe, expect, it } from "vitest";
import { combinedMassAt, motorAxialPosition } from "./combined-mass.js";
import { deriveMotorMassCurve } from "./motor-mass-curve.js";
import { defaultRocket, type Rocket, type SelectedMotor } from "../../model/rocket.js";
import type { Component } from "../../model/component.js";

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

function makeRocket(overhang = 0): Rocket {
  const components: Component[] = [
    { type: "nosecone", id: "nose", name: "n", shape: "conical", shapeParameter: 1, length: 0.1, aftRadius: 0.0125, thickness: 0.002 },
    { type: "bodytube", id: "tube", name: "t", length: 0.3, radius: 0.0125, thickness: 0.001, isMotorMount: true },
  ];
  return {
    ...defaultRocket(),
    components,
    dryMass: 0.05,
    dryCg: 0.2,
    motorMount: { componentId: "tube", motorOverhang: overhang },
    motor,
  };
}

describe("motorAxialPosition", () => {
  it("places the motor at the mount's aft end, offset by overhang", () => {
    const rocket = makeRocket(0);
    const pos = motorAxialPosition(rocket);
    expect(pos).not.toBeNull();
    // tube spans x0=0.1 (after nose) to 0.4 (aft end); no overhang -> motor aft end at 0.4
    expect(pos!.aftX).toBeCloseTo(0.4, 9);
    expect(pos!.foreX).toBeCloseTo(0.4 - motor.length, 9);
    expect(pos!.cgX).toBeCloseTo(0.4 - motor.length / 2, 9);
  });

  it("shifts aft with positive overhang", () => {
    const rocket = makeRocket(0.02);
    const pos = motorAxialPosition(rocket);
    expect(pos!.aftX).toBeCloseTo(0.42, 9);
  });

  it("returns null when no motor is selected", () => {
    const rocket = { ...makeRocket(0), motor: null };
    expect(motorAxialPosition(rocket)).toBeNull();
  });

  it("returns null when the mount component id doesn't exist", () => {
    const rocket = { ...makeRocket(0), motorMount: { componentId: "nonexistent", motorOverhang: 0 } };
    expect(motorAxialPosition(rocket)).toBeNull();
  });
});

describe("combinedMassAt", () => {
  const rocket = makeRocket(0);
  const massCurve = deriveMotorMassCurve(motor);

  it("total mass at t=0 is dry mass + full motor mass", () => {
    const { mass } = combinedMassAt(rocket, massCurve, 0);
    expect(mass).toBeCloseTo(rocket.dryMass + motor.totalMassKg, 9);
  });

  it("total mass at burnout is dry mass + motor burnout (dry) mass", () => {
    const burnout = motor.samples[motor.samples.length - 1]!.time;
    const { mass } = combinedMassAt(rocket, massCurve, burnout);
    expect(mass).toBeCloseTo(rocket.dryMass + (motor.totalMassKg - motor.propellantMassKg), 6);
  });

  it("CG shifts forward (toward dry CG) as the motor burns, since the motor sits aft of dry CG", () => {
    const cgAtStart = combinedMassAt(rocket, massCurve, 0).cgX;
    const cgAtBurnout = combinedMassAt(rocket, massCurve, motor.samples[motor.samples.length - 1]!.time).cgX;
    expect(cgAtStart).toBeGreaterThan(rocket.dryCg);
    expect(cgAtBurnout).toBeLessThan(cgAtStart);
    expect(cgAtBurnout).toBeGreaterThan(rocket.dryCg); // motor still has burnout mass, doesn't fully vanish
  });

  it("falls back to dry mass/CG when no motor is present", () => {
    const noMotorRocket = { ...rocket, motor: null };
    const result = combinedMassAt(noMotorRocket, massCurve, 0);
    expect(result.mass).toBeCloseTo(rocket.dryMass, 9);
    expect(result.cgX).toBeCloseTo(rocket.dryCg, 9);
  });
});
