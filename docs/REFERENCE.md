# REFERENCE — offline cheat-sheet (all facts you need with no internet)

This file is the single source of truth for the formulas, protocol, and APIs used in Stage 0.
It is self-contained on purpose: an offline agent (qwen) can implement everything below
**without web access**. Numbers were verified numerically. Sources are at the bottom.

---

## 1. Evaluation math (Lichess-derived)

### 1.1 Centipawns → Win%  (`cpToWinPercent`)
```
WIN_PERCENT_K = -0.00368208     // logistic steepness (from Lichess eval.scala)
CP_CEILING    = 1000            // clamp cp to +/- this BEFORE converting (mate excluded)

winPercent(cp) = 50 + 50 * ( 2 / (1 + exp(WIN_PERCENT_K * cpClamped)) - 1 )
```
- cp is from the **side-to-move's** point of view. Output is 0..100.
- Verified values: `0→50.00, 100→59.10, 200→67.62, 300→75.11, 500→86.31, 1000→97.54, -100→40.90, -1000→2.46`.
- Symmetric: `winPercent(x) + winPercent(-x) = 100`.

### 1.2 Score (cp **or** mate) → Win%  (`scoreToWinPercent`)
- If `score.cp` set → use `cpToWinPercent`.
- If `score.mate` set → convert to a cp-equivalent and feed the **same logistic but WITHOUT the ±1000 clamp** (so a closer mate scores higher):
```
cpEq = sign(mate) * (21 - min(10, abs(mate))) * 100
winPercent = 50 + 50 * (2 / (1 + exp(WIN_PERCENT_K * cpEq)) - 1)
```
- Verified: `mate 1→99.94, mate 3→99.87, mate 5→99.72, mate 10→98.29, mate -1→0.06`.

### 1.3 Win% drop → per-move Accuracy%  (`winPercentToAccuracy`)
```
ACC_A = 103.1668 ; ACC_B = -0.04354 ; ACC_C = 3.1669

if winAfter >= winBefore:  accuracy = 100
else:
  d   = winBefore - winAfter            // both 0..100, mover POV
  raw = ACC_A * exp(ACC_B * d) - ACC_C
  accuracy = clamp(raw, 0, 100)
```
- Verified by drop d: `0→100, 2→91.40, 5→79.82, 10→63.58, 15→50.52, 20→40.02, 40→14.91, 60→4.40`.

### 1.4 Move classification  (`classifyMove`) — by win% drop `d = winBefore - winAfter`
```
d < 1   → 'best'
d < 3   → 'excellent'
d < 5   → 'good'
d < 10  → 'inaccuracy'
d < 15  → 'mistake'
else    → 'blunder'
```
The 5/10/15 edges equal Lichess's 0.10/0.20/0.30 *winning-chances* thresholds
(winningChances drop × 50 = win% drop). They live in `CLASSIFICATION_THRESHOLDS` and are tunable.

### 1.5 ACPL & harmonic mean
- `averageCentipawnLoss(losses[])` = mean of per-move cp losses (each ≥ 0); empty → 0.
- `harmonicMean(values[])` = `n / Σ(1/x)`; empty → 0. (Used later for game-accuracy aggregation.)

---

## 2. UCI protocol cheat-sheet

Engine is a line-based stdio process. Lifecycle:
```
GUI→  uci
ENG→  id name ... ; option name ... ; uciok
GUI→  setoption name <id> value <x>        (only while idle)
GUI→  isready
ENG→  readyok
GUI→  ucinewgame                            (then isready/readyok again)
GUI→  position startpos moves e2e4 e7e5      | position fen <FEN> moves ...
GUI→  go movetime 1000                       | go depth 12 | go nodes 100000
ENG→  info depth .. score cp 41 .. pv g1f3 b8c6 ...   (many lines)
ENG→  bestmove g1f3 ponder b8c6
GUI→  stop      (force immediate bestmove)   ;  quit  (exit)
```
Parsing rules used by `uci.ts`:
- `info` line fields: `depth, seldepth, multipv, score (cp <n> | mate <n>), nodes, nps, time(ms→timeMs), pv (rest = UCI moves)`.
- `score cp` / `score mate` are **side-to-move POV**. `info string ...` lines are human-readable → ignore (return null).
- `bestmove <m> [ponder <m>]`.
- Annotated example line:
  `info depth 12 seldepth 16 multipv 1 score cp 41 nodes 56507 nps 326630 time 173 pv g1f3 b8c6 f1b5`

---

## 3. Strength limiting (making a beatable opponent)

- **`Skill Level`** (0–20): lower = weaker (randomised suboptimal moves; also caps depth ≈ `1+level`).
- **`UCI_LimitStrength` + `UCI_Elo`**: Elo-targeted. **`UCI_Elo` FLOOR is 1320**, ceiling 3190.
  → You **cannot** ask for 600/800/1000 via UCI_Elo; below 1320 use Skill Level + short movetime.
- Calibration caveat: engine "Elo" is **CCRL-anchored, not human** — it feels stronger and blunders
  less humanly than a same-rated person. Tune later; optionally inject randomness at low ratings.

`strength.ts` mapping (`eloToEngineOptions`):
| Target Elo | limitStrength | skillLevel | uciElo | movetimeMs |
|---|---|---|---|---|
| ≤600 | false | 0 | – | 50 |
| ≤800 | false | 2 | – | 50 |
| ≤1000 | false | 4 | – | 100 |
| ≤1200 | false | 6 | – | 150 |
| 1201–1319 | false | 8 | – | 200 |
| ≥1320 | true | – | clamp(elo,1320,3190) | 300 |

To apply at runtime (Stage 1): if `limitStrength` → `setoption name UCI_LimitStrength value true` + `setoption name UCI_Elo value <uciElo>`; else `setoption name Skill Level value <skillLevel>`. Always `setoption name Threads value 1` for the bot. Then `go movetime <movetimeMs>`.

---

## 4. chess.js v1 API (used by `ChessGame`)
```ts
import { Chess } from 'chess.js';
const c = new Chess();                 // start position
const c = new Chess(fen);              // from FEN (throws on invalid)
c.move('Nf3');                         // SAN; throws on illegal
c.move({ from:'g1', to:'f3' });        // object form; add promotion:'q' for promotions
c.moves();                             // string[] of legal SAN moves
c.fen(); c.turn();                     // turn() → 'w' | 'b'
c.isGameOver(); c.isCheckmate(); c.isDraw(); c.isStalemate();
c.history();                           // string[] of SAN played
c.loadPgn(pgn); c.pgn();
```
- UCI string like `e2e4` / `e7e8q` is NOT accepted directly — split into `{from,to,promotion}`.
- On checkmate, the side **to move** is the loser (so `turn()==='w'` ⇒ result `0-1`).

---

## 5. Glicko-2 (for LATER — puzzle & game rating, Stage 3+)
Treat each puzzle attempt as one game vs an opponent rated at the puzzle's rating (win=solved, loss=failed); run a standard Glicko-2 update on the user. Lichess parameters: default **1500 / RD 500 / vol 0.09**, **τ = 0.75**, RD clamp **45–500**, vol cap 0.1, single-update rating change capped ±700, "established" when RD ≤ 75. Use the `glicko2` npm package seeded with these. (Not needed for Stage 0.)

---

## 6. Lichess puzzle CSV schema (the ~4M-puzzle file you already have)
`PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl, OpeningTags`
- `Moves` = solution as space-separated UCI; the **first** move is the opponent's setup move, then the solver replies.
- `Themes` = space-separated tags (fork, pin, mateIn2, endgame, ...). File ships `.csv.zst`; decompress with `zstd -d`.

---

## Sources
- Lichess accuracy (Win%/Accuracy% formulas, game-accuracy method): https://lichess.org/page/accuracy
- scalachess `eval.scala` (−0.00368208, cp ceiling 1000, mate→cp): https://github.com/lichess-org/scalachess/blob/master/core/src/main/scala/eval.scala
- lila `AccuracyPercent.scala`: https://github.com/lichess-org/lila/blob/master/modules/analyse/src/main/AccuracyPercent.scala
- lila `Advice.scala` (inaccuracy/mistake/blunder = 0.1/0.2/0.3 winningChances): https://github.com/lichess-org/lila/blob/master/modules/tree/src/main/Advice.scala
- Stockfish UCI & Commands: https://official-stockfish.github.io/docs/stockfish-wiki/UCI-&-Commands.html
- Stockfish FAQ (Skill Level, UCI_Elo): https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html
- nmrugg/stockfish.js (WASM builds): https://github.com/nmrugg/stockfish.js
- Chess.com move classification: https://support.chess.com/en/articles/8572705
- Glicko-2: https://www.glicko.net/glicko/glicko2.pdf
