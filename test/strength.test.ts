import { describe, it, expect } from 'vitest';
import { eloToEngineOptions, UCI_ELO_FLOOR, UCI_ELO_CEILING } from '../src/index';

describe('eloToEngineOptions', () => {
  it('uses Skill Level below the UCI_Elo floor', () => {
    expect(eloToEngineOptions(600)).toMatchObject({ limitStrength: false, skillLevel: 0 });
    expect(eloToEngineOptions(800)).toMatchObject({ limitStrength: false, skillLevel: 2 });
    expect(eloToEngineOptions(1000)).toMatchObject({ limitStrength: false, skillLevel: 4 });
    expect(eloToEngineOptions(1200)).toMatchObject({ limitStrength: false, skillLevel: 6 });
  });
  it('uses the weakest band for very low targets', () => {
    expect(eloToEngineOptions(300)).toMatchObject({ limitStrength: false, skillLevel: 0 });
  });
  it('uses UCI_LimitStrength + UCI_Elo at or above the floor', () => {
    const o = eloToEngineOptions(1500);
    expect(o.limitStrength).toBe(true);
    expect(o.uciElo).toBe(1500);
  });
  it('treats exactly the floor as limit-strength', () => {
    const o = eloToEngineOptions(UCI_ELO_FLOOR);
    expect(o.limitStrength).toBe(true);
    expect(o.uciElo).toBe(UCI_ELO_FLOOR);
  });
  it('clamps UCI_Elo to the engine ceiling', () => {
    expect(eloToEngineOptions(5000).uciElo).toBe(UCI_ELO_CEILING);
  });
  it('always sets a positive movetime and multipv 1', () => {
    for (const elo of [300, 600, 1000, 1320, 1800, 2500]) {
      const o = eloToEngineOptions(elo);
      expect(o.movetimeMs).toBeGreaterThan(0);
      expect(o.multipv).toBe(1);
    }
  });
});
