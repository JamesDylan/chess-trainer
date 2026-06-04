// Adaptive next-puzzle selection — PURE and DETERMINISTIC given an injected RNG.
//
// Pick a puzzle near the user's current rating (so puzzles stay challenging but
// solvable), optionally filtered by theme, avoiding the most recent puzzles. The
// rating window widens in steps until it finds candidates, then chooses randomly
// among them for variety; if nothing falls inside the widest window it falls back to
// the single closest puzzle by rating. Injecting `rng` keeps it unit-testable.

import type { Puzzle } from './types';

export interface SelectNextOptions {
  /** The user's current rating; puzzles are chosen near it. */
  rating: number;
  /** Puzzle ids to avoid (recently served) — repeats are only used if nothing else remains. */
  excludeIds?: Iterable<string>;
  /** If set, a puzzle qualifies only if it has at least one of these themes. */
  themes?: string[];
  /** Initial +/- rating window (default 150). */
  initialWindow?: number;
  /** Amount to widen the window each step (default 150). */
  windowStep?: number;
  /** Largest +/- rating window before falling back to the nearest puzzle (default 800). */
  maxWindow?: number;
  /** Randomness source in [0,1) (default Math.random). */
  rng?: () => number;
}

function pick<T>(items: readonly T[], rng: () => number): T {
  const i = Math.min(items.length - 1, Math.max(0, Math.floor(rng() * items.length)));
  return items[i];
}

/**
 * Choose the next puzzle, or undefined if `puzzles` is empty (or the theme filter
 * matches nothing). Deterministic for a given `rng`.
 */
export function selectNextPuzzle(
  puzzles: readonly Puzzle[],
  opts: SelectNextOptions,
): Puzzle | undefined {
  const rng = opts.rng ?? Math.random;
  const exclude = new Set(opts.excludeIds ?? []);
  const themeFilter = opts.themes && opts.themes.length ? new Set(opts.themes) : undefined;

  const themed = themeFilter
    ? puzzles.filter((p) => p.themes.some((t) => themeFilter.has(t)))
    : puzzles.slice();
  if (themed.length === 0) return undefined;

  // Prefer unseen puzzles; only allow repeats if excluding empties the pool.
  let pool = themed.filter((p) => !exclude.has(p.id));
  if (pool.length === 0) pool = themed;

  const initial = opts.initialWindow ?? 150;
  const step = opts.windowStep ?? 150;
  const maxW = opts.maxWindow ?? 800;
  for (let w = initial; w <= maxW; w += step) {
    const inBand = pool.filter((p) => Math.abs(p.rating - opts.rating) <= w);
    if (inBand.length > 0) return pick(inBand, rng);
  }

  // Nothing within the widest window: take the closest by rating distance.
  let best = pool[0];
  let bestDist = Math.abs(best.rating - opts.rating);
  for (const p of pool) {
    const d = Math.abs(p.rating - opts.rating);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}
