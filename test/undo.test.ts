// Tests for ChessGame.undo() — the primitive the controller's "take back my last
// move" (opponent reply + own move) is built on. Pure (chess.js), no engine.

import { describe, it, expect } from 'vitest';
import { ChessGame } from '../src/core/chessGame';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('ChessGame.undo', () => {
  it('takes back the last half-move and restores turn/fen/history', () => {
    const g = new ChessGame();
    g.move('e4');
    g.move('e5');
    expect(g.history()).toEqual(['e4', 'e5']);
    expect(g.turn()).toBe('white');

    expect(g.undo()).toBe(true);
    expect(g.history()).toEqual(['e4']);
    expect(g.turn()).toBe('black');

    expect(g.undo()).toBe(true);
    expect(g.history()).toEqual([]);
    expect(g.turn()).toBe('white');
    expect(g.fen()).toBe(START);
  });

  it('returns false when there is nothing to undo', () => {
    const g = new ChessGame();
    expect(g.undo()).toBe(false);
    expect(g.fen()).toBe(START);
  });

  it('two plies back returns to the players turn so a different move is possible', () => {
    // White (human) plays a dubious move, Black (engine) replies; take back both,
    // then White plays something else — exactly the "undo my blunder" flow.
    const g = new ChessGame();
    g.move('e4');
    g.move('e5');
    g.move('Qh5'); // White's move to take back
    g.move('Nc6'); // Black's reply
    expect(g.turn()).toBe('white');

    expect(g.undo()).toBe(true); // remove Nc6
    expect(g.undo()).toBe(true); // remove Qh5
    expect(g.history()).toEqual(['e4', 'e5']);
    expect(g.turn()).toBe('white');

    expect(g.move('Nf3')).toBe(true); // a different, legal move
    expect(g.history()).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('undo after checkmate reopens the game', () => {
    const g = new ChessGame();
    g.move('f3');
    g.move('e5');
    g.move('g4');
    g.move('Qh4'); // Qh4# — Fools mate
    expect(g.isGameOver()).toBe(true);
    expect(g.isCheckmate()).toBe(true);

    expect(g.undo()).toBe(true); // take back the mating move
    expect(g.isGameOver()).toBe(false);
    expect(g.turn()).toBe('black'); // Black to move again
  });
});
