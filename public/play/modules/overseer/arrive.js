// Arrivals (H.arrive): how things come into the world. Everything is sent down by the Overseer; what it is decides how.
//   drop   most things (vehicles, props, furniture, creatures, herds): the beam locks onto the spot, the emitter flares,
//          the thing appears high up in the shaft and falls. Playing, the fall is real physics (the host or owner
//          simulates it, so online everyone sees the same fall): asked for under a roof, it lands on the roof.
//          Building, it falls exactly onto the spot its op saved (the spot is worked out before the op is made, roof
//          and all: H.arrive.plan), so the world file is what you see and undo removes it in one step. It lands with a
//          thud by what it's made of, dust, a ring of light and a shake for heavy things. Batches and herds rain down
//          one by one in a cluster under one wide beam.
//   grow   plants (trees, bushes, flowers, crystals): up out of the ground over ~2 s, with a soft sound.
//   beam   things that can't fall (lights, signs, text, zones, spawn points, waypoints, triggers, things floating or
//          attached to others, Gen art arriving on a thing that's already there): the beam and the thing growing out
//          of the light, a little grander.
//   none   it just appears.
//   Terrain from words (config.terrain.add: a mountain, a hill, a canyon) grows over ~5 s: terrain.js moves the ground
//   and calls H.arrive.quake for the rumble, the shake, the dust and the rocks.
// Cheap on purpose: no lights, nearby arrivals share one beam, landing rings come from a small pool, particles are
// juice's pools, sounds are a few synthesized voices at most (through H.audio.master), nothing is left behind.
// "Down" is H.arrive.down(at) (and up): straight down today; a round planet makes it "toward the center".
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const W = () => H.world;
  const G = () => H.game;
  const { clamp, num, smooth, PHONE } = H.sky._;

  const HOWS = ['drop', 'grow', 'beam', 'none'];
  const LIMITS = { tracked: PHONE ? 80 : 400, rings: PHONE ? 3 : 6, voices: PHONE ? 3 : 6, rocks: PHONE ? 2 : 7 };
  // vmax: the fastest it falls (fast enough to feel, slow enough never to pass through a roof); touch: how fast it meets
  // the ground (the beam brakes it over the last meters: crates don't shatter, barrels don't go off, cars don't bounce away).
  const FALL = { lock: 0.35, vmax: 20, v0: 4, touch: 7, brake: 25, growSeconds: 2.2, terrainSeconds: 5, terrainBack: 2.5 };

  // ------------------------------------------------------------------ down and up (the planet work swaps these)
  /** The way things fall at a point: [x, y, z] unit. */
  function down(at) { const P = H.planet; if (P && P.round) { const u = P.up(at); return [-u[0], -u[1], -u[2]]; } return [0, -1, 0]; } // (a round world: toward its middle)
  function up(at) { const d = down(at); return [-d[0], -d[1], -d[2]]; }
  const along = (p, dir, k) => [p[0] + dir[0] * k, p[1] + dir[1] * k, p[2] + dir[2] * k];
  /** How far `p` is above `base` along up. */
  const heightAbove = (p, base, u) => (p[0] - base[0]) * u[0] + (p[1] - base[1]) * u[1] + (p[2] - base[2]) * u[2];

  // ------------------------------------------------------------------ what a thing is: how it arrives
  const BEAMED = new Set(['light', 'text', 'spawn', 'waypoint', 'trigger', 'zone', 'sprite', 'video', 'mirror', 'plane', 'tool-pickup', 'critter', 'water', 'switch']);
  const PLANT = /\b(tree|trees|pine|palm|oak|birch|willow|maple|bush|bushes|shrub|hedge|plant|plants|flower|flowers|fern|cactus|mushroom|crystal|crystals|grass|sapling|vine|bamboo|reed|seaweed|coral|sunflower|rose|tulip|lily|daisy)\b/;
  const NOT_PLANT = /\b(log|rock|stone|boulder|pot|vase)\b/;
  const wordsOf = (x) => {
    const sh = (x && x.shape) || {};
    const d = (x && x.data) || {};
    return [x && x.name, x && x.tag, x && (x.kind || x.type), sh.word, sh.species, d.standIn, d.species].filter(Boolean).join(' ').toLowerCase();
  };
  /** The game's default (config.overseer.arrive: "auto", or one of drop/grow/beam/none for everything). */
  function gameDefault() {
    let o = null;
    try { o = H.lib.effectiveConfig().overseer; } catch { o = null; }
    if (o === false) return 'auto';
    if (o && typeof o === 'object') { if (o.beams === false) return 'none'; if (HOWS.includes(o.arrive)) return o.arrive; }
    return 'auto';
  }
  /** How a thing (an entity) arrives: asked (drop/grow/beam/none, or auto) and what it is. */
  function how(e, asked) {
    const want = HOWS.includes(asked) ? asked : gameDefault();
    if (want !== 'auto' && want !== 'drop') return want;
    if (!e || !e.__entity) return 'none';
    if (e.isPlayer || e.remotePlayer) return 'beam';
    const w = wordsOf(e);
    if (want === 'auto' && PLANT.test(w) && !NOT_PLANT.test(w) && e.kind !== 'herd') return 'grow';
    if (e.kind === 'herd') return 'drop';
    if (BEAMED.has(e.kind) || e.node.parent || e.gravity === 0 || e.physics === 'trigger' || e.physics === 'kinematic') return want === 'drop' && e.physics !== 'trigger' ? 'drop' : 'beam';
    if (e.physics === 'dynamic' || e.living) return 'drop';
    // Things that stay put: placed by hand somewhere they rest (a house, a wall, a boulder) fall onto that spot;
    // ones floating in the air, or as big as the ground, are beamed in where they are.
    const big = Math.max(e.half[0], e.half[2]) * 2;
    if (want === 'auto' && (big > 40 || !restsOnSomething(e))) return 'beam';
    return 'drop';
  }
  function restsOnSomething(e) {
    const p = [e.x, e.bottom + 0.3, e.z];
    try {
      const hit = H.physics.raycast(p, down(p), 0.9, { ignore: e });
      if (hit) return true;
    } catch { /* no physics */ }
    const g = H.terrain && H.terrain.active ? H.terrain.heightAt(e.x, e.z) : null;
    return g !== null && g !== undefined && Math.abs(e.bottom - g) < 0.7;
  }

  // ------------------------------------------------------------------ building: where a drop will land (before the op)
  /** Where something asked for at `at` (its middle, resting on the ground) comes to rest when it falls from the sky:
   *  on whatever is above the spot (a roof), or the spot itself. o: { half (half its width), lift (half its height) }. */
  function landing(at, o = {}) {
    const lift = Math.max(0.1, num(o.lift, 0.5)), half = Math.max(0.1, num(o.half, lift));
    const u = up(at);
    const high = 60;
    const from = along(at, u, high), to = along(at, u, -0.05);
    let hit = null;
    try {
      const shape = H.physics.shapes.box([half * 1.7, Math.max(0.2, lift * 1.8), half * 1.7]);
      hit = H.physics.shapeCast(shape, from, to, {});
    } catch { hit = null; }
    if (!hit || !(hit.fraction < 1)) return at.slice();
    if (hit.entity && (hit.entity.isPlayer || hit.entity.remotePlayer || hit.entity.living)) return at.slice();
    const k = high + 0.05;
    const rest = along(from, u, -k * hit.fraction + 0.02);
    return heightAbove(rest, at, u) > 0.3 ? rest.map((n) => Math.round(n * 100) / 100) : at.slice();
  }
  /** Building: moves the specs that will drop to where they land (a car asked for in a house ends on its roof).
   *  o: { half } (the spawn wheel knows how wide things are). Returns the specs. */
  function plan(specs, o = {}) {
    const list = Array.isArray(specs) ? specs : [specs];
    const asked = HOWS.includes(o.how) ? o.how : gameDefault();
    if (asked !== 'auto' && asked !== 'drop') return specs;
    for (const s of list) {
      const p = s && s.transform && s.transform.position;
      if (!Array.isArray(p) || p.length < 3 || !specDrops(s, asked)) continue;
      let lift = 0.5;
      try { lift = H.kinds.lift(s) || 0.5; } catch { /* a kind that can't say */ }
      s.transform.position = landing(p, { lift, half: o.half || lift });
    }
    return specs;
  }
  function specDrops(s, asked) {
    if (s.parent || BEAMED.has(s.type) || s.physics === 'trigger' || s.physics === 'kinematic' || s.physics === 'none') return false;
    if (asked === 'auto' && PLANT.test(wordsOf(s)) && !NOT_PLANT.test(wordsOf(s))) return false;
    const def = H.kinds.get ? H.kinds.get(s.type) : null;
    const phys = s.physics || (def && def.physics) || 'static';
    // Static things land on the spot they were placed (they're placed); things that fall can land on a roof.
    return phys === 'dynamic' || s.type === 'creature' || s.type === 'herd' || s.type === 'friend';
  }

  // ------------------------------------------------------------------ sound: a few synthesized voices
  let voices = 0;
  function voice(seconds) {
    const ac = H.audio && H.audio.context;
    if (!ac || ac.state !== 'running' || voices >= LIMITS.voices) return null;
    voices++;
    setTimeout(() => { voices = Math.max(0, voices - 1); }, Math.max(50, seconds * 1000));
    return ac;
  }
  function camAt() { const w = W(); const c = w && w.scene && w.scene.activeCamera; return c ? c.globalPosition : null; }
  /** An output for a sound at `at`, quieter far away (null: too far to hear). */
  function outAt(ac, at, vol, reach = 30) {
    const c = camAt();
    const d = c && at ? Math.hypot(at[0] - c.x, at[1] - c.y, at[2] - c.z) : 0;
    const v = vol / (1 + d / reach);
    if (v < 0.004) return null;
    const g = ac.createGain();
    g.gain.value = v;
    g.connect(H.audio.master);
    return g;
  }
  let noiseBuf = null;
  function noise(ac) {
    if (noiseBuf && noiseBuf.sampleRate === ac.sampleRate) return noiseBuf;
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  function env(ac, g, t0, a, peak, rel) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + rel); }
  function noiseThrough(ac, out, t0, dur, f0, f1, type = 'bandpass', q = 1.2, peak = 1) {
    const n = ac.createBufferSource(); n.buffer = noise(ac);
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ac.createGain(); env(ac, g, t0, Math.min(0.15, dur * 0.3), peak, dur * 0.8);
    n.connect(f).connect(g).connect(out);
    n.start(t0, Math.random()); n.stop(t0 + dur + 0.1);
  }
  function tone(ac, out, t0, dur, f0, f1, type = 'sine', peak = 1, attack = 0.01) {
    const o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ac.createGain(); env(ac, g, t0, attack, peak, dur);
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + attack + dur + 0.05);
  }
  /** A game sound for the word, if the game has one (H.assets), else null. */
  function gameSound(word) {
    try { const id = H.assets && H.assets.pick ? H.assets.pick(word, { kind: 'sound' }) : null; if (id && G() && G().sound) { G().sound(id); return true; } } catch { /* none */ }
    return null;
  }
  const sfx = {
    /** Falling: a whistle and rushing air that drop in pitch as it comes down. */
    fall(at, seconds, size) {
      if (gameSound('falling')) return;
      const ac = voice(seconds); if (!ac) return;
      const out = outAt(ac, at, 0.11 * clamp(0.6 + size * 0.15, 0.6, 1.4), 40); if (!out) return;
      const t = ac.currentTime;
      noiseThrough(ac, out, t, seconds, 2600, 500, 'bandpass', 1.6, 0.9);
      tone(ac, out, t, seconds, 1500 / Math.sqrt(Math.max(0.5, size)), 420 / Math.sqrt(Math.max(0.5, size)), 'sine', 0.25, seconds * 0.4);
    },
    /** Landing: a thud (deeper and longer for heavy things) and a soft chime as the ring of light goes out. */
    thud(at, weight) {
      if (gameSound('landing')) return;
      const ac = voice(1.2); if (!ac) return;
      const k = clamp(weight, 0, 1);
      const out = outAt(ac, at, 0.22 + k * 0.4, 30 + k * 40); if (!out) return;
      const t = ac.currentTime;
      tone(ac, out, t, 0.25 + k * 0.6, 95 - k * 40, 38, 'sine', 1, 0.005);
      noiseThrough(ac, out, t, 0.18 + k * 0.5, 900, 120, 'lowpass', 0.7, 0.7);
      tone(ac, out, t + 0.04, 0.7, 1318, 1290, 'sine', 0.06, 0.02);
      tone(ac, out, t + 0.06, 0.6, 1975, 1960, 'sine', 0.035, 0.02);
    },
    /** Something growing up out of the ground: a soft rising rustle and a little pluck. */
    sprout(at, seconds) {
      if (gameSound('grow')) return;
      const ac = voice(seconds); if (!ac) return;
      const out = outAt(ac, at, 0.12, 25); if (!out) return;
      const t = ac.currentTime;
      noiseThrough(ac, out, t, seconds, 300, 2400, 'bandpass', 2, 0.6);
      tone(ac, out, t + seconds * 0.85, 0.5, 520, 780, 'triangle', 0.18, 0.01);
    },
    /** The ground moving: a deep rumble for `seconds`, with cracks in it. */
    rumble(at, seconds, k) {
      if (gameSound('rumble')) return;
      const ac = voice(seconds + 0.5); if (!ac) return;
      const out = outAt(ac, at, 0.35 + k * 0.35, 120); if (!out) return;
      const t = ac.currentTime;
      const n = ac.createBufferSource(); n.buffer = noise(ac); n.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 110; lp.Q.value = 0.9;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.6); g.gain.setValueAtTime(1, t + seconds - 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.4);
      const lfo = ac.createOscillator(); lfo.frequency.value = 7; const lg = ac.createGain(); lg.gain.value = 0.35;
      lfo.connect(lg).connect(g.gain);
      n.connect(lp).connect(g).connect(out);
      tone(ac, out, t, seconds, 46, 34, 'sine', 0.8, 0.5);
      n.start(t); n.stop(t + seconds + 0.5); lfo.start(t); lfo.stop(t + seconds + 0.5);
      const cracks = PHONE ? 4 : 9;
      for (let i = 0; i < cracks; i++) noiseThrough(ac, out, t + 0.3 + Math.random() * (seconds - 0.6), 0.12 + Math.random() * 0.2, 1800, 300, 'bandpass', 0.8, 0.5);
    },
  };

  // ------------------------------------------------------------------ the look: shared beams, rings of light, juice
  /** Nearby arrivals share one beam (held until the last of them lands). */
  let shared = [];
  function beamFor(at, radius) {
    if (!H.overseer || !H.overseer.on || !H.overseer.beam) return null;
    for (const s of shared) {
      if (!s.b.alive || s.b.ended) continue;
      const d = Math.hypot(s.at[0] - at[0], s.at[2] - at[2]);
      if (d < Math.max(5, s.radius + radius)) {
        s.users++;
        const r = Math.max(s.radius, d + radius);
        if (r > s.radius) { s.radius = r; s.b.radius = clamp(r, 0.6, 90); }
        s.b.pulse(0.6);
        return s;
      }
    }
    const b = H.overseer.beam(at, { radius: clamp(radius, 0.8, 90), hold: true });
    if (!b) return null;
    b.pulse(1.2);
    const s = { b, at: at.slice(), radius, users: 1 };
    shared.push(s);
    return s;
  }
  function letGo(s, ok = true) {
    if (!s) return;
    s.users--;
    if (s.users <= 0) { if (s.b.alive) s.b.end(ok); shared = shared.filter((x) => x !== s); }
  }
  // Rings of light where things land: a few meshes, reused.
  const rings = { list: [], scene: null };
  function ring(at, radius) {
    const w = W();
    if (!w || !w.scene) return;
    if (rings.scene !== w.scene) { rings.list = []; rings.scene = w.scene; }
    let r = rings.list.find((x) => !x.on);
    if (!r && rings.list.length < LIMITS.rings) {
      const mesh = B.MeshBuilder.CreateTorus('arrive-ring', { diameter: 2, thickness: 0.06, tessellation: PHONE ? 24 : 40 }, w.scene);
      const m = new B.StandardMaterial('arrive-ring', w.scene);
      m.emissiveColor = new B.Color3(0.78, 0.94, 1); m.disableLighting = true; m.alphaMode = B.Engine.ALPHA_ADD; m.fogEnabled = false;
      mesh.material = m; mesh.isPickable = false; mesh.metadata = { decor: true, noGlow: true }; mesh.receiveShadows = false;
      r = { mesh, m, on: false };
      rings.list.push(r);
    }
    if (!r) return;
    r.on = true; r.t = 0; r.radius = Math.max(0.6, radius);
    r.mesh.position.set(at[0], at[1] + 0.06, at[2]);
    r.mesh.setEnabled(true);
  }
  function runRings(dt) {
    for (const r of rings.list) {
      if (!r.on) continue;
      r.t += dt;
      const k = clamp(r.t / 0.7, 0, 1);
      const s = r.radius * (0.5 + 1.8 * (1 - Math.pow(1 - k, 3)));
      r.mesh.scaling.set(s, 1, s);
      r.m.alpha = (1 - k) * 0.95;
      if (k >= 1) { r.on = false; r.mesh.setEnabled(false); }
    }
  }
  const J = () => H.juice || null;
  function shake(k, at, reach) {
    const j = J();
    if (j && j.shake) { j.shake(k, { at, reach }); return; }
    const g = G();
    if (g && g.camera && g.camera.shake) try { g.camera.shake(k * 0.5, 0.3); } catch { /* no camera */ }
  }
  function dust(at, amount, surface) {
    const j = J();
    if (j && j.fx && j.fx.dust) { j.fx.dust(at, { amount, surface }); return; }
    const g = G();
    if (g) g.burst(at, { color: '#c9b79a', count: Math.round(10 + amount * 24), speed: 2 });
  }
  /** What's under a point: { entity, point } or null. */
  function groundUnder(at, self) {
    try { return H.physics.raycast(along(at, up(at), 0.4), down(at), 3, { ignore: self }); } catch { return null; }
  }
  /** How heavy a thing feels, 0 (a ball) to 1 (a house, a truck). */
  function weightOf(e) {
    const v = e.half[0] * e.half[1] * e.half[2] * 8;
    const m = e.physics === 'dynamic' ? Math.max(e.mass, v * 60) : v * 120;
    return clamp((Math.log10(Math.max(1, m)) - 0.5) / 3.2, 0, 1);
  }

  // ------------------------------------------------------------------ arrivals, one per thing
  const list = []; // { e, how, t, delay, phase, exact, target, beam, ... }
  let stamp = 0;
  /** The things arrive (opts: how ('auto', drop, grow, beam, none), exact (building: the fall ends on the saved spot),
   *  gap (seconds between drops in a batch), lift (0: they're already up, as rain)). */
  function bring(things, o = {}) {
    const ents = (Array.isArray(things) ? things : [things]).filter((e) => e && e.__entity && e.alive && !e._arrival);
    if (!ents.length) return [];
    const groups = { drop: [], grow: [], beam: [], none: [] };
    for (const e of ents) groups[how(e, o.how)].push(e);
    if (groups.beam.length && H.overseer && H.overseer.materialize) {
      const b = H.overseer.materialize(groups.beam.length === 1 ? groups.beam[0] : groups.beam, { radius: groups.beam.length === 1 ? undefined : undefined });
      if (b && b.pulse) b.pulse(1);
      if (H.overseer.flare) H.overseer.flare(0.35);
    }
    for (const e of groups.grow) start(e, 'grow', o, 0);
    // Herds: their animals rain down (each one falls; the herd itself is a mark on the ground).
    const drops = [];
    for (const e of groups.drop) { if (e.kind === 'herd' && e.members) drops.push(...e.members.filter((m) => m.alive)); else drops.push(e); }
    const n = drops.length;
    const gap = num(o.gap, n > 1 ? Math.min(0.14, 2.6 / n) : 0);
    const delay0 = num(o.delay, 0);
    // A batch shares one wide beam over the cluster (held until the last one lands).
    let wide = null;
    if (n > 1) {
      let sx = 0, sz = 0, low = Infinity;
      for (const e of drops) { sx += e.x; sz += e.z; low = Math.min(low, e.bottom); }
      const cx = sx / n, cz = sz / n;
      let rad = 1;
      for (const e of drops) rad = Math.max(rad, Math.hypot(e.x - cx, e.z - cz) + Math.max(e.half[0], e.half[2]));
      wide = beamFor([cx, low, cz], clamp(rad * 1.05, 2, 90));
      if (wide) wide.users += n - 1;
    }
    drops.forEach((e, i) => start(e, 'drop', { ...o, beam: wide }, delay0 + i * gap, i));
    if (drops.length && H.overseer && H.overseer.flare) H.overseer.flare(clamp(0.4 + n * 0.05, 0.4, 1.2));
    return ents;
  }
  function start(e, kind, o, delay, index = 0) {
    if (list.length >= LIMITS.tracked) { if (o.beam) letGo(o.beam); return; } // past the budget: it just appears
    const exact = kind === 'drop' ? Boolean(o.exact) && !e.living : true;
    const target = [e.x, e.y, e.z];
    const big = Math.max(e.half[0], e.half[1], e.half[2]);
    const rec = {
      e, kind, t: 0, delay, phase: 'wait', exact, target, index, id: ++stamp,
      size: big, weight: weightOf(e), lift: o.lift === 0 ? 0 : null,
      physics: e.physics, gravity: e.gravity, scale: e.node.scaling.clone(), shown: e.node.isEnabled(),
    };
    e._arrival = rec;
    list.push(rec);
    if (kind === 'grow') { beginGrow(rec); return; }
    // Hidden until its turn (no body, no brain moving it), up in the beam.
    const drop = rec.lift === 0 ? 0 : clamp(16 + big * 1.6 + (index % 5) * 1.3, 16, 46);
    rec.drop = drop;
    // Where it will come to rest (a roof over the spot, or the spot): the beam ends there and the fall brakes toward it.
    if (!exact && drop > 0) rec.rest = landing(target, { lift: e.half[1], half: Math.max(e.half[0], e.half[2]) });
    const ground = rec.rest ? [rec.rest[0], rec.rest[1] - e.half[1], rec.rest[2]] : [target[0], e.bottom, target[2]];
    rec.beam = o.beam !== undefined && o.beam !== null ? o.beam : beamFor(ground, clamp(Math.max(e.half[0], e.half[2]) * 1.4 + 0.5, 0.8, 30));
    if (rec.lift !== 0) hide(rec);
    if (o.planned && !exact) rec.roof = true;
  }
  // A round world: the frame moved under the player (round.js moved the things); where each arrival is going goes too.
  if (H.planet && H.planet.frame && H.planet.frame.onRebase) H.planet.frame.onRebase((tr) => {
    for (const rec of list) {
      if (rec.target) rec.target = tr.point(rec.target);
      if (rec.rest) rec.rest = tr.point(rec.rest);
    }
  });
  function hide(rec) {
    const e = rec.e;
    e.node.setEnabled(false);
    if (rec.exact && e.physics !== 'none') e.physics = 'none';
  }
  /** Its turn: it appears high up in the beam and starts to fall. */
  function release(rec) {
    const e = rec.e;
    rec.phase = 'fall';
    rec.t = 0;
    const u = up(rec.target);
    const from = along(rec.target, u, rec.drop);
    if (rec.drop > 0) {
      e.node.position.set(from[0], from[1], from[2]);
      e.node.setEnabled(rec.shown);
      // Animals don't walk on air: they fall, land, lie there a moment and get up (Living things' knocked state).
      if (e.living) e._tumble = true;
      if (!rec.exact) {
        if (e.physics !== rec.physics) e.physics = rec.physics;
        if (!e.remote) e.velocity = along([0, 0, 0], down(rec.target), FALL.v0);
        e.wake();
      }
    }
    rec.prev = heightAbove([e.x, e.y, e.z], rec.target, u);
    rec.fastest = 0;
    rec.fallFor = Math.sqrt(2 * rec.drop / Math.abs(H.physics.gravity || 24));
    if (rec.beam && rec.beam.b.alive) rec.beam.b.pulse(0.8);
    if (rec.index < 6 && rec.drop > 0) sfx.fall(from, clamp(rec.fallFor + 0.2, 0.5, 2.2), rec.size);
  }
  /** It's down: dust, a thud, a ring of light, a shake by weight; the beam lets go. */
  function land(rec, speed) {
    const e = rec.e;
    if (e.living && e._tumble) e._tumble = false;
    rec.phase = 'settle';
    rec.t = 0;
    const at = [e.x, e.bottom, e.z];
    const k = rec.weight;
    const hit = groundUnder([e.x, e.bottom + 0.05, e.z], e);
    const g = hit && hit.entity;
    const M = H.juiceMath;
    let surface = 'dirt';
    try { if (g && M && M.surfaceOf) surface = M.surfaceOf(g, hit.point); else if (H.terrain && H.terrain.active) surface = H.terrain.materialAt(e.x, e.z) || 'dirt'; } catch { /* dirt */ }
    // Juice plays impacts for real bodies itself; a drop that was animated, or walks (creatures), gets its own.
    if ((rec.exact || e._cc) && J() && J().sound && J().sound.impact && rec.index < 8) try { J().sound.impact(e, g || null, { speed: Math.max(6, speed), at }); } catch { /* no sound */ }
    if (rec.index < 10 || rec.index % 4 === 0) dust(at, clamp(0.35 + k * 1.1, 0.3, 1.5), surface === 'water' ? 'dirt' : surface);
    if (rec.index < 3 || rec.index % 6 === 0) ring(at, Math.max(e.half[0], e.half[2]) * 1.3 + 0.4);
    if (rec.index < 2) sfx.thud(at, k);
    if (k > 0.25 && J() && J().fx && J().fx.burst && M && M.materialOf && M.materialOf(e) === 'metal') J().fx.burst('sparks', at, { count: 10 + k * 20, speed: 0.8 });
    if (rec.index < 4) shake(clamp(0.08 + k * 0.6, 0.06, 0.75), at, 18 + k * 30);
    if (rec.beam) { letGo(rec.beam, true); rec.beam = null; }
    try { if (G()) G().emit('landed', { thing: e, at, weight: k, on: g || null }); } catch (err) { H.report(err, 'arrive'); }
  }
  function beginGrow(rec) {
    const e = rec.e;
    rec.phase = 'grow';
    rec.height = Math.max(0.3, e.half[1] * 2 + 0.1);
    if (e.physics !== 'none') e.physics = 'none';
    applyGrow(rec, 0);
    if (rec.index < 6) {
      sfx.sprout([e.x, e.bottom, e.z], FALL.growSeconds);
      dust([e.x, e.bottom + 0.05, e.z], 0.35, 'dirt');
    }
    if (H.overseer && H.overseer.flare) H.overseer.flare(0.2);
  }
  function applyGrow(rec, k) {
    const e = rec.e, s = rec.scale, u = up(rec.target);
    const g = smooth(0, 1, k);
    const rise = g + Math.sin(g * Math.PI) * 0.06;
    const p = along(rec.target, u, -rec.height * (1 - rise));
    e.node.position.set(p[0], p[1], p[2]);
    const w = 0.35 + 0.65 * g, h = 0.55 + 0.45 * rise;
    e.node.scaling.set(s.x * w, s.y * h, s.z * w);
  }
  /** Done: everything put back as it was meant to be (its place, its size, its physics). */
  function finish(rec) {
    const e = rec.e;
    list.splice(list.indexOf(rec), 1);
    if (rec.beam) { letGo(rec.beam, true); rec.beam = null; }
    if (e._arrival === rec) e._arrival = null;
    if (!e.alive) return;
    if (!e.node.isEnabled() && rec.shown) e.node.setEnabled(true);
    if (rec.kind === 'grow' || rec.exact) {
      const p = rec.target;
      e.node.position.set(p[0], p[1], p[2]);
      if (!e.node.scaling.equals(rec.scale)) { e.node.scaling.copyFrom(rec.scale); e.measure(); }
    }
    if (e.living && e._tumble && rec.kind === 'drop') e._tumble = false;
    if (e.physics !== rec.physics) e.physics = rec.physics;
    if (e.gravity !== rec.gravity) e.gravity = rec.gravity;
    if (rec.exact || rec.kind === 'grow') { e.velocity = [0, 0, 0]; }
    e.wake();
  }
  // Real bodies tell us when they hit something.
  H.physics.on('collision', (c) => {
    for (const x of [c.a, c.b]) {
      const r = x && x._arrival;
      if (r && r.phase === 'fall' && !r.exact && r.t > 0.05) { r.hit = true; r.hitSpeed = Math.max(r.hitSpeed || 0, Number(c.speed) || 0); }
    }
  });

  function step(dt) {
    if (!list.length) return;
    const gAbs = Math.abs(H.physics.gravity || 24);
    for (const rec of [...list]) {
      const e = rec.e;
      if (!e.alive) { finish(rec); continue; }
      rec.t += dt;
      // The shaft burns brighter while something is on its way down it.
      if (rec.beam && rec.beam.b.alive && (rec.phase === 'fall' || rec.phase === 'wait') && rec.beam.b.boost < 1.4) rec.beam.b.boost = rec.phase === 'fall' ? 1.4 : Math.max(rec.beam.b.boost, 0.7);
      if (rec.phase === 'wait') {
        if (rec.t >= FALL.lock + rec.delay) release(rec);
        continue;
      }
      if (rec.phase === 'grow') {
        const k = clamp(rec.t / FALL.growSeconds, 0, 1);
        applyGrow(rec, k);
        if (k >= 1) { const p = [e.x, e.bottom + 0.05, e.z]; if (rec.index < 6) dust(p, 0.25, 'dirt'); finish(rec); }
        continue;
      }
      if (rec.phase === 'fall') {
        const u = up(rec.target);
        if (rec.exact) {
          // Building: an exact fall onto the saved spot (gravity's curve, as fast as a real one).
          const tt = rec.t;
          const h = Math.max(0, rec.drop - (FALL.v0 * tt + 0.5 * gAbs * tt * tt));
          const v = Math.min(FALL.vmax * 1.3, FALL.v0 + gAbs * tt);
          const p = along(rec.target, u, h);
          e.node.position.set(p[0], p[1], p[2]);
          if (h <= 0) land(rec, v);
          continue;
        }
        // Playing: a real fall (the beam keeps it from going too fast to tunnel through a roof).
        if (!e.remote && !e._cc && e.physics === 'dynamic') {
          const vd = -(e.vx * u[0] + e.vy * u[1] + e.vz * u[2]);
          const h = rec.rest ? Math.max(0, heightAbove([e.x, e.y, e.z], rec.rest, u)) : 1e9;
          const cap = Math.min(FALL.vmax, Math.sqrt(FALL.touch * FALL.touch + 2 * FALL.brake * h));
          if (vd > cap) { const k = vd - cap; e.velocity = [e.vx + u[0] * k, e.vy + u[1] * k, e.vz + u[2] * k]; }
        }
        const hNow = heightAbove([e.x, e.y, e.z], rec.target, u);
        const vDown = (rec.prev - hNow) / Math.max(1e-4, dt);
        rec.prev = hNow;
        rec.fastest = Math.max(rec.fastest, vDown);
        const stopped = rec.fastest > 4 && vDown < 1.2;
        if ((rec.hit && rec.t > 0.08) || stopped || (rec.drop === 0 && rec.t > 0.4 && vDown < 0.6) || hNow < -0.5 && rec.t > rec.fallFor) land(rec, Math.max(rec.hitSpeed || 0, rec.fastest));
        else if (rec.t > rec.fallFor + 4) { if (rec.beam) { letGo(rec.beam, false); rec.beam = null; } finish(rec); }
        continue;
      }
      if (rec.phase === 'settle') {
        // A little squash as it lands (animated drops: real bodies bounce for real).
        if (rec.exact && rec.drop > 0) {
          const k = clamp(rec.t / 0.22, 0, 1), q = Math.sin(k * Math.PI) * (0.12 + rec.weight * 0.08) * (1 - k * 0.3);
          const s = rec.scale;
          e.node.scaling.set(s.x * (1 + q * 0.5), s.y * (1 - q), s.z * (1 + q * 0.5));
          const p = along(rec.target, up(rec.target), -(e.half[1] * q * 0.5));
          e.node.position.set(p[0], p[1], p[2]);
          if (k < 1) continue;
        }
        finish(rec);
      }
    }
  }
  H.hooks.step.push((dt) => { try { step(dt); runQuakes(dt); } catch (err) { H.report(err, 'arrive'); } });
  H.hooks.frame.push((dt) => { if (rings.list.length) runRings(dt); });

  // ------------------------------------------------------------------ the ways things are made
  /** Scene ops (hooked from overseer.js): creates arrive by what they are. o.fx says how ('materialize', 'arrive' and
   *  'auto' choose by the thing; 'drop', 'grow', 'beam', 'none'); an op's own `arrive` wins. Another builder's
   *  undo/redo (no fx) is beamed. Building, drops fall exactly onto the saved spot. */
  function ops(opsList, touched, o = {}) {
    const fx = o.fx;
    const batch = fx === 'materialize' || fx === 'arrive' || fx === 'auto' ? 'auto' : HOWS.includes(fx) ? fx : o.remote && o.by ? 'beam' : null;
    const byHow = new Map();
    for (const op of opsList || []) {
      if (!op || !op.entity) continue;
      const isNew = op.op === 'create' || (op.op === 'replace' && fx === 'arrive');
      if (!isNew) continue;
      // A Gen asset arriving on a thing that is already there: beamed in place.
      const asked = HOWS.includes(op.arrive) ? op.arrive : op.op === 'replace' ? 'beam' : batch;
      if (!asked || asked === 'none') continue;
      const e = touched.find((x) => x && x.alive && x.sceneId === op.entity.id);
      if (!e) continue;
      if (!byHow.has(asked)) byHow.set(asked, []);
      byHow.get(asked).push(e);
    }
    const exact = H.mode === 'build';
    for (const [asked, ents] of byHow) {
      if (exact && o.remote) fixRoofs(ents, asked);
      bring(ents, { how: asked, exact });
    }
  }
  /** Building, someone else's drop (the assistant's): its op kept the asked spot; if that's under a roof, it lands on
   *  the roof, and one of the builders (the room's host) saves where it came to rest. */
  function fixRoofs(ents, asked) {
    const host = !H.sync || !H.sync.online || H.sync.isHost;
    const fixes = [];
    for (const e of ents) {
      if (how(e, asked) !== 'drop' || !(e.physics === 'dynamic' || e.living) || e.kind === 'herd') continue;
      const p = landing([e.x, e.y, e.z], { lift: e.half[1] + (e.y - e.half[1] - e.bottom), half: Math.max(e.half[0], e.half[2]) });
      if (Math.abs(p[1] - e.y) < 0.3) continue;
      e.node.position.set(p[0], p[1], p[2]);
      if (e.sceneId) fixes.push({ op: 'update', id: e.sceneId, patch: { transform: { position: p } } });
    }
    if (fixes.length && host && window.HawkesBuild && window.HawkesBuild.edit) setTimeout(() => { try { window.HawkesBuild.edit(fixes, { undo: false, label: 'landing' }); } catch (err) { H.report(err, 'arrive'); } }, 0);
  }
  /** Mayhem's spawnMany (for everyone: the host's copies fall for real, the others follow). Returns true when the
   *  arrival shows them (Mayhem skips its pop). */
  function spawned(out, d = {}) {
    const a = d.arrive && typeof d.arrive === 'object' ? d.arrive : { how: d.arrive };
    if (a.how === 'none' || d.v || (d.data && (d.data.grenade || d.data.sticky))) return false;
    const rain = d.o && d.o.pattern === 'rain';
    bring(out, { how: a.how || 'auto', delay: a.delay, gap: a.gap, lift: rain ? 0 : undefined });
    return true;
  }

  // ------------------------------------------------------------------ terrain growing (terrain.js moves the ground)
  const quakes = [];
  /** The ground is moving at `at` ([x, y, z]): a rumble, a shake, dust around the edge, rocks tumbling down, a wide
   *  beam. o: { radius, rise (meters, negative sinks), seconds }. Returns { end() }. */
  function quake(at, o = {}) {
    const R = Math.max(4, num(o.radius, 30)), rise = num(o.rise, 10), seconds = Math.max(0.5, num(o.seconds, FALL.terrainSeconds));
    const k = clamp(Math.abs(rise) / 50 + R / 300, 0.15, 1);
    const q = { at: at.slice(), R, rise, seconds, k, t: 0, dustT: 0, rockT: 0.8, rocks: [], ended: false, back: Boolean(o.back) };
    q.beam = o.back ? null : beamFor([at[0], at[1], at[2]], clamp(R * 0.3, 3, 40));
    if (H.overseer && H.overseer.flare && !o.back) H.overseer.flare(1);
    sfx.rumble(at, seconds, k);
    quakes.push(q);
    return { end: () => endQuake(q) };
  }
  function endQuake(q) {
    if (q.ended) return;
    q.ended = true;
    if (q.beam) { letGo(q.beam, true); q.beam = null; }
    shake(0.25 * q.k, q.at, q.R * 3);
  }
  function runQuakes(dt) {
    for (const q of [...quakes]) {
      q.t += dt;
      const live = !q.ended && q.t < q.seconds + 0.5;
      if (live) {
        // The shake builds and fades with the ground's speed (an ease in and out: strongest in the middle).
        const k = Math.sin(clamp(q.t / q.seconds, 0, 1) * Math.PI);
        // The beam stays on the ground as it moves (the ring rides the rising peak).
        if (q.beam && q.beam.b.alive && H.terrain && H.terrain.active) { const y = H.terrain.heightAt(q.at[0], q.at[2]); if (y !== null && y !== undefined) q.beam.b.move([q.at[0], y, q.at[2]]); }
        if ((q.shk = (q.shk || 0) + dt) > 0.12) { q.shk = 0; shake(0.05 + 0.18 * q.k * k, q.at, q.R * 3 + 40); }
        if ((q.dustT += dt) > (PHONE ? 0.45 : 0.22)) {
          q.dustT = 0;
          const a = Math.random() * Math.PI * 2, r = q.R * (0.45 + Math.random() * 0.5);
          const x = q.at[0] + Math.cos(a) * r, z = q.at[2] + Math.sin(a) * r;
          const y = H.terrain && H.terrain.active ? H.terrain.heightAt(x, z) : q.at[1];
          dust([x, (y ?? q.at[1]) + 0.2, z], 0.6 + q.k * 0.8, q.rise < 0 ? 'dirt' : 'stone');
        }
        if (q.rise > 6 && q.rocks.length < LIMITS.rocks && (q.rockT -= dt) <= 0) { q.rockT = q.seconds / (LIMITS.rocks + 1); rock(q); }
      }
      // Rocks go after a while; the quake is over when they're gone.
      for (const r of [...q.rocks]) if (!r.e.alive || (r.t += dt) > 5.5) { if (r.e.alive) r.e.destroy(); q.rocks.splice(q.rocks.indexOf(r), 1); }
      if (!live && !q.ended) endQuake(q);
      if (q.ended && !q.rocks.length) quakes.splice(quakes.indexOf(q), 1);
    }
  }
  /** A rock breaks off near the top and tumbles down the new slope (only here: cosmetic, never saved or sent). */
  function rock(q) {
    if (!H.fromSpec) return;
    const a = Math.random() * Math.PI * 2, r = q.R * (0.12 + Math.random() * 0.22);
    const x = q.at[0] + Math.cos(a) * r, z = q.at[2] + Math.sin(a) * r;
    const g = H.terrain && H.terrain.active ? H.terrain.heightAt(x, z) : q.at[1];
    const size = 0.35 + Math.random() * 0.5;
    let e;
    try {
      e = H.fromSpec({ type: 'sphere', name: 'Rock', shape: { radius: size }, material: { color: '#8a8378' }, physics: 'dynamic', body: { bounce: 0.25, friction: 0.7 }, transform: { position: [x, (g ?? q.at[1]) + size + 0.4, z], scale: [1.2, 0.85, 1] }, shadow: false });
    } catch { return; }
    e.temporary = true; e.grabbable = false; e.data.material = 'stone'; e.data.arrivalRock = true;
    e.velocity = [Math.cos(a) * 3, 1.5, Math.sin(a) * 3];
    q.rocks.push({ e, t: 0 });
  }

  // ------------------------------------------------------------------ worlds come and go: nothing is left behind
  function clear() {
    for (const rec of [...list]) { try { finish(rec); } catch { /* gone */ } }
    list.length = 0;
    for (const s of shared) if (s.b.alive) s.b.kill();
    shared = [];
    for (const q of quakes) for (const r of q.rocks) if (r.e.alive) r.e.destroy();
    quakes.length = 0;
    for (const r of rings.list) { r.on = false; try { r.mesh.dispose(); r.m.dispose(); } catch { /* gone */ } }
    rings.list = []; rings.scene = null;
  }
  H.hooks.world.push({ enter() { clear(); }, leave() { clear(); } });

  // Scripts: game.arrive(thing, 'drop') brings a thing you made in from the sky (and spawnMany's arrive option).
  H.hooks.game.push((game) => {
    game.arrive = (things, howTo = 'auto', o = {}) => bring(things, { ...(o || {}), how: howTo, exact: Boolean(o && o.exact) });
  });

  H.arrive = {
    HOWS, FALL, LIMITS,
    down, up, how, landing, plan, bring, ops, spawned, quake, clear,
    /** Arrivals going on now (things falling, growing, waiting their turn), and terrain moving. */
    get active() { return list.length; },
    get quakes() { return quakes.length; },
    get beams() { return shared.length; },
    /** The arrival of a thing now (or null): { kind, phase, exact, target }. */
    of(e) { const r = e && e._arrival; return r ? { kind: r.kind, phase: r.phase, exact: r.exact, target: r.target.slice() } : null; },
  };
})();
