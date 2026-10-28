// Looks (H.looks): choose how a thing looks (J, 2026-10-27: "a moment where the player can choose what it looks like").
// Like the mirror, but for a thing: the camera turns slowly round it, a panel offers looks (the library's, like it first,
// then everything, and the game's own), each shown on the thing at once, and the player keeps one, goes back, or asks
// Hawkes Gen for a new one (it takes its place when it's made). A look is only the look: a truck wearing a teapot still
// drives like a truck (looks-core.js). Only while building in the editor or on the player's own island; never in a
// published game. Opened by the build card's 🎨 Look, the Overseer (an answer's `look` line: work.js), or a script.
//   H.looks.open(thing, { suggest: [asset ids], prompt, why })   H.looks.close()   H.looks.allowed()   H.looks.state()
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const C = H.looksCore;
  const W = () => H.world;
  const G = () => H.game;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const NEW_MODEL_CREDITS = '~90';

  // ------------------------------------------------------------------ where it works, and how a choice is kept
  const inEditor = () => Boolean(window.HawkesBuild) && window.parent !== window;
  const island = () => (window.HawkesGuest && window.HawkesGuest.looks) || null;
  /** Building in the editor, or the player's own island (the sandbox, signed in). Never a published game. */
  const allowed = () => (inEditor() && H.mode === 'build') || Boolean(island());
  /** The island before an account: the look needs a game to keep it in. */
  const islandGuest = () => Boolean(window.HawkesGuest && !window.HawkesGuest.looks && window.HawkesGuest.account);

  const keep = (ops, label) => {
    if (!ops.length) return;
    if (inEditor() && window.HawkesBuild.edit) return window.HawkesBuild.edit(ops, { label: label || 'how it looks' });
    const g = island();
    if (g) return g.save(ops);
  };
  /** Puts a library thing in the game (it's its owner's asset: nothing is copied or paid): { ok, asset: { name } }. */
  function useLibrary(item) {
    if (inEditor() && H.spawn && H.spawn.useLibrary) return H.spawn.useLibrary({ id: item.id, kind: item.kind, title: item.title });
    const g = island();
    return g ? g.useLibrary(item) : Promise.resolve({ ok: false, error: 'Looks open while building' });
  }
  /** Asks Hawkes Gen for a new model: { ok, row: { task_id } } (paid from their credits; the editor or the island asks). */
  const waits = new Map();
  window.addEventListener('message', (ev) => {
    const m = ev.data || {};
    if (ev.source !== window.parent) return;
    if (m.type === 'looks-generate') { const w = waits.get(m.req); if (w) { waits.delete(m.req); w(m); } }
    if (m.type === 'gen' && m.row) onGen(m.row);
  });
  function generate(prompt, name) {
    if (inEditor()) {
      return new Promise((resolve) => {
        const req = Math.random().toString(36).slice(2);
        waits.set(req, resolve);
        H.post({ type: 'looks-generate', req, prompt, name });
        setTimeout(() => { if (waits.delete(req)) resolve({ ok: false, error: 'No answer. Try again in a moment.' }); }, 25000);
      });
    }
    const g = island();
    return g ? g.generate(prompt, name) : Promise.resolve({ ok: false, error: 'Looks open while building' });
  }

  // ------------------------------------------------------------------ the library
  const LIB = { cache: new Map() };
  async function search(params) {
    const key = new URLSearchParams({ kind: 'model', limit: '30', ...params }).toString();
    if (LIB.cache.has(key)) return LIB.cache.get(key);
    const p = fetch(`/v1/community?${key}`, { credentials: 'omit' }).then((r) => (r.ok ? r.json() : { items: [] })).then((j) => (j.items || []).filter((i) => i.kind === 'model')).catch(() => []);
    LIB.cache.set(key, p);
    return p;
  }
  /** A library thing as one of this game's assets, for the preview (its own id; the real thing joins on Keep). */
  function preload(item) {
    if (H.assets.get(item.id)) return item.id;
    const all = Object.fromEntries(H.assets.list().map((a) => [a.name, a]));
    all[`look-${item.id}.glb`] = { url: item.file || `/v1/community/${item.id}/file`, mime: 'model/gltf-binary', id: item.id, type: 'model', title: item.title, words: item.tags || [], lods: item.lods || null };
    H.setAssets(all);
    return item.id;
  }
  const yours = () => H.assets.list().filter((a) => a.type === 'model' && !/_low\.glb$/i.test(a.name) && !/^look-a_/.test(a.name));

  // ------------------------------------------------------------------ the session
  let S = null;
  function open(target, o = {}) {
    const w = W();
    const e = typeof target === 'string' ? w && w.byId.get(target) : target;
    if (!w || !e || !e.alive || !e.sceneId || S) return false;
    if (!allowed()) {
      if (islandGuest()) { say('Keep this island first, and then you can choose how anything on it looks.'); window.HawkesGuest.account(); }
      return false;
    }
    const spec = JSON.parse(JSON.stringify(w.graph.entities[e.sceneId] || {}));
    const f = C.field(spec, H.kinds.get(spec.type));
    const p = w.player;
    S = {
      e, id: e.sceneId, spec, f, ref0: C.current(spec, f), chosen: undefined, tab: o.suggest && o.suggest.length ? 'suggested' : 'like', q: '',
      suggest: (o.suggest || []).slice(0, 12), prompt: String(o.prompt || '').slice(0, 300), why: o.why || null,
      saved: p ? { controls: p.controls, view: p._view || 'first' } : null, t: 0, yaw: null, busy: false, items: [],
      size: Math.max(0.5, ...(e.size || [1, 1, 1])),
    };
    if (p) p.controls = false;
    try { const g = G(); if (g && g.input && g.input.release) g.input.release(); } catch { /* fine */ }
    show();
    load();
    emit({ state: 'open', id: S.id });
    return true;
  }
  /** Ends it. keep: the chosen look is the thing's now (saved); otherwise it goes back to how it was. */
  function close(keepIt) {
    if (!S) return;
    const s = S;
    S = null;
    hide();
    const w = W();
    if (w && w.camera && w.camera.release) try { w.camera.release(); } catch { /* fine */ }
    if (s.saved && w && w.player && w.player.alive) { w.player.controls = s.saved.controls !== false; try { w.player.view = s.saved.view; } catch { /* fine */ } }
    if (keepIt && s.chosen !== undefined && s.chosen !== s.ref0) {
      emit({ state: 'done', id: s.id, look: s.chosen });
      return;
    }
    // Back to how it was (what the preview changed, only here).
    if (s.chosen !== undefined && s.chosen !== s.ref0 && w && w.graph.entities[s.id]) try { H.applyOps([{ op: 'replace', entity: s.spec }], { local: true }); } catch (err) { H.report(err, 'looks'); }
    emit({ state: 'cancel', id: s.id });
  }
  function emit(d) { const g = G(); try { if (g && g.emit) g.emit('looks', d); } catch (err) { H.report(err, 'looks'); } }
  function say(text) { try { if (H.overseer && H.overseer.say) H.overseer.say(text, 4); } catch { /* fine */ } }

  /** Shows look `ref` on the thing, here only (not saved): an asset id, or null for its built-in body. */
  function preview(ref) {
    const s = S;
    if (!s) return;
    s.chosen = ref;
    const ops = ref === s.ref0 ? [{ op: 'replace', entity: s.spec }] : C.ops(s.spec, s.f, ref, { size: s.size });
    try { H.applyOps(ops, { local: true }); } catch (err) { H.report(err, 'looks'); }
    s.e = W().byId.get(s.id) || s.e;
    try { if (H.overseer && H.overseer.materialize && s.e && s.e.alive) H.overseer.materialize(s.e, { seconds: 0.8 }); } catch { /* fine */ }
    render();
  }
  async function keepChoice() {
    const s = S;
    if (!s || s.busy) return;
    if (s.chosen === undefined || s.chosen === s.ref0) return close(false);
    s.busy = true; render();
    let ref = s.chosen;
    const item = s.items.find((i) => i.id === ref && i.lib);
    if (item) {
      const r = await useLibrary(item);
      if (!r || r.ok === false) { s.busy = false; s.error = (r && r.error) || 'That look could not be added. Try again.'; render(); return; }
    }
    const ops = C.ops(s.spec, s.f, ref, { size: s.size });
    try { keep(ops, 'how it looks'); } catch (err) { H.report(err, 'looks'); }
    s.busy = false;
    close(true);
    say('There. It wears its new look.');
  }

  // ------------------------------------------------------------------ making a new one (Hawkes Gen)
  const pending = new Map(); // task id -> { id (the thing), f, spec, size }
  async function makeNew(text) {
    const s = S;
    if (!s || s.busy) return;
    const input = root && root.querySelector('.lk-prompt');
    const prompt = String(text ?? ((input && input.value) || '')).trim();
    if (!prompt) { s.error = 'Say what it should look like.'; render(); return; }
    s.busy = true; s.error = null; render();
    const name = `${(s.spec.name || 'look').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'look'}.glb`;
    const r = await generate(prompt, name);
    s.busy = false;
    if (!r || r.ok === false || !r.row) { s.error = (r && r.error) || 'It could not be started.'; render(); return; }
    pending.set(r.row.task_id, { id: s.id, f: s.f, spec: s.spec, size: s.size });
    close(false);
    say('I am making it now. It takes a few minutes, and it will take its place on its own when it is ready.');
  }
  /** A generation's news (the editor's feed or the island's): a new look that's done goes on its thing. */
  async function onGen(row) {
    const want = row && pending.get(row.task_id);
    if (!want || row.state === 'running') return;
    pending.delete(row.task_id);
    if (row.state !== 'done' || !row.asset_name) return say('The new look could not be made. Your credits for it were given back.');
    for (let i = 0; i < 60 && !H.assets.get(row.asset_name); i++) await new Promise((r) => setTimeout(r, 250));
    const w = W();
    const spec = w && w.graph.entities[want.id];
    if (!spec) return;
    const a = H.assets.get(row.asset_name);
    const ops = C.ops(spec, want.f, (a && a.id) || row.asset_name, { size: want.size });
    try { keep(ops, 'its new look'); } catch (err) { H.report(err, 'looks'); }
    say('Your new look is here.');
  }

  // ------------------------------------------------------------------ the picture: the camera turns round the thing
  function frame(dt) {
    const s = S, w = W();
    if (!s || !w || !w.camera) return;
    const e = (s.e = (w.byId.get(s.id) || s.e));
    if (!e || !e.alive) return close(false);
    s.t += dt;
    const c = e.node.getAbsolutePosition();
    const r = Math.max(1.2, s.size);
    if (s.yaw === null) { const cam = w.scene.activeCamera; s.yaw = cam ? Math.atan2(cam.position.x - c.x, cam.position.z - c.z) : 0; }
    const yaw = s.yaw + s.t * 0.25;
    const dist = 1.8 + r * 1.9;
    const phone = window.innerWidth < 700;
    const pos = [c.x + Math.sin(yaw) * dist, c.y + r * 0.55 + 0.6, c.z + Math.cos(yaw) * dist];
    // (The panel is on the right, at the bottom on a phone: the thing sits left of the middle, or up.)
    const side = phone ? 0 : r * 0.55;
    const at = [c.x + Math.cos(yaw) * side, c.y + (phone ? -r * 0.35 : 0), c.z - Math.sin(yaw) * side];
    try { w.camera.internal(() => w.camera.api.fixed(pos, at)); } catch (err) { H.report(err, 'looks'); }
  }
  H.hooks.frame.push((elapsed) => { if (S) frame(Math.min(0.1, Math.max(0, Number(elapsed) || 0))); });

  // ------------------------------------------------------------------ the panel
  let root = null;
  const CSS = `
    .lk{position:fixed;right:max(16px,env(safe-area-inset-right));top:50%;transform:translateY(-50%);width:min(420px,calc(100vw - 32px));max-height:min(86vh,780px);display:flex;flex-direction:column;z-index:60;
      background:rgba(10,14,26,.9);border:1px solid rgba(143,216,255,.25);border-radius:18px;color:#eef3ff;font:15px/1.35 Inter,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.45);backdrop-filter:blur(8px)}
    .lk-top{display:flex;align-items:flex-start;gap:8px;padding:16px 16px 4px}.lk-x{margin-left:auto;background:none;border:0;color:#a5acc2;font-size:22px;cursor:pointer;line-height:1;padding:2px 6px}
    .lk-q{margin:0;font:700 24px/1.1 var(--display,'Orbitron','Rajdhani',sans-serif);letter-spacing:.02em}.lk-sub{margin:4px 0 0;color:#a5acc2;font-size:13.5px}
    .lk-tabs{display:flex;gap:6px;padding:10px 16px 0;flex-wrap:wrap}.lk-tab{padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid transparent;color:inherit;font:inherit;font-size:13.5px;cursor:pointer}
    .lk-tab.on{border-color:#4a9eff;background:rgba(74,158,255,.2)}
    .lk-search{margin:10px 16px 0;padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.25);color:inherit;font:inherit}
    .lk-body{overflow:auto;padding:10px 16px 12px;flex:1}
    .lk-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .lk-card{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 6px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid transparent;color:inherit;font:inherit;cursor:pointer;min-height:104px}
    .lk-card:hover{background:rgba(255,255,255,.11)}.lk-card.on{border-color:#4a9eff;background:rgba(74,158,255,.18)}
    .lk-card img,.lk-card .ic{width:100%;aspect-ratio:1;object-fit:contain;border-radius:8px;background:rgba(255,255,255,.04);display:grid;place-items:center;font-size:30px}
    .lk-card span{font-size:12.5px;text-align:center;opacity:.9;line-height:1.2;max-height:2.4em;overflow:hidden}
    .lk-empty{color:#a5acc2;font-size:14px;padding:12px 0}
    .lk-new{margin-top:12px;padding:12px;border-radius:12px;background:rgba(255,216,74,.07);border:1px solid rgba(255,216,74,.25)}
    .lk-new h4{margin:0 0 6px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#ffd84a}.lk-new p{margin:0 0 8px;font-size:13px;color:#c9cfdf}
    .lk-prompt{width:100%;box-sizing:border-box;padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.25);color:inherit;font:inherit;resize:vertical;min-height:52px}
    .lk-foot{display:flex;gap:8px;padding:12px 16px 16px;border-top:1px solid rgba(255,255,255,.1);align-items:center}
    .lk-btn{padding:10px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:inherit;font:600 15px/1 var(--hud,'Rajdhani',sans-serif);cursor:pointer}
    .lk-btn.go{margin-left:auto;background:#4a9eff;border-color:transparent;color:#05101f}.lk-btn.gold{background:#ffd84a;border-color:transparent;color:#1b1400}.lk-btn:disabled{opacity:.45;cursor:default}
    .lk-err{color:#ff9b9b;font-size:13px;padding:0 16px 8px}
    @media (max-width:700px){.lk{top:auto;bottom:max(10px,env(safe-area-inset-bottom));transform:none;max-height:52vh;right:10px;width:calc(100vw - 20px)}.lk-grid{grid-template-columns:repeat(4,1fr)}.lk-q{font-size:20px}.lk-card{min-height:84px}}`;
  function show() {
    if (!document.getElementById('lk-css')) { const st = document.createElement('style'); st.id = 'lk-css'; st.textContent = CSS; document.head.appendChild(st); }
    root = document.createElement('div');
    root.className = 'lk';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Choose how it looks');
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Escape') close(false); if (ev.key === 'Enter' && ev.target.classList.contains('lk-search')) { S.q = ev.target.value.trim(); S.tab = 'search'; load(); } });
    root.addEventListener('keyup', (ev) => ev.stopPropagation());
    document.body.appendChild(root);
    render();
  }
  function hide() { if (root) { root.remove(); root = null; } }

  async function load() {
    const s = S;
    if (!s) return;
    s.loading = true; render();
    let list = [];
    if (s.tab === 'yours') list = yours().map((a) => ({ id: a.id || a.name, title: a.title || a.name.replace(/\.glb$/i, ''), thumb: null, lib: false }));
    else {
      const rows = s.tab === 'suggested' ? (await search({ limit: '60' })).filter((i) => s.suggest.includes(i.id)).concat(await search({ q: C.words(s.spec) || 'model' }))
        : s.tab === 'like' ? await search({ q: C.words(s.spec) || 'model' })
        : s.tab === 'search' ? await search({ q: s.q || 'model' })
        : await search({ sort: 'liked', limit: '60' });
      list = rows.filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i).map((r) => ({ ...r, lib: true }));
    }
    if (S !== s) return;
    s.items = list;
    s.loading = false;
    render();
  }

  function render() {
    const s = S;
    if (!root || !s) return;
    const card = (id, title, img, on) => `<button class="lk-card${on ? ' on' : ''}" data-look="${esc(id)}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span class="ic">${id === '__builtin' ? '◆' : '📦'}</span>`}<span>${esc(title)}</span></button>`;
    const chosen = s.chosen === undefined ? s.ref0 : s.chosen;
    const fixed = [card('__original', 'As it was', null, s.chosen === undefined || s.chosen === s.ref0)];
    if (C.hasBuiltIn(s.f) && s.ref0) fixed.push(card('__builtin', 'Its own shape', null, chosen === null));
    const grid = s.loading ? '<div class="lk-empty">Looking…</div>'
      : s.items.length ? `<div class="lk-grid">${fixed.join('')}${s.items.map((i) => card(i.id, i.title, i.thumb, chosen === i.id)).join('')}</div>`
      : `<div class="lk-grid">${fixed.join('')}</div><div class="lk-empty">${s.tab === 'yours' ? 'This game has no models of its own yet.' : 'Nothing in the library matches. Try other words, or make a new one below.'}</div>`;
    const tabs = [['suggested', 'Suggested', s.suggest.length], ['like', 'Like it', true], ['all', 'Everything', true], ['yours', 'Yours', true]].filter((t) => t[2]);
    const prompt = s.prompt || `${s.spec.name || C.words(s.spec) || 'it'}, a better-looking version`;
    root.innerHTML = `
      <div class="lk-top"><div><p class="lk-q">How should it look?</p><p class="lk-sub">${esc(s.spec.name || s.id)} keeps what it does; only its look changes.${s.why ? ` ${esc(s.why)}` : ''}</p></div><button class="lk-x" data-a="x" aria-label="Close">×</button></div>
      <div class="lk-tabs">${tabs.map(([k, label]) => `<button class="lk-tab${s.tab === k ? ' on' : ''}" data-tab="${k}">${label}</button>`).join('')}</div>
      <input class="lk-search" placeholder="Search the library (anything: a dragon, a teapot…)" value="${esc(s.q)}" aria-label="Search the library">
      <div class="lk-body">${grid}
        <div class="lk-new"><h4>✦ Make a new one</h4><p>Hawkes Gen makes a model just for this (${NEW_MODEL_CREDITS} credits, a few minutes). It takes its place by itself when it's ready.</p>
          <textarea class="lk-prompt" maxlength="300" aria-label="What it should look like">${esc(prompt)}</textarea>
          <div style="margin-top:8px"><button class="lk-btn gold" data-a="make" ${s.busy ? 'disabled' : ''}>Make it</button></div></div>
      </div>
      ${s.error ? `<div class="lk-err">${esc(s.error)}</div>` : ''}
      <div class="lk-foot"><button class="lk-btn" data-a="x">Cancel</button><button class="lk-btn go" data-a="keep" ${s.busy || s.chosen === undefined || s.chosen === s.ref0 ? 'disabled' : ''}>${s.busy ? 'Keeping…' : 'Keep this look'}</button></div>`;
  }
  function onClick(ev) {
    const b = ev.target.closest('button');
    if (!b || !S) return;
    if (b.dataset.a === 'x') return close(false);
    if (b.dataset.a === 'keep') return void keepChoice();
    if (b.dataset.a === 'make') return void makeNew();
    if (b.dataset.tab) { S.tab = b.dataset.tab; S.error = null; return void load(); }
    if (b.dataset.look) {
      S.error = null;
      if (b.dataset.look === '__original') return preview(S.ref0);
      if (b.dataset.look === '__builtin') return preview(null);
      const item = S.items.find((i) => i.id === b.dataset.look);
      if (!item) return;
      return preview(item.lib ? preload(item) : item.id);
    }
  }

  H.looks = {
    open, close: () => close(false), allowed, onGen,
    /** The Overseer offers a choice (its answer's look line): opened on that thing when looks can be chosen here. */
    offer(o) { if (!o || !o.id || !allowed()) return false; return open(o.id, { suggest: o.suggest, prompt: o.prompt, why: o.why }); },
    get isOpen() { return Boolean(S); },
    state() { return S ? { id: S.id, field: S.f, tab: S.tab, items: S.items.length, chosen: S.chosen, ref0: S.ref0, busy: S.busy } : null; },
    _: { preview, keepChoice, makeNew, pending },
  };
  // Scripts: game.looks.open(thing) (where looks can be chosen: building, or the player's island).
  H.hooks.game.push((g) => { g.looks = { open: (t, o) => open(t && t.__entity ? t : (W() && W().byId.get(String(t))) || t, o), close: () => close(false), get isOpen() { return Boolean(S); } }; });
})();
