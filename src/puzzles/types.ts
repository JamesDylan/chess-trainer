// Puzzle-layer types (Stage 3). These sit ON TOP of the Stage 0 core
// (src/core/chessGame.ts, src/core/rating.ts); they do not modify any of them.
//
// A puzzle is one Lichess tactics puzzle (docs/REFERENCE.md §6). The `moves` array
// is the solution as UCI: moves[0] is the OPPONENT's setup move (played for the
// user to create the tactic), then the solver and opponent alternate — the solver
// plays the ODD indices, the opponent replies on the EVEN indices.

/** One tactics puzzle, normalised from the Lichess CSV. */
export interface Puzzle {
  /** Lichess puzzle id (e.g. "00008"). */
  id: string;
  /** Position BEFORE the setup move (FEN). The side to move here plays moves[0]. */
  fen: string;
  /** Solution line as UCI. moves[0] = opponent setup move; solver = odd indices. */
  moves: string[];
  /** Puzzle rating (Glicko, ~600–2800). */
  rating: number;
  /** Puzzle rating deviation (used as the opponent RD when rating the user). */
  ratingDeviation: number;
  /** Tactic/phase tags (e.g. "fork", "pin", "mateIn2", "endgame"). */
  themes: string[];
  /** Lichess "popularity" score (−100..100); higher = better-liked puzzle. */
  popularity?: number;
  /** How many times the puzzle has been played. */
  nbPlays?: number;
  /** Source game URL, if carried through from the CSV. */
  gameUrl?: string;
}

/** Lifecycle of a single solve attempt. */
export type PuzzleStatus = 'in-progress' | 'solved' | 'failed';

/** Outcome of feeding one user move to a PuzzleSession. */
export interface PuzzleMoveResult {
  /** True if the move matched the solution (or an accepted alternate mate). */
  correct: boolean;
  /** Status after applying the move. */
  status: PuzzleStatus;
  /** True if this move ended the attempt (solved or failed). */
  done: boolean;
  /** On a correct, non-final move: the opponent reply that was auto-played (UCI). */
  opponentReply?: string;
  /** On an incorrect move: the solution move that was expected (UCI). */
  expected?: string;
}

/** A persisted record of one attempt (feeds Stage 4 progress tracking). */
export interface PuzzleAttempt {
  puzzleId: string;
  /** True = solved, false = failed. */
  solved: boolean;
  /** When the attempt finished (epoch ms). */
  at: number;
  /** The puzzle's rating at attempt time. */
  puzzleRating: number;
  /** User rating before the attempt. */
  ratingBefore: number;
  /** User rating after the attempt. */
  ratingAfter: number;
  /** ratingAfter − ratingBefore (signed). */
  ratingDelta: number;
  /** User RD after the attempt. */
  rdAfter: number;
  /**
   * The solved puzzle's theme tags (e.g. ["fork", "endgame"]), copied at attempt
   * time so per-theme/per-phase coaching (Stage 4) is derivable from the log alone.
   * OPTIONAL because rows written before Stage 4 don't carry it; the PuzzleStore
   * normalises a missing value to `[]` on read, so consumers never see undefined.
   */
  themes?: string[];
  /**
   * True if any hint was used on this attempt (the rating was frozen). Lets coaching
   * separate genuine solves from assisted ones. OPTIONAL for the same back-compat
   * reason as `themes`; normalised to `false` on read.
   */
  assisted?: boolean;
}
