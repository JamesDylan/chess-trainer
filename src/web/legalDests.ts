// View-only helper: turn a FEN into the data chessground needs to offer legal
// moves — the per-origin destination map, a promotion test, and a check flag.
//
// WHY chess.js directly here (and not ChessGame): ChessGame is the single source of
// truth for game STATE (applying moves, detecting game-over, PGN). This is a
// presentation concern — the board's legal-move overlay — that ChessGame doesn't
// expose, and the Stage 1 rules say not to change core signatures. We recompute
// from `game.fen()` every turn, so the board and ChessGame are always derived from
// the same position and cannot drift. chess.js is already a dependency.

import { Chess } from 'chess.js';

export interface MoveMap {
  /** Origin square -> legal destination squares (deduped). Feeds movable.dests. */
  dests: Map<string, string[]>;
  /** True if moving from->to is a pawn promotion (the UI must then pick a piece). */
  isPromotion(from: string, to: string): boolean;
  /** True if the side to move is in check (for the board's check highlight). */
  inCheck: boolean;
}

export function computeMoves(fen: string): MoveMap {
  const chess = new Chess(fen);
  const dests = new Map<string, string[]>();
  const promotions = new Set<string>();

  for (const move of chess.moves({ verbose: true })) {
    const tos = dests.get(move.from);
    if (tos) {
      if (!tos.includes(move.to)) tos.push(move.to);
    } else {
      dests.set(move.from, [move.to]);
    }
    if (move.promotion) promotions.add(move.from + move.to);
  }

  // chess.js named this `inCheck()` in v1; older shims used `isCheck()`. Resolve
  // whichever exists without coupling to one spelling.
  const c = chess as unknown as { inCheck?: () => boolean; isCheck?: () => boolean };
  const inCheck = c.inCheck?.() ?? c.isCheck?.() ?? false;

  return {
    dests,
    isPromotion: (from, to) => promotions.has(from + to),
    inCheck,
  };
}
