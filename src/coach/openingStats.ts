// Pure aggregation of per-opening win/loss, from the USER's point of view. Opening
// detection itself (which needs board replay / chess.js) happens OUTSIDE the coach, in
// src/openings; here we only fold the already-detected records together, so the coach
// layer stays engine-/chess.js-free and trivially testable.

import type { Color, GameResult } from '../core/types';
import type { GameOpeningRecord, OpeningStat } from './types';

/** Win / loss / draw from the user's perspective for one finished game. */
export function humanOutcome(result: GameResult, humanColor: Color): 'win' | 'loss' | 'draw' {
  if (result === '1/2-1/2') return 'draw';
  if (result !== '1-0' && result !== '0-1') return 'draw'; // '*' shouldn't reach here; treat as neutral
  const whiteWon = result === '1-0';
  return whiteWon === (humanColor === 'white') ? 'win' : 'loss';
}

/**
 * Win/loss by opening. Skips records with no recognised opening and unfinished games.
 * Sorted most-played first, then worst score, then name (deterministic).
 */
export function computeOpeningStats(records: GameOpeningRecord[]): OpeningStat[] {
  interface Bucket {
    eco?: string;
    games: number;
    wins: number;
    losses: number;
    draws: number;
    acc: number[];
  }
  const byName = new Map<string, Bucket>();

  for (const r of records) {
    if (!r.opening || r.result === '*') continue;
    const key = r.opening.name;
    const b = byName.get(key) ?? { eco: r.opening.eco, games: 0, wins: 0, losses: 0, draws: 0, acc: [] };
    b.games += 1;
    const outcome = humanOutcome(r.result, r.humanColor);
    if (outcome === 'win') b.wins += 1;
    else if (outcome === 'loss') b.losses += 1;
    else b.draws += 1;
    if (typeof r.accuracy === 'number') b.acc.push(r.accuracy);
    byName.set(key, b);
  }

  const stats: OpeningStat[] = [...byName.entries()].map(([name, b]) => ({
    name,
    eco: b.eco,
    games: b.games,
    wins: b.wins,
    losses: b.losses,
    draws: b.draws,
    score: (b.wins + 0.5 * b.draws) / b.games,
    accuracy: b.acc.length > 0 ? b.acc.reduce((s, a) => s + a, 0) / b.acc.length : undefined,
  }));

  stats.sort((a, b) => b.games - a.games || a.score - b.score || a.name.localeCompare(b.name));
  return stats;
}
