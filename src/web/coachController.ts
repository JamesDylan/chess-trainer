// Stage 5 — the live Coach seam on the Play tab. It listens to the GameController's
// "position settled" hook (onCoachEval), evaluates positions with a DEDICATED
// full-strength engine (separate from the limited-strength play engine), and turns the
// PURE liveMoveFeedback into an eval bar + a coach line + green/red board arrows. It
// owns no chess state and no engine wiring beyond an injected engine factory; the play
// loop, the analyzer math, and BoardView are all reused unchanged.
//
// Sequencing (never mid-search): after a HUMAN move the play loop hands us the turn —
// we review the move, and either auto-continue (a clean move) or pause with
// Retry/Continue (a slip / missed chance), calling requestEngineReply() to resume.
// After an ENGINE reply (or at game start) we only refresh the eval bar.

import { ChessGame } from '../core/chessGame';
import type { Score } from '../core/types';
import type { AnalysisEngine } from '../analysis/types';
import {
  liveMoveFeedback,
  shouldShowBestMove,
  COACH_BESTMOVE_ACCURACY,
  type LiveMoveFeedback,
} from '../coach/liveFeedback';
import { evaluatePosition, type PositionEvaluation } from '../coach/evaluatePosition';
import type { Side, BoardShape } from './boardView';
import type { GameController, CoachMoveContext } from './gameController';
import type { CoachView, CoachFeedbackVM } from './coachView';

export interface CoachConfig {
  /** Depth for the live eval bar + per-move classification + refutation PV. */
  liveDepth: number;
  /** Accuracy% below which the best move is surfaced / a move "slipped". */
  bestMoveAccuracy?: number;
  /** "Closeness to best" cp-loss weight (see evalMath.effectiveWinDrop). 0 = pure win%. */
  cpLossWeight?: number;
}

const PIECE_NAMES: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

export class CoachController {
  private enabled = false;
  /** Bumped on every settled position / reset / toggle; async evals tagged with the
   *  value they started under are dropped once it advances (drops stale work). */
  private gen = 0;
  private readonly cache = new Map<string, PositionEvaluation>();
  /** Serialises engine access — the single coach worker can run one search at a time. */
  private evalLock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly controller: GameController,
    private readonly view: CoachView,
    private readonly getEngine: () => Promise<AnalysisEngine>,
    private readonly cfg: CoachConfig,
    private readonly onStatus?: (text: string) => void,
  ) {}

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Toggle Coach mode. Pre-warms the engine and seeds the bar when turning on; clears
   *  state and releases any held turn when turning off. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.controller.setCoachMode(on);
    this.view.setVisible(on);
    this.gen++;
    this.cache.clear();
    if (on) {
      void this.prewarm();
      if (this.controller.isHumanToMove()) void this.evalForBar(this.controller.currentFen(), this.gen, true);
    } else {
      this.view.clear();
      this.controller.setLiveShapes([]);
      // If we were holding the turn after a human move, let the engine reply now.
      this.controller.requestEngineReply();
    }
  }

  /** Drop cache + pending work + UI on a new/loaded/closed game (called from main.ts).
   *  Neutralises the eval bar so a stale value never lingers between games. */
  reset(): void {
    this.gen++;
    this.cache.clear();
    this.view.clear();
    this.view.setEvalBar(50, '—', this.controller.orientation);
  }

  /** The GameController hook. Dispatched off the main thread (fire-and-forget). */
  onCoachEval(ctx: CoachMoveContext): void {
    if (!this.enabled) return;
    const gen = ++this.gen;
    if (ctx.isHumanMove && ctx.fenBefore && ctx.uci && ctx.mover) {
      void this.reviewHumanMove(ctx.fenBefore, ctx.fenAfter, ctx.uci, ctx.mover, gen);
    } else {
      // No move (game start / take-back) => idle "Your move."; an engine reply (has a
      // uci) just updates the bar and leaves the human's feedback + arrow in place.
      void this.evalForBar(ctx.fenAfter, gen, ctx.uci === undefined);
    }
  }

  // --- engine plumbing -------------------------------------------------------

  private async prewarm(): Promise<void> {
    try {
      await this.getEngine();
    } catch {
      /* surfaced on the first real eval */
    }
  }

  /** Run one search, serialised on the single coach worker. */
  private runEval(fen: string, depth: number): Promise<PositionEvaluation> {
    const run = this.evalLock.then(async () => {
      const engine = await this.getEngine();
      return evaluatePosition(fen, engine, depth);
    });
    this.evalLock = run.catch(() => {});
    return run;
  }

  /** Cached single-position eval at the live depth. */
  private async evalCached(fen: string): Promise<PositionEvaluation> {
    const hit = this.cache.get(fen);
    if (hit) return hit;
    const ev = await this.runEval(fen, this.cfg.liveDepth);
    this.cache.set(fen, ev);
    return ev;
  }

  // --- the two flows ---------------------------------------------------------

  /**
   * Engine reply / game start / toggle-on: refresh the eval bar. `idle` shows a quiet
   * "Your move." line — only at game start / after a take-back, NOT after the engine's
   * reply (there we LEAVE the human's last-move feedback + arrow on screen, so they can
   * read it on their own time and Undo to follow it).
   */
  private async evalForBar(fen: string, gen: number, idle: boolean): Promise<void> {
    try {
      const ev = await this.evalCached(fen);
      if (gen !== this.gen) return; // superseded
      this.view.setEvalBar(ev.winWhite, this.evalText(fen, ev.score), this.controller.orientation);
      if (idle) this.view.showIdle('Your move.');
    } catch (err) {
      this.onStatus?.(`Coach eval failed: ${(err as Error).message}`);
    }
  }

  /** Human move: review it (bar + best move + blunder "why" + missed-chance flag). */
  private async reviewHumanMove(
    fenBefore: string,
    fenAfter: string,
    uci: string,
    mover: Side,
    gen: number,
  ): Promise<void> {
    this.view.setThinking();
    try {
      const before = await this.evalCached(fenBefore);
      if (gen !== this.gen) return;
      const after = await this.evalCached(fenAfter);
      if (gen !== this.gen) return;

      this.view.setEvalBar(after.winWhite, this.evalText(fenAfter, after.score), this.controller.orientation);

      // One shallow search per position keeps coaching responsive — the bar, the
      // classification, and the refutation (post-move PV) all come from it. The deeper,
      // rigorous numbers live in the on-demand Analyze pass (Stage 2).
      const fb = liveMoveFeedback(before.score, after.score, before.bestMoveUci, after.pv, mover, {
        bestMoveAccuracy: this.cfg.bestMoveAccuracy,
        cpLossWeight: this.cfg.cpLossWeight,
      });
      this.presentFeedback(fenBefore, fenAfter, before, fb);
    } catch (err) {
      this.onStatus?.(`Coach eval failed: ${(err as Error).message}`);
      this.controller.requestEngineReply(); // never strand the game on an eval failure
    }
  }

  /**
   * Draw the arrows, render the coach line, and let the opponent play. NON-BLOCKING:
   * the game never stops. The green best-move / red refutation arrows are LEFT on the
   * board (they persist through the engine's reply, see GameController.engineMove), so
   * you can read the feedback and — if you want — hit Undo to follow the suggestion.
   */
  private presentFeedback(
    fenBefore: string,
    fenAfter: string,
    before: PositionEvaluation,
    fb: LiveMoveFeedback,
  ): void {
    const accThreshold = this.cfg.bestMoveAccuracy ?? COACH_BESTMOVE_ACCURACY;
    const isBlunder = fb.classification === 'blunder';
    const showBest = shouldShowBestMove(fb, accThreshold);

    // Arrows: green best move (the stronger move) + red refutation (the blunder "why").
    const shapes: BoardShape[] = [];
    if (showBest && isUci(fb.bestMoveUci)) {
      shapes.push({ orig: fb.bestMoveUci!.slice(0, 2), dest: fb.bestMoveUci!.slice(2, 4), brush: 'green' });
    }
    if (isBlunder && isUci(fb.refutationUci)) {
      shapes.push({ orig: fb.refutationUci!.slice(0, 2), dest: fb.refutationUci!.slice(2, 4), brush: 'red' });
    }
    this.controller.setLiveShapes(shapes);

    this.view.showFeedback(this.buildVM(fenBefore, fenAfter, before, fb));
    this.controller.requestEngineReply(); // never stop the game — the opponent plays on
  }

  /** Build the coach line's render-model, by missed-chance / accuracy priority. There are
   *  no buttons — the message + the arrow on the board are the whole interaction; you Undo
   *  yourself if you want to follow it. */
  private buildVM(
    fenBefore: string,
    fenAfter: string,
    before: PositionEvaluation,
    fb: LiveMoveFeedback,
  ): CoachFeedbackVM {
    const accThreshold = this.cfg.bestMoveAccuracy ?? COACH_BESTMOVE_ACCURACY;
    const bestSan = isUci(fb.bestMoveUci) ? this.uciToSan(fenBefore, fb.bestMoveUci!) : undefined;
    const slipped = fb.accuracy < accThreshold; // matches the green-arrow condition exactly
    const metrics = slipped
      ? `−${(fb.cpLoss / 100).toFixed(2)} · ${fb.accuracy.toFixed(0)}% accuracy`
      : undefined;
    const bestNote = bestSan ? ` Best was ${bestSan}.` : '';
    const undoHint = ' Hit Undo to take it back and play the arrow.';

    // 1) Missed forced mate — the most teachable, flagged even when not a "??".
    if (fb.missedOpportunity === 'mate') {
      const m = before.score.mate;
      return {
        badge: { label: 'Missed mate', tone: 'warn' },
        headline: `You had a chance to play checkmate${m ? ` (M${m})` : ''}.`,
        detail: `${bestNote}${undoHint}`.trim(),
        metrics,
      };
    }
    // 2) Blunder — show why (the refutation) + the best move.
    if (fb.classification === 'blunder') {
      const why = this.refutationReason(fenAfter, fb.refutationUci);
      return {
        badge: { label: '?? Blunder', tone: 'bad' },
        headline: why ?? 'That gives up material.',
        detail: `${bestNote}${undoHint}`.trim(),
        metrics,
      };
    }
    // 3) Missed a decisive (winning) advantage, though not a blunder.
    if (fb.missedOpportunity === 'winning') {
      return {
        badge: { label: 'Missed win', tone: 'warn' },
        headline: 'You had a winning chance and let some of it go.',
        detail: `${bestNote}${undoHint}`.trim(),
        metrics,
      };
    }
    // 4) Any sub-90% slip — inaccuracy, mistake, or a "good"/"excellent"-class move that
    //    still left a clearly stronger one (keeps the message consistent with the green
    //    arrow, which shows for exactly this accuracy band).
    if (slipped) {
      const label =
        fb.classification === 'mistake'
          ? '?! Mistake'
          : fb.classification === 'inaccuracy'
            ? 'Inaccuracy'
            : 'Decent';
      return {
        badge: { label, tone: fb.classification === 'mistake' ? 'warn' : 'ok' },
        headline: bestSan ? 'A stronger move was available.' : 'Slightly inaccurate.',
        detail: bestSan ? `Best was ${bestSan}.` : undefined,
        metrics,
      };
    }
    // 5) A clean move (≥ threshold accuracy) — quiet praise, no arrow.
    return { badge: { label: this.goodLabel(fb), tone: 'good' }, headline: this.goodHeadline(fb) };
  }

  // --- small chess/text helpers ----------------------------------------------

  /** White-POV eval text for the bar/label: "+1.2", "-0.8", "M8", "-M3". */
  private evalText(fen: string, score: Score): string {
    const whiteToMove = fen.split(' ')[1] !== 'b';
    if (score.mate !== undefined) {
      const whiteMate = whiteToMove ? score.mate : -score.mate;
      if (whiteMate === 0) return '#';
      return `${whiteMate > 0 ? '' : '-'}M${Math.abs(whiteMate)}`;
    }
    const whiteCp = whiteToMove ? score.cp ?? 0 : -(score.cp ?? 0);
    const pawns = whiteCp / 100;
    return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`;
  }

  /** Convert a UCI move to SAN in the context of `fen` (reuses ChessGame). */
  private uciToSan(fen: string, uci: string): string | undefined {
    const g = new ChessGame(fen);
    if (!g.move(uci)) return undefined;
    const h = g.history();
    return h[h.length - 1];
  }

  /** A one-line reason for a blunder from its refutation: SAN + the piece it wins. */
  private refutationReason(fenAfter: string, refUci: string | undefined): string | undefined {
    if (!isUci(refUci)) return undefined;
    const san = this.uciToSan(fenAfter, refUci);
    if (!san) return undefined;
    const victim = pieceAt(fenAfter, refUci.slice(2, 4));
    if (victim && victim.toLowerCase() !== 'k') {
      return `After ${san}, the engine wins your ${PIECE_NAMES[victim.toLowerCase()]}.`;
    }
    return `The engine punishes with ${san}.`;
  }

  private goodLabel(fb: LiveMoveFeedback): string {
    if (fb.classification === 'best') return 'Best';
    if (fb.classification === 'excellent') return 'Excellent';
    return 'Good';
  }

  private goodHeadline(fb: LiveMoveFeedback): string {
    if (fb.classification === 'best') return 'Best move — well played.';
    return 'Good move.';
  }
}

/** A well-formed UCI move string (e2e4 / e7e8q). */
function isUci(uci: string | undefined): uci is string {
  return typeof uci === 'string' && uci.length >= 4;
}

/** The piece char (e.g. "N"/"n") sitting on `square` in a FEN, or undefined. */
function pieceAt(fen: string, square: string): string | undefined {
  const placement = fen.split(' ')[0];
  const file = square.charCodeAt(0) - 97; // 'a'..'h' -> 0..7
  const rank = Number(square[1]); // 1..8
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return undefined;
  const ranks = placement.split('/'); // index 0 = rank 8
  const row = ranks[8 - rank];
  if (!row) return undefined;
  let f = 0;
  for (const ch of row) {
    if (ch >= '1' && ch <= '9') {
      f += Number(ch);
    } else {
      if (f === file) return ch;
      f += 1;
    }
  }
  return undefined;
}
