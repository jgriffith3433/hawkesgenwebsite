// Game menu (J, 2026-11-11): one Esc or one tap on the phone HUD's ☰ opens a Fortnite-style pause sheet with
 // Resume, Settings, Journal, Controls, Invite a friend, Change my look, Leave to Hawkes Games. Settings apply at once
 // and persist per device. Animates 150–250 ms (scale + fade) with ui-panel / ui-pickup; prefers-reduced-motion is
 // respected. The world pauses only for a guest alone. Laid out in hudlayout's menu zone ([data-game-menu]).
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.gameMenu) return;

  const KEY = 'hg_game_settings';
  const OPEN_MS = 200;
  const CLOSE_MS = 180;
  const CAPTION_PX = { sm: 13, md: 15, lg: 18 };
  const GRAPHICS = ['auto', 'low', 'medium', 'high'];
  const DEFAULTS = {
    master: 1, music: 1, effects: 1, voice: 1,
    captions: true, captionSize: 'md',
    graphics: 'auto', sensitivity: 1, invertY: false, view: 'third',
  };

  const clamp01 = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d; };
  const store = {
    get() { try { return window.localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { window.localStorage.setItem(KEY, v); } catch { /* sandboxed */ } },
  };
  const reduced = () => { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const typing = (e) => { const t = e && e.target; return t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)); };
  const alone = () => {
    try {
      if (!window.HawkesNet || !HawkesNet.online) return true;
      const p = HawkesNet.peers && HawkesNet.peers();
      return !(p && p.size > 0);
    } catch { return true; }
  };
  const isGuest = () => {
    try {
      if (window.HawkesGuest && HawkesGuest.user) return false;
      if (window.HawkesSession && HawkesSession.user) return false;
    } catch { /* fine */ }
    return true;
  };
  const shouldPause = () => isGuest() && alone();

  const settings = { ...DEFAULTS };
  function load() {
    let m = {};
    try { m = JSON.parse(store.get() || '{}') || {}; } catch { m = {}; }
    settings.master = clamp01(m.master, 1);
    settings.music = clamp01(m.music, 1);
    settings.effects = clamp01(m.effects, 1);
    settings.voice = clamp01(m.voice, 1);
    settings.captions = m.captions !== false;
    settings.captionSize = CAPTION_PX[m.captionSize] ? m.captionSize : 'md';
    settings.graphics = GRAPHICS.includes(m.graphics) ? m.graphics : 'auto';
    settings.sensitivity = Number.isFinite(Number(m.sensitivity)) ? Math.max(0.25, Math.min(2, Number(m.sensitivity))) : 1;
    settings.invertY = Boolean(m.invertY);
    settings.view = m.view === 'first' ? 'first' : 'third';
  }
  function save() { store.set(JSON.stringify(settings)); }
  function applyAudio() {
    if (!H.audio) return;
    try {
      H.audio.volume = settings.master;
      H.audio.musicVolume = settings.music;
      H.audio.effectsVolume = settings.effects;
      H.audio.voiceVolume = settings.voice;
    } catch { /* no audio yet */ }
  }
  function applyCaptions() {
    try {
      document.documentElement.style.setProperty('--hc-caption', `${CAPTION_PX[settings.captionSize] || 15}px`);
      document.documentElement.dataset.captions = settings.captions ? 'on' : 'off';
    } catch { /* fine */ }
    if (H.speech && H.speech.set) {
      try { H.speech.set({ captions: settings.captions, voice: settings.voice, music: settings.music }); } catch { /* fine */ }
    }
  }
  function applyGraphics() {
    if (H.setQuality) try { H.setQuality(settings.graphics); } catch { /* fine */ }
  }
  function applyView() {
    const w = H.world, p = w && w.player;
    if (!p || typeof p.view === 'undefined') return;
    try { if (p.view !== settings.view) p.view = settings.view; } catch { /* fine */ }
  }
  function applyAll() { applyAudio(); applyCaptions(); applyGraphics(); applyView(); }

  load();
  applyAll();

  const ui = { wrap: null, panel: null, page: 'root', open: false, focus: 0, paused: false, closing: false, extras: [] };
  let styleEl = null;

  function style() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.id = 'gm-style';
    styleEl.textContent = `
      .gm-wrap{position:fixed;inset:0;z-index:80;display:grid;place-items:center;pointer-events:auto;background:rgba(5,8,16,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity ${OPEN_MS}ms ease}
      .gm-wrap.on{opacity:1}
      .gm-wrap.off{opacity:0;transition-duration:${CLOSE_MS}ms}
      .gm-panel{width:min(420px,calc(100vw - 24px));max-height:min(92vh,720px);overflow:auto;padding:22px 20px;border-radius:16px;background:rgba(8,12,22,.94);border:1px solid rgba(140,200,255,.28);box-shadow:0 24px 70px rgba(0,0,0,.55);color:#e8eef7;font:600 15px/1.35 var(--hud,system-ui,sans-serif);transform:scale(.94);opacity:0;transition:transform ${OPEN_MS}ms ease,opacity ${OPEN_MS}ms ease;transform-origin:center}
      .gm-wrap.on .gm-panel{transform:scale(1);opacity:1}
      .gm-wrap.off .gm-panel{transform:scale(.96);opacity:0;transition-duration:${CLOSE_MS}ms}
      .gm-title{font:700 22px/1.1 var(--hud,system-ui,sans-serif);letter-spacing:.04em;margin:0 0 14px;color:#f3f7ff}
      .gm-sub{font:700 12px/1 var(--hud,system-ui,sans-serif);letter-spacing:.14em;text-transform:uppercase;color:#7cc8ff;margin:0 0 12px}
      .gm-list{display:grid;gap:8px}
      .gm-btn{appearance:none;width:100%;text-align:left;min-height:48px;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:inherit;font:700 15px/1.2 var(--hud,system-ui,sans-serif);cursor:pointer;touch-action:manipulation}
      .gm-btn:hover,.gm-btn:focus-visible,.gm-btn.on{outline:none;border-color:#4a9eff;background:rgba(74,158,255,.16);box-shadow:0 0 0 3px rgba(74,158,255,.35)}
      .gm-btn.primary{background:linear-gradient(90deg,#4a9eff,#a855f7);border-color:transparent;color:#fff}
      .gm-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:6px 2px}
      .gm-row label{flex:1;font:600 14px/1.3 var(--hud,system-ui,sans-serif)}
      .gm-row input[type=range]{width:min(160px,42vw)}
      .gm-row select,.gm-toggle{min-height:40px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e8eef7;font:600 13px var(--hud,system-ui,sans-serif);padding:0 10px}
      .gm-keys{display:grid;gap:8px;margin-top:4px}
      .gm-key{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.08)}
      .gm-key:last-child{border-bottom:0}
      .gm-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:36px;min-height:36px;padding:4px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.1);font:700 12px/1 system-ui,sans-serif;box-shadow:inset 0 -2px 0 rgba(0,0,0,.25)}
      .gm-touch{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px;margin-top:10px}
      .gm-touch i{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:72px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);font:600 12px/1.2 var(--hud,system-ui,sans-serif);font-style:normal}
      .gm-touch i b{font-size:22px;line-height:1}
      .gm-back{margin-bottom:10px}
      @media (max-width:759px),(max-height:499px){
        .gm-wrap{place-items:stretch;align-items:stretch}
        .gm-panel{width:auto;max-width:none;max-height:none;height:100%;min-height:100%;border-radius:0;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));transform:translateY(12px) scale(1)}
        .gm-wrap.on .gm-panel{transform:translateY(0)}
        .gm-wrap.off .gm-panel{transform:translateY(8px)}
        .gm-btn,.gm-row{min-height:52px}
      }
      /* Thumb-sized sliders on a phone (the mix's music, voice, effects): a 44 px thumb on a 48 px row. */
      @media (max-width:759px),(max-height:499px),(pointer:coarse){
        .gm-row input[type=range]{-webkit-appearance:none;appearance:none;width:min(240px,54vw);height:48px;margin:0;background:transparent;touch-action:pan-y}
        .gm-row input[type=range]::-webkit-slider-runnable-track{height:8px;border-radius:4px;background:rgba(255,255,255,.24)}
        .gm-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:44px;height:44px;margin-top:-18px;border-radius:50%;background:#4a9eff;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45)}
        .gm-row input[type=range]::-moz-range-track{height:8px;border-radius:4px;background:rgba(255,255,255,.24)}
        .gm-row input[type=range]::-moz-range-thumb{width:40px;height:40px;border-radius:50%;background:#4a9eff;border:3px solid #fff}
      }
      @media (prefers-reduced-motion:reduce){
        .gm-wrap,.gm-panel{transition:none!important;transform:none!important}
      }
      .hc-log{font-size:var(--hc-caption,15px)}
    `;
    document.head.appendChild(styleEl);
  }

  function sfx(name) {
    try {
      if (H.soundscape && H.soundscape.ui) H.soundscape.ui(name);
      else if (H.lib && H.lib.siteSound) H.lib.siteSound(`ui-${name}`, { rate: 0.97 + Math.random() * 0.06 });
    } catch { /* fine */ }
  }
  function emit(open, page) {
    try { if (H.game && H.game.emit) H.game.emit('menu', { open, page: page || ui.page }); } catch { /* fine */ }
  }

  function focusables() {
    if (!ui.panel) return [];
    return [...ui.panel.querySelectorAll('button.gm-btn, input, select')].filter((el) => !el.disabled && el.offsetParent !== null);
  }
  function setFocus(i) {
    const list = focusables();
    if (!list.length) return;
    ui.focus = ((i % list.length) + list.length) % list.length;
    list.forEach((el, n) => el.classList.toggle('on', n === ui.focus && el.tagName === 'BUTTON'));
    const el = list[ui.focus];
    if (el) try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch { /* fine */ } }
  }

  function rootItems() {
    const items = [
      { id: 'resume', label: 'Resume', primary: true, act: () => close() },
      { id: 'settings', label: 'Settings', act: () => showPage('settings') },
      { id: 'journal', label: 'Journal', act: () => { close(); openJournal(); } },
      { id: 'controls', label: 'Controls', act: () => showPage('controls') },
      { id: 'invite', label: 'Invite a friend', act: () => { close(); doInvite(); } },
      { id: 'look', label: 'Change my look', act: () => { close(); doLook(); } },
      { id: 'leave', label: 'Leave to Hawkes Games', act: () => { close(); leaveSite(); } },
    ];
    for (const x of ui.extras) {
      if (!x || !x.label) continue;
      const at = Math.max(1, Math.min(items.length - 1, Number(x.at) || items.length - 1));
      items.splice(at, 0, { id: x.id || x.label, label: x.label, act: () => { close(); try { x.onClick && x.onClick(); } catch (err) { H.report(err, 'gamemenu'); } } });
    }
    // Observatory / report extras registered by play.html.
    try {
      if (window.HawkesObservatoryReturn && !items.some((i) => i.id === 'obs-return')) {
        items.splice(items.length - 1, 0, { id: 'obs-return', label: 'Return to the Observatory', act: () => { close(); window.HawkesObservatoryReturn(); } });
      }
      if (window.HawkesReport && window.HawkesReport.reasons && !items.some((i) => i.id === 'report')) {
        items.splice(items.length - 1, 0, { id: 'report', label: 'Report this world', act: () => { close(); window.HawkesReport.reasons(); } });
      }
    } catch { /* fine */ }
    return items;
  }

  function openJournal() {
    try {
      const b = document.querySelector('.jr-btn');
      if (b) { b.click(); return; }
      if (H.controls) {
        const line = H.controls.list && H.controls.list().find((l) => /journal/i.test(l.what || ''));
        if (line && line.act) { line.act(); return; }
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    } catch (err) { H.report(err, 'gamemenu'); }
  }
  function doInvite() {
    try {
      if (window.HawkesGuest && typeof HawkesGuest.invite === 'function') { HawkesGuest.invite('menu'); return; }
      const b = document.querySelector('.gs-acts [data-intent="invite"]');
      if (b) b.click();
    } catch (err) { H.report(err, 'gamemenu'); }
  }
  function doLook() {
    try {
      if (H.mirror && H.mirror.dress) { H.mirror.dress(); return; }
      if (window.HawkesGuest && typeof HawkesGuest.look === 'function') HawkesGuest.look();
    } catch (err) { H.report(err, 'gamemenu'); }
  }
  function leaveSite() {
    try { location.href = '/'; } catch { /* fine */ }
  }

  function setField(k, v) {
    if (k === 'master' || k === 'music' || k === 'effects' || k === 'voice') settings[k] = clamp01(v, settings[k]);
    else if (k === 'captions') settings.captions = Boolean(v);
    else if (k === 'captionSize') settings.captionSize = CAPTION_PX[v] ? v : settings.captionSize;
    else if (k === 'graphics') settings.graphics = GRAPHICS.includes(v) ? v : settings.graphics;
    else if (k === 'sensitivity') settings.sensitivity = Math.max(0.25, Math.min(2, Number(v) || 1));
    else if (k === 'invertY') settings.invertY = Boolean(v);
    else if (k === 'view') settings.view = v === 'first' ? 'first' : 'third';
    else return;
    save();
    applyAll();
  }

  function settingsHtml() {
    const S = settings;
    const pct = (n) => Math.round(clamp01(n, 1) * 100);
    return `
      <button type="button" class="gm-btn gm-back" data-act="back">← Back</button>
      <div class="gm-sub">Settings</div>
      <div class="gm-row"><label for="gm-master">Master</label><input id="gm-master" type="range" min="0" max="100" value="${pct(S.master)}" data-s="master" aria-label="Master volume"></div>
      <div class="gm-row"><label for="gm-music">Music</label><input id="gm-music" type="range" min="0" max="100" value="${pct(S.music)}" data-s="music" aria-label="Music volume"></div>
      <div class="gm-row"><label for="gm-effects">Effects</label><input id="gm-effects" type="range" min="0" max="100" value="${pct(S.effects)}" data-s="effects" aria-label="Effects volume"></div>
      <div class="gm-row"><label for="gm-voice">Voice</label><input id="gm-voice" type="range" min="0" max="100" value="${pct(S.voice)}" data-s="voice" aria-label="Voice volume"></div>
      <div class="gm-row"><label for="gm-captions">Captions</label><input id="gm-captions" class="gm-toggle" type="checkbox" data-s="captions" ${S.captions ? 'checked' : ''} aria-label="Captions on or off"></div>
      <div class="gm-row"><label for="gm-capsize">Caption size</label><select id="gm-capsize" data-s="captionSize" aria-label="Caption size"><option value="sm" ${S.captionSize === 'sm' ? 'selected' : ''}>Small</option><option value="md" ${S.captionSize === 'md' ? 'selected' : ''}>Medium</option><option value="lg" ${S.captionSize === 'lg' ? 'selected' : ''}>Large</option></select></div>
      <div class="gm-row"><label for="gm-graphics">Graphics</label><select id="gm-graphics" data-s="graphics" aria-label="Graphics quality"><option value="auto" ${S.graphics === 'auto' ? 'selected' : ''}>Auto</option><option value="low" ${S.graphics === 'low' ? 'selected' : ''}>Low</option><option value="medium" ${S.graphics === 'medium' ? 'selected' : ''}>Medium</option><option value="high" ${S.graphics === 'high' ? 'selected' : ''}>High</option></select></div>
      <div class="gm-row"><label for="gm-sens">Camera sensitivity</label><input id="gm-sens" type="range" min="25" max="200" value="${Math.round(S.sensitivity * 100)}" data-s="sensitivity" aria-label="Camera sensitivity"></div>
      <div class="gm-row"><label for="gm-invert">Invert Y</label><input id="gm-invert" class="gm-toggle" type="checkbox" data-s="invertY" ${S.invertY ? 'checked' : ''} aria-label="Invert look up and down"></div>
      <div class="gm-row"><label for="gm-view">Camera</label><select id="gm-view" data-s="view" aria-label="First or third person"><option value="third" ${S.view === 'third' ? 'selected' : ''}>Third person</option><option value="first" ${S.view === 'first' ? 'selected' : ''}>First person</option></select></div>
    `;
  }

  function controlsHtml() {
    const phone = Boolean(H.touchUi) || (document.body && document.body.classList.contains('tl'));
    const lines = (H.controls && H.controls.list) ? H.controls.list() : [];
    const keys = lines.filter((l) => l.keys).map((l) => {
      const bits = String(l.keys).split(/[·•]/).map((s) => s.trim()).filter(Boolean);
      const kbd = bits.length ? bits.map((k) => k.split(/\s+/).map((p) => `<span class="gm-kbd">${esc(p)}</span>`).join(' ')).join(' ') : '<span class="gm-kbd">—</span>';
      return `<div class="gm-key">${kbd}<span>${esc(l.what)}</span></div>`;
    }).join('');
    const touch = `
      <div class="gm-touch">
        <i><b>○</b>Left stick — walk</i><i><b>↔</b>Drag right — look</i><i><b>A</b>Jump</i>
        <i><b>B</b>Act / get in</i><i><b>☰</b>This menu</i><i><b>E</b>Use nearby</i>
      </div>`;
    return `
      <button type="button" class="gm-btn gm-back" data-act="back">← Back</button>
      <div class="gm-sub">Controls</div>
      <div class="gm-keys">${keys || '<div class="gm-key"><span class="gm-kbd">Esc</span><span>open and close this menu</span></div>'}</div>
      ${phone || true ? `<div class="gm-sub" style="margin-top:16px">Touch</div>${touch}` : ''}
    `;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function render() {
    if (!ui.panel) return;
    if (ui.page === 'settings') {
      ui.panel.innerHTML = `<h2 class="gm-title">${esc(menuTitle())}</h2>${settingsHtml()}`;
      bindSettings();
    } else if (ui.page === 'controls') {
      ui.panel.innerHTML = `<h2 class="gm-title">${esc(menuTitle())}</h2>${controlsHtml()}`;
      bindNav();
    } else {
      const items = rootItems();
      ui.panel.innerHTML = `<h2 class="gm-title">${esc(menuTitle())}</h2><div class="gm-list">${items.map((it) => `<button type="button" class="gm-btn${it.primary ? ' primary' : ''}" data-id="${esc(it.id)}">${esc(it.label)}</button>`).join('')}</div>`;
      ui.panel.querySelectorAll('[data-id]').forEach((btn) => {
        const it = items.find((x) => x.id === btn.dataset.id);
        btn.onclick = () => { if (it && it.act) it.act(); };
      });
    }
    setTimeout(() => setFocus(0), 0);
  }
  function bindNav() {
    const back = ui.panel.querySelector('[data-act=back]');
    if (back) back.onclick = () => showPage('root');
  }
  function bindSettings() {
    bindNav();
    ui.panel.addEventListener('input', onSetting);
    ui.panel.addEventListener('change', onSetting);
  }
  function onSetting(e) {
    const el = e.target, k = el && el.dataset && el.dataset.s;
    if (!k) return;
    if (k === 'captions' || k === 'invertY') setField(k, el.checked);
    else if (k === 'captionSize' || k === 'graphics' || k === 'view') setField(k, el.value);
    else if (k === 'sensitivity') setField(k, Number(el.value) / 100);
    else setField(k, Number(el.value) / 100);
  }

  function showPage(page) {
    ui.page = page || 'root';
    render();
    emit(true, ui.page);
  }

  function menuTitle() {
    // Only say "Paused" when the world actually froze (guest alone); otherwise the island is still alive.
    return ui.paused ? 'Paused' : 'Menu';
  }

  function ensure() {
    style();
    if (ui.wrap) return;
    ui.wrap = document.createElement('div');
    ui.wrap.className = 'gm-wrap';
    ui.wrap.hidden = true;
    ui.wrap.setAttribute('data-game-menu', '1');
    ui.wrap.setAttribute('role', 'dialog');
    ui.wrap.setAttribute('aria-modal', 'true');
    ui.wrap.setAttribute('aria-label', 'Game menu');
    ui.panel = document.createElement('div');
    ui.panel.className = 'gm-panel';
    ui.wrap.appendChild(ui.panel);
    ui.wrap.addEventListener('pointerdown', (e) => {
      if (e.target === ui.wrap) close();
      e.stopPropagation();
    });
    for (const t of ['keydown', 'keyup']) ui.wrap.addEventListener(t, (e) => e.stopPropagation());
    document.body.appendChild(ui.wrap);
  }

  function open(page) {
    if (ui.open || ui.closing) { if (page) showPage(page); return api; }
    ensure();
    ui.open = true;
    ui.page = page || 'root';
    ui.wrap.hidden = false;
    ui.wrap.classList.remove('off');
    void ui.wrap.offsetWidth;
    ui.wrap.classList.add('on');
    ui.paused = shouldPause();
    if (ui.paused && H.world) H.world.paused = true;
    if (document.pointerLockElement) try { document.exitPointerLock(); } catch { /* fine */ }
    // Close the phone actions fold if it was open.
    for (const a of document.querySelectorAll('.gs-acts.open')) a.classList.remove('open');
    render();
    sfx('panel');
    emit(true, ui.page);
    return api;
  }

  function close() {
    if (!ui.open || ui.closing) return api;
    ui.closing = true;
    sfx('pickup');
    const ms = reduced() ? 0 : CLOSE_MS;
    ui.wrap.classList.remove('on');
    ui.wrap.classList.add('off');
    const finish = () => {
      ui.open = false;
      ui.closing = false;
      ui.page = 'root';
      if (ui.wrap) { ui.wrap.hidden = true; ui.wrap.classList.remove('off'); }
      if (ui.paused && H.world) H.world.paused = false;
      ui.paused = false;
      emit(false, 'root');
    };
    if (ms <= 0) finish();
    else setTimeout(finish, ms);
    return api;
  }

  function toggle(page) {
    if (ui.open) return close();
    return open(page);
  }

  // Esc toggles; arrows / gamepad move the focus ring.
  window.addEventListener('keydown', (e) => {
    if (e.repeat || typing(e)) return;
    if (document.body && document.body.dataset.gsSheet) return;
    if (H.looks && H.looks.isOpen) return;
    const reportOpen = document.querySelector('#reportBox:not([hidden])');
    const oldMenu = document.querySelector('.ui-menu-wrap, .ui-popup-wrap');
    const mirrorOpen = (() => {
      const m = document.querySelector('.mr');
      if (!m || m.hidden) return false;
      const cs = getComputedStyle(m);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = m.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    })();
    if (reportOpen || oldMenu || mirrorOpen) {
      // An older engine menu, the report dialog or the mirror owns Esc; leave it alone while those are up.
      if (e.key === 'Escape' && ui.open) { e.preventDefault(); e.stopPropagation(); close(); }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      toggle();
      return;
    }
    if (!ui.open) return;
    const list = focusables();
    if (!list.length) return;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { e.preventDefault(); setFocus(ui.focus + 1); }
    else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { e.preventDefault(); setFocus(ui.focus - 1); }
    else if (e.key === 'Enter' || e.key === ' ') {
      const el = list[ui.focus];
      if (el && el.tagName === 'BUTTON') { e.preventDefault(); el.click(); }
    }
  }, true);

  // Phone HUD ☰: open the game menu instead of (only) folding Save/Build.
  function wirePhoneButton() {
    const btn = document.querySelector('.gs-acts .more, .gs-acts [data-menu]');
    if (!btn || btn.dataset.gmWired) return;
    btn.dataset.gmWired = '1';
    btn.setAttribute('aria-label', 'Menu');
    btn.title = 'Menu';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }, true);
  }

  // Chat gear opens Settings.
  function wireChatGear() {
    const gear = document.querySelector('.hc-gear');
    if (!gear || gear.dataset.gmWired) return;
    gear.dataset.gmWired = '1';
    gear.title = 'Settings';
    gear.setAttribute('aria-label', 'Settings');
    gear.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const panel = document.querySelector('.hc-panel');
      if (panel) panel.hidden = true;
      const tools = document.querySelector('.hc-tools');
      if (tools) tools.classList.remove('open');
      open('settings');
    }, true);
  }

  function watchDom() {
    wirePhoneButton();
    wireChatGear();
  }
  if (typeof document !== 'undefined') {
    if (document.body) {
      watchDom();
      try { new MutationObserver(watchDom).observe(document.body, { childList: true, subtree: true }); } catch { /* fine */ }
    } else document.addEventListener('DOMContentLoaded', watchDom, { once: true });
  }

  H.hooks.world.push({
    enter() { applyAll(); watchDom(); },
    leave() { if (ui.open) close(); },
  });

  const api = {
    open, close, toggle,
    get openState() { return ui.open; },
    get page() { return ui.page; },
    get settings() { return { ...settings }; },
    set(part) { if (!part || typeof part !== 'object') return api; for (const k of Object.keys(part)) setField(k, part[k]); if (ui.open && ui.page === 'settings') render(); return api; },
    add(item) { if (item && item.label) ui.extras.push(item); return () => { const i = ui.extras.indexOf(item); if (i >= 0) ui.extras.splice(i, 1); }; },
    isOpen: () => ui.open,
  };
  H.gameMenu = api;
  H.hooks.game.push((game) => { game.menu = api; });
})();
