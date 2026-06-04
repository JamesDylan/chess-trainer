import { describe, it, expect } from 'vitest';
import {
  computePuzzleStats,
  themeStats,
  weakestThemes,
  ratingSeries,
  bandStats,
  streaks,
  overallSolveRate,
  COACH_THRESHOLDS,
} from '../src/coach';
import type { PuzzleAttempt } from '../src/puzzles/types';

const BASE = 1_700_000_000_000;
let seq = 0;
const att = (over: Partial<PuzzleAttempt> = {}): PuzzleAttempt => {
  const i = seq++;
  return {
    puzzleId: `p${i}`,
    solved: true,
    at: BASE + i * 1000,
    puzzleRating: 1500,
    ratingBefore: 1500,
    ratingAfter: 1500,
    ratingDelta: 0,
    rdAfter: 100,
    themes: [],
    assisted: false,
    ...over,
  };
};

describe('ratingSeries', () => {
  it('orders by timestamp and reads ratingAfter / rdAfter (matches the log)', () => {
    const log = [
      att({ at: BASE + 3000, ratingAfter: 1512, rdAfter: 480 }),
      att({ at: BASE + 1000, ratingAfter: 1500, rdAfter: 490 }), // deliberately out of order
      att({ at: BASE + 2000, ratingAfter: 1506, rdAfter: 485 }),
    ];
    const series = ratingSeries(log);
    expect(series.map((p) => p.at)).toEqual([BASE + 1000, BASE + 2000, BASE + 3000]);
    expect(series.map((p) => p.rating)).toEqual([1500, 1506, 1512]);
    expect(series[0].rd).toBe(490);
  });
});

describe('themeStats / solve rates', () => {
  it('an attempt feeds every one of its themes; solve-rate = solved/attempts', () => {
    const log = [
      att({ solved: true, themes: ['fork'] }),
      att({ solved: false, themes: ['fork', 'pin'] }),
      att({ solved: true, themes: ['pin'] }),
      att({ solved: true, themes: ['fork'] }),
    ];
    const themes = themeStats(log);
    const fork = themes.find((t) => t.theme === 'fork')!;
    const pin = themes.find((t) => t.theme === 'pin')!;
    expect(fork.attempts).toBe(3);
    expect(fork.solved).toBe(2);
    expect(fork.solveRate).toBeCloseTo(2 / 3, 6);
    expect(pin.attempts).toBe(2);
    expect(pin.solveRate).toBe(0.5);
    // worst solve-rate first.
    expect(themes[0].theme).toBe('pin');
  });
});

describe('weakestThemes — minimum-sample threshold', () => {
  it(`excludes themes below ${COACH_THRESHOLDS.minThemeAttempts} attempts even at 0%`, () => {
    const log = [
      // fork: 5 attempts, 2 solved → 40%
      ...Array.from({ length: 5 }, (_, i) => att({ solved: i < 2, themes: ['fork'] })),
      // rare: 2 attempts, 0 solved → 0% but below the min sample
      att({ solved: false, themes: ['rare'] }),
      att({ solved: false, themes: ['rare'] }),
    ];
    const ranked = weakestThemes(log);
    expect(ranked.map((t) => t.theme)).toEqual(['fork']); // rare dropped despite 0%
    expect(ranked[0].solveRate).toBeCloseTo(0.4, 6);

    // The full themeStats list still includes the low-sample row, flagged low-confidence.
    const all = themeStats(log);
    expect(all[0].theme).toBe('rare'); // 0% is worst
    expect(all.find((t) => t.theme === 'rare')!.confidence).toBe('low');
    expect(all.find((t) => t.theme === 'fork')!.confidence).toBe('medium');
  });

  it('marks a theme high-confidence once it clears the high-confidence attempt count', () => {
    const log = Array.from({ length: COACH_THRESHOLDS.highConfidenceThemeAttempts }, (_, i) =>
      att({ solved: i % 2 === 0, themes: ['endgame'] }),
    );
    expect(themeStats(log)[0].confidence).toBe('high');
  });
});

describe('bandStats', () => {
  it('buckets by 200-point band and reports per-band solve rate', () => {
    const log = [
      att({ puzzleRating: 1250, solved: true }),
      att({ puzzleRating: 1390, solved: false }),
      att({ puzzleRating: 1600, solved: true }),
    ];
    const bands = bandStats(log);
    expect(bands.map((b) => b.lo)).toEqual([1200, 1600]);
    const b12 = bands.find((b) => b.lo === 1200)!;
    expect(b12.attempts).toBe(2);
    expect(b12.solved).toBe(1);
    expect(b12.solveRate).toBe(0.5);
    expect(b12.label).toBe('1200–1399');
  });
});

describe('streaks', () => {
  it('reports the longest run (best) and the trailing run (current)', () => {
    const bools = [true, true, false, true, true, true, false, true];
    const log = bools.map((s, i) => att({ solved: s, at: BASE + i * 1000 }));
    expect(streaks(log)).toEqual({ current: 1, best: 3 });
  });

  it('a fully-solved log has current = best = length', () => {
    const log = [att({ solved: true }), att({ solved: true }), att({ solved: true })];
    expect(streaks(log)).toEqual({ current: 3, best: 3 });
  });
});

describe('computePuzzleStats — integration + empty handling', () => {
  it('aggregates totals and a chronological rating series', () => {
    const log = [
      att({ at: BASE + 3000, ratingAfter: 1520, solved: true, themes: ['fork'] }),
      att({ at: BASE + 1000, ratingAfter: 1490, solved: false, themes: ['pin'] }),
      att({ at: BASE + 2000, ratingAfter: 1505, solved: true, themes: ['fork'] }),
    ];
    const s = computePuzzleStats(log);
    expect(s.totalAttempts).toBe(3);
    expect(s.solved).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.solveRate).toBeCloseTo(2 / 3, 6);
    expect(s.ratingSeries.map((p) => p.rating)).toEqual([1490, 1505, 1520]);
  });

  it('handles an empty log without throwing', () => {
    const s = computePuzzleStats([]);
    expect(s.totalAttempts).toBe(0);
    expect(s.solveRate).toBe(0);
    expect(s.currentStreak).toBe(0);
    expect(s.bestStreak).toBe(0);
    expect(s.themes).toEqual([]);
    expect(s.bands).toEqual([]);
    expect(s.ratingSeries).toEqual([]);
    expect(overallSolveRate([])).toBe(0);
  });

  it('tolerates legacy attempts with no themes field', () => {
    const legacy = att();
    delete (legacy as { themes?: string[] }).themes;
    expect(() => computePuzzleStats([legacy])).not.toThrow();
    expect(themeStats([legacy])).toEqual([]);
  });
});
