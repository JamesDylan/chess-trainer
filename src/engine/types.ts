// Engine-layer types for Stage 1 (play vs engine).
// These sit ON TOP of the Stage 0 core types (src/core/types.ts) — they do not
// modify them. The key abstraction is `UciTransport`: a line-based pipe to *some*
// UCI engine. Swapping WASM (browser Web Worker) for a native Stockfish sidecar
// at Stage 6 is just a new UciTransport implementation — nothing above it changes.

/**
 * A line-based, transport-agnostic pipe to a UCI engine process.
 *
 * - `send` writes one UCI command line (no trailing newline needed).
 * - `onLine` registers the single sink for engine output; `UciEngine` sets this
 *   once at construction and demultiplexes lines itself.
 * - `dispose` tears down the underlying engine/worker/process.
 *
 * Implementations: `NodeUciTransport` (real Stockfish via the `stockfish` npm
 * package, used for headless tests + the integration gate) and — added in the UI
 * session — a `WorkerUciTransport` wrapping a browser Web Worker.
 */
export interface UciTransport {
  send(command: string): void;
  onLine(handler: (line: string) => void): void;
  dispose(): void | Promise<void>;
}

/** A position to search: start position (optionally with moves) or an explicit FEN. */
export interface EnginePosition {
  /** FEN to search from. Omit for the standard start position. */
  fen?: string;
  /** Moves (UCI, e.g. `e2e4`) applied from the base position. */
  moves?: string[];
}

/** Search limits for a single `go`. Omit all for an unbounded `go`. */
export interface GoLimits {
  depth?: number;
  movetimeMs?: number;
  nodes?: number;
}

/** Tunable timeouts (ms). Defaults are generous; tests override them to stay fast. */
export interface UciEngineOptions {
  /** Max wait for `uciok` / `readyok`. */
  handshakeTimeoutMs?: number;
  /** Max wait for a `bestmove` after `go`. asm.js can be slow, so keep this roomy. */
  searchTimeoutMs?: number;
  /** Fallback per-move think time used by `bestMove` when no GoLimits are given. */
  defaultMovetimeMs?: number;
}
