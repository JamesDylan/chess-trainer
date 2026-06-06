// Deterministic tests for the single-position eval helper — drives the REAL UciEngine
// through a position-aware scripted FakeTransport (no WASM), so the score + PV are read
// off `engine.lastInfo` via the real parse path. Asserts the White-POV bar mapping
// (REFERENCE §1: cp 200 -> 67.62), best-move capture, multi-move PV extraction (the
// source of the live coach's refutation), and that it searches by DEPTH.

import { describe, it, expect } from 'vitest';
import { UciEngine } from '../src/engine/uciEngine';
import { evaluatePosition } from '../src/coach/evaluatePosition';
import { scoreToWinPercent } from '../src/core/evalMath';
import type { Score } from '../src/core/types';
import { FakeTransport } from './helpers/fakeTransport';
import { scriptedAnalysisResponder } from './helpers/scriptedAnalysisEngine';

const WHITE_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BLACK_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

const scores = new Map<string, Score>([
  [WHITE_FEN, { cp: 200 }], // White to move, White +200
  [BLACK_FEN, { cp: 200 }], // Black to move, Black +200 (side-to-move POV)
]);
const best = new Map<string, string>([
  [WHITE_FEN, 'e2e4'],
  [BLACK_FEN, 'e7e5'],
]);
const pvs = new Map<string, string[]>([
  [BLACK_FEN, ['e7e5', 'g1f3', 'b8c6']], // a multi-move principal variation
]);

async function makeEngine(): Promise<{ engine: UciEngine; transport: FakeTransport }> {
  const transport = new FakeTransport(
    scriptedAnalysisResponder(
      (fen) => scores.get(fen) ?? { cp: 0 },
      (fen) => best.get(fen) ?? 'e2e4',
      (fen) => pvs.get(fen) ?? [best.get(fen) ?? 'e2e4'],
    ),
  );
  const engine = new UciEngine(transport, { searchTimeoutMs: 2000, handshakeTimeoutMs: 2000 });
  await engine.init();
  return { engine, transport };
}

describe('evaluatePosition — White-POV bar mapping + best move + PV', () => {
  it('maps a White-to-move +200 to ~67.62% White (REFERENCE §1) and searches by depth', async () => {
    const { engine, transport } = await makeEngine();
    const ev = await evaluatePosition(WHITE_FEN, engine, 12);

    expect(ev.score).toEqual({ cp: 200 });
    expect(ev.winWhite).toBeCloseTo(67.62, 1); // cp 200 -> 67.62, White to move = White POV
    expect(ev.winWhite).toBeCloseTo(scoreToWinPercent({ cp: 200 }), 9);
    expect(ev.bestMoveUci).toBe('e2e4');
    expect(ev.pv).toEqual(['e2e4']); // default single-move PV

    // It searched by DEPTH (shallow live depth), not movetime.
    expect(transport.sent.filter((c) => c.startsWith('go'))).toEqual(['go depth 12']);
  });

  it('flips side-to-move POV to White POV for a Black-to-move position', async () => {
    const { engine } = await makeEngine();
    const ev = await evaluatePosition(BLACK_FEN, engine, 12);

    // Black is +200 to move, so White's win% is the complement.
    expect(ev.winWhite).toBeCloseTo(100 - 67.62, 1);
    expect(ev.winWhite).toBeCloseTo(100 - scoreToWinPercent({ cp: 200 }), 9);
  });

  it('extracts the full multi-move PV (the live coach reads the refutation off pv[0])', async () => {
    const { engine } = await makeEngine();
    const ev = await evaluatePosition(BLACK_FEN, engine, 12);

    expect(ev.pv).toEqual(['e7e5', 'g1f3', 'b8c6']);
    expect(ev.pv[0]).toBe('e7e5'); // pv[0] from a post-move position = the opponent's refutation
    expect(ev.bestMoveUci).toBe('e7e5');
  });
});
