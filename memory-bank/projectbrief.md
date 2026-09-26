# Project Brief — Chess Visualization for Noobs

## One-line summary

A local-first, browser-only web app for drilling Lichess chess puzzles. The user builds
portable puzzle sets from the official Lichess puzzle CSV into SQLite databases held in
IndexedDB, then solves those puzzles against a **static** board and a PGN-style move table.

## Source of truth for scope

- **`specs.md`** (repo root) — the original build specification. It defines the stack, the
  four features, the puzzle-set SQL schema, and seven numbered *Gotchas* that the app
  handles explicitly. When scope is in question, `specs.md` wins.
- **`README.md`** (repo root) — the user-facing documentation. It is thorough and is kept
  in sync with the code (architecture map, ply-alignment derivation, storage keys,
  licensing). Feature claims in the README are treated as real requirements.

Both predate this memory bank and should be read alongside it. This bank adds the
*why*, the architectural reasoning, and the working state — not a restatement of the README.

## Core requirements (non-negotiable)

1. **No backend, no accounts on our side, no server-side data.** Static build output only.
2. **Vite + vanilla JavaScript.** No UI framework, no chessboard library.
3. **`sql.js` (SQLite over WASM) is the puzzle database**, entirely in the browser.
4. **`chess.js`** for SAN parsing, legality, checkmate detection, and PGN replay.
5. **The app hard-requires a live Lichess connection.** If the API fails, show a retryable
   error state. There is deliberately **no offline mode and no fallback data** — the API
   is the source of truth for puzzle alignment.
6. **IndexedDB is the working store** for puzzle sets; the `.sqlite` file is a portable
   export, not the primary copy.
7. **Settings and session score live in `localStorage`**, under the `cpt.` key namespace.

## Explicit non-goals

- **Animating the board.** The board renders from a FEN and *never moves*. No move
  animation, no piece dragging, no chessboard library. (Square-to-square drag/tap exists
  purely as an *alternative way to enter* a move — see below.)
- **Shipping a zstd decoder.** `.csv.zst` inputs are rejected with an explicit message.
- **Prefetching or bulk-downloading puzzles from the Lichess API.** One API call per
  *New puzzle* press. Mass enumeration belongs to `database.lichess.org`.
- **Committed build output.** `dist/` is git-ignored and rebuilt by every host/CI.

## The subtlest requirement — ply alignment

The Lichess puzzle CSV has a known off-by-one ambiguity between its `FEN` and `Moves`
columns. **The CSV is never trusted for alignment.** The puzzle position is derived from
the API's `puzzle.initialPly` replayed against the game PGN:

```
solving position = P(initialPly + 1)
board FEN        = P(initialPly - X + 1),  X = min(plyBack, initialPly)
context moves    = 0-based move indices initialPly - X + 1 .. initialPly
```

This is pinned by the acceptance test for puzzle `Yh7uB` (`npm run test:ply`). Any change
that touches alignment **must** keep that test green.

## Two design rules that are easy to break by accident

1. **Orientation comes from the *solving* position, not the CSV `FEN`.** The CSV FEN is
   `P(initialPly)` — one ply earlier — so its side to move is the *opponent's*. Orienting
   by the CSV FEN is wrong by exactly one ply on **every** puzzle. Pinned by
   `npm run test:orient`.
2. **A claimed non-move is a failure, not a no-op.** If the solver drags the chip to a
   different square, they have claimed "I see this move." If no such legal move exists,
   that is a *visualization failure* and counts as a wrong attempt. Only two paths
   cancel without failing: dropping back on the start square, or throwing the chip off
   the board. Promotion has **no default** — picking the wrong piece is a failed attempt
   just like typing the wrong move.

## Success criteria

A user can: build a rated puzzle set from the CSV, solve puzzles by typing SAN or
dragging square-to-square, see a spoiler-free board by default, track a session score,
flip the board by hand (persisted), and read the whole thing on a phone.

## Where to look first

| Question | File |
| --- | --- |
| What is the product? | `productContext.md` |
| What am I working on right now? | `activeContext.md` |
| How is it built? | `systemPatterns.md` |
| How do I run and test it? | `techContext.md` |
| What is done / broken / next? | `progress.md` |
