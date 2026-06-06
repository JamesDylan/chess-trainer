// Stage 5 — the Coach UI (DOM only; no engine, no chess logic). It owns two pieces of
// the Play tab: a vertical White-POV eval bar to the LEFT of the board (chess.com Play
// Coach style) and a coach feedback line under the board (a classification badge, a
// one-line message, the cp/accuracy metrics, and — on a slip — Retry/Continue actions).
// The CoachController drives it; this file just renders what it is told.

import type { Side } from './boardView';

/** Tone of the classification badge, mapped to a colour in styles.css. */
export type CoachTone = 'good' | 'ok' | 'warn' | 'bad';

/** A button shown in the coach line (e.g. "Try to find it", "Continue"). */
export interface CoachAction {
  label: string;
  onClick: () => void;
  kind?: 'primary' | 'secondary';
}

/** The render-model the controller hands the view for one move's feedback. */
export interface CoachFeedbackVM {
  badge: { label: string; tone: CoachTone };
  headline: string;
  detail?: string;
  metrics?: string;
  actions?: CoachAction[];
}

export class CoachView {
  constructor(
    private readonly barEl: HTMLElement,
    private readonly panelEl: HTMLElement,
  ) {}

  /** Show/hide the bar + panel (toggled with Coach mode). */
  setVisible(on: boolean): void {
    this.barEl.hidden = !on;
    this.panelEl.hidden = !on;
    if (on) {
      this.ensureBar();
    } else {
      this.panelEl.replaceChildren();
    }
  }

  private ensureBar(): void {
    if (this.barEl.querySelector('.eval-bar-fill')) return;
    this.barEl.classList.add('eval-bar');
    const fill = document.createElement('div');
    fill.className = 'eval-bar-fill';
    const label = document.createElement('div');
    label.className = 'eval-bar-label';
    this.barEl.append(fill, label);
  }

  /**
   * Update the eval bar. `winWhite` is White's win% (0..100); `evalText` is the
   * White-POV eval string ("+1.2", "-0.8", "M8", "-M3"). `orientation` is the side at
   * the bottom of the board, so the bar lines up with the pieces.
   */
  setEvalBar(winWhite: number, evalText: string, orientation: Side = 'white'): void {
    this.ensureBar();
    const fill = this.barEl.querySelector<HTMLElement>('.eval-bar-fill');
    const label = this.barEl.querySelector<HTMLElement>('.eval-bar-label');
    const h = Math.max(0, Math.min(100, winWhite));
    // White fill grows from the bottom when White is at the bottom; flip for Black.
    this.barEl.classList.toggle('flip', orientation === 'black');
    if (fill) fill.style.height = `${h.toFixed(2)}%`;
    if (label) label.textContent = evalText;
  }

  /** Transient "thinking" state while an eval is in flight. */
  setThinking(): void {
    this.panelEl.replaceChildren(line('coach-line coach-thinking', 'Coach is checking…'));
  }

  /** A muted idle line between moves (so the side panel isn't blank on your turn). */
  showIdle(text: string): void {
    this.panelEl.replaceChildren(line('coach-line coach-idle', text));
  }

  /** Clear the feedback line (keeps the eval bar). */
  clear(): void {
    this.panelEl.replaceChildren();
  }

  /** Render one move's feedback. */
  showFeedback(vm: CoachFeedbackVM): void {
    const wrap = document.createElement('div');
    wrap.className = 'coach-feedback';

    const head = document.createElement('div');
    head.className = 'coach-head';
    const badge = document.createElement('span');
    badge.className = `coach-badge tone-${vm.badge.tone}`;
    badge.textContent = vm.badge.label;
    const headline = document.createElement('span');
    headline.className = 'coach-headline';
    headline.textContent = vm.headline;
    head.append(badge, headline);
    wrap.append(head);

    if (vm.detail) wrap.append(line('coach-detail', vm.detail));
    if (vm.metrics) wrap.append(line('coach-metrics', vm.metrics));

    if (vm.actions && vm.actions.length > 0) {
      const row = document.createElement('div');
      row.className = 'coach-actions';
      for (const a of vm.actions) {
        const b = document.createElement('button');
        b.type = 'button';
        if (a.kind === 'secondary') b.className = 'secondary';
        b.textContent = a.label;
        b.addEventListener('click', a.onClick);
        row.append(b);
      }
      wrap.append(row);
    }

    this.panelEl.replaceChildren(wrap);
  }
}

function line(className: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}
