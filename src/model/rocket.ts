import type { Component } from "./component.js";
import type { WindProfile } from "./wind.js";

export interface SelectedMotor {
  motorId: string;
  designation: string;
  manufacturer: string;
  diameter: number; // m
  length: number; // m
  totalMassKg: number;
  propellantMassKg: number;
  // propellantMassRemainingKg mirrors ThrustSample's own field (physics/motor/thrustcurve-client.ts)
  // -- declared inline rather than imported to keep this model module independent of the API client
  // -- see that field's own doc comment for what it means and when it's present.
  samples: { time: number; thrust: number; propellantMassRemainingKg?: number }[];
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
  /**
   * Altitude-varying wind (m AGL -> velocity vector). null = calm/no wind.
   * A constant wind is just a single-sample profile (see
   * constantWindProfile() in model/wind.ts); real altitude-varying data can
   * come from an external source such as the splashcast/Open-Meteo importer
   * (physics/wind/splashcast-import.ts). Not yet consumed by the flight
   * engine — that's M4 (AOA/weathercocking), which this is the data-side
   * prep for.
   */
  windProfile: WindProfile | null;
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
    windProfile: null,
    launchAltitude: 0,
    launchTemperature: 288.15,
    launchPressure: 101325,
  };
}
