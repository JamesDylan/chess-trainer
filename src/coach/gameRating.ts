// Stage 5 — a classic Elo "playing rating" from your results vs the engine.
//
// The puzzle rating uses Glicko-2 (rated games vs known-rated puzzles). Full games are
// rated with the plain Elo update most players know: start from a seed, and after each
// finished game move toward/away from the bot's rating by K·(score − expected). Beating a
// stronger bot gains more than beating a weaker one; losing to a weaker bot costs more.
// Pure + deterministic (no Date.now / RNG): the same game history always yields the same
// rating, so it can be derived live on the Progress tab with no extra persistence.
//
//   E = 1 / (1 + 10^((opponent − current) / 400))      (expected score)
//   S = 1 win / 0.5 draw / 0 loss                       (actual score, user POV)
//   rating ← rating + K·(S − E)
//
// NOTE: the engine's "Elo" is CCRL-anchored, not human (REFERENCE §3), so this rating is
// "where you stand on the engine ladder", which reads lower than a puzzle rating and is a
// more honest proxy for playing strength.

import type { GameResult, Color } from '../core/types';
import type { GameRatingRecord, GameRating } from './types';

/** Seed rating for a brand-new player (an arbitrary, conventional starting point). */
export const GAME_RATING_SEED = 800;

/** Elo K-factor: how much one game moves the rating. FIDE uses 10–40; 32 is a lively default. */
export const GAME_RATING_K = 32;

/** Below this many rated games the rating is still settling from the seed → "provisional". */
export const GAME_RATING_PROVISIONAL_GAMES = 10;

/**
 * Fraction of a WIN's rating gain kept when the user took a move back during the game
 * (0.25 = a takeback win is worth a quarter of the points). Undoing to fix a mistake isn't
 * your true skill, so the gain is discounted; losses and draws are unaffected. */
export const GAME_RATING_UNDO_WIN_RETENTION = 0.25;

/** Classic Elo expected score for `current` vs `opponent` (probability of scoring 1). */
export function expectedScore(current: number, opponent: number): number {
  return 1 / (1 + Math.pow(10, (opponent - current) / 400));
}

/** The user's score for a finished game (1 win / 0.5 draw / 0 loss); null if unfinished. */
export function gameScore(result: GameResult, humanColor: Color): number | null {
  if (result === '1/2-1/2') return 0.5;
  if (result === '1-0') return humanColor === 'white' ? 1 : 0;
  if (result === '0-1') return humanColor === 'black' ? 1 : 0;
  return null; // '*' — unfinished / aborted, not rated
}

/**
 * Fold a classic Elo update over finished games in time order (oldest first), each as one
 * game vs an opponent at the bot's `strengthElo`. Unfinished games are ignored.
 */
export function computeGameRating(
  records: readonly GameRatingRecord[],
  opts: { seed?: number; k?: number; undoWinRetention?: number } = {},
): GameRating {
  const seed = opts.seed ?? GAME_RATING_SEED;
  const k = opts.k ?? GAME_RATING_K;
  const undoWinRetention = opts.undoWinRetention ?? GAME_RATING_UNDO_WIN_RETENTION;
  const sorted = [...records].sort((a, b) => a.playedAt - b.playedAt);

  let rating = seed;
  let games = 0;
  const series: { at: number; rating: number }[] = [];
  for (const r of sorted) {
    const s = gameScore(r.result, r.humanColor);
    if (s === null) continue;
    let delta = k * (s - expectedScore(rating, r.strengthElo));
    // A win after taking a move back isn't your true skill: keep only a fraction of the
    // gain. Losses and draws (delta ≤ 0 or neutral) are applied in full.
    if (r.undoUsed && s === 1) delta *= undoWinRetention;
    rating += delta;
    games += 1;
    series.push({ at: r.playedAt, rating: Math.round(rating) });
  }

  return {
    value: Math.round(rating),
    games,
    provisional: games < GAME_RATING_PROVISIONAL_GAMES,
    series,
  };
}
