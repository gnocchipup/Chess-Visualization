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

- **`git` is not on PATH.** The repo is managed through **GitHub Desktop**. To run
  read-only git commands, resolve the bundled binary:

```powershell
$git = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" |
       Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
& $git status --short
& $git log --oneline -10
```

- Cline's memory reset means `.clinerules/` and `memory-bank/` are untracked (`??` in
  `git status`) — that is expected, not a mistake to fix.

## Commands

```powershell
npm ci            # exact install from package-lock.json
npm run dev       # dev server with HMR, http://localhost:5173
npm run build     # production build into dist/
npm run preview   # serve dist/ at http://localhost:4173
npm test          # all eight verify scripts in sequence
npm run smoke     # needs `npm run preview` running in another terminal
```

`npm test` runs, in order: `test:topbar`, `test:flip`, `test:coords`, `test:next`,
`test:ply`, `test:loop`, `test:orient`, `test:drag`.

## Test inventory

| Script | Offline? | Covers |
| --- | --- | --- |
| `scripts/verify-topbar.mjs` | **yes** | Drawer geometry + header-collapse maths, `MOBILE_QUERY` vs the CSS breakpoint |
| `scripts/verify-flip.mjs` | **yes** | Orientation rules, `cpt.flipped` round trip, junk-value handling |
| `scripts/verify-coords.mjs` | **yes** | File letters, rank numbers, colour circles in both orientations |
| `scripts/verify-yh7ub.mjs` | no | **Ply-alignment acceptance test** — exact FEN + context rows for `Yh7uB` |
| `scripts/verify-orientation.mjs` | no | Solver owns `solution[0]`; CSV FEN side is the opponent; white *and* black covered |
| `scripts/verify-next.mjs` | no | `GET /api/puzzle/next` payload shape |
| `scripts/verify-solving.mjs` | no | Solving-loop logic |
| `scripts/verify-drag.mjs` | no | Square-to-square drag-input logic |
| `scripts/smoke-preview.mjs` | local server | `/` serves, bundle loads, WASM reachable, `ORDER BY RANDOM` survived minification |

**Only the first three run offline.** The rest hit the live Lichess API with nothing
mocked, mirroring the app's own no-network-no-app rule. In a sandbox without egress,
run `npm run test:topbar && npm run test:flip && npm run test:coords` instead of
`npm test`.


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
