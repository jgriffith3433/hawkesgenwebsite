// Fishing: the 'rod' tool, fish that bite, the reel-in, a table of species, a catch log, and 'catch' events (so games
// can run fishing contests).
//   Hold to charge, let go to cast (the bobber flies in an arc and floats). Wait: little nibbles, then a bite (the
//   bobber goes under, "!"): click (phones: tap 🎣) in time to hook it. Reeling: hold to reel; keep the tension in the
//   green: too much and the line snaps, slack too long and it gets away. J (phones: 📖) opens the catch log.
//   Species: common, uncommon, rare, legendary (and the odd old boot), fresh or salt water, sizes, stand-in fish shapes;
//   a model named after a species ("trout", or "fish-trout") is used when the game has one.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const W = () => H.world;
  const G = () => H.game;
  const X = H.water._;
  const BK = H.water._bucket;
  const clamp = X.clamp;
  const PHONE = X.PHONE;
  const rand = (a, b) => a + Math.random() * (b - a);

  // ------------------------------------------------------------------ the species
  const RARITY = {
    junk: { weight: 5, color: '#8b8b8b', points: 1, label: 'Junk' },
    common: { weight: 60, color: '#cbd5e1', points: 10, label: 'Common' },
    uncommon: { weight: 26, color: '#4ade80', points: 25, label: 'Uncommon' },
    rare: { weight: 8, color: '#60a5fa', points: 75, label: 'Rare' },
    legendary: { weight: 1.5, color: '#f59e0b', points: 300, label: 'Legendary' },
  };
  const ORDER = ['common', 'uncommon', 'rare', 'legendary', 'junk'];
  const DEFAULTS = [
    { id: 'minnow', name: 'Minnow', rarity: 'common', water: 'fresh', kg: [0.01, 0.05], cm: [4, 9], color: '#9fb4a8', strength: 0.15 },
    { id: 'perch', name: 'Perch', rarity: 'common', water: 'fresh', kg: [0.1, 0.8], cm: [12, 30], color: '#c9b23a', strength: 0.35 },
    { id: 'bluegill', name: 'Bluegill', rarity: 'common', water: 'fresh', kg: [0.1, 0.6], cm: [10, 25], color: '#4f7fb0', strength: 0.3 },
    { id: 'carp', name: 'Carp', rarity: 'common', water: 'fresh', kg: [1, 8], cm: [30, 70], color: '#a07a3a', strength: 0.5 },
    { id: 'sardine', name: 'Sardine', rarity: 'common', water: 'salt', kg: [0.05, 0.2], cm: [12, 20], color: '#9cb6c9', strength: 0.2 },
    { id: 'mackerel', name: 'Mackerel', rarity: 'common', water: 'salt', kg: [0.3, 1.5], cm: [25, 45], color: '#3d7a8a', strength: 0.4 },
    { id: 'trout', name: 'Rainbow trout', rarity: 'uncommon', water: 'fresh', kg: [0.5, 4], cm: [30, 60], color: '#c98aa0', strength: 0.55 },
    { id: 'bass', name: 'Largemouth bass', rarity: 'uncommon', water: 'fresh', kg: [0.5, 5], cm: [30, 60], color: '#5c7a3a', strength: 0.6 },
    { id: 'catfish', name: 'Catfish', rarity: 'uncommon', water: 'fresh', kg: [1, 20], cm: [40, 110], color: '#6b6155', strength: 0.65, whiskers: true },
    { id: 'snapper', name: 'Red snapper', rarity: 'uncommon', water: 'salt', kg: [1, 10], cm: [35, 80], color: '#d4553f', strength: 0.6 },
    { id: 'pike', name: 'Pike', rarity: 'rare', water: 'fresh', kg: [2, 15], cm: [60, 130], color: '#6f8a4a', strength: 0.75, long: true },
    { id: 'salmon', name: 'Salmon', rarity: 'rare', water: 'any', kg: [3, 15], cm: [60, 100], color: '#d98b6a', strength: 0.75 },
    { id: 'koi', name: 'Koi', rarity: 'rare', water: 'fresh', kg: [1, 10], cm: [40, 80], color: '#f5f0e6', spots: '#f26a1b', strength: 0.5 },
    { id: 'tuna', name: 'Bluefin tuna', rarity: 'rare', water: 'salt', kg: [30, 250], cm: [120, 250], color: '#2c4a7a', strength: 0.95 },
    { id: 'golden-carp', name: 'Golden carp', rarity: 'legendary', water: 'fresh', kg: [5, 20], cm: [60, 100], color: '#f4c430', strength: 0.85, glow: true },
    { id: 'old-whiskers', name: 'Old Whiskers', rarity: 'legendary', water: 'fresh', kg: [60, 150], cm: [180, 260], color: '#3f3a33', strength: 1, whiskers: true },
    { id: 'swordfish', name: 'Swordfish', rarity: 'legendary', water: 'salt', kg: [50, 300], cm: [200, 400], color: '#4a6b8a', strength: 1, sword: true },
    { id: 'moonfish', name: 'Moonfish', rarity: 'legendary', water: 'any', kg: [2, 6], cm: [30, 50], color: '#c7d2fe', strength: 0.8, glow: true },
    { id: 'old-boot', name: 'Old boot', rarity: 'junk', water: 'any', kg: [0.4, 1.2], cm: [25, 32], color: '#5b4636', strength: 0.1, shape: 'boot' },
    { id: 'tin-can', name: 'Tin can', rarity: 'junk', water: 'any', kg: [0.05, 0.1], cm: [10, 12], color: '#9aa3ad', strength: 0.05, shape: 'can' },
  ];
  const species = new Map(DEFAULTS.map((s) => [s.id, { ...s }]));
  const norm = (s) => {
    const id = String(s.id || s.name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
    if (!id) throw new Error('game.water.fish.add({ id, name, rarity, water, kg: [min, max], cm: [min, max], color })');
    const kg = Array.isArray(s.kg) ? s.kg.map(Number) : [Number(s.kg) || 0.5, Number(s.kg) || 2];
    const cm = Array.isArray(s.cm) ? s.cm.map(Number) : [Math.round(20 * Math.cbrt(kg[0] || 0.5)) + 5, Math.round(30 * Math.cbrt(kg[1] || 2)) + 10];
    return { strength: 0.5, water: 'any', color: '#7aa6c2', ...s, id, name: s.name || id, rarity: RARITY[s.rarity] ? s.rarity : 'common', kg, cm };
  };

  /** The fish that live in a body of water: its `fish` setting (true, false, a list of ids, "fresh" or "salt") and
   *  `species` (its own: [{ id, name, ... }]), and whether it is salt water. */
  function candidates(body) {
    if (!body || body.fish === false || body.fish === 'none') return [];
    const own = [];
    const extra = body.kind === 'ocean' ? (L.effectiveConfig().water || {}).species : body.entity && body.entity.spec && body.entity.spec.shape && body.entity.spec.shape.species;
    if (Array.isArray(extra)) for (const s of extra) { try { own.push(norm(s)); } catch { /* skip */ } }
    const all = [...species.values(), ...own];
    if (Array.isArray(body.fish)) { const ids = body.fish.map((x) => String(x).toLowerCase()); return all.filter((s) => ids.includes(s.id) || ids.includes(s.name.toLowerCase())); }
    if (own.length && body.fish === 'own') return own;
    const salt = body.fish === 'salt' ? true : body.fish === 'fresh' ? false : Boolean(body.salt);
    return all.filter((s) => s.water === 'any' || (s.water === 'salt') === salt);
  }
  /** Picks a fish from the water: rarer ones less often (luck makes them likelier, so does rain), a size in its range
   *  (big ones rarer). Returns { id, name, rarity, weight (kg), length (cm), points, color, species } or null. */
  function roll(body, o = {}) {
    const list = candidates(body);
    if (!list.length) return null;
    const luck = Math.max(0, Number(o.luck ?? 1)) * (1 + (H.water.rain || 0) * 0.5);
    let total = 0;
    const weights = list.map((s) => { const r = RARITY[s.rarity]; let wgt = (s.chance ?? r.weight) * (s.rarity === 'rare' || s.rarity === 'legendary' ? luck : 1); if (o.junk === false && s.rarity === 'junk') wgt = 0; total += wgt; return wgt; });
    if (total <= 0) return null;
    let x = Math.random() * total, sp = list[0];
    for (let i = 0; i < list.length; i++) { x -= weights[i]; if (x <= 0) { sp = list[i]; break; } }
    return sized(sp);
  }
  function sized(sp, weight) {
    const u = Math.pow(Math.random(), 2.2);
    const kg = weight !== undefined ? Number(weight) : sp.kg[0] + (sp.kg[1] - sp.kg[0]) * u;
    const k = sp.kg[1] > sp.kg[0] ? clamp((kg - sp.kg[0]) / (sp.kg[1] - sp.kg[0]), 0, 1) : 0.5;
    const cm = sp.cm[0] + (sp.cm[1] - sp.cm[0]) * Math.cbrt(k);
    const pts = Math.round((sp.points ?? RARITY[sp.rarity].points) * (0.6 + k * 0.8));
    return { id: sp.id, name: sp.name, rarity: sp.rarity, weight: Math.round(kg * 100) / 100, length: Math.round(cm), points: pts, color: sp.color, species: sp, big: k };
  }

  // ------------------------------------------------------------------ fish you can see (stand-ins, or a model by name)
  function modelFor(sp) {
    if (sp.model && H.assets.has(sp.model)) return sp.model;
    for (const n of [`fish ${sp.id}`, sp.id, sp.rarity !== 'junk' ? 'fish' : null].filter(Boolean)) { const a = BK.modelNamed(n, sp.id); if (a) return a; }
    return null;
  }
  /** A fish (length in meters, facing +z): a body, a tail, fins and eyes in its colors, or its model. */
  function fishMesh(sp, len, group = 0) {
    const sc = W().scene;
    const root = new B.TransformNode(`fish-${sp.id}`, sc);
    const mat = new B.StandardMaterial(`fish-${sp.id}`, sc);
    mat.diffuseColor = L.hex(sp.color, '#7aa6c2'); mat.specularColor = new B.Color3(0.5, 0.5, 0.5); mat.specularPower = 32;
    if (sp.glow) mat.emissiveColor = L.hex(sp.color).scale(0.45);
    const dark = new B.StandardMaterial('fish-eye', sc); dark.diffuseColor = new B.Color3(0.03, 0.03, 0.05);
    const part = (m, mt) => { m.material = mt; m.parent = root; m.isPickable = false; m.metadata = { decor: true, noGlow: !sp.glow }; m.renderingGroupId = group; return m; };
    const l = Math.max(0.03, len);
    if (sp.shape === 'boot') {
      part(B.MeshBuilder.CreateBox('boot-leg', { width: l * 0.35, height: l * 0.7, depth: l * 0.4 }, sc), mat).position.set(0, l * 0.2, -l * 0.2);
      part(B.MeshBuilder.CreateBox('boot-foot', { width: l * 0.35, height: l * 0.25, depth: l }, sc), mat).position.set(0, -l * 0.15, 0.1 * l);
    } else if (sp.shape === 'can') {
      part(B.MeshBuilder.CreateCylinder('can', { diameter: l * 0.6, height: l, tessellation: 14 }, sc), mat).rotation.x = Math.PI / 2;
    } else {
      const thin = sp.long ? 0.16 : 0.22, tall = sp.long ? 0.22 : 0.42;
      const body = part(B.MeshBuilder.CreateSphere('fish-body', { segments: 10 }, sc), mat);
      body.scaling.set(l * thin, l * tall, l);
      const tail = part(B.MeshBuilder.CreateDisc('fish-tail', { radius: l * 0.24, tessellation: 3, sideOrientation: B.Mesh.DOUBLESIDE }, sc), mat);
      tail.rotation.set(0, Math.PI / 2, Math.PI); tail.position.z = -l * 0.58;
      const fin = part(B.MeshBuilder.CreateDisc('fish-fin', { radius: l * 0.14, tessellation: 3, sideOrientation: B.Mesh.DOUBLESIDE }, sc), mat);
      fin.rotation.set(0, Math.PI / 2, -Math.PI / 2); fin.position.set(0, l * tall * 0.5, -l * 0.05);
      for (const s of [-1, 1]) { const eye = part(B.MeshBuilder.CreateSphere('fish-eye', { diameter: l * 0.07, segments: 6 }, sc), dark); eye.position.set(s * l * thin * 0.42, l * tall * 0.12, l * 0.33); }
      if (sp.whiskers) for (const s of [-1, 1]) { const w = part(B.MeshBuilder.CreateCylinder('fish-whisker', { diameter: l * 0.012, height: l * 0.35, tessellation: 4 }, sc), dark); w.position.set(s * l * 0.08, -l * 0.04, l * 0.55); w.rotation.set(Math.PI / 2.4, 0, s * 0.6); }
      if (sp.sword) { const sw = part(B.MeshBuilder.CreateCylinder('fish-sword', { diameterTop: 0, diameterBottom: l * 0.05, height: l * 0.5, tessellation: 6 }, sc), mat); sw.rotation.x = Math.PI / 2; sw.position.z = l * 0.72; }
      if (sp.spots) { const sm = new B.StandardMaterial('fish-spot', sc); sm.diffuseColor = L.hex(sp.spots); for (let i = 0; i < 4; i++) { const d = part(B.MeshBuilder.CreateSphere('fish-spot', { diameter: l * 0.16, segments: 6 }, sc), sm); d.position.set((i % 2 ? 1 : -1) * l * thin * 0.3, l * tall * (0.15 - i * 0.06), l * (0.15 - i * 0.18)); } }
      root.metadata = { tail };
    }
    const asset = modelFor(sp);
    // (A fish is small: its lightest level of detail, when the model has them, is plenty and costs a fraction.)
    const lv = asset && H.kinds.modelLevels && L.assetEntry ? H.kinds.modelLevels(L.assetEntry(asset), 256) : null;
    if (asset) B.SceneLoader.ImportMeshAsync('', '', (lv && (lv.low || lv.near)) || L.assetUrl(asset), sc, null, '.glb').then((r) => {
      if (root.isDisposed()) { for (const m of r.meshes) m.dispose(); return; }
      for (const c of root.getChildMeshes()) c.setEnabled(false);
      const holder = new B.TransformNode('fish-model', sc); holder.parent = root;
      for (const m of r.meshes) { if (!m.parent) m.parent = holder; m.isPickable = false; m.metadata = { decor: true }; m.renderingGroupId = group; }
      const { min, max } = holder.getHierarchyBoundingVectors(true);
      const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) || 1;
      holder.scaling.setAll(l / size);
    }).catch(() => {});
    return root;
  }

  // ------------------------------------------------------------------ the catch log (per player, kept while the page is open)
  const journal = () => { const g = G(); return (g && g.load('water:journal', null)) || { fish: {}, total: 0, points: 0 }; };
  function record(f) {
    const j = journal();
    const e = j.fish[f.id] || (j.fish[f.id] = { count: 0, best: 0, longest: 0, name: f.name, rarity: f.rarity });
    const first = e.count === 0;
    e.count++; e.best = Math.max(e.best, f.weight); e.longest = Math.max(e.longest, f.length);
    j.total++; j.points += f.points;
    G().save('water:journal', j);
    return { first, record: !first && f.weight >= e.best };
  }
  let logEl = null;
  /** Opens (or closes) the catch log: every fish in this world's water, the ones you've caught, your best. */
  function showLog(open) {
    const want = open === undefined ? !(logEl && logEl.isConnected) : Boolean(open);
    if (logEl) { logEl.remove(); logEl = null; }
    if (!want) return;
    X.overlay();
    const j = journal();
    const seen = new Map();
    for (const b of X.live()) for (const s of candidates(b)) seen.set(s.id, s);
    for (const id of Object.keys(j.fish)) if (!seen.has(id)) { const s = species.get(id); if (s) seen.set(id, s); else seen.set(id, { id, name: j.fish[id].name, rarity: j.fish[id].rarity, color: '#888' }); }
    const list = [...seen.values()].sort((a, b) => ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name));
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const caught = list.filter((s) => j.fish[s.id]).length;
    logEl = document.createElement('div');
    logEl.className = 'water-log';
    logEl.innerHTML = `<button class="x" aria-label="Close">×</button><h3>Catch log</h3><div>${caught} of ${list.length} kinds · ${j.total} caught · ${j.points} points</div>${list.length ? '' : '<div class="fish">No fish in this water.</div>'}${list.map((s) => {
      const e = j.fish[s.id], r = RARITY[s.rarity] || RARITY.common;
      return `<div class="fish${e ? '' : ' unknown'}"><span class="dot" style="background:${e ? esc(s.color) : r.color}"></span><span style="flex:1">${e ? esc(s.name) : '???'} <small style="color:${r.color}">${r.label}</small></span><span>${e ? `×${e.count} · best ${e.best} kg` : ''}</span></div>`;
    }).join('')}<div style="margin-top:8px;opacity:.7">J or 📖 closes this</div>`;
    logEl.querySelector('.x').onclick = () => showLog(false);
    document.body.appendChild(logEl);
  }

  // ------------------------------------------------------------------ catches, for everyone (contests)
  function announce(d) {
    const g = G();
    if (!g) return;
    const mine = !(H.sync && H.sync.online) || !d.by || d.by === H.sync.me;
    let entity = mine ? W().player : null;
    if (!mine) for (const e of W().entities) if (e.remotePlayer && e.netId === d.by) entity = e;
    if (!mine) g.ui.message(`${d.who || 'Someone'} caught a ${d.fish.name} (${d.fish.weight} kg)`, 2);
    g.emit('catch', { fish: d.fish, by: { id: d.by || null, name: d.who || null }, mine, entity });
  }
  const catchAction = H.sync ? H.sync.action('water:catch', (d) => announce(d)) : announce;
  function landed(f) {
    const r = record(f);
    const fish = { id: f.id, name: f.name, rarity: f.rarity, weight: f.weight, length: f.length, points: f.points, color: f.color };
    catchAction({ fish, by: (H.sync && H.sync.me) || null, who: H.hooks.myName || null });
    return r;
  }
  function card(f, r) {
    X.overlay();
    document.querySelectorAll('.water-card').forEach((el) => el.remove());
    const rr = RARITY[f.rarity] || RARITY.common;
    const el = document.createElement('div');
    el.className = 'water-card';
    el.innerHTML = `<span class="tag" style="background:${rr.color};color:#111">${rr.label}</span>${r.first ? ' <span class="tag" style="background:#fff;color:#111">New!</span>' : r.record ? ' <span class="tag" style="background:#fde047;color:#111">Record!</span>' : ''}<div class="name"></div><div>${f.weight} kg · ${f.length} cm · +${f.points} points</div>`;
    el.querySelector('.name').textContent = f.name;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  // ------------------------------------------------------------------ the rod
  function rodMesh(s) {
    const sc = W().scene;
    const root = new B.TransformNode('rod', sc);
    const wood = new B.StandardMaterial('rod', sc); wood.diffuseColor = new B.Color3(0.32, 0.22, 0.14); wood.specularColor = new B.Color3(0.2, 0.2, 0.2);
    const metal = new B.StandardMaterial('rod-reel', sc); metal.diffuseColor = new B.Color3(0.7, 0.72, 0.76);
    const part = (m, mt) => { m.material = mt; m.parent = root; m.isPickable = false; m.metadata = { decor: true }; return m; };
    const pole = part(B.MeshBuilder.CreateCylinder('rod-pole', { diameterTop: 0.012, diameterBottom: 0.035, height: 1.5, tessellation: 8 }, sc), wood);
    pole.position.y = 0.75;
    const reel = part(B.MeshBuilder.CreateCylinder('rod-reel', { diameter: 0.09, height: 0.04, tessellation: 14 }, sc), metal);
    reel.rotation.z = Math.PI / 2; reel.position.set(0.04, 0.22, 0);
    s.reelMesh = reel;
    const tip = new B.TransformNode('rod-tip', sc); tip.parent = root; tip.position.y = 1.5;
    s.tip = tip;
    const asset = BK.modelNamed('fishing rod') || BK.modelNamed('rod');
    if (asset) B.SceneLoader.ImportMeshAsync('', '', L.assetUrl(asset), sc, null, '.glb').then((r) => {
      if (root.isDisposed()) { for (const m of r.meshes) m.dispose(); return; }
      pole.setEnabled(false); reel.setEnabled(false);
      const holder = new B.TransformNode('rod-model', sc); holder.parent = root;
      for (const m of r.meshes) { if (!m.parent) m.parent = holder; m.isPickable = false; m.metadata = { decor: true }; }
      const { min, max } = holder.getHierarchyBoundingVectors(true);
      const k = 1.5 / Math.max(0.01, max.y - min.y);
      holder.scaling.setAll(k); holder.position.y = -min.y * k;
    }).catch(() => {});
    return root;
  }
  function bobberMesh() {
    const sc = W().scene;
    const root = new B.TransformNode('bobber', sc);
    const red = new B.StandardMaterial('bobber', sc); red.diffuseColor = new B.Color3(0.9, 0.15, 0.12); red.emissiveColor = new B.Color3(0.3, 0.03, 0.02);
    const white = new B.StandardMaterial('bobber-w', sc); white.diffuseColor = new B.Color3(0.95, 0.95, 0.95);
    const top = B.MeshBuilder.CreateSphere('bobber-top', { diameter: 0.22, segments: 8, slice: 0.5 }, sc);
    top.material = red; top.parent = root;
    const bot = B.MeshBuilder.CreateSphere('bobber-bottom', { diameter: 0.22, segments: 8, slice: 0.5 }, sc);
    bot.material = white; bot.parent = root; bot.rotation.x = Math.PI;
    for (const m of [top, bot]) { m.isPickable = false; m.metadata = { decor: true }; }
    root.setEnabled(false);
    return root;
  }
  function lineMesh(s) {
    const pts = Array.from({ length: 12 }, () => new B.Vector3());
    const line = B.MeshBuilder.CreateLines('fishing-line', { points: pts, updatable: true }, W().scene);
    line.color = new B.Color3(0.92, 0.95, 1); line.alpha = 0.8; line.isPickable = false; line.metadata = { decor: true, noGlow: true };
    line.setEnabled(false);
    s.linePts = pts;
    return line;
  }
  function drawLine(s, from, to, slack) {
    const pts = s.linePts;
    const n = pts.length - 1;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      pts[i].set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k - Math.sin(Math.PI * k) * slack, from.z + (to.z - from.z) * k);
    }
    B.MeshBuilder.CreateLines('fishing-line', { points: pts, instance: s.line });
    s.line.setEnabled(true);
  }

  function hud(s) {
    if (s.hud && s.hud.isConnected) return s.hud;
    X.overlay();
    const el = document.createElement('div');
    el.className = 'water-hud';
    document.body.appendChild(el);
    s.hud = el;
    return el;
  }
  function setHud(s, html) { const el = hud(s); if (el._html !== html) { el.innerHTML = html; el._html = html; } return el; }
  function clearHud(s) { if (s.hud) { s.hud.remove(); s.hud = null; } }
  const LINE_OUT = new Set(['flying', 'waiting', 'bite', 'reel', 'retract']);
  const verb = () => (H.touchUi ? 'Tap 🎣' : 'Click');
  const holdVerb = () => (H.touchUi ? 'Hold 🎣' : 'Hold the mouse');

  function newWait(s, ctx, k = 1) {
    const base = rand(3, 11) * k / Math.max(0.2, Number(ctx.opts.bite) || 1) * (1 - (H.water.rain || 0) * 0.3);
    s.wait = base; s.waited = 0; s.nibbles = [base * rand(0.35, 0.55), base * rand(0.65, 0.85)];
  }
  function reset(s) {
    s.phase = 'ready'; s.power = 0; s.fish = null; s.reel = null;
    if (s.bobber) s.bobber.setEnabled(false);
    if (s.line) s.line.setEnabled(false);
    lure.at = null;
  }
  function tipPos(s) { s.tip.computeWorldMatrix(true); return s.tip.getAbsolutePosition().clone(); }

  H.tools.register('rod', {
    title: 'Fishing rod',
    kind: 'tool',
    equip(ctx) {
      const s = ctx.state;
      s.mesh = rodMesh(s);
      s.bobber = bobberMesh();
      s.line = lineMesh(s);
      s.bob = new B.Vector3();
      s.vel = new B.Vector3();
      s.t = 0;
      reset(s);
      BK.useButton(s, '🎣', 'Fish');
      if (H.touchUi) {
        const pad = document.getElementById('touch');
        if (pad) { const b = document.createElement('button'); b.className = 'tb water-tb2 water-logb'; b.textContent = '📖'; b.setAttribute('aria-label', 'Catch log'); pad.appendChild(b); H.bindTouchKey(b, 'j'); s.logButton = b; }
      }
    },
    unequip(ctx) {
      const s = ctx.state;
      if (ctx.player) ctx.player._holdStill = false;
      for (const m of [s.mesh, s.bobber, s.line, s.shown]) if (m) m.dispose();
      if (s.button) s.button.remove();
      if (s.logButton) s.logButton.remove();
      clearHud(s);
      showLog(false);
      lure.at = null;
      sendRod(null, null, true);
    },
    step(dt, ctx) {
      const s = ctx.state, g = ctx.game, p = ctx.player;
      if (!p || !p.alive || W().paused) return;
      s.t += dt;
      // The line is out (flying, waiting, a bite, reeling, coming back): the player stays put (J, 2026-10-24).
      p._holdStill = LINE_OUT.has(s.phase);
      if (g.input.pressed('j')) showLog();
      const body = s.body;
      switch (s.phase) {
        case 'ready':
          if (BK.using(true) && (BK.using() || s.armed)) { s.phase = 'charge'; s.power = 0; }
          s.armed = !BK.using(true);
          setHud(s, `<div>${holdVerb()} to cast, let go to throw</div>`);
          break;
        case 'charge': {
          s.power = Math.min(1, s.power + dt * 0.9);
          setHud(s, `<div>Power</div><div class="track"><div class="fill" style="width:${Math.round(s.power * 100)}%;background:#fbbf24"></div></div>`);
          if (!BK.using(true)) {
            const cam = W().scene.activeCamera;
            const f = cam.getDirection(B.Axis.Z);
            s.bob.copyFrom(tipPos(s));
            const sp = 6 + s.power * 16;
            s.vel.set(f.x * sp, f.y * sp + 3 + s.power * 2, f.z * sp);
            s.phase = 'flying'; s.flight = 0;
            s.bobber.setEnabled(true);
            H.water.sound('cast', { volume: 0.6 });
            g.emit('cast', { entity: p, power: s.power });
          }
          break;
        }
        case 'flying': {
          s.flight += dt;
          s.vel.y -= 12 * dt;
          const step = s.vel.scale(dt);
          const hit = g.raycast([s.bob.x, s.bob.y, s.bob.z], [step.x, step.y, step.z], step.length() + 0.05, { ignore: p });
          const next = s.bob.add(step);
          const wa = X.waterAt(next.x, next.z, next.y);
          if (hit && hit.entity && hit.entity.kind !== 'water' && !(wa && hit.point[1] < wa.surface)) {
            s.bob.set(...hit.point);
            g.ui.message('Cast into the water', 1.2);
            s.phase = 'retract';
            break;
          }
          s.bob.copyFrom(next);
          if (wa && next.y <= wa.surface) {
            s.body = wa.body; s.anchor = [next.x, next.z];
            H.water.splash([next.x, wa.surface, next.z], 0.25, { sound: false });
            H.water.sound('plop', { at: [next.x, wa.surface, next.z] });
            s.phase = 'waiting';
            newWait(s, ctx);
            if (!candidates(wa.body).length) { s.wait = Infinity; g.ui.message('No fish in this water', 1.6); }
            break;
          }
          if (s.flight > 4 || s.bob.y < W().catchY || B.Vector3.Distance(s.bob, tipPos(s)) > 45) s.phase = 'retract';
          break;
        }
        case 'waiting':
        case 'bite': {
          if (!s.body || !X.live().includes(s.body)) { s.phase = 'retract'; break; }
          if (s.body.current) { s.anchor[0] += s.body.current[0] * dt * 0.6; s.anchor[1] += s.body.current[1] * dt * 0.6; }
          if (!X.contains(s.body, s.anchor[0], s.anchor[1])) { s.phase = 'retract'; break; }
          s.dip = (s.dip || 0) * Math.max(0, 1 - dt * 6);
          s.waited += dt;
          if (s.phase === 'waiting') {
            lure.at = s.waited > s.wait * 0.5 ? [s.anchor[0], X.surfaceOf(s.body, s.anchor[0], s.anchor[1]), s.anchor[1]] : null;
            while (s.nibbles.length && s.waited >= s.nibbles[0]) { s.nibbles.shift(); s.dip = -0.09; H.water.ripple(s.anchor[0], s.anchor[1], 0.15); H.water.sound('plop', { at: s.bob, volume: 0.35 }); }
            if (s.waited >= s.wait) {
              s.fish = roll(s.body, ctx.opts);
              if (!s.fish) { s.wait = Infinity; break; }
              s.phase = 'bite';
              s.biteLeft = s.fish.rarity === 'legendary' ? 0.95 : s.fish.rarity === 'rare' ? 1.15 : 1.4;
              s.dip = -0.3;
              H.water.splash(s.bob, 0.3, { sound: false });
              H.water.sound('bite', { volume: 0.9 });
              g.emit('bite', { entity: p });
            } else if (BK.using()) { s.phase = 'retract'; break; }
            setHud(s, `<div>Waiting for a bite… ${verb()} to reel in</div>`);
          } else {
            s.biteLeft -= dt;
            s.dip = Math.min(s.dip, -0.22 + Math.sin(s.t * 30) * 0.05);
            setHud(s, `<div class="big">!</div><div>${verb()} now!</div>`);
            if (BK.using()) {
              s.phase = 'reel';
              s.reel = { progress: 1, tension: 0.35, pull: 0, pullTo: 0.6, surge: 0.5, slack: 0, from: [s.anchor[0], s.anchor[1]], click: 0 };
              g.emit('hooked', { entity: p, rarity: s.fish.rarity });
            } else if (s.biteLeft <= 0) {
              g.ui.message('It got away…', 1.2);
              g.emit('escape', { entity: p, fish: s.fish && s.fish.name });
              s.fish = null; s.phase = 'waiting'; newWait(s, ctx, 0.7);
            }
          }
          s.bob.set(s.anchor[0], X.surfaceOf(s.body, s.anchor[0], s.anchor[1]) + 0.03 + (s.dip || 0), s.anchor[1]);
          break;
        }
        case 'reel': reelStep(s, dt, ctx); break;
        case 'retract': {
          const tp = tipPos(s);
          const d = tp.subtract(s.bob);
          const len = d.length();
          if (len < 0.4) { reset(s); break; }
          s.bob.addInPlace(d.scale(Math.min(1, (dt * 18) / len)));
          if (Math.random() < 0.4) H.water.sound('reel', { volume: 0.5 });
          setHud(s, '');
          break;
        }
        case 'show':
          s.showT -= dt;
          if (s.shown) { s.shown.rotation.z = Math.sin(s.t * 14) * 0.35 * Math.min(1, s.showT); }
          if (s.showT <= 0) { if (s.shown) s.shown.dispose(); s.shown = null; reset(s); }
          break;
      }
    },
    frame(dt, ctx) {
      const s = ctx.state, w = W();
      if (!s.mesh || !w) return;
      const p = w.player;
      const first = p && p._view === 'first';
      if (first) {
        s.mesh.parent = w.scene.activeCamera;
        s.mesh.position.set(0.3, -0.42, 0.55);
        const bend = s.phase === 'charge' ? -s.power * 0.5 : s.phase === 'reel' ? 0.15 + (s.reel ? s.reel.tension * 0.25 : 0) : 0;
        s.mesh.rotation.set(0.75 + bend, -0.15, -0.1);
      } else if (p) {
        s.mesh.parent = p.node;
        s.mesh.position.set(0.32, 0.1, 0.25);
        s.mesh.rotation.set(0.9, 0, -0.1);
      }
      if (s.reelMesh) s.reelMesh.rotation.x += (s.phase === 'reel' && BK.using(true)) || s.phase === 'retract' ? dt * 20 : 0;
      const out = ['flying', 'waiting', 'bite', 'reel', 'retract'].includes(s.phase);
      s.bobber.setEnabled(out);
      if (out) {
        s.bobber.position.copyFrom(s.bob);
        const tension = s.reel ? s.reel.tension : 0;
        const slack = s.phase === 'flying' ? 0 : Math.max(0, 0.6 - tension * 0.6) * Math.min(1, B.Vector3.Distance(s.bob, tipPos(s)) / 8);
        drawLine(s, tipPos(s), s.bob, slack);
      } else s.line.setEnabled(false);
      s.sendT = (s.sendT || 0) + dt;
      if (s.sendT > 0.12) { s.sendT = 0; sendRod(out ? s.bob : null, tipPos(s)); }
    },
  });
  { const { name, ...rodDef } = H.tools.get('rod'); void name; H.tools.register('fishing-rod', rodDef); }

  function reelStep(s, dt, ctx) {
    const g = ctx.game, p = ctx.player, r = s.reel, f = s.fish;
    const str = clamp((f.species.strength ?? 0.5) * (0.75 + f.big * 0.5), 0.05, 1.5) / Math.max(0.3, Number(ctx.opts.strength) || 1);
    r.surge -= dt;
    if (r.surge <= 0) { r.surge = rand(0.5, 1.8); r.pullTo = Math.random() < 0.55 ? Math.random() : 0; }
    r.pull += (r.pullTo - r.pull) * Math.min(1, dt * 4);
    const holding = BK.using(true);
    r.tension += (holding ? 0.42 + str * 0.3 : -0.85) * dt + r.pull * str * 0.8 * dt;
    r.tension = clamp(r.tension, 0, 1.2);
    const zone = r.tension > 0.3 && r.tension < 0.8;
    if (holding) r.progress -= dt * (0.12 + 0.07 * (1 - Math.min(1, str))) * (zone ? 1.5 : 0.7) * (1 - r.pull * 0.6);
    else r.progress += dt * r.pull * str * 0.07;
    r.progress = Math.min(1.12, r.progress);
    r.slack = r.tension < 0.04 ? r.slack + dt : 0;
    if (holding) { r.click += dt; if (r.click > 0.07) { r.click = 0; H.water.sound('reel', { volume: 0.4 }); } }
    // The bobber comes in toward you; the fish fights (splashes, side to side).
    const k = 0.06 + 0.94 * clamp(r.progress, 0, 1);
    const tx = p.x + (r.from[0] - p.x) * k, tz = p.z + (r.from[1] - p.z) * k;
    const side = Math.sin(s.t * 3.1) * r.pull * 0.6;
    const ax = tx + side * Math.cos(Math.atan2(tz - p.z, tx - p.x) + Math.PI / 2), az = tz + side * Math.sin(Math.atan2(tz - p.z, tx - p.x) + Math.PI / 2);
    const sy = H.water.surfaceAt(ax, az);
    if (sy !== null) { s.anchor = [ax, az]; s.lastY = sy; }
    s.bob.set(s.anchor[0], (s.lastY ?? s.bob.y) - 0.05 - r.pull * 0.1, s.anchor[1]);
    s.thrash = (s.thrash || 0) - dt;
    if (r.pull > 0.55 && s.thrash <= 0) { s.thrash = 0.3; H.water.splash(s.bob, 0.25 + f.big * 0.4, { sound: Math.random() < 0.5 }); }
    const big = f.big > 0.7 || f.rarity === 'legendary' ? '<div>Something big!</div>' : '';
    setHud(s, `${big}<div>${holdVerb()} to reel · keep it in the green</div><div class="row">Tension</div><div class="track"><div class="zone" style="left:30%;width:50%"></div><div class="mark" style="left:${Math.round(clamp(r.tension, 0, 1) * 100)}%;background:${r.tension > 0.9 ? '#f87171' : '#fff'}"></div></div><div class="row">Line out</div><div class="track"><div class="fill" style="width:${Math.round(clamp(r.progress, 0, 1) * 100)}%;background:#7dd3fc"></div></div>`);
    if (r.tension >= 1) { lose(s, g, p, 'The line snapped!', 'snap'); H.water.sound('snap'); return; }
    if (r.slack > 2.2 || r.progress >= 1.1) { lose(s, g, p, 'It slipped off the hook', 'escape'); return; }
    if (r.progress <= 0) caught(s, g, p);
  }
  function lose(s, g, p, text, ev) {
    g.ui.message(text, 1.4);
    g.emit(ev, { entity: p, fish: s.fish && s.fish.name });
    s.fish = null; s.reel = null;
    if (ev === 'snap') { s.bobber.setEnabled(false); reset(s); } else s.phase = 'retract';
  }
  function caught(s, g, p) {
    const f = s.fish;
    const r = landed(f);
    H.water.sound('catch');
    H.water.splash(s.bob, 0.5, { sound: false });
    card(f, r);
    // Holding it up for a look.
    const len = clamp(f.length / 100, 0.12, 1.1);
    const shown = fishMesh(f.species, len, 1);
    shown.parent = W().scene.activeCamera;
    shown.position.set(0, -0.08, 0.75 + len * 0.45);
    shown.rotation.y = Math.PI / 2;
    s.shown = shown;
    s.showT = 2.4;
    s.phase = 'show';
    if (s.bobber) s.bobber.setEnabled(false);
    if (s.line) s.line.setEnabled(false);
    clearHud(s);
    lure.at = null;
  }

  // ------------------------------------------------------------------ other players' lines (online)
  function sendRod(bob, tip, force) {
    const n = H.hooks.net;
    if (!n || !n.online) return;
    const r2 = (v) => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
    const msg = bob && tip ? { b: r2(bob), t: r2(tip) } : { b: null };
    const key = JSON.stringify(msg);
    if (!force && key === lastSent) return;
    lastSent = key;
    n.send('_water_rod', msg);
  }
  let lastSent = '';
  const remote = new Map(); // player id -> { bobber, line, pts, at }
  function remoteRod(d, from) {
    const id = from && from.id;
    if (!id || !W()) return;
    let r = remote.get(id);
    if (!d || !d.b) { if (r) { r.bobber.dispose(); r.line.dispose(); remote.delete(id); } return; }
    if (!r || r.world !== W()) {
      const s = {};
      r = { bobber: bobberMesh(), line: lineMesh(s), s, world: W() };
      r.s.line = r.line;
      remote.set(id, r);
    }
    r.at = performance.now();
    r.bobber.setEnabled(true);
    r.bobber.position.set(...d.b);
    drawLine(r.s, new B.Vector3(...d.t), r.bobber.position, 0.3);
  }
  H.hooks.frame.push(() => { const t = performance.now(); for (const [id, r] of remote) if (r.world !== W() || t - r.at > 3000) { r.bobber.dispose(); r.line.dispose(); remote.delete(id); } });
  H.hooks.world.push({ enter() { remote.clear(); lastSent = ''; if (G()) G().net.on('_water_rod', remoteRod); } });

  // ------------------------------------------------------------------ fish swimming in the water near you
  const lure = { at: null };
  const swimmers = [];
  function placeSwimmer(f, cam) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 13;
      const x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
      const wa = X.waterAt(x, z);
      if (!wa || !candidates(wa.body).length) continue;
      const depth = wa.surface - X.bottomOf(wa.body);
      if (depth < 0.7) continue;
      f.body = wa.body;
      f.y0 = -(0.3 + Math.random() * Math.min(2.5, depth - 0.4));
      f.node.position.set(x, wa.surface + f.y0, z);
      f.to = null;
      f.node.setEnabled(true);
      return true;
    }
    f.node.setEnabled(false);
    return false;
  }
  H.hooks.frame.push((dt) => {
    const w = W();
    if (!w) return;
    const bodies = X.live().filter((b) => candidates(b).length);
    for (let i = swimmers.length - 1; i >= 0; i--) if (swimmers[i].world !== w || !bodies.length) { swimmers[i].node.dispose(); swimmers.splice(i, 1); }
    if (!bodies.length || !w.scene.activeCamera) return;
    const cam = w.scene.activeCamera.globalPosition;
    while (swimmers.length < (PHONE ? 4 : 8)) {
      const b = bodies[Math.floor(Math.random() * bodies.length)];
      const f = roll(b, { junk: false }) || sized(DEFAULTS[0]);
      const node = fishMesh(f.species, clamp(f.length / 100, 0.1, 0.9) * 0.8);
      const sw = { node, world: w, t: Math.random() * 10, speed: 0.6 + Math.random() * 0.8 };
      swimmers.push(sw);
      placeSwimmer(sw, cam);
    }
    for (const f of swimmers) {
      f.t += dt;
      const n = f.node;
      if (!n.isEnabled() || Math.hypot(n.position.x - cam.x, n.position.z - cam.z) > 26 || !X.live().includes(f.body)) { if (f.t % 1 < dt) placeSwimmer(f, cam); continue; }
      if (lure.at && f === swimmers[0]) f.to = [lure.at[0], lure.at[2]];
      else if (!f.to || Math.hypot(f.to[0] - n.position.x, f.to[1] - n.position.z) < 0.5) {
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 5;
        const tx = n.position.x + Math.cos(a) * r, tz = n.position.z + Math.sin(a) * r;
        f.to = X.contains(f.body, tx, tz) ? [tx, tz] : [n.position.x - Math.cos(a), n.position.z - Math.sin(a)];
      }
      const dx = f.to[0] - n.position.x, dz = f.to[1] - n.position.z, l = Math.hypot(dx, dz) || 1;
      const sp = f.speed * (lure.at && f === swimmers[0] ? 1.4 : 1);
      const nx = n.position.x + (dx / l) * sp * dt, nz = n.position.z + (dz / l) * sp * dt;
      if (X.contains(f.body, nx, nz)) { n.position.x = nx; n.position.z = nz; } else f.to = null;
      const want = Math.atan2(dx, dz);
      let d = want - n.rotation.y; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      n.rotation.y += d * Math.min(1, dt * 3);
      const surf = X.surfaceOf(f.body, n.position.x, n.position.z);
      n.position.y = surf + (lure.at && f === swimmers[0] && l < 1.5 ? -0.25 : f.y0);
      const tail = n.metadata && n.metadata.tail;
      if (tail) tail.rotation.x = Math.sin(f.t * 9) * 0.5;
    }
  });

  // ------------------------------------------------------------------ the API
  H.water.fish = {
    /** Every species the game knows (the built-in ones and any added). */
    list: () => [...species.values()].map((s) => ({ ...s })),
    get: (id) => { const s = species.get(String(id).toLowerCase()); return s ? { ...s } : null; },
    /** Adds (or changes) a species: { id, name, rarity: common | uncommon | rare | legendary | junk, water: fresh | salt
     *  | any, kg: [min, max], cm: [min, max], color, strength (0 to 1: how hard it fights), points, chance, model }. */
    add(spec) { const s = norm(spec || {}); species.set(s.id, s); return { ...s }; },
    remove(id) { return species.delete(String(id).toLowerCase()); },
    /** The species that live in the water at a point (or a body from game.water.bodies()). */
    in(where) { const b = where && where.kind && where.world ? where : (() => { const p = X.posOf(where); const wa = X.waterAt(p[0], p[2], p[1]); return wa && wa.body; })(); return candidates(b).map((s) => ({ ...s })); },
    /** A random fish from the water at a point, as a bite would pick it. */
    roll(where, o) { const b = where && where.kind && where.world ? where : (() => { const p = X.posOf(where || (G() && G().player)); const wa = X.waterAt(p[0], p[2], p[1] - 1); return wa && wa.body; })(); const f = roll(b, o); if (f) delete f.species; return f; },
    /** Counts as a catch for this player (the log, the card, the 'catch' event for everyone): give('trout', { weight }). */
    give(id, o = {}) { const sp = species.get(String(id).toLowerCase()); if (!sp) return null; const f = sized(sp, o.weight); const r = landed(f); card(f, r); delete f.species; return f; },
    /** This player's catch log: { fish: { id: { count, best, longest } }, total, points }. */
    journal: () => JSON.parse(JSON.stringify(journal())),
    /** Opens or closes the catch log on screen (log(true), log(false), or log() to toggle). */
    log: (open) => showLog(open),
    clear() { G().save('water:journal', { fish: {}, total: 0, points: 0 }); },
    rarities: RARITY,
  };
  // J opens the log for anyone holding a rod (the tool handles it); a script may want it any time.
  H.hooks.world.push({ leave() { showLog(false); document.querySelectorAll('.water-card, .water-hud').forEach((el) => el.remove()); } });
})();
