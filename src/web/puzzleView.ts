// Stage 3 puzzle panel: renders the solver's status beside its board — the user's
// Glicko-2 rating (+ provisional flag), the ±delta after each attempt, solve/try-again
// feedback, progress within the line, a streak + daily-target tracker, a back/forward
// stepper, and the controls (Next / Hint→Solution + a theme filter).
//
// It owns ONLY its own DOM and talks to the PuzzleController through callbacks — the
// board itself is the controller's separate BoardView. Mirrors AnalysisView; it does
// not touch the play UI.

import type { PuzzleUiState } from './puzzleController';
import type { StatusKind } from './gameController';

export interface PuzzleViewCallbacks {
  onNext(): void;
  onHint(): void;
  onTheme(theme: string): void;
  onBack(): void;
  onForward(): void;
}

export class PuzzleView {
  private readonly root: HTMLElement;
  private themeValue = '';

  constructor(container: HTMLElement, private readonly cb: PuzzleViewCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'puzzle';
    container.appendChild(this.root);
  }

  /** Transient status (loading / load error) before/without a full state. */
  showStatus(text: string, kind: StatusKind): void {
    this.root.replaceChildren(this.messageEl(text, kind));
  }

  /** Render the full panel from a controller state snapshot. */
  render(state: PuzzleUiState): void {
    this.themeValue = state.activeTheme;
    this.root.replaceChildren(
      this.headEl(state),
      this.messageEl(state.message, state.messageKind),
      this.metaEl(state),
      this.navEl(state),
      this.controlsEl(state),
      this.statsEl(state),
    );
  }

  // --- builders --------------------------------------------------------------

  private headEl(state: PuzzleUiState): HTMLElement {
    const head = document.createElement('div');
    head.className = 'puzzle-head';

    const title = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = 'Puzzles';
    const sub = document.createElement('span');
    sub.className = 'puzzle-sub';
    if (state.puzzleId) {
      const side = state.solverColor === 'white' ? 'White' : 'Black';
      sub.textContent = `#${state.puzzleId} · ${side} to play · rated ${state.puzzleRating}`;
    } else {
      sub.textContent = 'Tactics trainer';
    }
    title.append(h2, sub);

    // Rating badge with the ±delta from the last attempt.
    const badge = document.createElement('div');
    badge.className = 'puzzle-rating';
    const num = document.createElement('span');
    num.className = 'puzzle-rating-num';
    num.textContent = String(state.rating);
    const lbl = document.createElement('span');
    lbl.className = 'puzzle-rating-label';
    lbl.textContent = state.provisional ? 'your rating (provisional)' : 'your rating';
    badge.append(num, lbl);
    if (state.lastDelta !== undefined && state.lastDelta !== 0) {
      const delta = document.createElement('span');
      delta.className = `puzzle-delta ${state.lastDelta >= 0 ? 'up' : 'down'}`;
      delta.textContent = state.lastDelta >= 0 ? `+${state.lastDelta}` : String(state.lastDelta);
      badge.appendChild(delta);
    }

    head.append(title, badge);
    return head;
  }

  private messageEl(text: string, kind: StatusKind): HTMLElement {
    const p = document.createElement('p');
    p.className = 'puzzle-message status';
    p.dataset.kind = kind;
    p.textContent = text;
    return p;
  }

  private metaEl(state: PuzzleUiState): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'puzzle-meta';
    if (state.puzzleId && state.totalMoves > 0) {
      const prog = document.createElement('span');
      prog.className = 'puzzle-progress';
      const shown = Math.min(state.movesMade + (state.phase === 'in-progress' ? 1 : 0), state.totalMoves);
      prog.textContent = `Move ${Math.max(1, shown)} of ${state.totalMoves}`;
      wrap.appendChild(prog);
    }
    if (state.assisted && state.phase !== 'solved') {
      const frozen = document.createElement('span');
      frozen.className = 'puzzle-frozen';
      frozen.textContent = 'hint used · rating frozen';
      wrap.appendChild(frozen);
    }
    if (state.puzzleThemes && state.puzzleThemes.length && state.phase === 'solved') {
      // Reveal themes only after the puzzle is solved (they can spoil the tactic).
      const themes = document.createElement('span');
      themes.className = 'puzzle-themes';
      themes.textContent = state.puzzleThemes.slice(0, 4).join(' · ');
      wrap.appendChild(themes);
    }
    return wrap;
  }

  /** ◀ / ▶ stepper through the moves played so far (also driven by the arrow keys). */
  private navEl(state: PuzzleUiState): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'puzzle-nav';
    const back = button('◀', () => this.cb.onBack(), 'icon');
    back.title = 'Back (←)';
    back.disabled = !state.canBack;
    const fwd = button('▶', () => this.cb.onForward(), 'icon');
    fwd.title = 'Forward (→)';
    fwd.disabled = !state.canForward;
    const ind = document.createElement('span');
    ind.className = 'puzzle-nav-indicator';
    ind.textContent = `${state.navIndex} / ${state.navTotal}`;
    bar.append(back, ind, fwd);
    return bar;
  }

  private controlsEl(state: PuzzleUiState): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'puzzle-controls';

    const solving = state.phase === 'in-progress';
    const next = button(solving ? 'Skip' : 'Next puzzle', () => this.cb.onNext());
    next.classList.add('puzzle-next');
    bar.appendChild(next);

    // Graduated hint: Hint → Solution → (shown).
    const hintLabel = state.hintLevel === 0 ? 'Hint' : state.hintLevel === 1 ? 'Solution' : 'Solution shown';
    const hint = button(hintLabel, () => this.cb.onHint(), 'secondary');
    hint.disabled = !state.canHint;
    hint.title = 'First click highlights the piece; second shows the move';
    bar.appendChild(hint);

    // Theme filter.
    if (state.availableThemes.length) {
      const label = document.createElement('label');
      label.className = 'puzzle-theme-filter';
      label.append('Theme');
      const select = document.createElement('select');
      select.appendChild(option('', 'All'));
      for (const t of state.availableThemes) select.appendChild(option(t, t));
      select.value = this.themeValue;
      select.addEventListener('change', () => this.cb.onTheme(select.value));
      label.appendChild(select);
      bar.appendChild(label);
    }

    return bar;
  }

  private statsEl(state: PuzzleUiState): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'puzzle-stats';

    wrap.appendChild(stat('🔥', `${state.streak}`, 'streak'));

    const dailyDone = Math.min(state.solvedToday, state.dailyTarget);
    const daily = stat('🎯', `${state.solvedToday} / ${state.dailyTarget}`, 'solved today');
    if (state.solvedToday >= state.dailyTarget) daily.classList.add('done');
    wrap.appendChild(daily);

    const rdStat = stat('±', `${state.rd}`, 'rating deviation');
    rdStat.title = state.provisional
      ? 'Rating is still provisional (RD > 75) — it will settle as you solve more.'
      : 'Rating is established (RD ≤ 75).';
    wrap.appendChild(rdStat);

    // Daily target progress bar.
    const bar = document.createElement('div');
    bar.className = 'puzzle-daily-bar';
    const fill = document.createElement('div');
    fill.className = 'puzzle-daily-fill';
    fill.style.width = `${state.dailyTarget > 0 ? (dailyDone / state.dailyTarget) * 100 : 0}%`;
    bar.appendChild(fill);

    const col = document.createElement('div');
    col.className = 'puzzle-stats-col';
    col.append(wrap, bar);
    return col;
  }
}

// --- small DOM helpers -------------------------------------------------------

function button(text: string, onClick: () => void, className?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (className) b.className = className;
  b.addEventListener('click', onClick);
  return b;
}

function option(value: string, text: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

function stat(icon: string, value: string, label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'puzzle-stat';
  const v = document.createElement('span');
  v.className = 'puzzle-stat-value';
  v.textContent = `${icon} ${value}`;
  const l = document.createElement('span');
  l.className = 'puzzle-stat-label';
  l.textContent = label;
  el.append(v, l);
  return el;
}
