// HUD layout: the HUD pieces sit in named zones, and a panel on the right side (the mirror's "What are you?") is a
// zone of its own that the others make room for. J, 2026-11-10 (finding f_107b8302f4fd): the top-right action row
// (Save this world, Build your own, Copy invite link...) ran under the mirror panel and the quest banner's button
// with it.
//
// Phone compact (J, 2026-11-10): under 760 px wide (portrait 390x844) or under 500 px tall (landscape 844x390, the same
// short-landscape cut as overseer-sky), the action row folds into one 44 px menu button, and the mirror is a bottom
// sheet (portrait) or a narrow side sheet above the touch cluster (landscape) that never covers the quest button or
// the move stick.
//
//   top-left   the quest banner      .tour-track .tour-stuck .qs-btn .qs-track   (max-width ends left of the panel)
//   top-right  the action row        .gs-acts                                     (moves left of the panel; folds on phone)
//   right      the side panel        .mr, or anything with [data-hud-panel]
//   bottom     the chat               (touchlayout.js owns the phone's zones; a bottom sheet clears the stick)
//
// No timers and no polling: the layout is recomputed when a panel is added or removed (a MutationObserver on the body),
// when the panel itself changes size (ResizeObserver) and when the window is resized. It writes two things: the CSS
// variable --hl-panel (pixels from the right edge to the panel's left edge, plus a gap; 0 when closed) and the class
// hl-panel on <body>. Compact adds body.hl-compact. The CSS moves things with a transition, so opening and closing
// glide instead of jumping.
//
//   H.hudLayout.zones        the table above (names -> selectors)
//   H.hudLayout.reserved()   pixels reserved on the right now
//   H.hudLayout.compact(vw, vh)   phone fold (tests)
//   H.hudLayout.sheet(vw, vh)     'bottom' | 'side' | null (tests)
//   H.hudLayout.compute(vw, left, width)   the pure rule (tests)
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.hudLayout) return;
  const GAP = 12; // between the moved things and the panel
  const PHONE_W = 760; // under this: fold actions; portrait sheet is a bottom sheet
  const SHORT_H = 500; // under this (landscape phone): fold actions; sheet is a narrow side sheet
  const ZONES = {
    quest: '.tour-track, .tour-stuck, .qs-btn, .qs-track',
    actions: '.gs-acts',
    panel: '.mr, [data-hud-panel]',
  };

  /** Phone compact: widths under 760 or heights under 500 (short landscape). */
  function compact(vw, vh) {
    return (vw > 0 && vw < PHONE_W) || (vh > 0 && vh < SHORT_H);
  }
  /** How the mirror/panel sits on a phone: bottom sheet, narrow side sheet, or null (desktop side panel). */
  function sheet(vw, vh) {
    if (!(vw > 0) || !(vh > 0)) return null;
    if (vh < SHORT_H) return 'side';
    if (vw < PHONE_W) return 'bottom';
    return null;
  }

  /** Pixels to keep free on the right for a panel whose left edge is `left` and width `width` in a window `vw` wide. */
  function compute(vw, left, width) {
    if (!(width > 0) || vw < PHONE_W) return 0; // portrait phone: bottom sheet, nothing to reserve on the right
    if (left < vw * 0.4) return 0; // not at the right side (a bottom sheet, a centered card)
    return Math.max(0, Math.round(vw - left + GAP));
  }

  let reserved = 0, mo = null, ro = null, watched = null, wasCompact = false;
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
    const vw = window.innerWidth, vh = window.innerHeight;
    const nextCompact = compact(vw, vh);
    if (nextCompact !== wasCompact) {
      wasCompact = nextCompact;
      document.body.classList.toggle('hl-compact', nextCompact);
      if (!nextCompact) {
        for (const a of document.querySelectorAll('.gs-acts.open')) a.classList.remove('open');
      }
    }
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
    :root{--hl-panel:0px;--hl-menu:44px}
    .gs-acts{transition:right .3s ease,max-width .3s ease}
    .tour-track,.qs-track{transition:width .3s ease,max-width .3s ease}
    body.hl-panel .gs-acts{right:calc(var(--hl-panel) + 0px);max-width:calc(100vw - var(--hl-panel) - 24px - 312px)}
    body.hl-panel .tour-track{width:min(300px,calc(100vw - var(--hl-panel) - 24px))}
    body.hl-panel .qs-track{max-width:min(300px,calc(100vw - var(--hl-panel) - 24px))}
    body.hl-panel.tl .gs-acts{max-width:none}
    /* phone: one 44 px menu; the intents sit in a list under it when .open */
    body.hl-compact .gs-acts{flex-wrap:nowrap;align-items:flex-end;max-width:min(280px,calc(100vw - 24px));z-index:70}
    body.hl-compact .gs-acts:not(.open)>[data-intent]{display:none!important}
    body.hl-compact .gs-acts .more{display:inline-flex!important;align-items:center;justify-content:center;width:var(--hl-menu);height:var(--hl-menu);min-width:var(--hl-menu);min-height:var(--hl-menu);padding:0;font:700 18px/1 var(--hud,'Rajdhani',system-ui,sans-serif);letter-spacing:0;flex:none}
    body.hl-compact .gs-acts.open{flex-direction:column;align-items:stretch;gap:6px;padding:8px;background:rgba(10,14,24,.92);border:1px solid rgba(255,255,255,.16);border-radius:12px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 10px 28px rgba(0,0,0,.4)}
    body.hl-compact .gs-acts.open .more{align-self:flex-end}
    body.hl-compact .gs-acts.open>[data-intent]{display:block!important;width:100%;min-height:var(--hl-menu);box-sizing:border-box;text-align:left}
    body.hl-compact .gs-acts button,body.hl-compact .mr-btn,body.hl-compact .mr-x,body.hl-compact .mr-card,body.hl-compact .mr-chip{min-height:44px}
    body.hl-compact .mr-x{min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;padding:0}
    body.hl-compact .mr-btn{min-height:44px;padding:12px 16px}
    body.hl-compact .mr-sw,body.hl-compact .mr-row input[type=color]{width:44px;height:44px;min-width:44px;min-height:44px;box-sizing:border-box}
    body.hl-compact .mr-chip{min-height:44px;padding:10px 12px;display:inline-flex;align-items:center}
    /* touch: keep the top-right zone (and the menu) clear of a landscape side sheet */
    body.tl.hl-panel.hl-compact #tl-tr{width:max(48px,calc(var(--tl-tr-w) - var(--hl-panel)))!important}
    /* portrait phone: bottom sheet above the stick, under the quest band */
    @media (max-width:759px){
      .mr{top:auto!important;bottom:max(148px,calc(var(--tl-stick,124px) + env(safe-area-inset-bottom,0px) + 24px))!important;left:max(10px,env(safe-area-inset-left,0px))!important;right:max(10px,env(safe-area-inset-right,0px))!important;width:auto!important;max-height:min(42vh,calc(100dvh - 220px))!important;transform:none!important;animation:none!important;border-radius:16px}
      .mr-grid{grid-template-columns:repeat(4,1fr)}.mr-q{font-size:21px}
    }
    /* short landscape (844x390): narrow side sheet above the touch cluster, clear of the quest (top left) */
    @media (max-height:499px){
      .mr{top:max(10px,env(safe-area-inset-top,0px))!important;bottom:max(148px,calc(var(--tl-btn,60px) * 4 + var(--tl-gap,8px) * 3 + env(safe-area-inset-bottom,0px) + 20px))!important;right:max(10px,env(safe-area-inset-right,0px))!important;left:auto!important;width:min(280px,36vw)!important;max-height:none!important;transform:none!important;animation:none!important;border-radius:14px}
      .mr-grid{grid-template-columns:repeat(3,1fr)}.mr-q{font-size:18px}
    }
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
    // Close the actions menu on an outside tap (no timer).
    document.addEventListener('pointerdown', (e) => {
      if (!document.body.classList.contains('hl-compact')) return;
      const t = e.target;
      if (t && t.closest && t.closest('.gs-acts')) return;
      for (const a of document.querySelectorAll('.gs-acts.open')) a.classList.remove('open');
    }, true);
    apply();
  }
  if (typeof document !== 'undefined') {
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  H.hudLayout = { zones: ZONES, reserved: () => reserved, compute, compact, sheet, refresh: apply, PHONE_W, SHORT_H };
})();
