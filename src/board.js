const GLYPHS = {
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
};

/**
 * Render a FEN string as a static 8x8 CSS grid (rank 8 at top, file a at left).
 * The board is display-only and never changes during a puzzle.
 */
export function renderBoard(el, fen) {
  const placement = String(fen).trim().split(/\s+/)[0];
  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error(`Invalid FEN board: ${fen}`);
  el.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    const cells = [];
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') {
        for (let i = 0; i < Number(ch); i++) cells.push(null);
      } else {
        cells.push(ch);
      }
    }
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement('div');
      sq.className = 'sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
      const piece = cells[c];
      if (piece) sq.textContent = GLYPHS[piece] || '';
      el.appendChild(sq);
    }
  }
}
