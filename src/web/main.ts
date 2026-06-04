// App entry: build the DOM, boot the WASM engine in a Web Worker, and wire the
// board + strength control + saved-games list to the GameController.

import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import './styles.css';

import { createWorkerEngine } from '../engine/workerEngine';
import type { UciEngine } from '../engine/uciEngine';
import { IndexedDbGameRepository, InMemoryGameRepository } from '../persistence';
import type { GameRepository, SavedGame } from '../persistence';
import {
  analyzeGame,
  AnalysisCancelled,
  ANALYSIS_REPORT_VERSION,
  IndexedDbAnalysisStore,
  InMemoryAnalysisStore,
} from '../analysis';
import type { AnalysisStore } from '../analysis';
import { InMemoryPuzzleStore, IndexedDbPuzzleStore, loadPuzzlesFromJson } from '../puzzles';
import type { PuzzleStore } from '../puzzles';
import { BoardView, type Side } from './boardView';
import { GameController, type StatusKind } from './gameController';
import { AnalysisView } from './analysisView';
import { PuzzleController } from './puzzleController';
import { PuzzleView } from './puzzleView';
import { copyText } from './clipboard';
import { capturedBy, advantageFor, PIECE_TYPES, type CapturedCount } from './material';
import {
  DEFAULT_STRENGTH,
  STRENGTH_CHOICES,
  engineWorkerUrl,
  ANALYSIS_DEPTH,
  ANALYSIS_SEARCH_TIMEOUT_MS,
  puzzlesUrl,
} from './config';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app not found');

app.innerHTML = `
  <main class="layout">
    <h1>Chess Trainer</h1>
    <p class="subtitle">Play vs Stockfish — offline, in your browser.</p>

    <nav class="tabs" aria-label="Mode">
      <button id="tab-play" class="tab active" type="button" aria-selected="true">Play</button>
      <button id="tab-puzzles" class="tab" type="button" aria-selected="false">Puzzles</button>
    </nav>

    <div id="play-view">
    <section class="controls setup" aria-label="Game setup">
      <label>Strength
        <select id="strength"></select>
      </label>
      <label>You play
        <select id="side">
          <option value="white">White</option>
          <option value="black">Black</option>
        </select>
      </label>
      <button id="new-game" type="button" disabled>New game</button>
    </section>

    <p id="status" class="status" role="status" aria-live="polite">Loading engine…</p>

    <div class="play-area">
      <div class="board-col">
        <div class="captured" id="captured-top" aria-hidden="true"></div>
        <div class="board-wrap">
          <div id="board" class="cg-wrap"></div>
        </div>
        <div class="captured" id="captured-bottom" aria-hidden="true"></div>

        <div class="toolbar">
          <div class="nav-group" role="group" aria-label="Move navigation">
            <button id="nav-first" type="button" class="icon" title="First move" disabled>⏮</button>
            <button id="nav-back" type="button" class="icon" title="Back (←)" disabled>◀</button>
            <span id="nav-indicator" class="nav-indicator">0 / 0</span>
            <button id="nav-forward" type="button" class="icon" title="Forward (→)" disabled>▶</button>
            <button id="nav-last" type="button" class="icon" title="Latest move" disabled>⏭</button>
          </div>
          <div class="action-group">
            <button id="undo" type="button" class="secondary" disabled>Undo</button>
            <button id="save-game" type="button" class="secondary" disabled>Save</button>
            <button id="resign" type="button" class="secondary" disabled>Resign</button>
          </div>
          <div class="export-group">
            <button id="copy-fen" type="button" class="ghost" title="Copy this position's FEN" disabled>FEN</button>
            <button id="copy-pgn" type="button" class="ghost" title="Copy the game's PGN" disabled>PGN</button>
          </div>
        </div>
      </div>
      <div id="analysis-root" class="analysis-root"></div>
    </div>

    <section class="history" aria-label="Saved games">
      <div class="history-head">
        <h2>Saved games (<span id="history-count">0</span>)</h2>
        <button id="clear-history" type="button">Clear all</button>
      </div>
      <ul id="history-list" class="history-list"></ul>
    </section>
    </div>

    <section id="puzzle-view" hidden aria-label="Puzzles">
      <div class="puzzle-area">
        <div class="board-col">
          <div class="board-wrap">
            <div id="puzzle-board" class="cg-wrap"></div>
          </div>
        </div>
        <div id="puzzle-panel" class="puzzle-panel"></div>
      </div>
    </section>
  </main>
`;

const strengthEl = document.querySelector<HTMLSelectElement>('#strength')!;
const sideEl = document.querySelector<HTMLSelectElement>('#side')!;
const newGameEl = document.querySelector<HTMLButtonElement>('#new-game')!;
const saveGameEl = document.querySelector<HTMLButtonElement>('#save-game')!;
const undoEl = document.querySelector<HTMLButtonElement>('#undo')!;
const resignEl = document.querySelector<HTMLButtonElement>('#resign')!;
const navFirstEl = document.querySelector<HTMLButtonElement>('#nav-first')!;
const navBackEl = document.querySelector<HTMLButtonElement>('#nav-back')!;
const navForwardEl = document.querySelector<HTMLButtonElement>('#nav-forward')!;
const navLastEl = document.querySelector<HTMLButtonElement>('#nav-last')!;
const navIndicatorEl = document.querySelector<HTMLSpanElement>('#nav-indicator')!;
const capturedTopEl = document.querySelector<HTMLDivElement>('#captured-top')!;
const capturedBottomEl = document.querySelector<HTMLDivElement>('#captured-bottom')!;
const copyFenEl = document.querySelector<HTMLButtonElement>('#copy-fen')!;
const copyPgnEl = document.querySelector<HTMLButtonElement>('#copy-pgn')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const boardEl = document.querySelector<HTMLDivElement>('#board')!;
const historyListEl = document.querySelector<HTMLUListElement>('#history-list')!;
const historyCountEl = document.querySelector<HTMLSpanElement>('#history-count')!;
const clearHistoryEl = document.querySelector<HTMLButtonElement>('#clear-history')!;

// Strength dropdown.
for (const elo of STRENGTH_CHOICES) {
  const opt = document.createElement('option');
  opt.value = String(elo);
  opt.textContent = `~${elo} Elo`;
  if (elo === DEFAULT_STRENGTH) opt.selected = true;
  strengthEl.appendChild(opt);
}

function setStatus(text: string, kind: StatusKind): void {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

// Captured-piece glyphs (filled silhouettes; coloured uniformly via CSS).
const PIECE_GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };

/** Render a row of captured pieces (opponent's lost pieces) + a "+N" point lead. */
function renderCaptured(el: HTMLElement, captured: CapturedCount, advantage: number): void {
  let html = '';
  for (const type of PIECE_TYPES) {
    for (let i = 0; i < captured[type]; i += 1) {
      html += `<span class="cap-piece">${PIECE_GLYPH[type]}</span>`;
    }
  }
  if (advantage > 0) html += `<span class="cap-adv">+${advantage}</span>`;
  el.innerHTML = html;
}

// Persistence: IndexedDB in the browser, with an in-memory fallback if unavailable.
const repo: GameRepository =
  typeof indexedDB !== 'undefined' ? new IndexedDbGameRepository() : new InMemoryGameRepository();

// Board + controller. `controller` is referenced lazily inside the board callback,
// so creating the board first (before controller exists) is safe.
let controller: GameController;
const board = new BoardView(boardEl, 'white', (from, to) => {
  void controller.handleUserMove(from, to);
});
controller = new GameController(board, repo, {
  onStatus: setStatus,
  onGameSaved: () => void refreshHistory(),
  onViewUpdate: (v) => {
    undoEl.disabled = !v.canUndo;
    navFirstEl.disabled = !v.canBack;
    navBackEl.disabled = !v.canBack;
    navForwardEl.disabled = !v.canForward;
    navLastEl.disabled = !v.canForward;
    navIndicatorEl.textContent = `${v.ply} / ${v.totalPlies}`;
    const opponent: Side = v.orientation === 'white' ? 'black' : 'white';
    renderCaptured(capturedBottomEl, capturedBy(v.material, v.orientation), advantageFor(v.material, v.orientation));
    renderCaptured(capturedTopEl, capturedBy(v.material, opponent), advantageFor(v.material, opponent));
  },
});

// Puzzles: built lazily on first visit to the Puzzles tab (see initPuzzles below).
// Declared here so the keyboard handler can route the arrow keys to it.
let puzzlesInited = false;
let puzzleController: PuzzleController | null = null;

// --- Stage 2: analysis -------------------------------------------------------

// Cache computed reports so re-opening one is instant. Separate IndexedDB store
// (its own database) — it does NOT touch the games store.
const analysisStore: AnalysisStore =
  typeof indexedDB !== 'undefined' ? new IndexedDbAnalysisStore() : new InMemoryAnalysisStore();

const analysisRootEl = document.querySelector<HTMLDivElement>('#analysis-root')!;
const layoutEl = document.querySelector<HTMLElement>('.layout')!;
let currentAnalysisOrientation: Side = 'white';
const analysisView = new AnalysisView(analysisRootEl, {
  onShowPosition: (fen, lastMove, shapes) =>
    controller.reviewPosition(fen, { lastMove, orientation: currentAnalysisOrientation, shapes }),
  onClose: () => {
    hideAnalysis();
    setStatus('Analysis closed — start a New game or Resume one from the list.', 'info');
  },
  onCancel: () => {
    cancelAnalysis = true;
  },
});

// Widen the page into the two-column (board | report) layout while analysis is
// visible; collapse back to the single-column play view when it is hidden.
function hideAnalysis(): void {
  analysisView.hide();
  layoutEl.classList.remove('analyzing');
}

// A dedicated, full-strength analysis engine (its own Web Worker), booted lazily on
// first use so it never slows the initial page load or the play engine.
let analysisEngine: UciEngine | null = null;
async function getAnalysisEngine(): Promise<UciEngine> {
  if (!analysisEngine) {
    analysisEngine = await createWorkerEngine(engineWorkerUrl(), {
      searchTimeoutMs: ANALYSIS_SEARCH_TIMEOUT_MS,
    });
  }
  return analysisEngine;
}

let analyzing = false;
let cancelAnalysis = false;

async function analyzeSavedGame(game: SavedGame): Promise<void> {
  if (analyzing) return; // one analysis at a time (single shared board)
  analyzing = true;
  cancelAnalysis = false;
  currentAnalysisOrientation = game.humanColor;
  layoutEl.classList.add('analyzing'); // two-column layout: board | report
  const meta = { strengthElo: game.strengthElo, humanColor: game.humanColor };
  try {
    // Instant re-open from cache when the saved game's moves are unchanged AND the
    // cached report matches the current report schema (else recompute).
    const cached = await analysisStore.get(game.id).catch(() => undefined);
    if (cached && cached.pgn === game.pgn && cached.version === ANALYSIS_REPORT_VERSION) {
      analysisView.render(cached, meta);
      return;
    }
    analysisView.showProgress(0, 0);
    const engine = await getAnalysisEngine();
    const report = await analyzeGame(game.pgn, engine, {
      depth: ANALYSIS_DEPTH,
      onProgress: (done, total) => analysisView.showProgress(done, total),
      shouldCancel: () => cancelAnalysis,
    });
    await analysisStore.put(game.id, report).catch(() => {
      /* caching is best-effort */
    });
    analysisView.render(report, meta);
  } catch (err) {
    if (err instanceof AnalysisCancelled) {
      hideAnalysis();
      setStatus('Analysis cancelled.', 'info');
    } else {
      analysisView.showError(`Analysis failed: ${(err as Error).message}`);
    }
  } finally {
    analyzing = false;
  }
}

function selectedSide(): Side {
  return sideEl.value === 'black' ? 'black' : 'white';
}
function selectedElo(): number {
  return Number(strengthEl.value) || DEFAULT_STRENGTH;
}

strengthEl.addEventListener('change', () => controller.setStrengthElo(selectedElo()));
newGameEl.addEventListener('click', () => {
  hideAnalysis();
  void controller.newGame(selectedSide(), selectedElo());
});
saveGameEl.addEventListener('click', () => void controller.save());
undoEl.addEventListener('click', () => void controller.undo());
resignEl.addEventListener('click', () => void controller.resign());

navFirstEl.addEventListener('click', () => controller.navToStart());
navBackEl.addEventListener('click', () => controller.navBackward());
navForwardEl.addEventListener('click', () => controller.navForward());
navLastEl.addEventListener('click', () => controller.navToEnd());

async function exportText(label: string, text: string): Promise<void> {
  const ok = await copyText(text);
  setStatus(ok ? `${label} copied to clipboard.` : `${label}: ${text}`, 'info');
}
copyFenEl.addEventListener('click', () => void exportText('FEN', controller.currentFen()));
copyPgnEl.addEventListener('click', () => void exportText('PGN', controller.currentPgn()));

// Keyboard navigation (← / →) while playing. Ignored while typing in a control, or
// while the analysis stepper owns the arrows (controller.canNavigate() is false then).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const tag = (document.activeElement?.tagName ?? '').toUpperCase();
  if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
  const pv = document.querySelector<HTMLElement>('#puzzle-view');
  if (pv && !pv.hidden) {
    // In the Puzzles tab, the arrows step through the puzzle line.
    if (!puzzleController) return;
    if (e.key === 'ArrowLeft') puzzleController.navBack();
    else puzzleController.navForward();
    e.preventDefault();
    return;
  }
  if (!controller.canNavigate()) return;
  if (e.key === 'ArrowLeft') controller.navBackward();
  else controller.navForward();
  e.preventDefault();
});
clearHistoryEl.addEventListener('click', () => {
  hideAnalysis();
  void repo
    .clear()
    .then(() => analysisStore.clear().catch(() => {}))
    .then(refreshHistory);
});

async function refreshHistory(): Promise<void> {
  let games: SavedGame[] = [];
  try {
    games = await repo.list();
  } catch {
    /* ignore listing errors in the UI */
  }
  historyCountEl.textContent = String(games.length);
  historyListEl.replaceChildren(...games.map(renderHistoryRow));
}

function renderHistoryRow(game: SavedGame): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'history-row';

  const meta = document.createElement('div');
  meta.className = 'history-meta';
  const when = new Date(game.playedAt).toLocaleString();
  const label = game.inProgress ? 'in progress' : game.result;
  const labelClass = game.inProgress ? 'history-result inprogress' : 'history-result';
  // Asterisk marks games where the player took a move back.
  const undoMark = game.undoUsed ? '<span class="undo-mark" title="Undo used in this game">*</span>' : '';
  meta.innerHTML = `
    <span class="${labelClass}">${label}${undoMark}</span>
    <span class="history-detail">vs ~${game.strengthElo} Elo · you ${game.humanColor} · ${when}</span>
  `;

  const actions = document.createElement('div');
  actions.className = 'history-actions';

  const primaryBtn = document.createElement('button');
  primaryBtn.type = 'button';
  if (game.inProgress) {
    primaryBtn.textContent = 'Resume';
    primaryBtn.addEventListener('click', () => {
      hideAnalysis();
      sideEl.value = game.humanColor;
      strengthEl.value = String(game.strengthElo);
      void controller.resume(game);
    });
  } else {
    primaryBtn.textContent = 'View';
    primaryBtn.addEventListener('click', () => {
      hideAnalysis();
      controller.viewPgn(game.pgn);
    });
  }

  const analyzeBtn = document.createElement('button');
  analyzeBtn.type = 'button';
  analyzeBtn.className = 'secondary';
  analyzeBtn.textContent = 'Analyze';
  analyzeBtn.addEventListener('click', () => void analyzeSavedGame(game));

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'danger';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', () =>
    void repo
      .delete(game.id)
      .then(() => analysisStore.delete(game.id).catch(() => {}))
      .then(refreshHistory),
  );

  actions.append(primaryBtn, analyzeBtn, delBtn);
  li.append(meta, actions);
  return li;
}

// --- Stage 3: puzzles tab ----------------------------------------------------

const tabPlayEl = document.querySelector<HTMLButtonElement>('#tab-play')!;
const tabPuzzlesEl = document.querySelector<HTMLButtonElement>('#tab-puzzles')!;
const playViewEl = document.querySelector<HTMLDivElement>('#play-view')!;
const puzzleViewEl = document.querySelector<HTMLElement>('#puzzle-view')!;

function showTab(tab: 'play' | 'puzzles'): void {
  const puzzles = tab === 'puzzles';
  playViewEl.hidden = puzzles;
  puzzleViewEl.hidden = !puzzles;
  tabPlayEl.classList.toggle('active', !puzzles);
  tabPuzzlesEl.classList.toggle('active', puzzles);
  tabPlayEl.setAttribute('aria-selected', String(!puzzles));
  tabPuzzlesEl.setAttribute('aria-selected', String(puzzles));
  if (puzzles) void initPuzzles();
}

// Built lazily on first visit to the Puzzles tab: a SEPARATE board + controller, so
// the play view (engine, persistence, analysis) is never touched. Creating the board
// only once its container is visible lets chessground size itself correctly.
async function initPuzzles(): Promise<void> {
  if (puzzlesInited) return;
  puzzlesInited = true;

  const puzzleBoardEl = document.querySelector<HTMLDivElement>('#puzzle-board')!;
  const puzzlePanelEl = document.querySelector<HTMLDivElement>('#puzzle-panel')!;

  const puzzleBoard = new BoardView(puzzleBoardEl, 'white', (from, to) => {
    void puzzleController?.handleUserMove(from, to);
  });

  // Puzzle progress lives in its OWN IndexedDB database (see IndexedDbPuzzleStore).
  const puzzleStore: PuzzleStore =
    typeof indexedDB !== 'undefined' ? new IndexedDbPuzzleStore() : new InMemoryPuzzleStore();

  const puzzleView = new PuzzleView(puzzlePanelEl, {
    onNext: () => puzzleController?.startNext(),
    onHint: () => puzzleController?.hint(),
    onTheme: (t) => puzzleController?.setTheme(t),
    onBack: () => puzzleController?.navBack(),
    onForward: () => puzzleController?.navForward(),
  });

  puzzleController = new PuzzleController(puzzleBoard, puzzleStore, {
    onState: (s) => puzzleView.render(s),
    onStatus: (t, k) => puzzleView.showStatus(t, k),
  });

  puzzleView.showStatus('Loading puzzles…', 'thinking');
  await puzzleController.init(); // load saved rating/streak (won't start until puzzles arrive)
  try {
    const res = await fetch(puzzlesUrl());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const puzzles = loadPuzzlesFromJson(await res.text());
    if (puzzles.length === 0) throw new Error('the puzzle asset is empty');
    puzzleController.setPuzzles(puzzles);
  } catch (err) {
    puzzleView.showStatus(
      `Could not load puzzles: ${(err as Error).message}. Run \`npm run build-puzzles\` to generate public/puzzles/puzzles.json.`,
      'error',
    );
  }
}

tabPlayEl.addEventListener('click', () => showTab('play'));
tabPuzzlesEl.addEventListener('click', () => showTab('puzzles'));

// Boot the engine, then enable play.
async function boot(): Promise<void> {
  setStatus('Loading engine… (first load fetches the WASM once)', 'thinking');
  await refreshHistory();
  try {
    const engine = await createWorkerEngine(engineWorkerUrl());
    controller.attachEngine(engine);
    newGameEl.disabled = false;
    saveGameEl.disabled = false;
    resignEl.disabled = false;
    copyFenEl.disabled = false;
    copyPgnEl.disabled = false;
    await controller.newGame(selectedSide(), selectedElo());
  } catch (err) {
    setStatus(`Could not load the engine: ${(err as Error).message}`, 'error');
  }
}

void boot();
