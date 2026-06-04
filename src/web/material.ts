// Material tally derived from a FEN: which pieces each side has captured, and the
// point advantage. Pure and position-based, so it works for the live game AND any
// position you navigate to during review.
//
// Note: captured counts are computed by diffing the board against the starting
// army, so an (uncommon) pawn promotion can make them approximate. The advantage
// is derived from the same diff, so the number and the icons stay consistent.

import type { Side } from './boardView';

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q';
export type CapturedCount = Record<PieceType, number>;

export interface MaterialTally {
  /** Black pieces captured by White. */
  white: CapturedCount;
  /** White pieces captured by Black. */
  black: CapturedCount;
  /** Point advantage from White's POV (+ = White ahead). p1 n3 b3 r5 q9. */
  advantage: number;
}

const START: CapturedCount = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
export const PIECE_TYPES: PieceType[] = ['p', 'n', 'b', 'r', 'q'];

export function materialFromFen(fen: string): MaterialTally {
  const placement = fen.split(' ')[0];
  const live: Record<string, number> = { P: 0, N: 0, B: 0, R: 0, Q: 0, p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const ch of placement) {
    if (ch in live) live[ch] += 1;
  }
  const white = {} as CapturedCount; // black pieces White has captured
  const black = {} as CapturedCount; // white pieces Black has captured
  for (const t of PIECE_TYPES) {
    white[t] = Math.max(0, START[t] - live[t]);
    black[t] = Math.max(0, START[t] - live[t.toUpperCase()]);
  }
  const value = (c: CapturedCount): number => PIECE_TYPES.reduce((sum, t) => sum + c[t] * VALUE[t], 0);
  return { white, black, advantage: value(white) - value(black) };
}

/** The pieces `side` has captured (the opponent's lost pieces). */
export function capturedBy(tally: MaterialTally, side: Side): CapturedCount {
  return side === 'white' ? tally.white : tally.black;
}

/** Point lead for `side` (negative if behind). */
export function advantageFor(tally: MaterialTally, side: Side): number {
  return side === 'white' ? tally.advantage : -tally.advantage;
}
