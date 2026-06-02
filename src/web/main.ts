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
import { analyzeGame, AnalysisCancelled, IndexedDbAnalysisStore, InMemoryAnalysisStore } from '../analysis';
import type { AnalysisStore } from '../analysis';
import { BoardView, type Side } from './boardView';
import { GameController, type StatusKind } from './gameController';
import { AnalysisView } from './analysisView';
import {
  DEFAULT_STRENGTH,
  STRENGTH_CHOICES,
  engineWorkerUrl,
  ANALYSIS_DEPTH,
  ANALYSIS_SEARCH_TIMEOUT_MS,
} from './config';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app not found');

app.innerHTML = `
  <main class="layout">
    <h1>Chess Trainer</h1>
    <p class="subtitle">Play vs Stockfish — offline, in your browser.</p>

    <section class="controls" aria-label="Game controls">
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
      <button id="save-game" type="button" class="secondary" disabled>Save</button>
      <button id="resign" type="button" class="secondary" disabled>Resign</button>
    </section>

    <p id="status" class="status" role="status" aria-live="polite">Loading engine…</p>

    <div class="board-wrap">
      <div id="board" class="cg-wrap"></div>
    </div>

    <div id="analysis-root" class="analysis-root"></div>

    <section class="history" aria-label="Saved games">
      <div class="history-head">
        <h2>Saved games (<span id="history-count">0</span>)</h2>
        <button id="clear-history" type="button">Clear all</button>
      </div>
      <ul id="history-list" class="history-list"></ul>
    </section>
  </main>
`;

const strengthEl = document.querySelector<HTMLSelectElement>('#strength')!;
const sideEl = document.querySelector<HTMLSelectElement>('#side')!;
const newGameEl = document.querySelector<HTMLButtonElement>('#new-game')!;
const saveGameEl = document.querySelector<HTMLButtonElement>('#save-game')!;
const resignEl = document.querySelector<HTMLButtonElement>('#resign')!;
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
});

// --- Stage 2: analysis -------------------------------------------------------

// Cache computed reports so re-opening one is instant. Separate IndexedDB store
// (its own database) — it does NOT touch the games store.
const analysisStore: AnalysisStore =
  typeof indexedDB !== 'undefined' ? new IndexedDbAnalysisStore() : new InMemoryAnalysisStore();

const analysisRootEl = document.querySelector<HTMLDivElement>('#analysis-root')!;
let currentAnalysisOrientation: Side = 'white';
const analysisView = new AnalysisView(analysisRootEl, {
  onShowPosition: (fen, lastMove) =>
    controller.reviewPosition(fen, { lastMove, orientation: currentAnalysisOrientation }),
  onClose: () => {
    analysisView.hide();
    setStatus('Analysis closed — start a New game or Resume one from the list.', 'info');
  },
  onCancel: () => {
    cancelAnalysis = true;
  },
});

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
  const meta = { strengthElo: game.strengthElo, humanColor: game.humanColor };
  try {
    // Instant re-open from cache when the saved game's moves are unchanged.
    const cached = await analysisStore.get(game.id).catch(() => undefined);
    if (cached && cached.pgn === game.pgn) {
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
      analysisView.hide();
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
  analysisView.hide();
  void controller.newGame(selectedSide(), selectedElo());
});
saveGameEl.addEventListener('click', () => void controller.save());
resignEl.addEventListener('click', () => void controller.resign());
clearHistoryEl.addEventListener('click', () => {
  analysisView.hide();
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
  meta.innerHTML = `
    <span class="${labelClass}">${label}</span>
    <span class="history-detail">vs ~${game.strengthElo} Elo · you ${game.humanColor} · ${when}</span>
  `;

  const actions = document.createElement('div');
  actions.className = 'history-actions';

  const primaryBtn = document.createElement('button');
  primaryBtn.type = 'button';
  if (game.inProgress) {
    primaryBtn.textContent = 'Resume';
    primaryBtn.addEventListener('click', () => {
      analysisView.hide();
      sideEl.value = game.humanColor;
      strengthEl.value = String(game.strengthElo);
      void controller.resume(game);
    });
  } else {
    primaryBtn.textContent = 'View';
    primaryBtn.addEventListener('click', () => {
      analysisView.hide();
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
    await controller.newGame(selectedSide(), selectedElo());
  } catch (err) {
    setStatus(`Could not load the engine: ${(err as Error).message}`, 'error');
  }
}

void boot();
