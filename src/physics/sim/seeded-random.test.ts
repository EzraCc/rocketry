import { describe, expect, it } from "vitest";
import { createSeededRandom } from "./seeded-random.js";

describe("createSeededRandom", () => {
  it("produces values in [0, 1)", () => {
    const rng = createSeededRandom(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic: the same seed reproduces the exact same sequence", () => {
    const a = createSeededRandom(12345);
    const b = createSeededRandom(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds produce different sequences", () => {
    const a = createSeededRandom(1);
    const b = createSeededRandom(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("doesn't repeat immediately (a real generator, not a constant)", () => {
    const rng = createSeededRandom(7);
    const v1 = rng();
    const v2 = rng();
    expect(v1).not.toBe(v2);
  });
});
