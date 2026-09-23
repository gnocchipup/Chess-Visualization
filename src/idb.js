const DB_NAME = 'chess-puzzle-trainer';
const STORE = 'sets';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const out = fn(store);
        t.oncomplete = () => {
          db.close();
          resolve(out && 'result' in out ? out.result : undefined);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
        t.onabort = () => {
          db.close();
          reject(t.error);
        };
      })
  );
}

/**
 * Record shape: { id, name, bytes: Uint8Array, createdAt, puzzleCount, ratingMin, ratingMax }
 */
export function putSet(record) {
  return run('readwrite', (s) => s.put(record));
}

export function getSet(id) {
  return run('readonly', (s) => s.get(id));
}

export function deleteSet(id) {
  return run('readwrite', (s) => s.delete(id));
}

/** All sets, newest first, with the heavy `bytes` stripped for listing. */
export async function listSets() {
  const all = (await run('readonly', (s) => s.getAll())) || [];
  return all
    .map(({ bytes, ...meta }) => meta)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
