// Fishing: the 'rod' tool, fish that bite, the reel-in, a table of species, a catch log, and 'catch' events (so games
// can run fishing contests).
//   Hold to charge, let go to cast (the bobber flies in an arc and floats). Wait: little nibbles, then a bite (the
//   bobber goes under, "!"): click (phones: tap 🎣) in time to hook it. Reeling: hold to reel; keep the tension in the
//   green: too much and the line snaps, slack too long and it gets away. J (phones: 📖) opens the catch log.
//   Species: common, uncommon, rare, legendary (and the odd old boot), fresh or salt water, sizes, stand-in fish shapes;
//   a model named after a species ("trout", or "fish-trout") is used when the game has one. Each has habits: the hours it
//   bites (`hours`) and how deep it lives (`depth`: shallow, mid, deep; a longer cast reaches deeper water). The catch
//   log (J, or 📖; silhouettes for what you haven't caught), a celebration and an Overseer line for each new species,
//   and a board by the hut (an entity with data.catchBoard) are kept with the Overseer's memory (memory.js): in the
//   account when signed in, on this device otherwise.
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
    { id: 'pufferfish', name: 'Pufferfish', rarity: 'uncommon', water: 'salt', kg: [0.3, 1.5], cm: [15, 35], color: '#d9c27a', spots: '#6b5a2a', strength: 0.4 },
    { id: 'barracuda', name: 'Barracuda', rarity: 'uncommon', water: 'salt', kg: [2, 12], cm: [70, 140], color: '#8d9aa6', strength: 0.7, long: true },
    { id: 'grouper', name: 'Giant grouper', rarity: 'rare', water: 'salt', kg: [15, 120], cm: [80, 180], color: '#7a5c3a', strength: 0.85 },
    { id: 'moray', name: 'Moray eel', rarity: 'rare', water: 'salt', kg: [2, 12], cm: [90, 200], color: '#5d6b2c', spots: '#d9c84a', strength: 0.8, long: true },
    { id: 'anglerfish', name: 'Anglerfish', rarity: 'legendary', water: 'salt', kg: [5, 40], cm: [40, 120], color: '#2a2438', strength: 0.9, glow: true },
    { id: 'old-boot', name: 'Old boot', rarity: 'junk', water: 'any', kg: [0.4, 1.2], cm: [25, 32], color: '#5b4636', strength: 0.1, shape: 'boot' },
    { id: 'tin-can', name: 'Tin can', rarity: 'junk', water: 'any', kg: [0.05, 0.1], cm: [10, 12], color: '#9aa3ad', strength: 0.05, shape: 'can' },
  ];
  // When each bites (hours of the world's clock, from to; it wraps past midnight) and how deep it lives.
  const HABITS = {
    minnow: { hours: [5, 20], depth: 'shallow' }, perch: { hours: [6, 18], depth: 'shallow' }, bluegill: { hours: [8, 17], depth: 'shallow' },
    carp: { hours: [4, 9], depth: 'mid' }, sardine: { hours: [6, 16], depth: 'shallow' }, mackerel: { hours: [7, 18], depth: 'mid' },
    trout: { hours: [5, 10], depth: 'mid' }, bass: { hours: [16, 21], depth: 'mid' }, catfish: { hours: [19, 5], depth: 'deep' },
    snapper: { hours: [9, 17], depth: 'mid' }, pufferfish: { hours: [8, 17], depth: 'shallow' }, barracuda: { hours: [16, 21], depth: 'mid' },
    pike: { hours: [5, 9], depth: 'mid' }, salmon: { hours: [17, 22], depth: 'mid' }, koi: { hours: [9, 17], depth: 'shallow' },
    tuna: { hours: [8, 16], depth: 'deep' }, grouper: { hours: [9, 17], depth: 'deep' }, moray: { hours: [20, 4], depth: 'deep' },
    'golden-carp': { hours: [5, 8], depth: 'shallow' }, 'old-whiskers': { hours: [21, 4], depth: 'deep' }, swordfish: { hours: [17, 21], depth: 'deep' },
    moonfish: { hours: [21, 3], depth: 'mid' }, anglerfish: { hours: [22, 4], depth: 'deep' },
  };
  for (const d of DEFAULTS) Object.assign(d, HABITS[d.id] || {});
  const DEPTHS = ['shallow', 'mid', 'deep'];
  /** How deep the line is: shallow under 3.5 m, mid under 6, deep beyond. */
  const depthTier = (m) => (m < 3.5 ? 'shallow' : m < 6 ? 'mid' : 'deep');
  const inHours = (h, hour) => (h[0] <= h[1] ? hour >= h[0] && hour < h[1] : hour >= h[0] || hour < h[1]);
  /** How much likelier (or not) a species is at this hour and line depth: its hours 2.5x (else 0.3x), its depth 1.8x (else 0.4x). */
  function habit(sp, o = {}) {
    let k = 1;
    if (Array.isArray(sp.hours) && Number.isFinite(o.hour)) k *= inHours(sp.hours, ((o.hour % 24) + 24) % 24) ? 2.5 : 0.3;
    if (DEPTHS.includes(sp.depth) && Number.isFinite(o.depth)) k *= sp.depth === depthTier(o.depth) ? 1.8 : 0.4;
    return k;
  }
  const hourNow = () => { const h = H.sky && H.sky.hour; return Number.isFinite(h) ? h : null; };
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
    const weights = list.map((s) => { const r = RARITY[s.rarity]; let wgt = (s.chance ?? r.weight) * (s.rarity === 'rare' || s.rarity === 'legendary' ? luck : 1) * habit(s, { hour: o.hour ?? hourNow(), depth: o.depth }); if (o.junk === false && s.rarity === 'junk') wgt = 0; total += wgt; return wgt; });
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

  // ------------------------------------------------------------------ the catch log (kept with the Overseer's memory)
  // Signed in it lives in the account, otherwise on this device (memory.js); without the Overseer module, while the page is open.
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const titleOf = (id) => id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  /** { fish: { id: { count, best (kg), longest (cm), name, rarity } }, total, points } */
  function journal() {
    const mem = H.memory && H.memory.fishLog;
    if (!mem) { const g = G(); return (g && g.load('water:journal', null)) || { fish: {}, total: 0, points: 0 }; }
    const log = mem.get();
    const out = { fish: {}, total: 0, points: log.points };
    for (const id of Object.keys(log.fish)) {
      const [count, kg, cm] = log.fish[id], sp = species.get(id);
      out.fish[id] = { count, best: kg / 100, longest: cm, name: sp ? sp.name : titleOf(id), rarity: sp ? sp.rarity : 'common' };
      out.total += count;
    }
    return out;
  }
  function keep(j) {
    const mem = H.memory && H.memory.fishLog;
    if (!mem) { if (G()) G().save('water:journal', j); return; }
    const fish = {};
    for (const id of Object.keys(j.fish)) fish[id] = [j.fish[id].count, Math.round(j.fish[id].best * 100), Math.round(j.fish[id].longest)];
    mem.set(fish, j.points);
  }
  function record(f) {
    const j = journal();
    const e = j.fish[f.id] || (j.fish[f.id] = { count: 0, best: 0, longest: 0, name: f.name, rarity: f.rarity });
    const first = e.count === 0, firstEver = j.total === 0;
    const heavier = !first && f.weight > e.best;
    e.count++; e.best = Math.max(e.best, f.weight); e.longest = Math.max(e.longest, f.length);
    j.total++; j.points += f.points;
    keep(j);
    return { first, firstEver, record: heavier };
  }
  /** The species of the log: this world's water, anything caught, and (with no water at all) every built-in kind. */
  function logList(j) {
    const seen = new Map();
    for (const b of X.live()) for (const s of candidates(b)) seen.set(s.id, s);
    if (!seen.size) for (const s of DEFAULTS) if (s.rarity !== 'junk') seen.set(s.id, species.get(s.id));
    for (const id of Object.keys(j.fish)) if (!seen.has(id)) seen.set(id, species.get(id) || { id, name: j.fish[id].name, rarity: j.fish[id].rarity, color: '#888' });
    return [...seen.values()].sort((a, b) => ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name));
  }
  /** A fish as a small picture: its colors when you've caught one, a dark shape against its rarity when not. */
  function silhouette(sp, known) {
    const r = RARITY[sp.rarity] || RARITY.common;
    const fill = known ? esc(sp.color || '#7aa6c2') : '#0a0f1a', line = known ? 'rgba(255,255,255,.35)' : esc(r.color);
    let body;
    if (sp.shape === 'boot') body = `<path d="M18 4h8v10h10v6H16z"/>`;
    else if (sp.shape === 'can') body = `<rect x="14" y="5" width="20" height="14" rx="2"/>`;
    else {
      const h = sp.long ? 4 : 7;
      body = `<ellipse cx="22" cy="12" rx="17" ry="${h}"/><path d="M36 12l9-${h + 1}v${2 * h + 2}z"/><path d="M18 ${12 - h}l5-${sp.long ? 2 : 4}l5 ${sp.long ? 2 : 4}z"/>${sp.sword ? '<path d="M6 12H0" stroke-width="2"/>' : ''}`;
    }
    return `<svg class="sil" viewBox="0 0 48 24" width="46" height="23" aria-hidden="true" fill="${fill}" stroke="${line}" stroke-width="1.2">${body}</svg>`;
  }
  const HOURS = (h) => (h[1] - h[0] + 24) % 24 > 11 ? 'by day' : h[0] >= 19 || h[0] < 4 && h[1] <= 6 ? 'at night' : h[0] < 12 ? 'at dawn' : 'at dusk';
  const habitText = (sp) => [sp.hours ? `Bites ${HOURS(sp.hours)}` : '', sp.depth ? { shallow: 'near the surface', mid: 'at mid depth', deep: 'in deep water (cast far)' }[sp.depth] : ''].filter(Boolean).join(' · ');
  let logEl = null;
  /** Opens (or closes) the catch log: every fish in this world's water, the ones you've caught with your best, and the rest as silhouettes. */
  function showLog(open) {
    const want = open === undefined ? !(logEl && logEl.isConnected) : Boolean(open);
    if (logEl) { logEl.remove(); logEl = null; }
    if (!want) return;
    X.overlay();
    const j = journal();
    const list = logList(j);
    const caught = list.filter((s) => j.fish[s.id]).length;
    const top = Object.entries(j.fish).sort((a, b) => b[1].best - a[1].best)[0];
    logEl = document.createElement('div');
    logEl.className = 'water-log';
    logEl.dataset.caught = String(caught); logEl.dataset.kinds = String(list.length);
    logEl.innerHTML = `<button class="x" aria-label="Close">×</button><h3>Catch log</h3><div class="sum">${caught} of ${list.length} species · ${j.total} caught · ${j.points} points</div>${top ? `<div class="sum">Biggest: ${esc(top[1].name)}, ${top[1].best} kg</div>` : ''}${list.length ? '' : '<div class="fish">No fish in this water.</div>'}${list.map((s) => {
      const e = j.fish[s.id], r = RARITY[s.rarity] || RARITY.common;
      return `<div class="fish${e ? '' : ' unknown'}" data-id="${esc(s.id)}">${silhouette(s, Boolean(e))}<span class="what"><b>${e ? esc(s.name) : '???'}</b> <small style="color:${r.color}">${r.label}</small>${e ? `<br><small>${esc(habitText(s))}</small>` : ''}</span><span class="best">${e ? `×${e.count}<br>best ${e.best} kg · ${e.longest} cm` : 'not caught yet'}</span></div>`;
    }).join('')}<div style="margin-top:8px;opacity:.7">${H.touchUi ? '📖' : 'J'} closes this</div>`;
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
    const fish = { id: f.id, name: f.name, rarity: f.rarity, weight: f.weight, length: f.length, points: f.points, color: f.color, first: r.first };
    catchAction({ fish, by: (H.sync && H.sync.me) || null, who: H.hooks.myName || null });
    return r;
  }
  // The Overseer notes a species the first time it's caught (junk is only junk): in its voice, short.
  const NOTE = {
    common: ['A {name}. I have written it down.', 'A {name}. A good place to begin.'],
    uncommon: ['A {name}. That one is not easy to find.', 'A {name}. You looked in the right place.'],
    rare: ['A {name}. I have not seen one in a long while.', 'A {name}. The sea does not give those twice.'],
    legendary: ['A {name}. I had begun to think it was a story.', 'A {name}. Hold it up. Let the light see it.'],
  };
  const NOTES = { tuna: 'A bluefin. It crossed an ocean to meet you.', swordfish: 'A swordfish. Everything in the water was afraid of it, except you.', moonfish: 'A moonfish. It only comes up when the light goes cold.', 'old-whiskers': 'Old Whiskers. The whole lake has been waiting for you to do that.', anglerfish: 'An anglerfish. It brought its own light, and you came anyway.', 'golden-carp': 'A golden carp. It looked like a coin, and was worth more.' };
  function overseerNote(f, firstEver) {
    if (!H.lines || !H.lines.sayText || f.rarity === 'junk') return;
    // The very first fish of all has the Overseer's own first-fish line (lines.js 'fish').
    if (firstEver) return;
    const list = NOTE[f.rarity] || NOTE.common;
    H.lines.sayText(`species-${f.id}`, NOTES[f.id] || list[Math.floor(Math.random() * list.length)].replace('{name}', f.name), f.rarity === 'legendary' ? 6 : f.rarity === 'rare' ? 4 : 3);
  }
  /** A short moment for a new species: a banner, a burst of confetti in its color, a flourish of sound. */
  function celebrate(f) {
    const rr = RARITY[f.rarity] || RARITY.common;
    const el = document.createElement('div');
    el.className = 'water-new';
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="head">New species!</div><div class="sp"></div>`;
    el.querySelector('.sp').textContent = f.name;
    el.style.setProperty('--c', rr.color);
    for (let i = 0; i < 22; i++) {
      const c = document.createElement('i');
      const a = (i / 22) * Math.PI * 2 + Math.random() * 0.3, d = 90 + Math.random() * 120;
      c.style.cssText = `--x:${Math.round(Math.cos(a) * d)}px;--y:${Math.round(Math.sin(a) * d * 0.7 - 30)}px;background:${i % 3 ? rr.color : f.color};animation-delay:${Math.round(Math.random() * 120)}ms`;
      el.appendChild(c);
    }
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
    H.water.sound('catch', { volume: 1 });
    if (f.rarity === 'rare' || f.rarity === 'legendary') setTimeout(() => H.water.sound('catch', { volume: 0.7 }), 260);
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
    if (r.first && f.rarity !== 'junk') { celebrate(f); overseerNote(f, r.firstEver); G().emit('species', { fish: { id: f.id, name: f.name, rarity: f.rarity, weight: f.weight, length: f.length }, entity: W().player }); }
    refreshBoards();
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

  // The line is a verlet rope (J, 2026-11-12): a dozen points pinned at the rod tip and the bobber, each segment as long as
  // the line left out, so slack sags under gravity and a taut line straightens. `slack` is the extra length (0.02 taut, 0.2 slack).
  const GRAV = -9;
  function ropeStep(s, a, b, dt, slack) {
    const pts = s.linePts, n = pts.length - 1;
    dt = Math.min(dt, 1 / 30);
    let r = s.rope;
    if (!r || r.n !== n) {
      r = s.rope = { n, p: pts.map((_, i) => ({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n, z: a.z + (b.z - a.z) * i / n })), q: null };
      r.q = r.p.map((v) => ({ ...v }));
    }
    const rest = Math.max(0.02, B.Vector3.Distance(a, b) * (1 + slack) / n);
    for (let i = 1; i < n; i++) {
      const c = r.p[i], o = r.q[i];
      const vx = (c.x - o.x) * 0.97, vy = (c.y - o.y) * 0.97, vz = (c.z - o.z) * 0.97;
      o.x = c.x; o.y = c.y; o.z = c.z;
      c.x += vx; c.y += vy + GRAV * dt * dt; c.z += vz;
    }
    for (let it = 0; it < 8; it++) {
      r.p[0].x = a.x; r.p[0].y = a.y; r.p[0].z = a.z; r.p[n].x = b.x; r.p[n].y = b.y; r.p[n].z = b.z;
      for (let i = 0; i < n; i++) {
        const u = r.p[i], v = r.p[i + 1];
        const dx = v.x - u.x, dy = v.y - u.y, dz = v.z - u.z, d = Math.hypot(dx, dy, dz) || 1e-6;
        if (d <= rest) continue;
        const k = (d - rest) / d * 0.5;
        if (i > 0) { u.x += dx * k; u.y += dy * k; u.z += dz * k; }
        if (i + 1 < n) { v.x -= dx * k; v.y -= dy * k; v.z -= dz * k; }
      }
    }
    for (let i = 0; i <= n; i++) pts[i].set(r.p[i].x, r.p[i].y, r.p[i].z);
    B.MeshBuilder.CreateLines('fishing-line', { points: pts, instance: s.line });
    s.line.setEnabled(true);
  }
  /** The log the playtest reads (window.__fishing.events, in order) and a 'fishing' game event: cast, plop, nibble, bite, strike, fight, leap, holdup, closeup-*. */
  function fx(name, d = {}) {
    const log = (window.__fishing = window.__fishing || { events: [] });
    log.events.push({ name, t: Math.round(performance.now()), ...d });
    if (log.events.length > 200) log.events.shift();
    try { if (G()) G().emit('fishing', { name, ...d }); } catch { /* the log stands */ }
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
  const LINE_OUT = new Set(['flying', 'waiting', 'bite', 'reel', 'retract', 'leap']);
  const verb = () => (H.touchUi ? 'Tap 🎣' : 'Click');
  const holdVerb = () => (H.touchUi ? 'Hold 🎣' : 'Hold the mouse');

  // A first catch is made easy (J, 2026-10-25: the first bite must be quick and reliable): until this player has caught
  // anything, or while a script asks (`game.water.fish.assist(true)`, the playtest bot's hook), the first bite comes 2.5 to 4.5 s
  // after the bobber lands (never later than FIRST_BITE_MAX), it is a common fish, the bite stays 3 s, and the line can
  // not snap: holding the reel is enough. `fishing: { firstCatch: false }` in the rod's options turns it off.
  const FIRST_BITE = [2.5, 4.5], FIRST_BITE_MAX = 5, FIRST_BITE_WINDOW = 3, FIRST_TENSION_CAP = 0.78;
  let assisted = false;
  const easyNow = (ctx) => assisted || (ctx.opts.firstCatch !== false && journal().total === 0);
  /** A common, non-junk fish of this water (the first fish of all); falls back to a normal roll. */
  function rollFirst(body) {
    const list = candidates(body).filter((x) => x.rarity === 'common');
    return list.length ? sized(list[Math.floor(Math.random() * list.length)]) : roll(body, { junk: false });
  }
  function newWait(s, ctx, k = 1) {
    if (s.easy) {
      const base = Math.min(FIRST_BITE_MAX, rand(FIRST_BITE[0], FIRST_BITE[1]) * k);
      s.wait = base; s.waited = 0; s.nibbles = [base * 0.45, base * 0.75];
      return;
    }
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
      for (const m of [s.mesh, s.bobber, s.line, s.shown, s.drops]) if (m) m.dispose();
      s.leap = null; s.closing = false;
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
            s.phase = 'flying'; s.flight = 0; s.rope = null; s.strikeT = 0;
            s.bobber.setEnabled(true);
            fx('cast', { power: Math.round(s.power * 100) / 100 });
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
            // A longer cast reaches deeper water (to the bottom of this one): what bites depends on it.
            const tp0 = tipPos(s), reach = Math.hypot(next.x - tp0.x, next.z - tp0.z);
            s.lineDepth = Math.min(wa.surface - X.bottomOf(wa.body), 1.2 + reach * 0.3);
            H.water.splash([next.x, wa.surface, next.z], 0.45, { sound: false });
            H.water.sound('plop', { at: [next.x, wa.surface, next.z] });
            // Rings go out one after another from the plop.
            setTimeout(() => H.water.ripple(next.x, next.z, 0.9), 140);
            setTimeout(() => H.water.ripple(next.x, next.z, 1.3), 320);
            fx('plop', { x: Math.round(next.x * 10) / 10, z: Math.round(next.z * 10) / 10, rings: 3 });
            s.phase = 'waiting';
            s.easy = easyNow(ctx);
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
          // The bobber drifts a little, never far from where it landed.
          s.anchor[0] += Math.cos(s.t * 0.31 + 1) * 0.06 * dt; s.anchor[1] += Math.sin(s.t * 0.23) * 0.06 * dt;
          s.waited += dt;
          if (s.phase === 'waiting') {
            lure.at = s.waited > s.wait * 0.5 ? [s.anchor[0], X.surfaceOf(s.body, s.anchor[0], s.anchor[1]), s.anchor[1]] : null;
            while (s.nibbles.length && s.waited >= s.nibbles[0]) { s.nibbles.shift(); s.dip = -0.09; H.water.ripple(s.anchor[0], s.anchor[1], 0.15); setTimeout(() => H.water.ripple(s.anchor[0], s.anchor[1], 0.25), 180); H.water.sound('plop', { at: s.bob, volume: 0.35 }); fx('nibble'); }
            if (s.waited >= s.wait) {
              s.fish = (s.easy && rollFirst(s.body)) || roll(s.body, { ...ctx.opts, depth: s.lineDepth });
              if (!s.fish) { s.wait = Infinity; break; }
              s.phase = 'bite';
              s.biteLeft = s.easy ? FIRST_BITE_WINDOW : s.fish.rarity === 'legendary' ? 0.95 : s.fish.rarity === 'rare' ? 1.15 : 1.4;
              s.dip = -0.3;
              H.water.splash(s.bob, 0.3, { sound: false });
              H.water.sound('bite', { volume: 0.9 });
              g.emit('bite', { entity: p });
              fx('bite', { fish: s.fish.name, rarity: s.fish.rarity });
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
              // The strike: the bobber is yanked under with a splash, the line snaps taut and the rod bends.
              s.strikeT = 0.6; s.dip = -0.4; s.fought = false;
              H.water.splash(s.bob, 0.7, { sound: true });
              fx('strike', { rarity: s.fish.rarity });
            } else if (s.biteLeft <= 0) {
              g.ui.message('It got away…', 1.2);
              g.emit('escape', { entity: p, fish: s.fish && s.fish.name });
              s.fish = null; s.phase = 'waiting'; newWait(s, ctx, 0.7);
            }
          }
          s.bob.set(s.anchor[0], X.surfaceOf(s.body, s.anchor[0], s.anchor[1]) + 0.03 + (s.dip || 0), s.anchor[1]);
          break;
        }
        case 'reel': s.strikeT = Math.max(0, (s.strikeT || 0) - dt); reelStep(s, dt, ctx); break;
        case 'leap': leapStep(s, dt, ctx); break;
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
          if (!s.closing) s.showT -= dt;
          if (s.shown && s.heldCam) { s.shown.rotation.z = Math.sin(s.t * 14) * 0.35 * Math.min(1, s.showT); }
          if (s.closing) { s.closeGuard = (s.closeGuard || 0) + dt; if (s.closeGuard > 8) s.closing = false; break; }
          if (s.shown && !s.heldCam) holdPose(s, p);
          if (s.showT <= 0) { if (s.shown) s.shown.dispose(); s.shown = null; if (s.drops) { s.drops.dispose(); s.drops = null; } reset(s); }
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
        s.mesh.rotation.set(0.75 + rodBend(s), -0.15, -0.1);
      } else if (p) {
        s.mesh.parent = p.node;
        s.mesh.position.set(0.32, 0.1, 0.25);
        s.mesh.rotation.set(0.9 + rodBend(s), 0, -0.1);
      }
      if (s.reelMesh) s.reelMesh.rotation.x += (s.phase === 'reel' && BK.using(true)) || s.phase === 'retract' ? dt * 20 : 0;
      const out = ['flying', 'waiting', 'bite', 'reel', 'retract', 'leap'].includes(s.phase);
      s.bobber.setEnabled(out && s.phase !== 'leap');
      if (out) {
        s.bobber.position.copyFrom(s.bob);
        // The bobber leans with the wave under it.
        if (s.body && (s.phase === 'waiting' || s.phase === 'bite')) {
          const y0 = X.surfaceOf(s.body, s.bob.x, s.bob.z), sx = X.surfaceOf(s.body, s.bob.x + 0.3, s.bob.z) - y0, sz = X.surfaceOf(s.body, s.bob.x, s.bob.z + 0.3) - y0;
          s.bobber.rotation.set(sz * 1.5 + Math.sin(s.t * 1.7) * 0.03, 0, -sx * 1.5);
        } else s.bobber.rotation.set(0, 0, 0);
        const tension = s.reel ? s.reel.tension : 0;
        // Flying: a curve that sags; waiting: a little slack; a strike snaps it taut; reeling follows the tension.
        const slack = s.phase === 'flying' ? 0.2 : s.phase === 'leap' ? 0.03 : s.phase === 'reel' ? ((s.strikeT || 0) > 0 ? 0.015 : 0.02 + Math.max(0, 0.7 - tension) * 0.12) : s.phase === 'retract' ? 0.03 : 0.12;
        ropeStep(s, tipPos(s), s.bob, dt, slack);
      } else { s.line.setEnabled(false); s.rope = null; }
      s.sendT = (s.sendT || 0) + dt;
      if (s.sendT > 0.12) { s.sendT = 0; sendRod(out ? s.bob : null, tipPos(s)); }
    },
  });
  { const { name, ...rodDef } = H.tools.get('rod'); void name; H.tools.register('fishing-rod', rodDef); }

  /** How far the rod bends (radians, added to its tilt): back to cast, a snap and then the fish's pull while reeling. */
  function rodBend(s) {
    if (s.phase === 'charge') return -s.power * 0.5;
    if (s.phase === 'reel') return 0.15 + (s.reel ? s.reel.tension * 0.25 : 0) + (s.strikeT || 0) * 0.5 + (s.reel ? s.reel.pull * 0.12 * Math.sin(s.t * 18) : 0);
    if (s.phase === 'leap') return 0.3;
    return 0;
  }
  function reelStep(s, dt, ctx) {
    const g = ctx.game, p = ctx.player, r = s.reel, f = s.fish;
    const str = clamp((f.species.strength ?? 0.5) * (0.75 + f.big * 0.5), 0.05, 1.5) / Math.max(0.3, Number(ctx.opts.strength) || 1);
    r.surge -= dt;
    if (r.surge <= 0) { r.surge = rand(0.5, 1.8); r.pullTo = Math.random() < 0.55 ? Math.random() : 0; }
    r.pull += (r.pullTo - r.pull) * Math.min(1, dt * 4);
    const holding = BK.using(true);
    r.tension += (holding ? 0.42 + str * 0.3 : -0.85) * dt + r.pull * str * 0.8 * dt;
    r.tension = clamp(r.tension, 0, s.easy ? FIRST_TENSION_CAP : 1.2);
    const zone = r.tension > 0.3 && r.tension < 0.8;
    if (holding) r.progress -= dt * (0.12 + 0.07 * (1 - Math.min(1, str))) * (zone ? 1.5 : 0.7) * (1 - r.pull * 0.6);
    else r.progress += dt * r.pull * str * 0.07;
    r.progress = Math.min(1.12, r.progress);
    r.slack = r.tension < 0.04 ? r.slack + dt : 0;
    if (holding) { r.click += dt; if (r.click > 0.07) { r.click = 0; H.water.sound('reel', { volume: 0.4 }); } }
    // The bobber comes in toward you; the fish fights (splashes, side to side).
    const k = 0.06 + 0.94 * clamp(r.progress, 0, 1);
    const tx = p.x + (r.from[0] - p.x) * k, tz = p.z + (r.from[1] - p.z) * k;
    const side = Math.sin(s.t * 3.1) * r.pull * 1.3;
    const ax = tx + side * Math.cos(Math.atan2(tz - p.z, tx - p.x) + Math.PI / 2), az = tz + side * Math.sin(Math.atan2(tz - p.z, tx - p.x) + Math.PI / 2);
    const sy = H.water.surfaceAt(ax, az);
    if (sy !== null) { s.anchor = [ax, az]; s.lastY = sy; }
    s.bob.set(s.anchor[0], (s.lastY ?? s.bob.y) - 0.05 - r.pull * 0.1, s.anchor[1]);
    s.thrash = (s.thrash || 0) - dt;
    if (r.pull > 0.3 && s.thrash <= 0) {
      s.thrash = 0.3 + (1 - r.pull) * 0.3; H.water.splash(s.bob, 0.2 + r.pull * 0.2 + f.big * 0.3, { sound: Math.random() < 0.5 });
      if (!s.fought) { s.fought = true; fx('fight', { fish: f.name, pull: Math.round(r.pull * 100) / 100 }); }
    }
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
  // ------------------------------------------------------------------ the landing: the fish leaps, then is held up
  /** Where the player holds a fish: in front of the chest, up high (world coordinates), and which way is forward. */
  function holdSpot(p) {
    let feet = p.y, h = 1.7;
    try { const bx = p.box(); feet = bx.min[1]; h = bx.max[1] - bx.min[1]; } catch { /* the entity's own y */ }
    const a = p.node ? p.node.rotation.y : 0, fx_ = Math.sin(a), fz = Math.cos(a);
    return { x: p.x + fx_ * 0.5, y: feet + h * 0.95, z: p.z + fz * 0.5, fx: fx_, fz, feet, h };
  }
  function holdPose(s, p) {
    const spot = holdSpot(p), n = s.shown;
    n.position.set(spot.x, spot.y + Math.sin(s.t * 3) * 0.02, spot.z);
    // Nose to the player's right, so the whole fish shows side on to a camera in front of them; it still twitches.
    n.rotation.set(0, Math.atan2(spot.fz, -spot.fx) + 0, Math.sin(s.t * 12) * 0.25 * Math.min(1, s.showT));
    const tail = n.metadata && n.metadata.tail;
    if (tail) tail.rotation.x = Math.sin(s.t * 14) * 0.5;
  }
  function dropsFor(node, rate) {
    const w = W(), ps = new B.ParticleSystem('fish-drops', PHONE ? 60 : 140, w.scene);
    ps.particleTexture = w.dot; ps.emitter = node; ps.minEmitBox = new B.Vector3(-0.1, -0.05, -0.1); ps.maxEmitBox = new B.Vector3(0.1, 0.1, 0.1);
    ps.color1 = new B.Color4(0.9, 0.97, 1, 0.9); ps.color2 = new B.Color4(0.7, 0.9, 1, 0.7); ps.colorDead = new B.Color4(0.8, 0.95, 1, 0);
    ps.minSize = 0.025; ps.maxSize = 0.06; ps.minLifeTime = 0.35; ps.maxLifeTime = 0.8;
    ps.emitRate = rate; ps.minEmitPower = 0.3; ps.maxEmitPower = 1.2;
    ps.direction1 = new B.Vector3(-1, 0.2, -1); ps.direction2 = new B.Vector3(1, 1, 1); ps.gravity = new B.Vector3(0, -9, 0);
    ps.start();
    return ps;
  }
  /** A flash of light at a point: one big soft white particle that fades in 0.35 s. */
  function glint(at, size) {
    const w = W(), ps = new B.ParticleSystem('fish-glint', 2, w.scene);
    ps.particleTexture = w.dot; ps.emitter = new B.Vector3(at.x, at.y, at.z);
    ps.color1 = new B.Color4(1, 1, 0.9, 1); ps.color2 = new B.Color4(1, 0.95, 0.7, 1); ps.colorDead = new B.Color4(1, 1, 1, 0);
    ps.minSize = size; ps.maxSize = size * 1.3; ps.minLifeTime = 0.3; ps.maxLifeTime = 0.4;
    ps.manualEmitCount = 2; ps.minEmitPower = 0; ps.maxEmitPower = 0.01; ps.blendMode = B.ParticleSystem.BLENDMODE_ADD;
    ps.disposeOnStop = true; ps.targetStopDuration = 0.5; ps.start();
  }
  function caught(s, g, p) {
    const f = s.fish;
    const len = clamp(f.length / 100, 0.12, 1.1);
    const node = fishMesh(f.species, len, 0);
    const spot = holdSpot(p);
    node.position.copyFrom(s.bob);
    s.leap = { t: 0, dur: 0.95, from: s.bob.clone(), to: new B.Vector3(spot.x, spot.y, spot.z), apex: 1.3 + len * 0.8, node, len, glint: false };
    s.shown = node;
    s.drops = dropsFor(node, PHONE ? 60 : 130);
    s.phase = 'leap';
    // It breaks the surface: a splash, spray and a rising drum of water.
    H.water.splash(s.bob, 0.8, { sound: true });
    fx('leap', { fish: f.name, rarity: f.rarity, apex: Math.round(s.leap.apex * 10) / 10 });
    clearHud(s);
    lure.at = null;
  }
  function leapStep(s, dt) {
    const L = s.leap;
    if (!L || !L.node || L.node.isDisposed()) { reset(s); return; }
    L.t += dt;
    const k = Math.min(1, L.t / L.dur), up = 4 * L.apex * k * (1 - k);
    const x = L.from.x + (L.to.x - L.from.x) * k, z = L.from.z + (L.to.z - L.from.z) * k, y = L.from.y + (L.to.y - L.from.y) * k + up;
    L.node.position.set(x, y, z);
    s.bob.set(x, y, z);
    const dx = L.to.x - L.from.x, dz = L.to.z - L.from.z;
    // Nose along the arc (up, then down), thrashing side to side.
    L.node.rotation.set(-(1 - 2 * k) * 0.9, Math.atan2(dx, dz) + Math.sin(L.t * 26) * 0.35, Math.sin(L.t * 34) * 0.7);
    const tail = L.node.metadata && L.node.metadata.tail;
    if (tail) tail.rotation.x = Math.sin(L.t * 40) * 0.8;
    if (!L.glint && k > 0.42) { L.glint = true; glint({ x, y: y + 0.05, z }, 0.7 + L.len * 0.6); H.water.sound('plop', { at: [x, y, z], volume: 0.4 }); }
    if (k >= 1) holdUp(s, W().player);
  }
  function holdUp(s, p) {
    const f = s.fish, g = G();
    const len = s.leap.len;
    s.leap = null;
    const r = landed(f);
    H.water.sound('catch');
    card(f, r);
    s.heldCam = false;
    s.showT = 2.4;
    s.phase = 'show';
    s.fish = null; s.reel = null;
    if (s.bobber) s.bobber.setEnabled(false);
    if (s.line) s.line.setEnabled(false);
    if (s.drops) s.drops.emitRate = 20;
    try { if (H.presence && H.presence.emote) H.presence.emote('cheer'); } catch { /* the pose is a flourish */ }
    fx('holdup', { fish: f.name, rarity: f.rarity, first: r.firstEver, length: f.length });
    if (r.firstEver) closeUp(s, f, p, len);
    else if (p._view === 'first') {
      // First person: the fish is held up in front of the camera, as it always was.
      s.heldCam = true;
      s.shown.parent = W().scene.activeCamera;
      s.shown.position.set(0, -0.08, 0.75 + len * 0.45);
      s.shown.rotation.set(0, Math.PI / 2, 0);
      for (const m of s.shown.getChildMeshes()) m.renderingGroupId = 1;
    }
    void g;
  }
  /** The first catch: a 2.6 s close-up. The camera stands in front of the player over the water and frames them holding the fish
   *  up (the whole fish across the screen, even on a portrait phone), letterbox bars, no HUD; then the player has the game back. */
  async function closeUp(s, f, p, len) {
    s.closing = true; s.closeGuard = 0;
    try {
      if (!H.cinematic && window.HawkesModules && window.HawkesModules.ensure) await window.HawkesModules.ensure('share');
      const C = H.cinematic;
      if (!C) { fx('closeup-skipped', { why: 'no cinematic camera' }); return; }
      const spot = holdSpot(p), aspect = window.innerWidth / Math.max(1, window.innerHeight), portrait = aspect < 1;
      const vfov = portrait ? 50 : 38, tv = Math.tan(vfov * Math.PI / 360), th = tv * aspect;
      const need = Math.max(len * 1.35, 1.3);
      const D = clamp(Math.max(need / 2 / th, 1.9 / 2 / tv), 1.8, 8);
      const camPos = [p.x + spot.fx * D, spot.feet + spot.h * 0.8, p.z + spot.fz * D];
      const look = [p.x + spot.fx * 0.3, spot.feet + spot.h * 0.82, p.z + spot.fz * 0.3];
      let bars = [];
      if (portrait) {
        for (const top of [true, false]) { const b = document.createElement('div'); b.className = 'sh-keep'; b.style.cssText = `position:fixed;left:0;right:0;${top ? 'top' : 'bottom'}:0;height:7vh;background:#000;z-index:60;pointer-events:none`; document.body.appendChild(b); bars.push(b); }
      }
      const done = C.fixed(camPos, look, { seconds: 2.6, fov: vfov, letterbox: !portrait, skippable: false, controls: false, smooth: 1 });
      fx('closeup-start', { seconds: 2.6, portrait, distance: Math.round(D * 10) / 10 });
      // Is the whole fish on screen? Measured from the camera that is showing it, a moment in.
      setTimeout(() => {
        try {
          const w = W(), cam = w.scene.activeCamera, eng = w.scene.getEngine();
          const { min, max } = s.shown.getHierarchyBoundingVectors(true);
          const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight()), tm = w.scene.getTransformMatrix();
          const pr = [min, max, new B.Vector3(min.x, max.y, max.z), new B.Vector3(max.x, min.y, min.z)].map((v) => B.Vector3.Project(v, B.Matrix.Identity(), tm, vp));
          const xs = pr.map((v) => v.x / vp.width), ys = pr.map((v) => v.y / vp.height);
          const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
          const bar = portrait ? 0.07 : 0;
          fx('closeup-framed', { whole: box.x0 >= 0 && box.x1 <= 1 && box.y0 >= bar && box.y1 <= 1 - bar, box: Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v * 100) / 100])) });
        } catch (e) { fx('closeup-framed', { whole: null, error: String(e && e.message || e) }); }
      }, 500);
      await done;
      for (const b of bars) b.remove();
      fx('closeup-end');
    } catch (e) { fx('closeup-skipped', { why: String(e && e.message || e) }); } finally { s.closing = false; }
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
    /** The odds of each species in the water there for this hour and line depth: [{ id, p }] (p adds up to 1). o: { hour, depth (m), luck }. */
    odds(where, o = {}) {
      const b = where && where.kind && where.world ? where : (() => { const p = X.posOf(where || (G() && G().player)); const wa = X.waterAt(p[0], p[2], p[1] - 1); return wa && wa.body; })();
      const list = candidates(b), luck = Math.max(0, Number(o.luck ?? 1));
      const ws = list.map((s) => (s.chance ?? RARITY[s.rarity].weight) * (s.rarity === 'rare' || s.rarity === 'legendary' ? luck : 1) * habit(s, { hour: o.hour ?? hourNow(), depth: o.depth }));
      const total = ws.reduce((a, c) => a + c, 0) || 1;
      return list.map((s, i) => ({ id: s.id, p: ws[i] / total }));
    },
    /** For scripts and the playtest bot: assist(true) makes every cast the player's first (a bite 2.5 to 4.5 s after the bobber
     *  lands, a common fish, a bite that waits 3 s, a line that cannot snap while the reel is held), so a catch is the same
     *  every time; assist(false) goes back to the normal tables. Without an argument it says whether it is on. A player with
     *  no catch yet gets the same help without calling it. */
    assist(on) { if (on !== undefined) assisted = Boolean(on); return assisted; },
    /** Where the rod is: 'ready', 'charge', 'flying', 'waiting', 'bite', 'reel', 'retract', 'leap', 'show', or null with no rod in hand. */
    phase() { const h = H.tools.held; return h && h.ctx && h.ctx.state && (h.name === 'rod' || h.name === 'fishing-rod') ? h.ctx.state.phase || null : null; },
    /** Opens or closes the catch log on screen (log(true), log(false), or log() to toggle). */
    log: (open) => showLog(open),
    clear() { keep({ fish: {}, total: 0, points: 0 }); refreshBoards(); },
    /** Rewrites the boards by the hut (a thing with data.catchBoard) from the log. */
    board: () => refreshBoards(),
    rarities: RARITY,
    /** For the playtest: the bobber's height against the sea's surface under it and how far the line bows from straight, in metres ({ y, surface, sag, phase }), or null with the line in. */
    bobber() { const h = H.tools.held, st = h && h.ctx && h.ctx.state; if (!st || !st.body || !LINE_OUT.has(st.phase)) return null; let sag = 0; if (st.rope) { const P = st.rope.p, A = P[0], Z = P[P.length - 1], L = Math.hypot(Z.x - A.x, Z.y - A.y, Z.z - A.z) || 1; for (const q of P) { const t = ((q.x - A.x) * (Z.x - A.x) + (q.y - A.y) * (Z.y - A.y) + (q.z - A.z) * (Z.z - A.z)) / (L * L); sag = Math.max(sag, Math.hypot(q.x - (A.x + (Z.x - A.x) * t), q.y - (A.y + (Z.y - A.y) * t), q.z - (A.z + (Z.z - A.z) * t))); } }
      return { phase: st.phase, x: st.bob.x, y: st.bob.y, z: st.bob.z, surface: X.surfaceOf(st.body, st.bob.x, st.bob.z), sag }; },
    /** The cast, bite, strike, leap and hold-up events so far, in order: [{ name, t, ... }]. */
    events: () => ((window.__fishing && window.__fishing.events) || []).slice(),
  };
  // J opens the log for anyone holding a rod (the tool handles it); a script may want it any time.
  // J opens the log without a rod in hand too (nothing else in the engine uses it); the board by the hut opens it with E.
  H.hooks.step.push(() => {
    const g = G();
    if (g && g.mode === 'play' && !(H.tools.held && H.tools.held.name === 'rod') && !(H.tools.held && H.tools.held.name === 'fishing-rod') && g.input.pressed('j') && !W().paused) showLog();
  });
  // ------------------------------------------------------------------ the board (a thing with data.catchBoard shows your best)
  const boards = new Map(); // entity -> its sign
  function boardWords() {
    const j = journal(), list = logList(j).filter((s) => s.rarity !== 'junk');
    const have = list.filter((s) => j.fish[s.id]);
    const best = have.sort((a, b) => j.fish[b.id].best - j.fish[a.id].best).slice(0, 3);
    return `CATCH BOARD\n${have.length} of ${list.length} species\n${best.length ? best.map((s) => `${s.name} ${j.fish[s.id].best} kg`).join('\n') : 'Nothing yet. The rod is on the pier.'}`;
  }
  function refreshBoards() {
    const w = W();
    if (!w) return;
    const words = boardWords();
    for (const e of w.entities) {
      if (!e.data || !e.data.catchBoard || !e.node) continue;
      const b = boards.get(e);
      if (b && b.words === words && !b.mesh.isDisposed()) continue;
      if (b) b.mesh.dispose();
      const mesh = H.textPlane(words, { size: 0.11, billboard: false, color: '#f8f1e4', background: 'rgba(40,24,12,0.0)' });
      mesh.parent = e.node; mesh.position.set(0, 0, 0.06); mesh.rotation.y = Math.PI; mesh.isPickable = false; mesh.metadata = { decor: true };
      boards.set(e, { mesh, words });
    }
  }
  function boardNear(p) {
    const w = W();
    let best = null, bd = 3.2;
    for (const e of w.entities) { if (!e.data || !e.data.catchBoard || !e.node) continue; const d = Math.hypot(e.x - p.x, e.z - p.z); if (d < bd) { bd = d; best = e; } }
    return best && { label: 'Read the catch board', distance: bd, act: () => showLog(true) };
  }
  H.use.register('water:board', { near: (p) => boardNear(p) });
  H.hooks.world.push({ enter() { boards.clear(); setTimeout(refreshBoards, 400); setTimeout(refreshBoards, 3000); } });
  H.hooks.world.push({ leave() { showLog(false); document.querySelectorAll('.water-card, .water-hud').forEach((el) => el.remove()); } });
})();
