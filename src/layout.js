/**
 * Narrow-screen layout: the header becomes a drawer.
 *
 * Below `MOBILE_QUERY` the board and the side panel have already stacked, so
 * the header is worth more as board space than as a toolbar. It turns into a
 * fixed panel hanging off the top of the viewport, and only the top bar (the
 * settings handle plus the solving controls, which must stay reachable) is left
 * on screen. Pulling that handle down reveals the settings; pushing it back up,
 * tapping outside, or pressing Escape hides them again.
 *
 * The geometry is a single number: the panel's translateY, where 0 = fully
 * open and -panelHeight = closed. Those maths are pure functions here so
 * scripts/verify-topbar.mjs can exercise them without a browser.
 */

/** Viewport width at which the layout stacks and the header becomes a drawer. */
export const MOBILE_QUERY = '(max-width: 900px)';

/** Pointer travel (px) that still counts as a tap instead of a drag. */
export const TAP_SLOP = 6;

/**
 * True when typing can be assumed to be the primary input, i.e. a real pointer
 * (mouse/trackpad) and no touch screen. Only there may the app move focus into
 * a text box by itself — on anything touch-first that would raise an on-screen
 * keyboard the solver never asked for.
 */
export function isKeyboardFirst() {
  return (
    window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
    (navigator.maxTouchPoints || 0) === 0
  );
}

/** Translation of a fully closed drawer: panel above the viewport, bar shown. */
function closedOffset(panelHeight) {
  return -Math.max(0, panelHeight);
}

/**
 * Clamp a drag translation to the resting range, so the drawer can never be
 * dragged past fully open or past fully closed.
 */
export function clampDrawerOffset(offset, panelHeight) {
  return Math.min(0, Math.max(closedOffset(panelHeight), offset));
}

/**
 * Resting state a drag settles into: open once the handle has been pulled more
 * than halfway towards open, closed otherwise. A tie closes.
 *
 * `startOpen` is the state the drag began in and `dy` the pointer's vertical
 * travel in px (positive = pulled down).
 */
export function resolveDrawerOpen({ startOpen, dy, panelHeight }) {
  const start = startOpen ? 0 : closedOffset(panelHeight);
  const offset = clampDrawerOffset(start + dy, panelHeight);
  return offset > closedOffset(panelHeight) / 2;
}


/**
 * Collapse/expand the header on a narrow screen.
 *
 * On a phone the header is worth more as board space than as a toolbar, so it
 * collapses to a slim bar holding just a drag grip and the settings button.
 * Pulling the grip down unfolds the title, account and help; pushing it back up,
 * tapping the grip, tapping outside, or pressing Escape collapses it again.
 *
 * Like TopBar, the geometry is pure and offline-testable
 * (scripts/verify-topbar.mjs): progress is a single fraction where 0 = fully
 * collapsed and 1 = fully expanded, and the only judgement call is where a
 * released drag comes to rest.
 */

/** Clamp collapse progress to the 0..1 range, so it can never overshoot. */
export function clampCollapseProgress(progress) {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/** Progress a pointer drag has reached, from the progress it started at. */
export function collapseProgress({ startProgress, dy, travel }) {
  if (!Number.isFinite(travel) || travel <= 0) return clampCollapseProgress(startProgress);
  return clampCollapseProgress(startProgress + dy / travel);
}

/**
 * Resting state a released drag settles into: expanded once the header has been
 * pulled more than halfway out, collapsed otherwise. A tie collapses, so a
 * barely-committed drag never leaves the header open over the board.
 */
export function resolveCollapseOpen({ startProgress, dy, travel }) {
  if (!Number.isFinite(travel) || travel <= 0) return false;
  return collapseProgress({ startProgress, dy, travel }) > 0.5;
}

/** Progress implied by a resting state, for starting the next drag from it. */
export function restingProgress(open) {
  return open ? 1 : 0;
}

export class TopBar {
  constructor({ headerEl, bodyEl, topbarEl, handleEl }) {
    this.headerEl = headerEl;
    this.bodyEl = bodyEl;
    this.topbarEl = topbarEl;
    this.handleEl = handleEl;

    this.mq = window.matchMedia(MOBILE_QUERY);
    this.mobile = this.mq.matches;
    // Auto-hidden on load: the board keeps the space until settings are asked
    // for. Desktop ignores the flag (every drawer rule is media-scoped).
    this.open = false;
    // Measured heights, published to CSS as --topbar-h / --drawer-body-h.
    this.metrics = { bar: -1, panel: -1 };

    this.gesture = null; // { startY, startOffset } while a pointer is down
    this.dragging = false;
    this.suppressClick = false;

    this.onPointerDown = (e) => this.startDrag(e);
    this.onPointerMove = (e) => this.moveDrag(e);
    this.onPointerUp = (e) => this.endDrag(e);
    this.onPointerCancel = () => this.cancelDrag();
    this.onClick = () => this.toggle();
    this.onKeyDown = (e) => {
      if (e.key === 'Escape' && this.mobile && this.open) this.setOpen(false);
    };
    this.onOutsideDown = (e) => {
      if (this.mobile && this.open && !this.headerEl.contains(e.target)) this.setOpen(false);
    };
    this.onViewportChange = () => this.refresh();

    this.handleEl.addEventListener('pointerdown', this.onPointerDown);
    this.handleEl.addEventListener('pointermove', this.onPointerMove);
    this.handleEl.addEventListener('pointerup', this.onPointerUp);
    this.handleEl.addEventListener('pointercancel', this.onPointerCancel);
    this.handleEl.addEventListener('click', this.onClick);
    document.addEventListener('pointerdown', this.onOutsideDown);
    document.addEventListener('keydown', this.onKeyDown);
    this.mq.addEventListener('change', this.onViewportChange);
    window.addEventListener('resize', this.onViewportChange);

    // Enables the fixed, collapsed header. A page where this script never ran
    // keeps a plain always-visible header instead of an unreachable one.
    document.documentElement.classList.add('drawer-ready');

    // The logo and the web font both land after first layout, and rotating a
    // phone changes the wrap width, so the measured heights are kept current.
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.measure());
      this.observer.observe(this.bodyEl);
      this.observer.observe(this.topbarEl);
    }

    this.refresh();
  }

  /** Re-measure after a viewport change and drop any desktop leftovers. */
  refresh() {
    this.mobile = this.mq.matches;
    if (!this.mobile) {
      this.open = false;
      this.gesture = null;
      this.dragging = false;
      this.releaseDrag();
    }
    this.measure();
    this.applyState();
  }

  /** Publish the measured heights to CSS. */
  measure() {
    const bar = this.topbarEl.offsetHeight;
    const panel = this.bodyEl.offsetHeight;
    if (bar === this.metrics.bar && panel === this.metrics.panel) return;
    this.metrics = { bar, panel };
    const style = document.documentElement.style;
    style.setProperty('--topbar-h', `${bar}px`);
    style.setProperty('--drawer-body-h', `${panel}px`);
  }

  setOpen(open) {
    this.open = !!open;
    this.applyState();
  }

  close() {
    this.setOpen(false);
  }

  applyState() {
    document.body.classList.toggle('drawer-open', this.open && this.mobile);
    this.handleEl.setAttribute('aria-expanded', String(this.open && this.mobile));
  }

  toggle() {
    // The browser still fires a click after a drag on the same element.
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (!this.mobile) return;
    this.setOpen(!this.open);
  }

  /**
   * Current translation of the panel, read back from the DOM so a drag that
   * starts mid-animation does not make the panel jump.
   */
  currentOffset() {
    const value = getComputedStyle(this.headerEl).transform;
    if (!value || value === 'none') return this.open ? 0 : -this.metrics.panel;
    return new DOMMatrixReadOnly(value).m42;
  }

  startDrag(e) {
    if (!this.mobile) return;
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.gesture = { startY: e.clientY, startOffset: this.currentOffset() };
    this.dragging = false;
    this.suppressClick = false;
    this.handleEl.setPointerCapture?.(e.pointerId);
  }

  moveDrag(e) {
    if (!this.mobile || !this.gesture || !e.isPrimary) return;
    const dy = e.clientY - this.gesture.startY;
    if (!this.dragging) {
      if (Math.abs(dy) < TAP_SLOP) return;
      // Only now is this a drag: freezing the transition at pointerdown would
      // snap a panel that was still animating.
      this.dragging = true;
      document.body.classList.add('drawer-dragging');
    }
    e.preventDefault();
    const offset = clampDrawerOffset(this.gesture.startOffset + dy, this.metrics.panel);
    this.headerEl.style.setProperty('--drawer-drag-y', `${offset}px`);
  }

  endDrag(e) {
    if (!this.mobile || !this.gesture || !e.isPrimary) return;
    const dy = e.clientY - this.gesture.startY;
    const dragged = this.dragging;
    this.gesture = null;
    this.dragging = false;
    if (!dragged) return; // a tap: the click handler toggles instead
    const open = resolveDrawerOpen({
      startOpen: this.open,
      dy,
      panelHeight: this.metrics.panel,
    });
    // Drop the inline offset and the drag class in one frame, so the panel
    // tweens from where the finger left it to the resting position.
    this.releaseDrag();
    this.setOpen(open);
    this.suppressClick = true;
    requestAnimationFrame(() => {
      this.suppressClick = false;
    });
  }

  cancelDrag() {
    if (!this.gesture) return;
    this.gesture = null;
    this.dragging = false;
    this.releaseDrag();
  }

  /** Hand the panel back to the class-driven resting position. */
  releaseDrag() {
    document.body.classList.remove('drawer-dragging');
    this.headerEl.style.removeProperty('--drawer-drag-y');
  }
}

export class HeaderCollapse {
  constructor({ headerEl, collapseEl, innerEl, handleEl }) {
    this.headerEl = headerEl;
    this.collapseEl = collapseEl;
    this.innerEl = innerEl;
    this.handleEl = handleEl;

    this.mq = window.matchMedia(MOBILE_QUERY);
    this.mobile = this.mq.matches;
    // Collapsed on load: the board keeps the space until asked for. Desktop
    // ignores this (every rule is media-scoped).
    this.open = false;
    this.progress = restingProgress(false);
    this.travel = 0; // px between collapsed and expanded, measured

    this.gesture = null; // { startY, startProgress } while a pointer is down
    this.dragging = false;
    this.suppressClick = false;

    this.onPointerDown = (e) => this.startDrag(e);
    this.onPointerMove = (e) => this.moveDrag(e);
    this.onPointerUp = (e) => this.endDrag(e);
    this.onPointerCancel = () => this.cancelDrag();
    this.onClick = () => this.toggle();
    this.onKeyDown = (e) => {
      if (e.key === 'Escape' && this.mobile && this.open) this.setOpen(false);
    };
    this.onOutsideDown = (e) => {
      if (this.mobile && this.open && !this.headerEl.contains(e.target)) this.setOpen(false);
    };
    this.onViewportChange = () => this.refresh();

    this.handleEl.addEventListener('pointerdown', this.onPointerDown);
    this.handleEl.addEventListener('pointermove', this.onPointerMove);
    this.handleEl.addEventListener('pointerup', this.onPointerUp);
    this.handleEl.addEventListener('pointercancel', this.onPointerCancel);
    this.handleEl.addEventListener('click', this.onClick);
    document.addEventListener('pointerdown', this.onOutsideDown);
    document.addEventListener('keydown', this.onKeyDown);
    this.mq.addEventListener('change', this.onViewportChange);
    window.addEventListener('resize', this.onViewportChange);

    // Enables the collapsed bar. A page where this script never ran keeps a
    // plain always-visible header instead of an unreachable one.
    document.documentElement.classList.add('header-collapse-ready');

    // The unfolded height depends on the title and the account name, both of
    // which can change after first layout (sign-in, font load).
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.measure());
      this.observer.observe(this.innerEl);
    }

    this.refresh();
  }

  /** Re-measure after a viewport change and drop any mobile leftovers. */
  refresh() {
    this.mobile = this.mq.matches;
    if (!this.mobile) {
      this.open = false;
      this.progress = restingProgress(false);
      this.gesture = null;
      this.dragging = false;
      this.releaseDrag();
    }
    this.measure();
    this.applyState();
  }

  /**
   * Measure how far the header travels between collapsed and expanded.
   * `scrollHeight` is used rather than `offsetHeight` because the collapsed row
   * is 0fr, which clips the box but not the content inside it.
   */
  measure() {
    const travel = this.innerEl.scrollHeight;
    if (travel === this.travel) return;
    this.travel = travel;
  }

  setOpen(open) {
    this.open = !!open;
    this.progress = restingProgress(this.open);
    this.applyState();
  }

  close() {
    this.setOpen(false);
  }

  applyState() {
    this.headerEl.classList.toggle('header-open', this.open && this.mobile);
    this.handleEl.setAttribute('aria-expanded', String(this.open && this.mobile));
  }

  /** Write a drag position to the row height, inline so CSS can follow it. */
  applyProgress(progress) {
    this.progress = clampCollapseProgress(progress);
    this.collapseEl.style.gridTemplateRows = `${this.progress * this.travel}px`;
  }

  toggle() {
    // The browser still fires a click after a drag on the same element.
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (!this.mobile) return;
    this.setOpen(!this.open);
  }

  startDrag(e) {
    if (!this.mobile) return;
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.measure();
    this.gesture = { startY: e.clientY, startProgress: this.progress };
    this.dragging = false;
    this.suppressClick = false;
    this.handleEl.setPointerCapture?.(e.pointerId);
  }

  moveDrag(e) {
    if (!this.mobile || !this.gesture || !e.isPrimary) return;
    const dy = e.clientY - this.gesture.startY;
    if (!this.dragging) {
      if (Math.abs(dy) < TAP_SLOP) return;
      // Only now is this a drag: freezing the transition at pointerdown would
      // snap a header that was still animating.
      this.dragging = true;
      this.headerEl.classList.add('header-dragging');
    }
    e.preventDefault();
    this.applyProgress(
      collapseProgress({ startProgress: this.gesture.startProgress, dy, travel: this.travel })
    );
  }

  endDrag(e) {
    if (!this.mobile || !this.gesture || !e.isPrimary) return;
    const startProgress = this.gesture.startProgress;
    const dy = e.clientY - this.gesture.startY;
    const dragged = this.dragging;
    this.gesture = null;
    this.dragging = false;
    if (!dragged) return; // a tap: the click handler toggles instead
    const open = resolveCollapseOpen({ startProgress, dy, travel: this.travel });
    // Drop the inline height and let the class-driven resting state take over,
    // so the panel tweens from where the finger left it.
    this.releaseDrag();
    this.setOpen(open);
    this.suppressClick = true;
    requestAnimationFrame(() => {
      this.suppressClick = false;
    });
  }

  cancelDrag() {
    if (!this.gesture) return;
    this.gesture = null;
    this.dragging = false;
    this.releaseDrag();
    this.applyState();
  }

  /** Hand the row height back to the class-driven resting state. */
  releaseDrag() {
    this.headerEl.classList.remove('header-dragging');
    this.collapseEl.style.removeProperty('grid-template-rows');
  }
}

