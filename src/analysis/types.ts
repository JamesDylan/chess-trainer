// Analysis-layer types (Stage 2). These sit ON TOP of the Stage 0 core
// (src/core/types.ts, src/core/evalMath.ts) and the engine seam; they do not
// modify any of them. The analyzer turns a saved game's PGN + a full-strength
// engine into a per-move accuracy/classification report.

import type { Color, GameResult, MoveClass, Score } from '../core/types';

/**
 * The slice of `UciEngine` the analyzer needs. Declaring it structurally (rather
 * than importing the concrete class) keeps the analyzer unit-testable with a
 * scripted fake engine and re-states the contract: configure once, then search a
 * position by depth and read the resulting score off `lastInfo`. The real
 * `UciEngine` satisfies this interface UNCHANGED.
 */
export interface AnalysisEngine {
  newGame(): Promise<void>;
  setStrength(opts: import('../core/types').EngineOptions): Promise<void>;
  bestMove(
    position: import('../engine/types').EnginePosition,
    limits?: import('../engine/types').GoLimits,
  ): Promise<import('../core/types').BestMove>;
  /** Last `info` line that carried a score, from the most recent search. */
  lastInfo?: import('../core/types').InfoLine;
}

/** Why a position carries no engine evaluation (the game is already decided there). */
export type TerminalKind = 'checkmate' | 'draw';

/** One analysed half-move (ply). All win% values are in the MOVER's point of view. */
export interface MoveAnalysis {
  /** 1-based half-move index. */
  ply: number;
  /** Full-move number (1, 1, 2, 2, …). */
  moveNumber: number;
  /** The side that made this move. */
  mover: Color;
  /** SAN of the move played (e.g. "Nf3", "Qxe5+"). */
  san: string;
  /** FEN before the move (mover to move). */
  fenBefore: string;
  /** FEN after the move (opponent to move, or terminal). */
  fenAfter: string;
  /** [from, to] squares of the move, inferred from the FEN pair (for board highlight). */
  lastMove?: [string, string];
  /** Engine score of `fenBefore`, side-to-move (= mover) POV. */
  scoreBefore: Score;
  /** Engine/synthetic score of `fenAfter`, side-to-move (= opponent) POV. */
  scoreAfter: Score;
  /** Set when `fenAfter` is a terminal position (no engine eval taken there). */
  terminal?: TerminalKind;
  /** Mover-POV win% before the move = scoreToWinPercent(scoreBefore). */
  winBefore: number;
  /** Mover-POV win% after the move = 100 - scoreToWinPercent(scoreAfter). */
  winAfter: number;
  /** Per-move accuracy% in [0,100] from winPercentToAccuracy(winBefore, winAfter). */
  accuracy: number;
  /** Move-quality label from classifyMove(winBefore, winAfter). */
  classification: MoveClass;
  /** Mover-POV centipawn loss (>= 0), used for ACPL. */
  cpLoss: number;
  /** The engine's best move at `fenBefore`, as UCI (for the board suggestion arrow). */
  bestMoveUci?: string;
  /** The engine's best move at `fenBefore`, as SAN (for display). */
  bestMoveSan?: string;
  /** True when the move played equals the engine's best move. */
  isBest: boolean;
}

/** Counts of each move class for one player. */
export interface ClassCounts {
  best: number;
  excellent: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  blunder: number;
}

/** Per-player aggregates over their own moves. */
export interface PlayerReport {
  color: Color;
  /** Number of moves this player made. */
  moveCount: number;
  /** Game accuracy% = harmonic mean of this player's per-move accuracies. */
  accuracy: number;
  /** Average centipawn loss across this player's moves. */
  acpl: number;
  /** How many of this player's moves fell into each class. */
  counts: ClassCounts;
}

/** The full analysis report for one game. */
export interface GameReport {
  /** Report schema version (bump to invalidate cached reports after a format change). */
  version: number;
  /** PGN this report was computed from (used to invalidate a cached report). */
  pgn: string;
  /** Final result of the game as analysed. */
  result: GameResult;
  /** Every analysed ply, in order. */
  moves: MoveAnalysis[];
  /** White's aggregate report. */
  white: PlayerReport;
  /** Black's aggregate report. */
  black: PlayerReport;
  /** Search depth used for engine evaluations. */
  depth: number;
  /** When the analysis finished (epoch ms). */
  analyzedAt: number;
}

/** Tunables + hooks for a single `analyzeGame` run. */
export interface AnalyzeOptions {
  /** Fixed search depth per position (REFERENCE: deeper than play). Default 16. */
  depth?: number;
  /** MultiPV for the engine (1 is enough for a single-line eval). Default 1. */
  multipv?: number;
  /**
   * Centipawn-loss weight for "closeness to best" accuracy/classification (see
   * evalMath.effectiveWinDrop). Default 0 = pure Lichess win%-based scoring; the app
   * passes a small value so imprecision in won positions still counts.
   */
  cpLossWeight?: number;
  /**
   * Progress callback: `done` non-terminal positions evaluated out of `total`.
   * Called once before the first search (0/total) and after each evaluation.
   */
  onProgress?: (done: number, total: number) => void;
  /** Cooperative cancellation: checked before each search; throws if aborted. */
  shouldCancel?: () => boolean;
}
