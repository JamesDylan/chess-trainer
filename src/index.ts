export * from './core/types';
export * from './core/evalMath';
export * from './core/uci';
export * from './core/strength';
export * from './core/chessGame';
export * from './core/rating';

// Stage 1 — engine layer (play vs engine). Side-effect free: importing this does
// NOT load the WASM/asm engine; `createNodeEngine` loads it lazily on call.
export * from './engine';

// Stage 3 — puzzle layer (engine-less). Pure solver state machine, adaptive
// selection, the loader for the static asset, and the storage-agnostic PuzzleStore.
export * from './puzzles';

// Stage 4 — coach layer (engine-less, DOM-less). Pure stats + rule-based coaching
// over the puzzle attempt log, saved games, and cached analysis reports.
export * from './coach';
