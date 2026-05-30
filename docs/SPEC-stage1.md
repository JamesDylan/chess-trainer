# SPEC — Stage 1: Play vs Engine

**Status:** engine core landed and verified. Board UI + game persistence are
deferred to the next session (see "Deferred" below). Stage 0 is untouched and
stays green.

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

## Deferred to the next session (UI + persistence)

The vertical slice that makes this *visible and playable*:

1. **Board UI** — recommendation: **vanilla TS + Vite + `chessground`** (no
   framework). Lightest footprint and the cleanest path to Tauri packaging at
   Stage 6, matching the build plan's wording.
2. **`WorkerUciTransport`** — a browser Web Worker wrapping a WASM Stockfish build,
   implementing the *same* `UciTransport` interface. The `UciEngine`, strength
   mapping, and Stage 0 core are reused unchanged. (`tsconfig` already includes
   the DOM/WebWorker libs.)
3. **Game persistence** — recommendation: a `GameRepository` interface backed by
   **raw IndexedDB** (no new dependency), swappable to SQLite behind the same
   interface at Stage 6. Store PGN + result + the strength played.
4. **Game-over UX** — surface `ChessGame.result()` / checkmate / draw in the UI.
5. **Acceptance to finish the stage:** play a full game at 3 strengths in the
   browser; confirm it works offline after `vite build`.

New deps for the next session: `vite`, `chessground` (and the WASM `stockfish`
build is already a dependency).
