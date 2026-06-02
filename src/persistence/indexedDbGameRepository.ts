// Raw-IndexedDB GameRepository (no dependency). One object store, `games`, keyed by
// an auto-incrementing `id`, with a `playedAt` index. Each IndexedDB request is
// wrapped in a Promise so the async `GameRepository` contract is honoured.
//
// Swappable for SQLite/native behind the same interface at Stage 6.

import type { GameRepository, NewSavedGame, SavedGame } from './types';

const DB_NAME = 'chess-trainer';
const STORE = 'games';
const DB_VERSION = 1;

/** Promisify a single IDBRequest. */
function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** Resolve when a transaction commits (so callers can await durability). */
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = (): void => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class IndexedDbGameRepository implements GameRepository {
  private dbPromise?: Promise<IDBDatabase>;

  constructor(
    private readonly dbName: string = DB_NAME,
    private readonly storeName: string = STORE,
  ) {}

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available in this environment'));
        return;
      }
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = (): void => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
          store.createIndex('playedAt', 'playedAt', { unique: false });
        }
      };
      req.onsuccess = (): void => resolve(req.result);
      req.onerror = (): void => reject(req.error ?? new Error('Failed to open IndexedDB'));
    });
    return this.dbPromise;
  }

  async save(game: NewSavedGame): Promise<number> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    // The store assigns `id` (autoIncrement); add() resolves with that key.
    const key = await promisifyRequest(tx.objectStore(this.storeName).add(game));
    await transactionDone(tx);
    return key as number;
  }

  async update(game: SavedGame): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    // put() upserts at the record's keyPath id (overwrites if present).
    await promisifyRequest(tx.objectStore(this.storeName).put(game));
    await transactionDone(tx);
  }

  async list(): Promise<SavedGame[]> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const rows = await promisifyRequest<SavedGame[]>(
      tx.objectStore(this.storeName).getAll() as IDBRequest<SavedGame[]>,
    );
    return rows.sort((a, b) => b.playedAt - a.playedAt);
  }

  async get(id: number): Promise<SavedGame | undefined> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const row = await promisifyRequest<SavedGame | undefined>(
      tx.objectStore(this.storeName).get(id) as IDBRequest<SavedGame | undefined>,
    );
    return row;
  }

  async delete(id: number): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    await promisifyRequest(tx.objectStore(this.storeName).delete(id));
    await transactionDone(tx);
  }

  async clear(): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    await promisifyRequest(tx.objectStore(this.storeName).clear());
    await transactionDone(tx);
  }
}
