/**
 * Live puzzle data from lichess. The app hard-requires these calls;
 * callers must treat any failure as a fatal (retryable) error state.
 */
import { getToken } from './auth.js';

function checkPuzzleShape(data, label) {
  if (!data?.game?.pgn || !data?.puzzle || typeof data.puzzle.initialPly !== 'number') {
    throw new Error(`Unexpected lichess response shape for ${label}.`);
  }
}

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
  checkPuzzleShape(data, `puzzle ${puzzleId}`);
  return data;
}

/** Difficulty values accepted by GET /api/puzzle/next (spec enum). */
export const NEXT_DIFFICULTIES = ['easiest', 'easier', 'normal', 'harder', 'hardest'];

/**
 * Fetch the caller's next puzzle (GET /api/puzzle/next).
 *
 * One call = one puzzle: callers must not prefetch or bulk-download
 * (Lichess API terms: mass enumeration belongs in database.lichess.org).
 * Works anonymously (difficulty calibrated to rating 1500), but only
 * returns unseen puzzles when signed in (scope `puzzle:read`).
 * `difficulty` is '' (Lichess default) or one of NEXT_DIFFICULTIES.
 */
export async function fetchNextPuzzle(difficulty = '') {
  const url = new URL('https://lichess.org/api/puzzle/next');
  if (difficulty) {
    if (!NEXT_DIFFICULTIES.includes(difficulty)) {
      throw new Error(`Unknown difficulty "${difficulty}".`);
    }
    url.searchParams.set('difficulty', difficulty);
  }
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new Error(`Network error reaching lichess: ${err.message}`);
  }
  if (res.status === 401) {
    throw new Error('Lichess rejected the sign-in (HTTP 401). Please sign in again.');
  }
  if (!res.ok) {
    throw new Error(`Lichess API returned HTTP ${res.status} for puzzle/next.`);
  }
  const data = await res.json();
  checkPuzzleShape(data, 'puzzle/next');
  return data;
}

