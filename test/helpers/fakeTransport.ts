// A scripted, in-memory UciTransport for deterministic tests — no WASM, no async
// engine. You provide a `responder` that, for each command the engine sends, may
// emit zero or more reply lines synchronously. This lets us assert the exact UCI
// conversation (handshake, setoption sequence, position/go) and parsing without
// any real engine, keeping `npm test` fast and offline.

import type { UciTransport } from '../../src/engine/types';

export type Responder = (command: string, emit: (line: string) => void) => void;

export class FakeTransport implements UciTransport {
  /** Every command the engine sent, in order — assert against this. */
  public readonly sent: string[] = [];
  private handler: (line: string) => void = () => {};
  private disposed = false;

  constructor(private readonly responder: Responder = () => {}) {}

  send(command: string): void {
    this.sent.push(command);
    this.responder(command, (line) => this.handler(line));
  }

  onLine(handler: (line: string) => void): void {
    this.handler = handler;
  }

  dispose(): void {
    this.disposed = true;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

/**
 * A convenience responder that behaves like a tiny, well-mannered UCI engine:
 *   - `uci`      → a couple of id/option lines, then `uciok`
 *   - `isready`  → `readyok`
 *   - `go ...`   → one `info` line, then a fixed `bestmove`
 * Everything else (setoption, ucinewgame, position) is accepted silently.
 */
export function scriptedEngine(bestmove = 'e2e4 ponder e7e5'): Responder {
  return (command, emit) => {
    if (command === 'uci') {
      emit('id name FakeFish 1.0');
      emit('id author tests');
      emit('option name UCI_Elo type spin default 1320 min 1320 max 3190');
      emit('uciok');
    } else if (command === 'isready') {
      emit('readyok');
    } else if (command.startsWith('go')) {
      emit('info depth 10 seldepth 14 multipv 1 score cp 31 nodes 12345 nps 100000 time 120 pv e2e4 e7e5');
      emit(`bestmove ${bestmove}`);
    }
  };
}
