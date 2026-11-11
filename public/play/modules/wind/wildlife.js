// Wildlife (config.wildlife): the island is not empty.
//   - Gulls circling the beach and the pier (a flock with a flap-and-glide cycle; boids: each keeps its own circle and
//     keeps off the others). A vehicle, the player running by, or an explosion within 8 m (an explosion within 40 m)
//     scatters the flock at once; some seconds later it settles back into its circle. Never nearer the ground than
//     4.8 m, so none is ever in the pier, a lamp or a roof.
//   - Butterflies in the clearing by day, fireflies in the clearing at night (by H.sky.clock: none at all by day).
//   - A fish that jumps off the pier now and then, with a splash.
//   Low-poly, built here from code. The wings beat in the wind module's vertex shader (kind 'wing'). Counts follow the
//   Graphics tier (a phone: 6 gulls, 4 butterflies, 14 fireflies).
//   config.wildlife: true | { gulls: [x, z] (the circle's middle on the planet), clearing: [x, z, radius], pier: [x, z] (where fish jump),
//                             gullsOn: false, butterflies: false, fireflies: false, fish: false }
//   window.__wildlife: counts, scatter events ({ t, cause, count, ms }), fish jumps, the closest any flyer came to
//   the ground or a solid (what the playtest reads); game.emit('wildlife', { state: 'scatter' | 'settle' | 'fish' ... }).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.wildlife) return;
  const B = window.BABYLON;
  const K = H.windCore;
  const W = () => H.world;
  const P = H.planet;
  const warn = (what, err) => { try { H.report ? H.report(err, `wildlife ${what}`) : console.warn(`wildlife ${what}`, err); } catch { /* none */ } };

  const S = {
    on: false, opts: {}, t: 0, tier: 'desktop', spec: K.TIERS.desktop, hour: 15.5, night: 0, day: 1,
    gullsAt: [68, -2], clearing: [-4, 0, 12], pier: [80, 0],
    gulls: [], gullMeshes: [], flies: null, butterflies: [], fish: null, nextFish: 6, fishJumps: 0, lastFish: null,
    scatters: [], scatterCount: 0, settles: 0, cool: 0, near: new Map(), solids: [], solidsAt: -9, minGull: 99, minFly: 99, inside: 0,
    player: [0, 0, 0], pv: [0, 0, 0], prev: null, r: K.rng(5),
  };
  const frameOn = () => Boolean(P && P.frame && P.frame.on);
  const radius = () => { const w = W(); const c = w && w.config && w.config.planet; return (c && c.radius) || 50000; };
  function localOf(px, pz) { if (!frameOn()) return [px, 0, pz]; return P.frame.toLocal([px, -(px * px + pz * pz) / (2 * radius()), pz]); }
  const groundAt = (x, z) => { const g = H.terrain && H.terrain.active ? H.terrain.heightAt(x, z) : null; return g === null || g === undefined ? null : g; };
  const seaAt = (x, z) => { const s = H.water && H.water.surfaceAt ? H.water.surfaceAt(x, z) : null; return s === null || s === undefined ? null : s; };
  /** What is under a flyer: the ground or the sea or, over the pier, a floor of 1.6 m (the planks, their lamps and lantern are lower than 4.4 m). */
  const under = (x, z) => Math.max(groundAt(x, z) ?? -9, seaAt(x, z) ?? -9, 1.6);

  // ------------------------------------------------------------------ meshes (low poly, vertex coloured)
  function build(name, scene, pos, col, idx) {
    const m = new B.Mesh(name, scene), vd = new B.VertexData();
    vd.positions = pos; vd.indices = idx; vd.colors = col;
    const n = []; for (let i = 0; i < pos.length; i += 3) n.push(0, 1, 0);
    vd.normals = n; vd.applyToMesh(m);
    m.isPickable = false; m.checkCollisions = false; m.alwaysSelectAsActiveMesh = true; m.doNotSyncBoundingInfo = true; m.receiveShadows = false;
    return m;
  }
  function mat(name, scene, emissive) {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseColor = new B.Color3(1, 1, 1); m.specularColor = new B.Color3(0, 0, 0); m.backFaceCulling = false; m.twoSidedLighting = true;
    m.emissiveColor = emissive || new B.Color3(0.22, 0.22, 0.24);
    return m;
  }
  // a flyer: body along +z, wings along x (the shader flaps them by |x|)
  function winged(name, scene, o) {
    const P_ = [], C = [], I = [], { body, wing, tip, span, chord, len, beak } = o;
    const v = (x, y, z, c) => { P_.push(x, y, z); C.push(c[0], c[1], c[2], 1); return P_.length / 3 - 1; };
    // body: a diamond-shaped spindle
    const n = v(0, 0, len * 0.5, body), t = v(0, 0, -len * 0.5, body), l = v(-len * 0.14, 0, 0, body), r = v(len * 0.14, 0, 0, body), u = v(0, len * 0.12, 0, body), d = v(0, -len * 0.1, 0, body);
    I.push(n, r, u, n, u, l, n, d, r, n, l, d, t, u, r, t, l, u, t, r, d, t, d, l);
    if (beak) { const b0 = v(0, 0, len * 0.5 + len * 0.16, beak), b1 = v(len * 0.05, 0.01, len * 0.46, beak), b2 = v(-len * 0.05, 0.01, len * 0.46, beak); I.push(b0, b1, b2); }
    for (const s of [-1, 1]) {
      const a = v(s * len * 0.12, 0, chord * 0.5, wing), b = v(s * len * 0.12, 0, -chord * 0.5, wing), m1 = v(s * span * 0.5, 0, chord * 0.3 - 0.02, wing), m2 = v(s * span * 0.5, 0, -chord * 0.35, wing);
      const t1 = v(s * span, 0.0, -chord * 0.15, tip);
      I.push(a, b, m1, b, m2, m1, m1, m2, t1);
    }
    return build(name, scene, P_, C, I);
  }

  // ------------------------------------------------------------------ the solids a flyer must stay out of
  function refreshSolids() {
    const w = W(); S.solidsAt = S.t;
    if (!w) return;
    const out = [], c = S.player;
    for (const e of w.entities) {
      if (!e.alive || e.isPlayer || e.remotePlayer || e.isTerrain || !e.node || !e.node.isEnabled || !e.node.isEnabled()) continue;
      if (Math.abs(e.x - c[0]) > 90 || Math.abs(e.z - c[2]) > 90) continue;
      try {
        const bb = e.node.getHierarchyBoundingVectors(true);
        if (bb.max.x - bb.min.x > 80 || bb.max.x - bb.min.x < 0.05) continue; // (the terrain's and the sea's own are not solids)
        out.push([bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z]);
      } catch { /* an entity with no bounds */ }
    }
    S.solids = out;
  }
  /** A point pushed up out of any solid it is inside (+ pad), so nothing is ever in a model. Returns the new y. */
  function clear(x, y, z, pad) {
    for (const s of S.solids) if (x > s[0] - pad && x < s[3] + pad && z > s[2] - pad && z < s[5] + pad && y > s[1] - pad && y < s[4] + pad) y = s[4] + pad;
    return y;
  }
  const inside = (x, y, z) => S.solids.some((s) => x > s[0] && x < s[3] && z > s[2] && z < s[5] && y > s[1] && y < s[4]);

  // ------------------------------------------------------------------ gulls
  function makeGulls(scene) {
    const n = S.opts.gullsOn === false ? 0 : S.spec.gulls;
    if (!n) return;
    const proto = winged('wl-gull', scene, { body: [0.96, 0.96, 0.95], wing: [0.94, 0.94, 0.94], tip: [0.22, 0.22, 0.26], span: 1.0, chord: 0.26, len: 0.62, beak: [0.95, 0.72, 0.15] });
    proto.material = mat('wl-gull-mat', scene);
    proto.setEnabled(false);
    const r = K.rng(41), c = localOf(S.gullsAt[0], S.gullsAt[1]);
    const cc = { x: c[0], y: 0, z: c[2], r: 20, h: 6.5 };
    for (let i = 0; i < n; i++) {
      const m = proto.clone(`wl-gull-${i}`); m.setEnabled(true); m.material = proto.material; m.scaling.setAll(1.7);
      H.wind.mark(m, 'wing', { decor: true, windFlap: 0 });
      const g = K.makeGull(r, i, n, { ...cc, y: under(c[0], c[2]) });
      g.r = 14 + r() * 16; g.h = 5.5 + r() * 4;
      g.x = c[0] + Math.cos(g.a) * g.r; g.z = c[2] + Math.sin(g.a) * g.r; g.y = under(g.x, g.z) + g.h;
      g.vx = -Math.sin(g.a) * g.dir * 7; g.vz = Math.cos(g.a) * g.dir * 7;
      g.mesh = m; S.gulls.push(g);
    }
    S.gullProto = proto;
  }
  function circle() {
    const c = localOf(S.gullsAt[0], S.gullsAt[1]);
    return { x: c[0], z: c[2], base: under(c[0], c[2]) };
  }
  /** Something near the flock: the player running by, a moving vehicle or a blast. Scatters the flock. */
  function startle(cause, at, dist) {
    if (S.t < S.cool) return false;
    const live = S.gulls.filter((g) => g.state === 'circle' || g.state === 'settle');
    if (!live.length) return false;
    for (const g of live) K.flockStep(g, 0.0001, circle(), S.gulls, under, S.t, { x: at[0], z: at[1] });
    S.cool = S.t + 9; // (the flock settles before it is startled again)
    const ev = { n: ++S.scatterCount, cause, count: live.length, dist: Math.round(dist * 10) / 10, at: Math.round(performance.now()), ms: Math.round(Math.max(0, (performance.now() - (S.near.get(cause) || performance.now())))) };
    S.scatters.push(ev); if (S.scatters.length > 12) S.scatters.shift();
    if (H.game) { try { H.game.emit('wildlife', { state: 'scatter', ...ev }); } catch (err) { warn('emit', err); } }
    return true;
  }
  function watchThreats(dt) {
    const w = W();
    if (!S.gulls.length || !w) return;
    const c = circle(), pxz = [S.player[0], S.player[2]];
    const gy = S.gulls.reduce((a, g) => a + g.y, 0) / S.gulls.length;
    const near = (x, y, z, d) => Math.hypot(x - c.x, z - c.z) < 60 && S.gulls.some((g) => g.state === 'circle' && Math.hypot(g.x - x, g.z - z) < d && g.y - y < 14);
    const mark = (cause, hit, x, z, d) => { if (hit) { if (!S.near.has(cause)) S.near.set(cause, performance.now()); startle(cause, [x, z], d); } else S.near.delete(cause); };
    // the player, when running (a walk along the pier under them is all right)
    const sp = Math.hypot(S.pv[0], S.pv[2]);
    mark('player', sp > 3 && near(pxz[0], S.player[1], pxz[1], 8), pxz[0], pxz[1], 8);
    if (w.vehicles) {
      let hit = null;
      for (const e of w.vehicles) {
        if (!e.alive || !e.vehicle) continue;
        const v = e.vehicle.vel, speed = v ? Math.hypot(v.x, v.z) : 0, occupied = Boolean(e.vehicle.driver || e.vehicle.rider || e._vehRider || e.driver);
        if ((speed > 2 || occupied && speed > 0.8) && near(e.x, e.y, e.z, 8.5)) { hit = e; break; }
      }
      mark('vehicle', Boolean(hit), hit ? hit.x : 0, hit ? hit.z : 0, 8);
    }
  }
  function updateGulls(dt) {
    if (!S.gulls.length) return;
    const c = circle();
    let minClear = 99;
    for (const g of S.gulls) {
      const was = g.state;
      K.flockStep(g, dt, c, S.gulls, under, S.t, null);
      if (was === 'settle' && g.state === 'circle') { S.settles++; if (H.game && !S.gulls.some((o) => o.state !== 'circle')) { try { H.game.emit('wildlife', { state: 'settle', count: S.gulls.length }); } catch (err) { warn('emit', err); } } }
      g.y = clear(g.x, g.y, g.z, 0.8);
      const m = g.mesh;
      m.position.set(g.x, g.y, g.z);
      const sp = Math.hypot(g.vx, g.vz);
      m.rotation.set(-Math.atan2(g.vy, Math.max(0.1, sp)) * 0.6, Math.atan2(g.vx, g.vz), g.bank);
      m.metadata.windFlap = g.wing * 0.9;
      minClear = Math.min(minClear, g.y - under(g.x, g.z));
      if (inside(g.x, g.y, g.z)) S.inside++;
    }
    S.minGull = minClear;
  }

  // ------------------------------------------------------------------ butterflies and fireflies in the clearing
  function makeButterflies(scene) {
    const n = S.opts.butterflies === false ? 0 : S.spec.butterflies;
    if (!n) return;
    const palettes = [[[1, 0.62, 0.15], [0.2, 0.12, 0.08]], [[0.4, 0.62, 1], [0.1, 0.12, 0.3]], [[1, 0.95, 0.5], [0.45, 0.35, 0.1]]];
    const protos = palettes.map((p, i) => { const m = winged(`wl-bf-${i}`, scene, { body: [0.15, 0.1, 0.08], wing: p[0], tip: p[1], span: 0.46, chord: 0.2, len: 0.18 }); m.material = mat(`wl-bf-mat-${i}`, scene, new B.Color3(0.32, 0.3, 0.25)); m.setEnabled(false); return m; });
    const r = K.rng(53);
    for (let i = 0; i < n; i++) {
      const m = protos[i % 3].clone(`wl-bf-${i}`); m.setEnabled(true); m.material = protos[i % 3].material;
      H.wind.mark(m, 'wing', { decor: true, windFlap: 0 });
      S.butterflies.push({ mesh: m, a: r() * 6.28, w: 0.25 + r() * 0.3, rx: 3 + r() * 8, rz: 3 + r() * 8, ph: r() * 6.28, h: 0.7 + r() * 1.3, ox: (r() - 0.5) * 6, oz: (r() - 0.5) * 6, beat: 14 + r() * 5 });
    }
    S.bfProtos = protos;
  }
  function makeFireflies(scene) {
    const n = S.opts.fireflies === false ? 0 : S.spec.fireflies;
    if (!n) return;
    const m = B.MeshBuilder.CreatePolyhedron('wl-firefly', { type: 1, size: 0.05 }, scene);
    const mt = new B.StandardMaterial('wl-firefly-mat', scene);
    mt.disableLighting = true; mt.emissiveColor = new B.Color3(1, 0.93, 0.35); mt.alpha = 1; m.material = mt;
    m.isPickable = false; m.checkCollisions = false; m.alwaysSelectAsActiveMesh = true; m.receiveShadows = false;
    m.thinInstanceSetBuffer('matrix', new Float32Array(n * 16), 16, false); m.thinInstanceCount = 0;
    const r = K.rng(67), list = [];
    for (let i = 0; i < n; i++) list.push({ ox: (r() - 0.5) * 2, oz: (r() - 0.5) * 2, ph: r() * 6.28, w: 0.18 + r() * 0.25, h: 0.5 + r() * 2.6, blink: 0.35 + r() * 0.7, off: r() * 6.28 });
    S.flies = { mesh: m, list, buf: new Float32Array(n * 16), shown: 0 };
  }
  function updateFlies(dt) {
    const c = S.clearing, base = localOf(c[0], c[1]), R = c[2];
    // butterflies: by day
    let seen = 0;
    for (const b of S.butterflies) {
      const on = S.day > 0.05;
      b.mesh.setEnabled(on);
      if (!on) continue;
      b.a += dt * b.w;
      const x = base[0] + b.ox + Math.sin(b.a) * b.rx * (R / 12) + Math.sin(b.a * 2.3 + b.ph) * 1.2, z = base[2] + b.oz + Math.cos(b.a * 0.8 + b.ph) * b.rz * (R / 12);
      const g = groundAt(x, z) ?? base[1];
      let y = g + b.h + Math.sin(S.t * 1.7 + b.ph) * 0.35;
      y = clear(x, Math.max(y, g + 0.45), z, 0.35);
      const dx = x - b.mesh.position.x, dz = z - b.mesh.position.z;
      b.mesh.position.set(x, y, z);
      if (dx * dx + dz * dz > 1e-8) b.mesh.rotation.set(0.15, Math.atan2(dx, dz), Math.sin(S.t * 3 + b.ph) * 0.35);
      b.mesh.metadata.windFlap = Math.sin(S.t * b.beat + b.ph) * 1.5;
      S.minFly = Math.min(S.minFly, y - g);
      if (inside(x, y, z)) S.inside++;
      seen++;
    }
    S.butterfliesShown = seen;
    // fireflies: by night
    const F = S.flies;
    if (!F) return;
    const vis = S.night;
    if (vis < 0.03) { F.mesh.thinInstanceCount = 0; F.shown = 0; return; }
    let cnt = 0;
    for (const f of F.list) {
      const x = base[0] + f.ox * R * 1.15 + Math.sin(S.t * f.w + f.ph) * 2.2, z = base[2] + f.oz * R * 1.15 + Math.cos(S.t * f.w * 0.8 + f.ph) * 2.2;
      const g = groundAt(x, z);
      if (g === null) continue;
      let y = g + f.h + Math.sin(S.t * 0.6 + f.off) * 0.5;
      y = clear(x, Math.max(y, g + 0.35), z, 0.3);
      const blink = 0.5 + 0.5 * Math.sin(S.t * f.blink * 5 + f.off), s = vis * (0.35 + 0.9 * blink * blink);
      const o = cnt * 16, b = F.buf;
      b[o] = s; b[o + 1] = 0; b[o + 2] = 0; b[o + 3] = 0; b[o + 4] = 0; b[o + 5] = s; b[o + 6] = 0; b[o + 7] = 0; b[o + 8] = 0; b[o + 9] = 0; b[o + 10] = s; b[o + 11] = 0; b[o + 12] = x; b[o + 13] = y; b[o + 14] = z; b[o + 15] = 1;
      S.minFly = Math.min(S.minFly, y - g);
      cnt++;
    }
    F.mesh.thinInstanceBufferUpdated('matrix');
    F.mesh.thinInstanceCount = cnt; F.shown = cnt;
  }

  // ------------------------------------------------------------------ the fish that jumps off the pier
  function makeFish(scene) {
    if (S.opts.fish === false || !S.spec.fish || !H.water) return;
    const P_ = [], C = [], I = [], v = (x, y, z, c) => { P_.push(x, y, z); C.push(c[0], c[1], c[2], 1); return P_.length / 3 - 1; };
    const back = [0.42, 0.55, 0.66], belly = [0.95, 0.96, 0.97], tail = [0.55, 0.66, 0.74];
    const n = v(0, 0, 0.2, back), t = v(0, 0, -0.18, back), l = v(-0.05, 0, 0.02, back), r = v(0.05, 0, 0.02, back), u = v(0, 0.055, 0.02, back), d = v(0, -0.05, 0.02, belly);
    I.push(n, r, u, n, u, l, n, d, r, n, l, d, t, u, r, t, l, u, t, r, d, t, d, l);
    const f1 = v(0, 0.07, -0.3, tail), f2 = v(0, -0.07, -0.3, tail), f3 = v(0, 0, -0.17, tail);
    I.push(f3, f1, f2);
    const m = build('wl-fish', scene, P_, C, I);
    m.material = mat('wl-fish-mat', scene, new B.Color3(0.3, 0.32, 0.34)); m.scaling.setAll(1.5); m.setEnabled(false);
    S.fish = { mesh: m, live: false, t: 0, dur: 0.9, from: [0, 0, 0], to: [0, 0, 0], sea: -1.5, peak: 1.1 };
  }
  function splash(x, y, z, size, sound) { try { H.water.splash([x, y, z], size, { sound }); } catch (err) { warn('splash', err); } }
  function updateFish(dt) {
    const F = S.fish;
    if (!F) return;
    const pier = localOf(S.pier[0], S.pier[1]);
    if (!F.live) {
      if (S.t < S.nextFish) return;
      S.nextFish = S.t + 7 + S.r() * 9;
      // only near the player (nobody sees a fish a kilometre off) and where there is open water
      if (Math.hypot(S.player[0] - pier[0], S.player[2] - pier[2]) > 110) return;
      const side = S.r() < 0.5 ? -1 : 1, x = pier[0] + (S.r() - 0.5) * 14, z = pier[2] + side * (3.2 + S.r() * 4);
      const sea = seaAt(x, z);
      if (sea === null) return;
      const g = groundAt(x, z);
      if (g !== null && g > sea - 0.6) return; // (shallows and sand: no)
      const a = S.r() * 6.28, d = 1.6 + S.r() * 1.2;
      F.live = true; F.t = 0; F.dur = 0.8 + S.r() * 0.25; F.sea = sea; F.peak = 0.9 + S.r() * 0.5;
      F.from = [x, sea, z]; F.to = [x + Math.cos(a) * d, sea, z + Math.sin(a) * d];
      F.mesh.setEnabled(true);
      splash(x, sea, z, 0.28, false);
      S.fishJumps++;
      S.lastFish = { n: S.fishJumps, at: Math.round(S.t * 10) / 10, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
      if (H.game) { try { H.game.emit('wildlife', { state: 'fish', ...S.lastFish }); } catch (err) { warn('emit', err); } }
      return;
    }
    F.t += dt;
    const u = Math.min(1, F.t / F.dur), x = F.from[0] + (F.to[0] - F.from[0]) * u, z = F.from[2] + (F.to[2] - F.from[2]) * u;
    const y = F.sea + 4 * F.peak * u * (1 - u), vy = 4 * F.peak * (1 - 2 * u), vh = Math.hypot(F.to[0] - F.from[0], F.to[2] - F.from[2]) / F.dur;
    F.mesh.position.set(x, y, z);
    F.mesh.rotation.set(-Math.atan2(vy, vh), Math.atan2(F.to[0] - F.from[0], F.to[2] - F.from[2]), Math.sin(F.t * 24) * 0.25);
    if (u >= 1) { F.live = false; F.mesh.setEnabled(false); splash(x, F.sea, z, 0.4, true); }
  }

  // ------------------------------------------------------------------ every frame
  function frame(dt) {
    if (!S.on) return;
    const w = W();
    if (!w || !w.scene || !w.player) return;
    try {
      dt = Math.min(dt, 0.1);
      S.t += dt;
      const p = w.player, prev = S.player;
      S.player = [p.x, p.y, p.z];
      S.pv = dt > 0 ? [(p.x - prev[0]) / dt, 0, (p.z - prev[2]) / dt] : [0, 0, 0];
      if (S.pv[0] ** 2 + S.pv[2] ** 2 > 2500) S.pv = [0, 0, 0]; // (a respawn or a rebase is not a run)
      const c = H.sky && H.sky.clock ? H.sky.clock(false) : null;
      S.hour = c && Number.isFinite(c.hour) ? c.hour : 12;
      S.night = c ? K.nightness(S.hour) : 0;
      S.day = c ? K.dayness(S.hour) : 1;
      if (S.t - S.solidsAt > (S.tier === 'phone' || S.tier === 'low' ? 5 : 2.5)) refreshSolids();
      watchThreats(dt);
      updateGulls(dt);
      updateFlies(dt);
      updateFish(dt);
      publish();
    } catch (err) { warn('frame', err); }
  }
  function publish() {
    const circling = S.gulls.filter((g) => g.state === 'circle').length;
    window.__wildlife = {
      on: S.on, tier: S.tier, hour: Math.round(S.hour * 100) / 100, night: Math.round(S.night * 100) / 100,
      gulls: S.gulls.length, gullsCircling: circling, gullsScattered: S.gulls.filter((g) => g.state === 'scatter').length, gullsOnScreen: S.gulls.filter((g) => g.mesh && g.mesh.isEnabled()).length,
      scatterCount: S.scatterCount, scatters: S.scatters.slice(), settles: S.settles, last: S.scatters[S.scatters.length - 1] || null,
      butterflies: S.butterfliesShown || 0, butterfliesMax: S.butterflies.length, fireflies: S.flies ? S.flies.shown : 0, firefliesMax: S.flies ? S.flies.list.length : 0,
      fishJumps: S.fishJumps, lastFish: S.lastFish, fishLive: Boolean(S.fish && S.fish.live),
      minGullClearance: Math.round(S.minGull * 100) / 100, minFlyClearance: Math.round(S.minFly * 100) / 100, insideGeometry: S.inside,
    };
  }

  // ------------------------------------------------------------------ the feature
  function apply(value) {
    const w = W();
    if (!w || !w.scene || !H.wind) return;
    remove();
    S.opts = value && typeof value === 'object' ? value : {};
    S.tier = K.tierFor(H.quality ? H.quality() : 'auto', H.device);
    S.spec = K.TIERS[S.tier];
    if (Array.isArray(S.opts.gulls)) S.gullsAt = [Number(S.opts.gulls[0]) || 0, Number(S.opts.gulls[1]) || 0];
    if (Array.isArray(S.opts.clearing)) S.clearing = [Number(S.opts.clearing[0]) || 0, Number(S.opts.clearing[1]) || 0, Math.max(4, Number(S.opts.clearing[2]) || 12)];
    if (Array.isArray(S.opts.pier)) S.pier = [Number(S.opts.pier[0]) || 0, Number(S.opts.pier[1]) || 0];
    S.on = true; S.t = 0; S.nextFish = 5; S.r = K.rng(5);
    S.minGull = 99; S.minFly = 99; S.inside = 0; S.cool = 0;
    const p = w.player; if (p) S.player = [p.x, p.y, p.z];
    makeGulls(w.scene); makeButterflies(w.scene); makeFireflies(w.scene); makeFish(w.scene);
    refreshSolids();
    publish();
  }
  function remove() {
    S.on = false;
    const gone = [...S.gulls.map((g) => g.mesh), ...S.butterflies.map((b) => b.mesh), S.gullProto, ...(S.bfProtos || []), S.flies && S.flies.mesh, S.fish && S.fish.mesh];
    for (const m of gone) if (m) { try { m.material && m.material.dispose && m.material.dispose(); m.dispose(); } catch { /* gone */ } }
    S.gulls = []; S.butterflies = []; S.flies = null; S.fish = null; S.gullProto = null; S.bfProtos = null; S.scatters = []; S.scatterCount = 0; S.settles = 0; S.fishJumps = 0; S.near.clear(); S.butterfliesShown = 0;
    try { delete window.__wildlife; } catch { /* none */ }
  }
  H.features.register('wildlife', {
    apply(value) { apply(value); },
    change(value) { apply(value); },
    dispose() { remove(); },
    codex: {
      title: 'Wildlife', group: 'World features',
      what: 'Gulls circle the beach and scatter (and settle again) when a vehicle, a running player or an explosion comes near; butterflies in the clearing by day, fireflies there at night; a fish that jumps off the pier with a splash. Needs config.wind (it draws the wings). Follows the Graphics setting (a phone: 6 gulls).',
      value: { gulls: [68, -2], clearing: [-4, 0, 12], pier: [80, 0] },
      fields: [['gulls', '[x, z]: the middle of the gulls\' circle', 'the beach'], ['clearing', '[x, z, radius]: where butterflies and fireflies are', '[-4, 0, 12]'], ['pier', '[x, z]: where the fish jump', '[80, 0]'], ['gullsOn / butterflies / fireflies / fish', 'false: leave that out', 'true']],
    },
  });
  H.hooks.world.push({ leave() { if (S.on) remove(); } });
  H.hooks.frame.push(frame);
  // A blast within 40 m startles the flock (the engine's one 'explosion' event).
  if (H.physics && H.physics.on) {
    H.physics.on('explosion', (ev) => {
      if (!S.on || !S.gulls.length || !ev || !ev.position) return;
      const c = circle(), at = ev.position, d = Math.hypot(at[0] - c.x, at[2] - c.z);
      const near = S.gulls.reduce((m, g) => Math.min(m, Math.hypot(g.x - at[0], g.z - at[2])), 1e9);
      if (near < Math.max(40, (ev.radius || 4) * 4)) { S.near.set('explosion', performance.now()); startle('explosion', [at[0], at[2]], near); }
    });
  }
  if (P && P.frame && P.frame.onRebase) {
    P.frame.onRebase((tr) => {
      if (!S.on) return;
      try {
        for (const g of S.gulls) { const a = tr.point([g.x, g.y, g.z]); g.x = a[0]; g.y = a[1]; g.z = a[2]; const v = tr.dir([g.vx, g.vy, g.vz]); g.vx = v[0]; g.vy = v[1]; g.vz = v[2]; if (g.fx !== undefined) { const f = tr.dir([g.fx, 0, g.fz]); g.fx = f[0]; g.fz = f[2]; } g.mesh.position.set(g.x, g.y, g.z); }
        const pl = W() && W().player; if (pl) S.player = [pl.x, pl.y, pl.z];
        refreshSolids();
      } catch (err) { warn('rebase', err); }
    });
  }
  H.wildlife = { get on() { return S.on; }, state: () => window.__wildlife || null, _: { S } };
})();
