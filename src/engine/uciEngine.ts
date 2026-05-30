// UciEngine: the high-level, transport-agnostic engine driver.
//
// It owns the UCI conversation (handshake → newgame → set strength → search) and
// reuses the Stage 0 pure helpers for every byte on the wire:
//   buildPositionCommand / buildGoCommand  (commands out)
//   parseInfoLine / parseBestMove          (lines in)
// It never imports chess.js, the DOM, Node, or the `stockfish` package — it only
// talks to an injected `UciTransport`. That is what makes it unit-testable with a
// scripted fake and identical across WASM/native engines.

import type { BestMove, InfoLine, EngineOptions } from '../core/types';
import { buildPositionCommand, buildGoCommand, parseInfoLine, parseBestMove } from '../core/uci';
import { buildStrengthCommands } from './strengthCommands';
import type { UciTransport, EnginePosition, GoLimits, UciEngineOptions } from './types';

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;
const DEFAULT_MOVETIME_MS = 1_000;

export class UciEngine {
  private readonly transport: UciTransport;
  private readonly handshakeTimeoutMs: number;
  private readonly searchTimeoutMs: number;
  private movetimeMs: number;

  /** Most recent `info` line that carried a score (handy for analysis/diagnostics). */
  public lastInfo?: InfoLine;

  // One pending resolver per response kind. Sequential use means at most one of
  // each is live at a time; each is cleared by its timeout or its matching line.
  private resolveUciOk?: () => void;
  private resolveReadyOk?: () => void;
  private resolveBest?: (bm: BestMove) => void;

  constructor(transport: UciTransport, opts: UciEngineOptions = {}) {
    this.transport = transport;
    this.handshakeTimeoutMs = opts.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.searchTimeoutMs = opts.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    this.movetimeMs = opts.defaultMovetimeMs ?? DEFAULT_MOVETIME_MS;
    this.transport.onLine((line) => this.handleLine(line));
  }

  /** `uci` → `uciok`, then `isready` → `readyok`. Call once after construction. */
  async init(): Promise<void> {
    const uciok = this.waitToken('uci', this.handshakeTimeoutMs);
    this.transport.send('uci');
    await uciok;
    await this.isReady();
  }

  /** `ucinewgame`, then sync on `isready`/`readyok`. */
  async newGame(): Promise<void> {
    this.transport.send('ucinewgame');
    await this.isReady();
  }

  /**
   * Apply a target strength: send the `setoption` lines from
   * `buildStrengthCommands`, record `movetimeMs` as the default think time, then
   * sync on `readyok`. Pass the result of Stage 0's `eloToEngineOptions`.
   */
  async setStrength(opts: EngineOptions): Promise<void> {
    for (const cmd of buildStrengthCommands(opts)) this.transport.send(cmd);
    this.movetimeMs = opts.movetimeMs;
    await this.isReady();
  }

  /**
   * Search `position` and resolve with the engine's `bestmove`. Uses `limits` if
   * given, otherwise `go movetime <defaultMovetime>`. Resets `lastInfo` first.
   */
  bestMove(position: EnginePosition, limits?: GoLimits): Promise<BestMove> {
    this.lastInfo = undefined;
    const best = this.waitBest(this.searchTimeoutMs);
    this.transport.send(buildPositionCommand(position));
    this.transport.send(buildGoCommand(limits ?? { movetimeMs: this.movetimeMs }));
    return best;
  }

  /** `isready` → `readyok`. Confirms the engine has digested prior options. */
  isReady(): Promise<void> {
    const ready = this.waitToken('ready', this.handshakeTimeoutMs);
    this.transport.send('isready');
    return ready;
  }

  /** Best-effort `quit` + transport teardown. */
  async dispose(): Promise<void> {
    try {
      this.transport.send('quit');
    } catch {
      // engine may already be gone; ignore.
    }
    await Promise.resolve(this.transport.dispose());
  }

  // --- internals -----------------------------------------------------------

  private handleLine(line: string): void {
    // `info` lines: keep the last scored one; never a control signal.
    if (line.startsWith('info')) {
      const info = parseInfoLine(line);
      if (info && info.score) this.lastInfo = info;
      return;
    }

    const bm = parseBestMove(line);
    if (bm) {
      const resolve = this.resolveBest;
      this.resolveBest = undefined;
      resolve?.(bm);
      return;
    }

    // `uciok` / `readyok` arrive as bare tokens (after id/option chatter).
    if (line.includes('uciok')) {
      const resolve = this.resolveUciOk;
      this.resolveUciOk = undefined;
      resolve?.();
      return;
    }
    if (line.includes('readyok')) {
      const resolve = this.resolveReadyOk;
      this.resolveReadyOk = undefined;
      resolve?.();
    }
  }

  /** Wait for `uciok` (kind='uci') or `readyok` (kind='ready'), racing a timeout. */
  private waitToken(kind: 'uci' | 'ready', timeoutMs: number): Promise<void> {
    const label = kind === 'uci' ? 'uciok' : 'readyok';
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (kind === 'uci') this.resolveUciOk = undefined;
        else this.resolveReadyOk = undefined;
        reject(new Error(`UCI timeout after ${timeoutMs}ms waiting for ${label}`));
      }, timeoutMs);
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      if (kind === 'uci') this.resolveUciOk = done;
      else this.resolveReadyOk = done;
    });
  }

  /** Wait for the next `bestmove`, racing a timeout. */
  private waitBest(timeoutMs: number): Promise<BestMove> {
    return new Promise<BestMove>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.resolveBest = undefined;
        reject(new Error(`UCI timeout after ${timeoutMs}ms waiting for bestmove`));
      }, timeoutMs);
      this.resolveBest = (bm: BestMove): void => {
        clearTimeout(timer);
        resolve(bm);
      };
    });
  }
}
