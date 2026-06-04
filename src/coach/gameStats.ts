// Pure aggregations over cached analysis reports (GameReport[] + SavedGame meta). It
// REUSES src/core/evalMath (harmonicMean, averageCentipawnLoss) and the analyzer's
// per-move numbers VERBATIM — accuracy/classification/cpLoss were already computed by
// the analyzer; here we only group and average them. No engine, no DOM, no new deps.

import { harmonicMean, averageCentipawnLoss } from '../core/evalMath';
import type {
  AnalyzedGame,
  Confidence,
  GamePhase,
  GameStats,
  GameTrendPoint,
  PhaseStat,
  StrengthStat,
} from './types';
import { COACH_THRESHOLDS, PHASE_THRESHOLDS } from './thresholds';

/** Standard piece values for the phase cut (kings + pawns excluded). */
const PIECE_POINTS: Record<string, number> = { q: 9, r: 5, b: 3, n: 3 };

/**
 * Non-pawn, non-king material points across BOTH colours, parsed straight from a FEN's
 * piece-placement field (no chess.js needed). Full board = 62.
 */
export function nonPawnMaterial(fen: string): number {
  const placement = fen.split(' ')[0] ?? '';
  let points = 0;
  for (const ch of placement) {
    const lower = ch.toLowerCase();
    if (PIECE_POINTS[lower] !== undefined) points += PIECE_POINTS[lower];
  }
  return points;
}

/**
 * Phase of the position BEFORE a move, from ply + material (documented cut, tunable in
 * PHASE_THRESHOLDS):
 *   1. endgame  — non-pawn material (both sides) <= endgameNonPawnPoints (checked FIRST,
 *                 so a stripped board is an endgame even if it arises early);
 *   2. opening  — else, ply <= openingMaxPly (the development phase);
 *   3. middlegame — everything else.
 */
export function phaseOf(ply: number, fenBefore: string): GamePhase {
  if (nonPawnMaterial(fenBefore) <= PHASE_THRESHOLDS.endgameNonPawnPoints) return 'endgame';
  if (ply <= PHASE_THRESHOLDS.openingMaxPly) return 'opening';
  return 'middlegame';
}

function phaseConfidence(moves: number): Confidence {
  if (moves < COACH_THRESHOLDS.minPhaseMoves) return 'low';
  if (moves >= COACH_THRESHOLDS.highConfidencePhaseMoves) return 'high';
  return 'medium';
}

const PHASES: GamePhase[] = ['opening', 'middlegame', 'endgame'];

interface PhaseBucket {
  acc: number[];
  loss: number[];
  blunders: number;
  mistakes: number;
  inaccuracies: number;
}

/** Per-phase aggregate over the USER's moves across all analysed games. */
export function phaseStats(games: AnalyzedGame[]): PhaseStat[] {
  const buckets: Record<GamePhase, PhaseBucket> = {
    opening: { acc: [], loss: [], blunders: 0, mistakes: 0, inaccuracies: 0 },
    middlegame: { acc: [], loss: [], blunders: 0, mistakes: 0, inaccuracies: 0 },
    endgame: { acc: [], loss: [], blunders: 0, mistakes: 0, inaccuracies: 0 },
  };
  for (const { report, game } of games) {
    for (const m of report.moves) {
      if (m.mover !== game.humanColor) continue; // only the user's own moves
      const b = buckets[phaseOf(m.ply, m.fenBefore)];
      b.acc.push(m.accuracy);
      b.loss.push(m.cpLoss);
      if (m.classification === 'blunder') b.blunders += 1;
      else if (m.classification === 'mistake') b.mistakes += 1;
      else if (m.classification === 'inaccuracy') b.inaccuracies += 1;
    }
  }
  return PHASES.map((phase) => {
    const b = buckets[phase];
    return {
      phase,
      moves: b.acc.length,
      accuracy: harmonicMean(b.acc), // reuse evalMath verbatim; [] → 0
      acpl: averageCentipawnLoss(b.loss),
      blunders: b.blunders,
      mistakes: b.mistakes,
      inaccuracies: b.inaccuracies,
      confidence: phaseConfidence(b.acc.length),
    };
  });
}

/** User accuracy/ACPL per analysed game, ascending by playedAt. */
export function accuracyTrend(games: AnalyzedGame[]): GameTrendPoint[] {
  return games
    .map((g, i) => [g, i] as const)
    .sort((x, y) => x[0].game.playedAt - y[0].game.playedAt || x[1] - y[1])
    .map(([{ report, game }]) => {
      const pr = game.humanColor === 'white' ? report.white : report.black;
      return { at: game.playedAt, accuracy: pr.accuracy, acpl: pr.acpl, strengthElo: game.strengthElo };
    });
}

/** User accuracy grouped by the engine strength faced, ascending by Elo. */
export function vsStrength(games: AnalyzedGame[]): StrengthStat[] {
  const groups = new Map<number, { acc: number[]; games: number }>();
  for (const { report, game } of games) {
    const g = groups.get(game.strengthElo) ?? { acc: [], games: 0 };
    g.games += 1;
    for (const m of report.moves) if (m.mover === game.humanColor) g.acc.push(m.accuracy);
    groups.set(game.strengthElo, g);
  }
  return [...groups.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([strengthElo, g]) => ({ strengthElo, games: g.games, accuracy: harmonicMean(g.acc) }));
}

/** Full game-side stats bundle. Handles zero analysed games without throwing. */
export function computeGameStats(games: AnalyzedGame[], totalGames: number): GameStats {
  const analyzedGames = games.length;
  const userAcc: number[] = [];
  let blunders = 0;
  let mistakes = 0;
  let inaccuracies = 0;
  for (const { report, game } of games) {
    const pr = game.humanColor === 'white' ? report.white : report.black;
    blunders += pr.counts.blunder;
    mistakes += pr.counts.mistake;
    inaccuracies += pr.counts.inaccuracy;
    for (const m of report.moves) if (m.mover === game.humanColor) userAcc.push(m.accuracy);
  }
  return {
    totalGames,
    analyzedGames,
    userAccuracy: userAcc.length > 0 ? harmonicMean(userAcc) : undefined,
    blundersPerGame: analyzedGames > 0 ? blunders / analyzedGames : 0,
    mistakesPerGame: analyzedGames > 0 ? mistakes / analyzedGames : 0,
    inaccuraciesPerGame: analyzedGames > 0 ? inaccuracies / analyzedGames : 0,
    trend: accuracyTrend(games),
    phases: phaseStats(games),
    vsStrength: vsStrength(games),
  };
}
