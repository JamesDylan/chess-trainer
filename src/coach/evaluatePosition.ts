// Stage 5 — the single-position eval helper that bridges the engine to the live
// coach. It is the live twin of one iteration of the analyzer's per-position loop:
// search a FEN at a fixed depth through the EXISTING UciEngine seam, then read the
// score + principal variation off `engine.lastInfo` (which already carries both) and
// the best move off the returned `bestmove`. It does NOT fork the analyzer's math —
// the White-POV win% is computed with `scoreToWinPercent` VERBATIM.
//
// It talks to the structural `AnalysisEngine` slice (the real UciEngine satisfies it
// unchanged, and the scripted fake satisfies it in tests), so this helper is
// engine-agnostic and unit-testable without WASM. The CALLER configures full
// strength once (limitStrength:false, skillLevel:20) before using it.

import type { Score } from '../core/types';
import { scoreToWinPercent } from '../core/evalMath';
import type { AnalysisEngine } from '../analysis/types';

/** One position's full-strength evaluation, ready for the eval bar + live feedback. */
export interface PositionEvaluation {
  /** Engine score, side-to-move POV (exactly as the analyzer records it). */
  score: Score;
  /** Win% in WHITE's POV (for the eval bar), in [0,100]. */
  winWhite: number;
  /** The engine's best move at this position, as UCI. */
  bestMoveUci: string;
  /** The engine's principal variation at this position, as UCI moves (may be empty). */
  pv: string[];
}

/**
 * Search `fen` at `depth` and return its score, White-POV win%, best move and PV.
 *
 * Reuses `UciEngine.bestMove()` + `engine.lastInfo` (the analyzer's exact read path)
 * and `scoreToWinPercent` for the bar mapping, so a live eval and the post-game
 * analysis of the same position agree. Engine score is side-to-move POV; this flips
 * it to White's POV using the side-to-move field of the FEN.
 */
export async function evaluatePosition(
  fen: string,
  engine: AnalysisEngine,
  depth: number,
): Promise<PositionEvaluation> {
  const { best } = await engine.bestMove({ fen }, { depth });
  // Stockfish always emits at least one scored info line before bestmove; fall back
  // to an even score / empty PV if a search somehow returned none (mirrors analyzer).
  const score: Score = engine.lastInfo?.score ?? { cp: 0 };
  const pv: string[] = engine.lastInfo?.pv ?? [];

  const whiteToMove = fen.split(' ')[1] !== 'b';
  const winStm = scoreToWinPercent(score);
  const winWhite = whiteToMove ? winStm : 100 - winStm;

  return { score, winWhite, bestMoveUci: best, pv };
}
