// Node transport + factory: drive a REAL Stockfish (the `stockfish` npm package)
// headlessly. Used by the integration gate (test/integration) and any Node-side
// tooling. The browser will get its own UciTransport (a Web Worker) in the UI
// session — this file is the Node counterpart of that same seam.
//
// `stockfish` is loaded with a DYNAMIC import so that merely importing the engine
// library never pulls a 10MB engine into the bundle/test process; the WASM/asm is
// only loaded when `createNodeEngine()` is actually called.

import type { UciTransport, UciEngineOptions } from './types';
import { UciEngine } from './uciEngine';

/** Subset of the `stockfish` engine object this transport relies on. */
interface RawEngine {
  listener?: (line: string) => void;
  sendCommand?: (command: string) => void;
  postMessage?: (command: string) => void;
  addMessageListener?: (cb: (line: string) => void) => void;
  terminate?: () => void;
}

/** Wraps a loaded `stockfish` engine object as a line-based UciTransport. */
export class NodeUciTransport implements UciTransport {
  constructor(private readonly engine: RawEngine) {}

  send(command: string): void {
    if (this.engine.sendCommand) this.engine.sendCommand(command);
    else if (this.engine.postMessage) this.engine.postMessage(command);
    else throw new Error('stockfish engine exposes neither sendCommand nor postMessage');
  }

  onLine(handler: (line: string) => void): void {
    // `listener` is the hook that works for the Node builds; also register the
    // worker-style listener if present, for forward-compatibility.
    this.engine.listener = handler;
    this.engine.addMessageListener?.(handler);
  }

  dispose(): void {
    // UciEngine.dispose already sends `quit`; just terminate the runtime here.
    this.engine.terminate?.();
  }
}

/**
 * Load Stockfish in Node and return a ready (post-handshake) UciEngine.
 *
 * @param build Engine build keyword. Defaults to `'asm'` — the pure-JS asm.js
 *   build, which is self-contained and loads everywhere (the WASM builds need
 *   their NNUE binary assembled by the package's postinstall, which can be flaky
 *   in restricted sandboxes). On a healthy install you can pass `'lite-single'`
 *   for a faster single-threaded WASM engine.
 */
export async function createNodeEngine(
  build: string = 'asm',
  opts: UciEngineOptions = {},
): Promise<UciEngine> {
  const mod = (await import('stockfish')) as unknown as {
    default?: (path?: string) => Promise<RawEngine>;
  };
  const initEngine = mod.default ?? (mod as unknown as (path?: string) => Promise<RawEngine>);
  const rawEngine = await initEngine(build);
  const engine = new UciEngine(new NodeUciTransport(rawEngine), opts);
  await engine.init();
  return engine;
}
