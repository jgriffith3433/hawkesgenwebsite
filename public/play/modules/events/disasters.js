// Events, part 2: disasters, as built-in presets on the same actions. Each runs on every player's screen from the same
// seed (so the tornado takes the same path everywhere); the lasting parts (explosions, spawning zombies, digging) are
// the host's, and each player's machine pushes the things it simulates and its own player. Every one stops by itself
// after `seconds` and cleans up after itself (meshes, particles, lights, fog, the dark, the sea level).
//
//   { "disaster": "tornado", "seconds": 30 }       or the short form   { "tornado": { "seconds": 30, "strength": 1.5 } }
//   tornado, meteor-shower (meteors), flood, earthquake, zombie-night (zombies), blizzard, volcano
//   { "stop": "tornado" }  /  { "stop": "all" }
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const E = H.events;
  const W = () => H.world;
  const G = () => H.game;
  const { num, lower } = E;
  const ALIASES = { meteors: 'meteor-shower', 'meteor-storm': 'meteor-shower', meteor: 'meteor-shower', zombies: 'zombie-night', 'zombie-attack': 'zombie-night', quake: 'earthquake', snowstorm: 'blizzard', 'snow-storm': 'blizzard', eruption: 'volcano', twister: 'tornado', tsunami: 'flood' };
  const DEFS = new Map();

  // ------------------------------------------------------------------ the parts every disaster uses
  function mat(name, color, alpha = 1, glow = 0) {
    const m = new B.StandardMaterial(`ev-${name}`, W().scene);
    const c = B.Color3.FromHexString(color);
    m.diffuseColor = c;
    m.emissiveColor = c.scale(glow);
    m.specularColor = new B.Color3(0, 0, 0);
    m.alpha = alpha;
    if (glow > 0.5) m.disableLighting = true;
    return m;
  }
  function particles(h, n, o = {}) {
    const sc = W().scene;
    const ps = new B.ParticleSystem(`ev-${h.name}`, n, sc);
    ps.particleTexture = W().dot;
    const c1 = B.Color3.FromHexString(o.color || '#cccccc'), c2 = B.Color3.FromHexString(o.color2 || o.color || '#999999');
    ps.color1 = new B.Color4(c1.r, c1.g, c1.b, o.alpha ?? 0.8); ps.color2 = new B.Color4(c2.r, c2.g, c2.b, (o.alpha ?? 0.8) * 0.8); ps.colorDead = new B.Color4(c2.r, c2.g, c2.b, 0);
    ps.minSize = o.min ?? 0.3; ps.maxSize = o.max ?? 1;
    ps.minLifeTime = o.life0 ?? 0.6; ps.maxLifeTime = o.life ?? 1.6;
    ps.emitRate = o.rate ?? n;
    ps.minEmitPower = o.power0 ?? 0.5; ps.maxEmitPower = o.power ?? 2;
    ps.gravity = new B.Vector3(0, o.gravity ?? 0, 0);
    ps.direction1 = new B.Vector3(...(o.dir1 || [-1, 1, -1])); ps.direction2 = new B.Vector3(...(o.dir2 || [1, 2, 1]));
    ps.minEmitBox = new B.Vector3(...(o.box0 || [-0.5, 0, -0.5])); ps.maxEmitBox = new B.Vector3(...(o.box1 || [0.5, 0, 0.5]));
    ps.blendMode = o.add ? B.ParticleSystem.BLENDMODE_ADD : B.ParticleSystem.BLENDMODE_STANDARD;
    if (o.emitter) ps.emitter = o.emitter;
    ps.start();
    h.systems.push(ps);
    return ps;
  }
  /** Things this player's machine moves: its own dynamic things (online: the ones it simulates). */
  function pushables(at, radius) {
    const out = [];
    for (const e of W().entities) {
      if (!e.alive || e.physics !== 'dynamic' || e.isPlayer || e.held || e.remote) continue;
      if (H.sync && H.sync.online && !H.sync.mine(e)) continue;
      const d = Math.hypot(e.x - at[0], e.z - at[2]);
      if (d < radius) out.push([e, d]);
    }
    return out;
  }
  function shake(strength, seconds) { try { G().camera.shake(strength, seconds); } catch { /* no camera */ } }
  /** An explosion decided by the host (Mayhem's when there is one: fire, smoke, craters; else the engine's). */
  function boom(at, o) {
    if (!E.net.host) return;
    if (H.mayhem && H.mayhem.explode) { H.mayhem.explode(at, { radius: o.radius, force: o.force, damage: o.damage, fire: o.fire }); return; }
    if (H.sync && H.sync.explode) H.sync.explode(at, { radius: o.radius, force: o.force });
    if (H.physics && H.physics.explode) H.physics.explode(at, { radius: o.radius, damage: o.damage, force: 0 });
  }

  /** Starts a disaster on this screen. Returns its handle ({ name, stop() }), or null. */
  function disaster(name, o = {}, ctx = {}) {
    const s = E.state;
    if (!s) return null;
    const n = ALIASES[lower(name)] || lower(name);
    const def = DEFS.get(n);
    if (!def) { E.report(new Error(`events: no disaster "${name}" (${[...DEFS.keys()].join(', ')})`)); return null; }
    if (!o.stack) for (const d of s.disasters.filter((x) => x.name === n)) d.stop(true);
    const seed = num(o._seed ?? ctx.seed, Math.floor(Math.random() * 1e9));
    const h = {
      name: n, o, ctx: { who: ctx.who || E.meWho(), data: ctx.data || null }, t: 0, dur: Math.max(1, num(o.seconds, def.seconds || 30)),
      strength: Math.max(0.1, num(o.strength, 1)), rand: E.rng(seed), seed, meshes: [], systems: [], lights: [], ends: [], stopped: false,
      at: E.posOf(o.at ?? 'player', ctx) || [0, 0, 0],
    };
    h.mesh = (m) => { m.isPickable = false; m.metadata = { decor: true, noGlow: true }; h.meshes.push(m); return m; };
    h.stop = (quiet) => {
      if (h.stopped) return;
      h.stopped = true;
      for (const f of h.ends) try { f(Boolean(quiet)); } catch (err) { E.report(err, `disaster ${n}`); }
      for (const ps of h.systems) try { ps.stop(); ps.dispose(); } catch { /* gone */ }
      for (const l of h.lights) try { l.dispose(); } catch { /* gone */ }
      for (const m of h.meshes) try { if (m.material) m.material.dispose(); m.dispose(); } catch { /* gone */ }
      h.systems = []; h.lights = []; h.meshes = [];
      const st = E.state;
      if (st) st.disasters = st.disasters.filter((x) => x !== h);
      if (!quiet && G()) G().emit('disaster', { name: n, state: 'end' });
    };
    h.step = (dt) => {
      if (h.stopped) return;
      h.t += dt;
      def.step(h, dt);
      if (!h.stopped && h.t >= h.dur + (h.tail || 0)) h.stop();
    };
    s.disasters.push(h);
    try { def.start(h); } catch (err) { E.report(err, `disaster ${n}`); h.stop(true); return null; }
    if (G()) G().emit('disaster', { name: n, state: 'start', at: h.at });
    return h;
  }
  function stopDisaster(name) {
    const s = E.state;
    if (!s) return 0;
    const n = name === undefined || name === true || lower(name) === 'all' ? null : ALIASES[lower(name)] || lower(name);
    const list = s.disasters.filter((d) => !n || d.name === n);
    for (const d of list) d.stop();
    return list.length;
  }
  E.disaster = disaster;
  E.stopDisaster = stopDisaster;
  E.disasters = () => [...DEFS.keys()];
  E.defineDisaster = (name, def) => { DEFS.set(lower(name), def); defineShort(lower(name)); };

  // ------------------------------------------------------------------ tornado: a funnel that wanders, lifts and spins
  DEFS.set('tornado', {
    seconds: 30,
    start(h) {
      const o = h.o, sc = W().scene;
      h.radius = num(o.radius, 7) * Math.sqrt(h.strength);
      h.height = num(o.height, 28);
      h.speed = num(o.speed, 3);
      h.pos = [h.at[0] + (h.o._auto_at ? 14 : 0), h.at[1], h.at[2] + (h.o._auto_at ? 14 : 0)];
      h.home = h.pos.slice();
      h.heading = h.rand() * Math.PI * 2;
      h.root = h.mesh(new B.TransformNode('ev-tornado', sc));
      const m = mat('tornado', o.color || '#8d939c', 0.42);
      m.backFaceCulling = false;
      h.rings = [];
      for (let i = 0; i < 9; i++) {
        const y0 = (i / 9) * h.height, y1 = ((i + 1) / 9) * h.height;
        const rb = h.radius * (0.16 + (i / 9) ** 1.6 * 0.95), rt = h.radius * (0.16 + ((i + 1) / 9) ** 1.6 * 0.95);
        const c = h.mesh(B.MeshBuilder.CreateCylinder(`ev-tornado-${i}`, { diameterBottom: rb * 2, diameterTop: rt * 2, height: y1 - y0, tessellation: 18, cap: B.Mesh.NO_CAP }, sc));
        c.material = m; c.parent = h.root; c.position.y = (y0 + y1) / 2;
        h.rings.push(c);
      }
      h.dust = particles(h, 260, { color: '#9a8b78', color2: '#6b6258', min: 0.6, max: 1.8, life: 1.4, rate: 160, power0: 2, power: 6, dir1: [-1, 0.3, -1], dir2: [1, 1.2, 1], box0: [-h.radius * 0.6, 0, -h.radius * 0.6], box1: [h.radius * 0.6, 0.5, h.radius * 0.6], alpha: 0.55 });
      h.dust.emitter = new B.Vector3(...h.pos);
      // Debris spinning round it.
      const dm = mat('tornado-debris', '#5b4a3a');
      h.debris = [];
      for (let i = 0; i < 14; i++) { const b = h.mesh(B.MeshBuilder.CreateBox(`ev-debris-${i}`, { size: 0.3 + h.rand() * 0.5 }, sc)); b.material = dm; h.debris.push({ m: b, a: h.rand() * 6.28, y: h.rand() * h.height * 0.8, r: 0.4 + h.rand() * 0.7, w: 2 + h.rand() * 2 }); }
      E.tone([[70, 0, 3, 'sawtooth'], [85, 0.2, 3, 'sawtooth']], { volume: 0.05 });
      h.fade = 0;
    },
    step(h, dt) {
      // Wander (the same everywhere: the seed), never far from where it started.
      h.heading += (h.rand() - 0.5) * 1.6 * dt;
      const away = Math.hypot(h.pos[0] - h.home[0], h.pos[2] - h.home[2]);
      if (away > num(h.o.range, 35)) h.heading = Math.atan2(h.home[0] - h.pos[0], h.home[2] - h.pos[2]);
      h.pos[0] += Math.sin(h.heading) * h.speed * dt;
      h.pos[2] += Math.cos(h.heading) * h.speed * dt;
      h.pos[1] = E.groundY(h.pos[0], h.pos[2], h.pos[1] + 20);
      const k = Math.min(1, h.t / 2) * Math.min(1, Math.max(0, (h.dur - h.t) / 2));
      h.root.position.set(h.pos[0], h.pos[1], h.pos[2]);
      h.root.rotation.y += dt * 4;
      h.root.scaling.set(Math.max(0.05, k), Math.max(0.05, k), Math.max(0.05, k));
      h.rings.forEach((c, i) => { c.position.x = Math.sin(h.t * 1.7 + i * 0.7) * 0.35 * i * 0.25; c.position.z = Math.cos(h.t * 1.3 + i * 0.6) * 0.35 * i * 0.25; });
      h.dust.emitter = new B.Vector3(h.pos[0], h.pos[1], h.pos[2]);
      for (const d of h.debris) { d.a += d.w * dt; d.y = (d.y + dt * 3) % (h.height * 0.85); const r = h.radius * (0.2 + (d.y / h.height) ** 1.6) * d.r * 1.3 * k; d.m.position.set(h.pos[0] + Math.sin(d.a) * r, h.pos[1] + d.y, h.pos[2] + Math.cos(d.a) * r); d.m.rotation.x += dt * 5; d.m.rotation.y += dt * 3; }
      // Lift and spin what's near (what this machine simulates), and its own player.
      const R = h.radius * 1.7, s = h.strength * k;
      for (const [e, d] of pushables(h.pos, R)) {
        const dx = e.x - h.pos[0], dz = e.z - h.pos[2], l = Math.hypot(dx, dz) || 1, near = 1 - d / R;
        const tan = [-dz / l, dx / l], inw = [-dx / l, -dz / l];
        const lift = e.y - h.pos[1] < h.height * 0.7 ? 30 * near : -4;
        const m = Math.max(0.6, Math.min(4, Math.sqrt(e.mass || 1)));
        e.push([(tan[0] * 22 * near + inw[0] * 9 * near) * s * dt / m * 2, lift * s * dt / m * 1.6, (tan[1] * 22 * near + inw[1] * 9 * near) * s * dt / m * 2]);
        if (e.vy > 14) e.vy = 14;
        e.angularVelocity = [180 * near, 240 * near, 120 * near];
        if (H.mayhem && H.mayhem.tumble && e.living && near > 0.4 && !e._evTumble) { e._evTumble = true; try { H.mayhem.tumble(e, 1); } catch { /* fine */ } }
      }
      const p = W().player;
      if (p && p.alive) {
        const dx = p.x - h.pos[0], dz = p.z - h.pos[2], d = Math.hypot(dx, dz);
        if (d < R) { const near = 1 - d / R, l = d || 1; p.push([(-dz / l * 14 - dx / l * 4) * near * s * dt, (p.y - h.pos[1] < h.height * 0.5 ? 26 : 0) * near * s * dt, (dx / l * 14 - dz / l * 4) * near * s * dt]); if (p.vy > 11) p.vy = 11; }
      }
    },
  });

  // ------------------------------------------------------------------ meteor shower: fireballs from the sky, each a blast
  DEFS.set('meteor-shower', {
    seconds: 30,
    start(h) {
      h.area = num(h.o.area, 35);
      h.every = Math.max(0.15, num(h.o.every, 0.8) / h.strength);
      h.next = 0.5;
      h.rocks = [];
      h.m = mat('meteor', h.o.color || '#ff7a1a', 1, 1);
      h.tail = 3;
      E.tone([[300, 0, 2, 'sawtooth']], { volume: 0.03, slide: 0.3 });
    },
    step(h, dt) {
      const sc = W().scene;
      if (h.t < h.dur && h.t >= h.next) {
        h.next += h.every * (0.6 + h.rand() * 0.8);
        const a = h.rand() * Math.PI * 2, d = Math.sqrt(h.rand()) * h.area;
        const x = h.at[0] + Math.sin(a) * d, z = h.at[2] + Math.cos(a) * d;
        const to = [x, E.groundY(x, z, h.at[1] + 40), z];
        const from = [x - 25 + h.rand() * 10, to[1] + 70, z - 20 + h.rand() * 10];
        const size = (0.5 + h.rand() * 0.8) * Math.sqrt(h.strength);
        const m = h.mesh(B.MeshBuilder.CreateSphere('ev-meteor', { diameter: size * 1.4, segments: 8 }, sc));
        m.material = h.m; m.position.set(...from);
        const trail = particles(h, 120, { color: '#ffcf5a', color2: '#ff4a1a', min: 0.4 * size, max: 1.2 * size, life0: 0.2, life: 0.6, rate: 140, power0: 0, power: 0.6, add: true, emitter: m });
        h.rocks.push({ m, trail, from, to, t: 0, dur: 1.4 + h.rand() * 0.5, size });
      }
      for (const r of h.rocks) {
        if (r.done) continue;
        r.t += dt;
        const k = Math.min(1, r.t / r.dur);
        r.m.position.set(r.from[0] + (r.to[0] - r.from[0]) * k, r.from[1] + (r.to[1] - r.from[1]) * k, r.from[2] + (r.to[2] - r.from[2]) * k);
        if (k >= 1) {
          r.done = true;
          r.m.setEnabled(false); r.trail.stop();
          const radius = num(h.o.radius, 4) * r.size;
          boom(r.to, { radius, force: num(h.o.force, 16), damage: num(h.o.damage, 30), fire: h.o.fire !== false });
          if (!(H.mayhem && H.mayhem.explode)) { try { G().burst([r.to[0], r.to[1] + 0.5, r.to[2]], { color: '#ff9a3a', count: 40, speed: 7, size: 0.4 }); } catch { /* fine */ } }
          const p = W().player;
          if (p && Math.hypot(p.x - r.to[0], p.z - r.to[2]) < 30) shake(0.25 * r.size, 0.3);
        }
      }
    },
  });

  // ------------------------------------------------------------------ flood: the sea rises, stays a while, goes down
  DEFS.set('flood', {
    seconds: 45,
    start(h) {
      const Wt = H.water;
      if (!Wt || !Wt.rise || !H.features.get('water')) { E.report(new Error('a flood needs the Water module')); h.dur = 1; return; }
      if (!Wt.sea) E.setFeature('water', { level: num(h.o.from, -4), waves: num(h.o.waves, 0.3) });
      h.from = Wt.level;
      const ground = E.groundY(h.at[0], h.at[2], h.at[1] + 30);
      h.to = h.o.level !== undefined ? num(h.o.level, 2) : Math.max(h.from + 2, ground + num(h.o.depth, 2.5) * h.strength);
      h.rise = Math.max(1, num(h.o.rise, 12));
      Wt.rise(h.to, h.rise);
      h.ends.push((quiet) => { if (h.o.recede === false || quiet) return; if (H.water && H.water.sea) H.water.rise(h.from, Math.max(2, num(h.o.recede, h.rise))); });
      if (h.o.storm) { h.hadWeather = W().features && W().features.get('weather') ? clone(W().features.get('weather').value) : null; E.setFeature('weather', 'storm'); h.ends.push((quiet) => { if (!quiet) E.setFeature('weather', h.hadWeather); }); }
      E.tone([[60, 0, 4, 'sawtooth']], { volume: 0.04, slide: 1.4 });
    },
    step() {},
  });
  const clone = (v) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

  // ------------------------------------------------------------------ earthquake: shaking, things thrown about, cracks
  DEFS.set('earthquake', {
    seconds: 8,
    start(h) {
      h.radius = num(h.o.radius, 70);
      h.tick = 0;
      E.tone([[40, 0, Math.min(6, h.dur), 'sawtooth'], [47, 0.1, Math.min(6, h.dur), 'sawtooth']], { volume: 0.14 });
      if (E.net.host && H.living && H.living.startle) try { H.living.startle(h.at, { radius: h.radius, strength: 1 }); } catch { /* fine */ }
      // Cracks in the ground (terrain), the host's (shared).
      const T = H.terrain;
      if (E.net.host && h.o.cracks !== false && T && T.active !== false && T.lower) {
        const a = h.rand() * Math.PI;
        for (let i = -3; i <= 3; i++) try { T.lower(h.at[0] + Math.sin(a) * i * 4 + 6, h.at[2] + Math.cos(a) * i * 4 + 6, 2.2, 0.8 * h.strength, { share: true }); } catch { /* fine */ }
      }
    },
    step(h, dt) {
      h.tick -= dt;
      if (h.tick > 0) return;
      h.tick = 0.25;
      const fade = Math.min(1, (h.dur - h.t) / 2);
      const p = W().player;
      const s = h.strength * fade;
      if (p && p.alive && Math.hypot(p.x - h.at[0], p.z - h.at[2]) < h.radius) { shake(0.35 * s, 0.3); if (p.grounded !== false && Math.random() < 0.4) p.push([(Math.random() - 0.5) * 3 * s, 2.5 * s, (Math.random() - 0.5) * 3 * s]); }
      for (const [e] of pushables(h.at, h.radius)) {
        const m = Math.max(0.5, Math.sqrt(e.mass || 1));
        e.push([(Math.random() - 0.5) * 5 * s / m, (2 + Math.random() * 3) * s / m, (Math.random() - 0.5) * 5 * s / m]);
        if (Math.random() < 0.3) e.angularVelocity = [(Math.random() - 0.5) * 200, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 200];
      }
    },
  });

  // ------------------------------------------------------------------ zombie night: dark, and the dead walk until dawn
  DEFS.set('zombie-night', {
    seconds: 90,
    start(h) {
      const s = E.state;
      h.count = Math.max(1, Math.floor(num(h.o.count, 10) * h.strength));
      h.waves = Math.max(1, Math.floor(num(h.o.waves, 3)));
      h.made = 0; h.wave = 0; h.nextWave = 0.5;
      h.tag = h.o.tag || 'zombie-night';
      if (s.clock) { h.hour = s.clock.hour; if (!(s.clock.hour >= 20 || s.clock.hour < 5)) { s.clock.hour = 21.5; s.clock.jumped = true; } }
      E.setDark(num(h.o.dark, 0.8), 3);
      if (h.o.timer !== false) { s.timers = s.timers.filter((t) => t.label !== 'Dawn in'); s.timers.push({ label: h.o.label || 'Dawn in', end: W().time + h.dur }); }
      if (h.o.message !== false) E.banner(h.o.title || 'Zombie night', h.o.sub || 'Survive until dawn', 3.5, 'lose');
      E.tone([[98, 0, 1.6, 'sawtooth'], [92, 0.3, 1.6, 'sawtooth'], [73, 0.8, 2, 'sawtooth']], { volume: 0.08 });
      h.ends.push((quiet) => {
        E.setDark(0, 3);
        const st = E.state;
        if (st) st.timers = st.timers.filter((t) => t.label !== (h.o.label || 'Dawn in'));
        if (quiet) return;
        if (st && st.clock && h.o.dawn !== false) { st.clock.hour = 6; st.clock.jumped = true; }
        if (h.o.message !== false) E.banner(h.o.dawnText || 'Dawn!', h.o.dawnSub || 'The dead crumble in the light', 3, 'win');
        // At dawn they burn and crumble (the host removes them for everyone).
        if (E.net.host) {
          for (const z of E.things(h.tag)) if (H.mayhem && H.mayhem.ignite) try { H.mayhem.ignite(z, { seconds: 2 }); } catch { /* fine */ }
          G().after(1.4, () => { if (E.state) E.perform({ remove: h.tag }, h.ctx); });
        }
      });
    },
    step(h) {
      if (!E.net.host || h.wave >= h.waves || h.t < h.nextWave) return;
      h.wave++;
      h.nextWave = h.t + Math.max(4, (h.dur * 0.5) / h.waves);
      const per = Math.ceil((h.count - h.made) / (h.waves - h.wave + 1));
      if (per <= 0) return;
      // Around each player, out of the light: 18 to 28 meters away, a few groups.
      const players = E.playersAll().filter((p) => p.e);
      const targets = players.length ? players : [{ e: null }];
      for (const pl of targets) {
        const c = pl.e ? [pl.e.x, pl.e.y, pl.e.z] : h.at;
        const groups = Math.min(per, 3);
        for (let g = 0; g < groups; g++) {
          const a = h.rand() * Math.PI * 2, d = 18 + h.rand() * 10;
          const x = c[0] + Math.sin(a) * d, z = c[2] + Math.cos(a) * d;
          const n = Math.ceil(per / groups / targets.length) || 1;
          E.perform({ spawn: h.o.what || 'zombie', count: n, at: [x, E.groundY(x, z, c[1] + 20), z], area: 3, tag: h.tag, effects: false }, h.ctx);
          h.made += n;
        }
      }
    },
  });

  // ------------------------------------------------------------------ blizzard: snow, white-out, wind
  DEFS.set('blizzard', {
    seconds: 40,
    start(h) {
      const sc = W().scene;
      h.wind = Array.isArray(h.o.wind) ? [num(h.o.wind[0], 4), num(h.o.wind[1], 1)] : [4 * h.strength, 1.2 * h.strength];
      h.fog = { mode: sc.fogMode, color: sc.fogColor ? sc.fogColor.clone() : null, start: sc.fogStart, end: sc.fogEnd, density: sc.fogDensity };
      sc.fogMode = B.Scene.FOGMODE_LINEAR;
      sc.fogColor = new B.Color3(0.86, 0.9, 0.95);
      h.fogEnd = Math.max(25, 90 / h.strength);
      sc.fogStart = 2; sc.fogEnd = 400;
      h.snow = particles(h, 1600, { color: '#ffffff', color2: '#e8f1ff', min: 0.06, max: 0.16, life0: 2.5, life: 4, rate: 520 * h.strength, power0: 0.5, power: 1.2, gravity: -3, dir1: [h.wind[0] * 0.3 - 0.2, -1, h.wind[1] * 0.3 - 0.2], dir2: [h.wind[0] * 0.3 + 0.2, -1, h.wind[1] * 0.3 + 0.2], box0: [-22, 10, -22], box1: [22, 14, 22], alpha: 0.95 });
      h.snow.emitter = new B.Vector3(0, 0, 0);
      E.setDark(0.3 * Math.min(1.5, h.strength), 3);
      const p = W().player;
      if (p && typeof p.speed === 'number') { h.speed = p.speed; p.speed = p.speed * 0.75; }
      const s = E.state;
      h.weather = s.weather;
      s.weather = 'snow';
      E.tone([[200, 0, 3, 'sawtooth']], { volume: 0.025, slide: 1.8 });
      h.ends.push(() => {
        const sc2 = W() && W().scene;
        if (sc2) { sc2.fogMode = h.fog.mode; if (h.fog.color) sc2.fogColor = h.fog.color; sc2.fogStart = h.fog.start; sc2.fogEnd = h.fog.end; sc2.fogDensity = h.fog.density; }
        E.setDark(0, 3);
        const pl = W() && W().player;
        if (pl && h.speed !== undefined) pl.speed = h.speed;
        if (E.state) E.state.weather = h.weather || null;
      });
    },
    step(h, dt) {
      const sc = W().scene, cam = sc.activeCamera;
      const k = Math.min(1, h.t / 4) * Math.min(1, Math.max(0, (h.dur - h.t) / 3));
      sc.fogEnd = 400 + (h.fogEnd - 400) * k;
      if (cam) h.snow.emitter = new B.Vector3(cam.position.x, cam.position.y, cam.position.z);
      h.snow.emitRate = 520 * h.strength * Math.max(0.05, k);
      const p = W().player;
      if (p && p.alive) p.push([h.wind[0] * 0.4 * k * dt, 0, h.wind[1] * 0.4 * k * dt]);
      for (const [e] of pushables(p ? [p.x, 0, p.z] : [0, 0, 0], 40)) if ((e.mass || 1) < 5) e.push([h.wind[0] * 0.6 * k * dt, 0, h.wind[1] * 0.6 * k * dt]);
    },
  });

  // ------------------------------------------------------------------ volcano: a mountain that rumbles and throws lava
  DEFS.set('volcano', {
    seconds: 40,
    start(h) {
      const sc = W().scene;
      const o = h.o;
      h.height = num(o.height, 16) * Math.sqrt(h.strength);
      h.radius = num(o.radius, 14);
      if (o._auto_at) { h.at = [h.at[0], h.at[1], h.at[2] + num(o.ahead, 32)]; h.at[1] = E.groundY(h.at[0], h.at[2], h.at[1] + 40); }
      const T = H.terrain;
      h.base = E.groundY(h.at[0], h.at[2], h.at[1] + 60);
      if (T && T.active !== false && T.raise) {
        if (E.net.host) { try { T.raise(h.at[0], h.at[2], h.radius, h.height, { share: true }); if (T.crater) T.crater(h.at[0], h.at[2], h.radius * 0.22, h.height * 0.15, { share: true }); } catch (err) { E.report(err, 'volcano'); } }
        h.top = h.base + h.height;
      } else {
        // No terrain: a cone of rock (the same on every screen), gone when it's over unless keep: true.
        const cone = G().cone({ x: h.at[0], y: h.base + h.height / 2, z: h.at[2], radius: h.radius, height: h.height, color: '#4a3b35', physics: 'static', name: 'Volcano', tag: 'volcano' });
        cone.keep = true;
        h.cone = cone;
        h.top = h.base + h.height;
        if (!o.keep) h.ends.push(() => { if (cone.alive) cone.destroy(); });
      }
      const lava = h.mesh(B.MeshBuilder.CreateDisc('ev-lava', { radius: Math.max(1.2, h.radius * 0.16), tessellation: 24 }, sc));
      lava.rotation.x = Math.PI / 2; lava.position.set(h.at[0], h.top + 0.15, h.at[2]);
      lava.material = mat('lava', '#ff5a14', 1, 1);
      h.light = new B.PointLight('ev-volcano-light', new B.Vector3(h.at[0], h.top + 3, h.at[2]), sc);
      h.light.diffuse = new B.Color3(1, 0.45, 0.15); h.light.range = 60; h.light.intensity = 1.6;
      h.lights.push(h.light);
      h.smoke = particles(h, 300, { color: '#4a4440', color2: '#2a2725', min: 2, max: 5, life0: 3, life: 6, rate: 40, power0: 2, power: 4, dir1: [-0.4, 2, -0.4], dir2: [0.6, 3, 0.4], box0: [-1, 0, -1], box1: [1, 0.5, 1], alpha: 0.6 });
      h.smoke.emitter = new B.Vector3(h.at[0], h.top + 1, h.at[2]);
      h.sparks = particles(h, 200, { color: '#ffd04a', color2: '#ff3a0a', min: 0.2, max: 0.6, life0: 0.6, life: 1.4, rate: 60, power0: 6, power: 12, gravity: -14, dir1: [-0.5, 2, -0.5], dir2: [0.5, 3, 0.5], add: true });
      h.sparks.emitter = new B.Vector3(h.at[0], h.top + 0.5, h.at[2]);
      h.bombs = [];
      h.every = Math.max(0.25, num(o.every, 0.9) / h.strength);
      h.next = 1.5;
      h.bombMat = mat('lava-bomb', '#ff6a1a', 1, 1);
      h.tail = 4;
      shake(0.5, 1.2);
      E.tone([[45, 0, 3, 'sawtooth'], [38, 0.2, 3.5, 'sawtooth']], { volume: 0.14 });
    },
    step(h, dt) {
      const sc = W().scene;
      h.light.intensity = 1.3 + Math.sin(h.t * 9) * 0.3 + Math.random() * 0.2;
      if (h.t < h.dur && h.t >= h.next) {
        h.next += h.every * (0.5 + h.rand());
        const a = h.rand() * Math.PI * 2, d = h.radius * 0.8 + h.rand() * num(h.o.reach, 26);
        const to = [h.at[0] + Math.sin(a) * d, 0, h.at[2] + Math.cos(a) * d];
        to[1] = E.groundY(to[0], to[2], h.top + 10);
        const m = h.mesh(B.MeshBuilder.CreateSphere('ev-lava-bomb', { diameter: 0.9, segments: 8 }, sc));
        m.material = h.bombMat;
        const trail = particles(h, 80, { color: '#ffb02a', color2: '#7a2a0a', min: 0.3, max: 0.8, life0: 0.3, life: 0.8, rate: 70, power0: 0, power: 0.5, add: true, emitter: m });
        const from = [h.at[0], h.top + 0.5, h.at[2]];
        h.bombs.push({ m, trail, from, to, t: 0, dur: 1.6 + h.rand() * 0.8, arc: 10 + h.rand() * 12 });
      }
      for (const b of h.bombs) {
        if (b.done) continue;
        b.t += dt;
        const k = Math.min(1, b.t / b.dur);
        b.m.position.set(b.from[0] + (b.to[0] - b.from[0]) * k, b.from[1] + (b.to[1] - b.from[1]) * k + Math.sin(k * Math.PI) * b.arc, b.from[2] + (b.to[2] - b.from[2]) * k);
        if (k >= 1) {
          b.done = true; b.m.setEnabled(false); b.trail.stop();
          boom(b.to, { radius: num(h.o.blast, 3), force: 12, damage: num(h.o.damage, 25), fire: true });
          if (!(H.mayhem && H.mayhem.explode)) try { G().burst([b.to[0], b.to[1] + 0.4, b.to[2]], { color: '#ff7a1a', count: 24, speed: 5 }); } catch { /* fine */ }
        }
      }
      if (h.t > h.dur) { h.smoke.emitRate = Math.max(0, h.smoke.emitRate - dt * 20); h.sparks.emitRate = 0; }
    },
  });

  // ------------------------------------------------------------------ the actions
  E.defineAction('disaster', { scope: 'all', at: ['at'], defaults: { at: 'player' }, run(a, ctx) { disaster(a.disaster, a, ctx); } });
  E.defineAction('stop', { scope: 'all', run(a) { stopDisaster(a.stop); } });
  function defineShort(n) {
    E.defineAction(n, {
      scope: 'all', at: ['at'], defaults: { at: 'player' },
      run(a, ctx) { const extra = a[n] && typeof a[n] === 'object' ? a[n] : {}; disaster(n, { ...a, ...extra, at: extra.at ?? a.at, _auto_at: extra.at === undefined && a._auto_at }, ctx); },
    });
  }
  for (const n of DEFS.keys()) defineShort(n);
  for (const n of Object.keys(ALIASES)) if (!DEFS.has(n)) E.defineAction(n, { scope: 'all', at: ['at'], defaults: { at: 'player' }, run(a, ctx) { const extra = a[n] && typeof a[n] === 'object' ? a[n] : {}; disaster(ALIASES[n], { ...a, ...extra, at: extra.at ?? a.at, _auto_at: extra.at === undefined && a._auto_at }, ctx); } });
})();
