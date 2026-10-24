/**
 * Locate a Chromium-family browser for the browser-driven verify scripts
 * (`verify-pwa.mjs`, `verify-layout.mjs`).
 *
 * Both drive Chrome DevTools Protocol directly, and every Chromium build speaks
 * it — so the browser does not have to be *Chrome*. Hardcoding
 * `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe` (which this
 * repo did) works on exactly the machine it was written on: the machine where
 * this was noticed has Edge and no Chrome at all, so `npm run test:pwa` died in
 * `spawn` with ENOENT rather than failing a check.
 *
 * Order: an explicit override, then the normal install locations for Chrome and
 * Edge (per-user installs included), then the usual Linux/macOS paths.
 *
 * Kept pure and injectable — `exists` and `platform` can be supplied — so the
 * ordering can be tested without any of those files existing.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Well-known Windows install locations, most specific first. */
function windowsCandidates(env) {
  const programDirs = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(Boolean);
  const out = [];
  for (const dir of programDirs) {
    out.push(join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    out.push(join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  // Chrome's per-user install lands under LOCALAPPDATA\Google, not under
  // LOCALAPPDATA\Programs (that one is for Electron-style apps).
  if (env.LOCALAPPDATA) {
    out.push(join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  return out;
}

/** Well-known Linux/macOS install locations. */
function unixCandidates() {
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
}

/**
 * Every candidate path, in the order they should be tried. `CHROME_PATH` (or
 * `CHROME_BIN`) always wins, so a browser in an unusual place is one env var
 * away and needs no code change.
 */
export function browserCandidates({ env = process.env, platform = process.platform } = {}) {
  const override = env.CHROME_PATH || env.CHROME_BIN;
  const installed = platform === 'win32' ? windowsCandidates(env) : unixCandidates();
  return [override, ...installed].filter(Boolean);
}

/** The first candidate that exists, or `null`. */
export function resolveBrowserPath(options = {}) {
  const exists = options.exists ?? existsSync;
  return browserCandidates(options).find((path) => exists(path)) ?? null;
}
