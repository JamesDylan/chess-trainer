// Stage 4 Progress panel: renders a ProgressSnapshot (built by the pure src/coach
// layer) — a header dashboard, a hand-drawn SVG rating-over-time chart (same technique
// as analysisView's win% sparkline, no chart library), per-theme + per-phase
// strength/weakness lists with confidence notes, and the prioritised coaching insights
// with a "Drill this" action. It owns ONLY its own DOM and talks to the outside through
// callbacks; it never touches a board, the engine, or the stores. Reuses the existing
// design tokens / CSS classes.

import { COACH_THRESHOLDS } from '../coach';
import type {
  CoachingInsight,
  GamePhase,
  OpeningStat,
  PhaseStat,
  ProgressSnapshot,
  RatingPoint,
  ThemeStat,
} from '../coach';

export interface ProgressViewCallbacks {
  /** "Drill this" pressed — open the Puzzles tab filtered to this theme. */
  onDrill(theme: string): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export class ProgressView {
  private readonly root: HTMLElement;

  constructor(container: HTMLElement, private readonly cb: ProgressViewCallbacks) {
    this.root = document.createElement('section');
    this.root.className = 'progress';
    container.appendChild(this.root);
  }

  /** A transient status (e.g. loading) before the first snapshot. */
  showStatus(text: string): void {
    const p = document.createElement('p');
    p.className = 'progress-note';
    p.textContent = text;
    this.root.replaceChildren(p);
  }

  /** Render the full panel from a snapshot. */
  render(snapshot: ProgressSnapshot): void {
    if (!snapshot.hasData) {
      this.root.replaceChildren(this.headEl(), this.emptyEl());
      return;
    }
    this.root.replaceChildren(
      this.headEl(),
      this.dashboardEl(snapshot),
      this.ratingNoteEl(),
      this.chartEl(
        snapshot.puzzles.ratingSeries,
        'Puzzle rating over time',
        'Solve puzzles to start your rating curve.',
        'One attempt so far — solve a few more to see the trend.',
      ),
      ...(snapshot.gameRating.series.length >= 2
        ? [
            this.chartEl(
              snapshot.gameRating.series,
              'Playing rating over time (vs engine)',
              '',
              'Play a few games to see your playing-rating trend.',
            ),
          ]
        : []),
      ...(snapshot.insights.length > 0 ? [this.insightsEl(snapshot.insights)] : []),
      this.themesEl(snapshot.puzzles.themes),
      this.phasesEl(snapshot.games),
      this.openingsEl(snapshot.openings),
    );
  }

  /** A one-line explainer for why the two ratings differ (puzzles overstate strength). */
  private ratingNoteEl(): HTMLElement {
    const p = document.createElement('p');
    p.className = 'progress-note';
    p.textContent =
      'Puzzle rating measures tactics (you’re told a tactic is there), so it usually reads higher than your playing rating, which comes from your actual game results vs the engine. Games where you took a move back keep only a quarter of a win.';
    return p;
  }

  // --- builders --------------------------------------------------------------

  private headEl(): HTMLElement {
    const head = document.createElement('div');
    head.className = 'progress-head';
    const h2 = document.createElement('h2');
    h2.textContent = 'Progress';
    const sub = document.createElement('span');
    sub.className = 'progress-sub';
    sub.textContent = 'Where you stand, and what to train next.';
    const title = document.createElement('div');
    title.append(h2, sub);
    head.append(title);
    return head;
  }

  private emptyEl(): HTMLElement {
    const p = document.createElement('p');
    p.className = 'progress-note';
    p.textContent =
      'Play and analyse a game, and solve a few puzzles, to unlock your progress dashboard and coaching.';
    return p;
  }

  private dashboardEl(s: ProgressSnapshot): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'progress-dash';

    const puzzleRating = statCard(
      String(s.rating.value),
      s.rating.provisional ? 'puzzle rating (prov.)' : 'puzzle rating',
    );
    puzzleRating.title = `Tactics rating (Glicko-2) · RD ${s.rating.rd}${s.rating.provisional ? ' — still settling' : ' — established'}`;

    const gr = s.gameRating;
    const playing = statCard(
      gr.games > 0 ? String(gr.value) : '—',
      gr.provisional ? 'playing rating (prov.)' : 'playing rating',
    );
    playing.title =
      gr.games > 0
        ? `Classic Elo from ${gr.games} finished game(s) vs the engine`
        : 'Finish some games to estimate your playing rating';

    wrap.append(
      puzzleRating,
      playing,
      statCard(String(s.puzzlesSolved), 'puzzles solved'),
      statCard(`${s.currentStreak}`, `streak · best ${s.bestStreak}`),
      statCard(String(s.gamesPlayed), s.games.analyzedGames > 0 ? `games · ${s.games.analyzedGames} analysed` : 'games played'),
      statCard(
        s.overallGameAccuracy !== undefined ? `${s.overallGameAccuracy.toFixed(0)}%` : '—',
        'game accuracy',
      ),
    );
    return wrap;
  }

  /** Hand-drawn SVG rating curve (no chart library) — mirrors the analysis sparkline.
   *  Reused for both the puzzle-rating and playing-rating series (only `.rating` is read). */
  private chartEl(
    series: readonly { rating: number }[],
    captionText: string,
    emptyNone: string,
    emptyOne: string,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'progress-chart';

    const caption = document.createElement('div');
    caption.className = 'progress-chart-caption';
    caption.textContent = captionText;
    wrap.appendChild(caption);

    if (series.length < 2) {
      const note = document.createElement('p');
      note.className = 'progress-note';
      note.textContent = series.length === 0 ? emptyNone : emptyOne;
      wrap.appendChild(note);
      return wrap;
    }

    const n = series.length;
    const ratings = series.map((p) => p.rating);
    const min = Math.min(...ratings);
    const max = Math.max(...ratings);
    const pad = Math.max(20, (max - min) * 0.15);
    const lo = min - pad;
    const span = max + pad - lo || 1;
    const x = (i: number): number => (i / (n - 1)) * 100;
    const y = (r: number): number => 100 - ((r - lo) / span) * 100;

    const plot = document.createElement('div');
    plot.className = 'progress-plot';

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('progress-svg');

    const line = document.createElementNS(SVG_NS, 'polyline');
    line.setAttribute('points', series.map((p, i) => `${x(i).toFixed(2)},${y(p.rating).toFixed(2)}`).join(' '));
    line.setAttribute('class', 'spark-line');
    svg.appendChild(line);

    const marker = document.createElementNS(SVG_NS, 'circle');
    marker.setAttribute('cx', x(n - 1).toFixed(2));
    marker.setAttribute('cy', y(series[n - 1].rating).toFixed(2));
    marker.setAttribute('r', '2.5');
    marker.setAttribute('class', 'spark-marker');
    svg.appendChild(marker);

    const hi = document.createElement('span');
    hi.className = 'progress-axis progress-axis-hi';
    hi.textContent = String(Math.round(max));
    const loLabel = document.createElement('span');
    loLabel.className = 'progress-axis progress-axis-lo';
    loLabel.textContent = String(Math.round(min));

    plot.append(svg, hi, loLabel);
    wrap.appendChild(plot);
    return wrap;
  }

  private insightsEl(insights: CoachingInsight[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'progress-section';
    wrap.appendChild(sectionTitle('Coaching', 'What to work on, in priority order'));

    const list = document.createElement('div');
    list.className = 'insight-list';
    for (const ins of insights) list.appendChild(this.insightCard(ins));
    wrap.appendChild(list);
    return wrap;
  }

  private insightCard(ins: CoachingInsight): HTMLElement {
    const card = document.createElement('div');
    card.className = 'insight-card';

    const badge = document.createElement('span');
    badge.className = 'insight-priority';
    badge.textContent = String(ins.priority);

    const body = document.createElement('div');
    body.className = 'insight-body';
    const title = document.createElement('div');
    title.className = 'insight-title';
    title.textContent = ins.title;
    const detail = document.createElement('div');
    detail.className = 'insight-detail';
    detail.textContent = ins.detail;
    const rec = document.createElement('div');
    rec.className = 'insight-rec';
    rec.textContent = ins.recommendation;
    body.append(title, detail, rec);

    card.append(badge, body);

    if (ins.drillTheme) {
      const theme = ins.drillTheme;
      const drill = document.createElement('button');
      drill.type = 'button';
      drill.className = 'insight-drill';
      drill.textContent = 'Drill this';
      drill.title = `Open the Puzzles tab filtered to "${theme}"`;
      drill.addEventListener('click', () => this.cb.onDrill(theme));
      card.appendChild(drill);
    }
    return card;
  }

  private themesEl(themes: ThemeStat[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'progress-section';
    wrap.appendChild(sectionTitle('By theme', `Puzzle solve-rate (≥ ${COACH_THRESHOLDS.minThemeAttempts} tries shown)`));

    const trusted = themes.filter((t) => t.attempts >= COACH_THRESHOLDS.minThemeAttempts).slice(0, 8);
    if (trusted.length === 0) {
      wrap.appendChild(note('Solve more puzzles across themes — per-theme stats appear once a theme has enough attempts.'));
      return wrap;
    }
    const list = document.createElement('div');
    list.className = 'stat-rows';
    for (const t of trusted) {
      list.appendChild(
        statRow({
          label: t.theme,
          valueText: `${Math.round(t.solveRate * 100)}%`,
          fraction: t.solveRate,
          sub: `${t.solved}/${t.attempts} · ${t.confidence} confidence`,
          tone: themeTone(t.solveRate),
        }),
      );
    }
    wrap.appendChild(list);
    return wrap;
  }

  private phasesEl(games: ProgressSnapshot['games']): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'progress-section';
    wrap.appendChild(sectionTitle('By game phase', 'Your accuracy from analysed games'));

    if (games.analyzedGames === 0) {
      wrap.appendChild(note('Analyse a saved game (Play tab → Analyze) to see opening / middlegame / endgame accuracy.'));
      return wrap;
    }
    const active = games.phases.filter((p) => p.moves > 0);
    if (active.length === 0) {
      wrap.appendChild(note('No classified moves yet.'));
      return wrap;
    }
    const list = document.createElement('div');
    list.className = 'stat-rows';
    for (const p of active) {
      list.appendChild(
        statRow({
          label: phaseLabel(p.phase),
          valueText: `${p.accuracy.toFixed(0)}%`,
          fraction: p.accuracy / 100,
          sub: `${p.moves} moves · ${p.blunders} blunders · ${p.confidence} confidence`,
          tone: phaseTone(p.accuracy),
        }),
      );
    }
    wrap.appendChild(list);
    return wrap;
  }

  private openingsEl(openings: OpeningStat[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'progress-section';
    wrap.appendChild(sectionTitle('By opening', 'Your results, most-played first'));

    if (openings.length === 0) {
      wrap.appendChild(note('Finish some games (any result) to see win/loss by opening.'));
      return wrap;
    }
    const list = document.createElement('div');
    list.className = 'stat-rows';
    for (const o of openings.slice(0, 10)) {
      const acc = o.accuracy !== undefined ? ` · ${o.accuracy.toFixed(0)}% acc` : '';
      list.appendChild(
        statRow({
          label: o.eco ? `${o.name} (${o.eco})` : o.name,
          valueText: `${Math.round(o.score * 100)}%`,
          fraction: o.score,
          sub: `${o.games} games · ${o.wins}W ${o.losses}L ${o.draws}D${acc}`,
          tone: openingTone(o.score),
        }),
      );
    }
    wrap.appendChild(list);
    return wrap;
  }
}

// --- small DOM helpers -------------------------------------------------------

type Tone = 'weak' | 'ok' | 'strong';

function statCard(value: string, label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'dash-card';
  const v = document.createElement('span');
  v.className = 'dash-value';
  v.textContent = value;
  const l = document.createElement('span');
  l.className = 'dash-label';
  l.textContent = label;
  el.append(v, l);
  return el;
}

function sectionTitle(title: string, sub: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'progress-section-head';
  const h = document.createElement('h3');
  h.textContent = title;
  const s = document.createElement('span');
  s.className = 'progress-section-sub';
  s.textContent = sub;
  el.append(h, s);
  return el;
}

function note(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'progress-note';
  p.textContent = text;
  return p;
}

function statRow(opts: { label: string; valueText: string; fraction: number; sub: string; tone: Tone }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stat-row';

  const top = document.createElement('div');
  top.className = 'stat-row-top';
  const label = document.createElement('span');
  label.className = 'stat-row-label';
  label.textContent = opts.label;
  const value = document.createElement('span');
  value.className = `stat-row-value tone-${opts.tone}`;
  value.textContent = opts.valueText;
  top.append(label, value);

  const bar = document.createElement('div');
  bar.className = 'stat-bar';
  const fill = document.createElement('div');
  fill.className = `stat-bar-fill tone-${opts.tone}`;
  fill.style.width = `${Math.max(0, Math.min(100, opts.fraction * 100))}%`;
  bar.appendChild(fill);

  const sub = document.createElement('span');
  sub.className = 'stat-row-sub';
  sub.textContent = opts.sub;

  row.append(top, bar, sub);
  return row;
}

function themeTone(solveRate: number): Tone {
  if (solveRate < COACH_THRESHOLDS.weakThemeSolveRate) return 'weak';
  if (solveRate >= COACH_THRESHOLDS.strongThemeSolveRate) return 'strong';
  return 'ok';
}

function phaseTone(accuracy: number): Tone {
  if (accuracy < COACH_THRESHOLDS.weakPhaseAccuracy) return 'weak';
  if (accuracy >= COACH_THRESHOLDS.strongPhaseAccuracy) return 'strong';
  return 'ok';
}

function openingTone(score: number): Tone {
  if (score < COACH_THRESHOLDS.weakOpeningScore) return 'weak';
  if (score >= COACH_THRESHOLDS.strongOpeningScore) return 'strong';
  return 'ok';
}

function phaseLabel(phase: GamePhase): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}
