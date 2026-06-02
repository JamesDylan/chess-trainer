// Unit tests for the browser engine seam — WorkerUciTransport — with NO real WASM.
// We inject fake workers (just postMessage/terminate/onmessage), so these run in
// vitest's node env and stay fast and deterministic, exactly like engine.test.ts
// does for the Node transport.

import { describe, it, expect } from 'vitest';
import { WorkerUciTransport, type WorkerLike } from '../src/engine/workerEngine';
import { UciEngine } from '../src/engine/uciEngine';

/** A worker double that records what was posted and lets the test emit lines back. */
class RecordingWorker implements WorkerLike {
  readonly posted: string[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage(command: string): void {
    this.posted.push(command);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Simulate the engine emitting one output line. */
  emit(line: unknown): void {
    this.onmessage?.({ data: line } as MessageEvent);
  }
}

/** A worker double that auto-replies like a tiny, well-mannered UCI engine. */
class ScriptedWorker implements WorkerLike {
  readonly posted: string[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage(command: string): void {
    this.posted.push(command);
    queueMicrotask(() => this.respond(command));
  }
  terminate(): void {
    this.terminated = true;
  }
  private emit(line: string): void {
    this.onmessage?.({ data: line } as MessageEvent);
  }
  private respond(command: string): void {
    if (command === 'uci') {
      this.emit('id name FakeFish 1.0');
      this.emit('uciok');
    } else if (command === 'isready') {
      this.emit('readyok');
    } else if (command.startsWith('go')) {
      this.emit('info depth 10 score cp 31 nodes 1234 time 50 pv e2e4 e7e5');
      this.emit('bestmove e2e4 ponder e7e5');
    }
  }
}

describe('WorkerUciTransport', () => {
  it('send() posts the command to the worker', () => {
    const worker = new RecordingWorker();
    const transport = new WorkerUciTransport(worker);
    transport.send('uci');
    transport.send('isready');
    expect(worker.posted).toEqual(['uci', 'isready']);
  });

  it('delivers worker messages to the onLine handler in order', () => {
    const worker = new RecordingWorker();
    const transport = new WorkerUciTransport(worker);
    const lines: string[] = [];
    transport.onLine((line) => lines.push(line));

    worker.emit('uciok');
    worker.emit('bestmove e2e4');

    expect(lines).toEqual(['uciok', 'bestmove e2e4']);
  });

  it('coerces non-string payloads and ignores null/undefined frames', () => {
    const worker = new RecordingWorker();
    const transport = new WorkerUciTransport(worker);
    const lines: string[] = [];
    transport.onLine((line) => lines.push(line));

    worker.emit(123);
    worker.emit(null);
    worker.emit(undefined);
    worker.emit('readyok');

    expect(lines).toEqual(['123', 'readyok']);
  });

  it('dispose() terminates the worker', () => {
    const worker = new RecordingWorker();
    new WorkerUciTransport(worker).dispose();
    expect(worker.terminated).toBe(true);
  });

  it('drives a full UciEngine handshake + bestmove through the worker seam', async () => {
    const worker = new ScriptedWorker();
    const engine = new UciEngine(new WorkerUciTransport(worker), {
      handshakeTimeoutMs: 1_000,
      searchTimeoutMs: 1_000,
    });

    await engine.init();
    const bm = await engine.bestMove({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' }, { movetimeMs: 5 });

    expect(bm.best).toBe('e2e4');
    expect(worker.posted).toContain('uci');
    expect(worker.posted).toContain('isready');
    expect(worker.posted.some((c) => c.startsWith('position'))).toBe(true);
    expect(worker.posted.some((c) => c.startsWith('go'))).toBe(true);
  });
});
