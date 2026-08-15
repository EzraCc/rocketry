import { describe, expect, it } from "vitest";
import * as V from "../../model/vec3.js";
import { parseAvailableDelays, recommendDelay, requiredCoastPastApogeeS } from "./delay-recommendation.js";
import { simulateFlight3D } from "./engine3d.js";
import { defaultRocket, type Rocket, type SelectedMotor } from "../../model/rocket.js";
import type { Component } from "../../model/component.js";
import type { SimResult3D, SimSample3D } from "./types3d.js";

function sample(time: number, speed: number): SimSample3D {
  return {
    time,
    position: V.ZERO,
    velocity: V.ZERO,
    axis: V.ZERO,
    angularVelocity: V.ZERO,
    altitude: 0,
    speed,
    aoaDeg: 0,
    tiltFromVerticalDeg: 0,
    mach: 0,
    mass: 0,
    thrust: 0,
    drag: 0,
  };
}

function makeResult(points: [time: number, speed: number][], apogeeTime: number): SimResult3D {
  return {
    samples: points.map(([t, s]) => sample(t, s)),
    events: [],
    apogeeAltitude: 0,
    apogeeTime,
    maxVelocity: Math.max(...points.map(([, s]) => s)),
    maxAcceleration: 0,
    maxMach: 0,
    maxAoaDeg: 0,
    maxTiltFromVerticalDeg: 0,
    tiltAtBurnoutDeg: null,
    burnoutAltitude: null,
    warnings: [],
  };
}

describe("parseAvailableDelays", () => {
  it("parses a comma-separated list of fixed or adjustable delays identically", () => {
    expect(parseAvailableDelays("6,8,10,12,14")).toEqual([6, 8, 10, 12, 14]);
    expect(parseAvailableDelays("4,5,6,7,8,10")).toEqual([4, 5, 6, 7, 8, 10]);
  });

  it("sorts even if the source list isn't already ascending", () => {
    expect(parseAvailableDelays("10,4,7")).toEqual([4, 7, 10]);
  });

  it("returns an empty list for a plugged (\"P\") motor", () => {
    expect(parseAvailableDelays("P")).toEqual([]);
  });
});

describe("requiredCoastPastApogeeS", () => {
  it("is zero when the motor is plugged (no delay to evaluate)", () => {
    expect(requiredCoastPastApogeeS("P", 2, 9)).toBe(0);
  });

  it("covers the longest available delay's ejection time, plus the buffer", () => {
    // burnout=2s, max delay=14s -> ejection at t=16s; apogee at t=9s -> need 7s of coast + buffer.
    expect(requiredCoastPastApogeeS("6,8,10,12,14", 2, 9, 1)).toBeCloseTo(8, 6);
  });

  it("is just the buffer when every delay already ejects before apogee", () => {
    // max ejection time (2+14=16) is still before this rocket's own apogee at t=30s.
    expect(requiredCoastPastApogeeS("6,8,10,12,14", 2, 30, 1)).toBeCloseTo(1, 6);
  });
});

// Speed(t) shaped like a real near-apogee curve: decelerating into apogee at t=9 (ascent, drag
// ADDS to gravity's deceleration -- steeper), then accelerating back down (descent, drag SUBTRACTS
// from gravity -- shallower), asymmetric on purpose so these tests can't be satisfied by a naive
// symmetric-time approximation.
const ASYMMETRIC_RESULT = makeResult(
  [
    [6, 20], // burnout
    [7, 12],
    [8, 5],
    [8.5, 2],
    [9, 0], // apogee
    [9.5, 3],
    [10, 7],
    [11, 15],
    [12, 22],
    [13, 28],
  ],
  9,
);

describe("recommendDelay", () => {
  it("plugged motor: no delay applies, no options, no warning", () => {
    const rec = recommendDelay("P", 6, ASYMMETRIC_RESULT);
    expect(rec.plugged).toBe(true);
    expect(rec.options).toEqual([]);
    expect(rec.recommendedDelaySeconds).toBeNull();
    expect(rec.warnings).toEqual([]);
  });

  it("picks the candidate delay with the lowest actual simulated deployment speed", () => {
    // burnout=6 -> delays 2/2.5/3 eject at t=8/8.5/9, speeds 5/2/0 -- 3s (exactly at apogee) wins.
    const rec = recommendDelay("2,2.5,3", 6, ASYMMETRIC_RESULT);
    expect(rec.recommendedDelaySeconds).toBe(3);
  });

  it("prefers the LONGER delay on a near-tie rather than the literal argmin", () => {
    // burnout=6 -> delay 1 ejects at t=7 (an exact sample point, speed 12); delay 4.625 ejects at
    // t=10.625, which interpolates (between the (10,7) and (11,15) samples, slope 8/s) to exactly
    // 12 too -- a genuine, exact tie in deployment speed, one well before apogee and one well after.
    const rec = recommendDelay("1,4.625", 6, ASYMMETRIC_RESULT);
    const early = rec.options.find((o) => o.delaySeconds === 1)!;
    const late = rec.options.find((o) => o.delaySeconds === 4.625)!;
    expect(early.deploySpeedMs).toBeCloseTo(late.deploySpeedMs, 6); // confirm it's actually a tie
    expect(rec.recommendedDelaySeconds).toBe(4.625); // the longer one wins the tie
  });

  it("a real-world-shaped example: 0.5s early beats 1.5s late (not a tie -- direct comparison)", () => {
    // apogee at t=9 (burnout=6, so a 3s delay would be exact). Compare a 2.5s delay (0.5s early,
    // ejects at t=8.5, speed 2) against a 4.5s delay (1.5s late, ejects at t=10.5, speed ~19) --
    // early wins outright, matching the stated real-world preference.
    const rec = recommendDelay("2.5,4.5", 6, ASYMMETRIC_RESULT);
    expect(rec.recommendedDelaySeconds).toBe(2.5);
  });

  it("marks options correctly as before/after apogee", () => {
    const rec = recommendDelay("2,4", 6, ASYMMETRIC_RESULT);
    const before = rec.options.find((o) => o.delaySeconds === 2)!;
    const after = rec.options.find((o) => o.delaySeconds === 4)!;
    expect(before.beforeApogee).toBe(true);
    expect(after.beforeApogee).toBe(false);
  });

  it("excludes (with a warning) a delay whose ejection time falls past the last simulated sample", () => {
    const rec = recommendDelay("2,20", 6, ASYMMETRIC_RESULT); // 20s delay -> ejects at t=26, way past t=13
    expect(rec.options.some((o) => o.delaySeconds === 20)).toBe(false);
    expect(rec.warnings.length).toBeGreaterThan(0);
    expect(rec.recommendedDelaySeconds).toBe(2); // still recommends from what IS coverable
  });

  it("unparseable/empty delays list produces no options and a warning (not silently null)", () => {
    const rec = recommendDelay("", 6, ASYMMETRIC_RESULT);
    expect(rec.options).toEqual([]);
    expect(rec.recommendedDelaySeconds).toBeNull();
    expect(rec.warnings.length).toBeGreaterThan(0);
  });
});

// End-to-end sanity check against the real flight sim (not just synthetic data): a real rocket,
// coasted past its own apogee, should let recommendDelay pick something sensible for a real
// motor-shaped delays list.
describe("recommendDelay — integration with a real simulateFlight3D coast", () => {
  function basicRocket(): Rocket {
    const components: Component[] = [
      { type: "nosecone", id: "nose", name: "n", shape: "ogive", shapeParameter: 1, length: 0.1, aftRadius: 0.0125, thickness: 0.002 },
      { type: "bodytube", id: "tube", name: "t", length: 0.3, radius: 0.0125, thickness: 0.001, isMotorMount: true },
      {
        type: "finset", id: "fins", name: "f", finCount: 3, rootChord: 0.05, tipChord: 0.03,
        sweepLength: 0.02, span: 0.05, thickness: 0.003, cantAngle: 0, axialOffsetFromParentBottom: 0.25,
      },
    ];
    const motor: SelectedMotor = {
      motorId: "c6", designation: "C6", manufacturer: "Estes", diameter: 0.018, length: 0.07,
      totalMassKg: 0.0241, propellantMassKg: 0.0108,
      samples: [
        { time: 0, thrust: 0 }, { time: 0.2, thrust: 14 }, { time: 0.5, thrust: 5 },
        { time: 1.8, thrust: 4 }, { time: 1.9, thrust: 0 },
      ],
      delay: 0,
    };
    return {
      ...defaultRocket(),
      components,
      dryMass: 0.04,
      dryCg: 0.24,
      motorMount: { componentId: "tube", motorOverhang: 0 },
      motor,
      launchRodLength: 1.0,
    };
  }

  it("recommends a delay, and it isn't the longest available just because it's available", () => {
    const rocket = basicRocket();
    const bt = rocket.motor!.samples[rocket.motor!.samples.length - 1]!.time; // 1.9s
    const base = simulateFlight3D(rocket);
    const delaysRaw = "1,2,3,4,5,6,7"; // Estes-C6-style small-motor delay range
    const coast = requiredCoastPastApogeeS(delaysRaw, bt, base.apogeeTime);
    const extended = simulateFlight3D(rocket, { coastPastApogeeS: coast });
    const rec = recommendDelay(delaysRaw, bt, extended);

    expect(rec.recommendedDelaySeconds).not.toBeNull();
    expect(rec.options.length).toBe(7);
    // Sanity: the recommended option's own deployment speed should be at or near the minimum
    // across all evaluated options, not some arbitrary pick.
    const bestSpeed = Math.min(...rec.options.map((o) => o.deploySpeedMs));
    const recommendedSpeed = rec.options.find((o) => o.delaySeconds === rec.recommendedDelaySeconds)!.deploySpeedMs;
    expect(recommendedSpeed).toBeLessThan(bestSpeed * 1.15);
  });
});
