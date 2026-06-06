// Tests for the "closeness to best" cp-weighted accuracy (Stage 5 follow-up). The pure
// win%-based functions still behave exactly as before (delegation), and the cp-weighted
// `effectiveWinDrop` makes imprecision in a WON position count — without ever being able
// to manufacture a 'blunder' there (cp alone caps below the blunder threshold). Also
// checks the live coach honours the weight while keeping the red refutation arrow for
// genuine win% collapses only.

import { describe, it, expect } from 'vitest';
import {
  accuracyFromWinDrop,
  classFromWinDrop,
  effectiveWinDrop,
  winPercentToAccuracy,
  classifyMove,
} from '../src/core/evalMath';
import { liveMoveFeedback } from '../src/coach/liveFeedback';

describe('drop-based helpers delegate to the same Lichess curve (back-compat)', () => {
  it('winPercentToAccuracy / classifyMove are exactly accuracyFromWinDrop / classFromWinDrop', () => {
    for (const [a, b] of [[80, 78], [80, 75], [70, 60], [90, 75], [50, 50], [40, 60]]) {
      expect(winPercentToAccuracy(a, b)).toBe(accuracyFromWinDrop(a - b));
      expect(classifyMove(a, b)).toBe(classFromWinDrop(a - b));
    }
  });
});

describe('effectiveWinDrop — cp loss counts in won positions, but never a blunder', () => {
  it('weight 0 reproduces the pure win% drop', () => {
    expect(effectiveWinDrop(80, 78, 400, 0)).toBeCloseTo(2, 9); // max(2, 0)
    expect(effectiveWinDrop(90, 60, 50, 0)).toBeCloseTo(30, 9);
  });

  it('a near-zero win% drop with real cp loss is elevated to an inaccuracy', () => {
    // Won position: win% barely moves (drop 1.5) but 250cp was given back.
    const d = effectiveWinDrop(97, 95.5, 250, 0.03); // max(1.5, 7.5) = 7.5
    expect(d).toBeCloseTo(7.5, 9);
    expect(classFromWinDrop(d)).toBe('inaccuracy'); // was 'excellent' on win% alone
    expect(accuracyFromWinDrop(d)).toBeLessThan(80);
  });

  it('cp loss ALONE can reach mistake but never blunder (cap below 15)', () => {
    // Huge cp swing, tiny win% drop (deeply won both sides): caps at < blunder threshold.
    const d = effectiveWinDrop(97, 96, 2000, 0.03);
    expect(d).toBeLessThan(15);
    expect(classFromWinDrop(d)).toBe('mistake');
  });

  it('a genuine win% collapse is still a blunder', () => {
    const d = effectiveWinDrop(80, 60, 0, 0.03); // win% drop 20 dominates
    expect(d).toBeCloseTo(20, 9);
    expect(classFromWinDrop(d)).toBe('blunder');
  });
});

describe('liveMoveFeedback honours the cp-loss weight', () => {
  // +8 -> +6: still winning, small win% drop. Pure win% calls it "good"; cp-weighting
  // makes it an inaccuracy (you gave back ~2 pawns), with the green best-move surfaced and
  // NO red refutation (you weren't actually punished — you're still winning).
  const before = { cp: 800 };
  const after = { cp: -600 }; // post-move, opponent to move, opponent -6 (mover +6)

  it('is more severe with the weight than without', () => {
    const lenient = liveMoveFeedback(before, after, 'a1a2', ['b8c6'], 'white');
    const strict = liveMoveFeedback(before, after, 'a1a2', ['b8c6'], 'white', { cpLossWeight: 0.03 });

    expect(lenient.classification).toBe('good');
    expect(strict.classification).toBe('inaccuracy');
    expect(strict.accuracy).toBeLessThan(lenient.accuracy);
    expect(strict.bestMoveUci).toBe('a1a2'); // best move surfaced for the slip
    expect(strict.refutationUci).toBeUndefined(); // not a real blunder -> no red arrow
  });
});
