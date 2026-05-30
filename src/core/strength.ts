// Map a target human-ish Elo to Stockfish engine options.
// See docs/REFERENCE.md "Strength limiting". UCI_Elo has a FLOOR of 1320,
// so below that we use Skill Level + a short movetime instead.

import type { EngineOptions } from './types';

export const UCI_ELO_FLOOR = 1320;
export const UCI_ELO_CEILING = 3190;

/** Skill-Level bands used BELOW the UCI_Elo floor. First band whose maxElo >= target wins. */
export const SKILL_BANDS: ReadonlyArray<{ maxElo: number; skillLevel: number; movetimeMs: number }> = [
  { maxElo: 600, skillLevel: 0, movetimeMs: 50 },
  { maxElo: 800, skillLevel: 2, movetimeMs: 50 },
  { maxElo: 1000, skillLevel: 4, movetimeMs: 100 },
  { maxElo: 1200, skillLevel: 6, movetimeMs: 150 },
  { maxElo: UCI_ELO_FLOOR - 1, skillLevel: 8, movetimeMs: 200 },
];

export function eloToEngineOptions(targetElo: number): EngineOptions {
  if (targetElo >= UCI_ELO_FLOOR) {
    return {
      limitStrength: true,
      uciElo: Math.min(UCI_ELO_CEILING, Math.max(UCI_ELO_FLOOR, Math.round(targetElo))),
      movetimeMs: 300,
      multipv: 1,
    };
  }
  const band = SKILL_BANDS.find((b) => targetElo <= b.maxElo) ?? SKILL_BANDS[SKILL_BANDS.length - 1];
  return { limitStrength: false, skillLevel: band.skillLevel, movetimeMs: band.movetimeMs, multipv: 1 };
}
