import { describe, it, expect } from 'vitest';
import {
  glicko2Update,
  updateForResult,
  updateForAttempt,
  initialRating,
  isEstablished,
  LICHESS_GLICKO2,
  type RatingState,
} from '../src/index';

describe('glicko2Update — canonical worked example', () => {
  // Glickman's Glicko-2 paper, "Step-by-step example": a player at 1500/200/0.06,
  // tau = 0.5, plays three games in one rating period.
  const player: RatingState = { rating: 1500, rd: 200, vol: 0.06 };
  const games = [
    { opponentRating: 1400, opponentRd: 30, score: 1 }, // win
    { opponentRating: 1550, opponentRd: 100, score: 0 }, // loss
    { opponentRating: 1700, opponentRd: 300, score: 0 }, // loss
  ];

  it('reproduces the reference rating, RD and volatility', () => {
    const out = glicko2Update(player, games, 0.5);
    expect(out.rating).toBeCloseTo(1464.06, 1); // ≈ 1464.06
    expect(out.rd).toBeCloseTo(151.52, 1); // ≈ 151.52
    expect(out.vol).toBeCloseTo(0.05999, 4); // ≈ 0.05999
  });

  it('with no games, only RD grows (rating + volatility unchanged)', () => {
    const out = glicko2Update(player, [], 0.5);
    expect(out.rating).toBe(1500);
    expect(out.vol).toBeCloseTo(0.06, 10);
    expect(out.rd).toBeGreaterThan(200);
  });
});

describe('Lichess seed + wrapper', () => {
  it('initialRating is the Lichess seed', () => {
    expect(initialRating()).toEqual({ rating: 1500, rd: 500, vol: 0.09 });
  });

  it('a win raises the rating and a loss lowers it', () => {
    const base = initialRating();
    const win = updateForAttempt(base, 1500, 60, true);
    const loss = updateForAttempt(base, 1500, 60, false);
    expect(win.rating).toBeGreaterThan(base.rating);
    expect(loss.rating).toBeLessThan(base.rating);
  });

  it('RD shrinks as you play, and stays within [45, 500]', () => {
    let s = initialRating();
    const rd0 = s.rd;
    for (let i = 0; i < 12; i += 1) s = updateForAttempt(s, 1500, 60, i % 2 === 0);
    expect(s.rd).toBeLessThan(rd0);
    expect(s.rd).toBeGreaterThanOrEqual(LICHESS_GLICKO2.minRd);
    expect(s.rd).toBeLessThanOrEqual(LICHESS_GLICKO2.maxRd);
    expect(s.vol).toBeLessThanOrEqual(LICHESS_GLICKO2.maxVol);
  });

  it('caps a single-update rating change at ±700', () => {
    // A provisional player beating a far-stronger puzzle: change is clamped.
    const up = updateForAttempt({ rating: 1000, rd: 500, vol: 0.09 }, 2800, 45, true);
    expect(up.rating - 1000).toBeLessThanOrEqual(LICHESS_GLICKO2.maxRatingChange + 1e-9);
    const down = updateForAttempt({ rating: 2000, rd: 500, vol: 0.09 }, 200, 45, false);
    expect(2000 - down.rating).toBeLessThanOrEqual(LICHESS_GLICKO2.maxRatingChange + 1e-9);
  });

  it('marks a rating established only once RD ≤ 75', () => {
    expect(isEstablished({ rating: 1500, rd: 76, vol: 0.06 })).toBe(false);
    expect(isEstablished({ rating: 1500, rd: 75, vol: 0.06 })).toBe(true);
    expect(isEstablished({ rating: 1500, rd: 40, vol: 0.06 })).toBe(true);
  });

  it('updateForResult clamps RD into the Lichess band', () => {
    // Many losses inflate uncertainty, but RD never exceeds the 500 ceiling.
    let s = initialRating();
    for (let i = 0; i < 3; i += 1) s = updateForResult(s, [], LICHESS_GLICKO2); // idle periods grow RD
    expect(s.rd).toBeLessThanOrEqual(LICHESS_GLICKO2.maxRd);
    expect(s.rd).toBeGreaterThanOrEqual(LICHESS_GLICKO2.minRd);
  });
});
