// Unit tests for the view-only fen -> chessground dests helper.

import { describe, it, expect } from 'vitest';
import { computeMoves } from '../src/web/legalDests';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function totalDests(dests: Map<string, string[]>): number {
  let n = 0;
  for (const tos of dests.values()) n += tos.length;
  return n;
}

describe('computeMoves', () => {
  it('start position: 10 movable origins, 20 legal moves, no promotions, not in check', () => {
    const { dests, isPromotion, inCheck } = computeMoves(START);
    expect(dests.size).toBe(10); // 8 pawns + 2 knights
    expect(totalDests(dests)).toBe(20);
    expect(dests.get('e2')).toEqual(expect.arrayContaining(['e3', 'e4']));
    expect(dests.get('g1')).toEqual(expect.arrayContaining(['f3', 'h3']));
    expect(isPromotion('e2', 'e4')).toBe(false);
    expect(inCheck).toBe(false);
  });

  it('flags pawn promotions as promotions (deduped to a single destination)', () => {
    const fen = '7k/4P3/8/8/8/8/8/7K w - - 0 1';
    const { dests, isPromotion } = computeMoves(fen);
    // e7->e8 appears once in dests even though chess.js lists q/r/b/n separately.
    expect(dests.get('e7')).toEqual(['e8']);
    expect(isPromotion('e7', 'e8')).toBe(true);
    expect(isPromotion('h1', 'h2')).toBe(false);
  });

  it('reports check and omits king moves that stay in check', () => {
    const fen = '4r2k/8/8/8/8/8/8/4K3 w - - 0 1'; // white king on e-file, black rook checks
    const { dests, inCheck } = computeMoves(fen);
    expect(inCheck).toBe(true);
    // Moving to e2 stays on the checked file, so it must NOT be offered.
    expect(dests.get('e1') ?? []).not.toContain('e2');
    expect(dests.get('e1') ?? []).toEqual(expect.arrayContaining(['d1', 'f1', 'd2', 'f2']));
  });
});
