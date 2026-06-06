// Tunable knobs for Stage-4 stats + coaching, in the spirit of evalMath.ts's
// CLASSIFICATION_THRESHOLDS: every policy number lives here, named and documented, so
// the rule-based coach can be retuned in one place. NOTHING here is derived from the
// user's data — these are the constants the deterministic coach applies to it.

export const COACH_THRESHOLDS = {
  // --- puzzle themes ---------------------------------------------------------
  /** A theme needs at least this many attempts before its solve-rate is trusted
   *  enough to be RANKED as a weakness — stops a 0/1 sample topping the list. */
  minThemeAttempts: 4,
  /** Solve-rate (fraction 0..1) strictly below this flags a theme as a weakness. */
  weakThemeSolveRate: 0.65,
  /** Solve-rate at/above this marks a theme as a strength (for the UI lists). */
  strongThemeSolveRate: 0.85,
  /** At/above this attempt count a theme's confidence is "high" (it is "medium" once
   *  it clears minThemeAttempts, and "low" below it). */
  highConfidenceThemeAttempts: 10,

  // --- game phases -----------------------------------------------------------
  /** A phase needs at least this many of the USER's moves before it is judged. */
  minPhaseMoves: 8,
  /** Phase accuracy% (0..100) strictly below this flags the phase as a weakness. */
  weakPhaseAccuracy: 75,
  /** Phase accuracy% at/above this marks the phase as a strength. */
  strongPhaseAccuracy: 90,
  /** At/above this move count a phase's confidence is "high". */
  highConfidencePhaseMoves: 20,

  // --- blunders --------------------------------------------------------------
  /** Mean USER blunders per analysed game at/above this flags a blunder habit. */
  highBlunderRate: 1.0,
  /** Minimum analysed games before the blunder rate is judged at all. */
  minGamesForBlunderRate: 1,

  // --- openings --------------------------------------------------------------
  /** Min finished games in an opening before its score can flag a weakness. */
  minOpeningGames: 3,
  /** User score (wins + ½·draws)/games strictly below this ⇒ a weak opening. */
  weakOpeningScore: 0.45,
  /** Score at/above this ⇒ a strong opening (for the UI tone). */
  strongOpeningScore: 0.55,

  // --- coaching output -------------------------------------------------------
  /** Cap on emitted insights (the UI shows the top 2–4). */
  maxInsights: 4,
} as const;

// Phase classification cut (applied in gameStats.phaseOf). Documented here so the cut
// is a single tunable. Material is counted in standard points, kings + pawns excluded.
export const PHASE_THRESHOLDS = {
  /** Non-pawn, non-king material points (BOTH sides) at/below which a position is an
   *  ENDGAME. Full board = 62 (Q+2R+2B+2N = 31 per side). 14 ≈ queens off and at most
   *  a rook + a minor each. Checked FIRST, so a stripped-down board is an endgame even
   *  if it arises early. */
  endgameNonPawnPoints: 14,
  /** Up to and including this ply (half-move) a non-endgame position is the OPENING
   *  (development phase); beyond it (still enough material) it is the MIDDLEGAME.
   *  20 plies = the first 10 full moves. */
  openingMaxPly: 20,
} as const;
