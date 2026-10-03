// Logic test of the session score: the Solved/Failed totals vs the capped
// colour strip in src/settings.js, run with:
//   node scripts/verify-score.mjs
//
// No network and no browser. src/settings.js only touches storage inside its
// functions, so the same minimal localStorage stub verify-flip.mjs uses is all
// it needs.
//
// The behaviour under test is a bug fix. getResults() used to slice to the last
// MAX_RESULTS entries and renderScore() derived BOTH the totals and the strip
// from that one array, so the numbers silently froze once a session passed 25
// puzzles while the squares kept scrolling. The totals must now count the whole
// log; only the drawn strip stays capped.
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

// Minimal Web Storage API, matching the stub in verify-flip.mjs.
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  },
});

const { MAX_STRIP, MAX_LOG, getResults, getStripResults, pushResult, clearResults } =
  await import('../src/settings.js');

const solvedIn = (log) => log.filter(Boolean).length;

console.log('\n1. An empty session reads as empty');
clearResults();
check('no results recorded', getResults().length === 0);
check('nothing drawn in the strip', getStripResults().length === 0);

console.log('\n2. Totals and strip agree while the strip is not yet full');
clearResults();
for (let i = 0; i < 10; i++) pushResult(i % 2 === 0);
const ten = getResults();
check('totals count every attempt', ten.length === 10, `len ${ten.length}`);
check('solved count is right', solvedIn(ten) === 5, `solved ${solvedIn(ten)}`);
check('strip shows them all while under the cap', getStripResults().length === 10);

console.log('\n3. Past 25 puzzles the strip caps but the totals keep counting');
clearResults();
// 40 attempts: 30 solved, 10 failed, so the last 25 entries deliberately hold a
// different ratio from the whole session. If the totals ever read from the
// trimmed array again, they report 25-ish and these assertions fail.
for (let i = 0; i < 30; i++) pushResult(true);
for (let i = 0; i < 10; i++) pushResult(false);
const forty = getResults();
check('the log is NOT capped at 25', forty.length === 40, `len ${forty.length}`);
check('solved total counts all 30', solvedIn(forty) === 30, `solved ${solvedIn(forty)}`);
check('failed total counts all 10', forty.length - solvedIn(forty) === 10);
check('totals exceed the strip length', forty.length > MAX_STRIP);

console.log('\n4. The strip keeps exactly the most recent MAX_STRIP, oldest first');
const strip = getStripResults();
check(`strip is capped at MAX_STRIP (${MAX_STRIP})`, strip.length === MAX_STRIP, `len ${strip.length}`);
check('strip holds the last 25 entries', forty.slice(-MAX_STRIP).join() === strip.join());
check('strip keeps the 10 failures at the end', strip.filter((x) => !x).length === 10);
// The 15 solved entries pushed before them must have scrolled off, which is the
// whole reason the totals needed un-capping in the first place.
check(
  'strip ratio differs from the session ratio',
  solvedIn(strip) !== solvedIn(forty),
  `strip ${solvedIn(strip)}/${strip.length} vs session ${solvedIn(forty)}/${forty.length}`,
);

console.log('\n5. The cap keeps holding as the session grows well past it');
clearResults();
for (let i = 0; i < 120; i++) pushResult(i % 3 !== 0);
const long = getResults();
check('120 attempts are all retained', long.length === 120, `len ${long.length}`);
check('strip still capped at 25', getStripResults().length === MAX_STRIP);
check('strip is the true tail', long.slice(-MAX_STRIP).join() === getStripResults().join());
check('totals reflect all 120', solvedIn(long) === 80, `solved ${solvedIn(long)}`);

console.log('\n6. MAX_LOG is a quota backstop, far above the strip cap');
check('MAX_LOG is larger than MAX_STRIP', MAX_LOG > MAX_STRIP, `${MAX_LOG} > ${MAX_STRIP}`);
check('MAX_LOG is not reachable in a normal session', MAX_LOG > 1000, `MAX_LOG ${MAX_LOG}`);
clearResults();
for (let i = 0; i < MAX_LOG + 25; i++) pushResult(true);
check('log is trimmed to MAX_LOG, not to MAX_STRIP', getResults().length === MAX_LOG, `len ${getResults().length}`);
check('the trim dropped the oldest entries', solvedIn(getResults()) === MAX_LOG);
check('strip still exactly MAX_STRIP', getStripResults().length === MAX_STRIP);

console.log('\n7. Junk in storage is filtered, not trusted');
clearResults();
localStorage.setItem('cpt.results', JSON.stringify([true, 'nope', false, 7, null, true]));
check('non-boolean entries are dropped', getResults().length === 3, `len ${getResults().length}`);
check('booleans survive in order', getResults().join() === 'true,false,true');
localStorage.setItem('cpt.results', 'not json at all');
check('malformed JSON degrades to empty', getResults().length === 0);
localStorage.setItem('cpt.results', JSON.stringify({ not: 'an array' }));
check('a non-array value degrades to empty', getResults().length === 0);

console.log('\n8. Reset clears both the totals and the strip');
clearResults();
for (let i = 0; i < 60; i++) pushResult(i % 2 === 0);
check('session has results before reset', getResults().length === 60);
clearResults();
check('totals cleared', getResults().length === 0);
check('strip cleared', getStripResults().length === 0);

console.log('\n9. pushResult coerces to a boolean');
clearResults();
pushResult(1);
pushResult(0);
pushResult('truthy');
pushResult(undefined);
check('only booleans are stored', getResults().join() === 'true,false,true,false');

// NOTE: no process.exit() — see scripts/verify-drag.mjs.
process.exitCode = failures ? 1 : 0;