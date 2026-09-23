import Papa from 'papaparse';
import { createSetDb } from './sqlsets.js';

/** Above this many puzzles an in-memory sql.js DB gets uncomfortable (Gotcha #4). */
export const MAX_SAFE_PUZZLES = 50000;

/**
 * Stream-parse the lichess puzzle CSV (never loading it as one string) and
 * reservoir-sample up to `count` rows with ratingMin <= Rating <= ratingMax.
 * onProgress receives { parsed, matched, kept } after every chunk.
 */
export function sampleCsv({ file, ratingMin, ratingMax, count, onProgress }) {
  return new Promise((resolve, reject) => {
    const reservoir = [];
    let parsed = 0;
    let matched = 0;
    Papa.parse(file, {
      header: true,
      worker: true,
      skipEmptyLines: true,
      chunk: (results) => {
        for (const row of results.data) {
          parsed++;
          const rating = parseInt(row.Rating, 10);
          if (!Number.isFinite(rating) || rating < ratingMin || rating > ratingMax) continue;
          matched++;
          const rec = {
            puzzle_id: row.PuzzleId,
            fen: row.FEN,
            moves: row.Moves,
            rating,
            themes: row.Themes || '',
            game_url: row.GameUrl || '',
          };
          if (reservoir.length < count) {
            reservoir.push(rec);
          } else {
            // Uniform random sample via reservoir sampling.
            const j = Math.floor(Math.random() * matched);
            if (j < count) reservoir[j] = rec;
          }
        }
        onProgress?.({ parsed, matched, kept: reservoir.length });
      },
      complete: () => resolve({ rows: reservoir, parsed, matched }),
      error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
    });
  });
}

/**
 * Full build: stream CSV -> sample -> sql.js DB -> exported bytes.
 * Returns { bytes, sampled, parsed, matched }.
 */
export async function buildSet({ file, ratingMin, ratingMax, count, name, onProgress }) {
  const { rows, parsed, matched } = await sampleCsv({
    file,
    ratingMin,
    ratingMax,
    count,
    onProgress,
  });
  if (!rows.length) {
    throw new Error(`No puzzles matched rating range ${ratingMin}–${ratingMax}.`);
  }
  const bytes = await createSetDb({
    name,
    ratingMin,
    ratingMax,
    sourceRows: parsed,
    rows,
    onProgress,
  });
  return { bytes, sampled: rows.length, parsed, matched };
}

/**
 * Offer the exported DB as a real file: showSaveFilePicker on Chromium,
 * <a download> fallback elsewhere. Returns 'saved' | 'downloaded' | 'cancelled'.
 */
export async function saveSqliteFile(name, bytes) {
  const safeName = (name || 'puzzle-set').replace(/[\\/:*?"<>|]/g, '_');
  const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${safeName}.sqlite`,
        types: [
          { description: 'SQLite database', accept: { 'application/x-sqlite3': ['.sqlite'] } },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // Other errors (e.g. permission quirks) fall through to the download path.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.sqlite`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}
