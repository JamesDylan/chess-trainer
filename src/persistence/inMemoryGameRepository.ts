// In-memory GameRepository: a dependency-free implementation of the same contract
// as the IndexedDB store. Used by the contract tests (Node, no browser env) and as
// a safe fallback when IndexedDB is unavailable (e.g. private-mode quirks).

import type { GameRepository, NewSavedGame, SavedGame } from './types';

export class InMemoryGameRepository implements GameRepository {
  private readonly rows = new Map<number, SavedGame>();
  private nextId = 1;

  save(game: NewSavedGame): Promise<number> {
    const id = this.nextId++;
    this.rows.set(id, { ...game, id });
    return Promise.resolve(id);
  }

  update(game: SavedGame): Promise<void> {
    this.rows.set(game.id, { ...game });
    if (game.id >= this.nextId) this.nextId = game.id + 1;
    return Promise.resolve();
  }

  list(): Promise<SavedGame[]> {
    const all = [...this.rows.values()].sort((a, b) => b.playedAt - a.playedAt);
    return Promise.resolve(all);
  }

  get(id: number): Promise<SavedGame | undefined> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? { ...row } : undefined);
  }

  delete(id: number): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.rows.clear();
    return Promise.resolve();
  }
}
