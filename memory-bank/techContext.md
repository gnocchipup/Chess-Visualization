# Tech Context — technologies, setup, and tool usage

## Stack

| Layer | Choice | Version |
| --- | --- | --- |
| Build / dev server | Vite | ^6.4.3 (devDependency) |
| Language | Vanilla JavaScript, ES modules | `"type": "module"` |
| Chess logic | `chess.js` | ^1.4.0 (BSD-2-Clause) |
| CSV parsing | `papaparse` | ^5.7.0 (MIT) |
| Database | `sql.js` (SQLite → WASM) | ^1.14.2 (MIT) |
| Styling | One hand-written `style.css` | — |
| PWA | Hand-written `manifest.webmanifest` + `sw.js` — **no plugin** | — |
| Pieces | Cburnett SVGs, 12 files | — |
| Tests | Plain Node scripts, no test framework | — |

**No UI framework. No chessboard library. No test runner.** This is a deliberate
constraint from `specs.md`, not an omission.

## Requirements

- **Node.js** 20+ (developed against 24.19.0)
- **npm** (developed against 11.17.0)
- **A live internet connection** — the app hard-requires the Lichess API.

## Windows environment notes (this machine)

> **`npm` may fail** with `npm.ps1 cannot be loaded because running scripts is disabled on
> this system`. This is the **PowerShell execution policy**, not npm. Use **`npm.cmd`**
> instead.

> **Node was missing until 2026-10-24, and is now installed without admin rights.**
> Neither `node` nor `npm` resolved in a fresh shell, so nothing in this repo could build or
> test. The fix used, because the account is **not** elevated and the MSI route wants UAC:
>
> - downloaded the official **win-x64 zip** from `nodejs.org/dist` (latest LTS, **v24.22.1**,
>   npm 11.19.1) — `curl.exe` works where a background PowerShell's HTTPS call hangs, see
>   below;
> - extracted with **`tar.exe -xf`** (`Expand-Archive` on this 36 MB / ~4 000-file zip takes
>   well over 30 s and is easy to interrupt);
> - into **`%LOCALAPPDATA%\nodejs`**, so `node.exe` sits at its root, and prepended that
>   folder to the **user** `PATH` (`[Environment]::SetEnvironmentVariable('Path', ..., 'User')`).
>   Nothing machine-wide changed, and uninstalling is deleting that one folder.
>
> A shell started before the install keeps its old `PATH`; prepend
> `$env:LOCALAPPDATA\nodejs` or open a new terminal.

> **Only Microsoft Edge is installed — there is no Chrome.** `C:\Program Files (x86)\
> Microsoft\Edge\Application\msedge.exe` is the only Chromium on the machine, and Chrome is
> absent from all three usual locations. That made the hardcoded `chrome.exe` path in
> `verify-pwa.mjs` a real failure on this machine (spawn ENOENT, not a failed check), which is
> why browser lookup now lives in `scripts/lib/browser-path.mjs` (`CHROME_PATH` → Chrome →
> Edge → Chromium). Edge speaks the same CDP, so nothing else had to change.

> **`vite preview` binds IPv6 loopback only.** `http://localhost:4173/` answers;
> `http://127.0.0.1:4173/` is refused. A hand-rolled "is the preview up?" probe must use
> `localhost` (both committed scripts do).

> **Outbound HTTPS hangs inside a hidden/background PowerShell** (`Start-Process -WindowStyle
> Hidden`) on this machine — `Invoke-RestMethod` *and* `[Net.WebRequest]` with `$req.Proxy =
> $null`, while the exact same call in a foreground shell returns in under a second. Two
> consequences:
>
> - anything long-running that a tool call would time out on (downloads, `npm ci`, test
>   suites) should be started detached with its output redirected to a file, then polled —
>   but keep *network* steps in the foreground, or use `curl.exe`;
> - CDP clients must poll `/json/list` with `[System.Net.WebRequest]::Create(...)` +
>   `$req.Proxy = $null` and, if that still hangs, run in the foreground.

> **Screenshot traps, for anyone repeating the layout measurements by hand:**
> `--window-size` is not a viewport (Windows enforces a minimum window width, and desktop
> Chromium maps `width=device-width` to the *screen*, so a narrow window lays out at ~490px
> or the full screen), and a viewport meta is only applied at *navigation* time — so
> `Emulation.setDeviceMetricsOverride` must be followed by a reload, or every case reports
> Chromium's 980px mobile fallback.

> **Never round-trip repo files through `Get-Content` / `Set-Content` in Windows PowerShell
> 5.1.** Without `-Encoding`, they decode UTF-8 as ANSI: one
> `(Get-Content f -Raw) -replace … | Set-Content f` turned every `—` in `src/style.css`
> into `â€”` (and `⇅` into `â‡…`) while leaving the CSS perfectly valid, so nothing failed —
> only `git diff` showed single-line churn on lines nobody had touched. Repair is possible
> (`UTF8 → CP1252 bytes → UTF8`) but avoidable: use
> `[IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)` and
> `[IO.File]::WriteAllText($p, $s, (New-Object Text.UTF8Encoding($false)))`, or an editor
> that handles encoding. The repo also normalises to LF on commit (`* text=auto` in
> `.gitattributes`), so CRLF in the working tree is expected and does not show in diffs.

- **`git` is not on PATH.** The repo is managed through **GitHub Desktop**. To run
  read-only git commands, resolve the bundled binary:

```powershell
$git = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" |
       Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
& $git status --short
& $git log --oneline -10
```

- **`.clinerules/` and `memory-bank/` are tracked** (7 files, `git ls-files` lists them).
  An earlier note here claimed they were untracked — that was wrong, and it matters: they
  are part of the repo, so edits to them show up as `M` and belong in the same commit as
  the work they describe.

## Commands

```powershell
npm ci             # exact install from package-lock.json
npm run dev        # dev server with HMR, http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve dist/ at http://localhost:4173
npm test           # all nine verify scripts in sequence
npm run test:pwa   # manifest + service worker + settings-menu rows (needs preview)
npm run test:layout # responsive layout at 10 device viewports (needs preview)
npm run smoke      # needs `npm run preview` running in another terminal
```

`npm test` runs, in order: `test:topbar`, `test:flip`, `test:coords`, `test:score`,
`test:next`, `test:ply`, `test:loop`, `test:orient`, `test:drag`. `test:pwa`,
`test:layout` and `smoke` are **not** in `npm test` — like the others in that group they
need `npm run preview` already serving on 4173.

## Test inventory

| Script | Offline? | Covers |
| --- | --- | --- |
| `scripts/verify-topbar.mjs` | **yes** | Drawer geometry + header-collapse maths, `MOBILE_QUERY` vs the CSS breakpoint |
| `scripts/verify-flip.mjs` | **yes** | Orientation rules, `cpt.flipped` round trip, junk-value handling |
| `scripts/verify-coords.mjs` | **yes** | File letters, rank numbers, colour circles in both orientations |
| `scripts/verify-score.mjs` | **yes** | Score log vs capped strip, `MAX_LOG` backstop, junk-storage filtering |
| `scripts/verify-yh7ub.mjs` | no | **Ply-alignment acceptance test** — exact FEN + context rows for `Yh7uB` |
| `scripts/verify-orientation.mjs` | no | Solver owns `solution[0]`; CSV FEN side is the opponent; white *and* black covered |
| `scripts/verify-next.mjs` | no | `GET /api/puzzle/next` payload shape |
| `scripts/verify-solving.mjs` | no | Solving-loop logic |
| `scripts/verify-drag.mjs` | no | Square-to-square drag-input logic |
| `scripts/smoke-preview.mjs` | local server | `/` serves, bundle loads, WASM reachable, `ORDER BY RANDOM` survived minification |
| `scripts/verify-pwa.mjs` | local server + Chromium | Manifest/icons/SW installability, "never cache lichess.org", conditional menu rows, the default source + hidden builder, and phone-width (390/360px) overflow of the builder panel and score strip |
| `scripts/verify-layout.mjs` | local server + Chromium | Responsive layout at 10 device viewports (4:3 E-Ink both ways, phone both ways, tablet portrait, 320x568, 320x800, square, desktop): no sideways scroll, board square / within its 560px ceiling / inside one screen, panel in the same row for the aspect-ratio layout with **New puzzle** on screen, panel under the board sharing its width *and the whole page exactly one screen tall* with a usable move-table window for the portrait layout, all `MAX_STRIP` markers drawn, plus a builder-open case |

**Only the first four run offline.** The rest hit the live Lichess API with nothing
mocked, mirroring the app's own no-network-no-app rule. In a sandbox without egress,
run `npm run test:topbar && npm run test:flip && npm run test:coords && npm run test:score`
instead of `npm test`.

Two scripts drive a browser — `verify-pwa.mjs` (port 9333) and `verify-layout.mjs` (9334).
Both launch a headless Chromium with a temp profile and talk CDP, and both get the binary
from **`scripts/lib/browser-path.mjs`** (`CHROME_PATH` / `CHROME_BIN` → Chrome → Edge →
Chromium), so neither cares whether Chrome is installed. `verify-layout.mjs` deliberately
reloads after `setDeviceMetricsOverride` — a viewport meta is applied at navigation time,
so measuring first would report Chromium's 980px mobile fallback for every size. **Both
serve the built `dist/`, not `src/`** — npm run build before re-running after a CSS edit, or
the test happily passes against the old layout (this happened, and looked like the test
being weak).

`verify-layout.mjs` was mutation-checked twice. Putting the pre-fix
`flex: 1 1 100%` back makes it fail four checks (board 567px wide on the 4:3 portrait,
703px on the tablet portrait, 835px on the square, and `bottom=967` against a 900px
viewport). And while the one-screen portrait layout was being written, the first attempt
sized the app with a flex `body`; that failed the builder case (`shell.h=201` against
`vh=840`) — which is why that case exists. A layout test that cannot fail is worse than no
test.

Both exist to catch things a DOM-free test cannot see: a collapsed menu reports height 0 for
*every* row, a `display:` author rule silently beats the `hidden` attribute, and a layout can
be "correct" at 390px while a 4:3 screen 900px wide stacks itself into an unusable state.
The browser keeps its profile locked for a moment after exit, so the `rmSync` of the temp
dir is best-effort in both scripts — it must never fail the run.

## Test script conventions (follow these when adding one)

Every verify script follows the same shape, and consistency here matters:

1. A header comment naming the module and the exact command to run, and stating
   explicitly what is *not* covered (e.g. "the pointer plumbing needs a browser").
2. A `check(label, cond, extra)` helper printing `PASS` / `FAIL` and incrementing a
   `failures` counter.
3. `console.log('\nN. <section title>')` to group cases readably.
4. **No `process.exit()`.** Set `process.exitCode = failures ? 1 : 0` so buffered stdout
   flushes on Windows. (`verify-topbar.mjs` is the canonical reference for this comment.)
5. Import only pure modules, or install stubs (`localStorage`) *before* a dynamic
   `await import()` of a module that touches storage at call time.

## Code style observed in the codebase

- 2-space indent, single quotes, semicolons, trailing commas in multi-line literals.
- ES modules everywhere; `import` at the top of each file.
- `$ = (id) => document.getElementById(id)` in `main.js`, with a single `els` object
  holding every cached element reference.
- **Comments explain *why*, not *what*.** This is a strong, consistent convention — long
  prose comments above functions and inline notes at non-obvious branches. The codebase
  documents its own reasoning, and new code is expected to match.
- Comments cite the empirical evidence or upstream issue behind a decision
  (e.g. `lichess-org/lila#20293`, `lila#19208`).
- DOM is built with `document.createElement` + `append`, not `innerHTML` string
  concatenation — so untrusted values (themes, puzzle ids) can't inject markup. The few
  `innerHTML = ''` uses are only to clear.
- Errors are surfaced to the user via `exercise.showError(message, retryFn, { retry })`.
  `retryFn` is optional; `{ retry: false }` renders the message with no button.
- Long button labels use a two-span pattern: `<span class="label-wide">` and
  `<span class="label-narrow">`, toggled by media query. Follow it for new buttons.
- Files end with a newline; no semicolon-less style, no tabs.


## Browser APIs used, and their constraints

| API | Where | Note |
| --- | --- | --- |
| `indexedDB` | `idb.js` | DB `chess-puzzle-trainer`, store `sets`, version 1 |
| `localStorage` / `sessionStorage` | `settings.js`, `auth.js` | Absent in Node — stub for tests |
| `showSaveFilePicker` | `builder.js` | Chromium only; feature-detected |
| `File.arrayBuffer()` | `main.js` `onImport` | |
| `<input type="file">` | `main.js` | Native picker for CSV and `.sqlite` |
| `crypto.randomUUID` | `main.js` | Set ids |
| `crypto.getRandomValues`, `crypto.subtle.digest` | `auth.js` | PKCE |
| `document.elementFromPoint` | `exercise.js` | Square hit-testing |
| `setPointerCapture` | `exercise.js` | Drag tracking |
| `matchMedia`, `ResizeObserver` | `layout.js` | Collapse measurement; both feature-guarded |
| `Worker` (via Papa Parse `worker: true`) | `builder.js` | CSV streaming |
| `navigator.serviceWorker` | `main.js` | Registration only; skipped in DEV and off HTTPS |
| `caches` (Cache Storage) | `public/sw.js` | App shell only; cross-origin never cached |
| `env(safe-area-inset-*)` | `style.css` | 0 in a browser tab; only matters when installed |
| `dvh` units + `aspect-ratio` media feature | `style.css` | `dvh` needs Chromium 108+; every use is preceded by a `vh` line as the fallback. `aspect-ratio` media queries are 88+, so the squarish layout degrades to the stacked one on an older E-Ink browser rather than breaking |

## Licensing constraints worth remembering

- Puzzle/game data: **CC0** (Lichess) — no attribution legally required.
- Cburnett piece SVGs: **attribution required**. Released under CC BY-SA 3.0 *and*
  BSD 3-Clause *and* GPLv2+ simultaneously. **BSD 3-Clause is the most permissive
  option** if share-alike must be avoided. There is a known unresolved upstream
  discrepancy (Lichess credits GPLv2+; Wikimedia says CC BY-SA 3.0) —
  `lichess-org/lila#19208`, closed as not planned. Check before commercial redistribution.
- **This project's own code has no `LICENSE` file** — "all rights reserved" by default.
  Adding one is an open task.
- `public/noobvisualize.png` was generated with ChatGPT (OpenAI).

## Attribution of authorship

Per the README, the project was built in **Cline Desktop** with **DeepSeek** (architecture,
SQLite/sql.js design, ply-alignment logic, spec) and **Kimi K3** / Moonshot AI
(implementation and coding assistance). Keep that credits section accurate if it changes.
