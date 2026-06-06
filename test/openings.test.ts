import { describe, it, expect } from 'vitest';
import {
  OpeningBook,
  SEED_OPENINGS,
  epdOf,
  loadOpeningsFromJson,
  normalizeOpeningMoves,
} from '../src/openings';

const sans = (line: string): string[] => line.split(' ');

describe('OpeningBook — seed integrity', () => {
  it('every seed line is legal SAN and reaches a distinct position', () => {
    const book = new OpeningBook(SEED_OPENINGS);
    // No illegal move and no two lines colliding on the same position key.
    expect(book.skipped).toEqual([]);
    expect(book.size).toBe(SEED_OPENINGS.length);
  });
});

describe('epdOf', () => {
  it('drops the halfmove/fullmove counters', () => {
    expect(epdOf('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3',
    );
  });
});

describe('OpeningBook — detection (deepest match)', () => {
  const book = new OpeningBook(SEED_OPENINGS);

  it('names the Scotch Game', () => {
    expect(book.detectFromSans(sans('e4 e5 Nf3 Nc6 d4'))?.name).toBe('Scotch Game');
  });

  it('names the Scandinavian Defense (family + mainline)', () => {
    expect(book.detectFromSans(sans('e4 d5'))?.name).toBe('Scandinavian Defense');
    expect(book.detectFromSans(sans('e4 d5 exd5 Qxd5'))?.name).toBe(
      'Scandinavian Defense: Main Line',
    );
  });

  it('names the French Winawer at the deepest matching ply', () => {
    const d = book.detectFromSans(sans('e4 e6 d4 d5 Nc3 Bb4'));
    expect(d?.name).toBe('French Defense: Winawer Variation');
    expect(d?.ply).toBe(6);
  });

  it('matches a deep mainline exactly (Najdorf)', () => {
    expect(book.detectFromSans(sans('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'))?.name).toBe(
      'Sicilian Defense: Najdorf Variation',
    );
  });

  it('falls back to the family when a line leaves the book early', () => {
    expect(book.detectFromSans(sans('e4 c5 Bc4'))?.name).toBe('Sicilian Defense');
  });

  it('detects through transposition (keyed by position, not move order)', () => {
    const direct = book.detectFromSans(sans('e4 e5 Nf3 Nc6 Nc3 Nf6'));
    const transposed = book.detectFromSans(sans('e4 e5 Nc3 Nf6 Nf3 Nc6'));
    expect(direct?.name).toBe('Four Knights Game');
    expect(transposed?.name).toBe('Four Knights Game');
  });

  it('returns undefined for an unknown or empty opening', () => {
    expect(book.detectFromSans(sans('a3 a6'))).toBeUndefined();
    expect(book.detectFromSans([])).toBeUndefined();
  });

  it('detects from a PGN movetext string', () => {
    expect(book.detectFromPgn('1. e4 e6 2. d4 d5 3. Nc3 Bb4')?.name).toBe(
      'French Defense: Winawer Variation',
    );
    expect(book.detectFromPgn('not a pgn at all')).toBeUndefined();
  });
});

describe('loader', () => {
  it('normalizeOpeningMoves strips move numbers', () => {
    expect(normalizeOpeningMoves('1. e4 e5 2. Nf3 Nc6')).toBe('e4 e5 Nf3 Nc6');
    expect(normalizeOpeningMoves('1. e4 c5 2... d6')).toBe('e4 c5 d6');
  });

  it('loadOpeningsFromJson accepts a wrapper or bare array, with pgn or moves', () => {
    const wrapped = loadOpeningsFromJson(
      JSON.stringify({ version: 1, openings: [{ eco: 'C45', name: 'Scotch Game', pgn: '1. e4 e5 2. Nf3 Nc6 3. d4' }] }),
    );
    expect(wrapped[0].moves).toBe('e4 e5 Nf3 Nc6 d4');

    const bare = loadOpeningsFromJson(JSON.stringify([{ name: 'Open Game', moves: 'e4 e5' }]));
    expect(bare[0].name).toBe('Open Game');

    // A book built from the loaded defs detects normally.
    const book = new OpeningBook(wrapped);
    expect(book.detectFromSans(sans('e4 e5 Nf3 Nc6 d4'))?.name).toBe('Scotch Game');
  });
});
