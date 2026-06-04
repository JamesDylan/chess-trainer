// Orchestrates puzzle solving: shows a position oriented to the solver, accepts
// board moves, validates them through a PuzzleSession (pure core), rates the user
// with Glicko-2, and persists progress. It mirrors GameController but is a SEPARATE
// seam — it drives its OWN BoardView instance and never touches the play game,
// engine, or GameRepository. Reuses BoardView (incl. `shapes` for hint arrows),
// legalDests (`computeMoves`), and promotion (`pickPromotion`) verbatim.
//
// Solve model:
//   - A WRONG move never ends the puzzle: the position is left unchanged and you keep
//     trying. The first unassisted miss is recorded as a fail (rating down once,
//     streak reset); after that, wrong moves just say "try again".
//   - HINTS are graduated: the first request highlights the piece to move, the second
//     draws the full solution arrow. Using ANY hint "freezes" the rating for that
//     puzzle (no gain, no loss) but a solve still counts toward the streak/daily goal.
//   - A CLEAN solve (no miss, no hint) raises the rating.
//   - The hint marker clears automatically once a move is made, and you can step
//     backward/forward through the moves played (← / →), like game review.

import { PuzzleSession, selectNextPuzzle } from '../puzzles';
import type { Puzzle, PuzzleAttempt } from '../puzzles';
import type { PuzzleStore } from '../puzzles';
import { initialRating, updateForAttempt, isEstablished, type RatingState } from '../core/rating';
import { computeMoves } from './legalDests';
import { BoardView, type Side, type BoardShape } from './boardView';
import { pickPromotion } from './promotion';
import type { StatusKind } from './gameController';
import { PUZZLE_DAILY_TARGET } from './config';

export type PuzzlePhase = 'loading' | 'empty' | 'in-progress' | 'solved';

/** Everything the puzzle panel needs to render. Emitted on every change. */
export interface PuzzleUiState {
  phase: PuzzlePhase;
  message: string;
  messageKind: StatusKind;
  /** User rating (rounded) + uncertainty. */
  rating: number;
  rd: number;
  provisional: boolean;
  /** Signed rating change from the just-finished attempt (rounded); undefined if frozen/none. */
  lastDelta?: number;
  streak: number;
  solvedToday: number;
  dailyTarget: number;
  /** Current puzzle meta (when one is loaded). */
  puzzleId?: string;
  puzzleRating?: number;
  puzzleThemes?: string[];
  solverColor?: Side;
  /** Solver progress within the current line. */
  movesMade: number;
  totalMoves: number;
  /** Hint stage: 0 none, 1 piece highlighted, 2 full solution arrow. */
  hintLevel: number;
  canHint: boolean;
  /** True once any hint was used this puzzle (rating frozen). */
  assisted: boolean;
  /** Theme filter: the options to offer + the active one ('' = all). */
  availableThemes: string[];
  activeTheme: string;
  /** Move navigation (stepping through the line played so far). */
  canBack: boolean;
  canForward: boolean;
  navIndex: number;
  navTotal: number;
}

export interface PuzzleControllerCallbacks {
  onState(state: PuzzleUiState): void;
  onStatus(text: string, kind: StatusKind): void;
}

const RECENT_LIMIT = 30;

export class PuzzleController {
  private puzzles: Puzzle[] = [];
  private availableThemes: string[] = [];
  private rating: RatingState = initialRating();
  private session: PuzzleSession | null = null;
  private readonly recentIds: string[] = [];
  private streak = 0;
  private solvedToday = 0;
  private ready = false; // progress loaded from the store

  // Per-puzzle attempt state.
  private assisted = false; // a hint was used → rating frozen
  private missed = false; // an unassisted wrong move happened → recorded as a fail
  private resultRecorded = false; // the rating/streak outcome was already applied
  private hintLevel = 0; // 0 none, 1 piece, 2 solution arrow
  private lastDelta?: number;
  private activeTheme = ''; // '' = all themes

  // Move navigation: positions[i] is the board after the i-th played half-move
  // (index 0 = the position the solver first sees). viewIndex is the shown one.
  private positions: Array<{ fen: string; lastMove?: [string, string] }> = [];
  private viewIndex = 0;

  // Last emitted status, re-used when navigation re-renders without new feedback.
  private phase: PuzzlePhase = 'loading';
  private message = '';
  private messageKind: StatusKind = 'info';

  // Bumped on every start/next so an in-flight promotion picker can be discarded.
  private generation = 0;

  constructor(
    private readonly board: BoardView,
    private readonly store: PuzzleStore,
    private readonly cb: PuzzleControllerCallbacks,
  ) {}

  /** Load persisted rating + attempt history (streak, solved-today), then start. */
  async init(): Promise<void> {
    try {
      this.rating = (await this.store.loadRating()) ?? initialRating();
      const attempts = await this.store.listAttempts();
      this.recomputeProgress(attempts);
    } catch {
      this.rating = initialRating();
    }
    this.ready = true;
    this.startNextIfPossible();
  }

  /** Provide (or replace) the puzzle set; (re)starts when ready. */
  setPuzzles(puzzles: Puzzle[]): void {
    this.puzzles = puzzles;
    this.availableThemes = topThemes(puzzles);
    this.startNextIfPossible();
  }

  private startNextIfPossible(): void {
    if (this.ready && this.puzzles.length > 0 && !this.session) this.startNext();
  }

  /** Pick and present the next puzzle near the user's rating. */
  startNext(): void {
    this.generation += 1;
    this.assisted = false;
    this.missed = false;
    this.resultRecorded = false;
    this.hintLevel = 0;
    this.lastDelta = undefined;

    const themes = this.activeTheme ? [this.activeTheme] : undefined;
    const puzzle = selectNextPuzzle(this.puzzles, {
      rating: this.rating.rating,
      excludeIds: this.recentIds,
      themes,
    });
    if (!puzzle) {
      this.session = null;
      this.positions = [];
      this.emit('empty', this.activeTheme ? `No puzzles match the "${this.activeTheme}" filter.` : 'No puzzles loaded.', 'info');
      return;
    }

    this.session = new PuzzleSession(puzzle);
    this.rememberRecent(puzzle.id);
    this.rebuildPositions(); // [post-setup position]; the setup move is highlighted
    this.renderBoard();
    const side = this.session.solverColor === 'white' ? 'White' : 'Black';
    this.emit('in-progress', `Your move — find the best line for ${side}.`, 'info');
  }

  /** Graduated hint: 1st → highlight the piece; 2nd → draw the solution arrow. */
  hint(): void {
    if (!this.session || this.session.isComplete()) return;
    this.assisted = true; // any hint freezes the rating for this puzzle
    this.hintLevel = Math.min(2, this.hintLevel + 1);
    this.viewIndex = this.liveIndex(); // snap to the live position so the mark shows
    this.renderBoard();
    const msg =
      this.hintLevel >= 2
        ? 'Solution — the arrow shows the move. (Rating frozen for this puzzle.)'
        : 'Hint — the highlighted piece moves. (Rating frozen for this puzzle.)';
    this.emit('in-progress', msg, 'info');
  }

  /** Apply a theme filter ('' = all) and start a fresh puzzle. */
  setTheme(theme: string): void {
    this.activeTheme = theme;
    this.session = null;
    this.startNext();
  }

  // --- move navigation (step through the line played so far) ------------------

  navBack(): void {
    if (!this.session || this.viewIndex <= 0) return;
    this.viewIndex -= 1;
    this.renderBoard();
    this.pushState();
  }

  navForward(): void {
    if (!this.session || this.viewIndex >= this.liveIndex()) return;
    this.viewIndex += 1;
    this.renderBoard();
    this.pushState();
  }

  /** A move was completed on the board (BoardView after-move event). */
  async handleUserMove(from: string, to: string): Promise<void> {
    if (!this.session || this.session.isComplete() || !this.isLive()) {
      this.renderBoard();
      return;
    }
    const fen = this.session.fen();
    const turn: Side = fen.split(' ')[1] === 'b' ? 'black' : 'white';
    if (turn !== this.session.solverColor) {
      this.renderBoard();
      return;
    }

    let uci = from + to;
    if (computeMoves(fen).isPromotion(from, to)) {
      const gen = this.generation;
      const piece = await pickPromotion(this.session.solverColor);
      if (gen !== this.generation || !this.session) return; // puzzle changed during the picker
      uci = from + to + piece;
    }

    const result = this.session.tryMove(uci);

    if (!result.correct) {
      // Wrong: the position is unchanged — keep trying. Record the first unassisted
      // miss as a fail; after that (or if a hint was used) just nudge to retry.
      if (!this.assisted && !this.resultRecorded) {
        this.missed = true;
        this.recordResult(false);
        this.renderBoard();
        this.emit('in-progress', `Not the move — counted as missed (${this.signed(this.lastDelta)}). Keep trying.`, 'error');
      } else {
        this.renderBoard();
        this.emit('in-progress', 'Not the move — try again.', 'error');
      }
      return;
    }

    // Correct: the hint clears once a move is made, and the line advances.
    this.hintLevel = 0;
    this.rebuildPositions();

    if (result.status === 'solved') {
      this.recordResult(true);
      this.renderBoard();
      this.emit('solved', this.solveMessage(), this.missed ? 'info' : 'gameover');
      return;
    }

    this.renderBoard();
    this.emit('in-progress', 'Correct — keep going.', 'info');
  }

  /** Apply the rating/streak outcome once per puzzle and persist it. */
  private recordResult(solved: boolean): void {
    if (this.resultRecorded || !this.session) return;
    this.resultRecorded = true;
    const puzzle = this.session.puzzle;
    const before = this.rating;
    let after = before;
    let delta: number | undefined;

    if (solved && this.assisted) {
      // Assisted solve: rating frozen, but it still counts toward streak/daily.
      this.streak += 1;
      this.solvedToday += 1;
      delta = undefined;
    } else if (solved) {
      after = updateForAttempt(before, puzzle.rating, puzzle.ratingDeviation, true);
      delta = Math.round(after.rating - before.rating);
      this.streak += 1;
      this.solvedToday += 1;
    } else {
      // Unassisted miss.
      after = updateForAttempt(before, puzzle.rating, puzzle.ratingDeviation, false);
      delta = Math.round(after.rating - before.rating);
      this.streak = 0;
    }
    this.rating = after;
    this.lastDelta = delta;

    const attempt: PuzzleAttempt = {
      puzzleId: puzzle.id,
      solved,
      at: Date.now(),
      puzzleRating: puzzle.rating,
      ratingBefore: Math.round(before.rating),
      ratingAfter: Math.round(after.rating),
      ratingDelta: delta ?? 0,
      rdAfter: Math.round(after.rd),
      // Stage 4: persist the puzzle's themes + whether a hint was used, so per-theme
      // and assisted-vs-clean coaching is derivable from the attempt log alone.
      themes: puzzle.themes,
      assisted: this.assisted,
    };
    void this.persist(after, attempt);
  }

  private async persist(state: RatingState, attempt: PuzzleAttempt): Promise<void> {
    try {
      await this.store.saveRating(state);
      await this.store.appendAttempt(attempt);
    } catch {
      this.cb.onStatus('Could not save puzzle progress (storage unavailable).', 'error');
    }
  }

  private solveMessage(): string {
    if (this.missed) return 'Correct — but this one was counted as missed.';
    if (this.assisted) return 'Solved with a hint — rating unchanged.';
    return `Solved! ${this.signed(this.lastDelta)}`;
  }

  // --- rendering -------------------------------------------------------------

  private liveIndex(): number {
    return Math.max(0, this.positions.length - 1);
  }

  private isLive(): boolean {
    return this.viewIndex >= this.liveIndex();
  }

  private rebuildPositions(): void {
    if (!this.session) {
      this.positions = [];
      this.viewIndex = 0;
      return;
    }
    this.positions = this.session.playedLine().map((e) => ({
      fen: e.fenAfter,
      lastMove: [e.uci.slice(0, 2), e.uci.slice(2, 4)] as [string, string],
    }));
    this.viewIndex = this.liveIndex(); // jump to the latest position
  }

  private renderBoard(): void {
    if (!this.session || this.positions.length === 0) return;
    this.viewIndex = Math.max(0, Math.min(this.liveIndex(), this.viewIndex));
    const atLive = this.isLive();
    const pos = this.positions[this.viewIndex];
    const { dests, inCheck } = computeMoves(pos.fen);
    const turn: Side = pos.fen.split(' ')[1] === 'b' ? 'black' : 'white';
    const solverToMove = atLive && !this.session.isComplete() && turn === this.session.solverColor;

    const shapes: BoardShape[] = [];
    if (atLive && !this.session.isComplete() && this.hintLevel > 0) {
      const expected = this.session.expectedMove();
      if (expected) {
        if (this.hintLevel >= 2) {
          shapes.push({ orig: expected.slice(0, 2), dest: expected.slice(2, 4), brush: 'blue' });
        } else {
          shapes.push({ orig: expected.slice(0, 2), brush: 'yellow' });
        }
      }
    }

    this.board.render({
      fen: pos.fen,
      orientation: this.session.solverColor,
      turnColor: turn,
      movableColor: solverToMove ? this.session.solverColor : undefined,
      dests: solverToMove ? dests : new Map(),
      lastMove: pos.lastMove,
      inCheck,
      shapes,
    });
  }

  private emit(phase: PuzzlePhase, message: string, kind: StatusKind): void {
    this.phase = phase;
    this.message = message;
    this.messageKind = kind;
    this.pushState();
  }

  private pushState(): void {
    const s = this.session;
    const live = this.liveIndex();
    this.cb.onState({
      phase: this.phase,
      message: this.message,
      messageKind: this.messageKind,
      rating: Math.round(this.rating.rating),
      rd: Math.round(this.rating.rd),
      provisional: !isEstablished(this.rating),
      lastDelta: this.lastDelta,
      streak: this.streak,
      solvedToday: this.solvedToday,
      dailyTarget: PUZZLE_DAILY_TARGET,
      puzzleId: s?.puzzle.id,
      puzzleRating: s?.puzzle.rating,
      puzzleThemes: s?.puzzle.themes,
      solverColor: s?.solverColor,
      movesMade: s ? s.solverMovesMade() : 0,
      totalMoves: s ? s.totalSolverMoves() : 0,
      hintLevel: this.hintLevel,
      canHint: !!s && !s.isComplete() && this.hintLevel < 2,
      assisted: this.assisted,
      availableThemes: this.availableThemes,
      activeTheme: this.activeTheme,
      canBack: !!s && this.viewIndex > 0,
      canForward: !!s && this.viewIndex < live,
      navIndex: this.viewIndex,
      navTotal: live,
    });
  }

  private signed(delta?: number): string {
    if (delta === undefined) return '';
    return delta >= 0 ? `+${delta}` : `${delta}`;
  }

  private rememberRecent(id: string): void {
    this.recentIds.push(id);
    while (this.recentIds.length > RECENT_LIMIT) this.recentIds.shift();
  }

  /** Trailing solved-streak + today's solve count from the persisted attempt log. */
  private recomputeProgress(attempts: PuzzleAttempt[]): void {
    let streak = 0;
    for (let i = attempts.length - 1; i >= 0; i -= 1) {
      if (attempts[i].solved) streak += 1;
      else break;
    }
    this.streak = streak;
    const today = new Date().toDateString();
    this.solvedToday = attempts.filter((a) => a.solved && new Date(a.at).toDateString() === today).length;
  }
}

/** Most common themes across the puzzle set (for the filter dropdown). */
function topThemes(puzzles: Puzzle[], limit = 14): string[] {
  const counts = new Map<string, number>();
  for (const p of puzzles) {
    for (const t of p.themes) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t]) => t);
}
