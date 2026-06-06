// Stage 5 — the PURE live-coaching core (engine-less, DOM-less, deterministic).
//
// This is the live counterpart to the Stage 2 analyzer's per-move math. Given the
// engine's score BEFORE and AFTER one move (plus the engine's best move at the
// pre-move position and the engine's principal variation at the post-move
// position), it produces the same win%/accuracy/classification the analysis view
// shows — REUSING src/core/evalMath.ts VERBATIM, never re-deriving a formula — and
// adds the two things a *live* coach needs that a post-game report doesn't:
//
//   - refutationUci  — the opponent's punishing reply (the PV's first move from the
//                      post-move position), so a blunder's "why" can be drawn as a
//                      red arrow even when the cost only lands a move or two later.
//   - missedOpportunity — a flag that the pre-move position was a forced mate or a
//                      decisive advantage that this move gave a meaningful chunk
//                      back, so the coach can say "you had a chance to …" and offer
//                      a retry even when the move played was not itself a blunder.
//
// POV conventions (identical to the analyzer, see docs/SPEC-stage2.md):
//   - scoreBefore is the engine score of the PRE-move position; its side to move IS
//     the mover, so winBefore = scoreToWinPercent(scoreBefore) is already mover POV.
//   - scoreAfter is the engine score of the POST-move position; its side to move is
//     the OPPONENT, so the mover's winAfter = 100 - scoreToWinPercent(scoreAfter).
//   - cpLoss is mover POV and reuses the analyzer's bounded-cp helper VERBATIM.

import type { Color, MoveClass, Score } from '../core/types';
import { scoreToWinPercent, winPercentToAccuracy, classifyMove } from '../core/evalMath';
import { centipawnLoss } from '../analysis/analyzer';

/**
 * Below this per-move accuracy% the coach surfaces the engine's best move (the
 * green arrow + "Best: <SAN>"), and — when the pre-move position was already
 * winning/mating — treats the move as having "given a meaningful chunk back".
 * Tunable, in the spirit of evalMath's CLASSIFICATION_THRESHOLDS. The BLUNDER
 * cutoff itself is reused from evalMath's CLASSIFICATION_THRESHOLDS via classifyMove.
 */
export const COACH_BESTMOVE_ACCURACY = 90;

/**
 * Pre-move centipawn advantage (mover POV) at/above which the position counts as a
 * DECISIVE (winning) advantage for the "missed a winning chance" flag. +3.00 pawns.
 */
export const COACH_WINNING_CP = 300;

/** Why a move is flagged as a missed opportunity (drives the "you had a chance …" line). */
export type MissedOpportunity = 'mate' | 'winning';

/** The full live feedback for one move. All win% values are MOVER POV. */
export interface LiveMoveFeedback {
  /** Mover-POV win% before the move = scoreToWinPercent(scoreBefore). */
  winBefore: number;
  /** Mover-POV win% after the move = 100 - scoreToWinPercent(scoreAfter). */
  winAfter: number;
  /** Mover-POV centipawn loss (>= 0), shared with the analyzer's ACPL convention. */
  cpLoss: number;
  /** Per-move accuracy% in [0,100] from winPercentToAccuracy(winBefore, winAfter). */
  accuracy: number;
  /** Move-quality label from classifyMove(winBefore, winAfter). */
  classification: MoveClass;
  /** The engine's best move at the PRE-move position (UCI), for the green "Best" arrow. */
  bestMoveUci?: string;
  /**
   * The opponent's punishing reply — the FIRST move of the post-move PV — set only
   * when this move was a `blunder` (the red "why" arrow). undefined otherwise.
   */
  refutationUci?: string;
  /**
   * The post-move principal variation (UCI moves, opponent to move first), exposed
   * so the UI can optionally step through how the punishment unfolds. [] if none.
   */
  refutationLine: string[];
  /**
   * Set when the PRE-move position was a forced mate (`'mate'`) or a decisive
   * advantage (`'winning'`) for the mover but this move gave a meaningful chunk back
   * (accuracy < COACH_BESTMOVE_ACCURACY). Independent of `classification`, so a
   * still-winning-but-not-best move is flagged even though it isn't a "??".
   */
  missedOpportunity?: MissedOpportunity;
}

/** Tunable thresholds for one `liveMoveFeedback` call (defaults match the consts above). */
export interface LiveFeedbackOptions {
  /** Accuracy% below which a move "slipped" (best-move surfaced / chunk-given-back). */
  bestMoveAccuracy?: number;
  /** Pre-move mover-POV cp at/above which the position is a decisive (winning) advantage. */
  winningCp?: number;
}

/**
 * Pure per-move live feedback. Deterministic: identical scores/PV in → identical out.
 *
 * @param scoreBefore engine score of the pre-move position (side to move = the mover)
 * @param scoreAfter  engine score of the post-move position (side to move = opponent)
 * @param bestMoveUci engine's best move at the pre-move position (passed through)
 * @param pv          engine's principal variation at the POST-move position (opponent first)
 * @param mover       the side that played the move (accepted for call-site clarity; the
 *                    score POV conventions already encode it, so the math needs no flip)
 */
export function liveMoveFeedback(
  scoreBefore: Score,
  scoreAfter: Score,
  bestMoveUci: string | undefined,
  pv: string[],
  mover: Color,
  opts: LiveFeedbackOptions = {},
): LiveMoveFeedback {
  void mover; // POV is encoded by the score conventions above; param kept for clarity.
  const bestMoveAccuracy = opts.bestMoveAccuracy ?? COACH_BESTMOVE_ACCURACY;
  const winningCp = opts.winningCp ?? COACH_WINNING_CP;

  const winBefore = scoreToWinPercent(scoreBefore);
  const winAfter = 100 - scoreToWinPercent(scoreAfter);
  const accuracy = winPercentToAccuracy(winBefore, winAfter);
  const classification = classifyMove(winBefore, winAfter);
  // Reuse the analyzer's bounded mover-POV cp loss VERBATIM (non-terminal here).
  const cpLoss = centipawnLoss(scoreBefore, scoreAfter, undefined);

  const refutationLine = pv ?? [];
  const refutationUci =
    classification === 'blunder' && refutationLine.length > 0 ? refutationLine[0] : undefined;

  // A move "slipped" when it gave back enough to drop below the best-move accuracy
  // bar. If the pre-move position was already winning/mating, that slip is a missed
  // opportunity — flagged regardless of whether the move reached "blunder".
  let missedOpportunity: MissedOpportunity | undefined;
  if (accuracy < bestMoveAccuracy) {
    if (scoreBefore.mate !== undefined && scoreBefore.mate > 0) {
      missedOpportunity = 'mate';
    } else if (scoreBefore.cp !== undefined && scoreBefore.cp >= winningCp) {
      missedOpportunity = 'winning';
    }
  }

  return {
    winBefore,
    winAfter,
    cpLoss,
    accuracy,
    classification,
    bestMoveUci,
    refutationUci,
    refutationLine,
    missedOpportunity,
  };
}

/** Whether the coach should surface the engine's best move for this feedback (sub-bar accuracy). */
export function shouldShowBestMove(
  fb: LiveMoveFeedback,
  bestMoveAccuracy: number = COACH_BESTMOVE_ACCURACY,
): boolean {
  return fb.bestMoveUci !== undefined && fb.accuracy < bestMoveAccuracy;
}
