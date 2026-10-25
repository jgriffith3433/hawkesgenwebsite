// H.touchLayout: where every on-screen touch control and HUD piece goes on a phone, in portrait and landscape.
//
// Before this, each module placed its own buttons with fixed pixel offsets (bottom: 108px, right: 100px...), so a vehicle's
// buttons sat on the fire button, the chat on the tracker, the Overseer's captions on the E prompt, and none of it knew
// about a notch. Now the page has FOUR ZONES (plus the stick and the two main buttons), computed from the viewport and
// the safe-area insets by `compute()` (pure; test/engine/touchlayout.test.ts proves they never overlap, stay inside the
// safe area and keep buttons at 48 px or more, in portrait and landscape, with and without a notch):
//
//   stick   bottom left          the move stick (124 px)
//   jump    bottom right         the main button (jump / handbrake / throttle up): 60 px
//   action  left of jump         B: get in, get out, use (60 px)
//   ctx     above jump + action  context buttons that flow upward (FIRE, tools, boost, horn, view, lights, flip, dive,
//                                fish, catch log, spawn wheel, throw): 2 columns of 3, 60 px each, 8 px apart
//   tl      top left             the HUD toggle, chat/emote/people, Journal, Stuck?, and the tour's tracker
//   tr      top right            account buttons, the vehicle's gauges, toasts, the gun's ammo
//   mid     bottom centre        the chat (the Overseer's captions), then the prompts above it (E, get in, tool tips)
//
// Modules keep making their elements where they always did; this file's MutationObserver MOVES them into a zone by
// selector (ZONE_OF) and the zone lays them out in a flow (flex), so two of them cannot overlap by construction and a
// new module's element joins by adding its selector. Zones clip, they never overlap each other.
//
// Also here: the HUD toggle (hide everything but the controls: body.tl-hud-off, remembered), haptics (H.haptic: a short tick
// on every button and the stick, off with reduced motion or localStorage hg_haptics=0) and audit() (measures the real
// elements: overlaps, buttons under 48 px, anything outside the safe area), which the playtest logs.
// docs/engine-modules.md "Touch layout"; tests: test/engine/touchlayout.test.ts.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H) return;

  // ------------------------------------------------------------------ the math (no DOM)
  const K = { M: 14, GAP: 8, BTN: 60, PITCH: 68, STICK: 124, MIN: 48, CTX_ROWS: 3, HOTBAR: 70, TL_MIN: 212, TL_MAX: 300, MID_LAND: 190 };
  const rect = (x, y, w, h) => ({ x, y, w, h, r: x + w, b: y + h });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** v: { w, h (the viewport), top, right, bottom, left (safe-area insets), lift (px the bottom controls rise: the build hotbar) }.
   *  Returns the rects (x, y, w, h, r, b) of every zone. */
  function compute(v) {
    const w = Math.round(v.w), h = Math.round(v.h);
    const T = Math.max(0, v.top || 0), R = Math.max(0, v.right || 0), B = Math.max(0, v.bottom || 0), L = Math.max(0, v.left || 0);
    const lift = Math.max(0, v.lift || 0);
    const { M, GAP, BTN, STICK } = K;
    const bot = h - B - M - lift, right = w - R - M;
    const stick = rect(L + M, bot - STICK, STICK, STICK);
    const jump = rect(right - BTN, bot - BTN, BTN, BTN);
    const action = rect(jump.x - GAP - BTN, bot - BTN, BTN, BTN);
    const ctxW = 2 * BTN + GAP, ctxH = K.CTX_ROWS * BTN + (K.CTX_ROWS - 1) * GAP;
    const ctx = rect(right - ctxW, jump.y - GAP - ctxH, ctxW, ctxH);
    const cluster = rect(ctx.x, ctx.y, ctxW, ctxH + GAP + BTN);
    const landscape = w > h;
    const top = T + M;
    const usable = w - L - R - 2 * M;
    const tw = clamp(Math.round(usable * (landscape ? 0.36 : 0.58)), K.TL_MIN, K.TL_MAX);
    let tl, tr, mid;
    if (landscape) {
      tl = rect(L + M, top, tw, Math.max(0, stick.y - GAP - top));
      const mx = tl.r + GAP;
      const midH = lift ? 150 : K.MID_LAND; // (building: the hotbar took 70 px of the height)
      mid = rect(mx, bot - midH, Math.max(0, cluster.x - GAP - mx), midH);
      tr = rect(mx, top, mid.w, Math.max(0, mid.y - GAP - top));
    } else {
      const bandBottom = cluster.y - GAP;
      const avail = bandBottom - top;
      const midH = clamp(Math.round(avail * 0.45), 150, 260);
      mid = rect(L + M, bandBottom - midH, usable, midH);
      const topH = Math.max(0, mid.y - GAP - top);
      tl = rect(L + M, top, tw, topH);
      tr = rect(tl.r + GAP, top, Math.max(0, right - (tl.r + GAP)), topH);
    }
    return { w, h, landscape, safe: rect(L, T, w - L - R, h - T - B), stick, jump, action, ctx, cluster, tl, tr, mid, insets: { t: T, r: R, b: B, l: L }, lift };
  }

  /** The pieces that must not overlap each other, by name. */
  const PIECES = ['stick', 'jump', 'action', 'ctx', 'tl', 'tr', 'mid'];
  const intersect = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y));
  /** Names of pairs of zones that overlap (empty: a sound layout). */
  function zoneOverlaps(lay) {
    const out = [];
    for (let i = 0; i < PIECES.length; i++) for (let j = i + 1; j < PIECES.length; j++) {
      if (intersect(lay[PIECES[i]], lay[PIECES[j]]) > 0) out.push(`${PIECES[i]}+${PIECES[j]}`);
    }
    return out;
  }
  const px = (n) => `${Math.round(n)}px`;
  /** The CSS custom properties for a layout (set on <html>; touchlayout's stylesheet reads them). */
  function cssVars(lay) {
    const o = { '--tl-btn': px(K.BTN), '--tl-gap': px(K.GAP), '--tl-stick': px(K.STICK), '--tl-mid-h': px(lay.mid.h) };
    for (const k of ['stick', 'jump', 'action', 'ctx', 'tl', 'tr', 'mid']) {
      const z = lay[k];
      o[`--tl-${k}-x`] = px(z.x); o[`--tl-${k}-y`] = px(z.y); o[`--tl-${k}-w`] = px(z.w); o[`--tl-${k}-h`] = px(z.h);
    }
    return o;
  }

  // ------------------------------------------------------------------ haptics
  const reduced = () => { try { return Boolean(matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };
  const hapticsOff = () => { try { return localStorage.getItem('hg_haptics') === '0'; } catch { return false; } };
  /** A short buzz where the device has one (phones): haptic(8) or haptic([10, 40, 10]). False where there is none. */
  function haptic(pattern = 8) {
    haptic.asked++;
    try {
      if (!navigator.vibrate || reduced() || hapticsOff()) return false;
      const ok = navigator.vibrate(pattern);
      if (ok) haptic.sent++;
      return Boolean(ok);
    } catch { return false; }
  }
  haptic.asked = 0; haptic.sent = 0;
  H.haptic = haptic;

  // ------------------------------------------------------------------ the zones' pieces: which module's element goes where
  const ZONE_OF = [
    ['tl', '.pr-hud, .pg-hud, .qs-btn, .tour-stuck, .tour-track, .qs-track, .wp-hp'],
    ['tr', '.gs-acts, .gs-toast, .corner, #veh-hud, .mh-score, .wp-ammo'],
    ['mid', '.hc-chat, .hp-use, #veh-prompt, .mh-tip, .water-hud'],
    ['ctx', '#touch, .mh-touch, #veh-touch, .sw-fab, .lv-touchbtn'],
  ];
  // What audit() measures: [name, selector, is a button (must be 48 px or more)]
  const WATCH = [
    ['stick', '#touch .pad', true], ['jump', '#touch .a', true], ['action', '#touch .b', true], ['touch-extra', '#touch .tb:not(.a):not(.b)', true],
    ['mayhem', '.mh-touch button', true], ['vehicle', '#veh-touch button', true], ['spawn', '.sw-fab', true], ['throw', '.lv-touchbtn', true],
    ['hud-toggle', '#tl-hide', true], ['people', '.pr-hud button', true], ['journal', '.qs-btn', true], ['stuck', '.tour-stuck', true],
    ['chat-tool', '.hc-tools button', true], ['prompt', '.hp-use button, #veh-prompt', true], ['account', '.gs-acts button, .gs-toast button', true], ['corner', '.corner button, .corner a', true],
    ['tracker', '.tour-track, .qs-track', false], ['chat', '.hc-chat', false], ['gauges', '#veh-hud', false], ['tip', '.mh-tip, .water-hud', false], ['ammo', '.wp-ammo, .wp-hp, .mh-score', false],
  ];

  /** Measures the real page: every watched element that is showing, which ones overlap, which buttons are under 48 px and
   *  which stick out of the safe area. { ok, w, h, items, overlaps, small, outside, text }. */
  function audit() {
    const w = innerWidth, h = innerHeight, ins = insets();
    const safe = rect(ins.l, ins.t, w - ins.l - ins.r, h - ins.t - ins.b);
    const items = [];
    for (const [name, sel, button] of WATCH) {
      let list = [];
      try { list = [...document.querySelectorAll(sel)]; } catch { /* odd selector */ }
      list.forEach((el, i) => {
        if (!el.getClientRects || !el.getClientRects().length) return;
        let cs = null;
        try { cs = getComputedStyle(el); } catch { /* no styles */ }
        if (cs && (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05)) return;
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) return;
        items.push({ name: list.length > 1 ? `${name}#${i + 1}` : name, kind: name, button, el, ...rect(b.left, b.top, b.width, b.height) });
      });
    }
    const overlaps = [], small = [], outside = [];
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (a.button && (a.w < K.MIN - 0.5 || a.h < K.MIN - 0.5)) small.push(`${a.name} ${Math.round(a.w)}x${Math.round(a.h)}`);
      if (a.button && (a.x < safe.x - 0.5 || a.y < safe.y - 0.5 || a.r > safe.r + 0.5 || a.b > safe.b + 0.5)) outside.push(a.name);
      for (let j = i + 1; j < items.length; j++) {
        const c = items[j];
        if (a.el.contains(c.el) || c.el.contains(a.el)) continue;
        const area = intersect(a, c);
        if (area > 6) overlaps.push(`${a.name} x ${c.name} (${Math.round(area)} px²)`);
      }
    }
    const ok = !overlaps.length && !small.length && !outside.length;
    const text = `${w}x${h}${ok ? ': ' : ' — '}${items.length} showing${overlaps.length ? `; overlap: ${overlaps.join(', ')}` : ''}${small.length ? `; under ${K.MIN}px: ${small.join(', ')}` : ''}${outside.length ? `; outside the safe area: ${outside.join(', ')}` : ''}`;
    return { ok, w, h, insets: ins, items: items.map((i) => ({ name: i.name, x: Math.round(i.x), y: Math.round(i.y), w: Math.round(i.w), h: Math.round(i.h) })), overlaps, small, outside, text };
  }

  // ------------------------------------------------------------------ safe area
  let probe = null;
  function insets() {
    try {
      if (!probe) {
        probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
        document.body.appendChild(probe);
      }
      const cs = getComputedStyle(probe);
      const n = (s) => parseFloat(s) || 0;
      return { t: n(cs.paddingTop), r: n(cs.paddingRight), b: n(cs.paddingBottom), l: n(cs.paddingLeft) };
    } catch { return { t: 0, r: 0, b: 0, l: 0 }; }
  }

  H.touchLayout = { compute, zoneOverlaps, cssVars, audit, insets, K, haptic, zones: ZONE_OF.map((z) => z[0]) };
  if (!H.touchUi || typeof document === 'undefined' || !document.body) return;

  // ------------------------------------------------------------------ the page part (phones and tablets only)
  const CSS = `
html body.tl .tl-zone{position:fixed;z-index:26;display:flex;box-sizing:border-box;pointer-events:none;gap:var(--tl-gap)}
html body.tl .tl-zone :is(button,a,input,select,label,[role=button]){pointer-events:auto}
html body.tl .tl-zone[hidden]{display:none}
html body.tl .tl-in{position:static!important;inset:auto!important;transform:none!important;margin:0!important;box-sizing:border-box}
html body.tl .tl-in[hidden],html body.tl .tl-zone [hidden]{display:none!important}

/* the main buttons and the stick: positioned from the computed rects (so a notch and the build hotbar move them) */
html body.tl #touch .pad{position:fixed!important;left:var(--tl-stick-x)!important;top:var(--tl-stick-y)!important;right:auto!important;bottom:auto!important;width:var(--tl-stick)!important;height:var(--tl-stick)!important;z-index:27}
html body.tl #touch .a{position:fixed!important;left:var(--tl-jump-x)!important;top:var(--tl-jump-y)!important;right:auto!important;bottom:auto!important;width:var(--tl-btn)!important;height:var(--tl-btn)!important;z-index:27}
html body.tl #touch .b{position:fixed!important;left:var(--tl-action-x)!important;top:var(--tl-action-y)!important;right:auto!important;bottom:auto!important;width:var(--tl-btn)!important;height:var(--tl-btn)!important;z-index:27}
html body.tl #touch,html body.tl .mh-touch,html body.tl #veh-touch{display:contents}

/* ctx: the context buttons flow up from just above jump and action, two columns of three */
html body.tl #tl-ctx{left:var(--tl-ctx-x);top:var(--tl-ctx-y);width:var(--tl-ctx-w);height:var(--tl-ctx-h);flex-direction:column-reverse;flex-wrap:wrap-reverse;align-content:flex-start;align-items:flex-start;justify-content:flex-start}
html body.tl #tl-ctx :is(#touch .tb:not(.a):not(.b),.mh-touch button,#veh-touch button,.sw-fab,.lv-touchbtn){position:static!important;inset:auto!important;margin:0!important;width:var(--tl-btn)!important;height:var(--tl-btn)!important;min-width:0!important;min-height:0!important;padding:0!important;flex:none;border-radius:50%;box-sizing:border-box;transform:none!important;line-height:1}
html body.tl #tl-ctx .mh-touch button{font-size:13px}
html body.tl #tl-ctx #veh-touch button{font-size:20px}
html body.tl #tl-ctx .sw-fab{font-size:30px}

/* tl: the top left; row one is the HUD toggle and the chat/emote/people buttons, then Journal and Stuck?, then the tracker */
html body.tl #tl-tl{left:var(--tl-tl-x);top:var(--tl-tl-y);width:var(--tl-tl-w);max-height:var(--tl-tl-h);flex-direction:row;flex-wrap:wrap;align-content:flex-start;align-items:flex-start;overflow:hidden}
html body.tl #tl-hide{order:0;width:48px;height:48px;border-radius:12px;border:1px solid rgba(255,255,255,.28);background:rgba(10,14,24,.7);color:#fff;font:700 12px/1 system-ui,sans-serif;letter-spacing:.04em;backdrop-filter:blur(8px);cursor:pointer;touch-action:manipulation;padding:0}
html body.tl #tl-hide[aria-pressed=true]{background:rgba(255,216,74,.9);color:#16130a}
html body.tl #tl-tl .pr-hud{order:1;display:flex;flex-direction:row;gap:6px}
html body.tl #tl-tl .pr-hud button{min-width:48px;min-height:48px;width:48px;height:48px;padding:0}
html body.tl #tl-tl .qs-btn{order:2;min-height:48px;display:inline-flex;align-items:center;max-width:100%}
html body.tl #tl-tl .tour-stuck{order:3;min-height:48px;padding:0 16px;font-size:14px;display:inline-flex;align-items:center;border-radius:24px}
html body.tl #tl-tl :is(.tour-track,.qs-track){order:5;flex:1 1 100%;width:100%!important;max-width:100%!important;overflow:hidden}
html body.tl #tl-tl :is(.wp-hp){order:4}

/* tr: the top right, filling downward (not clipped: the account button's tip hangs below it) */
html body.tl #tl-tr{left:var(--tl-tr-x);top:var(--tl-tr-y);width:var(--tl-tr-w);max-height:var(--tl-tr-h);flex-direction:column;align-items:flex-end;justify-content:flex-start}
html body.tl #tl-tr>*{max-width:100%}
html body.tl #tl-tr .gs-acts{justify-content:flex-end}
html body.tl #tl-tr .gs-acts button,html body.tl #tl-tr .gs-toast button{min-height:48px}
html body.tl #tl-tr .gs-toast{left:auto;width:auto;flex-wrap:wrap}
html body.tl #tl-tr .corner{flex-direction:row;flex-wrap:wrap;justify-content:flex-end;gap:6px}
html body.tl #tl-tr .corner #badge{display:none}
html body.tl #tl-tr .corner :is(a,button){display:inline-flex;align-items:center;min-height:48px;font-size:13px;padding:0 12px}
html body.tl #tl-tr #veh-hud{min-width:0!important;width:150px;padding:8px 12px!important;pointer-events:none}
html body.tl #tl-tr #veh-hud .hint{display:none}
html body.tl #tl-tr .wp-ammo{padding:4px 10px 6px 20px}

/* mid: the chat (the Overseer's captions) at the bottom, the prompts above it, all inside one clipped box */
html body.tl #tl-mid{left:var(--tl-mid-x);top:var(--tl-mid-y);width:var(--tl-mid-w);height:var(--tl-mid-h);flex-direction:column-reverse;align-items:center;justify-content:flex-start;overflow:hidden}
html body.tl #tl-mid>*{max-width:100%}
html body.tl #tl-mid .hc-chat{order:0;width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"log log" "status status" "form tools";gap:6px;padding:0;align-items:end}
html body.tl #tl-mid .hc-log{grid-area:log;max-height:max(2.8em,calc(var(--tl-mid-h) - 130px));font-size:14px;align-items:center;text-align:center;-webkit-mask-image:none;mask-image:none}
html body.tl #tl-mid .hc-log p{background:rgba(6,10,20,.55);padding:4px 9px;border-radius:8px}
html body.tl #tl-mid .hc-status{grid-area:status}
html body.tl #tl-mid .hc-form{grid-area:form;min-height:48px}
html body.tl #tl-mid .hc-tools{grid-area:tools;position:static;opacity:.85;align-self:end}
html body.tl #tl-mid .hc-tools button{width:48px;height:48px;font-size:18px}
html body.tl #tl-mid .hc-panel{position:fixed;left:var(--tl-mid-x);bottom:auto;top:var(--tl-mid-y);width:min(260px,var(--tl-mid-w));z-index:2}
html body.tl #tl-mid :is(.hp-use,.mh-tip,.water-hud){order:1;width:auto;white-space:normal;text-align:center}
html body.tl #tl-mid .hp-use{flex-wrap:wrap;justify-content:center}
html body.tl #tl-mid .hp-use button{min-height:48px}
html body.tl #tl-mid #veh-prompt{order:1;min-height:48px;display:inline-flex;align-items:center;pointer-events:auto}

/* hide the HUD: only the controls (and the toggle) stay */
html body.tl.tl-hud-off :is(#tl-tr,#tl-mid){display:none}
html body.tl.tl-hud-off #tl-tl>:not(#tl-hide){display:none!important}
html body.tl.tl-hud-off :is(.qs-edge,.qs-dist,.mh-pop){display:none!important}
`;

  const zones = {};
  let hideBtn = null;
  let raf = 0, adoptRaf = 0, last = '';

  function makeZones() {
    if (zones.tl) return;
    const css = document.createElement('style');
    css.id = 'tl-css';
    css.textContent = CSS;
    document.head.appendChild(css);
    for (const k of ['tl', 'tr', 'mid', 'ctx']) {
      const z = document.createElement('div');
      z.id = `tl-${k}`;
      z.className = 'tl-zone';
      z.setAttribute('data-tl', k);
      document.body.appendChild(z);
      zones[k] = z;
    }
    hideBtn = document.createElement('button');
    hideBtn.id = 'tl-hide';
    hideBtn.type = 'button';
    hideBtn.textContent = 'HUD';
    hideBtn.setAttribute('aria-label', 'Hide the HUD');
    hideBtn.setAttribute('aria-pressed', 'false');
    // (pointerdown is stopped so the tap is not also a look-drag or a click on the world)
    hideBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    hideBtn.addEventListener('click', () => setHud(!document.body.classList.contains('tl-hud-off')));
    zones.tl.appendChild(hideBtn);
  }

  /** Hides (true) or shows the HUD: everything but the sticks, buttons and this toggle. Remembered on this device. */
  function setHud(off) {
    const on = Boolean(off);
    document.body.classList.toggle('tl-hud-off', on);
    if (hideBtn) {
      hideBtn.setAttribute('aria-pressed', String(on));
      hideBtn.setAttribute('aria-label', on ? 'Show the HUD' : 'Hide the HUD');
    }
    try { localStorage.setItem('hg_touch_hud_off', on ? '1' : '0'); } catch { /* private mode */ }
    haptic(10);
    return on;
  }

  function adopt() {
    adoptRaf = 0;
    makeZones();
    for (const [zone, sel] of ZONE_OF) {
      let list = [];
      try { list = document.querySelectorAll(sel); } catch { /* odd selector */ }
      for (const el of list) {
        if (el.parentNode === zones[zone]) continue;
        if (el.closest && el.closest('.tl-zone') && el.closest('.tl-zone') !== zones[zone] && el.parentNode !== document.body) continue; // inside another adopted element (#touch's buttons)
        zones[zone].appendChild(el);
        el.classList.add('tl-in');
      }
    }
  }

  function layout() {
    raf = 0;
    makeZones();
    const b = document.body.classList;
    const lift = b.contains('building') || b.contains('studio-chat') ? K.HOTBAR : 0;
    const i = insets();
    const lay = compute({ w: innerWidth, h: innerHeight, top: i.t, right: i.r, bottom: i.b, left: i.l, lift });
    const key = JSON.stringify(lay);
    if (key === last) return;
    last = key;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(cssVars(lay))) root.style.setProperty(k, v);
    b.toggle('tl-land', lay.landscape);
    H.touchLayout.current = lay;
  }
  const soon = () => { if (!raf) raf = (window.requestAnimationFrame || setTimeout)(layout); };
  const soonAdopt = () => { if (!adoptRaf) adoptRaf = (window.requestAnimationFrame || setTimeout)(adopt); };

  function start() {
    document.body.classList.add('tl');
    makeZones();
    try { if (localStorage.getItem('hg_touch_hud_off') === '1') setHud(true); } catch { /* fine */ }
    layout(); adopt();
    // A tick on every other button too (the key buttons and the stick buzz in runtime.js).
    document.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (e.pointerType === 'mouse' || !t || !t.closest || t.closest('#touch,.mh-touch,#veh-touch')) return;
      if (t.closest('.tl-zone button,.tl-zone a,.sw-fab,.hp-use button,#veh-prompt')) haptic(8);
    }, true);
    window.addEventListener('resize', soon);
    window.addEventListener('orientationchange', soon);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', soon);
    if (typeof MutationObserver === 'function') {
      new MutationObserver(soonAdopt).observe(document.body, { childList: true, subtree: true });
      new MutationObserver(soon).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    // (a few times early: fonts, the notch's inset arrive after the first layout)
    for (const ms of [300, 1500]) setTimeout(() => { last = ''; layout(); adopt(); }, ms);
  }
  Object.assign(H.touchLayout, { setHud, adopt, layout, get hudOff() { return document.body.classList.contains('tl-hud-off'); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
