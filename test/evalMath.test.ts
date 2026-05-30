import { describe, it, expect } from 'vitest';
import {
  cpToWinPercent,
  scoreToWinPercent,
  winPercentToAccuracy,
  classifyMove,
  averageCentipawnLoss,
  harmonicMean,
} from '../src/index';

describe('cpToWinPercent', () => {
  it('is 50 at cp 0', () => {
    expect(cpToWinPercent(0)).toBeCloseTo(50, 6);
  });
  it('matches the Lichess logistic', () => {
    expect(cpToWinPercent(100)).toBeCloseTo(59.1026, 3);
    expect(cpToWinPercent(200)).toBeCloseTo(67.6212, 3);
    expect(cpToWinPercent(300)).toBeCloseTo(75.1126, 3);
    expect(cpToWinPercent(500)).toBeCloseTo(86.3072, 3);
    expect(cpToWinPercent(-100)).toBeCloseTo(40.8974, 3);
  });
  it('clamps cp to +/- 1000', () => {
    expect(cpToWinPercent(1000)).toBeCloseTo(97.5447, 3);
    expect(cpToWinPercent(2000)).toBeCloseTo(cpToWinPercent(1000), 6);
    expect(cpToWinPercent(-1000)).toBeCloseTo(2.4553, 3);
  });
  it('is symmetric around 50', () => {
    expect(cpToWinPercent(250) + cpToWinPercent(-250)).toBeCloseTo(100, 6);
  });
});

describe('scoreToWinPercent', () => {
  it('handles cp scores', () => {
    expect(scoreToWinPercent({ cp: 0 })).toBeCloseTo(50, 6);
    expect(scoreToWinPercent({ cp: 100 })).toBeCloseTo(59.1026, 3);
  });
  it('handles mate scores, with closer mates scoring higher', () => {
    expect(scoreToWinPercent({ mate: 1 })).toBeCloseTo(99.9367, 2);
    expect(scoreToWinPercent({ mate: 5 })).toBeCloseTo(99.7244, 2);
    expect(scoreToWinPercent({ mate: 10 })).toBeCloseTo(98.2881, 2);
    expect(scoreToWinPercent({ mate: -1 })).toBeCloseTo(0.0633, 2);
    expect(scoreToWinPercent({ mate: 1 })).toBeGreaterThan(scoreToWinPercent({ mate: 10 }));
  });
});

describe('winPercentToAccuracy', () => {
  it('is 100 when the position did not get worse', () => {
    expect(winPercentToAccuracy(50, 50)).toBeCloseTo(100, 6);
    expect(winPercentToAccuracy(40, 60)).toBeCloseTo(100, 6);
  });
  it('matches the Lichess accuracy curve (by win% drop)', () => {
    expect(winPercentToAccuracy(80, 78)).toBeCloseTo(91.3962, 2); // drop 2
    expect(winPercentToAccuracy(80, 75)).toBeCloseTo(79.817, 2); // drop 5
    expect(winPercentToAccuracy(70, 60)).toBeCloseTo(63.5826, 2); // drop 10
    expect(winPercentToAccuracy(90, 75)).toBeCloseTo(50.5242, 2); // drop 15
    expect(winPercentToAccuracy(100, 60)).toBeCloseTo(14.912, 2); // drop 40
  });
  it('stays within [0, 100]', () => {
    const a = winPercentToAccuracy(100, 0);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(100);
  });
});

describe('classifyMove', () => {
  it('labels by win% drop band', () => {
    expect(classifyMove(50, 50)).toBe('best'); // 0
    expect(classifyMove(50, 49.5)).toBe('best'); // 0.5
    expect(classifyMove(50, 48)).toBe('excellent'); // 2
    expect(classifyMove(50, 46)).toBe('good'); // 4
    expect(classifyMove(50, 43)).toBe('inaccuracy'); // 7
    expect(classifyMove(50, 38)).toBe('mistake'); // 12
    expect(classifyMove(50, 30)).toBe('blunder'); // 20
  });
  it('treats an improvement as best', () => {
    expect(classifyMove(40, 55)).toBe('best');
  });
  it('flags a hung queen as a blunder', () => {
    expect(classifyMove(55, 5)).toBe('blunder');
  });
});

describe('averageCentipawnLoss', () => {
  it('averages per-move losses', () => {
    expect(averageCentipawnLoss([0, 10, 50, 100, 40])).toBeCloseTo(40, 6);
  });
  it('is 0 for no moves', () => {
    expect(averageCentipawnLoss([])).toBe(0);
  });
});

describe('harmonicMean', () => {
  it('computes the harmonic mean', () => {
    expect(harmonicMean([50, 100])).toBeCloseTo(66.6667, 3);
    expect(harmonicMean([60, 60, 60])).toBeCloseTo(60, 6);
  });
  it('is 0 for empty input', () => {
    expect(harmonicMean([])).toBe(0);
  });
});
