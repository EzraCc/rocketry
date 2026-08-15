/**
 * mulberry32 -- a small, fast, good-enough (not cryptographic) deterministic PRNG. Used for the
 * pitch/yaw stability-margin nudge (see derivatives3d.ts's own doc comment on why this project
 * needs one at all): a fixed seed reproduces the exact same "random" perturbation sequence run to
 * run, matching OpenRocket's own `new Random(seed)` reproducibility, rather than reaching for
 * Math.random() (unseedable, so results couldn't be reproduced or compared across runs).
 */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
