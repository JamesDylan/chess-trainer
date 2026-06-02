// Browser transport + factory: drive a REAL Stockfish (a WASM build) inside a Web
// Worker. This is the browser twin of nodeEngine.ts — it implements the SAME
// `UciTransport` seam, so `UciEngine`, `buildStrengthCommands`, and the entire
// Stage 0 core are reused UNCHANGED. The only new code is this transport.
//
// Wiring (nmrugg/stockfish.js): the build self-detects a Worker context. A classic
// `new Worker(url)` boots the engine; commands go in via `postMessage`; engine
// output arrives one UCI line per `message` event. The single-threaded
// "lite-single" build uses no SharedArrayBuffer, so it needs NO cross-origin
// isolation (no COOP/COEP headers) — that's why we default to it.

import type { UciTransport, UciEngineOptions } from './types';
import { UciEngine } from './uciEngine';

/**
 * The minimal slice of the DOM `Worker` API this transport uses. Declaring it
 * structurally (instead of hard-depending on the global `Worker`) keeps the
 * transport unit-testable in Node with a fake worker, and decouples it from how
 * the worker was constructed. A real `Worker` satisfies this interface.
 */
export interface WorkerLike {
  postMessage(command: string): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

/** Wraps a Worker running a UCI engine as a line-based `UciTransport`. */
export class WorkerUciTransport implements UciTransport {
  private handler: (line: string) => void = () => {};

  constructor(private readonly worker: WorkerLike) {
    this.worker.onmessage = (event: MessageEvent): void => {
      // Stockfish posts one UCI line per message, as a string. Be defensive about
      // non-string payloads by coercing; ignore empty/nullish frames.
      const data: unknown = event.data;
      if (typeof data === 'string') this.handler(data);
      else if (data !== null && data !== undefined) this.handler(String(data));
    };
  }

  send(command: string): void {
    this.worker.postMessage(command);
  }

  onLine(handler: (line: string) => void): void {
    this.handler = handler;
  }

  dispose(): void {
    // UciEngine.dispose() already sends `quit` (the stockfish worker closes itself
    // on it); terminate() is the hard stop and belt-and-braces cleanup.
    this.worker.terminate();
  }
}

/**
 * Boot a WASM Stockfish in a Web Worker and return a ready (post-handshake)
 * `UciEngine`. `workerUrl` must point at a stockfish.js build served as a static
 * asset, with its `.wasm` sibling next to it (see scripts/copy-engine.mjs).
 *
 * The handshake timeout defaults higher than Node's: first load has to fetch and
 * compile a multi-megabyte `.wasm` before the engine can answer `uciok`.
 */
export async function createWorkerEngine(
  workerUrl: string | URL,
  opts: UciEngineOptions = {},
): Promise<UciEngine> {
  // Classic worker (NOT { type: 'module' }): the stockfish.js build is an IIFE
  // that relies on classic-worker globals (self.location, synchronous loading).
  const worker = new Worker(workerUrl);
  const engine = new UciEngine(new WorkerUciTransport(worker), {
    handshakeTimeoutMs: 30_000,
    ...opts,
  });
  await engine.init();
  return engine;
}
