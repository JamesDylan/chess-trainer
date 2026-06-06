// Public surface of the opening-detection layer (Stage 4 stretch). Side-effect free;
// pulls in only the ChessGame core (the single chess.js seam) — no engine, no DOM.

export * from './types';
export { OpeningBook, epdOf, MAX_DETECT_PLY } from './book';
export { loadOpeningsFromJson, normalizeOpeningMoves } from './loader';
export { SEED_OPENINGS } from './data';
