import { describe, expect, it } from "vitest";
import { IsaAtmosphere } from "./isa-model.js";

describe("IsaAtmosphere — standard atmosphere (no launch-site offset)", () => {
  const atm = new IsaAtmosphere();

  it("matches well-known sea-level values", () => {
    const c = atm.at(0);
    expect(c.temperature).toBeCloseTo(288.15, 6);
    expect(c.pressure).toBeCloseTo(101325, 6);
    expect(c.density).toBeCloseTo(1.225, 2);
    expect(c.speedOfSound).toBeCloseTo(340.3, 0);
  });

  it("matches the standard tropopause (11km) pressure", () => {
    const c = atm.at(11000);
    expect(c.temperature).toBeCloseTo(216.65, 6);
    expect(c.pressure).toBeCloseTo(22632, -1); // within ~10 Pa
  });

  it("matches the standard 20km pressure", () => {
    const c = atm.at(20000);
    expect(c.temperature).toBeCloseTo(216.65, 6);
    expect(c.pressure).toBeCloseTo(5474.9, -1);
  });

  it("density and pressure decrease monotonically with altitude up to 32km", () => {
    let prevP = Infinity;
    let prevRho = Infinity;
    for (let h = 0; h <= 32000; h += 500) {
      const c = atm.at(h);
      expect(c.pressure).toBeLessThanOrEqual(prevP);
      expect(c.density).toBeLessThanOrEqual(prevRho);
      prevP = c.pressure;
      prevRho = c.density;
    }
  });

  it("temperature decreases through the troposphere and is isothermal through the tropopause layer", () => {
    expect(atm.at(5000).temperature).toBeLessThan(atm.at(0).temperature);
    expect(atm.at(15000).temperature).toBeCloseTo(atm.at(11000).temperature, 6);
  });
});

describe("IsaAtmosphere — custom launch site conditions", () => {
  it("reproduces the exact given conditions at the launch altitude itself", () => {
    // A hot, low, low-pressure day at a 1600m-elevation launch site (e.g. Denver-ish).
    const site = { altitude: 1600, temperature: 300, pressure: 83000 };
    const atm = new IsaAtmosphere(site);
    const c = atm.at(site.altitude);
    expect(c.temperature).toBeCloseTo(site.temperature, 6);
    expect(c.pressure).toBeCloseTo(site.pressure, 3);
  });

  it("reduces to the standard atmosphere when given standard sea-level conditions at altitude 0", () => {
    const standard = new IsaAtmosphere();
    const custom = new IsaAtmosphere({ altitude: 0, temperature: 288.15, pressure: 101325 });
    for (const h of [0, 1000, 11000, 20000]) {
      expect(custom.at(h).pressure).toBeCloseTo(standard.at(h).pressure, 6);
      expect(custom.at(h).temperature).toBeCloseTo(standard.at(h).temperature, 6);
    }
  });

  it("a hotter/lower-pressure launch site stays consistently offset well above the launch altitude", () => {
    const standard = new IsaAtmosphere();
    const hot = new IsaAtmosphere({ altitude: 0, temperature: 298.15, pressure: 101325 }); // +10K day
    // Warmer air is less dense at the same pressure -> lower density aloft too.
    expect(hot.at(3000).density).toBeLessThan(standard.at(3000).density);
  });
});

describe("IsaAtmosphere — dynamic viscosity (Sutherland's law)", () => {
  it("matches the commonly cited sea-level value (~1.789e-5 Pa*s at 288.15K)", () => {
    const atm = new IsaAtmosphere();
    expect(atm.at(0).dynamicViscosity).toBeCloseTo(1.789e-5, 6);
  });

  it("decreases with the lower temperatures found at altitude", () => {
    const atm = new IsaAtmosphere();
    expect(atm.at(10000).dynamicViscosity).toBeLessThan(atm.at(0).dynamicViscosity);
  });
});
