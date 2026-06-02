// Optional analysis cache (Stage 2 stretch). Caches a computed GameReport keyed by
// the saved game's id so re-opening a report is instant instead of re-running a
// slow WASM analysis.
//
// This is a NEW, separate seam — it does NOT mutate GameRepository or SavedGame.
// The IndexedDB implementation uses its OWN database ('chess-trainer-analysis'),
// so it never collides with the games store's schema/version. Swappable for a
// native store behind the same interface at Stage 6, exactly like GameRepository.

import type { GameReport } from './types';

/**
 * CRUD over cached reports, keyed by the saved game's id. The stored report
 * carries the `pgn` it was computed from, so a caller can invalidate a stale
 * report if the game's moves changed.
 */
export interface AnalysisStore {
  /** Cached report for a game id, or undefined if none. */
  get(gameId: number): Promise<GameReport | undefined>;
  /** Insert or replace the cached report for a game id. */
  put(gameId: number, report: GameReport): Promise<void>;
  /** Drop the cached report for a game id (no-op if absent). */
  delete(gameId: number): Promise<void>;
  /** Drop every cached report. */
  clear(): Promise<void>;
}

/** One cached row. */
interface CachedRow {
  gameId: number;
  report: GameReport;
}

/** Dependency-free AnalysisStore for tests and as a fallback when IndexedDB is absent. */
export class InMemoryAnalysisStore implements AnalysisStore {
  private readonly rows = new Map<number, GameReport>();

  get(gameId: number): Promise<GameReport | undefined> {
    const r = this.rows.get(gameId);
    return Promise.resolve(r ? { ...r } : undefined);
  }

  put(gameId: number, report: GameReport): Promise<void> {
    this.rows.set(gameId, { ...report });
    return Promise.resolve();
  }

  delete(gameId: number): Promise<void> {
    this.rows.delete(gameId);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.rows.clear();
    return Promise.resolve();
  }
}

const DB_NAME = 'chess-trainer-analysis';
const STORE = 'reports';
const DB_VERSION = 1;

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = (): void => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Raw-IndexedDB AnalysisStore in its own database (keyPath `gameId`). */
export class IndexedDbAnalysisStore implements AnalysisStore {
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
          db.createObjectStore(this.storeName, { keyPath: 'gameId' });
        }
      };
      req.onsuccess = (): void => resolve(req.result);
      req.onerror = (): void => reject(req.error ?? new Error('Failed to open IndexedDB'));
    });
    return this.dbPromise;
  }

  async get(gameId: number): Promise<GameReport | undefined> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const row = await promisifyRequest<CachedRow | undefined>(
      tx.objectStore(this.storeName).get(gameId) as IDBRequest<CachedRow | undefined>,
    );
    return row?.report;
  }

  async put(gameId: number, report: GameReport): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    const row: CachedRow = { gameId, report };
    await promisifyRequest(tx.objectStore(this.storeName).put(row));
    await transactionDone(tx);
  }

  async delete(gameId: number): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    await promisifyRequest(tx.objectStore(this.storeName).delete(gameId));
    await transactionDone(tx);
  }

  async clear(): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    await promisifyRequest(tx.objectStore(this.storeName).clear());
    await transactionDone(tx);
  }
}
