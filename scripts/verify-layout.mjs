// Verifies the responsive layout contract at real device viewports, against a
// running `vite preview` (expects port 4173):
//
//   npm run preview        # in another terminal
//   npm run test:layout
//
// A browser is required because the contract is what CSS actually *computes*,
// and the two regressions pinned here are invisible to a DOM-free test:
//
//   1. **Width-only breakpoints.** A 4:3 E-Ink reader (Boox Go Color 7, about
//      840x632 CSS px) is under the 900px breakpoint and so was *stacked*: a
//      775px board inside a 632px-tall viewport, with the move table ~900px
//      below the fold and New puzzle unreachable. Only the browser's "desktop
//      mode" looked right, because that widened the viewport into two columns.
//   2. **`flex-basis` beats `width`.** The stacked layout's `flex: 1 1 100%`
//      silently discarded the 560px board ceiling (a 768px tablet drew 703px).
//
// The viewport meta is applied at *navigation* time, so every case reloads after
// setting device metrics. Measuring without the reload reports Chromium's 980px
// mobile fallback for every size — the "why is every case identical" trap.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBrowserPath } from './lib/browser-path.mjs';
import { MAX_STRIP } from '../src/settings.js';

const BASE = 'http://localhost:4173';
const BROWSER = resolveBrowserPath();
const PORT = 9334;

/** The board's ceiling on a roomy screen: `--board-cap`'s base value. */
const BOARD_CEILING = 560;
/** Slack between the board column's top and the panel's top in a two-column row. */
const ROW_TOLERANCE = 40;

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!BROWSER) {
  console.error(
    'No Chromium-family browser found.\n' +
      'Install Chrome or Edge, or point CHROME_PATH at a Chromium binary.',
  );
  process.exit(1);
}

// A missing preview server otherwise shows up as a 15s CDP timeout, which reads
// like a broken test rather than a missing prerequisite.
try {
  const res = await fetch(BASE + '/', { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (err) {
  console.error(
    `\`vite preview\` is not answering on ${BASE} (${err.message}).\n` +
      'Run `npm run build && npm run preview` in another terminal first.',
  );
  process.exit(1);
}

console.log(`Using browser: ${BROWSER}`);

const profile = mkdtempSync(join(tmpdir(), 'cpt-layout-'));
const browser = spawn(BROWSER, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  // Deterministic widths: a classic scrollbar would otherwise change the
  // available content box by 15px between platforms.
  '--hide-scrollbars',
  BASE + '/',
]);
browser.stderr.on('data', () => {});

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
  throw new Error('the browser did not expose a CDP page target');
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

async function waitFor(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(`return Boolean(${predicate});`)) return true;
    } catch {
      /* context mid-swap; retry */
    }
    await sleep(100);
  }
  return false;
}

await send('Page.enable');

/**
 * Fill the parts of the panel the app only paints once a puzzle has arrived, so
 * the measurements describe the layout rather than an empty shell. The real
 * solver flow needs the Lichess API; this test is about CSS.
 */
const SEED = `
  const strip = document.getElementById('score-strip');
  strip.textContent = '';
  for (let i = 0; i < ${MAX_STRIP}; i++) {
    const s = document.createElement('span');
    s.className = 'sq-result ' + (i % 4 ? 'ok' : 'bad');
    strip.appendChild(s);
  }
  const info = document.getElementById('puzzle-info');
  info.textContent = '';
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = 'Puzzle Yh7uB \\u00b7 1450 \\u00b7 mateIn2';
  info.appendChild(p);
  const table = document.getElementById('move-table');
  table.textContent = '';
  for (let i = 1; i <= 12; i++) {
    const tr = document.createElement('tr');
    const num = document.createElement('td');
    num.className = 'num';
    num.textContent = i + '.';
    const white = document.createElement('td');
    white.className = 'mv';
    white.textContent = 'Nf3';
    const black = document.createElement('td');
    black.className = 'mv opponent';
    black.textContent = 'Nc6';
    tr.append(num, white, black);
    table.appendChild(tr);
  }
`;

const MEASURE = `
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      right: Math.round(r.right), bottom: Math.round(r.bottom),
    };
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const board = document.getElementById('board');
  const wrap = document.getElementById('board-wrap');
  const side = document.getElementById('side');
  const controls = document.querySelector('.controls');
  const strip = document.getElementById('score-strip');
  const overflowing = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
      overflowing.push((el.id || el.className || el.tagName) + '..' + Math.round(r.right));
    }
  }
  return JSON.stringify({
    vw, vh,
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    board: box(board), wrap: box(wrap), side: box(side), controls: box(controls),
    stripClipped: strip.scrollWidth > strip.clientWidth + 1,
    flexWrap: getComputedStyle(document.querySelector('main')).flexWrap,
    overflowing: overflowing.slice(0, 5),
  });
`;

async function measureAt({ w, h, dpr }) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: dpr,
    mobile: true,
  });
  await send('Page.reload', { ignoreCache: false });
  if (!(await waitFor("document.readyState === 'complete' && document.querySelector('#board')"))) {
    throw new Error(`the page never settled at ${w}x${h}`);
  }
  await sleep(150);
  // Seeding and measuring in one evaluation: nothing asynchronous can wipe the
  // seeded rows in between. The seed is wrapped in a block so its locals cannot
  // collide with the measurement's (they both want a `strip`).
  return JSON.parse(await evaluate(`{\n${SEED}\n}\n${MEASURE}`));
}

/**
 * The matrix that matters. `columns` = board and panel side by side, `stacked` =
 * board above the panel. The E-Ink sizes are the reported device's own geometry
 * (1680x1264 at DPR 2 and 2.5, both orientations).
 */
const CASES = [
  { name: 'phone portrait 393x851', w: 393, h: 851, dpr: 2.75, layout: 'stacked' },
  { name: 'phone landscape 851x393', w: 851, h: 393, dpr: 2.75, layout: 'columns' },
  { name: '4:3 E-Ink portrait 632x840', w: 632, h: 840, dpr: 2, layout: 'stacked' },
  { name: '4:3 E-Ink landscape 840x632', w: 840, h: 632, dpr: 2, layout: 'columns' },
  { name: '4:3 E-Ink landscape 672x505', w: 672, h: 505, dpr: 2.5, layout: 'columns' },
  { name: 'tablet portrait 768x1024', w: 768, h: 1024, dpr: 2, layout: 'stacked' },
  { name: 'square 900x900', w: 900, h: 900, dpr: 1, layout: 'stacked' },
  { name: 'narrow phone 320x568', w: 320, h: 568, dpr: 2, layout: 'stacked' },
  { name: 'desktop 1280x800', w: 1280, h: 800, dpr: 1, layout: 'columns' },
];

for (const c of CASES) {
  console.log(`\n${c.name} (${c.layout})`);
  const m = await measureAt(c);

  check('page does not scroll sideways', m.scrollW <= m.vw + 1, `scrollW=${m.scrollW} vw=${m.vw}`);
  check('nothing pokes past the right edge', m.overflowing.length === 0, m.overflowing.join(', '));
  check('the board is square', Math.abs(m.board.w - m.board.h) <= 1, `${m.board.w}x${m.board.h}`);
  // The whole point of the height budget: the board itself is never taller than
  // the screen it is on.
  check('the board fits one screen', m.board.bottom <= m.vh + 1, `bottom=${m.board.bottom} vh=${m.vh}`);
  check(
    `the board respects its ${BOARD_CEILING}px ceiling`,
    m.board.w <= BOARD_CEILING + 1,
    `${m.board.w}px wide`,
  );
  check('score strip shows all its markers', !m.stripClipped, `${MAX_STRIP} markers`);

  if (c.layout === 'columns') {
    check(
      'board and panel share a row',
      Math.abs(m.board.y - m.side.y) <= ROW_TOLERANCE,
      `board.y=${m.board.y} side.y=${m.side.y}`,
    );
    check('the row does not wrap', m.flexWrap === 'nowrap', m.flexWrap);
    check(
      'New puzzle is on screen',
      m.controls.bottom <= m.vh + 1,
      `bottom=${m.controls.bottom} vh=${m.vh}`,
    );
    // Not an equality: on the shortest viewports the board's 200px floor is
    // allowed to cost a sliver of scroll rather than shrink the board further.
    check(
      'needs no more than a sliver of vertical scroll',
      m.scrollH <= m.vh + 24,
      `scrollH=${m.scrollH} vh=${m.vh}`,
    );
  } else {
    check(
      'the panel sits under the board',
      m.side.y >= m.board.y + m.board.h - 1,
      `side.y=${m.side.y}`,
    );
    check('the column is wrapped', m.flexWrap === 'wrap', m.flexWrap);
    check(
      'panel and board share one column width',
      Math.abs(m.side.w - m.wrap.w) <= 2,
      `side=${m.side.w} wrap=${m.wrap.w}`,
    );
  }
}

await send('Emulation.clearDeviceMetricsOverride');
ws.close();
browser.kill();
// The browser flushes its profile asynchronously; removing it immediately can
// hit EPERM on Windows. A failure here must not mask the real results.
await sleep(500);
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
} catch {
  /* temp profile left behind in %TEMP% — harmless */
}

console.log(
  failures === 0 ? '\nALL LAYOUT CHECKS PASSED' : `\n${failures} LAYOUT CHECK(S) FAILED`,
);
// NOTE: no process.exit() — see scripts/verify-drag.mjs.
process.exitCode = failures ? 1 : 0;
