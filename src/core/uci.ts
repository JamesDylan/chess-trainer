// UCI protocol helpers: parse engine output, build engine commands.
// See docs/REFERENCE.md "UCI cheat-sheet" for the exact line formats.

import type { InfoLine, BestMove } from './types';

/**
 * Parse a UCI `info ...` line into an InfoLine.
 * Returns null for non-`info` lines and for `info string ...` lines (and any
 * `info` line carrying neither a score nor a pv).
 */
export function parseInfoLine(line: string): InfoLine | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'info') return null;
  const info: InfoLine = { pv: [] };
  let has = false;
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        info.depth = parseInt(t[++i], 10);
        break;
      case 'seldepth':
        info.seldepth = parseInt(t[++i], 10);
        break;
      case 'multipv':
        info.multipv = parseInt(t[++i], 10);
        break;
      case 'nodes':
        info.nodes = parseInt(t[++i], 10);
        break;
      case 'nps':
        info.nps = parseInt(t[++i], 10);
        break;
      case 'time':
        info.timeMs = parseInt(t[++i], 10);
        break;
      case 'score': {
        const kind = t[++i];
        const value = parseInt(t[++i], 10);
        info.score = kind === 'mate' ? { mate: value } : { cp: value };
        has = true;
        break;
      }
      case 'pv': {
        info.pv = t.slice(i + 1);
        i = t.length; // pv is the rest of the line
        has = true;
        break;
      }
      case 'string':
        return null; // human-readable line, not data
      default:
        break;
    }
  }
  return has ? info : null;
}

/** Parse a UCI `bestmove <m> [ponder <m>]` line. Returns null if not a bestmove line. */
export function parseBestMove(line: string): BestMove | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'bestmove') return null;
  const res: BestMove = { best: t[1] };
  const p = t.indexOf('ponder');
  if (p !== -1 && t[p + 1]) res.ponder = t[p + 1];
  return res;
}

/**
 * Build a UCI `position` command.
 *   {}                              -> "position startpos"
 *   { moves: ['e2e4','e7e5'] }      -> "position startpos moves e2e4 e7e5"
 *   { fen: '<FEN>' }                -> "position fen <FEN>"
 *   { fen: '<FEN>', moves: [...] }  -> "position fen <FEN> moves ..."
 */
export function buildPositionCommand(opts: { fen?: string; moves?: string[] }): string {
  const base = opts.fen ? `position fen ${opts.fen}` : 'position startpos';
  return opts.moves && opts.moves.length > 0 ? `${base} moves ${opts.moves.join(' ')}` : base;
}

/**
 * Build a UCI `go` command.
 *   { movetimeMs: 1000 } -> "go movetime 1000"
 *   { depth: 12 }        -> "go depth 12"
 *   { nodes: 100000 }    -> "go nodes 100000"
 *   {}                   -> "go"
 */
export function buildGoCommand(opts: { depth?: number; movetimeMs?: number; nodes?: number }): string {
  const p: string[] = ['go'];
  if (opts.depth !== undefined) p.push('depth', String(opts.depth));
  if (opts.movetimeMs !== undefined) p.push('movetime', String(opts.movetimeMs));
  if (opts.nodes !== undefined) p.push('nodes', String(opts.nodes));
  return p.join(' ');
}
