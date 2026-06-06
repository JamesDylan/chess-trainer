// Orchestrates the Progress tab: reads the three data sources the first pillars
// persist — PuzzleStore (rating + attempt log), GameRepository (saved games), and the
// AnalysisStore cache (one GameReport per analysed game) — and folds them into a single
// ProgressSnapshot via the pure src/coach layer, which it hands to the view.
//
// It is a SEPARATE seam mirroring GameController / PuzzleController: it owns no board,
// runs no engine, and changes none of the stores' signatures. Aggregating analysed
// games is done exactly as the brief requires — enumerate GameRepository.list() ids,
// AnalysisStore.get(id) each, and SKIP games with no (or stale-schema) cached report.
// Everything is derived LIVE on refresh(), so re-opening the tab reflects new attempts.

import type { PuzzleStore } from '../puzzles';
import type { GameRepository } from '../persistence';
import { ANALYSIS_REPORT_VERSION, type AnalysisStore } from '../analysis';
import {
  buildProgressSnapshot,
  type AnalyzedGame,
  type GameOpeningRecord,
  type GameRatingRecord,
  type ProgressSnapshot,
} from '../coach';
import { OpeningBook, SEED_OPENINGS, loadOpeningsFromJson } from '../openings';
import { openingsUrl } from './config';

export interface ProgressControllerDeps {
  puzzleStore: PuzzleStore;
  gameRepo: GameRepository;
  analysisStore: AnalysisStore;
}

export interface ProgressControllerCallbacks {
  /** Emitted with a freshly-derived snapshot on every refresh. */
  onState(snapshot: ProgressSnapshot): void;
}

export class ProgressController {
  /** Built once, lazily: prefers the full opening asset, else the built-in seed. */
  private bookPromise?: Promise<OpeningBook>;

  constructor(
    private readonly deps: ProgressControllerDeps,
    private readonly cb: ProgressControllerCallbacks,
  ) {}

  /** Re-read every source and rebuild the snapshot. Tolerant of storage errors —
   *  a failing source contributes nothing rather than throwing. */
  async refresh(): Promise<void> {
    const rating = await this.deps.puzzleStore.loadRating().catch(() => undefined);
    const attempts = await this.deps.puzzleStore.listAttempts().catch(() => []);
    const games = await this.deps.gameRepo.list().catch(() => []);

    const analyzedGames: AnalyzedGame[] = [];
    for (const game of games) {
      const report = await this.deps.analysisStore.get(game.id).catch(() => undefined);
      // Only fold in a report that exists, matches the current report schema, and was
      // computed from this game's current moves (a stale/edited game is "unanalysed").
      if (report && report.version === ANALYSIS_REPORT_VERSION && report.pgn === game.pgn) {
        analyzedGames.push({ report, game });
      }
    }

    // Opening detection over FINISHED games (a result is needed for win/loss). Pair in
    // the user's analysed accuracy where available, for accuracy-by-opening.
    const book = await this.getBook();
    const accuracyByGame = new Map<number, number>();
    for (const a of analyzedGames) {
      const pr = a.game.humanColor === 'white' ? a.report.white : a.report.black;
      accuracyByGame.set(a.game.id, pr.accuracy);
    }
    const gameOpenings: GameOpeningRecord[] = [];
    const finishedGames: GameRatingRecord[] = [];
    for (const game of games) {
      if (game.inProgress || game.result === '*') continue; // finished games only
      const detected = book.detectFromPgn(game.pgn);
      gameOpenings.push({
        opening: detected ? { eco: detected.eco, name: detected.name } : undefined,
        result: game.result,
        humanColor: game.humanColor,
        accuracy: accuracyByGame.get(game.id),
      });
      // The classic-Elo playing rating folds over every finished game vs its engine
      // strength; `undoUsed` discounts a win's gain (a takeback isn't true skill).
      finishedGames.push({
        playedAt: game.playedAt,
        result: game.result,
        humanColor: game.humanColor,
        strengthElo: game.strengthElo,
        undoUsed: game.undoUsed ?? false,
      });
    }

    const snapshot = buildProgressSnapshot({
      attempts,
      rating,
      analyzedGames,
      totalGames: games.length,
      gameOpenings,
      finishedGames,
    });
    this.cb.onState(snapshot);
  }

  private getBook(): Promise<OpeningBook> {
    return (this.bookPromise ??= this.loadBook());
  }

  /** Prefer the full opening asset (public/openings/openings.json); fall back to the
   *  built-in seed so opening naming always works offline. */
  private async loadBook(): Promise<OpeningBook> {
    try {
      const res = await fetch(openingsUrl());
      if (res.ok) {
        const defs = loadOpeningsFromJson(await res.text());
        if (defs.length > 0) return new OpeningBook(defs);
      }
    } catch {
      /* no asset / offline → fall back to the seed below */
    }
    return new OpeningBook(SEED_OPENINGS);
  }
}
