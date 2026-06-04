import { describe, it, expect } from 'vitest';
import { PuzzleSession, type Puzzle } from '../src/index';

// Real Lichess puzzles (verified to replay legally) + two tiny synthetic positions
// for the promotion and alternate-mate paths. No engine/WASM — the solution line is
// known, so the session is pure and deterministic.

const mk = (over: Partial<Puzzle> & Pick<Puzzle, 'fen' | 'moves'>): Puzzle => ({
  id: 'test',
  rating: 1500,
  ratingDeviation: 75,
  themes: [],
  ...over,
});

describe('PuzzleSession — setup + solver alternation', () => {
  it('auto-applies the setup move so it is the solver’s turn', () => {
    const s = new PuzzleSession(
      mk({ fen: '5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27', moves: ['d3d6', 'f8d8', 'd6d8', 'f6d8'] }),
    );
    expect(s.solverColor).toBe('black'); // White's d3d6 was the setup move
    expect(s.setupMove).toBe('d3d6');
    expect(s.totalSolverMoves()).toBe(2);
    expect(s.expectedMove()).toBe('f8d8');
  });

  it('validates a multi-move line, auto-replying for the opponent, to SOLVED', () => {
    const s = new PuzzleSession(
      mk({ fen: '5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27', moves: ['d3d6', 'f8d8', 'd6d8', 'f6d8'] }),
    );
    const first = s.tryMove('f8d8');
    expect(first.correct).toBe(true);
    expect(first.status).toBe('in-progress');
    expect(first.opponentReply).toBe('d6d8'); // opponent's reply was auto-played
    expect(first.done).toBe(false);
    expect(s.solverMovesMade()).toBe(1);

    const second = s.tryMove('f6d8');
    expect(second.correct).toBe(true);
    expect(second.status).toBe('solved');
    expect(second.done).toBe(true);
    expect(s.status).toBe('solved');
  });

  it('does NOT terminate on a wrong move — the position is unchanged and you retry', () => {
    const s = new PuzzleSession(
      mk({ fen: '5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27', moves: ['d3d6', 'f8d8', 'd6d8', 'f6d8'] }),
    );
    const fenBefore = s.fen();
    const wrong = s.tryMove('g8h8'); // legal, but not the solution
    expect(wrong.correct).toBe(false);
    expect(wrong.status).toBe('in-progress'); // not terminated
    expect(wrong.done).toBe(false);
    expect(wrong.expected).toBe('f8d8'); // caller may surface this as a hint
    expect(s.fen()).toBe(fenBefore); // unchanged — retryable
    expect(s.isComplete()).toBe(false);
    // The correct move still works after a miss.
    const retry = s.tryMove('f8d8');
    expect(retry.correct).toBe(true);
    expect(retry.opponentReply).toBe('d6d8');
  });

  it('records the played line (setup + each half-move) for navigation', () => {
    const s = new PuzzleSession(
      mk({ fen: '5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27', moves: ['d3d6', 'f8d8', 'd6d8', 'f6d8'] }),
    );
    expect(s.playedLine().map((e) => e.uci)).toEqual(['d3d6']); // setup only
    s.tryMove('f8d8'); // solver move + auto-reply d6d8
    expect(s.playedLine().map((e) => e.uci)).toEqual(['d3d6', 'f8d8', 'd6d8']);
    s.tryMove('f6d8'); // final solver move
    expect(s.playedLine().map((e) => e.uci)).toEqual(['d3d6', 'f8d8', 'd6d8', 'f6d8']);
    // A wrong move does not extend the line.
    const s2 = new PuzzleSession(
      mk({ fen: '5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27', moves: ['d3d6', 'f8d8', 'd6d8', 'f6d8'] }),
    );
    s2.tryMove('g8h8');
    expect(s2.playedLine().length).toBe(1);
  });
});

describe('PuzzleSession — promotions and mate', () => {
  it('handles a promotion in the solution UCI and a terminal mate line', () => {
    // Lichess 12jD2 (mateIn2): ... the solver mates with c7d8=Q.
    const s = new PuzzleSession(
      mk({ fen: '2r3k1/p1PQ1ppp/1r2p3/8/3P4/q3P3/5PPP/2B2RK1 b - - 6 24', moves: ['a3a6', 'd7d8', 'c8d8', 'c7d8q'] }),
    );
    expect(s.solverColor).toBe('white');
    expect(s.tryMove('d7d8').opponentReply).toBe('c8d8');
    const last = s.tryMove('c7d8q');
    expect(last.correct).toBe(true);
    expect(last.status).toBe('solved');
  });

  it('requires the exact promotion piece (non-mate line)', () => {
    // Synthetic: setup a2a3, then White promotes e7e8=Q (winning, not check/mate).
    const puzzle = mk({ fen: '8/4P3/8/8/8/8/k7/4K3 b - - 0 1', moves: ['a2a3', 'e7e8q'] });
    expect(new PuzzleSession(puzzle).tryMove('e7e8q').status).toBe('solved');
    const wrong = new PuzzleSession(puzzle).tryMove('e7e8n'); // wrong promotion piece
    expect(wrong.correct).toBe(false);
    expect(wrong.expected).toBe('e7e8q');
  });

  it('accepts an alternate mating move when the solution is mate (acceptAnyMate)', () => {
    // Synthetic: after the setup Kh8, White has two mates — a1a8 and e1e8.
    const puzzle = mk({ fen: '6k1/5ppp/8/8/8/8/5PPP/R3R1K1 b - - 0 1', moves: ['g8h8', 'a1a8'] });
    const alt = new PuzzleSession(puzzle).tryMove('e1e8'); // different, but also mate
    expect(alt.correct).toBe(true);
    expect(alt.status).toBe('solved');
    // With the refinement off, only the exact solution UCI is accepted.
    const strict = new PuzzleSession(puzzle, { acceptAnyMate: false }).tryMove('e1e8');
    expect(strict.correct).toBe(false);
  });

  it('rejects an under-strength puzzle (needs setup + at least one reply)', () => {
    expect(() => new PuzzleSession(mk({ fen: '8/8/8/8/8/8/k7/4K3 w - - 0 1', moves: ['e1e2'] }))).toThrow();
  });
});
