# AGENTS.md — operating instructions for AI agents in this repo

Read this first. It applies to any AI (offline qwen on a plane, or Claude online).

## What this project is
An **offline, single-user chess trainer** for macOS: play vs Stockfish at adjustable strength,
solve Lichess puzzles, analyse games (accuracy %, move classification), track progress, get coaching
on weaknesses. Stack: **TypeScript** core now → web UI (chessground + Stockfish WASM) → packaged as a
**Tauri** Mac app with native Stockfish later. The full plan lives in the user's notes
(`memory_system/0_INBOX/2026-05-30_chess-trainer-*`).

## The current job: Stage 0
Implement the pure, engine-less core library. The exact task is in **`docs/SPEC-stage0.md`**.
All facts you need (formulas, UCI, chess.js API) are in **`docs/REFERENCE.md`** — you do **not** need internet.

## How to work (TDD loop)
1. Read `docs/SPEC-stage0.md` and `docs/REFERENCE.md`.
2. Pick ONE file from `src/core/` (start with `evalMath.ts`).
3. Replace each `throw new Error('not implemented')` with a real implementation using REFERENCE.
4. Run `npm test`. Fix until that file's tests pass.
5. Run `npm run typecheck`. Fix any type errors.
6. Next file. Done when `npm test` shows **43 passed** and typecheck is clean.

## Hard rules
- **Never edit `test/`** — the tests are the spec. If a test seems wrong, re-read REFERENCE; do not change it.
- **Never change signatures or `src/core/types.ts`.**
- **Never add dependencies.** Only `chess.js` may be imported (in `chessGame.ts`).
- Don't hardcode a function's return just to satisfy one assertion — implement the real formula.
- Keep changes small and run tests often.

## Commands
```
npm test            # run all tests once
npm run test:watch  # re-run on change
npm run typecheck   # tsc --noEmit
npm run check       # typecheck + test
```

---

## Paste-ready task prompt (for qwen / any model)
```
You are a senior TypeScript engineer working OFFLINE in the repo at chess-trainer/.
Your job: make `npm test` pass by implementing the stubbed functions in src/core/.

Read docs/SPEC-stage0.md and docs/REFERENCE.md first. They contain every formula and API you need —
do not use the internet, and do not invent constants.

Rules:
- Do NOT modify anything under test/. Tests are the contract.
- Do NOT change function signatures or src/core/types.ts.
- Do NOT add dependencies. Only chess.js may be imported (in chessGame.ts).
- Implement one file at a time, in this order: evalMath.ts, uci.ts, strength.ts, chessGame.ts.
- After each file, run `npm test` and fix failures before moving on. Then run `npm run typecheck`.

Done = `npm test` shows 43 passed and `npm run typecheck` is clean.
Start with src/core/evalMath.ts. Show me the implementation, then the test output.
```
