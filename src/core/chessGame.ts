// A thin, typed wrapper over chess.js so the rest of the app never touches chess.js directly.

import { Chess } from 'chess.js';
import type { Color, GameResult } from './types';

export class ChessGame {
  private c: Chess;

  constructor(fen?: string) {
    this.c = fen ? new Chess(fen) : new Chess();
  }

  /** Apply a move given as SAN ('Nf3') or UCI ('g1f3', 'e7e8q'). Returns true if legal+applied. */
  move(m: string): boolean {
    const isUci = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m);
    try {
      if (isUci) {
        const from = m.slice(0, 2);
        const to = m.slice(2, 4);
        const promotion = m.length === 5 ? m[4] : undefined;
        this.c.move(promotion ? { from, to, promotion } : { from, to });
      } else {
        this.c.move(m);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Take back the last half-move (ply). Returns true if a move was undone. */
  undo(): boolean {
    return this.c.undo() !== null;
  }

  legalMoves(): string[] {
    return this.c.moves();
  }

  fen(): string {
    return this.c.fen();
  }

  turn(): Color {
    return this.c.turn() === 'w' ? 'white' : 'black';
  }

  isGameOver(): boolean {
    return this.c.isGameOver();
  }

  isCheckmate(): boolean {
    return this.c.isCheckmate();
  }

  /** '1-0' / '0-1' / '1/2-1/2' if over, else '*'. (On checkmate, the side to move has lost.) */
  result(): GameResult {
    if (this.c.isCheckmate()) return this.c.turn() === 'w' ? '0-1' : '1-0';
    if (this.c.isGameOver()) return '1/2-1/2';
    return '*';
  }

  history(): string[] {
    return this.c.history();
  }

  loadPgn(pgn: string): void {
    this.c.loadPgn(pgn);
  }

  pgn(): string {
    return this.c.pgn();
  }
}
