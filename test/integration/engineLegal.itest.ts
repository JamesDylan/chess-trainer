// REAL-ENGINE integration gate (Stage 1 acceptance: "engine makes zero illegal
// moves"). Loads an actual Stockfish (asm.js build) in Node via createNodeEngine,
// then plays games at several strengths with a random-but-legal opponent and
// asserts EVERY engine reply is a legal move in the exact current position.
//
// This is intentionally NOT part of `npm test` (it loads a ~10MB engine and
// runs real searches). Run it with:  npm run engine:check
//
// The full "play a whole game in the browser, strengths feel different, works
// offline after build" check is the human acceptance step in the UI session.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createNodeEngine } from '../../src/engine/nodeEngine';
import type { UciEngine } from '../../src/engine/uciEngine';
import { eloToEngineOptions } from '../../src/core/strength';
import { ChessGame } from '../../src/core/chessGame';

const STRENGTHS = [800, 1200, 1600];
const MAX_PLIES = 24; // bound runtime; legality doesn't need a full game
const MOVETIME_CAP_MS = 120; // keep the slower asm.js engine snappy here

function randomLegal(game: ChessGame): string {
  const moves = game.legalMoves();
  return moves[Math.floor(Math.random() * moves.length)];
}

describe('real engine — zero illegal moves across strengths', () => {
  let engine: UciEngine;

  beforeAll(async () => {
    engine = await createNodeEngine('asm', { searchTimeoutMs: 20_000 });
  }, 30_000);

  afterAll(async () => {
    if (engine) await engine.dispose();
  });

  it('completes the UCI handshake', () => {
    expect(engine).toBeTruthy();
  });

  for (const elo of STRENGTHS) {
    it(`plays only legal moves at ~${elo} Elo`, async () => {
      const opts = eloToEngineOptions(elo);
      await engine.newGame();
      await engine.setStrength(opts);

      const game = new ChessGame(); // random opponent = White, engine = Black
      const movetimeMs = Math.min(opts.movetimeMs, MOVETIME_CAP_MS);
      let engineMoves = 0;

      for (let ply = 0; ply < MAX_PLIES && !game.isGameOver(); ply++) {
        if (game.turn() === 'white') {
          expect(game.move(randomLegal(game))).toBe(true);
        } else {
          const bm = await engine.bestMove({ fen: game.fen() }, { movetimeMs });
          // THE GATE: applying the engine's move must succeed (i.e. it is legal).
          const legal = game.move(bm.best);
          expect(legal, `illegal engine move "${bm.best}" at FEN ${game.fen()}`).toBe(true);
          engineMoves++;
        }
      }

      // Sanity: the engine actually moved (didn't no-op its way through).
      expect(engineMoves).toBeGreaterThanOrEqual(3);
    }, 40_000);
  }

  it('reports per-strength search signal (evidence strengths differ)', async () => {
    const fen = new ChessGame().fen(); // start position, fixed
    const rows: Array<{ elo: number; depth?: number; nodes?: number; best: string }> = [];
    for (const elo of STRENGTHS) {
      await engine.newGame();
      await engine.setStrength(eloToEngineOptions(elo));
      const bm = await engine.bestMove({ fen }, { movetimeMs: 300 });
      rows.push({ elo, depth: engine.lastInfo?.depth, nodes: engine.lastInfo?.nodes, best: bm.best });
      // We got a real search back at each strength.
      expect(engine.lastInfo).toBeTruthy();
    }
    // Logged for the human to eyeball; engine "Elo" is CCRL-anchored so we don't
    // hard-assert ordering, but stronger settings generally search deeper/more.
    // eslint-disable-next-line no-console
    console.table(rows);
  }, 30_000);
});
