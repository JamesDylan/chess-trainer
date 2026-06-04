import { describe, it, expect } from 'vitest';
import { selectNextPuzzle, type Puzzle } from '../src/index';

const mk = (id: string, rating: number, themes: string[] = []): Puzzle => ({
  id,
  fen: '8/8/8/8/8/8/8/8 w - - 0 1',
  moves: ['a1a2', 'a8a7'],
  rating,
  ratingDeviation: 50,
  themes,
});

const puzzles: Puzzle[] = [
  mk('a', 800, ['fork']),
  mk('b', 1200, ['pin']),
  mk('c', 1210, ['fork']),
  mk('d', 2000, ['endgame']),
];
const zero = (): number => 0; // deterministic: always pick the first candidate

describe('selectNextPuzzle', () => {
  it('picks a puzzle near the user’s rating', () => {
    const p = selectNextPuzzle(puzzles, { rating: 1205, rng: zero });
    expect(p).toBeDefined();
    expect(Math.abs((p as Puzzle).rating - 1205)).toBeLessThanOrEqual(150);
  });

  it('avoids recently-seen puzzles', () => {
    const p = selectNextPuzzle(puzzles, { rating: 1205, excludeIds: ['b'], rng: zero });
    expect(p?.id).not.toBe('b');
  });

  it('honours a theme filter', () => {
    const p = selectNextPuzzle(puzzles, { rating: 1205, themes: ['fork'], rng: zero });
    expect(p?.themes).toContain('fork');
  });

  it('falls back to the closest puzzle when none fall inside the window', () => {
    const p = selectNextPuzzle(puzzles, { rating: 5000, rng: zero });
    expect(p?.id).toBe('d'); // 2000 is nearest to 5000
  });

  it('returns undefined when no puzzle matches the theme, or the pool is empty', () => {
    expect(selectNextPuzzle(puzzles, { rating: 1000, themes: ['noSuchTheme'], rng: zero })).toBeUndefined();
    expect(selectNextPuzzle([], { rating: 1000 })).toBeUndefined();
  });

  it('still returns a puzzle when every candidate was recently seen (allows repeats)', () => {
    const p = selectNextPuzzle(puzzles, { rating: 1205, excludeIds: ['a', 'b', 'c', 'd'], rng: zero });
    expect(p).toBeDefined();
  });
});
