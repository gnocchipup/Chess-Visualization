const NS = 'cpt.';
const KEY_PLY_BACK = NS + 'plyBack';
const KEY_ACTIVE_SET = NS + 'activeSet';
const KEY_RESULTS = NS + 'results';

export const DEFAULT_PLY_BACK = 4;

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

/** Session-scoped score, persisted in localStorage: array of booleans (true = clean solve). */
export function getResults() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY_RESULTS) || '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'boolean') : [];
  } catch {
    return [];
  }
}

export function pushResult(ok) {
  const arr = getResults();
  arr.push(!!ok);
  localStorage.setItem(KEY_RESULTS, JSON.stringify(arr));
  return arr;
}

export function clearResults() {
  localStorage.removeItem(KEY_RESULTS);
}
