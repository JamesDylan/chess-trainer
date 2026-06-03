// Thin wrapper over chessground. The rest of the app speaks plain squares
// (strings like "e2") and a Map<string,string[]> of legal destinations; this file
// is the only place that touches chessground's types.

import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { Key, Dests } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';

export type Side = 'white' | 'black';

/** A board arrow/marker (e.g. the engine's best move). `brush` is a chessground
 *  brush name: 'green' | 'red' | 'blue' | 'yellow'. */
export interface BoardShape {
  orig: string;
  dest?: string;
  brush: string;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface BoardState {
  fen: string;
  turnColor: Side;
  orientation: Side;
  /** Color the human may move now; undefined disables all input (engine turn / over). */
  movableColor?: Side;
  /** Legal destinations per origin square (only meaningful when movableColor is set). */
  dests: Map<string, string[]>;
  /** Highlight the last move [from, to]. */
  lastMove?: [string, string];
  /** Highlight the side-to-move's king when in check. */
  inCheck?: boolean;
  /** Arrows/markers to draw (e.g. the engine's best move during review). */
  shapes?: BoardShape[];
}

export class BoardView {
  private readonly api: Api;

  constructor(
    el: HTMLElement,
    orientation: Side,
    private readonly onUserMove: (from: string, to: string) => void,
  ) {
    const config: Config = {
      fen: START_FEN,
      orientation,
      coordinates: true,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      draggable: { enabled: true, showGhost: true },
      movable: {
        free: false,
        color: undefined, // not playable until the controller renders a live game
        dests: new Map(),
        showDests: true,
        events: {
          after: (from: Key, to: Key): void => this.onUserMove(from, to),
        },
      },
    };
    this.api = Chessground(el, config);
  }

  render(state: BoardState): void {
    this.api.set({
      fen: state.fen,
      orientation: state.orientation,
      turnColor: state.turnColor,
      lastMove: state.lastMove as Key[] | undefined,
      check: state.inCheck ? state.turnColor : false,
      movable: {
        color: state.movableColor,
        dests: state.dests as unknown as Dests,
      },
    });
    // App-managed arrows (replaced every render; empty clears them during play).
    this.api.setAutoShapes(
      (state.shapes ?? []).map(
        (s): DrawShape => ({ orig: s.orig as Key, dest: s.dest as Key | undefined, brush: s.brush }),
      ),
    );
  }

  setOrientation(orientation: Side): void {
    this.api.set({ orientation });
  }

  destroy(): void {
    this.api.destroy();
  }
}
