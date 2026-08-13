/// <reference lib="webworker" />
import { simulateFlight3D } from "../physics/sim/engine3d.js";
import type { Rocket } from "../model/rocket.js";
import type { SimResult3D } from "../physics/sim/types3d.js";

/**
 * M6: runs the 3D ascent RK4 integration off the main thread so the page
 * doesn't stall while it works — a full-wind, many-second flight can be
 * thousands of substeps. The tsconfig includes both "DOM" and "WebWorker"
 * libs (main.ts needs DOM, this file needs WebWorker), which makes the
 * ambient `self` type ambiguous between the two — the local `declare const
 * self` below is the standard fix, not a style choice.
 */
declare const self: DedicatedWorkerGlobalScope;
export {};

export interface SimWorkerRequest {
  id: number;
  rocket: Rocket;
}

export type SimWorkerResponse = { id: number; result: SimResult3D } | { id: number; error: string };

self.onmessage = (e: MessageEvent<SimWorkerRequest>) => {
  const { id, rocket } = e.data;
  try {
    const result = simulateFlight3D(rocket);
    self.postMessage({ id, result } satisfies SimWorkerResponse);
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies SimWorkerResponse);
  }
};
