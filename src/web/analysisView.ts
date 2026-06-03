// Stage 2 analysis UI: renders a GameReport as a move scoresheet (coloured
// best -> blunder), per-player accuracy + blunder/mistake/inaccuracy counts, a
// hand-drawn SVG win% sparkline, and a board-review stepper (first/prev/next/last,
// click any move to jump). It owns only its own DOM; the board itself is driven
// through callbacks (so it can reuse the single shared BoardView via the
// controller's read-only review path). No engine, no persistence here.

import type { GameReport, MoveAnalysis } from '../analysis/types';
import type { MoveClass, Score } from '../core/types';
import type { Side, BoardShape } from './boardView';

export interface AnalysisViewCallbacks {
  /** Drive the shared board to a position (last-move highlight + best-move arrows). */
  onShowPosition(fen: string, lastMove?: [string, string], shapes?: BoardShape[]): void;
  /** User closed the analysis panel. */
  onClose(): void;
  /** User asked to cancel an in-progress analysis. */
  onCancel(): void;
}

export interface AnalysisMeta {
  strengthElo: number;
  humanColor: Side;
}

const CLASS_META: Record<MoveClass, { label: string; color: string }> = {
  best: { label: 'Best', color: 'var(--ok)' },
  excellent: { label: 'Excellent', color: 'var(--accent)' },
  good: { label: 'Good', color: '#7fae6e' },
  inaccuracy: { label: 'Inaccuracy', color: 'var(--warn)' },
  mistake: { label: 'Mistake', color: '#d19a66' },
  blunder: { label: 'Blunder', color: 'var(--danger)' },
};

function accuracyColor(acc: number): string {
  if (acc >= 90) return 'var(--ok)';
  if (acc >= 75) return 'var(--accent)';
  if (acc >= 60) return 'var(--warn)';
  return 'var(--danger)';
}

/** Format an eval for display in White's POV: "+1.2", "-0.5", "+#3", "-#2", "½", "#". */
function evalText(m: MoveAnalysis): string {
  if (m.terminal === 'draw') return '½';
  if (m.terminal === 'checkmate') return '#';
  const whiteToMoveAfter = m.fenAfter.split(' ')[1] === 'w';
  const s: Score = m.scoreAfter;
  if (s.mate !== undefined) {
    const whiteMate = whiteToMoveAfter ? s.mate : -s.mate;
    return `${whiteMate >= 0 ? '+' : '-'}#${Math.abs(whiteMate)}`;
  }
  const cp = whiteToMoveAfter ? s.cp ?? 0 : -(s.cp ?? 0);
  const pawns = cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

/** White-POV win% AFTER a move (the mover's win% flipped to White's POV when needed). */
function whiteWinAfter(m: MoveAnalysis): number {
  return m.mover === 'white' ? m.winAfter : 100 - m.winAfter;
}

export class AnalysisView {
  private readonly root: HTMLElement;
  private report?: GameReport;
  private meta?: AnalysisMeta;
  private currentPly = 0; // 0 = start position; 1..N = position after ply i
  private readonly cellByPly = new Map<number, HTMLElement>();
  private marker?: SVGCircleElement;
  private keyHandler?: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement, private readonly cb: AnalysisViewCallbacks) {
    this.root = document.createElement('section');
    this.root.className = 'analysis';
    this.root.hidden = true;
    container.appendChild(this.root);
  }

  /** Show the progress state while an analysis runs. */
  showProgress(done: number, total: number): void {
    this.detachKeys();
    this.root.hidden = false;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    this.root.replaceChildren();
    const head = document.createElement('div');
    head.className = 'analysis-head';
    head.innerHTML = `<h2>Analyzing…</h2>`;
    const cancel = button('Cancel', () => this.cb.onCancel(), 'secondary');
    head.appendChild(cancel);

    const bar = document.createElement('div');
    bar.className = 'analysis-progress';
    const fill = document.createElement('div');
    fill.className = 'analysis-progress-fill';
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    const label = document.createElement('p');
    label.className = 'analysis-progress-label';
    label.textContent =
      total > 0
        ? `Evaluated ${done} / ${total} positions (${pct}%) — analysis is slow in WASM.`
        : 'Preparing analysis… (loading the engine)';

    this.root.append(head, bar, label);
  }

  /** Show an error (e.g. the engine failed to load). */
  showError(message: string): void {
    this.detachKeys();
    this.root.hidden = false;
    this.root.replaceChildren();
    const head = document.createElement('div');
    head.className = 'analysis-head';
    head.innerHTML = `<h2>Analysis</h2>`;
    head.appendChild(button('Close', () => this.cb.onClose(), 'secondary'));
    const p = document.createElement('p');
    p.className = 'status';
    p.dataset.kind = 'error';
    p.textContent = message;
    this.root.append(head, p);
  }

  /** Render the finished report and enter board review at the start position. */
  render(report: GameReport, meta: AnalysisMeta): void {
    this.report = report;
    this.meta = meta;
    this.currentPly = 0;
    this.cellByPly.clear();
    this.root.hidden = false;
    this.root.replaceChildren();

    this.root.append(
      this.buildHead(meta),
      this.buildSummary(report),
      ...(report.moves.length > 0 ? [this.buildSparkline(report)] : []),
      this.buildStepper(),
      this.buildScoresheet(report),
    );

    this.attachKeys();
    this.goTo(0);
  }

  /** Hide and tear down the panel. */
  hide(): void {
    this.detachKeys();
    this.root.hidden = true;
    this.root.replaceChildren();
    this.report = undefined;
  }

  // --- builders --------------------------------------------------------------

  private buildHead(meta: AnalysisMeta): HTMLElement {
    const head = document.createElement('div');
    head.className = 'analysis-head';
    const h2 = document.createElement('h2');
    h2.textContent = 'Analysis';
    const sub = document.createElement('span');
    sub.className = 'analysis-sub';
    sub.textContent = `vs ~${meta.strengthElo} Elo · you ${meta.humanColor} · depth ${this.report?.depth ?? ''}`;
    const title = document.createElement('div');
    title.append(h2, sub);
    head.append(title, button('Close', () => this.cb.onClose(), 'secondary'));
    return head;
  }

  private buildSummary(report: GameReport): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analysis-summary';
    wrap.append(playerCard('White', report.white), playerCard('Black', report.black));
    return wrap;
  }

  private buildSparkline(report: GameReport): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analysis-spark';

    const n = report.moves.length;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${n} 100`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('spark-svg');

    // White-advantage band (top half) vs Black (bottom half), split at 50%.
    const mid = document.createElementNS(svgNS, 'line');
    mid.setAttribute('x1', '0');
    mid.setAttribute('y1', '50');
    mid.setAttribute('x2', String(n));
    mid.setAttribute('y2', '50');
    mid.setAttribute('class', 'spark-mid');
    svg.appendChild(mid);

    // Points: x=0 is the start (50%), x=i is the position after ply i.
    const pts: string[] = ['0,50'];
    report.moves.forEach((m, i) => {
      const y = 100 - whiteWinAfter(m); // SVG y grows downward; higher win% = higher up
      pts.push(`${i + 1},${y.toFixed(2)}`);
    });
    const line = document.createElementNS(svgNS, 'polyline');
    line.setAttribute('points', pts.join(' '));
    line.setAttribute('class', 'spark-line');
    svg.appendChild(line);

    const marker = document.createElementNS(svgNS, 'circle');
    marker.setAttribute('r', '1.6');
    marker.setAttribute('class', 'spark-marker');
    svg.appendChild(marker);
    this.marker = marker;

    // Click to jump to the nearest ply.
    svg.addEventListener('click', (e) => {
      const rect = svg.getBoundingClientRect();
      const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
      this.goTo(Math.round(ratio * n));
    });

    wrap.appendChild(svg);
    return wrap;
  }

  private buildStepper(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analysis-stepper-wrap';

    const bar = document.createElement('div');
    bar.className = 'analysis-stepper';
    bar.append(
      button('⏮', () => this.goTo(0), 'step'),
      button('◀', () => this.goTo(this.currentPly - 1), 'step'),
    );
    const label = document.createElement('span');
    label.className = 'analysis-ply-label';
    label.id = 'analysis-ply-label';
    bar.appendChild(label);
    bar.append(
      button('▶', () => this.goTo(this.currentPly + 1), 'step'),
      button('⏭', () => this.goTo(this.report ? this.report.moves.length : 0), 'step'),
    );

    // Best-move detail line (updated on every step).
    const detail = document.createElement('div');
    detail.className = 'analysis-detail';
    detail.id = 'analysis-detail';

    wrap.append(bar, detail);
    return wrap;
  }

  private buildScoresheet(report: GameReport): HTMLElement {
    const table = document.createElement('table');
    table.className = 'scoresheet';
    const body = document.createElement('tbody');

    for (let i = 0; i < report.moves.length; i += 2) {
      const row = document.createElement('tr');
      const moveNo = document.createElement('td');
      moveNo.className = 'sheet-no';
      moveNo.textContent = `${Math.floor(i / 2) + 1}.`;
      row.appendChild(moveNo);
      row.appendChild(this.moveCell(report.moves[i]));
      row.appendChild(report.moves[i + 1] ? this.moveCell(report.moves[i + 1]) : document.createElement('td'));
      body.appendChild(row);
    }
    table.appendChild(body);
    return table;
  }

  private moveCell(m: MoveAnalysis): HTMLElement {
    const td = document.createElement('td');
    td.className = 'sheet-move';
    const meta = CLASS_META[m.classification];
    const bestNote = !m.isBest && m.bestMoveSan ? ` · best ${m.bestMoveSan}` : '';
    td.title = `${meta.label} · ${m.accuracy.toFixed(1)}% accuracy · eval ${evalText(m)}${bestNote}`;

    const dot = document.createElement('span');
    dot.className = 'sheet-dot';
    dot.style.background = meta.color;

    const san = document.createElement('span');
    san.className = 'sheet-san';
    san.textContent = m.san;

    const ev = document.createElement('span');
    ev.className = 'sheet-eval';
    ev.textContent = evalText(m);

    td.append(dot, san, ev);
    td.addEventListener('click', () => this.goTo(m.ply));
    this.cellByPly.set(m.ply, td);
    return td;
  }

  // --- stepping --------------------------------------------------------------

  private goTo(ply: number): void {
    if (!this.report) return;
    const n = this.report.moves.length;
    this.currentPly = Math.max(0, Math.min(n, ply));

    const { fen, lastMove } = this.positionFor(this.currentPly);
    this.cb.onShowPosition(fen, lastMove, this.shapesFor(this.currentPly));

    // Highlight the active move cell.
    for (const [p, cell] of this.cellByPly) cell.classList.toggle('active', p === this.currentPly);

    // Update the ply label + the best-move detail line.
    const label = this.root.querySelector<HTMLSpanElement>('#analysis-ply-label');
    if (label) label.textContent = this.plyLabel(this.currentPly);
    this.updateDetail(this.currentPly);

    // Move the sparkline marker.
    if (this.marker) {
      if (this.currentPly === 0) {
        this.marker.setAttribute('cx', '0');
        this.marker.setAttribute('cy', '50');
      } else {
        const m = this.report.moves[this.currentPly - 1];
        this.marker.setAttribute('cx', String(this.currentPly));
        this.marker.setAttribute('cy', (100 - whiteWinAfter(m)).toFixed(2));
      }
    }
  }

  private positionFor(ply: number): { fen: string; lastMove?: [string, string] } {
    const moves = this.report?.moves ?? [];
    if (ply <= 0 || moves.length === 0) {
      return { fen: moves[0]?.fenBefore ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' };
    }
    const m = moves[ply - 1];
    return { fen: m.fenAfter, lastMove: m.lastMove };
  }

  private plyLabel(ply: number): string {
    if (!this.report || ply === 0) return 'Start position';
    const m = this.report.moves[ply - 1];
    const dots = m.mover === 'white' ? '.' : '…';
    const meta = CLASS_META[m.classification];
    return `${m.moveNumber}${dots} ${m.san} · ${meta.label} · ${m.accuracy.toFixed(0)}%`;
  }

  /** A green arrow for the engine's best move, shown when the played move wasn't best. */
  private shapesFor(ply: number): BoardShape[] {
    if (!this.report || ply === 0) return [];
    const m = this.report.moves[ply - 1];
    if (!m.isBest && m.bestMoveUci && m.bestMoveUci.length >= 4) {
      return [{ orig: m.bestMoveUci.slice(0, 2), dest: m.bestMoveUci.slice(2, 4), brush: 'green' }];
    }
    return [];
  }

  /** Update the "best move" detail line under the stepper for the given ply. */
  private updateDetail(ply: number): void {
    const el = this.root.querySelector<HTMLDivElement>('#analysis-detail');
    if (!el) return;
    el.replaceChildren();
    if (!this.report || ply === 0) return;
    const m = this.report.moves[ply - 1];
    if (m.isBest) {
      const span = document.createElement('span');
      span.className = 'detail-best';
      span.textContent = `★ Best move — ${m.san}`;
      el.appendChild(span);
      return;
    }
    if (m.bestMoveSan) {
      const played = document.createElement('span');
      played.textContent = `You played ${m.san}. `;
      const best = document.createElement('span');
      best.className = 'detail-suggest';
      best.textContent = `Best: ${m.bestMoveSan}`;
      el.append(played, best);
    }
  }

  private attachKeys(): void {
    this.detachKeys();
    this.keyHandler = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft') {
        this.goTo(this.currentPly - 1);
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        this.goTo(this.currentPly + 1);
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  private detachKeys(): void {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = undefined;
    }
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

function playerCard(name: string, p: import('../analysis/types').PlayerReport): HTMLElement {
  const card = document.createElement('div');
  card.className = 'player-card';

  const title = document.createElement('div');
  title.className = 'player-card-title';
  title.textContent = name;

  const acc = document.createElement('div');
  acc.className = 'player-acc';
  acc.style.color = accuracyColor(p.accuracy);
  acc.textContent = p.moveCount > 0 ? `${p.accuracy.toFixed(1)}%` : '—';

  const accLabel = document.createElement('div');
  accLabel.className = 'player-acc-label';
  accLabel.textContent = 'accuracy';

  const stats = document.createElement('div');
  stats.className = 'player-stats';
  stats.innerHTML =
    `<span title="Blunders" style="color:var(--danger)">✖ ${p.counts.blunder}</span>` +
    `<span title="Mistakes" style="color:#d19a66">● ${p.counts.mistake}</span>` +
    `<span title="Inaccuracies" style="color:var(--warn)">▲ ${p.counts.inaccuracy}</span>` +
    `<span title="Average centipawn loss" class="player-acpl">ACPL ${Math.round(p.acpl)}</span>`;

  card.append(title, acc, accLabel, stats);
  return card;
}
