import { describe, expect, it } from "vitest";
import { simulateAscent } from "./engine.js";
import { defaultRocket, type Rocket, type SelectedMotor } from "../../model/rocket.js";
import type { Component } from "../../model/component.js";

const G = 9.80665;

function zeroDragRocket(motor: SelectedMotor | null, overrides: Partial<Rocket> = {}): Rocket {
  // Near-zero radius -> refArea ~ 0 -> computeDragFromGeometry's guard returns cd=0 exactly,
  // isolating the integrator/event-detection logic from the drag model entirely.
  const components: Component[] = [
    { type: "nosecone", id: "nose", name: "n", shape: "conical", shapeParameter: 1, length: 0.1, aftRadius: 1e-9, thickness: 1e-10 },
    { type: "bodytube", id: "tube", name: "t", length: 0.3, radius: 1e-9, thickness: 1e-10, isMotorMount: true },
  ];
  return {
    ...defaultRocket(),
    components,
    dryMass: 0.5,
    dryCg: 0.2,
    motorMount: { componentId: "tube", motorOverhang: 0 },
    motor,
    launchRodLength: 0.01, // effectively irrelevant to this check
    ...overrides,
  };
}

describe("simulateAscent — closed-form validation (constant thrust, zero drag, constant mass)", () => {
  // A motor with a flat thrust curve and zero propellant mass burns for a
  // fixed time while its mass stays exactly constant (deriveMotorMassCurve's
  // impulse-proportional scaling degenerates to zero mass loss when
  // propellantMassKg=0) -- this reduces the whole flight to textbook
  // constant-acceleration kinematics with an exact closed-form answer,
  // independent of the drag model or motor mass-curve complexity.
  const thrust = 50; // N
  const burnTime = 2.0; // s
  const motorMass = 0.1; // kg, constant (zero propellant)
  const dryMass = 0.5; // kg
  const totalMass = dryMass + motorMass;

  const motor: SelectedMotor = {
    motorId: "const",
    designation: "CONST50",
    manufacturer: "test",
    diameter: 0.024,
    length: 0.1,
    totalMassKg: motorMass,
    propellantMassKg: 0,
    samples: [
      { time: 0, thrust },
      { time: burnTime - 1e-4, thrust }, // flat 50N right up to (just before) burnout...
      { time: burnTime, thrust: 0 }, // ...then an effectively-instant cutoff (negligible extra impulse: 0.5*50*1e-4 N*s)
    ],
    delay: 0,
  };

  const rocket = zeroDragRocket(motor, { dryMass });
  const result = simulateAscent(rocket);

  // Powered phase: a = F/m - g (constant), v(t)=a*t, h(t)=0.5*a*t^2.
  const aPowered = thrust / totalMass - G;
  const vBurnout = aPowered * burnTime;
  const hBurnout = 0.5 * aPowered * burnTime * burnTime;
  // Coast phase (zero drag): standard projectile deceleration under gravity alone.
  const additionalHeight = (vBurnout * vBurnout) / (2 * G);
  const additionalTime = vBurnout / G;
  const expectedApogee = hBurnout + additionalHeight;
  const expectedApogeeTime = burnTime + additionalTime;

  it("burnout altitude/velocity match the closed-form powered-flight kinematics", () => {
    expect(result.burnoutAltitude).not.toBeNull();
    expect(result.burnoutVelocity).not.toBeNull();
    expect(result.burnoutAltitude!).toBeCloseTo(hBurnout, 1);
    expect(result.burnoutVelocity!).toBeCloseTo(vBurnout, 1);
  });

  it("apogee altitude matches the closed-form powered+coast solution within 0.1%", () => {
    const relError = Math.abs(result.apogeeAltitude - expectedApogee) / expectedApogee;
    expect(relError).toBeLessThan(0.001);
  });

  it("apogee time matches the closed-form solution within 0.1%", () => {
    const relError = Math.abs(result.apogeeTime - expectedApogeeTime) / expectedApogeeTime;
    expect(relError).toBeLessThan(0.001);
  });

  it("fires events in the correct chronological order", () => {
    const order = result.events.map((e) => e.type);
    expect(order).toEqual(["LIFTOFF", "LAUNCHROD", "BURNOUT", "APOGEE"]);
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.time).toBeGreaterThanOrEqual(result.events[i - 1]!.time);
    }
  });

  it("mass stays exactly constant throughout (zero propellant mass)", () => {
    for (const s of result.samples) {
      expect(s.mass).toBeCloseTo(totalMass, 9);
    }
  });

  it("no warnings for a normal flight", () => {
    expect(result.warnings).toEqual([]);
  });
});

describe("simulateAscent — edge cases", () => {
  it("warns and reports zero apogee if there's no motor", () => {
    const rocket = zeroDragRocket(null);
    const result = simulateAscent(rocket);
    expect(result.apogeeAltitude).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("warns if the motor is too weak to lift the rocket off the pad", () => {
    const weakMotor: SelectedMotor = {
      motorId: "weak",
      designation: "WEAK",
      manufacturer: "test",
      diameter: 0.018,
      length: 0.05,
      totalMassKg: 0.02,
      propellantMassKg: 0.005,
      samples: [
        { time: 0, thrust: 1 }, // far less than the rocket's weight
        { time: 1, thrust: 1 },
      ],
      delay: 0,
    };
    const rocket = zeroDragRocket(weakMotor, { dryMass: 5 }); // way too heavy for a 1N motor
    const result = simulateAscent(rocket);
    expect(result.events.find((e) => e.type === "LIFTOFF")).toBeUndefined();
    expect(result.warnings.some((w) => w.toLowerCase().includes("lift"))).toBe(true);
  });
});

describe("simulateAscent — sanity with real drag geometry", () => {
  it("produces a plausible, monotonically-increasing-then-decreasing altitude profile for a basic rocket+small motor", () => {
    const components: Component[] = [
      { type: "nosecone", id: "nose", name: "n", shape: "ogive", shapeParameter: 1, length: 0.1, aftRadius: 0.0125, thickness: 0.002 },
      { type: "bodytube", id: "tube", name: "t", length: 0.3, radius: 0.0125, thickness: 0.001, isMotorMount: true },
      {
        type: "finset", id: "fins", name: "f", finCount: 3, rootChord: 0.05, tipChord: 0.03,
        sweepLength: 0.02, span: 0.05, thickness: 0.003, cantAngle: 0, axialOffsetFromParentBottom: 0.25,
      },
    ];
    const motor: SelectedMotor = {
      motorId: "c6",
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
    const rocket: Rocket = {
      ...defaultRocket(),
      components,
      dryMass: 0.02,
      dryCg: 0.2,
      motorMount: { componentId: "tube", motorOverhang: 0 },
      motor,
      launchRodLength: 1.0,
    };
    const result = simulateAscent(rocket);

    expect(result.warnings).toEqual([]);
    // A C6 in a light ~40g rocket is a real, common combination -- plausible apogee is tens to a
    // few hundred meters, not e.g. negative, zero, or absurdly large (which would indicate a bug).
    expect(result.apogeeAltitude).toBeGreaterThan(20);
    expect(result.apogeeAltitude).toBeLessThan(1000);
    expect(result.maxVelocity).toBeGreaterThan(0);
    expect(result.maxMach).toBeLessThan(1); // well subsonic for this combo

    // Altitude rises monotonically up to apogee.
    let prevAlt = -1;
    for (const s of result.samples) {
      expect(s.altitude).toBeGreaterThanOrEqual(prevAlt - 1e-6);
      prevAlt = s.altitude;
    }
  });
});
