// Loader for the static puzzle asset (public/puzzles/puzzles.json), produced offline
// by scripts/build-puzzles.mjs from the Lichess CSV. The on-disk shape is COMPACT —
// `moves` and `themes` are space-joined strings (as in the source CSV) and `rd` is
// shortened — to keep the shipped file small. This module expands a compact row into
// the app-facing `Puzzle`. Keep this in sync with build-puzzles.mjs.

import type { Puzzle } from './types';

/** Compact on-disk puzzle row (see scripts/build-puzzles.mjs). */
export interface RawPuzzle {
  id: string;
  fen: string;
  /** Space-separated UCI; moves[0] is the opponent setup move. */
  moves: string;
  rating: number;
  /** Rating deviation (compact key for `ratingDeviation`). */
  rd: number;
  /** Space-separated theme tags. */
  themes: string;
  popularity?: number;
  nbPlays?: number;
}

/** The file may be a bare array of rows, or a versioned wrapper. */
interface PuzzleFile {
  version?: number;
  puzzles: RawPuzzle[];
}

function expand(raw: RawPuzzle): Puzzle {
  return {
    id: raw.id,
    fen: raw.fen,
    moves: raw.moves.split(' ').filter(Boolean),
    rating: raw.rating,
    ratingDeviation: raw.rd,
    themes: raw.themes ? raw.themes.split(' ').filter(Boolean) : [],
    popularity: raw.popularity,
    nbPlays: raw.nbPlays,
  };
}

/** Parse the puzzles.json text into `Puzzle[]`. Accepts a bare array or `{puzzles}`. */
export function loadPuzzlesFromJson(text: string): Puzzle[] {
  const parsed: unknown = JSON.parse(text);
  const rows: RawPuzzle[] = Array.isArray(parsed)
    ? (parsed as RawPuzzle[])
    : ((parsed as PuzzleFile).puzzles ?? []);
  return rows.map(expand);
}
