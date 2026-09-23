// Acceptance test for Gotcha #1 (ply alignment), run with: node scripts/verify-yh7ub.mjs
//
// EMPIRICAL FINDING (verified against the live lichess API):
//   puzzle.initialPly is the number of plies up to the position *before* the
//   opponent's setup move (i.e. the CSV FEN position). The solving position is
//   therefore reached after (initialPly + 1) plies of the game PGN.
//
// With P_k = position after k plies:
//   solving position = P_{initialPly + 1}
//   X                = min(plyBack, initialPly)
//   board FEN        = P_{initialPly - X + 1}
//   context plies    = 0-based move indices initialPly - X + 1 .. initialPly
//
// Puzzle Yh7uB (game MnItujoS), plyBack = 4 must yield:
//   board FEN: 2kr4/pbp2pp1/5n1p/1B2r3/1P1p2q1/2NP1N2/1PP2PPP/R2Q1RK1 b - - 0 17
//   table:     17... Rg5 / 18. Ne1 Qh3 / 19. Ba6, first solver input at 19... expecting Rxg2+
import { Chess } from 'chess.js';

const res = await fetch('https://lichess.org/api/puzzle/Yh7uB');
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const { game, puzzle } = await res.json();

const replay = new Chess();
replay.loadPgn(game.pgn);
const hist = replay.history({ verbose: true });
const startFen = hist.length ? hist[0].before : replay.fen();
const fenAfter = (k) => (k === 0 ? startFen : hist[k - 1].after);

const plyBack = 4;
const X = Math.min(plyBack, puzzle.initialPly);
const boardFen = fenAfter(puzzle.initialPly - X + 1);

const EXPECTED_FEN = '2kr4/pbp2pp1/5n1p/1B2r3/1P1p2q1/2NP1N2/1PP2PPP/R2Q1RK1 b - - 0 17';
console.log('game id      :', game.id);
console.log('initialPly   :', puzzle.initialPly);
console.log('board FEN    :', boardFen);
console.log('FEN match    :', boardFen === EXPECTED_FEN ? 'PASS' : 'FAIL');

console.log('context rows :');
for (let p = puzzle.initialPly - X + 1; p <= puzzle.initialPly; p++) {
  const m = hist[p];
  console.log(`  ${Math.floor(p / 2) + 1}${p % 2 === 0 ? '.' : '...'} ${m.san}`);
}

const solve = new Chess(fenAfter(puzzle.initialPly + 1));
const mv = solve.move({ from: puzzle.solution[0].slice(0, 2), to: puzzle.solution[0].slice(2, 4) });
console.log('solver ply 1 :', mv.san, mv.san === 'Rxg2+' ? 'PASS' : 'FAIL');
console.log('solution     :', puzzle.solution.join(' '));
