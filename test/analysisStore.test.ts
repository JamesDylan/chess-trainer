// Contract tests for the AnalysisStore, exercised against the dependency-free
// InMemoryAnalysisStore. The IndexedDB implementation honours the same contract in
// its OWN database (not the games store); its browser behaviour is covered by the
// manual acceptance run.

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAnalysisStore } from '../src/analysis/analysisStore';
import type { AnalysisStore } from '../src/analysis/analysisStore';
import type { GameReport } from '../src/analysis/types';

function report(overrides: Partial<GameReport> = {}): GameReport {
  const emptyCounts = { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  return {
    version: 2,
    pgn: '1. e4 e5',
    result: '*',
    moves: [],
    white: { color: 'white', moveCount: 0, accuracy: 0, acpl: 0, counts: { ...emptyCounts } },
    black: { color: 'black', moveCount: 0, accuracy: 0, acpl: 0, counts: { ...emptyCounts } },
    depth: 16,
    analyzedAt: 1,
    ...overrides,
  };
}

describe('AnalysisStore contract (InMemory)', () => {
  let store: AnalysisStore;
  beforeEach(() => {
    store = new InMemoryAnalysisStore();
  });

  it('put then get round-trips a report by game id', async () => {
    expect(await store.get(1)).toBeUndefined();
    await store.put(1, report({ pgn: '1. e4', depth: 18 }));
    const got = await store.get(1);
    expect(got?.pgn).toBe('1. e4');
    expect(got?.depth).toBe(18);
  });

  it('put overwrites the report for the same game id (no duplicates)', async () => {
    await store.put(7, report({ pgn: 'old' }));
    await store.put(7, report({ pgn: 'new' }));
    expect((await store.get(7))?.pgn).toBe('new');
  });

  it('keeps reports for different game ids independent', async () => {
    await store.put(1, report({ pgn: 'a' }));
    await store.put(2, report({ pgn: 'b' }));
    expect((await store.get(1))?.pgn).toBe('a');
    expect((await store.get(2))?.pgn).toBe('b');
  });

  it('delete removes one report; clear removes all', async () => {
    await store.put(1, report());
    await store.put(2, report());
    await store.delete(1);
    expect(await store.get(1)).toBeUndefined();
    expect(await store.get(2)).toBeDefined();
    await store.clear();
    expect(await store.get(2)).toBeUndefined();
  });

  it('returns a copy so cached reports are not mutated by callers', async () => {
    const r = report({ pgn: 'immutable' });
    await store.put(3, r);
    const got = await store.get(3);
    if (got) got.pgn = 'mutated';
    expect((await store.get(3))?.pgn).toBe('immutable');
  });
});
