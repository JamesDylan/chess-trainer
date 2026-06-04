// Tests for materialFromFen — the captured-piece tally + point advantage shown
// above and below the board. Pure (FEN parsing), no engine.

import { describe, it, expect } from 'vitest';
import { materialFromFen, capturedBy, advantageFor } from '../src/web/material';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('materialFromFen', () => {
  it('reports no captures and no advantage at the start', () => {
    const m = materialFromFen(START);
    expect(m.advantage).toBe(0);
    expect(capturedBy(m, 'white')).toEqual({ p: 0, n: 0, b: 0, r: 0, q: 0 });
    expect(capturedBy(m, 'black')).toEqual({ p: 0, n: 0, b: 0, r: 0, q: 0 });
  });

  it('counts captured pieces and the point advantage (White POV)', () => {
    // Black is missing one pawn (White captured it); White is missing one knight.
    const fen = 'rnbqkbnr/ppppppp1/8/8/8/8/PPPPPPPP/R1BQKBNR w KQkq - 0 1';
    const m = materialFromFen(fen);
    expect(capturedBy(m, 'white').p).toBe(1); // White took a pawn
    expect(capturedBy(m, 'black').n).toBe(1); // Black took a knight
    expect(m.advantage).toBe(-2); // +1 (pawn) − 3 (knight)
    expect(advantageFor(m, 'white')).toBe(-2);
    expect(advantageFor(m, 'black')).toBe(2);
  });

  it('uses values p1 n3 b3 r5 q9', () => {
    // Black is missing one rook (White is up the exchange-and-then-some: +5).
    const fen = '1nbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const m = materialFromFen(fen);
    expect(capturedBy(m, 'white').r).toBe(1);
    expect(m.advantage).toBe(5);
    expect(advantageFor(m, 'black')).toBe(-5);
  });
});
