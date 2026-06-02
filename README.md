# chess-trainer

Offline, single-user chess trainer for macOS — play vs Stockfish (adjustable strength), solve
Lichess puzzles, analyse games (accuracy %, blunder→brilliant), track progress, and get coaching on
your weaknesses. No accounts, no internet, no social. Like Lichess/Chess.com training, for one person.

**Stack:** TypeScript core → web UI (chessground board + Stockfish WASM) → packaged as a Tauri macOS
app with native Stockfish. See the planning docs in `memory_system/0_INBOX/2026-05-30_chess-trainer-*`.

## Status: Stage 1 complete (play vs engine, in the browser)
Stage 0's pure core (chess wrapper, UCI parse/build, eval→accuracy→classification math, strength
mapping) plus the Stage 1 engine layer and **the playable UI**: a `chessground` board driven by a
WASM Stockfish running in a Web Worker, adjustable strength, checkmate/draw detection, and game
persistence to IndexedDB. Works offline after `vite build`.

## Setup & run
```
npm install        # do this while ONLINE; adds vite + chessground, pulls the Stockfish builds
npm test           # 67 tests (Stage 0's 43 + engine units + UI/persistence units)
npm run typecheck

npm run dev        # play in the browser at the printed localhost URL
npm run build      # self-contained, offline dist/
npm run preview    # serve dist/ locally (disconnect the network to prove offline)
```
Strength, side, and New game are in the top controls; finished games appear under "Saved games".
See `docs/SPEC-stage1.md` for the architecture and the acceptance checklist.

## Layout
```
src/core/         types, evalMath, uci, strength, chessGame   (Stage 0; pure, do not change sigs)
src/engine/       UciEngine + transports: nodeEngine (Node) and workerEngine (browser Web Worker)
src/web/          board UI, game controller, strength control, promotion picker (vanilla TS)
src/persistence/  GameRepository over IndexedDB (+ in-memory twin)
scripts/          copy-engine.mjs — stages the Stockfish WASM into public/sf for Vite
test/             the spec, as tests (don't edit existing ones)
docs/             REFERENCE.md (offline cheat-sheet), SPEC-stage0.md, SPEC-stage1.md
AGENTS.md         instructions for AI agents working here
```

## For AI agents
Read `AGENTS.md`, then `docs/SPEC-stage0.md` + `docs/REFERENCE.md`. Everything needed is offline.
