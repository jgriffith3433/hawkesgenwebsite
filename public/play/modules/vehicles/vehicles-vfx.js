// Vehicles, part 5: what driving and flying leave on the world, by surface. Looks only, never forces.
//   4x4 (any wheeled vehicle): per-wheel emitters that switch with the ground under each tire, using the same surface
//   lookup the footsteps use (H.juiceMath.surfaceOf, the terrain's paint) and the water's height: pale dust on the
//   gravel road, heavy sand plumes and roostertails on the beach, grass and dirt bits on the meadow, white spray and a
//   wake in the shallows, and tire smoke in a drift on hard ground. Tracks on sand and grass (one ribbon mesh of quads,
//   a ring buffer, faded over 30 s, polygon offset so they never fight the ground). Headlights get a soft cone and a lens
//   flare, the tail lights glow brighter under the brakes.
//   Helicopter: a blur disc where the rotor is, and under 8 m a downwash ring that ripples over the ground and flattens
//   what is there (H.vehicles.vfx.washes() says where, for grass), grass bits flung outward, a spray disc over the sea,
//   dust when it lands.
//   H.vehicles.vfx.sample() is what the playtest reads (surface switches, effects, tracks, lights, wash). Phones: half the
//   particles, tracks capped at 200 segments, no cone (the lamp's real light stays).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const V = H.vehicles;
  const X = V._;
  const W = () => H.world;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

  // ------------------------------------------------------------------ the numbers (no engine in them)
  const EFFECT_OF = { road: 'dust', sand: 'sand', grass: 'grass', shallows: 'spray', hard: 'smoke' };
  const TRACK_LIFE = 30;
  const math = {
    clamp, smooth, EFFECT_OF, TRACK_LIFE,
    /** Which of the five grounds a tire is on: a wet tire (the water's surface above its contact) is the shallows;
     *  else the footsteps' surface: sand, grass, hard (stone, wood, metal, rock) or the road (dirt and anything else). */
    classify(surface, wet) {
      if (wet || surface === 'water') return 'shallows';
      if (surface === 'sand') return 'sand';
      if (surface === 'grass' || surface === 'snow') return surface === 'grass' ? 'grass' : 'road';
      if (surface === 'stone' || surface === 'wood' || surface === 'metal' || surface === 'rock') return 'hard';
      return 'road';
    },
    /** Particles a second from one tire: by surface, the speed, a slide and the throttle. Hard ground only smokes in a slide. */
    rate(ground, speed, o = {}) {
      if (speed < 2.5) return 0;
      const base = { road: 20, sand: 44, grass: 16, shallows: 58, hard: 0 }[ground] ?? 0;
      const v = clamp(speed / 20, 0.15, 1.25);
      if (ground === 'hard') return o.slip ? 34 * v : 0;
      return base * v * (1 + (o.slip ? 0.9 : 0) + (o.throttle ? 0.25 : 0));
    },
    /** The roostertail: the share of a sand tire's grains thrown up and back, more under power or in a slide. */
    tail(speed, o = {}) { return clamp(speed / 25, 0, 1) * (0.35 + (o.throttle ? 0.35 : 0) + (o.slip ? 0.3 : 0)); },
    /** A track's opacity at an age (s): full for 18 s, gone at 30. */
    trackAlpha(age, peak = 0.62) { return age >= TRACK_LIFE ? 0 : peak * clamp((TRACK_LIFE - age) / 12, 0, 1); },
    /** Tracks are left on soft ground only, and only while it rolls fast enough to print. */
    tracksOn(ground, speed) { return (ground === 'sand' || ground === 'grass') && speed > 1.2; },
    /** The most tracks (quads) kept: a phone 200, a tablet 400, a desktop 700. */
    trackCap(tier) { return tier === 'phone' ? 200 : tier === 'tablet' ? 400 : 700; },
    /** Particles' share: a phone half (whatever the level's own is, never more than half). */
    particleShare(tier, level) { return tier === 'phone' ? Math.min(0.5, level) : level; },
    /** The downwash under a helicopter: the ring's radius (m), its strength (0-1), 0 above 8 m or with the rotor slow. */
    wash(alt, spool, rotor = 3.8) {
      if (!(alt < 8) || spool < 0.25) return { radius: 0, strength: 0 };
      const k = clamp(1 - alt / 8, 0, 1);
      return { radius: rotor * 1.05 + alt * 0.85, strength: clamp(spool, 0, 1) * (0.25 + 0.75 * smooth(k)) };
    },
    /** The rotor's blur: how visible the disc is (the blades fade as it spools up). */
    blur(spool) { return spool < 0.08 ? 0 : clamp((spool - 0.08) / 0.5, 0, 1) * 0.3; },
    /** The headlight cone's opacity: lit lamps only, softer in the dark's start, none on a phone. */
    coneAlpha(on, day, tier) { return !on || tier === 'phone' ? 0 : 0.12 + 0.2 * clamp(1 - day, 0, 1); },
    /** Brakes: the pedal against the way it rolls, or the handbrake. */
    braking(input, fwdSpeed) { return Boolean(input && (input.brake || (input.y < -0.05 && fwdSpeed > 1) || (input.y > 0.05 && fwdSpeed < -1))); },
  };

  // ------------------------------------------------------------------ particles: one pooled system per kind, many emit points
  // Each system has a queue of where its next particles start and which way they go; the system takes from it as it makes them
  // (so four tires can each add their own in one frame).
  const KINDS = {
    dust: { cap: 200, c1: [0.78, 0.73, 0.64, 0.5], c2: [0.66, 0.62, 0.54, 0.34], size: [0.5, 1.3], life: [0.9, 1.7], power: [0.6, 1.8], gravity: 0.35, drag: true },
    sand: { cap: 260, c1: [0.94, 0.83, 0.58, 0.78], c2: [0.86, 0.73, 0.5, 0.55], size: [0.3, 0.95], life: [0.7, 1.4], power: [1.4, 4.2], gravity: -5.5, drag: true },
    grass: { cap: 160, c1: [0.34, 0.56, 0.2, 1], c2: [0.4, 0.3, 0.15, 1], size: [0.07, 0.17], life: [0.5, 1.05], power: [1.8, 4.6], gravity: -12 },
    spray: { cap: 280, c1: [0.95, 0.98, 1, 0.9], c2: [0.78, 0.9, 0.98, 0.6], size: [0.12, 0.34], life: [0.5, 1.1], power: [2.2, 5.6], gravity: -9 },
    smoke: { cap: 120, c1: [0.9, 0.9, 0.9, 0.5], c2: [0.72, 0.72, 0.74, 0.34], size: [0.5, 1.3], life: [0.8, 1.7], power: [0.3, 1], gravity: 0.5, drag: true },
  };
  const pools = new Map();
  let scene0 = null;
  const used = { dust: 0, sand: 0, grass: 0, spray: 0, smoke: 0 };
  function pool(kind) {
    const w = W();
    if (!w || !w.scene) return null;
    if (scene0 !== w.scene) { disposeAll(); scene0 = w.scene; }
    let p = pools.get(kind);
    if (p) return p;
    const k = KINDS[kind];
    const ps = new B.ParticleSystem(`vfx-${kind}`, k.cap, w.scene);
    ps.particleTexture = w.dot;
    ps.emitRate = 0;
    ps.minSize = k.size[0]; ps.maxSize = k.size[1];
    ps.minLifeTime = k.life[0]; ps.maxLifeTime = k.life[1];
    ps.minEmitPower = k.power[0]; ps.maxEmitPower = k.power[1];
    ps.gravity = new B.Vector3(0, k.gravity, 0);
    ps.color1 = new B.Color4(...k.c1); ps.color2 = new B.Color4(...k.c2); ps.colorDead = new B.Color4(k.c2[0], k.c2[1], k.c2[2], 0);
    ps.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
    ps.minAngularSpeed = -3; ps.maxAngularSpeed = 3;
    if (k.drag) { ps.addSizeGradient(0, 0.5); ps.addSizeGradient(1, 1.6); }
    ps.emitter = new B.Vector3(0, -1000, 0);
    ps.updateSpeed = 1 / 60;
    p = { ps, q: [], qi: 0 };
    ps.startPositionFunction = (wm, pos) => { const e = p.q[p.qi]; if (e) pos.copyFromFloats(e[0], e[1], e[2]); else pos.copyFromFloats(0, -1000, 0); };
    ps.startDirectionFunction = (wm, dir) => { const e = p.q[p.qi++]; if (e) dir.copyFromFloats(e[3], e[4], e[5]); else dir.copyFromFloats(0, 1, 0); if (p.qi >= p.q.length) { p.q.length = 0; p.qi = 0; } };
    ps.start();
    pools.set(kind, p);
    return p;
  }
  /** Adds n particles of a kind at a point, going the way `dir` points (its length is the speed). */
  function emit(kind, at, dir, n, spread = 0.5) {
    const p = pool(kind);
    if (!p || n <= 0) return 0;
    const room = KINDS[kind].cap * 0.9 - p.q.length;
    n = Math.min(n, room, 24);
    for (let i = 0; i < n; i++) {
      const r = () => (Math.random() - 0.5) * spread;
      p.q.push([at[0] + r() * 0.4, at[1], at[2] + r() * 0.4, dir[0] + r(), dir[1] + Math.random() * spread, dir[2] + r()]);
    }
    p.ps.manualEmitCount = (p.ps.manualEmitCount > 0 ? p.ps.manualEmitCount : 0) + n;
    used[kind] += n;
    return n;
  }

  // ------------------------------------------------------------------ tracks: one mesh, a ring of quads, each with its own age
  let tr = null;
  function tracks() {
    const w = W();
    if (!w || !w.scene) return null;
    if (tr && tr.scene === w.scene && tr.cap === math.trackCap(H.device && H.device.tier)) return tr;
    if (tr) { try { tr.mesh.dispose(); tr.mat.dispose(); } catch { /* gone */ } tr = null; }
    const cap = math.trackCap(H.device && H.device.tier);
    const pos = new Float32Array(cap * 12), col = new Float32Array(cap * 16), idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) { const a = i * 4; idx.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6); }
    const mesh = new B.Mesh('vfx-tracks', w.scene);
    const vd = new B.VertexData(); vd.positions = pos; vd.colors = col; vd.indices = idx;
    vd.normals = new Float32Array(cap * 12); for (let i = 1; i < vd.normals.length; i += 3) vd.normals[i] = 1;
    vd.applyToMesh(mesh, true);
    const mat = new B.StandardMaterial('vfx-tracks', w.scene);
    mat.diffuseColor = new B.Color3(1, 1, 1); mat.specularColor = new B.Color3(0, 0, 0); mat.backFaceCulling = false;
    mat.zOffset = -3; mat.zOffsetUnits = -3; mat.disableDepthWrite = true;
    mesh.material = mat; mesh.hasVertexAlpha = true; mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true; mesh.receiveShadows = false;
    mesh.metadata = { decor: true, noGlow: true };
    tr = { scene: w.scene, mesh, mat, cap, pos, col, born: new Float32Array(cap).fill(-1), tint: new Float32Array(cap * 3), at: 0, live: 0, written: 0, t: 0, dirty: true, frame: 0 };
    return tr;
  }
  const TINT = { sand: [0.42, 0.33, 0.2], grass: [0.16, 0.2, 0.07] };
  function addTrack(a, b, width, ground) {
    const T = tracks();
    if (!T) return;
    const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
    const px = (-dz / l) * width / 2, pz = (dx / l) * width / 2;
    const i = T.at; T.at = (T.at + 1) % T.cap;
    const lift = 0.04, o = i * 12;
    T.pos.set([a[0] - px, a[1] + lift, a[2] - pz, a[0] + px, a[1] + lift, a[2] + pz, b[0] - px, b[1] + lift, b[2] - pz, b[0] + px, b[1] + lift, b[2] + pz], o);
    if (T.born[i] < 0) T.live++;
    T.born[i] = T.t; T.written++;
    const tint = TINT[ground] || TINT.sand;
    T.tint.set(tint, i * 3);
    T.mesh.updateVerticesData(B.VertexBuffer.PositionKind, T.pos);
    T.dirty = true;
  }
  function ageTracks(dt) {
    const T = tr;
    if (!T) return;
    T.t += dt;
    if (!T.live || (++T.frame % 3)) return;
    let live = 0;
    for (let i = 0; i < T.cap; i++) {
      if (T.born[i] < 0) continue;
      const age = T.t - T.born[i], a = math.trackAlpha(age);
      if (a <= 0) { T.born[i] = -1; T.pos.fill(0, i * 12, i * 12 + 12); T.col.fill(0, i * 16, i * 16 + 16); T.dirty = 'p'; continue; }
      live++;
      for (let k = 0; k < 4; k++) { const c = i * 16 + k * 4; T.col[c] = T.tint[i * 3]; T.col[c + 1] = T.tint[i * 3 + 1]; T.col[c + 2] = T.tint[i * 3 + 2]; T.col[c + 3] = a; }
    }
    T.live = live;
    T.mesh.updateVerticesData(B.VertexBuffer.ColorKind, T.col);
    if (T.dirty === 'p') T.mesh.updateVerticesData(B.VertexBuffer.PositionKind, T.pos);
    T.dirty = false;
  }

  // ------------------------------------------------------------------ what each vehicle remembers
  const state = new WeakMap();
  const sense = { surface: null, effect: null, switches: [], emitted: used, wash: null, lights: null, rotorBlur: 0, tracksWritten: 0, hover: null };
  function st(v) {
    let s = state.get(v);
    if (!s) { s = { acc: {}, last: [], wet: 0, ground: null, since: 0, pend: null, pendT: 0, ripple: 0, lamps: null, brake: false, air: true, ringPhase: 0 }; state.set(v, s); }
    return s;
  }
  const level = () => { const j = H.juice; return j && j.allowed && j.allowed('particles') ? (j.budget ? j.budget.particles : 1) : 0; };
  const share = () => math.particleShare(H.device && H.device.tier, level());
  const surfaceAt = (g, at) => { try { return g ? H.juiceMath.surfaceOf(g, at) : H.terrain && H.terrain.materialAt ? (H.terrain.materialAt(at[0], at[2]) || 'dirt') : 'dirt'; } catch { return 'dirt'; } };
  const waterY = (x, z) => { try { return H.water && H.water.surfaceAt ? H.water.surfaceAt(x, z) : null; } catch { return null; } };
  const groundY = (x, z) => { try { return H.terrain && H.terrain.heightAt ? H.terrain.heightAt(x, z) : null; } catch { return null; } };
  const say = (name, data) => { try { if (window.game && window.game.emit) window.game.emit(name, data); } catch { /* none */ } };

  // ------------------------------------------------------------------ wheels
  function wheelPoint(w) { const n = w.tire || w.steerNode; n.computeWorldMatrix(true); const p = n.getAbsolutePosition(); return [p.x, p.y - (w.r || 0.35), p.z]; }
  function wheeled(v, e, dt, sh, mine) {
    const s = st(v), D = v.def;
    const speed = v.vel.length();
    const fwdSpeed = B.Vector3.Dot(v.vel, v.fwd), vlat = B.Vector3.Dot(v.vel, v.right);
    const throttle = Math.abs(v.throttleNow || 0) > 0.3;
    const grounds = {};
    let any = null;
    v.wheels.forEach((w, i) => {
      if (!w.contact) { s.last[i] = null; return; }
      const at = wheelPoint(w);
      const wy = waterY(at[0], at[2]);
      const wet = wy !== null && wy !== undefined && at[1] < wy + 0.12;
      const surface = wet ? 'water' : surfaceAt(w.ground, at);
      const ground = math.classify(surface, wet);
      grounds[ground] = (grounds[ground] || 0) + 1;
      any = any || ground;
      const slip = Boolean(w.slip);
      // Particles: a rate a second, carried between frames.
      if (sh > 0) {
        const kind = EFFECT_OF[ground];
        const rate = math.rate(ground, speed, { slip, throttle }) * sh;
        s.acc[i] = (s.acc[i] || 0) + rate * dt;
        const n = Math.floor(s.acc[i]);
        if (n > 0) {
          s.acc[i] -= n;
          const bx = speed > 0.5 ? -v.vel.x / speed : 0, bz = speed > 0.5 ? -v.vel.z / speed : 0;
          const side = (w.at && w.at[0] > 0 ? 1 : -1);
          const rx = v.right.x * side, rz = v.right.z * side;
          if (ground === 'sand') {
            const tail = w.rear ? Math.round(n * math.tail(speed, { throttle, slip })) : 0;
            emit('sand', at, [bx * 1.2 + rx * 0.6, 1.0, bz * 1.2 + rz * 0.6], n - tail, 0.7);
            if (tail) emit('sand', [at[0], at[1] + 0.15, at[2]], [bx * 2.6, 3.4 + speed * 0.07, bz * 2.6], tail, 0.5); // the roostertail
          } else if (ground === 'shallows') {
            emit('spray', [at[0], (wy ?? at[1]) + 0.05, at[2]], [bx * 0.8 + rx * 1.8, 2.2 + speed * 0.05, bz * 0.8 + rz * 1.8], n, 0.8);
          } else if (ground === 'grass') {
            emit('grass', at, [bx * 1.5 + rx * 0.5, 1.7, bz * 1.5 + rz * 0.5], n, 0.8);
            emit('dust', at, [bx * 0.5, 0.5, bz * 0.5], Math.ceil(n / 4), 0.4);
          } else if (ground === 'hard') emit('smoke', at, [bx * 0.7, 0.5, bz * 0.7], n, 0.4);
          else emit('dust', at, [bx * 0.8 + rx * 0.3, 0.7, bz * 0.8 + rz * 0.3], n, 0.5);
        }
      }
      // Tracks on soft ground: a quad from where this tire was.
      if (math.tracksOn(ground, speed)) {
        const last = s.last[i];
        if (!last) s.last[i] = at;
        else if (Math.hypot(at[0] - last[0], at[2] - last[2]) >= 0.45) { addTrack(last, at, Math.max(0.2, (w.w || 0.3) * 0.95), ground); s.last[i] = at; }
      } else s.last[i] = null;
    });
    // The wake: rings in the shallows.
    if (grounds.shallows && speed > 4 && H.water && H.water.ripple) {
      s.ripple -= dt;
      if (s.ripple <= 0) { s.ripple = 0.35; const p = e.node.position, wy = waterY(p.x, p.z); if (wy !== null && wy !== undefined) { try { H.water.ripple(p.x, p.z, clamp(speed / 12, 0.4, 1.4)); } catch { /* fine */ } } }
    }
    // The ground it is on now (most tires; steady for 0.15 s) and the switch is told.
    let top = null, n = 0;
    for (const k of Object.keys(grounds)) if (grounds[k] > n) { top = k; n = grounds[k]; }
    if (top && speed > 1) {
      if (top !== s.ground) {
        if (top !== s.pend) { s.pend = top; s.pendT = 0; }
        s.pendT += dt;
        if (s.pendT >= 0.15) {
          const from = s.ground; s.ground = top; s.pend = null;
          if (mine || !sense.surface) {
            sense.surface = top; sense.effect = EFFECT_OF[top];
            const rec = { t: Math.round(performance.now()), from, ground: top, effect: EFFECT_OF[top], speed: Math.round(speed * 10) / 10 };
            sense.switches.push(rec); if (sense.switches.length > 40) sense.switches.shift();
            say('vehicle-surface', { vehicle: e.name || D.title, ...rec });
          }
        }
      } else s.pend = null;
    }
    lamps(v, s, e, mine, fwdSpeed);
    void vlat; void any;
  }

  // ------------------------------------------------------------------ lights: a soft cone, a lens flare, brake lights
  let flareTex = null;
  function lamps(v, s, e, mine, fwdSpeed) {
    const D = v.def, w = W();
    if (!D.lamps || !w || !w.scene) return;
    const tier = H.device && H.device.tier;
    if (!s.lamps && v.lights) {
      const lp = D.lamps, sc = D.scale || 1, xs = lp.x ? [-lp.x, lp.x] : [0];
      const flares = [];
      const mk = (x, y, z, size, rgb) => {
        const m = B.MeshBuilder.CreatePlane('vfx-flare', { size }, w.scene);
        const mat = new B.StandardMaterial('vfx-flare', w.scene);
        mat.disableLighting = true; mat.emissiveColor = new B.Color3(...rgb); mat.diffuseColor = B.Color3.Black(); mat.specularColor = B.Color3.Black();
        if (!flareTex) { flareTex = w.dot; }
        mat.opacityTexture = flareTex; mat.alphaMode = B.Engine.ALPHA_ADD; mat.backFaceCulling = false; mat.disableDepthWrite = true;
        m.material = mat; m.billboardMode = B.Mesh.BILLBOARDMODE_ALL; m.parent = e.node; m.position.set(x * sc, y * sc, z * sc);
        m.isPickable = false; m.metadata = { decor: true, noGlow: false }; m.renderingGroupId = 0;
        return m;
      };
      for (const x of xs) flares.push(mk(x, lp.y, lp.front + 0.06, 1.1 * sc, [1, 0.93, 0.75]));
      const tails = xs.map((x) => mk(x, lp.y, lp.back - 0.06, 0.8 * sc, [1, 0.1, 0.06]));
      let cone = null;
      if (tier !== 'phone') {
        const len = 16 * sc, base = 7 * sc;
        const pivot = new B.TransformNode('vfx-cone', w.scene);
        pivot.parent = e.node; pivot.position.set(0, lp.y * sc, (lp.front + 0.1) * sc); pivot.rotation.x = 0.1;
        cone = B.MeshBuilder.CreateCylinder('vfx-cone', { diameterTop: 0.15, diameterBottom: base, height: len, tessellation: 20, cap: B.Mesh.NO_CAP }, w.scene);
        cone.parent = pivot; cone.rotation.x = -Math.PI / 2; cone.position.z = len / 2;
        const p = cone.getVerticesData(B.VertexBuffer.PositionKind), c = new Float32Array((p.length / 3) * 4);
        for (let i = 0; i < p.length / 3; i++) { const t = clamp((len / 2 - p[i * 3 + 1]) / len, 0, 1); c.set([1, 0.95, 0.8, Math.pow(1 - t, 1.6)], i * 4); }
        cone.setVerticesData(B.VertexBuffer.ColorKind, c);
        cone.hasVertexAlpha = true; cone.isPickable = false; cone.metadata = { decor: true, noGlow: true }; cone.receiveShadows = false;
        const mat = new B.StandardMaterial('vfx-cone', w.scene);
        mat.disableLighting = true; mat.emissiveColor = new B.Color3(1, 0.95, 0.8); mat.diffuseColor = B.Color3.Black(); mat.specularColor = B.Color3.Black();
        mat.alphaMode = B.Engine.ALPHA_ADD; mat.backFaceCulling = false; mat.disableDepthWrite = true;
        cone.material = mat; cone.pivot = pivot;
      }
      s.lamps = { flares, tails, cone };
    }
    const L = s.lamps;
    if (!L) return;
    const day = typeof H.sky.day === 'number' ? H.sky.day : 1;
    const alpha = math.coneAlpha(v.lights, day, tier);
    L.flares.forEach((m) => { m.setEnabled(Boolean(v.lights)); });
    if (L.cone) { L.cone.setEnabled(alpha > 0); L.cone.visibility = alpha / 0.32; }
    const brake = math.braking(v.cur, fwdSpeed);
    if (v.mats && v.mats.tail && brake !== s.brake) { s.brake = brake; v.mats.tail.emissiveColor = brake ? new B.Color3(1, 0.08, 0.05) : (v.lights ? new B.Color3(0.9, 0.05, 0.05) : new B.Color3(0.35, 0.02, 0.02)); }
    L.tails.forEach((m) => { m.setEnabled(brake || Boolean(v.lights)); m.visibility = brake ? 1 : 0.35; });
    if (mine) sense.lights = { on: Boolean(v.lights), cone: Boolean(L.cone && alpha > 0), flares: L.flares.length, brake, day: Math.round(day * 100) / 100, spot: Boolean(v.light) };
  }

  // ------------------------------------------------------------------ the helicopter: rotor blur, downwash, spray, landing dust
  const rings = new WeakMap();
  const washes = [];
  let ringTex = null, blurTex = null;
  function texOf(draw) {
    const w = W();
    const t = new B.DynamicTexture('vfx-tex', 128, w.scene, true);
    try { const c = t.getContext(); c.clearRect(0, 0, 128, 128); draw(c, 128); t.update(); } catch { /* no canvas */ }
    t.hasAlpha = true;
    return t;
  }
  function heli(v, e, dt, sh, mine, cam) {
    const w = W(), s = st(v), D = v.def, sc = D.scale || 1;
    const spool = clamp(v.spool || 0, 0, 1);
    // The rotor's blur: a soft disc where the blades turn.
    let h = rings.get(v);
    if (!h) {
      if (!blurTex) blurTex = texOf((c, n) => { const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(0.7, 'rgba(255,255,255,0.5)'); g.addColorStop(0.92, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, n, n); });
      if (!ringTex) ringTex = texOf((c, n) => { const g = c.createRadialGradient(n / 2, n / 2, n * 0.22, n / 2, n / 2, n / 2); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.62, 'rgba(255,255,255,0.75)'); g.addColorStop(0.8, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, n, n); });
      const disc = B.MeshBuilder.CreateDisc('vfx-rotor', { radius: 3.8, tessellation: 32 }, w.scene);
      const dm = new B.StandardMaterial('vfx-rotor', w.scene);
      dm.disableLighting = true; dm.emissiveColor = new B.Color3(0.85, 0.88, 0.92); dm.diffuseColor = B.Color3.Black(); dm.specularColor = B.Color3.Black();
      dm.opacityTexture = blurTex; dm.backFaceCulling = false; dm.disableDepthWrite = true;
      disc.material = dm; disc.parent = v.body; disc.position.set(0, 1.4, 0); disc.rotation.x = Math.PI / 2; disc.isPickable = false; disc.metadata = { decor: true, noGlow: true };
      const ring = B.MeshBuilder.CreateGround('vfx-wash', { width: 1, height: 1 }, w.scene);
      const rm = new B.StandardMaterial('vfx-wash', w.scene);
      rm.disableLighting = true; rm.diffuseColor = B.Color3.Black(); rm.specularColor = B.Color3.Black(); rm.emissiveColor = new B.Color3(1, 1, 1);
      rm.opacityTexture = ringTex; rm.backFaceCulling = false; rm.disableDepthWrite = true; rm.zOffset = -3; rm.zOffsetUnits = -3;
      ring.material = rm; ring.isPickable = false; ring.metadata = { decor: true, noGlow: true }; ring.setEnabled(false); ring.alwaysSelectAsActiveMesh = true;
      h = { disc, dm, ring, rm };
      rings.set(v, h);
    }
    const blur = math.blur(spool);
    h.disc.setEnabled(blur > 0); h.disc.visibility = blur;
    if (mine) sense.rotorBlur = blur;
    // The ground under it.
    const p = e.node.position, below = (D.size ? D.size[1] : 1.7) * 0.5 + 0.55 * sc;
    let gy = groundY(p.x, p.z), under = null;
    if ((gy === null || gy === undefined) && X.cast) { try { const hit = X.cast(v, p, new B.Vector3(0, -1, 0), 60); if (hit) { gy = hit.point.y; under = hit.entity; } } catch { /* no ground below */ } }
    const wy = waterY(p.x, p.z);
    const sea = wy !== null && wy !== undefined && (gy === null || gy === undefined || wy > gy);
    const floor = sea ? wy : (gy ?? null);
    if (floor === null) { h.ring.setEnabled(false); return; }
    const alt = Math.max(0, p.y - below - floor);
    const surface = sea ? 'water' : surfaceAt(under, [p.x, 0, p.z]);
    const ground = math.classify(surface, sea);
    const wash = math.wash(alt, spool, 3.8 * sc);
    s.ringPhase = (s.ringPhase + dt * 1.1) % 1;
    if (wash.strength > 0.02) {
      const r = wash.radius * (0.5 + 0.5 * s.ringPhase) * 2;
      h.ring.setEnabled(true);
      h.ring.position.set(p.x, floor + (sea ? 0.18 : 0.07), p.z);
      h.ring.scaling.set(r, 1, r);
      h.ring.visibility = wash.strength * (1 - s.ringPhase) * 0.8;
      const tint = ground === 'shallows' ? [0.95, 1, 1] : ground === 'grass' ? [0.62, 0.85, 0.45] : ground === 'sand' ? [0.95, 0.85, 0.62] : [0.82, 0.78, 0.7];
      h.rm.emissiveColor.set(tint[0], tint[1], tint[2]);
      if (mine || !sense.wash || !sense.wash.mine) sense.wash = { mine, ground, surface: ground === 'shallows' ? 'sea' : ground, alt: Math.round(alt * 10) / 10, radius: Math.round(wash.radius * 10) / 10, strength: Math.round(wash.strength * 100) / 100, ring: true, spray: ground === 'shallows' };
      washes.push({ x: p.x, z: p.z, radius: wash.radius, strength: wash.strength, alt, ground });
      // Things thrown outward from the ring's edge.
      if (sh > 0) {
        const kind = ground === 'shallows' ? 'spray' : ground === 'grass' ? 'grass' : ground === 'sand' ? 'sand' : 'dust';
        s.acc.w = (s.acc.w || 0) + (kind === 'spray' ? 70 : 38) * wash.strength * sh * dt;
        const n = Math.floor(s.acc.w);
        if (n > 0) {
          s.acc.w -= n;
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, rr = wash.radius * (0.35 + Math.random() * 0.55);
            emit(kind, [p.x + Math.cos(a) * rr, floor + (sea ? 0.2 : 0.15), p.z + Math.sin(a) * rr], [Math.cos(a) * (2.2 + wash.strength * 2.5), 0.8 + Math.random() * 1.2, Math.sin(a) * (2.2 + wash.strength * 2.5)], 1, 0.5);
          }
        }
      }
    } else { h.ring.setEnabled(false); if (mine && sense.wash && sense.wash.mine !== false && sense.wash.ring) sense.wash = { ...sense.wash, ring: false, spray: false }; }
    // Landing: the dust the rotor throws as it settles.
    if (sh > 0 && alt < 0.6 && spool > 0.3 && s.air && v.vel.length() < 8) {
      s.air = false;
      emit(ground === 'sand' ? 'sand' : ground === 'shallows' ? 'spray' : 'dust', [p.x, floor + 0.2, p.z], [0, 0.8, 0], Math.round(24 * sh), 1.4);
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; emit(ground === 'sand' ? 'sand' : ground === 'shallows' ? 'spray' : 'dust', [p.x + Math.cos(a) * 1.6, floor + 0.2, p.z + Math.sin(a) * 1.6], [Math.cos(a) * 3.2, 0.5, Math.sin(a) * 3.2], Math.ceil(2 * sh), 0.4); }
      sense.landingDust = (sense.landingDust || 0) + 1;
      say('rotor-landing-dust', { ground, alt });
    }
    if (alt > 1.2) s.air = true;
    void cam;
  }

  // ------------------------------------------------------------------ every frame
  H.hooks.frame.push((dt) => {
    const w = W();
    if (!w || !w.scene || !(dt > 0) || !V.list) return;
    try {
      washes.length = 0;
      const cam = w.scene.activeCamera, me = V.current ? V.current.vehicle : null;
      const sh = share();
      for (const e of V.list()) {
        const v = e.vehicle;
        if (!v || !e.alive || !v.vel || !v.wheels) continue;
        const D = v.def, mine = v === me;
        if (cam && B.Vector3.Distance(cam.position, e.node.position) > 90) continue;
        const run = Boolean(v.seats && v.seats[0] && v.seats[0].who) || Boolean(v.autopilot) || (v.vel.length() > 0.8);
        if (D.class === 'wheeled' && !v.sleeping && run) wheeled(v, e, dt, sh, mine);
        else if (D.class === 'heli' && (v.spool > 0.02 || rings.has(v))) heli(v, e, dt, sh, mine, cam);
      }
      ageTracks(dt);
      sense.tracksWritten = tr ? tr.written : 0;
    } catch (err) { H.report(err, 'vehicles vfx'); }
  });
  function disposeAll() {
    for (const p of pools.values()) try { p.ps.dispose(); } catch { /* gone */ }
    pools.clear();
    if (tr) { try { tr.mesh.dispose(); tr.mat.dispose(); } catch { /* gone */ } tr = null; }
    flareTex = ringTex = blurTex = null;
  }
  H.hooks.world.push({ enter() { sense.switches = []; sense.surface = sense.effect = null; sense.wash = null; sense.landingDust = 0; for (const k of Object.keys(used)) used[k] = 0; }, leave() { disposeAll(); scene0 = null; } });

  V.vfx = {
    math, handles: true,
    /** Where a helicopter's downwash is pressing the ground this frame: [{ x, z, radius, strength, alt, ground }] (for grass that bends). */
    washes: () => washes.slice(),
    /** For playtests and the console: the surface the local vehicle is on, every switch, particles made by effect, tracks, lights, the wash. */
    sample() {
      return { ...sense, switches: sense.switches.slice(), emitted: { ...used }, tracks: tr ? { live: tr.live, cap: tr.cap, written: tr.written } : { live: 0, cap: math.trackCap(H.device && H.device.tier), written: 0 }, share: share() };
    },
  };
  void X; void smooth;
})();
