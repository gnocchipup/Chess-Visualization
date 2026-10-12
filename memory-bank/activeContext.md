# Active Context — current focus

## Current state

The memory bank was **initialized on 2026-09-27** by reading the entire codebase
(`index.html`, all 13 `src/` modules, all 9 `scripts/`, `README.md`, `specs.md`,
`vite.config.js`, `package.json`, the deploy workflow) and the git history.

**Latest work — mobile streamlining.** Four requests, all done (uncommitted):

1. **Strip cap 25 → 22** (`MAX_STRIP` in `src/settings.js`) — a mobile width problem, not a
   scoring one. The squares/gap/padding also shrink under 900px (12px / 2px / 0.5rem),
   because 22 at the desktop 14px/3px still clipped on a phone.
2. **Default source is now Lichess next.** `getSource()` honours only an explicit `'sets'`,
   so an unset key (or junk) means Lichess. A stored value still wins, so an install that
   already chose My sets does not move — worth remembering when testing the change.
3. **The builder panel is hidden by default.** `refreshSets()` no longer un-hides `#builder`
   when there are no sets; it opens from the "Puzzle sets…" CTA plus the two paths that
   answer a user action (New puzzle with no set, storage error).
4. **The builder fits a phone.** `.builder-grid > fieldset { flex: 1 1 100% }` under 900px
   stacks the two panels, and `.set-list li { flex-wrap: wrap }` +
   `.set-name { flex: 1 1 100%; min-width: 0; overflow-wrap: anywhere }` gives the label its
   own line so Export/Delete can no longer be pushed off-screen. The row-axis basis is
   deliberate: `flex-direction: column` would resolve `flex: 1` against *height* and
   collapse both auto-height panels.

Verified: `npm run build`, `npm test` (all nine scripts, exit 0) and `npm run test:pwa` —
50 assertions, 47 passing. **The 3 failures are pre-existing, not from this work:**
`public/manifest.webmanifest` has carried absolute `start_url`/`scope` since
`22efb85 "PWA conflict resolution"`, so §1's "is relative" checks and "id is not merely a
copy of start_url" fail. Left alone (the commit looks deliberate) and recorded as open
item 1 in `progress.md`.

### Previous session — settings-menu layout + PWA installability

Three requests, all done:

1. **Menu order.** *Ply back* moved to the very top of the ⚙ menu, above the source block.
   The "Display" kicker is gone — with ply back alone above the divider, the heading said
   nothing. Source picker follows.
2. **Conditional rows.** `Lichess next` → **Difficulty** only. `My sets` → **Set** +
   **Puzzle sets…**. The builder CTA now hides for Lichess, which it previously showed
   while offering a set you could not then select.
3. **Set picker hidden on a fresh install.** With zero sets it could only read "— no sets
   yet —". Gated on a new `hasSets` flag, set in `refreshSets()`, which also re-applies
   visibility so building/importing/deleting the last set updates the menu live.
4. **PWA.** `public/manifest.webmanifest` + `public/sw.js` + four generated PNGs
   (192/512/maskable-512/apple-touch), `theme-color`, `viewport-fit=cover`, safe-area
   padding, and registration in `main.js`.

**A real latent bug was found and fixed along the way.** `.menu-row { display: flex }` is
an author rule, so it *beat* the UA stylesheet's `[hidden] { display: none }`. Every
conditional menu row has therefore been visible regardless of what `main.js` set. Fixed
with `.menu-row[hidden], .menu-cta[hidden] { display: none }`. The codebase already knew
this class of bug — `.promo-backdrop[hidden]` carries the same comment — so it had simply
been missed here.

Verified with a new committed script, `scripts/verify-pwa.mjs` (`npm run test:pwa`), which
launches headless Chrome over CDP against `vite preview`. It asserts real layout heights
rather than the `hidden` attribute, because that is precisely the bug. (The script has
grown since — see the latest entry above for its current coverage and count.)
`npm run build`, the three offline tests, and the full PWA script pass.

## Recent changes (most recent first, from git log)

| Commit | What |
| --- | --- |
| `22efb85` | PWA conflict resolution (absolute `start_url`/`scope` — see open item 1) |
| `9eadfab` | part 2/2 from premature commit |
| `4f9ea7f` | new id for manifest |
| `bf54d7e` | Layout, PWA, and Scoring |
| `8c784fd` | Reset session, simplified flip button |
| `726701f` | Header layout, tighter icons |
| `225bef6` | Layout updates |
| `410f7df` | Flip board indicator, mobile layout |
| `396bc51` | In-board "Flipped board" badge **removed** (state now shown by the colour circles + button) |
| `ae5274f` | Flipped mode indicator |
| `c48f069` | Board orientation visuals |
| `4e67401` | Board flip persistence |
| `1274df9` | Button cleanup |
| `d035446` | Difficulty setting applied mid-session |
| `e9b0a49` | Lichess served puzzles (`/api/puzzle/next`) |
| `1048aa3` | Lichess OAuth |
| `cb82321` | Move list length of solution hidden |
| `7f930f1` | Promotion modal |
| `2a1fc65` | Mobile layout upgrades |
| `573ad30` | Click/drag solution input v2 |

The through-line of the last ~15 commits: the header and board frame were redesigned to
a mock-shell dropdown layout, the flip feature was built end to end (persistence →
indicator → visuals → mobile), and the solving loop was tightened so it never leaks the
solution length.

## Next steps

None queued. If asked what to do next, the honest answer is: the feature set from
`specs.md` is complete, so new work should come from the user. See **Open items** in
`progress.md` for the self-identified candidates (LICENSE file, the 1.3 MB logo, the
dormant `TopBar` path, the `verify-coords` mirroring gap).

Before starting anything new:

1. Re-run the offline tests to confirm a clean baseline:
   `npm run test:topbar && npm run test:flip && npm run test:coords`
2. With network access, run the full `npm test`.

## Active decisions and considerations

- **The spec is the scope.** `specs.md` defines what was asked for. Features have been
  added beyond it (flip, drag input, coordinates, Lichess-next source, OAuth), all of
  which are now documented in the README and treated as real requirements. Do not
  "correct" the app back toward the spec.
- **Do not add offline mode, even as a nicety.** The API is the source of truth for
  alignment; a fallback would mask exactly the bug class that bit this project once
  (the CSV off-by-one).
- **Do not animate the board.** It is the pedagogical premise, not a missing feature.
- **Orientation changes must go through `src/orientation.js`.** It is the single place
  the auto rule and the persisted override are decided. Deriving orientation anywhere
  else is how the one-ply error would come back.
- **Pure logic belongs in a pure module.** If a new rule needs testing without a browser,
  put the decision in a DOM-free export and have the DOM code merely carry it out.
- **`git` requires the GitHub Desktop path** on this machine — see `techContext.md`.
- **`npm` may need to be `npm.cmd`** — see `techContext.md`.

## Gotchas that will bite you again

- **A drag to a different square is always a move claim.** No such legal move → failed
  attempt, and the input shows `from-to` in red. Only a release on the start square or
  off the board cancels. This is deliberate.
- **Promotion has no default piece.** A cancelled dialog (Escape / backdrop click) is not
  a failed attempt, but a *wrong* choice is.
- **The coordinate gutters must stay outside `#board`.** Square hit-testing uses
  `elementFromPoint().closest('.sq')`; a gutter element under the pointer would break it.
- **Drag input must not call `focus()`.** It pops the mobile keyboard over the board after
  every move. Only typed input advances focus.
- **`solve / report` is one-shot per puzzle.** `exercise.nextPuzzleId` is consumed on
  report, so a revealed puzzle is never reported and needs an extra New-puzzle press to
  advance the Lichess queue.
- **Legacy sign-ins lack `puzzle:write`** and will 403 on report. `hasWriteScope()` is
  what detects this so the UI can say "sign out and sign in again".
- **A `display` rule beats the `hidden` attribute.** The UA stylesheet's
  `[hidden] { display: none }` is author-level, so any `.foo { display: flex }` wins.
  When hiding a laid-out element, restate `.foo[hidden] { display: none }` and verify
  by *measuring height in a browser* — the attribute will look correct either way.
- **The service worker must never grow an offline path.** It exists only because
  Chromium gates "Install app" on a fetch handler. It caches the shell and passes
  cross-origin straight through. If someone later adds a cached `/api/puzzle/next`
  fallback, they have reintroduced the alignment bug the project exists to prevent.
- **These projects share a `github.io` origin, so the manifest `id` is load-bearing.**
  An installed app is keyed by origin + `id`; `"./"` collapses to the app's own
  directory and collides with sibling apps on the same host (Android install appeared
  to do nothing). `id` is therefore the absolute path `/Chess-Visualization/`, named
  after the repo. `start_url`/`scope` stay relative so the relative-base build still
  works. **Change `id` if the app ever moves host or path**, or it collides again.
  Pinned by `verify-pwa.mjs` section 1b.

## Project insights worth keeping

- The app's hardest problem was never the UI — it was proving that the puzzle position is
  the API's, not the CSV's. Everything else follows from taking that seriously.
- The `data-square` attribute (algebraic name, white's point of view, set at paint time)
  is what made orientation-aware drag input nearly free.
- The "don't offer help you didn't ask for" rule (Reveal behind Hint) is a product
  decision that has already been made. Restoring it if a refactor uncovers the button is
  the right call.
- The mock-shell header intentionally left `TopBar` in the tree as a tested, dormant
  fallback. That is not dead code by accident.
