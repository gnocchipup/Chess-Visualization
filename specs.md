# Build a web-based chess puzzle trainer

## Stack (use these)
- Vite + vanilla JS (no framework). Builds to static files → Render **Static Site**, free tier.
- `sql.js` (SQLite compiled to WASM) for the puzzle DB, all in-browser.
- Persistence: IndexedDB stores each puzzle set as `{id, name, bytes: Uint8Array (sql.js export), createdAt, puzzleCount, ratingMin, ratingMax}`.
- `chess.js` for SAN parsing, legality, checkmate detection, and replaying PGN to an arbitrary ply.
- Board rendering: a small hand-rolled renderer from a FEN string (8×8 CSS grid + Unicode chess glyphs). No chessboard library needed — **the board is static and never moves**, so no drag/drop, no move animation.
- Settings in `localStorage`.

## Global data facts (verify these empirically — see Gotchas)
- Puzzle set CSV = the plain, decompressed lichess puzzle CSV (`lichess_db_puzzle.csv`), columns: `PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags`.
- Game data fetched live from `GET https://lichess.org/api/puzzle/{puzzleId}`. Returns `{game: {pgn, ...}, puzzle: {id, initialPly, solution, rating, themes, ...}}`. Lichess sends permissive CORS headers; this works from the browser.
- **The app hard-requires a live lichess connection.** If the API call fails, show an error state and do not fall back to anything.

---

## Feature 1 — Puzzle set builder

Screen: "Create puzzle set".

1. Button opens a native file picker (`<input type="file" accept=".csv">`) for the lichess puzzle CSV.
2. Numeric inputs: **Rating min**, **Rating max**, **Number of puzzles**.
3. Parse the CSV in a streaming/worker pass (Papa Parse with `worker: true`, or a manual chunked parser) — the file can be ~1 GB. Do not load it as one string.
4. Filter rows to `ratingMin <= Rating <= ratingMax`. Take a **uniform random sample** of `N` (reservoir sampling, so we never hold all matching rows in memory).
5. Create a sql.js DB with:

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
-- meta rows: name, created_at, rating_min, rating_max, puzzle_count, source_rows
```

6. Ask for a set **name**, then save. Save path: try `window.showSaveFilePicker()` so the user can pick a real path and write the `.sqlite` file to disk; if unsupported (Firefox/Safari), fall back to an `<a download>` of the exported blob. **In both cases also write the bytes into IndexedDB** — IndexedDB is the working store; the `.sqlite` file is a portable export.
7. Show progress during parse/insert (`parsed X rows, matched Y, kept Z / N`).

Also provide "Import existing .sqlite" (file picker → read → validate schema → store in IndexedDB) and "Export" / "Delete" per set.

---

## Feature 2 — Puzzle set selection

A `<select>` in the header listing every set in IndexedDB as `"{name} ({puzzle_count} puzzles, {rating_min}–{rating_max})"`. Selecting one loads its bytes into a sql.js instance and makes it active. Persist the selection in `localStorage` and restore on reload.

If no sets exist, show an empty state pointing at Feature 1.

---

## Feature 3 — Settings

- **Ply back**: integer input, default 4, min 0. Persisted to `localStorage` under a namespaced key.
- (Anything else you add — board flip is *not* needed since the board is static.)

---

## Feature 4 — Exercise (the main screen)

Layout: static board on the left, move table on the right, session score strip above or below.

### On "New puzzle"
1. `SELECT * FROM puzzles ORDER BY RANDOM() LIMIT 1` from the active set.
2. Fetch `https://lichess.org/api/puzzle/{puzzle_id}`.
3. Using `chess.js`, load `game.pgn` and walk the game to the puzzle position. **Anchor everything on `puzzle.initialPly`** (the 0-based ply index of the puzzle position in the game):
   - `X = min(plyBackSetting, initialPly)` ← "whichever is lower"
   - **Board FEN** = position after `initialPly - X` plies. Render it. It never changes.
   - **Move table** lists plies `initialPly - X + 1` through `initialPly`, as a standard two-column White/Black table with move numbers (SAN). These are read-only context rows.
   - **Solving position** = position after `initialPly` plies, i.e. the puzzle position. The solver plays from here.
4. Render the puzzle link as a clickable `https://lichess.org/training/{puzzle_id}` (opens in a new tab).
5. Show the rating and themes.

### Move table
Standard PGN-style layout: rows of `N. <white> <black>`, with empty cells where a move doesn't exist (e.g. the lead-up may start on a black move).

The cell for the solver's current move renders as a **text input**. All other cells are static text.

### Solving loop
- Solver types a move in SAN in the active input and presses **Enter**. (Accept SAN, be lenient about trailing `+` / `#`; if SAN parsing is ambiguous, reject.)
- **Correct** → the app appends the move to the table as static text, then **immediately, with no delay**, writes the opponent's next solution move into the next cell. Focus advances to the solver's next input.
- **Incorrect** → the app does *not* reply. Turn the typed text red, keep it in the input, and mark the puzzle as failed for scoring. The solver retries.
- Continue until the solution array is exhausted. Lichess solutions always end on the solver's move.
- **Alternate last move**: if this is the **final ply** of the solution, accept *any* legal move that delivers checkmate, not just the scripted one.
- Board never re-renders during solving.

### Solution source
Prefer `puzzle.solution` from the API. If it's absent, fall back to the CSV `Moves` column (strip the leading opponent ply if the alignment check requires it — see Gotchas). Store nothing; the API is the source of truth at runtime.

### Scoring
Lichess-style row of small squares, session-scoped, in `localStorage`:
- **Green** = solved with no wrong attempts.
- **Red** = had at least one wrong attempt.
Keep a rolling count of solved/failed in the header.

### Controls
"New puzzle", and a "Reveal solution" button that fills the remaining cells in a muted style and marks the puzzle failed.

---

## Gotchas to handle explicitly

1. **Ply alignment.** There is a known off-by-one ambiguity in the lichess CSV between `FEN` (which some versions define as "before the opponent's setup move") and `Moves` (which may or may not include that setup move). **Do not trust the CSV for alignment.** Derive the puzzle position from the API's `puzzle.initialPly` against the game PGN, and use the CSV `Moves` column only as a cross-check.
   - **Acceptance test:** puzzle `Yh7uB` (game `MnItujoS`) with ply-back = 4 must render board FEN `2kr4/pbp2pp1/5n1p/1B2r3/1P1p2q1/2NP1N2/1PP2PPP/R2Q1RK1 b - - 0 17` and a move table reading `17... Rg5`, `18. Ne1 Qh3`, `19. Ba6`. The first solver input is at `19...` and expects `Rxg2+`.
2. **Large CSV.** Stream it. Never `FileReader.readAsText()` the whole thing.
3. **`.zst`.** If the user hands you a `.csv.zst`, show a clear error telling them to decompress first (don't ship a WASM zstd decoder).
4. **sql.js memory.** The DB is fully in memory. A few thousand puzzles is fine; warn if the requested count exceeds ~50,000.
5. **IndexedDB size limits.** Safari caps at ~1 GB per origin. Fine for the intended sizes.
6. **`showSaveFilePicker` is Chromium-only.** Feature-detect; fall back to download.
7. **No network → no app.** Lichess API failure = error state with a retry button. No offline mode, no board-only fallback.

---
