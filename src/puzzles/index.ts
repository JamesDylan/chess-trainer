// Public surface of the puzzle layer (Stage 3). Importing this barrel is
// side-effect free and pulls in no engine/DOM — the solver state machine drives a
// ChessGame (reused verbatim), selection is a pure function, and the store is
// storage-agnostic behind its interface.

export * from './types';
export { PuzzleSession, createPuzzleSession } from './puzzleSession';
export type { PuzzleSessionOptions } from './puzzleSession';
export { selectNextPuzzle } from './selection';
export type { SelectNextOptions } from './selection';
export { loadPuzzlesFromJson, type RawPuzzle } from './loader';
export type { PuzzleStore } from './puzzleStore';
export { InMemoryPuzzleStore, IndexedDbPuzzleStore } from './puzzleStore';
