// Opening-detection types (Stage 4 stretch). A small, pure layer that names the
// opening a game reached, so the Progress tab can show win/loss by opening. It sits on
// top of the Stage 0 core (ChessGame) and pulls in NO engine and NO DOM.

/** A named opening (ECO code optional). */
export interface OpeningId {
  /** ECO code (e.g. "C45"), if known. */
  eco?: string;
  /** Opening name (e.g. "Scotch Game", "French Defense: Winawer Variation"). */
  name: string;
}

/** One opening-book row: a name + the SAN move sequence that defines it. */
export interface OpeningDef extends OpeningId {
  /** Space-separated SAN moves, e.g. "e4 e5 Nf3 Nc6 d4". */
  moves: string;
}

/** A detected opening + the ply (half-move) at which the deepest match occurred. */
export interface DetectedOpening extends OpeningId {
  /** 1-based half-move index of the matched position. */
  ply: number;
}
