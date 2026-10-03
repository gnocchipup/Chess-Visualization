import './style.css';
import { Exercise } from './exercise.js';
import * as settings from './settings.js';
import * as idb from './idb.js';
import { openSet, randomPuzzle, inspectSet } from './sqlsets.js';
import { buildSet, saveSqliteFile, MAX_SAFE_PUZZLES } from './builder.js';
import { TopBar, HeaderCollapse } from './layout.js';
import { fetchNextPuzzle, reportResult, NEXT_DIFFICULTIES } from './lichess.js';
import * as auth from './auth.js';

const $ = (id) => document.getElementById(id);
const els = {
  appHeader: $('app-header'),
  headerBody: $('header-body'),
  topbar: $('topbar'),
  drawerToggle: $('drawer-toggle'),
  headerCollapse: $('header-collapse'),
  headerCollapseInner: $('header-collapse-inner'),
  headerHandle: $('header-handle'),
  btnSettings: $('btn-settings'),
  settingsMenu: $('settings-menu'),
  accountBtn: $('account-btn'),
  accountMenu: $('account-menu'),
  accountAvatar: $('account-avatar'),
  accountName: $('account-name'),
  sourceSelect: $('source-select'),
  setSelect: $('set-select'),
  difficultySelect: $('difficulty-select'),
  authArea: $('auth-area'),
  plyBack: $('ply-back'),
  btnBuilder: $('btn-builder'),
  btnNew: $('btn-new'),
  btnFlip: $('btn-flip'),
  btnReveal: $('btn-reveal'),
  boardFiles: $('board-files'),
  boardRanks: $('board-ranks'),
  dotTop: $('board-dot-top'),
  dotBottom: $('board-dot-bottom'),
  score: $('score'),
  scoreStrip: $('score-strip'),
  btnResetScore: $('btn-reset-score'),
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
/** Whether IndexedDB holds at least one puzzle set; gates the set picker. */
let hasSets = false;

/* ---------- mock-shell dropdowns (settings gear + account) ---------- */

// The mock moves settings into a gear dropdown and sign-in into an account
// dropdown; the legacy narrow-screen drawer (TopBar) stays as a no-op
// fallback only if its hidden hooks ever become visible again.
let topBar = null;
try {
  if (els.headerBody && !els.headerBody.hidden) {
    topBar = new TopBar({
      headerEl: els.appHeader,
      bodyEl: els.headerBody,
      topbarEl: els.topbar,
      handleEl: els.drawerToggle,
    });
  }
} catch {
  topBar = null;
}

// Narrow-screen header: collapses to a slim bar (drag grip + settings button)
// and unfolds in place when the grip is pulled down. The settings dropdown itself
// is untouched — the button is pinned outside the folding region, so it stays
// reachable whether the header is collapsed or not. Desktop is unaffected: every
// collapse rule is media-scoped, and without the class this adds, a header whose
// script never ran is simply always shown.
let headerCollapse = null;
try {
  if (els.appHeader && els.headerCollapse && els.headerCollapseInner && els.headerHandle) {
    headerCollapse = new HeaderCollapse({
      headerEl: els.appHeader,
      collapseEl: els.headerCollapse,
      innerEl: els.headerCollapseInner,
      handleEl: els.headerHandle,
    });
  }
} catch {
  headerCollapse = null;
}

function closeMenus(except = null) {
  for (const [btn, menu] of [
    [els.btnSettings, els.settingsMenu],
    [els.accountBtn, els.accountMenu],
  ]) {
    if (!menu || menu === except) continue;
    menu.hidden = true;
    btn?.setAttribute('aria-expanded', 'false');
  }
}

function toggleMenu(btn, menu) {
  if (!btn || !menu) return;
  const willOpen = menu.hidden;
  closeMenus(menu);
  menu.hidden = !willOpen;
  btn.setAttribute('aria-expanded', String(willOpen));
}

els.btnSettings?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu(els.btnSettings, els.settingsMenu);
});
els.accountBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu(els.accountBtn, els.accountMenu);
});
document.addEventListener('click', (e) => {
  if (e.target?.closest?.('.dropdown-wrap')) return;
  closeMenus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenus();
});

const exercise = new Exercise({
  boardEl: $('board'),
  tableEl: $('move-table'),
  infoEl: $('puzzle-info'),
  errorEl: $('error-box'),
  revealBtn: els.btnReveal,
  // Board frame chrome: coordinate gutters + the two colour circles, all
  // painted from the board's orientation (see Exercise.paintBoard).
  filesEl: els.boardFiles,
  ranksEl: els.boardRanks,
  topDotEl: els.dotTop,
  bottomDotEl: els.dotBottom,
  // Board flip is a persisted preference: the exercise asks for the stored
  // value whenever it prepares a puzzle, and reports every flip back so it can
  // be saved (and mirrored onto the button and the board's corner badge).
  getFlipped: settings.getFlipped,
  onFlipChange: (flipped) => {
    settings.setFlipped(flipped);
    renderFlipState(flipped);
  },
  onResult: (solved) => {
    settings.pushResult(solved);
    renderScore();
    // Signed-in Lichess-next mode: report casual results to advance the
    // server queue (POST /api/puzzle/batch/mix, rated:false). Anonymous
    // mode has no queue, so nothing is reported. Reveals are deliberately
    // NOT reported (user choice) — skipping ahead then needs one extra
    // New-puzzle press, which is the honest trade-off.
    if (settings.getSource() === 'lichess' && !exercise.revealed && exercise.nextPuzzleId) {
      const id = exercise.nextPuzzleId;
      exercise.nextPuzzleId = null; // consume: report each puzzle at most once
      // Guests have no server queue — a fresh puzzle arrives on every
      // New-puzzle press, so there is nothing to report and no message.
      if (!auth.isLoggedIn()) return;
      if (!auth.hasWriteScope()) {
        exercise.showError(
          'This sign-in is read-only (missing puzzle:write). Sign out and sign in again, then each solved puzzle advances the queue.',
          null,
          { retry: false }
        );
        return;
      }
      reportResult(id, solved)
        .then(() => {
          // Queue advanced; the next New-puzzle press fetches at the
          // CURRENT difficulty setting (read then, not now).
          els.btnNew.disabled = false;
          els.btnNew.textContent = 'New puzzle ✓';
        })
        .catch((err) => {
          // Non-fatal: the queue just doesn't advance; next press refetches.
          exercise.showError(`Could not report result: ${err.message}`, null, { retry: false });
        });
    }
  },
});

// Difficulty is read fresh on every New-puzzle press (fetchNextPuzzle),
// never cached — so mid-puzzle changes apply to the very next fetch.

/* ---------- score strip ---------- */

function renderScore() {
  // Two different questions, two different sources. The totals answer "how
  // have I done this session" and so count the whole log; the strip answers
  // "what happened recently" and is capped at MAX_STRIP squares, since it has a
  // fixed width. They used to read the same capped array, which quietly froze
  // the numbers at the last 25 puzzles.
  const results = settings.getResults();
  const strip = settings.getStripResults();
  const solved = results.filter(Boolean).length;
  const failed = results.length - solved;
  // Nothing recorded means nothing to clear, so say so on the reset button
  // rather than offer a click that does nothing.
  els.btnResetScore.disabled = results.length === 0;
  // Mock style: "Solved 11 · Failed 14" with bold counts.
  els.score.innerHTML = '';
  if (results.length) {
    const b1 = document.createElement('b');
    b1.textContent = String(solved);
    const b2 = document.createElement('b');
    b2.textContent = String(failed);
    els.score.append('Solved ', b1, ' · Failed ', b2);
    // Once the strip is full, say so — otherwise a full row of squares looks
    // like "25 puzzles this session" next to a much larger total.
    if (results.length > strip.length) {
      const more = document.createElement('span');
      more.className = 'score-more';
      const hidden = results.length - strip.length;
      more.textContent = `+${hidden} older`;
      more.title =
        `${results.length} puzzles attempted this session. The strip shows the ` +
        `most recent ${settings.MAX_STRIP}; the totals above count all of them.`;
      els.score.append(' ', more);
    }
  }
  els.scoreStrip.innerHTML = '';
  for (const ok of strip) {
    const sq = document.createElement('span');
    sq.className = 'sq-result ' + (ok ? 'ok' : 'bad');
    sq.title = ok ? 'Solved' : 'Failed';
    els.scoreStrip.appendChild(sq);
  }
}

/**
 * Clear the correct/incorrect session counter. Two things reach it: the reset
 * button beside the score (the explicit "start a new session"), and every
 * setting that changes *what* is being solved — the puzzle source or set, the
 * Lichess difficulty, or how much lead-up is shown (ply back). Results from the
 * previous configuration would otherwise be carried into the new one and misread
 * as its accuracy.
 */
function resetScore() {
  settings.clearResults();
  renderScore();
}

// The dedicated reset: clearing the counter should not require changing a
// setting first. renderScore() disables the button while there is nothing to do.
els.btnResetScore.addEventListener('click', resetScore);

/* ---------- board flip ---------- */

/**
 * Mirror the flip preference onto the flip button. The button is only the ⇅ sign,
 * so the state travels on aria-pressed: CSS paints that sign blue for the default
 * (auto) orientation and red while the board is flipped, matching the two colour
 * circles on the board frame (see Exercise.paintSideDot), which also turn their
 * outlines red — so the state stays obvious once the button has scrolled out of
 * view under a long move table.
 */
function renderFlipState(flipped) {
  els.btnFlip.setAttribute('aria-pressed', String(flipped));
  els.btnFlip.title = flipped
    ? 'Unflip the board (F) — remembered for the next puzzle'
    : 'Flip the board 180° (F) — remembered for the next puzzle';
}

/* ---------- puzzle sets ---------- */

function setLabel(s) {
  return `${s.name} (${s.puzzleCount} puzzles, ${s.ratingMin}–${s.ratingMax})`;
}

async function refreshSets() {
  const sets = await idb.listSets();
  // Read by applySourceVisibility() to decide whether the set picker is a real
  // choice or just the "— no sets yet —" placeholder. Re-applied at the end so
  // building, importing, or deleting the last set updates the menu immediately.
  hasSets = sets.length > 0;

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

  // The set count may have just changed (first build, last delete), which is
  // exactly what decides whether the set picker is shown.
  applySourceVisibility();
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

function isLichessSource() {
  return els.sourceSelect.value === 'lichess';
}

/**
 * Show/hide the rows that depend on the chosen source.
 *
 * "Lichess next" serves from /api/puzzle/next, whose only knob is difficulty;
 * a local set has no such notion, so the difficulty row goes away and the set
 * picker comes in. The builder CTA belongs to the same branch — with Lichess as
 * the source there are no local sets to manage, and leaving the button there
 * offered a builder whose result could not be selected.
 *
 * The set picker also stays hidden while `hasSets` is false. On a fresh install
 * it can only render the "— no sets yet —" placeholder, which is not a choice;
 * the builder CTA is the useful action there, and it is now the only row under
 * the source picker. `hasSets` is refreshed by refreshSets(), so building or
 * importing a set makes the row appear without a reload.
 */
function applySourceVisibility() {
  const lichess = isLichessSource();
  els.difficultySelect.closest('.difficulty-picker').hidden = !lichess;
  els.setSelect.closest('.set-picker').hidden = lichess || !hasSets;
  els.btnBuilder.hidden = lichess;
  // Auth lives in the account dropdown now, and applies to every source
  // (the badge in the header button mirrors the session).
  if (els.authArea) els.authArea.hidden = false;
}

/** Render the account dropdown + header badge for the lichess session. */
function renderAuth() {
  els.authArea.innerHTML = '';
  const username = auth.isLoggedIn() ? auth.getUsername() || 'Lichess user' : 'Guest';
  if (els.accountName) els.accountName.textContent = username;
  if (els.accountAvatar) els.accountAvatar.textContent = (username[0] || 'G').toUpperCase();
  if (auth.isLoggedIn()) {
    const badge = document.createElement('span');
    badge.className = 'auth-user';
    badge.textContent = auth.getUsername() ? `Signed in as ${auth.getUsername()}` : 'Signed in';
    badge.title = auth.hasWriteScope()
      ? 'Signed in — solving reports casual results so each New puzzle is fresh (rated:false, rating untouched)'
      : 'Signed in (read-only) — please sign out and sign in again to enable fresh puzzles (adds puzzle:write)';
    const btnOut = document.createElement('button');
    btnOut.type = 'button';
    btnOut.id = 'btn-logout';
    btnOut.textContent = 'Sign out';
    btnOut.addEventListener('click', async () => {
      await auth.logout();
      renderAuth();
    });
    els.authArea.append(badge, btnOut);
  } else {
    const btnIn = document.createElement('button');
    btnIn.type = 'button';
    btnIn.id = 'btn-login';
    btnIn.textContent = 'Sign in with Lichess';
    btnIn.title = 'Sign in so Lichess serves puzzles you have not seen (scope: puzzle:read)';
    btnIn.addEventListener('click', async () => {
      try {
        await auth.beginLogin();
      } catch (err) {
        exercise.showError(err.message, null, { retry: false });
      }
    });
    const hint = document.createElement('span');
    hint.className = 'muted auth-hint';
    hint.textContent = 'Optional — works signed out too (rating ~1500).';
    els.authArea.append(btnIn, hint);
  }
}

async function onNewPuzzle() {
  if (busy) return;
  closeMenus();
  topBar?.close(); // solving needs the board, not the settings
  headerCollapse?.close(); // and the board beats header chrome on a phone
  busy = true;
  els.btnNew.disabled = true;
  els.btnNew.textContent = 'New puzzle';
  try {
    if (isLichessSource()) {
      // One fetch per press at the current difficulty. No prefetching or
      // bulk download — and no bundled puzzle from the report, which would
      // carry the default difficulty and ignore mid-puzzle changes.
      const data = await fetchNextPuzzle(settings.getDifficulty());
      await exercise.newPuzzleFromNext(data, settings.getPlyBack(), onNewPuzzle);
      return;
    }
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
    await exercise.newPuzzle(row, settings.getPlyBack());
  } catch (err) {
    exercise.showError(err.message, onNewPuzzle);
  } finally {
    busy = false;
    els.btnNew.disabled = false;
  }
}

els.btnNew.addEventListener('click', onNewPuzzle);

// Flip control beside New puzzle: the F shortcut is unreachable on touch, and
// the state it sets is persisted (see the Exercise options above).
els.btnFlip.addEventListener('click', () => exercise.flip());
renderFlipState(settings.getFlipped());

els.btnReveal.addEventListener('click', () => exercise.reveal());
els.btnBuilder.addEventListener('click', () => {
  els.builder.hidden = !els.builder.hidden;
});
els.btnBuild.addEventListener('click', onBuild);
els.importFile.addEventListener('change', onImport);

els.setSelect.addEventListener('change', async () => {
  const id = els.setSelect.value || null;
  if (id !== activeSetId) {
    await activateSet(id);
    resetScore();
  }
});

els.plyBack.value = String(settings.getPlyBack());
els.plyBack.addEventListener('change', () => {
  const before = settings.getPlyBack();
  settings.setPlyBack(els.plyBack.value);
  els.plyBack.value = String(settings.getPlyBack());
  if (settings.getPlyBack() !== before) resetScore();
});

// Source picker: local puzzle sets (default, unchanged) vs Lichess next
// puzzle (/api/puzzle/next, one fetch per New-puzzle press).
for (const [value, label] of [['sets', 'My sets'], ['lichess', 'Lichess next']]) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  els.sourceSelect.appendChild(opt);
}
els.sourceSelect.value = settings.getSource();
const diffDefault = document.createElement('option');
diffDefault.value = '';
diffDefault.textContent = 'Default';
els.difficultySelect.appendChild(diffDefault);
for (const d of NEXT_DIFFICULTIES) {
  const opt = document.createElement('option');
  opt.value = d;
  opt.textContent = d[0].toUpperCase() + d.slice(1);
  els.difficultySelect.appendChild(opt);
}
if (NEXT_DIFFICULTIES.includes(settings.getDifficulty())) {
  els.difficultySelect.value = settings.getDifficulty();
}
els.sourceSelect.addEventListener('change', () => {
  const before = settings.getSource();
  settings.setSource(els.sourceSelect.value);
  applySourceVisibility();
  // Swapping the source swaps the whole puzzle pool, so counts from the old
  // source say nothing about the new one — same reasoning as changing set.
  if (settings.getSource() !== before) resetScore();
});
els.difficultySelect.addEventListener('change', () => {
  const before = settings.getDifficulty();
  settings.setDifficulty(els.difficultySelect.value);
  if (settings.getDifficulty() !== before) resetScore();
});
applySourceVisibility();

// OAuth callback (if returning from lichess.org/oauth) + persisted session.
auth
  .handleAuthCallback()
  .then((result) => {
    renderAuth();
    if (result.status === 'error') exercise.showError(`Sign-in failed: ${result.error}`, null, { retry: false });
  })
  .catch((err) => {
    renderAuth();
    exercise.showError(`Sign-in failed: ${err.message}`, null, { retry: false });
  });

renderScore();
refreshSets().catch((err) => {
  els.builder.hidden = false;
  els.builderMsg.textContent = `Storage error: ${err.message}`;
});

/* ---------- service worker (installability) ---------- */

/**
 * Register the app-shell service worker.
 *
 * Skipped in dev on purpose: a worker caching modules fights Vite's HMR and
 * serves stale bundles, which is a confusing way to spend an afternoon. It is
 * also skipped outside a secure context, since browsers refuse registration on
 * plain http (localhost excepted) — that is why the GitHub Pages / Render
 * deploys are fine and a LAN IP over http is not.
 *
 * The worker is an installability requirement, not an offline feature: it
 * caches the built shell and nothing else. Lichess API traffic is deliberately
 * never cached, so the app's no-offline-mode rule is preserved. Every failure
 * here is swallowed because a missing worker costs the install prompt and
 * nothing else — the app itself does not depend on it.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  if (!window.isSecureContext) return;

  window.addEventListener('load', () => {
    // Relative URL to match vite.config.js's `base: './'` — the app is served
    // from a subpath on GitHub Pages, where '/sw.js' would 404.
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* No install prompt on this browser/profile; the app still works. */
    });
  });
}

registerServiceWorker();
