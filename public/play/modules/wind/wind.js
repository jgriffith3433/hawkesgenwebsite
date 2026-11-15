// Wind (config.wind): the island moves on its own.
//   - A vertex wind on trees, palms, bushes, grass and flowers (a material plugin: any mesh whose metadata.wind names its
//     kind sways, and the thin instances of the terrain's scatter too): a breath that is always there plus gusts, bumps
//     that travel across the island with the wind. The shader and the ear read the same gust, so one is heard where it is seen.
//   - Grass and wildflowers (thin instances) on the meadow and the road verges round you, shrinking to nothing at the edge
//     of their reach, pushed aside where you and vehicles pass; the density follows the Graphics tier (a phone: 30 percent).
//   - Petals and leaves lifted by gusts (not on a phone), a few palms on the beach (built here, no new model).
//   config.wind: true | { dir: [x, z] (where the wind blows to), gusts: false, grass: false, petals: false, palms: false }
//   H.wind: { on, tier, dir, gust (the live gust), gustHere() (0..1 at the player), on('gust', fn), state() }; window.__wind
//   (what the playtest reads); game.emit('wind', { state: 'gust', ... }) at the start of every gust.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.wind) return;
  const B = window.BABYLON;
  const K = H.windCore;
  const W = () => H.world;
  const P = H.planet;
  const warn = (what, err) => { try { H.report ? H.report(err, `wind ${what}`) : console.warn(`wind ${what}`, err); } catch { /* none */ } };

  // amp: the top of a thing leans this fraction of its height (x the breath, x 2.4 in a gust); pow: how the lean grows with height.
  const KINDS = {
    tree: { amp: 0.05, pow: 2, flag: 0 }, bush: { amp: 0.085, pow: 1.6, flag: 0 }, palm: { amp: 0.07, pow: 1.5, flag: 0 },
    grass: { amp: 0.34, pow: 1.4, flag: 1 }, wing: { amp: 0, pow: 1, flag: 2 },
  };

  const S = {
    on: false, opts: {}, t: 0, dir: [0.93, 0.37], tier: 'desktop', spec: K.TIERS.desktop, r: K.rng(7),
    gust: { front: -1e5, len: 24, str: 0, speed: K.GUST_SPEED, live: false }, nextAt: 1.2, gusts: 0, lastGust: null,
    origin: [0, 0], player: [0, 0, 0], listeners: [], pushers: [], reach: 46, here: 0, grassOn: false,
  };
  const U = { A: [0, 0, 0, 0.5], B: [0, 20, 0, 0], C: [0.93, 0.37, 46, 0], Q: [0, 0, 0, 0], push: [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]] };

  // ------------------------------------------------------------------ the shader: one plugin on every standard and PBR material
  let pluginOk = false;
  function boundsOf(mesh) {
    const md = mesh.metadata || (mesh.metadata = {});
    if (md.windB) return md.windB;
    let lo = 0, hi = 1;
    try {
      const p = mesh.getVerticesData ? mesh.getVerticesData(B.VertexBuffer.PositionKind) : null;
      if (p && p.length >= 3) { lo = Infinity; hi = -Infinity; for (let i = 1; i < p.length; i += 3) { if (p[i] < lo) lo = p[i]; if (p[i] > hi) hi = p[i]; } }
    } catch { /* the default */ }
    md.windB = [lo, hi];
    return md.windB;
  }
  if (B.MaterialPluginBase && B.RegisterMaterialPlugin) {
    class WindPlugin extends B.MaterialPluginBase {
      constructor(material) { super(material, 'HpWind', 191, { HP_WIND: false }); this._enable(true); }
      prepareDefines(defines, scene, mesh) { defines.HP_WIND = Boolean(S.on && mesh && mesh.metadata && mesh.metadata.wind && KINDS[mesh.metadata.wind]); }
      getClassName() { return 'HpWindPlugin'; }
      getUniforms() {
        const names = ['hpWindA', 'hpWindB', 'hpWindC', 'hpWindK', 'hpWindM', 'hpWindQ', 'hpWindP0', 'hpWindP1', 'hpWindP2', 'hpWindP3'];
        return { ubo: names.map((name) => ({ name, size: 4, type: 'vec4' })), vertex: `#ifdef HP_WIND\n${names.map((n) => `uniform vec4 ${n};`).join('\n')}\n#endif\n` };
      }
      bindForSubMesh(ubo, scene, engine, subMesh) {
        const mesh = subMesh && subMesh.getRenderingMesh ? subMesh.getRenderingMesh() : null;
        const md = mesh && mesh.metadata;
        if (!S.on || !md || !md.wind || !KINDS[md.wind]) return;
        const k = KINDS[md.wind], b = boundsOf(mesh);
        ubo.updateFloat4('hpWindA', U.A[0], U.A[1], U.A[2], U.A[3]);
        ubo.updateFloat4('hpWindB', U.B[0], U.B[1], U.B[2], 0);
        ubo.updateFloat4('hpWindC', U.C[0], U.C[1], U.C[2], 0);
        ubo.updateFloat4('hpWindK', k.amp * (md.windAmp ?? 1), k.pow, k.flag, 0);
        ubo.updateFloat4('hpWindM', b[0], b[1], md.windFlap || 0, 0);
        ubo.updateFloat4('hpWindQ', U.Q[0], U.Q[1], 0, 0);
        for (let i = 0; i < 4; i++) ubo.updateFloat4('hpWindP' + i, U.push[i][0], U.push[i][1], U.push[i][2], U.push[i][3]);
      }
      getCustomCode(type) {
        if (type !== 'vertex') return null;
        return {
          // a wing: the tips beat up and down (the flap, -1..1, is this mesh's own)
          CUSTOM_VERTEX_UPDATE_POSITION: `#ifdef HP_WIND
if (hpWindK.z > 1.5) { positionUpdated.y += hpWindM.z * abs(positionUpdated.x); }
#endif
`,
          CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef HP_WIND
if (hpWindK.z < 1.5) {
  float hpHt = clamp((positionUpdated.y - hpWindM.x) / max(hpWindM.y - hpWindM.x, 0.01), 0.0, 1.0);
  float hpHm = (hpWindM.y - hpWindM.x) * length(finalWorld[1].xyz);
  vec2 hpP = worldPos.xz + hpWindA.xy;
  float hpT = hpWindA.z;
  float hpSw = sin(hpT * 1.3 + dot(hpP, vec2(0.21, 0.17))) * 0.5 + sin(hpT * 2.3 + hpP.x * 0.43 - hpP.y * 0.37) * 0.3 + 0.35;
  float hpD = (dot(hpP, hpWindC.xy) - hpWindB.x) / max(hpWindB.y, 1.0);
  float hpG = hpWindB.z * exp(-hpD * hpD);
  float hpFl = 1.0 + 0.35 * sin(hpT * 7.0 + hpP.x * 1.7 + hpP.y * 1.3);
  float hpAmt = hpWindK.x * pow(hpHt, hpWindK.y) * hpHm * (hpWindA.w * hpSw + 2.4 * hpG * hpFl);
  vec2 hpW = worldPos.xz;
  worldPos.xz += hpWindC.xy * hpAmt + vec2(-hpWindC.y, hpWindC.x) * hpAmt * 0.25 * sin(hpT * 1.7 + hpP.x);
  worldPos.y -= abs(hpAmt) * 0.35;
  if (hpWindK.z > 0.5) {
    vec2 hpBase = finalWorld[3].xz;
    float hpGrow = 1.0 - smoothstep(hpWindC.z * 0.72, hpWindC.z, length(hpBase - hpWindQ.xy));
    worldPos.y = finalWorld[3].y + (worldPos.y - finalWorld[3].y) * hpGrow;
    vec4 hpPush[4];
    hpPush[0] = hpWindP0; hpPush[1] = hpWindP1; hpPush[2] = hpWindP2; hpPush[3] = hpWindP3;
    for (int i = 0; i < 4; i++) {
      vec2 hpV = hpW - hpPush[i].xy;
      float hpL = max(length(hpV), 0.05);
      float hpPw = (1.0 - smoothstep(0.0, hpPush[i].z, hpL)) * hpPush[i].w * hpHt;
      worldPos.xz += (hpV / hpL) * hpPw * hpHm * 0.9;
      worldPos.y -= hpPw * hpHm * 0.45;
    }
  }
}
#endif
`,
        };
      }
    }
    B.RegisterMaterialPlugin('HpWind', (material) => (material instanceof B.StandardMaterial || (B.PBRBaseMaterial && material instanceof B.PBRBaseMaterial) ? new WindPlugin(material) : null));
    pluginOk = true;
  }

  /** Marks a mesh as wind's: its kind ('tree', 'bush', 'palm', 'grass', 'wing'). */
  function mark(mesh, kind, o = {}) {
    if (!mesh) return mesh;
    mesh.metadata = { ...(mesh.metadata || {}), wind: kind, ...o };
    delete mesh.metadata.windB;
    try { if (mesh.material && mesh.material.markAsDirty) mesh.material.markAsDirty(B.Material.MiscDirtyFlag); } catch { /* the next frame */ }
    return mesh;
  }

  // ------------------------------------------------------------------ where things are (planet and local)
  const radius = () => { const w = W(); const c = w && w.config && w.config.planet; return (c && c.radius) || 50000; };
  const frameOn = () => Boolean(P && P.frame && P.frame.on);
  /** A point round the player (world coordinates) -> planet x, z (the wind and the grass's cells are fixed to the planet). */
  function planetXZ(p) { if (!frameOn()) return [p[0], p[2]]; const q = P.frame.toPlanet(p); return [q[0], q[2]]; }
  /** Planet x, z -> a point in the world around you at about the ground (y from the curve; ask the terrain for the real one). */
  function localOf(px, pz) { if (!frameOn()) return [px, 0, pz]; return P.frame.toLocal([px, -(px * px + pz * pz) / (2 * radius()), pz]); }
  const groundAt = (x, z) => { const g = H.terrain && H.terrain.active ? H.terrain.heightAt(x, z) : null; return g === null || g === undefined ? null : g; };
  const along = (xz) => xz[0] * S.dir[0] + xz[1] * S.dir[1];

  // ------------------------------------------------------------------ gusts
  function startGust(now) {
    const g = K.nextGust(S.r, now, { gap: [1, 3] });
    const a = along(S.origin) + along([S.player[0], S.player[2]]) - 0; // (the origin's own plus the player's: planet along)
    S.gust = { front: a - 52, len: g.len, str: g.str, speed: 16, live: true, from: now };
    S.gusts++;
    const toPlayer = 52 / 16;
    S.lastGust = { n: S.gusts, str: Math.round(g.str * 100) / 100, at: Math.round(now * 10) / 10, toPlayer: Math.round(toPlayer * 10) / 10 };
    const ev = { state: 'gust', n: S.gusts, strength: g.str, dir: S.dir.slice(), seconds: toPlayer };
    for (const f of S.listeners) { try { f(ev); } catch (err) { warn('listener', err); } }
    if (H.game) { try { H.game.emit('wind', ev); } catch (err) { warn('emit', err); } }
  }
  function stepGust(dt) {
    const g = S.gust;
    if (g.live) {
      g.front += g.speed * dt;
      const a = along(S.origin) + along([S.player[0], S.player[2]]);
      if (g.front > a + 70) { g.live = false; g.str = 0; S.nextAt = S.t + 1 + S.r() * 2; }
    } else if (S.t >= S.nextAt) startGust(S.t);
  }
  function gustHere() { const a = along(planetXZ(S.player)); return K.gustAt(S.gust, a); }

  // ------------------------------------------------------------------ meshes made in code
  function meshFrom(name, pos, col, idx, scene) {
    const m = new B.Mesh(name, scene);
    const vd = new B.VertexData();
    vd.positions = pos; vd.indices = idx; vd.colors = col;
    const n = new Array(pos.length); for (let i = 0; i < pos.length; i += 3) { n[i] = 0; n[i + 1] = 1; n[i + 2] = 0; }
    vd.normals = n;
    vd.applyToMesh(m);
    m.isPickable = false; m.checkCollisions = false; m.alwaysSelectAsActiveMesh = true; m.doNotSyncBoundingInfo = true;
    return m;
  }
  function plain(name, scene, o = {}) {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseColor = new B.Color3(1, 1, 1); m.specularColor = new B.Color3(0, 0, 0); m.emissiveColor = new B.Color3(0.05, 0.07, 0.04);
    m.backFaceCulling = false; m.twoSidedLighting = true;
    if (o.alpha !== undefined) m.alpha = o.alpha;
    return m;
  }
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  /** A blade: base width w, height h, bent a little by `lean`, at angle `yaw` round the clump's middle at `off` out. */
  function blade(P_, C_, I_, x, z, yaw, w, h, lean, base, tip) {
    const c = Math.cos(yaw), s = Math.sin(yaw), v0 = P_.length / 3;
    const ring = [[w, 0, 0, 0], [w * 0.7, 0.5, lean * 0.5, 0.35], [w * 0.1, 1, lean, 1]]; // (half width, height frac, lean, colour frac)
    for (const [hw, hf, ln, cf] of ring) {
      const col = lerp3(base, tip, cf);
      const lx = ln * h; // (leans along the blade's facing)
      for (const sgn of hw > w * 0.2 ? [-1, 1] : [0]) {
        const px = sgn * hw * 0.5, pz = lx;
        P_.push(x + px * c + pz * s, hf * h, z - px * s + pz * c); C_.push(col[0], col[1], col[2], 1);
      }
    }
    // two bottom vertices (0,1), two mid (2,3), one tip (4)
    I_.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2, v0 + 2, v0 + 3, v0 + 4);
  }
  function grassMesh(scene) {
    const Pp = [], C = [], I = [], r = K.rng(11);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r() * 0.6, d = 0.05 + r() * 0.13;
      blade(Pp, C, I, Math.cos(a) * d, Math.sin(a) * d, a + (r() - 0.5) * 1.2, 0.07 + r() * 0.03, 0.36 + r() * 0.26, 0.25 + r() * 0.3, [0.16, 0.32, 0.1], [0.55 + r() * 0.12, 0.74, 0.25]);
    }
    return meshFrom('wind-grass', Pp, C, I, scene);
  }
  const FLOWERS = [[0.98, 0.98, 0.94], [1, 0.84, 0.2], [0.96, 0.5, 0.72], [0.62, 0.5, 0.95]];
  function flowerMesh(scene, k) {
    const Pp = [], C = [], I = [], col = FLOWERS[k];
    blade(Pp, C, I, 0, 0, 0.4 * k, 0.03, 0.5, 0.05, [0.2, 0.4, 0.12], [0.3, 0.55, 0.18]);
    const v0 = Pp.length / 3, cy = 0.5, n = 6;
    Pp.push(0, cy + 0.015, 0); C.push(1, 0.85, 0.25, 1);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      Pp.push(Math.cos(a) * 0.075, cy + 0.0, Math.sin(a) * 0.075); C.push(col[0], col[1], col[2], 1);
    }
    for (let i = 0; i < n; i++) I.push(v0, v0 + 1 + i, v0 + 1 + ((i + 1) % n));
    return meshFrom(`wind-flower-${k}`, Pp, C, I, scene);
  }

  // ------------------------------------------------------------------ the grass round you
  const G = { cells: new Map(), meshes: null, at: null, built: 0, count: 0, flowers: 0, dirty: true, lastBuild: -9, cellSize: 2 };
  const CELL = 2;
  function dropGrass() {
    if (G.meshes) { for (const m of G.meshes) { try { m.material && m.material.dispose(); m.dispose(); } catch { /* gone */ } } }
    G.meshes = null; G.cells.clear(); G.at = null; G.count = 0; G.flowers = 0; G.dirty = true;
  }
  function makeGrass(scene) {
    const mats = [];
    const meshes = [grassMesh(scene), ...FLOWERS.map((_, k) => flowerMesh(scene, k))];
    meshes.forEach((m, i) => {
      const mat = plain(i ? `wind-flower-mat-${i}` : 'wind-grass-mat', scene); mats.push(mat);
      m.material = mat; m.receiveShadows = S.tier === 'desktop'; m.isVisible = true;
      mark(m, 'grass', { decor: true });
      m.thinInstanceSetBuffer('matrix', new Float32Array(16), 16, false);
      m.thinInstanceCount = 0;
    });
    G.meshes = meshes;
  }
  /** The accepted clumps of one cell: a Float32Array of [x, y, z, scale, yaw, tint, flower] in the world around you. */
  function buildCell(ix, iz, spec) {
    const raw = K.cellClumps(ix, iz, CELL, K.GRASS_PER_M2 * spec.grass, spec.flowers);
    const out = [];
    for (const c of raw) {
      const l = localOf(c[0], c[1]);
      const mat = H.terrain.materialAt(l[0], l[2]);
      if (mat !== 'grass') continue; // roads, sand, rock and snow stay bare; the verges are grass
      const y = groundAt(l[0], l[2]);
      if (y === null) continue;
      const sea = H.water && H.water.surfaceAt ? H.water.surfaceAt(l[0], l[2]) : null;
      if (sea !== null && sea !== undefined && y < sea + 0.35) continue;
      out.push(l[0], y - 0.02, l[2], c[2], c[3], c[4], c[5]);
    }
    return Float32Array.from(out);
  }
  const key = (ix, iz) => ix * 65536 + iz;
  const mtx = new B.Matrix();
  function updateGrass(dt) {
    const w = W();
    if (!S.grassOn || !w || !w.scene || !(S.spec.grass > 0) || !H.terrain || !H.terrain.active) return;
    if (!G.meshes) makeGrass(w.scene);
    const pxz = planetXZ(S.player);
    const reach = S.spec.reach, build = reach * 1.25;
    // new cells round the player, within a time budget (a drive reaches new ground every frame, a walk hardly ever)
    const t0 = performance.now(), cx = Math.floor(pxz[0] / CELL), cz = Math.floor(pxz[1] / CELL), n = Math.ceil(build / CELL);
    let made = 0, over = false;
    for (let r = 0; r <= n && !over; r++) {
      for (let dz = -r; dz <= r && !over; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (dx * dx + dz * dz > n * n) continue;
          const ix = cx + dx, iz = cz + dz, k = key(ix, iz);
          if (G.cells.has(k)) continue;
          G.cells.set(k, { ix, iz, data: buildCell(ix, iz, S.spec) });
          made++; G.dirty = true;
          if (performance.now() - t0 > (S.tier === 'phone' || S.tier === 'low' ? 1.8 : 3.5)) { over = true; break; }
        }
      }
    }
    // the cells far behind are let go
    if (G.cells.size > (n * 2 + 1) ** 2 * 1.4) for (const [k, c] of G.cells) if (Math.abs(c.ix - cx) > n + 3 || Math.abs(c.iz - cz) > n + 3) G.cells.delete(k);
    const moved = !G.at || Math.hypot(S.player[0] - G.at[0], S.player[2] - G.at[1]) > 5;
    if ((G.dirty && (moved || made || !G.built)) && S.t - G.lastBuild > 0.12) fillBuffers(build);
  }
  function fillBuffers(build) {
    const px = S.player[0], pz = S.player[2], b2 = build * build;
    const bufs = [[], [], [], [], []];
    for (const c of G.cells.values()) {
      const d = c.data;
      for (let i = 0; i < d.length; i += 7) {
        const dx = d[i] - px, dz = d[i + 2] - pz;
        if (dx * dx + dz * dz > b2) continue;
        const f = d[i + 6], s = d[i + 3], cs = Math.cos(d[i + 4]) * s, sn = Math.sin(d[i + 4]) * s;
        (bufs[f] || bufs[0]).push(cs, 0, -sn, 0, 0, s, 0, 0, sn, 0, cs, 0, d[i], d[i + 1], d[i + 2], 1, d[i + 5]);
      }
    }
    let total = 0;
    G.meshes.forEach((m, k) => {
      const src = bufs[k], cnt = src.length / 17;
      const arr = new Float32Array(Math.max(1, cnt) * 16), col = k === 0 ? new Float32Array(Math.max(1, cnt) * 4) : null;
      for (let j = 0; j < cnt; j++) {
        for (let q = 0; q < 16; q++) arr[j * 16 + q] = src[j * 17 + q];
        if (col) { const t = 0.8 + src[j * 17 + 16] * 0.4; col[j * 4] = t; col[j * 4 + 1] = t; col[j * 4 + 2] = t; col[j * 4 + 3] = 1; }
      }
      m.thinInstanceSetBuffer('matrix', arr, 16, true);
      if (col) m.thinInstanceSetBuffer('color', col, 4, true);
      m.thinInstanceCount = cnt;
      total += cnt;
    });
    G.count = bufs[0].length / 17; G.flowers = total - G.count; G.at = [px, pz]; G.dirty = false; G.built++; G.lastBuild = S.t;
  }

  // ------------------------------------------------------------------ pushers: you and vehicles
  function updatePushers() {
    const w = W(), list = [];
    const p = w && w.player;
    const driving = p && (p._vehRider || p.seated);
    if (p && p.alive !== false && !driving) list.push({ x: p.x, z: p.z, r: 1.5, s: Math.min(1, 0.35 + Math.hypot(p.vx || 0, p.vz || 0) * 0.12), d: 0 });
    if (w && w.vehicles) {
      for (const e of w.vehicles) {
        if (!e.alive) continue;
        const dx = e.x - S.player[0], dz = e.z - S.player[2], d = Math.hypot(dx, dz);
        if (d < S.spec.reach) list.push({ x: e.x, z: e.z, r: 3.2, s: 1, d });
      }
    }
    list.sort((a, b) => a.d - b.d);
    for (let i = 0; i < 4; i++) {
      const q = U.push[i], e = i < S.spec.push ? list[i] : null;
      if (e) { q[0] = e.x; q[1] = e.z; q[2] = e.r; q[3] = e.s; } else { q[0] = 0; q[1] = 0; q[2] = 1; q[3] = 0; }
    }
    S.pushers = list.slice(0, 4);
  }

  // ------------------------------------------------------------------ petals and leaves
  const PT = { mesh: null, items: [], n: 0 };
  function makePetals(scene) {
    const n = S.spec.petals;
    if (!n || S.opts.petals === false) return;
    const Pp = [-0.05, 0, -0.03, 0.05, 0, -0.03, 0, 0, 0.06], C = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], I = [0, 1, 2];
    const m = meshFrom('wind-petals', Pp, C, I, scene);
    m.material = plain('wind-petals-mat', scene); m.material.emissiveColor = new B.Color3(0.2, 0.18, 0.18);
    m.thinInstanceSetBuffer('matrix', new Float32Array(n * 16), 16, false);
    m.thinInstanceSetBuffer('color', new Float32Array(n * 4), 4, false);
    m.thinInstanceCount = 0;
    PT.mesh = m; PT.n = n; PT.items = [];
    const cols = [[1, 0.78, 0.86], [1, 1, 0.95], [0.97, 0.82, 0.3], [0.62, 0.78, 0.32], [0.82, 0.55, 0.25]];
    for (let i = 0; i < n; i++) PT.items.push({ life: 0, max: 5, x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, a: 0, spin: 0, col: cols[i % cols.length], phase: Math.random() * 6 });
    PT.buf = new Float32Array(n * 16); PT.cbuf = new Float32Array(n * 4);
  }
  function updatePetals(dt) {
    if (!PT.mesh) return;
    const gl = gustHere(), px = S.player[0], pz = S.player[2];
    let live = 0;
    const dirx = S.dir[0], dirz = S.dir[1];
    for (const p of PT.items) {
      if (p.life <= 0) {
        // born upwind of the player, more of them in a gust
        if (Math.random() < dt * (0.25 + gl * 9)) {
          const a = Math.random() * Math.PI * 2, d = 6 + Math.random() * 22;
          p.x = px - dirx * (8 + Math.random() * 14) + Math.cos(a) * d * 0.5; p.z = pz - dirz * (8 + Math.random() * 14) + Math.sin(a) * d * 0.5;
          const g = groundAt(p.x, p.z);
          if (g === null) continue;
          p.y = g + 0.6 + Math.random() * 3.2; p.vx = dirx * 2; p.vz = dirz * 2; p.vy = 0; p.max = p.life = 4.5 + Math.random() * 3; p.spin = (Math.random() - 0.5) * 8; p.a = Math.random() * 6;
        }
        continue;
      }
      p.life -= dt;
      const sp = 1.4 + 8 * gl;
      p.vx += (dirx * sp - p.vx) * Math.min(1, dt * 1.6); p.vz += (dirz * sp - p.vz) * Math.min(1, dt * 1.6);
      p.vy += ((-0.5 + Math.sin(S.t * 2 + p.phase) * 0.8 + gl * 1.6) - p.vy) * Math.min(1, dt * 2);
      p.x += (p.vx - dirz * Math.sin(S.t * 1.7 + p.phase) * 0.9) * dt; p.z += (p.vz + dirx * Math.sin(S.t * 1.7 + p.phase) * 0.9) * dt; p.y += p.vy * dt; p.a += p.spin * dt;
      const g = groundAt(p.x, p.z);
      if (g !== null && p.y < g + 0.08) { p.y = g + 0.08; p.vy = 0; p.vx *= 0.7; p.vz *= 0.7; }
      const u = p.life / p.max, sc = Math.min(1, u * 4, (1 - u) * 6) * 1.5;
      if (sc <= 0) continue;
      const cs = Math.cos(p.a) * sc, sn = Math.sin(p.a) * sc, o = live * 16;
      const b = PT.buf;
      b[o] = cs; b[o + 1] = 0; b[o + 2] = -sn; b[o + 3] = 0; b[o + 4] = 0; b[o + 5] = sc; b[o + 6] = 0; b[o + 7] = 0; b[o + 8] = sn; b[o + 9] = 0; b[o + 10] = cs; b[o + 11] = 0; b[o + 12] = p.x; b[o + 13] = p.y; b[o + 14] = p.z; b[o + 15] = 1;
      const c = live * 4; PT.cbuf[c] = p.col[0]; PT.cbuf[c + 1] = p.col[1]; PT.cbuf[c + 2] = p.col[2]; PT.cbuf[c + 3] = 1;
      live++;
    }
    PT.mesh.thinInstanceBufferUpdated('matrix'); PT.mesh.thinInstanceBufferUpdated('color');
    PT.mesh.thinInstanceCount = live;
    PT.live = live;
  }

  // ------------------------------------------------------------------ palms on the beach (built here: a bent trunk and eight fronds)
  const PM = { mesh: null, pts: [], at: [], done: false };
  function palmMesh(scene) {
    const Pp = [], C = [], I = [], H_ = 6.2, lean = 0.9, sides = 6, rings = 8;
    for (let i = 0; i < rings; i++) {
      const t = i / (rings - 1), cx = lean * t * t, cy = t * H_, rad = 0.26 * (1 - 0.4 * t) + (i === 0 ? 0.06 : 0);
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        Pp.push(cx + Math.cos(a) * rad, cy, Math.sin(a) * rad);
        const band = i % 2 ? 0.8 : 1; C.push(0.42 * band, 0.3 * band, 0.19 * band, 1);
      }
    }
    for (let i = 0; i < rings - 1; i++) for (let s = 0; s < sides; s++) {
      const a = i * sides + s, b = i * sides + ((s + 1) % sides), c = (i + 1) * sides + s, d = (i + 1) * sides + ((s + 1) % sides);
      I.push(a, b, c, b, d, c);
    }
    const topX = lean, topY = H_, fronds = 8, segs = 6;
    for (let f = 0; f < fronds; f++) {
      const a = (f / fronds) * Math.PI * 2 + (f % 2) * 0.2, ca = Math.cos(a), sa = Math.sin(a), v0 = Pp.length / 3;
      const len = 2.5 + (f % 3) * 0.25;
      for (let s = 0; s <= segs; s++) {
        const u = s / segs, out = u * len, up = Math.sin(u * Math.PI * 0.75) * 1.1 - u * u * 0.5, w = 0.55 * Math.sin(Math.PI * Math.min(1, u * 0.9 + 0.1)) + 0.02;
        const bx = topX + ca * out, by = topY + 0.2 + up, bz = sa * out, px = -sa * w * 0.5, pz = ca * w * 0.5;
        const col = lerp3([0.13, 0.34, 0.1], [0.4, 0.66, 0.2], u);
        Pp.push(bx + px, by - u * 0.12, bz + pz, bx - px, by - u * 0.12, bz - pz); C.push(col[0], col[1], col[2], 1, col[0], col[1], col[2], 1);
      }
      for (let s = 0; s < segs; s++) { const a0 = v0 + s * 2; I.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
    }
    return meshFrom('wind-palm', Pp, C, I, scene);
  }
  function placePalms(scene) {
    const n = S.spec.palms;
    if (!n || S.opts.palms === false || !H.terrain || !H.terrain.active) return;
    const spot = S.opts.palmsAt || [52, 0, 26, 32]; // [x, z, half width, half depth]: the beach, round the pier
    const r = K.rng(31), pts = [];
    for (let tries = 0; tries < 400 && pts.length < n; tries++) {
      const px = spot[0] + (r() * 2 - 1) * spot[2], pz = spot[1] + (r() * 2 - 1) * spot[3];
      const l = localOf(px, pz);
      if (H.terrain.materialAt(l[0], l[2]) !== 'sand') continue;
      const y = groundAt(l[0], l[2]);
      const sea = H.water && H.water.surfaceAt ? H.water.surfaceAt(l[0], l[2]) : -1.5;
      if (y === null || y < (sea ?? -1.5) + 0.7) continue;
      if ((H.terrain.slopeAt(l[0], l[2]) ?? 0) > 14) continue;
      if (px > 53 && Math.abs(pz) < 7) continue;           // the pier's foot, its lamps and the sign
      if (px > 38 && px < 62 && Math.abs(pz - (-18)) < 6) continue; // the fuel dump
      if (pts.some((q) => Math.hypot(q[0] - px, q[1] - pz) < 7)) continue;
      pts.push([px, pz, r() * Math.PI * 2, 0.85 + r() * 0.4]);
    }
    PM.pts = pts;
    if (!pts.length) return;
    const m = palmMesh(scene);
    m.material = plain('wind-palm-mat', scene); m.receiveShadows = true;
    mark(m, 'palm', { decor: true });
    PM.mesh = m;
    refreshPalms();
    if (w_shadows()) { try { w_shadows().addShadowCaster(m); } catch { /* none */ } }
  }
  const w_shadows = () => (W() && W().shadows) || null;
  function refreshPalms() {
    if (!PM.mesh) return;
    const arr = new Float32Array(PM.pts.length * 16);
    PM.pts.forEach((p, i) => {
      const l = localOf(p[0], p[1]), y = groundAt(l[0], l[2]) ?? l[1];
      const s = p[3], cs = Math.cos(p[2]) * s, sn = Math.sin(p[2]) * s;
      arr.set([cs, 0, -sn, 0, 0, s, 0, 0, sn, 0, cs, 0, l[0], y - 0.12, l[2], 1], i * 16);
    });
    PM.mesh.thinInstanceSetBuffer('matrix', arr, 16, true);
    PM.mesh.thinInstanceCount = PM.pts.length;
  }

  // ------------------------------------------------------------------ the sound of a gust: heard as it is seen
  const AU = { node: null, g: null, f: null, tried: false };
  function noiseBuffer(ctx) {
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.96 + (Math.random() * 2 - 1) * 0.04; d[i] = last * 6; } // (brown-ish: air, not hiss)
    return buf;
  }
  function updateSound() {
    const ctx = H.audio && H.audio.context;
    if (!ctx || ctx.state !== 'running') return;
    if (!AU.node && !AU.tried) {
      AU.tried = true;
      try {
        const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        src.buffer = noiseBuffer(ctx); src.loop = true; f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.7; g.gain.value = 0;
        src.connect(f).connect(g).connect(H.audio.ambience || H.audio.background || H.audio.master);
        src.start();
        AU.node = src; AU.g = g; AU.f = f;
      } catch (err) { warn('sound', err); }
    }
    if (!AU.g) return;
    const gl = S.here;
    AU.g.gain.setTargetAtTime(gl * 0.5, ctx.currentTime, 0.12);
    AU.f.frequency.setTargetAtTime(380 + gl * 700, ctx.currentTime, 0.2);
    S.heard = gl;
  }

  // ------------------------------------------------------------------ every frame
  function frame(dt) {
    if (!S.on) return;
    const w = W();
    if (!w || !w.scene || !w.player) return;
    try {
      dt = Math.min(dt, 0.1);
      S.t += dt;
      S.player = [w.player.x, w.player.y, w.player.z];
      const o = frameOn() ? P.frame.toPlanet([0, 0, 0]) : [0, 0, 0];
      S.origin = [o[0], o[2]];
      stepGust(dt);
      S.here = Math.min(1, gustHere());
      const breath = K.breath(S.t) * 0.55;
      const g = S.gust;
      U.A = [S.origin[0], S.origin[1], S.t, breath];
      U.B = [g.front, g.len, g.live ? g.str : 0, 0];
      U.C = [S.dir[0], S.dir[1], S.spec.reach, 0];
      U.Q = [S.player[0], S.player[2]];
      if (!PM.done && H.terrain && H.terrain.active) { PM.done = true; placePalms(w.scene); }
      updatePushers();
      updateGrass(dt);
      updatePetals(dt);
      updateSound();
      publish();
    } catch (err) { warn('frame', err); }
  }
  function publish() {
    window.__wind = {
      on: S.on, tier: S.tier, gusts: S.gusts, live: S.gust.live, strength: Math.round((S.gust.live ? S.gust.str : 0) * 100) / 100, here: Math.round(S.here * 100) / 100,
      dir: S.dir.slice(), grass: G.count, flowers: G.flowers, grassDensity: S.spec.grass, grassReach: S.spec.reach, petals: PT.live || 0, petalsMax: PT.n, palms: PM.pts.length,
      pushers: S.pushers.length, plugin: pluginOk, last: S.lastGust, heard: Math.round((S.heard || 0) * 100) / 100, t: Math.round(S.t * 10) / 10,
    };
  }

  // ------------------------------------------------------------------ the feature
  function apply(value) {
    const w = W();
    if (!w || !w.scene) return;
    remove();
    S.opts = value && typeof value === 'object' ? value : {};
    S.tier = K.tierFor(H.quality ? H.quality() : 'auto', H.device);
    S.spec = K.TIERS[S.tier];
    S.r = K.rng(7);
    const d = Array.isArray(S.opts.dir) && S.opts.dir.length >= 2 ? S.opts.dir : [0.93, 0.37];
    const l = Math.hypot(d[0], d[1]) || 1; S.dir = [d[0] / l, d[1] / l];
    S.on = true; S.t = 0; S.nextAt = S.opts.gusts === false ? 1e9 : 1.2; S.gusts = 0; S.gust = { front: -1e5, len: 24, str: 0, speed: 16, live: false };
    S.grassOn = S.opts.grass !== false;
    // The meshes already there that are wind's (the scatter marks its own): their materials learn it.
    for (const m of w.scene.meshes) if (m.metadata && m.metadata.wind && m.material) { try { m.material.markAsDirty(B.Material.MiscDirtyFlag); } catch { /* next frame */ } }
    PM.done = false;
    makePetals(w.scene);
    publish();
  }
  function remove() {
    S.on = false;
    dropGrass();
    for (const m of [PT.mesh, PM.mesh]) if (m) { try { m.material && m.material.dispose(); m.dispose(); } catch { /* gone */ } }
    PT.mesh = null; PT.items = []; PT.live = 0; PT.n = 0; PM.mesh = null; PM.pts = [];
    if (AU.g) { try { AU.g.gain.value = 0; AU.node.stop(); } catch { /* none */ } }
    AU.node = null; AU.g = null; AU.f = null; AU.tried = false;
    try { delete window.__wind; } catch { /* none */ }
  }
  H.features.register('wind', {
    apply(value) { apply(value); },
    change(value) { apply(value); },
    dispose() { remove(); },
    codex: {
      title: 'Wind', group: 'World features',
      what: 'The island moves on its own: trees, palms, bushes and grass sway in a breath that is always there and in gusts that cross the island with the wind (heard as they are seen), meadow grass and wildflowers are pushed aside where you and vehicles pass, and petals lift in the gusts. Follows the Graphics setting (a phone draws 30 percent of the grass and no petals).',
      value: true,
      fields: [['dir', '[x, z]: where the wind blows to', '[0.93, 0.37]'], ['gusts', 'false: only the breath', 'true'], ['grass', 'false: no grass and flowers', 'true'], ['petals', 'false: no petals', 'true'], ['palms', 'false: no palms on the beach', 'true']],
    },
  });
  H.hooks.world.push({ leave() { if (S.on) remove(); } });
  H.hooks.frame.push(frame);
  if (P && P.frame && P.frame.onRebase) {
    P.frame.onRebase((tr) => {
      if (!S.on) return;
      try {
        // what is kept in the world around you goes with the frame (the grass keeps its places, the palms are set again)
        for (const c of G.cells.values()) { const d = c.data; for (let i = 0; i < d.length; i += 7) { const a = tr.point([d[i], d[i + 1], d[i + 2]]); d[i] = a[0]; d[i + 1] = a[1]; d[i + 2] = a[2]; } }
        for (const p of PT.items) if (p.life > 0) { const a = tr.point([p.x, p.y, p.z]); p.x = a[0]; p.y = a[1]; p.z = a[2]; }
        const pl = W() && W().player; if (pl) S.player = [pl.x, pl.y, pl.z];
        G.dirty = true; G.lastBuild = -9; G.at = null;
        if (G.meshes) fillBuffers(S.spec.reach * 1.25);
        refreshPalms();
      } catch (err) { warn('rebase', err); }
    });
  }
  // A terrain edit (a crater, a dig) changes the ground the grass stands on: grow it again.
  H.hooks.game.push((game) => { try { game.on('terrain', () => { G.cells.clear(); G.dirty = true; }); } catch { /* none */ } });
  if (H.setQuality && !H.setQuality._windy) {
    const base = H.setQuality;
    const wrapped = function (q) {
      const r = base.apply(this, arguments);
      try { if (S.on) { const o = S.opts; apply(o); } } catch (err) { warn('quality', err); }
      return r;
    };
    wrapped._windy = true;
    H.setQuality = wrapped;
  }

  H.wind = {
    get on() { return S.on; }, get tier() { return S.tier; }, get dir() { return S.dir.slice(); }, get gust() { return { ...S.gust }; },
    mark, gustHere: () => S.here, on_: undefined,
    /** fn({ state: 'gust', n, strength, dir, seconds }) at the start of every gust. */
    onGust(fn) { S.listeners.push(fn); return () => { const i = S.listeners.indexOf(fn); if (i >= 0) S.listeners.splice(i, 1); }; },
    /** The grass's clumps and the live state (for the playtest and the console). */
    state: () => ({ ...(window.__wind || {}), cells: G.cells.size }),
    /** Starts a gust now (the playtest's, the editor's). */
    gustNow() { if (S.on) startGust(S.t); },
    _: { S, G, PT, PM, U, K },
  };
  delete H.wind.on_;
})();
