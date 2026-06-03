# SPEC — Stage 2: Game Analysis

**Status:** COMPLETE (pending the Mac-side acceptance run). Take a saved game and
produce a per-move accuracy/classification report — the consumer the Stage 0 eval
math was built for. Stage 0/1 are untouched and stay green.

**Goal (from the build plan):** replay a saved game, evaluate every position with a
full-strength engine at a deeper search than play, classify each move (best →
blunder) and score per-player accuracy, and review the game on the board.
**Acceptance:** analyze a real saved game end to end in the browser, offline; a
deliberate blunder is classified `blunder` and a clean game scores high; per-move
numbers match REFERENCE §1; the board review steps through the game; `npm test` green.

---

## What was built

All new code is the **analysis layer** + the **analysis UI**; no existing
signatures changed. The only edits to existing files are additive UI wiring
(`gameController.ts`, `main.ts`, `config.ts`, `styles.css`, `vite.config.ts`) and
one additive field on `BoardView` (an optional `shapes` array → `setAutoShapes`,
for the best-move arrow — `render()`'s signature is unchanged).

### New seam: the analyzer (`src/analysis/`)
- **`analyzer.ts`** — `analyzeGame(pgn, engine, opts)`:
  - Replays the PGN with `ChessGame` (single source of truth for legality) into
    per-ply positions.
  - Evaluates each **distinct, non-terminal** position **once**, by **depth**
    (`go depth 16`), through the existing `UciEngine` seam, reading the score off
    `engine.lastInfo.score` after each search. Terminal positions get **no** engine
    eval (REFERENCE/task requirement).
  - Configures the engine to **full strength** (`limitStrength:false, skillLevel:20,
    multipv:1`) via the unchanged `setStrength`/`buildStrengthCommands`.
  - Derives every per-move metric by **reusing `src/core/evalMath.ts` VERBATIM**:
    `scoreToWinPercent` (cp **and** mate), `winPercentToAccuracy`, `classifyMove`,
    `averageCentipawnLoss`, `harmonicMean`. Nothing re-implements a formula.
  - Score is side-to-move POV and win% is symmetric, so the mover's
    `winAfter = 100 - scoreToWinPercent(next position's eval)`.
  - Terminal handling: checkmate after a move → mover `winAfter = 100`; draw → 50.
  - Per-player game accuracy = **harmonic mean** of that player's move accuracies.
    (Lichess additionally volatility-weights this — left as an optional refinement,
    noted in code.)
  - Also exports `inferLastMove(fenBefore, fenAfter)` — best-effort [from,to] from a
    FEN diff, for the board-review highlight (king squares on castling).
- **`types.ts`** — `MoveAnalysis`, `PlayerReport`, `GameReport`, `AnalyzeOptions`
  (`depth`, `onProgress`, `shouldCancel`), and `AnalysisEngine` (the structural
  slice of `UciEngine` the analyzer needs — the real engine satisfies it unchanged,
  and a scripted fake satisfies it in tests).
- **`analysisStore.ts`** *(stretch, done)* — `AnalysisStore` interface +
  `InMemoryAnalysisStore` + `IndexedDbAnalysisStore`. Caches a `GameReport` keyed by
  saved-game id so re-opening is instant. It is a **separate** seam in its **own**
  IndexedDB database (`chess-trainer-analysis`) — it does **not** mutate
  `GameRepository`/`SavedGame`. Cached reports carry their `pgn` so a stale report
  (game edited) is recomputed.

### Analysis UI (`src/web/`)
- **`analysisView.ts`** — renders a `GameReport` **beside the board** (two-column
  layout; the board is sticky and the report scrolls; it stacks on narrow screens):
  a two-column **scoresheet** (SAN + class dot coloured best→blunder + White-POV
  eval, click to jump), per-player **accuracy %** + blunder/mistake/inaccuracy
  counts + ACPL, a hand-drawn **SVG win% sparkline** (click/scrub to jump), and a
  **board-review stepper** (⏮ ◀ ▶ ⏭, ←/→ keys). For each move it shows **what the
  engine's best move was** — a detail line ("You played Nc6. Best: Nf3") and a
  **green best-move arrow on the board** (drawn when the played move wasn't best,
  via `BoardView`'s new `shapes`). It owns only its own DOM and drives the board
  through a callback. Progress + Cancel + error states included.
- The best move per ply comes from the analyzer: it records the engine's `bestmove`
  at each position (UCI) and converts it to SAN via `ChessGame`
  (`MoveAnalysis.bestMoveUci/bestMoveSan/isBest`). `GameReport.version` lets the UI
  discard caches written by an older build (bumped to 2 for the best-move fields).
- **`gameController.ts`** — extended the read-only `viewPgn` path with an **additive**
  `reviewPosition(fen, {lastMove, orientation})` that reuses the single `BoardView`.
  It uses a **dedicated `reviewing` flag** (not `viewing`), so board review never
  alters the live game's persistence lifecycle — a live in-progress game is still
  auto-preserved when you start/resume next.
- **`main.ts`** — an **Analyze** button on every saved-games row → boots a dedicated
  full-strength analysis engine (its own Web Worker, lazily, so it never slows page
  load or the play engine) → runs `analyzeGame` with live progress → caches the
  report → renders it and enters board review. Cache is checked first for instant
  re-open; deleting/clearing games evicts their cached reports.
- **`config.ts`** — `ANALYSIS_DEPTH` (16) and `ANALYSIS_SEARCH_TIMEOUT_MS` (60s).
- **`vite.config.ts`** — adds **COOP/COEP** headers on dev + preview so switching to
  the threaded build is a one-line change. Everything this app loads is same-origin,
  so the headers are **inert and safe** for the default `lite-single` build.

### New tests (fast, no WASM; existing tests untouched) — `npm test` now **79** (was 67)
- **`test/analyzer.test.ts`** (7) — drives the **real `UciEngine`** through a
  position-aware **scripted `FakeTransport`** (`test/helpers/scriptedAnalysisEngine.ts`):
  a clean game with one deliberate blunder (asserts `blunder` class, clean side
  100%, REFERENCE win% values: cp 200 → 67.62), a mate-score + Fool's-mate terminal
  game (mate 1 → 99.94; terminal position never searched), **best-move capture**
  (played-best vs not-best → `isBest`/`bestMoveSan`/`bestMoveUci`), and `inferLastMove`.
- **`test/analysisStore.test.ts`** (5) — the `AnalysisStore` contract via InMemory.

## How to run (on the Mac)

```
npm install
npm test            # 78 passed (Stage 0/1's 67 + 11 new) — fast, offline, no WASM
npm run typecheck   # clean
npm run dev         # play a game, Save it, then click Analyze on it
npm run build && npm run preview   # disconnect network, confirm analysis works offline
```

## Verification done in this build (Linux sandbox)

`vitest`/`vite`/`rolldown` can't run on the FUSE mount (mac native bindings), so:
- **Typecheck:** `tsc --noEmit` clean across the whole repo (strict, DOM lib).
- **Pipeline (transpiled to CJS, run through Node):** both new test files execute
  green (**12/12**) under a minimal `vitest` shim — the analyzer's
  win%/accuracy/classification pipeline is asserted end to end against REFERENCE §1
  values, with the blunder classified `blunder`, the clean side at 100%, and
  mate/terminal handling correct.

**Run `npm test` + the `npm run dev` analysis playthrough once on the Mac** — that is
the human acceptance step.

## Notes / honest caveats
- Analysis reuses the play strength-command path, which pins `Threads 1`. So the
  **threaded** `lite` build won't get a multi-thread speedup without a future
  thread-count option on `UciEngine` (out of scope — `engine/*` is reused unchanged).
  `lite-single` analyses fine, just slower per game; depth-16 evals are trustworthy.
- `GameReport.result` is derived from the PGN moves (so a *resigned* game reads `*`);
  the saved game's real result lives on `SavedGame.result`. Not shown in the report UI.
