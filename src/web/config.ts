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
