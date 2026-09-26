# Active Context — current focus

## Current state

The memory bank was **initialized on 2026-09-27** by reading the entire codebase
(`index.html`, all 13 `src/` modules, all 9 `scripts/`, `README.md`, `specs.md`,
`vite.config.js`, `package.json`, the deploy workflow) and the git history.

**No feature work is in progress.** Polish continues. Latest change: the correct/incorrect
counter got a dedicated **↺ Reset session** button on the score row (it shares the one
`resetScore()` path with the setting handlers, and is disabled while nothing is recorded),
and the **flip button is now the ⇅ sign alone** — coloured **blue when unflipped (the
default) and red when flipped**, the same pair as the haloes on the board's two colour
circles. Before that, the score strip markers were made fixed-width and the counter started
resetting whenever puzzle source, puzzle set, difficulty, or ply back changed.

Verified live in headless Chrome over CDP (not committed, since the repo has no browser-test
harness): sign-only at 1200 px and 600 px, blue→red→blue on click, `aria-pressed` and
`cpt.flipped` round-trip, reset disabled/enabled/clears/disables across a reload. `npm run
build`, the three offline tests and `npm run smoke` all pass.

## Recent changes (most recent first, from git log)

| Commit | What |
| --- | --- |
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
