// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRasaeroXml } from "./parse.js";
import { computeBarrowman } from "../../physics/aero/barrowman.js";
import type { BodyTube, NoseCone, Transition, TrapezoidalFinSet } from "../../model/component.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN = 1 / 39.37;

function loadFixture(fileName: string) {
  const xml = fs.readFileSync(path.resolve(__dirname, "../../../sim-files/rasaero", fileName), "utf-8");
  return parseRasaeroXml(xml, fileName);
}

describe("parseRasaeroXml — real fixture (Show-off.CDX1, OpenRocket's own RASAero import test resource)", () => {
  const parsed = loadFixture("Show-off.CDX1");

  it("derives the rocket name from the filename (RASAero files carry no embedded name)", () => {
    expect(parsed.name).toBe("Show-off");
  });

  it("warns about the trailing booster stage and stops before it", () => {
    expect(parsed.warnings.some((w) => /booster/i.test(w) && /sustainer/i.test(w))).toBe(true);
  });

  it("decomposes NoseCone, plain BodyTube, FinCan (shoulder+tube+fin), more BodyTubes, and BoatTail+fin, in document order", () => {
    expect(parsed.components.map((c) => c.type)).toEqual([
      "nosecone", "bodytube", "transition", "bodytube", "finset", "bodytube", "bodytube", "bodytube", "transition", "finset",
    ]);
  });

  it("nose cone: Tangent Ogive -> ogive/shapeParameter=1, inches converted to meters", () => {
    const nose = parsed.components[0] as NoseCone;
    expect(nose.shape).toBe("ogive");
    expect(nose.shapeParameter).toBe(1);
    expect(nose.length).toBeCloseTo(1 * IN, 9);
    expect(nose.aftRadius).toBeCloseTo((1.5 / 2) * IN, 9);
  });

  it("FinCan: shoulder transition tapers from InsideDiameter to the can's own Diameter, tube carries the fin", () => {
    const shoulder = parsed.components[2] as Transition;
    expect(shoulder.shape).toBe("conical");
    expect(shoulder.length).toBeCloseTo(0.23 * IN, 9);
    expect(shoulder.foreRadius).toBeCloseTo((1.5 / 2) * IN, 9); // InsideDiameter/2
    expect(shoulder.aftRadius).toBeCloseTo((2.73 / 2) * IN, 9); // Diameter/2

    const tube = parsed.components[3] as BodyTube;
    expect(tube.length).toBeCloseTo(2.34 * IN, 9);
    expect(tube.radius).toBeCloseTo((2.73 / 2) * IN, 9);

    const fin = parsed.components[4] as TrapezoidalFinSet;
    expect(fin.finCount).toBe(3);
    expect(fin.rootChord).toBeCloseTo(1 * IN, 9);
    // Location=1in, tube length=2.34in -> trailing edge exactly flush with the tube's aft end
    // (offset + rootChord == tube length) -- the physically expected case, derived and verified
    // algebraically in parse.ts's own doc comment against two independent real fixtures.
    expect(fin.axialOffsetFromParentBottom + fin.rootChord).toBeCloseTo(tube.length, 9);
  });

  it("BoatTail: tapers from its own Diameter down to RearDiameter, fin trailing edge flush with its aft end", () => {
    const boattail = parsed.components[8] as Transition;
    expect(boattail.shape).toBe("conical");
    expect(boattail.foreRadius).toBeCloseTo((2.73 / 2) * IN, 9);
    expect(boattail.aftRadius).toBeCloseTo((0.25 / 2) * IN, 9);

    const fin = parsed.components[9] as TrapezoidalFinSet;
    expect(fin.finCount).toBe(4);
    expect(fin.axialOffsetFromParentBottom + fin.rootChord).toBeCloseTo(boattail.length, 9);
  });

  it("produces finite, positive CNa and a CP through the real physics", () => {
    const { cna, cpX } = computeBarrowman(parsed.components, 0.3);
    expect(Number.isFinite(cna)).toBe(true);
    expect(Number.isFinite(cpX)).toBe(true);
    expect(cna).toBeGreaterThan(0);
  });
});

describe("parseRasaeroXml — real fixture (Complex.Two-Stage.CDX1): deeper part-type coverage", () => {
  const parsed = loadFixture("Complex.Two-Stage.CDX1");

  it("handles fins directly on plain BodyTubes, plain Transitions, a FinCan, and a BoatTail, then stops at the booster", () => {
    expect(parsed.components.map((c) => c.type)).toEqual([
      "nosecone",
      "bodytube", "finset",
      "transition",
      "bodytube", "finset",
      "transition",
      "bodytube", "finset",
      "transition", "bodytube", "finset", // FinCan
      "transition", "finset", // BoatTail
    ]);
    expect(parsed.warnings.some((w) => /booster/i.test(w))).toBe(true);
  });

  it("a delta fin (TipChord=0) on a plain BodyTube parses with the tip chord taken literally as zero", () => {
    const fin = parsed.components[2] as TrapezoidalFinSet;
    expect(fin.tipChord).toBeCloseTo(0, 9);
    expect(fin.sweepLength).toBeCloseTo(1 * IN, 9);
  });

  it("FinCan shoulder uses this file's own (different from Show-off's) InsideDiameter/Diameter pair", () => {
    const shoulderIdx = parsed.components.findIndex((c, i) => c.type === "transition" && i > 8);
    const shoulder = parsed.components[shoulderIdx] as Transition;
    expect(shoulder.foreRadius).toBeCloseTo((3 / 2) * IN, 9); // InsideDiameter=3in
    expect(shoulder.aftRadius).toBeCloseTo((3.25 / 2) * IN, 9); // Diameter=3.25in
  });

  it("produces finite, positive CNa through the real physics", () => {
    const { cna } = computeBarrowman(parsed.components, 0.3);
    expect(Number.isFinite(cna)).toBe(true);
    expect(cna).toBeGreaterThan(0);
  });
});

describe("parseRasaeroXml — real fixture (Three-stage rocket.CDX1): multi-booster warning", () => {
  it("imports only the sustainer (nose + one finned body tube) and warns once about the boosters below it", () => {
    const parsed = loadFixture("Three-stage rocket.CDX1");
    expect(parsed.components.map((c) => c.type)).toEqual(["nosecone", "bodytube", "finset"]);
    expect(parsed.warnings.filter((w) => /booster/i.test(w)).length).toBe(1);

    const { cna, cpX } = computeBarrowman(parsed.components, 0.3);
    expect(cna).toBeGreaterThan(0);
    expect(cpX).toBeGreaterThan(0);
  });
});

describe("parseRasaeroXml — error handling", () => {
  it("throws a clear error for XML that isn't a valid .CDX1 rocket document", () => {
    expect(() => parseRasaeroXml("<NotRASAero/>")).toThrow(/No <RocketDesign> element/);
  });

  it("throws a clear error for malformed XML", () => {
    expect(() => parseRasaeroXml("<RASAeroDocument><unclosed>")).toThrow(/Failed to parse/);
  });

  it("falls back to a generic name when no filename is given", () => {
    const xml = fs.readFileSync(path.resolve(__dirname, "../../../sim-files/rasaero/Show-off.CDX1"), "utf-8");
    expect(parseRasaeroXml(xml).name).toBe("Imported rocket");
  });
});
