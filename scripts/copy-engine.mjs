// Copy the prebuilt Stockfish WASM engine(s) from node_modules into public/sf so
// Vite serves them as static assets. Two hard requirements come from how the
// nmrugg/stockfish.js worker locates its binary:
//   1. The .wasm must sit NEXT TO its .js with the same basename — the worker
//      derives the wasm URL from its own filename (foo.js -> foo.wasm).
//   2. The files must be served verbatim (not bundled/transformed), hence public/.
//
// Run automatically by the predev/prebuild npm hooks; also `npm run copy-engine`.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const srcDir = join(root, 'node_modules', 'stockfish', 'bin');
const outDir = join(root, 'public', 'sf');

// "lite-single" = single-threaded WASM build: no SharedArrayBuffer => no COOP/COEP
// needed. "lite" = threaded build, copied too so you can upgrade later by changing
// ENGINE_FILE in src/web/config.ts (it needs cross-origin isolation to use threads).
const files = [
  'stockfish-18-lite-single.js',
  'stockfish-18-lite-single.wasm',
  'stockfish-18-lite.js',
  'stockfish-18-lite.wasm',
];

if (!existsSync(srcDir)) {
  console.error(`[copy-engine] ${srcDir} not found — run \`npm install\` first.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const file of files) {
  const from = join(srcDir, file);
  if (!existsSync(from)) {
    console.warn(`[copy-engine] skip (missing): ${file}`);
    continue;
  }
  copyFileSync(from, join(outDir, file));
  copied += 1;
}

console.log(`[copy-engine] copied ${copied} file(s) -> public/sf/`);
