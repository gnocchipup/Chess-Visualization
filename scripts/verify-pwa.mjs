// Verifies the settings-menu layout rules and PWA installability against a
// running `vite preview` (expects port 4173). Real browser required: the
// conditional rows depend on `hidden` beating a `display` author rule, which
// no DOM-free test can catch.
//
//   node scripts/verify-pwa.mjs
//
// A headless Chromium is launched here over CDP (--headless=new
// --remote-debugging-port) so the committed repo still needs no browser-test
// harness. Any Chromium build will do — see scripts/lib/browser-path.mjs, which
// finds one (Chrome, Edge, Chromium, or `CHROME_PATH`).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBrowserPath } from './lib/browser-path.mjs';

const BASE = 'http://localhost:4173';
const CHROME = resolveBrowserPath();
const PORT = 9333;

if (!CHROME) {
  console.error(
    'No Chromium-family browser found.\n' +
      'Install Chrome or Edge, or point CHROME_PATH at a Chromium binary.',
  );
  process.exit(1);
}
console.log(`Using browser: ${CHROME}`);

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- boot a headless Chrome with a clean profile (no cached worker) ---------
const profile = mkdtempSync(join(tmpdir(), 'cpt-pwa-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  BASE + '/',
]);
chrome.stderr.on('data', () => {});

async function cdpTargets() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith(BASE));
      if (page) return page;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  throw new Error('Chrome did not expose a CDP page target');
}

const target = await cdpTargets();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('CDP socket failed'));
});

let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/** Evaluate a function body in the page and return its JSON value. */
async function evaluate(body) {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${body} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || 'page threw');
  }
  return r.result.value;
}

// Reload so the page is definitely built from the current dist/.
await send('Page.enable');
await send('Page.reload', { ignoreCache: true });

// Wait for the *new* document to be interactive. Reload replaces the execution
// context, so anything evaluated too early can observe the outgoing page (or a
// detached document) and report bogus failures.
async function waitFor(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(`return Boolean(${predicate});`)) return true;
    } catch {
      /* context mid-swap; retry */
    }
    await sleep(250);
  }
  return false;
}

const ready = await waitFor("document.readyState === 'complete' && document.querySelector('link[rel=manifest]')");
check('document loaded with a manifest link', ready);

// The worker registers on the window load event and installs asynchronously.
const registered = await waitFor("(await navigator.serviceWorker.getRegistration()) !== null");
check('service worker registration started', registered);

console.log('\n1. Manifest is served and linked');
const manifest = await evaluate(`
  const link = document.querySelector('link[rel=manifest]');
  if (!link) return { linked: false };
  const res = await fetch(link.getAttribute('href'));
  const body = await res.json();
  return {
    linked: true,
    status: res.status,
    name: body.name,
    start_url: body.start_url,
    scope: body.scope,
    id: body.id,
    display: body.display,
    has192: body.icons.some((i) => i.sizes === '192x192'),
    has512: body.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'),
    maskable: body.icons.some((i) => i.purpose === 'maskable'),
  };
`);
check('index.html links a manifest', manifest.linked);
check('manifest fetches 200', manifest.status === 200);
check('manifest has a name', !!manifest.name, manifest.name);
check('start_url is relative (subpath deploys)', manifest.start_url === './', manifest.start_url);
check('scope is relative (subpath deploys)', manifest.scope === './', manifest.scope);
check('display is standalone', manifest.display === 'standalone');
check('192x192 icon present (Android install requirement)', manifest.has192);
check('512x512 "any" icon present', manifest.has512);
check('maskable icon present (adaptive icons)', manifest.maskable);

// The app identity that makes a second install on the SAME origin possible.
// Chrome keys an installed app by origin+id, so a relative id (".") collides
// with any other PWA served from the same host — which is exactly what happened
// when this app could not be installed on Android alongside another project
// under the same github.io address.
console.log('\n1b. App id is distinct, so two apps can share one origin');
const idUrl = new URL(manifest.id, 'https://gnocchipup.github.io/').href;
check('id is present', !!manifest.id, manifest.id);
check(
  'id is an absolute path naming the repo, not a bare "."',
  manifest.id.startsWith('/') && manifest.id === '/Chess-Visualization/',
  manifest.id,
);
check(
  'id resolves to the full origin + path (never collides with a sibling app)',
  idUrl === 'https://gnocchipup.github.io/Chess-Visualization/',
  idUrl,
);
check(
  'id is same-origin when resolved against the deploy host',
  new URL(manifest.id, 'https://gnocchipup.github.io/Chess-Visualization/').origin ===
    'https://gnocchipup.github.io',
);
check('id is not merely a copy of start_url', manifest.id !== manifest.start_url);

console.log('\n2. Manifest icon files actually resolve');
const icons = await evaluate(`
  const href = document.querySelector('link[rel=manifest]').getAttribute('href');
  const body = await (await fetch(href)).json();
  const out = [];
  for (const icon of body.icons) {
    const r = await fetch(new URL(icon.src, new URL(href, location.href)));
    out.push({ src: icon.src, status: r.status, type: r.headers.get('content-type') });
  }
  return out;
`);
for (const i of icons) {
  check(`icon ${i.src} -> 200`, i.status === 200, i.type);
}

console.log('\n3. Service worker registers (installability gate)');
// Registration is asynchronous and skipWaiting()+clients.claim() can swap which
// object is "current", so poll for an activated worker rather than sampling the
// state once and reporting whatever happened to be true at that instant.
const activated = await waitFor(`
  (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated'
`, 20000);
const sw = await evaluate(`
  const keys = await caches.keys();
  if (!keys.length) return { registered: false, cached: [] };
  const cache = await caches.open(keys[0]);
  const cached = await cache.keys();
  return { registered: true, cacheName: keys[0], cached: cached.map((r) => new URL(r.url).pathname) };
`);
check('worker reaches activated', activated);
check(
  'app shell precached',
  (sw.cached || []).length >= 3,
  (sw.cached || []).join(', '),
);

console.log('\n4. Lichess API traffic is NEVER cached (no offline mode)');
const noCache = await evaluate(`
  const paths = [];
  for (const k of await caches.keys()) {
    const cache = await caches.open(k);
    for (const r of await cache.keys()) paths.push(r.url);
  }
  return { total: paths.length, crossOrigin: paths.filter((u) => !u.startsWith(location.origin)) };
`);
check(
  'nothing cross-origin in any cache',
  noCache.crossOrigin.length === 0,
  noCache.crossOrigin.join(', '),
);

// MAX_STRIP from src/settings.js, kept as a literal: this script drives the
// built bundle over CDP and cannot import app modules. 40 attempts — 30 solved
// then 10 failed — leave the last 22 holding 12 green / 10 red, a different
// ratio from the session's 30/40, so a capped read of the totals cannot pass
// the checks below.
const STRIP_CAP = 22;
console.log(`\n5. Score row: totals uncapped, colour strip capped at ${STRIP_CAP}`);
// Drives the real renderScore() through those 40 results.
const score = await evaluate(`
  localStorage.setItem('cpt.results', JSON.stringify([
    ...Array(30).fill(true),
    ...Array(10).fill(false),
  ]));
  // Re-render via the app's own path: the module is already loaded, so drive the
  // same handler the UI uses rather than reaching into internals.
  window.dispatchEvent(new Event('focus'));
  location.reload();
  return true;
`);
await sleep(1500);
await waitFor("document.getElementById('score-strip').children.length > 0");
const scoreUi = await evaluate(`
  const sq = [...document.getElementById('score-strip').children];
  return {
    text: document.getElementById('score').textContent,
    squares: sq.length,
    green: sq.filter((s) => s.classList.contains('ok')).length,
    red: sq.filter((s) => s.classList.contains('bad')).length,
    more: document.querySelector('.score-more')?.textContent || null,
  };
`);
check(`40 results recorded, ${STRIP_CAP} squares drawn`, scoreUi.squares === STRIP_CAP, `${scoreUi.squares} squares drawn`);
check(
  `squares keep the last ${STRIP_CAP}: 12 green, 10 red`,
  scoreUi.green === 12 && scoreUi.red === 10,
  `${scoreUi.green}/${scoreUi.red}`,
);
check(`totals show all 40, not ${STRIP_CAP}`, scoreUi.text.includes('30') && scoreUi.text.includes('10'), scoreUi.text);
check(
  'a "+N older" marker explains the difference',
  scoreUi.more === `+${40 - STRIP_CAP} older`,
  scoreUi.more,
);
await evaluate(`
  localStorage.removeItem('cpt.results');
  location.reload();
  return true;
`);
await sleep(1200);

// Everything below measures the settings menu, which ships with the `hidden`
// attribute set. A collapsed menu reports height 0 for every row, which would
// make every visibility assertion pass for the wrong reason — so open it first.
await evaluate(`
  document.getElementById('settings-menu').hidden = false;
  return true;
`);
await sleep(200);

console.log('\n6. Settings menu: ply back on top, then source');
const order = await evaluate(`
  const menu = document.getElementById('settings-menu');
  const rows = [...menu.querySelectorAll('.menu-row, .menu-cta, .menu-kicker')];
  // Label rows carry no id, so identify them by the control they contain.
  const name = (r) =>
    r.querySelector('select, input')?.id || r.querySelector('select, input')?.name ||
    (r.classList.contains('menu-kicker') ? 'kicker' : r.id);
  const visible = rows.filter((r) => r.getBoundingClientRect().height > 0);
  return {
    all: rows.map(name),
    visibleFirst: visible.length ? name(visible[0]) : null,
  };
`);
check('ply back is the first visible row', order.visibleFirst === 'ply-back', order.visibleFirst);
check(
  'source picker comes after ply back',
  order.all.indexOf('source-select') > order.all.indexOf('ply-back'),
  order.all.join(' > '),
);
check(
  'difficulty sits under source, not above it',
  order.all.indexOf('difficulty-select') > order.all.indexOf('source-select'),
  order.all.join(' > '),
);

console.log('\n6b. Fresh profile: Lichess next is the default and the builder stays shut');
// Nothing has written cpt.source in this run — section 5 only touched
// cpt.results and removed it again — so this is the true first-run state.
const fresh = await evaluate(`
  return {
    stored: localStorage.getItem('cpt.source'),
    source: document.getElementById('source-select').value,
    builderHidden: document.getElementById('builder').hidden,
    builderHeight: document.getElementById('builder').getBoundingClientRect().height,
  };
`);
check('no source is stored on a fresh profile', fresh.stored === null, String(fresh.stored));
check('source defaults to "Lichess next"', fresh.source === 'lichess', fresh.source);
// Measured, not read off the attribute: a display rule beats `hidden` while the
// attribute still reports true — the bug class section 9 guards.
check(
  'puzzle-sets builder is hidden on load',
  fresh.builderHidden === true && fresh.builderHeight === 0,
  `hidden=${fresh.builderHidden} height=${fresh.builderHeight}`,
);

console.log('\n7. Source = "My sets" (fresh install): no set picker, CTA shown');
const asSets = await evaluate(`
  const sel = document.getElementById('source-select');
  sel.value = 'sets';
  sel.dispatchEvent(new Event('change'));
  await new Promise((r) => setTimeout(r, 100));
  const vis = (id) =>
    document.getElementById(id).closest('.menu-row').getBoundingClientRect().height > 0;
  return {
    setPicker: vis('set-select'),
    difficulty: vis('difficulty-select'),
    cta: document.getElementById('btn-builder').getBoundingClientRect().height > 0,
  };
`);
check('set picker hidden with zero sets (the reported bug)', asSets.setPicker === false);
check('difficulty hidden for local sets', asSets.difficulty === false);
check('"Puzzle sets..." CTA shown for local sets', asSets.cta === true);

console.log('\n8. Source = "Lichess next": only difficulty');
const asLichess = await evaluate(`
  const sel = document.getElementById('source-select');
  sel.value = 'lichess';
  sel.dispatchEvent(new Event('change'));
  await new Promise((r) => setTimeout(r, 100));
  const vis = (id) =>
    document.getElementById(id).closest('.menu-row').getBoundingClientRect().height > 0;
  return {
    setPicker: vis('set-select'),
    difficulty: vis('difficulty-select'),
    cta: document.getElementById('btn-builder').getBoundingClientRect().height > 0,
  };
`);
check('set picker hidden for Lichess', asLichess.setPicker === false);
check('difficulty shown for Lichess', asLichess.difficulty === true);
check('builder CTA hidden for Lichess', asLichess.cta === false);

console.log('\n9. `hidden` actually beats the display rule (CSS regression guard)');
const hiddenWorks = await evaluate(`
  // Rows carry display:flex from .menu-row, which beats the UA [hidden] rule
  // unless style.css restates it. Prove the override exists and works, using
  // the ply-back row (always visible) so the menu stays expanded.
  const row = document.getElementById('ply-back').closest('.menu-row');
  row.hidden = false;
  const shownH = row.getBoundingClientRect().height;
  row.hidden = true;
  const hiddenH = row.getBoundingClientRect().height;
  row.hidden = false;
  const matched = [...document.styleSheets]
    .flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } })
    .some((r) => r.selectorText?.includes('.menu-row[hidden]'));
  return { hiddenH, shownH, matched };
`);
check('CSS rule .menu-row[hidden] exists', hiddenWorks.matched);
check(
  'hidden row collapses to 0 height',
  hiddenWorks.hiddenH === 0 && hiddenWorks.shownH > 0,
  `hidden=${hiddenWorks.hiddenH} shown=${hiddenWorks.shownH}`,
);

console.log('\n10. theme-color matches the app background');
const theme = await evaluate(`
  const meta = document.querySelector('meta[name=theme-color]')?.content;
  // getComputedStyle returns rgb(), the meta is #hex — compare as numbers so the
  // check is about the colour, not the notation.
  const toRgb = (hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const bg = getComputedStyle(document.body).backgroundColor;
  const bgRgb = bg.match(/\\d+/g).map(Number).slice(0, 3);
  return { meta, bg, same: toRgb(meta).join() === bgRgb.join() };
`);
check('theme-color declared', !!theme.meta, theme.meta);
check(
  'theme-color == body background',
  theme.same === true,
  `${theme.meta} vs ${theme.bg}`,
);

console.log('\n11. The builder panel and the score strip fit a phone viewport');
// Two widths: 390 (iPhone 14-class) and 360 (the narrowest the app targets). A
// fixed-width strip and a two-column grid are the two things most likely to
// push the page sideways, so both are measured for horizontal overflow.
async function overflowAt(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await sleep(300);
  return evaluate(`
    const builder = document.getElementById('builder');
    builder.hidden = false;
    // The menu ships collapsed; sections 6+ opened it, but assert it here so
    // this check does not depend on another section's side effect.
    const menu = document.getElementById('settings-menu');
    menu.hidden = false;
    // A synthetic row stands in for a real set: the builder pipeline needs a
    // ~1 GB CSV, and this check is about CSS, not parsing. The label is the
    // longest realistic one setLabel() produces.
    const list = document.getElementById('set-list');
    list.innerHTML = '';
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = 'Basic 14-18 100pack (1000 puzzles, 1600-2200)';
    const ex = document.createElement('button');
    ex.type = 'button';
    ex.textContent = 'Export';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete';
    li.append(name, ex, del);
    list.appendChild(li);
    // The strip is empty here (section 5 cleared it), so fill a full window of
    // squares to measure the real worst case.
    const strip = document.getElementById('score-strip');
    strip.innerHTML = '';
    for (let i = 0; i < ${STRIP_CAP}; i++) {
      const s = document.createElement('span');
      s.className = 'sq-result ' + (i % 2 ? 'ok' : 'bad');
      strip.appendChild(s);
    }

    const targets = [
      ['#builder', builder],
      ['.builder-grid', builder.querySelector('.builder-grid')],
      ...[...builder.querySelectorAll('fieldset')].map((f, i) => ['fieldset ' + i, f]),
      ['.set-list li', li],
      ['#score-strip', strip],
      // The menu the user actually screenshotted: at <=900px it is a fixed
      // sheet spanning the viewport minus its side insets, so it must fit too.
      ['#settings-menu', menu],
    ];
    const wide = targets
      .filter(([, el]) => el.scrollWidth > el.clientWidth + 1)
      .map(([label, el]) => label + ' ' + el.scrollWidth + '>' + el.clientWidth);
    const rect = builder.getBoundingClientRect();
    // Sizes as well as overflow, so a pass cannot come from collapsed
    // (zero-width) boxes — and the fieldset widths are what actually prove the
    // panels stacked. In a two-column grid each one measures ~half of this.
    const out = {
      wide,
      right: Math.round(rect.right),
      viewport: innerWidth,
      fieldsets: [...builder.querySelectorAll('fieldset')].map((f) =>
        Math.round(f.getBoundingClientRect().width),
      ),
      row: Math.round(li.getBoundingClientRect().width),
      bars: strip.children.length,
    };
    builder.hidden = true;
    list.innerHTML = '';
    strip.innerHTML = '';
    return out;
  `);
}
for (const w of [390, 360]) {
  const fit = await overflowAt(w, 844);
  check(`no horizontal overflow at ${w}px wide`, fit.wide.length === 0, fit.wide.join(', '));
  check(
    `builder panel stays inside a ${w}px viewport`,
    fit.right <= fit.viewport + 1,
    `right=${fit.right} viewport=${fit.viewport}`,
  );
  check(
    `both builder panels stack full-width at ${w}px`,
    fit.fieldsets.length === 2 && Math.min(...fit.fieldsets) > 250,
    fit.fieldsets.join('/') + 'px',
  );
  check(
    `set row and strip really laid out at ${w}px`,
    fit.row > 250 && fit.bars === STRIP_CAP,
    `row=${fit.row}px bars=${fit.bars}`,
  );
}
await send('Emulation.clearDeviceMetricsOverride');
await sleep(200);

ws.close();
chrome.kill();
// Chrome flushes its profile asynchronously; removing it immediately can hit
// EPERM on Windows. A failure here must not mask the real results, so the
// temp dir is left to the OS rather than failing the run.
await sleep(500);
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
} catch {
  /* temp profile left behind in %TEMP% — harmless */
}

// NOTE: no process.exit() — see scripts/verify-drag.mjs.
process.exitCode = failures ? 1 : 0;