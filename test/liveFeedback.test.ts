// Deterministic tests for the PURE live-coaching core (no engine, no WASM, no DOM).
// The scripted scores/PVs reproduce the two acceptance scenarios from the Stage 5
// brief — the +4 -> -0.15 blunder and the missed "M8" mate — and assert the feedback
// is derived by REUSING evalMath (cross-checked against the library functions), with
// the refutation read off the PV and the missed-opportunity flag set independently of
// the move's classification. REFERENCE §1 anchors: cp 200 -> 67.62, mate values, etc.

import { describe, it, expect } from 'vitest';
import {
  liveMoveFeedback,
  shouldShowBestMove,
  COACH_BESTMOVE_ACCURACY,
  COACH_WINNING_CP,
} from '../src/coach/liveFeedback';
import { scoreToWinPercent, winPercentToAccuracy, classifyMove } from '../src/core/evalMath';
import { centipawnLoss } from '../src/analysis/analyzer';
import type { Score } from '../src/core/types';

describe('liveMoveFeedback — win%/accuracy/classification reuse evalMath verbatim', () => {
  it('derives every metric from the evalMath functions (cross-checked)', () => {
    const before: Score = { cp: 0 };
    const after: Score = { cp: 200 }; // post-move, opponent to move, opponent +200
    const fb = liveMoveFeedback(before, after, 'g1f3', ['b8c6'], 'white');

    // winBefore from cp 0 = 50.00; winAfter = 100 - winPercent(cp 200) = 100 - 67.62.
    expect(fb.winBefore).toBeCloseTo(50.0, 6);
    expect(fb.winBefore).toBeCloseTo(scoreToWinPercent(before), 9);
    expect(fb.winAfter).toBeCloseTo(100 - 67.62, 1); // REFERENCE: cp 200 -> 67.62
    expect(fb.winAfter).toBeCloseTo(100 - scoreToWinPercent(after), 9);

    // accuracy + classification must be the evalMath functions, not a re-derivation.
    expect(fb.accuracy).toBeCloseTo(winPercentToAccuracy(fb.winBefore, fb.winAfter), 9);
    expect(fb.classification).toBe(classifyMove(fb.winBefore, fb.winAfter));
    // cpLoss must be the analyzer's bounded helper (shared, not forked).
    expect(fb.cpLoss).toBeCloseTo(centipawnLoss(before, after, undefined), 9);
  });
});

describe('liveMoveFeedback — the +4 -> -0.15 blunder (acceptance scenario)', () => {
  // My knight on e5 was left undefended. scoreBefore +4 (mover to move); after my move
  // the eval is -0.15 for me => +0.15 for the opponent to move (cp 15). The engine's PV
  // from the post-move position starts with the capture of the hanging knight.
  const before: Score = { cp: 400 };
  const after: Score = { cp: 15 };
  const bestMove = 'e3e4'; // push the e-pawn so the rook defends e5
  const pv = ['d6e5', 'c3d5']; // refutation: ...Nxe5 wins the knight, then a follow-up
  const fb = liveMoveFeedback(before, after, bestMove, pv, 'white');

  it('flags a ?? blunder', () => {
    expect(fb.classification).toBe('blunder');
    expect(fb.classification).toBe(classifyMove(fb.winBefore, fb.winAfter));
    expect(fb.accuracy).toBeLessThan(COACH_BESTMOVE_ACCURACY);
  });

  it('surfaces the best move I should have played', () => {
    expect(fb.bestMoveUci).toBe('e3e4');
    expect(shouldShowBestMove(fb)).toBe(true);
  });

  it('shows WHY: the refutation is the PV first move, with the full line exposed', () => {
    expect(fb.refutationUci).toBe('d6e5'); // the capture of the now-undefended knight
    expect(fb.refutationLine).toEqual(['d6e5', 'c3d5']); // steppable, even if the cost lands later
  });

  it('also recognises a decisive advantage was given back (missed winning)', () => {
    expect(fb.missedOpportunity).toBe('winning');
  });

  it('reports the centipawn swing (mover POV)', () => {
    // +400 down to -15 (mover POV) = a 415 cp loss, via the shared analyzer helper.
    expect(fb.cpLoss).toBe(415);
    expect(fb.cpLoss).toBe(centipawnLoss(before, after, undefined));
  });
});

describe('liveMoveFeedback — the missed "M8" mate (the other side of the coin)', () => {
  // I had a forced mate (M8). I played a move that keeps a winning +6 but throws away
  // the mate: post-move the opponent is -600 (cp). This is NOT a blunder, yet the coach
  // must still flag the missed mate and offer a retry.
  const before: Score = { mate: 8 };
  const after: Score = { cp: -600 };
  const mating = 'd1h5';
  const fb = liveMoveFeedback(before, after, mating, ['g8f6'], 'white');

  it('is not a blunder', () => {
    expect(fb.classification).not.toBe('blunder');
    expect(fb.classification).toBe(classifyMove(fb.winBefore, fb.winAfter));
  });

  it('flags the missed mate anyway (does not stay silent)', () => {
    expect(fb.missedOpportunity).toBe('mate');
    expect(fb.accuracy).toBeLessThan(COACH_BESTMOVE_ACCURACY);
  });

  it('shows the stronger (mating) move but no red refutation (the move was not a "??")', () => {
    expect(fb.bestMoveUci).toBe('d1h5');
    expect(shouldShowBestMove(fb)).toBe(true);
    expect(fb.refutationUci).toBeUndefined();
  });

  it("winBefore reads the forced mate off scoreBefore.mate (REFERENCE: closer mate scores higher)", () => {
    expect(fb.winBefore).toBeCloseTo(scoreToWinPercent({ mate: 8 }), 9);
    expect(fb.winBefore).toBeGreaterThan(99); // a forced mate is ~99%+
  });
});

describe('liveMoveFeedback — keeping the mate does NOT nag', () => {
  it('advancing M8 -> M2 keeps ~100% accuracy and raises no missed-opportunity', () => {
    // Post-move the opponent is getting mated in 2 (mate -2 from their POV) => I still mate.
    const fb = liveMoveFeedback({ mate: 8 }, { mate: -2 }, 'd1h5', ['a7a6'], 'white');
    expect(fb.accuracy).toBe(100); // winAfter >= winBefore
    expect(fb.classification).toBe('best');
    expect(fb.missedOpportunity).toBeUndefined();
    expect(fb.refutationUci).toBeUndefined();
  });
});

describe('liveMoveFeedback — missed winning (decisive cp given back, not a blunder)', () => {
  it('flags "winning" when a decisive +5 slips to a merely-winning +3.5 (an inaccuracy)', () => {
    // before +500 (winBefore ~86.31), after = opponent -350 (I am +350): an inaccuracy,
    // but a decisive advantage was not kept -> missedOpportunity 'winning'.
    const before: Score = { cp: 500 };
    const after: Score = { cp: -350 };
    const fb = liveMoveFeedback(before, after, 'f1c4', ['b8c6'], 'white');

    expect(before.cp).toBeGreaterThanOrEqual(COACH_WINNING_CP);
    expect(fb.classification).not.toBe('blunder');
    expect(fb.accuracy).toBeLessThan(COACH_BESTMOVE_ACCURACY);
    expect(fb.missedOpportunity).toBe('winning');
    expect(fb.refutationUci).toBeUndefined(); // not a blunder -> no red arrow
  });
});

describe('liveMoveFeedback — a clean move keeps the coach quiet', () => {
  it('a best-quality move: high accuracy, no best-move surfacing, no flags', () => {
    const fb = liveMoveFeedback({ cp: 30 }, { cp: -25 }, 'g1f3', ['b8c6'], 'white');
    expect(fb.classification).toBe('best');
    expect(fb.accuracy).toBeGreaterThanOrEqual(COACH_BESTMOVE_ACCURACY);
    expect(shouldShowBestMove(fb)).toBe(false);
    expect(fb.refutationUci).toBeUndefined();
    expect(fb.missedOpportunity).toBeUndefined();
  });
});

describe('liveMoveFeedback — walking into mate is a blunder with the mating refutation', () => {
  it('post-move opponent has mate in 1 -> blunder, refutation = the mating move', () => {
    // I hang mate: post-move it is the opponent to move with mate in 1.
    const fb = liveMoveFeedback({ cp: 0 }, { mate: 1 }, 'e1e2', ['d8h4'], 'black');
    expect(fb.winAfter).toBeCloseTo(100 - scoreToWinPercent({ mate: 1 }), 9); // ~0.06
    expect(fb.classification).toBe('blunder');
    expect(fb.refutationUci).toBe('d8h4'); // the mate the opponent now plays
  });
});
