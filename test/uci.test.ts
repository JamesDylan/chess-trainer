import { describe, it, expect } from 'vitest';
import { parseInfoLine, parseBestMove, buildPositionCommand, buildGoCommand } from '../src/index';

describe('parseInfoLine', () => {
  it('parses a full info line with cp score and pv', () => {
    const info = parseInfoLine(
      'info depth 12 seldepth 16 multipv 1 score cp 41 nodes 56507 nps 326630 time 173 pv g1f3 b8c6 f1b5',
    );
    expect(info).not.toBeNull();
    expect(info!.depth).toBe(12);
    expect(info!.seldepth).toBe(16);
    expect(info!.multipv).toBe(1);
    expect(info!.score).toEqual({ cp: 41 });
    expect(info!.nodes).toBe(56507);
    expect(info!.nps).toBe(326630);
    expect(info!.timeMs).toBe(173);
    expect(info!.pv).toEqual(['g1f3', 'b8c6', 'f1b5']);
  });
  it('parses a mate score', () => {
    const info = parseInfoLine('info depth 20 score mate 3 pv d1h5 g6h5 e2e8');
    expect(info!.score).toEqual({ mate: 3 });
    expect(info!.pv).toEqual(['d1h5', 'g6h5', 'e2e8']);
  });
  it('parses a negative mate score', () => {
    expect(parseInfoLine('info depth 9 score mate -2 pv a1a2')!.score).toEqual({ mate: -2 });
  });
  it('returns null for info string lines and non-info lines', () => {
    expect(parseInfoLine('info string NNUE evaluation using nn-b1a57edbea57.nnue')).toBeNull();
    expect(parseInfoLine('readyok')).toBeNull();
  });
});

describe('parseBestMove', () => {
  it('parses bestmove with ponder', () => {
    expect(parseBestMove('bestmove g1f3 ponder b8c6')).toEqual({ best: 'g1f3', ponder: 'b8c6' });
  });
  it('parses bestmove without ponder', () => {
    expect(parseBestMove('bestmove e2e4')).toEqual({ best: 'e2e4' });
  });
  it('returns null for non-bestmove lines', () => {
    expect(parseBestMove('info depth 1 score cp 10 pv e2e4')).toBeNull();
  });
});

describe('buildPositionCommand', () => {
  it('startpos', () => {
    expect(buildPositionCommand({})).toBe('position startpos');
  });
  it('startpos + moves', () => {
    expect(buildPositionCommand({ moves: ['e2e4', 'e7e5'] })).toBe('position startpos moves e2e4 e7e5');
  });
  it('fen', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(buildPositionCommand({ fen })).toBe(`position fen ${fen}`);
  });
  it('fen + moves', () => {
    expect(buildPositionCommand({ fen: 'X', moves: ['e2e4'] })).toBe('position fen X moves e2e4');
  });
});

describe('buildGoCommand', () => {
  it('movetime', () => {
    expect(buildGoCommand({ movetimeMs: 1000 })).toBe('go movetime 1000');
  });
  it('depth', () => {
    expect(buildGoCommand({ depth: 12 })).toBe('go depth 12');
  });
  it('nodes', () => {
    expect(buildGoCommand({ nodes: 100000 })).toBe('go nodes 100000');
  });
  it('no args', () => {
    expect(buildGoCommand({})).toBe('go');
  });
});
