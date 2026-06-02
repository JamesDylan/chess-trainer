// Minimal promotion picker. When a pawn reaches the last rank, the user chooses a
// piece; we resolve with the UCI promotion letter (q/r/b/n) to append to the move.

import type { Side } from './boardView';

export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

const GLYPHS: Record<Side, Record<PromotionPiece, string>> = {
  white: { q: '♕', r: '♖', b: '♗', n: '♘' },
  black: { q: '♛', r: '♜', b: '♝', n: '♞' },
};

const LABELS: Record<PromotionPiece, string> = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };

/** Show an overlay and resolve with the chosen promotion piece. */
export function pickPromotion(color: Side): Promise<PromotionPiece> {
  return new Promise<PromotionPiece>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'promotion-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'promotion-dialog';

    const title = document.createElement('div');
    title.className = 'promotion-title';
    title.textContent = 'Promote to';
    dialog.appendChild(title);

    const row = document.createElement('div');
    row.className = 'promotion-row';

    (['q', 'r', 'b', 'n'] as PromotionPiece[]).forEach((piece) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'promotion-choice';
      btn.title = LABELS[piece];
      btn.setAttribute('aria-label', LABELS[piece]);
      btn.textContent = GLYPHS[color][piece];
      btn.addEventListener('click', () => {
        overlay.remove();
        resolve(piece);
      });
      row.appendChild(btn);
    });

    dialog.appendChild(row);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Focus the first choice for keyboard users.
    (row.firstElementChild as HTMLButtonElement | null)?.focus();
  });
}
