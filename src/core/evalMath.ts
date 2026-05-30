// Evaluation math: centipawns -> win% -> accuracy% -> move classification.
// Formulas/constants are documented in docs/REFERENCE.md (Lichess-derived).
//
// TODO(agent): implement every function below. Do NOT change signatures.
// Use ONLY the constants/formulas in docs/REFERENCE.md. Do NOT modify the tests.

import type { Score, MoveClass } from './types';

/** The logistic steepness constant from Lichess eval.scala. */
export const WIN_PERCENT_K = -0.00368208;

/** Centipawn ceiling: cp is clamped to +/- this before converting to win% (mate excluded). */
export const CP_CEILING = 1000;

/** Win% accuracy curve constants (Lichess AccuracyPercent). */
export const ACC_A = 103.1668;
export const ACC_B = -0.04354;
export const ACC_C = 3.1669;

/**
 * Move classification thresholds, expressed as WIN% DROP (mover POV, 0..100).
 * A move's drop d = winBefore - winAfter. Lower band wins:
 *   d < best       -> 'best'
 *   d < excellent  -> 'excellent'
 *   d < good       -> 'good'
 *   d < inaccuracy -> 'inaccuracy'
 *   d < mistake    -> 'mistake'
 *   else           -> 'blunder'
 * The inaccuracy/mistake/blunder edges (5/10/15) equal Lichess's 0.10/0.20/0.30
 * winning-chances thresholds (winChances drop * 50 = win% drop). Tunable.
 */
export const CLASSIFICATION_THRESHOLDS = {
  best: 1,
  excellent: 3,
  good: 5,
  inaccuracy: 10,
  mistake: 15,
} as const;

/** Convert a centipawn eval (side-to-move POV) to win% in [0, 100]. Clamp cp to +/- CP_CEILING. */
export function cpToWinPercent(cp: number): number {
  const clampedCp = Math.max(-CP_CEILING, Math.min(CP_CEILING, cp));
  return 50 + 50 * (2 / (1 + Math.exp(WIN_PERCENT_K * clampedCp)) - 1);
}

/**
 * Convert a UCI Score (cp or mate) to win% in [0, 100].
 * For mate scores use the cp-equivalent (21 - min(10, |mate|)) * 100 * sign(mate)
 * fed through the SAME logistic but WITHOUT the CP_CEILING clamp (so closer mates score higher).
 */
export function scoreToWinPercent(score: Score): number {
  if (score.cp !== undefined) {
    return cpToWinPercent(score.cp);
  } else if (score.mate !== undefined) {
    const cpEq = Math.sign(score.mate) * (21 - Math.min(10, Math.abs(score.mate))) * 100;
    return 50 + 50 * (2 / (1 + Math.exp(WIN_PERCENT_K * cpEq)) - 1);
  }
  throw new Error('Invalid score');
}

/**
 * Per-move accuracy% in [0, 100] from the mover's win% before and after their move.
 * If winAfter >= winBefore, accuracy is 100. Otherwise:
 *   d = winBefore - winAfter
 *   raw = ACC_A * exp(ACC_B * d) - ACC_C
 *   return clamp(raw, 0, 100)
 */
export function winPercentToAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) {
    return 100;
  } else {
    const d = winBefore - winAfter;
    const raw = ACC_A * Math.exp(ACC_B * d) - ACC_C;
    return Math.max(0, Math.min(100, raw));
  }
}

/** Classify a move by its win% drop (mover POV) using CLASSIFICATION_THRESHOLDS. */
export function classifyMove(winBefore: number, winAfter: number): MoveClass {
  const d = winBefore - winAfter;
  if (d < CLASSIFICATION_THRESHOLDS.best) return 'best';
  if (d < CLASSIFICATION_THRESHOLDS.excellent) return 'excellent';
  if (d < CLASSIFICATION_THRESHOLDS.good) return 'good';
  if (d < CLASSIFICATION_THRESHOLDS.inaccuracy) return 'inaccuracy';
  if (d < CLASSIFICATION_THRESHOLDS.mistake) return 'mistake';
  return 'blunder';
}

/** Average centipawn loss. `losses` are per-move cp losses (>= 0). Empty -> 0. */
export function averageCentipawnLoss(losses: number[]): number {
  if (losses.length === 0) return 0;
  const sum = losses.reduce((acc, loss) => acc + loss, 0);
  return sum / losses.length;
}

/** Harmonic mean of positive numbers. Empty -> 0. (Used later for game accuracy.) */
export function harmonicMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sumOfReciprocals = values.reduce((acc, value) => acc + 1 / value, 0);
  return values.length / sumOfReciprocals;
}
