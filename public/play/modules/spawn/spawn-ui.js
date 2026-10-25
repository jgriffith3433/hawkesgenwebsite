// The spawn wheel's screens:
//   - desktop: hold Q for a radial wheel (type -> category -> asset): point with the mouse, click (or let go of Q) to go
//     in or spawn, Esc backs out a layer, the mouse wheel or 1-9 pick too, Shift (or holding the click) spawns ×10,
//     F stars a favorite, Tab opens the searchable panel ("cow")
//   - phones: the ➕ button opens a 3-step sheet with big tiles, back or swipe right between layers, a search field,
//     recent things; tap spawns, hold for ×10
//   - gamepad: D-pad up opens the wheel, the left stick picks, A goes in or spawns, X spawns ×10, B backs out
// A tap of Q (shorter than a hold) still switches Mayhem's tools while playing.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const S = H.spawn;
  const W = () => H.world;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const phone = () => Boolean(H.touchUi);
  const HOLD_Q = 220; // ms: a longer press of Q opens the wheel (shorter is a tap)
  const HOLD_MANY = 600; // ms: holding a tile (or the click) this long spawns ×10
  const PAGE = 10;

  // ------------------------------------------------------------------ styles
  const CSS = `
.sw-wheel{position:fixed;inset:0;z-index:40;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;background:radial-gradient(circle at 50% 50%,rgba(6,10,22,0) 0,rgba(6,10,22,0) 90px,rgba(6,10,22,.5) 92px,rgba(6,10,22,.18) 70%);user-select:none;-webkit-user-select:none;touch-action:none}
.sw-wheel[hidden],.sw-sheet[hidden],.sw-fab[hidden]{display:none}
.sw-ring{position:absolute;left:50%;top:50%;width:0;height:0}
.sw-seg{position:absolute;width:84px;height:84px;margin:-42px 0 0 -42px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:rgba(12,18,34,.82);border:1.5px solid rgba(255,255,255,.16);box-shadow:0 4px 16px rgba(0,0,0,.35);transition:transform .08s,background .08s,border-color .08s;cursor:pointer}
.sw-seg .ic{font-size:28px;line-height:1;height:32px;display:flex;align-items:center}
.sw-seg .ic img{width:40px;height:40px;object-fit:cover;border-radius:8px}
.sw-seg .lb{font:600 10.5px/1.15 system-ui,sans-serif;max-width:76px;text-align:center;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;text-shadow:0 1px 2px #000}
.sw-seg .n{position:absolute;top:-4px;left:-4px;width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.14);font:700 10px/18px system-ui;text-align:center;color:#cfe3ff}
.sw-seg .st{position:absolute;top:-3px;right:-2px;font-size:13px;color:#ffd166}
.sw-seg.hot{transform:scale(1.18);background:rgba(40,80,150,.92);border-color:#7dd3fc;z-index:2}
.sw-seg.lib{border-style:dashed}
.sw-seg .many{position:absolute;inset:-5px;border-radius:50%;border:3px solid transparent;border-top-color:#ffd166;opacity:0}
.sw-seg.charging .many{opacity:1;animation:sw-spin .6s linear}
.sw-seg.ten .many{opacity:1;border-color:#ffd166}
@keyframes sw-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.sw-mid{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:170px;text-align:center;pointer-events:none}
.sw-mid .crumb{font:700 10px/1.2 system-ui;letter-spacing:.14em;text-transform:uppercase;color:#9fc4ff;margin-bottom:4px}
.sw-mid .name{font:800 17px/1.2 system-ui;text-shadow:0 2px 6px #000;min-height:21px}
.sw-mid .sub{font:500 11.5px/1.3 system-ui;color:#c9d6f0;margin-top:3px;text-shadow:0 1px 3px #000;min-height:15px}
.sw-cursor{position:absolute;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:#7dd3fc;box-shadow:0 0 8px #7dd3fc;pointer-events:none}
.sw-keys{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);font:600 12px/1.4 system-ui;color:#dbe7ff;background:rgba(8,12,24,.7);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:6px 12px;white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis}
.sw-keys kbd{font:700 11px system-ui;background:rgba(255,255,255,.14);border-radius:4px;padding:1px 5px;margin:0 2px}
.sw-sheet{position:fixed;z-index:41;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,calc(100vw - 24px));height:min(560px,calc(100vh - 40px));display:flex;flex-direction:column;background:rgba(12,16,28,.96);color:#eef2ff;border:1px solid rgba(255,255,255,.16);border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.55);font:14px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.sw-sheet.phone{left:0;right:0;top:auto;bottom:0;transform:none;width:auto;height:min(62vh,560px);border-radius:20px 20px 0 0;padding:0 env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}
.sw-sheet.phone .sw-head button{min-width:48px;min-height:48px}
.sw-sheet.phone .sw-tile .fav{width:48px;height:48px;top:0;right:0}
@media (orientation:landscape) and (max-height:500px){.sw-sheet.phone{height:min(86vh,560px)}.sw-sheet.phone .sw-grid{grid-template-columns:repeat(5,1fr)}}
.sw-head{display:flex;align-items:center;gap:8px;padding:10px 12px 6px}
.sw-head b{flex:1;font-size:17px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sw-head button{font:700 15px system-ui;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:10px;min-width:44px;min-height:40px;cursor:pointer;touch-action:manipulation}
.sw-head button[hidden]{display:none}
.sw-grab{width:44px;height:5px;border-radius:3px;background:rgba(255,255,255,.25);margin:8px auto 0}
.sw-sheet:not(.phone) .sw-grab{display:none}
.sw-find{display:flex;padding:0 12px 8px}
.sw-find input{flex:1;min-width:0;font:16px system-ui;color:#fff;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:10px 12px;outline:none}
.sw-find input:focus{border-color:#7dd3fc}
.sw-body{flex:1;overflow:auto;padding:4px 12px 14px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent;overscroll-behavior:contain}
.sw-body h4{margin:10px 2px 6px;font:700 11px/1 system-ui;letter-spacing:.12em;text-transform:uppercase;color:#9fb0d0}
.sw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}
.sw-sheet.phone .sw-grid{grid-template-columns:repeat(3,1fr)}
.sw-row{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
.sw-row .sw-tile{flex:0 0 96px}
.sw-tile{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:100px;padding:10px 6px;border-radius:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;font:600 12.5px/1.2 system-ui;text-align:center}
.sw-tile:hover,.sw-tile.hot{background:rgba(60,110,200,.35);border-color:#7dd3fc}
.sw-tile .ic{font-size:34px;line-height:1;height:42px;display:flex;align-items:center}
.sw-tile .ic img{width:52px;height:52px;object-fit:cover;border-radius:10px}
.sw-tile .lb{max-width:100%;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.sw-tile small{font:500 10.5px system-ui;opacity:.6}
.sw-tile.lib{border-style:dashed}
.sw-tile .fav{position:absolute;top:2px;right:2px;width:30px;height:30px;border:0;background:none;color:#ffd166;font-size:16px;cursor:pointer;opacity:.75}
.sw-tile .many{position:absolute;left:8px;right:8px;bottom:5px;height:3px;border-radius:2px;background:#ffd166;transform:scaleX(0);transform-origin:left}
.sw-tile.charging .many{transition:transform .6s linear;transform:scaleX(1)}
.sw-empty{padding:20px 6px;color:#9fb0d0;text-align:center}
.sw-fab{position:fixed;right:12px;top:40%;z-index:8;width:58px;height:58px;border-radius:50%;font:300 34px/1 system-ui;color:#0b1020;background:#7dd3fc;border:0;box-shadow:0 6px 20px rgba(0,0,0,.4);cursor:pointer;touch-action:manipulation;display:flex;align-items:center;justify-content:center}
.sw-fab.desk{width:auto;height:34px;border-radius:10px;padding:0 10px;font:600 12.5px system-ui;color:#fff;background:rgba(10,14,26,.7);border:1px solid rgba(255,255,255,.16);top:auto;bottom:96px;gap:6px}
.sw-fab.desk kbd{font:700 11px system-ui;background:rgba(255,255,255,.16);border-radius:4px;padding:1px 6px}
.sw-toast{position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:42;background:rgba(8,12,24,.85);color:#fff;font:600 14px system-ui;border-radius:10px;padding:8px 14px;pointer-events:none;opacity:0;transition:opacity .2s}
.sw-toast.on{opacity:1}`;
  let styled = false;
  function style() { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
  const make = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; document.body.appendChild(e); return e; };
  let toastEl = null, toastT = 0;
  function toast(text) {
    style();
    if (!toastEl) toastEl = make('div', 'sw-toast');
    toastEl.textContent = text; toastEl.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 1800);
  }
  S.toast = toast;
  const iconHtml = (e) => (e.thumb ? `<img src="${esc(e.thumb)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('${esc(e.icon || '◆')}'))">` : esc(e.icon || '◆'));

  // ------------------------------------------------------------------ the layers, as screens show them
  // nav: { layer: 0 types | 1 categories | 2 items | 'search', type, cat, page, q }
  const nav = { layer: 0, type: null, cat: null, page: 0, q: '', results: [] };
  /** The entries of the layer we're on: [{ kind: 'type' | 'cat' | 'item' | 'more', id, label, icon, thumb, item }]. */
  function entries() {
    if (nav.layer === 'search') return nav.results.map((it) => ({ kind: 'item', id: it.id, label: it.name, icon: it.icon, thumb: it.thumb, item: it, sub: it.catName }));
    if (nav.layer === 0) return S.types().map((t) => ({ kind: 'type', id: t.id, label: t.name, icon: t.icon, sub: `${t.count}` }));
    if (nav.layer === 1) return S.categories(nav.type).map((c) => ({ kind: 'cat', id: c.id, label: c.name, icon: c.icon, lib: c.library, sub: c.count ? `${c.count}` : '' }));
    return S.items(nav.type, nav.cat).map((it) => ({ kind: 'item', id: it.id, label: it.name, icon: it.icon, thumb: it.thumb, item: it, lib: it.source === 'library', sub: it.source === 'library' ? 'library' : '' }));
  }
  function crumb() {
    if (nav.layer === 'search') return `Search: ${nav.q}`;
    const t = nav.type && S.typeOf(nav.type);
    if (nav.layer === 0) return 'Spawn';
    if (nav.layer === 1) return t ? t.name : '';
    const c = S.categories(nav.type).find((x) => x.id === nav.cat);
    return `${t ? t.name : ''} › ${c ? c.name : (S.items(nav.type, nav.cat)[0] || {}).catName || ''}`;
  }
  function go(layer, o = {}) { Object.assign(nav, { layer, page: 0, ...o }); }
  function back() {
    if (nav.layer === 'search') { go(nav.prevLayer ?? 0); return true; }
    if (nav.layer === 2) { go(nav.type === 'recent' || nav.type === 'favorites' ? 0 : 1); return true; }
    if (nav.layer === 1) { go(0, { type: null }); return true; }
    return false;
  }
  /** Goes into a type or category (types with one category skip straight to its things). Returns a Promise when the
   *  library has to be asked. */
  function enter(e) {
    if (e.kind === 'type') {
      if (e.id === 'recent' || e.id === 'favorites') { go(2, { type: e.id, cat: null }); return null; }
      go(1, { type: e.id });
      // The library's shelves arrive the first time (they add categories).
      const p = S.loadShelves ? S.loadShelves().then(() => true) : null;
      const cats = S.categories(e.id);
      if (cats.length === 1) return enter({ kind: 'cat', id: cats[0].id });
      return p;
    }
    if (e.kind === 'cat') { go(2, { cat: e.id }); return S.load(nav.type, e.id); }
    if (e.kind === 'more') { nav.page++; return null; }
    return null;
  }
  S.nav = nav;
  S.entries = entries;
  S.enter = enter;
  S.back = back;

  // ------------------------------------------------------------------ spawning from a screen
  /** The click that follows the press that spawned (or closed) is ours, not the game's (no grab, no taking control). */
  function swallowClick() {
    const h = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', h, { capture: true, once: true });
    window.addEventListener('dblclick', h, { capture: true, once: true });
    setTimeout(() => { window.removeEventListener('click', h, true); window.removeEventListener('dblclick', h, true); }, 450);
  }
  async function spawnEntry(e, count, from) {
    if (!e || e.kind !== 'item') return;
    S.ghost.hide();
    swallowClick();
    close();
    const r = await S.spawn(e.item, { count });
    if (r && r.ok && navigator.vibrate && from === 'touch') navigator.vibrate(12);
  }

  // ------------------------------------------------------------------ the wheel (desktop, gamepad)
  let wheel = null;
  const wh = { open: false, hot: -1, list: [], vx: 0, vy: 0, by: null, held: false, charge: null, ten: false, shift: false, sticky: false };
  function ensureWheel() {
    style();
    if (wheel && wheel.isConnected) return;
    wheel = make('div', 'sw-wheel', '<div class="sw-ring"></div><div class="sw-mid"><div class="crumb"></div><div class="name"></div><div class="sub"></div></div><div class="sw-cursor"></div><div class="sw-keys"></div>');
    wheel.hidden = true;
    wheel.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }
  const radius = () => Math.max(120, Math.min(220, Math.min(innerWidth, innerHeight) * 0.34));
  function renderWheel() {
    if (!wheel) return;
    const all = entries();
    const pages = Math.max(1, Math.ceil(all.length / PAGE));
    if (nav.page >= pages) nav.page = 0;
    const list = all.slice(nav.page * PAGE, nav.page * PAGE + PAGE);
    if (pages > 1) list.push({ kind: 'more', id: 'more', label: `More (${nav.page + 1}/${pages})`, icon: '⟳' });
    wh.list = list;
    if (wh.hot >= list.length) wh.hot = -1;
    const ring = wheel.querySelector('.sw-ring');
    const R = radius();
    ring.innerHTML = list.length ? list.map((e, i) => {
      const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      const fav = e.item && S.favorites.has(e.item);
      return `<div class="sw-seg${i === wh.hot ? ' hot' : ''}${e.lib ? ' lib' : ''}" data-i="${i}" style="left:${Math.round(Math.cos(a) * R)}px;top:${Math.round(Math.sin(a) * R)}px"><span class="n">${i < 10 ? (i + 1) % 10 : ''}</span>${fav ? '<span class="st">★</span>' : ''}<span class="ic">${iconHtml(e)}</span><span class="lb">${esc(e.label)}</span><span class="many"></span></div>`;
    }).join('') : '';
    renderMid();
    const keys = nav.layer === 2 || nav.layer === 'search'
      ? '<kbd>Click</kbd> or let go of <kbd>Q</kbd> spawns · hold the click or <kbd>Shift</kbd>: ×10 · <kbd>F</kbd> favorite · <kbd>Esc</kbd> back · <kbd>Tab</kbd> search'
      : '<kbd>Click</kbd> opens · <kbd>1</kbd>-<kbd>9</kbd> or the mouse wheel pick · <kbd>Esc</kbd> back · <kbd>Tab</kbd> search';
    wheel.querySelector('.sw-keys').innerHTML = keys;
  }
  function renderMid() {
    const e = wh.list[wh.hot];
    wheel.querySelector('.crumb').textContent = crumb();
    wheel.querySelector('.name').textContent = e ? e.label : (wh.list.length ? (nav.layer === 2 ? 'Pick one' : 'Pick') : (nav.layer === 2 ? 'Loading…' : 'Nothing here yet'));
    wheel.querySelector('.sub').textContent = e ? (e.kind === 'item' ? (wh.shift || wh.ten ? 'Spawns ×10' : e.item.source === 'library' ? 'From the community library' : e.item.build ? 'Changes the world (saved)' : e.item.world || e.item.effect ? 'Happens now' : 'Spawns in front of you') : e.kind === 'more' ? 'Next page' : e.sub ? `${e.sub} inside` : '') : '';
    for (const seg of wheel.querySelectorAll('.sw-seg')) seg.classList.toggle('hot', Number(seg.dataset.i) === wh.hot);
    const c = wheel.querySelector('.sw-cursor');
    const show = H.input.mouse.locked || wh.by === 'pad';
    c.hidden = !show;
    if (show) { c.style.left = `${innerWidth / 2 + wh.vx}px`; c.style.top = `${innerHeight / 2 + wh.vy}px`; }
    const it = e && e.kind === 'item' ? e.item : null;
    if (it) S.ghost.show(it, wh.shift || wh.ten ? 10 : 1); else S.ghost.hide();
  }
  function setHot(i) { if (i === wh.hot) return; wh.hot = i; cancelCharge(); renderMid(); }
  /** The segment the cursor points at (from the middle), or -1 inside the dead zone. */
  function hotFrom(x, y) {
    if (Math.hypot(x, y) < 38 || !wh.list.length) return wh.hot;
    const a = (Math.atan2(y, x) + Math.PI / 2 + Math.PI * 4) % (Math.PI * 2);
    return Math.round((a / (Math.PI * 2)) * wh.list.length) % wh.list.length;
  }
  /** The game hears it opened: game.on('spawn-wheel', ({ state: 'open', as: 'wheel' | 'sheet', by })). */
  function opened(as, by) { try { if (H.game && H.game.emit) H.game.emit('spawn-wheel', { state: 'open', as, by }); } catch { /* no world */ } }
  function openWheel(by = 'mouse') {
    if (!S.allowed() || !W()) return false;
    closeSheet();
    ensureWheel();
    go(0, { type: null, cat: null });
    Object.assign(wh, { open: true, hot: -1, vx: 0, vy: 0, by, ten: false, shift: false });
    wheel.hidden = false;
    renderWheel();
    opened('wheel', by);
    S.loadShelves && S.loadShelves().then(() => { if (wh.open && nav.layer === 0) renderWheel(); });
    return true;
  }
  function closeWheel() {
    if (!wh.open) return;
    wh.open = false; wh.held = false; cancelCharge();
    if (wheel) wheel.hidden = true;
    S.ghost.hide();
  }
  /** Goes into, or spawns, what the wheel points at. */
  function activate(i, count) {
    const e = wh.list[i];
    if (!e) return;
    if (e.kind === 'item') { spawnEntry(e, count || (wh.shift || wh.ten ? 10 : 1), 'wheel'); return; }
    wh.hot = -1; wh.vx = 0; wh.vy = 0;
    const p = enter(e);
    renderWheel();
    if (p && p.then) p.then(() => { if (wh.open) renderWheel(); });
  }
  function wheelBack() { if (back()) { wh.hot = -1; wh.vx = 0; wh.vy = 0; renderWheel(); } else closeWheel(); }
  // Holding the click on a thing: ×10.
  function startCharge() {
    const e = wh.list[wh.hot];
    if (!e || e.kind !== 'item') return;
    cancelCharge();
    const seg = wheel.querySelector(`.sw-seg[data-i="${wh.hot}"]`);
    if (seg) seg.classList.add('charging');
    wh.charge = { i: wh.hot, t: setTimeout(() => { wh.ten = true; if (seg) { seg.classList.remove('charging'); seg.classList.add('ten'); } renderMid(); }, HOLD_MANY) };
  }
  function cancelCharge() {
    if (wh.charge) clearTimeout(wh.charge.t);
    wh.charge = null; wh.ten = false;
    if (wheel) for (const s of wheel.querySelectorAll('.sw-seg.charging, .sw-seg.ten')) s.classList.remove('charging', 'ten');
  }

  // Mouse: while the wheel is open the game doesn't see it (no looking around, no shooting).
  const onWheelUi = () => wh.open;
  window.addEventListener('pointermove', (ev) => {
    if (!onWheelUi() || ev.pointerType !== 'mouse') return;
    ev.stopPropagation();
    if (H.input.mouse.locked) { wh.vx += ev.movementX || 0; wh.vy += ev.movementY || 0; const R = radius() + 40, l = Math.hypot(wh.vx, wh.vy); if (l > R) { wh.vx *= R / l; wh.vy *= R / l; } }
    else { wh.vx = ev.clientX - innerWidth / 2; wh.vy = ev.clientY - innerHeight / 2; }
    wh.by = 'mouse';
    setHot(hotFrom(wh.vx, wh.vy));
    renderMid();
  }, true);
  window.addEventListener('pointerdown', (ev) => {
    if (!onWheelUi() || ev.pointerType !== 'mouse') return;
    ev.stopPropagation(); ev.preventDefault();
    if (ev.button === 2) { wheelBack(); return; }
    if (!H.input.mouse.locked) { const seg = ev.target.closest && ev.target.closest('.sw-seg'); if (seg) setHot(Number(seg.dataset.i)); else if (!ev.target.closest || !ev.target.closest('.sw-wheel')) return; }
    if (wh.hot < 0) return;
    const e = wh.list[wh.hot];
    if (e && e.kind === 'item') startCharge();
    else { wh.downOn = wh.hot; }
  }, true);
  window.addEventListener('pointerup', (ev) => {
    if (!onWheelUi() || ev.pointerType !== 'mouse' || ev.button !== 0) return;
    ev.stopPropagation();
    if (wh.charge || wh.ten) { const ten = wh.ten; const i = wh.charge ? wh.charge.i : wh.hot; cancelCharge(); activate(i, ten || wh.shift ? 10 : 1); return; }
    if (wh.downOn !== undefined && wh.downOn === wh.hot) activate(wh.hot);
    wh.downOn = undefined;
  }, true);
  window.addEventListener('wheel', (ev) => {
    if (!onWheelUi()) return;
    ev.stopPropagation(); ev.preventDefault();
    const n = wh.list.length;
    if (!n) return;
    setHot(((wh.hot < 0 ? (ev.deltaY > 0 ? -1 : 0) : wh.hot) + (ev.deltaY > 0 ? 1 : -1) + n) % n);
  }, { capture: true, passive: false });
  window.addEventListener('click', (ev) => { if (onWheelUi()) ev.stopPropagation(); }, true);
  window.addEventListener('dblclick', (ev) => { if (onWheelUi()) ev.stopPropagation(); }, true);

  // ------------------------------------------------------------------ the sheet (phones) and the panel (Tab, desktop)
  let sheet = null;
  const sh = { open: false, timer: null, press: null };
  function ensureSheet() {
    style();
    if (sheet && sheet.isConnected) return;
    sheet = make('div', 'sw-sheet', `<div class="sw-grab"></div>
      <div class="sw-head"><button type="button" data-a="back" aria-label="Back">‹</button><b></b><button type="button" data-a="close" aria-label="Close">✕</button></div>
      <div class="sw-find"><input type="search" placeholder="Search: cow, 4x4, stone wall…" autocomplete="off" enterkeyhint="search" aria-label="Search things to spawn"></div>
      <div class="sw-body"></div>`);
    sheet.hidden = true;
    for (const t of ['pointerdown', 'wheel', 'click', 'dblclick', 'contextmenu']) sheet.addEventListener(t, (ev) => ev.stopPropagation());
    sheet.querySelector('[data-a=close]').onclick = () => closeSheet();
    sheet.querySelector('[data-a=back]').onclick = () => { if (back()) renderSheet(); else closeSheet(); };
    const input = sheet.querySelector('input');
    input.addEventListener('input', () => {
      clearTimeout(sh.timer);
      const q = input.value.trim();
      if (!q) { if (nav.layer === 'search') go(nav.prevLayer ?? 0); renderSheet(); return; }
      if (nav.layer !== 'search') nav.prevLayer = nav.layer;
      go('search', { q, results: S.search(q) });
      renderSheet();
      sh.timer = setTimeout(async () => { const res = await S.searchAll(q); if (nav.layer === 'search' && nav.q === q) { nav.results = res; renderSheet(); } }, 260);
    });
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); if (input.value) { input.value = ''; input.dispatchEvent(new Event('input')); } else closeSheet(); }
      if (ev.key === 'Enter') { ev.preventDefault(); const first = entries()[0]; if (first) spawnEntry(first, ev.shiftKey ? 10 : 1, 'panel'); }
    });
    // Swipe right: back a layer; swipe down on the top: close.
    let sw = null;
    sheet.addEventListener('touchstart', (ev) => { const t = ev.touches[0]; sw = { x: t.clientX, y: t.clientY, head: Boolean(ev.target.closest && ev.target.closest('.sw-head, .sw-grab')) }; }, { passive: true });
    sheet.addEventListener('touchend', (ev) => {
      if (!sw) return;
      const t = ev.changedTouches[0];
      const dx = t.clientX - sw.x, dy = t.clientY - sw.y;
      if (dx > 70 && Math.abs(dy) < 50) { cancelPress(); if (back()) renderSheet(); }
      else if (sw.head && dy > 60 && Math.abs(dx) < 50) closeSheet();
      sw = null;
    }, { passive: true });
    // Tiles: tap goes in or spawns; holding a thing spawns ×10; ☆ stars it.
    const body = sheet.querySelector('.sw-body');
    body.addEventListener('pointerdown', (ev) => {
      const fav = ev.target.closest('.fav');
      if (fav) return;
      const t = ev.target.closest('.sw-tile');
      if (!t) return;
      const e = tileEntry(t);
      if (!e) return;
      sh.press = { el: t, e, x: ev.clientX, y: ev.clientY, ten: false, kind: ev.pointerType };
      if (e.kind === 'item') { S.ghost.show(e.item, 1); t.classList.add('charging'); sh.press.t = setTimeout(() => { if (sh.press && sh.press.el === t) { sh.press.ten = true; S.ghost.show(e.item, 10); t.querySelector('small') && (t.querySelector('small').textContent = '×10'); if (navigator.vibrate) navigator.vibrate(20); } }, HOLD_MANY); }
    });
    body.addEventListener('pointermove', (ev) => { if (sh.press && Math.hypot(ev.clientX - sh.press.x, ev.clientY - sh.press.y) > 12) cancelPress(); });
    body.addEventListener('pointerup', (ev) => {
      if (ev.target.closest('.fav')) return;
      const p = sh.press;
      if (!p) return;
      cancelPress();
      if (p.e.kind === 'item') { spawnEntry(p.e, p.ten || ev.shiftKey ? 10 : 1, p.kind === 'mouse' ? 'panel' : 'touch'); return; }
      const r = enter(p.e);
      renderSheet();
      if (r && r.then) r.then(() => { if (sh.open) renderSheet(); });
    });
    body.addEventListener('pointercancel', cancelPress);
    body.addEventListener('click', (ev) => {
      const fav = ev.target.closest('.fav');
      if (!fav) return;
      const e = tileEntry(fav.closest('.sw-tile'));
      if (e && e.item) { const on = S.toggleFavorite(e.item); toast(on ? `★ ${e.item.name}` : `${e.item.name}: not a favorite`); renderSheet(); }
    });
    body.addEventListener('mouseover', (ev) => { const t = ev.target.closest && ev.target.closest('.sw-tile'); const e = t && tileEntry(t); if (e && e.kind === 'item' && !phone()) S.ghost.show(e.item, 1); });
    body.addEventListener('mouseleave', () => { if (!sh.press) S.ghost.hide(); });
  }
  function cancelPress() { if (sh.press) { clearTimeout(sh.press.t); sh.press.el.classList.remove('charging'); } sh.press = null; }
  let sheetList = [];
  const tileEntry = (t) => (t ? sheetList[Number(t.dataset.i)] : null);
  function tile(e, i) {
    const fav = e.item ? `<button type="button" class="fav" aria-label="Favorite">${S.favorites.has(e.item) ? '★' : '☆'}</button>` : '';
    return `<div class="sw-tile${e.lib ? ' lib' : ''}" data-i="${i}" role="button" tabindex="0">${fav}<span class="ic">${iconHtml(e)}</span><span class="lb">${esc(e.label)}</span>${e.sub ? `<small>${esc(e.sub)}</small>` : '<small></small>'}<span class="many"></span></div>`;
  }
  function renderSheet() {
    if (!sheet) return;
    const list = entries();
    sheetList = [];
    const add = (e) => { sheetList.push(e); return tile(e, sheetList.length - 1); };
    sheet.querySelector('.sw-head b').textContent = crumb();
    sheet.querySelector('[data-a=back]').hidden = nav.layer === 0;
    let html = '';
    if (nav.layer === 0) {
      const rec = S.recent.list().filter((it) => !it.build || H.mode === 'build').slice(0, 8);
      if (rec.length) html += `<h4>Recent</h4><div class="sw-row">${rec.map((it) => add({ kind: 'item', id: it.id, label: it.name, icon: it.icon, thumb: it.thumb, item: it, lib: it.source === 'library' })).join('')}</div><h4>Everything</h4>`;
    }
    html += list.length ? `<div class="sw-grid">${list.map(add).join('')}</div>` : `<div class="sw-empty">${nav.layer === 'search' ? `Nothing called “${esc(nav.q)}” yet. Ask the Overseer to make one.` : nav.layer === 2 ? 'Loading…' : 'Nothing here yet.'}</div>`;
    if (nav.layer === 2 || nav.layer === 'search') html += `<div class="sw-empty" style="padding:12px 4px 0;font-size:12px">${phone() ? 'Tap to spawn · hold for ×10 · ☆ favorite' : 'Click to spawn · Shift+click or hold for ×10 · ☆ favorite'}${H.mode === 'build' ? ' · saved with the world (Ctrl+Z undoes)' : ''}</div>`;
    sheet.querySelector('.sw-body').innerHTML = html;
  }
  function openSheet(o = {}) {
    if (!S.allowed() || !W()) return false;
    const keep = wh.open && o.keepNav;
    closeWheel();
    ensureSheet();
    if (!keep) go(0, { type: null, cat: null });
    sh.open = true;
    if (!keep) opened('sheet', 'touch');
    sheet.classList.toggle('phone', phone());
    // The panel sits between the editor's bars (H.hooks.uiTop / uiBottom), not under them.
    const top = Number(H.hooks.uiTop) || 0, bottom = Number(H.hooks.uiBottom) || 0;
    if (!phone()) { sheet.style.top = `${Math.round(top + (innerHeight - top - bottom) / 2)}px`; sheet.style.height = `${Math.round(Math.max(260, Math.min(560, innerHeight - top - bottom - 16)))}px`; }
    else { sheet.style.top = ''; sheet.style.height = ''; }
    sheet.hidden = false;
    const input = sheet.querySelector('input');
    input.value = '';
    renderSheet();
    if (document.pointerLockElement) document.exitPointerLock();
    if (o.search && !phone()) setTimeout(() => input.focus(), 0);
    S.loadShelves && S.loadShelves().then(() => { if (sh.open && nav.layer === 0) renderSheet(); });
    return true;
  }
  function closeSheet() {
    if (!sh.open) return;
    sh.open = false; cancelPress();
    if (sheet) { sheet.hidden = true; const i = sheet.querySelector('input'); if (i) i.blur(); }
    S.ghost.hide();
  }
  function close() { closeWheel(); closeSheet(); }
  S.open = (o = {}) => (phone() || o.panel ? openSheet({ search: o.search }) : openWheel(o.by || 'mouse'));
  S.close = close;
  S.isOpen = () => wh.open || sh.open;
  S.ui = { openWheel, openSheet, closeWheel, closeSheet, renderWheel, renderSheet, activate, setHot, wheelBack, get wheel() { return wh; }, get sheet() { return sh; } };

  // ------------------------------------------------------------------ the ➕ button (phones) and the hint (desktop)
  let fab = null;
  function ensureFab() {
    style();
    if (fab && fab.isConnected) return;
    fab = make('button', 'sw-fab');
    fab.type = 'button';
    fab.hidden = true;
    fab.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
    fab.addEventListener('click', (ev) => { ev.stopPropagation(); if (sh.open) closeSheet(); else openSheet({ search: !phone() }); });
  }
  let fabT = 0;
  H.hooks.frame.push((dt) => {
    fabT -= dt;
    if (fabT > 0) return;
    fabT = 0.4;
    ensureFab();
    const show = Boolean(W()) && S.allowed() && !(H.share && H.share.photo && H.share.photo.on);
    const desk = !phone();
    fab.classList.toggle('desk', desk);
    const html = desk ? '<kbd>Q</kbd> Spawn' : '+';
    if (fab.innerHTML !== html) fab.innerHTML = html;
    fab.setAttribute('aria-label', 'Spawn something');
    fab.title = desk ? 'Hold Q for the spawn wheel (click for the searchable panel)' : 'Spawn something';
    fab.hidden = !show || S.isOpen();
    if (!show && S.isOpen()) close();
  });

  // ------------------------------------------------------------------ keys
  const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
  const keyOf = (e) => (e.key === ' ' ? 'space' : String(e.key || '').toLowerCase());
  /** Someone else uses Q right now: photo mode, a screen in your hands, driving, another wheel or panel. */
  function qTaken() {
    if (H.share && H.share.photo && H.share.photo.on) return true;
    if (H.hooks.holding) return true; // carrying something while building
    const held = H.tools && H.tools.held;
    if (held && ['remote', 'phone', 'computer'].includes(held.name)) return true;
    const p = W() && W().player;
    if (p && p.controller && p.controller !== 'walk') return true;
    if (H.presence && H.presence.uiOpen && H.presence.uiOpen()) return true;
    return document.querySelector('.ui-menu-wrap, .ui-popup-wrap, .card') !== null;
  }
  const q = { down: 0, t: null, mine: false, opened: false };
  /** A tap of Q goes to the game as if the wheel weren't there (Mayhem's tool belt). */
  function tapQ() {
    const held = H.input.held;
    held.add('q');
    setTimeout(() => held.delete('q'), 90);
  }
  const beltWantsTap = () => H.mode !== 'build' && H.mayhem && Array.isArray(H.mayhem.belt) && H.mayhem.belt.length > 1;
  window.addEventListener('keydown', (e) => {
    if (typing(e) || !W()) return;
    const k = keyOf(e);
    if (e.cancelBubble && !wh.open) return; // photo mode (it stops what it takes)
    if (wh.open) {
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (k === 'q') { stop(); return; }
      if (k === 'shift') { wh.shift = true; renderMid(); return; }
      if (/^[0-9]$/.test(k) && !e.repeat) { stop(); const i = k === '0' ? 9 : Number(k) - 1; if (wh.list[i]) { setHot(i); activate(i); } return; }
      if (k === 'escape' || k === 'backspace') { stop(); wheelBack(); return; }
      if (k === 'enter' && wh.hot >= 0) { stop(); activate(wh.hot); return; }
      if (k === 'tab') { stop(); openSheet({ search: true, keepNav: true }); return; }
      if (k === 'f' && wh.list[wh.hot] && wh.list[wh.hot].item) { stop(); const it = wh.list[wh.hot].item; const on = S.toggleFavorite(it); toast(on ? `★ ${it.name}` : `${it.name}: not a favorite`); renderWheel(); return; }
      if (k === 'arrowright' || k === 'arrowleft') { stop(); const n = wh.list.length; if (n) setHot(((wh.hot < 0 ? 0 : wh.hot) + (k === 'arrowright' ? 1 : -1) + n) % n); return; }
      return;
    }
    if (sh.open) {
      if (k === 'escape') { e.preventDefault(); e.stopImmediatePropagation(); if (!back()) closeSheet(); else renderSheet(); }
      if (k === 'tab' || k === 'q') { e.preventDefault(); e.stopImmediatePropagation(); closeSheet(); }
      return;
    }
    if (k !== 'q' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!S.allowed() || qTaken()) return;
    // Ours: a hold opens the wheel; a tap is still Q for the game (Mayhem's belt), or opens the wheel to click.
    e.preventDefault(); e.stopImmediatePropagation();
    q.mine = true; q.opened = false; q.down = performance.now();
    clearTimeout(q.t);
    q.t = setTimeout(() => { if (q.mine && !q.opened) { q.opened = openWheel('mouse'); wh.held = true; } }, HOLD_Q);
  }, true);
  window.addEventListener('keyup', (e) => {
    const k = keyOf(e);
    if (k === 'shift' && wh.open) { wh.shift = false; renderMid(); return; }
    if (k !== 'q' || !q.mine) return;
    e.stopImmediatePropagation();
    q.mine = false;
    clearTimeout(q.t);
    if (!q.opened) {
      // A tap.
      if (beltWantsTap()) tapQ();
      else { openWheel('mouse'); wh.sticky = true; }
      return;
    }
    // Let go after holding: spawn what it points at, go into a type or category (the wheel stays to click), or close.
    if (!wh.open) return;
    wh.held = false;
    const e2 = wh.list[wh.hot];
    if (e2 && e2.kind === 'item') activate(wh.hot);
    else if (e2) activate(wh.hot);
    else if (nav.layer === 0) closeWheel();
  }, true);
  window.addEventListener('blur', () => { if (q.mine) { q.mine = false; clearTimeout(q.t); } });

  // ------------------------------------------------------------------ gamepad: D-pad up, the stick, A / X / B
  const pad = { was: [] };
  H.hooks.frame.push(() => {
    if (!navigator.getGamepads || !W()) return;
    let gp = null;
    try { gp = [...navigator.getGamepads()].find((g) => g && g.connected); } catch { return; }
    if (!gp) return;
    const down = (i) => Boolean(gp.buttons[i] && gp.buttons[i].pressed);
    const pressed = (i) => down(i) && !pad.was[i];
    if (pressed(12) && !qTaken()) { if (wh.open) closeWheel(); else openWheel('pad'); }
    else if (wh.open && wh.by === 'pad') {
      const x = gp.axes[0] || 0, y = gp.axes[1] || 0;
      if (Math.hypot(x, y) > 0.5) { wh.vx = x * radius(); wh.vy = y * radius(); setHot(hotFrom(wh.vx, wh.vy)); renderMid(); }
      if (pressed(0) && wh.hot >= 0) activate(wh.hot, 1);
      if (pressed(2) && wh.hot >= 0) activate(wh.hot, 10);
      if (pressed(1)) wheelBack();
    }
    pad.was = gp.buttons.map((b) => b.pressed);
  });

  // ------------------------------------------------------------------ the editor and new worlds
  window.addEventListener('message', (ev) => {
    const m = ev.data || {};
    if (ev.source !== window.parent) return;
    if (m.type === 'spawn-wheel') { if (m.open === false) close(); else S.open({ panel: m.panel, search: m.search }); }
  });
  H.hooks.world.push({ leave() { close(); } });
})();
