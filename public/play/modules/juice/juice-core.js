// Juice: how the game feels. The core: settings (config.juice in the world, the juice level and "reduce motion" per
// device), what things are made of, and the pure math the other juice files share (and the tests check):
//   H.juiceMath   materials, impact sounds by material and impulse, the voice budget, levels, ragdoll plans, falloff
//   H.juice       the live API (juice-audio.js, juice-feel.js, juice-ragdoll.js and juice-fx.js add to it)
// The assistant's docs: docs/world/88-juice.md and docs/api/88-juice.md.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  // ------------------------------------------------------------------ materials: what a thing sounds and breaks like
  const MATERIALS = ['wood', 'metal', 'stone', 'glass', 'flesh', 'plastic', 'water', 'dirt'];
  // Surfaces you walk on (footsteps) are a little finer than what things are made of: grass, sand and snow are dirt
  // when something lands on them, but each has its own step.
  const SURFACES = ['grass', 'dirt', 'sand', 'snow', 'stone', 'wood', 'metal', 'water', 'glass', 'plastic', 'flesh'];
  const SURFACE_MATERIAL = { grass: 'dirt', sand: 'dirt', snow: 'dirt', rock: 'stone' };
  const WORDS = [
    ['glass', /glass|window|bottle|ice\b|crystal|jar|mirror|vase/],
    ['metal', /metal|steel|iron|tin\b|can\b|pipe|anvil|barrel|drum|robot|car\b|truck|bike|motorbike|helicopter|plane|airplane|submarine|vehicle|locker|fridge|oven|sign|pole|lamp|rail|chain|bell|sword|shield|gun|launcher/],
    ['wood', /wood|crate|plank|log\b|tree|trunk|branch|table|chair|desk|shelf|door|fence|bench|box(es)?\b|barricade|boat|raft|cupboard|bed|sofa|piano|stick/],
    ['stone', /stone|rock|brick|wall|boulder|concrete|marble|statue|pillar|cliff|tower|castle|floor|ground|tile|platform|road|path|step|stair|cave/],
    ['dirt', /dirt|mud|soil|grass|sand|snow|terrain|earth|hay|leaf|leaves|bush/],
    ['plastic', /plastic|ball|toy|cone|bucket|rubber|bin|chair|cup|phone|remote|computer|tv\b/],
    ['flesh', /cow|sheep|pig|horse|deer|dog|cat|wolf|bear|rabbit|chicken|bird|penguin|dinosaur|fish|person|people|zombie|player|body|meat|animal|creature/],
    ['water', /water|sea|lake|pool|ocean|river|puddle/],
  ];
  /** A word (or a few) to a material, or null. */
  function materialOfWords(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return null;
    for (const [m, re] of WORDS) if (re.test(t)) return m;
    return null;
  }
  const isMaterial = (m) => MATERIALS.includes(m);
  const PRIMITIVE = new Set(['box', 'sphere', 'cylinder', 'capsule', 'cone', 'torus', 'plane', 'model', 'text', 'light', 'spawn']);
  /** What a thing is made of: its data.material (any of MATERIALS), or a guess from what it is (creatures are flesh,
   *  vehicles metal, crates wood, floors stone...), its name and tag. */
  function materialOf(e) {
    if (!e) return 'stone';
    const d = e.data || {};
    // (Kept on the thing: impacts ask often. A new data.material is seen.)
    if (e._jmat && e._jmatD === d.material) return e._jmat;
    const m = guessMaterial(e, d);
    if (e.__entity) { e._jmat = m; e._jmatD = d.material; }
    return m;
  }
  function guessMaterial(e, d) {
    if (isMaterial(d.material)) return d.material;
    if (d.material && SURFACE_MATERIAL[d.material]) return SURFACE_MATERIAL[d.material];
    if (e.isPlayer || e.remotePlayer) return 'flesh';
    if (e.living) return /robot/.test(String(d.species)) ? 'metal' : 'flesh';
    if (e.vehicle) return e.vehicle.type === 'boat' ? 'wood' : 'metal';
    if (e.kind === 'water') return 'water';
    if (e.isTerrain || d.terrain) return 'dirt';
    if (d.barrel || d.explosive) return 'metal';
    if (d.crate) return 'wood';
    const w = materialOfWords([d.species, PRIMITIVE.has(e.kind) ? '' : e.kind, e.name, e.tag, d.debrisOf].filter(Boolean).join(' '));
    if (w) return w;
    if (e.kind === 'sphere') return 'plastic';
    if (e.physics === 'static' || e.physics === 'kinematic') return 'stone';
    if (e.kind === 'box') return 'wood';
    return 'plastic';
  }
  /** What you're standing on, for footsteps: a surface (grass, sand, snow, stone, wood...). */
  function surfaceOf(e, at) {
    if (!e) return null;
    if (e.isTerrain && H.terrain && H.terrain.materialAt && at) {
      const m = H.terrain.materialAt(at[0], at[2]);
      if (m === 'rock') return 'stone';
      if (m) return m;
    }
    const d = e.data || {};
    if (SURFACES.includes(d.surface)) return d.surface;
    if (SURFACES.includes(d.material)) return d.material;
    const w = String([e.name, e.tag].filter(Boolean).join(' ')).toLowerCase();
    if (/grass|lawn|meadow/.test(w)) return 'grass';
    if (/sand|beach|desert/.test(w)) return 'sand';
    if (/snow/.test(w)) return 'snow';
    const m = materialOf(e);
    return m === 'flesh' ? 'dirt' : m;
  }

  // How each material sounds when synthesized (no sound asset for it): the tone's pitch and how long it rings, the
  // noise's colour (a band-pass) and how much of the hit is noise. Heavier hits are lower, louder and longer.
  const VOICE = {
    wood: { tone: 190, partials: [1, 2.3], ring: 0.09, band: 1100, q: 1.6, noise: 0.55, dur: 0.16 },
    metal: { tone: 420, partials: [1, 2.76, 5.4, 8.9], ring: 0.55, band: 3200, q: 3, noise: 0.3, dur: 0.6 },
    stone: { tone: 95, partials: [1, 1.9], ring: 0.07, band: 520, q: 0.9, noise: 0.75, dur: 0.18 },
    glass: { tone: 1900, partials: [1, 2.4, 4.1, 6.3], ring: 0.32, band: 5200, q: 2, noise: 0.45, dur: 0.35 },
    flesh: { tone: 75, partials: [1], ring: 0.08, band: 300, q: 0.7, noise: 0.6, dur: 0.14 },
    plastic: { tone: 520, partials: [1, 1.7], ring: 0.06, band: 1500, q: 1.2, noise: 0.4, dur: 0.1 },
    water: { tone: 260, partials: [1], ring: 0.12, band: 900, q: 0.8, noise: 0.85, dur: 0.35, sweep: true },
    dirt: { tone: 70, partials: [1], ring: 0.05, band: 380, q: 0.6, noise: 0.85, dur: 0.13 },
  };
  // Which of two materials an impact sounds like: the "louder" one (metal rings over flesh, glass over everything).
  const LOUD = { glass: 7, metal: 6, wood: 5, plastic: 4, stone: 3, water: 2.5, flesh: 2, dirt: 1 };
  /** The impact sound for two materials and how hard they met. impulse: N·s (or a speed in m/s with o.speed).
   *  Returns null for a touch too soft to hear, else { material, other, loudness (0-1), pitch (a rate, ~0.6-1.4),
   *  size: 'tap' | 'knock' | 'crash', words: the asset words to look for, first match wins }. */
  function impactSound(a, b, impulse, o = {}) {
    const ma = isMaterial(a) ? a : 'stone', mb = isMaterial(b) ? b : 'stone';
    const mass = Math.max(0.05, num(o.mass, 1));
    // How hard: the speed change a 1 kg thing would get (so a cow walking into a wall isn't a cannon).
    const speed = o.speed !== undefined ? Math.abs(num(o.speed, 0)) : Math.abs(num(impulse, 0)) / mass;
    if (!(speed >= (o.min ?? 1.2))) return null;
    const main = (LOUD[ma] ?? 0) >= (LOUD[mb] ?? 0) ? ma : mb;
    const other = main === ma ? mb : ma;
    const loudness = clamp((speed - 1) / 14, 0.04, 1) * clamp(0.6 + Math.log10(1 + mass) * 0.25, 0.5, 1.2);
    const size = speed >= 14 ? 'crash' : speed >= 5 ? 'knock' : 'tap';
    // Heavier is lower; the same hit twice isn't the same pitch (o.jitter: 0-1, a seeded number for tests).
    const jitter = o.jitter ?? Math.random();
    const pitch = clamp(1.25 - Math.log10(1 + mass) * 0.22 + (jitter - 0.5) * 0.16, 0.55, 1.45);
    const words = [`${main} ${size}`, `${main} ${size === 'crash' ? 'smash' : 'hit'}`, `${main} impact`, `${main} hit`, main === 'flesh' ? 'thud' : `${main}`, size === 'crash' ? 'crash' : 'impact'];
    return { material: main, other, loudness: Math.min(1, loudness), pitch, size, speed, words };
  }

  // ------------------------------------------------------------------ the voice budget: 100 cows don't make 100 sounds
  /** A fixed number of voices. Each sound asks with a priority (louder and closer is higher); when the voices are
   *  all busy it takes the quietest one's place if it matters more, else it isn't played. Sounds of one kind from one
   *  place close together in time are one sound (`key` + `gap`). */
  class VoiceBudget {
    constructor(max = 16) { this.max = max; this.voices = []; this.recent = new Map(); this.stats = { played: 0, dropped: 0, stolen: 0, merged: 0 }; }
    /** Asks for a voice: { priority, until (time it ends), key?, gap? (seconds a same-key sound is merged), now }.
     *  Returns a voice ({ id, priority, until, stop }) or null. `stop` (set by the caller) is called if it's stolen. */
    request(o) {
      const now = num(o.now, 0);
      this.voices = this.voices.filter((v) => v.until > now && !v.done);
      if (o.key) {
        const last = this.recent.get(o.key);
        if (last !== undefined && now - last < (o.gap ?? 0.05)) { this.stats.merged++; return null; }
      }
      const v = { id: ++VoiceBudget.ids, priority: num(o.priority, 0), until: num(o.until, now + 0.3), stop: null, done: false };
      if (this.voices.length >= this.max) {
        let low = null;
        for (const x of this.voices) if (!low || x.priority < low.priority) low = x;
        if (!low || low.priority >= v.priority) { this.stats.dropped++; return null; }
        low.done = true;
        this.voices.splice(this.voices.indexOf(low), 1);
        this.stats.stolen++;
        try { if (low.stop) low.stop(); } catch { /* fine */ }
      }
      this.voices.push(v);
      if (o.key) {
        this.recent.set(o.key, now);
        if (this.recent.size > 256) for (const [k, t] of this.recent) if (now - t > 1) this.recent.delete(k);
      }
      this.stats.played++;
      return v;
    }
    release(v) { if (v) { v.done = true; const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); } }
    busy(now) { return this.voices.filter((v) => v.until > num(now, 0) && !v.done).length; }
    clear() { for (const v of this.voices) { v.done = true; try { if (v.stop) v.stop(); } catch { /* fine */ } } this.voices = []; this.recent.clear(); }
  }
  VoiceBudget.ids = 0;
  /** A sound's priority: how loud it would be where you are (loudness, distance), and how much it matters (yours, a
   *  blast, a crash: `weight`). */
  const priorityOf = (loudness, distance, weight = 1) => (clamp(loudness, 0, 1.5) * weight) / (1 + Math.max(0, distance) / 8);

  // ------------------------------------------------------------------ levels: how much juice a device gets
  // full: everything; reduced (phones by default): fewer voices, particles, decals and ragdolls, still all of it;
  // minimal (slow devices, or asked for): the essentials (impact sounds, shake, hit-stop), no ragdolls or decals.
  const LEVELS = {
    full: { voices: 24, ragdolls: 8, particles: 1, decals: 160, loops: 6, creatureSteps: 6, prints: 1 },
    reduced: { voices: 14, ragdolls: 3, particles: 0.5, decals: 60, loops: 3, creatureSteps: 3, prints: 0.5 },
    minimal: { voices: 8, ragdolls: 0, particles: 0.2, decals: 0, loops: 1, creatureSteps: 0, prints: 0 },
  };
  const LEVEL_NAMES = Object.keys(LEVELS);
  const levelOf = (name) => (LEVELS[name] ? name : /min|low|off|none/.test(String(name)) ? 'minimal' : /red|less|med|phone/.test(String(name)) ? 'reduced' : 'full');
  /** The lower of two levels (a world can ask for less than the device does, never more). */
  const lowerLevel = (a, b) => LEVEL_NAMES[Math.max(LEVEL_NAMES.indexOf(levelOf(a)), LEVEL_NAMES.indexOf(levelOf(b)))];

  // ------------------------------------------------------------------ feel: shake, hit-stop and slow motion
  /** How much a blast shakes you: stronger closer and bigger (0-1). Past `reach` (radius x 4) it's nothing. */
  function blastShake(radius, distance, force = 18) {
    const R = Math.max(0.5, num(radius, 5));
    const reach = R * 4 + 6;
    const k = clamp(1 - num(distance, 0) / reach, 0, 1);
    return clamp(k * k * (0.25 + R * 0.05) * clamp(num(force, 18) / 18, 0.4, 1.6), 0, 1);
  }
  /** Hit-stop for a hit: seconds the world freezes (0 for none). Kills and big blasts close by freeze longest; it
   *  never lasts past 0.12 s. */
  function hitStopFor(kind, strength) {
    const s = clamp(num(strength, 0), 0, 1);
    if (kind === 'kill') return 0.07;
    if (kind === 'blast') return s > 0.35 ? clamp(0.03 + s * 0.08, 0, 0.11) : 0;
    if (kind === 'crash') return s > 0.4 ? clamp(0.03 + s * 0.06, 0, 0.09) : 0;
    if (kind === 'impact') return s > 0.6 ? 0.04 : 0;
    return 0;
  }
  /** Slow motion for a blast: { scale, seconds } or null. Huge ones (radius 10+, or a chain of three) slow time. */
  function slowmoFor(radius, chain, o = {}) {
    const big = num(o.big, 10);
    const R = num(radius, 0);
    if (R < big && num(chain, 0) < 2) return null;
    const k = clamp((R - big) / 12, 0, 1);
    return { scale: clamp(num(o.scale, 0.3) - k * 0.1, 0.1, 0.9), seconds: clamp(num(o.seconds, 1) + k * 0.6, 0.2, 4) };
  }
  /** Shake "trauma": goes up with each hit, down by itself; what you feel is trauma squared. */
  const traumaAdd = (trauma, amount) => clamp(trauma + amount, 0, 1);
  const traumaDecay = (trauma, dt, rate = 1.6) => Math.max(0, trauma - rate * dt);

  // ------------------------------------------------------------------ ragdolls: a body of 6-10 boxes on ball joints
  /** The parts and joints of a ragdoll for a body plan, in meters with the feet at y = 0 and facing +z.
   *  plan: 'human' (the block avatar: torso, head, arms, legs), 'quad' (torso, head, four legs), 'bird' (torso, head,
   *  legs, wings). d: { len, h, w, legH, legW, head: [w, h, l], size, height (humans) }. Returns { parts: [{ name,
   *  size, at, color }], joints: [{ a, b, at }] } (color: which of the body's colours: body, head, legs, accent). */
  function ragdollPlan(plan, d = {}) {
    const s = num(d.size, 1);
    if (plan === 'human' || plan === 'person' || !plan) {
      const k = num(d.height, 1.8) / 1.8 * s;
      const P = (x) => x * k;
      return {
        parts: [
          { name: 'torso', size: [P(0.5), P(0.64), P(0.3)], at: [0, P(0.87), 0], color: 'body' },
          { name: 'head', size: [P(0.42), P(0.42), P(0.4)], at: [0, P(1.41), 0], color: 'head' },
          { name: 'armL', size: [P(0.14), P(0.62), P(0.15)], at: [P(0.33), P(0.86), 0], color: 'body' },
          { name: 'armR', size: [P(0.14), P(0.62), P(0.15)], at: [P(-0.33), P(0.86), 0], color: 'body' },
          { name: 'legL', size: [P(0.17), P(0.54), P(0.19)], at: [P(0.11), P(0.27), 0], color: 'legs' },
          { name: 'legR', size: [P(0.17), P(0.54), P(0.19)], at: [P(-0.11), P(0.27), 0], color: 'legs' },
        ],
        joints: [
          { a: 'torso', b: 'head', at: [0, P(1.2), 0] },
          { a: 'torso', b: 'armL', at: [P(0.31), P(1.14), 0] },
          { a: 'torso', b: 'armR', at: [P(-0.31), P(1.14), 0] },
          { a: 'torso', b: 'legL', at: [P(0.11), P(0.55), 0] },
          { a: 'torso', b: 'legR', at: [P(-0.11), P(0.55), 0] },
        ],
      };
    }
    const L = num(d.len, 1) * s, Hh = num(d.h, 0.6) * s, Wd = num(d.w, 0.5) * s;
    const legH = Math.max(0.06, num(d.legH, 0.5) * s), legW = Math.max(0.03, num(d.legW, 0.1) * s);
    const hd = (Array.isArray(d.head) ? d.head : [0.3, 0.3, 0.3]).map((v) => Math.max(0.05, num(v, 0.3) * s));
    const torsoY = legH + Hh / 2;
    const parts = [{ name: 'torso', size: [Wd, Hh, L], at: [0, torsoY, 0], color: 'body' }];
    const joints = [];
    const headZ = L / 2 + hd[2] / 2 - Math.min(hd[2], L) * 0.1;
    parts.push({ name: 'head', size: hd, at: [0, torsoY + Hh * 0.35, headZ], color: 'head' });
    joints.push({ a: 'torso', b: 'head', at: [0, torsoY + Hh * 0.3, L / 2] });
    if (plan === 'bird') {
      for (const sx of [1, -1]) {
        parts.push({ name: sx > 0 ? 'legL' : 'legR', size: [legW, legH, legW], at: [sx * Wd * 0.25, legH / 2, 0], color: 'legs' });
        joints.push({ a: 'torso', b: sx > 0 ? 'legL' : 'legR', at: [sx * Wd * 0.25, legH, 0] });
      }
      if (d.wings !== false) for (const sx of [1, -1]) {
        parts.push({ name: sx > 0 ? 'wingL' : 'wingR', size: [Wd * 0.5, Hh * 0.18, L * 0.7], at: [sx * Wd * 0.75, torsoY + Hh * 0.15, 0], color: 'body' });
        joints.push({ a: 'torso', b: sx > 0 ? 'wingL' : 'wingR', at: [sx * Wd * 0.5, torsoY + Hh * 0.2, 0] });
      }
    } else {
      for (const [n, sx, sz] of [['legFL', 1, 1], ['legFR', -1, 1], ['legBL', 1, -1], ['legBR', -1, -1]]) {
        const x = sx * (Wd / 2 - legW / 2), z = sz * (L / 2 - legW / 2);
        parts.push({ name: n, size: [legW, legH, legW], at: [x, legH / 2, z], color: 'legs' });
        joints.push({ a: 'torso', b: n, at: [x, legH, z] });
      }
    }
    return { parts, joints };
  }
  /** Which of these get a ragdoll when the budget is `max`: the nearest first. items: [{ distance, ... }]. */
  function pickNearest(items, max) {
    return items.slice().sort((a, b) => a.distance - b.distance).slice(0, Math.max(0, max | 0));
  }
  /** How hard a thing is thrown by a blast (a velocity change, m/s): away from it, stronger closer (H.physics.explode's
   *  push, without the mass: Δv = impulse / mass). */
  function blastVelocity(at, pos, radius, force, up = 0.8) {
    const dx = pos[0] - at[0], dy = pos[1] - at[1] + up, dz = pos[2] - at[2];
    const dist = Math.hypot(pos[0] - at[0], pos[1] - at[1], pos[2] - at[2]);
    const k = Math.max(0, 1 - dist / Math.max(0.1, radius));
    const l = Math.hypot(dx, dy, dz) || 1;
    return [(dx / l) * force * k, (dy / l) * force * 0.7 * k, (dz / l) * force * k];
  }
  /** Ragdolls from a hit: true when it's hard enough to knock someone off their feet (m/s of speed change). */
  const knocksDown = (dv, o = {}) => num(dv, 0) >= num(o.threshold, 7);
  /** A fall that ends on your back: landing at this speed (m/s, downwards) or more. 17 m/s is about a 6 m drop. */
  const fallRagdolls = (vy, o = {}) => -num(vy, 0) >= num(o.fall, 17);

  H.juiceMath = {
    MATERIALS, SURFACES, VOICE, LOUD, LEVELS, LEVEL_NAMES, materialOf, materialOfWords, surfaceOf, impactSound, VoiceBudget,
    priorityOf, levelOf, lowerLevel, blastShake, hitStopFor, slowmoFor, traumaAdd, traumaDecay, ragdollPlan, pickNearest,
    blastVelocity, knocksDown, fallRagdolls, clamp, num,
  };

  // ------------------------------------------------------------------ settings: the world's (config.juice) and the device's
  // config.juice (scene.json / game.json): false turns it all off; otherwise any of DEFAULTS. The device's choice (the
  // juice level and reduce motion) is kept in this browser and wins where it asks for less.
  const DEFAULTS = {
    level: 'full',       // the most this world wants: full, reduced, minimal
    sounds: true,        // impact sounds, footsteps, rolling and scraping, wind, whooshes
    footsteps: true,
    ragdolls: true,      // players and creatures go ragdoll when blasted, run over or falling far
    hitstop: true,       // a moment's freeze on big hits and kills (playing alone)
    slowmo: true,        // huge blasts slow time (playing alone)
    slowmoScale: 0.3,    // how slow (0.1-0.9)
    slowmoSeconds: 1,    // for how long (real seconds)
    slowmoRadius: 10,    // a blast this big (meters) or bigger slows time
    shake: 1,            // camera shake strength (0 off)
    flash: 1,            // the screen flash of a close blast (0 off)
    boom: 1,             // how big explosions feel: shake, flash, slow motion and particles scale with it
    particles: true,     // dust, sparks, splinters
    decals: true,        // scorch marks, tire marks, footprints
    fov: true,           // the view widens at speed and boost
    bob: false,          // head bob while walking (off unless asked)
    landing: true,       // the view dips when you land
    recoil: true,        // guns kick the view up
    rumble: true,        // controller rumble and phone vibration
    selfBlast: 'launch', // your own explosions launch you instead of killing you ('hurt': they hurt as they used to)
  };
  let world = { ...DEFAULTS };
  const store = (() => { try { return window.localStorage || null; } catch { return null; } })();
  const KEY = 'hawkes.juice';
  const reducedPref = (() => { try { return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } })();
  const device = { level: H.touchUi ? 'reduced' : 'full', reduceMotion: reducedPref, auto: true };
  try { const s = store && JSON.parse(store.getItem(KEY) || 'null'); if (s && typeof s === 'object') { if (s.level) { device.level = levelOf(s.level); device.auto = false; } if (typeof s.reduceMotion === 'boolean') device.reduceMotion = s.reduceMotion; } } catch { /* a fresh device */ }
  const save = () => { try { if (store) store.setItem(KEY, JSON.stringify({ level: device.auto ? undefined : device.level, reduceMotion: device.reduceMotion })); } catch { /* no storage (the sandboxed page): it lasts this visit */ } };
  // Slow frames for a while: the level steps down by itself (and back up when it's smooth again), never above the device's.
  const auto = { drop: 0, slow: 0, fast: 0 };
  let off = false;

  H.features.register('juice', {
    codex: {
      title: 'Juice (how it feels)', group: 'World features',
      what: 'Impact sounds by material, footsteps, ragdolls, hit-stop, slow motion on huge blasts, screen shake, particles, scorch and tire marks, camera feel. Each player also picks a juice level and "reduce motion" for their device.',
      value: { level: 'full', boom: 1.5, slowmoScale: 0.25, shake: 1, bob: false },
      fields: Object.entries(DEFAULTS).map(([k, v]) => [k, typeof v, String(v)]),
    },
    apply(value) { off = value === false; world = { ...DEFAULTS, ...(value && typeof value === 'object' ? value : {}) }; },
    change(value) { off = value === false; world = { ...DEFAULTS, ...(value && typeof value === 'object' ? value : {}) }; },
    dispose() { off = false; world = { ...DEFAULTS }; },
  });

  const listeners = [];
  const J = (H.juice = H.juice || {});
  Object.defineProperties(J, Object.getOwnPropertyDescriptors({
    /** The level in effect now: the lowest of the device's and the world's; slow frames step full down to reduced
     *  (never to minimal: only a player or a world asks for that). */
    get level() { const base = LEVEL_NAMES.indexOf(lowerLevel(device.level, world.level)); return LEVEL_NAMES[base >= 1 ? base : Math.min(1, base + auto.drop)]; },
    /** The device's own choice ('full', 'reduced', 'minimal'); setting it keeps it in this browser. */
    get deviceLevel() { return device.level; },
    set deviceLevel(v) { device.level = levelOf(v); device.auto = false; auto.drop = 0; save(); for (const f of listeners) f(); },
    /** Reduce motion: shake, flashes, the FOV kick and head bob turned well down (kept in this browser). */
    get reduceMotion() { return device.reduceMotion; },
    set reduceMotion(v) { device.reduceMotion = Boolean(v); save(); for (const f of listeners) f(); },
    /** The numbers for the level now (voices, ragdolls, particles, decals...). */
    get budget() { return LEVELS[J.level]; },
    /** The world's settings (config.juice over the defaults). */
    get settings() { return world; },
    /** False when the world turned juice off (config.juice: false). */
    get on() { const w = H.world; return !off && !(w && w.config && w.config.juice === false); },
    /** Is this part of it on? (a setting that's true, or a number above 0) */
    allowed(k) { if (!J.on) return false; const v = world[k]; return v !== false && v !== 0 && v !== 'off'; },
    /** How much motion: 1, or about a fifth with reduce motion on. */
    get motion() { return device.reduceMotion ? 0.2 : 1; },
    onChange(fn) { listeners.push(fn); },
    _auto: auto, _device: device, DEFAULTS,
  }));

  // Watching the frame rate: under 30 fps for 3 s steps the level down one (never to minimal by itself); smooth (55+)
  // for 15 s steps it back up.
  H.hooks.frame.push((dt, render) => {
    const w = H.world;
    if (!w || !w.scene || !render) return;
    const fps = w.scene.getEngine().getFps();
    if (!Number.isFinite(fps) || fps <= 0) return;
    if (fps < 30) { auto.slow += dt; auto.fast = 0; } else if (fps > 55) { auto.fast += dt; auto.slow = 0; } else { auto.slow = 0; auto.fast = 0; }
    if (auto.slow > 3 && auto.drop < 1) { auto.drop++; auto.slow = 0; } // (one step at most: minimal only when asked)
    if (auto.fast > 15 && auto.drop > 0) { auto.drop--; auto.fast = 0; }
  });

  // The editor (or a page around the game) can set the device's choice: postMessage({ type: 'juice', level, reduceMotion }).
  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (e.source !== window.parent || m.type !== 'juice') return;
    if (m.level) J.deviceLevel = m.level;
    if (typeof m.reduceMotion === 'boolean') J.reduceMotion = m.reduceMotion;
    if (m.open) J.openSettings();
  });

  /** A small menu in the game: the juice level and reduce motion for this device. */
  J.openSettings = () => {
    const g = H.game;
    if (!g || !g.ui || !g.ui.menu) return null;
    const mark = (l) => (device.level === l ? '● ' : '○ ');
    return g.ui.menu('juice-settings', {
      title: 'Feel',
      text: 'How much the game shakes, flashes and throws you around, on this device.',
      items: [
        { label: `${mark('full')}Full`, onClick: () => { J.deviceLevel = 'full'; setTimeout(J.openSettings, 0); } },
        { label: `${mark('reduced')}Reduced (fewer particles and ragdolls)`, onClick: () => { J.deviceLevel = 'reduced'; setTimeout(J.openSettings, 0); } },
        { label: `${mark('minimal')}Minimal`, onClick: () => { J.deviceLevel = 'minimal'; setTimeout(J.openSettings, 0); } },
        { label: `${device.reduceMotion ? '☑' : '☐'} Reduce motion (less shake and flashing)`, onClick: () => { J.reduceMotion = !device.reduceMotion; setTimeout(J.openSettings, 0); } },
        { label: 'Done', onClick: () => {} },
      ],
    });
  };

  // game.juice for scripts (every new game object, before scripts run).
  H.hooks.game.push((g) => { g.juice = J; });
})();
