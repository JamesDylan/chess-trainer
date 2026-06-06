// Expands the optional full opening asset (public/openings/openings.json, built by
// scripts/build-openings.mjs from the Lichess/ECO data) into OpeningDef[]. Accepts both
// a bare array and a { version, openings: [...] } wrapper, and tolerates rows that store
// the line as Lichess-style `pgn` ("1. e4 e5 2. Nf3") or as bare `moves` ("e4 e5 Nf3").

import type { OpeningDef } from './types';

interface RawOpeningRow {
  eco?: string;
  name?: string;
  moves?: string;
  pgn?: string;
}

/** Strip move numbers ("1.", "12...") so a SAN list remains. */
export function normalizeOpeningMoves(line: string): string {
  return line
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function loadOpeningsFromJson(text: string): OpeningDef[] {
  const data: unknown = JSON.parse(text);
  const rows: RawOpeningRow[] = Array.isArray(data)
    ? (data as RawOpeningRow[])
    : ((data as { openings?: RawOpeningRow[] }).openings ?? []);
  const out: OpeningDef[] = [];
  for (const r of rows) {
    const moves = normalizeOpeningMoves(r.moves ?? r.pgn ?? '');
    if (!r.name || !moves) continue;
    out.push({ eco: r.eco, name: r.name, moves });
  }
  return out;
}
