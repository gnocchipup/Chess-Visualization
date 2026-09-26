import { WHITE, BLACK } from './orientation.js';
import wkUrl from './pieces/wk.svg';
import wqUrl from './pieces/wq.svg';
import wrUrl from './pieces/wr.svg';
import wbUrl from './pieces/wb.svg';
import wnUrl from './pieces/wn.svg';
import wpUrl from './pieces/wp.svg';
import bkUrl from './pieces/bk.svg';
import bqUrl from './pieces/bq.svg';
import brUrl from './pieces/br.svg';
import bbUrl from './pieces/bb.svg';
import bnUrl from './pieces/bn.svg';
import bpUrl from './pieces/bp.svg';

/**
 * FEN piece letter -> bundled SVG asset. Uppercase = white, lowercase = black.
 */
export const PIECE_URL = {
  K: wkUrl, Q: wqUrl, R: wrUrl, B: wbUrl, N: wnUrl, P: wpUrl,
  k: bkUrl, q: bqUrl, r: brUrl, b: bbUrl, n: bnUrl, p: bpUrl,
};

/** Alt text per piece letter. */
export const PIECE_NAME = {
  K: 'White king', Q: 'White queen', R: 'White rook',
  B: 'White bishop', N: 'White knight', P: 'White pawn',
  k: 'Black king', q: 'Black queen', r: 'Black rook',
  b: 'Black bishop', n: 'Black knight', p: 'Black pawn',
};

/**
 * Parse the piece-placement field of a FEN into an 8x8 grid of piece letters.
 * grid[0] is rank 8 and grid[0][0] is a8, i.e. always white's point of view.
 */
function parsePlacement(fen) {
  const placement = String(fen).trim().split(/\s+/)[0];
  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error(`Invalid FEN board: ${fen}`);
  return rows.map((row) => {
    const cells = [];
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        for (let i = 0; i < Number(ch); i++) cells.push(null);
      } else if (PIECE_URL[ch]) {
        cells.push(ch);
      } else {
        throw new Error(`Invalid FEN piece "${ch}" in: ${fen}`);
      }
    }
    if (cells.length !== 8) throw new Error(`Invalid FEN rank "${row}" in: ${fen}`);
    return cells;
  });
}

/**
 * Render a FEN string as a static 8x8 CSS grid of SVG pieces.
 *
 * `orientation` names the colour shown at the bottom of the board:
 *   'white' -> rank 8 on top, file a on the left (default)
 *   'black' -> rank 1 on top, file h on the left (flipped)
 * Flipping mirrors both axes, so it is a 180-degree rotation of the same
 * position. Square shading is intrinsic to the square and is therefore
 * preserved: a8 and h1 are both light squares in either orientation.
 */
export function renderBoard(el, fen, { orientation = WHITE } = {}) {
  const grid = parsePlacement(fen);
  const order = orientation === BLACK ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  el.innerHTML = '';
  el.dataset.orientation = orientation;
  for (const r of order) {
    for (const c of order) {
      const sq = document.createElement('div');
      sq.className = 'sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
      // Algebraic name of this square (grid is always white's point of view),
      // so drag/tap input can map pointer targets to squares in either
      // orientation without re-deriving coordinates from the DOM order.
      sq.dataset.square = 'abcdefgh'[c] + (8 - r);
      const piece = grid[r][c];
      if (piece) {
        const img = document.createElement('img');
        img.className = 'piece';
        img.src = PIECE_URL[piece];
        img.alt = PIECE_NAME[piece];
        img.draggable = false;
        sq.appendChild(img);
      }
      el.appendChild(sq);
    }
  }
}
