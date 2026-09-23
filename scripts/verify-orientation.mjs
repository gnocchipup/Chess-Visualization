// Verifies the board-orientation rule from src/exercise.js against live Lichess
// puzzles:   node scripts/verify-orientation.mjs
//
// The solver plays the side to move in the solving position P_{initialPly + 1}
// (see scripts/verify-yh7ub.mjs for the ply arithmetic). That colour decides the
// board orientation, so a puzzle where black is to move must be shown flipped.
//
// Rather than hard-coding a colour per puzzle, this asserts the invariant that
// makes the rule correct, then checks both branches are actually exercised.
import { Chess } from 'chess.js';

const PUZZLE_IDS = ['Yh7uB', '00sHx', '00sJ9'];

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
};

const seen = new Set();

for (const id of PUZZLE_IDS) {
  const res = await fetch(`https://lichess.org/api/puzzle/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for puzzle ${id}`);
  const { game, puzzle } = await res.json();

  const replay = new Chess();
  replay.loadPgn(game.pgn);
  const hist = replay.history({ verbose: true });
  const startFen = hist.length ? hist[0].before : replay.fen();
  const fenAfter = (k) => (k === 0 ? startFen : hist[k - 1].after);

  const solvingFen = fenAfter(puzzle.initialPly + 1);
  const chess = new Chess(solvingFen);
  const solver = chess.turn() === 'b' ? 'black' : 'white';
  const orientation = solver; // exercise.js flips the board when this is 'black'
  seen.add(solver);

  // The CSV FEN column is P_{initialPly}: the position *before* the opponent's
  // setup ply. So the side to move there is the opponent, not the solver.
  const sideAt = (k) => (fenAfter(k).split(/\s+/)[1] === 'b' ? 'black' : 'white');
  const fenSide = sideAt(puzzle.initialPly);

  console.log(`\n${id} (game ${game.id}, initialPly ${puzzle.initialPly})`);
  console.log(`  solution      : ${puzzle.solution.join(' ')}`);
  console.log(`  CSV FEN side  : ${fenSide}   (= P${puzzle.initialPly}, the opponent)`);
  console.log(`  solving pos   : ${solvingFen.split(' ').slice(0, 2).join(' ')}`);
  console.log(`  board orient. : ${orientation}${orientation === 'black' ? '  -> FLIPPED' : ''}`);

  check('the CSV FEN side is the opponent, never the solver', fenSide !== solver,
    `csv=${fenSide} vs solver=${solver}`);

  // If the side to move did not own the first solution piece, orienting the
  // board by it would put the solver's own pieces at the top.
  const first = puzzle.solution[0];
  const piece = chess.get(first.slice(0, 2));
  check('side to move owns the piece playing solution[0]',
    !!piece && piece.color === (solver === 'white' ? 'w' : 'b'),
    `${first.slice(0, 2)} = ${piece ? piece.color + piece.type : 'empty'}`);

  check('solution[0] is legal in the solving position', (() => {
    try {
      chess.move({ from: first.slice(0, 2), to: first.slice(2, 4), promotion: first[4] });
      return true;
    } catch { return false; }
  })());
}

console.log('');
check('both orientations are exercised (a white and a black puzzle)', seen.size === 2,
  [...seen].sort().join(' + '));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL ORIENTATION CHECKS PASSED');

// No process.exit(): on Windows, exiting while undici's keep-alive sockets are
// closing trips a libuv assertion (see scripts/verify-solving.mjs).
process.exitCode = failures ? 1 : 0;
