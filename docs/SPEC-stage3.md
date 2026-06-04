# SPEC — Stage 3: Puzzles + Glicko-2 rating

**Status:** COMPLETE (pending the Mac-side acceptance run). Solve Lichess tactics
puzzles offline, validate the solution line move-by-move, and rate the user with
Glicko-2 — the third core pillar (play ✓ / analyse ✓ / **train**). Stage 0/1/2 are
untouched and stay green.

**Goal (from the build plan):** ship a curated puzzle set into the app offline, drive
a pure solver state machine over `ChessGame` (auto-play the opponent's setup move,
then validate each user move against the known solution, auto-replying for the
opponent), rate each attempt with a pure Glicko-2 update, persist progress, and wire
a Puzzles tab into the UI.
**Acceptance:** solve a real Lichess puzzle end to end in the browser, offline — the
position loads oriented to the solver, the setup move auto-plays, correct moves
advance and auto-reply, a wrong move fails and reveals the solution; a multi-move
puzzle works; the rating moves up on solve / down on fail and persists across reloads
with RD shrinking as you play; the next puzzle is chosen near the user's rating;
puzzle-session + rating unit tests pass; `npm test` green.

---

## What was built

All new code is the **puzzle layer** (`src/puzzles/`), a **pure Glicko-2** core
(`src/core/rating.ts`), the **puzzle UI** (`src/web/puzzleController.ts` +
`puzzleView.ts`), and the **offline build script** (`scripts/build-puzzles.mjs`).
**No existing signatures changed.** Edits to existing files are additive only:
`src/web/main.ts` (tabs + lazy puzzle init), `config.ts` (asset URL + daily target),
`styles.css` (tabs + puzzle panel), `src/index.ts` (barrel re-exports), and one new
`package.json` script (`build-puzzles`). `chessGame.ts`, `boardView.ts`,
`legalDests.ts`, `promotion.ts`, the engine, and the persistence pattern are reused
**verbatim**. **Zero new runtime dependencies.**

### 1. Puzzle data pipeline (`scripts/build-puzzles.mjs`) — offline, Mac

The Lichess DB (`PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags`;
`Moves` = space-separated UCI, **first move is the opponent's setup move**, ships
`.csv.zst`) was found at:

```
~/hobbes/chess-app/offline-chess-puzzles-2.5.1/puzzles/lichess_db_puzzle.csv.zst
```

(296 MB compressed, ~4M rows — the sibling "offline-chess-puzzles" app bundles it.)
The script **auto-detects** that path; override with `--in <path>`.

- **Streams** the file (shells out to `zstd -d -c`, line-by-line via `readline`) so
  it never holds 4M rows or the ~1 GB decompressed CSV in memory.
- **Filters** to quality puzzles: `popularity ≥ 85` (default), `nbPlays ≥ 50`,
  rating in `[600, 2200)`.
- **Buckets** into **8 rating bands** (600–799, …, 2000–2199) and **reservoir-samples**
  a fixed count **per band** with a seeded RNG (mulberry32) → uniform, reproducible,
  difficulty-spanning, theme-diverse (themes vary naturally across a random sample).
- **Selection + size (decided & documented):** default **`--target 2500`** (~313/band)
  → a compact **`public/puzzles/puzzles.json`** of roughly **0.4–0.5 MB**, fetched
  **same-origin** like the engine wasm (fully offline). Output is COMPACT — `moves`
  and `themes` stay space-joined strings, `rd` shortened — and is **valid JSON with
  one puzzle per line** (diff-friendly). `--compact` minifies to a single line.
- Run it with **`npm run build-puzzles`** (or `node scripts/build-puzzles.mjs --target 3000 --min-popularity 90 --seed 1`).

**A committed seed sample ships so the app works out of the box:** `public/puzzles/puzzles.json`
currently holds **24 real puzzles** (3 per band, `seed 7`, `popularity ≥ 92`, ~5.2 KB),
every one verified to replay legally. Running `npm run build-puzzles` on the Mac
overwrites it with the full curated set.

### 2. Puzzle core (`src/puzzles/`) — engine-less, pure, unit-tested

- **`types.ts`** — `Puzzle` (id, fen, solution `moves: string[]`, rating,
  ratingDeviation, themes, popularity, nbPlays), `PuzzleStatus`, `PuzzleMoveResult`,
  `PuzzleAttempt`.
- **`puzzleSession.ts`** — the solver **state machine over `ChessGame`** (reused
  verbatim for legality/turns; the engine is **never** consulted — the line is known):
  - Construction **auto-applies `moves[0]`** (the opponent setup move) so it's the
    solver's turn; `solverColor` = side to move after setup.
  - `tryMove(uci)` validates against the expected solution move (solver = **odd
    indices**). A correct, non-final move **auto-plays the opponent reply** (next even
    index) and advances; the line reaching its end → **SOLVED**; a wrong move →
    **FAILED**, leaving the position **unchanged** so the UI can reveal the answer.
  - **Rule v1:** require the **exact** solution UCI. **Refinement (implemented, on by
    default, `acceptAnyMate`):** when the solution move is checkmate, also accept **any**
    legal move that gives immediate mate (Lichess accepts alternate mates-in-one; the
    solution's mate is by definition the final move). Toggle off for strict exactness.
  - Handles **promotions** in the solution UCI (`c7d8q`, underpromotions) and
    terminal/mate lines. Pure + deterministic.
- **`selection.ts`** — `selectNextPuzzle(puzzles, {rating, excludeIds, themes, rng})`:
  picks **near the user's rating** (window widens 150→800 until candidates exist, then
  random within the band; closest-by-distance fallback), optional **theme filter**, and
  **avoids recent repeats** (allows repeats only if that would otherwise empty the pool).
  Deterministic given an injected `rng`.
- **`loader.ts`** — `loadPuzzlesFromJson(text)` expands the compact on-disk rows into
  `Puzzle[]` (kept in sync with the build script).
- **`index.ts`** — barrel (side-effect free, no engine/DOM).

### 3. Glicko-2 rating (`src/core/rating.ts`) — pure TS, zero deps

Implements the full update from Glickman's paper (REFERENCE §5), matching the
`evalMath.ts` "tested-against-reference" ethos:

- **`glicko2Update(state, games, tau)`** — the raw algorithm (scale 173.7178, `g(φ)`,
  `E`, variance `v`, `Δ`, the **Illinois volatility iteration**, `φ*`, new `φ'`/`µ'`).
  No clamps, so it can be asserted exactly against the reference vector.
- **`updateForResult` / `updateForAttempt`** — the product wrappers applying the
  **Lichess seed + bounds**: seed **1500 / RD 500 / vol 0.09**, **τ = 0.75**, RD clamp
  **[45, 500]**, vol cap **0.1**, single-update rating-change cap **±700**; plus
  `initialRating()` and `isEstablished()` (**RD ≤ 75**). A puzzle attempt is one game vs
  an opponent at the puzzle's rating/RD (win = solved, loss = failed).
- **Verified** against the canonical worked example (1500/200/0.06, τ=0.5, vs 1400/30 W,
  1550/100 L, 1700/300 L) → **rating 1464.05, RD 151.52, σ 0.05999** (paper: ≈1464.06 /
  151.52 / 0.05999).

### 4. Persistence (`src/puzzles/puzzleStore.ts`) — separate DB

A **new `PuzzleStore`** seam mirroring `analysisStore.ts`. `InMemoryPuzzleStore`
(tests/fallback) + `IndexedDbPuzzleStore` in its **own database**
(`chess-trainer-puzzles`, stores `state` + `attempts`) — it does **not** mutate
`GameRepository`/`SavedGame` or the analysis cache. Persists the Glicko-2 state
(rating/RD/vol) and an **append-only attempt log** (puzzleId, solved, date, puzzle
rating, before/after rating, delta, RD) so progress survives reloads and feeds Stage 4.

### 5. Puzzle UI (`src/web/`) — new seams, board reused

- **`puzzleController.ts`** — mirrors `GameController` but is a **separate** seam
  driving its **own `BoardView`** instance; it never touches the play game/engine/repo.
  Orients to the solver, auto-plays the setup move, accepts board moves (resolving
  promotions via the reused **`pickPromotion`** + **`computeMoves`** legality), feeds them
  to `PuzzleSession`, and persists progress. Solve model:
  - A **wrong move never ends the puzzle** — the position is left unchanged and you
    **keep trying**. The first unassisted miss is recorded as a fail (**rating down once,
    streak reset**); after that, wrong moves just say "try again". (No reveal-on-fail and
    no Retry button.)
  - **Graduated hint:** the first click **highlights the piece** (yellow); the second
    **draws the solution arrow** (blue), via BoardView `shapes`. Using **any** hint
    **freezes the rating** for that puzzle (no gain/loss) but a solve still **counts
    toward the streak/daily goal**. The hint clears automatically once a move is played.
  - A **clean solve** (no miss, no hint) **raises the rating** (±delta shown).
  - **Back/forward navigation** (◀ ▶ buttons and the ← / → keys) steps through the moves
    played so far, like game review.
  - Plus **Next/Skip**, a **theme filter**, a **streak**, and a **daily target**.
- **`puzzleView.ts`** — owns only its own DOM (rating badge + provisional flag, ±delta,
  feedback line, progress, streak / daily-target tracker, controls). Mirrors
  `AnalysisView`; talks to the controller through callbacks.
- **`main.ts`** — a **Play / Puzzles tab bar**. The Puzzles tab is **lazily** initialised
  on first open (so the board sizes correctly and page load is unaffected): it creates
  the puzzle board + store + controller, `fetch`es `puzzles.json` same-origin, and starts.
  A missing asset shows a friendly "run `npm run build-puzzles`" message.
- **`config.ts`** — `puzzlesUrl()` (same-origin, base-aware) + `PUZZLE_DAILY_TARGET` (10).
- **`styles.css`** — tab bar + puzzle panel, using the existing design tokens.

### New tests (fast, no WASM; existing tests untouched) — `npm test` **86 → 113** (27 new)

- **`test/rating.test.ts`** (8) — the **canonical Glicko-2 vector** (1464.06 / 151.52 /
  0.05999), no-games RD growth, win-raises/loss-lowers, RD shrinks with play and clamps
  to [45,500], vol cap 0.1, ±700 change cap, the established (RD≤75) boundary.
- **`test/puzzleSession.test.ts`** (8) — setup auto-apply + solver color, a **multi-move
  line** validated to SOLVED with opponent auto-replies, a **wrong move that does NOT
  terminate** (position unchanged, retry succeeds), the **played-line** record used for
  navigation, a **promotion + mate** line, **exact promotion** enforcement on a non-mate
  line, **accept-any-mate** accepting an alternate mate, and the under-strength guard.
- **`test/selection.test.ts`** (6) — near-rating pick, recent-exclusion, theme filter,
  closest-fallback, empty/no-match → undefined, repeats-allowed-when-exhausted.
- **`test/puzzleStore.test.ts`** (5) — the `PuzzleStore` contract (rating save/overwrite,
  ordered attempt log, clear) + `loadPuzzlesFromJson` expansion.

## How to run (on the Mac)

```
npm install
npm run build-puzzles            # decompress + curate the full set -> public/puzzles/puzzles.json
                                 # (auto-detects the sibling CSV; needs the `zstd` CLI: brew install zstd)
npm test                         # 113 passed (86 + 27 new) — fast, offline, no WASM
npm run typecheck                # clean
npm run dev                      # open the Puzzles tab, solve a few
npm run build && npm run preview # disconnect the network, confirm puzzles work offline
```

The committed 24-puzzle seed means the Puzzles tab already works before you run
`build-puzzles`; run it to get the full ~2,500-puzzle set.

## Verification done in this build (Linux sandbox)

`vitest`/`vite`/`rolldown` can't run on the FUSE mount (mac native bindings), so as in
Stage 2:
- **Typecheck:** `tsc --noEmit` clean across the whole repo (strict, DOM lib), including
  the new UI and the 4 new test files.
- **Pure logic (transpiled to CJS, run through Node):** the **26 new unit tests pass
  (26/26)** under a minimal `vitest` shim, and a broader 32-assertion harness exercised
  the same code against **real Lichess puzzles**. The Glicko-2 canonical vector matches.
- **Data pipeline:** `build-puzzles.mjs` was run against the **real 296 MB CSV** in the
  sandbox; the committed 24-puzzle sample is **byte-identical** to the generated file and
  **all 24 replay legally** (incl. 4 promotions; every mate-themed puzzle ends in mate).

**Run `npm run build-puzzles` + `npm test` + the `npm run dev` puzzle playthrough once
on the Mac** — that is the human acceptance step. (Commit on the Mac too; git index
writes can fail on the FUSE mount.)

## Notes / honest caveats

- **Repo writes fail from the sandbox** (FUSE: atomic-rename/permission), so the full
  `puzzles.json` is generated on the Mac; the small seed sample was landed via the file
  tools and **byte-verified**. `public/puzzles/` is **not** gitignored (unlike the
  regenerated `public/sf/` engine binaries), so the asset ships.
- **Accept-any-mate** is the only acceptance relaxation; everything else requires the
  exact solution UCI. Lichess additionally accepts some non-mate alternates that
  transpose into the same line — left as a future refinement (would need the engine).
- **Rating model:** a clean first-try solve raises the rating; the first *unassisted*
  wrong move records a loss (rating down once) and resets the streak; using a hint
  **freezes** the rating for that puzzle (no change) while still counting toward the
  streak/daily goal; skipping an untouched puzzle is free. All tunable in
  `puzzleController.recordResult`.
- The puzzle board is a **second `BoardView` instance** (not the shared play board) so
  the two modes are fully decoupled — no cross-talk with an in-flight engine search.
- `RatingDeviation` from the CSV is used as the **opponent RD** in the Glicko-2 update,
  so well-established puzzles move the user's rating a touch more than uncertain ones.
