// Verifies GET /api/puzzle/next (anonymous) returns a PuzzleAndGame payload
// that feeds Exercise.setup() with no set row — the Lichess-next source.
// One request only: this endpoint must never be bulk-fetched.
import { Chess } from 'chess.js';
import { fetchNextPuzzle } from '../src/lichess.js';

const data = await fetchNextPuzzle('');
const { game, puzzle } = data;
if (!game?.pgn || typeof puzzle?.initialPly !== 'number' || !puzzle?.solution?.length) {
  throw new Error('Unexpected /api/puzzle/next response shape.');
}
// Same alignment derivation Exercise.setup() uses: the solving position must
// exist and the scripted solution must be legal from it.
const replay = new Chess();
replay.loadPgn(game.pgn);
const hist = replay.history({ verbose: true });
const fenAfter = (k) => (k === 0 ? hist[0].before : hist[k - 1].after);
const solving = new Chess(fenAfter(puzzle.initialPly + 1));
for (const uci of puzzle.solution) {
  solving.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}
console.log(`next OK: puzzle ${puzzle.id} rating ${puzzle.rating}, ${puzzle.solution.length}-ply solution aligns.`);
