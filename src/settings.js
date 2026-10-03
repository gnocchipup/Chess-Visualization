const NS = 'cpt.';
const KEY_PLY_BACK = NS + 'plyBack';
const KEY_ACTIVE_SET = NS + 'activeSet';
const KEY_RESULTS = NS + 'results';

export const DEFAULT_PLY_BACK = 4;

/**
 * How many coloured squares the score strip shows. This is a *display* cap
 * only: the strip has a fixed width, so past this point the oldest square
 * scrolls off the left. It deliberately does not limit the Solved/Failed
 * totals beside it — those are the running record of the whole session, and
 * capping them made the counts silently freeze once you passed 25 puzzles.
 */
export const MAX_STRIP = 25;

/**
 * A backstop on the stored log so a very long session cannot fill the
 * localStorage quota and start throwing on every result. One boolean is a few
 * bytes, so this is months of drilling rather than a real limit — and it is
 * still ~200x the strip length, so the visible totals never hit it in practice.
 */
export const MAX_LOG = 5000;

export function getPlyBack() {
  const raw = localStorage.getItem(KEY_PLY_BACK);
  const n = raw === null ? DEFAULT_PLY_BACK : parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PLY_BACK;
}

export function setPlyBack(value) {
  const n = Math.max(0, Math.floor(Number(value)));
  localStorage.setItem(KEY_PLY_BACK, String(Number.isFinite(n) ? n : DEFAULT_PLY_BACK));
}

export function getActiveSetId() {
  return localStorage.getItem(KEY_ACTIVE_SET);
}

export function setActiveSetId(id) {
  if (id === null || id === undefined) localStorage.removeItem(KEY_ACTIVE_SET);
  else localStorage.setItem(KEY_ACTIVE_SET, String(id));
}

const KEY_SOURCE = NS + 'source';
const KEY_DIFFICULTY = NS + 'difficulty';

/** Puzzle source: 'sets' (local SQLite set) or 'lichess' (/api/puzzle/next). */
export function getSource() {
  return localStorage.getItem(KEY_SOURCE) === 'lichess' ? 'lichess' : 'sets';
}

export function setSource(value) {
  localStorage.setItem(KEY_SOURCE, value === 'lichess' ? 'lichess' : 'sets');
}

/** Difficulty for /api/puzzle/next; '' means the Lichess default. */
export function getDifficulty() {
  return localStorage.getItem(KEY_DIFFICULTY) || '';
}

export function setDifficulty(value) {
  localStorage.setItem(KEY_DIFFICULTY, typeof value === 'string' ? value : '');
}

const KEY_FLIPPED = NS + 'flipped';

/**
 * Board flip preference: true = show the board from the other side than the
 * auto-detected one. Persisted, so a flip survives the next puzzle and a
 * reload; the orientation rule itself lives in src/orientation.js.
 */
export function getFlipped() {
  return localStorage.getItem(KEY_FLIPPED) === '1';
}

export function setFlipped(value) {
  localStorage.setItem(KEY_FLIPPED, value ? '1' : '0');
}

/**
 * Session score, persisted in localStorage: array of booleans (true = clean
 * solve). Scoped to the current configuration — main.js calls clearResults() when
 * the source, set, difficulty, or ply-back setting changes, since results from a
 * different configuration are not comparable to this one.
 *
 * Returns the whole log, not a window: the Solved/Failed totals count every
 * attempt in the session. Only the drawn strip is trimmed, and that happens in
 * renderScore via getStripResults() — trimming here instead would cap the
 * numbers as a side effect of a purely visual decision.
 */
export function getResults() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY_RESULTS) || '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'boolean') : [];
  } catch {
    return [];
  }
}

/**
 * The most recent MAX_STRIP results, oldest first — what the strip actually
 * draws. Derived from the full log on each call rather than stored separately,
 * so there is one source of truth and no way for the two to disagree.
 */
export function getStripResults() {
  return getResults().slice(-MAX_STRIP);
}

export function pushResult(ok) {
  const arr = getResults();
  arr.push(!!ok);
  // Bounded only by MAX_LOG, a quota backstop — not by MAX_STRIP. Dropping
  // older entries here is what used to freeze the totals at 25.
  const trimmed = arr.length > MAX_LOG ? arr.slice(-MAX_LOG) : arr;
  localStorage.setItem(KEY_RESULTS, JSON.stringify(trimmed));
  return trimmed;
}

export function clearResults() {
  localStorage.removeItem(KEY_RESULTS);
}
