// OpeningBook: a position-keyed opening dictionary + deepest-match detection.
//
// Each opening line is replayed once (via ChessGame — the single chess.js seam) to its
// position key (EPD = the first four FEN fields: placement, side-to-move, castling, en
// passant — counters dropped so it matches regardless of move count). Detection replays
// a game and returns the DEEPEST named position it reaches, so transpositions and
// stop-short games still get named at the most specific known point. Pure + deterministic;
// no engine, no DOM.

import { ChessGame } from '../core/chessGame';
import type { DetectedOpening, OpeningDef, OpeningId } from './types';

/** Don't scan past this ply for an opening name (openings are an early-game concept). */
export const MAX_DETECT_PLY = 40;

/** Position key: the first four FEN fields (drop the halfmove/fullmove counters). */
export function epdOf(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export class OpeningBook {
  private readonly byEpd = new Map<string, OpeningId>();
  /** Lines that failed to build (illegal SAN, or a position already claimed). */
  readonly skipped: string[] = [];

  constructor(defs: Iterable<OpeningDef>) {
    for (const def of defs) {
      const sans = def.moves.trim().split(/\s+/).filter(Boolean);
      const game = new ChessGame();
      let legal = true;
      for (const san of sans) {
        if (!game.move(san)) {
          legal = false;
          break;
        }
      }
      if (!legal || sans.length === 0) {
        this.skipped.push(def.name);
        continue;
      }
      const epd = epdOf(game.fen());
      // First definition to claim a position wins (keeps detection deterministic and
      // lets broader/earlier rows take precedence over later duplicates).
      if (this.byEpd.has(epd)) {
        this.skipped.push(def.name);
        continue;
      }
      this.byEpd.set(epd, { eco: def.eco, name: def.name });
    }
  }

  /** Number of distinct positions in the book. */
  get size(): number {
    return this.byEpd.size;
  }

  /** Deepest named opening reached by a SAN move list, or undefined if none match. */
  detectFromSans(sans: readonly string[]): DetectedOpening | undefined {
    const game = new ChessGame();
    let best: DetectedOpening | undefined;
    const n = Math.min(sans.length, MAX_DETECT_PLY);
    for (let i = 0; i < n; i += 1) {
      if (!game.move(sans[i])) break; // stop at the first illegal move
      const hit = this.byEpd.get(epdOf(game.fen()));
      if (hit) best = { ...hit, ply: i + 1 };
    }
    return best;
  }

  /** Deepest named opening for a PGN, or undefined if it can't be parsed / matched. */
  detectFromPgn(pgn: string): DetectedOpening | undefined {
    let sans: string[];
    try {
      const game = new ChessGame();
      game.loadPgn(pgn);
      sans = game.history();
    } catch {
      return undefined;
    }
    return this.detectFromSans(sans);
  }
}
