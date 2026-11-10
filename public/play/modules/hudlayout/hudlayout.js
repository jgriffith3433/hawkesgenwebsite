// HUD layout: the HUD pieces sit in named zones, and a panel on the right side (the mirror's "What are you?") is a
// zone of its own that the others make room for. J, 2026-11-10 (finding f_107b8302f4fd): the top-right action row
// (Save this world, Build your own, Copy invite link...) ran under the mirror panel and the quest banner's button
// with it.
//
//   top-left   the quest banner      .tour-track .tour-stuck .qs-btn .qs-track   (max-width ends left of the panel)
//   top-right  the action row        .gs-acts                                     (moves left of the panel)
//   right      the side panel        .mr, or anything with [data-hud-panel]
//   bottom     the chat               (touchlayout.js owns the phone's zones; a bottom sheet reserves nothing here)
//
// No timers and no polling: the layout is recomputed when a panel is added or removed (a MutationObserver on the body),
// when the panel itself changes size (ResizeObserver) and when the window is resized. It writes two things: the CSS
// variable --hl-panel (pixels from the right edge to the panel's left edge, plus a gap; 0 when closed) and the class
// hl-panel on <body>. The CSS moves things with a transition, so opening and closing glide instead of jumping.
//
//   H.hudLayout.zones        the table above (names -> selectors)
//   H.hudLayout.reserved()   pixels reserved on the right now
//   H.hudLayout.compute(vw, left, width)   the pure rule (tests)
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.hudLayout) return;
  const GAP = 12; // between the moved things and the panel
  const SIDE_MIN_VW = 701; // under this the panel is a bottom sheet (mirror.js @media 700px): nothing to make room for
  const ZONES = {
    quest: '.tour-track, .tour-stuck, .qs-btn, .qs-track',
    actions: '.gs-acts',
    panel: '.mr, [data-hud-panel]',
  };

  /** Pixels to keep free on the right for a panel whose left edge is `left` and width `width` in a window `vw` wide. */
  function compute(vw, left, width) {
    if (!(width > 0) || vw < SIDE_MIN_VW) return 0;
    if (left < vw * 0.4) return 0; // not at the right side (a bottom sheet, a centered card)
    return Math.max(0, Math.round(vw - left + GAP));
  }

  let reserved = 0, mo = null, ro = null, watched = null;
  function measure() {
    const p = document.querySelector(ZONES.panel);
    if (!p) return 0;
    const cs = getComputedStyle(p);
    if (cs.position !== 'fixed') return 0;
    const vw = window.innerWidth;
    const right = parseFloat(cs.right);
    const width = p.offsetWidth; // (not the rect: the panel slides in, and a transform must not count)
    return compute(vw, vw - (Number.isFinite(right) ? right : 0) - width, width);
  }
  function apply() {
    const p = document.querySelector(ZONES.panel);
    if (p !== watched) { if (ro && watched) ro.unobserve(watched); watched = p; if (ro && p) ro.observe(p); }
    const next = measure();
    if (next === reserved) return;
    reserved = next;
    const root = document.documentElement;
    root.style.setProperty('--hl-panel', reserved + 'px');
    document.body.classList.toggle('hl-panel', reserved > 0);
  }

  const CSS = `
    :root{--hl-panel:0px}
    .gs-acts{transition:right .3s ease,max-width .3s ease}
    .tour-track,.qs-track{transition:width .3s ease,max-width .3s ease}
    body.hl-panel .gs-acts{right:calc(var(--hl-panel) + 0px);max-width:calc(100vw - var(--hl-panel) - 24px - 312px)}
    body.hl-panel .tour-track{width:min(300px,calc(100vw - var(--hl-panel) - 24px))}
    body.hl-panel .qs-track{max-width:min(300px,calc(100vw - var(--hl-panel) - 24px))}
    body.hl-panel.tl .gs-acts{max-width:none}
    @media (prefers-reduced-motion:reduce){.gs-acts,.tour-track,.qs-track{transition:none}}`;

  function start() {
    if (typeof document === 'undefined' || !document.body || start.done) return;
    start.done = true;
    const st = document.createElement('style');
    st.id = 'hl-style';
    st.textContent = CSS;
    document.head.appendChild(st);
    mo = new MutationObserver(apply);
    mo.observe(document.body, { childList: true });
    if (typeof ResizeObserver !== 'undefined') ro = new ResizeObserver(apply);
    window.addEventListener('resize', apply);
    apply();
  }
  if (typeof document !== 'undefined') {
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  H.hudLayout = { zones: ZONES, reserved: () => reserved, compute, refresh: apply };
})();
