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

// Real AeroTech J340M data (RockSim/.rse source, decoded directly from ThrustCurve.org's API --
// see thrustcurve-client.ts's parseRseEngDataMassKg) -- initWt=577.3g, propWt=365g. Exercises the
// real-per-sample-data path in deriveMotorMassCurve, not the impulse-derived fallback.
const realDataMotor: SelectedMotor = {
  motorId: "test-j340m",
  designation: "J340M",
  manufacturer: "AeroTech",
  diameter: 0.038,
  length: 0.337,
  totalMassKg: 0.5773,
  propellantMassKg: 0.365,
  samples: [
    { time: 0, thrust: 0, propellantMassRemainingKg: 0.365 },
    { time: 0.005, thrust: 361.55, propellantMassRemainingKg: 0.364495 },
    { time: 0.026, thrust: 606.518, propellantMassRemainingKg: 0.358193 },
    { time: 0.485, thrust: 439.762, propellantMassRemainingKg: 0.237904 },
    { time: 1.048, thrust: 383.685, propellantMassRemainingKg: 0.103797 },
    { time: 1.841, thrust: 11.806, propellantMassRemainingKg: 0.00105205 },
    { time: 2.19, thrust: 0, propellantMassRemainingKg: 0 },
  ],
  delay: 0,
};

describe("deriveMotorMassCurve — real per-sample propellant data", () => {
  it("uses casing mass + the sample's own real propellantMassRemainingKg exactly, not a derived estimate", () => {
    const curve = deriveMotorMassCurve(realDataMotor);
    const casingMassKg = realDataMotor.totalMassKg - realDataMotor.propellantMassKg;
    for (const s of realDataMotor.samples) {
      expect(getMotorMassAt(curve, s.time)).toBeCloseTo(casingMassKg + s.propellantMassRemainingKg!, 9);
    }
  });

  it("differs from the impulse-derived estimate for the same samples (proves the real-data path is actually used, not coincidentally identical)", () => {
    const realCurve = deriveMotorMassCurve(realDataMotor);
    const strippedSamples = realDataMotor.samples.map(({ time, thrust }) => ({ time, thrust }));
    const derivedCurve = deriveMotorMassCurve({ ...realDataMotor, samples: strippedSamples });
    // Mid-burn (t=0.485s): real data and the impulse-proportional model diverge meaningfully.
    expect(getMotorMassAt(realCurve, 0.485)).not.toBeCloseTo(getMotorMassAt(derivedCurve, 0.485), 3);
  });

  it("falls back to the derived estimate if only SOME samples have real data (partial/mixed data isn't trusted)", () => {
    const mixedSamples = realDataMotor.samples.map((s, i) => (i === 2 ? { time: s.time, thrust: s.thrust } : s));
    const curve = deriveMotorMassCurve({ ...realDataMotor, samples: mixedSamples });
    const realValueAtSameTime = realDataMotor.totalMassKg - realDataMotor.propellantMassKg + 0.358193;
    // Falls back to the impulse-derived model for the WHOLE curve (not just the one sample missing
    // real data), so even a sample that DID carry a real value no longer matches it exactly.
    expect(getMotorMassAt(curve, 0.026)).not.toBeCloseTo(realValueAtSameTime, 6);
  });
});

// Real AeroTech J435WS data (RockSim/.rse source, decoded directly from ThrustCurve.org's API) --
// its own header AND ThrustCurve's catalog both say propWt=352g, but its own <eng-data> curve
// starts at m=272g, an internal inconsistency in this specific source file (confirmed against two
// other real motors -- J340M above and AeroTech M650W -- both start exactly at their own propWt,
// so this isn't how the format normally behaves). Exercises the sanity-check fallback.
const inconsistentRealDataMotor: SelectedMotor = {
  motorId: "test-j435ws",
  designation: "J435WS",
  manufacturer: "AeroTech",
  diameter: 0.038,
  length: 0.3659,
  totalMassKg: 0.6164,
  propellantMassKg: 0.352,
  samples: [
    { time: 0, thrust: 0, propellantMassRemainingKg: 0.272 },
    { time: 0.867, thrust: 481.023, propellantMassRemainingKg: 0.1345 },
    { time: 1.781, thrust: 0, propellantMassRemainingKg: 0 },
  ],
  delay: 0,
};

describe("deriveMotorMassCurve — real data that disagrees with the motor's own published propellant mass", () => {
  it("falls back to the derived estimate rather than trusting an inconsistent real curve", () => {
    const curve = deriveMotorMassCurve(inconsistentRealDataMotor);
    // The real (untrusted) value would be casingMass + 0.272 = 0.5364kg -- confirm we did NOT use it.
    const untrustedRealMassAt0 = inconsistentRealDataMotor.totalMassKg - inconsistentRealDataMotor.propellantMassKg + 0.272;
    expect(getMotorMassAt(curve, 0)).not.toBeCloseTo(untrustedRealMassAt0, 3);
    // The derived fallback is anchored to the published total mass exactly, same guarantee as the
    // synthetic-motor "mass(0) equals total (launch) mass" case above.
    expect(getMotorMassAt(curve, 0)).toBeCloseTo(inconsistentRealDataMotor.totalMassKg, 9);
  });

  it("exposes the inconsistency so the UI can surface a warning with the actual numbers", () => {
    const curve = deriveMotorMassCurve(inconsistentRealDataMotor);
    expect(curve.inconsistentRealData).toEqual({
      firstSampleKg: 0.272,
      publishedPropellantMassKg: 0.352,
    });
  });

  it("does not set inconsistentRealData for a motor with no real per-sample data at all", () => {
    const curve = deriveMotorMassCurve(motor);
    expect(curve.inconsistentRealData).toBeUndefined();
  });

  it("does not set inconsistentRealData for real data that passes the check", () => {
    const curve = deriveMotorMassCurve(realDataMotor);
    expect(curve.inconsistentRealData).toBeUndefined();
  });

  it("still trusts real data whose first sample is close enough (within 2%) to the published propellant mass", () => {
    const closeEnough: SelectedMotor = {
      ...inconsistentRealDataMotor,
      samples: inconsistentRealDataMotor.samples.map((s, i) =>
        i === 0 ? { ...s, propellantMassRemainingKg: 0.352 * 0.99 } : s,
      ),
    };
    const curve = deriveMotorMassCurve(closeEnough);
    const casingMassKg = closeEnough.totalMassKg - closeEnough.propellantMassKg;
    expect(getMotorMassAt(curve, 0)).toBeCloseTo(casingMassKg + 0.352 * 0.99, 9);
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
