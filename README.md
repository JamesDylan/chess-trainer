# chess-trainer

Offline, single-user chess trainer for macOS — play vs Stockfish (adjustable strength), solve
Lichess puzzles, analyse games (accuracy %, blunder→brilliant), track progress, and get coaching on
your weaknesses. No accounts, no internet, no social. Like Lichess/Chess.com training, for one person.

**Stack:** TypeScript core → web UI (chessground board + Stockfish WASM) → packaged as a Tauri macOS
app with native Stockfish. See the planning docs in `memory_system/0_INBOX/2026-05-30_chess-trainer-*`.

## Status: Stage 0 (engine-less core library)
Pure, unit-tested foundations: chess game wrapper, UCI parse/build, eval→accuracy→classification
math, and engine strength mapping. No engine or UI yet.

## Setup
```
npm install        # do this while ONLINE (also writes package-lock.json)
npm test           # runs the Stage 0 test suite (43 tests)
npm run typecheck
```
With the stubs in place, `npm test` fails by design — the tests define the work. Implementing
`src/core/*` to make them pass is Stage 0 (see `docs/SPEC-stage0.md`).

## Layout
```
src/core/      types, evalMath, uci, strength, chessGame   (implement these)
test/          the spec, as tests (don't edit)
docs/          REFERENCE.md (offline cheat-sheet), SPEC-stage0.md
AGENTS.md      instructions for AI agents working here
```

## For AI agents
Read `AGENTS.md`, then `docs/SPEC-stage0.md` + `docs/REFERENCE.md`. Everything needed is offline.
