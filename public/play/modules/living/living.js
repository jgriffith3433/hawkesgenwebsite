// Living things, part 3: creatures with brains. The `creature` kind (any species: cow, dog, wolf, dinosaur, robot,
// person...), the `herd` kind (many at once, cheaply), needs and goals (wander, graze, flock, flee from players,
// gunfire and explosions, follow, hunt and fight, sleep, eat), paths around what's in the way (nav.js), tumbling when
// blown up and getting back up, riding (the `ride` controller: E near a horse), a ball to throw for dogs (the `ball`
// tool), and H.living for scripts and other modules. friends.js adds AI friends on top.
//
// Cost: brains think a few times a second, a slice of them each step (100+ animals stay cheap); far-away animals think
// and animate less. Playing together: the host runs every brain (or whoever owns a thing: a rider owns their mount);
// herds send their animals' places a few times a second; everyone animates what they see.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const living = (H.living = H.living || {});
  const nav = living.nav, body = living.body, SP = living.species;
  const W = () => H.world;
  const G = () => H.game;
  const RAD = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const STATES = ['idle', 'walk', 'run', 'eat', 'sleep', 'sit', 'dance', 'knocked', 'attack', 'cheer', 'fly', 'swim', 'flop'];

  // ------------------------------------------------------------------ the creatures in this world
  let list = []; // records: { e, sp, name, state, act, goal, path, ... } (e.living is its record)
  let cursor = 0, steps = 0, hash = new Map(), pathQueue = [], warned = false;
  // A round world: the frame moved under the player (round.js moved the creatures); where they're going, their
  // homes and herds' middles go with it (their paths are worked out again).
  if (H.planet && H.planet.frame && H.planet.frame.onRebase) H.planet.frame.onRebase((tr) => {
    const xz = (a) => { const p = tr.point([a[0], 0, a[1]]); return [p[0], p[2]]; };
    for (const r of list) {
      if (r.home) r.home = xz(r.home);
      if (r.goal && !r.goal.ent) { const p = xz([r.goal.x, r.goal.z]); r.goal.x = p[0]; r.goal.z = p[1]; }
      if (r.netGoal) { const p = xz([r.netGoal.x, r.netGoal.z]); r.netGoal.x = p[0]; r.netGoal.z = p[1]; }
      r.path = null;
      if (r.trk) r.trk = null;
    }
    hash = new Map();
  });
  const listeners = { startle: [], hurt: [], act: [], world: [] };
  living.on = (name, fn) => { (listeners[name] || (listeners[name] = [])).push(fn); return () => { const l = listeners[name]; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; };
  const tell = (name, ...args) => { for (const f of listeners[name] || []) try { f(...args); } catch (err) { H.report(err, 'living'); } };
  const now = () => (W() ? W().time : 0);
  const cfg = () => { try { const c = H.lib.effectiveConfig(); return (c && c.living) || {}; } catch { return {}; } };
  /** How many animals a world may hold (config.living.max; fewer on phones). */
  const maxCreatures = () => Number(cfg().max) || (H.touchUi ? 160 : 400);

  /** Everyone who counts as a player here: you and the other players' bodies. */
  function players() {
    const out = [];
    const w = W();
    if (w && w.player && w.player.alive) out.push(w.player);
    const g = G();
    if (g && g.net && g.net.online) for (const p of g.net.players) if (p.entity) out.push(p.entity);
    return out;
  }
  /** Does this player simulate the creature? (Herd animals: the host; others: whoever owns it.) */
  function mine(r) {
    if (!H.sync || !H.sync.online) return true;
    if (r.herd) return H.sync.isHost;
    return H.sync.mine(r.e);
  }
  // (No terrain answers null: on a round world that's no ground at all here, not a floor at y = 0; flat worlds as before.)
  const groundAt = (x, z, fallback) => { const h = H.terrain && typeof H.terrain.heightAt === 'function' ? H.terrain.heightAt(x, z) : NaN; const t = h === null && H.planet && H.planet.round ? NaN : Number(h); return Number.isFinite(t) ? t : fallback; };
  const inWater = (p) => Boolean(H.water && typeof H.water.inWater === 'function' && H.water.inWater(p));
  const dist2 = (a, b) => Math.hypot(a.e.x - b.e.x, a.e.z - b.e.z);
  function seedOf(v) { let h = 2166136261; for (const ch of String(v)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ------------------------------------------------------------------ the creature kind
  /** The collider's size: [footprint, height] for a species at a size. */
  function dims(sp, s) {
    const head = sp.head ? sp.head[1] : 0.3;
    let h;
    if (sp.plan === 'quad') h = sp.legH + sp.h + (sp.neck ? sp.neck[1] * 0.75 : head * 0.3);
    else if (sp.plan === 'bird') h = sp.legH + sp.h + head * (sp.upright ? 1 : 0.6);
    else if (sp.plan === 'human') h = sp.legH + sp.h + 0.36;
    else h = Math.max(sp.h, sp.w);
    const foot = sp.plan === 'human' ? 0.5 : Math.max(sp.w, sp.len * 0.6);
    return [Math.max(0.12, foot * s), Math.max(0.12, h * s)];
  }

  /** Makes a creature. `shape`: species, size, color, colors, model, temper, follow, roam, speed, hp, rideable,
   *  seed. The body is a stand-in (or the model); the entity is an invisible box you can hit, push and click. */
  function makeCreature(shape, o, spec) {
    const { name, def: sp } = SP.of(shape.species || shape.animal || (spec && spec.data && spec.data.species) || 'cow');
    const size = clamp((Number(shape.size) || 1) * (sp.scale || 1), 0.15, 20);
    const [foot, tall] = dims(sp, size);
    const scene = W().scene;
    const box = B.MeshBuilder.CreateBox('creature', { width: foot, height: tall, depth: foot }, scene);
    box.visibility = 0;
    const statue = o.physics === 'static' || o.physics === 'none';
    const e = new H.lib.Entity(box, { ...o, physics: o.physics || 'dynamic' }, 'creature');
    const seed = shape.seed !== undefined ? Number(shape.seed) >>> 0 : seedOf(`${spec ? spec.id : ''}${o.name || ''}${Math.random()}`);
    const r = {
      e, sp, name, size, seed, state: 'idle', act: 'idle', goal: null, path: null, dir: { x: 0, z: 1 },
      hunger: Math.random() * 0.5, energy: 0.55 + Math.random() * 0.45, fear: 0, until: 0,
      temper: shape.temper || sp.temper, follow: shape.follow || null, roam: Number(shape.roam) || (sp.temper === 'pet' ? 5 : sp.group === 'herd' || sp.group === 'flock' ? 12 : 9),
      speed: Number(shape.speed) || 1, rideable: shape.rideable ?? sp.rideable ?? false, statue, command: null,
      home: null, herd: null, neighbors: [], visY: -tall / 2, tall, foot, think: 0, lastThink: 0, stuck: 0,
      checkAt: 0, lastPos: null, flying: false, inWater: false, anim: null, sight: Number(shape.sight) || sp.sight || 20,
    };
    e.living = r;
    e.data.species = name;
    e.rig = null;
    // Its model: shape.model, or the game's asset for the species (H.assets: picked per animal by its id, so a herd
    // can mix the game's cows and a reload keeps each the same).
    const pickSeed = shape.pickSeed ?? (spec && spec.id) ?? `${o.name || name}:${seed}`;
    r.rig = body.make(e, sp, name, { size, color: shape.color, colors: shape.colors, model: shape.model, modelHeight: shape.modelHeight, modelYaw: shape.modelYaw, seed, pickSeed });
    if (!shape.model && r.rig.modelRef) {
      e._assetPick = name; // (a change of config.assets rebuilds it: assets.js)
      // A new thing (spawned, not in the world file): its spec names the id it got.
      if (spec && spec.shape && !(spec.id && H.world.graph && H.world.graph.entities[spec.id])) spec.shape.model = r.rig.modelRef;
    }
    r.rig.vis.position.y = r.visY;
    H.lib.place(e, { ...o, shadow: false });
    e.upright = true;
    try { e.layer = 'character'; } catch {}
    if (o.mass === undefined || o.mass === null) e.mass = clamp(sp.mass * size * size * size, 0.2, 50000);
    e.hp = e.maxHp = Number(shape.hp) || Math.round(sp.hp * Math.max(0.3, size * size));
    if (e.data.hp !== undefined) e.hp = e.maxHp = Number(e.data.hp) || e.hp;
    r.home = [e.x, e.z];
    if (sp.flies && shape.flying !== false) r.alt = rand(3, 7);
    add(r);
    e.onDestroy(() => remove(r));
    return e;
  }

  function add(r) {
    list.push(r);
    if (list.length > maxCreatures() && !warned && G()) { warned = true; G().ui.message(`That's a lot of animals (${list.length}): things may slow down`, 2.5); }
  }
  function remove(r) {
    const i = list.indexOf(r);
    if (i >= 0) list.splice(i, 1);
    if (r.carrying) drop(r);
    if (r.ridden && r.ridden.alive && r.ridden.controller === 'ride') r.ridden.control('walk');
  }

  const RING = '#7dd3fc';
  H.kinds.register('creature', {
    physics: 'dynamic',
    maker: (o = {}) => (Number(o.count) > 1 ? makeHerd(o, o, null) : makeCreature(o, o, null)),
    build: (shape, o, spec) => makeCreature(shape, o, spec),
    editor: {
      word: 'a creature',
      lift: (spec) => creatureLift(spec),
      motion: [['dynamic', 'Lives: walks, thinks, can be pushed'], ['static', 'A statue: stands still']],
      hotbar: [
        { order: 300, icon: '🐄', label: 'Cow', make: () => ({ type: 'creature', name: 'Cow', shape: { species: 'cow' } }) },
        { order: 301, icon: '🐕', label: 'Dog', make: () => ({ type: 'creature', name: 'Dog', shape: { species: 'dog', follow: 'player' } }) },
        { order: 302, icon: '🐎', label: 'Horse', make: () => ({ type: 'creature', name: 'Horse', shape: { species: 'horse' } }) },
        { order: 304, icon: '🐖', label: 'Pig', make: () => ({ type: 'creature', name: 'Pig', shape: { species: 'pig' } }) },
        { order: 305, icon: '🐔', label: 'Chicken', make: () => ({ type: 'creature', name: 'Chicken', shape: { species: 'chicken' } }) },
      ],
    },
    codex: {
      group: 'Living things',
      what: 'An animal or person that lives: walks around, eats, sleeps, flees, follows, hunts; blown up, it tumbles and gets back up. Species: ' + SP.list().join(', ') + ' (and ' + SP.looks().join(', ') + ', or any word: a stand-in in its own color). Uses the game\'s "<species>.glb" model when there is one.',
      spec: { type: 'creature', name: 'Daisy', shape: { species: 'cow' }, transform: { position: [0, 1, 0] } },
      fields: [['shape.species', SP.list().join(' | '), 'cow'], ['shape.size', 'times normal size', '1'], ['shape.temper', 'calm | shy | pet | predator | angry | neutral | person', 'by species'], ['shape.follow', '"player" or a thing\'s name/id', ''], ['shape.roam', 'meters it wanders from home', '12'], ['shape.color', 'its main color', 'by species'], ['shape.model', 'a .glb asset to use as its body', '<species>.glb'], ['shape.rideable', 'true: E rides it', 'horse, dinosaur']],
    },
  });

  function creatureLift(spec) {
    const sh = spec.shape || {};
    const { def } = SP.of(sh.species || sh.animal || 'cow');
    return dims(def, (Number(sh.size) || 1) * (def.scale || 1))[1] / 2 + 0.02;
  }
  // "critter": what the Mayhem module called its stand-in animals before Living things owned animals. Worlds that have
  // one get a creature (no hotbar, no page in the codex: write "creature").
  H.kinds.register('critter', {
    alias: 'creature', // builds a creature (its kind says so)
    physics: 'dynamic',
    build: (shape, o, spec) => makeCreature(shape, o, spec),
    editor: { word: 'a creature', lift: (spec) => creatureLift(spec), motion: [['dynamic', 'Lives: walks, thinks, can be pushed'], ['static', 'A statue: stands still']], hotbar: [] },
    codex: { hidden: true, group: 'Living things', what: 'An old name for a creature (use "creature").' },
  });

  // ------------------------------------------------------------------ the herd kind: many at once
  let herdCount = 0;
  /** A herd: `count` animals of a species around a point (`radius` meters, or as much as they need). One thing in the
   *  world; its animals are made when it is. */
  function makeHerd(shape, o, spec) {
    const scene = W().scene;
    const root = new B.TransformNode('herd', scene);
    const e = new H.lib.Entity(root, { ...o, physics: 'none' }, 'herd');
    const { name, def: sp } = SP.of(shape.species || 'cow');
    const size = clamp((Number(shape.size) || 1) * (sp.scale || 1), 0.15, 20);
    const room = maxCreatures() - list.length;
    const asked = clamp(Math.round(Number(shape.count) || 12), 1, 300);
    const count = Math.max(0, Math.min(asked, room));
    if (count < asked && G()) G().ui.message(`Room for ${count} more animals (the world's limit is ${maxCreatures()})`, 2.5);
    const [foot] = dims(sp, size);
    const spacing = Math.max(1, foot * 1.6);
    const radius = Number(shape.radius) || Math.max(3, spacing * Math.sqrt(count) * 0.62);
    H.lib.place(e, o);
    // While building: a ring on the ground and a label you can click to edit it.
    if (H.mode === 'build') {
      const ring = B.MeshBuilder.CreateTorus('herd-ring', { diameter: radius * 2, thickness: 0.08, tessellation: 48 }, scene);
      const m = new B.StandardMaterial('herd-ring', scene); m.emissiveColor = H.lib.hex(RING); m.disableLighting = true; m.alpha = 0.7;
      ring.material = m; ring.parent = root; ring.position.y = 0.05; ring.metadata = { entity: e };
      const label = H.textPlane(`${count} ${count === 1 ? name : plural(name)}`, { size: 0.35 });
      label.parent = root; label.position.y = 2.6; label.metadata = { entity: e };
      e._mat = m;
    }
    e.half = [radius, 0.3, radius];
    const rec = { e, key: spec && spec.id ? spec.id : `script-${++herdCount}`, members: [], sync: null, species: name };
    e.herd = rec;
    e.members = rec.members;
    const at = [e.x, e.y, e.z];
    const [, tall] = dims(sp, size);
    for (let i = 0; i < count; i++) {
      // A sunflower spiral: evenly spread, nobody inside anybody.
      const rr = spacing * Math.sqrt(i + 0.5) * 0.9, th = i * 2.399963 + Math.random() * 0.3;
      const x = at[0] + Math.cos(th) * rr, z = at[2] + Math.sin(th) * rr;
      const y = groundAt(x, z, at[1]) + tall / 2 + 0.02;
      const m = makeCreature({ ...shape, species: name, size: shape.size, count: undefined, seed: seedOf(`${rec.key}:${i}`), pickSeed: `${rec.key}:${i}` }, { name: null, tag: o.tag || name, data: { herd: rec.key }, position: [x, y, z], rotation: Math.random() * 360, physics: 'dynamic', lenient: true }, null);
      m.living.herd = rec;
      m.living.index = i;
      m.living.home = [at[0], at[2]];
      m.living.roam = Number(shape.roam) || Math.max(radius * 1.5, 10);
      rec.members.push(m);
    }
    rec.sync = herdSync(rec);
    if (rec.members.some((m) => m._assetPick)) e._assetPick = name;
    return e;
  }
  const plural = (n) => ({ sheep: 'sheep', fish: 'fish', deer: 'deer', person: 'people', wolf: 'wolves', fox: 'foxes' }[n] || `${n}s`);

  H.kinds.register('herd', {
    physics: 'none',
    maker: (o = {}) => makeHerd(o, o, null),
    build: (shape, o, spec) => makeHerd(shape, o, spec),
    destroy(e) { const rec = e.herd; if (!rec) return; if (rec.sync) rec.sync.remove(); for (const m of [...rec.members]) if (m.alive) m.destroy(); rec.members.length = 0; },
    editor: {
      word: 'a herd',
      lift: () => 0.05,
      motion: [],
      hotbar: [{ order: 303, icon: '🐑', label: 'Herd', make: () => ({ type: 'herd', name: 'Sheep', shape: { species: 'sheep', count: 12 } }) }],
    },
    codex: {
      group: 'Living things',
      what: 'Many animals at once (up to 300): a herd of cows, a flock of chickens, a pack of wolves. They keep together, graze, sleep and stampede together. Cheap: 100 is fine.',
      spec: { type: 'herd', name: 'Cows', shape: { species: 'cow', count: 20 }, transform: { position: [0, 0, 0] } },
      fields: [['shape.species', 'any creature species', 'cow'], ['shape.count', '1 to 300', '12'], ['shape.radius', 'meters they start spread over', 'as needed'], ['shape.size', 'times normal size', '1'], ['shape.roam', 'how far they wander', 'radius x 1.5'], ['shape.temper', 'overrides the species\' temper', '']],
    },
  });

  // ------------------------------------------------------------------ playing together
  // Herd animals: the host sends where they are and where they're going (in chunks of 25, only chunks that changed),
  // everyone else plays that back smoothly (H.sync.track: interpolated, a little behind); far players get it less
  // often (where). A new host carries on with each animal's goal.
  function herdSync(rec) {
    if (!H.sync || !H.sync.state) return null;
    return H.sync.state(`living:herd:${rec.key}`, {
      rate: 8,
      where() { return rec.center || null; },
      get() {
        const out = {};
        let sx = 0, sy = 0, sz = 0, n = 0;
        rec.members.forEach((m, i) => {
          const k = `c${Math.floor(i / 25)}`;
          const r = m.living;
          const g = r && r.goal && !r.goal.ent ? [Math.round(r.goal.x * 20), Math.round(r.goal.z * 20), r.goal.how === 'run' ? 1 : 0] : [];
          if (m.alive && !m.dead) { sx += m.x; sy += m.y; sz += m.z; n++; }
          (out[k] || (out[k] = [])).push(m.alive && !m.dead ? [Math.round(m.x * 20), Math.round(m.y * 20), Math.round(m.z * 20), Math.round(m.node.rotation.y / RAD), STATES.indexOf(m.living.state), ...g] : 0);
        });
        rec.center = n ? [sx / n, sy / n, sz / n] : null;
        return out;
      },
      set(state, changed, from, meta) {
        for (const k of changed) {
          const c = Number(k.slice(1)) * 25;
          (state[k] || []).forEach((v, j) => {
            const m = rec.members[c + j];
            if (!m || !m.alive) return;
            if (!v) { G().burst([m.x, m.y, m.z], { color: '#ff6040', count: 24, speed: 5 }); m.destroy(); return; }
            const r = m.living;
            if (H.sync.track) (r.trk || (r.trk = H.sync.track({ yaw: [3] }))).push(meta && meta.at, [v[0] / 20, v[1] / 20, v[2] / 20, v[3] * RAD], meta && meta.from);
            else r.net = { p: [v[0] / 20, v[1] / 20, v[2] / 20], yaw: v[3] * RAD, at: performance.now() };
            r.state = STATES[v[4]] || 'idle';
            r.netGoal = v.length > 6 ? { x: v[5] / 20, z: v[6] / 20, how: v[7] ? 'run' : 'walk' } : null;
          });
        }
      },
    });
  }
  // Creatures from the world file: the engine sends their places; this sends what they're doing (sleeping, eating...).
  let stateSync = null;
  function syncStates() {
    if (stateSync || !H.sync || !H.sync.state) return;
    stateSync = H.sync.state('living:states', {
      rate: 4,
      get() { const out = {}; for (const r of list) if (r.e.sceneId && !r.herd && mine(r)) out[r.e.sceneId] = STATES.indexOf(r.state); return out; },
      set(state, changed) { const w = W(); if (!w) return; for (const id of changed) { const e = w.byId.get(id); if (e && e.living && !mine(e.living)) e.living.state = STATES[state[id]] || 'idle'; } },
    });
  }

  // ------------------------------------------------------------------ senses: a coarse grid of who is near whom
  const CELL = 6;
  function rehash() {
    hash = new Map();
    for (const r of list) {
      if (!r.e.alive) continue;
      const k = `${Math.floor(r.e.x / CELL)},${Math.floor(r.e.z / CELL)}`;
      const b = hash.get(k);
      if (b) b.push(r); else hash.set(k, [r]);
    }
  }
  /** Creatures within `radius` of a point (from the grid: fast). */
  function around(x, z, radius, out = []) {
    const c = Math.ceil(radius / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) {
      const b = hash.get(`${cx + i},${cz + j}`);
      if (b) for (const r of b) if (r.e.alive && Math.hypot(r.e.x - x, r.e.z - z) <= radius) out.push(r);
    }
    return out;
  }

  // ------------------------------------------------------------------ brains: what to do next (a few times a second)
  const fearful = (r) => r.temper === 'calm' || r.temper === 'shy' || r.temper === 'person' || (r.temper === 'pet' && r.fear > 0.9);
  const brave = (r) => r.temper === 'predator' || r.temper === 'angry' || r.temper === 'neutral' || (r.temper === 'pet' && r.name === 'dog');
  function resolve(t) {
    if (!t) return null;
    if (t.__entity) return t.alive ? t : null;
    const s = String(t);
    if (s === 'player' || s === 'me') { const w = W(); return w && w.player && w.player.alive ? w.player : null; }
    if (s.startsWith('net:')) { const id = s.slice(4); if (H.sync && H.sync.me === id) return W().player; const g = G(); const p = g.net.players.find((x) => x.id === id); return p ? p.entity : null; }
    const g = G();
    return g ? g.entity(s) || g.find(s) : null;
  }
  /** Go somewhere (a point or a thing): speed 'walk' or 'run', `near` = how close is there. */
  function goTo(r, target, how = 'walk', near = 0.8, act = 'goto') {
    const ent = target && target.__entity ? target : null;
    const p = ent ? [ent.x, ent.z] : [target[0], target.length > 2 ? target[2] : target[1]];
    // Already on the way to that thing: keep the way found.
    if (ent && r.goal && r.goal.ent === ent) { Object.assign(r.goal, { how, near }); r.act = act; return; }
    r.goal = { x: p[0], z: p[1], ent, how, near };
    r.act = act;
    r.path = null;
    r.stuck = 0;
    // Something in the way: find a way around it (queued: a couple of searches a step).
    if (!nav.clear([r.e.x, r.e.bottom, r.e.z], [p[0], r.e.bottom, p[1]], { ignore: r.e })) wantPath(r);
  }
  function wantPath(r) { if (!r.pathing) { r.pathing = true; pathQueue.push(r); } }
  function stop(r, state = 'idle') { r.goal = null; r.path = null; r.state = state; }

  function think(r) {
    const e = r.e, sp = r.sp, t = now();
    const dt = Math.min(5, t - (r.lastThink || t));
    r.lastThink = t;
    if (!e.alive || e.dead || e.ghost || r.statue) return;
    // Needs drift: hunger rises, energy falls (sleeping fills it), fear fades.
    if (sp.diet !== 'none') r.hunger = Math.min(1, r.hunger + dt * 0.01);
    r.energy = r.state === 'sleep' ? Math.min(1, r.energy + dt * 0.045) : Math.max(0, r.energy - dt * (r.state === 'run' ? 0.012 : 0.004));
    r.fear = Math.max(0, r.fear - dt * 0.12);
    if (r.state === 'knocked' || r.ridden) return;
    r.happy = false;
    // Who's around (same kind: herd mates; others: predators, prey).
    r.neighbors = around(e.x, e.z, 7).filter((n) => n !== r).slice(0, 8);
    // Fish: swim in water, flop on land.
    if (sp.swims) { r.inWater = inWater([e.x, e.y, e.z]); if (!r.inWater) { r.act = 'flop'; r.state = 'flop'; return; } }

    // 1. Danger: a startle (explosion, gunfire, being hurt), a player too close, a predator that hunts us.
    let from = null;
    if (r.startle && r.startle.until > t) from = r.startle.from;
    else if (fearful(r) && r.temper !== 'person') {
      for (const p of players()) {
        const d = Math.hypot(p.x - e.x, p.z - e.z), running = Math.hypot(p.vx, p.vz) > 7;
        const shy = (sp.shy || 4) * (r.temper === 'calm' ? (running ? 1.6 : 0.6) : 1);
        if (d < shy && !(r.temper === 'calm' && r.tame)) { from = [p.x, p.z]; r.fear = Math.max(r.fear, 0.5); break; }
      }
      if (!from) for (const n of around(e.x, e.z, 10)) if (n.sp.hunts && n.sp.hunts.includes(r.name) && n.temper !== 'pet' && n.e.alive) { from = [n.e.x, n.e.z]; r.fear = 1; break; }
    }
    if (from && (fearful(r) || r.fear > 0.95) && !(r.command && r.command.brave)) {
      let ax = e.x - from[0], az = e.z - from[1];
      const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
      // Stampede: run the way the herd runs.
      let hx = 0, hz = 0;
      for (const n of r.neighbors) if (n.act === 'flee') { hx += n.dir.x; hz += n.dir.z; }
      const hl = Math.hypot(hx, hz);
      if (hl > 0.1) { ax = ax * 0.6 + (hx / hl) * 0.4; az = az * 0.6 + (hz / hl) * 0.4; }
      // Not over a cliff (or off the edge of the world): away from it, toward home.
      if (r.ledge && r.ledge.until > t) { ax = ax * 0.2 + r.ledge.x * 0.8; az = az * 0.2 + r.ledge.z * 0.8; }
      const run = 10 + r.fear * 8;
      goTo(r, [e.x + ax * run, e.z + az * run], 'run', 1.5, 'flee');
      if (sp.flies) r.alt = rand(6, 11);
      if (r.carrying && r.temper !== 'pet') drop(r);
      return;
    }

    // 2. Fighting: someone who hurt a brave one, prey when hungry, players for the angry ones.
    if (r.attack && (!r.attack.alive || r.attack.dead || r.attack.ghost || t > r.attackUntil || Math.hypot(r.attack.x - e.x, r.attack.z - e.z) > 40)) r.attack = null;
    if (!r.attack && !r.command && (r.temper === 'predator' || r.temper === 'angry') && (r.hunger > 0.45 || r.temper === 'angry')) {
      let best = null, bd = r.sight;
      if (sp.hunts) for (const n of around(e.x, e.z, r.sight)) { if (n.e.alive && !n.e.dead && sp.hunts.includes(n.name) && n.temper !== 'pet') { const d = dist2(r, n); if (d < bd) { bd = d; best = n.e; } } }
      if (r.temper === 'angry' && H.mode !== 'build') for (const p of players()) { const d = Math.hypot(p.x - e.x, p.z - e.z); if (d < bd && !p.ghost) { bd = d; best = p; } }
      if (best) { r.attack = best; r.attackUntil = t + 20; }
    }
    if (r.temper === 'neutral' && sp.guard && !r.attack) for (const p of players()) if (Math.hypot(p.x - e.x, p.z - e.z) < sp.guard) { r.attack = p; r.attackUntil = t + 6; }
    if (r.attack) { goTo(r, r.attack, 'run', reach(r, r.attack), 'chase'); return; }

    // 3. Something it was asked to do (friends, pets, scripts): living.command.
    if (r.command && commandThink(r, t)) return;

    // 4. Following its person.
    const lead = resolve(r.follow);
    if (lead && lead !== e) {
      const d = Math.hypot(lead.x - e.x, lead.z - e.z);
      if (d > 40 && r.temper === 'pet') { e.position = [lead.x - 1.5, lead.y + 0.5, lead.z - 1.5]; e.velocity = [0, 0, 0]; }
      if (d > 3.6) { goTo(r, lead, d > 9 ? 'run' : 'walk', 2.4, 'follow'); return; }
      if (r.act === 'follow') { stop(r); r.until = t + rand(1, 3); }
      r.happy = r.temper === 'pet' && d < 3;
      if (r.act !== 'eat' && r.act !== 'sleep' && t > r.until) { r.act = 'idle'; r.state = r.sp.aloof && Math.random() < 0.3 ? 'sit' : 'idle'; r.until = t + rand(2, 5); }
      return;
    }

    // 5. Busy with something (walking somewhere, eating, sleeping, resting).
    if (r.act === 'sleep') { if (r.energy >= 0.95) { r.act = 'idle'; r.state = 'idle'; } return; }
    if (r.act === 'eat') { if (t > r.until) { r.hunger = 0; r.act = 'idle'; r.state = 'idle'; r.until = t + rand(1, 3); } return; }
    if (r.goal && r.act !== 'idle') return;
    if (t < r.until) return;

    // 6. Needs: sleepy, hungry.
    if (r.energy < 0.12 && !sp.flies) { stop(r, 'sleep'); r.act = 'sleep'; return; }
    if (r.hunger > 0.65 && (sp.diet === 'grass' || sp.diet === 'seeds')) { stop(r, 'eat'); r.act = 'eat'; r.until = t + rand(4, 8); if (sp.flies) r.alt = 0; return; }

    // 7. Wander (herds keep together: around the middle of whoever is near, pulled home if too far).
    if (Math.random() < (sp.group === 'herd' || sp.group === 'flock' ? 0.45 : 0.3)) { r.act = 'idle'; r.state = Math.random() < 0.3 && sp.diet === 'grass' ? 'eat' : 'idle'; r.until = t + rand(2, 6); return; }
    let cx = r.home[0], cz = r.home[1];
    const mates = r.neighbors.filter((n) => n.name === r.name);
    if (mates.length && (sp.group === 'herd' || sp.group === 'flock' || sp.group === 'pack')) { let sx = 0, sz = 0; for (const n of mates) { sx += n.e.x; sz += n.e.z; } cx = cx * 0.3 + (sx / mates.length) * 0.7; cz = cz * 0.3 + (sz / mates.length) * 0.7; }
    const far = Math.hypot(e.x - r.home[0], e.z - r.home[1]) > r.roam;
    const span = far ? r.roam * 0.5 : sp.group === 'solo' ? r.roam : Math.min(r.roam, 6);
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * span;
    if (sp.flies) r.alt = Math.random() < 0.25 ? 0 : rand(3, 8);
    goTo(r, [cx + Math.cos(a) * d, cz + Math.sin(a) * d], 'walk', 0.8, 'wander');
  }
  const reach = (r, t) => r.foot * 0.55 + (t.half ? Math.max(t.half[0], t.half[2]) : 0.4) + 0.5;

  // Commands (friends.js and scripts): follow, stay, sit, sleep, come, goto, dance, cheer, fetch, carry, drop, wander, attack, flee
  function commandThink(r, t) {
    const c = r.command, e = r.e;
    if (c.until && t > c.until) { r.command = null; return false; }
    const who = resolve(c.target);
    switch (c.do) {
      case 'stay': stop(r, 'idle'); r.act = 'stay'; return true;
      case 'sit': stop(r, 'sit'); r.act = 'sit'; return true;
      case 'sleep': stop(r, 'sleep'); r.act = 'sleep'; return true;
      case 'dance': stop(r, 'dance'); r.act = 'dance'; return true;
      case 'cheer': stop(r, 'cheer'); r.act = 'cheer'; if (!c.until) c.until = t + 2.5; return true;
      case 'wander': r.command = null; r.follow = null; return false;
      case 'follow': r.follow = c.target || 'player'; r.command = null; return false;
      case 'come': case 'goto': {
        const at = who ? [who.x, who.z] : c.at;
        if (!at) { r.command = null; return false; }
        if (Math.hypot(at[0] - e.x, at[1] - e.z) < (c.near || 2)) { stop(r); r.act = 'stay'; if (c.do === 'come') r.command = { do: 'stay' }; else r.command = null; return true; }
        goTo(r, who || [at[0], at[1]], Math.hypot(at[0] - e.x, at[1] - e.z) > 8 ? 'run' : 'walk', c.near || 2, c.do);
        return true;
      }
      case 'attack': if (who) { r.attack = who; r.attackUntil = t + 30; } r.command = null; return false;
      case 'flee': r.startle = { from: who ? [who.x, who.z] : [e.x + 1, e.z], until: t + 4 }; r.fear = 1; r.command = null; return false;
      case 'drop': drop(r); r.command = null; return false;
      case 'carry': {
        // Pick up a thing (named, or the nearest loose one), then follow whoever asked.
        if (r.carrying) { r.follow = c.by || 'player'; r.command = null; return false; }
        const thing = resolve(c.thing) || nearestLoose(e, 15);
        if (!thing) { r.command = null; return false; }
        if (Math.hypot(thing.x - e.x, thing.z - e.z) < reach(r, thing) + 0.3) { pickUp(r, thing); r.follow = c.by || 'player'; r.command = null; return true; }
        goTo(r, thing, 'walk', reach(r, thing), 'carry');
        return true;
      }
      case 'fetch': return fetchThink(r, t, c);
      default: r.command = null; return false;
    }
  }
  /** The nearest loose thing small enough to carry (a ball first). */
  function nearestLoose(e, radius) {
    const w = W(); let best = null, bd = radius;
    for (const o of w.entities) {
      if (!o.alive || o === e || o.living || o.isPlayer || o.remotePlayer || o.held || o.physics !== 'dynamic' || o._carrier) continue;
      const big = Math.max(o.half[0], o.half[1], o.half[2]);
      if (big > 0.8 || o.mass > 60) continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z) - (o.tag === 'ball' ? 5 : 0);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  // Fetch: run to the ball, bring it back, drop it at their feet, wait for the next throw.
  function fetchThink(r, t, c) {
    const e = r.e, owner = resolve(c.target) || resolve('player');
    if (!owner) { r.command = null; return false; }
    r.happy = true;
    if (r.carrying) {
      const d = Math.hypot(owner.x - e.x, owner.z - e.z);
      if (d < 2.2) { const f = owner.forward || { x: 0, z: 1 }; drop(r, [f.x * -1.2, 1.5, f.z * -1.2]); stop(r, 'idle'); r.until = t + 0.5; return true; }
      goTo(r, owner, 'run', 1.8, 'fetch');
      return true;
    }
    let ball = null, bd = 45;
    for (const o of W().entities) if (o.alive && o.tag === 'ball' && !o._carrier) { const d = Math.hypot(o.x - e.x, o.z - e.z); if (d < bd) { bd = d; ball = o; } }
    if (!ball || (Math.hypot(ball.x - owner.x, ball.z - owner.z) < 2.2 && Math.hypot(ball.vx, ball.vz) < 1)) {
      // No ball out there (it's in their hand, or at their feet): wait close by, wagging.
      const d = Math.hypot(owner.x - e.x, owner.z - e.z);
      if (d > 3.5) goTo(r, owner, 'run', 2.6, 'fetch'); else { stop(r, 'idle'); r.act = 'fetch'; }
      return true;
    }
    if (bd < reach(r, ball) + 0.4 && Math.abs(ball.y - e.y) < 1.5 + r.tall) { pickUp(r, ball); return true; }
    goTo(r, ball, 'run', 0.3, 'fetch');
    return true;
  }

  // ------------------------------------------------------------------ carrying things (in the mouth or the arms)
  function pickUp(r, thing) {
    if (r.carrying) drop(r);
    r.carrying = thing;
    thing._carrier = r.e;
    thing.held = true;
    thing.velocity = [0, 0, 0];
    if (H.sync && H.sync.claim) H.sync.claim(thing);
    r.state = 'idle';
  }
  function drop(r, push) {
    const t = r.carrying;
    r.carrying = null;
    if (!t || !t.alive) return;
    t._carrier = null;
    t.held = false;
    t.velocity = push || [r.e.forward.x * 1.5, 1.5, r.e.forward.z * 1.5];
    t.wake();
  }
  function carryPoint(r) {
    const f = r.e.forward, top = r.e.box().max[1];
    if (r.sp.plan === 'human') return [r.e.x + f.x * 0.45, r.e.y + r.tall * 0.1, r.e.z + f.z * 0.45];
    const ahead = r.foot * 0.5 + (r.sp.head ? r.sp.head[2] * r.size : 0.2);
    return [r.e.x + f.x * ahead, top - (r.sp.head ? r.sp.head[1] * r.size : 0.2), r.e.z + f.z * ahead];
  }

  // ------------------------------------------------------------------ moving: every step, cheap
  function steer(r, dt, t) {
    const e = r.e, sp = r.sp;
    if (!e.alive || e.dead || r.statue) return;
    const hv = Math.hypot(e.vx, e.vz);
    // Thrown by a blast (or a big push): tumble, land, lie there a moment, get up and run.
    if (r.state !== 'knocked' && !r.flying && !r.ridden && t > (r.jumpAt || 0) + 0.8 && (e.vy > 4 || hv > Math.max(sp.run * 1.8, 11)) && (!r.lastSet || Math.abs(hv - r.lastSet) > 4 || e.vy > 4)) {
      knock(r);
      return;
    }
    // Tumbling (Mayhem's ragdoll spin, e._tumble): lying there until it's back on its feet.
    if (e._tumble && r.state !== 'knocked') { r.state = 'knocked'; r.act = 'knocked'; r.knockT = 0; r.goal = null; r.path = null; r.fear = 1; if (r.carrying) drop(r); }
    if (r.state === 'knocked') {
      if (e._tumble) { r.knockT = 0; if (e.grounded) e.walk({ x: 0, z: 0 }, 0); return; }
      if (e.grounded && hv < 1) r.knockT += dt;
      if (r.knockT > 1.4) { r.state = 'idle'; r.act = 'idle'; r.startle = { from: [e.x + rand(-1, 1), e.z + rand(-1, 1)], until: t + 3 }; r.lastThink = t; r.think = 0; }
      r.lastSet = 0;
      return;
    }
    if (r.ridden) return;
    if (r.act === 'flop' && sp.swims) {
      // A fish out of water: flip-flop about.
      r.state = 'flop';
      if (e.grounded && t > (r.flopAt || 0)) { r.flopAt = t + rand(0.5, 1.3); r.jumpAt = t; const a = Math.random() * Math.PI * 2; e.velocity = [Math.cos(a) * 1.2, rand(3, 4.5), Math.sin(a) * 1.2]; r.lastSet = hv; }
      return;
    }
    // Birds fly: height over the ground follows r.alt (0 = land).
    if (sp.flies) {
      const ground = groundAt(e.x, e.z, r.groundY ?? e.bottom);
      if (e.grounded) r.groundY = e.bottom;
      const want = (r.alt || 0) > 0 ? ground + r.alt : null;
      r.flying = want !== null;
      e.gravity = r.flying ? 0 : 1;
      if (r.flying) e.vy = clamp((want - e.y) * 2, -4, 4);
    }
    // Swimming: stay under the surface (the water module floats things; this keeps fish swimming at a depth).
    if (sp.swims && r.inWater && H.water && H.water.surfaceAt) { const s = H.water.surfaceAt(e.x, e.z); if (s !== null && s !== undefined) { e.gravity = 0; e.vy = clamp((Number(s) - 0.6 - e.y) * 2, -2, 2); } }

    const g = r.goal;
    if (!g) { r.lastSet = 0; if (r.state === 'walk' || r.state === 'run' || r.state === 'fly') r.state = r.flying ? 'fly' : 'idle'; if (r.flying) e.walk({ x: 0, z: 0 }, 0); return; }
    if (g.ent) { if (!g.ent.alive) { stop(r); return; } g.x = g.ent.x; g.z = g.ent.z; }
    let tx = g.x, tz = g.z;
    if (r.path && r.path.points.length) {
      const p = r.path.points[0];
      if (Math.hypot(p[0] - e.x, p[1] - e.z) < 0.8 && r.path.points.length > 1) r.path.points.shift();
      [tx, tz] = r.path.points[0];
      if (g.ent && r.path.points.length === 1) { tx = g.x; tz = g.z; }
    }
    const left = Math.hypot(g.x - e.x, g.z - e.z);
    if (left <= g.near) {
      // There.
      if (r.act === 'chase' && r.attack) { bite(r, t); return; }
      r.goal = null; r.path = null; r.lastSet = 0;
      if (r.act === 'wander' || r.act === 'goto') { r.act = 'idle'; r.until = t + rand(1.5, 5); }
      r.state = r.flying ? 'fly' : 'idle';
      e.walk({ x: 0, z: 0 }, 0);
      return;
    }
    let dx = tx - e.x, dz = tz - e.z;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    // Keep a little room from the others (cheap: only the neighbors seen when thinking).
    for (const n of r.neighbors) {
      const ox = e.x - n.e.x, oz = e.z - n.e.z, od = Math.hypot(ox, oz), room = (r.foot + n.foot) * 0.6 + 0.3;
      if (od > 0.001 && od < room) { const k = (room - od) / room * 1.2; dx += (ox / od) * k; dz += (oz / od) * k; }
    }
    if (r.avoid && r.avoid.until > t) { const c = Math.cos(r.avoid.angle), s = Math.sin(r.avoid.angle); [dx, dz] = [dx * c - dz * s, dx * s + dz * c]; }
    // Turn toward it smoothly.
    const k = Math.min(1, dt * (g.how === 'run' ? 7 : 4));
    r.dir.x += (dx - r.dir.x) * k; r.dir.z += (dz - r.dir.z) * k;
    const l = Math.hypot(r.dir.x, r.dir.z) || 1; r.dir.x /= l; r.dir.z /= l;
    const base = g.how === 'run' ? sp.run : sp.walk;
    const speed = base * r.speed * (r.fear > 0.6 && g.how === 'run' ? 1.1 : 1) * Math.min(1, 0.3 + left / 1.5) * (r.flying ? (sp.fly || sp.run) / sp.run : 1);
    // Every few steps: is there ground ahead? (No walking off cliffs or the edge of the world.)
    if (!r.flying && !sp.swims && (steps + r.seed) % 8 === 0 && !groundAhead(r, speed)) {
      const hx = r.home[0] - e.x, hz = r.home[1] - e.z, hl = Math.hypot(hx, hz) || 1;
      r.ledge = { x: hl > 1 ? hx / hl : -r.dir.x, z: hl > 1 ? hz / hl : -r.dir.z, until: t + 2.5 };
      r.dir.x = r.ledge.x; r.dir.z = r.ledge.z;
      r.path = null;
      if (r.act === 'flee' || r.act === 'wander' || r.act === 'goto') goTo(r, [e.x + r.ledge.x * 6, e.z + r.ledge.z * 6], g.how, 1, r.act);
      e.walk({ x: 0, z: 0 }, 0);
      return;
    }
    e.walk({ x: r.dir.x, z: r.dir.z }, speed);
    r.lastSet = speed;
    r.state = r.flying ? 'fly' : speed > sp.walk * 1.8 ? 'run' : 'walk';
    // Stuck? (pushing into a wall, a corner): find a way, or try somewhere else.
    if (t > r.checkAt) {
      const moved = r.lastPos ? Math.hypot(e.x - r.lastPos[0], e.z - r.lastPos[1]) : 1;
      r.lastPos = [e.x, e.z];
      r.checkAt = t + 1;
      if (moved < Math.min(0.4, speed * 0.25)) {
        r.stuck++;
        if (r.stuck === 1 && e.grounded && sp.plan !== 'fish' && (r.jumpAt = t)) e.jump(Math.min(6, 3 + r.size * 2));
        if (r.stuck === 2) wantPath(r);
        if (r.stuck >= 4) { r.goal = null; r.path = null; r.act = 'idle'; r.until = t + 0.5; r.stuck = 0; r.avoid = { angle: rand(-2, 2), until: t + 1.5 }; }
      } else r.stuck = 0;
    }
  }
  /** Is there something to stand on a little ahead (a drop of a couple of meters is fine)? */
  function groundAhead(r, speed) {
    const e = r.e, ahead = r.foot * 0.5 + 0.8 + speed * 0.3;
    const x = e.x + r.dir.x * ahead, z = e.z + r.dir.z * ahead;
    let ground = groundAt(x, z, NaN);
    if (!Number.isFinite(ground)) { const hit = H.physics.raycast([x, e.bottom + 1, z], [0, -1, 0], 3.5 + r.size, { ignore: e }); if (!hit) return false; ground = hit.point[1]; }
    // Deep water ahead counts as an edge for things that don't swim.
    const s = H.water && H.water.surfaceAt ? H.water.surfaceAt(x, z) : null;
    return !(s !== null && s !== undefined && Number(s) - ground > 0.7);
  }
  /** At a target it's fighting: bite (or punch) once a second. The owner of the creature decides the damage. */
  function bite(r, t) {
    const e = r.e, tgt = r.attack;
    e.lookAt(tgt);
    e.walk({ x: 0, z: 0 }, 0);
    r.state = 'attack';
    if (t < (r.biteAt || 0)) return;
    r.biteAt = t + 1;
    const dmg = r.sp.bite || 8;
    const g = G();
    if (g) g.damage(tgt, dmg * Math.max(0.5, r.size), e);
    if (tgt.physics === 'dynamic' && !tgt.isPlayer) tgt.push([e.forward.x * 3, 2, e.forward.z * 3]);
    if (!tgt.alive || tgt.dead || (tgt.hp !== undefined && tgt.hp <= 0)) { r.attack = null; r.hunger = 0; r.act = 'eat'; r.state = 'eat'; r.until = t + 5; r.goal = null; }
  }

  // ------------------------------------------------------------------ the step: think a slice, move everyone
  function stepAll(dt) {
    const w = W();
    if (!w || !list.length) { pathQueue.length = 0; return; }
    const t = w.time;
    const building = H.mode === 'build';
    steps++;
    if (steps % 6 === 0 || !hash.size) rehash();
    // Gunfire nearby scares the shy ones.
    const held = H.tools && H.tools.held;
    if (held && held.def.kind === 'weapon' && H.input.mouse.down && !building && t > (stepAll.shotAt || 0) && w.player) { stepAll.shotAt = t + 0.4; startle([w.player.x, w.player.y, w.player.z], { radius: 22, strength: 0.5, only: 'fearful' }); }
    const online = H.sync && H.sync.online, host = !online || H.sync.isHost;
    const budget = Math.max(6, Math.ceil(list.length / 10));
    for (let i = 0; i < budget && list.length; i++) {
      const r = list[cursor++ % list.length];
      if (!mine(r) || (building && !r.awake) || r.e._far) continue; // (_far: a round world's far side rests, round.js)
      // Far from every player: think a quarter as often.
      if (r.far && (r.skip = (r.skip || 0) + 1) % 4) continue;
      think(r);
    }
    for (const r of list) {
      if (r.herd) {
        const remote = online && !host;
        // Just became the host's (the host left): carry on where it was going.
        if (r.e.remote && !remote) { r.trk = null; if (r.netGoal && !r.goal && r.e.alive && !r.e.dead) { r.goal = { x: r.netGoal.x, z: r.netGoal.z, ent: null, how: r.netGoal.how, near: 0.8 }; r.act = 'goto'; r.path = null; } }
        r.e.remote = remote;
      }
      if (!mine(r)) continue;
      if (building && !r.awake) { if (r.goal) stop(r); continue; }
      if (r.e._far) continue;
      steer(r, dt, t);
    }
    // A couple of path searches a step.
    for (let n = 0; n < 2 && pathQueue.length; n++) {
      const r = pathQueue.shift();
      r.pathing = false;
      if (!r.e.alive || !r.goal) continue;
      const res = nav.path([r.e.x, r.e.bottom, r.e.z], [r.goal.x, r.e.bottom, r.goal.z], { radius: r.foot * 0.5, height: Math.min(r.tall, 1.6), ignore: r.e, swims: r.sp.swims, step: 0.45 + r.size * 0.1 });
      if (res && res.points.length) r.path = res;
    }
  }
  function afterAll() {
    const w = W();
    if (!w) return;
    for (const r of list) {
      const e = r.e;
      if (!e.alive) continue;
      // On the terrain (when there is one), whatever the physics did.
      if (H.terrain && H.terrain.heightAt && !r.flying && e.physics === 'dynamic' && !e.remote && !e._far) {
        const g = groundAt(e.x, e.z, NaN);
        if (Number.isFinite(g) && e.bottom < g - 0.01) { e.node.position.y += g - e.bottom; if (e.vy < 0) e.vy = 0; e.grounded = true; }
      }
      if (r.carrying) {
        const c = r.carrying;
        if (!c.alive || c._carrier !== e) { r.carrying = null; continue; }
        const p = carryPoint(r);
        c.node.position.set(p[0], p[1] + c.half[1] * 0.5, p[2]);
        c.velocity = [0, 0, 0];
      }
      if (r.ridden) seat(r.ridden, r);
    }
  }
  let frames = 0;
  function frameAll(dt) {
    const w = W();
    if (!w || !list.length) return;
    frames++;
    const cam = w.scene.activeCamera;
    const cx = cam ? cam.position.x : 0, cz = cam ? cam.position.z : 0;
    const k = 1 - Math.exp(-dt * 10);
    for (const r of list) {
      const e = r.e;
      if (!e.alive) continue;
      // Herd animals another player simulates: played back from their snapshots (interpolated, a little behind).
      if (r.trk && e.remote) {
        const s = r.trk.sample();
        if (s) {
          const px = e.x, pz = e.z;
          e.node.position.set(s[0], s[1], s[2]);
          e.node.rotation.y = s[3];
          e.vx = (e.x - px) / Math.max(1e-3, dt); e.vz = (e.z - pz) / Math.max(1e-3, dt);
        }
      } else if (r.net && e.remote) {
        const n = r.net, px = e.x, pz = e.z;
        const far = Math.abs(n.p[0] - px) + Math.abs(n.p[2] - pz) > 6;
        e.node.position.set(far ? n.p[0] : px + (n.p[0] - px) * k, far ? n.p[1] : e.y + (n.p[1] - e.y) * k, far ? n.p[2] : pz + (n.p[2] - pz) * k);
        let d = n.yaw - e.node.rotation.y; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        e.node.rotation.y += d * k;
        e.vx = (e.x - px) / Math.max(1e-3, dt); e.vz = (e.z - pz) / Math.max(1e-3, dt);
      }
      const d = Math.hypot(e.x - cx, e.z - cz);
      r.far = d > 70;
      r.animDt = (r.animDt || 0) + dt;
      // Far away: animate now and then; out of sight range: not at all.
      if (d > 140 || (d > 60 && (frames + r.seed) % 4)) continue;
      body.animate(r, Math.min(0.25, r.animDt));
      r.animDt = 0;
    }
  }

  // ------------------------------------------------------------------ startles: explosions, gunfire, getting hurt
  /** Scares the creatures within `radius` of `at`: they run away from it (herds stampede). { radius, strength,
   *  only: 'fearful' (just the shy ones) }. Explosions and gunfire do it by themselves. */
  function startle(at, o = {}) {
    const p = H.lib.vec(at);
    const R = Number(o.radius) || 15, t = now();
    for (const r of list) {
      if (!r.e.alive || r.statue) continue;
      const d = Math.hypot(r.e.x - p[0], r.e.z - p[2]);
      if (d > R) continue;
      if (o.only === 'fearful' && !fearful(r)) continue;
      if (r.temper === 'angry' && !o.all) continue;
      r.startle = { from: [p[0], p[2]], until: t + 2.5 + (o.strength ?? 1) * 3 * (1 - d / R) };
      r.fear = Math.max(r.fear, Math.min(1, (o.strength ?? 1) * (1.2 - d / R)));
      r.think = 0;
      if (r.act === 'sleep' || r.act === 'eat' || r.act === 'idle') { r.act = 'idle'; r.until = 0; }
      if (mine(r) && r.state !== 'knocked') think(r);
    }
    tell('startle', p, o);
  }
  function onHurt(d) {
    const e = d && d.entity;
    if (!e || !e.living) return;
    const r = e.living, from = d.from && d.from.__entity ? d.from : null, t = now();
    if (from && brave(r) && r.temper !== 'pet') { r.attack = from; r.attackUntil = t + 15; r.think = 0; }
    else if (from || r.fear < 1) startle(from ? [from.x, from.y, from.z] : [e.x + rand(-1, 1), e.y, e.z + rand(-1, 1)], { radius: 12, strength: 0.8, only: 'fearful' });
    tell('hurt', r, d);
  }
  /** Explosions anywhere (the engine's 'explosion' event: rockets, barrels, grenades, scripts) scare everything near. */
  // The ones close enough to be thrown are knocked over (they tumble, lie there a moment, get up and run).
  H.physics.on('explosion', (d) => {
    if (!W() || !list.length) return;
    const p = d.position, R = Number(d.radius) || 4.5, F = Number(d.force) || 0;
    if (d.authoritative && F > 0) for (const r of around(p[0], p[2], R)) {
      const e = r.e, k = 1 - Math.hypot(e.x - p[0], e.y - p[1], e.z - p[2]) / R;
      if (k > 0 && F * k > 5 && e.physics === 'dynamic' && !r.statue && !r.ridden && mine(r)) knock(r);
    }
    startle(p, { radius: Math.max(14, R * 4), strength: 1.2, all: true });
  });
  function knock(r) {
    r.state = 'knocked'; r.act = 'knocked'; r.knockT = 0; r.tipSide = Math.random() < 0.5 ? -1 : 1; r.spinRate = rand(6, 14) * (Math.random() < 0.5 ? -1 : 1);
    r.goal = null; r.path = null; r.fear = 1;
    if (r.carrying) drop(r);
    tell('hurt', r, { knocked: true });
  }

  // ------------------------------------------------------------------ riding (E near a horse, a dinosaur, anything rideable)
  function seat(p, r) {
    const m = r.e, top = m.box().max[1];
    p.node.position.set(m.x - m.forward.x * 0.1, top + 0.55, m.z - m.forward.z * 0.1);
    p.vx = 0; p.vy = 0; p.vz = 0; // the mount carries them: the player's own body doesn't move (or bump into it)
  }
  H.controllers.register('ride', {
    title: 'Riding: WASD steers, shift gallops, space jumps, E gets off',
    speed: 8,
    enter(p, ctx) {
      const m = ctx.opts.mount, r = m && m.living;
      if (!r) { setTimeout(() => p.control('walk'), 0); return; }
      ctx.state.r = r;
      r.ridden = p; r.goal = null; r.path = null; r.command = null; r.attack = null; r.state = 'idle'; r.tame = true;
      p.ghost = true; p.gravity = 0; p.held = true; // carried: the character controller lets the mount move them
      if (H.sync && H.sync.claim) H.sync.claim(m);
      seat(p, r);
      if (G()) G().ui.message(`Riding the ${r.name}: WASD, shift to gallop, E to get off`, 2);
    },
    update(p, dt, ctx) {
      const r = ctx.state.r, input = ctx.game.input;
      if (!r || !r.e.alive || r.e.dead) { p.control('walk'); return; }
      const a = input.direction(), m = r.e;
      const len = Math.hypot(a.x, a.z);
      const speed = input.key('shift') ? r.sp.run * 1.15 : Math.max(r.sp.walk * 2.4, r.sp.run * 0.45);
      if (len > 0.05) { m.walk(a, speed * Math.min(1, len)); r.state = speed > r.sp.walk * 1.8 ? 'run' : 'walk'; }
      else { m.walk({ x: 0, z: 0 }, 0); r.state = 'idle'; }
      if (input.pressed('space') && m.grounded) m.jump(Math.min(9, 6 + r.size));
      seat(p, r);
      p._walked = true;
    },
    idle(p, ctx) { const r = ctx.state.r; if (r && r.e.alive) { r.e.walk({ x: 0, z: 0 }, 0); seat(p, r); } p._walked = true; },
    exit(p, ctx) {
      const r = ctx.state.r;
      p.ghost = false; p.held = false;
      p.gravity = p.baseGravity ?? 1;
      if (!r) return;
      r.ridden = null; r.state = 'idle'; r.act = 'idle'; r.until = now() + 3;
      const m = r.e, side = { x: m.forward.z, z: -m.forward.x };
      p.position = [m.x + side.x * (r.foot * 0.5 + 0.8), m.box().max[1] + 0.2, m.z + side.z * (r.foot * 0.5 + 0.8)];
      p.velocity = [0, 0, 0];
    },
  });
  /** The rideable creature within reach of the player (or null). */
  function mountNear(p, reachM = 2.6) {
    let best = null, bd = Infinity;
    for (const r of list) {
      if (!r.rideable || !r.e.alive || r.e.dead || r.ridden || r.statue || (r.herd && H.sync && H.sync.online)) continue;
      const d = Math.hypot(r.e.x - p.x, r.e.z - p.z) - r.foot * 0.5;
      if (d < reachM && d < bd) { bd = d; best = r; }
    }
    if (best) best.reach = bd;
    return best;
  }
  function ride(e) { const p = G() && G().player; if (p && e && e.living) p.control('ride', { mount: e }); return e; }

  // ------------------------------------------------------------------ the ball (dogs fetch it)
  H.tools.register('ball', {
    title: 'Ball',
    kind: 'tool',
    equip(ctx) {
      const sc = W().scene;
      const m = B.MeshBuilder.CreateSphere('ball-view', { diameter: 0.22, segments: 10 }, sc);
      const mt = new B.StandardMaterial('ball-view', sc); mt.diffuseColor = H.lib.hex(ctx.opts.color || '#e84b3c'); m.material = mt;
      m.isPickable = false; m.metadata = { decor: true }; m.renderingGroupId = 1;
      ctx.state.view = m; ctx.state.has = true;
      if (H.touchUi) living.ui && living.ui.button('throw', 'Throw', 'g');
    },
    unequip(ctx) { if (ctx.state.view) ctx.state.view.dispose(); if (ctx.state.ball && ctx.state.ball.alive && !ctx.state.ball._carrier) ctx.state.ball.destroy(); if (living.ui) living.ui.button('throw', null); },
    step(dt, ctx) {
      const s = ctx.state, g = ctx.game, p = ctx.player;
      const free = H.input.mouse.locked || H.touchUi || (p && p.mouse === 'free');
      if (s.has && (g.input.pressed('g') || (H.input.mouse.pressed && free))) throwBall(ctx);
      else if (!s.has) {
        const b = s.ball;
        if (!b || !b.alive) s.has = true;
        else if (!b._carrier && Math.hypot(b.x - p.x, b.z - p.z) < 1.5 && Math.abs(b.y - p.y) < 2) { b.destroy(); s.has = true; }
      }
    },
    frame(dt, ctx) {
      const v = ctx.state.view, w = W();
      if (!v || !w) return;
      v.parent = w.scene.activeCamera;
      v.position.set(0.26, -0.22, 0.55);
      v.setEnabled(Boolean(ctx.state.has && w.player && w.player._view === 'first'));
    },
  });
  function throwBall(ctx) {
    const g = ctx.game, cam = W().scene.activeCamera, d = cam.getDirection(B.Axis.Z);
    const at = [cam.position.x + d.x * 0.7, cam.position.y + d.y * 0.7 - 0.1, cam.position.z + d.z * 0.7];
    const ball = g.sphere({ radius: 0.13, position: at, physics: 'dynamic', color: ctx.opts.color || '#e84b3c', bounce: 0.55, tag: 'ball', name: 'Ball' });
    const power = Number(ctx.opts.power) || 13;
    ball.velocity = [d.x * power, d.y * power + 3.5, d.z * power];
    ctx.state.has = false;
    ctx.state.ball = ball;
    // Pets nearby that love to fetch go for it.
    for (const r of list) if (r.sp.fetches && r.temper === 'pet' && !r.command && Math.hypot(r.e.x - ctx.player.x, r.e.z - ctx.player.z) < 30) r.command = { do: 'fetch', target: 'player' };
    for (const r of list) if (r.command && r.command.do === 'fetch') r.think = 0;
  }

  // ------------------------------------------------------------------ E: ride, get off (H.use: the engine picks one offer)
  H.use.register('living:ride', {
    near(p) {
      if (p.controller === 'ride') return { label: 'Get off', priority: 100, act: () => p.control('walk') };
      const r = mountNear(p);
      return r ? { label: `Ride the ${r.name}`, distance: r.reach, act: () => ride(r.e) } : null;
    },
  });
  const buttons = new Map();
  living.ui = {
    /** A round touch button that holds a key (null label removes it). */
    button(id, label, key) {
      const old = buttons.get(id);
      if (old) { old.remove(); buttons.delete(id); }
      if (!label) return;
      if (!document.getElementById('lv-style')) {
        const st = document.createElement('style');
        st.id = 'lv-style';
        st.textContent = '.lv-touchbtn{position:fixed;right:18px;bottom:190px;z-index:31;width:64px;height:64px;border-radius:50%;font:700 14px system-ui;color:#fff;background:rgba(232,75,60,.75);border:2px solid rgba(255,255,255,.4)}';
        document.head.appendChild(st);
      }
      const b = document.createElement('button');
      b.className = 'lv-touchbtn'; b.textContent = label;
      b.style.bottom = `${190 + buttons.size * 74}px`;
      document.body.appendChild(b);
      H.bindTouchKey(b, key);
      buttons.set(id, b);
    },
  };
  // ------------------------------------------------------------------ the world starting and ending
  H.hooks.world.push({
    enter() {
      syncStates();
      const g = G();
      if (g) g.on('hurt', onHurt);
      tell('world', W());
    },
    leave() { list = []; hash = new Map(); pathQueue = []; cursor = 0; warned = false; for (const id of [...buttons.keys()]) living.ui.button(id, null); },
  });
  H.hooks.game.push((g) => { g.living = living; });
  H.physics.beforeStep((dt) => { try { stepAll(dt); } catch (err) { H.report(err, 'living'); } });
  H.physics.afterStep(() => { try { afterAll(); } catch (err) { H.report(err, 'living'); } });
  H.hooks.frame.push((dt) => { try { frameAll(dt); } catch (err) { H.report(err, 'living'); } });

  // ------------------------------------------------------------------ H.living: for scripts (game.living) and modules
  /** Makes creatures: spawn('cow', { count: 100, at: [0, 0, 0], radius }) (a herd when count > 1), or one:
   *  spawn('dog', { x: 2, z: 3, follow: 'player' }). Returns the creature (or the herd: .members are its animals). */
  function spawn(kind, o = {}) {
    const at = o.at ? H.lib.vec(o.at) : o.position ? H.lib.vec(o.position) : [Number(o.x) || 0, o.y !== undefined ? Number(o.y) : 1, Number(o.z) || 0];
    const shape = { ...o, species: kind || o.species };
    if (Number(o.count) > 1) return makeHerd(shape, { name: o.name, tag: o.tag, position: at }, null);
    const sp = SP.of(shape.species).def;
    if (o.y === undefined && !o.at && !o.position) at[1] = groundAt(at[0], at[2], 0) + dims(sp, (Number(o.size) || 1) * (sp.scale || 1))[1] / 2 + 0.05;
    return makeCreature(shape, { name: o.name, tag: o.tag, data: o.data, position: at, rotation: o.rotation }, null);
  }
  const recOf = (e) => (e && e.living) || null;
  /** Tells a creature what to do: 'follow' (target), 'stay', 'sit', 'sleep', 'come' (target), 'goto' (at: [x, z]),
   *  'dance', 'cheer', 'fetch' (target), 'carry' (thing), 'drop', 'wander', 'attack' (target), 'flee' (target). */
  function command(e, what, o = {}) {
    const r = recOf(e);
    if (!r) return e;
    const t = now();
    if (what === 'follow') { r.follow = o.target || 'player'; r.command = null; r.attack = null; }
    else if (what === 'wander') { r.follow = null; r.command = null; r.home = [e.x, e.z]; }
    else if (what === 'stay' || what === 'sit' || what === 'sleep') { r.follow = null; r.command = { do: what, until: o.seconds ? t + o.seconds : 0 }; }
    else r.command = { do: what, target: o.target || null, at: o.at ? [H.lib.vec(o.at)[0], H.lib.vec(o.at)[2] ?? H.lib.vec(o.at)[1]] : null, thing: o.thing || null, by: o.by || null, until: o.seconds ? t + o.seconds : 0, near: o.near };
    if (what === 'goto' && o.at) { const p = H.lib.vec(o.at); r.command.at = o.at.length === 2 ? [o.at[0], o.at[1]] : [p[0], p[2]]; }
    r.act = 'idle'; r.until = 0; r.goal = null; r.path = null;
    if (mine(r) && r.state !== 'knocked') think(r);
    tell('act', r, what, o);
    return e;
  }

  Object.assign(living, {
    spawn,
    herd: (kind, o = {}) => spawn(kind, { count: 12, ...o }),
    /** Every creature (of a species). */
    all: (kind) => { const k = kind ? SP.name(kind) : null; return list.filter((r) => r.e.alive && (!k || r.name === k)).map((r) => r.e); },
    /** Creatures within `radius` of a point (of a species). */
    near: (at, radius = 10, kind) => { const p = H.lib.vec(at), k = kind ? SP.name(kind) : null; return list.filter((r) => r.e.alive && (!k || r.name === k) && Math.hypot(r.e.x - p[0], r.e.z - p[2]) <= radius).map((r) => r.e); },
    startle, command,
    follow: (e, target = 'player') => command(e, 'follow', { target }),
    stay: (e) => command(e, 'stay'),
    goTo: (e, at) => command(e, 'goto', { at }),
    wander: (e) => command(e, 'wander'),
    ride, mountNear: (p) => { const r = mountNear(p || G().player); return r ? r.e : null; },
    dismount: () => { const p = G() && G().player; if (p && p.controller === 'ride') p.control('walk'); },
    /** A way around obstacles: [[x, z], ...] corners, or null (nav.js). */
    path: (from, to, o) => { const r = nav.path(H.lib.vec(from), H.lib.vec(to), o); return r ? r.points : null; },
    /** What a creature is doing: { species, state, act, hunger, energy, fear, following, carrying }. */
    status(e) { const r = recOf(e); return r ? { species: r.name, state: r.state, act: r.act, hunger: +r.hunger.toFixed(2), energy: +r.energy.toFixed(2), fear: +r.fear.toFixed(2), following: r.follow ? String(r.follow.__entity ? r.follow.name : r.follow) : null, carrying: r.carrying ? r.carrying.name || r.carrying.kind : null, riding: Boolean(r.ridden) } : null; },
    pickUp: (e, thing) => { const r = recOf(e); if (r && thing) pickUp(r, thing); return e; },
    drop: (e) => { const r = recOf(e); if (r) drop(r); return e; },
    states: STATES,
    _records: () => list,
    _make: (shape, o, spec) => makeCreature(shape, o, spec),
    _resolve: resolve,
    _think: think,
  });
  Object.defineProperties(living, {
    /** How many creatures there are now, and how many the world may hold. */
    count: { get: () => list.length, configurable: true },
    max: { get: () => maxCreatures(), configurable: true },
  });
})();
