// Contract tests for the GameRepository, exercised against the dependency-free
// InMemoryGameRepository. The IndexedDB implementation honours the same contract;
// its browser-specific behaviour is covered by the manual acceptance run.

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGameRepository } from '../src/persistence/inMemoryGameRepository';
import type { GameRepository, NewSavedGame } from '../src/persistence/types';

function game(overrides: Partial<NewSavedGame> = {}): NewSavedGame {
  return {
    playedAt: 1,
    pgn: '1. e4 e5',
    result: '1-0',
    strengthElo: 1200,
    humanColor: 'white',
    ...overrides,
  };
}

describe('GameRepository contract (InMemory)', () => {
  let repo: GameRepository;
  beforeEach(() => {
    repo = new InMemoryGameRepository();
  });

  it('save assigns increasing ids; get returns the stored record with its id', async () => {
    const id1 = await repo.save(game({ playedAt: 1, pgn: '1. e4' }));
    const id2 = await repo.save(game({ playedAt: 2, pgn: '1. d4' }));
    expect(id2).toBeGreaterThan(id1);

    const stored = await repo.get(id1);
    expect(stored?.id).toBe(id1);
    expect(stored?.pgn).toBe('1. e4');
    expect(await repo.get(9999)).toBeUndefined();
  });

  it('list returns games newest (largest playedAt) first', async () => {
    await repo.save(game({ playedAt: 100, pgn: 'a' }));
    await repo.save(game({ playedAt: 300, pgn: 'b' }));
    await repo.save(game({ playedAt: 200, pgn: 'c' }));
    const all = await repo.list();
    expect(all.map((g) => g.pgn)).toEqual(['b', 'c', 'a']);
  });

  it('records the strength played and the human color', async () => {
    const id = await repo.save(game({ strengthElo: 1600, humanColor: 'black', result: '0-1' }));
    const stored = await repo.get(id);
    expect(stored?.strengthElo).toBe(1600);
    expect(stored?.humanColor).toBe('black');
    expect(stored?.result).toBe('0-1');
  });

  it('delete removes one game; clear removes all', async () => {
    const id = await repo.save(game({ pgn: 'x' }));
    await repo.save(game({ pgn: 'y' }));
    await repo.delete(id);
    expect((await repo.list()).map((g) => g.pgn)).toEqual(['y']);

    await repo.clear();
    expect(await repo.list()).toEqual([]);
  });

  it('update overwrites a record in place — no new id, no duplicate (resume/save loop)', async () => {
    const id = await repo.save(game({ pgn: '1. e4', result: '*', inProgress: true }));
    await repo.update({ ...game({ pgn: '1. e4 e5 2. Nf3', result: '*', inProgress: true }), id });
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);
    expect(all[0].pgn).toBe('1. e4 e5 2. Nf3');
  });

  it('round-trips the inProgress flag and finalizes via update', async () => {
    const id = await repo.save(game({ result: '*', inProgress: true }));
    expect((await repo.get(id))?.inProgress).toBe(true);

    // Finalize the same record: still one row, now finished.
    await repo.update({ ...game({ pgn: '1. e4 e5', result: '1-0', inProgress: false }), id });
    const finished = await repo.get(id);
    expect(finished?.inProgress).toBe(false);
    expect(finished?.result).toBe('1-0');
    expect(await repo.list()).toHaveLength(1);
  });
});
