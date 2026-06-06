# SPEC — Stage 4: Progress tracking + Coaching

**Status:** COMPLETE (pending the Mac-side acceptance run). Turn the data the first
three pillars already persist — puzzle attempts, saved games, cached analysis reports —
into a **progress dashboard** and **rule-based coaching** that names the user's
weaknesses and says what to train. This closes the loop: **play ✓ / analyse ✓ /
train ✓ → know where you're weak and drill it.** Stage 0–3 are untouched and stay green.

**Goal (from the build plan):** aggregate (don't recompute) the existing local data
into a rating curve, per-theme + per-phase strength/weakness stats, and a short ranked
list of coaching insights — each with a "Drill this" action that opens the Puzzles tab
pre-filtered to the weak theme. Fully **offline**, **NO LLM / web API**: coaching is
deterministic analytics in the same "tested-against-reference" pure-core ethos as
`evalMath`/`rating`.

**Acceptance:** after solving some puzzles (incl. a couple missed across ≥2 themes) and
analysing ≥1 game, the Progress tab shows a rating curve matching the attempt log,
correct per-theme solve rates, a ranked weakness list, and ≥1 coaching insight whose
"Drill this" opens the Puzzles tab filtered to that theme; stats derive live and update
after a new attempt; coach/stats unit tests pass; `npm test` green.

---

## What was built

All new code is the **coach layer** (`src/coach/`, pure + engine-less + DOM-less) and
the **Progress UI** (`src/web/progressController.ts` + `progressView.ts`). **No existing
signatures changed.** Edits to existing files are additive only: two optional fields on
`PuzzleAttempt` + the `PuzzleStore` IndexedDB version bump (back-compat), the
`PuzzleController` attempt-write wiring, `main.ts` (a third tab + lazy Progress init +
the drill handler), `styles.css` (progress panel, existing tokens), and the
`src/index.ts` barrel. `ChessGame`, `BoardView`, `GameRepository`, `AnalysisStore`,
`PuzzleStore`, `rating.ts`, `evalMath.ts`, and the analysis types are reused
**verbatim**. **Zero new runtime dependencies.**

### 1. Additive puzzle-attempt fields (back-compat) — `src/puzzles/`

`PuzzleAttempt` couldn't support per-theme/assisted coaching because it never stored the
puzzle's themes. Added (additively, **optional** so the field can be absent on old rows):

- **`themes?: string[]`** — the solved puzzle's theme tags, copied at attempt time.
- **`assisted?: boolean`** — whether a hint was used (the rating was frozen).

`PuzzleController.recordResult` now writes both (`puzzle.themes` + the existing
`this.assisted` flag are already in hand there). The `PuzzleStore` IndexedDB version was
bumped **1 → 2**; the object stores are unchanged, so the upgrade is a no-op for existing
DBs and **back-compat is handled at READ time**: a new `normalizeAttempt` fills a missing
`themes`/`assisted` with `[]`/`false` in **both** `InMemoryPuzzleStore.listAttempts` and
`IndexedDbPuzzleStore.listAttempts`, so legacy rows **never throw and read as `[]`/`false`**.
Making the fields optional (not required) keeps the untouched `test/puzzleStore.test.ts`
type-checking and green. No new DB; all progress stats are **derived at read time**.

### 2. Stats + coaching core (`src/coach/`) — pure, engine-less, unit-tested

- **`types.ts`** — `RatingPoint`, `ThemeStat`, `RatingBandStat`, `PhaseStat`,
  `Confidence`, `PuzzleStats`, `GameStats`, `GameTrendPoint`, `StrengthStat`,
  `Weakness`, `CoachingInsight`, `ProgressSnapshot`, `AnalyzedGame`, `SnapshotInput`.
  Puzzle solve-rates are **fractions [0,1]**; chess accuracies are **percent [0,100]**
  (same scale the analyzer emits) — documented per field.
- **`thresholds.ts`** — every tunable lives here, evalMath-style (`COACH_THRESHOLDS`,
  `PHASE_THRESHOLDS`), each with a justifying comment. See **Documented thresholds** below.
- **`puzzleStats.ts`** — pure fns over `PuzzleAttempt[]`: `ratingSeries` (from
  `ratingAfter`+`at`, chronological), `overallSolveRate`, `themeStats` (an attempt feeds
  **every** one of its themes; sorted worst-first), `weakestThemes` (themes ranked
  worst-first **but only those with ≥ `minThemeAttempts` attempts**, so a tiny sample
  never tops the list), `bandStats` (200-pt rating bands), `streaks` (current trailing +
  best run), and `computePuzzleStats` (the bundle). Empty log → all zeros, no throw.
- **`gameStats.ts`** — pure fns over `AnalyzedGame[]` (a `GameReport` + its `SavedGame`
  meta). **Reuses `evalMath.harmonicMean` + `averageCentipawnLoss` and the analyzer's
  per-move numbers VERBATIM** — accuracy/classification/cpLoss are *not* re-derived, only
  grouped. `nonPawnMaterial(fen)` parses material straight from the FEN placement field
  (no chess.js); `phaseOf(ply, fenBefore)` is the documented phase cut; `phaseStats`
  buckets the **user's** moves per phase (harmonic-mean accuracy, ACPL, class counts);
  `accuracyTrend` (per game, by `playedAt`); `vsStrength` (grouped by engine Elo);
  `computeGameStats` (the bundle, incl. blunder/mistake/inaccuracy **per-game rates** and
  overall user accuracy). Zero analysed games → safe defaults.
- **`coach.ts`** — `diagnoseWeaknesses` synthesises a ranked `Weakness[]` from **both**
  sources, each emitted only when it crosses its documented threshold; `rankWeaknesses`
  orders worst-first by **severity × confidence-weight** (low 0.4 / medium 0.75 / high 1),
  tie-broken by sample size then id (fully deterministic). `buildInsights` turns the top
  `maxInsights` weaknesses into prioritised `CoachingInsight`s (title + evidence +
  recommendation + `drillTheme`); with data but no flagged weakness it emits one honest
  "no clear weakness yet" note (pointing at the lowest trusted theme) rather than
  inventing an alarm. `buildProgressSnapshot(input)` is the single entry the UI calls;
  it reuses **`rating.ts`** (`initialRating`, `isEstablished`) for the headline rating /
  provisional flag. **No `Date.now`, no RNG** → same data ⇒ same coaching.
- **`index.ts`** — barrel (side-effect free; no engine/DOM/deps). Re-exported from
  `src/index.ts`.

### 3. Progress UI (`src/web/`) — new seams, nothing overloaded

- **`progressController.ts`** — mirrors GameController/PuzzleController. Reads
  `PuzzleStore` (rating + attempts), `GameRepository.list()`, and the `AnalysisStore`
  cache, folding them into a `ProgressSnapshot` via `src/coach`. Analysed games are
  gathered **exactly as required**: enumerate `GameRepository.list()` ids →
  `AnalysisStore.get(id)`, and **skip** games with no cached report, a stale report
  schema (`version !== ANALYSIS_REPORT_VERSION`), or a `pgn` mismatch — `AnalysisStore`'s
  signature is **not** changed. Every source is read defensively (a failing store
  contributes nothing). `refresh()` re-derives everything live.
- **`progressView.ts`** — owns only its own DOM, talks out through an `onDrill(theme)`
  callback. Renders: a **header dashboard** (rating ± provisional, puzzles solved, current
  + best streak, games played, overall game accuracy); a **hand-drawn SVG rating-over-time
  chart** (reusing the analysisView `.spark-line`/`.spark-marker` technique — **no chart
  library**, with min/max axis labels and an end marker); the **prioritised coaching
  insights**, each with a **"Drill this"** button when it carries a `drillTheme`; and
  **per-theme + per-phase strength/weakness lists** with solve-rate/accuracy bars
  toned weak/ok/strong and a **confidence note** (sample size + low/medium/high). Empty &
  sparse states are handled (friendly prompts, never a crash).
- **`main.ts`** — a third **Progress** tab beside Play / Puzzles. The puzzle `PuzzleStore`
  was hoisted to module scope so the Puzzles and Progress tabs share it; `initPuzzles` and
  `initProgress` are each cached one-shot promises (lazy, so page load is unaffected and
  the board sizes correctly). Opening Progress derives live on first open and **re-refreshes
  on every later open** (so a new attempt shows immediately). **"Drill this"** →
  `drillTheme(theme)` switches to the Puzzles tab, awaits puzzle readiness, then calls the
  reused **`PuzzleController.setTheme(theme)`** — closing play/analyse → train.
- **`styles.css`** — a `progress` panel built from the **existing design tokens**
  (dashboard cards, the SVG chart, insight cards, stat-row bars, shared weak/ok/strong
  tones).

## Documented thresholds (all tunable in `src/coach/thresholds.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `minThemeAttempts` | **4** | min attempts before a theme can be **ranked** as a weakness (stops tiny samples topping the list) |
| `weakThemeSolveRate` | **0.65** | solve-rate strictly `<` this ⇒ weak theme |
| `strongThemeSolveRate` | **0.85** | solve-rate `≥` this ⇒ strong theme |
| `highConfidenceThemeAttempts` | **10** | `≥` ⇒ theme confidence "high" (≥`minThemeAttempts` ⇒ "medium"; below ⇒ "low") |
| `minPhaseMoves` | **8** | min user moves before a phase is judged |
| `weakPhaseAccuracy` | **75** | phase accuracy% strictly `<` this ⇒ weak phase |
| `strongPhaseAccuracy` | **90** | phase accuracy% `≥` this ⇒ strong phase |
| `highConfidencePhaseMoves` | **20** | `≥` ⇒ phase confidence "high" |
| `highBlunderRate` | **1.0** | mean user blunders/game `≥` this ⇒ a "frequent blunders" weakness |
| `minGamesForBlunderRate` | **1** | min analysed games before the blunder rate is judged |
| `maxInsights` | **4** | cap on emitted insights (UI shows the top 2–4) |

**Phase cut (`PHASE_THRESHOLDS`, applied in `phaseOf`):** material is counted in standard
points from the FEN (Q9 R5 B3 N3; kings + pawns excluded; full board = 62).
1. **endgame** if non-pawn material (both sides) `≤ 14` — checked **first**, so a
   stripped-down board is an endgame even if it arises early (≈ queens off, at most a
   rook + a minor each);
2. else **opening** if `ply ≤ 20` (the first 10 full moves, the development phase);
3. else **middlegame**.

## New tests (fast, no WASM; existing tests untouched) — `npm test` **113 → 141** (28 new)

- **`test/puzzleStats.test.ts`** (10) — rating series ordered by time & reading
  `ratingAfter`/`rdAfter`; per-theme solve-rate (an attempt feeds each of its themes);
  the **min-sample threshold** (a 0% theme below `minThemeAttempts` is excluded from
  `weakestThemes` but still listed low-confidence); confidence tiers; 200-pt bands;
  current/best streaks; the `computePuzzleStats` bundle + chronological series; empty-log
  and legacy-row (no `themes`) safety.
- **`test/gameStats.test.ts`** (8) — `nonPawnMaterial` and the documented `phaseOf` cut
  (material-first, then ply, with boundaries); `phaseStats` bucketing **user moves only**,
  harmonic-mean accuracy, blunder counts and confidence; `humanColor` respected (black);
  `accuracyTrend` ordering; `vsStrength` grouping; `computeGameStats` rollups (blunders/
  game, harmonic overall accuracy); zero-game safety.
- **`test/coach.test.ts`** (10) — theme weakness fires **exactly** on the documented
  threshold (incl. the strict-`<` boundary at 0.65); the min-sample rule; phase + blunder
  weaknesses from a scripted game (both drilling `endgame`, ranked by severity×confidence);
  the `minPhaseMoves` floor; the "no clear weakness" note with a drill target; the
  `maxInsights` cap (worst-first); `buildProgressSnapshot` produces a drillable insight + a
  rating curve matching the log; provisional/established rating; the Lichess-seed default;
  empty-input safety; and **determinism** (identical input ⇒ identical output).

## How to run (on the Mac)

```
npm install
npm test                          # 161 passed (113 + 28 coach/stats + 20 openings) — offline, no WASM
npm run typecheck                 # clean
npm run dev                       # solve puzzles (incl. a few misses across ≥2 themes),
                                  # Analyze ≥1 saved game, open Progress; click "Drill this"
npm run build-openings            # (optional) full ECO opening set → public/openings/openings.json
npm run build && npm run preview  # disconnect the network, confirm Progress works offline
```

## Verification done in this build (Linux sandbox)

`vitest`/`vite`/`rolldown` can't run on the FUSE mount (mac native bindings), so as in
Stages 2–3:

- **Typecheck:** `tsc --noEmit` **clean** across the whole repo (strict, DOM lib),
  including the new coach core, the Progress UI, and the 3 new test files.
- **Pure logic (transpiled to CJS, run through Node):** all **48 Stage-4 unit tests pass
  (48/48)** under a minimal `vitest` shim (28 coach/stats + 20 openings) — the rating
  series, per-theme/per-band stats, the phase cut + per-phase accuracy, the weakness
  ranking + its min-sample threshold, opening detection + win/loss aggregation, and that
  insights/recommendations fire **exactly** on the documented thresholds. (The openings
  tests load `chess.js` from the repo `node_modules` via `NODE_PATH`.)
- **Store back-compat:** transpiled `puzzleStore.ts` and confirmed a legacy attempt (no
  `themes`/`assisted`) reads back as `[]`/`false` while new rows preserve their values and
  ordering is kept.

**Run `npm test` + the `npm run dev` Progress playthrough once on the Mac** — that is the
human acceptance step. (Commit on the Mac too; git index writes can fail on the FUSE
mount — clear any stale `.git/index.lock` first.)

## Notes / honest caveats

- **Coaching is rule-based and offline.** No LLM, no network — just documented thresholds
  over local data. Retuning is a one-file edit (`thresholds.ts`).
- **Harmonic-mean accuracy** (reused verbatim from the analyzer) is dominated by the worst
  moves: a single 0%-accuracy move zeroes a phase's accuracy, exactly as Lichess-style
  per-game accuracy behaves. Kept for consistency rather than re-derived.
- **Aggregation is over analysed games only.** Games the user never clicked *Analyze* on
  contribute to "games played" but not to accuracy/phase stats — by design (the brief), and
  with no change to `AnalysisStore`. A cached report is used only if its schema version and
  `pgn` still match the saved game.
- **"Drill this" targets** are real Lichess themes: theme weaknesses drill their own theme
  (which by definition exists in the user's attempt history), and phase weaknesses drill the
  matching `opening`/`middlegame`/`endgame` theme. If the curated set lacks that theme the
  Puzzles tab shows its usual "no puzzles match" message (run `npm run build-puzzles` for
  the full, theme-diverse set). The puzzle theme dropdown reflects the drilled theme only
  when it's one of the top-N filter options — cosmetic; the filter itself always applies.
- **Optional `PuzzleAttempt` fields** (vs. required) are deliberate: it models "absent on
  legacy rows" precisely and keeps the untouched store test green; the store normalises on
  read so all consumers see concrete `[]`/`false`.
- **Stretches not taken** (left as future work, all noted in the brief): activity
  heatmap/calendar, user-set goals, a "review your worst blunders" jump onto the analysis
  board, spaced-repetition re-queue of missed puzzles, and an exportable progress report.

---

## Stretch delivered: win/loss by opening + opening coaching

Added after the first acceptance pass (user request): name the opening each game reached
and show **win/loss by opening**, plus an opening-based coaching insight. Fully offline,
deterministic — opening ID is a **static book lookup**, no LLM/web.

### New seam: `src/openings/` (pure; uses the ChessGame core only)
- **`data.ts`** — a committed **seed book** (~60 openings) covering every common family +
  popular mainlines (Scotch, Scandinavian, French incl. Winawer, Sicilian incl. Najdorf/
  Dragon, Ruy Lopez, Italian, Caro-Kann, QGD/Slav/QGA, Nimzo/QID/KID/Grünfeld, English,
  Réti, London, Dutch, …). Names follow common usage; ECO codes are the standard ranges.
  Ships in-repo so opening naming works out of the box, like the puzzle seed.
- **`book.ts`** — `OpeningBook` builds a `Map<EPD, OpeningId>` by replaying each line via
  `ChessGame` (the single chess.js seam); `epdOf` = the first four FEN fields (counters
  dropped). `detectFromPgn` / `detectFromSans` return the **deepest** named position a game
  reaches, so a deep mainline is named precisely while a game that leaves book early still
  gets its **family** name, and transpositions match by position. Pure + deterministic.
- **`loader.ts`** — `loadOpeningsFromJson` (+ `normalizeOpeningMoves`) expands the optional
  full asset (accepts Lichess-style `pgn` or bare `moves`).
- **`scripts/build-openings.mjs`** (Mac, Node built-ins only) — converts the Lichess
  `chess-openings` TSVs (CC0) into `public/openings/openings.json` (the full ~3,500-line
  ECO set). The app **prefers this asset** when present (fetched same-origin) and falls
  back to the seed otherwise. New `npm run build-openings` script.

### Coach additions (still pure, no chess.js)
- `OpeningRef` / `GameOpeningRecord` / `OpeningStat` types; `SnapshotInput.gameOpenings?`
  and `ProgressSnapshot.openings`.
- **`openingStats.ts`** — `computeOpeningStats` folds finished games into per-opening
  **W / L / D + score** `(wins + ½·draws)/games` from the **user's** point of view
  (`humanOutcome`), with mean accuracy over analysed games; sorted most-played first.
  Detection runs OUTSIDE the coach (in the controller), so the coach stays chess.js-free.
- `coach.ts` adds an **opening weakness** (a line scoring `< weakOpeningScore` over
  `≥ minOpeningGames`) to the ranked list + a "Patch up your <opening>" insight (no drill
  theme — puzzles filter by tactic, not opening; the fix is study/review). New thresholds:
  `minOpeningGames = 3`, `weakOpeningScore = 0.45`, `strongOpeningScore = 0.55`.

### UI
`ProgressController` builds the book lazily (asset → seed fallback), detects each finished
game's opening, attaches analysed accuracy, and passes the records to the snapshot.
`progressView` renders a **"By opening"** section: per-opening score%, `gamesW/L/D`, and
accuracy, toned weak/ok/strong. Reuses the existing stat-row styles.

### New tests (offline, no WASM) — `npm test` **141 → 161** (20 new)
- **`test/openings.test.ts`** (12) — seed integrity (every line legal SAN, all positions
  distinct); `epdOf`; detection of Scotch / Scandinavian / **French Winawer** (deepest at
  ply 6) / Najdorf (deep exact) / family fallback / **transposition** (Four Knights by
  position) / unknown + empty; PGN detection; loader round-trip.
- **`test/openingStats.test.ts`** (8) — `humanOutcome`; W/L/D + score aggregation from the
  user POV (incl. black wins, skipping unrecognised + unfinished); accuracy averaging;
  the opening-weakness threshold (fires at `≥ minOpeningGames` + `< weakOpeningScore`, with
  **no** drill theme; suppressed below the game floor); snapshot integration; empty-safe.

### Caveats
- The **seed** names families and common mainlines; for fine-grained variation names run
  `npm run build-openings` to ship the full ECO set (the app then prefers it).
- Opening detection keys on the **exact position** (EPD incl. castling/en-passant), matching
  Lichess's approach — transpositions that differ only by en-passant square are treated as
  distinct positions, which is standard.
- Opening insights have **no "Drill this"**: puzzles are filtered by tactical theme, not by
  opening, so the actionable advice is to study/replay games in that line rather than do
  tactics reps. (Wiring the Lichess puzzle `OpeningTags` into the puzzle pipeline would
  enable opening-filtered drilling — a future enhancement.)

---

## Next up (scoped, not built)

- **Stage 5 — Coaching Mode** (live in-game coaching: eval bar, per-move cp/accuracy, the
  best move when you slip, a red "why" arrow from the engine PV on a blunder, and
  missed-opportunity prompts — "you had a chance to play checkmate; undo and try to find
  it?"). Full paste-ready brief: **docs/PROMPT-stage5-coaching.md**.
