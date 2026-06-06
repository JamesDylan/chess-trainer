// Orchestrates a game: human moves on the board, engine replies, game-over is
// detected, and the game is persisted. Reuses the Stage 0/1 core UNCHANGED —
// ChessGame (state), UciEngine (the transport-agnostic driver), eloToEngineOptions
// (strength mapping) — and a GameRepository for persistence.
//
// Persistence model:
//   - Save: keep the current unfinished game (result '*', inProgress: true) so it
//     can be resumed later. Starting/resuming another game auto-preserves the
//     current one first, so a game is never silently lost.
//   - Resume: reload a saved in-progress game into a PLAYABLE state.
//   - Resign: concede the current game (engine wins) and persist it as finished.
//   - A game that reaches checkmate/draw is finalized and persisted automatically.
//
// Stage 1 acceptance gate lives in engineMove(): every engine bestmove is applied
// to ChessGame and MUST succeed (be legal). An illegal reply halts play loudly.

import { ChessGame } from '../core/chessGame';
import { eloToEngineOptions } from '../core/strength';
import type { GameResult } from '../core/types';
import type { UciEngine } from '../engine/uciEngine';
import type { GameRepository, SavedGame } from '../persistence/types';
import { inferLastMove } from '../analysis/analyzer';
import { computeMoves } from './legalDests';
import { BoardView, type Side, type BoardShape } from './boardView';
import { materialFromFen, type MaterialTally } from './material';
import { pickPromotion } from './promotion';

export type StatusKind = 'info' | 'thinking' | 'gameover' | 'error';

/** Everything the UI needs to refresh after the board view changes (move played,
 *  navigation, undo, analysis review). Emitted on every render. */
export interface ViewState {
  /** Whether the player can take their last move back right now. */
  canUndo: boolean;
  /** Whether there's an earlier position to step back to. */
  canBack: boolean;
  /** Whether there's a later position to step forward to. */
  canForward: boolean;
  /** The ply currently shown (0 = start, totalPlies = live position). */
  ply: number;
  /** Number of plies in the game. */
  totalPlies: number;
  /** Captured-piece tally + point advantage for the shown position. */
  material: MaterialTally;
  /** Color shown at the bottom of the board (for placing captured pieces). */
  orientation: Side;
}

/**
 * Stage 5 hook: a "position settled" event the live coach listens to. Fired AFTER a
 * move is applied and rendered (never mid-search). When `isHumanMove` the coach
 * reviews the move just played (eval the post-move position for the bar + use the
 * cached pre-move eval as scoreBefore); otherwise (engine reply / game start) the
 * coach just refreshes the eval bar and caches the new pre-move eval.
 */
export interface CoachMoveContext {
  /** FEN before the move that produced `fenAfter` (undefined at game start). */
  fenBefore?: string;
  /** FEN now on the board — the position to evaluate. */
  fenAfter: string;
  /** The move just played (UCI), undefined at game start. */
  uci?: string;
  /** Who played it (undefined at game start). */
  mover?: Side;
  /** True when this was the HUMAN's move (the coach reviews these). */
  isHumanMove: boolean;
}

export interface ControllerCallbacks {
  onStatus(text: string, kind: StatusKind): void;
  /** Called after a game is saved/updated, so the UI can refresh its list. */
  onGameSaved(): void;
  /** Called on every render with the current view state (buttons, captured pieces). */
  onViewUpdate(view: ViewState): void;
  /** Stage 5: a settled position to coach (only fired while Coach mode is on). */
  onCoachEval?(ctx: CoachMoveContext): void;
}

export class GameController {
  private game = new ChessGame();
  private engine: UciEngine | null = null;
  private humanColor: Side = 'white';
  private strengthElo = 1200;
  private thinking = false;
  private viewing = false; // read-only review of a finished game
  private reviewing = false; // read-only board review driven by the analysis stepper
  private resigned = false; // human conceded (board isn't terminal, but play stops)
  private finalized = false; // game finished + persisted as finished
  private undoUsed = false; // the human took a move back at some point this game
  private lastMove?: [string, string];
  // Ply currently shown on the board. Equals the game length when "live" (the
  // latest position, playable); a smaller value means the player is browsing back
  // through the game read-only. Reset to live whenever a move is made.
  private viewIndex = 0;
  private finalStatus?: string; // result text, re-shown when returning to a finished game's end
  // Bumped on every newGame/resume/viewPgn/resign. An in-flight engine search
  // captures the value and discards its result if the game changed underneath it.
  private generation = 0;
  // Id of this game's persisted record (in-progress or finished), once saved.
  private currentId?: number;
  // Stage 5 — Coach mode. When on, after a human move the controller hands the turn
  // to the coach (via onCoachEval) instead of auto-replying; the coach calls
  // requestEngineReply() to continue. `liveShapes` are the coach's green/red arrows,
  // drawn on the live board and cleared on every new move. Both default to off/empty,
  // so when Coach mode is never enabled the play loop is byte-for-byte the original.
  private coachMode = false;
  private liveShapes: BoardShape[] = [];

  constructor(
    private readonly board: BoardView,
    private readonly repo: GameRepository,
    private readonly cb: ControllerCallbacks,
  ) {}

  attachEngine(engine: UciEngine): void {
    this.engine = engine;
  }

  get currentStrength(): number {
    return this.strengthElo;
  }

  // --- Stage 5: Coach mode seam (additive) -----------------------------------

  /** Enable/disable Coach mode. When ON, the play loop hands the post-human-move
   *  turn to the coach (onCoachEval) instead of auto-replying. OFF restores the
   *  original behaviour exactly and clears any coach arrows. */
  setCoachMode(on: boolean): void {
    this.coachMode = on;
    if (!on) {
      this.liveShapes = [];
      this.render();
    }
  }

  /** Whether Coach mode is currently on. */
  get coachEnabled(): boolean {
    return this.coachMode;
  }

  /** Side shown at the bottom of the board (= the human's color) — for the eval bar. */
  get orientation(): Side {
    return this.humanColor;
  }

  /** Draw the coach's arrows on the live board (green best move / red refutation).
   *  Replaces any previous set; pass [] to clear. Only visible at the live position. */
  setLiveShapes(shapes: BoardShape[]): void {
    this.liveShapes = shapes;
    this.render();
  }

  /** Trigger the engine's reply on demand — the coach calls this to "Continue" after
   *  reviewing the human's move. No-op unless it's genuinely the engine's turn in a
   *  live, unfinished game (so a stray call can never inject an out-of-turn move). */
  requestEngineReply(): void {
    if (!this.engine || this.viewing || this.reviewing || this.finalized || this.resigned) return;
    if (this.game.isGameOver() || !this.isLive()) return;
    if (this.game.turn() === this.humanColor) return; // not the engine's turn
    void this.engineMove();
  }

  /** Whether it is currently the human's turn at the live position (used by the coach
   *  when it is toggled on mid-game to decide whether to seed a pre-move eval). */
  isHumanToMove(): boolean {
    return (
      !this.viewing &&
      !this.reviewing &&
      !this.finalized &&
      !this.resigned &&
      this.isLive() &&
      !this.game.isGameOver() &&
      this.game.turn() === this.humanColor
    );
  }

  /** Update the strength for the NEXT game; apply immediately if no moves played. */
  setStrengthElo(elo: number): void {
    this.strengthElo = elo;
    if (
      this.engine &&
      !this.viewing &&
      !this.thinking &&
      !this.finalized &&
      this.game.history().length === 0
    ) {
      void this.engine.setStrength(eloToEngineOptions(elo));
    }
  }

  async newGame(humanColor: Side, elo: number): Promise<void> {
    if (!this.engine) throw new Error('engine not attached');
    await this.persistInProgress(false); // don't lose the current unfinished game

    this.generation++;
    this.game = new ChessGame();
    this.humanColor = humanColor;
    this.strengthElo = elo;
    this.thinking = false;
    this.viewing = false;
    this.reviewing = false;
    this.resigned = false;
    this.finalized = false;
    this.undoUsed = false;
    this.lastMove = undefined;
    this.currentId = undefined;
    this.viewIndex = 0;
    this.finalStatus = undefined;
    this.liveShapes = [];

    await this.engine.newGame();
    await this.engine.setStrength(eloToEngineOptions(elo));
    this.render();

    // If the human chose Black, the engine (White) moves first.
    if (this.game.turn() !== this.humanColor) void this.engineMove();
    // Otherwise seed the coach's eval bar from the start position (human to move).
    else if (this.coachMode) this.cb.onCoachEval?.({ fenAfter: this.game.fen(), isHumanMove: false });
  }

  /** Resume a saved in-progress game into a PLAYABLE state. */
  async resume(saved: SavedGame): Promise<void> {
    if (!this.engine) throw new Error('engine not attached');
    const game = new ChessGame();
    try {
      game.loadPgn(saved.pgn);
    } catch {
      this.cb.onStatus('Could not resume that game (invalid PGN).', 'error');
      return;
    }
    await this.persistInProgress(false); // preserve any other unfinished game first

    this.generation++;
    this.game = game;
    this.humanColor = saved.humanColor;
    this.strengthElo = saved.strengthElo;
    this.thinking = false;
    this.viewing = false;
    this.reviewing = false;
    this.resigned = false;
    this.finalized = false;
    this.undoUsed = saved.undoUsed ?? false;
    this.lastMove = undefined;
    this.currentId = saved.id;
    this.viewIndex = game.history().length; // show the latest position
    this.finalStatus = undefined;
    this.liveShapes = [];

    await this.engine.newGame();
    await this.engine.setStrength(eloToEngineOptions(this.strengthElo));
    this.render();

    if (!this.game.isGameOver() && this.game.turn() !== this.humanColor) void this.engineMove();
    // Resumed on the human's turn: seed the coach's eval bar for the current position.
    else if (this.coachMode && !this.game.isGameOver())
      this.cb.onCoachEval?.({ fenAfter: this.game.fen(), isHumanMove: false });
  }

  /** Read-only review of a finished game (shows the final position). */
  viewPgn(pgn: string): void {
    const game = new ChessGame();
    try {
      game.loadPgn(pgn);
    } catch {
      this.cb.onStatus('Could not load that saved game (invalid PGN).', 'error');
      return;
    }
    this.generation++;
    this.game = game;
    this.viewing = true;
    this.reviewing = false;
    this.finalized = true;
    this.resigned = false;
    this.thinking = false;
    this.lastMove = undefined;
    this.currentId = undefined;
    this.viewIndex = game.history().length;
    this.liveShapes = [];
    this.render();
    this.cb.onStatus(`Viewing saved game (${game.result()}). Start a new game to play.`, 'info');
  }

  /**
   * Stage 2 board review: render an ARBITRARY position read-only (the analysis
   * stepper drives this as the user moves through a game). Extends the read-only
   * `viewPgn` path — it reuses the same BoardView, disables all input, and never
   * touches the live `ChessGame`, so resuming/starting a game afterwards is
   * unaffected. `lastMove` highlights the move that produced the position.
   */
  reviewPosition(
    fen: string,
    opts: { lastMove?: [string, string]; orientation?: Side; shapes?: BoardShape[] } = {},
  ): void {
    this.generation++; // discard any in-flight engine reply from the live game
    // Use a DEDICATED flag (not `viewing`): board review must not alter the live
    // game's persistence lifecycle, so a live in-progress game is still
    // auto-preserved when the user later starts/resumes a game.
    this.reviewing = true;
    this.thinking = false;
    const { inCheck } = computeMoves(fen);
    const turnColor: Side = fen.split(' ')[1] === 'b' ? 'black' : 'white';
    this.board.render({
      fen,
      orientation: opts.orientation ?? this.humanColor,
      turnColor,
      movableColor: undefined, // read-only review: no input
      dests: new Map(),
      lastMove: opts.lastMove,
      inCheck,
      shapes: opts.shapes,
    });
    // Nav/undo are driven by the analysis stepper here, not the play toolbar; still
    // refresh the captured-piece tally for the reviewed position.
    this.cb.onViewUpdate({
      canUndo: false,
      canBack: false,
      canForward: false,
      ply: 0,
      totalPlies: 0,
      material: materialFromFen(fen),
      orientation: opts.orientation ?? this.humanColor,
    });
  }

  /** Explicitly save the current in-progress game so it can be resumed later. */
  async save(): Promise<void> {
    if (this.viewing || this.finalized) {
      this.cb.onStatus('Nothing to save — start or resume a game first.', 'info');
      return;
    }
    if (this.game.history().length === 0) {
      this.cb.onStatus('Nothing to save yet — make a move first.', 'info');
      return;
    }
    await this.persistInProgress(true);
  }

  /** Resign the current game: the engine wins, and the game is saved as finished. */
  async resign(): Promise<void> {
    if (!this.engine || this.viewing || this.finalized || this.game.isGameOver()) return;
    this.generation++; // discard any in-flight engine reply
    this.resigned = true;
    this.thinking = false;
    this.liveShapes = [];
    const result: GameResult = this.humanColor === 'white' ? '0-1' : '1-0';
    await this.finalize(result, 'You resigned — engine wins.');
  }

  /** Whether the player can take their last move back right now (only at the live position). */
  canUndo(): boolean {
    return (
      !!this.engine &&
      !this.viewing &&
      !this.reviewing &&
      this.isLive() &&
      this.hasHumanMoveToUndo()
    );
  }

  /** True when there is at least one of the human's own moves on the board. */
  private hasHumanMoveToUndo(): boolean {
    const plies = this.game.history().length;
    // White (human) moves on odd plies; Black (human) on even plies. So a Black
    // human needs at least 2 plies (engine opened, then they replied) to have one.
    return this.humanColor === 'white' ? plies >= 1 : plies >= 2;
  }

  /**
   * Take back the last full move: the engine's reply (if it's the human's turn)
   * AND the human's own move, returning to the human's previous decision point so
   * they can play differently. Cancels any in-flight engine search, reopens a
   * finished game if needed, and flags the game as having used undo (the asterisk
   * in the saved-games list). It never auto-moves the engine afterwards — it is the
   * human's turn by construction.
   */
  async undo(): Promise<void> {
    if (!this.canUndo()) return;
    this.generation++; // cancel any in-flight engine reply
    this.thinking = false;
    this.resigned = false;
    this.finalized = false; // reopen the game if it had just finished

    // If it's the human's turn, the last ply was the engine's reply — drop it.
    if (this.game.history().length > 0 && this.game.turn() === this.humanColor) {
      this.game.undo();
    }
    // Drop the human's own last move.
    if (this.game.history().length > 0) {
      this.game.undo();
    }

    this.undoUsed = true;
    this.lastMove = undefined;
    this.finalStatus = undefined;
    // Keep the coach's GREEN best-move arrow (it points to the move to play at the
    // position we've returned to); drop any red refutation arrow (now stale).
    this.liveShapes = this.liveShapes.filter((s) => s.brush === 'green');
    this.viewIndex = this.liveLen(); // back to the (new) live position, human to move
    this.render();
    this.cb.onStatus('Move taken back — your turn again.', 'info');

    // Keep an already-saved record consistent (e.g. reopen a finished game to
    // in-progress, carrying the undo flag). A never-saved game stays unsaved here;
    // the flag travels with it whenever it is next persisted.
    if (this.currentId != null) await this.persist('*', true);

    // Coach mode: refresh the eval bar for the position we've returned to.
    if (this.coachMode && this.cb.onCoachEval) {
      this.cb.onCoachEval({ fenAfter: this.game.fen(), isHumanMove: false });
    }
  }

  // --- move navigation (read-only browsing of the live game) -----------------

  /** Number of plies played in the current game. */
  private liveLen(): number {
    return this.game.history().length;
  }

  /** True when the board shows the latest position (where play happens). */
  private isLive(): boolean {
    return this.viewIndex >= this.liveLen();
  }

  /** Whether back/forward browsing is available (a game with moves, not reviewing). */
  canNavigate(): boolean {
    return !this.viewing && !this.reviewing && this.liveLen() > 0;
  }

  /** Jump to the start position. */
  navToStart(): void {
    if (this.canNavigate()) this.goToView(0);
  }
  /** Step one ply back. */
  navBackward(): void {
    if (this.canNavigate() && this.viewIndex > 0) this.goToView(this.viewIndex - 1);
  }
  /** Step one ply forward. */
  navForward(): void {
    if (this.canNavigate() && this.viewIndex < this.liveLen()) this.goToView(this.viewIndex + 1);
  }
  /** Return to the latest (live) position. */
  navToEnd(): void {
    if (this.canNavigate()) this.goToView(this.liveLen());
  }

  private goToView(index: number): void {
    this.viewIndex = Math.max(0, Math.min(this.liveLen(), index));
    this.render();
  }

  /** FEN of the position currently shown (for export). */
  currentFen(): string {
    return this.positionAtView().fen;
  }
  /** PGN of the whole game (for export). */
  currentPgn(): string {
    return this.game.pgn();
  }

  /** The FEN (+ last-move highlight) for the currently-viewed ply. */
  private positionAtView(): { fen: string; lastMove?: [string, string] } {
    const total = this.liveLen();
    const idx = Math.max(0, Math.min(total, this.viewIndex));
    if (idx >= total) return { fen: this.game.fen(), lastMove: this.lastMove };

    const sans = this.game.history();
    const tmp = new ChessGame();
    let lastMove: [string, string] | undefined;
    for (let i = 0; i < idx; i++) {
      const before = tmp.fen();
      tmp.move(sans[i]);
      if (i === idx - 1) lastMove = inferLastMove(before, tmp.fen());
    }
    return { fen: tmp.fen(), lastMove };
  }

  /** User completed a move on the board (from BoardView's after-move event). */
  async handleUserMove(from: string, to: string): Promise<void> {
    if (
      this.viewing ||
      this.reviewing ||
      this.thinking ||
      this.resigned ||
      this.finalized ||
      this.game.isGameOver() ||
      !this.isLive() // can only move from the latest position
    ) {
      this.render(); // revert any visual move
      return;
    }

    let uci = from + to;
    if (computeMoves(this.game.fen()).isPromotion(from, to)) {
      const gen = this.generation;
      const piece = await pickPromotion(this.humanColor);
      if (gen !== this.generation) return; // game changed during the picker
      uci = from + to + piece;
    }

    const fenBefore = this.game.fen(); // the position the human faced (coach scoreBefore)
    if (!this.game.move(uci)) {
      this.render(); // illegal (shouldn't happen given dests): snap back
      return;
    }
    this.lastMove = [from, to];
    this.liveShapes = []; // a new move clears the previous coach arrows
    this.viewIndex = this.liveLen(); // stay at the live position
    this.render();

    if (this.game.isGameOver()) {
      await this.finishNatural();
      return;
    }
    // Coach mode: hand the turn to the coach to review this move; it calls
    // requestEngineReply() to continue (immediately for a clean move, or after the
    // user picks Continue/Retry on a slip). Off (or no coach wired): auto-reply exactly
    // as before — the `onCoachEval` guard guarantees the game can never be stranded.
    if (this.coachMode && this.cb.onCoachEval) {
      this.cb.onCoachEval({
        fenBefore,
        fenAfter: this.game.fen(),
        uci,
        mover: this.humanColor,
        isHumanMove: true,
      });
      return;
    }
    void this.engineMove();
  }

  private async engineMove(): Promise<void> {
    if (!this.engine) return;
    const gen = this.generation;
    // NB: coach arrows are intentionally NOT cleared here — they're left on the board
    // through the engine's reply so the human can read the feedback and choose to Undo.
    // They're cleared on the next human move (handleUserMove) and on game changes.
    this.thinking = true;
    this.render();
    this.cb.onStatus(`Engine (~${this.strengthElo}) is thinking…`, 'thinking');

    let best: string;
    try {
      const bm = await this.engine.bestMove({ fen: this.game.fen() });
      best = bm.best;
    } catch (err) {
      if (gen !== this.generation) return; // superseded
      this.thinking = false;
      this.cb.onStatus(`Engine error: ${(err as Error).message}`, 'error');
      this.render();
      return;
    }

    if (gen !== this.generation) return; // new game / resign happened while thinking

    // Follow the new move only if the player was watching the live position; if they
    // had stepped back to browse, leave them there (they can step forward to it).
    const follow = this.isLive();
    const fenBeforeEngine = this.game.fen(); // position the engine moved from (coach scoreBefore for the human's next turn)

    // THE GATE: applying the engine's move must succeed (legal in this position).
    const legal = this.game.move(best);
    if (!legal) {
      this.thinking = false;
      const fen = this.game.fen();
      this.cb.onStatus(`ILLEGAL engine move "${best}" at ${fen} — play halted.`, 'error');
      this.render();
      throw new Error(`illegal engine move "${best}" at ${fen}`);
    }

    this.lastMove = [best.slice(0, 2), best.slice(2, 4)];
    if (follow) this.viewIndex = this.liveLen();
    this.thinking = false;
    this.render();

    if (this.game.isGameOver()) {
      await this.finishNatural();
      return;
    }
    // Coach mode: refresh the eval bar for the position the human now faces (and seed
    // the next pre-move eval). Not a review — the coach only critiques the human.
    if (this.coachMode) {
      const engineColor: Side = this.humanColor === 'white' ? 'black' : 'white';
      this.cb.onCoachEval?.({
        fenBefore: fenBeforeEngine,
        fenAfter: this.game.fen(),
        uci: best,
        mover: engineColor,
        isHumanMove: false,
      });
    }
  }

  private async finishNatural(): Promise<void> {
    await this.finalize(this.game.result(), this.resultText(this.game.result()));
  }

  /** Mark the game finished, surface the result, and persist it as finished. */
  private async finalize(result: GameResult, statusText: string): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    this.finalStatus = statusText;
    this.render();
    this.cb.onStatus(statusText, 'gameover');
    await this.persist(result, false);
  }

  /** Persist the current game as in-progress (no-op if nothing meaningful to save). */
  private async persistInProgress(announce: boolean): Promise<void> {
    if (this.viewing || this.finalized || this.game.history().length === 0) return;
    await this.persist('*', true);
    if (announce) this.cb.onStatus('Game saved — resume it any time from Saved games.', 'info');
  }

  /** Insert (first save) or update (subsequent) this game's persisted record. */
  private async persist(result: GameResult, inProgress: boolean): Promise<void> {
    const record = {
      playedAt: Date.now(),
      pgn: this.game.pgn(),
      result,
      strengthElo: this.strengthElo,
      humanColor: this.humanColor,
      inProgress,
      undoUsed: this.undoUsed,
    };
    try {
      if (this.currentId == null) this.currentId = await this.repo.save(record);
      else await this.repo.update({ ...record, id: this.currentId });
      this.cb.onGameSaved();
    } catch (err) {
      this.cb.onStatus(`Could not save game: ${(err as Error).message}`, 'error');
    }
  }

  private render(): void {
    const total = this.liveLen();
    this.viewIndex = Math.max(0, Math.min(total, this.viewIndex));
    const live = this.viewIndex >= total;

    const { fen, lastMove } = this.positionAtView();
    const { dests, inCheck } = computeMoves(fen);
    const turn: Side = fen.split(' ')[1] === 'b' ? 'black' : 'white';

    const playable =
      live &&
      !this.viewing &&
      !this.reviewing &&
      !this.thinking &&
      !this.resigned &&
      !this.finalized &&
      !this.game.isGameOver() &&
      turn === this.humanColor;

    this.board.render({
      fen,
      orientation: this.humanColor,
      turnColor: turn,
      movableColor: playable ? this.humanColor : undefined,
      dests: playable ? dests : new Map(),
      lastMove,
      inCheck,
      // Coach arrows only at the live position (never while browsing history).
      shapes: live && this.coachMode ? this.liveShapes : undefined,
    });

    // Status priority: browsing > thinking (owned by engineMove) > finished > turn.
    if (!this.viewing && !this.reviewing) {
      if (!live) {
        this.cb.onStatus(
          `Reviewing move ${this.viewIndex}/${total} — press → to return to the game.`,
          'info',
        );
      } else if (!this.thinking) {
        if ((this.finalized || this.game.isGameOver() || this.resigned) && this.finalStatus) {
          this.cb.onStatus(this.finalStatus, 'gameover');
        } else if (!this.finalized && !this.resigned && !this.game.isGameOver()) {
          this.cb.onStatus(this.turnStatus(), 'info');
        }
      }
    }

    this.cb.onViewUpdate({
      canUndo: this.canUndo(),
      canBack: this.canNavigate() && this.viewIndex > 0,
      canForward: this.canNavigate() && this.viewIndex < total,
      ply: this.viewIndex,
      totalPlies: total,
      material: materialFromFen(fen),
      orientation: this.humanColor,
    });
  }

  private turnStatus(): string {
    const turn = this.game.turn();
    const who = turn === this.humanColor ? 'Your move' : 'Engine to move';
    return `${who} — ${turn} to play.`;
  }

  private resultText(result: GameResult): string {
    if (result === '1/2-1/2') return 'Game over — draw.';
    const humanWon =
      (result === '1-0' && this.humanColor === 'white') ||
      (result === '0-1' && this.humanColor === 'black');
    const verb = this.game.isCheckmate() ? 'Checkmate' : 'Game over';
    return `${verb} — ${result} — ${humanWon ? 'you win.' : 'engine wins.'}`;
  }
}
