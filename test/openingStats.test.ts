import { describe, it, expect } from 'vitest';
import {
  computeOpeningStats,
  humanOutcome,
  diagnoseWeaknesses,
  buildProgressSnapshot,
  computePuzzleStats,
  computeGameStats,
} from '../src/coach';
import type { GameOpeningRecord } from '../src/coach';

const rec = (over: Partial<GameOpeningRecord> = {}): GameOpeningRecord => ({
  opening: { name: 'Sicilian Defense', eco: 'B20' },
  result: '1-0',
  humanColor: 'white',
  ...over,
});

const noPuzzles = computePuzzleStats([]);
const noGames = computeGameStats([], 0);

describe('humanOutcome', () => {
  it('maps result + color to the user POV', () => {
    expect(humanOutcome('1-0', 'white')).toBe('win');
    expect(humanOutcome('1-0', 'black')).toBe('loss');
    expect(humanOutcome('0-1', 'black')).toBe('win');
    expect(humanOutcome('0-1', 'white')).toBe('loss');
    expect(humanOutcome('1/2-1/2', 'white')).toBe('draw');
  });
});

describe('computeOpeningStats', () => {
  it('aggregates W/L/D + score per opening; skips unrecognised + unfinished', () => {
    const records: GameOpeningRecord[] = [
      rec({ opening: { name: 'French Defense' }, result: '0-1', humanColor: 'white' }), // loss
      rec({ opening: { name: 'French Defense' }, result: '1-0', humanColor: 'white' }), // win
      rec({ opening: { name: 'French Defense' }, result: '1/2-1/2', humanColor: 'white' }), // draw
      rec({ opening: { name: 'Sicilian Defense' }, result: '0-1', humanColor: 'black' }), // win (black)
      rec({ opening: undefined, result: '1-0', humanColor: 'white' }), // unrecognised → skip
      rec({ opening: { name: 'Sicilian Defense' }, result: '*', humanColor: 'white' }), // unfinished → skip
    ];
    const stats = computeOpeningStats(records);
    const french = stats.find((s) => s.name === 'French Defense')!;
    expect(french.games).toBe(3);
    expect([french.wins, french.losses, french.draws]).toEqual([1, 1, 1]);
    expect(french.score).toBeCloseTo(0.5, 6); // (1 + 0.5) / 3
    const sicilian = stats.find((s) => s.name === 'Sicilian Defense')!;
    expect(sicilian.games).toBe(1);
    expect(sicilian.wins).toBe(1); // 0-1 with black = a win
    expect(stats[0].name).toBe('French Defense'); // most-played first
    expect(stats.reduce((n, s) => n + s.games, 0)).toBe(4); // 2 skipped
  });

  it('averages accuracy over analysed games only', () => {
    const records: GameOpeningRecord[] = [
      rec({ opening: { name: 'Italian Game' }, result: '1-0', accuracy: 80 }),
      rec({ opening: { name: 'Italian Game' }, result: '0-1', accuracy: 60 }),
      rec({ opening: { name: 'Italian Game' }, result: '1-0' }), // not analysed
    ];
    const s = computeOpeningStats(records).find((o) => o.name === 'Italian Game')!;
    expect(s.games).toBe(3);
    expect(s.accuracy).toBeCloseTo(70, 6); // mean of 80, 60
  });

  it('empty input → []', () => {
    expect(computeOpeningStats([])).toEqual([]);
  });
});

describe('opening weakness + snapshot integration', () => {
  const weakFrench: GameOpeningRecord[] = [
    rec({ opening: { name: 'French Defense' }, result: '1-0', humanColor: 'white' }), // 1 win
    ...Array.from({ length: 4 }, () => rec({ opening: { name: 'French Defense' }, result: '0-1', humanColor: 'white' })), // 4 losses
  ]; // score 0.2 over 5 games

  it('flags a low-scoring opening with enough games, and carries no drill theme', () => {
    const openings = computeOpeningStats(weakFrench);
    const ws = diagnoseWeaknesses(noPuzzles, noGames, openings);
    const w = ws.find((x) => x.id === 'opening:French Defense');
    expect(w).toBeTruthy();
    expect(w?.kind).toBe('opening');
    expect(w?.drillTheme).toBeUndefined();
  });

  it('does not flag an opening below the minimum game count', () => {
    const fewGames: GameOpeningRecord[] = [
      rec({ opening: { name: 'French Defense' }, result: '0-1', humanColor: 'white' }),
      rec({ opening: { name: 'French Defense' }, result: '0-1', humanColor: 'white' }),
    ];
    const ws = diagnoseWeaknesses(noPuzzles, noGames, computeOpeningStats(fewGames));
    expect(ws.find((x) => x.id.startsWith('opening:'))).toBeUndefined();
  });

  it('buildProgressSnapshot surfaces openings + an opening insight', () => {
    const snap = buildProgressSnapshot({
      attempts: [],
      analyzedGames: [],
      totalGames: 5,
      gameOpenings: weakFrench,
    });
    expect(snap.openings[0].name).toBe('French Defense');
    expect(snap.openings[0].score).toBeCloseTo(0.2, 6);
    expect(snap.insights.some((i) => i.id === 'opening:French Defense')).toBe(true);
    expect(snap.hasData).toBe(true);
  });

  it('snapshot without gameOpenings still works (openings default to [])', () => {
    const snap = buildProgressSnapshot({ attempts: [], analyzedGames: [], totalGames: 0 });
    expect(snap.openings).toEqual([]);
  });
});
