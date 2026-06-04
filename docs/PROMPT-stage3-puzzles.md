# Next session — Stage 3: Puzzles + Glicko-2 rating

Paste the block below into the next session as the task prompt. (It mirrors the
Stage 2 brief: dense, numbered, reuse-don't-rebuild, with acceptance + env notes.)

---

Building my offline chess trainer at ~/hobbes/chess-app/chess-trainer. Stage 0
(core), Stage 1 (play vs engine: chessground board + WASM Stockfish in a Web Worker
+ IndexedDB persistence), and Stage 2 (game analysis: per-move accuracy/
classification, board review, best-move arrows, captured-material, move nav, FEN/PGN
export) are committed and green. `npm test` is green (86 = Stage 0's 43 + engine/UI/
persistence units + Stage 2's analysis/undo/material units). I can play, save, and
analyse full games offline in the browser.

This session: Stage 3 — PUZZLES. Solve Lichess tactics puzzles, validate the
solution line, and rate the user with Glicko-2. This is the third core pillar
(play ✓ / analyse ✓ / train) and unlocks progress tracking + coaching later.

Read first: docs/SPEC-stage1.md and docs/SPEC-stage2.md (architecture + the seams
already built), AGENTS.md (operating rules), docs/REFERENCE.md — especially §4
(chess.js API used by ChessGame), §5 (Glicko-2: Lichess params + the algorithm
source), and §6 (Lichess puzzle CSV schema). Also read
~/hobbes/memory_system/0_INBOX/2026-05-30_chess-trainer-build-plan.md for the
intended Stage 3 scope — NOTE: that file lives OUTSIDE the repo folder, so the
sandbox may not be able to read it; if so I'll paste the relevant part on request.

Job:
1. Puzzle data pipeline (offline). The Lichess puzzle DB (REFERENCE §6:
   `PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,
   OpeningTags`; `Moves` = space-separated UCI, FIRST move is the opponent's SETUP
   move then the solver replies; ships `.csv.zst`) is ~4M rows — do NOT ship it into
   the browser. Write a Node preprocessing script (`scripts/build-puzzles.mjs`, run
   on the Mac) that decompresses (shell out to `zstd -d`), filters/samples to a
   curated, modest set (e.g. a few thousand, bucketed across rating bands ~600–2200,
   popularity-thresholded, theme-diverse), and writes a compact static asset
   (`public/puzzles/puzzles.json` or NDJSON) the app fetches same-origin (like the
   engine wasm — keep it offline). Decide and document the selection + size. Tell me
   where the CSV is if you can't find it.
2. Puzzle core (engine-less, pure, unit-tested) under a NEW `src/puzzles/` seam:
   - `types.ts` — `Puzzle` (id, fen, solution UCI[], rating, ratingDeviation,
     themes[], etc.), attempt/result types, solver-state types.
   - `puzzleSession.ts` — the solver state machine over ChessGame: load FEN, auto-
     apply the setup move (Moves[0]) so it's the solver's turn, then validate each
     user move against the expected solution move (solver = odd indices; after a
     correct move auto-play the opponent reply at the next even index), advancing to
     SOLVED when the line is exhausted or FAILED on a wrong move. Rule v1: require the
     exact solution UCI; OPTIONAL refinement (note it): also accept any move that
     gives immediate checkmate when the solution move is mate. Pure + deterministic.
   - `selection.ts` — pick the next puzzle near the user's current rating (adaptive),
     optional theme filter, avoid immediate repeats.
   - `index.ts` barrel. Reuse ChessGame VERBATIM for legality/turns; do NOT reach for
     the engine to solve (the solution line is known).
3. Glicko-2 rating in core: `src/core/rating.ts` — implement the update from
   REFERENCE §5 + the Glicko-2 paper as PURE TS (preferred: zero new deps, matches
   the "tested-against-reference" core ethos like evalMath). Treat each attempt as a
   game vs an opponent at the puzzle's rating (win=solved, loss=failed). Apply the
   Lichess seed/params from §5 (default 1500 / RD 500 / vol 0.09, τ=0.75, RD clamp
   45–500, vol cap 0.1, single-update change cap ±700, "established" when RD≤75).
   Unit-test against the canonical worked example (player 1500/RD 200/σ 0.06, τ=0.5,
   vs 1400/30 win, 1550/100 loss, 1700/300 loss → rating≈1464.06, RD≈151.52,
   σ≈0.05999), AND verify wins raise / losses lower the rating, RD shrinks with play,
   and the bounds clamp. (Using the `glicko2` npm package is an allowed fallback, but
   then it's the FIRST new runtime dep — prefer the pure implementation.)
4. Persistence: a NEW `PuzzleStore` interface (InMemory + IndexedDb in its OWN
   database, NOT mutating GameRepository/SavedGame — mirror
   src/analysis/analysisStore.ts, which already uses a separate DB). Persist the
   user's Glicko-2 state (rating/RD/vol) and an attempt log (puzzleId, solved/failed,
   date, rating delta) so progress survives reloads and feeds Stage 4 tracking.
5. Puzzle UI: a `PuzzleController` + `puzzleView` (new web seams, mirroring the
   GameController / AnalysisView pattern — do NOT overload them). Reuse BoardView
   (incl. its `shapes` for an optional hint arrow), legalDests (`computeMoves`), and
   promotion (`pickPromotion`). Flow: show the position oriented to the solver's
   side, auto-play the setup move, accept user moves, give correct/incorrect feedback
   (with the right move revealed on fail), show SOLVED/FAILED, the user's rating + the
   ±delta, and a "Next puzzle" button (retry on fail is fine). Wire a "Puzzles" entry
   into the app (a mode/tab alongside the play view in main.ts). Stretch: themes
   filter, hint (highlight the piece to move), streak counter, a daily target.
6. Works offline after `vite build`.

Reuse, don't rebuild (don't change their signatures): src/core/chessGame.ts,
src/core/types.ts, src/engine/* (only if you later add alt-move acceptance/hints —
not needed for v1), src/web/boardView.ts, src/web/legalDests.ts, src/web/promotion.ts,
and the persistence pattern. New seams only: src/puzzles/*, src/core/rating.ts, the
PuzzleStore, the puzzle UI, and the build-puzzles script.

Constraints: aim for NO new runtime deps (implement Glicko-2 in TS; the build script
may shell out to the `zstd` CLI on the Mac — that's not an app dep). Keep `npm test`
green and ADD deterministic, offline tests: puzzle-session tests driving scripted
puzzles (no WASM) that assert the validate→advance→solved/failed pipeline incl. a
multi-move line and a wrong-move failure; and rating tests against the §5 vector.
Handle promotions in solution UCI (e.g. `e7e8q`) and terminal/mate lines.

Acceptance: solve a real Lichess puzzle end to end in the browser, offline — position
loads, the setup move auto-plays, correct moves advance and auto-reply, a wrong move
fails and reveals the solution; a multi-move puzzle works; the Glicko-2 rating updates
(up on solve, down on fail) and persists across reloads with RD shrinking as you play;
the next puzzle is chosen near the user's rating; puzzle-session + rating unit tests
pass; `npm test` green. Finish by writing docs/SPEC-stage3.md (what was built, how to
run, acceptance) like SPEC-stage1/2.

Environment notes (carry over from last sessions): the repo is on a FUSE mount where
`npm install`, `vite build`, and git index writes can fail with atomic-rename/
permission errors — run npm/vite/git on the Mac. vitest/rolldown won't run in the
sandbox (the FUSE node_modules has mac native bindings); verify pure logic by
transpiling the relevant .ts to CommonJS with `node node_modules/typescript/bin/tsc
--module commonjs --outDir /tmp/... ` and running assertions through Node (chess.js is
pure JS, so puzzleSession + rating run fine there) — this is how Stage 2 was verified
offline. The puzzle CSV is large and may sit outside the mounted folder, so run
build-puzzles on the Mac. `tsc --noEmit` runs fine in the sandbox for full typecheck.
Clear any stale .git/index.lock before committing; do the browser playthrough +
`npm test` + `npm run build` offline check on the Mac as the human acceptance step.
