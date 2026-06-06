// Rule-based, OFFLINE coaching: turn the puzzle/game stats into a ranked Weakness[]
// and a short, prioritised CoachingInsight[]. Every decision is a documented threshold
// in thresholds.ts — NO LLM, no web API, fully deterministic (no Date.now, no RNG), so
// the same data always yields the same coaching and the rules can be asserted exactly.

import { initialRating, isEstablished } from '../core/rating';
import { computePuzzleStats } from './puzzleStats';
import { computeGameStats } from './gameStats';
import { computeOpeningStats } from './openingStats';
import { computeGameRating } from './gameRating';
import { COACH_THRESHOLDS } from './thresholds';
import type {
  CoachingInsight,
  Confidence,
  GameStats,
  OpeningStat,
  ProgressSnapshot,
  PuzzleStats,
  SnapshotInput,
  Weakness,
} from './types';

/** Down-weights low-confidence weaknesses when ranking across sources. */
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { low: 0.4, medium: 0.75, high: 1 };

/**
 * Diagnose weaknesses from BOTH sources, ranked worst-first by severity × confidence.
 * A signal is only emitted when it crosses its documented threshold:
 *   - theme:    attempts >= minThemeAttempts AND solveRate < weakThemeSolveRate;
 *   - phase:    moves >= minPhaseMoves AND accuracy < weakPhaseAccuracy;
 *   - blunders: analysedGames >= minGamesForBlunderRate AND blundersPerGame >= highBlunderRate.
 */
export function diagnoseWeaknesses(
  puzzles: PuzzleStats,
  games: GameStats,
  openings: OpeningStat[] = [],
): Weakness[] {
  const out: Weakness[] = [];

  for (const t of puzzles.themes) {
    if (t.attempts < COACH_THRESHOLDS.minThemeAttempts) continue;
    if (t.solveRate < COACH_THRESHOLDS.weakThemeSolveRate) {
      out.push({
        id: `theme:${t.theme}`,
        kind: 'theme',
        label: themeLabel(t.theme),
        detail: `solved ${t.solved}/${t.attempts} (${pct(t.solveRate)}) on ${t.theme} puzzles`,
        severity: 1 - t.solveRate,
        confidence: t.confidence,
        sampleSize: t.attempts,
        drillTheme: t.theme,
      });
    }
  }

  for (const p of games.phases) {
    if (p.moves < COACH_THRESHOLDS.minPhaseMoves) continue;
    if (p.accuracy < COACH_THRESHOLDS.weakPhaseAccuracy) {
      out.push({
        id: `phase:${p.phase}`,
        kind: 'phase',
        label: `${cap(p.phase)} play`,
        detail: `${p.accuracy.toFixed(0)}% accuracy over ${p.moves} ${p.phase} moves (${p.blunders} blunders, ${p.mistakes} mistakes)`,
        severity: (100 - p.accuracy) / 100,
        confidence: p.confidence,
        sampleSize: p.moves,
        // opening/middlegame/endgame are valid Lichess puzzle themes, so the phase
        // name doubles as the theme to drill.
        drillTheme: p.phase,
      });
    }
  }

  if (
    games.analyzedGames >= COACH_THRESHOLDS.minGamesForBlunderRate &&
    games.blundersPerGame >= COACH_THRESHOLDS.highBlunderRate
  ) {
    const worst = worstPhaseByBlunders(games);
    out.push({
      id: 'blunders',
      kind: 'blunders',
      label: 'Frequent blunders',
      detail:
        `${games.blundersPerGame.toFixed(1)} blunders per game over ${games.analyzedGames} analysed game(s)` +
        (worst ? `, most in the ${worst}` : ''),
      severity: Math.min(1, games.blundersPerGame / 3),
      confidence: games.analyzedGames >= 3 ? 'high' : games.analyzedGames >= 2 ? 'medium' : 'low',
      sampleSize: games.analyzedGames,
      drillTheme: worst ?? undefined,
    });
  }

  // 4. A low-scoring opening (enough games to mean something). No drill theme — puzzles
  //    are filtered by tactic, not opening; the fix is study/review, not tactics reps.
  const weakOpenings = openings.filter(
    (o) => o.games >= COACH_THRESHOLDS.minOpeningGames && o.score < COACH_THRESHOLDS.weakOpeningScore,
  );
  if (weakOpenings.length > 0) {
    const worst = [...weakOpenings].sort(
      (a, b) => a.score - b.score || b.games - a.games || a.name.localeCompare(b.name),
    )[0];
    out.push({
      id: `opening:${worst.name}`,
      kind: 'opening',
      label: worst.name,
      detail: `${pct(worst.score)} score (${worst.wins}W / ${worst.losses}L / ${worst.draws}D) over ${worst.games} games`,
      severity: 1 - worst.score,
      confidence: worst.games >= 6 ? 'high' : worst.games >= 3 ? 'medium' : 'low',
      sampleSize: worst.games,
    });
  }

  return rankWeaknesses(out);
}

/** Stable worst-first ordering: severity × confidence, then sample size, then id. */
export function rankWeaknesses(weaknesses: Weakness[]): Weakness[] {
  return [...weaknesses].sort(
    (a, b) =>
      b.severity * CONFIDENCE_WEIGHT[b.confidence] - a.severity * CONFIDENCE_WEIGHT[a.confidence] ||
      b.sampleSize - a.sampleSize ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Turn the top-ranked weaknesses into at most `maxInsights` prioritised messages. When
 * there's data but nothing crosses a threshold, emit a single honest "no clear weakness
 * yet" note (optionally pointing at the lowest trusted theme) rather than inventing one.
 */
export function buildInsights(
  weaknesses: Weakness[],
  puzzles: PuzzleStats,
  games: GameStats,
): CoachingInsight[] {
  const insights: CoachingInsight[] = weaknesses
    .slice(0, COACH_THRESHOLDS.maxInsights)
    .map((w, i) => ({
      id: w.id,
      priority: i + 1,
      title: insightTitle(w),
      detail: w.detail,
      recommendation: insightRecommendation(w),
      drillTheme: w.drillTheme,
    }));

  if (insights.length === 0 && (puzzles.totalAttempts > 0 || games.analyzedGames > 0)) {
    const lowest = puzzles.themes.find((t) => t.attempts >= COACH_THRESHOLDS.minThemeAttempts);
    insights.push({
      id: 'all-clear',
      priority: 1,
      title: 'No clear weakness yet',
      detail: 'Nothing crosses the coaching thresholds — your themes and phases look balanced.',
      recommendation: lowest
        ? `Keep sharpening your lowest area: ${themeLabel(lowest.theme)} (${pct(lowest.solveRate)}).`
        : 'Solve more puzzles across different themes so per-theme coaching can kick in.',
      drillTheme: lowest?.theme,
    });
  }

  return insights;
}

/** Assemble the full snapshot. Pure + deterministic; safe on empty/sparse input. */
export function buildProgressSnapshot(input: SnapshotInput): ProgressSnapshot {
  const puzzles = computePuzzleStats(input.attempts);
  const games = computeGameStats(input.analyzedGames, input.totalGames);
  const openings = computeOpeningStats(input.gameOpenings ?? []);
  const weaknesses = diagnoseWeaknesses(puzzles, games, openings);
  const insights = buildInsights(weaknesses, puzzles, games);
  const rating = input.rating ?? initialRating();
  const gameRating = computeGameRating(input.finishedGames ?? []);

  return {
    hasData: puzzles.totalAttempts > 0 || games.analyzedGames > 0 || input.totalGames > 0,
    rating: {
      value: Math.round(rating.rating),
      rd: Math.round(rating.rd),
      provisional: !isEstablished(rating),
    },
    gameRating,
    puzzlesSolved: puzzles.solved,
    gamesPlayed: input.totalGames,
    currentStreak: puzzles.currentStreak,
    bestStreak: puzzles.bestStreak,
    overallGameAccuracy: games.userAccuracy,
    puzzles,
    games,
    openings,
    weaknesses,
    insights,
  };
}

// --- helpers (pure) ----------------------------------------------------------

/** Phase with the most user blunders (tie-break: lowest accuracy, then phase order). */
function worstPhaseByBlunders(games: GameStats): string | null {
  const withMoves = games.phases.filter((p) => p.moves > 0 && p.blunders > 0);
  if (withMoves.length === 0) return null;
  const order: Record<string, number> = { opening: 0, middlegame: 1, endgame: 2 };
  const best = [...withMoves].sort(
    (a, b) => b.blunders - a.blunders || a.accuracy - b.accuracy || order[a.phase] - order[b.phase],
  )[0];
  return best.phase;
}

function insightTitle(w: Weakness): string {
  if (w.kind === 'theme') return `Shore up your ${w.label.toLowerCase()} tactics`;
  if (w.kind === 'phase') return `Sharpen your ${w.label.toLowerCase()}`;
  if (w.kind === 'opening') return `Patch up your ${w.label}`;
  return 'Cut down the blunders';
}

function insightRecommendation(w: Weakness): string {
  if (w.kind === 'theme') {
    return `Drill ${w.label.toLowerCase()} puzzles until your solve-rate clears ${pct(
      COACH_THRESHOLDS.weakThemeSolveRate,
    )}.`;
  }
  if (w.kind === 'phase') {
    const phase = w.drillTheme ?? 'middlegame';
    return `Train ${phase} puzzles and slow down on your ${phase} decisions when you review games.`;
  }
  if (w.kind === 'opening') {
    return `Study the ${w.label}: replay your analysed games in this line and learn its main plans and pawn breaks.`;
  }
  return `Before each move, check for opponent threats; drill ${
    w.drillTheme ?? 'tactical'
  } puzzles to spot them faster.`;
}

/** "fork" → "Fork", "backRankMate" → "Back rank mate", "mateIn2" → "Mate in 2". */
function themeLabel(theme: string): string {
  const spaced = theme
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fraction 0..1 → rounded percent string, e.g. 0.413 → "41%". */
function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
