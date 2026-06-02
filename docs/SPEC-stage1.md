# SPEC — Stage 1: Play vs Engine

**Status:** COMPLETE. Engine core (previous session) + board UI and game
persistence (this session) are landed. You can play full games vs the engine at
adjustable strength in the browser, checkmate/draw is detected, and games persist.
Stage 0 is untouched and stays green. See "Delivered this session" below for the
UI/persistence build and the acceptance checklist.

**Goal of the full stage (from the build plan):** wire a real Stockfish behind a
swappable engine interface, drive a `chessground` board, play a full game vs the
engine at adjustable strength, detect checkmate/draw, and persist the game.
**Acceptance:** a full game at ≥3 strengths; engine makes **zero illegal moves**;
strengths feel clearly different; works offline after build.

This session delivers the part that is fiddly and needs a live engine — the
engine layer — and gates it with automated tests. The board, the visible
playthrough, and persistence come next.

---

## What was built (this session)

All new code is under `src/engine/` and `test/`. Nothing in `src/core/` or the
existing `test/*.test.ts` was modified.

- **`src/engine/types.ts`** — `UciTransport`, the line-based seam to *some* UCI
  engine, plus `EnginePosition`, `GoLimits`, `UciEngineOptions`. Swapping WASM ↔
  native at Stage 6 is just a new `UciTransport`; nothing above it changes.
- **`src/engine/strengthCommands.ts`** — `buildStrengthCommands(EngineOptions)`,
  a **pure** translation of Stage 0's `eloToEngineOptions` output into the exact
  `setoption` lines (REFERENCE §3): always `Threads 1`, then either
  `UCI_LimitStrength`+`UCI_Elo` or `Skill Level`, then `MultiPV`.
- **`src/engine/uciEngine.ts`** — `UciEngine`, the transport-agnostic driver:
  `init` (uci→uciok, isready→readyok), `newGame`, `setStrength`, `bestMove`,
  `dispose`. It reuses the Stage 0 helpers verbatim for every line on the wire
  (`buildPositionCommand`, `buildGoCommand`, `parseInfoLine`, `parseBestMove`)
  and races every wait against a timeout. It imports no engine, no DOM, no Node.
- **`src/engine/nodeEngine.ts`** — `NodeUciTransport` + `createNodeEngine()`:
  drives a real Stockfish (the `stockfish` npm package) headlessly. `stockfish`
  is loaded with a **dynamic import**, so importing the library never pulls a
  ~10 MB engine into a bundle/process — it loads only when `createNodeEngine()`
  is called. This is the Node twin of the browser Web Worker transport to come.
- **`src/engine/stockfish.d.ts`** — minimal ambient types for the `stockfish`
  package (it ships none), so the repo typechecks before `npm install` too.
- **`test/helpers/fakeTransport.ts`** — a scripted `UciTransport` double + a
  `scriptedEngine()` responder for deterministic, engine-free tests.
- **`test/engine.test.ts`** — deterministic unit tests (no WASM): exact
  handshake, the strength `setoption` sequence for both bands, bestmove
  parsing, `lastInfo` capture, default movetime, timeout rejection, dispose.
- **`test/integration/engineLegal.itest.ts`** — the real-engine gate (separate
  vitest config so it never slows `npm test`): loads Stockfish and asserts every
  engine reply is legal across strengths.

## How to run

```
npm install            # adds stockfish to the lockfile; pulls your platform binaries
npm run typecheck      # tsc --noEmit — clean
npm test               # Stage 0's 43 + the new engine unit tests (fast, no WASM)
npm run engine:check   # real Stockfish: zero-illegal-move gate across strengths
```

## Verification done in this build

- **Typecheck:** clean across the whole repo (engine + tests included).
- **Engine logic:** all deterministic checks pass (handshake, exact strength
  command sequence, bestmove parse for startpos/moves/fen, default movetime,
  timeout, dispose).
- **Real engine, zero illegal moves:** played games at 800 / 1200 / 1600 against
  a random-legal opponent (36 engine moves total) — **0 illegal**. Strength
  options confirmed applied (Skill 2, Skill 6, UCI_Elo 1600), and the three
  settings chose different opening moves.

These were verified in the Linux sandbox by compiling to CommonJS and running the
same assertions through Node (vitest's native build deps don't install cleanly in
the sandbox, but they will on macOS). **Run `npm test` and `npm run engine:check`
once on your Mac to confirm green in the real runner** — the test files are
type-checked and assert exactly what the sandbox harness verified.

### Strength note (honest)
At a short, fixed think time the three strengths reach similar search depth/nodes
in the asm.js build and differ mainly in move *selection* — expected, because
engine "Elo" is CCRL-anchored, not human (REFERENCE §3). The clear "feels
different" experience shows over full games at real movetimes in the browser, and
is the human acceptance step for the UI session. Consider injecting extra
randomness at the lowest ratings later if it still feels too sharp.

## Engine builds (why asm.js here)

The `stockfish` package ships several builds. The Node gate uses **`'asm'`** (pure
JS, self-contained, loads anywhere). The WASM builds (`lite-single`, `lite`) need
their NNUE binary assembled by the package's postinstall, which can be flaky in a
restricted sandbox — that's a packaging detail, not a browser problem. In the
browser (UI session) we'll serve a WASM build from a Web Worker via Vite.
`createNodeEngine(build)` takes the build keyword if you want to try
`'lite-single'` on a healthy install.

---

## Delivered this session (UI + persistence)

The vertical slice that makes Stage 1 *visible and playable*. All new code is the
UI/persistence layers + one new engine transport; **nothing in `src/core/` or
`src/engine/{types,uciEngine,strengthCommands,nodeEngine}.ts` changed signatures**,
and the existing tests are untouched.

- **Board UI** — vanilla TS + Vite + `chessground` (no framework), as recommended.
  - `index.html` + `vite.config.ts` (Vite entry; `base: './'` for portable assets).
  - `src/web/boardView.ts` — the only file that touches chessground's types; the
    rest of the app speaks plain squares (`"e2"`) and a `Map<string,string[]>` of
    legal destinations.
  - `src/web/legalDests.ts` — pure `fen -> { dests, isPromotion, inCheck }` via
    chess.js, *view-only* (ChessGame stays the single source of truth for state;
    both derive from the same FEN each turn, so they can't drift).
  - `src/web/gameController.ts` — orchestrates ChessGame + UciEngine + board +
    repo. Adjustable strength via `eloToEngineOptions`; game-over via
    `ChessGame.result()` (checkmate/draw surfaced in the status line).
  - `src/web/promotion.ts` — minimal promotion picker (Q/R/B/N).
  - `src/web/main.ts` + `styles.css` — DOM, strength/side controls, status,
    saved-games list.
- **`WorkerUciTransport`** (`src/engine/workerEngine.ts`) — the browser twin of
  `NodeUciTransport`: a classic Web Worker running a WASM Stockfish build, wired
  via `postMessage`/`onmessage`/`terminate`, implementing the **existing**
  `UciTransport` interface. `createWorkerEngine(url)` mirrors `createNodeEngine`.
  `UciEngine`, `buildStrengthCommands`, `eloToEngineOptions`, and `ChessGame` are
  reused unchanged. Exported from `src/engine/index.ts`.
- **Engine build & serving** — `scripts/copy-engine.mjs` copies the prebuilt
  `stockfish-18-lite-single.{js,wasm}` (and the threaded `lite` build, for later)
  from `node_modules/stockfish/bin` into `public/sf/` (git-ignored), so Vite serves
  them verbatim. The `.wasm` sits next to its `.js` because the nmrugg worker
  derives the wasm URL from its own filename. **lite-single is single-threaded → no
  SharedArrayBuffer → no COOP/COEP headers needed.** Wired into `predev`/`prebuild`.
- **Persistence** (`src/persistence/`) — a `GameRepository` interface
  (save/update/list/get/delete/clear) over **raw IndexedDB**
  (`IndexedDbGameRepository`, no new dependency), plus an `InMemoryGameRepository`
  used for the contract tests and as a fallback. Stores PGN + result + strength
  played + date + human color + an `inProgress` flag. Swappable to SQLite behind
  the same interface at S6.
  - **Finished games** auto-save when the board reaches a terminal position; they
    show in the saved-games list with **View** (replays the final position).
  - **Save / Resume / Resign** (added after first playtest): **Save** keeps the
    current unfinished game (`inProgress: true`); **Resume** reloads it into a
    *playable* state from the list; **Resign** concedes (engine wins) and persists
    it as finished. Starting or resuming another game auto-preserves the current
    unfinished one via `update()` (upsert by id), so a game is never silently lost.
    Delete / Clear all manage the list.
- **Zero-illegal-move gate (in the UI)** — every engine `bestmove` is applied to
  `ChessGame`; if `move()` returns false the move is rejected, play halts, and the
  illegal move + FEN are shown loudly (see `engineMove()` in `gameController.ts`).

### New unit tests (kept fast, no WASM; never touched existing tests)
- `test/workerTransport.test.ts` — WorkerUciTransport mapping + a full
  handshake→bestmove driven through the seam with a scripted fake worker.
- `test/legalDests.test.ts` — dests counts, promotion flagging, check handling.
- `test/gameRepository.test.ts` — the GameRepository contract via InMemory.

New deps added this session: `vite`, `chessground` (WASM `stockfish` was already a
dependency). Total: `npm test` = **67 passed** (Stage 0's 43 + 12 engine units + 12
new). The IndexedDB store is exercised by the manual browser run, not `npm test`.

## How to run the UI (on the Mac)

```
npm install            # adds vite + chessground; pulls the stockfish builds
npm run dev            # predev copies the engine into public/sf, then Vite serves
# open the printed http://localhost:5173 URL
```

Offline production build + serve:
```
npm run build          # prebuild copies the engine; outputs a self-contained dist/
npm run preview        # serve dist/ locally — disconnect from the network to prove offline
```

`dist/` after build is fully self-contained: `index.html`, one JS + one CSS bundle,
and `sf/stockfish-18-lite-single.{js,wasm}` (+ the `lite` build). No network at
runtime — the engine loads the local `.wasm` from same-origin.

## Acceptance checklist (the human step)

- [ ] Play a **full game** vs the engine at **800**, **1200**, and **1600** Elo
      (pick each in the Strength dropdown, click New game).
- [ ] **Zero illegal engine moves** — if the engine ever returns an illegal move,
      the status bar turns red and names the move + FEN. It should never happen.
- [ ] **Strengths feel different** over a full game at real movetimes (800 should
      blunder; 1600 should punish). Engine "Elo" is CCRL-anchored, not human (REF
      §3) — if low ratings still feel too sharp, inject extra randomness later.
- [ ] **Checkmate/draw** is detected and the result is shown and saved.
- [ ] **Persistence** — finished games appear under "Saved games"; reload the page
      and they're still there; "View" replays the final position.
- [ ] **Save / Resume / Resign** — Save a mid-game, reload the page, Resume it and
      keep playing; Resign ends a game as a loss and saves it; starting a new game
      mid-play preserves the old one (it appears as "in progress").
- [ ] **Offline** — `npm run build && npm run preview`, then kill the network and
      confirm a new game still works end to end.

To try the stronger threaded engine later: set `ENGINE_FILE` in
`src/web/config.ts` to `'stockfish-18-lite.js'` AND serve with COOP/COEP headers
(it needs SharedArrayBuffer). lite-single is the safe default that needs neither.
