// Deterministic engine-layer tests — NO real engine, NO WASM. A scripted
// FakeTransport stands in for Stockfish so the UCI conversation, the strength
// option sequence, and bestmove parsing are all asserted exactly and instantly.
// (The real engine is exercised separately by test/integration, run via
// `npm run engine:check`.)

import { describe, it, expect } from 'vitest';
import { UciEngine } from '../src/engine/uciEngine';
import { buildStrengthCommands } from '../src/engine/strengthCommands';
import { eloToEngineOptions } from '../src/core/strength';
import { FakeTransport, scriptedEngine } from './helpers/fakeTransport';

describe('buildStrengthCommands', () => {
  it('uses Skill Level (limit off) below the 1320 Elo floor', () => {
    const opts = eloToEngineOptions(800); // → skill band 2, limit off
    expect(buildStrengthCommands(opts)).toEqual([
      'setoption name Threads value 1',
      'setoption name UCI_LimitStrength value false',
      'setoption name Skill Level value 2',
      'setoption name MultiPV value 1',
    ]);
  });

  it('uses UCI_LimitStrength + UCI_Elo at or above the floor', () => {
    const opts = eloToEngineOptions(1600); // → limit on, elo 1600
    expect(buildStrengthCommands(opts)).toEqual([
      'setoption name Threads value 1',
      'setoption name UCI_LimitStrength value true',
      'setoption name UCI_Elo value 1600',
      'setoption name MultiPV value 1',
    ]);
  });

  it('always pins Threads to 1 and echoes the requested MultiPV', () => {
    const cmds = buildStrengthCommands({ limitStrength: true, uciElo: 2000, movetimeMs: 300, multipv: 3 });
    expect(cmds[0]).toBe('setoption name Threads value 1');
    expect(cmds).toContain('setoption name MultiPV value 3');
  });
});

describe('UciEngine handshake', () => {
  it('init() sends uci then isready and resolves on uciok/readyok', async () => {
    const t = new FakeTransport(scriptedEngine());
    const engine = new UciEngine(t);
    await engine.init();
    expect(t.sent).toEqual(['uci', 'isready']);
  });

  it('newGame() sends ucinewgame then syncs on readyok', async () => {
    const t = new FakeTransport(scriptedEngine());
    const engine = new UciEngine(t);
    await engine.newGame();
    expect(t.sent).toEqual(['ucinewgame', 'isready']);
  });
});

describe('UciEngine.setStrength', () => {
  it('emits the exact setoption sequence then isready', async () => {
    const t = new FakeTransport(scriptedEngine());
    const engine = new UciEngine(t);
    const opts = eloToEngineOptions(1600);
    await engine.setStrength(opts);
    expect(t.sent).toEqual([...buildStrengthCommands(opts), 'isready']);
  });
});

describe('UciEngine.bestMove', () => {
  it('sends position(startpos)+go and returns the parsed bestmove + ponder', async () => {
    const t = new FakeTransport(scriptedEngine('e2e4 ponder e7e5'));
    const engine = new UciEngine(t);
    const bm = await engine.bestMove({ moves: ['e2e4', 'e7e5'] }, { movetimeMs: 100 });
    expect(bm).toEqual({ best: 'e2e4', ponder: 'e7e5' });
    expect(t.sent).toEqual(['position startpos moves e2e4 e7e5', 'go movetime 100']);
  });

  it('captures the last scored info line during the search', async () => {
    const t = new FakeTransport(scriptedEngine());
    const engine = new UciEngine(t);
    await engine.bestMove({});
    expect(engine.lastInfo?.score).toEqual({ cp: 31 });
    expect(engine.lastInfo?.depth).toBe(10);
  });

  it('builds a fen position command when a fen is given', async () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const t = new FakeTransport(scriptedEngine());
    const engine = new UciEngine(t);
    await engine.bestMove({ fen }, { depth: 12 });
    expect(t.sent).toEqual([`position fen ${fen}`, 'go depth 12']);
  });

  it('falls back to the configured default movetime when no limits are given', async () => {
    const t = new FakeTransport(scriptedEngine());
    const engine = new UciEngine(t, { defaultMovetimeMs: 250 });
    await engine.bestMove({});
    expect(t.sent).toEqual(['position startpos', 'go movetime 250']);
  });

  it('rejects with a timeout if the engine never replies', async () => {
    const silent = new FakeTransport(() => {}); // never emits anything
    const engine = new UciEngine(silent, { searchTimeoutMs: 40 });
    await expect(engine.bestMove({})).rejects.toThrow(/timeout.*bestmove/i);
  });
});

describe('UciEngine.dispose', () => {
  it('sends quit and tears down the transport', async () => {
    const t = new FakeTransport(scriptedEngine());
    const engine = new UciEngine(t);
    await engine.dispose();
    expect(t.sent).toContain('quit');
    expect(t.isDisposed).toBe(true);
  });
});
