// UI-level configuration knobs.

import { DEFAULT_ANALYSIS_DEPTH } from '../analysis/analyzer';

// The Stockfish build to run in the Web Worker, served from public/sf (see
// scripts/copy-engine.mjs). "lite-single" is single-threaded WASM: no
// SharedArrayBuffer, so it works WITHOUT cross-origin isolation (no COOP/COEP).
// To try the stronger threaded build (much faster for Stage 2 analysis), switch
// to 'stockfish-18-lite.js' — the COOP/COEP headers it needs are already served by
// vite.config.ts, so it is a one-line change. lite-single still analyses fine,
// just slower per game.
export const ENGINE_FILE = 'stockfish-18-lite-single.js';

/** Resolve the worker URL against the app's base, robust to dev/preview/subpaths. */
export function engineWorkerUrl(): URL {
  return new URL(`${import.meta.env.BASE_URL}sf/${ENGINE_FILE}`, window.location.href);
}

/** Strength options offered in the UI (target Elo). Mapped via eloToEngineOptions. */
export const STRENGTH_CHOICES: ReadonlyArray<number> = [400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200];

/** Default strength on first load (one of the three acceptance strengths). */
export const DEFAULT_STRENGTH = 1200;

// --- Stage 2: analysis ------------------------------------------------------

/** Fixed search depth used to evaluate every position during game analysis.
 *  Deeper than play (REFERENCE §2/§3) so the evals are trustworthy. */
export const ANALYSIS_DEPTH = DEFAULT_ANALYSIS_DEPTH;

/** Per-position search timeout for the analysis engine. Generous: a deep search
 *  on the single-threaded WASM build can take several seconds in sharp positions. */
export const ANALYSIS_SEARCH_TIMEOUT_MS = 60_000;

// --- Stage 3: puzzles -------------------------------------------------------

/** The curated puzzle asset, served from public/puzzles (built by scripts/build-puzzles.mjs).
 *  Fetched same-origin so the trainer stays fully offline, exactly like the engine wasm. */
export function puzzlesUrl(): URL {
  return new URL(`${import.meta.env.BASE_URL}puzzles/puzzles.json`, window.location.href);
}

/** How many puzzles solved counts as hitting the daily target. */
export const PUZZLE_DAILY_TARGET = 10;

// --- Stage 5: live coaching -------------------------------------------------

/** Depth for the live coach's single per-move search — the eval bar, the per-move
 *  classification, AND the refutation PV all come from it, so it's kept SHALLOWER than
 *  ANALYSIS_DEPTH to stay responsive (latency is felt every move). The rigorous, deeper
 *  numbers live in the on-demand Analyze pass (ANALYSIS_DEPTH). */
export const COACH_LIVE_DEPTH = 12;

/** Per-eval search timeout for the dedicated coach engine. Generous: a search on the
 *  single-threaded WASM build can take a couple of seconds in sharp positions. */
export const COACH_SEARCH_TIMEOUT_MS = 60_000;

/**
 * "Closeness to best" strictness: how much centipawn loss counts toward accuracy/
 * classification even when win% barely moves (imprecision in a won position). 0 = pure
 * Lichess win%-based (most lenient); ~0.05 ≈ chess.com-harsh (cp loss maps straight onto
 * the classification thresholds). 0.03 is the middle ground used by both the post-game
 * analysis and the live coach, so a sloppy move in a winning position still reads as an
 * inaccuracy. See evalMath.effectiveWinDrop. Tunable. */
export const ACCURACY_CP_WEIGHT = 0.03;

/** Auto-enable Coach mode at or below this strength (beginners benefit most; it is
 *  still a visible toggle they can switch off). Set to 0 to never auto-enable. */
export const COACH_AUTO_ON_MAX_ELO = 1000;

// --- Stage 4: openings ------------------------------------------------------

/** Optional full opening book, served from public/openings (built by
 *  scripts/build-openings.mjs). Fetched same-origin; the app falls back to the built-in
 *  seed (src/openings/data.ts) when it's absent, so opening naming always works offline. */
export function openingsUrl(): URL {
  return new URL(`${import.meta.env.BASE_URL}openings/openings.json`, window.location.href);
}
