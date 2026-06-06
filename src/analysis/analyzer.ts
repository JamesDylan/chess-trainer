// The analyzer seam (Stage 2). Take a saved game's PGN and a FULL-STRENGTH engine
// and produce a per-move accuracy/classification report — the consumer the Stage 0
// eval math was built for.
//
// Design rules honoured here:
//   - Replays the PGN with ChessGame (the single source of truth for legality).
//   - Evaluates every distinct, NON-terminal position once, by DEPTH, via the
//     existing UciEngine seam (reads the score off `engine.lastInfo` after each
//     search). Terminal positions get no engine eval (REFERENCE/task requirement).
//   - Computes every per-move metric by REUSING src/core/evalMath.ts VERBATIM:
//     scoreToWinPercent, winPercentToAccuracy, classifyMove, averageCentipawnLoss,
//     harmonicMean. Nothing here re-implements a formula.
//   - Score is side-to-move POV and win% is symmetric, so the mover's
//     winAfter = 100 - scoreToWinPercent(next position's eval).

import { ChessGame } from '../core/chessGame';
import type { Color, GameResult, Score } from '../core/types';
import {
  scoreToWinPercent,
  accuracyFromWinDrop,
  classFromWinDrop,
  effectiveWinDrop,
  averageCentipawnLoss,
  harmonicMean,
  CP_CEILING,
} from '../core/evalMath';
import type {
  AnalysisEngine,
  AnalyzeOptions,
  ClassCounts,
  GameReport,
  MoveAnalysis,
  PlayerReport,
  TerminalKind,
} from './types';

/** Default fixed search depth per position — deeper than play (REFERENCE §2/§3). */
export const DEFAULT_ANALYSIS_DEPTH = 16;

/** Report schema version. Bump when MoveAnalysis/GameReport shape changes — or when the
 *  scoring changes — so the UI discards caches written by an older build. v2 added
 *  best-move fields; v3 switched accuracy/classification to the cp-weighted "closeness to
 *  best" (imprecision in won positions now counts). */
export const ANALYSIS_REPORT_VERSION = 3;

/** One position's engine result: its score and the engine's best move (UCI). */
interface PositionEval {
  score: Score;
  bestUci: string;
}

/** Thrown by `analyzeGame` when `opts.shouldCancel()` reports an abort. */
export class AnalysisCancelled extends Error {
  constructor() {
    super('analysis cancelled');
    this.name = 'AnalysisCancelled';
  }
}

/** One replayed ply: the move and the positions either side of it. */
interface ReplayPly {
  san: string;
  mover: Color;
  fenBefore: string;
  fenAfter: string;
  /** Set when `fenAfter` ends the game (so it is never sent to the engine). */
  terminalAfter?: TerminalKind;
}

/**
 * Analyse a game from its PGN. Evaluates each position at `depth`, then derives
 * win%, accuracy, and classification per move (mover POV) and aggregates per
 * player. Engine is configured to FULL strength here; pass the real `UciEngine`
 * (it satisfies `AnalysisEngine`) or a scripted fake in tests.
 */
export async function analyzeGame(
  pgn: string,
  engine: AnalysisEngine,
  opts: AnalyzeOptions = {},
): Promise<GameReport> {
  const depth = opts.depth ?? DEFAULT_ANALYSIS_DEPTH;
  const multipv = opts.multipv ?? 1;
  const cpLossWeight = opts.cpLossWeight ?? 0;

  const { plies, result } = replay(pgn);

  // The distinct, non-terminal positions that need an engine evaluation, in order.
  // fenBefore of every ply is non-terminal (a move follows it); the final fenAfter
  // is added only when the game did NOT end (e.g. an in-progress or resigned game).
  const toEval: string[] = [];
  const seen = new Set<string>();
  const need = (fen: string): void => {
    if (!seen.has(fen)) {
      seen.add(fen);
      toEval.push(fen);
    }
  };
  for (const p of plies) need(p.fenBefore);
  const last = plies[plies.length - 1];
  if (last && last.terminalAfter === undefined) need(last.fenAfter);

  // Configure the engine to full strength (REFERENCE §3): no limit, skill 20.
  await engine.newGame();
  await engine.setStrength({ limitStrength: false, skillLevel: 20, movetimeMs: 1000, multipv });

  // Evaluate by depth, reading the score off lastInfo and the best move off the
  // returned bestmove after each search.
  const evalByFen = new Map<string, PositionEval>();
  const total = toEval.length;
  opts.onProgress?.(0, total);
  let done = 0;
  for (const fen of toEval) {
    if (opts.shouldCancel?.()) throw new AnalysisCancelled();
    const { best } = await engine.bestMove({ fen }, { depth });
    // Stockfish always emits at least one scored info line before bestmove; fall
    // back to an even position if a search somehow returned none.
    evalByFen.set(fen, { score: engine.lastInfo?.score ?? { cp: 0 }, bestUci: best });
    done += 1;
    opts.onProgress?.(done, total);
  }

  const moves: MoveAnalysis[] = plies.map((p, i) =>
    buildMoveAnalysis(p, i, evalByFen, cpLossWeight),
  );

  return {
    version: ANALYSIS_REPORT_VERSION,
    pgn,
    result,
    moves,
    white: aggregate(moves, 'white'),
    black: aggregate(moves, 'black'),
    depth,
    analyzedAt: Date.now(),
  };
}

/** Replay a PGN into per-ply positions. Assumes the standard start position
 *  (true for every game this app saves). */
function replay(pgn: string): { plies: ReplayPly[]; result: GameResult } {
  const loaded = new ChessGame();
  loaded.loadPgn(pgn);
  const sans = loaded.history();
  const result = loaded.result();

  const board = new ChessGame();
  const plies: ReplayPly[] = [];
  for (const san of sans) {
    const fenBefore = board.fen();
    const mover = board.turn();
    if (!board.move(san)) {
      throw new Error(`analyzer: could not replay move "${san}" from ${fenBefore}`);
    }
    const fenAfter = board.fen();
    const terminalAfter: TerminalKind | undefined = board.isGameOver()
      ? board.isCheckmate()
        ? 'checkmate'
        : 'draw'
      : undefined;
    plies.push({ san, mover, fenBefore, fenAfter, terminalAfter });
  }
  return { plies, result };
}

/** Derive one move's metrics from the position evals, reusing evalMath verbatim. */
function buildMoveAnalysis(
  p: ReplayPly,
  index: number,
  evalByFen: Map<string, PositionEval>,
  cpLossWeight: number,
): MoveAnalysis {
  const before = evalByFen.get(p.fenBefore);
  const scoreBefore = before?.score ?? { cp: 0 };
  const winBefore = scoreToWinPercent(scoreBefore);

  let scoreAfter: Score;
  let winAfter: number;
  if (p.terminalAfter === 'checkmate') {
    // The mover delivered mate: the side to move in fenAfter is mated, so the
    // mover's win% is 100. scoreAfter is a display sentinel only — the win%
    // is set directly here and never run through scoreToWinPercent.
    scoreAfter = { mate: 0 };
    winAfter = 100;
  } else if (p.terminalAfter === 'draw') {
    scoreAfter = { cp: 0 };
    winAfter = 50;
  } else {
    scoreAfter = evalByFen.get(p.fenAfter)?.score ?? { cp: 0 };
    // win% is symmetric: flip the opponent-POV win% to the mover's POV.
    winAfter = 100 - scoreToWinPercent(scoreAfter);
  }

  // The engine's recommended move at the position the mover faced.
  const bestMoveUci = before?.bestUci;
  const bestMoveSan = bestMoveUci ? uciToSan(p.fenBefore, bestMoveUci) : undefined;

  const cpLoss = centipawnLoss(scoreBefore, scoreAfter, p.terminalAfter);
  // "Closeness to best": blend the win% drop with a cp-loss term so imprecision in a
  // won position still counts. cpLossWeight = 0 reproduces the pure win% scoring exactly.
  const effDrop = effectiveWinDrop(winBefore, winAfter, cpLoss, cpLossWeight);

  return {
    ply: index + 1,
    moveNumber: Math.floor(index / 2) + 1,
    mover: p.mover,
    san: p.san,
    fenBefore: p.fenBefore,
    fenAfter: p.fenAfter,
    lastMove: inferLastMove(p.fenBefore, p.fenAfter),
    scoreBefore,
    scoreAfter,
    terminal: p.terminalAfter,
    winBefore,
    winAfter,
    accuracy: accuracyFromWinDrop(effDrop),
    classification: classFromWinDrop(effDrop),
    cpLoss,
    bestMoveUci,
    bestMoveSan,
    isBest: bestMoveSan !== undefined && bestMoveSan === p.san,
  };
}

/** Convert a UCI move to SAN in the context of `fen` (reuses ChessGame). Returns
 *  undefined if the move is not legal there (e.g. a scripted/garbage move). */
function uciToSan(fen: string, uci: string): string | undefined {
  const g = new ChessGame(fen);
  if (!g.move(uci)) return undefined;
  const history = g.history();
  return history[history.length - 1];
}

/** Aggregate one player's moves: harmonic-mean accuracy, ACPL, class counts. */
function aggregate(moves: MoveAnalysis[], color: Color): PlayerReport {
  const own = moves.filter((m) => m.mover === color);
  const counts: ClassCounts = {
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
  for (const m of own) counts[m.classification] += 1;
  return {
    color,
    moveCount: own.length,
    // Game accuracy = harmonic mean of per-move accuracies (REFERENCE §1.5).
    // (Lichess additionally volatility-weights this; left as an optional refinement.)
    accuracy: harmonicMean(own.map((m) => m.accuracy)),
    acpl: averageCentipawnLoss(own.map((m) => m.cpLoss)),
    counts,
  };
}

/**
 * Mover-POV centipawn loss (>= 0) for ACPL. Mate/terminal map to a bounded ±CP_CEILING.
 * Exported so the live coach (Stage 5) computes cp loss with the EXACT same convention
 * instead of forking the math — pass `terminalAfter: undefined` for a live, non-terminal
 * post-move position.
 */
export function centipawnLoss(
  scoreBefore: Score,
  scoreAfter: Score,
  terminalAfter: TerminalKind | undefined,
): number {
  const cpBefore = scoreToCp(scoreBefore); // mover POV (fenBefore side to move = mover)
  let cpAfter: number;
  if (terminalAfter === 'checkmate') cpAfter = CP_CEILING; // mover won
  else if (terminalAfter === 'draw') cpAfter = 0;
  else cpAfter = -scoreToCp(scoreAfter); // flip opponent POV to mover POV
  return Math.max(0, cpBefore - cpAfter);
}

/** Bounded centipawns from a Score (side-to-move POV). Mate -> ±CP_CEILING.
 *  Exported for reuse by the Stage 5 live coach (shared, not re-derived). */
export function scoreToCp(score: Score): number {
  if (score.cp !== undefined) {
    return Math.max(-CP_CEILING, Math.min(CP_CEILING, score.cp));
  }
  const m = score.mate ?? 0;
  if (m === 0) return -CP_CEILING; // side to move is mated
  return Math.sign(m) * CP_CEILING;
}

// --- last-move inference (for the board-review highlight) --------------------

/**
 * Infer the [from, to] squares of the move between two FENs, for highlighting in
 * the board review. Best-effort and view-only: it compares piece placement and,
 * for castling, reports the king's squares. ChessGame remains the source of truth
 * for legality; this never affects analysis numbers.
 */
export function inferLastMove(fenBefore: string, fenAfter: string): [string, string] | undefined {
  const before = parsePlacement(fenBefore);
  const after = parsePlacement(fenAfter);
  const stm = fenBefore.split(' ')[1]; // 'w' | 'b'
  const isMover = (pc: string): boolean => (stm === 'w' ? pc === pc.toUpperCase() : pc === pc.toLowerCase());

  const froms: string[] = [];
  const tos: string[] = [];
  const squares = new Set<string>([...before.keys(), ...after.keys()]);
  for (const sq of squares) {
    const b = before.get(sq);
    const a = after.get(sq);
    if (a === b) continue;
    if (a && isMover(a)) tos.push(sq); // a mover piece now sits here
    if (b && isMover(b) && !a) froms.push(sq); // a mover piece left here
  }
  const isKing = (sq: string, map: Map<string, string>): boolean => (map.get(sq) ?? '').toLowerCase() === 'k';
  const to = tos.find((sq) => isKing(sq, after)) ?? tos[0];
  const from = froms.find((sq) => isKing(sq, before)) ?? froms[0];
  return from && to ? [from, to] : undefined;
}

/** Parse a FEN's piece-placement field into a square -> piece map (e.g. "e4" -> "P"). */
function parsePlacement(fen: string): Map<string, string> {
  const placement = fen.split(' ')[0];
  const ranks = placement.split('/'); // index 0 = rank 8
  const map = new Map<string, string>();
  for (let r = 0; r < ranks.length; r += 1) {
    const rank = 8 - r;
    let file = 0;
    for (const ch of ranks[r]) {
      if (ch >= '1' && ch <= '9') {
        file += Number(ch);
      } else {
        const square = String.fromCharCode(97 + file) + String(rank);
        map.set(square, ch);
        file += 1;
      }
    }
  }
  return map;
}
