// Logic test of the narrow-screen header drawer geometry (mirrors
// src/layout.js `clampDrawerOffset` / `resolveDrawerOpen`), run with:
//   node scripts/verify-topbar.mjs
//
// The drawer is a single number — the panel's translateY, where 0 = fully open
// and -panelHeight = closed with the top bar left on screen — so the only
// decision the DOM code makes is which side of that range a drag settles on.
// The pointer plumbing itself (layout.js `TopBar`) needs a browser and is not
// covered here; `isKeyboardFirst` needs window.matchMedia and is not either.
import {
  clampDrawerOffset,
  resolveDrawerOpen,
  clampCollapseProgress,
  collapseProgress,
  resolveCollapseOpen,
  restingProgress,
  MOBILE_QUERY,
  TAP_SLOP,
} from '../src/layout.js';

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const PANEL = 300;

// 1. The resting positions themselves.
check('open resting offset is 0', clampDrawerOffset(0, PANEL) === 0);
check('closed resting offset is -panelHeight', clampDrawerOffset(-PANEL, PANEL) === -PANEL);

// 2. A drag cannot go past either resting position.
check('cannot pull past fully open', clampDrawerOffset(250, PANEL) === 0);
check('cannot push past fully closed', clampDrawerOffset(-900, PANEL) === -PANEL);

// 3. Where a released drag settles.
check(
  'pull up less than halfway keeps the panel open',
  resolveDrawerOpen({ startOpen: true, dy: -100, panelHeight: PANEL }) === true
);
check(
  'pull up past halfway closes it',
  resolveDrawerOpen({ startOpen: true, dy: -200, panelHeight: PANEL }) === false
);
check(
  'pull down less than halfway leaves it closed',
  resolveDrawerOpen({ startOpen: false, dy: 100, panelHeight: PANEL }) === false
);
check(
  'pull down past halfway opens it',
  resolveDrawerOpen({ startOpen: false, dy: 200, panelHeight: PANEL }) === true
);

// 4. Exactly halfway is a tie, and ties close, so a barely-committed drag
//    never leaves the panel hanging over the board.
check('exactly halfway closes', resolveDrawerOpen({ startOpen: true, dy: -150, panelHeight: PANEL }) === false);
check(
  'no movement keeps the panel where it was',
  resolveDrawerOpen({ startOpen: true, dy: 0, panelHeight: PANEL }) === true &&
    resolveDrawerOpen({ startOpen: false, dy: 0, panelHeight: PANEL }) === false
);

// 5. Movement below TAP_SLOP never reaches resolveDrawerOpen at all — it falls
//    through to the click toggle — so the slop has to stay under half a panel.
check('tap slop is far below half a panel', TAP_SLOP < PANEL / 2, `slop ${TAP_SLOP}px`);

// 6. Heavy overshoot in either direction settles instead of running away.
check('huge pull down opens', resolveDrawerOpen({ startOpen: false, dy: 5000, panelHeight: PANEL }) === true);
check('huge push up closes', resolveDrawerOpen({ startOpen: true, dy: -5000, panelHeight: PANEL }) === false);

// 7. Degenerate heights: an unmeasured panel (0, e.g. before the first layout
//    pass) and a nonsense negative one must not produce NaN or a half-open panel.
check(
  'zero-height panel degrades to closed',
  clampDrawerOffset(-10, 0) === 0 &&
    resolveDrawerOpen({ startOpen: false, dy: 50, panelHeight: 0 }) === false
);
check('negative panel height is treated as 0', clampDrawerOffset(10, -20) === 0);

// 8. The JS gate is the same breakpoint as the CSS media query; pin it so the
//    two cannot drift apart without failing here.
check('breakpoint matches the CSS media query', MOBILE_QUERY === '(max-width: 900px)', MOBILE_QUERY);

// 9. Collapsible header (mobile): progress is a fraction, 0 = collapsed,
//    1 = expanded, and the drag maths must stay inside that range.
const TRAVEL = 60; // px between collapsed and expanded

check('progress starts collapsed and ends expanded', restingProgress(false) === 0 && restingProgress(true) === 1);

check(
  'a full pull down reaches fully expanded',
  collapseProgress({ startProgress: 0, dy: TRAVEL, travel: TRAVEL }) === 1
);
check(
  'progress cannot overshoot either end',
  collapseProgress({ startProgress: 0, dy: 5000, travel: TRAVEL }) === 1 &&
    collapseProgress({ startProgress: 1, dy: -5000, travel: TRAVEL }) === 0
);
check(
  'a half pull lands halfway',
  collapseProgress({ startProgress: 0, dy: TRAVEL / 2, travel: TRAVEL }) === 0.5
);

// 10. Where a released header drag settles. Same halfway rule as the drawer:
//     a tie collapses, so a barely-committed pull never leaves the header open.
check(
  'pull down less than halfway stays collapsed',
  resolveCollapseOpen({ startProgress: 0, dy: 20, travel: TRAVEL }) === false
);
check(
  'pull down past halfway expands',
  resolveCollapseOpen({ startProgress: 0, dy: 40, travel: TRAVEL }) === true
);
check(
  'exactly halfway collapses',
  resolveCollapseOpen({ startProgress: 0, dy: TRAVEL / 2, travel: TRAVEL }) === false
);
check(
  'pushing up from expanded past halfway collapses it',
  resolveCollapseOpen({ startProgress: 1, dy: -40, travel: TRAVEL }) === false
);
check(
  'a short push up from expanded leaves it open',
  resolveCollapseOpen({ startProgress: 1, dy: -20, travel: TRAVEL }) === true
);
check(
  'no movement keeps the header where it was',
  resolveCollapseOpen({ startProgress: 1, dy: 0, travel: TRAVEL }) === true &&
    resolveCollapseOpen({ startProgress: 0, dy: 0, travel: TRAVEL }) === false
);

// 11. An unmeasured header (travel 0, e.g. before first layout) must not divide
//     by zero, produce NaN, or open itself on a stray touch.
check(
  'zero travel keeps the current state instead of NaN',
  collapseProgress({ startProgress: 0, dy: 50, travel: 0 }) === 0 &&
    resolveCollapseOpen({ startProgress: 0, dy: 50, travel: 0 }) === false
);
check('negative travel is treated as unmeasured', clampCollapseProgress(collapseProgress({ startProgress: 1, dy: -10, travel: -5 })) === 1);
check('NaN progress clamps to collapsed', clampCollapseProgress(NaN) === 0);

// NOTE: no process.exit() — see scripts/verify-drag.mjs.
process.exitCode = failures ? 1 : 0;
