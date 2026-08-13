import type { Rocket } from "../model/rocket.js";
import type { SimResult3D } from "../physics/sim/types3d.js";
import type { SimWorkerRequest, SimWorkerResponse } from "./sim-worker.js";

/**
 * Lazily-created singleton worker (spun up on the first simulation request,
 * not at module load — most page loads never run a flight sim at all, e.g.
 * someone just browsing the motor search). Request/response pairs are
 * correlated by an incrementing id since a fast unit toggle or motor
 * reselect can fire a new request before a previous one's response has
 * arrived; the id lets each caller's Promise resolve with only its own
 * result rather than racing on shared worker state.
 */
let worker: Worker | null = null;
let nextId = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./sim-worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

export function simulateFlight3DInWorker(rocket: Rocket): Promise<SimResult3D> {
  const id = ++nextId;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<SimWorkerResponse>) => {
      if (e.data.id !== id) return;
      cleanup();
      if ("error" in e.data) reject(new Error(e.data.error));
      else resolve(e.data.result);
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      reject(e.error instanceof Error ? e.error : new Error(e.message));
    };
    function cleanup(): void {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    }
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ id, rocket } satisfies SimWorkerRequest);
  });
}
