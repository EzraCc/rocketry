/**
 * Nose-weight balancing: how much added mass near the nose tip (and where) shifts the LOADED
 * (dry + full motor) CG forward enough to hit a target stability margin, or the reverse -- what
 * margin a given amount of added mass at a given position actually achieves. Pure moment-
 * conservation math (see combined-mass.ts's own combinedMassAt, which this mirrors), deliberately
 * NOT modeled as a new Component in the aerodynamic component list: this project's actual dry
 * mass/CG (Rocket.dryMass/dryCg) are plain user-entered scalars, not derived by summing
 * components (only the RockSim parser's one-time import estimate works that way) -- so a nose-
 * weight Component would sit in the aero geometry list but never actually move dryMass/dryCg,
 * which is what the flight sim and every stat panel actually reads. Operating directly on the
 * scalars is both simpler and the only version that would actually take effect.
 *
 * CP itself doesn't depend on mass at all (a Barrowman CP is pure geometry), so unlike an
 * iterative "add weight, re-check margin, repeat" loop, the added mass needed for a target margin
 * has a single closed-form solution -- no bisection required.
 */

export interface NoseWeightBalance {
  currentMarginCal: number;
  targetMarginCal: number;
  /** 0 if the target margin is already met without adding anything. Infinity if xNoseM isn't far enough forward of the target CG to ever reach it (see feasible). */
  addedMassKg: number;
  newDryMassKg: number;
  newDryCgM: number;
  /** The margin actually achieved -- equals targetMarginCal unless addedMassKg was clamped to 0 (already there) or infeasible. */
  newMarginCal: number;
  /** False when xNoseM is at or aft of the target CG position -- no finite mass placed there can reach the target (the position itself needs to move forward, not just the mass). */
  feasible: boolean;
}

/**
 * Solves for the nose-weight mass (at a given axial position, e.g. near the nose tip) needed to
 * bring the LOADED (dry + full motor) stability margin up to targetMarginCal. Liftoff (full
 * propellant) is the relevant loaded configuration to target, matching this project's own
 * established convention (see main.ts's own liftoff-vs-burnout stability comment) -- for most
 * motor/airframe combinations the CG moves FORWARD as propellant burns (mass leaving from the aft
 * motor), so liftoff is the worst-case (least stable) point in the flight, not an arbitrary choice.
 */
export function solveNoseWeight(
  cpXM: number,
  refDiameterM: number,
  dryMassKg: number,
  dryCgM: number,
  motorMassKg: number,
  motorCgXM: number,
  targetMarginCal: number,
  xNoseM: number,
): NoseWeightBalance {
  const loadedMassKg = dryMassKg + motorMassKg;
  const loadedCgM = loadedMassKg > 1e-9 ? (dryMassKg * dryCgM + motorMassKg * motorCgXM) / loadedMassKg : dryCgM;
  const currentMarginCal = refDiameterM > 1e-9 ? (cpXM - loadedCgM) / refDiameterM : 0;

  if (currentMarginCal >= targetMarginCal) {
    return {
      currentMarginCal,
      targetMarginCal,
      addedMassKg: 0,
      newDryMassKg: dryMassKg,
      newDryCgM: dryCgM,
      newMarginCal: currentMarginCal,
      feasible: true,
    };
  }

  const cgTargetM = cpXM - targetMarginCal * refDiameterM;

  if (xNoseM >= cgTargetM) {
    return {
      currentMarginCal,
      targetMarginCal,
      addedMassKg: Infinity,
      newDryMassKg: dryMassKg,
      newDryCgM: dryCgM,
      newMarginCal: currentMarginCal,
      feasible: false,
    };
  }

  // Moment conservation: (loadedMass*loadedCg + addedMass*xNose) / (loadedMass+addedMass) = cgTarget,
  // solved for addedMass. Applied to dryMass/dryCg (not the loaded figures) below, since combining
  // (dry+nose) then (dry+nose+motor) via the same weighted-average formula twice is mathematically
  // identical to combining all three at once -- dryMass/dryCg are what's actually persisted.
  const addedMassKg = (loadedMassKg * (loadedCgM - cgTargetM)) / (cgTargetM - xNoseM);
  const newDryMassKg = dryMassKg + addedMassKg;
  const newDryCgM = (dryMassKg * dryCgM + addedMassKg * xNoseM) / newDryMassKg;

  return {
    currentMarginCal,
    targetMarginCal,
    addedMassKg,
    newDryMassKg,
    newDryCgM,
    newMarginCal: targetMarginCal,
    feasible: true,
  };
}

export interface NoseWeightPreview {
  newDryMassKg: number;
  newDryCgM: number;
  newMarginCal: number;
}

/** The reverse direction: given a specific mass the user has actually entered (not solved for), what margin does adding it at xNoseM actually achieve? Live-preview companion to solveNoseWeight's auto-solve. */
export function previewNoseWeight(
  cpXM: number,
  refDiameterM: number,
  dryMassKg: number,
  dryCgM: number,
  motorMassKg: number,
  motorCgXM: number,
  addedMassKg: number,
  xNoseM: number,
): NoseWeightPreview {
  const newDryMassKg = dryMassKg + addedMassKg;
  const newDryCgM = newDryMassKg > 1e-9 ? (dryMassKg * dryCgM + addedMassKg * xNoseM) / newDryMassKg : dryCgM;

  const loadedMassKg = newDryMassKg + motorMassKg;
  const loadedCgM = loadedMassKg > 1e-9 ? (newDryMassKg * newDryCgM + motorMassKg * motorCgXM) / loadedMassKg : newDryCgM;
  const newMarginCal = refDiameterM > 1e-9 ? (cpXM - loadedCgM) / refDiameterM : 0;

  return { newDryMassKg, newDryCgM, newMarginCal };
}
