# Next session — Stage 4: Progress tracking + Coaching

Paste the block below into the next session as the task prompt. (It mirrors the
Stage 1–3 briefs: dense, numbered, reuse-don't-rebuild, with acceptance + env notes.)

---

Building my offline chess trainer at ~/hobbes/chess-app/chess-trainer. Stage 0 (core),
Stage 1 (play vs engine: chessground + WASM Stockfish in a Web Worker + IndexedDB
persistence), Stage 2 (game analysis: per-move accuracy/classification, board review,
best-move arrows, FEN/PGN export), and Stage 3 (puzzles + Glicko-2 rating: solve Lichess
tactics offline, validate the solution line, rate the user with Glicko-2, persist an
attempt log) are committed and green. `npm test` is green (113 = Stage 0–2's 86 +
Stage 3's 27 puzzle-session/rating/selection/store tests). I can play, analyse, and
train fully offline in the browser; puzzle progress (Glicko-2 rating/RD/vol + an attempt
log) survives reloads in its own IndexedDB.

This session: Stage 4 — PROGRESS & COACHING. Turn the data the first three pillars
already persist (puzzle attempts, saved games, analysis reports) into a progress
dashboard and RULE-BASED coaching that names the user's weaknesses and tells them what to
train. This closes the loop — play ✓ / analyse ✓ / train ✓ → **know where you're weak and
drill it**. Fully offline, NO LLM/web API: coaching is deterministic analytics over local
data, in the same "tested-against-reference" pure-core ethos as evalMath/rating.

Read first: docs/SPEC-stage1.md, docs/SPEC-stage2.md, docs/SPEC-stage3.md (architecture +
every seam already built), AGENTS.md (operating rules), docs/REFERENCE.md — especially §1
(eval math / Win%→Accuracy% / move classification) and §5 (Glicko-2). Also read
~/hobbes/memory_system/0_INBOX/2026-05-30_chess-trainer-build-plan.md for the intended
Stage 4 scope — NOTE: that file lives OUTSIDE the repo folder, so the sandbox may not be
able to read it; if so I'll paste the relevant part on request.

Data you already have — AGGREGATE it, don't recompute it:
- **PuzzleStore** (src/puzzles/puzzleStore.ts, own DB `chess-trainer-puzzles`): the
  Glicko-2 state + an append-only `PuzzleAttempt[]` (puzzleId, solved, at, puzzleRating,
  ratingBefore/After, ratingDelta, rdAfter).
- **GameRepository** (src/persistence): `SavedGame` (pgn, result, strengthElo,
  humanColor, playedAt, inProgress, undoUsed).
- **AnalysisStore** (src/analysis/analysisStore.ts, own DB `chess-trainer-analysis`): a
  cached `GameReport` per analysed game id (per-move `MoveAnalysis` with classification
  best→blunder, accuracy, cpLoss, FENs; per-player accuracy/ACPL/class counts). Reports
  exist ONLY for games the user clicked Analyze on — aggregate over whatever's present by
  enumerating `GameRepository.list()` ids → `AnalysisStore.get(id)` and skipping
  unanalysed games. Do NOT change AnalysisStore's signature to do this.

Job:
1. **Extend the puzzle attempt record (additive) so theme/phase coaching is possible.**
   `PuzzleAttempt` currently does NOT store the puzzle's themes, so per-theme weakness
   analysis isn't derivable from the log. Add `themes: string[]` and `assisted: boolean`
   (whether a hint was used) to `PuzzleAttempt`, and write them in `PuzzleController` at
   attempt time (the full `Puzzle` + the assisted flag are already in hand there). Bump
   the PuzzleStore IndexedDB version with BACK-COMPAT — legacy rows missing
   themes/assisted read as `[]`/`false`, never throw. No other schema changes: progress
   stats are DERIVED at read time (no new DB, unless you add an optional goals store as a
   stretch).

2. **Stats + coaching CORE (pure, engine-less, unit-tested) under a NEW `src/coach/`
   seam:**
   - `types.ts` — `RatingPoint`, `ThemeStat`, `PhaseStat`, `Weakness`,
     `CoachingInsight`, `ProgressSnapshot`, etc.
   - `puzzleStats.ts` — pure fns over `PuzzleAttempt[]`: rating-over-time series (from
     ratingAfter + at), overall solve rate, per-theme solved/attempts → accuracy,
     per-rating-band performance, streak history. Rank "weakest themes" but require a
     MINIMUM attempt count so tiny samples don't top the list (document the threshold).
     Reuse src/core/rating.ts for any rating math.
   - `gameStats.ts` — pure fns over `GameReport[]` (+ SavedGame meta): accuracy & ACPL
     trend over time, blunder/mistake/inaccuracy rate per game and overall, accuracy by
     GAME PHASE (opening/middlegame/endgame — derive from ply/material off the FENs
     already in `MoveAnalysis`; document the cut), and performance vs engine strength.
     Reuse src/core/evalMath.ts + the analysis types VERBATIM — do NOT re-derive
     accuracy/classification.
   - `coach.ts` — synthesize a ranked `Weakness[]` + a short, prioritised
     `CoachingInsight[]` from BOTH sources using documented, tunable heuristics/thresholds
     (constants like evalMath's), e.g. "fork solve-rate 55% over 22 tries → weak → drill
     forks"; "blunders 1.8/game, mostly endgame → endgame focus". Each insight carries an
     actionable recommendation (e.g. a theme to drill). Pure + deterministic.
   - `index.ts` barrel. No engine, no DOM, no new deps.

3. **Progress UI: a `ProgressController` + `progressView` (new web seams mirroring the
   GameController / AnalysisView / PuzzleController pattern — do NOT overload them). Wire
   a "Progress" tab into main.ts alongside Play / Puzzles.** It reads PuzzleStore +
   GameRepository + AnalysisStore, builds a `ProgressSnapshot` via `src/coach`, and
   renders:
   - a header dashboard (current rating ± / provisional, puzzles solved, current + best
     streak, games played, overall game accuracy),
   - a rating-over-time chart as a HAND-DRAWN SVG (reuse the analysisView win% sparkline
     technique — no chart library),
   - per-theme + per-phase strength/weakness lists with the stats and a confidence note,
   - 2–4 prioritised coaching insights, each with a **"Drill this"** action that opens the
     Puzzles tab pre-filtered to the weak theme (reuse `PuzzleController.setTheme`) —
     closing play/analyse → train. Derive live on open; refresh after new attempts. Reuse
     the existing styles/design tokens.
   - Stretch: an activity heatmap/calendar, user-set goals you track against, a "review
     your worst blunders" jump that replays a game position on the board (reuse the
     analysis board-review path), spaced-repetition re-queue of missed puzzles, or an
     exportable progress report.

4. Reuse, don't rebuild (don't change their signatures): src/core/* (rating, evalMath,
   chessGame, types), src/puzzles/* (PuzzleStore, PuzzleController.setTheme, types),
   src/analysis/* (GameReport, MoveAnalysis, AnalysisStore), src/persistence/*, src/web/*
   (BoardView + the tab/controller/view pattern). New seams only: src/coach/*, the
   Progress UI, and the additive `PuzzleAttempt` fields + the PuzzleController wiring.

5. Constraints: aim for NO new runtime deps (pure-TS analytics; SVG charts hand-drawn like
   the existing sparkline). Coaching is RULE-BASED and OFFLINE — do NOT call any LLM or
   web API. Keep `npm test` green and ADD deterministic, offline tests: puzzleStats /
   gameStats / coach over scripted attempt logs + scripted GameReports, asserting the
   rating series, per-theme and per-phase accuracy, the weakness ranking + its min-sample
   threshold, and that insights/recommendations fire exactly on the documented thresholds.
   Handle empty/sparse data (no attempts, no analysed games) without throwing.

6. Works offline after `vite build`.

Acceptance: after solving some puzzles (including a couple missed, across ≥2 themes) and
analysing ≥1 game, the Progress tab shows a rating curve that matches the attempt log,
correct per-theme solve rates, a ranked weakness list, and ≥1 coaching insight whose
"Drill this" opens the Puzzles tab filtered to that theme; stats derive live and update
after a new attempt; coach/stats unit tests pass; `npm test` green. Finish by writing
docs/SPEC-stage4.md (what was built, how to run, acceptance) like SPEC-stage1/2/3.

Environment notes (carry over from last sessions): the repo is on a FUSE mount where
`npm install`, `vite build`, and git index writes can fail with atomic-rename/permission
errors — run npm/vite/git on the Mac. vitest/rolldown won't run in the sandbox (the FUSE
node_modules has mac native bindings); verify pure logic by transpiling the relevant .ts
to CommonJS with `node node_modules/typescript/bin/tsc --module commonjs --outDir /tmp/...`
and running assertions through Node (chess.js + the analysis/coach code are pure JS there)
— this is how Stages 2–3 were verified offline. IMPORTANT: the sandbox shell CANNOT write
into the repo on the FUSE mount (`rm`/redirects fail with "Operation not permitted") —
create/modify files with the editor/file tools, not shell redirects, and verify by reading
them back. `tsc --noEmit` runs fine in the sandbox for a full typecheck. Clear any stale
.git/index.lock before committing; do the browser playthrough + `npm test` + `npm run
build` offline check on the Mac as the human acceptance step.
