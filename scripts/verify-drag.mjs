// Logic test of square-to-square drag input (mirrors src/exercise.js
// `attemptDrag` + the drag branch of `attempt`), run with:
//   node scripts/verify-drag.mjs
import { Chess } from 'chess.js';

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

// Same promotion resolution as exercise.js attemptDrag()
function dragDescriptor(chess, solution, solIdx, from, to) {
  let promotion;
  const piece = chess.get(from);
  if (piece?.type === 'p' && (to[1] === '8' || to[1] === '1')) {
    const scripted = solution[solIdx];
    promotion = scripted.startsWith(from + to) && scripted[4] ? scripted[4] : 'q';
  }
  return { from, to, promotion };
}

// Same acceptance predicate as the drag branch of exercise.js attempt()
function tryDragAttempt(chess, solution, solIdx, from, to) {
  let mv;
  try {
    mv = chess.move(dragDescriptor(chess, solution, solIdx, from, to));
  } catch {
    return { accepted: false, illegal: true };
  }
  const uci = mv.from + mv.to + (mv.promotion || '');
  const isLast = solIdx === solution.length - 1;
  const accepted = uci === solution[solIdx] || (isLast && chess.isCheckmate());
  if (!accepted) chess.undo();
  return { accepted, illegal: false, mv };
}

// --- Puzzle Yh7uB, solving position (after 19. Ba6), solution g5g2 e1g2 h3g2 ---
const res = await fetch('https://lichess.org/api/puzzle/Yh7uB');
const { game, puzzle } = await res.json();
const replay = new Chess();
replay.loadPgn(game.pgn);
const hist = replay.history({ verbose: true });
const solvingFen = hist[puzzle.initialPly].after; // P_{initialPly + 1}
const solution = puzzle.solution;

// 1. Dragging g5 -> g2 is exactly as good as typing Rxg2.
const chess = new Chess(solvingFen);
let r = tryDragAttempt(chess, solution, 0, 'g5', 'g2');
check('drag g5->g2 accepted as scripted g5g2', r.accepted && r.mv.san === 'Rxg2+');

// opponent reply
chess.move({ from: 'e1', to: 'g2' });

// 2. Wrong (but legal) drag is rejected and the position is restored.
const fenBefore = chess.fen();
r = tryDragAttempt(chess, solution, 2, 'h3', 'h4'); // Qh4, not the solution
check('wrong drag h3->h4 rejected', !r.accepted && !r.illegal);
check('position unchanged after wrong drag', chess.fen() === fenBefore);

// 3. Illegal drag is ignored silently (no failure, no position change).
r = tryDragAttempt(chess, solution, 2, 'e4', 'e5'); // empty square
check('illegal drag reported as illegal, not accepted', r.illegal && !r.accepted);
check('position unchanged after illegal drag', chess.fen() === fenBefore);

// 4. Scripted final move by drag (mate) accepted.
r = tryDragAttempt(chess, solution, 2, 'h3', 'g2');
check('drag h3->g2 accepted as scripted mate', r.accepted && chess.isCheckmate());

// 5. Alternate last move: any mating drag accepted on the final ply.
const dual = new Chess('6k1/5ppp/8/8/8/8/7K/RR6 w - - 0 1');
r = tryDragAttempt(dual, ['a1a8'], 0, 'b1', 'b8'); // scripted Ra8#, dragged Rb8#
check('alternate mating drag accepted on final ply', r.accepted && dual.isCheckmate());

// 6. Promotion drag defaults to queen when it matches the scripted move.
const promo = new Chess('8/2P5/8/8/8/8/k6K/8 w - - 0 1');
r = tryDragAttempt(promo, ['c7c8q'], 0, 'c7', 'c8');
check('promotion drag resolves to queen', r.accepted && r.mv.promotion === 'q');

// 7. ...but uses the scripted piece for an underpromotion solution.
const under = new Chess('8/2P5/8/8/8/8/k6K/8 w - - 0 1');
r = tryDragAttempt(under, ['c7c8n'], 0, 'c7', 'c8');
check('underpromotion drag uses scripted piece', r.accepted && r.mv.promotion === 'n');

// 8. A promotion drag that is not the solution is rejected (default queen),
//    and the position is restored.
const wrongPromo = new Chess('8/2P5/8/8/8/8/k6K/8 w - - 0 1');
const wpFen = wrongPromo.fen();
r = tryDragAttempt(wrongPromo, ['h1g1'], 0, 'c7', 'c8');
check('non-solution promotion drag rejected', !r.accepted && r.mv.promotion === 'q');
check('position unchanged after rejected promotion', wrongPromo.fen() === wpFen);

// NOTE: no process.exit() here — on Windows, exiting while undici's keep-alive
// sockets are closing trips a libuv assertion (win/async.c). Set exitCode and
// let the event loop drain instead.
process.exitCode = failures ? 1 : 0;
