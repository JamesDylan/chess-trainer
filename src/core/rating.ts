// Glicko-2 rating (Stage 3) — a PURE, dependency-free TypeScript implementation.
//
// This matches the "tested-against-reference" ethos of evalMath.ts: every constant
// and formula comes from Glickman's Glicko-2 paper (docs/REFERENCE.md §5 + the
// source linked there: https://www.glicko.net/glicko/glicko2.pdf). It is unit-tested
// against the paper's canonical worked example (see test/rating.test.ts).
//
// Used by the puzzle trainer: each attempt is treated as one game against an
// opponent rated at the puzzle's rating (win = solved, loss = failed), and a
// standard Glicko-2 update is run on the user. `glicko2Update` is the raw algorithm
// (no clamps); `updateForResult` / `updateForAttempt` wrap it with the Lichess
// seed + bounds. The two are kept separate so the raw maths can be asserted exactly
// against the reference vector while the product still gets Lichess's guard-rails.

/** A player's Glicko-2 state. `rd` = rating deviation, `vol` = rating volatility (σ). */
export interface RatingState {
  rating: number;
  rd: number;
  vol: number;
}

/** One game in a rating period, from the rated player's point of view. */
export interface GameOutcome {
  opponentRating: number;
  opponentRd: number;
  /** 1 = win, 0.5 = draw, 0 = loss. */
  score: number;
}

/** The Glicko-2 scale factor: Glicko (rating/RD) -> Glicko-2 (µ/φ) is a /173.7178 map. */
export const GLICKO2_SCALE = 173.7178;

/** Convergence tolerance for the volatility (σ') root-finding iteration. */
const VOL_CONVERGENCE = 1e-6;

/** g(φ): how much an opponent's rating deviation discounts the game (paper step 3). */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** E(µ, µ_j, φ_j): expected score vs opponent j (paper step 3). */
function expectedScore(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * Raw Glicko-2 update for one rating period of `games`, at the given `tau` (the
 * system constant constraining volatility change). No clamping — this is the exact
 * algorithm from Glickman's paper, so it can be asserted against the reference
 * vector. With no games, only RD increases (φ* = sqrt(φ² + σ²)); rating is unchanged.
 */
export function glicko2Update(state: RatingState, games: readonly GameOutcome[], tau: number): RatingState {
  const mu = (state.rating - 1500) / GLICKO2_SCALE;
  const phi = state.rd / GLICKO2_SCALE;
  const sigma = state.vol;

  // No games this period: RD drifts upward by the volatility, nothing else moves.
  if (games.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: state.rating, rd: GLICKO2_SCALE * phiStar, vol: sigma };
  }

  // Step 3 + 4: estimated variance v, and the rating-direction sum.
  let vInv = 0; // 1/v
  let dirSum = 0; // Σ g(φ_j)(s_j − E_j)
  for (const game of games) {
    const muJ = (game.opponentRating - 1500) / GLICKO2_SCALE;
    const phiJ = game.opponentRd / GLICKO2_SCALE;
    const gj = g(phiJ);
    const ej = expectedScore(mu, muJ, phiJ);
    vInv += gj * gj * ej * (1 - ej);
    dirSum += gj * (game.score - ej);
  }
  const v = 1 / vInv;
  const delta = v * dirSum; // step 4: estimated improvement

  // Step 5: new volatility σ' via Illinois (regula-falsi) root finding on f(x).
  const a = Math.log(sigma * sigma);
  const phi2 = phi * phi;
  const delta2 = delta * delta;
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta2 - phi2 - v - ex);
    const den = 2 * Math.pow(phi2 + v + ex, 2);
    return num / den - (x - a) / (tau * tau);
  };

  let A = a;
  let B: number;
  if (delta2 > phi2 + v) {
    B = Math.log(delta2 - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > VOL_CONVERGENCE) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  const newVol = Math.exp(A / 2);

  // Step 6: pre-period RD bumped by the new volatility. Step 7: new φ' and µ'.
  const phiStar = Math.sqrt(phi2 + newVol * newVol);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + vInv);
  const newMu = mu + newPhi * newPhi * dirSum;

  return {
    rating: GLICKO2_SCALE * newMu + 1500,
    rd: GLICKO2_SCALE * newPhi,
    vol: newVol,
  };
}

/** Lichess Glicko-2 seed + bounds (docs/REFERENCE.md §5). */
export const LICHESS_GLICKO2 = {
  /** New-player seed. */
  rating: 1500,
  rd: 500,
  vol: 0.09,
  /** System constant τ — constrains how fast volatility can move. */
  tau: 0.75,
  /** RD is clamped to this band (a floor keeps ratings responsive; a ceiling caps uncertainty). */
  minRd: 45,
  maxRd: 500,
  /** Volatility ceiling. */
  maxVol: 0.1,
  /** A single update may not move the rating by more than this many points. */
  maxRatingChange: 700,
  /** A rating is "established" (no longer provisional) once RD drops to/below this. */
  establishedRd: 75,
} as const;

/** A fresh Lichess-seeded rating for a brand-new user. */
export function initialRating(): RatingState {
  return { rating: LICHESS_GLICKO2.rating, rd: LICHESS_GLICKO2.rd, vol: LICHESS_GLICKO2.vol };
}

/** Whether a rating is established (RD ≤ 75) vs still provisional. */
export function isEstablished(state: RatingState): boolean {
  return state.rd <= LICHESS_GLICKO2.establishedRd;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Product update: run the raw Glicko-2 update for `games`, then apply the Lichess
 * guard-rails — cap the volatility, clamp RD into [minRd, maxRd], and cap the
 * single-update rating change to ±maxRatingChange. Defaults to the Lichess params.
 */
export function updateForResult(
  state: RatingState,
  games: readonly GameOutcome[],
  params: typeof LICHESS_GLICKO2 = LICHESS_GLICKO2,
): RatingState {
  const raw = glicko2Update(state, games, params.tau);
  const vol = clamp(raw.vol, 0, params.maxVol);
  const rd = clamp(raw.rd, params.minRd, params.maxRd);
  const rating = clamp(
    raw.rating,
    state.rating - params.maxRatingChange,
    state.rating + params.maxRatingChange,
  );
  return { rating, rd, vol };
}

/**
 * Convenience for the puzzle trainer: update the user's rating after one attempt,
 * treating the puzzle as an opponent at its own rating/RD. `solved` → win, else loss.
 */
export function updateForAttempt(
  state: RatingState,
  puzzleRating: number,
  puzzleRd: number,
  solved: boolean,
  params: typeof LICHESS_GLICKO2 = LICHESS_GLICKO2,
): RatingState {
  return updateForResult(
    state,
    [{ opponentRating: puzzleRating, opponentRd: puzzleRd, score: solved ? 1 : 0 }],
    params,
  );
}
