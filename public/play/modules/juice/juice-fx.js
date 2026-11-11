// Juice: particles and marks. Dust when things land and skid, sparks when metal hits, splinters from wood, chips of
// glass and stone, splashes (the water module's), scorch marks under blasts, tire marks from skids and footprints in
// sand and snow. All pooled (a few particle systems per kind, reused; marks are thin instances of one mesh per kind in
// a ring), with budgets that follow the juice level (phones get fewer).
//   H.juice.fx.burst(kind, at, { count, speed, color, dir })   kind: dust, sparks, splinters, chips, glass, spray
//   H.juice.fx.decal(kind, at, { size, yaw, normal, life })    kind: scorch, tire, print
//   H.juice.fx.dust(at, { amount, surface })  H.juice.fx.footprint(surface, entity, side)
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const M = H.juiceMath;
  const J = H.juice;
  const W = () => H.world;
  const clamp = M.clamp;
  const camPos = () => { const w = W(); const c = w && w.scene && w.scene.activeCamera; return c ? c.globalPosition || c.position : null; };

  // ------------------------------------------------------------------ particles: a small pool of systems per kind
  const KINDS = {
    dust: { cap: 70, c1: [0.62, 0.55, 0.45, 0.55], c2: [0.5, 0.45, 0.38, 0.4], size: [0.25, 0.7], life: [0.5, 1.2], power: [0.6, 2.2], gravity: -0.6, blend: 'std', drag: 0.9 },
    sparks: { cap: 90, c1: [1, 0.85, 0.4, 1], c2: [1, 0.55, 0.15, 1], size: [0.04, 0.09], life: [0.15, 0.45], power: [3, 9], gravity: -14, blend: 'add', drag: 0.1 },
    splinters: { cap: 60, c1: [0.62, 0.43, 0.24, 1], c2: [0.48, 0.32, 0.18, 1], size: [0.06, 0.15], life: [0.5, 1.1], power: [2, 6], gravity: -12, blend: 'std', drag: 0.2 },
    chips: { cap: 60, c1: [0.6, 0.6, 0.6, 1], c2: [0.45, 0.45, 0.47, 1], size: [0.05, 0.12], life: [0.4, 0.9], power: [2, 5], gravity: -12, blend: 'std', drag: 0.2 },
    glass: { cap: 60, c1: [0.8, 0.92, 1, 0.9], c2: [0.6, 0.8, 0.95, 0.7], size: [0.04, 0.1], life: [0.4, 1], power: [2.5, 6], gravity: -12, blend: 'add', drag: 0.2 },
    spray: { cap: 80, c1: [0.8, 0.9, 1, 0.8], c2: [0.6, 0.78, 0.95, 0.6], size: [0.08, 0.2], life: [0.4, 0.9], power: [2, 6], gravity: -10, blend: 'add', drag: 0.2 },
  };
  const SURFACE_DUST = { sand: [0.86, 0.78, 0.58], snow: [0.95, 0.97, 1], grass: [0.55, 0.52, 0.4], dirt: [0.55, 0.45, 0.33], stone: [0.62, 0.62, 0.62], wood: [0.6, 0.5, 0.38] };
  const pools = new Map(); // kind -> { list, at }
  let poolScene = null;
  function pool(kind) {
    const w = W();
    if (!w || !w.scene) return null;
    if (poolScene !== w.scene) { disposePools(); poolScene = w.scene; }
    let p = pools.get(kind);
    if (!p) { p = { list: [], at: 0 }; pools.set(kind, p); }
    const want = J.level === 'full' ? 6 : J.level === 'reduced' ? 3 : 2;
    if (p.list.length < want) {
      const k = KINDS[kind];
      const ps = new B.ParticleSystem(`juice-${kind}`, k.cap, w.scene);
      ps.particleTexture = w.dot;
      ps.emitRate = 0;
      ps.minSize = k.size[0]; ps.maxSize = k.size[1];
      ps.minLifeTime = k.life[0]; ps.maxLifeTime = k.life[1];
      ps.minEmitPower = k.power[0]; ps.maxEmitPower = k.power[1];
      ps.gravity = new B.Vector3(0, k.gravity, 0);
      ps.color1 = new B.Color4(...k.c1); ps.color2 = new B.Color4(...k.c2); ps.colorDead = new B.Color4(k.c2[0], k.c2[1], k.c2[2], 0);
      ps.blendMode = k.blend === 'add' ? B.ParticleSystem.BLENDMODE_ADD : B.ParticleSystem.BLENDMODE_STANDARD;
      ps.minAngularSpeed = -4; ps.maxAngularSpeed = 4;
      ps.emitter = new B.Vector3(0, -1000, 0);
      ps.createSphereEmitter(0.15);
      ps.updateSpeed = 1 / 60;
      ps.start();
      p.list.push(ps);
    }
    return p;
  }
  function disposePools() { for (const p of pools.values()) for (const ps of p.list) try { ps.dispose(); } catch { /* gone */ } pools.clear(); }
  let rate = { t: 0, n: 0 };
  /** A burst of particles: kind (dust, sparks, splinters, chips, glass, spray) at a point. o: { count, speed (x the
   *  kind's), color ([r, g, b] 0-1 or '#hex'), dir ([x, y, z]: they go mostly this way), spread (0-1) }. */
  function burst(kind, at, o = {}) {
    if (!J.allowed('particles') || !KINDS[kind] || !at) return false;
    const c = camPos();
    if (c && Math.hypot(at[0] - c.x, at[1] - c.y, at[2] - c.z) > 60) return false;
    // At most ~40 bursts a second, however much is happening.
    const now = J.fx.clock;
    if (now - rate.t > 0.25) { rate = { t: now, n: 0 }; }
    if (++rate.n > 10) return false;
    const p = pool(kind);
    if (!p) return false;
    const ps = p.list[p.at % p.list.length];
    p.at++;
    const k = KINDS[kind];
    const n = Math.max(1, Math.round((o.count || 20) * J.budget.particles));
    ps.emitter = new B.Vector3(at[0], at[1], at[2]);
    const sp = o.speed || 1;
    ps.minEmitPower = k.power[0] * sp; ps.maxEmitPower = k.power[1] * sp;
    if (o.color) {
      const col = Array.isArray(o.color) ? o.color : (() => { const x = B.Color3.FromHexString(o.color); return [x.r, x.g, x.b]; })();
      ps.color1 = new B.Color4(col[0], col[1], col[2], k.c1[3]); ps.color2 = new B.Color4(col[0] * 0.85, col[1] * 0.85, col[2] * 0.85, k.c2[3]);
      ps.colorDead = new B.Color4(col[0], col[1], col[2], 0);
    } else { ps.color1 = new B.Color4(...k.c1); ps.color2 = new B.Color4(...k.c2); ps.colorDead = new B.Color4(k.c2[0], k.c2[1], k.c2[2], 0); }
    const d = o.dir || [0, 1, 0];
    const s = o.spread ?? 0.6;
    ps.createDirectedSphereEmitter ? ps.createDirectedSphereEmitter(o.radius || 0.15, new B.Vector3(d[0] - s, d[1] - s * 0.3, d[2] - s), new B.Vector3(d[0] + s, d[1] + s, d[2] + s)) : null;
    ps.manualEmitCount = (ps.manualEmitCount > 0 ? ps.manualEmitCount : 0) + n;
    J.fx.bursts++;
    return true;
  }
  /** Dust where something lands or skids (the surface's colour). */
  function dust(at, o = {}) {
    const col = SURFACE_DUST[o.surface] || SURFACE_DUST.dirt;
    return burst('dust', at, { count: Math.round(10 + 40 * clamp(o.amount ?? 0.5, 0, 1.5)), color: col, speed: 0.6 + (o.amount ?? 0.5) * 0.8, dir: [0, 0.4, 0], spread: 1 });
  }

  // ------------------------------------------------------------------ marks: thin instances of one plane per kind, in a ring
  const DECALS = {
    scorch: { cap: 40, life: 40, draw: (c, s) => { const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(12,8,6,.92)'); g.addColorStop(0.45, 'rgba(25,18,12,.75)'); g.addColorStop(0.8, 'rgba(40,30,20,.25)'); g.addColorStop(1, 'rgba(40,30,20,0)'); c.fillStyle = g; c.fillRect(0, 0, s, s); } },
    tire: { cap: 400, life: 25, draw: (c, s) => { c.fillStyle = 'rgba(18,18,20,.55)'; c.fillRect(s * 0.15, 0, s * 0.7, s); c.fillStyle = 'rgba(10,10,12,.35)'; for (let i = 0; i < 4; i++) c.fillRect(s * (0.2 + i * 0.16), 0, s * 0.05, s); } },
    print: { cap: 300, life: 30, draw: (c, s) => { c.fillStyle = 'rgba(70,60,50,.4)'; c.beginPath(); if (c.ellipse) c.ellipse(s / 2, s * 0.58, s * 0.26, s * 0.36, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); if (c.ellipse) c.ellipse(s / 2, s * 0.15, s * 0.2, s * 0.13, 0, 0, Math.PI * 2); c.fill(); } },
  };
  const decals = new Map(); // kind -> { mesh, buf, at, born: [], cap }
  let decalScene = null;
  function decalPool(kind) {
    const w = W();
    if (!w || !w.scene) return null;
    if (decalScene !== w.scene) { disposeDecals(); decalScene = w.scene; }
    let d = decals.get(kind);
    if (d) return d;
    const def = DECALS[kind];
    const cap = def.cap;
    const mesh = B.MeshBuilder.CreateGround(`juice-${kind}`, { width: 1, height: 1 }, w.scene);
    const tex = new B.DynamicTexture(`juice-${kind}`, 64, w.scene, true);
    try { const c = tex.getContext(); c.clearRect(0, 0, 64, 64); def.draw(c, 64); tex.update(); } catch { /* no canvas */ }
    tex.hasAlpha = true;
    const m = new B.StandardMaterial(`juice-${kind}`, w.scene);
    m.diffuseTexture = tex; m.useAlphaFromDiffuseTexture = true; m.specularColor = new B.Color3(0, 0, 0);
    m.backFaceCulling = false; m.zOffset = -2; m.disableDepthWrite = true;
    mesh.material = m; mesh.isPickable = false; mesh.metadata = { decor: true }; mesh.alwaysSelectAsActiveMesh = true;
    mesh.receiveShadows = false;
    const buf = new Float32Array(16 * cap); // all zero: nothing drawn until a mark is put there
    mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
    d = { mesh, buf, at: 0, born: new Float32Array(cap).fill(-1), life: new Float32Array(cap), cap, tex, m, live: 0 };
    decals.set(kind, d);
    return d;
  }
  function disposeDecals() { for (const d of decals.values()) try { d.mesh.dispose(); d.m.dispose(); d.tex.dispose(); } catch { /* gone */ } decals.clear(); }
  const TMP_M = new B.Matrix(), TMP_Q = new B.Quaternion(), TMP_Q2 = new B.Quaternion();
  /** A mark on the ground (or a wall): kind (scorch, tire, print) at a point. o: { size (meters, or [w, l]), yaw
   *  (radians), normal ([x, y, z], up by default), life (seconds) }. */
  function decal(kind, at, o = {}) {
    if (!J.allowed('decals') || !DECALS[kind] || !at) return -1;
    const cap = Math.min(DECALS[kind].cap, Math.round(J.budget.decals * (kind === 'scorch' ? 0.25 : kind === 'print' ? J.budget.prints * 1.5 : 1.5)));
    if (cap <= 0) return -1;
    const d = decalPool(kind);
    if (!d) return -1;
    const i = d.at % cap;
    d.at++;
    const sz = Array.isArray(o.size) ? o.size : [o.size || 1, o.size || 1];
    const n = o.normal ? new B.Vector3(o.normal[0], o.normal[1], o.normal[2]).normalize() : B.Vector3.Up();
    // Turned so its up is the surface's normal, then spun by yaw around it.
    const axis = B.Vector3.Cross(B.Vector3.Up(), n);
    const ang = Math.acos(clamp(B.Vector3.Dot(B.Vector3.Up(), n), -1, 1));
    if (axis.lengthSquared() > 1e-6) B.Quaternion.RotationAxisToRef(axis.normalize(), ang, TMP_Q); else TMP_Q.copyFromFloats(0, 0, 0, 1);
    B.Quaternion.RotationAxisToRef(B.Vector3.Up(), o.yaw || 0, TMP_Q2);
    const q = TMP_Q.multiply(TMP_Q2);
    const lift = 0.025 + (d.at % 7) * 0.002;
    B.Matrix.ComposeToRef(new B.Vector3(sz[0], 1, sz[1]), q, new B.Vector3(at[0] + n.x * lift, at[1] + n.y * lift, at[2] + n.z * lift), TMP_M);
    TMP_M.copyToArray(d.buf, i * 16);
    d.born[i] = J.fx.clock; d.life[i] = o.life || DECALS[kind].life;
    d.mesh.thinInstanceBufferUpdated('matrix');
    J.fx.decals++;
    return i;
  }
  // Old marks go (every second): their matrix zeroed.
  let ageAt = 0;
  function ageDecals() {
    if (J.fx.clock - ageAt < 1) return;
    ageAt = J.fx.clock;
    for (const d of decals.values()) {
      let changed = false;
      for (let i = 0; i < d.cap; i++) if (d.born[i] >= 0 && J.fx.clock - d.born[i] > d.life[i]) { d.born[i] = -1; d.buf.fill(0, i * 16, i * 16 + 16); changed = true; }
      if (changed) d.mesh.thinInstanceBufferUpdated('matrix');
    }
  }
  /** How many marks of a kind are on the ground now. */
  const decalCount = (kind) => { const d = decals.get(kind); if (!d) return 0; let n = 0; for (let i = 0; i < d.cap; i++) if (d.born[i] >= 0) n++; return n; };

  // ------------------------------------------------------------------ footprints in sand and snow (and mud)
  function footprint(surface, e, side) {
    if (!(surface === 'sand' || surface === 'snow' || surface === 'mud') || !J.budget.prints || !e) return -1;
    const yaw = e.node ? e.node.rotation.y : 0;
    const off = (side ? 1 : -1) * (e.living ? Math.min(0.25, e.half[0] * 0.5) : 0.12);
    const at = [e.x + Math.cos(yaw) * off, e.bottom, e.z - Math.sin(yaw) * off];
    const s = e.living ? clamp((e.living.sp.legW || 0.12) * (e.living.size || 1) * 1.6, 0.1, 0.6) : 0.22;
    return decal('print', at, { size: [s, s * 1.4], yaw, life: surface === 'snow' ? 40 : 25 });
  }

  // ------------------------------------------------------------------ what makes them
  // Impacts: sparks on metal, splinters from wood, chips from stone and glass, dust on dirt, splashes on water.
  J.sound.hits.push(({ a, b, at, speed, sound }) => {
    if (!sound || speed < 4) return;
    const mats = [M.materialOf(a), M.materialOf(b)];
    const k = clamp((speed - 3) / 15, 0, 1.4);
    const dir = [0, 1, 0];
    if (mats.includes('metal') && speed > 6) burst('sparks', at, { count: 8 + k * 30, speed: 0.6 + k * 0.8, dir, spread: 1 });
    if (mats.includes('wood') && speed > 7) burst('splinters', at, { count: 5 + k * 16, speed: 0.6 + k * 0.6 });
    if (mats.includes('glass') && speed > 5) burst('glass', at, { count: 6 + k * 18 });
    if (mats.includes('stone') && speed > 8 && !mats.includes('flesh')) burst('chips', at, { count: 4 + k * 10, speed: 0.6 + k * 0.5 });
    if ((mats.includes('dirt') || mats.includes('stone')) && speed > 5) dust(at, { amount: k * 0.6, surface: mats.includes('dirt') ? 'dirt' : 'stone' });
    if (mats.includes('water') && speed > 3) { if (H.water && H.water.splash) { try { H.water.splash(at, clamp(speed / 10, 0.2, 2), { sound: false }); } catch { /* fine */ } } else burst('spray', at, { count: 10 + k * 20 }); }
  });
  // Landing from a height (≥0.5 m): one dust puff in the surface's colour (sand, grass, stone, wood...).
  J.feel.on('land', ({ height, speed, surface, entity, amount }) => {
    if (!entity) return;
    const h = height != null ? height : (speed * speed) / (2 * 24);
    if (h < 0.5) return;
    const amt = amount != null ? amount : clamp((h - 0.35) / 2.8, 0.1, 1.4);
    const ok = dust([entity.x, entity.bottom + 0.05, entity.z], { amount: clamp(0.25 + amt * 1.1, 0.25, 1.4), surface: surface === 'water' ? 'dirt' : surface });
    if (ok && J.feel.lastLand) J.feel.lastLand.dust = true;
  });
  // Blasts: a scorch mark on the ground under it (and a ring of dust).
  H.physics.on('explosion', (d) => {
    const at = d.position, R = Number(d.radius) || 4.5;
    if (!W()) return;
    if (d.mayhem && H.mayhem && H.mayhem.vfx && H.mayhem.vfx.ready()) return; // the layered blast (mayhem-vfx.js) makes its own scorch and dust
    let ground = null;
    try { ground = H.physics.raycast([at[0], at[1] + 0.5, at[2]], [0, -1, 0], Math.max(2, R * 0.8)); } catch { /* fine */ }
    if (ground && !(ground.entity && (ground.entity.living || ground.entity._ragPart))) {
      const n = ground.normal || [0, 1, 0];
      const near = clamp(1 - (at[1] - ground.point[1]) / Math.max(1, R * 0.8), 0.3, 1);
      decal('scorch', ground.point, { size: R * 0.75 * near * (Number(J.settings.boom) || 1), yaw: Math.random() * 6.28, normal: n });
      const surface = ground.entity ? M.surfaceOf(ground.entity, ground.point) : 'dirt';
      dust(ground.point, { amount: clamp(R / 6, 0.4, 1.5), surface });
    }
  });
  // Skids: tire marks and dust where wheels slip.
  const wheelLast = new WeakMap();
  function runSkids() {
    if (!H.vehicles || !H.vehicles.list) return;
    const c = camPos();
    for (const e of H.vehicles.list()) {
      const v = e.vehicle;
      if (!v || !v.wheels || !e.alive) continue;
      if (c && Math.hypot(e.x - c.x, e.z - c.z) > 80) continue;
      const vel = v.vel ? [v.vel.x, v.vel.y, v.vel.z] : [e.vx, e.vy, e.vz];
      const sp = Math.hypot(vel[0], vel[2]);
      for (const w of v.wheels) {
        const tire = w.tire || w.steerNode;
        if (!w.contact || !tire || sp < 2) { wheelLast.delete(w); continue; }
        const p = tire.getAbsolutePosition();
        const at = [p.x, p.y - (w.r || 0.35), p.z];
        const last = wheelLast.get(w);
        if (!w.slip) { wheelLast.delete(w); continue; }
        if (last && Math.hypot(at[0] - last[0], at[2] - last[2]) < 0.3) continue;
        const yaw = last ? Math.atan2(at[0] - last[0], at[2] - last[2]) : Math.atan2(vel[0], vel[2]);
        const len = last ? Math.min(0.9, Math.hypot(at[0] - last[0], at[2] - last[2]) + 0.05) : 0.35;
        const mid = last ? [(at[0] + last[0]) / 2, at[1], (at[2] + last[2]) / 2] : at;
        decal('tire', mid, { size: [Math.max(0.15, (w.w || 0.25) * 0.9), len], yaw });
        wheelLast.set(w, at);
        const ground = w.ground;
        const surface = ground ? M.surfaceOf(ground, at) : 'dirt';
        if (Math.random() < 0.35) dust(at, { amount: clamp(sp / 25, 0.15, 0.6) * (/dirt|sand|snow|grass/.test(surface) ? 1.6 : 0.6), surface });
      }
    }
  }

  // ------------------------------------------------------------------ every frame; worlds come and go
  // A second into a world, one of each is made (their shaders compile then, not at the first blast).
  let warm = 0;
  H.hooks.frame.push((dt, render) => {
    if (!W()) return;
    J.fx.clock += dt;
    if (warm >= 0 && render && (warm += dt) > 1) { warm = -1; try { if (J.allowed('particles')) for (const k of Object.keys(KINDS)) pool(k); if (J.allowed('decals') && J.budget.decals) for (const k of Object.keys(DECALS)) decalPool(k); } catch (err) { H.report(err, 'juice fx'); } }
    try { runSkids(); ageDecals(); } catch (err) { H.report(err, 'juice fx'); }
  });
  H.hooks.world.push({ enter() { warm = 0; }, leave() { disposePools(); disposeDecals(); poolScene = null; decalScene = null; } });

  J.fx = { burst, dust, decal, footprint, decalCount, clock: 0, bursts: 0, decals: 0, KINDS: Object.keys(KINDS), DECALS: Object.keys(DECALS) };
})();
