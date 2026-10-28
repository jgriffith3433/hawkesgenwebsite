// Planets (config.planets; J, 2026-10-27: "put me on an entirely new planet and make it so I can fly to different
// planets"): a game holds more than one planet. The world as written is the home planet; config.planets.list adds
// others, each with its own look and size (config.planet), ground (terrain), sea (water), weather, time, gravity and
// things (a thing's data.planet says which planet it is on; things without it are home's). The others hang in the sky as
// planets you can see. Fly up into space (or anywhere, with travel: "anywhere"), open 🪐 Planets and pick one: a warp,
// and you arrive standing on it, your ship with you. Online the whole room travels together (the host decides; late
// joiners arrive where everyone is). Scripts: game.planets.travel(id), game.on('travel' / 'arrive').
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const W = () => H.world;
  const G = () => H.game;
  // What a planet may change of the world (the rest is the game's own).
  const KEYS = ['planet', 'terrain', 'water', 'weather', 'time', 'blocks', 'look'];
  const COLORS = { earth: '#4d8a3a', forest: '#2f6b2a', desert: '#c9a165', ice: '#dce7ee', ocean: '#1b6db0', lava: '#ff5a1a', alien: '#7b4fb0' };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const st = { at: 'home', home: null, sky: [], busy: false, ui: null, open: false, cool: 0 };

  const cfg = () => { const c = W() && W().graph && W().graph.config && W().graph.config.planets; return c && typeof c === 'object' ? c : null; };
  function list() {
    const c = cfg();
    if (!c) return [];
    const home = { id: 'home', name: (c.home && c.home.name) || 'Home', biome: biomeOf(st.home ? st.home.planet : W().graph.config.planet), home: true };
    const others = (Array.isArray(c.list) ? c.list : []).filter((p) => p && typeof p === 'object' && /^[a-z0-9-]{1,32}$/i.test(String(p.id || '')) && p.id !== 'home')
      .map((p) => ({ ...p, id: String(p.id), name: String(p.name || p.id), biome: biomeOf(p.planet || p.biome) }));
    return [home, ...others];
  }
  function biomeOf(v) { const b = v && typeof v === 'object' ? v.biome : v; return typeof b === 'string' && COLORS[b] ? b : 'earth'; }
  const find = (id) => list().find((p) => p.id === id) || null;
  const where = (e) => (e.data && e.data.planet) || (e.sceneId && !e.temporary && !e.spawned ? 'home' : null);

  // ------------------------------------------------------------------ the others in the sky
  function drawSky() {
    for (const m of st.sky) m.dispose(false, true);
    st.sky = [];
    const w = W();
    if (!w || !cfg()) return;
    const others = list().filter((p) => p.id !== st.at);
    others.forEach((p, i) => {
      const n = others.length, az = (i / Math.max(1, n)) * Math.PI * 2 + 0.7, el = 0.35 + (i % 3) * 0.18, dist = 1500;
      const size = Math.min(520, 120 + (Number(p.radius ?? (p.planet && p.planet.radius)) || 20000) / 200);
      const m = B.MeshBuilder.CreateSphere(`planet-${p.id}`, { diameter: size, segments: 24 }, w.scene);
      const mat = new B.StandardMaterial(`planet-${p.id}`, w.scene);
      const col = B.Color3.FromHexString(p.color && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : COLORS[p.biome]);
      mat.diffuseColor = col; mat.emissiveColor = col.scale(p.biome === 'lava' ? 0.6 : 0.22); mat.specularColor = B.Color3.Black();
      mat.fogEnabled = false;
      m.material = mat; m.isPickable = false; m.infiniteDistance = true; m.metadata = { decor: true };
      m.position.set(Math.cos(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.sin(az) * Math.cos(el) * dist);
      m.applyFog = false;
      st.sky.push(m);
    });
  }

  // ------------------------------------------------------------------ going there
  /** What the world's settings become on a planet: its own, else home's (the world as written), else nothing. */
  function patchFor(p) {
    const home = st.home || {};
    const patch = {};
    for (const k of KEYS) patch[k] = p.home ? clone(home[k]) ?? null : p[k] !== undefined ? clone(p[k]) : k === 'planet' ? { ...(clone(home.planet) || {}), biome: p.biome, ...(p.radius ? { radius: p.radius } : {}) } : k === 'look' ? clone(home.look) ?? null : null;
    // A planet with no ground of its own on a flat home world (no ball underfoot): ground by its biome, so you land.
    const round = home.planet && typeof home.planet === 'object' && (home.planet.sphere || home.planet.round);
    if (!p.home && !round && p.terrain === undefined && p.blocks === undefined) patch.terrain = { shape: { desert: 'dunes', lava: 'craters', ice: 'hills', alien: 'craters', ocean: 'flat' }[p.biome] || 'hills' };
    const pl = { ...(clone(home.player) || {}) };
    if (!p.home && p.gravity !== undefined) pl.gravity = Number(p.gravity);
    else if (pl.gravity === undefined) pl.gravity = 1;
    patch.player = pl;
    return patch;
  }
  /** Shows the things on this planet and hides (and stills) the rest. */
  function showThings(id) {
    for (const e of W().entities) {
      if (e === W().player || e.remotePlayer || e.isTerrain || e.isBlocks) continue;
      const on = where(e);
      if (on === null) continue;
      const here = on === id;
      if (!here && !e._planetAway) { e._planetAway = { physics: e.physics, visible: e.visible }; e.visible = false; e.physics = 'none'; }
      else if (here && e._planetAway) { const a = e._planetAway; e._planetAway = null; e.physics = a.physics; e.visible = a.visible; }
    }
  }
  /** Where you arrive: the planet's spawn (a spawn thing on it), its `at`, or the top of the planet. */
  function arrival(p) {
    const sp = [...W().entities].find((e) => e.kind === 'spawn' && where(e) === p.id);
    if (sp) return [sp.x, sp.bottom + 0.05, sp.z];
    const at = Array.isArray(p.at) ? p.at : [0, 0, 0];
    const f = H.planet && H.planet.frame;
    if (f && f.on && f.fromScene) return f.fromScene({ position: at, rotation: 0 }).position;
    return at;
  }
  function arrive(p, fx) {
    const w = W(), g = G(), pl = w.player;
    const ship = g.vehicles && g.vehicles.current;
    if (ship) ship.data.planet = p.id;
    // (Cleared first: a config patch merges, and nothing of the last planet may stay.)
    const patch = patchFor(p), clear = {}, set = {};
    for (const [k, v] of Object.entries(patch)) { clear[k] = null; if (v !== null && v !== undefined) set[k] = v; }
    st.at = p.id;
    // (A round planet of another size starts the world again: what to carry over is kept for enter().)
    st.carry = { at: p.id, home: st.home, planet: JSON.stringify(set.planet ?? null), ship: Boolean(ship) };
    H.applyOps([{ op: 'config', patch: clear }, { op: 'config', patch: set }], { local: true });
    if (W() !== w) return;
    showThings(p.id);
    drawSky();
    if (pl) {
      w.checkpoint = arrival(p);
      H.respawn();
      w.checkpoint = null;
      if (ship && ship.alive) {
        ship.position = [pl.x + 4, pl.y + 1.5, pl.z + 4];
        ship.velocity = [0, 0, 0];
        try { g.vehicles.enter(ship); } catch { /* it can't be entered */ }
      }
    }
    g.emit('arrive', { planet: p.id, name: p.name, fx: Boolean(fx) });
    if (fx && g.ui) g.ui.message(p.home ? `Back home` : `${p.name}${p.gravity !== undefined && Number(p.gravity) !== 1 ? ` · gravity ${p.gravity}` : ''}`, 2.6);
  }
  /** The warp: stars streak past, white, and you are there. */
  function warp(p, then) {
    st.busy = true;
    const el = document.createElement('div');
    el.className = 'pl-warp';
    el.innerHTML = `<div class="pl-warp-name">${esc(p.name)}</div>`;
    document.body.appendChild(el);
    if (G().sound) G().sound('warp');
    // (On the world's clock, which a paused or background game holds too.)
    G().after(1.3, () => { try { then(); } catch (err) { H.report(err, 'planets'); } el.classList.add('out'); });
    G().after(2.3, () => { el.remove(); st.busy = false; });
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const goAction = H.sync && H.sync.action ? H.sync.action('planets:go', (d) => { const p = d && find(d.id); if (p) go(p, d.fx !== false); }) : null;
  function go(p, fx) {
    if (p.id === st.at) return;
    G().emit('travel', { from: st.at, to: p.id, name: p.name });
    if (fx) warp(p, () => arrive(p, true)); else arrive(p, false);
  }
  /** Travel (everyone in the room goes). False when it can't now (building, already going, no such planet). */
  function travel(id, o = {}) {
    const p = find(String(id));
    if (!p || st.busy || H.mode === 'build' || p.id === st.at) return false;
    const d = { id: p.id, fx: o.fx !== false };
    if (goAction) goAction(d); else go(p, d.fx);
    return true;
  }
  /** Whether the travel panel opens here: anywhere, or high up (space), or in a ship. */
  function canOpen() {
    const c = cfg();
    if (!c || H.mode === 'build' || st.busy) return false;
    if (c.travel === 'anywhere') return true;
    const g = G(), ship = g && g.vehicles && g.vehicles.current;
    if (ship && ship.vehicle && /rocket|spaceship/.test(ship.vehicle.type || '')) return true;
    const pl = W().player, from = Number(c.from) || 2500;
    if (!pl) return false;
    const round = H.planet && H.planet.frame && H.planet.frame.on && H.planet.heightOf;
    const alt = round ? H.planet.heightOf(pl.position) : H.planet && H.planet.altitude ? H.planet.altitude(pl.y) : pl.y;
    return alt > from;
  }

  // ------------------------------------------------------------------ the panel
  function ui() {
    if (st.ui) return st.ui;
    const css = document.createElement('style');
    css.textContent = `
      .pl-btn[hidden], .pl-panel[hidden] { display: none !important; }
      .pl-btn { position: fixed; right: 14px; top: max(64px, calc(env(safe-area-inset-top) + 56px)); z-index: 6; min-height: 44px; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.25); background: rgba(10,14,28,.82); color: #fff; font: 600 13px/1 system-ui, sans-serif; cursor: pointer; }
      .pl-panel { position: fixed; right: 14px; top: max(116px, calc(env(safe-area-inset-top) + 108px)); z-index: 6; width: min(300px, calc(100vw - 28px)); background: rgba(8,12,26,.94); border: 1px solid rgba(255,255,255,.16); border-radius: 14px; padding: 10px; display: grid; gap: 6px; color: #e8eef7; font: 500 13px/1.3 system-ui, sans-serif; }
      .pl-panel button { display: flex; gap: 10px; align-items: center; min-height: 48px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); color: inherit; font: inherit; cursor: pointer; text-align: left; }
      .pl-panel button:disabled { opacity: .55; cursor: default; }
      .pl-panel i { width: 26px; height: 26px; border-radius: 50%; flex: none; box-shadow: inset -6px -5px 0 rgba(0,0,0,.35); }
      .pl-panel small { display: block; opacity: .7; }
      .pl-warp { position: fixed; inset: 0; z-index: 30; pointer-events: none; background: radial-gradient(circle at 50% 50%, rgba(255,255,255,.95) 0, rgba(180,210,255,.4) 18%, rgba(4,6,18,.96) 60%); animation: pl-in 1.3s ease-in forwards; display: grid; place-items: center; }
      .pl-warp::before { content: ''; position: absolute; inset: -50%; background: repeating-conic-gradient(from 0deg, rgba(255,255,255,.5) 0 .4deg, transparent .4deg 5deg); animation: pl-spin 1.3s linear infinite; mix-blend-mode: screen; }
      .pl-warp.out { animation: pl-out 1s ease-out forwards; }
      .pl-warp-name { position: relative; font: 700 28px/1.2 system-ui, sans-serif; color: #fff; text-shadow: 0 2px 18px rgba(0,0,0,.6); letter-spacing: .04em; }
      @keyframes pl-in { from { opacity: 0; transform: scale(1.4); } to { opacity: 1; transform: scale(1); } }
      @keyframes pl-out { from { opacity: 1; } to { opacity: 0; } }
      @keyframes pl-spin { to { transform: rotate(40deg) scale(1.3); } }`;
    document.head.appendChild(css);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'pl-btn'; btn.textContent = '🪐 Planets'; btn.hidden = true;
    const panel = document.createElement('div');
    panel.className = 'pl-panel'; panel.hidden = true;
    for (const el of [btn, panel]) { el.addEventListener('pointerdown', (e) => e.stopPropagation()); document.body.appendChild(el); }
    btn.onclick = () => { st.open = !st.open; render(); };
    panel.onclick = (e) => { const b = e.target.closest && e.target.closest('button[data-id]'); if (b && travel(b.dataset.id)) { st.open = false; render(); } };
    st.ui = { btn, panel };
    return st.ui;
  }
  function render() {
    const u = ui(), ok = canOpen();
    u.btn.hidden = !ok;
    if (!ok) st.open = false;
    u.panel.hidden = !st.open;
    if (!st.open) return;
    u.panel.innerHTML = list().map((p) => `<button type="button" data-id="${esc(p.id)}" ${p.id === st.at ? 'disabled' : ''}><i style="background:${p.color && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : COLORS[p.biome]}"></i><span>${esc(p.name)}${p.id === st.at ? ' · you are here' : ''}<small>${esc(p.about || p.biome)}${p.gravity !== undefined ? ` · gravity ${esc(p.gravity)}` : ''}</small></span></button>`).join('');
  }

  // ------------------------------------------------------------------ a gate that sends you
  H.behavior('warp-gate', {
    title: 'A gate to another planet', group: 'Moving you', icon: '🪐',
    says: (o) => `walk in: travel to ${o.planet || 'the next planet'}`,
    defaults: { planet: '' },
    settings: [{ key: 'planet', label: 'To (a planet id; empty: the next)', type: 'text' }],
    start(e) { if (e.physics === 'none') e.physics = 'trigger'; else e.ghost = true; },
    hit(e, other, o) {
      if (other !== W().player || st.busy || st.cool > 0) return;
      const ids = list().map((p) => p.id);
      const to = o.planet && ids.includes(o.planet) ? o.planet : ids[(ids.indexOf(st.at) + 1) % ids.length];
      st.cool = 4;
      travel(to);
    },
  });

  // ------------------------------------------------------------------ every world
  H.hooks.world.push({
    enter() {
      st.busy = false; st.open = false;
      const c = W().graph.config || {};
      const carry = st.carry;
      st.carry = null;
      if (carry && JSON.stringify(c.planet ?? null) === carry.planet) {
        // The same game started again on the planet we went to (a round planet of another size): still there.
        st.at = carry.at; st.home = carry.home;
        drawSky();
        showThings(st.at);
        const p = find(st.at), pl = W().player;
        if (p && pl) { W().checkpoint = arrival(p); H.respawn(); W().checkpoint = null; }
        return;
      }
      st.at = 'home';
      st.home = {};
      for (const k of [...KEYS, 'player']) if (c[k] !== undefined) st.home[k] = clone(c[k]);
      drawSky();
      if (cfg()) showThings('home');
    },
    ops(ops) {
      if ((ops || []).some((o) => o && o.op === 'config' && o.patch && 'planets' in o.patch)) drawSky();
      // (A thing made while away is on the planet you are on.)
      if (st.at !== 'home') for (const o of ops || []) if (o && o.op === 'create' && o.entity && o.entity.id) { const e = G().entity(o.entity.id); if (e && !(e.data && e.data.planet)) e.data.planet = st.at; }
    },
  });
  let t = 0;
  H.hooks.frame.push((dt) => {
    st.cool = Math.max(0, st.cool - dt);
    t -= dt;
    if (t > 0 || !W()) return;
    t = 0.4;
    if (cfg() || st.ui) render();
  });
  if (H.sync && H.sync.state) H.sync.state('planets', { rate: 0.5, get: () => ({ at: st.at }), set: (s) => { if (s && s.at && s.at !== st.at && !st.busy) { const p = find(s.at); if (p) go(p, false); } } });

  const api = {
    get here() { return st.at; },
    list: () => list().map((p) => ({ id: p.id, name: p.name, biome: p.biome, gravity: p.gravity ?? 1, home: Boolean(p.home) })),
    travel: (id, o) => travel(id, o || {}),
    get canTravel() { return canOpen(); },
    open() { if (!canOpen() && !(cfg() && cfg().travel === 'anywhere')) return false; st.open = true; render(); return true; },
  };
  H.planets = api;
  H.hooks.game.push((game) => { game.planets = api; });
})();
