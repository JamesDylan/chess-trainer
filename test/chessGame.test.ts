import { describe, it, expect } from 'vitest';
import { ChessGame } from '../src/index';

describe('ChessGame', () => {
  it('starts with 20 legal moves and white to move', () => {
    const g = new ChessGame();
    expect(g.turn()).toBe('white');
    expect(g.legalMoves().length).toBe(20);
    expect(g.isGameOver()).toBe(false);
    expect(g.result()).toBe('*');
  });

  it('applies both SAN and UCI moves', () => {
    const g = new ChessGame();
    expect(g.move('e4')).toBe(true); // SAN
    expect(g.turn()).toBe('black');
    expect(g.move('e7e5')).toBe(true); // UCI
    expect(g.history()).toEqual(['e4', 'e5']);
  });

  it('rejects illegal moves without changing state', () => {
    const g = new ChessGame();
    expect(g.move('e5')).toBe(false); // illegal from the start position
    expect(g.turn()).toBe('white');
    expect(g.legalMoves().length).toBe(20);
  });

  it("detects checkmate and a White win (Scholar's mate)", () => {
    const g = new ChessGame();
    for (const m of ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']) {
      expect(g.move(m)).toBe(true);
    }
    expect(g.isCheckmate()).toBe(true);
    expect(g.isGameOver()).toBe(true);
    expect(g.result()).toBe('1-0');
  });

  it('loads a PGN', () => {
    const g = new ChessGame();
    g.loadPgn('1. e4 e5 2. Nf3 Nc6 *');
    expect(g.history()).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(g.turn()).toBe('white');
  });

  it('starts from a FEN', () => {
    const g = new ChessGame('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1');
    expect(g.turn()).toBe('black');
  });
});
