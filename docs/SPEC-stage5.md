# SPEC — Stage 5: Coaching Mode (live in-game coaching)

**Status:** COMPLETE (pending the Mac-side acceptance run). Bring the Stage 2 analysis
pillar's feedback **live onto the Play tab**, chess.com "Play Coach"-style: a visible
**eval bar**, **per-move accuracy/cp change**, the **best move when you slip**, a **red
arrow showing the refutation** when you blunder (read from the engine's **PV**, so it
works even when the punishment lands a move or two later), and a **missed-opportunity**
flag ("you had a chance to play checkmate — undo and try to find it?") that fires even
when the move played wasn't a "??". Stage 0–4 are untouched and stay green.

**Goal (from the build plan):** the live counterpart to Stage 2 — drive it with the
**same Stockfish + the Stage 0/2 eval math**, **NOT re-deriving** accuracy/classification
(reuse `src/core/evalMath.ts` + `src/analysis` verbatim). Fully **offline, no LLM/web,
no new runtime deps**.

**Acceptance:** with Coach mode on, the **+4 → −0.15** blunder (a hung knight) swings the
bar down, is flagged **?? Blunder**, shows the **best move** (green arrow + SAN) and the
**refutation** (red arrow capturing the knight) with a one-line reason — even though the
loss only fully lands a move later (taken from the PV). A sub-90% non-blunder shows the
best move. The **M8** position flags the **missed mate** and offers undo/retry without
needing the move to be a blunder. The eval bar tracks the game throughout. The pure
feedback/refutation/missed-opportunity logic has unit tests; `npm test` green; works
offline after `npm run build`.

---

## What was built

All new behaviour is in **two pure, engine-less additions to `src/coach/`** (unit-tested)
and a **self-contained Coach UI seam in `src/web/`**. **No existing signatures changed.**
Edits to existing files are additive only: two `export`s on the analyzer, four config
knobs, additive `GameController` hooks (a coach callback + a coach-mode flag + a live-arrow
overlay + a `requestEngineReply()`), `main.ts` wiring, `styles.css`, and one optional
parameter on the test scripted-engine helper. `evalMath.ts`, the analyzer math,
`UciEngine`/`WorkerUciTransport`, and `BoardView` are reused **verbatim**.

### 1. Pure live-feedback core — `src/coach/liveFeedback.ts` (engine-less, tested)

`liveMoveFeedback(scoreBefore, scoreAfter, bestMoveUci, pv, mover)` →
`{ winBefore, winAfter, cpLoss, accuracy, classification, bestMoveUci, refutationUci?, refutationLine, missedOpportunity? }`.

- **Reuses `evalMath` verbatim** for every shared number — `scoreToWinPercent`,
  `winPercentToAccuracy`, `classifyMove` — with the analyzer's exact POV convention:
  `winBefore = scoreToWinPercent(scoreBefore)` (pre-move side to move = the mover) and
  `winAfter = 100 − scoreToWinPercent(scoreAfter)` (post-move side to move = opponent).
  `cpLoss` reuses the analyzer's **exported** bounded-cp helper `centipawnLoss` — shared,
  not forked.
- **refutation** = the first move of the **post-move PV** (`pv[0]`), set when the move is
  a `blunder` (the red "why" arrow). The full `refutationLine` is exposed so the UI can
  step through how the punishment unfolds.
- **missedOpportunity** (`'mate' | 'winning'`) = the pre-move position was a forced mate
  (`scoreBefore.mate > 0`) or a decisive advantage (`scoreBefore.cp ≥ COACH_WINNING_CP`,
  300) but the move gave a meaningful chunk back (`accuracy < COACH_BESTMOVE_ACCURACY`,
  90). **Independent of `classification`**, so a still-winning-but-not-best move is flagged
  even though it isn't a "??".
- Tunables co-located like evalMath's constants: `COACH_BESTMOVE_ACCURACY = 90`,
  `COACH_WINNING_CP = 300`; the **blunder cutoff is reused** from evalMath's
  `CLASSIFICATION_THRESHOLDS` via `classifyMove`.

### 2. Single-position eval helper — `src/coach/evaluatePosition.ts`

`evaluatePosition(fen, engine, depth)` → `{ score, winWhite, bestMoveUci, pv }`, built from
`UciEngine.bestMove()` + `engine.lastInfo` (which already carries the `score` **and** the
`pv`) — the analyzer's exact read path. `winWhite` flips the side-to-move score to White's
POV via the FEN, reusing `scoreToWinPercent` (so the live bar agrees with the analysis
view). Talks to the structural `AnalysisEngine` slice, so it's unit-testable with the
scripted fake — no WASM.

### 3. Coach UI seam — `src/web/coachController.ts` + `coachView.ts`

- **`CoachController`** owns a **dedicated full-strength coach engine** in its **own Web
  Worker** (separate from the limited-strength play engine and from the analysis engine),
  **pre-warmed** when Coach mode is toggled on. It listens to the new `onCoachEval` hook,
  caches per-position evals, serialises engine access, and turns `liveMoveFeedback` into
  the eval bar + a coach line + **green best-move / red refutation arrows** on the existing
  play `BoardView` (reusing `BoardShape`/`setAutoShapes`). One shallow **`COACH_LIVE_DEPTH`**
  search per position drives the bar, the classification, AND the refutation PV (the rigorous
  deeper numbers are the on-demand Analyze pass). **It is NON-BLOCKING: the game never
  stops.** After a move it shows the feedback + arrows and the opponent **plays on
  immediately**; the arrows are **left on the board** through the reply so you can read the
  critique and, if you want, hit **Undo** to follow it — Undo keeps the (still-valid) green
  best-move arrow and refreshes the bar. The best-move arrow / "stronger move available"
  message appear together for any sub-90%-accuracy move, so they can never disagree.
- **`CoachView`** is DOM-only: a vertical White-POV **eval bar** to the left of the board
  (white fill height = White win%, flips with board orientation, handles mate via "M8"),
  and a coach line (classification badge best→blunder, a one-line message, the cp/accuracy
  metrics, and a muted "Your move." between moves).

### 4. Additive `GameController` hooks (the play loop is reused, not overloaded)

`setCoachMode(on)`, an `onCoachEval(ctx)` callback fired **after the human move and after
the engine reply (never mid-search)**, `requestEngineReply()` (so the coach owns the
post-human-move turn and releases it on Continue), `setLiveShapes()` (the green/red overlay,
shown only at the live position), `isHumanToMove()`/`orientation` getters, and coach-arrow
clearing on every new move / undo / new game / resume / view / resign. **With Coach mode
off, the play loop is byte-for-byte the original** (the auto-reply path is unchanged).

### 5. Config knobs — `src/web/config.ts`

`COACH_LIVE_DEPTH = 12` (the single per-move search), `COACH_SEARCH_TIMEOUT_MS = 60_000`,
and `COACH_AUTO_ON_MAX_ELO = 1000` (Coach mode auto-on at low strength, still a visible
toggle). When Coach is on, the Play tab switches to a **two-column layout** (bigger board
+ eval bar on the left, coach notes in a sticky right column, like the analysis view);
`BoardView.redraw()` re-measures chessground on the layout change so pieces stay aligned.

## Reuse, don't rebuild (what was NOT touched)

`src/core/evalMath.ts`, `src/analysis/*` (only **added** `export` to `scoreToCp` +
`centipawnLoss`; no logic/signature change), `src/engine/*` (UciEngine + WorkerUciTransport),
`src/web/boardView.ts` (its existing `shapes` path), and the `gameController` play loop
(hooked after each move, never mid-search). New seams only: the two `src/coach/` modules,
and the Coach UI (`coachController.ts` + `coachView.ts`). **Zero new runtime dependencies.**

## New tests (fast, no WASM; existing tests untouched) — `npm test` now **178** (was 161)

- **`test/liveFeedback.test.ts`** (14) — the PURE core, cross-checked against the evalMath
  functions and REFERENCE §1 anchors. Includes the two acceptance scenarios as scripted
  scores/PVs: the **+4 → −0.15 blunder** (asserts `blunder`, `missedOpportunity:'winning'`,
  `refutationUci === pv[0]`, the 415 cp swing, best-move surfaced) and the **missed "M8"
  mate** (asserts `missedOpportunity:'mate'` while the move is **not** a blunder and no red
  refutation is shown). Plus: keeping a mate raises no flag, a missed decisive win, a clean
  move stays quiet, and walking into mate is a blunder whose refutation is the mating move.
- **`test/evaluatePosition.test.ts`** (3) — drives the **real `UciEngine`** through the
  position-aware scripted `FakeTransport`: White-POV bar mapping (cp 200 → 67.62), the
  side-to-move→White flip, multi-move **PV extraction** (the refutation source), and that
  it searches by **depth**. (The scripted helper gained an optional `pvForFen` to script a
  multi-move PV — additive; existing analyzer tests are unaffected.)

## How to run (on the Mac)

```
npm install
npm test            # 178 passed (161 + 17 new) — fast, offline, no WASM
npm run typecheck   # clean
npm run dev         # turn on "Coach", play; blunder a piece and watch the bar/arrows/retry
npm run build && npm run preview   # disconnect the network, confirm coaching works offline
```

## Verification done in this build (Linux sandbox)

`vitest`/`vite`/`rolldown` can't run on the FUSE mount (native bindings), so:
- **Typecheck:** `tsc --noEmit` clean across the whole repo (strict, DOM lib) — engine +
  coach + web + tests.
- **Pure pipeline (transpiled to CJS, run through Node):** the two new test files execute
  green (**17/17**), and `test/analyzer.test.ts` re-runs green (**7/7**) against the
  additive analyzer exports — confirming no regression. The win%/accuracy/classification,
  the refutation extraction, and the missed-mate flag are asserted against REFERENCE §1.

**Run `npm test` + the `npm run dev` Coach playthrough once on the Mac** — that is the
human acceptance step (live engine evals aren't bit-deterministic across depth/runs, so the
live bar/arrow behaviour is a manual check by design).

## Notes / honest caveats

- **Non-blocking by design.** Coach mode never stops the game (this replaced an earlier
  pause/Retry/Continue flow that could strand the game on a borderline move). After your
  move the opponent replies immediately; the feedback + arrows are left on the board for you
  to read and act on with **Undo**. One shallow `COACH_LIVE_DEPTH` search per position keeps
  it responsive (the rigorous depth-16 numbers are the Analyze pass). The coach evaluates
  your move (for feedback) and the position you next face (for the bar) — the engine's own
  move isn't critiqued. Raise `COACH_LIVE_DEPTH` in `config.ts` to trade speed for trust;
  the threaded `lite` build (one-line `ENGINE_FILE` switch) is much faster if you serve
  COOP/COEP (already configured).
- **POV bookkeeping** follows the analyzer exactly: engine score is side-to-move POV, the
  eval bar is White POV (flipped from the FEN), accuracy/classification are mover POV, and
  the refutation is the post-move PV's first move (UCI→SAN via `ChessGame`).
- **Not done (optional/stretch):** persisting a per-game accuracy onto `SavedGame` so the
  Progress tab populates without a separate Analyze pass — deferred to keep the change
  surgical (it would touch `persistence` + the Stage 4 aggregation). The live coach already
  reuses the analyzer's numbers, so wiring this later is a small additive step.

## Follow-up: stricter accuracy + a playing rating

Two changes after comparing the analysis to chess.com (same game, matching eval line):

**1. "Closeness to best" accuracy (cp-weighted).** Lichess (our original) only penalises
moves that change *winning chances*, so imprecision in an already-won position is forgiven
and accuracy reads higher than chess.com (which grades every deviation from best). New
`evalMath.effectiveWinDrop(winBefore, winAfter, cpLoss, cpWeight) = max(winDrop,
min(cpWeight·cpLoss, blunderThreshold−ε))` blends the win% drop with a centipawn-loss term,
so a sloppy move in a winning position now counts as an inaccuracy/mistake. The cp term is
**capped below the blunder threshold**, so cp loss alone can never manufacture a "??" in a
still-winning position — the red refutation arrow stays reserved for genuine win% collapses,
and the live coach's missed-opportunity/undo prompt is still keyed on a real give-back.
`winPercentToAccuracy`/`classifyMove` now delegate to extracted drop-based helpers
(`accuracyFromWinDrop`/`classFromWinDrop`) so existing behaviour is unchanged at
`cpWeight = 0`. The analyzer (`AnalyzeOptions.cpLossWeight`) and the live coach both use
`ACCURACY_CP_WEIGHT = 0.03` (web/config; tunable: 0 = Lichess-lenient, ~0.05 ≈ chess.com).
`ANALYSIS_REPORT_VERSION` bumped to 3 so cached reports recompute.

**2. Playing rating (classic Elo vs the engine).** A new pure `src/coach/gameRating.ts`
folds the standard Elo update over finished games — `NewElo = cur + K·(S − E)`,
`E = 1/(1+10^((opp−cur)/400))`, opponent = the engine's strength, `S` from result + side,
seed **800**, `K = 32`, provisional < 10 games. **Undo handling:** a WIN in a game where
you took a move back keeps only **25%** of its rating gain (`GAME_RATING_UNDO_WIN_RETENTION`,
read off the existing `SavedGame.undoUsed` flag) — a takeback isn't your true skill; losses
and draws are unaffected. It's derived live from the saved games (no
new persistence), surfaced on the Progress tab as a **"playing rating"** card beside the
**"puzzle rating"**, with a chart and a one-line note explaining why they differ: puzzle
rating measures tactics (you're told a tactic exists) and reads higher than real playing
strength; and the engine's Elo is CCRL-anchored, not human (REFERENCE §3) — both explain a
1400 puzzle rating alongside losing to an "800" bot. New deterministic tests:
`test/accuracyStrictness.test.ts` (6) and `test/gameRating.test.ts` (9); existing suites
unchanged. `npm test` ≈ **193**.

## Acceptance checklist (the human step)

- [ ] Toggle **Coach** on; the **eval bar** appears left of the board and tracks every move.
- [ ] Hang a piece (the **+4 → −0.15** case): bar swings down, move flagged **?? Blunder**,
      **green** best-move arrow + SAN, **red** refutation arrow capturing the piece, and a
      one-line reason — even when the punishment is a move or two later (from the PV).
- [ ] A **sub-90% non-blunder** shows the best move (green arrow + "Best: …").
- [ ] In a position with a **forced mate** you don't take, the coach flags the **missed
      mate** ("you had a chance to play checkmate") and shows the move — it does **not**
      stay silent because the move wasn't a "??".
- [ ] The coach is **non-blocking**: the opponent always replies; the arrow stays on the
      board; hitting **Undo** takes the move back with the green best-move arrow still
      shown, so you can play it.
- [ ] **Offline:** `npm run build && npm run preview`, kill the network, confirm a coached
      game still works end to end.
