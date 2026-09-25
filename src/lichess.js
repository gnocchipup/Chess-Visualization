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
 *
 * Authenticated repeat-poll quirk: Lichess holds your "next" puzzle until
 * you solve it (POST /api/puzzle/batch/mix, scope `puzzle:write`). So
 * callers in signed-in Lichess mode MUST report each finished puzzle via
 * `reportResult` (below), otherwise every New-puzzle press returns the same
 * id. This is expected server behaviour, not a fetch bug — see
 * lichess-org/lila#20293 (closed as not planned).
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

/**
 * Report a finished Lichess-next puzzle as CASUAL (rated:false) and advance
 * the server queue: POST /api/puzzle/batch/mix?nb=1 (scope `puzzle:write`).
 *
 * Body: { solutions: [{ id, win, rated: false }] }. With nb=1 the response
 * also carries the next unseen puzzle ({ puzzles: [PuzzleAndGame] }), which
 * is returned so the caller can show it immediately — still one puzzle per
 * user action, no prefetching. `win` is your local solve result (reveal
 * counts as a loss client-side; per user choice reveals are NOT reported).
 *
 * Anonymous callers (no token) resolve null — nothing to report.
 * Throws on 401 (caller should prompt re-login) and other HTTP failures.
 */
export async function reportResult(puzzleId, win) {
  const token = getToken();
  if (!token) return null;
  let res;
  try {
    res = await fetch('https://lichess.org/api/puzzle/batch/mix?nb=1', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ solutions: [{ id: puzzleId, win: !!win, rated: false }] }),
    });
  } catch (err) {
    throw new Error(`Network error reporting puzzle result: ${err.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Lichess rejected the report (HTTP ' + res.status + '). Please sign in again.');
  }
  if (!res.ok) {
    throw new Error(`Lichess API returned HTTP ${res.status} for puzzle result.`);
  }
  const data = await res.json();
  const next = data?.puzzles?.[0];
  if (next) checkPuzzleShape(next, 'puzzle/batch next');
  return next ?? null;
}

