/**
 * Board-orientation rules.
 *
 * Kept free of DOM and asset imports so the rule can be exercised offline
 * (scripts/verify-flip.mjs) — src/board.js is what actually paints the grid.
 *
 * `orientation` always names the colour shown at the bottom of the board:
 *   'white' -> rank 8 on top, file a on the left (default)
 *   'black' -> rank 1 on top, file h on the left (flipped)
 */

export const WHITE = 'white';
export const BLACK = 'black';

/** The other colour. Flipping twice is a no-op (see verify-flip.mjs). */
export function flipOrientation(orientation) {
  return orientation === BLACK ? WHITE : BLACK;
}

/**
 * Colour to show at the bottom for a puzzle.
 *
 * The default is auto-detection: the solver's own colour, so their pieces sit
 * at the bottom. `flipped` is the persisted user preference (cpt.flipped) and
 * shows the *other* side than that — which is what makes a manual flip survive
 * the next puzzle, where the solver may well be the other colour.
 */
export function resolveOrientation(solverColor, flipped) {
  return flipped ? flipOrientation(solverColor) : solverColor;
}
