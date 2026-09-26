import { Chess } from 'chess.js';
import { renderBoard, PIECE_URL, PIECE_NAME } from './board.js';
import { WHITE, BLACK, resolveOrientation } from './orientation.js';
import { fetchPuzzle } from './lichess.js';
import { isKeyboardFirst } from './layout.js';

function playUci(chess, uci) {
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

/**
 * Controls one exercise: static board, move table, solving loop.
 * Ply alignment is anchored on the API's puzzle.initialPly. Empirically (see
 * scripts/verify-yh7ub.mjs), initialPly counts the plies up to the position
 * *before* the opponent's setup move, so with P_k = position after k plies:
 *   solving position = P_{initialPly + 1}
 *   board FEN        = P_{initialPly - X + 1},  X = min(plyBack, initialPly)
 *   context moves    = 0-based move indices initialPly - X + 1 .. initialPly
 */
export class Exercise {
  constructor({ boardEl, tableEl, infoEl, errorEl, revealBtn, onResult, getFlipped, onFlipChange }) {
    this.boardEl = boardEl;
    this.tableEl = tableEl;
    this.infoEl = infoEl;
    this.errorEl = errorEl;
    this.revealBtn = revealBtn;
    this.onResult = onResult;
    // Board flip is a persisted preference that main.js owns (localStorage):
    // the exercise reads the stored value whenever a puzzle is prepared and
    // reports every flip back, so a flip survives the next puzzle and a reload.
    // Orientation rules live in src/orientation.js.
    this.getFlipped = getFlipped ?? (() => false);
    this.onFlipChange = onFlipChange ?? null;
    this.clear();

    // Optional shortcut: 'F' flips the board (it is also a button beside New
    // puzzle, which is how touch users reach it). Ignored while typing in the
    // move table so it never swallows a keystroke meant for a solution attempt.
    this.onKeyDown = (e) => {
      if (e.key === 'Escape') {
        // Cancel a pending promotion choice without failing the attempt.
        if (!this.promoEl.hidden) this.closePromotion();
        return;
      }
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (t && t.isContentEditable) return;
      this.flip();
    };
    document.addEventListener('keydown', this.onKeyDown);

    // Square-to-square drag/tap input. The board shows a static position a
    // few plies before the puzzle, so pieces are never dragged; the gesture
    // is only translated into a solution attempt, exactly as if the move had
    // been typed. Pointer events cover mouse and touch with one code path.
    this.dragFrom = null; // square where the current gesture started
    this.dragMoved = false; // pointer left the start square during the gesture
    this.selected = null; // tap-selected square awaiting a target tap

    // The only visual feedback: a translucent grey chip "held" under the
    // pointer while dragging, parked on the selected square after a tap.
    this.chipEl = document.createElement('div');
    this.chipEl.className = 'drag-chip';
    this.chipEl.hidden = true;
    document.body.appendChild(this.chipEl);

    // Promotion picker modal. A pawn drag/tap to the back rank is not a
    // complete move until the solver names the piece, so the gesture pauses
    // on this dialog instead of silently defaulting to a queen. The pending
    // from/to squares live in this.promoPending until a choice is made.
    this.promoPending = null;
    this.promoEl = document.createElement('div');
    this.promoEl.className = 'promo-backdrop';
    this.promoEl.hidden = true;
    const panel = document.createElement('div');
    panel.className = 'promo-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Choose promotion piece');
    const title = document.createElement('p');
    title.className = 'promo-title';
    title.textContent = 'Promote to';
    this.promoChoices = document.createElement('div');
    this.promoChoices.className = 'promo-choices';
    panel.append(title, this.promoChoices);
    this.promoEl.appendChild(panel);
    document.body.appendChild(this.promoEl);
    // Clicking the dimmed area outside the panel cancels the gesture without
    // a failed attempt: no piece was named, so no move was claimed. (This is
    // unlike an illegal board drop, which does fail — see attempt().)
    this.promoEl.addEventListener('pointerdown', (e) => {
      if (e.target === this.promoEl) this.closePromotion();
    });

    this.boardEl.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const sq = this.squareAt(e.clientX, e.clientY);
      if (!sq) return;
      // Keep focus (and the mobile keyboard) wherever it is; the board is
      // not a text entry point.
      e.preventDefault();
      this.dragFrom = sq;
      this.dragMoved = false;
      this.boardEl.setPointerCapture?.(e.pointerId);
      this.showChip(e.clientX, e.clientY);
    });

    this.boardEl.addEventListener('pointermove', (e) => {
      if (!this.dragFrom || !e.isPrimary) return;
      const over = this.squareAt(e.clientX, e.clientY);
      if (over && over !== this.dragFrom) this.dragMoved = true;
      this.moveChip(e.clientX, e.clientY);
    });

    this.boardEl.addEventListener('pointerup', (e) => {
      if (!this.dragFrom || !e.isPrimary) return;
      const from = this.dragFrom;
      const moved = this.dragMoved;
      this.dragFrom = null;
      this.dragMoved = false;
      const to = this.squareAt(e.clientX, e.clientY);
      if (moved) {
        if (!to || to === from) {
          // Drag released back on its start square, or thrown off the board:
          // the solver cancelled, not attempted. Keep the tap selection (if
          // any) as it was — for a fresh drag there is none, so just hide.
          if (this.selected) this.parkChip(this.selected);
          else this.hideChip();
          return;
        }
        // Drag released on a different square: submit from -> to.
        this.selected = null;
        this.hideChip();
        this.attemptDrag(from, to);
      } else if (!to) {
        // Press-and-release off the board (e.g. a tap that drifted outside
        // without leaving the start square's slop): nothing was named.
        if (this.selected) this.parkChip(this.selected);
        else this.hideChip();
      } else if (this.selected && this.selected !== from) {
        // Tap-tap: a square was already selected, this tap is the target.
        const sel = this.selected;
        this.selected = null;
        this.hideChip();
        this.attemptDrag(sel, from);
      } else if (this.selected === from) {
        // Tapping the selected square again deselects it.
        this.selected = null;
        this.hideChip();
      } else {
        // Plain tap: select the square, wait for the target tap.
        this.selected = from;
        this.parkChip(from);
      }
    });

    this.boardEl.addEventListener('pointercancel', () => {
      this.dragFrom = null;
      this.dragMoved = false;
      if (this.selected) this.parkChip(this.selected);
      else this.hideChip();
    });
  }

  /** Square name under a viewport point, or null when outside the board. */
  squareAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const sq = el?.closest?.('.sq');
    return sq && this.boardEl.contains(sq) ? sq.dataset.square : null;
  }

  sqEl(name) {
    return this.boardEl.querySelector(`[data-square="${name}"]`);
  }

  /** Show the chip centred on a viewport point (the pointer). */
  showChip(x, y) {
    // Size relative to a board square, like a piece; recomputed every time
    // so a resize between gestures cannot leave a stale size.
    const sqSize = this.boardEl.getBoundingClientRect().width / 8;
    const d = Math.round(sqSize * 0.75);
    this.chipEl.style.width = this.chipEl.style.height = `${d}px`;
    this.chipEl.hidden = false;
    this.moveChip(x, y);
  }

  moveChip(x, y) {
    this.chipEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }

  /** Rest the chip on the centre of a board square (tap-tap selection). */
  parkChip(square) {
    const el = this.sqEl(square);
    if (!el) return this.hideChip();
    const r = el.getBoundingClientRect();
    this.showChip(r.left + r.width / 2, r.top + r.height / 2);
  }

  hideChip() {
    this.chipEl.hidden = true;
  }

  clear() {
    this.row = null;
    this.nextPuzzleId = null; // lichess-next id awaiting a casual report
    this.revealed = false;
    this.chess = null;
    this.solution = null;
    this.solIdx = 0;
    this.failed = false;
    this.done = false;
    this.cellEls = new Map();
    this.inputEls = new Map();
    this.rowsByNum = new Map();
    this.tbodyEl = null;
    this.boardFen = null;
    this.orientation = WHITE;
    // Whether the board currently shows the other side than the auto-detected
    // one. Re-read from the persisted preference when the next puzzle is
    // prepared (see setup), so it always matches what is on screen.
    this.flipped = false;
    this.solverColor = null;
    this.dragFrom = null;
    this.dragMoved = false;
    this.selected = null;
    this.chipEl && this.hideChip();
    this.promoEl && this.closePromotion();
  }

  /**
   * Flip the board 180 degrees. This only re-orients the static board; it does
   * not change the position or touch the solving state, so it is safe to call
   * at any point during a puzzle.
   *
   * The new state is reported to main.js, which persists it (cpt.flipped), so
   * the flip survives the next puzzle — where the solver may well be the other
   * colour, and the board is then flipped relative to *that* puzzle's
   * auto-detected orientation. Flipping before the first puzzle loads works
   * too: there is nothing to re-render, but the preference still applies.
   */
  flip() {
    this.flipped = !this.flipped;
    this.onFlipChange?.(this.flipped);
    if (!this.boardFen) return;
    this.orientation = resolveOrientation(this.solverColor, this.flipped);
    renderBoard(this.boardEl, this.boardFen, { orientation: this.orientation });
    this.updateBoardLabels();
    // A parked chip marks the tap-selected square; re-centre it on the
    // re-rendered square so the selection survives the flip visually.
    if (this.selected) this.parkChip(this.selected);
  }

  /**
   * Board tooltip and accessible name. Both state which colour is at the bottom
   * and whether that is the flipped orientation, so the state is available even
   * where the corner badge is not read out.
   */
  updateBoardLabels() {
    const bottom = this.orientation === BLACK ? 'black' : 'white';
    const flipped = this.flipped ? ' (flipped)' : '';
    this.boardEl.title =
      `Drag or tap square-to-square to enter a move · press F or Flip to turn the board · ` +
      `showing ${bottom} at the bottom${flipped}`;
    this.boardEl.setAttribute('aria-label', `Chess board, ${bottom} at the bottom${flipped}`);
  }

  get active() {
    return !!this.solution && !this.done;
  }

  async newPuzzle(row, plyBack) {
    this.clear();
    this.row = row;
    this.nextPuzzleId = null; // set puzzles are never reported
    this.hideError();
    this.tableEl.innerHTML = '';
    this.infoEl.innerHTML = '<p class="muted">Fetching puzzle from lichess…</p>';
    this.revealBtn.disabled = true;
    this.revealBtn.hidden = true;

    let data;
    try {
      data = await fetchPuzzle(row.puzzle_id);
    } catch (err) {
      this.infoEl.innerHTML = '';
      this.showError(err.message, () => this.newPuzzle(this.row, plyBack));
      return;
    }
    try {
      this.setup(data, plyBack);
    } catch (err) {
      this.showError(`Could not prepare puzzle ${row.puzzle_id}: ${err.message}`, () =>
        this.newPuzzle(this.row, plyBack)
      );
    }
  }

  /**
   * Lichess next-puzzle mode: `data` is already a PuzzleAndGame response
   * (GET /api/puzzle/next), so there is no set row and no second fetch.
   * `retryFn` (optional) refetches a fresh puzzle for the Retry button —
   * retrying the same payload would just fail the same way.
   */
  async newPuzzleFromNext(data, plyBack, retryFn = null) {
    this.clear();
    this.row = null;
    this.hideError();
    this.tableEl.innerHTML = '';
    // Id reported to Lichess on finish (casual, signed-in mode only).
    this.nextPuzzleId = data?.puzzle?.id ?? null;
    this.revealed = false;
    try {
      this.setup(data, plyBack);
    } catch (err) {
      const id = data?.puzzle?.id ?? 'next';
      if (retryFn) {
        this.showError(`Could not prepare puzzle ${id}: ${err.message}`, retryFn);
      } else {
        this.showError(`Could not prepare puzzle ${id}: ${err.message}`, null, { retry: false });
      }
    }
  }

  setup({ game, puzzle }, plyBack) {
    const replay = new Chess();
    replay.loadPgn(game.pgn);
    const hist = replay.history({ verbose: true });
    const startFen = hist.length ? hist[0].before : replay.fen();
    const fenAfter = (k) => (k === 0 ? startFen : hist[k - 1].after);

    const initialPly = puzzle.initialPly;
    if (initialPly < 0 || initialPly + 1 > hist.length) {
      throw new Error(`initialPly ${initialPly} is out of range for a ${hist.length}-ply game.`);
    }

    const X = Math.min(Math.max(0, plyBack), initialPly);
    const boardFen = fenAfter(initialPly - X + 1);
    const solvingFen = fenAfter(initialPly + 1);

    this.initialPly = initialPly;
    this.contextMoves = [];
    for (let p = initialPly - X + 1; p <= initialPly; p++) {
      this.contextMoves.push({ ply: p, san: hist[p].san });
    }

    this.solution = this.deriveSolution(puzzle, solvingFen);
    this.chess = new Chess(solvingFen);

    // The solver plays the side to move in the solving position. If that is
    // black, show the board from black's side — unless the persisted flip
    // preference is on, which shows the other side than the auto-detected one
    // (that is what carries a manual flip over to the next puzzle).
    this.boardFen = boardFen;
    this.solverColor = this.chess.turn() === 'b' ? BLACK : WHITE;
    this.flipped = !!this.getFlipped();
    this.orientation = resolveOrientation(this.solverColor, this.flipped);
    this.updateBoardLabels();
    renderBoard(this.boardEl, this.boardFen, { orientation: this.orientation });

    this.renderInfo(puzzle);
    this.renderTable();
    // Reveal stays hidden+disabled until the Hint button is clicked; renderInfo
    // owns that state (see the hint handler there).
    this.revealBtn.disabled = true;
    this.revealBtn.hidden = true;
  }

  /** Prefer the API solution; fall back to the CSV Moves column (strip setup ply). */
  deriveSolution(puzzle, solvingFen) {
    if (Array.isArray(puzzle.solution) && puzzle.solution.length) return puzzle.solution;
    // `this.row` is null for /api/puzzle/next puzzles; the guard keeps the
    // CSV fallback working for set puzzles without crashing next-mode.
    const csvMoves = (this.row?.moves || '').trim().split(/\s+/).filter(Boolean);
    // CSV Moves normally starts with the opponent's setup move, so try both
    // alignments and keep the first whose opening move is legal here.
    for (const cand of [csvMoves.slice(1), csvMoves]) {
      if (!cand.length) continue;
      const test = new Chess(solvingFen);
      try {
        playUci(test, cand[0]);
        return cand;
      } catch {
        /* try next alignment */
      }
    }
    throw new Error('No usable solution: API has none and CSV Moves do not align.');
  }

  renderInfo(puzzle) {
    const row = this.row ?? {};
    const id = puzzle.id ?? row.puzzle_id;
    const rating = puzzle.rating ?? row.rating;
    const themes = Array.isArray(puzzle.themes)
      ? puzzle.themes.join(', ')
      : String(row.themes || '').split(/\s+/).filter(Boolean).join(', ');
    this.infoEl.innerHTML = '';
    const link = document.createElement('a');
    link.href = `https://lichess.org/training/${encodeURIComponent(id)}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = `lichess.org/training/${id}`;
    // Rating and themes spoil the puzzle (mate in N, motif, ...), so they stay
    // hidden behind a Hint button until the solver asks for them. infoEl is
    // rebuilt on every puzzle, which resets the hidden state automatically.
    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.hidden = true;
    meta.textContent = `Rating ${rating ?? '?'}${themes ? ` · ${themes}` : ''}`;
    const hintBtn = document.createElement('button');
    hintBtn.type = 'button';
    hintBtn.className = 'hint-btn';
    hintBtn.textContent = 'Hint';
    hintBtn.title = 'Show rating and themes';
    // Reveal only becomes available after a hint is asked for: the button lives
    // in the hint line and stays hidden until then, so a solver who never
    // asks isn't tempted by it. It is re-hidden on the next puzzle.
    this.revealBtn.hidden = true;
    this.revealBtn.disabled = true;
    hintBtn.addEventListener('click', () => {
      meta.hidden = false;
      hintBtn.remove();
      this.revealBtn.hidden = false;
      this.revealBtn.disabled = this.done || !this.solution;
    });
    const hintLine = document.createElement('div');
    hintLine.className = 'hint-line';
    hintLine.append(hintBtn, meta, this.revealBtn);
    this.statusEl = document.createElement('span');
    this.statusEl.className = 'status';
    this.infoEl.append(link, hintLine, this.statusEl);
  }


  /** Return the cell for a solution index, creating its row on demand. */
  solutionCell(i) {
    const ply = this.initialPly + 1 + i;
    const num = Math.floor(ply / 2) + 1;
    if (!this.rowsByNum.has(num)) {
      const tr = document.createElement('tr');
      const tdNum = document.createElement('td');
      tdNum.className = 'num';
      tdNum.textContent = `${num}.`;
      const tdW = document.createElement('td');
      tdW.className = 'mv';
      const tdB = document.createElement('td');
      tdB.className = 'mv';
      tr.append(tdNum, tdW, tdB);
      this.tbodyEl.appendChild(tr);
      this.rowsByNum.set(num, { white: tdW, black: tdB });
    }
    const td = this.rowsByNum.get(num)[ply % 2 === 0 ? 'white' : 'black'];
    this.cellEls.set(i, td);
    return td;
  }

  /**
   * Create the solver input for a solution index. The input's keydown handler
   * closes over its own index, so no stale `disabled` juggling is needed —
   * exactly one input exists per reached ply.
   */
  addSolverInput(i) {
    const existing = this.inputEls.get(i);
    if (existing) return existing;
    const ply = this.initialPly + 1 + i;
    const td = this.solutionCell(i);
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.placeholder = '…';
    input.setAttribute(
      'aria-label',
      `Your move ${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}`
    );
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.attempt(i);
      }
    });
    input.addEventListener('input', () => {
      // Clear only the red highlight; dataset.failed (this ply failed at
      // least once) is kept so a later accept still colours amber.
      input.classList.remove('wrong');
    });
    td.appendChild(input);
    this.inputEls.set(i, input);
    return input;
  }

  renderTable() {
    this.tableEl.innerHTML = '';
    this.cellEls.clear();
    this.inputEls.clear();
    this.rowsByNum = new Map();
    this.tbodyEl = document.createElement('tbody');
    const tbody = this.tbodyEl;

    const cellFor = (ply) => {
      const num = Math.floor(ply / 2) + 1;
      const isWhite = ply % 2 === 0;
      if (!this.rowsByNum.has(num)) {
        const tr = document.createElement('tr');
        const tdNum = document.createElement('td');
        tdNum.className = 'num';
        tdNum.textContent = `${num}.`;
        const tdW = document.createElement('td');
        tdW.className = 'mv';
        const tdB = document.createElement('td');
        tdB.className = 'mv';
        tr.append(tdNum, tdW, tdB);
        tbody.appendChild(tr);
        this.rowsByNum.set(num, { white: tdW, black: tdB });
      }
      return this.rowsByNum.get(num)[isWhite ? 'white' : 'black'];
    };

    // Read-only lead-up context rows.
    for (const m of this.contextMoves) {
      cellFor(m.ply).textContent = m.san;
    }

    // Only the first solver ply is shown; each accepted move appends the
    // reply (and the next input) below, so the table grows one step at a
    // time and never hints at the total solution length. Later plies get no
    // row, no cell, and no input until they are reached.
    this.addSolverInput(0);

    this.tableEl.appendChild(tbody);
    // Focus the first solution cell only where a keyboard is already there.
    // On a touch screen this focus raises the on-screen keyboard before the
    // solver has asked for it; the cell is one tap away, and board drag/tap
    // input needs no focus at all.
    if (isKeyboardFirst()) this.inputEls.get(0)?.focus();
  }

  /**
   * Translate a square-to-square drag/tap gesture into a move attempt on the
   * currently expected solution ply. Promotion: a pawn reaching the back rank
   * opens the picker modal first — the solver must choose the piece, there is
   * no default queen. Picking the wrong piece is a failed attempt, exactly as
   * if the wrong promotion had been typed.
   */
  attemptDrag(from, to) {
    if (!this.active) return;
    const piece = this.chess.get(from);
    if (piece?.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      this.askPromotion(from, to, piece.color);
      return;
    }
    this.attempt(this.solIdx, { from, to });
  }

  /**
   * Open the promotion picker for a pending from/to gesture. `color` is the
   * chess.js colour ('w'/'b') of the promoting pawn, so the choices show the
   * solver's own pieces.
   */
  askPromotion(from, to, color) {
    this.promoPending = { from, to, solIdx: this.solIdx };
    this.promoChoices.innerHTML = '';
    for (const type of ['q', 'r', 'b', 'n']) {
      const letter = color === 'w' ? type.toUpperCase() : type;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'promo-choice';
      btn.title = PIECE_NAME[letter];
      const img = document.createElement('img');
      img.src = PIECE_URL[letter];
      img.alt = PIECE_NAME[letter];
      img.draggable = false;
      btn.appendChild(img);
      btn.addEventListener('click', () => {
        const pending = this.promoPending;
        this.closePromotion();
        // If the puzzle moved on while the dialog was open (e.g. a typed
        // Enter attempt), the stale gesture is dropped by attempt()'s guard.
        this.attempt(pending.solIdx, { from: pending.from, to: pending.to, promotion: type });
      });
      this.promoChoices.appendChild(btn);
    }
    this.promoEl.hidden = false;
    this.promoChoices.firstChild?.focus();
  }

  closePromotion() {
    this.promoPending = null;
    this.promoEl.hidden = true;
  }

  attempt(solIdx, drag = null) {
    if (this.done || solIdx !== this.solIdx) return;
    const input = this.inputEls.get(solIdx);
    const raw = input.value.trim();
    if (!drag && !raw) return;
    // A real attempt supersedes any pending tap-selection chip.
    this.selected = null;
    this.hideChip();

    let mv;
    try {
      if (drag) {
        mv = this.chess.move({ from: drag.from, to: drag.to, promotion: drag.promotion });
      } else {
        // Lenient SAN (strict: false accepts missing/extra trailing +/# etc.);
        // unparseable or ambiguous input throws and is rejected.
        mv = this.chess.move(raw, { strict: false });
      }
    } catch {
      // Typed garbage is a failed attempt, and so is an illegal board
      // gesture (no such legal move): landing the chip on a different square
      // claims "I see this move", so a claimed non-move is a visualization
      // failure. Only dropping back on the start square, or throwing the chip
      // off the board, cancels without failing — those paths never reach
      // attempt(). The illegal from-to (no SAN exists) is written into the
      // input, e.g. "e2-e5", so the feedback parallels the SAN shown for a
      // legal-but-wrong drag.
      if (drag) input.value = `${drag.from}-${drag.to}`;
      this.markWrong(input, { focus: !drag });
      return;
    }

    const uci = mv.from + mv.to + (mv.promotion || '');
    const scripted = this.solution[solIdx];
    const isLast = solIdx === this.solution.length - 1;
    // Alternate last move: on the final ply any checkmating move is accepted.
    const accepted = uci === scripted || (isLast && this.chess.isCheckmate());
    if (!accepted) {
      this.chess.undo();
      // Show what the drag was read as, so the feedback matches typed input.
      if (drag) input.value = mv.san;
      this.markWrong(input, { focus: !drag });
      return;
    }

    const td = this.cellEls.get(solIdx);
    td.textContent = mv.san;
    // First-try accept = green; accept after any failure on this ply = amber.
    td.classList.add(input.dataset.failed ? 'mine-recovered' : 'mine-first');
    if (isLast) {
      this.finish();
      return;
    }

    // Opponent replies immediately, no delay — and only now is its cell (and
    // the next solver input) created, so the table grows one row at a time.
    const reply = playUci(this.chess, this.solution[solIdx + 1]);
    const replyTd = this.solutionCell(solIdx + 1);
    replyTd.textContent = reply.san;
    replyTd.classList.add('opponent');

    this.solIdx = solIdx + 2;
    if (this.solIdx >= this.solution.length) {
      this.finish();
      return;
    }
    const next = this.addSolverInput(this.solIdx);
    // Drag input must not grab focus: on mobile that would pop the keyboard
    // up over the board after every move.
    if (!drag) next.focus();
  }

  markWrong(input, { focus = true } = {}) {
    this.failed = true;
    input.classList.add('wrong');
    // Remember that this ply failed at least once: a later accepted move on
    // the same input colours amber instead of green.
    input.dataset.failed = '1';
    if (focus) {
      input.focus();
      input.select();
    }
  }

  reveal() {
    if (!this.solution || this.done) return;
    this.failed = true;
    this.revealed = true; // reveals are never reported to Lichess
    for (let i = this.solIdx; i < this.solution.length; i++) {
      const mv = playUci(this.chess, this.solution[i]);
      // Reveal also grows the table: cells for unreached plies don't exist
      // yet, so create rows/inputs on demand before overwriting them.
      if (i % 2 === 0) this.addSolverInput(i);
      const td = this.solutionCell(i);
      td.textContent = mv.san;
      td.classList.add('revealed');
    }
    this.finish();
  }

  finish() {
    this.done = true;
    for (const input of this.inputEls.values()) input.disabled = true;
    // Served (or revealed) — the button has no further use, so retire it.
    this.revealBtn.disabled = true;
    this.revealBtn.hidden = true;
    const solved = !this.failed;
    if (this.statusEl) {
      this.statusEl.textContent = solved ? ' Solved!' : ' Failed';
      this.statusEl.classList.add(solved ? 'solved' : 'failed');
    }
    this.onResult?.(solved);
  }

  showError(message, retryFn, { retry = true } = {}) {
    this.errorEl.hidden = false;
    this.errorEl.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = message;
    this.errorEl.append(span);
    if (!retry) {
      this.revealBtn.disabled = true;
      this.revealBtn.hidden = true;
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Retry';
    btn.addEventListener('click', () => {
      this.hideError();
      retryFn?.();
    });
    this.errorEl.append(btn);
    this.revealBtn.disabled = true;
    this.revealBtn.hidden = true;
  }

  hideError() {
    this.errorEl.hidden = true;
    this.errorEl.innerHTML = '';
  }
}
