// Tests for the classic-Elo playing rating (Stage 5 follow-up). Pure + deterministic:
// seed 800, NewElo = cur + K·(S − E), E = 1/(1+10^((opp−cur)/400)), opponent = engine
// strength, S from result + the side the human played. Beating a stronger bot gains more
// than beating a weaker one; unfinished games don't count; games are folded oldest-first.

import { describe, it, expect } from 'vitest';
import {
  computeGameRating,
  expectedScore,
  gameScore,
  GAME_RATING_SEED,
  GAME_RATING_K,
  GAME_RATING_PROVISIONAL_GAMES,
} from '../src/coach/gameRating';
import type { GameRatingRecord } from '../src/coach/types';

const rec = (over: Partial<GameRatingRecord> = {}): GameRatingRecord => ({
  playedAt: 1,
  result: '1-0',
  humanColor: 'white',
  strengthElo: 800,
  ...over,
});

describe('expectedScore — classic Elo logistic', () => {
  it('is 0.5 for equal ratings and symmetric around it', () => {
    expect(expectedScore(800, 800)).toBeCloseTo(0.5, 9);
    expect(expectedScore(1500, 1600)).toBeCloseTo(0.36, 2); // the worked example
    expect(expectedScore(1600, 1500)).toBeCloseTo(0.64, 2);
    expect(expectedScore(800, 1200)).toBeCloseTo(1 / 11, 4); // +400 -> ~0.0909
  });
});

describe('gameScore — result + side to the human POV', () => {
  it('maps wins / draws / losses, and ignores unfinished games', () => {
    expect(gameScore('1-0', 'white')).toBe(1);
    expect(gameScore('1-0', 'black')).toBe(0);
    expect(gameScore('0-1', 'black')).toBe(1);
    expect(gameScore('0-1', 'white')).toBe(0);
    expect(gameScore('1/2-1/2', 'white')).toBe(0.5);
    expect(gameScore('1/2-1/2', 'black')).toBe(0.5);
    expect(gameScore('*', 'white')).toBeNull();
  });
});

describe('computeGameRating — classic Elo fold', () => {
  it('an empty history is the seed, provisional, no games', () => {
    const r = computeGameRating([]);
    expect(r.value).toBe(GAME_RATING_SEED);
    expect(r.games).toBe(0);
    expect(r.provisional).toBe(true);
    expect(r.series).toEqual([]);
  });

  it('a win vs an equal (800) bot adds K/2; a loss subtracts K/2', () => {
    expect(computeGameRating([rec({ result: '1-0', humanColor: 'white', strengthElo: 800 })]).value).toBe(
      Math.round(GAME_RATING_SEED + GAME_RATING_K * 0.5),
    ); // 816
    expect(computeGameRating([rec({ result: '0-1', humanColor: 'white', strengthElo: 800 })]).value).toBe(
      Math.round(GAME_RATING_SEED - GAME_RATING_K * 0.5),
    ); // 784
    expect(computeGameRating([rec({ result: '1/2-1/2', strengthElo: 800 })]).value).toBe(800); // draw vs equal
  });

  it('beating a STRONGER bot gains more than beating a weaker one', () => {
    const vsStrong = computeGameRating([rec({ result: '1-0', humanColor: 'white', strengthElo: 1200 })]).value;
    const vsEqual = computeGameRating([rec({ result: '1-0', humanColor: 'white', strengthElo: 800 })]).value;
    expect(vsStrong).toBe(829); // 800 + 32*(1 - 0.0909)
    expect(vsStrong - 800).toBeGreaterThan(vsEqual - 800);
  });

  it('a black win reads off the 0-1 result', () => {
    expect(computeGameRating([rec({ result: '0-1', humanColor: 'black', strengthElo: 800 })]).value).toBe(816);
  });

  it('ignores unfinished games and counts only rated ones', () => {
    const r = computeGameRating([
      rec({ playedAt: 1, result: '*', strengthElo: 800 }),
      rec({ playedAt: 2, result: '1-0', humanColor: 'white', strengthElo: 800 }),
    ]);
    expect(r.games).toBe(1);
    expect(r.value).toBe(816);
    expect(r.series).toHaveLength(1);
  });

  it('folds oldest-first regardless of input order', () => {
    const a = rec({ playedAt: 2, result: '1-0', humanColor: 'white', strengthElo: 1000 });
    const b = rec({ playedAt: 1, result: '0-1', humanColor: 'white', strengthElo: 600 }); // a loss
    // Sorted order is b (loss vs 600) then a (win vs 1000): 800 -> 775.69 -> 800.79 -> 801.
    expect(computeGameRating([a, b]).value).toBe(801);
    expect(computeGameRating([b, a]).value).toBe(801); // order-independent (sorted internally)
  });

  it('discounts a WIN to 25% when Undo was used; losses/draws unaffected', () => {
    const cleanWin = computeGameRating([rec({ result: '1-0', humanColor: 'white', strengthElo: 800 })]).value;
    const undoWin = computeGameRating([
      rec({ result: '1-0', humanColor: 'white', strengthElo: 800, undoUsed: true }),
    ]).value;
    expect(cleanWin).toBe(816); // full gain: 800 + 32*0.5
    expect(undoWin).toBe(804); // quarter gain: 800 + 0.25*16

    // A loss is unchanged whether or not Undo was used.
    const cleanLoss = computeGameRating([rec({ result: '0-1', humanColor: 'white', strengthElo: 800 })]).value;
    const undoLoss = computeGameRating([
      rec({ result: '0-1', humanColor: 'white', strengthElo: 800, undoUsed: true }),
    ]).value;
    expect(undoLoss).toBe(cleanLoss); // 784 either way

    // A drawing gain (drew a stronger bot) is also unchanged by Undo.
    const cleanDraw = computeGameRating([rec({ result: '1/2-1/2', strengthElo: 1200 })]).value;
    const undoDraw = computeGameRating([rec({ result: '1/2-1/2', strengthElo: 1200, undoUsed: true })]).value;
    expect(undoDraw).toBe(cleanDraw);
  });

  it('stays provisional until enough games, then settles', () => {
    const nine = Array.from({ length: 9 }, (_, i) => rec({ playedAt: i + 1 }));
    const ten = Array.from({ length: GAME_RATING_PROVISIONAL_GAMES }, (_, i) => rec({ playedAt: i + 1 }));
    expect(computeGameRating(nine).provisional).toBe(true);
    expect(computeGameRating(ten).provisional).toBe(false);
  });
});
