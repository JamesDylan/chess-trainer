// Build the FULL opening book asset from the Lichess/ECO opening tables.
//
// The app ships a built-in seed (src/openings/data.ts) so opening naming works out of
// the box. Run this on the Mac to generate the complete ~3,500-line set into
// public/openings/openings.json, which the app prefers when present (fetched same-origin,
// like the puzzle asset). Node built-ins only — no new dependencies.
//
// Input: the Lichess "chess-openings" TSV files a.tsv … e.tsv
//   (https://github.com/lichess-org/chess-openings — CC0 / public domain).
//   Each row is: eco<TAB>name<TAB>pgn   (pgn e.g. "1. e4 e5 2. Nf3 Nc6")
//
// Usage:
//   node scripts/build-openings.mjs                 # auto-detect a sibling chess-openings/ dir
//   node scripts/build-openings.mjs --in <dir>      # dir containing a.tsv … e.tsv
//   node scripts/build-openings.mjs --out <file>    # default public/openings/openings.json
//   node scripts/build-openings.mjs --compact       # single-line JSON

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const compact = process.argv.includes('--compact');
const outPath = resolve(arg('--out', join(repoRoot, 'public', 'openings', 'openings.json')));

// Candidate locations for the Lichess chess-openings TSVs.
const candidates = [
  arg('--in', null),
  join(repoRoot, 'chess-openings'),
  join(repoRoot, '..', 'chess-openings'),
  join(homedir(), 'hobbes', 'chess-app', 'chess-openings'),
].filter(Boolean);

const TSV_FILES = ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv'];

function findInputDir() {
  for (const dir of candidates) {
    if (dir && existsSync(join(dir, 'a.tsv'))) return dir;
  }
  return null;
}

const inputDir = findInputDir();
if (!inputDir) {
  console.error(
    'Could not find the Lichess chess-openings TSVs (a.tsv … e.tsv).\n' +
      'Clone https://github.com/lichess-org/chess-openings next to this repo, or pass --in <dir>.\n' +
      'Searched:\n  ' +
      candidates.join('\n  '),
  );
  process.exit(1);
}

const openings = [];
const seen = new Set(); // de-dup by pgn line
for (const file of TSV_FILES) {
  const path = join(inputDir, file);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('eco\t')) continue; // skip header / blanks
    const [eco, name, pgn] = line.split('\t');
    if (!name || !pgn) continue;
    if (seen.has(pgn)) continue;
    seen.add(pgn);
    openings.push({ eco: eco || undefined, name, pgn: pgn.trim() });
  }
}

if (openings.length === 0) {
  console.error(`No rows parsed from ${inputDir}. Are the TSVs the Lichess chess-openings format?`);
  process.exit(1);
}

const payload = { version: 1, openings };
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 0).replace(/},{/g, '},\n{'),
);

console.log(`Wrote ${openings.length} openings → ${outPath}`);
console.log('The app will prefer this asset over the built-in seed on the next Progress open.');
