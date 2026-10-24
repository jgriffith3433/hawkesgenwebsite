// A bucket of water dumped on someone, and being wet.
//   game.water.dump(target, { volume })   a blob of water falls on a thing, a player (by name) or a point: it splashes,
//                                          knocks people over, soaks them (drips) and puts out fire (the 'extinguish' event)
//   the 'bucket' tool                      click (phones: the 💧 button) to throw the water where you look; it refills
//   game.water.wet(thing, seconds)         wet: drips (and, for you, drops on the screen); isWet, dry
// Online: the host decides once what a dump pushes around (H.sync.action); every player knocks over and soaks
// themselves, so nobody waits for the network to get splashed.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const W = () => H.world;
  const G = () => H.game;
  const X = H.water._;
  const clamp = X.clamp;
  const PHONE = X.PHONE;

  // ------------------------------------------------------------------ wet things
  const wets = new Map(); // entity -> { until, ps, at, world }
  function screenWet(on) {
    X.overlay();
    let el = document.getElementById('water-wet');
    if (!el) { el = document.createElement('div'); el.id = 'water-wet'; document.body.appendChild(el); }
    el.classList.toggle('on', Boolean(on));
  }
  /** Makes a thing (or a player) wet for `seconds`: it drips, and anything burning on it goes out. */
  function wet(e, seconds = 12) {
    const w = W();
    if (!w || !e || !e.__entity || !e.alive || e.kind === 'water' || (e.data && e.data.waterPart)) return;
    const until = w.time + Math.max(0.5, Number(seconds) || 12);
    let s = wets.get(e);
    if (s && s.world === w) { s.until = Math.max(s.until, until); return; }
    if (wets.size >= (PHONE ? 8 : 24)) { const [old, os] = wets.entries().next().value; stopDrip(old, os); }
    s = { until, world: w, at: new B.Vector3(e.x, e.y, e.z) };
    wets.set(e, s);
    e.data.wet = true;
    if (!(e.isPlayer && e._view === 'first')) {
      const ps = new B.ParticleSystem('drips', PHONE ? 20 : 40, w.scene);
      ps.particleTexture = w.dot;
      ps.emitter = s.at;
      ps.minEmitBox = new B.Vector3(-e.half[0] * 0.8, -e.half[1] * 0.5, -e.half[2] * 0.8);
      ps.maxEmitBox = new B.Vector3(e.half[0] * 0.8, e.half[1] * 0.3, e.half[2] * 0.8);
      ps.color1 = new B.Color4(0.75, 0.9, 1, 0.9); ps.color2 = new B.Color4(0.55, 0.8, 1, 0.8); ps.colorDead = new B.Color4(0.6, 0.85, 1, 0);
      ps.minSize = 0.04; ps.maxSize = 0.08; ps.minLifeTime = 0.35; ps.maxLifeTime = 0.6;
      ps.emitRate = 14; ps.direction1 = new B.Vector3(0, -1, 0); ps.direction2 = new B.Vector3(0, -1, 0);
      ps.minEmitPower = 0.2; ps.maxEmitPower = 0.6; ps.gravity = new B.Vector3(0, -14, 0);
      ps.start();
      s.ps = ps;
    }
    if (e === w.player) { screenWet(true); setTimeout(() => screenWet(false), 1600); }
    G().emit('wet', { entity: e, seconds });
    G().emit('extinguish', { at: [e.x, e.y, e.z], radius: Math.max(e.half[0], e.half[2]) + 0.3, entity: e, by: 'wet' });
  }
  function stopDrip(e, s) { wets.delete(e); if (s.ps) { s.ps.stop(); const ps = s.ps; setTimeout(() => ps.dispose(), 800); } if (e.alive && e.data) e.data.wet = false; }
  const isWet = (e) => { const s = wets.get(e); return Boolean(s && W() && s.world === W() && s.until > W().time); };
  const dry = (e) => { const s = wets.get(e); if (s) stopDrip(e, s); };
  H.hooks.frame.push(() => {
    const w = W();
    for (const [e, s] of wets) {
      if (s.world !== w || !e.alive || !w || s.until <= w.time) { stopDrip(e, s); continue; }
      s.at.set(e.x + e.offset[0], e.y + e.offset[1], e.z + e.offset[2]);
      if (s.ps) s.ps.emitRate = 14 * clamp((s.until - w.time) / 4, 0.2, 1);
    }
  });

  // ------------------------------------------------------------------ the falling water
  const blobs = [];
  const puddles = [];
  function blobMesh(r) {
    const sc = W().scene;
    const m = B.MeshBuilder.CreateSphere('water-blob', { diameter: r * 2, segments: PHONE ? 8 : 14 }, sc);
    const mat = new B.StandardMaterial('water-blob', sc);
    mat.diffuseColor = new B.Color3(0.35, 0.7, 0.95); mat.emissiveColor = new B.Color3(0.08, 0.22, 0.32);
    mat.specularColor = new B.Color3(0.9, 0.9, 0.9); mat.specularPower = 64; mat.alpha = 0.62;
    m.material = mat; m.isPickable = false; m.metadata = { decor: true, noGlow: true };
    return m;
  }
  function people() {
    const w = W(), out = [];
    for (const e of w.entities) if (e.alive && (e.isPlayer || e.remotePlayer || e.kind === 'capsule' || (e.data && (e.data.creature || e.data.npc)))) out.push(e);
    return out;
  }
  function runDump(d, authoritative) {
    const w = W();
    if (!w) return;
    const v = clamp(Number(d.v) || 1, 0.2, 200);
    const r = 0.25 + Math.cbrt(v) * 0.35;
    const at = L.vec(d.at);
    const m = blobMesh(r);
    m.position.set(at[0], at[1], at[2]);
    const vel = new B.Vector3(...L.vec(d.vel));
    blobs.push({ m, r, v, pos: m.position, vel, thrown: vel.length() > 2, t: 0, world: w, authoritative, by: d.by || null });
    if (vel.length() > 2) H.water.sound('cast', { at, volume: 0.5 });
  }
  const dumpAction = H.sync ? H.sync.action('water:dump', (d, o) => runDump(d, o.authoritative)) : (d) => runDump(d, true);

  H.hooks.step.push((dt) => {
    const w = W();
    for (let i = blobs.length - 1; i >= 0; i--) {
      const b = blobs[i];
      if (b.world !== w || b.m.isDisposed()) { b.m.dispose(); blobs.splice(i, 1); continue; }
      b.t += dt;
      b.vel.y += (w.config.gravity ?? -24) * 0.8 * dt;
      const step = b.vel.scale(dt);
      const len = step.length();
      // A wobbling blob.
      const k = Math.sin(b.t * 18) * 0.12;
      b.m.scaling.set(1 + k, 1 - k + Math.min(0.4, -b.vel.y * 0.015), 1 + k);
      let hitAt = null, hitThing = null;
      if (len > 0) {
        const ray = G().raycast([b.pos.x, b.pos.y, b.pos.z], [step.x, step.y, step.z], len + b.r * 0.6, { ignore: b });
        if (ray && ray.entity && ray.entity.kind !== 'water') { hitAt = ray.point; hitThing = ray.entity; }
      }
      if (!hitAt) for (const e of H.physics.overlap(H.physics.shapes.sphere(b.r * 0.9), [b.pos.x, b.pos.y, b.pos.z], { all: true })) {
        if (b.thrown && b.t < 0.3 && (e.isPlayer || e.remotePlayer)) continue;
        if (!e.alive || e.kind === 'water' || e.kind === 'light' || e.kind === 'text' || e.kind === 'waypoint' || (e.physics === 'none' && !e.isPlayer && !e.remotePlayer) || e.physics === 'trigger') continue;
        hitAt = [b.pos.x, b.pos.y - b.r * 0.5, b.pos.z]; hitThing = e; break;
      }
      const s = H.water.surfaceAt(b.pos.x, b.pos.z, b.pos.y);
      if (!hitAt && s !== null && b.pos.y - b.r < s) { hitAt = [b.pos.x, s, b.pos.z]; hitThing = 'water'; }
      if (!hitAt && (b.pos.y < w.catchY || b.t > 8)) { b.m.dispose(); blobs.splice(i, 1); continue; }
      if (hitAt) { blobs.splice(i, 1); b.m.dispose(); land(b, hitAt, hitThing); continue; }
      b.pos.addInPlace(step);
      if (Math.random() < 0.3) G().burst([b.pos.x, b.pos.y + b.r, b.pos.z], { color: '#bfe8ff', count: 2, speed: 0.6, size: 0.08, life: 0.4 });
    }
  });

  function puddle(at, r) {
    const w = W();
    if (puddles.length > 10) { const p = puddles.shift(); p.m.dispose(); }
    const below = G().raycast([at[0], at[1] + 0.5, at[2]], [0, -1, 0], 3, { ignore: {} });
    if (!below) return;
    const m = B.MeshBuilder.CreateDisc('puddle', { radius: r, tessellation: 24 }, w.scene);
    const mat = new B.StandardMaterial('puddle', w.scene);
    mat.diffuseColor = new B.Color3(0.2, 0.35, 0.45); mat.specularColor = new B.Color3(1, 1, 1); mat.specularPower = 128; mat.alpha = 0.55;
    m.material = mat; m.isPickable = false; m.metadata = { decor: true, noGlow: true };
    m.rotation.x = Math.PI / 2;
    m.position.set(below.point[0], below.point[1] + 0.015, below.point[2]);
    puddles.push({ m, mat, t: 0, world: w });
  }
  H.hooks.frame.push((dt) => {
    for (let i = puddles.length - 1; i >= 0; i--) {
      const p = puddles[i];
      p.t += dt;
      if (p.world !== W() || p.t > 9) { p.m.dispose(); puddles.splice(i, 1); continue; }
      if (p.t > 5) p.mat.alpha = 0.55 * (1 - (p.t - 5) / 4);
    }
  });

  /** Where the water lands: a splash; people near it are knocked over and soaked; loose things are pushed (by the
   *  host); fire goes out. */
  function land(b, at, what) {
    const w = W(), g = G();
    const size = clamp(0.6 + Math.cbrt(b.v) * 0.7, 0.5, 4);
    const R = 1.2 + Math.cbrt(b.v) * 1.1;
    H.water.splash(at, size);
    if (what !== 'water') puddle(at, Math.min(6, R * 0.8));
    const touched = [];
    // People: you knock yourself over (every player does it for themselves); everyone sees everyone soaked.
    for (const e of people()) {
      const dx = e.x - at[0], dz = e.z - at[2], dy = e.y - at[1];
      const dist = Math.hypot(dx, dz);
      if (dist > R + e.half[0] || dy < -R - 1 || dy > R + 1.5) continue;
      touched.push(e);
      wet(e, 10 + Math.cbrt(b.v) * 4);
      if (e === w.player) knockDown(e, dx, dz, dist, b.v, R);
    }
    // Things: the host pushes them (their new places are sent to everyone).
    for (const e of H.physics.overlap(H.physics.shapes.sphere(R), at, { all: true })) {
      if (!e.alive || e.isPlayer || e.remotePlayer || e.kind === 'water' || (e.data && e.data.waterPart)) continue;
      if (!touched.includes(e)) touched.push(e);
      if (e.physics === 'dynamic') {
        wet(e, 8);
        if (b.authoritative && !e.remote && !e.held) {
          const dx = e.x - at[0], dz = e.z - at[2], l = Math.hypot(dx, dz) || 1;
          const k = (1 - Math.min(1, l / R)) * (2 + Math.cbrt(b.v) * 2.5);
          if (H.sync && H.sync.claim && !H.sync.mine(e)) H.sync.claim(e);
          e.impulse([(dx / l) * k * e.mass, -k * 0.2 * e.mass, (dz / l) * k * e.mass]);
        }
      }
    }
    g.emit('extinguish', { at, radius: R, by: 'bucket', entities: touched });
    g.emit('splash', { at, size, radius: R, entities: touched, bucket: true });
    g.emit('soaked', { at, radius: R, entities: touched, volume: b.v, by: b.by });
  }

  function knockDown(p, dx, dz, dist, v, R) {
    const g = G();
    const l = dist || 1;
    const k = (1 - Math.min(1, dist / (R + 0.5))) * (3 + Math.cbrt(v) * 2.5);
    p.vx = (dx / l) * k; p.vz = (dz / l) * k; p.vy = Math.min(p.vy, -2);
    const hard = v >= 0.6;
    g.camera.shake(0.12 + Math.min(0.4, v * 0.03), 0.35);
    g.ui.message(v >= 8 ? 'SOAKED!' : 'Splash!', 1.1);
    if (!hard || !p.controls) return;
    // Knocked over: a moment without control (and, seen from outside, lying down).
    p.controls = false;
    const lie = p._view !== 'first';
    if (lie) p.node.rotation.z = (dx >= 0 ? -1 : 1) * 1.2;
    const world = W();
    g.after(0.6 + Math.min(1.2, Math.cbrt(v) * 0.3), () => {
      if (W() !== world || !p.alive) return;
      p.controls = world.config.controls !== false;
      if (lie) p.node.rotation.z = 0;
    });
    g.emit('knocked', { entity: p, by: 'water' });
  }

  /** Dumps water on a thing, a player (a name: "Sam") or a point: it falls from above (opts.height meters over them,
   *  or from `at` with opts.velocity when thrown). volume: 1 is a bucket, 10 a bathtub, 50 a water tower. */
  function dump(target, o = {}) {
    const g = G();
    if (!g) return null;
    let t = target, at;
    if (typeof t === 'string') {
      const name = t.toLowerCase();
      t = g.find(target) || (g.net.players.find((p) => String(p.name || '').toLowerCase() === name) || {}).entity || [...W().entities].find((e) => String(e.name || '').toLowerCase() === name) || null;
      if (!t && g.player && /^(me|myself|you|player)$/i.test(target)) t = g.player;
      if (!t) { H.report(new Error(`game.water.dump: nobody called "${target}" here`), 'water'); return null; }
    }
    if (t === undefined || t === null) t = g.player;
    const v = clamp(Number(o.volume) || 1, 0.2, 200);
    const r = 0.25 + Math.cbrt(v) * 0.35;
    if (t && t.__entity) at = [t.x, t.bottom + t.size[1] + Number(o.height ?? 2 + r * 2), t.z];
    else { const p = L.vec(t); at = o.velocity ? p : [p[0], p[1] + Number(o.height ?? 4 + r * 2), p[2]]; }
    if (o.at) at = L.vec(o.at);
    const data = { at: at.map((x) => Math.round(x * 100) / 100), v, vel: o.velocity ? L.vec(o.velocity) : [0, -1, 0], by: (H.sync && H.sync.me) || null };
    dumpAction(data);
    return data;
  }

  // ------------------------------------------------------------------ the bucket (a tool)
  function bucketMesh(state) {
    const sc = W().scene;
    const root = new B.TransformNode('bucket', sc);
    const metal = new B.StandardMaterial('bucket', sc);
    metal.diffuseColor = new B.Color3(0.62, 0.66, 0.7); metal.specularColor = new B.Color3(0.6, 0.6, 0.6);
    const part = (m, mat) => { m.material = mat; m.parent = root; m.isPickable = false; m.metadata = { decor: true }; m.renderingGroupId = 1; return m; };
    part(B.MeshBuilder.CreateCylinder('bucket-body', { diameterTop: 0.34, diameterBottom: 0.26, height: 0.32, tessellation: 18, cap: B.Mesh.CAP_START }, sc), metal);
    const handle = part(B.MeshBuilder.CreateTorus('bucket-handle', { diameter: 0.34, thickness: 0.015, tessellation: 20 }, sc), metal);
    handle.rotation.z = Math.PI / 2; handle.position.y = 0.16; handle.scaling.set(1, 1, 1);
    const wm = new B.StandardMaterial('bucket-water', sc);
    wm.diffuseColor = new B.Color3(0.25, 0.6, 0.9); wm.emissiveColor = new B.Color3(0.05, 0.2, 0.3); wm.alpha = 0.85;
    const water = part(B.MeshBuilder.CreateDisc('bucket-water', { radius: 0.155, tessellation: 18 }, sc), wm);
    water.rotation.x = Math.PI / 2; water.position.y = 0.11;
    state.waterDisc = water;
    // A model by name ("bucket") takes over when the game has one.
    const asset = modelNamed('bucket');
    if (asset) B.SceneLoader.ImportMeshAsync('', '', L.assetUrl(asset), sc, null, '.glb').then((r) => {
      if (root.isDisposed()) { for (const m of r.meshes) m.dispose(); return; }
      for (const c of root.getChildMeshes()) if (c !== water) c.setEnabled(false);
      const holder = new B.TransformNode('bucket-model', sc); holder.parent = root;
      for (const m of r.meshes) { if (!m.parent) m.parent = holder; m.isPickable = false; m.metadata = { decor: true }; m.renderingGroupId = 1; }
      const { min, max } = holder.getHierarchyBoundingVectors(true);
      const s = 0.34 / Math.max(0.01, max.y - min.y);
      holder.scaling.setAll(s); holder.position.y = -0.16 - min.y * s;
    }).catch(() => {});
    return root;
  }
  /** The game's model for a word ("bucket", "fishing rod", "trout"): an asset id or name (H.assets), or null. */
  function modelNamed(word, seed) {
    return H.assets.pick(String(word).replace(/-/g, ' '), { kind: 'model', seed });
  }
  function useButton(state, icon, label) {
    if (!H.touchUi) return;
    const pad = document.getElementById('touch');
    if (!pad) return;
    const b = document.createElement('button');
    b.className = 'tb water-tb water-use';
    b.setAttribute('aria-label', label);
    b.textContent = icon;
    pad.appendChild(b);
    H.bindTouchKey(b, 'wateruse');
    state.button = b;
  }
  /** Did the player use the tool this step: a click in the game (captured mouse, phones, or a free-mouse game), or the
   *  phone's use button. `held` asks whether it is held down instead. */
  function using(held = false) {
    const i = H.input, w = W();
    const free = w && w.player && w.player.mouse === 'free';
    const mouseOk = i.mouse.locked || i.touchUi || free || document.body.classList.contains('soft-control');
    if (held) return (i.mouse.down && mouseOk && !i.touchUi) || i.held.has('wateruse');
    return (i.mouse.pressed && mouseOk && !i.touchUi) || G().input.pressed('wateruse');
  }

  H.tools.register('bucket', {
    title: 'Bucket of water',
    kind: 'tool',
    equip(ctx) {
      const s = ctx.state;
      s.full = true; s.refill = 0; s.tip = 0;
      s.volume = clamp(Number(ctx.opts.volume) || 1, 0.2, 50);
      s.mesh = bucketMesh(s);
      useButton(s, '💧', 'Throw water');
    },
    unequip(ctx) { const s = ctx.state; if (s.mesh) s.mesh.dispose(); if (s.button) s.button.remove(); G().ui.remove('water-bucket'); },
    step(dt, ctx) {
      const s = ctx.state, p = ctx.player, g = ctx.game;
      if (!p || !p.alive || W().paused) return;
      if (!s.full && (ctx.opts.refill || 'auto') === 'auto') { s.refill += dt; if (s.refill > 1.2) { s.full = true; H.water.sound('plop', { volume: 0.4 }); } }
      if (!using()) return;
      if (s.full) {
        // Throw it where you look: the water flies in an arc and lands on whatever is there.
        const cam = W().scene.activeCamera;
        const f = cam.getDirection(B.Axis.Z);
        const from = cam.globalPosition.add(f.scale(0.9)).add(new B.Vector3(0, -0.2, 0));
        const speed = Number(ctx.opts.speed) || 11;
        dump([from.x, from.y, from.z], { volume: s.volume, velocity: [f.x * speed + p.vx * 0.5, f.y * speed + 2.5, f.z * speed + p.vz * 0.5], at: [from.x, from.y, from.z] });
        s.full = false; s.refill = 0; s.tip = 1;
        g.emit('bucket', { entity: p, volume: s.volume });
      } else {
        // Empty: dip it in water you're in or looking at.
        const aim = g.aim(5);
        const wet = H.water.inWater([p.x, p.bottom + 0.3, p.z]) || (aim && aim.entity && aim.entity.kind === 'water') || (aim && H.water.surfaceAt(aim.point[0], aim.point[2], aim.point[1] - 0.2) !== null && aim.point[1] <= (H.water.surfaceAt(aim.point[0], aim.point[2]) ?? -Infinity) + 0.3);
        if (wet) { s.full = true; H.water.sound('plop', { volume: 0.6 }); if (aim) H.water.splash(aim.point, 0.3, { sound: false }); }
        else g.ui.message('Fill it in the water', 1);
      }
    },
    frame(dt, ctx) {
      const s = ctx.state, w = W();
      if (!s.mesh || !w) return;
      s.mesh.parent = w.scene.activeCamera;
      s.mesh.setEnabled(w.player && w.player._view === 'first');
      s.tip = Math.max(0, s.tip - dt * 2.5);
      s.mesh.position.set(0.32, -0.32 + s.tip * 0.15, 0.62);
      s.mesh.rotation.set(-s.tip * 1.6, 0.25, 0.1 - s.tip * 0.3);
      s.waterDisc.setEnabled(s.full);
      if (!s.full && (ctx.opts.refill || 'auto') !== 'auto') G().ui.text('water-bucket', 'Empty: dip the bucket in water', { x: 'center', y: 'bottom', size: 15 });
      else G().ui.remove('water-bucket');
    },
  });

  Object.assign(H.water, { dump, wet, isWet, dry, _bucket: { using, useButton, modelNamed } });
})();
