// Controls (J, 2026-10-28: "a controls button that shows you a list of hotkeys... this will ALL be different on mobile"):
// one button. On a computer it opens the keys that work right now: moving, the camera, using things, and what the
// moment adds (driving, a tool in hand, building, a strategy view), each line only when it applies. On a phone it opens a
// sheet of big buttons that do those things (spawn, change a thing's look, your look, the bag, emotes, the camera, stuck),
// and a few words on the stick and the screen. Modules add lines: H.controls.add({ group, keys, what, when, act, icon }).
// Also here: K changes the look of what you point at (or the vehicle you're in), where looks can be chosen.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const W = () => H.world;
  const G = () => H.game;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const player = () => W() && W().player;
  const ctrl = () => { const p = player(); return p && p.controller; };
  const inVehicle = () => Boolean(G() && G().vehicles && G().vehicles.current);
  const building = () => H.mode === 'build';
  const has = (k) => { try { return Boolean(k()); } catch { return false; } };

  // ------------------------------------------------------------------ what you point at, and changing its look
  /** The thing to change: the vehicle you're in, else the one under the crosshair (a scene thing, not you). */
  function target() {
    const g = G();
    if (!g) return null;
    if (inVehicle()) return g.vehicles.current;
    try {
      const hit = g.aim(14);
      const e = hit && hit.entity;
      if (e && e.sceneId && e !== player() && !e.isTerrain && !e.isBlocks && !e.remotePlayer) return e;
    } catch { /* no aim here */ }
    return null;
  }
  const canChange = () => Boolean(H.looks && H.looks.allowed && H.looks.allowed());
  function changeLook() {
    if (!canChange()) { if (G()) G().ui.message('Looks can be changed while building, or on your own island', 2); return false; }
    const t = target();
    if (!t) { G().ui.message('Point at something to change how it looks', 1.6); return false; }
    H.looks.open(t);
    return true;
  }

  // ------------------------------------------------------------------ the lines
  // { group, keys (desktop), what, when (shown only then), act (the phone's button does this), icon, tap (phone words) }
  const LINES = [
    { group: 'Move', keys: 'W A S D', what: 'walk', when: () => !inVehicle() && ctrl() !== 'flight' },
    { group: 'Move', keys: 'Space', what: 'jump (swim up)', when: () => !inVehicle() },
    { group: 'Move', keys: 'F', what: 'fly (Space up, C down)', when: () => { const p = player(); return !inVehicle() && p && (p.canFly || building()); } },
    { group: 'Look', keys: 'Click', what: 'look around with the mouse (Esc lets go)', when: () => !inVehicle() && H.mode === 'play' },
    { group: 'Look', keys: 'V', what: 'change the camera', when: () => inVehicle(), act: () => press('v'), icon: '🎥', tap: 'Camera' },
    { group: 'Do', keys: 'E', what: 'use, get in, talk, pick up (when it says so)', when: () => true },
    { group: 'Do', keys: 'Q', what: 'spawn something (hold for the wheel)', when: () => H.spawn && H.spawn.allowed && H.spawn.allowed(), act: () => H.spawn.open({ panel: true }), icon: '➕', tap: 'Spawn' },
    { group: 'Do', keys: 'K', what: 'change how the thing you point at looks', when: canChange, act: changeLook, icon: '🎨', tap: 'Change look' },
    { group: 'Do', keys: 'L', what: 'change how you look (the mirror)', when: () => Boolean(H.mirror && H.mirror.dress) && !inVehicle() && Boolean(window.HawkesGuest), act: () => H.mirror.dress(), icon: '🪞', tap: 'My look' },
    { group: 'Do', keys: 'I', what: 'your bag', when: () => Boolean(H.items && Object.keys(H.items.bag).length), act: () => H.items.open('bag'), icon: '🎒', tap: 'Bag' },
    { group: 'Do', keys: 'B', what: 'emotes (hold)', when: () => Boolean(H.presence && H.presence.enabled && H.presence.enabled('emotes')), act: () => press('b', 400), icon: '😀', tap: 'Emotes' },
    { group: 'Do', keys: 'N', what: 'the journal', when: () => Boolean(document.querySelector('.jr-btn')), act: () => { const b = document.querySelector('.jr-btn'); if (b) b.click(); }, icon: '📖', tap: 'Journal' },
    { group: 'Do', keys: '', what: 'your quests', when: () => Boolean(H.touchUi && document.querySelector('.qs-btn')), act: () => { const b = document.querySelector('.qs-btn'); if (b) b.click(); }, icon: '📜', tap: 'Quests' },
    { group: 'Do', keys: 'R', what: 'stuck? back to safety', when: () => Boolean(document.querySelector('.tour-stuck')), act: () => { const b = document.querySelector('.tour-stuck'); if (b) b.click(); }, icon: '🛟', tap: 'Stuck?' },
    { group: 'Do', keys: 'Enter', what: 'talk (to the Overseer, or to everyone)', when: () => Boolean(H.chat), act: () => H.chat.open && H.chat.open(), icon: '💬', tap: 'Talk' },
    { group: 'Do', keys: 'Esc Esc', what: 'pause', when: () => H.mode === 'play' },
    { group: 'Building', keys: '1-9', what: 'put a new thing where you look', when: building },
    { group: 'Building', keys: 'Delete · C · Ctrl+Z', what: 'remove · copy · undo', when: building },
  ];
  const extra = [];
  /** A module's own lines (a tool, a mode): { group, keys, what, when, act, icon, tap }. Returns a remover. */
  function add(line) { if (!line || !line.what) return () => {}; extra.push(line); return () => { const i = extra.indexOf(line); if (i >= 0) extra.splice(i, 1); }; }
  /** What's showing now: the moment's own line (driving, a tool) first, then the rest that apply. */
  function current() {
    const out = [];
    const p = player(), c = p && p._controller;
    if (inVehicle()) { const v = G().vehicles.current; const title = (v.vehicle && v.vehicle.def && v.vehicle.def.title) || 'Vehicle'; out.push({ group: `Driving the ${title.toLowerCase()}`, keys: '', what: hintOf(v) }); }
    else if (c && c.def && c.def.title && c.name !== 'walk') out.push({ group: 'Now', keys: '', what: c.def.title });
    const held = H.tools && H.tools.held;
    if (held && held.def && held.def.title) out.push({ group: 'In your hands', keys: '', what: held.def.title });
    for (const l of [...extra, ...LINES]) if (has(l.when || (() => true))) out.push(l);
    return out;
  }
  function hintOf(v) {
    try { const t = H.vehicles && H.vehicles.hintFor ? H.vehicles.hintFor(v.vehicle.def) : null; if (t) return t; } catch { /* fine */ }
    return 'W/S go and stop, A/D steer, E gets out';
  }
  /** Presses a key for the game (a phone's button doing what the key does). */
  function press(k, ms = 90) {
    const b = document.createElement('button');
    H.bindTouchKey(b, k);
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    setTimeout(() => b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })), ms);
  }

  // ------------------------------------------------------------------ the button and the panel
  const ui = { btn: null, panel: null, open: false };
  function make() {
    const css = document.createElement('style');
    css.textContent = `
      .ct-btn { position: fixed; left: max(12px, env(safe-area-inset-left)); bottom: max(96px, calc(env(safe-area-inset-bottom) + 88px)); z-index: 24; min-height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.18); background: rgba(10,14,24,.72); color: #e8ecf6; font: 600 13px/1 system-ui, sans-serif; cursor: pointer; backdrop-filter: blur(8px); display: inline-flex; align-items: center; gap: 6px; }
      .ct-btn[hidden], .ct-panel[hidden] { display: none !important; }
      .ct-btn kbd { font: 700 11px system-ui; background: rgba(255,255,255,.16); border-radius: 4px; padding: 1px 6px; }
      .ct-panel { position: fixed; z-index: 45; left: max(12px, env(safe-area-inset-left)); bottom: max(140px, calc(env(safe-area-inset-bottom) + 132px)); width: min(380px, calc(100vw - 24px)); max-height: calc(100vh - 180px); overflow: auto; background: rgba(8,12,22,.95); border: 1px solid rgba(255,255,255,.15); border-radius: 14px; padding: 12px 14px; color: #e8eef7; font: 500 13px/1.35 system-ui, sans-serif; }
      .ct-panel h4 { margin: 10px 0 4px; font: 700 11px/1 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #93a4c4; }
      .ct-panel h4:first-child { margin-top: 0; }
      .ct-row { display: grid; grid-template-columns: minmax(64px, auto) 1fr; gap: 10px; padding: 3px 0; align-items: baseline; }
      .ct-row.wide { grid-template-columns: 1fr; color: #cfe3ff; }
      .ct-row kbd { justify-self: start; font: 700 11.5px system-ui; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.14); border-radius: 6px; padding: 2px 7px; white-space: nowrap; }
      /* phones: a sheet from the bottom, big buttons that do the thing */
      body.tl .ct-btn { position: static; min-width: 48px; min-height: 48px; padding: 0 12px; border-radius: 12px; font-size: 13px; }
      body.tl .ct-panel { left: 0; right: 0; bottom: 0; width: auto; max-height: 72vh; border-radius: 18px 18px 0 0; padding: 14px 14px max(16px, env(safe-area-inset-bottom)); z-index: 60; }
      .ct-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; margin: 6px 0 12px; }
      .ct-grid button { min-height: 72px; border-radius: 14px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: inherit; font: 600 13px/1.2 system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; cursor: pointer; touch-action: manipulation; }
      .ct-grid button b { font-size: 24px; line-height: 1; }
      .ct-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
      .ct-head strong { font: 700 15px system-ui, sans-serif; }
      .ct-head button { min-width: 44px; min-height: 44px; border: 0; background: none; color: #cbd5e1; font-size: 20px; cursor: pointer; }
      .ct-how { color: #b6c2d9; font-size: 13px; line-height: 1.45; }`;
    document.head.appendChild(css);
    ui.btn = document.createElement('button');
    ui.btn.type = 'button'; ui.btn.className = 'ct-btn'; ui.btn.setAttribute('aria-label', 'Controls');
    ui.panel = document.createElement('div');
    ui.panel.className = 'ct-panel'; ui.panel.hidden = true; ui.panel.setAttribute('role', 'dialog'); ui.panel.setAttribute('aria-label', 'Controls');
    for (const el of [ui.btn, ui.panel]) { el.addEventListener('pointerdown', (e) => e.stopPropagation()); for (const t of ['keydown', 'keyup']) el.addEventListener(t, (e) => e.stopPropagation()); document.body.appendChild(el); }
    ui.btn.onclick = () => toggle();
    ui.panel.onclick = (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (!b) return;
      if (b.dataset.close) return toggle(false);
      const l = current().find((x) => x.tap && x.tap === b.dataset.act);
      if (l && l.act) { toggle(false); try { l.act(); } catch (err) { H.report(err, 'controls'); } }
    };
  }
  function toggle(on = !ui.open) { ui.open = on; render(); }
  function render() {
    if (!ui.btn) make();
    const show = Boolean(W()) && !(H.share && H.share.photo && H.share.photo.on) && !document.body.dataset.gsSheet;
    ui.btn.hidden = !show;
    const phone = Boolean(H.touchUi);
    const label = phone ? '🎮 Controls' : '<kbd>?</kbd> Controls';
    if (ui.btn.innerHTML !== label) ui.btn.innerHTML = label;
    ui.panel.hidden = !(show && ui.open);
    if (ui.panel.hidden) return;
    const lines = current();
    if (phone) {
      const acts = lines.filter((l) => l.tap && l.act);
      const now = lines.filter((l) => !l.keys && l.what);
      ui.panel.innerHTML = `<div class="ct-head"><strong>Controls</strong><button type="button" data-close="1" aria-label="Close">✕</button></div>
        ${acts.length ? `<div class="ct-grid">${acts.map((l) => `<button type="button" data-act="${esc(l.tap)}"><b>${l.icon || '•'}</b>${esc(l.tap)}</button>`).join('')}</div>` : ''}
        <div class="ct-how">${now.map((l) => `<div><b>${esc(l.group)}:</b> ${esc(l.what)}</div>`).join('')}<div>The stick on the left moves you; drag anywhere else to look around. The round buttons jump and act; a button with a word on it appears when there's something to use.</div></div>`;
      return;
    }
    let h = '', group = '';
    for (const l of lines) {
      if (l.group !== group) { group = l.group; h += `<h4>${esc(group)}</h4>`; }
      h += l.keys ? `<div class="ct-row"><kbd>${esc(l.keys)}</kbd><span>${esc(l.what)}</span></div>` : `<div class="ct-row wide">${esc(l.what)}</div>`;
    }
    ui.panel.innerHTML = h;
  }

  // ------------------------------------------------------------------ keys: ? (or /) opens the list; K changes a look
  const typing = (e) => { const t = e.target; return t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)); };
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(e) || !W()) return;
    if (document.querySelector('.ui-menu-wrap, .ui-popup-wrap') || (H.looks && H.looks.isOpen)) return;
    const k = String(e.key || '').toLowerCase();
    if (k === '?' || (k === '/' && !e.shiftKey)) { e.preventDefault(); toggle(); return; }
    if (k === 'escape' && ui.open) { toggle(false); e.stopPropagation(); return; }
    if (k === 'k' && canChange()) changeLook();
  });
  let t = 0;
  H.hooks.frame.push((dt) => { t -= dt; if (t > 0) return; t = 0.4; render(); });
  H.hooks.world.push({ leave() { ui.open = false; } });

  const api = { add, open: () => toggle(true), close: () => toggle(false), list: () => current().map((l) => ({ group: l.group, keys: l.keys, what: l.what, tap: l.tap || null })), changeLook, target };
  H.controls = api;
  H.hooks.game.push((game) => { game.controls = api; });
})();
