import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let sqlPromise = null;

/** Lazily initialise the sql.js WASM module. */
export function getSQL() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => sqlWasmUrl });
  }
  return sqlPromise;
}

const SCHEMA = `
CREATE TABLE puzzles (
  puzzle_id TEXT PRIMARY KEY,
  fen       TEXT NOT NULL,
  moves     TEXT NOT NULL,
  rating    INTEGER,
  themes    TEXT,
  game_url  TEXT
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
`;

/**
 * Build a fresh puzzle-set DB from sampled rows and return the exported bytes.
 * rows: [{ puzzle_id, fen, moves, rating, themes, game_url }]
 */
export async function createSetDb({ name, ratingMin, ratingMax, sourceRows, rows, onProgress }) {
  const SQL = await getSQL();
  const db = new SQL.Database();
  try {
    db.run(SCHEMA);
    const insert = db.prepare(
      'INSERT INTO puzzles (puzzle_id, fen, moves, rating, themes, game_url) VALUES (?,?,?,?,?,?)'
    );
    db.run('BEGIN');
    rows.forEach((r, i) => {
      insert.run([r.puzzle_id, r.fen, r.moves, r.rating, r.themes, r.game_url]);
      if (onProgress && i % 500 === 0) {
        onProgress({ phase: 'insert', inserted: i, total: rows.length });
      }
    });
    db.run('COMMIT');
    insert.free();

    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?,?)');
    const metaRows = [
      ['name', name],
      ['created_at', new Date().toISOString()],
      ['rating_min', String(ratingMin)],
      ['rating_max', String(ratingMax)],
      ['puzzle_count', String(rows.length)],
      ['source_rows', String(sourceRows)],
    ];
    for (const [k, v] of metaRows) meta.run([k, v]);
    meta.free();

    return db.export();
  } finally {
    db.close();
  }
}

/**
 * Validate bytes as a puzzle-set DB and read its meta. Throws on invalid schema.
 * Returns { name, createdAt, ratingMin, ratingMax, puzzleCount }.
 */
export async function inspectSet(bytes) {
  const SQL = await getSQL();
  const db = new SQL.Database(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  try {
    const tables = db
      .exec("SELECT name FROM sqlite_master WHERE type='table'")
      .flatMap((r) => r.values)
      .flat();
    if (!tables.includes('puzzles') || !tables.includes('meta')) {
      throw new Error('Not a valid puzzle set: missing puzzles/meta tables.');
    }
    const meta = {};
    const metaRes = db.exec('SELECT key, value FROM meta');
    for (const [k, v] of metaRes[0]?.values ?? []) meta[k] = v;
    const count = db.exec('SELECT COUNT(*) FROM puzzles')[0]?.values[0]?.[0] ?? 0;
    return {
      name: meta.name || 'Imported set',
      createdAt: meta.created_at || new Date().toISOString(),
      ratingMin: Number(meta.rating_min) || 0,
      ratingMax: Number(meta.rating_max) || 0,
      puzzleCount: Number(meta.puzzle_count) || count,
    };
  } finally {
    db.close();
  }
}

/** Open a stored set's bytes as a live sql.js Database. */
export async function openSet(bytes) {
  const SQL = await getSQL();
  return new SQL.Database(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/** Pick one random puzzle row from an open set DB. */
export function randomPuzzle(db) {
  const res = db.exec(
    'SELECT puzzle_id, fen, moves, rating, themes, game_url FROM puzzles ORDER BY RANDOM() LIMIT 1'
  );
  if (!res.length || !res[0].values.length) return null;
  const [puzzle_id, fen, moves, rating, themes, game_url] = res[0].values[0];
  return { puzzle_id, fen, moves, rating, themes, game_url };
}
