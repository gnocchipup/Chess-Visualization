# System Patterns — architecture and key decisions

## Module map

```
index.html                      entry point + all static markup (no build-time templating)
public/noobvisualize.png        favicon / logo (1.3 MB, generated with ChatGPT)
public/readme.html              the in-app "How to use" page
└── src/main.js                  composition root: header, menus, set picker, score, builder
    ├── src/builder.js           CSV stream-parse + reservoir sampling + file save
    ├── src/sqlsets.js           sql.js wrapper: create / inspect / open set DBs, random puzzle
    ├── src/idb.js               IndexedDB persistence of sets
    ├── src/settings.js          localStorage settings + session score
    ├── src/auth.js              Lichess OAuth2 + PKCE, fully client-side
    ├── src/lichess.js           GET /api/puzzle/{id}, GET /api/puzzle/next, POST batch/mix
    ├── src/exercise.js          one puzzle: fetch, ply alignment, render, solving loop
    │   ├── src/board.js         FEN -> static 8x8 SVG grid + coordinate gutters
    │   └── src/orientation.js   orientation, coordinate order, side colours (pure, unit-tested)
    ├── src/layout.js            mobile header collapse + legacy drawer (pure geometry, unit-tested)
    ├── src/pieces/*.svg         Cburnett piece set (12 files)
    └── src/style.css            all styling, single file
```

Dependencies flow strictly downward. `main.js` knows everything; leaf modules know nothing.

## Pattern 1 — Pure logic extracted for offline testing

The single most important structural decision. Anything with a real rule in it is written
as a **pure function with no DOM and no asset imports**, so a plain Node script can test
it with no browser and no network.

| Module | Pure exports | Tested by |
| --- | --- | --- |
| `orientation.js` | `flipOrientation`, `topColor`, `fileOrder`, `rankOrder`, `resolveOrientation` | `verify-flip.mjs`, `verify-coords.mjs` |
| `layout.js` | `clampDrawerOffset`, `resolveDrawerOpen`, `clampCollapseProgress`, `collapseProgress`, `resolveCollapseOpen`, `restingProgress` | `verify-topbar.mjs` |
| `settings.js` | all getters/setters (storage touched only inside functions) | `verify-flip.mjs` (localStorage stub) |

**Rule to follow:** when adding a rule, put the *decision* in a pure function and let the
DOM code only carry it out. `board.js` is the counter-example that shows why — it paints
the grid, and `verify-coords.mjs` has to *mirror* its square-naming logic rather than
import it. Keep new rules out of that situation.

**Node has no storage.** A `localStorage` stub is installed via
`Object.defineProperty(globalThis, 'localStorage', {...})` before importing `settings.js`.

## Pattern 2 — Orientation is decided in exactly one place

`orientation.js` is the single source of truth, and `orientation` **always names the
colour shown at the bottom of the board**:

- `'white'` → rank 8 on top, file a on the left (default)
- `'black'` → rank 1 on top, file h on the left (flipped)

```
resolveOrientation(solverColor, flipped) = flipped ? flip(solverColor) : solverColor
topColor(orientation)                     = flip(orientation)
```

`solverColor` is derived from the **solving** position's side to move — never the CSV FEN.
`flipped` is the persisted user preference (`cpt.flipped`), which shows the *other* side
than auto — that is precisely what carries a manual flip over to the next puzzle, where
the solver may well be the other colour.

Everything that follows orientation is derived from it: `fileOrder`, `rankOrder`, the two
colour circles, the board's `title` and `aria-label`, and the red `data-flipped` ring.
`Exercise.paintBoard()` repaints **all** of it in one call, so a turned board can never
leave stale chrome pointing the wrong way.


## Pattern 3 — The board is static; gestures are input, not animation

`renderBoard()` paints a FEN into an 8×8 CSS grid of `<img>` SVGs and returns. It is
never called again during solving. A flip only re-paints the same position.

The gesture path (`pointerdown`/`pointermove`/`pointerup`, one code path for mouse and
touch) does **not** move pieces. It translates a from→to pair into the *same* `attempt()`
call that typing SAN would produce. The only visual feedback is a translucent grey chip:
held under the pointer while dragging, parked on the square after a tap-select (tap-tap
input). The chip is sized relative to a board square and recomputed every gesture, so a
resize cannot leave a stale size.

Release paths on `pointerup`:

| Release | Result |
| --- | --- |
| on a different square | `attemptDrag(from, to)` — always a move claim |
| back on the start square | cancelled, no attempt |
| off the board | cancelled, no attempt |
| no movement, tap on unselected square | select, park chip |
| no movement, tap on selected square | deselect |
| no movement, tap elsewhere with a selection | `attemptDrag(selection, tap)` (tap-tap) |

`dragMoved` becomes true when the pointer reaches a square different from the start; that
is the sole discriminator between a drag and a tap. `pointercancel` behaves like a
non-committal release, preserving any tap selection.

Hit-testing uses `document.elementFromPoint(x, y)` → `closest('.sq')` →
`dataset.square`. **This is why the coordinate gutters live outside `#board` in the
markup** — a gutter element under the pointer would break square resolution. Each square
carries `data-square` with its *algebraic* name computed in white's point of view, so
hit-testing works in either orientation without re-deriving coordinates from DOM order.
Square shading is intrinsic to the square, so flipping preserves it (a8 and h1 stay light).

## Pattern 4 — Ply alignment anchored on the API, never the CSV

`Exercise.setup()` replays the game PGN with `chess.js`, builds `fenAfter(k) = P(k)`, then:

```
X             = min(max(0, plyBack), initialPly)
boardFen      = fenAfter(initialPly - X + 1)
solvingFen    = fenAfter(initialPly + 1)
contextMoves  = indices initialPly - X + 1 .. initialPly   (read-only lead-up)
solution      = puzzle.solution  (preferred)
              = CSV Moves, trying slice(1) then the full list, keeping the first
                whose opening move is legal in solvingFen
```

`initialPly` is range-checked against the game length. A `Chess` instance is built on
`solvingFen` and is the authority for legality. `startFen` comes from `hist[0].before`.

Pinned by `verify-yh7ub.mjs`: puzzle `Yh7uB` at ply-back 4 must render FEN
`2kr4/pbp2pp1/5n1p/1B2r3/1P1p2q1/2NP1N2/1PP2PPP/R2Q1RK1 b - - 0 17` with context moves
`17... Rg5`, `18. Ne1 Qh3`, `19. Ba6`, first solver input at `19...` expecting `Rxg2+`.


## Pattern 5 — The move table grows one ply at a time

`solutionCell(i)` and `addSolverInput(i)` create rows and cells **on demand**, keyed by
move number in `rowsByNum`. Later plies have no row, no cell, and no input until reached,
so the table cannot leak the solution's length. Each input's `keydown` handler closes
over its own index, so no `disabled` juggling is needed — exactly one input exists per
reached ply.

Cell classes encode the result: `mine-first` (green, accepted first try),
`mine-recovered` (amber, accepted after a failure on that ply), `opponent` (blue reply),
`wrong` (red, current failure), `revealed` (muted, filled by Reveal). Rows are `N.` +
white cell + black cell; the `cellFor` helper resolves a ply to its column by parity.

`reveal()` therefore *grows* the table too, creating inputs for unreached plies before
overwriting them.

## Pattern 6 — The solving attempt is one function for both input modes

`attempt(solIdx, drag = null)`:

1. Guard: `solIdx !== this.solIdx` → return (stale gesture, e.g. a promotion dialog left
   open while a typed move advanced the puzzle).
2. Empty input with no drag → return.
3. Apply the move: `chess.move({from, to, promotion})` for a drag, or
   `chess.move(raw, { strict: false })` for typed SAN. `strict: false` accepts a missing
   or extra trailing `+`/`#`; genuinely ambiguous or unparseable input throws.
4. **On throw** — a failed attempt. A drag writes `from-to` into the input so the feedback
   matches what a legal-but-wrong drag shows.
5. Accept iff `uci === scripted`, **or** `isLast && chess.isCheckmate()` — the alternate
   last move, which accepts any mating move on the final ply.
6. Reject → `chess.undo()`, then `markWrong`.
7. Accept → colour the cell, play the opponent's reply immediately (no delay), create the
   next input, advance focus — **but only for typed input**; a drag must not steal focus,
   or the on-screen keyboard pops up over the board after every move.

`markWrong` sets `input.dataset.failed = '1'`, which is what turns a later accept on that
ply amber instead of green. The `input` listener clears only the red `wrong` class and
deliberately keeps `dataset.failed`.

**Promotion** pauses the gesture: a pawn reaching rank 1 or 8 opens a modal
(`role="dialog"`, `aria-modal`) with four piece choices and **no default**. Clicking the
dimmed backdrop or pressing `Escape` cancels without a failed attempt — no piece was
named, so no move was claimed. Choosing the wrong piece is an ordinary failed attempt.
The pending gesture lives in `this.promoPending` and is discarded by `attempt()`'s guard
if the puzzle moved on. Choices are built from the promoting pawn's colour so the solver
sees their own pieces.

## Pattern 7 — Spoiler containment

Two independent mechanisms, both in `renderInfo()` (which is rebuilt per puzzle, so the
hidden state resets automatically):

- `meta` (rating + themes) starts `hidden` and is unhidden by the **Hint** button, which
  then removes itself.
- `revealBtn` starts `hidden` + `disabled`; it is unhidden **only** inside the Hint
  handler. `setup()`, `showError()`, and `finish()` all re-hide and re-disable it.

## Pattern 8 — Network calls are fatal and explicitly shaped

`lichess.js` wraps every call with the same discipline: distinguish a *network* failure
from an *HTTP* failure, and run `checkPuzzleShape()` (requires `game.pgn` and a numeric
`puzzle.initialPly`) before handing the payload on. Callers treat any throw as a
retryable error state — there is no fallback path, by design.

- `fetchPuzzle(id)` → `GET /api/puzzle/{id}`.
- `fetchNextPuzzle(difficulty)` → `GET /api/puzzle/next`, one call per press, difficulty
  read fresh each time (never cached, so mid-puzzle changes apply immediately). Works
  anonymously (calibrated to rating 1500); only returns *unseen* puzzles when signed in
  with `puzzle:read`. A 401 gets a specific "sign in again" message.
- `reportResult(id, win)` → `POST /api/puzzle/batch/mix?nb=0`, `rated: false`, needs
  `puzzle:write`. `nb=0` is deliberate: the solve endpoint takes no difficulty parameter,
  so bundling a next puzzle would pick it at the default difficulty and swallow a
  mid-puzzle difficulty change. Anonymous callers resolve `null`. 401/403 prompt re-login.

Lichess holds your "next" puzzle until you solve it, so a signed-in caller **must** report
each finished puzzle or every New-puzzle press returns the same id. This is expected
server behaviour (lichess-org/lila#20293), not a fetch bug. Reveals are deliberately
**not** reported — the trade-off is that skipping ahead needs one extra New-puzzle press.

## Pattern 9 — Progressive enhancement / graceful degradation

- **Header collapse** adds a `header-collapse-ready` class to `<html>`. Without the
  class, the header is simply always visible — a page whose script never ran is not
  unreachable. Desktop uses `display: contents` so the markup lays out as if the wrapper
  weren't there. All collapse rules are media-scoped to `(max-width: 900px)`, and
  `MOBILE_QUERY` is asserted equal to the CSS breakpoint by `verify-topbar.mjs`.
- **Legacy `TopBar` drawer** is retained in `layout.js` and in `index.html` as a no-op
  fallback, guarded by `hidden` and wrapped in `try/catch`. It is tested but not live.
- **Auto-focus is gated on `isKeyboardFirst()`** — `(hover: hover) and (pointer: fine)`
  plus `maxTouchPoints === 0`. On touch this prevents an uninvited on-screen keyboard.
- **Drag thresholds** are pure functions of one number (translateY for the drawer, a 0..1
  fraction for the header), with a "tie collapses" rule so a barely-committed pull never
  leaves the header open. `TAP_SLOP = 6` px separates a tap from a drag.
- **`showSaveFilePicker`** is feature-detected with an `<a download>` fallback;
  `AbortError` returns `'cancelled'`, other errors fall through to download.
- **Storage failures are caught everywhere.** `auth.js` falls back to an in-memory
  session; `settings.getResults()` returns `[]` on malformed JSON; a junk `cpt.flipped`
  value degrades to `false`, never to "on".

## Pattern 10 — Storage layout

| Where | Key | Contents |
| --- | --- | --- |
| IndexedDB | db `chess-puzzle-trainer`, store `sets` | `{ id, name, bytes: Uint8Array, createdAt, puzzleCount, ratingMin, ratingMax }` |
| localStorage | `cpt.plyBack` | Ply-back setting (default 4) |
| localStorage | `cpt.activeSet` | Selected set id |
| localStorage | `cpt.results` | Array of booleans, capped at `MAX_RESULTS = 25` |
| localStorage | `cpt.flipped` | `'1'` while flipped from auto, `'0'` otherwise |
| localStorage | `cpt.source` | `'sets'` (default) or `'lichess'` |
| localStorage | `cpt.difficulty` | `''` or one of `NEXT_DIFFICULTIES` |
| localStorage | `cpt.lichessToken` | Serialized OAuth session (survives reloads) |
| sessionStorage | `cpt.oauth.verifier`, `cpt.oauth.state` | PKCE verifier + CSRF state, deleted after exchange |

`listSets()` strips `bytes` for listing and sorts newest-first. `idb.js` opens and closes
the DB per transaction, resolving on `complete` and rejecting on `error`/`abort`. The
OAuth session is in-memory first; the localStorage copy exists only so a reload doesn't
sign you out, and a restored legacy session without `scopes` is assumed to have full scope.

## Puzzle-set schema

```sql
CREATE TABLE puzzles (
  puzzle_id TEXT PRIMARY KEY,
  fen       TEXT NOT NULL,
  moves     TEXT NOT NULL,   -- CSV Moves column, space-separated UCI
  rating    INTEGER,
  themes    TEXT,
  game_url  TEXT
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
-- meta: name, created_at, rating_min, rating_max, puzzle_count, source_rows
```

`createSetDb()` wraps the inserts in a single `BEGIN`/`COMMIT` transaction with a
prepared statement, reports insert progress every 500 rows, then writes meta and returns
`db.export()`. `inspectSet(bytes)` validates by checking for **both** tables before
reading meta, so a foreign `.sqlite` file is rejected with a clear message. `randomPuzzle`
uses `ORDER BY RANDOM() LIMIT 1` — a string Vite must not mangle, which is why
`smoke-preview.mjs` asserts it survived minification.

## Builder pipeline

`buildSet()` = `sampleCsv()` → `createSetDb()` → bytes.

`sampleCsv()` uses Papa Parse with `worker: true` and a `chunk` callback, so the ~1 GB
decompressed CSV is never held as one string. It counts `parsed` / `matched` / `kept` and
reservoir-samples: fill to `count`, then replace at index `floor(random() * matched)`. A
`.csv.zst` is rejected up front in `main.js` `onBuild()` with a message telling the user
to decompress first. `MAX_SAFE_PUZZLES = 50000` triggers a `confirm()` warning because
sql.js holds the whole database in memory.

Progress has two phases with distinct shapes: parse progress carries
`{parsed, matched, kept}` and insert progress carries `{phase:'insert', inserted, total}`.
The UI switches on `p.phase`.

## Build and deploy

- `vite.config.js` sets `base: './'` — relative asset URLs, so the same build works at a
  domain root (Render) or a project subpath (GitHub Pages) with no per-host config.
- `dist/` is git-ignored and rebuilt by every host. Never commit it.
- `.github/workflows/deploy.yml`: push to `main` → `npm ci` → `npm run build` → upload
  artifact → deploy. Pages must be set to source **GitHub Actions**; "Deploy from a
  branch" on `main` serves the raw unbundled `index.html` and cannot run in a browser.
- `index.html` is hand-written. New markup goes there, not in a template.
- `sql-wasm.wasm` is imported with Vite's `?url` suffix so it is emitted as a hashed
  asset; `getSQL()` lazily initialises the module once and caches the promise.

## OAuth2 (client-side, PKCE)

`auth.js` implements Authorization Code + PKCE for a public client — Lichess requires no
registration, so `CLIENT_ID` is an arbitrary stable string. `code_verifier` (43–128 chars)
and `state` are fresh per attempt via `crypto.getRandomValues`, held in `sessionStorage`,
never in a URL, and deleted after exchange. `state` is verified first (CSRF). The
challenge is always S256 (BASE64URL of SHA-256). The redirect URI is
`origin + pathname` and must be byte-identical at authorize and token time. The query
string is scrubbed with `history.replaceState` even on failure. `getToken()` treats a
token as expired 60 s early. `hasWriteScope()` detects legacy read-only tokens
(pre-`puzzle:write`) that would fail a result report with 403, so the UI can tell the
user to sign out and back in. `logout()` revokes server-side then clears local state;
revocation is best-effort since the local session is already gone.

`auth.js` guards its `localStorage` access behind `typeof localStorage !== 'undefined'`
precisely so `verify-next.mjs` can import `lichess.js` (which imports `auth.js`) in Node.

