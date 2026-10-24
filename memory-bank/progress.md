# Progress — status, what works, what's next

## Snapshot

The app is **feature-complete against `specs.md`** and in active polish. Every one of the
four specified features is implemented, all seven numbered Gotchas are handled
deliberately, and each is pinned by at least one test where a test is possible. The recent
git history is a run of UI/UX refinement commits (board orientation visuals, mobile
layout, header collapse, colour edits) rather than missing functionality.

Last commit at the time of writing: `95664f4 "layout fixes"` on `main` (the
mobile-streamlining work). The **squarish / E-Ink responsive layout** and the
**one-screen portrait layout** described below, plus `scripts/verify-layout.mjs` and
`scripts/lib/browser-path.mjs`, are uncommitted. (An earlier note here called
`.clinerules/` and `memory-bank/` untracked; they are tracked.)

**Node is installed on this machine as of 2026-10-24** (user-scoped, no admin — see
`techContext.md`), so the repo's own gate finally runs here: `npm run build` and `npm test`
exit 0, `npm run test:pwa` is 47 pass / 3 pre-existing manifest failures, and the new
`npm run test:layout` is 125 checks / 0 failures over ten viewports.

## Feature status

### Feature 1 — Puzzle set builder — **complete**

- [x] Native file picker for the plain, decompressed CSV
- [x] Rating min / max / count inputs, with validation
- [x] Streaming worker parse (`Papa.parse` `worker: true` + `chunk`) — never loads the
      ~1 GB file as a string
- [x] Uniform random sample via reservoir sampling
- [x] sql.js DB created with the specified `puzzles` + `meta` schema
- [x] `showSaveFilePicker()` with an `<a download>` fallback
- [x] Bytes also written to IndexedDB (the working store)
- [x] Progress reported as `parsed / matched / kept`, then insert progress
- [x] Import existing `.sqlite` with schema validation
- [x] Export and Delete per set
- [x] `.csv.zst` rejected with an explicit "decompress first" message
- [x] `MAX_SAFE_PUZZLES = 50000` warning

### Feature 2 — Set selection — **complete**

- [x] `<select>` in the header listing every set as
      `"{name} ({n} puzzles, {min}–{max})"`
- [x] Selecting one loads its bytes into a live sql.js Database
- [x] Selection persisted to `cpt.activeSet` and restored on reload
- [x] Falls back to the newest set when the stored id is gone
- [x] Empty state points at the builder and opens the panel

### Feature 3 — Settings — **complete, and extended**

- [x] Ply back, integer, default 4, min 0, persisted
- [x] *Beyond spec:* board flip (`cpt.flipped`) — the spec said flip was "not needed",
      but a static board still benefits from being re-oriented, and it was added
- [x] *Beyond spec:* puzzle source (`sets` | `lichess`) and difficulty for Lichess next

### Feature 4 — Exercise — **complete**

- [x] Static board, move table, session score strip
- [x] Ply-back context as read-only lead-up rows
- [x] Solving position derived from `initialPly`, **not** the CSV
- [x] Clickable `lichess.org/training/{id}` link
- [x] Rating and themes hidden behind **Hint**
- [x] PGN-style table; future plies get no row, cell, or input
- [x] SAN entry with lenient `+`/`#` handling, Enter to submit
- [x] Correct → static text, immediate opponent reply, focus advances
- [x] Incorrect → red, stays put, marks the puzzle failed
- [x] Alternate last move: any mating move accepted on the final ply
- [x] Board never re-renders during solving
- [x] *Beyond spec:* square-to-square drag/tap input with promotion picker
- [x] *Beyond spec:* **Flip board** button + `F` shortcut, persisted
- [x] *Beyond spec:* coordinate gutters and colour circles
- [x] *Beyond spec:* mobile header collapse by drag

### Scoring — **complete**

- [x] Green/red strip, session-scoped, `cpt.results`
- [x] `Solved · Failed` counts in the header
- [x] **Strip** capped at the most recent 22 (`MAX_STRIP`); **totals uncapped** so
      running accuracy stays correct past the cap. A `+N older` marker reports
      how many attempts are not currently drawn. `MAX_LOG = 5000` is a quota
      backstop only. The old single capped array froze the counts at the cap —
      guarded by `scripts/verify-score.mjs` and `verify-pwa.mjs` §5.
- [x] Mobile strip sizing: 12px squares, 2px gap and 0.5rem side padding under 900px,
      so all 22 still fit a 360px phone (pinned by `verify-pwa.mjs` §11); 11px under 380px,
      because at 320px the 12px markers overflowed and `overflow: hidden` cut the *newest*
      results off the right-hand end
- [x] Fixed-width markers (`flex: 0 0 auto; width: 14px`) — no longer `flex: 1 1 0`, which
      re-divided the full row width on every new result
- [x] Counter resets when puzzle source, puzzle set, Lichess difficulty, or ply back changes
- [x] Dedicated **↺ Reset session** button on the score row (same `resetScore()` path), disabled
      when there is nothing to clear; label narrows to "Reset" under 900 px
- [x] *Beyond spec:* flip button reduced to the ⇅ sign alone and recoloured **blue = unflipped
      (default) / red = flipped**, matching the colour circles' haloes

### Gotcha handling — **all seven**

1. Ply alignment → API-anchored, pinned by `verify-yh7ub.mjs` and `verify-orientation.mjs`

### Responsive layout — **complete for phones, tablets and squarish/E-Ink screens**

- [x] Three layout states: desktop (>900px); **one-screen portrait** (`<=900px` and
      `max-aspect-ratio: 5/4`) where the card fills the viewport and board + panel share one
      height budget; and side-by-side (`<=900px` and `min-aspect-ratio: 5/4`) — the last one
      being what a 4:3 E-Ink reader or a landscape tablet was previously only getting via the
      browser's "desktop mode"
- [x] `--board-cap` is a *height* budget in every state (`dvh` with a `vh` fallback), so the
      board never exceeds the screen and the panel's top stays reachable
- [x] Move table scrolls inside the panel on both narrow layouts, keeping **New puzzle** on
      screen; the portrait state additionally makes the *whole page* exactly one screen tall
      (632x840 went from 1232px to 840px)
- [x] `Exercise.scrollTableToNewest()` keeps the cell being typed into visible when the move
      list outgrows its window (scroll only — never `focus()`, which would raise the keyboard)
- [x] `width` + `max-width` (not a flex basis) on the shared narrow-screen column, because the
      old `flex: 1 1 100%` silently discarded the 560px board ceiling below 900px
- [x] The shell, not a flex `body`, owns the viewport height — `#builder` is its sibling, so a
      flex body squashed the shell to 201px whenever the builder opened
- [x] `-webkit-text-size-adjust: 100%` against Chromium font boosting (a mobile-viewport-only
      effect that showed up as "fine in desktop mode")
- [x] Viewport meta without `maximum-scale`, plus `interactive-widget=resizes-content`
- [x] Pinned by **`npm run test:layout`** (`scripts/verify-layout.mjs`, 125 checks over ten
      viewports: 4:3 E-Ink both ways, phone both ways, tablet portrait, 320x568, 320x800,
      square, desktop). It asserts no sideways scroll, a square board inside one screen and
      under the 560px ceiling, panel-same-row + New-puzzle-on-screen for the aspect-ratio
      layout, panel-under-board with a shared column width + the whole page one screen tall
      (with a usable move-table window) for the portrait layout, and that the builder grows
      the page rather than squashing the app.
- [x] Browser lookup is machine-independent: `scripts/lib/browser-path.mjs`
      (`CHROME_PATH`/`CHROME_BIN` → Chrome → Edge → Chromium). `verify-pwa.mjs` previously
      hardcoded `chrome.exe`, which does not exist on machines that ship only Edge.

## Known limitations (accepted, documented in the README)

- **No offline mode** — by design, not a bug.
- **The board never animates** — the design, not an omission.
- **sql.js holds the whole DB in memory** — comfortable into the low tens of thousands.
- **Safari caps an origin at ~1 GB** in IndexedDB.
- **Most verify scripts need network access** — `npm test` cannot run in a sandbox
  without egress. Only `test:topbar`, `test:flip`, `test:coords` are offline.
- **Piece artwork licence is genuinely ambiguous** upstream (CC BY-SA vs GPLv2+),
  unresolved as of `lila#19208`. BSD 3-Clause is the escape hatch.
- **No `LICENSE` file** for this project's own code.

## Open items / possible next steps

Nothing is explicitly queued. Reasonable candidates, in rough priority order:

1. **Reconcile `public/manifest.webmanifest` with its own tests.** Since
   `22efb85 "PWA conflict resolution"` it carries absolute `start_url`/`scope`
   (`/Chess-Visualization/`) as well as an absolute `id`. `verify-pwa.mjs` §1 still
   asserts the relative `'./'` form, so three assertions fail — and an absolute path
   would break a move to a different host/path (Render at the domain root). Either
   restore relative `start_url`/`scope` (keeping `id` absolute, which is what must be
   unique) or update the assertions and the README to match the new intent.
2. **Add a `LICENSE` file** — the code is currently all-rights-reserved, which is worth
   resolving before the project is shared or published.
3. **Consider replacing the 1.3 MB `noobvisualize.png`** — it is used as both favicon and
   header logo and is unoptimised.
4. **Tidy the legacy `TopBar` path** — retained, tested, but not reachable. It could be
   deleted along with `#header-body` / `#drawer-toggle` if the mock-shell header is final.
5. **Close the `verify-coords.mjs` mirroring gap** — it re-derives `board.js`'s square
   naming rather than importing it. Extracting that mapping into a pure export would let
   the test use the real thing (see Pattern 1 in `systemPatterns.md`).
6. **Widen `npm test`'s offline subset** if more network-free invariants come to mind.

## Decision history (how the project got here)

- **SQLite over IndexedDB records.** Each puzzle is a small, fixed row, but users want to
  *own* their sets as portable `.sqlite` files. SQLite gives both, and the byte blob is
  what gets stored in IndexedDB.
- **Static board, no animation.** The whole pedagogical thesis. Also removes any need for
  a chessboard library.
- **API as source of truth, CSV only for sampling.** The CSV's `FEN`/`Moves` off-by-one is
  a known upstream ambiguity; trusting it would corrupt alignment on every puzzle.
- **Reservoir sampling, not a full pass.** Keeps memory flat on a ~1 GB input.
- **Pure logic modules for `orientation.js` and `layout.js`.** Extracted specifically so
  the rules could be tested offline — the reason `test:flip` and `test:topbar` exist.
- **The spec's "board flip is not needed" was overridden.** A static board still benefits
  from re-orientation, and it persisted cleanly into `cpt.flipped`.
- **Orientation resolved from the solving position, not the CSV FEN.** Discovered
  empirically: the CSV FEN is one ply earlier, so its side to move is the opponent's.
  This was a real bug class, caught and pinned by `verify-orientation.mjs`.
- **A claimed non-move counts as a failure.** Refined from the first drag implementation;
  cancellation is limited to dropping back on the start square or off the board.
- **Promotion has no default.** Defaulting to a queen would silently accept a wrong answer.
- **Reveal gated behind Hint.** A deliberate spoiler-containment choice, not a UI quirk.
- **Lichess `puzzle/next` source added later** (`e9b0a49`), with OAuth2 + PKCE on top
  (`1048aa3`). Difficulty was later made mid-session-effective (`d035446`).
- **Header moved from a drawer to a drag-to-collapse mock shell** (`726701f`,
  `2e76cd4`). `TopBar` was kept as a tested but dormant fallback.
- **The layout asks about aspect ratio, not just width.** Reported from a Boox Go Color 7
  (4:3 E-Ink, ~840x632 CSS px): mobile mode stacked a 775px board into a 632px viewport and
  buried the move table ~900px down, while the browser's desktop mode looked fine. Desktop
  mode was only ever the *two-column* layout, so the third state reproduces it at
  `min-aspect-ratio: 5/4` with the board sized from the remaining height. 5/4 rather than
  1/1 because a square viewport leaves the panel a constant ~120px, too narrow for a
  three-column table.
- **`--board-cap` became a height budget.** The old fixed 560px both overflowed short/wide
  screens and (in the stacked state) made the board taller than the viewport, so the
  puzzle link and Hint were off-screen. Every state now subtracts its own chrome from
  `100dvh`.

2. Large CSV → worker + chunked parse, reservoir sampling
3. `.zst` → explicit rejection, no zstd decoder shipped
4. sql.js memory → `MAX_SAFE_PUZZLES` warning
5. IndexedDB limits → documented; not otherwise mitigated
6. `showSaveFilePicker` → feature-detected with download fallback
7. No network → error state with Retry, no fallback
