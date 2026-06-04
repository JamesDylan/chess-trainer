import { describe, it, expect } from 'vitest';
import {
  computeGameStats,
  phaseStats,
  phaseOf,
  nonPawnMaterial,
  accuracyTrend,
  vsStrength,
} from '../src/coach';
import type { AnalyzedGame } from '../src/coach';
import type { GameReport, MoveAnalysis, PlayerReport } from '../src/analysis/types';
import type { SavedGame } from '../src/persistence/types';
import type { Color, MoveClass } from '../src/core/types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ENDGAME = '8/5k2/8/8/3K4/8/4R3/8 w - - 0 50'; // lone rook → 5 non-pawn points

const mv = (over: Partial<MoveAnalysis> = {}): MoveAnalysis => ({
  ply: 1,
  moveNumber: 1,
  mover: 'white',
  san: 'x',
  fenBefore: START,
  fenAfter: START,
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

const player = (over: Partial<PlayerReport & { blunder: number; mistake: number; inaccuracy: number }> = {}): PlayerReport => ({
  color: (over.color ?? 'white') as Color,
  moveCount: over.moveCount ?? 0,
  accuracy: over.accuracy ?? 0,
  acpl: over.acpl ?? 0,
  counts: {
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: over.inaccuracy ?? 0,
    mistake: over.mistake ?? 0,
    blunder: over.blunder ?? 0,
  },
});

const report = (moves: MoveAnalysis[], over: Partial<GameReport> = {}): GameReport => ({
  version: 2,
  pgn: '',
  result: '*',
  moves,
  white: player({ color: 'white' }),
  black: player({ color: 'black' }),
  depth: 16,
  analyzedAt: 0,
  ...over,
});

const game = (over: Partial<SavedGame> = {}): SavedGame => ({
  id: 1,
  playedAt: 1000,
  pgn: '',
  result: '*',
  strengthElo: 1200,
  humanColor: 'white',
  ...over,
});

/** N user moves at a fixed phase FEN/ply, with the given accuracy + classification. */
function userMoves(
  n: number,
  fen: string,
  ply: number,
  accuracy: number,
  cpLoss: number,
  classification: MoveClass,
  mover: Color = 'white',
): MoveAnalysis[] {
  return Array.from({ length: n }, (_, i) =>
    mv({ ply: ply + 2 * i, fenBefore: fen, accuracy, cpLoss, classification, mover }),
  );
}

describe('material + phase cut', () => {
  it('counts non-pawn material from a FEN (kings + pawns excluded)', () => {
    expect(nonPawnMaterial(START)).toBe(62); // Q+2R+2B+2N per side = 31 × 2
    expect(nonPawnMaterial(ENDGAME)).toBe(5); // one rook
  });

  it('classifies by material first, then ply (documented cut)', () => {
    expect(phaseOf(1, START)).toBe('opening');
    expect(phaseOf(20, START)).toBe('opening'); // boundary inclusive
    expect(phaseOf(21, START)).toBe('middlegame'); // past the opening ply
    expect(phaseOf(50, ENDGAME)).toBe('endgame');
    expect(phaseOf(2, ENDGAME)).toBe('endgame'); // low material → endgame even early
  });
});

describe('phaseStats — user moves only, per phase', () => {
  it('buckets the user moves, harmonic-means accuracy, counts blunders, sets confidence', () => {
    const moves = [
      ...userMoves(8, START, 1, 95, 8, 'good'), // 8 opening moves (plies 1..15)
      ...userMoves(3, ENDGAME, 51, 20, 300, 'blunder'), // 3 endgame blunders
      mv({ ply: 2, fenBefore: START, mover: 'black', accuracy: 1, cpLoss: 999, classification: 'blunder' }), // opponent move, ignored
    ];
    const games: AnalyzedGame[] = [{ report: report(moves), game: game({ humanColor: 'white' }) }];
    const phases = phaseStats(games);
    const opening = phases.find((p) => p.phase === 'opening')!;
    const middle = phases.find((p) => p.phase === 'middlegame')!;
    const endgame = phases.find((p) => p.phase === 'endgame')!;

    expect(opening.moves).toBe(8);
    expect(opening.accuracy).toBeCloseTo(95, 6); // all 95 → harmonic mean 95
    expect(opening.blunders).toBe(0);
    expect(opening.confidence).toBe('medium'); // 8 == minPhaseMoves, < high

    expect(endgame.moves).toBe(3);
    expect(endgame.blunders).toBe(3);
    expect(endgame.accuracy).toBeCloseTo(20, 6);
    expect(endgame.acpl).toBeCloseTo(300, 6);
    expect(endgame.confidence).toBe('low'); // 3 < minPhaseMoves

    expect(middle.moves).toBe(0);
    expect(middle.accuracy).toBe(0); // no moves → 0, never throws
  });

  it('respects humanColor — counts black moves when the user played black', () => {
    const moves = [
      ...userMoves(4, START, 1, 90, 10, 'good', 'black'), // user (black)
      ...userMoves(4, START, 2, 10, 500, 'blunder', 'white'), // opponent (white)
    ];
    const games: AnalyzedGame[] = [{ report: report(moves), game: game({ humanColor: 'black' }) }];
    const opening = phaseStats(games).find((p) => p.phase === 'opening')!;
    expect(opening.moves).toBe(4);
    expect(opening.accuracy).toBeCloseTo(90, 6); // the white blunders are excluded
  });
});

describe('accuracyTrend + vsStrength + computeGameStats', () => {
  const r1 = report(userMoves(2, START, 1, 80, 30, 'good'), {
    white: player({ accuracy: 80, acpl: 30, blunder: 2 }),
  });
  const g1: AnalyzedGame = { report: r1, game: game({ id: 1, playedAt: 2000, strengthElo: 1200 }) };
  const r2 = report(userMoves(2, START, 1, 60, 60, 'mistake'), {
    white: player({ accuracy: 60, acpl: 60, blunder: 1 }),
  });
  const g2: AnalyzedGame = { report: r2, game: game({ id: 2, playedAt: 1000, strengthElo: 1600 }) };

  it('trend is ascending by playedAt and carries the per-game player numbers', () => {
    const trend = accuracyTrend([g1, g2]);
    expect(trend.map((t) => t.at)).toEqual([1000, 2000]);
    expect(trend.map((t) => t.strengthElo)).toEqual([1600, 1200]);
    expect(trend.map((t) => t.accuracy)).toEqual([60, 80]);
  });

  it('vsStrength groups by Elo (ascending) and harmonic-means user accuracies', () => {
    const vs = vsStrength([g1, g2]);
    expect(vs.map((s) => s.strengthElo)).toEqual([1200, 1600]);
    expect(vs.find((s) => s.strengthElo === 1200)!.accuracy).toBeCloseTo(80, 6);
    expect(vs.find((s) => s.strengthElo === 1600)!.accuracy).toBeCloseTo(60, 6);
  });

  it('rolls up totals; blunders/game from the player reports; overall accuracy harmonic', () => {
    const stats = computeGameStats([g1, g2], 5);
    expect(stats.totalGames).toBe(5);
    expect(stats.analyzedGames).toBe(2);
    expect(stats.blundersPerGame).toBe(1.5); // (2 + 1) / 2
    // harmonic mean of [80,80,60,60]
    const hm = 4 / (1 / 80 + 1 / 80 + 1 / 60 + 1 / 60);
    expect(stats.userAccuracy).toBeCloseTo(hm, 4);
  });

  it('handles zero analysed games without throwing', () => {
    const stats = computeGameStats([], 0);
    expect(stats.analyzedGames).toBe(0);
    expect(stats.userAccuracy).toBeUndefined();
    expect(stats.blundersPerGame).toBe(0);
    expect(stats.trend).toEqual([]);
    expect(stats.vsStrength).toEqual([]);
    expect(stats.phases.map((p) => p.moves)).toEqual([0, 0, 0]);
  });
});
