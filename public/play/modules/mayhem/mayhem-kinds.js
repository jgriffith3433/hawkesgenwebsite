// Mayhem's kinds of things: exploding barrels, breakable crates, critters (stand-in animals that tumble and get back
// up, a model by asset name when one exists) and tool pickups (walk into one to hold a mayhem tool).
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
      const ringMat = new B.StandardMaterial('barrel-ring', sc); ringMat.diffuseColor = new B.Color3(0.18, 0.12, 0.1);
      const band = new B.StandardMaterial('barrel-band', sc); band.diffuseColor = hexc('#f4c430'); band.emissiveColor = hexc('#3a2a00');
      const parts = [];
      for (const y of [-h * 0.32, h * 0.32]) {
        const ring = B.MeshBuilder.CreateTorus('barrel-ring', { diameter: r * 2 + 0.02, thickness: 0.05, tessellation: 24 }, sc);
        ring.position.y = y; ring.material = ringMat; parts.push(ring);
      }
      const stripe = B.MeshBuilder.CreateCylinder('barrel-band', { diameter: r * 2 + 0.012, height: h * 0.16, tessellation: 20 }, sc);
      stripe.material = band; parts.push(stripe);
      for (const m of parts) { m.parent = e.node; m.isPickable = true; m.metadata = { decor: true }; }
      e.data.explosive = { radius: num(sh.power, 6), force: num(sh.force, 22), damage: num(sh.damage, 60), fire: sh.fire !== false, strength: num(sh.strength, 16) };
      e.data.barrel = true;
      if (e.hp === undefined) e.maxHp = e.hp = num(sh.hp, 20);
      e.onDestroy(() => { ringMat.dispose(); band.dispose(); });
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

  // ------------------------------------------------------------------ critter: a stand-in animal
  // Sizes in meters: body [w, h, d], head [w, h, d], legs (count, length), colors, and a few extras.
  const SPECIES = {
    cow: { body: [0.9, 0.75, 1.6], head: [0.5, 0.5, 0.55], legs: [4, 0.6], color: '#f2efe6', leg: '#f2efe6', spots: '#2b2b2b', snout: '#f2b8c0', horns: '#e8dcc0' },
    pig: { body: [0.7, 0.6, 1.1], head: [0.45, 0.42, 0.4], legs: [4, 0.3], color: '#f4a6b4', snout: '#e7889c', ears: '#e7889c' },
    sheep: { body: [0.85, 0.75, 1.1], head: [0.32, 0.38, 0.42], legs: [4, 0.45], color: '#f5f3ea', headColor: '#2e2a28', leg: '#2e2a28', round: true },
    chicken: { body: [0.34, 0.36, 0.46], head: [0.2, 0.24, 0.2], legs: [2, 0.24], color: '#ffffff', leg: '#f2a516', beak: '#f2a516', comb: '#e03a3a' },
    duck: { body: [0.36, 0.32, 0.5], head: [0.22, 0.24, 0.24], legs: [2, 0.16], color: '#f7d43a', leg: '#f28c16', beak: '#f28c16' },
    penguin: { body: [0.46, 0.8, 0.42], head: [0.32, 0.3, 0.32], legs: [2, 0.08], color: '#1e2230', belly: '#f5f5f5', leg: '#f28c16', beak: '#f28c16', upright: true },
    horse: { body: [0.7, 0.8, 1.7], head: [0.34, 0.46, 0.75], legs: [4, 0.95], color: '#8a5a36', leg: '#6b4428', mane: '#2b1d14' },
    dog: { body: [0.42, 0.42, 0.85], head: [0.36, 0.36, 0.42], legs: [4, 0.36], color: '#c08a4a', snout: '#3a2a1a', ears: '#8a5a2a', tail: '#c08a4a' },
    cat: { body: [0.3, 0.3, 0.62], head: [0.3, 0.28, 0.28], legs: [4, 0.26], color: '#7a7a80', ears: '#7a7a80', tail: '#7a7a80' },
    rabbit: { body: [0.34, 0.34, 0.5], head: [0.26, 0.26, 0.28], legs: [4, 0.12], color: '#f2f2f2', ears: '#f2f2f2', longEars: true, tail: '#ffffff' },
    bear: { body: [1.0, 0.95, 1.6], head: [0.6, 0.55, 0.55], legs: [4, 0.55], color: '#5b3a22', snout: '#3a2614', ears: '#5b3a22' },
    frog: { body: [0.4, 0.22, 0.42], head: [0.36, 0.18, 0.26], legs: [4, 0.08], color: '#4caf50', eyes: true },
    elephant: { body: [1.5, 1.4, 2.3], head: [1.0, 1.0, 0.8], legs: [4, 1.0], color: '#8d8f96', ears: '#8d8f96', trunk: '#8d8f96', bigEars: true },
    dinosaur: { body: [0.9, 1.0, 1.8], head: [0.6, 0.6, 0.9], legs: [2, 0.9], color: '#5aa05a', tail: '#5aa05a', spikes: '#3a703a' },
    slime: { body: [0.8, 0.6, 0.8], head: null, legs: [0, 0], color: '#66dd77', round: true, blob: true },
  };
  const ALIAS = { hen: 'chicken', rooster: 'chicken', bird: 'chicken', goose: 'duck', bunny: 'rabbit', dino: 'dinosaur', calf: 'cow', lamb: 'sheep', piglet: 'pig', puppy: 'dog', kitten: 'cat', blob: 'slime', pony: 'horse', goat: 'sheep', llama: 'horse', panda: 'bear', wolf: 'dog', fox: 'dog', deer: 'horse', zebra: 'horse', lion: 'cat', tiger: 'cat', mouse: 'rabbit', rat: 'rabbit', turtle: 'frog' };
  const TINT = { goat: '#d9d2c3', llama: '#e8dcc0', panda: '#f2f2f2', wolf: '#808890', fox: '#e0702a', deer: '#a0703a', zebra: '#f2f2f2', lion: '#d9a441', tiger: '#e8822a', mouse: '#9a9aa0', rat: '#6a6a70', turtle: '#3a7a4a', pony: '#c79a6a' };
  /** A species' look (any word works: unknown ones get a body in a color from their name). */
  function species(name) {
    const n = String(name || 'cow').toLowerCase();
    const base = SPECIES[n] || SPECIES[ALIAS[n]];
    if (base) return { ...base, color: TINT[n] || base.color, leg: TINT[n] ? undefined : base.leg, name: n };
    const COLS = ['#d98b5f', '#8fb3d9', '#b38fd9', '#d9c78f', '#8fd9a8', '#d98fae'];
    return { body: [0.6, 0.5, 0.9], head: [0.4, 0.38, 0.4], legs: [4, 0.4], color: COLS[M.hashSeed(n) % COLS.length], name: n };
  }
  // One source mesh per shape and color for the whole world: every critter's parts are instances of them, so a
  // hundred cows cost a handful of materials.
  const sources = new Map();
  function source(kind, color) {
    const sc = W().scene;
    const key = `${kind}:${color}`;
    const have = sources.get(key);
    if (have && have.getScene() === sc && !have.isDisposed()) return have;
    const m = kind === 'sphere' ? B.MeshBuilder.CreateSphere('mh-part', { diameter: 1, segments: 10 }, sc) : B.MeshBuilder.CreateBox('mh-part', { size: 1 }, sc);
    const mat = new B.StandardMaterial(`mh-${key}`, sc);
    mat.diffuseColor = hexc(color, '#cccccc'); mat.specularColor = new B.Color3(0.06, 0.06, 0.06);
    m.material = mat; m.isPickable = false; m.metadata = { decor: true };
    m.position.y = -10000;
    m.receiveShadows = true; // for every instance
    sources.set(key, m);
    return m;
  }
  H.mayhem.leaves.push(() => { sources.clear(); plankTex = null; });

  function critterHeight(sp) { return (sp.legs[1] || 0) + sp.body[1] + (sp.head && sp.upright ? sp.head[1] : sp.head ? sp.head[1] * 0.3 : 0); }
  function critter(sh, o) {
    const sp = species(sh.species || sh.animal || 'cow');
    const want = num(sh.size, 0);
    const h0 = critterHeight(sp);
    const k = want ? want / h0 : 1;
    // A model by asset name (cow.glb) when the game has one; the stand-in until then.
    const asset = sh.asset || [`${sp.name}.glb`, `${sh.species}.glb`].find((n) => L.hasAsset(n));
    let e;
    if (asset && L.hasAsset(asset)) {
      e = H.kinds.get('model').build({ asset, size: want || h0 }, { ...o, physics: o.physics || 'dynamic' }, null);
    } else {
      const root = new B.TransformNode(`critter:${sp.name}`, W().scene);
      e = new L.Entity(root, { ...o, physics: o.physics || 'dynamic' }, 'critter');
      const legLen = sp.legs[1] * k;
      const bw = sp.body[0] * k, bh = sp.body[1] * k, bd = sp.body[2] * k;
      const total = h0 * k;
      const bodyY = -total / 2 + legLen + bh / 2;
      const part = (kind, color, size, pos, rot) => {
        const m = source(kind, color).createInstance('mh-critter-part');
        m.parent = root; m.scaling.set(size[0], size[1], size[2]); m.position.set(pos[0], pos[1], pos[2]);
        if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
        m.isPickable = true;
        return m;
      };
      part(sp.round ? 'sphere' : 'box', sp.color, [bw, bh, bd], [0, bodyY, 0]);
      if (sp.belly) part('box', sp.belly, [bw * 0.7, bh * 0.75, 0.04 * k], [0, bodyY - bh * 0.05, bd / 2 + 0.01]);
      if (sp.spots) { part('box', sp.spots, [0.02, bh * 0.4, bd * 0.3], [bw / 2 + 0.005, bodyY + bh * 0.1, -bd * 0.15]); part('box', sp.spots, [0.02, bh * 0.3, bd * 0.25], [-bw / 2 - 0.005, bodyY, bd * 0.12]); part('box', sp.spots, [bw * 0.5, 0.02, bd * 0.25], [0, bodyY + bh / 2 + 0.005, bd * 0.05]); }
      e._legs = [];
      const [nl, ll] = sp.legs;
      if (nl === 4) for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) e._legs.push(part('box', sp.leg || sp.color, [bw * 0.2, legLen, Math.min(bd * 0.18, bw * 0.24)], [lx * bw * 0.32, -total / 2 + legLen / 2, lz * bd * 0.36]));
      else if (nl === 2) for (const lx of [-1, 1]) e._legs.push(part('box', sp.leg || sp.color, [bw * 0.14, legLen, bw * 0.14], [lx * bw * 0.22, -total / 2 + legLen / 2, 0]));
      if (sp.head) {
        const hw = sp.head[0] * k, hh = sp.head[1] * k, hd = sp.head[2] * k;
        const hy = sp.upright ? bodyY + bh / 2 + hh / 2 : bodyY + bh * 0.25 + hh * 0.3;
        const hz = sp.upright ? 0 : bd / 2 + hd * 0.35;
        part('box', sp.headColor || sp.color, [hw, hh, hd], [0, hy, hz]);
        const face = hz + hd / 2;
        if (sp.snout) part('box', sp.snout, [hw * 0.6, hh * 0.35, 0.08 * k], [0, hy - hh * 0.2, face + 0.03 * k]);
        if (sp.beak) part('box', sp.beak, [hw * 0.4, hh * 0.18, hd * 0.5], [0, hy - hh * 0.05, face + hd * 0.2]);
        if (sp.comb) part('box', sp.comb, [hw * 0.18, hh * 0.35, hd * 0.6], [0, hy + hh * 0.6, hz]);
        if (sp.horns) for (const s of [-1, 1]) part('box', sp.horns, [0.06 * k, 0.18 * k, 0.06 * k], [s * hw * 0.42, hy + hh * 0.58, hz - hd * 0.1]);
        if (sp.ears) for (const s of [-1, 1]) part('box', sp.ears, sp.longEars ? [0.06 * k, hh * 1.1, 0.12 * k] : sp.bigEars ? [0.08 * k, hh * 0.9, hd * 0.8] : [hw * 0.22, hh * 0.25, 0.05 * k], sp.longEars ? [s * hw * 0.22, hy + hh * 0.95, hz - hd * 0.1] : sp.bigEars ? [s * hw * 0.62, hy, hz - hd * 0.1] : [s * hw * 0.38, hy + hh * 0.55, hz - hd * 0.15]);
        if (sp.trunk) part('box', sp.trunk, [hw * 0.22, hh * 0.9, hw * 0.22], [0, hy - hh * 0.55, face + 0.05 * k]);
        if (sp.mane) part('box', sp.mane, [hw * 0.3, hh * 0.3, hd * 0.9], [0, hy + hh * 0.55, hz - hd * 0.2]);
        // Eyes: two dark dots on the face.
        for (const s of [-1, 1]) part('box', '#111111', [hw * 0.14, hh * 0.14, 0.02], [s * hw * 0.26, hy + hh * 0.15, face + 0.01]);
      }
      if (sp.blob) for (const s of [-1, 1]) part('sphere', '#111111', [0.1 * k, 0.12 * k, 0.05 * k], [s * bw * 0.18, bodyY + bh * 0.15, bd / 2 - 0.02]);
      if (sp.tail) part('box', sp.tail, sp.spikes ? [bw * 0.35, bh * 0.35, bd * 0.6] : [0.06 * k, 0.06 * k, bd * 0.35], [0, bodyY + (sp.spikes ? -bh * 0.1 : bh * 0.25), -bd / 2 - (sp.spikes ? bd * 0.25 : bd * 0.12)]);
      if (sp.spikes) for (let i = 0; i < 3; i++) part('box', sp.spikes, [0.06 * k, 0.22 * k, 0.22 * k], [0, bodyY + bh / 2 + 0.08 * k, bd * (0.25 - i * 0.25)], [Math.PI / 4, 0, 0]);
      // Shadows by hand: instances take receiving from their source (place() would set it on each, with a warning).
      L.place(e, { ...o, shadow: false });
      if (W().shadows && o.shadow !== false) for (const m of root.getChildMeshes()) W().shadows.addShadowCaster(m);
    }
    e.data.critter = sp.name;
    e.data.color = sp.color;
    e.data.upright = true;
    e.mass = o.mass !== undefined ? e.mass : Math.max(0.3, (sp.body[0] * sp.body[1] * sp.body[2]) * k * k * k * 300);
    e.upright = true;
    if (e.hp === undefined) e.maxHp = e.hp = num(sh.hp, Math.round(15 + e.mass * 0.1));
    e.data.wander = sh.wander !== false;
    e._critter = { state: 'graze', t: Math.random() * 3, dir: { x: 0, z: 0 }, speed: num(sh.speed, sp.legs[0] === 2 ? 1.3 : 1.1) * (sp.legs[1] > 0.7 ? 1.6 : 1), phase: Math.random() * 6 };
    return e;
  }
  H.kinds.register('critter', {
    physics: 'dynamic',
    maker: (species = 'cow', o = {}) => (typeof species === 'object' ? critter(species, species) : critter({ ...o, species }, o)),
    build: (sh, o) => critter(sh, o),
    editor: {
      word: 'an animal',
      lift: (spec) => { const sp = species(spec.shape && spec.shape.species); const want = num(spec.shape && spec.shape.size, 0); return (want || critterHeight(sp)) / 2 + 0.03; },
      motion: [['dynamic', 'Wanders and tumbles'], ['static', 'Stands still']],
      hotbar: [
        { order: 612, icon: '🐄', label: 'Cow', make: () => ({ type: 'critter', name: 'Cow', shape: { species: 'cow' }, physics: 'dynamic' }) },
        { order: 613, icon: '🐖', label: 'Pig', make: () => ({ type: 'critter', name: 'Pig', shape: { species: 'pig' }, physics: 'dynamic' }) },
        { order: 614, icon: '🐔', label: 'Chicken', make: () => ({ type: 'critter', name: 'Chicken', shape: { species: 'chicken' }, physics: 'dynamic' }) },
      ],
    },
    codex: {
      group: 'Mayhem', what: 'A stand-in animal made of blocks (cow, pig, sheep, chicken, duck, penguin, horse, dog, cat, rabbit, bear, frog, elephant, dinosaur, slime, or any word). It grazes and wanders, runs from blasts, flies and tumbles when hit and gets back up. A model named after it (cow.glb) takes its place when the game has one.',
      spec: { type: 'critter', name: 'Cow', transform: { position: [0, 0.8, 0] }, shape: { species: 'cow' }, physics: 'dynamic' },
      fields: [['shape.species', 'cow, pig, sheep, chicken, duck, penguin, horse, dog, cat, rabbit, bear, frog, elephant, dinosaur, slime, or any word', 'cow'], ['shape.size', 'height in meters', 'its own'], ['shape.hp', 'health', 'by size'], ['shape.wander', 'false: stands still', 'true'], ['shape.speed', 'walking speed (m/s)', '1.1'], ['shape.asset', 'a model to use instead', '<species>.glb']],
    },
  });

  // Critters graze, wander, run from blasts, and swing their legs while they walk.
  H.mayhem.steps.push((dt) => {
    const w = W(), g = G();
    const many = H.mayhem.spawned.length > 150 || H.mayhem.quality > 1;
    const cam = w.scene.activeCamera;
    for (const e of w.entities) {
      const c = e._critter;
      if (!c || !e.alive || e.dead || e.remote || e.held || e._tumble || e.physics !== 'dynamic') continue;
      c.t -= dt;
      let dir = null, speed = 0;
      if (e._panic) {
        e._panic.t -= dt;
        const away = { x: e.x - e._panic.from[0], z: e.z - e._panic.from[2] };
        if (e._panic.t <= 0) { e._panic = null; c.state = 'graze'; c.t = 1 + Math.random() * 2; }
        else { dir = away; speed = c.speed * 3.5; }
        if (e._panic && !e._panic.said && e.data.critter === 'cow' && Math.random() < 0.3) { e._panic.said = true; H.mayhem.sound('moo', { at: e.position, volume: 0.6 }); }
      } else if (e.data.wander !== false && !many && H.mode !== 'build') {
        if (c.t <= 0) {
          c.state = c.state === 'walk' ? 'graze' : Math.random() < (H.mayhem.spawned.length > 60 ? 0.25 : 0.55) ? 'walk' : 'graze';
          c.t = c.state === 'walk' ? 1.5 + Math.random() * 3 : 2 + Math.random() * 5;
          const a = Math.random() * Math.PI * 2;
          c.dir = { x: Math.sin(a), z: Math.cos(a) };
          if (c.state === 'graze') e.walk({ x: 0, z: 0 }, 0);
        }
        if (c.state === 'walk') { dir = c.dir; speed = c.speed; }
      }
      if (dir) {
        e.walk(dir, speed);
        // Leg swing (close to the camera only).
        if (e._legs && e._legs.length && cam && H.mayhem.quality === 0 && Math.abs(e.x - cam.position.x) + Math.abs(e.z - cam.position.z) < 40) {
          c.phase += dt * speed * 6;
          e._legs.forEach((l, i) => { l.rotation.x = Math.sin(c.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.5; });
        }
      } else if (e._legs && e._legs[0] && e._legs[0].rotation.x) for (const l of e._legs) l.rotation.x *= 0.8;
    }
    void g;
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
    const item = new B.TransformNode('tp-item', sc); item.parent = root; item.position.y = 1;
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
    tag.parent = root; tag.position.y = 1.75; tag.isPickable = false; tag.metadata = { decor: true };
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
      pk.item.rotation.y = t * 1.5; pk.item.position.y = 1 + Math.sin(t * 2.2 + e.x) * 0.1;
      if (pk.away > 0) { pk.away -= dt; if (pk.away <= 0) pk.item.setEnabled(true); continue; }
      if (!p || !p.alive || H.mode === 'build') continue;
      if (Math.hypot(p.x - e.x, p.z - e.z) < 1.1 && Math.abs(p.bottom - e.y) < 2) {
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
