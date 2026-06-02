// A position-aware scripted UCI responder for analyzer tests — NO WASM, NO async
// engine. It remembers the FEN from the last `position fen ...` command and, on the
// next `go`, emits a single scored `info` line for THAT position followed by a
// `bestmove`. This lets a test pin an exact engine evaluation per position and
// drive the REAL UciEngine through its REAL parse path, so the analyzer's
// win%/accuracy/classification pipeline is asserted end to end and instantly.

import type { Responder } from './fakeTransport';
import type { Score } from '../../src/core/types';

const POSITION_FEN = 'position fen ';

/** Format a Score as the UCI `score ...` payload (`cp <n>` or `mate <n>`). */
function scoreField(score: Score): string {
  return score.mate !== undefined ? `mate ${score.mate}` : `cp ${score.cp ?? 0}`;
}

/**
 * Build a responder that returns `scoreForFen(fen)` for each searched position.
 * `fen` is the exact string the analyzer sent after `position fen `.
 */
export function scriptedAnalysisResponder(scoreForFen: (fen: string) => Score): Responder {
  let pendingFen = '';
  return (command, emit) => {
    if (command === 'uci') {
      emit('id name AnalysisFake 1.0');
      emit('id author tests');
      emit('uciok');
    } else if (command === 'isready') {
      emit('readyok');
    } else if (command.startsWith(POSITION_FEN)) {
      pendingFen = command.slice(POSITION_FEN.length).split(' moves ')[0].trim();
    } else if (command === 'position startpos' || command.startsWith('position startpos ')) {
      pendingFen = 'startpos';
    } else if (command.startsWith('go')) {
      const field = scoreField(scoreForFen(pendingFen));
      emit(`info depth 16 seldepth 22 multipv 1 score ${field} nodes 100000 nps 1000000 time 50 pv e2e4 e7e5`);
      emit('bestmove e2e4 ponder e7e5');
    }
    // setoption / ucinewgame are accepted silently.
  };
}
