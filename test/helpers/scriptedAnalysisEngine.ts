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
 * `fen` is the exact string the analyzer sent after `position fen `. Optionally
 * `bestForFen(fen)` supplies the engine's best move (UCI) for that position; it
 * defaults to `e2e4`, and is echoed in the `bestmove` line.
 *
 * Optionally `pvForFen(fen)` supplies the FULL principal variation (UCI moves) for
 * that position — used by the Stage 5 live coach to read a refutation off the PV.
 * When omitted, the PV is just `[best]` (a single-move line, as before), so existing
 * callers are unaffected.
 */
export function scriptedAnalysisResponder(
  scoreForFen: (fen: string) => Score,
  bestForFen: (fen: string) => string = () => 'e2e4',
  pvForFen?: (fen: string) => string[],
): Responder {
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
      const best = bestForFen(pendingFen);
      const pv = pvForFen?.(pendingFen) ?? [best];
      emit(
        `info depth 16 seldepth 22 multipv 1 score ${field} nodes 100000 nps 1000000 time 50 pv ${pv.join(' ')}`,
      );
      emit(`bestmove ${best}`);
    }
    // setoption / ucinewgame are accepted silently.
  };
}
