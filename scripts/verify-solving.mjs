// Logic test of the solving loop (mirrors src/exercise.js `attempt`), run with:
//   node scripts/verify-solving.mjs
import { Chess } from 'chess.js';

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

// Same predicate as exercise.js
function tryAttempt(chess, solution, solIdx, san) {
  let mv;
  try {
    mv = chess.move(san, { strict: false });
  } catch {
    return { accepted: false };
  }
  const uci = mv.from + mv.to + (mv.promotion || '');
  const isLast = solIdx === solution.length - 1;
  const accepted = uci === solution[solIdx] || (isLast && chess.isCheckmate());
  if (!accepted) chess.undo();
  return { accepted, mv };
}

// --- Puzzle Yh7uB, solving position (after 19. Ba6) ---
const res = await fetch('https://lichess.org/api/puzzle/Yh7uB');
const { game, puzzle } = await res.json();
const replay = new Chess();
replay.loadPgn(game.pgn);
const hist = replay.history({ verbose: true });
const solvingFen = hist[puzzle.initialPly].after; // P_{initialPly + 1}

const chess = new Chess(solvingFen);
const solution = puzzle.solution; // g5g2 e1g2 h3g2

// 1. Lenient SAN: "Rxg2" without trailing "+" must be accepted.
let r = tryAttempt(chess, solution, 0, 'Rxg2');
check('lenient SAN "Rxg2" accepted as g5g2', r.accepted && r.mv.san === 'Rxg2+');

// opponent reply
chess.move({ from: 'e1', to: 'g2' });

// 2. Wrong move rejected and position restored.
const fenBefore = chess.fen();
r = tryAttempt(chess, solution, 2, 'Qh4');
check('wrong move "Qh4" rejected', !r.accepted);
check('position unchanged after rejection', chess.fen() === fenBefore);

// 3. Unparseable input rejected.
r = tryAttempt(chess, solution, 2, 'nonsense');
check('garbage input rejected', !r.accepted && chess.fen() === fenBefore);

// 4. Scripted final move (mate) accepted.
r = tryAttempt(chess, solution, 2, 'Qxg2#');
check('scripted final "Qxg2#" accepted', r.accepted && chess.isCheckmate());

// 5. Alternate last move: any mating move accepted on the final ply.
//    Position: black king boxed in by its own pawns; both Ra8# and Rb8# mate.
const dual = new Chess('6k1/5ppp/8/8/8/8/7K/RR6 w - - 0 1');
r = tryAttempt(dual, ['a1a8'], 0, 'Rb8#'); // scripted is Ra8#, user plays Rb8#
check('alternate mating move accepted on final ply', r.accepted && dual.isCheckmate());

// 6. ...but a non-mating non-scripted move on the final ply is rejected.
const dual2 = new Chess('6k1/5ppp/8/8/8/8/7K/RR6 w - - 0 1');
r = tryAttempt(dual2, ['a1a8'], 0, 'Ra2');
check('non-mating deviation on final ply rejected', !r.accepted);

// 7. Mate-acceptance does NOT apply before the final ply.
const c7 = new Chess(solvingFen);
r = tryAttempt(c7, solution, 0, 'Qd1+'); // legal check, not scripted, not last ply
check('non-scripted move rejected mid-solution even if checking', !r.accepted);

// NOTE: no process.exit() here — on Windows, exiting while undici's keep-alive
// sockets are closing trips a libuv assertion (win/async.c). Set exitCode and
// let the event loop drain instead.
process.exitCode = failures ? 1 : 0;
