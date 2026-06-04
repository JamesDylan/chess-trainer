import { describe, it, expect } from 'vitest';
import { InMemoryPuzzleStore, loadPuzzlesFromJson, type PuzzleAttempt } from '../src/index';

const attempt = (over: Partial<PuzzleAttempt> = {}): PuzzleAttempt => ({
  puzzleId: 'p1',
  solved: true,
  at: Date.now(),
  puzzleRating: 1500,
  ratingBefore: 1500,
  ratingAfter: 1512,
  ratingDelta: 12,
  rdAfter: 480,
  ...over,
});

describe('InMemoryPuzzleStore', () => {
  it('starts empty', async () => {
    const store = new InMemoryPuzzleStore();
    expect(await store.loadRating()).toBeUndefined();
    expect(await store.listAttempts()).toEqual([]);
  });

  it('saves and reloads the rating state', async () => {
    const store = new InMemoryPuzzleStore();
    await store.saveRating({ rating: 1623, rd: 84, vol: 0.061 });
    expect(await store.loadRating()).toEqual({ rating: 1623, rd: 84, vol: 0.061 });
    // Overwrites, not appends.
    await store.saveRating({ rating: 1630, rd: 80, vol: 0.06 });
    expect((await store.loadRating())?.rating).toBe(1630);
  });

  it('appends attempts in order and clears everything', async () => {
    const store = new InMemoryPuzzleStore();
    await store.appendAttempt(attempt({ puzzleId: 'a' }));
    await store.appendAttempt(attempt({ puzzleId: 'b', solved: false, ratingDelta: -9 }));
    const log = await store.listAttempts();
    expect(log.map((a) => a.puzzleId)).toEqual(['a', 'b']);
    expect(log[1].solved).toBe(false);

    await store.clear();
    expect(await store.listAttempts()).toEqual([]);
    expect(await store.loadRating()).toBeUndefined();
  });
});

describe('loadPuzzlesFromJson', () => {
  it('expands compact rows (versioned wrapper)', () => {
    const text = JSON.stringify({
      version: 1,
      puzzles: [{ id: 'x', fen: 'F', moves: 'e2e4 e7e5', rating: 1000, rd: 70, themes: 'opening short', popularity: 90 }],
    });
    const [p] = loadPuzzlesFromJson(text);
    expect(p.id).toBe('x');
    expect(p.ratingDeviation).toBe(70);
    expect(p.moves).toEqual(['e2e4', 'e7e5']);
    expect(p.themes).toEqual(['opening', 'short']);
  });

  it('accepts a bare array and empty themes', () => {
    const [p] = loadPuzzlesFromJson(JSON.stringify([{ id: 'y', fen: 'F', moves: 'a1a2', rating: 1, rd: 1, themes: '' }]));
    expect(p.id).toBe('y');
    expect(p.themes).toEqual([]);
  });
});
