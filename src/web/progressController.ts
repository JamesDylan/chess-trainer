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
import { buildProgressSnapshot, type AnalyzedGame, type ProgressSnapshot } from '../coach';

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

    const snapshot = buildProgressSnapshot({
      attempts,
      rating,
      analyzedGames,
      totalGames: games.length,
    });
    this.cb.onState(snapshot);
  }
}
