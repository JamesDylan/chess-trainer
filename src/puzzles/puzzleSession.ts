// The puzzle solver state machine — PURE and DETERMINISTIC (no engine, no DOM).
//
// It drives a ChessGame (the single source of truth for legality/turns, reused
// VERBATIM) through one Lichess puzzle:
//   1. On construction, auto-apply moves[0] (the opponent's SETUP move) so it is the
//      solver's turn.
//   2. Each user move is validated against the expected solution move (the solver
//      plays the ODD indices). A correct, non-final move auto-plays the opponent's
//      reply (the next EVEN index) and advances.
//   3. The attempt is SOLVED when the solver plays the last move in the line, and
//      FAILED on the first wrong move.
//
// Rule v1: require the EXACT solution UCI. Refinement (on by default, see
// `acceptAnyMate`): when the expected solution move delivers checkmate, also accept
// ANY legal user move that gives immediate checkmate — Lichess accepts alternate
// mates-in-one, and the expected move is by definition the final move of the line.

import { ChessGame } from '../core/chessGame';
import type { Color } from '../core/types';
import type { Puzzle, PuzzleMoveResult, PuzzleStatus } from './types';

export interface PuzzleSessionOptions {
  /** Accept any move that gives immediate checkmate when the solution is mate. Default true. */
  acceptAnyMate?: boolean;
}

function normalizeUci(uci: string): string {
  return uci.trim().toLowerCase();
}

export class PuzzleSession {
  private readonly game: ChessGame;
  private readonly acceptAnyMate: boolean;
  /** Index in `puzzle.moves` of the next expected SOLVER move (odd; 1, 3, 5, …). */
  private idx = 1;
  private _status: PuzzleStatus = 'in-progress';
  private _solverMovesMade = 0;
  /** Every half-move applied so far (setup, then solver/opponent), with the FEN after. */
  private readonly line: { uci: string; fenAfter: string }[] = [];

  /** The side the user is solving for (the side to move after the setup move). */
  readonly solverColor: Color;
  /** The opponent's setup move that was auto-applied (UCI). */
  readonly setupMove: string;

  constructor(readonly puzzle: Puzzle, opts: PuzzleSessionOptions = {}) {
    if (!puzzle.moves || puzzle.moves.length < 2) {
      throw new Error(`puzzle ${puzzle.id}: needs at least a setup move + one reply`);
    }
    this.acceptAnyMate = opts.acceptAnyMate ?? true;
    this.game = new ChessGame(puzzle.fen);
    this.setupMove = puzzle.moves[0];
    if (!this.game.move(this.setupMove)) {
      throw new Error(`puzzle ${puzzle.id}: illegal setup move "${this.setupMove}" for FEN ${puzzle.fen}`);
    }
    this.line.push({ uci: this.setupMove, fenAfter: this.game.fen() });
    this.solverColor = this.game.turn();
    // Degenerate data guard: if the setup move already ended the game, nothing to solve.
    if (this.game.isGameOver()) this._status = 'solved';
  }

  get status(): PuzzleStatus {
    return this._status;
  }

  isComplete(): boolean {
    return this._status !== 'in-progress';
  }

  /** FEN of the current position (solver to move while in progress). */
  fen(): string {
    return this.game.fen();
  }

  /** The solution move the solver is expected to play now (UCI), or undefined if complete. */
  expectedMove(): string | undefined {
    return this.isComplete() ? undefined : this.puzzle.moves[this.idx];
  }

  /** SAN of the expected solution move (for "best was …" feedback), or undefined. */
  expectedSan(): string | undefined {
    const uci = this.expectedMove();
    if (!uci) return undefined;
    const probe = new ChessGame(this.game.fen());
    if (!probe.move(uci)) return undefined;
    return probe.history()[0];
  }

  /** How many solver moves have been played correctly so far. */
  solverMovesMade(): number {
    return this._solverMovesMade;
  }

  /** Total solver moves in the full solution (the count of odd indices). */
  totalSolverMoves(): number {
    return Math.ceil((this.puzzle.moves.length - 1) / 2);
  }

  /**
   * Every half-move applied so far, in order — the setup move, then each solver move
   * and the opponent's auto-reply — with the FEN after each. Index 0 is the position
   * the solver first sees. Used to step backward/forward through the attempt.
   */
  playedLine(): ReadonlyArray<{ uci: string; fenAfter: string }> {
    return this.line;
  }

  /**
   * Validate `uci` against the expected solution move and advance the state machine.
   * Returns the outcome; on a wrong move the position is left UNCHANGED at the
   * decision point so the UI can reveal the expected move.
   */
  tryMove(uci: string): PuzzleMoveResult {
    if (this.isComplete()) {
      return { correct: false, status: this._status, done: false };
    }
    const expected = this.puzzle.moves[this.idx];
    if (!this.isAccepted(uci, expected)) {
      // Wrong move: do NOT terminate the puzzle — leave the position UNCHANGED so the
      // solver can try again. Any rating/streak consequence is the caller's decision.
      return { correct: false, status: 'in-progress', done: false, expected };
    }

    // Apply the user's move (use their UCI so an accepted alternate mate is reflected).
    if (!this.game.move(uci)) {
      // Defensive: an "accepted" move should always be legal. Treat as a retryable miss.
      return { correct: false, status: 'in-progress', done: false, expected };
    }
    this._solverMovesMade += 1;
    this.line.push({ uci, fenAfter: this.game.fen() });

    const wasLast = this.idx >= this.puzzle.moves.length - 1;
    if (wasLast || this.game.isGameOver()) {
      this._status = 'solved';
      return { correct: true, status: 'solved', done: true };
    }

    // Auto-play the opponent's scripted reply (next even index), then advance.
    const reply = this.puzzle.moves[this.idx + 1];
    const replied = this.game.move(reply);
    if (replied) this.line.push({ uci: reply, fenAfter: this.game.fen() });
    this.idx += 2;

    if (!replied || this.idx > this.puzzle.moves.length - 1 || this.game.isGameOver()) {
      // Reply was the final scripted move (or data ended): the line is exhausted.
      this._status = 'solved';
      return { correct: true, status: 'solved', done: true, opponentReply: replied ? reply : undefined };
    }
    return { correct: true, status: 'in-progress', done: false, opponentReply: reply };
  }

  private isAccepted(uci: string, expected: string): boolean {
    if (normalizeUci(uci) === normalizeUci(expected)) return true;
    if (this.acceptAnyMate && this.givesMate(expected) && this.givesMate(uci)) return true;
    return false;
  }

  /** True if playing `uci` from the current position is legal and is checkmate. */
  private givesMate(uci: string): boolean {
    const probe = new ChessGame(this.game.fen());
    if (!probe.move(uci)) return false;
    return probe.isCheckmate();
  }
}

/** Convenience factory mirroring the rest of the seam's style. */
export function createPuzzleSession(puzzle: Puzzle, opts?: PuzzleSessionOptions): PuzzleSession {
  return new PuzzleSession(puzzle, opts);
}
