// Coach-layer types (Stage 4). These sit ON TOP of the data the first three pillars
// persist — puzzle attempts (src/puzzles), saved games + analysis reports
// (src/persistence, src/analysis) — and the Stage 0/3 core (rating, evalMath). They
// AGGREGATE that data into a progress snapshot + rule-based coaching; they never
// re-run an engine, touch the DOM, or recompute the per-move accuracy/classification
// that the analyzer already produced.

import type { PuzzleAttempt } from '../puzzles/types';
import type { GameReport } from '../analysis/types';
import type { SavedGame } from '../persistence/types';
import type { RatingState } from '../core/rating';
import type { Color, GameResult } from '../core/types';

/** The three coarse phases of a game (see gameStats.phaseOf for the documented cut). */
export type GamePhase = 'opening' | 'middlegame' | 'endgame';

/** How much to trust a stat, from its sample size vs the documented thresholds. */
export type Confidence = 'low' | 'medium' | 'high';

/** One point on the rating-over-time curve, taken straight from an attempt's
 *  post-attempt rating (so the curve matches the attempt log exactly). */
export interface RatingPoint {
  /** Epoch ms the attempt finished. */
  at: number;
  /** User rating AFTER the attempt (PuzzleAttempt.ratingAfter). */
  rating: number;
  /** User RD after the attempt (PuzzleAttempt.rdAfter). */
  rd: number;
}

/** Solve performance for one puzzle theme. `solveRate` is a FRACTION in [0,1]. */
export interface ThemeStat {
  theme: string;
  attempts: number;
  solved: number;
  /** solved / attempts, in [0,1]. */
  solveRate: number;
  /** Trust in this row, from `attempts` vs minThemeAttempts/highConfidenceThemeAttempts. */
  confidence: Confidence;
}

/** Solve performance within one 200-point puzzle rating band. */
export interface RatingBandStat {
  /** Inclusive lower edge of the band. */
  lo: number;
  /** Inclusive upper edge (lo + 199). */
  hi: number;
  /** Display label, e.g. "1200–1399". */
  label: string;
  attempts: number;
  solved: number;
  /** solved / attempts, in [0,1]. */
  solveRate: number;
}

/** Per-phase aggregate over the USER's analysed moves. `accuracy`/`acpl` are on the
 *  SAME scale the analyzer uses (accuracy% in [0,100]; acpl in centipawns). */
export interface PhaseStat {
  phase: GamePhase;
  /** Count of the user's moves classified into this phase. */
  moves: number;
  /** Harmonic mean of the user's per-move accuracy% in this phase (0 when no moves). */
  accuracy: number;
  /** Average centipawn loss across the user's moves in this phase. */
  acpl: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  confidence: Confidence;
}

/** Aggregates derived PURELY from the puzzle attempt log. */
export interface PuzzleStats {
  totalAttempts: number;
  solved: number;
  failed: number;
  /** solved / totalAttempts, in [0,1]. */
  solveRate: number;
  /** Trailing run of consecutive solves (newest-first). */
  currentStreak: number;
  /** Longest run of consecutive solves anywhere in the log. */
  bestStreak: number;
  /** Rating after each attempt, oldest first. */
  ratingSeries: RatingPoint[];
  /** Every theme seen, worst solve-rate first (includes low-sample rows; check
   *  `confidence`). */
  themes: ThemeStat[];
  /** Per rating band, ascending. */
  bands: RatingBandStat[];
}

/** One analysed game in time order, for the accuracy/ACPL trend. */
export interface GameTrendPoint {
  at: number;
  /** User accuracy% for that game (from the analyzer's PlayerReport). */
  accuracy: number;
  acpl: number;
  strengthElo: number;
}

/** User accuracy grouped by the engine strength they faced. */
export interface StrengthStat {
  strengthElo: number;
  games: number;
  /** Harmonic mean of the user's move accuracies vs that strength. */
  accuracy: number;
}

/** Aggregates derived from cached GameReports (+ SavedGame meta). */
export interface GameStats {
  /** Saved games in total (analysed or not). */
  totalGames: number;
  /** Games that had a usable cached report to aggregate. */
  analyzedGames: number;
  /** Harmonic mean of all the user's move accuracies; undefined if no analysed moves. */
  userAccuracy?: number;
  blundersPerGame: number;
  mistakesPerGame: number;
  inaccuraciesPerGame: number;
  /** Per analysed game, ascending by playedAt. */
  trend: GameTrendPoint[];
  /** Always opening/middlegame/endgame (moves may be 0). */
  phases: PhaseStat[];
  vsStrength: StrengthStat[];
}

/** A reference to a named opening (ECO optional). Mirrors src/openings' OpeningId but is
 *  redeclared here so the coach layer stays free of the chess.js-backed openings seam. */
export interface OpeningRef {
  eco?: string;
  name: string;
}

/** One finished game reduced to what opening stats need (detected outside the coach). */
export interface GameOpeningRecord {
  /** The detected opening, or undefined if unrecognised. */
  opening?: OpeningRef;
  /** Final result of the game. */
  result: GameResult;
  /** Which side the user played. */
  humanColor: Color;
  /** The user's game accuracy% if the game was analysed (for accuracy-by-opening). */
  accuracy?: number;
}

/** Win/loss aggregate for one opening, from the USER's point of view. */
export interface OpeningStat {
  name: string;
  eco?: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** (wins + 0.5·draws) / games, in [0,1]. */
  score: number;
  /** Mean user accuracy% across analysed games in this opening; undefined if none. */
  accuracy?: number;
}

/** A diagnosed weakness. Ranked by `severity` × confidence weight. */
export interface Weakness {
  /** Stable id, e.g. "theme:fork", "phase:endgame", "blunders", "opening:Sicilian Defense". */
  id: string;
  kind: 'theme' | 'phase' | 'blunders' | 'opening';
  /** Short human label, e.g. "Fork" or "Endgame play". */
  label: string;
  /** One-line evidence, e.g. "solved 9/22 (41%) on fork puzzles". */
  detail: string;
  /** 0..1; higher = worse. */
  severity: number;
  confidence: Confidence;
  /** Backing data points (attempts or moves). */
  sampleSize: number;
  /** A puzzle theme to drill to attack this (opening/middlegame/endgame are themes too). */
  drillTheme?: string;
}

/** A short, prioritised coaching message with an actionable recommendation. */
export interface CoachingInsight {
  id: string;
  /** 1 = most important. */
  priority: number;
  title: string;
  detail: string;
  recommendation: string;
  /** Theme the "Drill this" action filters puzzles to (if applicable). */
  drillTheme?: string;
}

/** The full snapshot the Progress UI renders. Derived live; pure + deterministic. */
export interface ProgressSnapshot {
  /** True once there's ANY data (an attempt, an analysed game, or a saved game). */
  hasData: boolean;
  rating: { value: number; rd: number; provisional: boolean };
  puzzlesSolved: number;
  gamesPlayed: number;
  currentStreak: number;
  bestStreak: number;
  /** Overall accuracy across analysed games; undefined if nothing analysed. */
  overallGameAccuracy?: number;
  puzzles: PuzzleStats;
  games: GameStats;
  /** Win/loss by opening, most-played first. */
  openings: OpeningStat[];
  /** Ranked worst-first. */
  weaknesses: Weakness[];
  /** The top 2–4 prioritised coaching messages. */
  insights: CoachingInsight[];
}

/** One analysed game: a cached report paired with its saved-game metadata. */
export interface AnalyzedGame {
  report: GameReport;
  game: SavedGame;
}

/** Everything buildProgressSnapshot needs. The Progress controller assembles this by
 *  reading PuzzleStore + GameRepository + AnalysisStore; the function itself is pure. */
export interface SnapshotInput {
  attempts: PuzzleAttempt[];
  /** Current Glicko state; undefined → the fresh Lichess seed. */
  rating?: RatingState;
  analyzedGames: AnalyzedGame[];
  /** Count of saved games (analysed or not), for the "games played" headline. */
  totalGames: number;
  /** Finished games reduced to opening + result + color (detected outside the coach).
   *  Optional so existing callers/tests need not supply it. */
  gameOpenings?: GameOpeningRecord[];
}
