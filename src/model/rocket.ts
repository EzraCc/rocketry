import type { Component } from "./component.js";

export interface SelectedMotor {
  motorId: string;
  designation: string;
  manufacturer: string;
  diameter: number; // m
  length: number; // m
  totalMassKg: number;
  propellantMassKg: number;
  samples: { time: number; thrust: number }[];
  delay: number; // s
}

export interface Rocket {
  name: string;
  /** Ordered nose-to-tail; axial position is derived by stacking (see rocket-geometry.ts). */
  components: Component[];
  dryMass: number; // kg, user-entered
  dryCg: number; // m from nose tip, user-entered
  motorMount: { componentId: string; motorOverhang: number };
  motor: SelectedMotor | null;
  launchRodLength: number; // m
  launchRodAngle: number; // rad from vertical
  launchRodDirection: number; // rad, azimuth
  windSpeed: number; // m/s, constant (MVP: no turbulence)
  windDirection: number; // rad
  launchAltitude: number; // m ASL
  launchTemperature: number; // K
  launchPressure: number; // Pa
}

export function defaultRocket(): Rocket {
  return {
    name: "New rocket",
    components: [],
    dryMass: 0.05,
    dryCg: 0.15,
    motorMount: { componentId: "", motorOverhang: 0 },
    motor: null,
    launchRodLength: 1.0,
    launchRodAngle: 0,
    launchRodDirection: 0,
    windSpeed: 0,
    windDirection: 0,
    launchAltitude: 0,
    launchTemperature: 288.15,
    launchPressure: 101325,
  };
}
