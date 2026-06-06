// Built-in opening book (seed). A curated set of common openings + mainline variations
// keyed by their SAN move sequence; the OpeningBook replays each to a position key (EPD)
// and matches the DEEPEST one a game reaches. This ships in the repo so opening naming
// works out of the box, offline — exactly like the committed puzzle seed. For the full
// ~3,500-line ECO set, run `npm run build-openings` (see scripts/build-openings.mjs) to
// emit public/openings/openings.json, which the app prefers when present.
//
// Coverage is deliberately family-first: every line below also names broader games that
// transpose into or stop short of a specific variation (e.g. any 1.e4 c5 game is at
// least a "Sicilian Defense"). Names follow common usage; ECO codes are the standard
// ranges. SAN is validated by a unit test (every line must be legal + reach a distinct
// position), so a typo fails CI rather than silently dropping an opening.

import type { OpeningDef } from './types';

export const SEED_OPENINGS: OpeningDef[] = [
  // --- 1.e4 e5 (Open Games) -------------------------------------------------
  { eco: 'C20', name: 'Open Game', moves: 'e4 e5' },
  { eco: 'C23', name: "Bishop's Opening", moves: 'e4 e5 Bc4' },
  { eco: 'C25', name: 'Vienna Game', moves: 'e4 e5 Nc3' },
  { eco: 'C30', name: "King's Gambit", moves: 'e4 e5 f4' },
  { eco: 'C40', name: "King's Knight Opening", moves: 'e4 e5 Nf3' },
  { eco: 'C41', name: 'Philidor Defense', moves: 'e4 e5 Nf3 d6' },
  { eco: 'C42', name: 'Petrov Defense', moves: 'e4 e5 Nf3 Nf6' },
  { eco: 'C44', name: 'Scotch Game', moves: 'e4 e5 Nf3 Nc6 d4' },
  { eco: 'C45', name: 'Scotch Game: Main Line', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4' },
  { eco: 'C46', name: 'Three Knights Opening', moves: 'e4 e5 Nf3 Nc6 Nc3' },
  { eco: 'C47', name: 'Four Knights Game', moves: 'e4 e5 Nf3 Nc6 Nc3 Nf6' },
  { eco: 'C50', name: 'Italian Game', moves: 'e4 e5 Nf3 Nc6 Bc4' },
  { eco: 'C50', name: 'Italian Game: Giuoco Piano', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5' },
  { eco: 'C55', name: 'Italian Game: Two Knights Defense', moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6' },
  { eco: 'C60', name: 'Ruy Lopez', moves: 'e4 e5 Nf3 Nc6 Bb5' },
  { eco: 'C68', name: 'Ruy Lopez: Exchange', moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6' },
  { eco: 'C70', name: 'Ruy Lopez: Morphy Defense', moves: 'e4 e5 Nf3 Nc6 Bb5 a6' },

  // --- 1.e4 c5 (Sicilian) ---------------------------------------------------
  { eco: 'B20', name: 'Sicilian Defense', moves: 'e4 c5' },
  { eco: 'B22', name: 'Sicilian Defense: Alapin Variation', moves: 'e4 c5 c3' },
  { eco: 'B23', name: 'Sicilian Defense: Closed', moves: 'e4 c5 Nc3' },
  { eco: 'B27', name: 'Sicilian Defense: Hyperaccelerated Dragon', moves: 'e4 c5 Nf3 g6' },
  { eco: 'B50', name: 'Sicilian Defense: Najdorf-bound (…d6)', moves: 'e4 c5 Nf3 d6' },
  { eco: 'B40', name: 'Sicilian Defense: French/Taimanov (…e6)', moves: 'e4 c5 Nf3 e6' },
  { eco: 'B30', name: 'Sicilian Defense: Old Sicilian (…Nc6)', moves: 'e4 c5 Nf3 Nc6' },
  { eco: 'B33', name: 'Sicilian Defense: Open', moves: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4' },
  { eco: 'B90', name: 'Sicilian Defense: Najdorf Variation', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6' },
  { eco: 'B70', name: 'Sicilian Defense: Dragon Variation', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6' },

  // --- 1.e4 e6 / c6 / d5 / minor (Semi-Open) --------------------------------
  { eco: 'C00', name: 'French Defense', moves: 'e4 e6' },
  { eco: 'C01', name: 'French Defense: Exchange Variation', moves: 'e4 e6 d4 d5 exd5' },
  { eco: 'C02', name: 'French Defense: Advance Variation', moves: 'e4 e6 d4 d5 e5' },
  { eco: 'C03', name: 'French Defense: Tarrasch Variation', moves: 'e4 e6 d4 d5 Nd2' },
  { eco: 'C11', name: 'French Defense: Classical Variation', moves: 'e4 e6 d4 d5 Nc3 Nf6' },
  { eco: 'C15', name: 'French Defense: Winawer Variation', moves: 'e4 e6 d4 d5 Nc3 Bb4' },
  { eco: 'B10', name: 'Caro-Kann Defense', moves: 'e4 c6' },
  { eco: 'B12', name: 'Caro-Kann Defense: Advance Variation', moves: 'e4 c6 d4 d5 e5' },
  { eco: 'B13', name: 'Caro-Kann Defense: Exchange Variation', moves: 'e4 c6 d4 d5 exd5 cxd5' },
  { eco: 'B15', name: 'Caro-Kann Defense: Main Line', moves: 'e4 c6 d4 d5 Nc3' },
  { eco: 'B01', name: 'Scandinavian Defense', moves: 'e4 d5' },
  { eco: 'B01', name: 'Scandinavian Defense: Main Line', moves: 'e4 d5 exd5 Qxd5' },
  { eco: 'B01', name: 'Scandinavian Defense: Modern Variation', moves: 'e4 d5 exd5 Nf6' },
  { eco: 'B02', name: 'Alekhine Defense', moves: 'e4 Nf6' },
  { eco: 'B06', name: 'Modern Defense', moves: 'e4 g6' },
  { eco: 'B07', name: 'Pirc Defense', moves: 'e4 d6' },

  // --- 1.d4 d5 (Closed / Queen's Gambit) ------------------------------------
  { eco: 'D00', name: "Queen's Pawn Game", moves: 'd4 d5' },
  { eco: 'D02', name: 'London System', moves: 'd4 d5 Bf4' },
  { eco: 'D06', name: "Queen's Gambit", moves: 'd4 d5 c4' },
  { eco: 'D20', name: "Queen's Gambit Accepted", moves: 'd4 d5 c4 dxc4' },
  { eco: 'D30', name: "Queen's Gambit Declined", moves: 'd4 d5 c4 e6' },
  { eco: 'D10', name: 'Slav Defense', moves: 'd4 d5 c4 c6' },

  // --- 1.d4 Nf6 (Indian Defenses) ------------------------------------------
  { eco: 'A45', name: 'Indian Defense', moves: 'd4 Nf6' },
  { eco: 'E20', name: 'Nimzo-Indian Defense', moves: 'd4 Nf6 c4 e6 Nc3 Bb4' },
  { eco: 'E12', name: "Queen's Indian Defense", moves: 'd4 Nf6 c4 e6 Nf3 b6' },
  { eco: 'E60', name: "King's Indian Defense", moves: 'd4 Nf6 c4 g6 Nc3 Bg7' },
  { eco: 'D80', name: 'Grünfeld Defense', moves: 'd4 Nf6 c4 g6 Nc3 d5' },
  { eco: 'A56', name: 'Benoni Defense', moves: 'd4 Nf6 c4 c5' },
  { eco: 'A80', name: 'Dutch Defense', moves: 'd4 f5' },

  // --- Flank openings -------------------------------------------------------
  { eco: 'A10', name: 'English Opening', moves: 'c4' },
  { eco: 'A04', name: 'Réti Opening', moves: 'Nf3' },
  { eco: 'A09', name: 'Réti Opening: Advance', moves: 'Nf3 d5 c4' },
  { eco: 'A01', name: 'Nimzo-Larsen Attack', moves: 'b3' },
  { eco: 'A02', name: "Bird's Opening", moves: 'f4' },
];
