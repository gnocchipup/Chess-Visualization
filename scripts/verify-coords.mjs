// Logic test of the board's coordinate chrome and colour circles: the pure
// rules in src/orientation.js that src/board.js renders into the frame's
// gutters, run with:
//   node scripts/verify-coords.mjs
//
// No network and no browser. Rather than only asserting the two label orders,
// this mirrors src/board.js's own square naming (grid[r][c] -> 'abcdefgh'[c] +
// (8 - r), painted in `order` for the orientation) and checks that the j-th
// letter along the bottom edge names the file of the j-th board column, and the
// i-th number down the right edge names the rank of the i-th board row. That is
// the property a mis-ordered gutter would break, and the reason the colour
// circles are derived from the same orientation rather than tracked separately.
import {
  WHITE,
  BLACK,
  flipOrientation,
  topColor,
  fileOrder,
  rankOrder,
} from '../src/orientation.js';

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
};

// --- mirrors of src/board.js ------------------------------------------------

/** Row/column paint order: white's point of view, or rotated 180 degrees. */
const boardOrder = (orientation) =>
  orientation === BLACK ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

/** Square name for a white's-point-of-view (row, column), as board.js does it. */
const squareAt = (r, c) => 'abcdefgh'[c] + (8 - r);

/** Square name drawn at painted grid position (row i, column j). */
const paintedAt = (orientation, i, j) => {
  const order = boardOrder(orientation);
  return squareAt(order[i], order[j]);
};

const joined = (labels) => labels.join('');

console.log('\n1. White at the bottom: a..h along the bottom, 8..1 down the right');

check('files run a..h, left to right', joined(fileOrder(WHITE)) === 'abcdefgh', joined(fileOrder(WHITE)));
check('ranks run 8..1, top to bottom', joined(rankOrder(WHITE)) === '87654321', joined(rankOrder(WHITE)));

console.log('\n2. Black at the bottom: the same two gutters, reversed');

check('files run h..a, left to right', joined(fileOrder(BLACK)) === 'hgfedcba', joined(fileOrder(BLACK)));
check('ranks run 1..8, top to bottom', joined(rankOrder(BLACK)) === '12345678', joined(rankOrder(BLACK)));

console.log('\n3. Every label lines up with the square it labels');

for (const orientation of [WHITE, BLACK]) {
  const files = fileOrder(orientation);
  const ranks = rankOrder(orientation);
  let fileOk = true;
  let rankOk = true;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const sq = paintedAt(orientation, i, j);
      if (sq[0] !== files[j]) fileOk = false; // bottom gutter: j-th column
      if (sq[1] !== ranks[i]) rankOk = false; // right gutter: i-th row
    }
  }
  check(`${orientation} at the bottom: each file letter sits under its column`, fileOk);
  check(`${orientation} at the bottom: each rank number sits beside its row`, rankOk);
  check(
    `${orientation} at the bottom: corner squares match the gutter ends`,
    paintedAt(orientation, 0, 0) === files[0] + ranks[0] &&
      paintedAt(orientation, 7, 7) === files[7] + ranks[7],
    `${paintedAt(orientation, 0, 0)} .. ${paintedAt(orientation, 7, 7)}`
  );
}

check(
  'white at the bottom starts at a8 and ends at h1',
  paintedAt(WHITE, 0, 0) === 'a8' && paintedAt(WHITE, 7, 7) === 'h1'
);
check(
  'black at the bottom starts at h1 and ends at a8',
  paintedAt(BLACK, 0, 0) === 'h1' && paintedAt(BLACK, 7, 7) === 'a8'
);

console.log('\n4. The colour circles name the two ends');

check('white at the bottom -> black at the top', topColor(WHITE) === BLACK);
check('black at the bottom -> white at the top', topColor(BLACK) === WHITE);

for (const orientation of [WHITE, BLACK]) {
  check(
    `${orientation} at the bottom: the two circles show opposite colours`,
    topColor(orientation) !== orientation && [WHITE, BLACK].includes(topColor(orientation))
  );
  check(
    `${orientation} at the bottom: the top circle matches the top rank it sits beside`,
    topColor(orientation) === (rankOrder(orientation)[0] === '8' ? BLACK : WHITE)
  );
}

console.log('\n5. Flipping turns the coordinates round, and flipping twice is a no-op');

for (const orientation of [WHITE, BLACK]) {
  const other = flipOrientation(orientation);
  check(
    `a flipped board reverses both gutters (${orientation} -> ${other})`,
    joined(fileOrder(other)) === joined([...fileOrder(orientation)].reverse()) &&
      joined(rankOrder(other)) === joined([...rankOrder(orientation)].reverse())
  );
  check(
    `flipping twice restores both gutters (${orientation})`,
    joined(fileOrder(flipOrientation(other))) === joined(fileOrder(orientation)) &&
      joined(rankOrder(flipOrientation(other))) === joined(rankOrder(orientation))
  );
  check(
    `flipping twice restores the circles (${orientation})`,
    topColor(flipOrientation(other)) === topColor(orientation)
  );
}

console.log('\n6. Repeated reads are stable (the orders are not shared state)');

// A module-level array that was reversed in place would poison every later
// call; both orders must be rebuilt on each call, whatever order they are read.
check(
  'reading black first does not corrupt white',
  joined(fileOrder(BLACK)) === 'hgfedcba' && joined(fileOrder(WHITE)) === 'abcdefgh',
  `black=${joined(fileOrder(BLACK))} white=${joined(fileOrder(WHITE))}`
);
check(
  'reading black first does not corrupt white ranks',
  joined(rankOrder(BLACK)) === '12345678' && joined(rankOrder(WHITE)) === '87654321',
  `black=${joined(rankOrder(BLACK))} white=${joined(rankOrder(WHITE))}`
);
check(
  'each call returns a fresh array',
  fileOrder(WHITE) !== fileOrder(WHITE) && rankOrder(BLACK) !== rankOrder(BLACK)
);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL COORDINATE CHECKS PASSED');

// No process.exit(): see scripts/verify-topbar.mjs.
process.exitCode = failures ? 1 : 0;
