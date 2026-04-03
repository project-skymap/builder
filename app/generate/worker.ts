// Single-pass generation worker for Generator v2.

import { generateSky } from "@project-skymap/library";
import type { SkyGenParams, SkyField } from "@project-skymap/library";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export type WorkerRequest = { type: "generate"; params: SkyGenParams };
export type WorkerResponse =
  | { type: "progress"; stage: string; pct: number }
  | { type: "done"; field: SkyField };

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = (msg: WorkerResponse) => (self as any).postMessage(msg);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "generate") {
    const field = generateSky(msg.params, (stage, pct) => {
      post({ type: "progress", stage, pct });
    });
    post({ type: "done", field });
  }
};
