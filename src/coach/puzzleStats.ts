// Pure aggregations over the puzzle attempt log (PuzzleAttempt[]). No engine, no DOM,
// no recomputation of ratings — the Glicko-2 maths already ran in PuzzleController and
// each attempt carries its post-attempt rating/RD; we only AGGREGATE. Reuses
// src/core/rating's seed/established notion at the snapshot level (see coach.ts).

import type { PuzzleAttempt } from '../puzzles/types';
import type { Confidence, PuzzleStats, RatingBandStat, RatingPoint, ThemeStat } from './types';
import { COACH_THRESHOLDS } from './thresholds';

const BAND_SIZE = 200;

/** Attempts sorted oldest-first by timestamp (stable; the log is already ordered, but
 *  callers may pass an arbitrary array, e.g. in tests). */
function chronological(attempts: PuzzleAttempt[]): PuzzleAttempt[] {
  return attempts.map((a, i) => [a, i] as const)
    .sort((x, y) => x[0].at - y[0].at || x[1] - y[1])
    .map(([a]) => a);
}

/** Rating after each attempt (oldest first) — the curve the chart draws. */
export function ratingSeries(attempts: PuzzleAttempt[]): RatingPoint[] {
  return chronological(attempts).map((a) => ({ at: a.at, rating: a.ratingAfter, rd: a.rdAfter }));
}

/** Overall solve rate (fraction 0..1). Empty → 0. */
export function overallSolveRate(attempts: PuzzleAttempt[]): number {
  if (attempts.length === 0) return 0;
  return attempts.filter((a) => a.solved).length / attempts.length;
}

function themeConfidence(attempts: number): Confidence {
  if (attempts < COACH_THRESHOLDS.minThemeAttempts) return 'low';
  if (attempts >= COACH_THRESHOLDS.highConfidenceThemeAttempts) return 'high';
  return 'medium';
}

/**
 * Per-theme solve performance, WORST solve-rate first. An attempt contributes to every
 * one of its themes. Includes low-sample rows (flagged `confidence: 'low'`); callers
 * that rank weaknesses must apply the min-sample threshold (see `weakestThemes`).
 * Tie-break: more attempts first (more evidence), then theme name (deterministic).
 */
export function themeStats(attempts: PuzzleAttempt[]): ThemeStat[] {
  const tally = new Map<string, { attempts: number; solved: number }>();
  for (const a of attempts) {
    for (const theme of a.themes ?? []) {
      const e = tally.get(theme) ?? { attempts: 0, solved: 0 };
      e.attempts += 1;
      if (a.solved) e.solved += 1;
      tally.set(theme, e);
    }
  }
  const stats: ThemeStat[] = [...tally.entries()].map(([theme, e]) => ({
    theme,
    attempts: e.attempts,
    solved: e.solved,
    solveRate: e.solved / e.attempts,
    confidence: themeConfidence(e.attempts),
  }));
  stats.sort(
    (x, y) =>
      x.solveRate - y.solveRate || y.attempts - x.attempts || x.theme.localeCompare(y.theme),
  );
  return stats;
}

/**
 * Themes ranked weakest-first, but ONLY those with enough attempts to trust
 * (>= COACH_THRESHOLDS.minThemeAttempts) — so a 0/1 fluke never tops the weakness list.
 */
export function weakestThemes(attempts: PuzzleAttempt[], limit = Number.POSITIVE_INFINITY): ThemeStat[] {
  return themeStats(attempts)
    .filter((t) => t.attempts >= COACH_THRESHOLDS.minThemeAttempts)
    .slice(0, limit);
}

/** Solve performance per 200-point puzzle rating band, ascending by band. */
export function bandStats(attempts: PuzzleAttempt[]): RatingBandStat[] {
  const tally = new Map<number, { attempts: number; solved: number }>();
  for (const a of attempts) {
    const lo = Math.floor(a.puzzleRating / BAND_SIZE) * BAND_SIZE;
    const e = tally.get(lo) ?? { attempts: 0, solved: 0 };
    e.attempts += 1;
    if (a.solved) e.solved += 1;
    tally.set(lo, e);
  }
  return [...tally.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([lo, e]) => ({
      lo,
      hi: lo + BAND_SIZE - 1,
      label: `${lo}–${lo + BAND_SIZE - 1}`,
      attempts: e.attempts,
      solved: e.solved,
      solveRate: e.solved / e.attempts,
    }));
}

/** Current (trailing) + best (longest) run of consecutive solves. */
export function streaks(attempts: PuzzleAttempt[]): { current: number; best: number } {
  const ordered = chronological(attempts);
  let best = 0;
  let run = 0;
  for (const a of ordered) {
    if (a.solved) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  let current = 0;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (ordered[i].solved) current += 1;
    else break;
  }
  return { current, best };
}

/** Full puzzle-side stats bundle. Handles an empty log without throwing. */
export function computePuzzleStats(attempts: PuzzleAttempt[]): PuzzleStats {
  const solved = attempts.filter((a) => a.solved).length;
  const { current, best } = streaks(attempts);
  return {
    totalAttempts: attempts.length,
    solved,
    failed: attempts.length - solved,
    solveRate: overallSolveRate(attempts),
    currentStreak: current,
    bestStreak: best,
    ratingSeries: ratingSeries(attempts),
    themes: themeStats(attempts),
    bands: bandStats(attempts),
  };
}
