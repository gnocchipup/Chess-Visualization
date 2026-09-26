// Logic test of the persisted board flip: the orientation rules in
// src/orientation.js and the stored preference in src/settings.js, run with:
//   node scripts/verify-flip.mjs
//
// No network and no browser. src/settings.js only touches storage inside its
// functions, so a minimal localStorage stub is all it needs — which also lets
// this script assert the storage key the README documents and the two-way
// round trip that carries a flip over to the next puzzle and a reload.
import { WHITE, BLACK, flipOrientation, resolveOrientation } from '../src/orientation.js';

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
};

console.log('\n1. Auto orientation (no flip): the solver owns the bottom');

check('a white puzzle shows white at the bottom', resolveOrientation(WHITE, false) === WHITE);
check('a black puzzle shows black at the bottom', resolveOrientation(BLACK, false) === BLACK);

console.log('\n2. A flip shows the other side than the auto-detected one');

check('white puzzle flipped -> black at the bottom', resolveOrientation(WHITE, true) === BLACK);
check('black puzzle flipped -> white at the bottom', resolveOrientation(BLACK, true) === WHITE);

console.log('\n3. Flipping is its own inverse, and never yields a non-orientation');

check(
  'flipOrientation swaps both colours',
  flipOrientation(WHITE) === BLACK && flipOrientation(BLACK) === WHITE
);
check(
  'flipping twice is a no-op',
  flipOrientation(flipOrientation(WHITE)) === WHITE &&
    flipOrientation(flipOrientation(BLACK)) === BLACK
);
check(
  'every solver x flip combination yields white or black',
  [WHITE, BLACK].every((solver) =>
    [false, true].every((flipped) => [WHITE, BLACK].includes(resolveOrientation(solver, flipped)))
  )
);
check(
  'a flipped board is the mirror of the auto one for the same puzzle',
  resolveOrientation(WHITE, true) === resolveOrientation(BLACK, false) &&
    resolveOrientation(BLACK, true) === resolveOrientation(WHITE, false)
);

console.log('\n4. The preference persists (cpt.flipped)');

// Node has no storage of its own (checked on 24.19.0), so stub the tiny slice
// of the Web Storage API that src/settings.js uses.
const store = new Map();
const written = [];
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      written.push(key);
      store.set(key, String(value));
    },
    removeItem: (key) => store.delete(key),
  },
});

const settings = await import('../src/settings.js');

check('the flip preference defaults to off (auto orientation)', settings.getFlipped() === false);

settings.setFlipped(true);
check('the flip is stored', settings.getFlipped() === true);
check('it is stored under the namespaced key cpt.flipped', written.includes('cpt.flipped'), [
  ...new Set(written),
].join(', ') || 'nothing written');
check(
  'the stored value is exactly "1", as the README documents',
  store.get('cpt.flipped') === '1',
  `cpt.flipped=${JSON.stringify(store.get('cpt.flipped'))}`
);
check(
  'getFlipped returns booleans, not raw strings',
  settings.getFlipped() === true && typeof settings.getFlipped() === 'boolean'
);

// The contract main.js wires together: Exercise.setup() orients each new puzzle
// with resolveOrientation(solverColor, settings.getFlipped()).
const nextPuzzleOrientation = (solver) => resolveOrientation(solver, settings.getFlipped());
check(
  'after a flip the next puzzle starts flipped (either colour)',
  nextPuzzleOrientation(BLACK) === WHITE && nextPuzzleOrientation(WHITE) === BLACK
);

settings.setFlipped(false);
check(
  'unflipping returns the next puzzle to the auto orientation',
  nextPuzzleOrientation(BLACK) === BLACK && nextPuzzleOrientation(WHITE) === WHITE
);
check(
  'an unflip is recorded as "0", so a stale "on" cannot survive',
  store.get('cpt.flipped') === '0',
  `cpt.flipped=${JSON.stringify(store.get('cpt.flipped'))}`
);

console.log('\n5. Storage hygiene');

store.set('cpt.flipped', 'yes-please');
check('a junk value degrades to the default, not to "on"', settings.getFlipped() === false);
check(
  'flip writes touch no other setting',
  !written.includes('cpt.plyBack') &&
    !written.includes('cpt.results') &&
    !written.includes('cpt.activeSet') &&
    !written.includes('cpt.source'),
  [...new Set(written)].join(', ')
);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL FLIP CHECKS PASSED');

// No process.exit(): see scripts/verify-topbar.mjs.
process.exitCode = failures ? 1 : 0;
