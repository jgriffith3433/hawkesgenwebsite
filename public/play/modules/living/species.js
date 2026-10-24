// Living things, part 2: the species and their bodies. Every species is a table row (size, speed, temper, who it
// runs from, what it eats) and a stand-in body made of primitives (a torso, legs on hip joints, a head on a neck, a
// tail, ears, wings) that walks, grazes, sleeps and wags procedurally. Parts are instances of shared meshes (one draw
// call per shape and color, not per animal), so a herd of 100 is cheap. When the game has a model for the species
// (shape.model, or "<species>.glb"), it's loaded once per world and copied per animal, and its clips play by name
// (walk, run, idle, eat, sleep...). H.living.species.add(name, def) adds a species.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const living = (H.living = H.living || {});
  const RAD = Math.PI / 180;

  // ------------------------------------------------------------------ the species table
  // plan: quad (four legs), bird (two legs, body level), human (upright), fish. Sizes in meters at size 1.
  // temper: calm (flees when you run at it), shy (flees early), pet (follows its person), predator (hunts what it
  //   `hunts`), angry (hunts players too), neutral (minds its business, fights back), person.
  // group: herd / flock / pack / solo: herds and flocks keep together and stampede together.
  const SPECIES = {
    cow: { plan: 'quad', len: 1.9, h: 0.85, w: 0.8, legH: 0.7, legW: 0.17, head: [0.42, 0.42, 0.5], neck: null, tail: [0.06, 0.75, -60], ears: 1, horns: 1, nose: '#e8a3a0', spots: '#2a2522', colors: { body: '#f2efe8', head: '#f2efe8', legs: '#f2efe8', accent: '#2a2522' }, walk: 1.2, run: 5.5, temper: 'calm', group: 'herd', diet: 'grass', hp: 160, mass: 400, shy: 3.5, sound: 'moo', clips: {} },
    sheep: { plan: 'quad', len: 1.05, h: 0.62, w: 0.7, legH: 0.42, legW: 0.11, fluffy: 1, head: [0.26, 0.3, 0.34], tail: [0.08, 0.15, -40], ears: 1, colors: { body: '#efe9da', head: '#3b332d', legs: '#3b332d', accent: '#3b332d' }, walk: 1.1, run: 5, temper: 'calm', group: 'herd', diet: 'grass', hp: 60, mass: 60, shy: 5, sound: 'baa' },
    pig: { plan: 'quad', len: 1.1, h: 0.6, w: 0.62, legH: 0.32, legW: 0.13, head: [0.38, 0.36, 0.3], tail: [0.04, 0.2, 20], ears: 1, nose: '#d9828c', colors: { body: '#f2a7b0', head: '#f2a7b0', legs: '#e8959f', accent: '#c96f7c' }, walk: 1.1, run: 4.5, temper: 'calm', group: 'herd', diet: 'grass', hp: 80, mass: 120, shy: 3, sound: 'oink' },
    horse: { plan: 'quad', len: 2.0, h: 0.8, w: 0.6, legH: 1.0, legW: 0.15, neck: [0.28, 0.8, 50], head: [0.26, 0.3, 0.62], tail: [0.1, 0.8, -55], ears: 1, mane: 1, colors: { body: '#8a5a36', head: '#8a5a36', legs: '#6b4428', accent: '#2a1d14' }, walk: 1.6, run: 11, temper: 'calm', group: 'herd', diet: 'grass', hp: 180, mass: 450, shy: 5, rideable: true, sound: 'neigh' },
    deer: { plan: 'quad', len: 1.3, h: 0.55, w: 0.45, legH: 0.85, legW: 0.09, neck: [0.18, 0.55, 55], head: [0.2, 0.22, 0.38], tail: [0.08, 0.15, 30], ears: 1, antlers: 1, colors: { body: '#a8713f', head: '#a8713f', legs: '#8f5f34', accent: '#f1e6d4' }, walk: 1.3, run: 10, temper: 'shy', group: 'herd', diet: 'grass', hp: 60, mass: 80, shy: 14, sound: 'deer' },
    dog: { plan: 'quad', len: 0.8, h: 0.36, w: 0.32, legH: 0.38, legW: 0.09, head: [0.26, 0.26, 0.32], tail: [0.05, 0.4, 35], ears: 1, nose: '#1d1d1d', colors: { body: '#c98f4f', head: '#c98f4f', legs: '#b07a41', accent: '#3a2a1c' }, walk: 2, run: 8, temper: 'pet', group: 'solo', diet: 'meat', hp: 60, mass: 25, sound: 'bark', fetches: true },
    cat: { plan: 'quad', len: 0.55, h: 0.24, w: 0.2, legH: 0.22, legW: 0.06, head: [0.2, 0.18, 0.18], tail: [0.04, 0.45, 70], ears: 1, nose: '#e7a0a6', colors: { body: '#5d5d66', head: '#5d5d66', legs: '#4b4b52', accent: '#f2f2f2' }, walk: 1.4, run: 7, temper: 'pet', aloof: true, group: 'solo', diet: 'meat', hp: 30, mass: 5, sound: 'meow' },
    wolf: { plan: 'quad', len: 1.2, h: 0.45, w: 0.36, legH: 0.55, legW: 0.1, head: [0.3, 0.28, 0.42], tail: [0.08, 0.5, -20], ears: 1, nose: '#151515', colors: { body: '#7d7f86', head: '#8c8e95', legs: '#6c6e75', accent: '#d8d8dc' }, walk: 1.6, run: 9.5, temper: 'predator', hunts: ['sheep', 'chicken', 'deer', 'rabbit', 'pig'], group: 'pack', diet: 'meat', hp: 90, mass: 50, bite: 12, sound: 'howl' },
    bear: { plan: 'quad', len: 1.7, h: 0.95, w: 0.9, legH: 0.55, legW: 0.24, head: [0.48, 0.44, 0.48], tail: [0.1, 0.12, 0], ears: 1, nose: '#2a1a12', colors: { body: '#5a3a24', head: '#5a3a24', legs: '#4a2f1d', accent: '#2a1a12' }, walk: 1.1, run: 8, temper: 'neutral', group: 'solo', diet: 'meat', hp: 320, mass: 350, bite: 22, guard: 3, sound: 'growl' },
    rabbit: { plan: 'quad', len: 0.42, h: 0.26, w: 0.24, legH: 0.12, legW: 0.07, head: [0.18, 0.18, 0.2], tail: [0.08, 0.08, 40], longEars: 1, colors: { body: '#c8b6a0', head: '#c8b6a0', legs: '#b8a690', accent: '#ffffff' }, walk: 1.5, run: 7, hops: true, temper: 'shy', group: 'herd', diet: 'grass', hp: 20, mass: 3, shy: 6, sound: 'squeak' },
    chicken: { plan: 'bird', len: 0.45, h: 0.38, w: 0.32, legH: 0.18, legW: 0.035, head: [0.16, 0.18, 0.16], beak: '#f0b429', comb: '#d62f2f', wings: 1, tail: [0.18, 0.2, 50], colors: { body: '#f6f1e6', head: '#f6f1e6', legs: '#e8a32a', accent: '#d62f2f' }, walk: 1, run: 4.5, temper: 'shy', group: 'flock', diet: 'seeds', hp: 15, mass: 2.5, shy: 4, sound: 'cluck' },
    bird: { plan: 'bird', len: 0.3, h: 0.18, w: 0.16, legH: 0.08, legW: 0.02, head: [0.12, 0.12, 0.12], beak: '#f0b429', wings: 1, flies: true, tail: [0.1, 0.18, 10], colors: { body: '#3f7fd9', head: '#3f7fd9', legs: '#5a4630', accent: '#f4f4f4' }, walk: 0.8, run: 3, fly: 6, temper: 'shy', group: 'flock', diet: 'seeds', hp: 5, mass: 0.3, shy: 7, sound: 'tweet' },
    penguin: { plan: 'bird', upright: 1, len: 0.38, h: 0.62, w: 0.36, legH: 0.06, legW: 0.06, head: [0.22, 0.2, 0.2], beak: '#f09a29', wings: 1, belly: '#f4f4f4', colors: { body: '#1e2430', head: '#1e2430', legs: '#f09a29', accent: '#f4f4f4' }, walk: 0.7, run: 2.2, temper: 'calm', group: 'flock', diet: 'meat', hp: 30, mass: 20, shy: 3, sound: 'squawk' },
    dinosaur: { plan: 'bird', dino: 1, len: 2.6, h: 1.1, w: 0.9, legH: 1.3, legW: 0.3, head: [0.6, 0.6, 1.0], arms: 1, tail: [0.35, 2.2, -10], colors: { body: '#4d7a3a', head: '#4d7a3a', legs: '#3f6630', accent: '#e9d8a6' }, walk: 1.8, run: 8.5, temper: 'angry', hunts: ['cow', 'sheep', 'pig', 'horse', 'deer', 'person'], group: 'solo', diet: 'meat', hp: 600, mass: 2000, bite: 30, sight: 18, rideable: true, sound: 'roar' },
    fish: { plan: 'fish', len: 0.6, h: 0.32, w: 0.16, legH: 0, legW: 0, head: null, colors: { body: '#f08a2c', head: '#f08a2c', legs: '#f08a2c', accent: '#ffffff' }, walk: 0.6, run: 2, swims: true, temper: 'shy', group: 'solo', diet: 'none', hp: 10, mass: 1.5, shy: 3, sound: 'splash' },
    person: { plan: 'human', len: 0.42, h: 0.62, w: 0.42, legH: 0.8, legW: 0.15, walk: 1.5, run: 5.5, temper: 'person', group: 'solo', diet: 'none', hp: 100, mass: 70, sound: 'hey', colors: { body: '#3f7fd9', head: '#f1c27d', legs: '#2f3b52', accent: '#3a2a1c' } },
    robot: { plan: 'human', robot: 1, len: 0.46, h: 0.66, w: 0.46, legH: 0.78, legW: 0.16, walk: 1.4, run: 4.5, temper: 'neutral', group: 'solo', diet: 'none', hp: 200, mass: 150, sound: 'beep', colors: { body: '#aab4c3', head: '#c9d2df', legs: '#7d8796', accent: '#3ee6ff' } },
  };
  // Other words for the same things.
  const ALIAS = { 'fish-out-of-water': 'fish', trex: 'dinosaur', 't-rex': 'dinosaur', dino: 'dinosaur', puppy: 'dog', kitten: 'cat', kitty: 'cat', bunny: 'rabbit', hen: 'chicken', rooster: 'chicken', chick: 'chicken', lamb: 'sheep', calf: 'cow', bull: 'cow', cattle: 'cow', pony: 'horse', stag: 'deer', doe: 'deer', fawn: 'deer', human: 'person', villager: 'person', npc: 'person', man: 'person', woman: 'person', kid: 'person', android: 'robot', bot: 'robot', crow: 'bird', pigeon: 'bird', seagull: 'bird', duck: 'chicken', goat: 'sheep', fox: 'dog', puppydog: 'dog', piglet: 'pig' };
  ALIAS.wolves = 'wolf'; ALIAS.ponies = 'horse'; ALIAS.puppies = 'dog'; ALIAS.people = 'person'; ALIAS.fishes = 'fish'; ALIAS.geese = 'chicken'; ALIAS.mice = 'rabbit'; ALIAS.dinos = 'dinosaur';
  // Animals with no table row of their own: a close species' body, their own colors and size (`scale`).
  const LOOKS = {
    elephant: ['cow', '#8d8f96', 1.9], lion: ['dog', '#d9a441', 1.7], tiger: ['dog', '#e8822a', 1.7], zebra: ['horse', '#f2f2f2', 1],
    giraffe: ['horse', '#d9b05a', 1.35], panda: ['bear', '#f2f2f2', 0.9], llama: ['sheep', '#e8dcc0', 1.35], alpaca: ['sheep', '#f0e2c8', 1.1],
    monkey: ['dog', '#7a5230', 0.8], turtle: ['rabbit', '#3a7a4a', 1.1], mouse: ['rabbit', '#9a9aa0', 0.45], rat: ['rabbit', '#6a6a70', 0.5],
    frog: ['rabbit', '#4caf50', 0.8], hamster: ['rabbit', '#e0a060', 0.5], squirrel: ['rabbit', '#a0603a', 0.7], raccoon: ['cat', '#77736e', 1.2],
    moose: ['deer', '#5a3a24', 1.5], camel: ['horse', '#d2a868', 1.15], kangaroo: ['deer', '#b07850', 1], slime: ['pig', '#66dd77', 0.8],
    ostrich: ['chicken', '#3a3030', 3.2], parrot: ['bird', '#2fb04a', 1.3], owl: ['bird', '#8a6a4a', 1.4], eagle: ['bird', '#5a4030', 1.8],
  };
  const derived = new Map();
  function look(name, [base, color, scale]) {
    const b = SPECIES[base];
    return { ...b, colors: { ...b.colors, body: color, head: color, legs: color }, scale, base };
  }
  /** Any other word ("wibble"): a small four-legged body in a color from its name. */
  function generic(word) {
    let h = 2166136261; for (const ch of word) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    const c = ['#d98b5f', '#8fb3d9', '#b38fd9', '#d9c78f', '#8fd9a8', '#d98fae'][(h >>> 0) % 6];
    return look(word, ['pig', c, 1]);
  }
  const singular = (n) => n.replace(/ies$/, 'y').replace(/(ss|x|ch|sh)es$/, '$1').replace(/([^s])s$/, '$1');
  /** The species a word means ("cows", "puppy", "t-rex", "elephants"), or null. */
  function nameOf(s) {
    const n = String(s || '').toLowerCase().trim();
    for (const c of [n, n.replace(/s$/, ''), n.replace(/es$/, '')]) { if (SPECIES[c]) return c; if (ALIAS[c]) return ALIAS[c]; if (LOOKS[c]) return c; }
    return null;
  }
  function getDef(name) {
    if (!name) return null;
    if (SPECIES[name]) return SPECIES[name];
    if (!derived.has(name)) derived.set(name, LOOKS[name] ? look(name, LOOKS[name]) : generic(name));
    return derived.get(name);
  }
  const species = {
    get: (s) => getDef(nameOf(s)),
    name: (s) => nameOf(s),
    /** Any word as an animal: { name, def }. Known species and their other words first; any other word gets a stand-in
     *  body in its own color (so "spawn 20 wibbles" works). */
    of(s) {
      const known = nameOf(s);
      if (known) return { name: known, def: getDef(known) };
      const w = singular(String(s || '').toLowerCase().replace(/[^a-z -]/g, '').trim());
      if (!w) return { name: 'cow', def: SPECIES.cow };
      return { name: w, def: getDef(w) };
    },
    /** Words that are animals beyond the table (each looks like a close species). */
    looks: () => Object.keys(LOOKS),
    list: () => Object.keys(SPECIES),
    /** A new species: { plan, len, h, w, legH, legW, head, colors, walk, run, temper, group, diet, hp, mass, ... }
     *  (copy a row of the table: H.living.species.add('goat', { ...H.living.species.get('sheep'), colors: {...} })). */
    add(name, def) { SPECIES[String(name).toLowerCase()] = { plan: 'quad', len: 1, h: 0.6, w: 0.5, legH: 0.5, legW: 0.1, head: [0.3, 0.3, 0.3], colors: { body: '#aaaaaa', head: '#aaaaaa', legs: '#888888', accent: '#333333' }, walk: 1.2, run: 5, temper: 'calm', group: 'solo', diet: 'grass', hp: 50, mass: 50, ...def }; return SPECIES[String(name).toLowerCase()]; },
    aliases: ALIAS,
  };
  living.species = species;
  // Other words for the same animals find the same assets (a "puppy" asset is a dog's).
  if (H.assets) for (const [w, s] of Object.entries(ALIAS)) H.assets.synonym(w, s);

  // ------------------------------------------------------------------ shared meshes: one source per shape and color
  const pools = new WeakMap(); // scene -> { src: Map, mats: Map }
  function pool(scene) {
    let p = pools.get(scene);
    if (!p) { p = { src: new Map(), mats: new Map(), models: new Map() }; pools.set(scene, p); }
    return p;
  }
  function mat(scene, color, glow) {
    const p = pool(scene), key = `${color}|${glow ? 1 : 0}`;
    let m = p.mats.get(key);
    if (!m) {
      m = new B.StandardMaterial(`living-${key}`, scene);
      m.diffuseColor = H.lib.hex(color, '#cccccc');
      m.specularColor = new B.Color3(0.06, 0.06, 0.06);
      if (glow) { m.emissiveColor = H.lib.hex(color); m.disableLighting = true; }
      m.freeze();
      p.mats.set(key, m);
    }
    return m;
  }
  /** A soft box: a sphere pushed out toward a cube (rounded edges, smooth shading), width x height x depth. Bodies are
   *  made of these rather than sharp cubes, so creatures and people read as soft toys, not as blocks. */
  function softBox(name, o, scene) {
    const m = B.MeshBuilder.CreateSphere(name, { diameter: 2, segments: 10, updatable: true }, scene);
    const p = m.getVerticesData(B.VertexBuffer.PositionKind);
    const w = (o.width ?? o.size ?? 1) / 2, h = (o.height ?? o.size ?? 1) / 2, d = (o.depth ?? o.size ?? 1) / 2;
    const k = 0.32; // 1 is a sphere, toward 0 a cube
    const f = (v) => Math.sign(v) * Math.pow(Math.abs(v), k);
    for (let i = 0; i < p.length; i += 3) { p[i] = f(p[i]) * w; p[i + 1] = f(p[i + 1]) * h; p[i + 2] = f(p[i + 2]) * d; }
    m.updateVerticesData(B.VertexBuffer.PositionKind, p);
    const n = [];
    B.VertexData.ComputeNormals(p, m.getIndices(), n);
    m.updateVerticesData(B.VertexBuffer.NormalKind, n);
    return m;
  }
  const MAKE = {
    box: (s) => B.MeshBuilder.CreateBox('lv-box', { size: 1 }, s),
    soft: (s) => softBox('lv-soft', { size: 1 }, s),
    sphere: (s) => B.MeshBuilder.CreateSphere('lv-sphere', { diameter: 1, segments: 8 }, s),
    cyl: (s) => B.MeshBuilder.CreateCylinder('lv-cyl', { diameter: 1, height: 1, tessellation: 10 }, s),
    cone: (s) => B.MeshBuilder.CreateCylinder('lv-cone', { diameterTop: 0, diameterBottom: 1, height: 1, tessellation: 8 }, s),
  };
  function source(scene, shape, color, glow) {
    const p = pool(scene), key = `${shape}|${color}|${glow ? 1 : 0}`;
    let m = p.src.get(key);
    if (!m) {
      m = MAKE[shape](scene);
      m.material = mat(scene, color, glow);
      // The source itself is never seen: only its instances are.
      m.isVisible = false;
      m.isPickable = false;
      m.metadata = { decor: true };
      m.receiveShadows = true;
      const w = H.world;
      if (w && w.shadows && !H.touchUi) w.shadows.addShadowCaster(m, false);
      p.src.set(key, m);
    }
    return m;
  }
  /** One part of a body: an instance of a shared mesh, under `parent`, `size` [x, y, z] meters, at `pos`. */
  function part(scene, parent, shape, color, size, pos, rot, glow) {
    // Body parts are soft; small details (eyes, spots, noses, combs) stay crisp.
    if (shape === 'box' && Math.min(size[0], size[1], size[2]) >= 0.07) shape = 'soft';
    const inst = source(scene, shape, color, glow).createInstance('lv-part');
    inst.parent = parent;
    inst.scaling.set(size[0], size[1], size[2]);
    inst.position.set(pos[0], pos[1], pos[2]);
    if (rot) inst.rotation.set(rot[0] * RAD, rot[1] * RAD, rot[2] * RAD);
    inst.isPickable = false;
    inst.metadata = { decor: true };
    return inst;
  }
  function joint(scene, parent, pos, name = 'lv-joint') {
    const n = new B.TransformNode(name, scene);
    n.parent = parent;
    n.position.set(pos[0], pos[1], pos[2]);
    return n;
  }

  // A few looks for people, picked by the creature's seed.
  const SHIRTS = ['#4f6d8f', '#a85a4a', '#5f8a68', '#c9a35a', '#7a6a96', '#e6e1d6', '#3e4a52'];
  const PANTS = ['#2f3b52', '#3a3a3a', '#5b4636', '#1f4f7a'];
  const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
  const HAIR = ['#3a2a1c', '#14110f', '#d9b25f', '#8e3b1f', '#bdbdbd'];

  /** Builds a stand-in body under `vis` (feet at y = 0, facing +z). Returns the rig the animator moves. */
  function buildBody(scene, vis, sp, o) {
    const s = o.size || 1;
    const c = { ...sp.colors, ...(o.colors || {}) };
    if (o.color) { c.body = o.color; if (!o.colors || !o.colors.head) c.head = sp.colors.head === sp.colors.body ? o.color : c.head; }
    const rig = { vis, hips: [], arms: [], wings: [], head: null, headBase: 0, tail: null, tailBase: 0, torso: null, plan: sp.plan, size: s };
    const L = sp.len * s, Ht = sp.h * s, Wd = sp.w * s, legH = sp.legH * s, legW = Math.max(0.02, sp.legW * s);
    const eyes = (head, hw, hh, hl, z = hl * 0.8) => { for (const sx of [-1, 1]) part(scene, head, 'box', '#141414', [0.03 * s + hw * 0.08, hh * 0.16, 0.02 * s], [sx * hw * 0.42, hh * 0.15, z], null); };
    if (sp.plan === 'quad') {
      const top = legH + Ht;
      const torso = part(scene, vis, sp.fluffy ? 'sphere' : 'box', c.body, sp.fluffy ? [Wd * 1.25, Ht * 1.35, L * 1.1] : [Wd, Ht, L], [0, legH + Ht / 2, 0]);
      rig.torso = torso;
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        const hip = joint(scene, vis, [sx * (Wd / 2 - legW * 0.6), legH, sz * (L / 2 - legW * 0.9)], 'lv-hip');
        part(scene, hip, 'box', c.legs, [legW, legH, legW], [0, -legH / 2, 0]);
        if (sp.hops && sz < 0) hip.scaling.set(1.3, 1, 1.6);
        rig.hips.push({ n: hip, ph: sp.plan === 'quad' ? (sx * sz > 0 ? 0 : Math.PI) : 0, front: sz > 0 });
      }
      if (sp.spots) for (const [sx, z, y] of [[1, 0.15, 0.6], [-1, -0.2, 0.5], [1, -0.3, 0.35], [-1, 0.25, 0.3]]) part(scene, vis, 'box', sp.spots, [0.02 * s, Ht * 0.38, L * 0.22], [sx * (Wd / 2 + 0.006), legH + Ht * y + Ht * 0.1, L * z]);
      // The neck (horses, deer) or straight onto the body.
      const [hw, hh, hl] = (sp.head || [0.3, 0.3, 0.3]).map((v) => v * s);
      let headParent = vis, headAt = [0, top - Ht * 0.15 + hh * 0.2, L / 2 - hl * 0.1];
      if (sp.neck) {
        const [nw, nl, ang] = [sp.neck[0] * s, sp.neck[1] * s, sp.neck[2]];
        const neck = joint(scene, vis, [0, top - Ht * 0.2, L / 2 - nw * 0.4], 'lv-neck');
        neck.rotation.x = -(90 - ang) * RAD;
        part(scene, neck, 'box', c.body, [nw * 0.9, nl, nw], [0, nl / 2, 0]);
        if (sp.mane) part(scene, neck, 'box', c.accent, [nw * 0.35, nl * 0.95, nw * 0.5], [0, nl / 2, -nw * 0.55]);
        headParent = neck; headAt = [0, nl, nw * 0.1];
        rig.neck = neck;
      }
      const head = joint(scene, headParent, headAt, 'lv-head');
      if (sp.neck) head.rotation.x = (90 - sp.neck[2]) * RAD; // level again
      part(scene, head, 'box', c.head, [hw, hh, hl], [0, 0, hl / 2]);
      if (sp.nose) part(scene, head, 'box', sp.nose, [hw * 0.7, hh * 0.4, 0.04 * s], [0, -hh * 0.2, hl]);
      eyes(head, hw, hh, hl, hl * 0.72);
      if (sp.ears) for (const sx of [-1, 1]) part(scene, head, 'box', c.head === c.body ? c.accent : c.head, [hw * 0.28, hh * 0.38, 0.05 * s], [sx * hw * 0.42, hh * 0.6, hl * 0.25], [0, 0, sx * -18]);
      if (sp.longEars) for (const sx of [-1, 1]) part(scene, head, 'box', c.body, [hw * 0.22, hh * 1.4, 0.04 * s], [sx * hw * 0.25, hh * 1.1, hl * 0.25], [0, 0, sx * -8]);
      if (sp.horns) for (const sx of [-1, 1]) part(scene, head, 'cone', '#e9e1cf', [0.07 * s, 0.22 * s, 0.07 * s], [sx * hw * 0.55, hh * 0.62, hl * 0.3], [0, 0, sx * -55]);
      if (sp.antlers) for (const sx of [-1, 1]) { part(scene, head, 'box', '#d8c6a4', [0.03 * s, 0.38 * s, 0.03 * s], [sx * hw * 0.35, hh * 0.9, hl * 0.25], [0, 0, sx * -20]); part(scene, head, 'box', '#d8c6a4', [0.03 * s, 0.2 * s, 0.03 * s], [sx * hw * 0.62, hh * 1.05, hl * 0.4], [-30, 0, sx * -60]); }
      rig.head = head; rig.headBase = head.rotation.x;
      if (sp.tail) {
        const [tw, tl, up] = [sp.tail[0] * s, sp.tail[1] * s, sp.tail[2]];
        const tail = joint(scene, vis, [0, top - Ht * 0.15, -L / 2], 'lv-tail');
        tail.rotation.x = -up * RAD;
        part(scene, tail, sp.fluffy || tl < tw * 2.5 ? 'sphere' : 'box', c.accent && sp.tail[1] < 0.2 ? c.accent : c.body, [tw, tw, tl], [0, 0, -tl / 2]);
        rig.tail = tail; rig.tailBase = tail.rotation.x;
      }
      rig.height = top + (sp.neck ? sp.neck[1] * s * 0.7 : hh * 0.3);
      rig.length = L + hl;
    } else if (sp.plan === 'bird') {
      const upright = Boolean(sp.upright);
      const bodyY = legH + Ht / 2;
      const torso = joint(scene, vis, [0, bodyY, 0], 'lv-torso');
      if (sp.dino) torso.rotation.x = -12 * RAD;
      part(scene, torso, sp.dino ? 'box' : 'sphere', c.body, [Wd, Ht, L], [0, 0, 0]);
      if (sp.belly) part(scene, torso, 'sphere', sp.belly, [Wd * 0.75, Ht * 0.8, L * 0.35], [0, -Ht * 0.04, L * 0.34]);
      rig.torso = torso;
      for (const sx of [-1, 1]) {
        const hip = joint(scene, vis, [sx * Wd * 0.22, legH, sp.dino ? -L * 0.05 : 0], 'lv-hip');
        part(scene, hip, 'box', c.legs, [legW, Math.max(0.02, legH), legW], [0, -legH / 2, 0]);
        part(scene, hip, 'box', c.legs, [legW * 2.2, legW * 0.6, legW * 3], [0, -legH + legW * 0.3, legW]);
        rig.hips.push({ n: hip, ph: sx > 0 ? 0 : Math.PI, front: true });
      }
      const [hw, hh, hl] = (sp.head || [0.15, 0.15, 0.15]).map((v) => v * s);
      const head = joint(scene, vis, upright ? [0, legH + Ht * 0.98, L * 0.05] : [0, bodyY + Ht * 0.45, L / 2 - hl * 0.1], 'lv-head');
      part(scene, head, sp.dino ? 'box' : 'sphere', c.head, [hw, hh, hl], [0, hh * 0.3, hl * 0.3]);
      if (sp.dino) { part(scene, head, 'box', c.accent, [hw * 0.9, hh * 0.25, hl * 0.9], [0, -hh * 0.15, hl * 0.35]); for (let i = -2; i <= 2; i++) part(scene, head, 'cone', '#ffffff', [0.05 * s, 0.1 * s, 0.05 * s], [i * hw * 0.18, -hh * 0.02, hl * 0.78], [180, 0, 0]); }
      if (sp.beak) part(scene, head, 'cone', sp.beak, [hw * 0.35, hl * 0.6, hw * 0.35], [0, hh * 0.25, hl * 0.3 + hl * 0.6], [90, 0, 0]);
      if (sp.comb) part(scene, head, 'box', sp.comb, [0.03 * s, hh * 0.45, hl * 0.6], [0, hh * 0.85, hl * 0.3]);
      eyes(head, hw, hh, hl, hl * 0.62);
      rig.head = head; rig.headBase = 0;
      if (sp.wings) for (const sx of [-1, 1]) {
        const wj = joint(scene, vis, [sx * Wd * 0.45, upright ? legH + Ht * 0.7 : bodyY + Ht * 0.15, upright ? 0 : L * 0.05], 'lv-wing');
        part(scene, wj, 'box', c.body === '#f6f1e6' ? '#ebe4d4' : c.body, upright ? [0.04 * s, Ht * 0.6, L * 0.35] : [Wd * 0.7 * (sp.flies ? 1.8 : 1), 0.03 * s, L * 0.6], upright ? [0, -Ht * 0.28, 0] : [sx * Wd * 0.35 * (sp.flies ? 1.8 : 1), 0, 0]);
        rig.wings.push({ n: wj, side: sx, upright });
      }
      if (sp.arms) for (const sx of [-1, 1]) { const a = joint(scene, vis, [sx * Wd * 0.45, bodyY + Ht * 0.05, L * 0.38], 'lv-arm'); part(scene, a, 'box', c.legs, [0.08 * s, 0.32 * s, 0.08 * s], [0, -0.14 * s, 0.06 * s], [-30, 0, 0]); rig.arms.push({ n: a, ph: sx > 0 ? 0 : Math.PI }); }
      if (sp.tail) {
        const [tw, tl, up] = [sp.tail[0] * s, sp.tail[1] * s, sp.tail[2]];
        const tail = joint(scene, vis, [0, bodyY + Ht * 0.1, -L / 2 + 0.02], 'lv-tail');
        tail.rotation.x = -up * RAD;
        part(scene, tail, sp.dino ? 'cone' : 'box', c.body, sp.dino ? [tw * 1.2, tl, tw * 1.2] : [tw * 1.4, tw * 0.25, tl], sp.dino ? [0, 0, -tl / 2] : [0, 0, -tl / 2], sp.dino ? [-90, 0, 0] : null);
        rig.tail = tail; rig.tailBase = tail.rotation.x;
      }
      rig.height = upright ? legH + Ht + hh : bodyY + Ht / 2 + hh * 0.7;
      rig.length = L + hl;
    } else if (sp.plan === 'human') {
      const seed = o.seed || 0;
      const robot = Boolean(sp.robot);
      const shirt = o.color || (robot ? c.body : SHIRTS[seed % SHIRTS.length]);
      const pants = o.colors && o.colors.legs ? o.colors.legs : robot ? c.legs : PANTS[(seed >> 3) % PANTS.length];
      const skin = o.colors && o.colors.head ? o.colors.head : robot ? c.head : SKINS[(seed >> 5) % SKINS.length];
      const hair = o.colors && o.colors.accent ? o.colors.accent : HAIR[(seed >> 7) % HAIR.length];
      const tw = Wd, th = Ht, td = 0.24 * s;
      for (const sx of [-1, 1]) {
        const hip = joint(scene, vis, [sx * tw * 0.24, legH, 0], 'lv-hip');
        part(scene, hip, robot ? 'box' : 'cyl', pants, [legW, legH, legW * 1.05], [0, -legH / 2, 0]);
        part(scene, hip, 'box', robot ? c.accent === '#3ee6ff' ? '#59616e' : c.accent : '#2b2b2b', [legW * 1.05, 0.08 * s, legW * 1.6], [0, -legH + 0.04 * s, legW * 0.25]);
        rig.hips.push({ n: hip, ph: sx > 0 ? 0 : Math.PI, front: true });
      }
      const torso = joint(scene, vis, [0, legH, 0], 'lv-torso');
      part(scene, torso, 'box', shirt, [tw, th, td], [0, th / 2, 0]);
      if (robot) part(scene, torso, 'box', c.accent, [tw * 0.4, th * 0.18, 0.02 * s], [0, th * 0.62, td / 2 + 0.01], null, true);
      rig.torso = torso;
      for (const sx of [-1, 1]) {
        const sh = joint(scene, torso, [sx * (tw / 2 + 0.06 * s), th * 0.92, 0], 'lv-arm');
        part(scene, sh, robot ? 'box' : 'cyl', robot ? c.legs : shirt, [0.11 * s, 0.3 * s, 0.11 * s], [0, -0.14 * s, 0]);
        part(scene, sh, robot ? 'box' : 'cyl', robot ? c.legs : skin, [0.09 * s, 0.24 * s, 0.09 * s], [0, -0.38 * s, 0]);
        if (!robot) part(scene, sh, 'sphere', skin, [0.11 * s, 0.11 * s, 0.11 * s], [0, -0.53 * s, 0]);
        rig.arms.push({ n: sh, ph: sx > 0 ? Math.PI : 0, side: sx });
      }
      const head = joint(scene, torso, [0, th + 0.02 * s, 0], 'lv-head');
      const hs = 0.3 * s;
      part(scene, head, robot ? 'box' : 'sphere', skin, robot ? [hs, hs * 1.08, hs] : [hs * 1.02, hs * 1.12, hs * 1.02], [0, hs * 0.55, 0]);
      if (robot) {
        for (const sx of [-1, 1]) part(scene, head, 'box', c.accent, [hs * 0.22, hs * 0.12, 0.02 * s], [sx * hs * 0.22, hs * 0.62, hs / 2 + 0.006], null, true);
        part(scene, head, 'cyl', c.legs, [0.025 * s, 0.18 * s, 0.025 * s], [0, hs * 1.15, 0]);
        part(scene, head, 'sphere', c.accent, [0.07 * s, 0.07 * s, 0.07 * s], [0, hs * 1.27, 0], null, true);
      } else {
        part(scene, head, 'sphere', hair, [hs * 1.1, hs * 0.62, hs * 1.1], [0, hs * 0.98, -hs * 0.05]);
        part(scene, head, 'sphere', hair, [hs * 1.04, hs * 0.8, hs * 0.5], [0, hs * 0.72, -hs * 0.3]);
        for (const sx of [-1, 1]) part(scene, head, 'sphere', '#1b1b1b', [hs * 0.13, hs * 0.16, hs * 0.08], [sx * hs * 0.2, hs * 0.6, hs * 0.5]);
      }
      rig.head = head; rig.headBase = 0;
      rig.height = legH + th + hs * 1.2;
      rig.length = td;
    } else {
      // fish: a fat oval with a tail fin and eyes
      const torso = joint(scene, vis, [0, Ht / 2, 0], 'lv-torso');
      part(scene, torso, 'sphere', c.body, [Wd, Ht, L], [0, 0, 0]);
      part(scene, torso, 'box', c.accent, [0.02 * s, Ht * 0.5, L * 0.2], [0, Ht * 0.45, 0]);
      for (const sx of [-1, 1]) part(scene, torso, 'box', '#141414', [0.02 * s, 0.05 * s, 0.05 * s], [sx * Wd * 0.42, Ht * 0.12, L * 0.33]);
      const tail = joint(scene, torso, [0, 0, -L / 2], 'lv-tail');
      part(scene, tail, 'box', c.accent === '#ffffff' ? c.body : c.accent, [0.03 * s, Ht * 0.9, L * 0.3], [0, 0, -L * 0.12]);
      rig.tail = tail; rig.tailBase = 0; rig.torso = torso;
      rig.height = Ht; rig.length = L;
    }
    return rig;
  }

  // ------------------------------------------------------------------ models: by asset id (H.assets), loaded once, copied per animal
  /** The model for this animal: shape.model (an id or a name), else the game's asset for its species' word
   *  (H.assets.pick: the world's choice, mixed over a herd when the word mixes, the same for the same animal). */
  function modelName(sp, name, o) {
    if (o.model) return o.model;
    return H.assets ? H.assets.pick(name, { kind: 'model', seed: o.pickSeed }) : null;
  }
  /** Loads a model once per world (an AssetContainer) and puts a copy under `vis`, scaled to `height`. */
  function loadModel(scene, vis, name, height, rig) {
    const p = pool(scene);
    let c = p.models.get(name);
    if (!c) {
      let url;
      try { url = H.lib.assetUrl(name); } catch { return false; }
      c = B.SceneLoader.LoadAssetContainerAsync('', url, scene, null, '.glb');
      p.models.set(name, c);
    }
    rig.modelLoading = true;
    c.then((cont) => {
      if (vis.isDisposed()) return;
      const inst = cont.instantiateModelsToScene((n) => n, false, { doNotInstantiate: false });
      const holder = new B.TransformNode('lv-model', scene);
      for (const n of inst.rootNodes) n.parent = holder;
      holder.computeWorldMatrix(true);
      let { min, max } = holder.getHierarchyBoundingVectors(true);
      const k = height / Math.max(1e-3, max.y - min.y);
      holder.scaling.setAll(k);
      holder.computeWorldMatrix(true);
      ({ min, max } = holder.getHierarchyBoundingVectors(true));
      holder.position.set(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
      holder.parent = vis;
      if (rig.modelYaw) holder.rotation.y = rig.modelYaw * RAD;
      for (const m of holder.getChildMeshes()) { m.isPickable = false; m.metadata = { decor: true }; if (H.world.shadows && !H.touchUi) H.world.shadows.addShadowCaster(m, false); }
      // The stand-in goes; the model's clips (if any) take over the animating.
      for (const n of rig.standIn || []) n.setEnabled(false);
      rig.model = holder;
      rig.clips = inst.animationGroups || [];
      for (const a of rig.clips) a.stop();
      rig.modelLoading = false;
    }).catch((err) => { rig.modelLoading = false; p.models.delete(name); H.report(new Error(`Could not load ${name}: ${err.message || err}`)); });
    return true;
  }

  /** Makes the body (stand-in, then the model when there is one) of a creature under its collider node. */
  function makeBody(e, sp, spName, o) {
    const scene = H.world.scene;
    const vis = new B.TransformNode('lv-body', scene);
    vis.parent = e.node;
    const rig = buildBody(scene, vis, sp, o);
    rig.standIn = vis.getChildren();
    rig.modelYaw = Number(o.modelYaw) || 0;
    const name = modelName(sp, spName, o);
    rig.modelRef = name;
    if (name) {
      if (!loadModel(scene, vis, name, (o.modelHeight || rig.height), rig) && o.model) e._waiting = o.model; // made later: the engine rebuilds it
    }
    return rig;
  }

  // ------------------------------------------------------------------ animating: walk cycles, head bob, tail wag
  // r.anim = { phase, t }; states (living.js): idle walk run eat sleep sit dance knocked attack cheer fly swim flop
  const lerp = (a, b, k) => a + (b - a) * k;
  function playClip(rig, state, speed) {
    const want = { walk: ['walk'], run: ['run', 'gallop', 'walk'], eat: ['eat', 'graze', 'idle'], sleep: ['sleep', 'lie', 'idle'], sit: ['sit', 'idle'], dance: ['dance', 'idle'], attack: ['attack', 'bite', 'punch'], cheer: ['cheer', 'jump', 'wave'], fly: ['fly', 'flap'], swim: ['swim'], knocked: ['fall', 'hit', 'idle'] }[state] || ['idle'];
    if (rig.playing === state) return;
    for (const w of want) {
      const g = rig.clips.find((a) => a.name.toLowerCase().includes(w));
      if (g) { for (const a of rig.clips) if (a !== g) a.stop(); g.start(true, Math.max(0.5, Math.min(2, speed || 1)), g.from, g.to, false); rig.playing = state; return; }
    }
    rig.playing = state;
  }
  /** Moves the parts for this frame: `state` (a word), `speed` (m/s on the ground), dt (s). */
  function animate(r, dt) {
    const rig = r.rig;
    if (!rig) return;
    const a = r.anim || (r.anim = { phase: Math.random() * 6, t: 0, lie: 0, tip: 0, spin: 0, eat: 0, flap: 0 });
    a.t += dt;
    const e = r.e, s = rig.size || 1;
    const state = r.state;
    const speed = Math.hypot(e.vx, e.vz);
    if (rig.clips && rig.clips.length) playClip(rig, state === 'walk' && speed > r.sp.walk * 2 ? 'run' : state, speed / Math.max(0.5, r.sp.walk));
    const k = Math.min(1, dt * 8);
    // Lying down (sleep), sitting, tipped over (knocked) blend in and out.
    a.lie = lerp(a.lie, state === 'sleep' ? 1 : state === 'sit' ? 0.55 : 0, Math.min(1, dt * 3));
    a.tip = lerp(a.tip, state === 'knocked' && e.grounded ? 1 : 0, Math.min(1, dt * (state === 'knocked' ? 6 : 2.5)));
    a.eat = lerp(a.eat, state === 'eat' ? 1 : 0, Math.min(1, dt * 4));
    const vis = rig.vis;
    // Tumbling through the air after a blast: spin; on the ground after it: lie on the side.
    if (state === 'knocked' && !e.grounded) { a.spin += dt * (r.spinRate || 9); vis.rotation.x = a.spin; vis.rotation.z = a.spin * 0.6; }
    else {
      a.spin = 0;
      vis.rotation.x = lerp(vis.rotation.x, 0, k);
      vis.rotation.z = lerp(vis.rotation.z, (rig.plan === 'fish' && !r.inWater ? Math.PI / 2 : 0) + a.tip * Math.PI / 2 * (r.tipSide || 1), k);
    }
    if (rig.model) {
      // A model without clips: a little bob and lean, so it doesn't glide.
      if (!rig.clips.length) { const moving = speed > 0.2; a.phase += dt * (moving ? 6 + speed : 1); rig.model.position.y = (moving ? Math.abs(Math.sin(a.phase)) * 0.05 * s : 0) - a.lie * (rig.height * 0.3); rig.model.rotation.x = state === 'eat' ? 0.25 : 0; }
      vis.position.y = r.visY;
      return;
    }
    const moving = speed > 0.15;
    const stride = rig.plan === 'human' ? 1.9 : rig.plan === 'quad' ? 2.2 : 3.2;
    a.phase += dt * (moving ? (speed / Math.max(0.2, s)) * stride + 1 : state === 'dance' ? 7 : 0);
    const swing = moving ? Math.min(0.75, 0.25 + speed * 0.09) : 0;
    const bob = moving ? Math.abs(Math.sin(a.phase)) * 0.035 * s : 0;
    let dy = bob - a.lie * (r.sp.legH * s * 0.85);
    if (r.sp.hops && moving) dy += Math.abs(Math.sin(a.phase * 0.5)) * 0.18 * s;
    if (state === 'dance') dy += Math.abs(Math.sin(a.t * 7)) * 0.12 * s;
    if (state === 'cheer') dy += Math.max(0, Math.sin(a.t * 9)) * 0.25 * s;
    vis.position.y = r.visY + dy;
    // Legs: swing while walking; folded under when lying down.
    for (const h of rig.hips) {
      const fold = a.lie * (rig.plan === 'quad' ? (h.front ? -1.35 : 1.35) : rig.plan === 'human' ? -1.4 : 0.9);
      h.n.rotation.x = lerp(h.n.rotation.x, Math.sin(a.phase + h.ph) * swing + fold, k);
    }
    // Arms: swing opposite the legs; up for cheering, waving for dancing, out front for carrying.
    for (const ar of rig.arms) {
      let x = -Math.sin(a.phase + ar.ph) * swing * 0.8, z = 0;
      if (state === 'cheer') { x = -2.9; z = 0; }
      else if (state === 'dance') { x = -1.6 + Math.sin(a.t * 7 + ar.ph) * 0.9; z = (ar.side || 1) * 0.3; }
      else if (r.carrying) x = -1.4;
      else if (state === 'attack') x = -1.5 + Math.sin(a.t * 14) * 0.5;
      ar.n.rotation.x = lerp(ar.n.rotation.x, x, k);
      ar.n.rotation.z = lerp(ar.n.rotation.z, z, k);
    }
    // Wings: flap when flying, fleeing or cheering; folded otherwise.
    const flapping = state === 'fly' || (state === 'run' && rig.plan === 'bird') || state === 'cheer' || r.flying;
    a.flap += dt * (flapping ? (r.flying ? 22 : 16) : 0);
    for (const w of rig.wings) {
      const f = flapping ? Math.sin(a.flap) * (w.upright ? 0.7 : 0.9) : 0;
      if (w.upright) w.n.rotation.z = lerp(w.n.rotation.z, w.side * (0.15 + Math.abs(f)), k);
      else w.n.rotation.z = lerp(w.n.rotation.z, w.side * f, Math.min(1, dt * 20));
    }
    // Head: bob with the step, down to graze, droop asleep, look around when idle.
    if (rig.head) {
      const look = !moving && state === 'idle' ? Math.sin(a.t * 0.7 + (r.seed || 0)) * 0.5 : 0;
      const peck = rig.plan === 'bird' && state === 'eat' ? Math.max(0, Math.sin(a.t * 6)) * 0.9 : 0;
      rig.head.rotation.x = lerp(rig.head.rotation.x, rig.headBase + (moving ? Math.sin(a.phase * 2) * 0.06 : 0) + a.eat * (rig.plan === 'quad' ? 0.95 : 0.5) + peck + a.lie * 0.35 - (state === 'cheer' ? 0.3 : 0), k);
      rig.head.rotation.y = lerp(rig.head.rotation.y, look + (state === 'dance' ? Math.sin(a.t * 3.5) * 0.4 : 0), Math.min(1, dt * 3));
    }
    // Tail: a wag (fast when a pet is happy, frantic for a fish out of water), a sway otherwise.
    if (rig.tail) {
      const happy = r.happy || state === 'dance' || state === 'cheer';
      const rate = rig.plan === 'fish' ? (r.inWater ? 8 : 22) : happy ? 16 : moving ? 6 : 1.5;
      const amp = rig.plan === 'fish' ? 0.5 : happy ? 0.7 : 0.18;
      rig.tail.rotation.y = Math.sin(a.t * rate) * amp;
      rig.tail.rotation.x = rig.tailBase + (state === 'sleep' ? 0.4 : 0);
    }
    if (rig.torso && rig.plan === 'human') rig.torso.rotation.z = state === 'dance' ? Math.sin(a.t * 3.5) * 0.15 : lerp(rig.torso.rotation.z, 0, k);
  }

  living.body = { make: makeBody, animate, build: buildBody, part, source, softBox };
})();
