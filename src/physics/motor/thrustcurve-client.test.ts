import { describe, expect, it } from "vitest";
import { parseRseEngDataMassKg } from "./thrustcurve-client.js";

// Real ThrustCurve.org API response for AeroTech J340M (motorId 5f4294d20002310000000388),
// data:"both" -> results[0].data, fetched directly and hardcoded here rather than mocking network
// -- an exact real captured payload, not synthesized. Decodes to a RockSim/.rse file whose 20
// <eng-data t="..." f="..." m="..." cg="..."/> entries exactly match ThrustCurve's own parsed
// "samples" time/thrust values for this same motor (confirmed directly), the 1:1 correspondence
// downloadThrustSamples relies on to zip mass onto samples by index.
const J340M_RSE_BASE64 =
  "PGVuZ2luZS1kYXRhYmFzZT4KICA8ZW5naW5lLWxpc3Q+CiAgICA8ZW5naW5lICBtZmc9IkFlcm90ZWNoIiBjb2RlPSJKMzQwTSIgVHlwZT0icmVsb2FkYWJsZSIgZGlhPSIzOC4iIGxlbj0iMzM3LiIKaW5pdFd0PSI1NzcuMyIgcHJvcFd0PSIzNjUuIiBkZWxheXM9IjIsNCw2LDgsMTAsMTQiIGF1dG8tY2FsYy1tYXNzPSIxIgphdXRvLWNhbGMtY2c9IjEiIGF2Z1RocnVzdD0iMjk4LjA2NyIgcGVha1RocnVzdD0iNjA2LjUxOCIgdGhyb2F0RGlhPSIwLiIKZXhpdERpYT0iMC4iIEl0b3Q9IjY1Mi43NjciIGJ1cm4tdGltZT0iMi4xOSIgbWFzc0ZyYWM9IjYzLjIzIiBJc3A9IjE4Mi4zNyIKdERpdj0iMTAiIHRTdGVwPSItMS4iIHRGaXg9IjEiIEZEaXY9IjEwIiBGU3RlcD0iLTEuIiBGRml4PSIxIiBtRGl2PSIxMCIKbVN0ZXA9Ii0xLiIgbUZpeD0iMSIgY2dEaXY9IjEwIiBjZ1N0ZXA9Ii0xLiIgY2dGaXg9IjEiPgogICAgPGNvbW1lbnRzPkFUIEozNDAgTWV0YWxzdG9ybSBmb3IgMzgtNzIwPC9jb21tZW50cz4KICAgIDxkYXRhPgogICAgICA8ZW5nLWRhdGEgIHQ9IjAuIiBmPSIwLiIgbT0iMzY1LiIgY2c9IjE2OC41Ii8+CiAgICAgIDxlbmctZGF0YSAgdD0iMC4wMDUiIGY9IjM2MS41NSIgbT0iMzY0LjQ5NSIgY2c9IjE2OC41Ii8+CiAgICAgIDxlbmctZGF0YSAgdD0iMC4wMDgiIGY9IjUwMS43NDIiIG09IjM2My43NzEiIGNnPSIxNjguNSIvPgogICAgICA8ZW5nLWRhdGEgIHQ9IjAuMDI2IiBmPSI2MDYuNTE4IiBtPSIzNTguMTkzIiBjZz0iMTY4LjUiLz4KICAgICAgPGVuZy1kYXRhICB0PSIwLjA5NiIgZj0iNDkxLjQxMiIgbT0iMzM2LjcwNiIgY2c9IjE2OC41Ii8+CiAgICAgIDxlbmctZGF0YSAgdD0iMC4yMTQiIGY9IjQ1My4wNDQiIG09IjMwNS41NDgiIGNnPSIxNjguNSIvPgogICAgICA8ZW5nLWRhdGEgIHQ9IjAuNDg1IiBmPSI0MzkuNzYyIiBtPSIyMzcuOTA0IiBjZz0iMTY4LjUiLz4KICAgICAgPGVuZy1kYXRhICB0PSIwLjc3MiIgZj0iNDM1LjMzNSIgbT0iMTY3LjY4NyIgY2c9IjE2OC41Ii8+CiAgICAgIDxlbmctZGF0YSAgdD0iMC44MjYiIGY9IjQyNi40ODEiIG09IjE1NC42NzYiIGNnPSIxNjguNSIvPgogICAgICA8ZW5nLWRhdGEgIHQ9IjAuODkxIiBmPSI0MjMuNTMiIG09IjEzOS4yMjkiIGNnPSIxNjguNSIvPgogICAgICA8ZW5nLWRhdGEgIHQ9IjEuMDQ4IiBmPSIzODMuNjg1IiBtPSIxMDMuNzk3IiBjZz0iMTY4LjUiLz4KICAgICAgPGVuZy1kYXRhICB0PSIxLjM4OSIgZj0iMzExLjM3NSIgbT0iMzcuNTMyMyIgY2c9IjE2OC41Ii8+CiAgICAgIDxlbmctZGF0YSAgdD0iMS40MjUiIGY9IjMwOC40MjQiIG09IjMxLjI5NDEiIGNnPSIxNjguNSIvPgogICAgICA8ZW5nLWRhdGEgIHQ9IjEuNDU5IiBmPSIzMDkuOSIgbT0iMjUuNDE2NSIgY2c9IjE2OC41Ii8+CiAgICAgIDxlbmctZGF0YSAgdD0iMS41NTQiIGY9IjE4Mi45ODgiIG09IjEyLjMyNTQiIGNnPSIxNjguNSIvPgogICAgICA8ZW5nLWRhdGEgIHQ9IjEuNjExIiBmPSIxMDMuMyIgbT0iNy43NjMwOSIgY2c9IjE2OC41Ii8+CiAgICAgIDxlbmctZGF0YSAgdD0iMS42OTkiIGY9IjU3LjU1MyIgbT0iMy44MDU2MiIgY2c9IjE2OC41Ii8+CiAgICAgIDxlbmctZGF0YSAgdD0iMS44NDEiIGY9IjExLjgwNiIgbT0iMS4wNTIwNSIgY2c9IjE2OC41Ii8+CiAgICAgIDxlbmctZGF0YSAgdD0iMS44OTgiIGY9IjguODU0IiBtPSIwLjcyMjgxNSIgY2c9IjE2OC41Ii8+CiAgICAgIDxlbmctZGF0YSAgdD0iMi4xOSIgZj0iMC4iIG09IjAuIiBjZz0iMTY4LjUiLz4KICAgIDwvZGF0YT4KICA8L2VuZ2luZT4KPC9lbmdpbmUtbGlzdD4KPC9lbmdpbmUtZGF0YWJhc2U+";

describe("parseRseEngDataMassKg", () => {
  it("extracts all 20 propellant-mass-remaining values from a real .rse file, in document order, g->kg", () => {
    const massesKg = parseRseEngDataMassKg(J340M_RSE_BASE64);
    expect(massesKg).not.toBeNull();
    expect(massesKg).toHaveLength(20);
    // First (ignition) and last (burnout) are the clearest real-world checkpoints: starts at the
    // motor's own propWt (365g), ends at exactly 0.
    expect(massesKg![0]).toBeCloseTo(0.365, 9);
    expect(massesKg![massesKg!.length - 1]).toBeCloseTo(0, 9);
    // A real mid-burn checkpoint (t=0.485s in the file).
    expect(massesKg![6]).toBeCloseTo(0.237904, 9);
    // Monotonically non-increasing -- propellant is only ever consumed, never regenerated.
    for (let i = 1; i < massesKg!.length; i++) {
      expect(massesKg![i]!).toBeLessThanOrEqual(massesKg![i - 1]! + 1e-12);
    }
  });

  it("returns null for a RASP (.eng) plain-text file with no <eng-data> tags at all", () => {
    const raspText = Buffer.from(";Estes C6\nC6-0 18 70 P .0125 .0227 E\n 0.1 5.0\n 2.0 0.0\n").toString("base64");
    expect(parseRseEngDataMassKg(raspText)).toBeNull();
  });

  it("returns null (not a partial array) if any <eng-data> tag is missing a numeric m= value", () => {
    const malformed = Buffer.from(
      '<engine-database><engine><data><eng-data t="0" f="0" m="10"/><eng-data t="1" f="5"/></data></engine></engine-database>',
    ).toString("base64");
    expect(parseRseEngDataMassKg(malformed)).toBeNull();
  });

  it("returns null for undecodable input", () => {
    expect(parseRseEngDataMassKg("not valid base64!!!")).toBeNull();
  });
});
