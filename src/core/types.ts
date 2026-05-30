// Shared types for the chess-trainer core library.
// These are COMPLETE — do not change them; the stubs and tests depend on them.

export type Color = 'white' | 'black';

export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';

/** A UCI engine score, from the side-to-move's point of view. Exactly one field is set. */
export interface Score {
  /** centipawns (side-to-move POV) */
  cp?: number;
  /** mate in N half? No: mate in N moves, signed. +3 = side-to-move mates in 3; -2 = gets mated in 2. */
  mate?: number;
}

/** A parsed UCI `info ...` line. `pv` is the principal variation as UCI moves (may be empty). */
export interface InfoLine {
  depth?: number;
  seldepth?: number;
  multipv?: number;
  score?: Score;
  nodes?: number;
  nps?: number;
  timeMs?: number;
  pv: string[];
}

/** Result of a UCI `bestmove ...` line. */
export interface BestMove {
  best: string;
  ponder?: string;
}

/** Move-quality label (mover POV), derived from win% drop. See CLASSIFICATION_THRESHOLDS. */
export type MoveClass =
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

/** Options to send to a UCI engine to make it play at a target strength. */
export interface EngineOptions {
  /** If true, use UCI_LimitStrength + UCI_Elo. If false, use Skill Level. */
  limitStrength: boolean;
  /** Target Elo for UCI_Elo (only meaningful when limitStrength = true). 1320..3190. */
  uciElo?: number;
  /** Stockfish "Skill Level" 0..20 (used when limitStrength = false, i.e. below the 1320 Elo floor). */
  skillLevel?: number;
  /** Per-move thinking time in milliseconds. */
  movetimeMs: number;
  /** MultiPV (number of candidate lines). Keep at 1 for play; raise for analysis. */
  multipv: number;
}
