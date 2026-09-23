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

