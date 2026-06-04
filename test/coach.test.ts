import { describe, it, expect } from 'vitest';
import {
  diagnoseWeaknesses,
  buildInsights,
  buildProgressSnapshot,
  computePuzzleStats,
  computeGameStats,
  COACH_THRESHOLDS,
} from '../src/coach';
import type { AnalyzedGame } from '../src/coach';
import type { GameReport, MoveAnalysis, PlayerReport } from '../src/analysis/types';
import type { SavedGame } from '../src/persistence/types';
import type { Color, MoveClass } from '../src/core/types';
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
/** `total` attempts on one theme, the first `solved` of them successful. */
const themeAttempts = (theme: string, total: number, solved: number): PuzzleAttempt[] =>
  Array.from({ length: total }, (_, i) => att({ themes: [theme], solved: i < solved }));

const ENDGAME = '8/5k2/8/8/3K4/8/4R3/8 w - - 0 50';

const mv = (over: Partial<MoveAnalysis>): MoveAnalysis => ({
  ply: 1,
  moveNumber: 1,
  mover: 'white',
  san: 'x',
  fenBefore: ENDGAME,
  fenAfter: ENDGAME,
  scoreBefore: { cp: 0 },
  scoreAfter: { cp: 0 },
  winBefore: 50,
  winAfter: 50,
  accuracy: 100,
  classification: 'best',
  cpLoss: 0,
  isBest: false,
  ...over,
});
const player = (over: { accuracy?: number; acpl?: number; blunder?: number } = {}): PlayerReport => ({
  color: 'white',
  moveCount: 8,
  accuracy: over.accuracy ?? 0,
  acpl: over.acpl ?? 0,
  counts: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: over.blunder ?? 0 },
});
const endgameMoves = (n: number, accuracy: number, klass: MoveClass): MoveAnalysis[] =>
  Array.from({ length: n }, (_, i) => mv({ ply: 51 + 2 * i, accuracy, cpLoss: 200, classification: klass }));

const noGames = computeGameStats([], 0);

describe('diagnoseWeaknesses — theme thresholds', () => {
  it('flags a theme weak only when it clears min-sample AND is below the weak solve-rate', () => {
    const attempts = [
      ...themeAttempts('fork', 4, 2), // 50% — weak, trusted
      ...themeAttempts('pin', 4, 3), // 75% — fine
      ...themeAttempts('tiny', 3, 0), // 0% but only 3 attempts — ignored
    ];
    const ws = diagnoseWeaknesses(computePuzzleStats(attempts), noGames);
    expect(ws.map((w) => w.id)).toEqual(['theme:fork']);
    expect(ws[0].drillTheme).toBe('fork');
    expect(ws[0].kind).toBe('theme');
  });

  it('uses a strict < on the weak solve-rate boundary', () => {
    // 13/20 = 0.65 exactly → NOT weak; 12/20 = 0.60 → weak.
    expect(diagnoseWeaknesses(computePuzzleStats(themeAttempts('edge', 20, 13)), noGames)).toEqual([]);
    const below = diagnoseWeaknesses(computePuzzleStats(themeAttempts('edge', 20, 12)), noGames);
    expect(below.map((w) => w.id)).toEqual(['theme:edge']);
  });
});

describe('diagnoseWeaknesses — phase + blunder thresholds (from games)', () => {
  it('flags a weak endgame and a high blunder rate, both drilling the endgame', () => {
    const moves = [...endgameMoves(2, 20, 'blunder'), ...endgameMoves(6, 60, 'good')]; // 8 endgame user moves
    const g: AnalyzedGame = {
      report: { version: 2, pgn: '', result: '*', moves, white: player({ accuracy: 40, acpl: 200, blunder: 2 }), black: player(), depth: 16, analyzedAt: 0 } as GameReport,
      game: { id: 1, playedAt: 1000, pgn: '', result: '*', strengthElo: 1200, humanColor: 'white' } as SavedGame,
    };
    const ws = diagnoseWeaknesses(computePuzzleStats([]), computeGameStats([g], 1));
    const ids = ws.map((w) => w.id);
    expect(ids).toContain('phase:endgame');
    expect(ids).toContain('blunders');
    expect(ws[0].id).toBe('phase:endgame'); // higher severity×confidence than the 1-game blunder signal
    expect(ws.find((w) => w.id === 'phase:endgame')!.drillTheme).toBe('endgame');
    expect(ws.find((w) => w.id === 'blunders')!.drillTheme).toBe('endgame'); // worst phase by blunders
  });

  it('does not flag a phase below the minimum move count', () => {
    const moves = endgameMoves(COACH_THRESHOLDS.minPhaseMoves - 1, 30, 'mistake'); // too few moves
    const g: AnalyzedGame = {
      report: { version: 2, pgn: '', result: '*', moves, white: player({ accuracy: 30, blunder: 0 }), black: player(), depth: 16, analyzedAt: 0 } as GameReport,
      game: { id: 1, playedAt: 1, pgn: '', result: '*', strengthElo: 1200, humanColor: 'white' } as SavedGame,
    };
    expect(diagnoseWeaknesses(computePuzzleStats([]), computeGameStats([g], 1))).toEqual([]);
  });
});

describe('buildInsights', () => {
  it('emits an honest "no clear weakness" note (with a drill target) when data has no flagged weakness', () => {
    const puzzles = computePuzzleStats(themeAttempts('pin', 5, 5)); // 100%
    const insights = buildInsights([], puzzles, noGames);
    expect(insights).toHaveLength(1);
    expect(insights[0].id).toBe('all-clear');
    expect(insights[0].drillTheme).toBe('pin');
  });

  it('caps the number of insights at maxInsights, worst-first', () => {
    const attempts = [
      ...themeAttempts('a', 5, 0), // 0%
      ...themeAttempts('b', 5, 1),
      ...themeAttempts('c', 5, 1),
      ...themeAttempts('d', 5, 1),
      ...themeAttempts('e', 5, 1),
    ];
    const snap = buildProgressSnapshot({ attempts, analyzedGames: [], totalGames: 0 });
    expect(snap.weaknesses.length).toBe(5);
    expect(snap.insights.length).toBe(COACH_THRESHOLDS.maxInsights);
    expect(snap.insights[0].drillTheme).toBe('a');
    expect(snap.insights.map((i) => i.priority)).toEqual([1, 2, 3, 4]);
  });
});

describe('buildProgressSnapshot', () => {
  it('produces an actionable, drillable insight + a rating curve matching the log (acceptance)', () => {
    const attempts = [
      att({ at: BASE + 1, ratingAfter: 1490, solved: false, themes: ['fork'] }),
      att({ at: BASE + 2, ratingAfter: 1500, solved: false, themes: ['fork'] }),
      att({ at: BASE + 3, ratingAfter: 1512, solved: true, themes: ['fork'] }),
      att({ at: BASE + 4, ratingAfter: 1520, solved: true, themes: ['fork'] }),
      att({ at: BASE + 5, ratingAfter: 1515, solved: false, themes: ['fork'] }),
      att({ at: BASE + 6, ratingAfter: 1525, solved: true, themes: ['fork'] }),
    ]; // fork 3/6 = 50% → weak
    const snap = buildProgressSnapshot({
      attempts,
      analyzedGames: [],
      totalGames: 3,
      rating: { rating: 1525, rd: 60, vol: 0.06 },
    });
    expect(snap.weaknesses.length).toBeGreaterThanOrEqual(1);
    expect(snap.insights.length).toBeGreaterThanOrEqual(1);
    expect(snap.insights[0].drillTheme).toBe('fork');
    expect(snap.puzzlesSolved).toBe(3);
    expect(snap.gamesPlayed).toBe(3);
    expect(snap.rating).toEqual({ value: 1525, rd: 60, provisional: false }); // rd ≤ 75
    expect(snap.puzzles.ratingSeries.map((p) => p.rating)).toEqual([1490, 1500, 1512, 1520, 1515, 1525]);
    expect(snap.hasData).toBe(true);
  });

  it('marks a high-RD rating provisional and is empty-safe with no data', () => {
    const snap = buildProgressSnapshot({
      attempts: [],
      analyzedGames: [],
      totalGames: 0,
      rating: { rating: 1500, rd: 200, vol: 0.09 },
    });
    expect(snap.rating.provisional).toBe(true);
    expect(snap.hasData).toBe(false);
    expect(snap.weaknesses).toEqual([]);
    expect(snap.insights).toEqual([]);
  });

  it('defaults to the Lichess seed when no rating is supplied', () => {
    const snap = buildProgressSnapshot({ attempts: [], analyzedGames: [], totalGames: 0 });
    expect(snap.rating.value).toBe(1500);
    expect(snap.rating.provisional).toBe(true);
  });

  it('is deterministic — identical input yields identical output', () => {
    const input = { attempts: themeAttempts('fork', 6, 2), analyzedGames: [], totalGames: 1 };
    expect(buildProgressSnapshot(input)).toEqual(buildProgressSnapshot(input));
  });
});
