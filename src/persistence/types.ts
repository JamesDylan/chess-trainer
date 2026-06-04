// Game persistence seam. Stage 1 stores finished games (PGN + result + the strength
// the engine played at) so they survive reloads. The interface is deliberately
// storage-agnostic: the Stage 1 implementation is raw IndexedDB (no dependency),
// and it can be swapped for SQLite behind this same interface at Stage 6 — nothing
// above `GameRepository` changes, exactly like the UciTransport seam for engines.

import type { Color, GameResult } from '../core/types';

/** A persisted game. `id` is assigned by the store on save. */
export interface SavedGame {
  id: number;
  /** When the game finished (epoch milliseconds). */
  playedAt: number;
  /** Full PGN (from `ChessGame.pgn()`). */
  pgn: string;
  /** Final result (from `ChessGame.result()`). */
  result: GameResult;
  /** Target Elo the engine was set to for this game. */
  strengthElo: number;
  /** Which side the human played. */
  humanColor: Color;
  /** True while the game is unfinished (saved mid-play, resumable). Absent/false = finished. */
  inProgress?: boolean;
  /** True if the player took a move back at any point during this game. */
  undoUsed?: boolean;
}

/** A game to persist, before the store assigns an `id`. */
export type NewSavedGame = Omit<SavedGame, 'id'>;

/**
 * CRUD over saved games. All methods are async so the same interface fits both
 * IndexedDB (browser) and a future SQLite/native store (Tauri, Stage 6).
 */
export interface GameRepository {
  /** Persist a new game; resolves with its newly-assigned id. */
  save(game: NewSavedGame): Promise<number>;
  /** Overwrite an existing game in place (upsert by id). Used to update an
   *  in-progress game after each save, and to finalize it when the game ends. */
  update(game: SavedGame): Promise<void>;
  /** All saved games, newest (largest `playedAt`) first. */
  list(): Promise<SavedGame[]>;
  /** One game by id, or undefined if not found. */
  get(id: number): Promise<SavedGame | undefined>;
  /** Delete one game by id (no-op if absent). */
  delete(id: number): Promise<void>;
  /** Delete every saved game. */
  clear(): Promise<void>;
}
