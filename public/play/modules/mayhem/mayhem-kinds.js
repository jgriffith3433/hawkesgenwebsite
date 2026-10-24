// Mayhem's kinds of things: exploding barrels, breakable crates and tool pickups (walk into one to hold a mayhem
// tool). Animals are Living things' (the creature kind); Mayhem throws, burns and breaks them like anything else.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const M = H.mayhemMath;
  const W = () => H.world;
  const G = () => H.game;
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const hexc = (c, f) => L.hex(c, f);

  // ------------------------------------------------------------------ barrel: goes off when shot, burnt or hit hard
  H.kinds.register('barrel', {
    physics: 'dynamic',
    maker: true,
    build(sh, o) {
      const r = num(sh.radius, 0.42), h = num(sh.height, 1.15);
      const e = L.shape('barrel', () => B.MeshBuilder.CreateCylinder('barrel', { diameter: r * 2, height: h, tessellation: 20 }, W().scene), { ...o, color: o.color || '#c0392b' });
      const sc = W().scene;
      // Rings and a hazard band (decor: the collider is the drum).
      // (The rings' and the band's materials are shared by every barrel in the world.)
      const shared = sc._barrelMats || (sc._barrelMats = {
        ring: (() => { const m = new B.StandardMaterial('barrel-ring', sc); m.diffuseColor = new B.Color3(0.18, 0.12, 0.1); return m; })(),
        band: (() => { const m = new B.StandardMaterial('barrel-band', sc); m.diffuseColor = hexc('#f4c430'); m.emissiveColor = hexc('#3a2a00'); return m; })(),
      });
      const ringMat = shared.ring, band = shared.band;
      const parts = [];
      for (const y of [-h * 0.32, h * 0.32]) {
        const ring = B.MeshBuilder.CreateTorus('barrel-ring', { diameter: r * 2 + 0.02, thickness: 0.05, tessellation: 24 }, sc);
        ring.position.y = y; ring.material = ringMat; parts.push(ring);
      }
      const stripe = B.MeshBuilder.CreateCylinder('barrel-band', { diameter: r * 2 + 0.012, height: h * 0.16, tessellation: 20 }, sc);
      stripe.material = band; parts.push(stripe);
      for (const m of parts) { m.parent = e.node; m.isPickable = true; m.metadata = { decor: true }; }
      if (H.mergeParts) H.mergeParts(parts); // (the two rings: one mesh)
      e.data.explosive = { radius: num(sh.power, 6), force: num(sh.force, 22), damage: num(sh.damage, 60), fire: sh.fire !== false, strength: num(sh.strength, 16) };
      e.data.barrel = true;
      if (e.hp === undefined) e.maxHp = e.hp = num(sh.hp, 20);
      return e;
    },
    editor: {
      word: 'an exploding barrel',
      lift: (spec) => num(spec.shape && spec.shape.height, 1.15) / 2 + 0.02,
      motion: [['dynamic', 'Falls and rolls'], ['static', 'Stays put']],
      hotbar: [{ order: 610, icon: '🛢', label: 'Barrel', make: () => ({ type: 'barrel', name: 'Barrel', physics: 'dynamic' }) }],
    },
    codex: {
      group: 'Mayhem', what: 'An exploding barrel: shoot it, burn it or hit it hard and it blows up, setting off the barrels around it (chain reactions).',
      spec: { type: 'barrel', name: 'Barrel', transform: { position: [0, 0.6, 0] }, physics: 'dynamic' },
      fields: [['shape.power', 'blast radius in meters', '6'], ['shape.damage', 'damage at the middle', '60'], ['shape.force', 'how hard it throws things', '22'], ['shape.hp', 'damage it takes to go off', '20'], ['shape.fire', 'false: no fire', 'true'], ['shape.radius', 'meters', '0.42'], ['shape.height', 'meters', '1.15']],
    },
  });

  // ------------------------------------------------------------------ crate: wooden, breaks into planks
  let plankTex = null;
  function planks() {
    const sc = W().scene;
    if (plankTex && plankTex.getScene() === sc) return plankTex;
    const t = new B.DynamicTexture('mh-planks', 256, sc, true);
    const c = t.getContext();
    c.fillStyle = '#b07a45'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) { c.fillStyle = i % 2 ? '#a66f3c' : '#b98350'; c.fillRect(0, i * 64 + 4, 256, 56); }
    c.strokeStyle = '#5a3a1e'; c.lineWidth = 6;
    for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(0, i * 64); c.lineTo(256, i * 64); c.stroke(); }
    c.lineWidth = 22; c.strokeStyle = '#7a5130'; c.strokeRect(11, 11, 234, 234);
    c.beginPath(); c.moveTo(20, 20); c.lineTo(236, 236); c.stroke();
    c.fillStyle = '#3a2614'; for (const [x, y] of [[20, 20], [236, 20], [20, 236], [236, 236]]) { c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill(); }
    t.update();
    plankTex = t;
    return t;
  }
  H.kinds.register('crate', {
    physics: 'dynamic',
    maker: true,
    build(sh, o) {
      const s = L.size3(sh.size, 1);
      const e = L.shape('crate', () => B.MeshBuilder.CreateBox('crate', { width: s[0], height: s[1], depth: s[2] }, W().scene), o);
      if (!o.texture) { e._mat.diffuseTexture = planks(); e._mat.diffuseColor = o.color ? hexc(o.color) : new B.Color3(1, 1, 1); }
      e.data.crate = true;
      e._break = { strength: num(sh.strength, 11), pieces: num(sh.pieces, 8), respawn: num(sh.respawn, 0) };
      if (e.hp === undefined) e.maxHp = e.hp = num(sh.hp, 30);
      return e;
    },
    editor: {
      word: 'a crate that breaks', textureable: true,
      lift: (spec) => L.size3(spec.shape && spec.shape.size, 1)[1] / 2 + 0.02,
      motion: [['dynamic', 'Falls and can be thrown'], ['static', 'Stays put']],
      hotbar: [{ order: 611, icon: '📦', label: 'Breakable crate', make: () => ({ type: 'crate', name: 'Crate', physics: 'dynamic' }) }],
    },
    codex: {
      group: 'Mayhem', what: 'A wooden crate that breaks into pieces when it is hit hard, shot, blown up or burnt down.',
      spec: { type: 'crate', name: 'Crate', transform: { position: [0, 0.5, 0] }, physics: 'dynamic' },
      fields: [['shape.size', 'meters ([w, h, d] or a number)', '1'], ['shape.strength', 'impact speed that breaks it (m/s)', '11'], ['shape.pieces', 'how many pieces', '8'], ['shape.hp', 'damage that breaks it', '30'], ['shape.respawn', 'seconds until it is back (0: not until the game starts over)', '0']],
    },
  });

  // ------------------------------------------------------------------ tool pickup: walk into it to hold a tool
  const TOOL_LOOK = {
    'rocket-launcher': ['#ff6b3d', 'Rocket launcher'], grenade: ['#6b8f3a', 'Grenades'], 'sticky-bomb': ['#e03a5a', 'Sticky bombs'],
    'spawn-gun': ['#38bdf8', 'Spawn gun'], 'gravity-gun': ['#f59e0b', 'Gravity gun'], lasso: ['#c69c6d', 'Lasso'],
    flamethrower: ['#ff8c1a', 'Flamethrower'], matches: ['#ffd166', 'Matches'],
  };
  H.kinds.register('tool-pickup', {
    physics: 'none',
    maker: (tool = 'rocket-launcher', o = {}) => toolPickup({ tool, ...o }, o),
    build: (sh, o) => toolPickup(sh, o),
    editor: {
      word: 'a tool to pick up',
      lift: () => 0.05,
      motion: [],
      hotbar: Object.entries(TOOL_LOOK).filter(([t]) => t !== 'matches').map(([tool, [, label]], i) => ({ order: 620 + i, icon: ['🚀', '💣', '🧨', '✨', '🌀', '➰', '🔥'][i] || '★', label, make: () => ({ type: 'tool-pickup', name: label, shape: { tool } }) })),
    },
    codex: {
      group: 'Mayhem', what: 'A tool on a glowing pad: walk into it while playing and you hold it (Q switches between the tools you have). Tools: rocket-launcher, grenade, sticky-bomb, spawn-gun, gravity-gun, lasso, flamethrower, matches.',
      spec: { type: 'tool-pickup', name: 'Rocket launcher', transform: { position: [0, 0.05, 0] }, shape: { tool: 'rocket-launcher' } },
      fields: [['shape.tool', 'rocket-launcher, grenade, sticky-bomb, spawn-gun, gravity-gun, lasso, flamethrower, matches (or any tool)', 'rocket-launcher'], ['shape.respawn', 'seconds until it is back', '10'], ['shape.options', 'the tool\'s options ({ radius, what, ... })', '']],
    },
  });
  function toolPickup(sh, o) {
    const tool = String(sh.tool || 'rocket-launcher');
    const [color, label] = TOOL_LOOK[tool] || ['#a78bfa', (H.tools.get(tool) && H.tools.get(tool).title) || tool];
    const sc = W().scene;
    const root = new B.TransformNode('tool-pickup', sc);
    const e = new L.Entity(root, { ...o, physics: 'none' }, 'tool-pickup');
    const glow = new B.StandardMaterial('tp-glow', sc); glow.emissiveColor = hexc(color); glow.disableLighting = true; glow.alpha = 0.85;
    const pad = B.MeshBuilder.CreateCylinder('tp-pad', { diameter: 1.4, height: 0.08, tessellation: 32 }, sc);
    const padMat = new B.StandardMaterial('tp-pad', sc); padMat.diffuseColor = new B.Color3(0.12, 0.13, 0.17); padMat.emissiveColor = hexc(color).scale(0.25);
    pad.material = padMat; pad.parent = root; pad.position.y = 0.04;
    const ring = B.MeshBuilder.CreateTorus('tp-ring', { diameter: 1.3, thickness: 0.05, tessellation: 40 }, sc);
    ring.material = glow; ring.parent = root; ring.position.y = 0.1;
    // The tool itself, floating: a stand-in shape per tool.
    const item = new B.TransformNode('tp-item', sc); item.parent = root; item.position.y = 0.55;
    const dark = new B.StandardMaterial('tp-dark', sc); dark.diffuseColor = new B.Color3(0.15, 0.16, 0.2);
    const bit = (m, mat, x, y, z) => { m.material = mat; m.parent = item; m.position.set(x, y, z); return m; };
    if (tool === 'grenade' || tool === 'sticky-bomb') { bit(B.MeshBuilder.CreateSphere('tp-b', { diameter: 0.4, segments: 12 }, sc), tool === 'grenade' ? dark : glow, 0, 0, 0); bit(B.MeshBuilder.CreateBox('tp-c', { width: 0.1, height: 0.12, depth: 0.1 }, sc), glow, 0, 0.24, 0); }
    else if (tool === 'lasso') bit(B.MeshBuilder.CreateTorus('tp-l', { diameter: 0.6, thickness: 0.06, tessellation: 24 }, sc), glow, 0, 0, 0).rotation.x = Math.PI / 2;
    else if (tool === 'matches') { bit(B.MeshBuilder.CreateBox('tp-m', { width: 0.35, height: 0.08, depth: 0.22 }, sc), glow, 0, 0, 0); }
    else {
      bit(B.MeshBuilder.CreateBox('tp-body', { width: 0.16, height: 0.18, depth: 0.7 }, sc), dark, 0, 0, 0);
      bit(B.MeshBuilder.CreateCylinder('tp-barrel', { diameter: tool === 'rocket-launcher' ? 0.24 : 0.12, height: 0.5, tessellation: 14 }, sc), glow, 0, 0.04, 0.45).rotation.x = Math.PI / 2;
      bit(B.MeshBuilder.CreateBox('tp-grip', { width: 0.1, height: 0.22, depth: 0.1 }, sc), dark, 0, -0.17, -0.12);
    }
    const tag = H.textPlane(label, { size: 0.22 });
    tag.parent = root; tag.position.y = 1.3; tag.isPickable = false; tag.metadata = { decor: true };
    for (const m of root.getChildMeshes()) { if (!m.metadata) m.metadata = { entity: e }; }
    e._mat = glow;
    e.pickup = { tool, opts: sh.options && typeof sh.options === 'object' ? sh.options : {}, respawn: num(sh.respawn, 10), item, away: 0 };
    e.onDestroy(() => { glow.dispose(); padMat.dispose(); dark.dispose(); });
    L.place(e, { ...o, shadow: false });
    return e;
  }
  H.mayhem.steps.push((dt) => {
    const w = W();
    const p = w.player;
    const t = (Date.now() + L.clockOffset) / 1000;
    for (const e of w.entities) {
      const pk = e.pickup;
      if (!pk || !e.alive) continue;
      pk.item.rotation.y = t * 1.5; pk.item.position.y = 0.55 + Math.sin(t * 2.2 + e.x) * 0.06;
      // Gone after taking: back only once the timer is out AND the player has left the (larger) leave radius.
      if (pk.away > 0) {
        pk.away -= dt;
        if (pk.away <= 0) {
          if (p && p.alive && Math.hypot(p.x - e.x, p.z - e.z) < 3) pk.away = 0.01;
          else { pk.item.setEnabled(true); pk.used = false; }
        }
        continue;
      }
      if (!p || !p.alive || H.mode === 'build') continue;
      const near = Math.hypot(p.x - e.x, p.z - e.z) < 1.1 && Math.abs(p.bottom - e.y) < 2;
      // Standing on it when it comes back does not take it again: step off first.
      if (pk.used) { if (!near) pk.used = false; continue; }
      if (near) {
        pk.used = true;
        H.mayhem.giveTool(pk.tool, pk.opts);
        G().burst([e.x, e.y + 1, e.z], { color: e.emissive || '#ffffff', count: 24, speed: 4 });
        H.mayhem.sound('pop', { at: e.position });
        pk.item.setEnabled(false);
        pk.away = pk.respawn > 0 ? pk.respawn : 1e9;
        G().emit('pickup', { entity: e, gives: 'tool', tool: pk.tool });
      }
    }
  });
})();
