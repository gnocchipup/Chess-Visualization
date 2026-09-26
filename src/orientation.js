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
 * Colour shown at the **top** of the board when `orientation` is at the bottom.
 * Always the other side, which is what makes the two colour indicators on the
 * board frame (see src/board.js renderCoordinates / exercise.js paintSideDots)
 * agree with the rank numbers they sit beside.
 */
export function topColor(orientation) {
  return flipOrientation(orientation);
}

/**
 * File letters along the **bottom** edge of the board, left to right.
 * White at the bottom -> a..h; black at the bottom -> h..a.
 */
export function fileOrder(orientation) {
  const files = 'abcdefgh'.split('');
  return orientation === BLACK ? files.reverse() : files;
}

/**
 * Rank numbers down the **right** edge of the board, top to bottom.
 * White at the bottom -> 8..1; black at the bottom -> 1..8.
 */
export function rankOrder(orientation) {
  const ranks = '12345678'.split('');
  return orientation === BLACK ? ranks : ranks.reverse();
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
