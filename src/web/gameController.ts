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
import { computeMoves } from './legalDests';
import { BoardView, type Side, type BoardShape } from './boardView';
import { pickPromotion } from './promotion';

export type StatusKind = 'info' | 'thinking' | 'gameover' | 'error';

export interface ControllerCallbacks {
  onStatus(text: string, kind: StatusKind): void;
  /** Called after a game is saved/updated, so the UI can refresh its list. */
  onGameSaved(): void;
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
  private lastMove?: [string, string];
  // Bumped on every newGame/resume/viewPgn/resign. An in-flight engine search
  // captures the value and discards its result if the game changed underneath it.
  private generation = 0;
  // Id of this game's persisted record (in-progress or finished), once saved.
  private currentId?: number;

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
    this.lastMove = undefined;
    this.currentId = undefined;

    await this.engine.newGame();
    await this.engine.setStrength(eloToEngineOptions(elo));
    this.render();

    // If the human chose Black, the engine (White) moves first.
    if (this.game.turn() !== this.humanColor) void this.engineMove();
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
    this.lastMove = undefined;
    this.currentId = saved.id;

    await this.engine.newGame();
    await this.engine.setStrength(eloToEngineOptions(this.strengthElo));
    this.render();

    if (!this.game.isGameOver() && this.game.turn() !== this.humanColor) void this.engineMove();
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
    const result: GameResult = this.humanColor === 'white' ? '0-1' : '1-0';
    await this.finalize(result, 'You resigned — engine wins.');
  }

  /** User completed a move on the board (from BoardView's after-move event). */
  async handleUserMove(from: string, to: string): Promise<void> {
    if (
      this.viewing ||
      this.reviewing ||
      this.thinking ||
      this.resigned ||
      this.finalized ||
      this.game.isGameOver()
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

    if (!this.game.move(uci)) {
      this.render(); // illegal (shouldn't happen given dests): snap back
      return;
    }
    this.lastMove = [from, to];
    this.render();

    if (this.game.isGameOver()) {
      await this.finishNatural();
      return;
    }
    void this.engineMove();
  }

  private async engineMove(): Promise<void> {
    if (!this.engine) return;
    const gen = this.generation;
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
    this.thinking = false;
    this.render();

    if (this.game.isGameOver()) await this.finishNatural();
  }

  private async finishNatural(): Promise<void> {
    await this.finalize(this.game.result(), this.resultText(this.game.result()));
  }

  /** Mark the game finished, surface the result, and persist it as finished. */
  private async finalize(result: GameResult, statusText: string): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
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
    const fen = this.game.fen();
    const { dests, inCheck } = computeMoves(fen);
    const turn = this.game.turn();
    const playable =
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
      lastMove: this.lastMove,
      inCheck,
    });

    if (
      !this.viewing &&
      !this.reviewing &&
      !this.thinking &&
      !this.resigned &&
      !this.finalized &&
      !this.game.isGameOver()
    ) {
      this.cb.onStatus(this.turnStatus(), 'info');
    }
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
