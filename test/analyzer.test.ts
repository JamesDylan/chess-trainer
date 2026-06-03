// Deterministic analyzer tests — NO real engine, NO WASM. A position-aware scripted
// FakeTransport stands in for Stockfish so the analyzer's win%/accuracy/
// classification pipeline is asserted exactly and instantly. The scripted scores
// are chosen to hit REFERENCE §1 verified win% values (cp 0 -> 50.00, cp 200 ->
// 67.62, mate 1 -> 99.94) and to contain a deliberate blunder and a forced mate.

import { describe, it, expect } from 'vitest';
import { ChessGame } from '../src/core/chessGame';
import { UciEngine } from '../src/engine/uciEngine';
import { scoreToWinPercent, winPercentToAccuracy, classifyMove } from '../src/core/evalMath';
import type { Score } from '../src/core/types';
import { analyzeGame, inferLastMove, ANALYSIS_REPORT_VERSION } from '../src/analysis/analyzer';
import { FakeTransport } from './helpers/fakeTransport';
import { scriptedAnalysisResponder } from './helpers/scriptedAnalysisEngine';

/** Play SANs and return the canonical SAN list, the PGN, and every position FEN
 *  (start + after each ply). */
function buildGame(moves: string[]): { sans: string[]; pgn: string; fens: string[] } {
  const g = new ChessGame();
  for (const m of moves) {
    if (!g.move(m)) throw new Error(`illegal test move ${m}`);
  }
  const sans = g.history();
  const pgn = g.pgn();

  const r = new ChessGame();
  const fens = [r.fen()];
  for (const san of sans) {
    r.move(san);
    fens.push(r.fen());
  }
  return { sans, pgn, fens };
}

/** A real UciEngine over a scripted transport that returns `scores[fen]`. */
async function makeEngine(scores: Map<string, Score>): Promise<{ engine: UciEngine; transport: FakeTransport }> {
  const transport = new FakeTransport(scriptedAnalysisResponder((fen) => scores.get(fen) ?? { cp: 0 }));
  const engine = new UciEngine(transport, { searchTimeoutMs: 2000, handshakeTimeoutMs: 2000 });
  await engine.init();
  return { engine, transport };
}

const goCount = (sent: string[]): number => sent.filter((c) => c.startsWith('go')).length;

describe('analyzeGame — clean play with one blunder', () => {
  // Ruy Lopez stub. Scores (side-to-move POV) keep every position even EXCEPT the
  // position after Black's 4th ply, where White is +200 — so Black's Nc6 is the
  // blunder and White plays only best moves.
  const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'];
  const { pgn, fens } = buildGame(moves); // fens: P0..P6

  const scores = new Map<string, Score>([
    [fens[0], { cp: 0 }], // P0 White to move, even
    [fens[1], { cp: 0 }], // P1 Black to move, even
    [fens[2], { cp: 0 }], // P2 White to move, even
    [fens[3], { cp: 0 }], // P3 Black to move, even  (before the blunder)
    [fens[4], { cp: 200 }], // P4 White to move, White +200 (after Black's blunder)
    [fens[5], { cp: -200 }], // P5 Black to move, Black -200 (White still +200)
    [fens[6], { cp: 0 }], // P6 White to move, even again (Black recovered)
  ]);

  it('classifies the blunder as "blunder" and keeps the clean side at 100%', async () => {
    const { engine, transport } = await makeEngine(scores);
    const report = await analyzeGame(pgn, engine, { depth: 16 });

    expect(report.moves).toHaveLength(6);
    expect(report.result).toBe('*'); // game not finished

    // Searched every non-terminal position once: P0..P5 (fenBefore of each ply)
    // plus the final non-terminal P6 = 7 searches, all by DEPTH.
    expect(goCount(transport.sent)).toBe(7);
    expect(transport.sent.filter((c) => c.startsWith('go')).every((c) => c === 'go depth 16')).toBe(true);

    const blunder = report.moves[3]; // Black's Nc6 (ply 4)
    expect(blunder.mover).toBe('black');
    expect(blunder.san).toBe('Nc6');
    expect(blunder.classification).toBe('blunder');

    // White (plies 1,3,5) played only best moves -> 100% by harmonic mean.
    expect(report.white.accuracy).toBeCloseTo(100, 6);
    expect(report.white.counts.best).toBe(3);
    expect(report.white.counts.blunder).toBe(0);

    // Black has exactly one blunder and two best moves; accuracy is dragged down
    // but not to zero (a single ~18-pt win% drop, not a total collapse).
    expect(report.black.counts.blunder).toBe(1);
    expect(report.black.counts.best).toBe(2);
    expect(report.black.accuracy).toBeLessThan(report.white.accuracy);
    expect(report.black.accuracy).toBeGreaterThan(60);
    expect(report.black.accuracy).toBeLessThan(80);
  });

  it('per-move numbers match REFERENCE §1 and reuse evalMath verbatim', async () => {
    const { engine } = await makeEngine(scores);
    const report = await analyzeGame(pgn, engine, { depth: 16 });

    const blunder = report.moves[3];
    // winBefore from cp 0 = 50.00; winAfter = 100 - winPercent(cp 200) = 100 - 67.62.
    expect(blunder.winBefore).toBeCloseTo(50.0, 2);
    expect(blunder.winAfter).toBeCloseTo(100 - 67.62, 1);
    expect(blunder.scoreBefore).toEqual({ cp: 0 });
    expect(blunder.scoreAfter).toEqual({ cp: 200 });

    // The analyzer must derive accuracy/classification by calling evalMath, not by
    // re-implementing it: cross-check against the library functions directly.
    expect(blunder.accuracy).toBeCloseTo(
      winPercentToAccuracy(blunder.winBefore, blunder.winAfter),
      6,
    );
    expect(blunder.classification).toBe(classifyMove(blunder.winBefore, blunder.winAfter));

    // A clean White move keeps win% (drop <= 0) -> accuracy 100, class 'best'.
    const cleanWhite = report.moves[4]; // Bb5 (ply 5), White holds +200
    expect(cleanWhite.mover).toBe('white');
    expect(cleanWhite.accuracy).toBe(100);
    expect(cleanWhite.classification).toBe('best');

    // A position scored +200 reads as REFERENCE's verified 67.62 win%.
    expect(scoreToWinPercent({ cp: 200 })).toBeCloseTo(67.62, 1);
  });
});

describe('analyzeGame — mate scores and terminal positions', () => {
  // Fool's mate: 1. f3 e5 2. g4 Qh4#. Before Black's last move, Black has mate in 1,
  // so that position is scored `mate 1` (side-to-move = Black). The final position is
  // checkmate (terminal) and must NOT be sent to the engine.
  const moves = ['f3', 'e5', 'g4', 'Qh4'];
  const { pgn, fens } = buildGame(moves); // fens: P0..P4 (P4 = checkmate)

  const scores = new Map<string, Score>([
    [fens[0], { cp: 0 }],
    [fens[1], { cp: 0 }],
    [fens[2], { cp: 0 }],
    [fens[3], { mate: 1 }], // Black to move, mate in 1 (Qh4#)
    // fens[4] (checkmate) deliberately absent: it must never be searched.
  ]);

  it('handles a forced mate score and a checkmate terminal position', async () => {
    const { engine, transport } = await makeEngine(scores);
    const report = await analyzeGame(pgn, engine, { depth: 16 });

    expect(report.moves).toHaveLength(4);
    expect(report.result).toBe('0-1'); // White is checkmated

    // Only the 4 non-terminal positions (P0..P3) were searched; the checkmate
    // position (P4) was synthesized, not queried.
    expect(goCount(transport.sent)).toBe(4);
    expect(transport.sent.some((c) => c.startsWith('position') && c.includes(fens[4].split(' ')[0]))).toBe(false);

    // White's g4 walks into mate-in-1: winAfter = 100 - winPercent(mate 1) ~= 0.06.
    const g4 = report.moves[2];
    expect(g4.mover).toBe('white');
    expect(g4.winBefore).toBeCloseTo(50.0, 2);
    expect(g4.winAfter).toBeCloseTo(100 - 99.94, 1); // REFERENCE: mate 1 -> 99.94
    expect(g4.classification).toBe('blunder');

    // Black's Qh4# delivers mate: terminal handled directly (no engine eval).
    const mate = report.moves[3];
    expect(mate.mover).toBe('black');
    expect(mate.terminal).toBe('checkmate');
    expect(mate.winBefore).toBeCloseTo(99.94, 1); // mate 1 from Black's POV
    expect(mate.winAfter).toBe(100);
    expect(mate.accuracy).toBe(100);
    expect(mate.classification).toBe('best');
  });
});

describe('analyzeGame — best move capture', () => {
  // Script the engine's best move per position so we can assert both the
  // "played the best move" and "played a non-best move" cases.
  const moves = ['e4', 'e5', 'Nf3', 'Nc6'];
  const { pgn, fens } = buildGame(moves); // fens: P0..P4

  const bestByFen = new Map<string, string>([
    [fens[0], 'e2e4'], // start: best is e4 — and White played e4 (best)
    [fens[1], 'b8c6'], // after e4: best is Nc6, but Black played e5 (not best)
  ]);

  it('records the engine best move (UCI + SAN) and whether the played move was best', async () => {
    const transport = new FakeTransport(
      scriptedAnalysisResponder(
        () => ({ cp: 0 }),
        (fen) => bestByFen.get(fen) ?? 'e2e4',
      ),
    );
    const engine = new UciEngine(transport, { searchTimeoutMs: 2000, handshakeTimeoutMs: 2000 });
    await engine.init();
    const report = await analyzeGame(pgn, engine, { depth: 16 });

    expect(report.version).toBe(ANALYSIS_REPORT_VERSION);

    // White's e4 was the engine's best move.
    expect(report.moves[0].san).toBe('e4');
    expect(report.moves[0].bestMoveSan).toBe('e4');
    expect(report.moves[0].isBest).toBe(true);

    // Black's e5 was NOT the engine's best (Nc6 was) — surfaced as UCI + SAN.
    expect(report.moves[1].san).toBe('e5');
    expect(report.moves[1].bestMoveUci).toBe('b8c6');
    expect(report.moves[1].bestMoveSan).toBe('Nc6');
    expect(report.moves[1].isBest).toBe(false);
  });
});

describe('inferLastMove — board-review highlight', () => {
  it('finds from/to for a simple pawn move', () => {
    const { fens } = buildGame(['e4']);
    expect(inferLastMove(fens[0], fens[1])).toEqual(['e2', 'e4']);
  });

  it('finds from/to for a knight development', () => {
    const { fens } = buildGame(['e4', 'e5', 'Nf3']);
    // fens[2] = after e5 (before Nf3), fens[3] = after Nf3.
    expect(inferLastMove(fens[2], fens[3])).toEqual(['g1', 'f3']);
  });

  it('reports the king squares for castling', () => {
    const before = 'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    const after = 'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4';
    expect(inferLastMove(before, after)).toEqual(['e1', 'g1']);
  });
});
