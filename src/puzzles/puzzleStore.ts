// Puzzle progress persistence (Stage 3). Stores the user's Glicko-2 rating state and
// an attempt log so progress survives reloads and feeds Stage 4 tracking/coaching.
//
// This is a NEW, separate seam — it does NOT mutate GameRepository/SavedGame. The
// IndexedDB implementation uses its OWN database ('chess-trainer-puzzles') with two
// object stores ('state' for the single rating row, 'attempts' as an append log),
// so it never collides with the games store or the analysis cache. It mirrors
// src/analysis/analysisStore.ts and is swappable for a native store at Stage 6.

import type { RatingState } from '../core/rating';
import type { PuzzleAttempt } from './types';

/**
 * CRUD over puzzle progress: the user's current Glicko-2 state (a single row) and an
 * append-only attempt log (newest last). All async so the same interface fits both
 * IndexedDB (browser) and a future native store.
 */
export interface PuzzleStore {
  /** The persisted rating state, or undefined if the user has never solved a puzzle. */
  loadRating(): Promise<RatingState | undefined>;
  /** Insert or replace the rating state. */
  saveRating(state: RatingState): Promise<void>;
  /** Append one attempt to the log. */
  appendAttempt(attempt: PuzzleAttempt): Promise<void>;
  /** Every attempt, oldest first. */
  listAttempts(): Promise<PuzzleAttempt[]>;
  /** Drop all rating state and attempts. */
  clear(): Promise<void>;
}

/** Dependency-free PuzzleStore for tests and as a fallback when IndexedDB is absent. */
export class InMemoryPuzzleStore implements PuzzleStore {
  private rating?: RatingState;
  private readonly attempts: PuzzleAttempt[] = [];

  loadRating(): Promise<RatingState | undefined> {
    return Promise.resolve(this.rating ? { ...this.rating } : undefined);
  }

  saveRating(state: RatingState): Promise<void> {
    this.rating = { ...state };
    return Promise.resolve();
  }

  appendAttempt(attempt: PuzzleAttempt): Promise<void> {
    this.attempts.push({ ...attempt });
    return Promise.resolve();
  }

  listAttempts(): Promise<PuzzleAttempt[]> {
    return Promise.resolve(this.attempts.map((a) => ({ ...a })));
  }

  clear(): Promise<void> {
    this.rating = undefined;
    this.attempts.length = 0;
    return Promise.resolve();
  }
}

const DB_NAME = 'chess-trainer-puzzles';
const STATE_STORE = 'state';
const ATTEMPTS_STORE = 'attempts';
const RATING_KEY = 'rating';
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

interface StateRow {
  key: string;
  value: RatingState;
}

/** Raw-IndexedDB PuzzleStore in its own database. */
export class IndexedDbPuzzleStore implements PuzzleStore {
  private dbPromise?: Promise<IDBDatabase>;

  constructor(private readonly dbName: string = DB_NAME) {}

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
        if (!db.objectStoreNames.contains(STATE_STORE)) {
          db.createObjectStore(STATE_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(ATTEMPTS_STORE)) {
          db.createObjectStore(ATTEMPTS_STORE, { keyPath: 'seq', autoIncrement: true });
        }
      };
      req.onsuccess = (): void => resolve(req.result);
      req.onerror = (): void => reject(req.error ?? new Error('Failed to open IndexedDB'));
    });
    return this.dbPromise;
  }

  async loadRating(): Promise<RatingState | undefined> {
    const db = await this.openDb();
    const tx = db.transaction(STATE_STORE, 'readonly');
    const row = await promisifyRequest<StateRow | undefined>(
      tx.objectStore(STATE_STORE).get(RATING_KEY) as IDBRequest<StateRow | undefined>,
    );
    return row?.value;
  }

  async saveRating(state: RatingState): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(STATE_STORE, 'readwrite');
    const row: StateRow = { key: RATING_KEY, value: state };
    await promisifyRequest(tx.objectStore(STATE_STORE).put(row));
    await transactionDone(tx);
  }

  async appendAttempt(attempt: PuzzleAttempt): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(ATTEMPTS_STORE, 'readwrite');
    await promisifyRequest(tx.objectStore(ATTEMPTS_STORE).add(attempt));
    await transactionDone(tx);
  }

  async listAttempts(): Promise<PuzzleAttempt[]> {
    const db = await this.openDb();
    const tx = db.transaction(ATTEMPTS_STORE, 'readonly');
    const all = await promisifyRequest<PuzzleAttempt[]>(
      tx.objectStore(ATTEMPTS_STORE).getAll() as IDBRequest<PuzzleAttempt[]>,
    );
    return all;
  }

  async clear(): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction([STATE_STORE, ATTEMPTS_STORE], 'readwrite');
    await promisifyRequest(tx.objectStore(STATE_STORE).clear());
    await promisifyRequest(tx.objectStore(ATTEMPTS_STORE).clear());
    await transactionDone(tx);
  }
}
