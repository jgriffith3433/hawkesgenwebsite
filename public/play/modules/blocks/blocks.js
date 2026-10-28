// Blocks (config.blocks; J, 2026-10-27: "make a voxel mining game"): a world of blocks you mine and build, grown from a
// seed (hills, caves, ores, trees). Drawn in chunks of 16 (one mesh each, the faces you can see, colored by vertex),
// each chunk a static body of its own triangles, remade when a block in it changes. The pickaxe (H.tools 'pickaxe'):
// hold click to mine what you look at (harder blocks take longer), R or shift+click places the block picked in the bar
// (1-9, the wheel, or a tap); what you mine goes in your bag; ⚒ crafts. Every change is shared with everyone playing
// (through the host, late joiners catch up). In the editor, editor.js builds with it and saves it (config.blocks.edits).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const C = window.HawkesBlocksCore;
  const W = () => H.world;
  const L = H.lib;
  const CH = C.CH;
  const SHARED_MAX = 20000;
  // Crafting: what it makes (name, how many) from what (name: count).
  const RECIPES = [
    ['planks', 4, { wood: 1 }],
    ['glass', 1, { sand: 2 }],
    ['brick', 2, { cobble: 2, dirt: 1 }],
    ['lamp', 1, { coal: 1, glass: 1 }],
    ['stone', 1, { cobble: 1, coal: 1 }],
  ];
  const PLACEABLE = C.TYPES.map((t, i) => i).filter((i) => i && i !== C.ID.bedrock);

  let cur = null;
  const sync = { set: null, want: null, all: null, lastWant: 0 };

  // ------------------------------------------------------------------ drawing
  function materials(scene) {
    const solid = new B.StandardMaterial('blocks', scene);
    solid.specularColor = new B.Color3(0.04, 0.04, 0.04);
    solid.emissiveColor = new B.Color3(0.08, 0.08, 0.09); // (caves are never pitch black)
    const glass = new B.StandardMaterial('blocks-glass', scene);
    glass.specularColor = new B.Color3(0.6, 0.6, 0.6);
    glass.alpha = 0.55;
    glass.backFaceCulling = false;
    return { solid, glass };
  }
  /** Where block-space (meters from block 0,0,0's corner) is in the world: the first chunk's node (round.js moves and
   *  turns every chunk alike, so one is enough). */
  function frame(t) {
    const n = t.anchor.node;
    n.computeWorldMatrix(true);
    const m = n.getWorldMatrix();
    return { m, inv: m.clone().invert() };
  }
  const TV = new B.Vector3();
  /** A world point -> blocks [x, y, z] (fractional). */
  function toBlocks(t, p) {
    const f = frame(t), s = t.c.scale;
    B.Vector3.TransformCoordinatesFromFloatsToRef(p[0], p[1], p[2], f.inv, TV);
    return [TV.x / s, TV.y / s, TV.z / s];
  }
  /** A world direction -> blocks. */
  function dirToBlocks(t, d) {
    const f = frame(t);
    B.Vector3.TransformNormalFromFloatsToRef(d[0], d[1], d[2], f.inv, TV);
    return [TV.x, TV.y, TV.z];
  }
  /** Blocks [x, y, z] (fractional) -> a world point. */
  function toWorld(t, b) {
    const f = frame(t), s = t.c.scale;
    B.Vector3.TransformCoordinatesFromFloatsToRef(b[0] * s, b[1] * s, b[2] * s, f.m, TV);
    return [TV.x, TV.y, TV.z];
  }
  function chunkKey(cx, cy, cz) { return `${cx},${cy},${cz}`; }
  /** One chunk's mesh, from the data (its glass a child mesh), and its body. */
  function drawChunk(t, ch) {
    const m = C.chunkMesh(t.c, t.data, ch.cx, ch.cy, ch.cz);
    const fill = (mesh, b) => {
      if (!b.indices.length) { mesh.setEnabled(false); return false; }
      const vd = new B.VertexData();
      vd.positions = b.positions; vd.normals = b.normals; vd.colors = b.colors; vd.indices = b.indices;
      vd.applyToMesh(mesh, true);
      mesh.setEnabled(true);
      return true;
    };
    const any = fill(ch.mesh, m.solid);
    if (m.glass.indices.length && !ch.glass) {
      ch.glass = new B.Mesh(`${ch.mesh.name}-glass`, t.scene);
      ch.glass.parent = ch.mesh; ch.glass.material = t.mat.glass; ch.glass.hasVertexAlpha = true; ch.glass.isPickable = false;
    }
    const glass = ch.glass ? fill(ch.glass, m.glass) : false;
    ch.version = (ch.version || 0) + 1;
    const e = ch.e;
    e.physics = any || glass ? 'static' : 'none';
    if (any || glass) H.physics.setShape(e, { type: 'mesh', id: `blocks-${t.id}-${ch.key}`, version: ch.version });
    e.measure();
    ch.dirty = false;
  }
  function build(t) {
    const c = t.c, s = c.scale, [w, h, d] = c.size;
    const root = new B.TransformNode('blocks-root', t.scene);
    root.position.set(c.at[0], c.at[1], c.at[2]);
    // A round world: the blocks stand upright where their middle is on the planet (the frame moves them from there).
    const cf = H.planet && H.planet.configure ? H.planet.configure() : null;
    if (cf && cf.on && cf.round && H.planet.frame.fromScene) {
      const at = H.planet.frame.fromScene({ position: c.at, rotation: 0 });
      root.position.set(at.position[0], at.position[1], at.position[2]);
      root.rotation.set(at.rotation[0] * Math.PI / 180, at.rotation[1] * Math.PI / 180, at.rotation[2] * Math.PI / 180);
    }
    root.computeWorldMatrix(true);
    const rm = root.getWorldMatrix();
    t.chunks = new Map();
    for (let cy = 0; cy * CH < h; cy++) for (let cz = 0; cz * CH < d; cz++) for (let cx = 0; cx * CH < w; cx++) {
      const key = chunkKey(cx, cy, cz);
      const mesh = new B.Mesh(`blocks-${t.id}-${key}`, t.scene);
      mesh.material = t.mat.solid;
      mesh.receiveShadows = true;
      const local = new B.Vector3(-w / 2 * s + cx * CH * s, cy * CH * s, -d / 2 * s + cz * CH * s);
      const p = B.Vector3.TransformCoordinates(local, rm);
      mesh.position.copyFrom(p);
      mesh.rotation.copyFrom(root.rotation);
      const e = new L.Entity(mesh, { name: 'Blocks', tag: 'blocks', physics: 'static', grab: false }, 'blocks');
      e.isBlocks = true;
      e.data.blocks = true;
      const ch = { key, cx, cy, cz, mesh, e, glass: null, dirty: true };
      t.chunks.set(key, ch);
      if (!cx && !cy && !cz) t.anchor = e;
    }
    root.dispose();
    for (const ch of t.chunks.values()) drawChunk(t, ch);
  }
  function make(c, scene) {
    const t = { id: ++make.n, c, scene, mat: materials(scene), shared: [], saved: c.edits.slice(), base: null, data: null, chunks: null, anchor: null, version: 0 };
    t.base = C.generate({ ...c, edits: [] });
    t.data = t.base.slice();
    for (const e of c.edits) t.data[C.index(c, e[0], e[1], e[2])] = e[3];
    build(t);
    return t;
  }
  make.n = 0;
  function dispose(t) {
    for (const ch of t.chunks.values()) { if (ch.e.alive) ch.e.destroy(); if (!ch.mesh.isDisposed()) ch.mesh.dispose(); }
    t.mat.solid.dispose(); t.mat.glass.dispose();
    if (t.mark) t.mark.dispose();
  }
  /** A block changed: its chunk (and a neighbour's, on a border) is drawn again soon. */
  function touch(t, x, y, z) {
    const mark = (X, Y, Z) => { const ch = t.chunks.get(chunkKey(Math.floor(X / CH), Math.floor(Y / CH), Math.floor(Z / CH))); if (ch) ch.dirty = true; };
    mark(x, y, z);
    if (x % CH === 0) mark(x - 1, y, z); if (x % CH === CH - 1) mark(x + 1, y, z);
    if (y % CH === 0) mark(x, y - 1, z); if (y % CH === CH - 1) mark(x, y + 1, z);
    if (z % CH === 0) mark(x, y, z - 1); if (z % CH === CH - 1) mark(x, y, z + 1);
  }
  /** Changes blocks here ([x, y, z, type] each); what was there before comes back. */
  function apply(t, list) {
    const before = [];
    for (const e of list) {
      if (!C.validEdit(e, t.c)) continue;
      const i = C.index(t.c, e[0], e[1], e[2]), v = C.typeOf(e[3]);
      if (t.data[i] === v) continue;
      before.push([e[0], e[1], e[2], t.data[i]]);
      t.data[i] = v;
      touch(t, e[0], e[1], e[2]);
    }
    if (before.length) t.version++;
    return before;
  }
  function redraw(t, max = 4) {
    let n = 0;
    for (const ch of t.chunks.values()) if (ch.dirty) { drawChunk(t, ch); if (++n >= max) break; }
    return n;
  }

  // ------------------------------------------------------------------ playing together
  /** Changes for everyone: through the host, once each (a game with nobody else applies them at once). */
  function share(list) {
    const t = cur;
    if (!t) return;
    const ok = list.filter((e) => C.validEdit(e, t.c)).map((e) => [e[0], e[1], e[2], C.typeOf(e[3])]);
    if (!ok.length) return;
    if (sync.set) sync.set({ e: ok }); else applyShared(ok);
  }
  function applyShared(list) {
    const t = cur;
    if (!t) return;
    apply(t, list);
    t.shared.push(...list);
    if (t.shared.length > SHARED_MAX) t.shared.splice(0, t.shared.length - SHARED_MAX);
  }
  function setupSync() {
    if (!H.sync || sync.set) return;
    sync.set = H.sync.action('blocks:set', (d) => { if (d && Array.isArray(d.e)) applyShared(d.e); });
    sync.all = H.sync.action('blocks:all', (d) => {
      const t = cur;
      if (!t || !d || d.to !== H.sync.me || !Array.isArray(d.e)) return;
      // Back to the saved world, then the host's changes.
      const now = t.base.slice();
      for (const e of t.saved) now[C.index(t.c, e[0], e[1], e[2])] = e[3];
      const list = d.e.filter((e) => C.validEdit(e, t.c));
      for (const e of list) now[C.index(t.c, e[0], e[1], e[2])] = C.typeOf(e[3]);
      apply(t, C.diff(t.c, t.data, now).map((e) => [e[0], e[1], e[2], now[C.index(t.c, e[0], e[1], e[2])]]));
      t.shared = list;
    });
    sync.want = H.sync.action('blocks:want', (d, { authoritative, from }) => {
      const t = cur;
      if (!authoritative || !t || !H.sync.isHost) return;
      const to = (from && from.id) || (d && d.me);
      if (to && to !== H.sync.me) sync.all({ to, e: t.shared });
    });
    H.sync.state('blocks', {
      rate: 1,
      get: () => (cur ? { n: cur.shared.length, h: C.fingerprint(cur.shared) } : { n: 0, h: 0 }),
      set: (st) => {
        const t = cur;
        if (!t || !st || (st.n === t.shared.length && st.h === C.fingerprint(t.shared))) return;
        if (performance.now() - sync.lastWant < 4000) return;
        sync.lastWant = performance.now();
        sync.want({ me: H.sync.me });
      },
    });
  }

  // ------------------------------------------------------------------ the bag, the bar, crafting
  const bag = { items: new Map(), pick: C.ID.dirt };
  const nameOf = (v) => (C.TYPES[C.typeOf(v)] || C.TYPES[0])[0];
  const creative = () => Boolean(cur && (cur.c.creative || H.mode === 'build'));
  function count(type) { return creative() ? Infinity : bag.items.get(C.typeOf(type)) || 0; }
  function give(type, n = 1) {
    const v = C.typeOf(type);
    if (v <= 0 || !(n > 0)) return 0;
    bag.items.set(v, (bag.items.get(v) || 0) + Math.floor(n));
    if (!bag.items.has(bag.pick) || !bag.items.get(bag.pick)) bag.pick = v;
    ui.render();
    return bag.items.get(v);
  }
  function take(type, n = 1) {
    if (creative()) return true;
    const v = C.typeOf(type), have = bag.items.get(v) || 0;
    if (have < n) return false;
    if (have === n) bag.items.delete(v); else bag.items.set(v, have - n);
    ui.render();
    return true;
  }
  /** What the bar shows: everything placeable while creative, else what you carry. */
  function barList() {
    if (creative()) return PLACEABLE;
    return [...bag.items.keys()].filter((v) => PLACEABLE.includes(v) && bag.items.get(v) > 0);
  }
  function canCraft(r) { return Object.entries(r[2]).every(([k, n]) => count(k) >= n); }
  function craft(name) {
    const r = RECIPES.find((x) => x[0] === name);
    if (!r || !canCraft(r)) return false;
    if (!creative()) for (const [k, n] of Object.entries(r[2])) take(k, n);
    give(r[0], creative() ? 0 : r[1]);
    if (H.game) H.game.emit('craft', { what: r[0], count: r[1] });
    ui.render();
    return true;
  }
  function select(type) { const v = C.typeOf(type); if (v > 0) { bag.pick = v; ui.render(); } return nameOf(bag.pick); }

  const ui = {
    el: null, craftOpen: false, shown: false,
    show(on) { this.shown = on; if (on && !this.el) this.make(); if (this.el) this.el.hidden = !on; if (on) this.render(); },
    make() {
      const css = document.createElement('style');
      css.textContent = `
        .bk-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: max(78px, calc(env(safe-area-inset-bottom) + 70px)); z-index: 5; display: flex; gap: 4px; align-items: flex-end; font: 600 11px/1 system-ui, sans-serif; color: #fff; pointer-events: auto; }
        .bk-bar button { position: relative; width: 44px; height: 44px; border-radius: 8px; border: 2px solid rgba(255,255,255,.25); background: rgba(10,14,22,.7); cursor: pointer; padding: 0; color: inherit; font: inherit; }
        .bk-bar button.on { border-color: #fff; box-shadow: 0 0 0 2px rgba(255,255,255,.35); }
        .bk-bar button i { position: absolute; inset: 9px; border-radius: 3px; box-shadow: inset 0 -5px 0 rgba(0,0,0,.25); }
        .bk-bar button b { position: absolute; right: 3px; bottom: 2px; text-shadow: 0 1px 2px #000; }
        .bk-bar .bk-craft { width: 44px; font-size: 20px; }
        .bk-bar .bk-empty { padding: 10px 12px; border-radius: 8px; background: rgba(10,14,22,.7); opacity: .85; }
        .bk-recipes { position: absolute; bottom: 52px; left: 50%; transform: translateX(-50%); background: rgba(10,14,22,.92); border: 1px solid rgba(255,255,255,.18); border-radius: 10px; padding: 8px; display: grid; gap: 4px; min-width: 220px; }
        .bk-recipes button { width: auto; height: auto; padding: 7px 9px; text-align: left; font: 500 12px/1.3 system-ui, sans-serif; }
        .bk-recipes button:disabled { opacity: .45; cursor: default; }`;
      document.head.appendChild(css);
      const el = document.createElement('div');
      el.className = 'bk-bar';
      el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      el.addEventListener('click', (ev) => {
        const b = ev.target.closest && ev.target.closest('button');
        if (!b) return;
        if (b.dataset.t) select(Number(b.dataset.t));
        else if (b.dataset.craft) craft(b.dataset.craft);
        else if (b.classList.contains('bk-craft')) { this.craftOpen = !this.craftOpen; this.render(); }
      });
      document.body.appendChild(el);
      this.el = el;
    },
    render() {
      const el = this.el;
      if (!el || !this.shown) return;
      const list = barList();
      if (list.length && !list.includes(bag.pick)) bag.pick = list[0];
      const cell = (v, i) => `<button type="button" data-t="${v}" class="${v === bag.pick ? 'on' : ''}" title="${nameOf(v)}${i < 9 ? ` (${i + 1})` : ''}"><i style="background:${C.TYPES[v][2] || C.TYPES[v][1]}"></i>${creative() ? '' : `<b>${bag.items.get(v)}</b>`}</button>`;
      const recipes = this.craftOpen ? `<div class="bk-recipes">${RECIPES.map((r) => `<button type="button" data-craft="${r[0]}" ${canCraft(r) ? '' : 'disabled'}>${r[1]} ${r[0]} ← ${Object.entries(r[2]).map(([k, n]) => `${n} ${k}`).join(' + ')}</button>`).join('')}</div>` : '';
      el.innerHTML = (list.length ? list.slice(0, 18).map(cell).join('') : '<span class="bk-empty">Mine blocks to fill your bag</span>') + `<button type="button" class="bk-craft" title="Craft">⚒</button>${recipes}`;
    },
  };

  // ------------------------------------------------------------------ the pickaxe
  /** What the crosshair is on: { x, y, z, n, type } (blocks) or null. */
  function aim(reach) {
    const t = cur, w = W();
    if (!t || !w || !w.scene.activeCamera) return null;
    const cam = w.scene.activeCamera, p = cam.globalPosition, d = cam.getDirection(B.Axis.Z);
    const o = toBlocks(t, [p.x, p.y, p.z]), dir = dirToBlocks(t, [d.x, d.y, d.z]);
    // (Third person: the reach counts from the player, not from the camera behind them.)
    const pl = w.player, extra = pl && pl._view !== 'first' ? Math.hypot(p.x - pl.x, p.y - pl.y, p.z - pl.z) : 0;
    return C.ray(t.c, t.data, o, dir, ((reach || t.c.reach) + extra) / t.c.scale, true);
  }
  /** Whether a block at x, y, z would be inside a player or a thing that moves. */
  function blocked(t, x, y, z) {
    const s = t.c.scale;
    for (const e of W().entities) {
      if (!e.alive || e.isBlocks || !(e === W().player || e.remotePlayer || e.physics === 'dynamic')) continue;
      const b = toBlocks(t, [e.x, e.y + e.offset[1], e.z]);
      const hx = e.half[0] / s + 0.5, hy = e.half[1] / s + 0.5, hz = e.half[2] / s + 0.5;
      if (Math.abs(b[0] - (x + 0.5)) < hx - 0.05 && Math.abs(b[1] - (y + 0.5)) < hy - 0.05 && Math.abs(b[2] - (z + 0.5)) < hz - 0.05) return true;
    }
    return false;
  }
  /** Takes a block out (it drops into the bag unless creative). */
  function mine(x, y, z, by) {
    const t = cur;
    if (!t) return false;
    const v = C.get(t.c, t.data, x, y, z);
    if (!v || !C.TYPES[v][3]) return false;
    share([[x, y, z, 0]]);
    const drop = C.TYPES[v][4];
    if (drop && !creative() && by !== 'script') give(drop, 1);
    const at = toWorld(t, [x + 0.5, y + 0.5, z + 0.5]);
    const g = H.game;
    if (g) {
      if (g.burst) g.burst(at, { color: C.TYPES[v][2] || C.TYPES[v][1], count: 12, speed: 3, size: 0.12 * t.c.scale, life: 0.5 });
      if (g.sound) g.sound('break');
      g.emit('mine', { type: C.TYPES[v][0], at: [x, y, z], point: at, by: by || 'player' });
    }
    return true;
  }
  /** Puts a block in (from the bag unless creative). */
  function place(x, y, z, type, by) {
    const t = cur, v = C.typeOf(type);
    if (!t || v <= 0 || !C.inside(t.c, x, y, z) || C.get(t.c, t.data, x, y, z)) return false;
    if (by !== 'script' && blocked(t, x, y, z)) return false;
    if (by !== 'script' && !take(v, 1)) return false;
    share([[x, y, z, v]]);
    const g = H.game;
    if (g) { if (g.sound) g.sound('place'); g.emit('place', { type: C.TYPES[v][0], at: [x, y, z], by: by || 'player' }); }
    return true;
  }

  function marker(t) {
    if (t.mark && !t.mark.isDisposed()) return t.mark;
    const s = t.c.scale;
    const m = B.MeshBuilder.CreateBox('blocks-aim', { size: s * 1.02 }, t.scene);
    const mat = new B.StandardMaterial('blocks-aim', t.scene);
    mat.diffuseColor = B.Color3.Black(); mat.emissiveColor = new B.Color3(0.05, 0.05, 0.05); mat.alpha = 0; mat.specularColor = B.Color3.Black();
    m.material = mat; m.isPickable = false; m.metadata = { decor: true };
    m.enableEdgesRendering(); m.edgesWidth = 2.5 * s; m.edgesColor = new B.Color4(0, 0, 0, 0.7);
    t.mark = m;
    return m;
  }
  function showMark(hit, progress) {
    const t = cur;
    if (!t) return;
    const m = marker(t);
    if (!hit || hit.floor) { m.setEnabled(false); return; }
    m.setEnabled(true);
    const p = toWorld(t, [hit.x + 0.5, hit.y + 0.5, hit.z + 0.5]);
    m.position.set(p[0], p[1], p[2]);
    m.rotation.copyFrom(t.anchor.node.rotation);
    m.material.alpha = Math.min(0.6, progress * 0.6); // (darker as it cracks)
  }

  function viewModel(scene) {
    const root = new B.TransformNode('pickaxe', scene);
    const wood = new B.StandardMaterial('pickaxe-wood', scene); wood.diffuseColor = B.Color3.FromHexString('#8a5a32'); wood.specularColor = new B.Color3(0.05, 0.05, 0.05);
    const steel = new B.StandardMaterial('pickaxe-head', scene); steel.diffuseColor = B.Color3.FromHexString('#9aa3ad'); steel.specularColor = new B.Color3(0.5, 0.5, 0.55);
    const handle = B.MeshBuilder.CreateBox('pickaxe-handle', { width: 0.05, height: 0.6, depth: 0.05 }, scene);
    handle.material = wood; handle.parent = root;
    const head = B.MeshBuilder.CreateBox('pickaxe-headbar', { width: 0.42, height: 0.07, depth: 0.07 }, scene);
    head.material = steel; head.parent = root; head.position.y = 0.28;
    for (const m of [handle, head]) { m.isPickable = false; m.metadata = { decor: true }; m.renderingGroupId = 1; }
    return root;
  }
  function touchButtons(state) {
    if (!H.touchUi) return;
    const wrap = document.createElement('div');
    wrap.className = 'blocks-touch';
    wrap.style.cssText = 'position:fixed;right:110px;bottom:max(30px,env(safe-area-inset-bottom));display:flex;gap:10px;z-index:5;';
    for (const [key, label] of [['g', 'Mine'], ['r', 'Place']]) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.style.cssText = 'width:66px;height:66px;border-radius:50%;border:1px solid rgba(255,255,255,.45);background:rgba(255,255,255,.14);color:#fff;font:600 15px/1 system-ui,sans-serif;touch-action:none;';
      H.bindTouchKey(b, key);
      wrap.appendChild(b);
    }
    document.body.appendChild(wrap);
    state.touch = wrap;
  }

  H.tools.register('pickaxe', {
    title: 'Pickaxe: hold click to mine, R or shift+click places the block picked (1-9, the wheel)',
    kind: 'tool',
    equip(ctx) {
      const s = ctx.state;
      s.cool = 0; s.swing = 0; s.target = null; s.progress = 0;
      s.mesh = viewModel(W().scene);
      touchButtons(s);
      ui.show(true);
      ctx.game.ui.message(cur ? (H.touchUi ? 'Pickaxe: hold Mine, tap Place' : 'Pickaxe: hold click to mine, R places') : 'Nothing to mine here: this world has no blocks', 1.8);
    },
    unequip(ctx) {
      const s = ctx.state;
      if (s.mesh) s.mesh.dispose(false, true);
      if (s.touch) s.touch.remove();
      ui.show(false);
      showMark(null, 0);
    },
    step(dt, ctx) {
      const s = ctx.state, input = H.input, t = cur;
      s.cool = Math.max(0, s.cool - dt);
      if (!t || W().paused) return;
      const power = Math.max(0.2, Number(ctx.opts.power) || 1);
      const hit = aim(Number(ctx.opts.reach) || 0);
      // The bar: 1-9 picks, the wheel turns through it.
      const list = barList();
      for (let i = 0; i < 9 && i < list.length; i++) if (ctx.game.input.pressed(String(i + 1))) select(list[i]);
      if (input.mouse.wheel && list.length && (input.mouse.locked || W().player._view === 'first')) {
        const i = Math.max(0, list.indexOf(bag.pick));
        select(list[(i + Math.sign(input.mouse.wheel) + list.length) % list.length]);
      }
      const aimed = input.mouse.locked || (W().player && W().player.mouse === 'free');
      const shift = input.held.has('shift');
      const mining = input.held.has('g') || (input.mouse.down && aimed && !shift);
      const placing = input.held.has('r') || (input.mouse.pressed && aimed && shift);
      if (placing && s.cool <= 0) {
        s.cool = 0.22; s.swing = 1;
        if (hit) {
          const x = hit.x + hit.n[0], y = hit.y + hit.n[1], z = hit.z + hit.n[2];
          if (!place(x, y, z, bag.pick) && !count(bag.pick)) ctx.game.ui.message(`No ${nameOf(bag.pick)} left: mine some`, 1);
        }
      }
      const same = hit && !hit.floor && s.target && hit.x === s.target[0] && hit.y === s.target[1] && hit.z === s.target[2];
      if (!mining || !hit || hit.floor) { s.progress = 0; s.target = null; }
      else {
        if (!same) { s.target = [hit.x, hit.y, hit.z]; s.progress = 0; }
        const hard = C.TYPES[hit.type][3];
        if (!hard) { if (!s.told) { ctx.game.ui.message(`${nameOf(hit.type)} can't be mined`, 1); s.told = true; } }
        else {
          s.progress += dt * power / (creative() ? Math.min(hard, 0.15) : hard);
          if (s.swing <= 0) s.swing = 1;
          if (s.progress >= 1) { mine(hit.x, hit.y, hit.z, 'player'); s.progress = 0; s.target = null; }
        }
      }
      showMark(hit, s.progress);
    },
    frame(dt, ctx) {
      const s = ctx.state, w = W();
      if (!s.mesh || !w) return;
      s.mesh.parent = w.scene.activeCamera;
      s.mesh.setEnabled(Boolean(w.player && w.player._view === 'first'));
      s.swing = Math.max(0, s.swing - dt * 4);
      const k = Math.sin(s.swing * Math.PI);
      s.mesh.position.set(0.34, -0.36 - k * 0.08, 0.6 + k * 0.1);
      s.mesh.rotation.set(-0.3 + k * 1.1, -0.25, 0.25);
    },
  });

  // ------------------------------------------------------------------ the feature and the API
  /** The player never stays inside blocks (a world grown round the start, a block placed by someone else). */
  function unstick(t) {
    const p = W().player;
    if (!p || !p.alive) return;
    const b = toBlocks(t, [p.x, p.bottom + 0.05, p.z]);
    const x = Math.floor(b[0]), z = Math.floor(b[2]);
    let y = Math.floor(b[1]);
    if (!C.inside(t.c, x, Math.max(0, y), z)) return;
    const solid = (yy) => { const v = C.get(t.c, t.data, x, yy, z); return v && v !== C.ID.leaves; };
    if (!solid(y) && !solid(y + 1)) return;
    while (y < t.c.size[1] && (solid(y) || solid(y + 1))) y++;
    const to = toWorld(t, [b[0], y + 0.02, b[2]]);
    p.position = [to[0], to[1] + (p.y - p.bottom), to[2]];
    p.vy = 0;
  }
  const api = {
    get active() { return Boolean(cur); },
    get size() { return cur ? cur.c.size.slice() : null; },
    get types() { return C.TYPES.map((t) => t[0]); },
    get(x, y, z) { return cur ? nameOf(C.get(cur.c, cur.data, x, y, z)) : 'air'; },
    set(x, y, z, type) { if (!cur || C.typeOf(type) < 0) return false; share([[x | 0, y | 0, z | 0, C.typeOf(type)]]); return true; },
    fill(a, b, type) {
      if (!cur || C.typeOf(type) < 0) return 0;
      const v = C.typeOf(type), list = [];
      for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++) for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) if (C.inside(cur.c, x, y, z)) list.push([x, y, z, v]);
      share(list.slice(0, 20000));
      return Math.min(list.length, 20000);
    },
    mine: (x, y, z) => mine(x, y, z, 'script'),
    place: (x, y, z, type) => place(x, y, z, type, 'script'),
    /** A world point -> the block it is in [x, y, z]. */
    at(p) { if (!cur) return null; const b = toBlocks(cur, L.vec(p)); return b.map(Math.floor); },
    /** A block's middle in the world. */
    toWorld(x, y, z) { return cur ? toWorld(cur, [x + 0.5, y + 0.5, z + 0.5]) : null; },
    /** The top of a column: the highest solid block's y (or -1). */
    top(x, z) { if (!cur) return -1; for (let y = cur.c.size[1] - 1; y >= 0; y--) if (C.get(cur.c, cur.data, x, y, z)) return y; return -1; },
    aim: (reach) => aim(reach),
    give, take, count: (type) => count(type), craft, select,
    get picked() { return nameOf(bag.pick); },
    get bag() { return Object.fromEntries([...bag.items].map(([k, n]) => [nameOf(k), n])); },
    get recipes() { return RECIPES.map((r) => ({ makes: r[0], count: r[1], from: { ...r[2] } })); },
    /** The edits that make the world as it is now from its seed (what the editor saves). */
    edits() { return cur ? C.diff(cur.c, cur.base, cur.data).map((e) => [e[0], e[1], e[2], cur.data[C.index(cur.c, e[0], e[1], e[2])]]) : []; },
    get creative() { return creative(); },
    _: { get cur() { return cur; }, redraw: () => cur && redraw(cur, 1e9), toBlocks: (p) => cur && toBlocks(cur, p), ui, bag },
  };
  H.blocks = api;
  H.hooks.game.push((game) => { game.blocks = api; });

  function start(value, ctx) {
    const c = C.config(value);
    if (!c) return;
    bag.items.clear(); bag.pick = C.ID.dirt;
    cur = make(c, ctx.scene);
    ctx.state.t = cur;
    setupSync();
    unstick(cur);
  }
  H.features.register('blocks', {
    apply: start,
    change(value, old, ctx) {
      const c = C.config(value), t = ctx.state.t;
      if (!c || !t || c.key !== t.c.key) { if (t) dispose(t); cur = null; ctx.state.t = null; if (c) start(value, ctx); return; }
      // The same world with other saved edits (the editor saved, an undo): only the blocks that differ change.
      const now = t.base.slice();
      for (const e of c.edits) now[C.index(c, e[0], e[1], e[2])] = e[3];
      for (const e of t.shared) now[C.index(c, e[0], e[1], e[2])] = e[3];
      const list = [];
      for (let i = 0; i < now.length; i++) if (now[i] !== t.data[i]) { const x = i % c.size[0], z = Math.floor(i / c.size[0]) % c.size[2], y = Math.floor(i / (c.size[0] * c.size[2])); list.push([x, y, z, now[i]]); }
      apply(t, list);
      t.saved = c.edits.slice();
      t.c = { ...c };
      redraw(t, 1e9);
    },
    update(dt, ctx) {
      const t = ctx.state.t;
      if (!t) return;
      redraw(t, 4);
      if (!t.anchor.alive) return;
      ctx.state.unstick = (ctx.state.unstick || 0) + dt;
      if (ctx.state.unstick > 0.25) { ctx.state.unstick = 0; unstick(t); }
    },
    dispose(ctx) { if (ctx.state.t) dispose(ctx.state.t); cur = null; ctx.state.t = null; ui.show(false); },
    codex: {
      title: 'Blocks', group: 'World',
      what: 'A world of blocks you mine and build: hills, caves, ores and trees grown from a seed. Hold the pickaxe: click mines, R places.',
      value: { world: 'hills', size: [32, 24, 32] },
      fields: [['world', `${Object.keys(C.WORLDS).join(', ')}`, 'hills'], ['size', 'blocks [wide, tall, deep]', '[48, 32, 48]'], ['scale', 'meters a block', '1'], ['seed', 'which world', '1'], ['creative', 'every block, no bag', 'false']],
    },
  });
})();
