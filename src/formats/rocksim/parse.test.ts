// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRocksimXml } from "./parse.js";
import { computeBarrowman } from "../../physics/aero/barrowman.js";
import type { BodyTube, FreeformFinSet, NoseCone } from "../../model/component.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MM = 0.001;

function loadFixture(): ReturnType<typeof parseRocksimXml> {
  const xml = fs.readFileSync(path.resolve(__dirname, "../../../sim-files/LOC/PK-48 LOC-IV.rkt"), "utf-8");
  return parseRocksimXml(xml);
}

// The independently hand-transcribed fixture already in src/main.ts (locIvComponents) --
// derived by a human reading this exact .rkt file directly, before this parser existed.
// Cross-checking the parser's output against it is a real regression test, not just "does it run."
const HAND_TRANSCRIBED_POINTS: [number, number][] = [
  [171.45 * MM, 0],
  [206.375 * MM, 31.75 * MM],
  [206.375 * MM, 107.95 * MM],
  [142.875 * MM, 107.95 * MM],
  [0, 0],
];

describe("parseRocksimXml — real fixture (sim-files/LOC/PK-48 LOC-IV.rkt)", () => {
  it("matches the independently hand-transcribed locIvComponents fixture field-for-field", () => {
    const parsed = loadFixture();

    expect(parsed.name).toBe("PK-48 LOC-IV");
    expect(parsed.warnings).toEqual([]); // single stage, everything supported
    expect(parsed.components.map((c) => c.type)).toEqual(["nosecone", "bodytube", "bodytube", "freeformfinset"]);

    // Real, sourced number: sum of this file's own 12 <CalcMass> entries (nose, 2 body tubes, tube
    // coupler, bulkhead, motor mount tube, fin set, 3 centering rings, an unmeasured accessory
    // (0g), parachute) -- a real ~4in/1.2m rocket, not the ~50g a blank-rocket default would imply.
    expect(parsed.estimatedDryMassKg).toBeCloseTo(1.10517226, 6);

    // IsMotorMount is 0 everywhere in this file (see the isMotorMount assertions below), so this
    // exercises the PartDesc-based fallback: the real inner tube is named "Motor mount tube" with
    // <ID>38.608</ID> -- a real, verified 38mm-class motor mount despite the flag being unset.
    expect(parsed.motorMountDiameterM).toBeCloseTo(38.608 * MM, 6);

    // Single <Parachute>, PartDesc "36 In. 8 lines" -- Dia=914.001mm, SpillHoleDia=90mm,
    // DragCoefficient=0.8, no name hint -> the only device, so it's "main" by default.
    expect(parsed.descentDevices).toHaveLength(1);
    expect(parsed.descentDevices[0]!.type).toBe("parachute");
    expect(parsed.descentDevices[0]!.role).toBe("main");
    expect(parsed.descentDevices[0]!.dragCoefficient).toBeCloseTo(0.8, 6);
    const expectedAreaM2 = Math.PI * (((914.001 * MM) / 2) ** 2 - ((90 * MM) / 2) ** 2);
    expect(parsed.descentDevices[0]!.dragAreaM2).toBeCloseTo(expectedAreaM2, 6);

    const nose = parsed.components[0] as NoseCone;
    expect(nose.shape).toBe("ogive");
    // RockSim's own <ShapeParameter> is meaningless for ogive (see parseShapeCode's doc comment) --
    // this project's ogive shape needs it forced to 1 (tangent), not left at the file's stored 0.
    expect(nose.shapeParameter).toBe(1);
    expect(nose.length).toBeCloseTo(325.12 * MM, 9);
    expect(nose.aftRadius).toBeCloseTo((101.6 / 2) * MM, 9);
    expect(nose.thickness).toBeCloseTo(3.175 * MM, 9);

    const tube1 = parsed.components[1] as BodyTube;
    expect(tube1.length).toBeCloseTo(279.4 * MM, 9);
    expect(tube1.radius).toBeCloseTo((101.6 / 2) * MM, 9);
    expect(tube1.isMotorMount).toBe(false);

    const tube2 = parsed.components[2] as BodyTube;
    expect(tube2.length).toBeCloseTo(584.2 * MM, 9);
    expect(tube2.radius).toBeCloseTo((101.6 / 2) * MM, 9);
    // This exact file never marks any tube's IsMotorMount=1 (confirmed by reading the raw file) --
    // the nested "Motor mount tube" inner tube is IsMotorMount=0 too, so this correctly comes out
    // false, matching the hand-transcribed fixture's own (also false) value for this real file.
    expect(tube2.isMotorMount).toBe(false);

    const fins = parsed.components[3] as FreeformFinSet;
    expect(fins.finCount).toBe(3);
    expect(fins.points).toEqual(HAND_TRANSCRIBED_POINTS);
    expect(fins.thickness).toBeCloseTo(3 * MM, 9);
    expect(fins.cantAngle).toBeCloseTo(0, 9);
    // Xb=412.75, no <LocationMode> present for this fin set in the real file -> defaults to
    // FRONT_OF_OWNING_PART (offset from parent's fore end, unmodified) -- matches the
    // hand-transcribed fixture's axialOffsetFromParentBottom: 412.75 * MM exactly.
    expect(fins.axialOffsetFromParentBottom).toBeCloseTo(412.75 * MM, 9);
  });

  it("produces the same CNa/CP as the hand-transcribed fixture through the real physics", () => {
    const parsed = loadFixture();
    const parsedResult = computeBarrowman(parsed.components, 0.001);

    // Hand-transcribed fixture, reconstructed inline (mirrors src/main.ts's locIvComponents).
    const handComponents = [
      { type: "nosecone" as const, id: "n", name: "n", shape: "ogive" as const, shapeParameter: 1, length: 325.12 * MM, aftRadius: (101.6 / 2) * MM, thickness: 3.175 * MM },
      { type: "bodytube" as const, id: "t1", name: "t1", length: 279.4 * MM, radius: (101.6 / 2) * MM, thickness: 0, isMotorMount: false },
      { type: "bodytube" as const, id: "t2", name: "t2", length: 584.2 * MM, radius: (101.6 / 2) * MM, thickness: 0, isMotorMount: false },
      {
        type: "freeformfinset" as const, id: "f", name: "f", finCount: 3, points: HAND_TRANSCRIBED_POINTS,
        thickness: 3 * MM, cantAngle: 0, axialOffsetFromParentBottom: 412.75 * MM,
      },
    ];
    const handResult = computeBarrowman(handComponents, 0.001);

    expect(parsedResult.cna).toBeCloseTo(handResult.cna, 9);
    expect(parsedResult.cpX).toBeCloseTo(handResult.cpX, 9);
  });
});

describe("parseRocksimXml — real fixture (public/library/wildman/WildmanDD.rkt) — dual-deploy descent device classification", () => {
  it("classifies the explicitly-named drogue as drogue and the larger unnamed chute as main", () => {
    const xml = fs.readFileSync(path.resolve(__dirname, "../../../public/library/wildman/WildmanDD.rkt"), "utf-8");
    const parsed = parseRocksimXml(xml);

    // 54mm inner motor mount tube, correctly IsMotorMount=1 in this file (unlike LOC-IV).
    expect(parsed.motorMountDiameterM).toBeCloseTo(54.356 * MM, 6);

    expect(parsed.descentDevices).toHaveLength(2);
    const main = parsed.descentDevices.find((d) => d.role === "main");
    const drogue = parsed.descentDevices.find((d) => d.role === "drogue");
    expect(main).toBeDefined();
    expect(drogue).toBeDefined();
    // Main: Dia=1320.8mm, no spill hole, DragCoefficient=1.46 (plain "Parachute", the larger of the two).
    expect(main!.dragCoefficient).toBeCloseTo(1.46, 6);
    expect(main!.dragAreaM2).toBeCloseTo(Math.PI * ((1320.8 * MM) / 2) ** 2, 6);
    // Drogue: Dia=508mm, DragCoefficient=0.8, explicitly named "Drogue Parachute" -- classified by
    // name, not just by being the smaller one (both signals agree here, but the name is what the
    // implementation actually keys on).
    expect(drogue!.dragCoefficient).toBeCloseTo(0.8, 6);
    expect(drogue!.dragAreaM2).toBeCloseTo(Math.PI * ((508 * MM) / 2) ** 2, 6);
    expect(main!.dragAreaM2).toBeGreaterThan(drogue!.dragAreaM2);
  });
});

describe("parseRocksimXml — error handling", () => {
  it("throws a clear error for XML that isn't a valid .rkt rocket document", () => {
    expect(() => parseRocksimXml("<NotRockSim/>")).toThrow(/No <RocketDesign> element/);
  });

  it("throws a clear error for malformed XML", () => {
    expect(() => parseRocksimXml("<RockSimDocument><unclosed>")).toThrow(/Failed to parse/);
  });
});
