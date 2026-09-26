# Product Context — why this exists

## The problem

A beginner who has just learned that a knight moves in an L has no intuition for a
position. Chess sites solve this by showing an *animated* board where you physically drag
pieces. That is exactly the wrong affordance for someone who cannot yet read a board at a
glance: you cannot drag what you cannot see.

**Chess Visualization for Noobs exists to make the position the only thing on screen.**
The board is a *static picture* of the position, and the solver's job is to state, in
words, what they see happening. Naming a move in SAN ("that's the knight taking on f3")
is the visualization skill being trained. The board deliberately never moves, so there is
no animation to distract from the position and no illusion that the app already knows the
answer.

## Who it is for

Someone who:

- knows the rules of chess but cannot yet *see* a tactic;
- wants to drill concrete puzzle sets, not an endless random feed;
- is not ready for a Lichess account or a rating to protect;
- may be on a phone, often mid-session and briefly.

The tone of the UI follows from this: a mock-shell layout with dropdowns rather than a
dense toolbar, and a large board that owns the screen.

## The experience it is trying to create

1. **Pick a set you trust.** The builder lets you bound puzzles by rating, so a beginner
   can drill 800–1200 and not stumble into positions far beyond them.
2. **Solve without being spoiled.** The board shows a few plies *before* the puzzle, so
   the solver sees how the position arose. The move table grows **one row at a time** —
   future plies get no row, no cell, and no input — so the table never leaks the length
   of the solution. Rating and themes (which literally say "mate in 3") sit behind a
   **Hint** button.
3. **Never be offered help you did not ask for.** The **Reveal solution** button appears
   *only after* the Hint button is pressed. It is a deliberate product decision: a solver
   who never asks for a hint is never tempted to spoil the puzzle.
4. **Feel the board orientation, not guess it.** The board auto-flips so the solver's own
   pieces are at the bottom, file letters and rank numbers follow the flip, and two small
   circles above and below name the colour at each end. A manual flip is remembered.
5. **Keep a running score.** A strip of green (clean) / red (had a wrong attempt) squares
   gives a session a shape without ever being punitive.

## Design tensions deliberately resolved

| Tension | Resolution |
| --- | --- |
| Convenience vs. learning | No prefetch, no "next up" hinting at length, no default promotion piece. |
| Mobile vs. desktop | A feature must have a non-keyboard path to exist. The `F` shortcut is mirrored by a real button; drag/tap input is first-class. |
| Offline convenience vs. correctness | No offline mode. The API is the source of truth; a fallback would hide alignment bugs. |
| Simplicity vs. data | Local SQLite sets *and* a Lichess-served feed. Both are first-class sources, chosen in a dropdown. |

## How it should feel

Fast, quiet, and slightly austere. Nothing animates on the board. The only motion in the
app is the translucent grey chip under your pointer, because that chip is *your* cursor,
not the app's. The app does one thing at a time and gets out of the way.

## Boundaries

- Not a Lichess client. It borrows puzzle *data* only.
- Not an offline trainer. It is a live-connection drill tool.
- Not a general chess GUI. No notation editor, no game replay, no analysis board.
