# SPEC — Stage 0: engine-less core library

**Goal:** implement the stubbed functions in `src/core/` so that `npm test` is all green and
`npm run typecheck` is clean. No chess engine, no UI, no network. Pure, deterministic TypeScript.

**Why this first:** these are the foundations the whole app reuses — the engine command/parse layer
(play vs engine), the strength mapping (adjustable opponent), and the eval→accuracy→classification
math (game analysis). They are pure functions, so they can be fully unit-tested offline.

All formulas, constants, protocol details, and the chess.js API are in **`docs/REFERENCE.md`**.
Do not invent constants — use the ones in REFERENCE.

---

## What to implement (4 files, 12 things)

### `src/core/evalMath.ts`
1. `cpToWinPercent(cp)` — REFERENCE §1.1 (clamp cp to ±1000).
2. `scoreToWinPercent(score)` — REFERENCE §1.2 (mate handling, no clamp for mate).
3. `winPercentToAccuracy(winBefore, winAfter)` — REFERENCE §1.3.
4. `classifyMove(winBefore, winAfter)` — REFERENCE §1.4 (use `CLASSIFICATION_THRESHOLDS`).
5. `averageCentipawnLoss(losses[])` — mean, empty → 0.
6. `harmonicMean(values[])` — `n / Σ(1/x)`, empty → 0.

### `src/core/uci.ts`
7. `parseInfoLine(line)` — REFERENCE §2. Return `null` for `info string ...` and non-`info` lines.
8. `parseBestMove(line)` — `bestmove <m> [ponder <m>]`, else `null`.
9. `buildPositionCommand({fen?, moves?})` — startpos/fen + optional moves.
10. `buildGoCommand({depth?, movetimeMs?, nodes?})` — `go [depth N] [movetime N] [nodes N]`, `{}` → `go`.

### `src/core/strength.ts`
11. `eloToEngineOptions(targetElo)` — REFERENCE §3 table. ≥1320 → UCI_Elo (clamped 1320–3190); else Skill band.

### `src/core/chessGame.ts`
12. `ChessGame` — thin wrapper over `chess.js` (REFERENCE §4). `move()` accepts SAN **or** UCI and
    returns `true`/`false`; `result()` returns `'1-0' | '0-1' | '1/2-1/2' | '*'`.

---

## Rules (do not break these)
- **Do NOT modify anything in `test/`.** The tests are the contract.
- **Do NOT change function signatures or the types in `src/core/types.ts`.**
- **Do NOT add npm dependencies.** Only `chess.js` (already installed) may be imported, in `chessGame.ts` only.
- Use only the constants/formulas in `docs/REFERENCE.md`.
- Work **one file at a time**, run `npm test` after each, move on only when that file's tests pass.

## Definition of done
```
npm run typecheck     # no errors
npm test              # 43 passed (4 files)
```
Suggested order (easiest → hardest): `evalMath` → `uci` → `strength` → `chessGame`.
