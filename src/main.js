import './style.css';
import { Exercise } from './exercise.js';
import * as settings from './settings.js';
import * as idb from './idb.js';
import { openSet, randomPuzzle, inspectSet } from './sqlsets.js';
import { buildSet, saveSqliteFile, MAX_SAFE_PUZZLES } from './builder.js';
import { TopBar } from './layout.js';

const $ = (id) => document.getElementById(id);
const els = {
  appHeader: $('app-header'),
  headerBody: $('header-body'),
  topbar: $('topbar'),
  drawerToggle: $('drawer-toggle'),
  setSelect: $('set-select'),
  plyBack: $('ply-back'),
  btnBuilder: $('btn-builder'),
  btnNew: $('btn-new'),
  btnReveal: $('btn-reveal'),
  score: $('score'),
  scoreStrip: $('score-strip'),
  builder: $('builder'),
  csvFile: $('csv-file'),
  ratingMin: $('rating-min'),
  ratingMax: $('rating-max'),
  puzzleCount: $('puzzle-count'),
  setName: $('set-name'),
  btnBuild: $('btn-build'),
  buildProgress: $('build-progress'),
  setList: $('set-list'),
  importFile: $('import-file'),
  builderMsg: $('builder-msg'),
};

let activeDb = null;
let activeSetId = null;
let busy = false;

/* ---------- mobile layout ---------- */

// On a narrow screen the header is an auto-hidden drawer: only the top bar
// (settings handle + solving controls) stays on screen, until this is dragged
// down. See src/layout.js and the mobile section of src/style.css.
const topBar = new TopBar({
  headerEl: els.appHeader,
  bodyEl: els.headerBody,
  topbarEl: els.topbar,
  handleEl: els.drawerToggle,
});

const exercise = new Exercise({
  boardEl: $('board'),
  tableEl: $('move-table'),
  infoEl: $('puzzle-info'),
  errorEl: $('error-box'),
  revealBtn: els.btnReveal,
  onResult: (solved) => {
    settings.pushResult(solved);
    renderScore();
  },
});

/* ---------- score strip ---------- */

function renderScore() {
  const results = settings.getResults();
  const solved = results.filter(Boolean).length;
  const failed = results.length - solved;
  els.score.textContent = results.length ? `Solved ${solved} · Failed ${failed}` : '';
  els.scoreStrip.innerHTML = '';
  for (const ok of results.slice(-60)) {
    const sq = document.createElement('span');
    sq.className = 'sq-result ' + (ok ? 'ok' : 'bad');
    sq.title = ok ? 'Solved' : 'Failed';
    els.scoreStrip.appendChild(sq);
  }
}

/* ---------- puzzle sets ---------- */

function setLabel(s) {
  return `${s.name} (${s.puzzleCount} puzzles, ${s.ratingMin}–${s.ratingMax})`;
}

async function refreshSets() {
  const sets = await idb.listSets();

  els.setSelect.innerHTML = '';
  if (!sets.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— no sets yet, create one below —';
    els.setSelect.appendChild(opt);
    els.builder.hidden = false;
  } else {
    for (const s of sets) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = setLabel(s);
      els.setSelect.appendChild(opt);
    }
  }

  els.setList.innerHTML = '';
  for (const s of sets) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = setLabel(s);
    const btnExport = document.createElement('button');
    btnExport.type = 'button';
    btnExport.textContent = 'Export';
    btnExport.addEventListener('click', () => exportSet(s));
    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.textContent = 'Delete';
    btnDelete.addEventListener('click', () => removeSet(s));
    li.append(name, btnExport, btnDelete);
    els.setList.appendChild(li);
  }

  // Restore persisted selection, or fall back to the newest set.
  const wanted = settings.getActiveSetId();
  const target = sets.find((s) => s.id === wanted) ?? sets[0] ?? null;
  if (target) {
    els.setSelect.value = target.id;
    await activateSet(target.id);
  } else {
    await activateSet(null);
  }
}

async function activateSet(id) {
  if (activeDb) {
    activeDb.close();
    activeDb = null;
  }
  activeSetId = id;
  settings.setActiveSetId(id);
  if (id) {
    const rec = await idb.getSet(id);
    activeDb = await openSet(rec.bytes);
  }
}

async function exportSet(meta) {
  try {
    const rec = await idb.getSet(meta.id);
    const how = await saveSqliteFile(rec.name, rec.bytes);
    els.builderMsg.textContent =
      how === 'cancelled' ? 'Export cancelled.' : `Exported "${rec.name}".`;
  } catch (err) {
    els.builderMsg.textContent = `Export failed: ${err.message}`;
  }
}

async function removeSet(meta) {
  if (!confirm(`Delete set "${meta.name}"? This cannot be undone.`)) return;
  await idb.deleteSet(meta.id);
  if (activeSetId === meta.id) await activateSet(null);
  await refreshSets();
}

/* ---------- builder (Feature 1) ---------- */

async function onBuild() {
  const file = els.csvFile.files?.[0];
  if (!file) {
    els.buildProgress.textContent = 'Choose the lichess puzzle CSV first.';
    return;
  }
  if (/\.zst$/i.test(file.name)) {
    els.buildProgress.textContent =
      'That is a .csv.zst archive — please decompress it first (e.g. "zstd -d lichess_db_puzzle.csv.zst") and select the plain .csv.';
    return;
  }
  const ratingMin = parseInt(els.ratingMin.value, 10);
  const ratingMax = parseInt(els.ratingMax.value, 10);
  const count = parseInt(els.puzzleCount.value, 10);
  if (!Number.isFinite(ratingMin) || !Number.isFinite(ratingMax) || ratingMin > ratingMax) {
    els.buildProgress.textContent = 'Invalid rating range.';
    return;
  }
  if (!Number.isFinite(count) || count < 1) {
    els.buildProgress.textContent = 'Number of puzzles must be at least 1.';
    return;
  }
  if (count > MAX_SAFE_PUZZLES) {
    const ok = confirm(
      `${count} puzzles is a lot for an in-memory database (>${MAX_SAFE_PUZZLES}). Continue anyway?`
    );
    if (!ok) return;
  }
  const name =
    els.setName.value.trim() || `Set ${ratingMin}–${ratingMax} (${new Date().toLocaleDateString()})`;

  busy = true;
  els.btnBuild.disabled = true;
  const onProgress = (p) => {
    els.buildProgress.textContent =
      p.phase === 'insert'
        ? `Inserting into SQLite… ${p.inserted} / ${p.total}`
        : `parsed ${p.parsed.toLocaleString()} rows, matched ${p.matched.toLocaleString()}, kept ${p.kept.toLocaleString()} / ${count.toLocaleString()}`;
  };
  try {
    const { bytes, sampled } = await buildSet({
      file, ratingMin, ratingMax, count, name, onProgress,
    });
    const record = {
      id: crypto.randomUUID(),
      name,
      bytes,
      createdAt: new Date().toISOString(),
      puzzleCount: sampled,
      ratingMin,
      ratingMax,
    };
    // IndexedDB is the working store; the .sqlite file is a portable export.
    await idb.putSet(record);
    els.buildProgress.textContent = `Built "${name}" with ${sampled.toLocaleString()} puzzles. Saving file…`;
    const how = await saveSqliteFile(name, bytes);
    els.buildProgress.textContent =
      `Built "${name}" with ${sampled.toLocaleString()} puzzles. ` +
      (how === 'cancelled' ? 'File save cancelled (set is still stored in the browser).' : `Exported ${name}.sqlite.`);
    await refreshSets();
    await activateSet(record.id);
    els.setSelect.value = record.id;
  } catch (err) {
    els.buildProgress.textContent = `Build failed: ${err.message}`;
  } finally {
    busy = false;
    els.btnBuild.disabled = false;
  }
}

async function onImport() {
  const file = els.importFile.files?.[0];
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const meta = await inspectSet(bytes);
    const record = {
      id: crypto.randomUUID(),
      name: meta.name,
      bytes,
      createdAt: meta.createdAt,
      puzzleCount: meta.puzzleCount,
      ratingMin: meta.ratingMin,
      ratingMax: meta.ratingMax,
    };
    await idb.putSet(record);
    els.builderMsg.textContent = `Imported "${meta.name}" (${meta.puzzleCount} puzzles).`;
    await refreshSets();
    await activateSet(record.id);
    els.setSelect.value = record.id;
  } catch (err) {
    els.builderMsg.textContent = `Import failed: ${err.message}`;
  } finally {
    els.importFile.value = '';
  }
}

/* ---------- wiring ---------- */

els.btnNew.addEventListener('click', async () => {
  if (busy) return;
  if (!activeDb) {
    els.builder.hidden = false;
    els.builderMsg.textContent = 'Create or import a puzzle set first.';
    return;
  }
  const row = randomPuzzle(activeDb);
  if (!row) {
    els.builderMsg.textContent = 'The active set contains no puzzles.';
    return;
  }
  topBar.close(); // solving needs the board, not the settings
  busy = true;
  els.btnNew.disabled = true;
  try {
    await exercise.newPuzzle(row, settings.getPlyBack());
  } finally {
    busy = false;
    els.btnNew.disabled = false;
  }
});

els.btnReveal.addEventListener('click', () => exercise.reveal());
els.btnBuilder.addEventListener('click', () => {
  els.builder.hidden = !els.builder.hidden;
});
els.btnBuild.addEventListener('click', onBuild);
els.importFile.addEventListener('change', onImport);

els.setSelect.addEventListener('change', async () => {
  const id = els.setSelect.value || null;
  if (id !== activeSetId) await activateSet(id);
});

els.plyBack.value = String(settings.getPlyBack());
els.plyBack.addEventListener('change', () => {
  settings.setPlyBack(els.plyBack.value);
  els.plyBack.value = String(settings.getPlyBack());
});

renderScore();
refreshSets().catch((err) => {
  els.builder.hidden = false;
  els.builderMsg.textContent = `Storage error: ${err.message}`;
});
