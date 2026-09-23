import { Chess } from 'chess.js';
import { renderBoard, WHITE, BLACK } from './board.js';
import { fetchPuzzle } from './lichess.js';

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
  constructor({ boardEl, tableEl, infoEl, errorEl, revealBtn, onResult }) {
    this.boardEl = boardEl;
    this.tableEl = tableEl;
    this.infoEl = infoEl;
    this.errorEl = errorEl;
    this.revealBtn = revealBtn;
    this.onResult = onResult;
    this.clear();

    // Optional shortcut: 'F' flips the board. Ignored while typing in the move
    // table so it never swallows a keystroke meant for a solution attempt.
    this.onKeyDown = (e) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (t && t.isContentEditable) return;
      this.flip();
    };
    document.addEventListener('keydown', this.onKeyDown);
  }

  clear() {
    this.row = null;
    this.chess = null;
    this.solution = null;
    this.solIdx = 0;
    this.failed = false;
    this.done = false;
    this.cellEls = new Map();
    this.inputEls = new Map();
    this.boardFen = null;
    this.orientation = WHITE;
    this.solverColor = null;
  }

  /**
   * Flip the board 180 degrees. This only re-orients the static board; it does
   * not change the position or touch the solving state, so it is safe to call
   * at any point during a puzzle.
   */
  flip() {
    if (!this.boardFen) return;
    this.orientation = this.orientation === WHITE ? BLACK : WHITE;
    renderBoard(this.boardEl, this.boardFen, { orientation: this.orientation });
  }

  get active() {
    return !!this.solution && !this.done;
  }

  async newPuzzle(row, plyBack) {
    this.clear();
    this.row = row;
    this.hideError();
    this.tableEl.innerHTML = '';
    this.infoEl.innerHTML = '<p class="muted">Fetching puzzle from lichess…</p>';
    this.revealBtn.disabled = true;

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
    // black, show the board from black's side.
    this.boardFen = boardFen;
    this.solverColor = this.chess.turn() === 'b' ? BLACK : WHITE;
    this.orientation = this.solverColor;
    this.boardEl.title = 'Press F to flip the board';
    renderBoard(this.boardEl, this.boardFen, { orientation: this.orientation });

    this.renderInfo(puzzle);
    this.renderTable();
    this.revealBtn.disabled = false;
  }

  /** Prefer the API solution; fall back to the CSV Moves column (strip setup ply). */
  deriveSolution(puzzle, solvingFen) {
    if (Array.isArray(puzzle.solution) && puzzle.solution.length) return puzzle.solution;
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
    const id = puzzle.id ?? this.row.puzzle_id;
    const rating = puzzle.rating ?? this.row.rating;
    const themes = Array.isArray(puzzle.themes)
      ? puzzle.themes.join(', ')
      : String(this.row.themes || '').split(/\s+/).filter(Boolean).join(', ');
    this.infoEl.innerHTML = '';
    const link = document.createElement('a');
    link.href = `https://lichess.org/training/${encodeURIComponent(id)}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = `lichess.org/training/${id}`;
    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.textContent = `Rating ${rating ?? '?'}${themes ? ` · ${themes}` : ''}`;
    this.statusEl = document.createElement('span');
    this.statusEl.className = 'status';
    this.infoEl.append(link, meta, this.statusEl);
  }


  renderTable() {
    this.tableEl.innerHTML = '';
    this.cellEls.clear();
    this.inputEls.clear();
    const tbody = document.createElement('tbody');
    const rowsByNum = new Map();

    const cellFor = (ply) => {
      const num = Math.floor(ply / 2) + 1;
      const isWhite = ply % 2 === 0;
      if (!rowsByNum.has(num)) {
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
        rowsByNum.set(num, { white: tdW, black: tdB });
      }
      return rowsByNum.get(num)[isWhite ? 'white' : 'black'];
    };

    // Read-only lead-up context rows.
    for (const m of this.contextMoves) {
      cellFor(m.ply).textContent = m.san;
    }

    // Solution rows: solver plies are inputs, opponent plies are filled on reply.
    this.solution.forEach((uci, i) => {
      const ply = this.initialPly + 1 + i;
      const td = cellFor(ply);
      this.cellEls.set(i, td);
      if (i % 2 === 0) {
        const input = document.createElement('input');
        input.type = 'text';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute(
          'aria-label',
          `Your move ${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}`
        );
        input.disabled = i !== 0;
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.attempt(i);
          }
        });
        input.addEventListener('input', () => input.classList.remove('wrong'));
        td.appendChild(input);
        this.inputEls.set(i, input);
      }
    });

    this.tableEl.appendChild(tbody);
    this.inputEls.get(0)?.focus();
  }

  attempt(solIdx) {
    if (this.done || solIdx !== this.solIdx) return;
    const input = this.inputEls.get(solIdx);
    const raw = input.value.trim();
    if (!raw) return;

    let mv;
    try {
      // Lenient SAN (strict: false accepts missing/extra trailing +/# etc.);
      // unparseable or ambiguous input throws and is rejected.
      mv = this.chess.move(raw, { strict: false });
    } catch {
      this.markWrong(input);
      return;
    }

    const uci = mv.from + mv.to + (mv.promotion || '');
    const scripted = this.solution[solIdx];
    const isLast = solIdx === this.solution.length - 1;
    // Alternate last move: on the final ply any checkmating move is accepted.
    const accepted = uci === scripted || (isLast && this.chess.isCheckmate());
    if (!accepted) {
      this.chess.undo();
      this.markWrong(input);
      return;
    }

    const td = this.cellEls.get(solIdx);
    td.textContent = mv.san;
    if (isLast) {
      this.finish();
      return;
    }

    // Opponent replies immediately, no delay.
    const reply = playUci(this.chess, this.solution[solIdx + 1]);
    const replyTd = this.cellEls.get(solIdx + 1);
    replyTd.textContent = reply.san;
    replyTd.classList.add('opponent');

    this.solIdx = solIdx + 2;
    if (this.solIdx >= this.solution.length) {
      this.finish();
      return;
    }
    const next = this.inputEls.get(this.solIdx);
    next.disabled = false;
    next.focus();
  }

  markWrong(input) {
    this.failed = true;
    input.classList.add('wrong');
    input.focus();
    input.select();
  }

  reveal() {
    if (!this.solution || this.done) return;
    this.failed = true;
    for (let i = this.solIdx; i < this.solution.length; i++) {
      const mv = playUci(this.chess, this.solution[i]);
      const td = this.cellEls.get(i);
      td.textContent = mv.san;
      td.classList.add('revealed');
    }
    this.finish();
  }

  finish() {
    this.done = true;
    for (const input of this.inputEls.values()) input.disabled = true;
    this.revealBtn.disabled = true;
    const solved = !this.failed;
    if (this.statusEl) {
      this.statusEl.textContent = solved ? ' Solved!' : ' Failed';
      this.statusEl.classList.add(solved ? 'solved' : 'failed');
    }
    this.onResult?.(solved);
  }

  showError(message, retryFn) {
    this.errorEl.hidden = false;
    this.errorEl.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = message;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Retry';
    btn.addEventListener('click', () => {
      this.hideError();
      retryFn?.();
    });
    this.errorEl.append(span, btn);
    this.revealBtn.disabled = true;
  }

  hideError() {
    this.errorEl.hidden = true;
    this.errorEl.innerHTML = '';
  }
}
