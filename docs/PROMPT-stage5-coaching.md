# Next session — Stage 5: Coaching Mode (live in-game coaching)

**Status: SCOPED, not built.** Paste the block below into the next session as the task
prompt. It mirrors the Stage 1–4 briefs: dense, numbered, reuse-don't-rebuild, with
acceptance + env notes. This is the **live** counterpart to Stage 2 analysis — bring the
analyzer's feedback into the board *while you play*, chess.com "Play Coach"-style.

---

Building my offline chess trainer at ~/hobbes/chess-app/chess-trainer. Stage 0 (core),
Stage 1 (play vs engine: chessground + WASM Stockfish in a Web Worker + IndexedDB),
Stage 2 (game analysis: per-move accuracy/classification, board review, best-move arrows,
FEN/PGN export), Stage 3 (puzzles + Glicko-2), and Stage 4 (Progress tab: rule-based
coaching over the attempt log + analysed games, hand-drawn rating chart, per-theme/phase
stats, win/loss-by-opening via a static opening book) are committed and green. `npm test`
is green (161). Everything runs fully offline in the browser.

This session: **Stage 5 — COACHING MODE.** Bring the analysis pillar's feedback LIVE onto
the **Play** tab: a visible **eval bar**, the **centipawn/accuracy change for each move**,
**the best move shown when I slip**, and — when I blunder — a **visual "why"** (a red
arrow showing the refutation, e.g. the capture of the piece I just left hanging), using the
**engine's principal variation** so it works even when the punishment lands a move or two
later. It should also flag **missed opportunities**, not just bad moves — "you had a chance
to play checkmate; want to undo and try to find it?" Reference UX = chess.com "Play Coach"
(eval bar on the left; "??" on a blunder; a red arrow showing the threat; a one-line coach
message; an offer to undo and retry when you miss a much stronger move). Fully offline, NO LLM/web — drive it
with the same Stockfish + the Stage 0/2 eval math; **do not re-derive accuracy/
classification**, reuse `src/core/evalMath.ts` + `src/analysis` VERBATIM.

Read first: docs/SPEC-stage1.md (the play loop, the engine seam, BoardView + its `shapes`
arrows), docs/SPEC-stage2.md (the analyzer: per-position eval, **best-move capture**,
win%→accuracy→classification, the win% sparkline, the green best-move arrow), docs/SPEC-
stage4.md (the coach layer), docs/REFERENCE.md §1 (eval math), AGENTS.md (operating rules).

### Requirements (exactly what I want)
1. **Live eval bar on the Play tab** (like the bar in chess.com Play Coach). White-POV,
   updates every move, handles mate scores. Map eval→bar height via the EXISTING
   `cpToWinPercent`/`scoreToWinPercent` so it agrees with the analysis view.
2. **Per-move centipawn / accuracy change**: after each of MY moves, show the move's cp
   loss (and/or accuracy% + class label best→blunder). Reuse `winPercentToAccuracy` +
   `classifyMove` + the analyzer's `winAfter = 100 − scoreToWinPercent(nextPos)` convention.
3. **Sub-90%-accuracy move → show the best move** I should have played (green arrow at the
   pre-move position + "Best: <SAN>"), exactly like the analysis best-move arrow. (Threshold
   tunable; default accuracy < 90%.)
4. **Blunder → show WHY.** Surface the engine's refutation from its **PV** (principal
   variation), not just a single eval: draw a **red arrow** for the opponent's punishing
   move (e.g. capturing the now-undefended piece), plus a one-line reason. Because the cost
   often shows up a couple of moves later, use the PV (optionally let me step through it),
   not only the immediate reply. **Use analysis depth** so the "why" is trustworthy.
5. **Coach mode toggle** on the Play tab (opt-in: it adds a second engine + per-move
   latency). Optionally auto-on at low strengths.
6. **Missed opportunities — not just bad moves.** When a much stronger move was available —
   especially a **forced mate** or a decisive tactic — point it out even if the move I
   played wasn't a blunder: e.g. "You had a chance to play checkmate." Show the stronger
   move (arrow) and **offer to undo and try to find it** (reuse the play loop's Undo). It
   should celebrate/flag the chance, not stay silent just because my move wasn't a "??".

**Worked example I hit (use as the acceptance scenario):** I played a move that took the
eval from **+4 to −0.15** — my knight on e5 was left undefended; I should have pushed the
e-pawn so my rook defended it. The coach should: swing the eval bar down, mark the move a
**?? blunder**, show the **best move**, and draw a **red arrow showing the refutation**
(the capture of the knight), with a short reason — even though the loss only fully shows up
a move or two later.

**Second example — a missed opportunity (the other side of the coin):** I had a forced mate
available (the eval bar read **"M8"**) but played a different move. The coach flagged it —
*"Can I show you something? You had a chance to play checkmate. Want to undo and try to find
it?"* — and offered an undo. The coach should recognise the **missed mate / decisive tactic**,
show the stronger move, and let me retry — it must not stay silent just because the move I
played wasn't a blunder.

### Job
1. **Pure live-feedback core (add to `src/coach/`, engine-less, unit-tested).** A pure
   `liveMoveFeedback(scoreBefore, scoreAfter, bestMoveUci, pv, mover)` →
   `{ winBefore, winAfter, cpLoss, accuracy, classification, bestMoveUci, refutationUci?, missedOpportunity? }`,
   reusing `evalMath` verbatim.
   - **refutation** = the first opponent move of the PV from the post-move position (the move
     that punishes a blunder); expose enough of the PV to optionally step through it.
   - **missedOpportunity** (`'mate' | 'winning'`) = `scoreBefore` (the pre-move position eval,
     i.e. the value of best play for me) was a **mate-for-mover** or a decisive advantage, but
     my move gave a meaningful chunk back — this drives the "you had a chance to …" message
     and the retry offer. A missed mate reads off `scoreBefore.mate`; a missed win off a large
     `scoreBefore` cp that `winAfter` didn't keep.
   Deterministic + tested against scripted scores/PVs (incl. a missed-mate case).
2. **Single-position eval helper (reuse the analyzer/engine).** `evaluatePosition(fen,
   engine, depth) → { score, winWhite, bestMoveUci, pv }` built from `UciEngine.bestMove()`
   + `engine.lastInfo` (which already carries `score` and the `pv`). Don't fork the
   analyzer's math; share it. Full strength (`limitStrength:false, skillLevel:20`).
3. **CoachController + UI on the Play tab.** An eval-bar element + a coach-feedback line +
   the green best-move / red refutation arrows on the EXISTING play `BoardView` (reuse
   `BoardShape`/`setAutoShapes`; brushes green/red). A "Coach mode" toggle in `main.ts`.
   After each human move (and optionally each engine reply) it runs `evaluatePosition` and
   renders feedback. On a **missed opportunity**, show the "you had a chance to …" message +
   the stronger-move arrow + a **"Try to find it"** action that undoes the move and
   re-prompts (reuse the play loop's Undo; optionally validate the retry like a mini-puzzle).
   New web seam — do NOT overload `GameController`/`AnalysisView`.
4. **Config knobs** (like evalMath's constants): `COACH_LIVE_DEPTH` (live-bar depth, can be
   shallower than `ANALYSIS_DEPTH` for speed), `COACH_BESTMOVE_ACCURACY = 90`, reuse
   `CLASSIFICATION_THRESHOLDS` for the blunder cutoff.
5. **Reuse, don't rebuild (don't change signatures):** `src/core/evalMath.ts`,
   `src/analysis/*` (eval/best-move/PV extraction, types), `src/engine/*` (UciEngine +
   WorkerUciTransport), `src/web/boardView.ts` (`shapes`), the `gameController` play loop
   (hook the coach eval AFTER the human move and AFTER the engine reply — never mid-search).
   New seams only: the live-feedback core in `src/coach/`, the eval-helper, and the Coach UI.
6. **Constraints:** offline, NO LLM/web API, no new runtime deps. Keep `npm test` green and
   ADD deterministic tests for the PURE pieces (bar mapping, cpLoss/accuracy/classification
   from scripted scores, refutation-move extraction from a scripted PV) using the existing
   `test/helpers/scriptedAnalysisEngine.ts`. Live engine behaviour is the manual browser
   acceptance step (engine evals aren't bit-deterministic across depth/runs). Works offline
   after `vite build`.

### Watch out (lessons carried over — read before building)
- **A second, full-strength engine.** Coaching needs a FULL-STRENGTH eval engine separate
  from the *limited-strength* play engine. Decide up front: a **dedicated coach worker**
  (simplest; more memory) vs **reusing the play engine** (reconfigure to full strength per
  eval — setoption churn, and it can't be mid-search). Recommended: a dedicated coach
  worker, **pre-warmed** when Coach mode is toggled on / the game starts so the first
  eval is responsive.
- **Latency.** Depth-16 per move on the single-threaded WASM build takes seconds and will
  stall the game feel. Evaluate **asynchronously** (let play continue; update the bar/arrows
  when the result arrives), use a shallower `COACH_LIVE_DEPTH` for the bar and full depth
  only for the blunder "why", and/or cap with a movetime. Consider evaluating only MY moves.
- **POV bookkeeping.** Engine score is side-to-move POV; the eval bar is White POV; accuracy
  is mover POV. Reuse the analyzer's exact conventions. The PV's first move (from the
  post-move position) is the opponent's refutation; convert UCI→SAN via `ChessGame` for the
  label and use `from/to` for the red arrow.
- **Sequencing.** Never start a coach eval while the play engine is mid-search for its reply;
  order them (human move → coach eval of the human move → engine computes reply → optional
  coach eval of the reply).

### Optional / stretch
- **Retry the blunder** (take back + replay) like chess.com's Continue/Retry — the play loop
  already has Undo, so this is small.
- A coach **message line** ("Careful — your knight on e5 is undefended.") derived from the
  refutation (a captured piece on the PV's first move).
- Persist a per-game accuracy onto `SavedGame` so the Progress tab's game stats populate
  without a separate Analyze pass.

### Acceptance
With Coach mode on, the **+4 → −0.15** blunder above: the eval bar swings down, the move is
flagged **?? blunder**, the **best move** is shown (green arrow + SAN), and a **red arrow**
shows the **refutation** (the capture of the hanging knight) with a one-line reason — even
when the punishment is a move or two later (taken from the PV). A sub-90% non-blunder shows
the best move. Conversely, in the **"M8"** position above, the coach flags the **missed mate**
("you had a chance to play checkmate"), shows the move, and offers undo/retry — it does not
stay silent just because the move played wasn't a blunder. The eval bar tracks the game
throughout. The pure feedback/refutation/missed-opportunity logic has unit tests; `npm test`
green; works offline after `npm run build`.

### Environment notes (carry over)
The repo is on a FUSE mount where `npm install`, `vite build`, and git index writes can fail
— run npm/vite/git on the Mac. vitest/rolldown won't run in the sandbox; verify pure logic
by transpiling the relevant `.ts` to CommonJS (`node node_modules/typescript/bin/tsc
--module commonjs --moduleResolution node --outDir /tmp/...`) and running assertions through
Node (use `NODE_PATH=<repo>/node_modules` when a test pulls in chess.js). The sandbox shell
CANNOT write into the repo on the FUSE mount — create/modify files with the editor/file
tools and verify by reading them back. `tsc --noEmit` runs fine in the sandbox for a full
typecheck. Clear any stale `.git/index.lock` before committing; do the browser playthrough +
`npm test` + `npm run build` offline check on the Mac as the human acceptance step.
