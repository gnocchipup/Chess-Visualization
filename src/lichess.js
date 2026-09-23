/**
 * Fetch live puzzle data from lichess. The app hard-requires this call;
 * callers must treat any failure as a fatal (retryable) error state.
 */
export async function fetchPuzzle(puzzleId) {
  let res;
  try {
    res = await fetch(`https://lichess.org/api/puzzle/${encodeURIComponent(puzzleId)}`);
  } catch (err) {
    throw new Error(`Network error reaching lichess: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`Lichess API returned HTTP ${res.status} for puzzle ${puzzleId}.`);
  }
  const data = await res.json();
  if (!data?.game?.pgn || !data?.puzzle || typeof data.puzzle.initialPly !== 'number') {
    throw new Error(`Unexpected lichess response shape for puzzle ${puzzleId}.`);
  }
  return data;
}
