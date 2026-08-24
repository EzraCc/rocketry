// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipOrkXml } from "./unzip.js";
import { parseOrkXml } from "./parse.js";
import type { BodyTube, FreeformFinSet, NoseCone, Transition, TrapezoidalFinSet } from "../../model/component.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.resolve(__dirname, "../../../sim-files/ork", name);

async function loadAndParse(fileName: string) {
  const bytes = fs.readFileSync(fixture(fileName));
  const xml = await unzipOrkXml(bytes);
  return parseOrkXml(xml);
}

describe("parseOrkXml — real .ork fixtures from OpenRocket's own example rockets", () => {
  it("parses 'A simple model rocket.ork': nose + body tube + trapezoidal fins, motor mount detected, default motor resolved", async () => {
    const parsed = await loadAndParse("A simple model rocket.ork");

    expect(parsed.name).toBe("A simple model rocket");
    expect(parsed.warnings).toEqual([]); // single stage, everything supported -- no warnings expected
    expect(parsed.components.map((c) => c.type)).toEqual(["nosecone", "bodytube", "finset"]);

    const nose = parsed.components[0] as NoseCone;
    expect(nose.shape).toBe("ogive");
    expect(nose.length).toBeCloseTo(0.1, 9);
    expect(nose.aftRadius).toBeCloseTo(0.0125, 9);

    const tube = parsed.components[1] as BodyTube;
    expect(tube.length).toBeCloseTo(0.3, 9);
    expect(tube.radius).toBeCloseTo(0.0125, 9); // "auto 0.0125" -- auto-prefix stripped correctly
    // The motor mount is on a nested <innertube>, not the outer <bodytube> itself --
    // hasMotorMount must find it via a descendant search, not just a direct-child check.
    expect(tube.isMotorMount).toBe(true);

    const fins = parsed.components[2] as TrapezoidalFinSet;
    expect(fins.finCount).toBe(3);
    expect(fins.rootChord).toBeCloseTo(0.0508, 9);
    expect(fins.span).toBeCloseTo(0.03, 9); // OpenRocket's <height> maps to our span
    expect(fins.cantAngle).toBeCloseTo(0, 9);
    // <axialoffset method="bottom">0.0</axialoffset> -> flush with the tube's aft end.
    expect(fins.axialOffsetFromParentBottom).toBeCloseTo(tube.length - fins.rootChord, 9);

    // Default flight configuration (configid marked default="true") resolves to the matching <motor>, not just the first one in the file.
    expect(parsed.motor).toEqual({ manufacturer: "Estes", designation: "C6" });

    // OpenRocket's own saved CP, read from its first status="uptodate" simulation's flight data --
    // "CP location" is NaN for every datapoint before the "launchrod" event (confirmed directly
    // against this exact file), so this is the first point past rod exit, not t=0.
    expect(parsed.embeddedCpM).toBeCloseTo(0.3, 6);
  });

  it("parses 'Base drag hack (short-wide).ork': nose + body tube + freeform fins + transition, handles 'auto <number>' radius values", async () => {
    const parsed = await loadAndParse("Base drag hack (short-wide).ork");

    expect(parsed.components.map((c) => c.type)).toEqual(["nosecone", "bodytube", "freeformfinset", "transition"]);

    const nose = parsed.components[0] as NoseCone;
    expect(nose.shape).toBe("ellipsoid");
    expect(nose.aftRadius).toBeCloseTo(0.03937, 6); // from "auto 0.03937"

    const tube = parsed.components[1] as BodyTube;
    expect(tube.radius).toBeCloseTo(0.03937, 9);
    expect(tube.isMotorMount).toBe(true);

    const fins = parsed.components[2] as FreeformFinSet;
    expect(fins.finCount).toBe(4);
    expect(fins.points.length).toBeGreaterThan(3);
    expect(fins.points[0]).toEqual([0, 0]);
    const rootChord = Math.max(...fins.points.filter(([, y]) => Math.abs(y) < 1e-9).map(([x]) => x));
    // <axialoffset method="bottom">0.02774...</axialoffset> against this tube's real length.
    expect(fins.axialOffsetFromParentBottom).toBeCloseTo(tube.length - rootChord + 0.02774048572215544, 6);

    const transition = parsed.components[3] as Transition;
    expect(transition.shape).toBe("conical");
    expect(transition.foreRadius).toBeCloseTo(1.5142307692307692e-5, 12);
    expect(transition.aftRadius).toBeCloseTo(0.03937, 6);
  });

  it("parses 'Three stage low power rocket.ork': imports only the first (sustainer) stage and warns about the rest", async () => {
    const parsed = await loadAndParse("Three stage low power rocket.ork");

    expect(parsed.warnings.some((w) => /3 stages/.test(w) && /first \(sustainer\)/.test(w))).toBe(true);
    // Whatever geometry comes back belongs to a single stage -- exactly one nose cone.
    expect(parsed.components.filter((c) => c.type === "nosecone").length).toBe(1);
  });
});

describe("parseOrkXml — motor mount diameter (a nested inner tube narrower than the outer airframe)", () => {
  it("parses 'PML_Callisto.ork': motor mount diameter comes from the actual mount tube, not the outer 54mm airframe", async () => {
    const bytes = fs.readFileSync(path.resolve(__dirname, "../../../sim-files/misc/PML_Callisto.ork"));
    const xml = await unzipOrkXml(bytes);
    const parsed = parseOrkXml(xml);

    // The rocket flies a real 38mm motor (Cesaroni 247H143-13A) via an inner tube nested inside a
    // ~57.8mm-outer-diameter ("54mm class") airframe -- motorMountDiameterM must reflect the inner
    // tube's own inner diameter (outerradius 0.0206375 - thickness 0.0013335, doubled), not the
    // outer body tube's much wider radius (which is what referenceDiameter/hasMotorMount's deep
    // search would otherwise report -- see extractMotorMountDiameterM's own doc comment).
    expect(parsed.motor).toEqual({ manufacturer: "Cesaroni Technology", designation: "247H143-13A" });
    expect(parsed.motorMountDiameterM).toBeCloseTo(0.0386, 3);
    expect(parsed.motorMountDiameterM).toBeLessThan(0.05); // sanity: nowhere near the 54mm-class outer airframe
  });
});

describe("parseOrkXml — recovery devices (main/drogue)", () => {
  it("parses 'PML_Callisto.ork': single parachute, no <isdrogue> flag -> stays 'main' (single-deploy)", async () => {
    const bytes = fs.readFileSync(path.resolve(__dirname, "../../../sim-files/misc/PML_Callisto.ork"));
    const xml = await unzipOrkXml(bytes);
    const parsed = parseOrkXml(xml);

    expect(parsed.descentDevices).toHaveLength(1);
    expect(parsed.descentDevices[0]).toMatchObject({ type: "parachute", role: "main", dragCoefficient: 1.55 });
    // 1.2192m diameter, full disk (OpenRocket's own parachute has no spill-hole concept).
    expect(parsed.descentDevices[0]!.dragAreaM2).toBeCloseTo(Math.PI * (1.2192 / 2) ** 2, 6);
  });

  it("parses 'A simple model rocket.ork': single parachute with <cd>auto</cd> -> falls back to the 0.8 default", async () => {
    const parsed = await loadAndParse("A simple model rocket.ork");

    expect(parsed.descentDevices).toHaveLength(1);
    expect(parsed.descentDevices[0]).toMatchObject({ type: "parachute", role: "main", dragCoefficient: 0.8 });
    expect(parsed.descentDevices[0]!.dragAreaM2).toBeCloseTo(Math.PI * (0.3 / 2) ** 2, 6);
  });
});

describe("parseOrkXml — error handling", () => {
  it("throws a clear error for XML that isn't a valid .ork rocket document", () => {
    expect(() => parseOrkXml("<not-a-rocket/>")).toThrow(/No <rocket> element/);
  });

  it("throws a clear error for malformed XML", () => {
    expect(() => parseOrkXml("<rocket><unclosed>")).toThrow(/Failed to parse/);
  });
});
