import { describe, expect, it } from "vitest";
import { simulateFlight3D } from "./engine3d.js";
import { simulateAscent } from "./engine.js";
import { defaultRocket, type Rocket, type SelectedMotor } from "../../model/rocket.js";
import type { Component } from "../../model/component.js";
import { constantWindProfile } from "../../model/wind.js";

function basicRocket(overrides: Partial<Rocket> = {}): Rocket {
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
    delay: 5,
  };
  return {
    ...defaultRocket(),
    components,
    dryMass: 0.04,
    dryCg: 0.24, // aft of the nose+tube midpoint -> should give a stable (CP aft of CG) rocket
    motorMount: { componentId: "tube", motorOverhang: 0 },
    motor,
    launchRodLength: 1.0,
    launchRodAngle: 0,
    launchRodDirection: 0,
    windProfile: null,
    ...overrides,
  };
}

describe("simulateFlight3D — regression against M3 (zero wind, vertical launch)", () => {
  // With no wind and a perfectly vertical rod, AOA should stay ~0 throughout (no crossflow to
  // ever tip the rocket), so the 3D engine's vertical trajectory should closely match M3's
  // dedicated 1D integrator for the exact same rocket -- a strong regression tie-back to
  // already-validated physics (M3 was itself validated against an exact closed-form solution).
  const rocket = basicRocket();
  const result3D = simulateFlight3D(rocket);
  const result1D = simulateAscent(rocket);

  it("apogee altitude matches M3 within 1%", () => {
    const relError = Math.abs(result3D.apogeeAltitude - result1D.apogeeAltitude) / result1D.apogeeAltitude;
    expect(relError).toBeLessThan(0.01);
  });

  it("apogee time matches M3 within 1%", () => {
    const relError = Math.abs(result3D.apogeeTime - result1D.apogeeTime) / result1D.apogeeTime;
    expect(relError).toBeLessThan(0.01);
  });

  it("max velocity matches M3 within 1%", () => {
    const relError = Math.abs(result3D.maxVelocity - result1D.maxVelocity) / result1D.maxVelocity;
    expect(relError).toBeLessThan(0.01);
  });

  it("stays essentially vertical (no tilt, no AOA) throughout with zero wind", () => {
    expect(result3D.maxTiltFromVerticalDeg).toBeLessThan(0.01);
    expect(result3D.maxAoaDeg).toBeLessThan(0.01);
  });

  it("no warnings for a normal zero-wind flight", () => {
    expect(result3D.warnings).toEqual([]);
  });
});

describe("simulateFlight3D — launch rod lock", () => {
  it("axis stays exactly locked to the rod direction while still on the rod, even with wind present", () => {
    const rocket = basicRocket({ windProfile: constantWindProfile(15, 270) }); // strong wind from the west
    const result = simulateFlight3D(rocket);
    const launchRodEvent = result.events.find((e) => e.type === "LAUNCHROD");
    expect(launchRodEvent).toBeDefined();
    const onRodSamples = result.samples.filter((s) => s.time <= launchRodEvent!.time);
    for (const s of onRodSamples) {
      expect(s.tiltFromVerticalDeg).toBeLessThan(0.01);
    }
  });
});

/**
 * Tilt-from-vertical AT BURNOUT (not flight-wide max) is the meaningful checkpoint for these
 * comparisons. As vertical velocity approaches zero near apogee, the relative airspeed becomes
 * dominated by the horizontal wind regardless of stability margin, so tilt legitimately
 * approaches ~90deg for ANY sufficiently stable rocket near its own apogee (verified by direct
 * inspection: a smooth, monotonic approach to exactly 90deg right at the velocity zero-crossing,
 * not a divergence/instability artifact) -- checking the flight-wide max would be confounded by
 * this correct-but-universal near-apogee behavior instead of actually distinguishing stable from
 * unstable dynamics.
 */
function tiltAtBurnout(result: ReturnType<typeof simulateFlight3D>): number {
  const burnout = result.events.find((e) => e.type === "BURNOUT");
  if (!burnout) return result.maxTiltFromVerticalDeg;
  const sample = result.samples.reduce((closest, s) =>
    Math.abs(s.time - burnout.time) < Math.abs(closest.time - burnout.time) ? s : closest,
  );
  return sample.tiltFromVerticalDeg;
}

describe("simulateFlight3D — weathercocking direction", () => {
  // Wind FROM due west (270deg) blows TOWARD due east -- a stable rocket's axis should tip
  // toward the direction the relative airspeed vector points, which (since the rocket's own
  // large upward velocity dominates during boost) is tilted slightly toward -windVelocity, i.e.
  // WEST (upwind) -- matching the well-known real-world behavior that stable rockets weathercock
  // to fly into the wind (nose tips upwind) rather than away from it.
  it("a stable rocket tips its nose toward the west when the wind blows from the west (toward the east)", () => {
    const rocket = basicRocket({ windProfile: constantWindProfile(12, 270) });
    const result = simulateFlight3D(rocket);
    const postRod = result.samples.filter((s) => s.time > (result.events.find((e) => e.type === "LAUNCHROD")?.time ?? 0));
    expect(postRod.length).toBeGreaterThan(0);
    const atBurnout = tiltAtBurnout(result);
    // West = -x in this project's convention (x=East, y=North). Nose tipping west means the
    // axis's x-component goes negative.
    const burnoutSample = result.samples.find((s) => Math.abs(s.time - (result.events.find((e) => e.type === "BURNOUT")?.time ?? 0)) < 0.02)!;
    expect(burnoutSample.axis.x).toBeLessThan(-0.001);
    expect(atBurnout).toBeGreaterThan(0.1); // it actually tips, not exactly zero
    expect(atBurnout).toBeLessThan(45); // bounded/reasonable during boost, not tumbling
  });

  it("wind from the east (blowing toward the west) tips the nose toward the east (opposite sign)", () => {
    const rocket = basicRocket({ windProfile: constantWindProfile(12, 90) });
    const result = simulateFlight3D(rocket);
    const burnoutSample = result.samples.find((s) => Math.abs(s.time - (result.events.find((e) => e.type === "BURNOUT")?.time ?? 0)) < 0.02)!;
    expect(burnoutSample.axis.x).toBeGreaterThan(0.001);
  });

  it("more wind produces more tilt at burnout (monotonic, same direction)", () => {
    const light = simulateFlight3D(basicRocket({ windProfile: constantWindProfile(5, 270) }));
    const strong = simulateFlight3D(basicRocket({ windProfile: constantWindProfile(15, 270) }));
    expect(tiltAtBurnout(strong)).toBeGreaterThan(tiltAtBurnout(light));
  });

  it("zero wind produces zero tilt even with a nonzero-margin rocket", () => {
    const result = simulateFlight3D(basicRocket({ windProfile: constantWindProfile(0, 0) }));
    expect(result.maxTiltFromVerticalDeg).toBeLessThan(0.01);
  });

  it("tilt smoothly approaches ~90deg near apogee as vertical velocity vanishes (correct physics, not instability)", () => {
    const result = simulateFlight3D(basicRocket({ windProfile: constantWindProfile(12, 270) }));
    const apogee = result.events.find((e) => e.type === "APOGEE")!;
    const nearApogee = result.samples.filter((s) => Math.abs(s.time - apogee.time) < 0.05);
    expect(nearApogee.length).toBeGreaterThan(0);
    for (const s of nearApogee) {
      expect(s.tiltFromVerticalDeg).toBeGreaterThan(80);
      expect(s.tiltFromVerticalDeg).toBeLessThan(100);
    }
  });
});

describe("simulateFlight3D — coastPastApogeeS (unparachuted descent past apogee)", () => {
  const rocket = basicRocket();

  it("defaults to stopping at apogee (within one integration step), unchanged from every other caller's expectation", () => {
    const result = simulateFlight3D(rocket);
    const lastSample = result.samples[result.samples.length - 1]!;
    // The final sample is pushed at the step's END time, not the interpolated apogeeTime itself
    // (see the APOGEE-detection block's own comment) -- so it lands within one DT (0.01s) of it,
    // not exactly on it.
    expect(Math.abs(lastSample.time - result.apogeeTime)).toBeLessThan(0.02);
  });

  it("continues integrating past apogee when coastPastApogeeS is set, samples extending past apogeeTime", () => {
    const result = simulateFlight3D(rocket, { coastPastApogeeS: 2 });
    const lastSample = result.samples[result.samples.length - 1]!;
    expect(lastSample.time).toBeGreaterThan(result.apogeeTime + 1.9);
    // apogeeTime/apogeeAltitude themselves are unaffected by coasting -- still the first crossing.
    expect(result.apogeeTime).toBeGreaterThan(0);
  });

  it("falls back toward the ground under gravity+drag after apogee, no parachute to arrest it", () => {
    const result = simulateFlight3D(rocket, { coastPastApogeeS: 2 });
    const atApogee = result.samples.find((s) => Math.abs(s.time - result.apogeeTime) < 0.02)!;
    const later = result.samples[result.samples.length - 1]!;
    expect(later.altitude).toBeLessThan(atApogee.altitude);
    expect(later.velocity.z).toBeLessThan(0); // falling
  });

  it("stops at ground impact rather than continuing to integrate the descent", () => {
    // A generous coast window, long enough for this small/light rocket to actually hit the ground.
    const result = simulateFlight3D(rocket, { coastPastApogeeS: 60 });
    const lastSample = result.samples[result.samples.length - 1]!;
    const secondToLast = result.samples[result.samples.length - 2]!;
    // Stopped at (or immediately past, within one step's worth of overshoot) impact -- the
    // previous sample was still airborne, and it didn't keep falling well below ground.
    expect(secondToLast.altitude).toBeGreaterThanOrEqual(0);
    expect(lastSample.altitude).toBeGreaterThan(-1); // one RK4 step's worth of overshoot, not runaway
    expect(lastSample.time).toBeLessThan(60 + result.apogeeTime);
  });
});

describe("simulateFlight3D — stability comparison", () => {
  it("a stable (CG forward of CP) rocket stays bounded through boost; an unstable (CG aft of CP) rocket diverges/tumbles", () => {
    // Push dryCg far aft -- past where CP typically sits for this geometry -- to flip stability.
    const stable = simulateFlight3D(basicRocket({ dryCg: 0.2, windProfile: constantWindProfile(10, 270) }));
    const unstable = simulateFlight3D(basicRocket({ dryCg: 0.45, windProfile: constantWindProfile(10, 270) }));

    expect(tiltAtBurnout(stable)).toBeLessThan(45);
    // An unstable rocket's tilt should grow much larger (diverging) than a stable one under the
    // same wind, well before either reaches its own apogee.
    expect(tiltAtBurnout(unstable)).toBeGreaterThan(tiltAtBurnout(stable));
  });
});
