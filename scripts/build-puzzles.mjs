// build-puzzles.mjs — offline preprocessing of the Lichess puzzle DB into a small,
// curated static asset the app fetches same-origin (public/puzzles/puzzles.json).
//
// The source (docs/REFERENCE.md §6) is ~4M rows of
//   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
// shipped as `lichess_db_puzzle.csv.zst` — far too big for the browser. This script
// streams it (decompressing via the `zstd` CLI), keeps only well-liked puzzles, and
// reservoir-samples a fixed number per rating band so the result is small, spans the
// difficulty range, and is theme-diverse. Output is COMPACT (moves/themes kept as
// space-joined strings, `rd` shortened) and matches src/puzzles/loader.ts.
//
// Run on the Mac (the repo's FUSE mount + the multi-hundred-MB CSV make the sandbox a
// poor fit for the full run):
//   node scripts/build-puzzles.mjs                 # auto-detect CSV, write the default asset
//   node scripts/build-puzzles.mjs --in <csv.zst> --out public/puzzles/puzzles.json
//   node scripts/build-puzzles.mjs --target 3000 --min-popularity 90 --seed 1
//
// It shells out to `zstd` (a CLI, not an app dependency). Install with `brew install zstd`.

import { createReadStream, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- arg parsing ----------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const TARGET = Number(args.target ?? 2500); // total puzzles in the output
const MIN_POPULARITY = Number(args['min-popularity'] ?? 85); // Lichess popularity score, -100..100
const MIN_PLAYS = Number(args['min-plays'] ?? 50); // ignore barely-played puzzles
const SEED = Number(args.seed ?? 1); // deterministic sampling
// Rating band edges (inclusive lower, exclusive upper). 8 bands across ~600–2200.
const BANDS = (args.bands ? String(args.bands).split(',').map(Number) : [600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200]);
const NUM_BANDS = BANDS.length - 1;
const PER_BAND = Math.ceil(TARGET / NUM_BANDS);

// ---- locate the input CSV -------------------------------------------------
const CANDIDATE_INPUTS = [
  args.in,
  resolve(REPO_ROOT, 'lichess_db_puzzle.csv.zst'),
  resolve(REPO_ROOT, 'puzzles/lichess_db_puzzle.csv.zst'),
  // The sibling "offline-chess-puzzles" app bundles the DB (where this repo found it):
  resolve(REPO_ROOT, '..', 'offline-chess-puzzles-2.5.1/puzzles/lichess_db_puzzle.csv.zst'),
  resolve(REPO_ROOT, '..', 'offline-chess-puzzles/puzzles/lichess_db_puzzle.csv.zst'),
  resolve(REPO_ROOT, 'lichess_db_puzzle.csv'),
].filter(Boolean);

const INPUT = CANDIDATE_INPUTS.find((p) => existsSync(p));
const OUTPUT = resolve(REPO_ROOT, args.out ?? 'public/puzzles/puzzles.json');

if (!INPUT) {
  console.error('ERROR: could not find the Lichess puzzle CSV. Looked in:');
  for (const p of CANDIDATE_INPUTS) console.error('  ' + p);
  console.error('\nDownload it from https://database.lichess.org/#puzzles and pass --in <path-to>.csv.zst');
  process.exit(1);
}

// ---- seeded RNG (mulberry32) for reproducible sampling --------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

function bandIndex(rating) {
  if (rating < BANDS[0] || rating >= BANDS[NUM_BANDS]) return -1;
  // BANDS is small; a linear scan is fine and clear.
  for (let b = 0; b < NUM_BANDS; b += 1) {
    if (rating >= BANDS[b] && rating < BANDS[b + 1]) return b;
  }
  return -1;
}

// ---- streaming source (decompress with zstd if needed) --------------------
function openLineStream(input) {
  if (input.endsWith('.zst')) {
    const zstd = spawn('zstd', ['-d', '-c', input], { stdio: ['ignore', 'pipe', 'inherit'] });
    zstd.on('error', (err) => {
      console.error(`ERROR: failed to run \`zstd\` (${err.message}). Install it (e.g. \`brew install zstd\`) or pass a decompressed --in *.csv.`);
      process.exit(1);
    });
    return { stream: zstd.stdout, child: zstd };
  }
  return { stream: createReadStream(input), child: null };
}

// ---- main -----------------------------------------------------------------
console.error(`Reading ${INPUT}`);
console.error(`Filter: popularity >= ${MIN_POPULARITY}, plays >= ${MIN_PLAYS}, rating in [${BANDS[0]}, ${BANDS[NUM_BANDS]})`);
console.error(`Sampling ${PER_BAND}/band x ${NUM_BANDS} bands (target ~${TARGET}), seed ${SEED}\n`);

const reservoirs = Array.from({ length: NUM_BANDS }, () => []);
const seen = Array.from({ length: NUM_BANDS }, () => 0); // count considered per band (for reservoir math)
let scanned = 0;
let kept = 0;

const { stream } = openLineStream(INPUT);
const rl = createInterface({ input: stream, crlfDelay: Infinity });

let isHeader = true;
for await (const line of rl) {
  if (!line) continue;
  if (isHeader) {
    isHeader = false;
    if (line.startsWith('PuzzleId')) continue; // skip header row
  }
  scanned += 1;
  // FEN/Moves/GameUrl/OpeningTags contain no commas in this dataset, so a plain
  // split yields exactly 10 fields (the last may be empty).
  const f = line.split(',');
  if (f.length < 9) continue;
  const [id, fen, moves, ratingStr, rdStr, popStr, playsStr, themes] = f;

  const rating = Number(ratingStr);
  const popularity = Number(popStr);
  const nbPlays = Number(playsStr);
  if (!Number.isFinite(rating) || popularity < MIN_POPULARITY || nbPlays < MIN_PLAYS) continue;
  if (!moves || moves.indexOf(' ') === -1) continue; // need a setup move + at least one reply

  const b = bandIndex(rating);
  if (b === -1) continue;

  // Reservoir sampling: keep PER_BAND uniformly-random rows per band in one pass.
  seen[b] += 1;
  const res = reservoirs[b];
  const row = {
    id,
    fen,
    moves,
    rating,
    rd: Number(rdStr) || 0,
    themes: themes || '',
    popularity,
    nbPlays,
  };
  if (res.length < PER_BAND) {
    res.push(row);
    kept += 1;
  } else {
    const j = Math.floor(rng() * seen[b]);
    if (j < PER_BAND) res[j] = row;
  }
}

// Flatten, sort by rating for a tidy, diff-friendly file.
const puzzles = reservoirs.flat().sort((a, b) => a.rating - b.rating || a.id.localeCompare(b.id));

const header = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: 'lichess_db_puzzle',
  count: puzzles.length,
  bands: BANDS,
  filter: { minPopularity: MIN_POPULARITY, minPlays: MIN_PLAYS, seed: SEED },
};

// Default output is valid JSON with ONE puzzle per line, so the asset is
// diff-friendly in git and easy to inspect. `--compact` minifies onto a single line.
function serialize() {
  if (args.compact || !puzzles.length) return JSON.stringify({ ...header, puzzles });
  const head = JSON.stringify(header).replace(/}$/, ',"puzzles":[');
  const rows = puzzles.map((p) => JSON.stringify(p)).join(',\n');
  return `${head}\n${rows}\n]}`;
}

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, serialize());

// Report.
const sizeKb = (statSync(OUTPUT).size / 1024).toFixed(1);
console.error('Per-band kept:');
for (let b = 0; b < NUM_BANDS; b += 1) {
  console.error(`  ${BANDS[b]}–${BANDS[b + 1] - 1}: ${reservoirs[b].length}  (from ${seen[b]} eligible)`);
}
console.error(`\nScanned ${scanned.toLocaleString()} rows, kept ${puzzles.length}.`);
console.error(`Wrote ${OUTPUT} (${sizeKb} KB).`);
