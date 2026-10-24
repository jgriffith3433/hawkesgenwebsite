// Terrain: ground you can drive across, dig into and reshape. Owns config.terrain (H.features) and provides H.terrain
// (heightAt, normalAt, dig, ...) to everyone else: water, creatures, vehicles, mayhem.
//   - the shape comes from words (terrain-core.js: hills, mountain, island, canyon, ...), stamps (add) and edits
//   - meshes: chunks of 32x32 cells, each with lower-detail copies for far away (LOD) and a skirt that hides seams
//   - ground materials: grass, dirt, rock, snow, sand blended by height and slope, painted layers on top; procedural
//     stand-ins, real textures by asset name when the game has them (config.terrain.textures or terrain-<layer>)
//   - trees, rocks and bushes scattered as thin instances (models by name when there are any)
//   - physics: on Havok, a heightfield body; on the old box physics, things are kept on the surface after each step
//   - edits made while playing (shovel, explosions, scripts with share: true) are synced through H.sync
// docs/world/45-terrain.md and docs/api/45-terrain.md are what the assistant reads.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const T = window.HawkesTerrainCore;
  const L = H.lib;
  const CH = 64; // cells per chunk
  const LODS = [1, 2, 4, 8]; // sample step of each level of detail
  const MAX_SLOPE_COS = Math.cos(50 * Math.PI / 180); // walkers can't climb steeper than this on the old physics
  const FAR = { min: [0, -1e9, 0], max: [0, -1e9, 0] };
  const SHARED_MAX = 2000; // edits kept for players who join late
  let cur = null; // the live terrain (one per world)

  // ------------------------------------------------------------------ looks: textures and colors
  function noiseTexture(scene, name, color, seed) {
    const S = 256;
    const tex = new B.DynamicTexture(name, { width: S, height: S }, scene, true);
    const ctx = tex.getContext();
    const img = ctx.createImageData(S, S);
    if (!img || !img.data) return tex; // no 2D canvas (tests): a plain texture
    const nz = T.makeNoise(seed);
    const c = color ? L.hex(color) : new B.Color3(1, 1, 1);
    // Tileable: noise sampled on a torus (four corners blended).
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const n = (fx, fy) => 0.55 * nz(fx * 8, fy * 8) + 0.3 * nz(fx * 24 + 5, fy * 24 + 9) + 0.15 * nz(fx * 64 + 3, fy * 64 + 1);
      const val = n(u, v) * (1 - u) * (1 - v) + n(u - 1, v) * u * (1 - v) + n(u, v - 1) * (1 - u) * v + n(u - 1, v - 1) * u * v;
      const k = Math.max(0, Math.min(1, 0.86 + val * 0.5));
      const i = (y * S + x) * 4;
      img.data[i] = Math.round(255 * Math.min(1, c.r * k)); img.data[i + 1] = Math.round(255 * Math.min(1, c.g * k)); img.data[i + 2] = Math.round(255 * Math.min(1, c.b * k)); img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    tex.update();
    tex.wrapU = tex.wrapV = B.Texture.WRAP_ADDRESSMODE;
    return tex;
  }
  // Assets by id or name, and by word (H.assets): the ground's textures and the scatter's models.
  const isImage = (ref) => { const a = H.assets.get(ref); return Boolean(a && a.type === 'image'); };
  const isMesh = (ref) => { const a = H.assets.get(ref); return Boolean(a && a.type === 'model'); };
  /** The asset each ground layer uses, if the game has one: config.terrain.textures.<layer> (an id or a name), or the
   *  game's image for "terrain <layer>" / "<layer>" ("grass", "sand"...). */
  function layerAssets(cfg) {
    const out = {};
    for (const l of T.LAYERS) { const n = (cfg.textures[l] && isImage(cfg.textures[l]) ? cfg.textures[l] : null) || H.assets.pick(`terrain ${l}`, { kind: 'image' }); if (n) out[l] = n; }
    return out;
  }

  /** Blends real textures by the ground weights (a StandardMaterial plugin: lights, shadows and fog still work). */
  class SplatPlugin extends B.MaterialPluginBase {
    constructor(material, textures, tile) {
      super(material, 'TerrainSplat', 200, { TERRAIN_SPLAT: false });
      this.textures = textures; this.tile = tile;
      this._enable(true);
    }
    getClassName() { return 'TerrainSplatPlugin'; }
    prepareDefines(defines) { defines.TERRAIN_SPLAT = true; }
    isReadyForSubMesh() { return this.textures.every((t) => !t || t.isReady()); }
    getAttributes(attributes) { attributes.push('splatA', 'splatB'); }
    getSamplers(samplers) { for (let i = 0; i < 5; i++) samplers.push(`tSplat${i}`); }
    getUniforms() { return { ubo: [{ name: 'terrainTile', size: 1, type: 'float' }], fragment: '#ifdef TERRAIN_SPLAT\nuniform float terrainTile;\n#endif\n' }; }
    bindForSubMesh(ubo) {
      ubo.updateFloat('terrainTile', this.tile);
      for (let i = 0; i < 5; i++) ubo.setTexture(`tSplat${i}`, this.textures[i]);
    }
    getCustomCode(type) {
      if (type === 'vertex') return {
        CUSTOM_VERTEX_DEFINITIONS: '#ifdef TERRAIN_SPLAT\nattribute vec4 splatA;\nattribute vec4 splatB;\nvarying vec4 vSplatA;\nvarying vec4 vSplatB;\nvarying vec2 vTerrainXZ;\n#endif\n',
        CUSTOM_VERTEX_MAIN_END: '#ifdef TERRAIN_SPLAT\nvSplatA = splatA;\nvSplatB = splatB;\nvTerrainXZ = worldPos.xz;\n#endif\n',
      };
      if (type === 'fragment') return {
        CUSTOM_FRAGMENT_DEFINITIONS: '#ifdef TERRAIN_SPLAT\nvarying vec4 vSplatA;\nvarying vec4 vSplatB;\nvarying vec2 vTerrainXZ;\nuniform sampler2D tSplat0;\nuniform sampler2D tSplat1;\nuniform sampler2D tSplat2;\nuniform sampler2D tSplat3;\nuniform sampler2D tSplat4;\n#endif\n',
        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: '#ifdef TERRAIN_SPLAT\nvec2 tUV = vTerrainXZ / terrainTile;\nbaseColor.rgb = texture2D(tSplat0, tUV).rgb * vSplatA.x + texture2D(tSplat1, tUV).rgb * vSplatA.y + texture2D(tSplat2, tUV).rgb * vSplatA.z + texture2D(tSplat3, tUV).rgb * vSplatA.w + texture2D(tSplat4, tUV).rgb * vSplatB.x;\n#endif\n',
      };
      return null;
    }
  }

  function makeMaterial(t) {
    const scene = t.scene, cfg = t.cfg;
    const m = new B.StandardMaterial('terrain', scene);
    m.specularColor = new B.Color3(0.04, 0.04, 0.04);
    t.textures = [];
    const assets = layerAssets(cfg);
    t.splat = Object.keys(assets).length > 0;
    if (t.splat) {
      // Real textures where the game has them, a colored stand-in for the other layers.
      const list = T.LAYERS.map((l, i) => {
        if (assets[l]) { try { const tx = new B.Texture(L.assetUrl(assets[l]), scene, false, true, B.Texture.TRILINEAR_SAMPLINGMODE); tx.wrapU = tx.wrapV = B.Texture.WRAP_ADDRESSMODE; return tx; } catch { /* stand-in below */ } }
        return noiseTexture(scene, `terrain-${l}`, cfg.colors[l] || T.COLORS[l], 11 + i);
      });
      t.textures = list;
      try { t.plugin = new SplatPlugin(m, list, cfg.tile); } catch (err) { H.report(err, 'terrain'); t.splat = false; }
    }
    if (!t.splat) {
      const d = noiseTexture(scene, 'terrain-detail', null, 7);
      m.diffuseTexture = d;
      t.textures.push(d);
    }
    return m;
  }

  // ------------------------------------------------------------------ shading: normals, layer weights, colors per sample
  function shadeAll(t) { shade(t, { ix0: 0, ix1: t.f.n - 1, iz0: 0, iz1: t.f.n - 1 }); }
  function shade(t, box) {
    const f = t.f, n = f.n;
    const cols = T.LAYERS.map((l) => L.hex(t.cfg.colors[l] || T.COLORS[l]));
    const w = new Float32Array(5);
    for (let iz = Math.max(0, box.iz0); iz <= Math.min(n - 1, box.iz1); iz++) for (let ix = Math.max(0, box.ix0); ix <= Math.min(n - 1, box.ix1); ix++) {
      const i = iz * n + ix;
      T.sampleNormal(f, ix, iz, t.normals, i * 3);
      T.weightsAt(f, ix, iz, w, 0, t.normals[i * 3 + 1]);
      for (let k = 0; k < 5; k++) t.weights[i * 5 + k] = w[k];
      const v = t.tint[i];
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < 5; k++) { r += cols[k].r * w[k]; g += cols[k].g * w[k]; b += cols[k].b * w[k]; }
      t.colors[i * 3] = r * v; t.colors[i * 3 + 1] = g * v; t.colors[i * 3 + 2] = b * v;
    }
  }

  // ------------------------------------------------------------------ meshes: chunks, levels of detail, skirts
  function chunkGeometry(m) {
    // Indices for an m x m grid plus a skirt (the border ring copied downward, both sides drawn).
    const idx = [];
    for (let j = 0; j < m - 1; j++) for (let i = 0; i < m - 1; i++) {
      const a = j * m + i, b = a + 1, c = a + m, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    const ring = perimeter(m);
    const base = m * m, k = ring.length;
    for (let r = 0; r < k; r++) {
      const a = ring[r], b = ring[(r + 1) % k], a2 = base + r, b2 = base + (r + 1) % k;
      idx.push(a, b, b2, a, b2, a2, a, b2, b, a, a2, b2);
    }
    return { idx: new Uint32Array(idx), ring };
  }
  function perimeter(m) {
    const out = [];
    for (let i = 0; i < m - 1; i++) out.push(i);
    for (let j = 0; j < m - 1; j++) out.push(j * m + m - 1);
    for (let i = m - 1; i > 0; i--) out.push((m - 1) * m + i);
    for (let j = m - 1; j > 0; j--) out.push(j * m);
    return out;
  }
  const geoCache = new Map();
  function geometryFor(m) { if (!geoCache.has(m)) geoCache.set(m, chunkGeometry(m)); return geoCache.get(m); }

  /** Fills a chunk level's vertex arrays from the field (positions local to the terrain's center). */
  function fillLevel(t, ci, cj, step, arr) {
    const f = t.f, n = f.n, m = CH / step + 1;
    const { ring } = geometryFor(m);
    const cx = t.cfg.center[0], cz = t.cfg.center[1];
    const skirt = Math.max(2, f.cell * step * 2);
    const put = (v, ix, iz, drop) => {
      const i = iz * n + ix;
      arr.pos[v * 3] = f.x0 + ix * f.cell - cx; arr.pos[v * 3 + 1] = f.y + f.heights[i] - drop; arr.pos[v * 3 + 2] = f.z0 + iz * f.cell - cz;
      arr.nrm[v * 3] = t.normals[i * 3]; arr.nrm[v * 3 + 1] = t.normals[i * 3 + 1]; arr.nrm[v * 3 + 2] = t.normals[i * 3 + 2];
      if (arr.col) { arr.col[v * 4] = t.colors[i * 3]; arr.col[v * 4 + 1] = t.colors[i * 3 + 1]; arr.col[v * 4 + 2] = t.colors[i * 3 + 2]; arr.col[v * 4 + 3] = 1; }
      if (arr.sa) { const w = t.weights; arr.sa[v * 4] = w[i * 5]; arr.sa[v * 4 + 1] = w[i * 5 + 1]; arr.sa[v * 4 + 2] = w[i * 5 + 2]; arr.sa[v * 4 + 3] = w[i * 5 + 3]; arr.sb[v * 4] = w[i * 5 + 4]; }
      if (arr.uv) { arr.uv[v * 2] = (f.x0 + ix * f.cell) / t.cfg.tile; arr.uv[v * 2 + 1] = (f.z0 + iz * f.cell) / t.cfg.tile; }
    };
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) put(j * m + i, ci * CH + i * step, cj * CH + j * step, 0);
    for (let r = 0; r < ring.length; r++) { const g = ring[r]; put(m * m + r, ci * CH + (g % m) * step, cj * CH + Math.floor(g / m) * step, skirt); }
  }
  function levelArrays(t, m, withUv) {
    const count = m * m + 4 * (m - 1);
    return {
      pos: new Float32Array(count * 3), nrm: new Float32Array(count * 3),
      col: t.splat ? null : new Float32Array(count * 4),
      sa: t.splat ? new Float32Array(count * 4) : null, sb: t.splat ? new Float32Array(count * 4) : null,
      uv: withUv ? new Float32Array(count * 2) : null,
    };
  }
  function buildChunks(t) {
    const scene = t.scene, per = t.f.cells / CH;
    const phone = H.touchUi;
    const lodDist = (k) => (phone ? 0.6 : 1) * [0, 120, 240, 420][k];
    t.chunks = [];
    for (let cj = 0; cj < per; cj++) for (let ci = 0; ci < per; ci++) {
      const levels = [];
      for (let k = 0; k < LODS.length; k++) {
        const step = LODS[k];
        if (step > CH / 2) break;
        const m = CH / step + 1;
        const arr = levelArrays(t, m, true);
        fillLevel(t, ci, cj, step, arr);
        const mesh = new B.Mesh(`terrain-${ci}-${cj}-${k}`, scene);
        const vd = new B.VertexData();
        vd.positions = arr.pos; vd.normals = arr.nrm; vd.indices = geometryFor(m).idx; vd.uvs = arr.uv;
        if (arr.col) vd.colors = arr.col;
        vd.applyToMesh(mesh, true);
        if (arr.sa) { mesh.setVerticesData('splatA', arr.sa, true, 4); mesh.setVerticesData('splatB', arr.sb, true, 4); }
        mesh.material = t.material;
        mesh.parent = t.root;
        mesh.receiveShadows = true;
        mesh.isPickable = k === 0;
        if (k > 0) mesh.metadata = { decor: true };
        mesh.freezeNormals && void 0;
        levels.push({ mesh, step, m, arr });
      }
      for (let k = 1; k < levels.length; k++) levels[0].mesh.addLODLevel(lodDist(k), levels[k].mesh);
      t.chunks.push({ ci, cj, levels });
    }
  }
  /** After an edit: the chunks over the touched samples get new vertices. */
  function refreshChunks(t, box) {
    const per = t.f.cells / CH;
    const c0 = Math.max(0, Math.floor((box.ix0 - 1) / CH)), c1 = Math.min(per - 1, Math.floor((box.ix1 + 1) / CH));
    const r0 = Math.max(0, Math.floor((box.iz0 - 1) / CH)), r1 = Math.min(per - 1, Math.floor((box.iz1 + 1) / CH));
    for (let cj = r0; cj <= r1; cj++) for (let ci = c0; ci <= c1; ci++) {
      const ch = t.chunks[cj * per + ci];
      for (const lv of ch.levels) {
        fillLevel(t, ci, cj, lv.step, lv.arr);
        lv.mesh.updateVerticesData(B.VertexBuffer.PositionKind, lv.arr.pos);
        lv.mesh.updateVerticesData(B.VertexBuffer.NormalKind, lv.arr.nrm);
        if (lv.arr.col) lv.mesh.updateVerticesData(B.VertexBuffer.ColorKind, lv.arr.col);
        if (lv.arr.sa) { lv.mesh.updateVerticesData('splatA', lv.arr.sa); lv.mesh.updateVerticesData('splatB', lv.arr.sb); }
        lv.mesh.refreshBoundingInfo();
      }
    }
  }

  // ------------------------------------------------------------------ scatter: trees, rocks, bushes
  const SCATTER = {
    hills: { trees: 260, rocks: 120, bushes: 220 }, mountain: { trees: 220, rocks: 160, bushes: 160 },
    mountains: { trees: 200, rocks: 220, bushes: 120 }, island: { trees: 140, rocks: 70, bushes: 120 },
    canyon: { trees: 60, rocks: 260, bushes: 100 }, valley: { trees: 300, rocks: 140, bushes: 200 },
    craters: { trees: 0, rocks: 320, bushes: 0 }, dunes: { trees: 0, rocks: 40, bushes: 30 }, flat: { trees: 0, rocks: 0, bushes: 0 },
  };
  function scatterPlan(t) {
    const cfg = t.cfg, s = cfg.scatter;
    if (s === false) return null;
    const d = SCATTER[cfg.shape] || SCATTER.hills;
    const area = (cfg.size * cfg.size) / (512 * 512);
    const get = (k) => Math.max(0, Math.min(3000, Math.round(s && s[k] !== undefined ? Number(s[k]) || 0 : d[k] * area)));
    return { trees: get('trees'), rocks: get('rocks'), bushes: get('bushes'), seed: (s && s.seed) ?? cfg.seed, models: (s && s.models) || (s && s.model) || {} };
  }
  /** Where a kind of scatter may stand: [x, z, scale, yaw] points (the same for every player: seeded). */
  function scatterPoints(t, kind, count, seed) {
    const f = t.f, cfg = t.cfg, r = T.rng(`${seed}:${kind}`), out = [];
    const w = new Float32Array(5);
    for (let tries = 0; out.length < count && tries < count * 12; tries++) {
      const x = f.x0 + 4 + r() * (cfg.size - 8), z = f.z0 + 4 + r() * (cfg.size - 8);
      if (Math.hypot(x, z) < 16) continue;
      const ix = Math.round((x - f.x0) / f.cell), iz = Math.round((z - f.z0) / f.cell);
      T.weightsAt(f, ix, iz, w, 0);
      const h = T.heightAt(f, x, z);
      if (cfg.sea !== false && h < f.y + cfg.sea + (kind === 'rocks' ? 0.3 : 1.2)) continue;
      if (f.paintLayer[iz * f.n + ix] && f.paintAmt[iz * f.n + ix] > 100) continue; // roads and painted paths stay clear
      if (kind === 'trees' && (w[0] < 0.6 || r() > w[0])) continue;
      if (kind === 'bushes' && w[0] + w[1] < 0.5) continue;
      if (kind === 'rocks' && w[3] > 0.6) continue;
      out.push([x, z, kind === 'trees' ? 0.7 + r() * 0.7 : kind === 'rocks' ? 0.4 + Math.pow(r(), 2) * 2.2 : 0.6 + r() * 0.6, r() * Math.PI * 2, r()]);
    }
    return out;
  }
  function makeScatter(t) {
    const plan = scatterPlan(t);
    t.scatter = { groups: [], grid: new Map(), version: 0 };
    if (!plan) return;
    const scene = t.scene;
    const mat = (name, color) => { const m = new B.StandardMaterial(name, scene); m.diffuseColor = L.hex(color); m.specularColor = new B.Color3(0.03, 0.03, 0.03); return m; };
    const part = (mesh, material, offset) => { mesh.material = material; mesh.isPickable = false; mesh.metadata = { decor: true }; mesh.receiveShadows = true; mesh.parent = null; return { mesh, offset }; };
    const kinds = {
      trees: () => [
        part(B.MeshBuilder.CreateCylinder('tree-trunk', { diameterTop: 0.35, diameterBottom: 0.55, height: 2.6, tessellation: 6 }, scene), mat('tree-trunk', '#6b4a2f'), 1.3),
        part(B.MeshBuilder.CreateCylinder('tree-crown', { diameterTop: 0, diameterBottom: 3.6, height: 4.6, tessellation: 7 }, scene), mat('tree-crown', '#3d6b35'), 4.2),
        part(B.MeshBuilder.CreateCylinder('tree-crown2', { diameterTop: 0, diameterBottom: 2.6, height: 3.2, tessellation: 7 }, scene), mat('tree-crown2', '#4a7d3f'), 6.1),
      ],
      rocks: () => [part(B.MeshBuilder.CreateIcoSphere('rock', { radius: 0.8, subdivisions: 1, flat: true }, scene), mat('rock', '#8b8780'), 0.25)],
      bushes: () => [part(B.MeshBuilder.CreateIcoSphere('bush', { radius: 0.7, subdivisions: 1, flat: true }, scene), mat('bush', '#557f3a'), 0.35)],
    };
    for (const kind of ['trees', 'rocks', 'bushes']) {
      if (!plan[kind]) continue;
      const pts = scatterPoints(t, kind, plan[kind], plan.seed);
      const group = { kind, pts, parts: kinds[kind](), alive: pts.map(() => true) };
      t.scatter.groups.push(group);
      placeGroup(t, group);
      if (kind === 'trees') pts.forEach((p, i) => addTrunk(t, group, i));
      // A model by name (config.terrain.scatter.models.tree, or an asset called tree / rock / bush).
      const one = kind.slice(0, -1);
      const name = plan.models[one] || plan.models[kind] || H.assets.pick(`terrain ${one}`, { kind: 'model' }) || H.assets.pick(one, { kind: 'model' });
      if (name && isMesh(name)) useModel(t, group, name);
    }
  }
  function addTrunk(t, group, i) {
    const p = group.pts[i];
    const key = `${Math.floor(p[0] / 8)},${Math.floor(p[1] / 8)}`;
    if (!t.scatter.grid.has(key)) t.scatter.grid.set(key, []);
    t.scatter.grid.get(key).push({ group, i });
  }
  function placeGroup(t, group) {
    const n = group.pts.length;
    for (const part of group.parts) {
      const buf = new Float32Array(n * 16);
      const tmp = B.Matrix.Identity();
      group.pts.forEach((p, i) => {
        const y = T.heightAt(t.f, p[0], p[1]) ?? 0;
        const s = group.alive[i] ? p[2] : 0;
        const sy = group.kind === 'rocks' ? s * (0.5 + p[4] * 0.5) : s;
        B.Matrix.ComposeToRef(new B.Vector3(s, sy, s), B.Quaternion.RotationYawPitchRoll(p[3], group.kind === 'rocks' ? p[4] * 0.5 : 0, 0), new B.Vector3(p[0], y + part.offset * sy - (group.kind === 'trees' ? 0.15 : 0), p[1]), tmp);
        tmp.copyToArray(buf, i * 16);
      });
      part.buf = buf;
      part.mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
      part.mesh.thinInstanceRefreshBoundingInfo(false);
    }
  }
  /** A real model instead of the stand-in primitives (loaded once, merged, drawn as thin instances). */
  async function useModel(t, group, name) {
    try {
      // Hundreds of copies are drawn at once: its lowest level of detail (Gen's) when it has them, else the model itself.
      const entry = L.assetEntry(name), lods = entry && entry.lods;
      const low = lods && lods.kind === 'mesh' && Array.isArray(lods.levels) && lods.levels.length ? lods.levels.reduce((a, b) => ((b.tris || b.level) < (a.tris || a.level) ? b : a)) : null;
      const r = await B.SceneLoader.ImportMeshAsync('', '', low && low.url ? low.url : L.assetUrl(name), t.scene, null, '.glb');
      if (cur !== t) { r.meshes.forEach((m) => m.dispose()); return; }
      const parts = r.meshes.filter((m) => m.getTotalVertices && m.getTotalVertices() > 0);
      for (const m of parts) { m.setParent(null); m.bakeCurrentTransformIntoVertices(); }
      const merged = B.Mesh.MergeMeshes(parts, true, true, undefined, false, true);
      r.meshes.forEach((m) => { if (!m.isDisposed()) m.dispose(); });
      if (!merged) return;
      const bb = merged.getBoundingInfo().boundingBox;
      const tall = { trees: 7, rocks: 1.2, bushes: 1.3 }[group.kind];
      const k = tall / Math.max(0.01, bb.maximum.y - bb.minimum.y);
      merged.scaling.setAll(k);
      merged.position.y = -bb.minimum.y * k;
      merged.bakeCurrentTransformIntoVertices();
      merged.isPickable = false; merged.metadata = { decor: true }; merged.receiveShadows = true;
      for (const p of group.parts) p.mesh.dispose();
      group.parts = [{ mesh: merged, offset: 0 }];
      placeGroup(t, group);
    } catch (err) { console.warn('terrain scatter model', name, err); }
  }
  /** Scatter follows the ground after an edit; what a crater swallows is gone. */
  function scatterAfterEdit(t, box, clear) {
    const f = t.f;
    const x0 = f.x0 + box.ix0 * f.cell, x1 = f.x0 + box.ix1 * f.cell, z0 = f.z0 + box.iz0 * f.cell, z1 = f.z0 + box.iz1 * f.cell;
    for (const g of t.scatter.groups) {
      let any = false;
      g.pts.forEach((p, i) => {
        if (p[0] < x0 || p[0] > x1 || p[1] < z0 || p[1] > z1) return;
        any = true;
        if (clear && Math.hypot(p[0] - clear[0], p[1] - clear[1]) < clear[2]) g.alive[i] = false;
      });
      if (any) { placeGroup(t, g); if (g.kind === 'trees') t.scatter.version++; }
    }
  }

  // ------------------------------------------------------------------ the sea (a stand-in until the Water module does it)
  function makeSea(t) {
    const cfg = t.cfg;
    if (cfg.sea === false || H.water || (H.world.config && H.world.config.water)) return;
    const sea = B.MeshBuilder.CreateGround('terrain-sea', { width: cfg.size * 3, height: cfg.size * 3 }, t.scene);
    const m = new B.StandardMaterial('terrain-sea', t.scene);
    m.diffuseColor = L.hex('#2a6f9e'); m.specularColor = new B.Color3(0.5, 0.55, 0.6); m.alpha = 0.82; m.specularPower = 64;
    sea.material = m; sea.isPickable = false; sea.metadata = { decor: true };
    sea.position.set(cfg.center[0], cfg.y + cfg.sea, cfg.center[1]);
    t.sea = sea;
  }

  // ------------------------------------------------------------------ the terrain as a thing in the world
  function makeEntity(t) {
    const root = new B.TransformNode('terrain', t.scene);
    root.position.set(t.cfg.center[0], 0, t.cfg.center[1]);
    t.root = root;
    const e = new L.Entity(root, { name: 'Terrain', tag: 'terrain', physics: 'static', grab: false }, 'terrain');
    e.isTerrain = true;
    e.measure = () => {};
    e.box = () => FAR; // the old box physics never collides with its bounds; the surface is handled below
    e.half = [t.cfg.size / 2, 1, t.cfg.size / 2];
    e.data.terrain = true;
    t.entity = e;
  }

  function build(value, ctx) {
    const t0 = performance.now();
    const t = { ctx, scene: ctx.scene, cfg: T.normalize(value), shared: [], preview: new Map(), version: 0, id: ++ids };
    t.f = T.generate(value);
    const n = t.f.n;
    t.normals = new Float32Array(n * n * 3);
    t.weights = new Float32Array(n * n * 5);
    t.colors = new Float32Array(n * n * 3);
    t.tint = new Float32Array(n * n);
    const nz = T.makeNoise(`${t.cfg.seed}:tint`);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) { const x = t.f.x0 + ix * t.f.cell, z = t.f.z0 + iz * t.f.cell; t.tint[iz * n + ix] = 0.93 + 0.07 * nz(x / 9, z / 9) + 0.06 * nz(x / 41, z / 41); }
    const lap = (k) => { const now = performance.now(); t.timing[k] = Math.round(now - (t.lapAt || t0)); t.lapAt = now; };
    t.timing = {};
    lap('shape');
    shadeAll(t);
    lap('shade');
    t.material = makeMaterial(t);
    makeEntity(t);
    buildChunks(t);
    lap('meshes');
    makeScatter(t);
    makeSea(t);
    lap('scatter');
    t.assetSig = assetSig(t.cfg);
    if (t.scatter.groups.some((g) => g.kind === 'trees')) {
      // The trunks' collider (Havok): a thing of its own, so the ground's body stays one heightfield.
      const node = new B.TransformNode('terrain-trunks', t.scene);
      node.position.copyFrom(t.root.position);
      const e = new L.Entity(node, { name: 'Trees', tag: 'terrain', physics: 'static', grab: false }, 'terrain');
      e.measure = () => {}; e.box = () => FAR; e.isScatter = true; e.data.terrain = true;
      t.trunks = e;
    }
    havokShape(t, true); // the collider is described before the first step (never the box around the whole terrain)
    hideGrounds(t);
    liftAll(t);
    if (H.world.grid && t.cfg.shape !== 'flat') H.world.grid.setEnabled(false);
    t.ms = Math.round(performance.now() - t0);
    return t;
  }
  function destroy(t) {
    if (!t) return;
    showGrounds(t);
    if (t.entity && t.entity.alive) t.entity.destroy();
    if (t.trunks && t.trunks.alive) t.trunks.destroy();
    for (const g of (t.scatter && t.scatter.groups) || []) for (const p of g.parts) p.mesh.dispose();
    if (t.sea) t.sea.dispose();
    if (t.material) t.material.dispose(true, true);
    for (const tx of t.textures || []) tx.dispose();
    if (H.world && H.world.grid && !H.world.grid.isDisposed()) H.world.grid.setEnabled(true);
  }

  // ------------------------------------------------------------------ the world's old ground, and things under the new one
  /** A flat ground the world already had (the template's "Ground" plane, a big floor box) would sit inside the hills:
   *  while the terrain is on it's hidden and nothing stands on it (it comes back when the terrain is turned off; delete
   *  it to be rid of it). A ground: static, a plane or a box at most 1.5 m thick, at least 20 m (or a quarter of the
   *  terrain) across, and either called ground/floor/grass/meadow or lying low (its top within 2 m of the terrain's base). */
  function isGround(t, e) {
    if (!e.alive || e.isTerrain || e.isScatter || e.physics !== 'static' || (e.kind !== 'plane' && e.kind !== 'box') || !e.visible) return false;
    if (e.data && e.data.keepWithTerrain) return false;
    const b = e.box(), w = b.max[0] - b.min[0], d = b.max[2] - b.min[2], h = b.max[1] - b.min[1];
    const big = Math.min(w, d) >= Math.min(20, t.cfg.size * 0.25);
    if (!big || h > 1.5) return false;
    const named = /\b(ground|floor|grass|meadow|terrain|land)\b/i.test(`${e.name || ''} ${e.tag || ''} ${e.sceneId || ''}`);
    return named || Math.abs(b.max[1] - t.f.y) < 2;
  }
  function hideGrounds(t) {
    const w = H.world;
    t.hidden = t.hidden || [];
    if (w) for (const e of w.entities) if (!e._underTerrain && isGround(t, e)) { t.hidden.push({ e, physics: e.physics }); e.visible = false; e.physics = 'none'; e._underTerrain = true; }
  }
  function showGrounds(t) {
    for (const { e, physics } of t.hidden || []) if (e.alive && e._underTerrain) { e._underTerrain = false; e.visible = true; e.physics = physics; }
    t.hidden = [];
  }
  /** How deep a thing is in the ground (null: no ground there). A turned thing goes by its own box's corners, each
   *  against the ground under it: the box around a 4x4 on a hillside (a plank, a ragdoll's arm) reaches far below
   *  the thing itself, and going by it popped them out of the ground every quarter second. */
  const TURN = new B.Matrix();
  function depthIn(t, e) {
    const r = e.node.rotation, lh = e._lhalf, lo = e._loff;
    // A vehicle keeps itself on the ground (its wheels, its hull): only one sunk to its middle is put back on top.
    if (e.vehicle && lh && lo) { const g = T.heightAt(t.f, e.x, e.z); return g === null || g < e.y ? null : g - e.y + lh[1] - lo[1] - 0.02; }
    if (e.isPlayer || !lh || !lo || e.kind === 'sphere' || e.node.rotationQuaternion || (!r.x && !r.z)) {
      const g = T.heightAt(t.f, e.x, e.z);
      return g === null ? null : g - e.bottom - 0.02;
    }
    B.Matrix.RotationYawPitchRollToRef(r.y, r.x, r.z, TURN);
    const m = TURN.m; // (rows: where the local x, y, z axes point)
    const c = [0, 1, 2].map((i) => e.node.position.asArray()[i] + m[i] * lo[0] + m[4 + i] * lo[1] + m[8 + i] * lo[2]);
    let deep = null;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const p = [0, 1, 2].map((i) => c[i] + m[i] * lh[0] * sx + m[4 + i] * lh[1] * sy + m[8 + i] * lh[2] * sz);
      const g = T.heightAt(t.f, p[0], p[2]);
      if (g !== null) deep = Math.max(deep ?? -Infinity, g - p[1]);
    }
    return deep === null ? null : deep - 0.1; // (resting on it is touching: Havok keeps it out of the ground)
  }
  /** Things (and the player) that would be inside the ground go on top of it. */
  function liftOne(t, e, pad = 0.05) {
    if (!e.alive || e.isTerrain || e.isScatter || e.remote || e.held || e._underTerrain) return false;
    if (!(e.physics === 'dynamic' || e.isPlayer) || (e.isPlayer && e.flying)) return false;
    const d = depthIn(t, e);
    if (d === null || d <= 0) return false;
    e.node.position.y += d + pad + 0.02;
    if (e.vy < 0) e.vy = 0;
    e.wake();
    return true;
  }
  function liftAll(t) { const w = H.world; if (w) for (const e of [...w.entities]) liftOne(t, e); }
  let liftStep = 0;
  // Every step for the player (a spawn point under a hill, a respawn), every quarter second for everything else.
  H.physics.afterStep(() => {
    const t = cur, w = H.world;
    if (!t || !w || !t.entity || !t.entity.alive) return;
    if (w.player) liftOne(t, w.player);
    if (++liftStep % 15) return;
    for (const e of w.entities) if (e.physics === 'dynamic' && !e.isPlayer && !e.living) liftOne(t, e);
  });
  // Grounds and things that arrive later (the world's own things are built after the terrain, edits add more).
  H.hooks.world.push({
    enter() { if (cur) { hideGrounds(cur); liftAll(cur); } },
    ops() { if (cur) hideGrounds(cur); },
    respawn(p) { if (cur) liftOne(cur, p); },
  });

  // ------------------------------------------------------------------ editing (everyone's way in: tools, brush, scripts, explosions)
  /** Applies edits to the live terrain: heights, looks, physics, scatter. Returns the touched box. */
  function applyEdits(t, edits, o = {}) {
    let box = null;
    for (const e of edits) {
      const b = T.applyEdit(t.f, e);
      if (b) box = box ? { ix0: Math.min(box.ix0, b.ix0), ix1: Math.max(box.ix1, b.ix1), iz0: Math.min(box.iz0, b.iz0), iz1: Math.max(box.iz1, b.iz1) } : b;
    }
    if (!box) return null;
    const grown = { ix0: box.ix0 - 2, ix1: box.ix1 + 2, iz0: box.iz0 - 2, iz1: box.iz1 + 2 };
    shade(t, grown);
    refreshChunks(t, grown);
    scatterAfterEdit(t, grown, o.clear);
    // Things over the edit wake up (they may have a hole under them now).
    const f = t.f, x0 = f.x0 + grown.ix0 * f.cell, x1 = f.x0 + grown.ix1 * f.cell, z0 = f.z0 + grown.iz0 * f.cell, z1 = f.z0 + grown.iz1 * f.cell;
    for (const e of H.world.entities) if (e.sleeping && e.x >= x0 - 2 && e.x <= x1 + 2 && e.z >= z0 - 2 && e.z <= z1 + 2) e.wake();
    t.version++;
    if (H.game) try { H.game.emit('terrain', { edits, box: [x0, z0, x1, z1] }); } catch { /* a listener's error is its own */ }
    return box;
  }
  const sync = { edit: null, want: null, all: null, lastWant: 0 };
  /** Edits for everyone (tools, explosions, scripts with share: true): through the host, once each. */
  function shareEdits(edits, o = {}) {
    const list = edits.filter(T.validEdit).map(T.compact);
    if (!list.length || !cur) return;
    sync.edit({ e: list, c: o.clear ? o.clear.map((v) => Math.round(v * 10) / 10) : null });
  }
  function setupSync() {
    if (!H.sync || sync.edit) return;
    sync.edit = H.sync.action('terrain:edit', (d) => {
      const t = cur;
      if (!t || !d || !Array.isArray(d.e)) return;
      const list = d.e.filter(T.validEdit);
      applyEdits(t, list, { clear: Array.isArray(d.c) ? d.c : null });
      t.shared.push(...list);
      if (t.shared.length > SHARED_MAX) t.shared.splice(0, t.shared.length - SHARED_MAX);
    });
    // A player who joined late asks the host for every shared edit; the host sends them to that player.
    sync.all = H.sync.action('terrain:all', (d) => {
      const t = cur;
      if (!t || !d || d.to !== H.sync.me || !Array.isArray(d.e)) return;
      rebuildWith(t, d.e.filter(T.validEdit));
    });
    sync.want = H.sync.action('terrain:want', (d, { authoritative, from }) => {
      const t = cur;
      if (!authoritative || !t || !H.sync.isHost) return;
      const to = (from && from.id) || (d && d.me);
      if (to && to !== H.sync.me) sync.all({ to, e: t.shared });
    });
    H.sync.state('terrain', {
      rate: 1,
      get: () => (cur ? { n: cur.shared.length, h: T.fingerprint(cur.shared), s: cur.cfg.seed } : { n: 0, h: 0 }),
      set: (st) => {
        const t = cur;
        if (!t || !st) return;
        if (st.n === t.shared.length && st.h === T.fingerprint(t.shared)) return;
        if (performance.now() - sync.lastWant < 4000) return;
        sync.lastWant = performance.now();
        sync.want({ me: H.sync.me });
      },
    });
  }
  /** Back to the saved terrain, then these shared edits (a late joiner catching up). */
  function rebuildWith(t, shared) {
    const fresh = T.generate(t.cfg.raw);
    t.f.heights.set(fresh.heights); t.f.paintLayer.set(fresh.paintLayer); t.f.paintAmt.set(fresh.paintAmt);
    t.f.min = fresh.min; t.f.max = fresh.max;
    for (const e of shared) T.applyEdit(t.f, e);
    t.shared = shared.slice();
    shadeAll(t);
    refreshChunks(t, { ix0: 0, ix1: t.f.n - 1, iz0: 0, iz1: t.f.n - 1 });
    for (const g of t.scatter.groups) placeGroup(t, g);
    for (const e of H.world.entities) e.wake();
    t.version++;
  }

  // ------------------------------------------------------------------ physics
  function havokReady() { return Boolean(H.physics && H.physics.engine === 'havok' && H.world && H.world.havok); }
  /** The ground's collider: a heightfield (in Babylon's order: x from +x to -x by rows, z along each row). Remade
   *  after edits, four times a second at most. On the old box physics it's only kept (settle() does the work). */
  function havokShape(t, now) {
    const time = H.world ? H.world.time : 0;
    if (t.shapeVersion === t.version || (!now && time - (t.havokAt ?? -1) < 0.25)) return;
    const first = t.shapeVersion === undefined;
    t.shapeVersion = t.version; t.havokAt = time;
    if (!first && H.world) for (const e of H.world.entities) if (e.sleeping && e.physics === 'dynamic') e.wake();
    const f = t.f, n = f.n, data = new Float32Array(n * n);
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) data[(n - 1 - z) * n + x] = f.y + f.heights[z * n + x];
    try { H.physics.setShape(t.entity, H.physics.shapes.heightfield({ width: f.size, depth: f.size, rows: n, cols: n, heights: data, id: `terrain-${t.id}`, version: t.version })); }
    catch (err) { H.report(err, 'terrain'); }
    trunkShape(t);
  }
  /** Tree trunks as one static body of cylinders (Havok). */
  function trunkShape(t) {
    if (!t.trunks || t.trunkVersion === t.scatter.version) return;
    t.trunkVersion = t.scatter.version;
    const parts = [];
    for (const g of t.scatter.groups) if (g.kind === 'trees') g.pts.forEach((p, i) => {
      if (!g.alive[i]) return;
      const y = T.heightAt(t.f, p[0], p[1]) ?? 0, h = 2.6 * p[2];
      parts.push({ shape: { type: 'cylinder', radius: 0.26 * p[2], height: h }, position: [p[0] - t.cfg.center[0], y + h / 2 - 0.15, p[1] - t.cfg.center[1]] });
    });
    t.trunks.physics = parts.length ? 'static' : 'none';
    if (parts.length) H.physics.setShape(t.trunks, { type: 'compound', parts, id: `trunks-${t.id}`, version: t.scatter.version });
  }
  let ids = 0;
  H.physics.beforeStep(() => { if (cur && havokReady() && cur.entity && cur.entity.alive) havokShape(cur); });
  /** While asleep on the ground, a thing counts the terrain as holding it up (the old physics' sleep check). */
  function restsOnTerrain(e) {
    if (e._terrainRest) return;
    e._terrainRest = true;
    const own = Object.getPrototypeOf(e).overlaps;
    e.overlaps = function (o, pad) {
      if (o && o.isTerrain && cur && o === cur.entity) {
        if (!this.sleeping) return false;
        const g = T.heightAt(cur.f, this.x + this.offset[0], this.z + this.offset[2]);
        return g !== null && this.bottom < g - 0.01;
      }
      return own.call(this, o, pad);
    };
  }
  /** The old box physics: after each step, things are put back on the surface, slide down steep ground, stop on it. */
  function settle(dt) {
    const t = cur, w = H.world;
    if (!t || !w || !t.entity || !t.entity.alive) return;
    const lowest = t.f.y + t.f.min - 30;
    if (w.catchY > lowest) w.catchY = lowest;
    // Fog made for a small world would hide a big one: it starts farther out (the world's own setting is kept).
    const sc = w.scene, far = Math.min(900, t.cfg.size * 0.9);
    if (sc.fogMode === B.Scene.FOGMODE_LINEAR && sc.fogEnd < far && !(t.cfg.raw && t.cfg.raw.fog === false)) { sc.fogStart = Math.max(sc.fogStart, far * 0.35); sc.fogEnd = far; }
    if (havokReady()) return;
    const G = Math.abs(w.config.gravity ?? -24);
    for (const e of w.entities) {
      if (!e.alive || e.physics !== 'dynamic' || e.remote || e.held || e.sleeping || e.isTerrain || e.ignoreTerrain) continue;
      if (!e.node.isEnabled()) continue;
      const x = e.x + e.offset[0], z = e.z + e.offset[2];
      let g = T.heightAt(t.f, x, z);
      if (g === null) { e._onTerrain = false; continue; }
      let on = false;
      const bottom = e.bottom;
      if (bottom < g) {
        if (e.upright && !e.flying && g - bottom > 0.35 && e._px !== undefined) {
          // Too steep to walk up: back to where it was this step.
          const nrm = T.normalAt(t.f, x, z);
          const gp = T.heightAt(t.f, e._px + e.offset[0], e._pz + e.offset[2]);
          if (nrm && nrm[1] < MAX_SLOPE_COS && gp !== null && gp < g - 0.05 && bottom >= gp - 0.3) {
            e.node.position.x = e._px; e.node.position.z = e._pz;
            e.vx = nrm[0] * 2; e.vz = nrm[2] * 2;
            g = gp;
          }
        }
        e.node.position.y += g - e.bottom;
        if (e.vy < 0) {
          if (e.bounce > 0 && -e.vy > 2.5) e.vy = -e.vy * e.bounce;
          else { e.vy = 0; on = true; }
        } else on = e.vy < 0.5;
      } else if (e._onTerrain && e.vy <= 0.5 && e.gravity > 0 && !e.flying && bottom - g < 0.45) {
        // Stay on the ground going downhill instead of skipping off it.
        e.node.position.y -= bottom - g;
        e.vy = 0;
        on = true;
      }
      e._onTerrain = on;
      if (!on) { e._terrainStill = 0; continue; }
      e.grounded = true;
      e.standing = t.entity;
      const nrm = T.normalAt(t.f, x, z) || [0, 1, 0];
      const ball = e.kind === 'sphere';
      let sliding = false;
      if (!e._walked) {
        // Steep ground (or anything round) pulls things downhill; friction slows what's on flatter ground.
        const steep = nrm[1] < Math.cos(Math.atan(Math.max(0.2, e.friction * 1.1)));
        if ((ball && nrm[1] < 0.995) || steep) {
          const k = G * e.gravity * nrm[1] * (ball ? 0.7 : 0.6);
          e.vx += nrm[0] * k * dt; e.vz += nrm[2] * k * dt;
          sliding = true;
        }
        const keep = Math.max(0, 1 - e.friction * (ball ? 1.2 : sliding ? 2 : 10) * dt);
        e.vx *= keep; e.vz *= keep;
        if (Math.abs(e.vx) < 0.01) e.vx = 0;
        if (Math.abs(e.vz) < 0.01) e.vz = 0;
      }
      if (!e._walked && e !== w.player && !sliding && Math.abs(e.vx) + Math.abs(e.vz) < 0.05) {
        e._terrainStill = (e._terrainStill || 0) + dt;
        if (e._terrainStill > 0.6) { restsOnTerrain(e); e.sleeping = true; e._terrainStill = 0; }
      } else e._terrainStill = 0;
    }
    trunks(t);
  }
  /** Tree trunks are solid: things are pushed out of them. */
  function trunks(t) {
    const grid = t.scatter && t.scatter.grid;
    if (!grid || !grid.size) return;
    for (const e of H.world.entities) {
      if (!e.alive || e.physics !== 'dynamic' || e.remote || e.held || e.sleeping || e.isTerrain || e.ignoreTerrain) continue;
      const cx = Math.floor(e.x / 8), cz = Math.floor(e.z / 8);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const list = grid.get(`${cx + dx},${cz + dz}`);
        if (!list) continue;
        for (const { group, i } of list) {
          if (!group.alive[i]) continue;
          const p = group.pts[i];
          const r = 0.28 * p[2] + Math.min(e.half[0], e.half[2]);
          const ddx = e.x - p[0], ddz = e.z - p[1];
          const d = Math.hypot(ddx, ddz);
          if (d >= r || d < 1e-4) continue;
          const g = T.heightAt(t.f, p[0], p[1]) ?? 0;
          if (e.bottom > g + 2.6 * p[2]) continue;
          const nx = ddx / d, nz = ddz / d;
          e.node.position.x = p[0] + nx * r; e.node.position.z = p[1] + nz * r;
          const into = e.vx * nx + e.vz * nz;
          if (into < 0) { e.vx -= into * nx; e.vz -= into * nz; }
        }
      }
    }
  }
  H.physics.afterStep(settle);

  // ------------------------------------------------------------------ growing: stamps added (or taken back) move the ground
  // A mountain asked for here rises over ~5 s (H.arrive: the rumble, the shake, dust, rocks, the Overseer's beam); a
  // canyon or a hole sinks. Undo takes it back down faster. The heights ease from the old shape to the new one; the
  // meshes follow 15 times a second, the collider every half second, and anything standing on it rides up.
  const GROW_HZ = 15;
  /** Starts moving the ground to `value`'s shape. Returns false when there's nothing to animate (rebuild instead). */
  function growTo(t, value, o = {}) {
    if (t.grow) endGrow(t);
    const target = T.generate(value);
    if (target.n !== t.f.n || target.x0 !== t.f.x0 || target.z0 !== t.f.z0) return false;
    for (const e of t.shared) T.applyEdit(target, e);
    const f = t.f, n = f.n, from = f.heights, to = target.heights;
    let box = null, peak = 0, px = 0, pz = 0, sum = 0;
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix, d = to[i] - from[i];
      if (Math.abs(d) < 1e-3) continue;
      box = box ? { ix0: Math.min(box.ix0, ix), ix1: Math.max(box.ix1, ix), iz0: Math.min(box.iz0, iz), iz1: Math.max(box.iz1, iz) } : { ix0: ix, ix1: ix, iz0: iz, iz1: iz };
      if (Math.abs(d) > Math.abs(peak)) { peak = d; px = ix; pz = iz; }
      sum += d;
    }
    t.cfg = { ...T.normalize(value), raw: rawOf(value) };
    f.paintLayer.set(target.paintLayer); f.paintAmt.set(target.paintAmt);
    f.road = target.road;
    if (!box) { shadeAll(t); refreshChunks(t, { ix0: 0, ix1: n - 1, iz0: 0, iz1: n - 1 }); return true; }
    const grown = { ix0: Math.max(0, box.ix0 - 2), ix1: Math.min(n - 1, box.ix1 + 2), iz0: Math.max(0, box.iz0 - 2), iz1: Math.min(n - 1, box.iz1 + 2) };
    const at = [f.x0 + px * f.cell, f.y + (sum >= 0 ? to : from)[pz * n + px], f.z0 + pz * f.cell];
    const radius = Math.max(box.ix1 - box.ix0, box.iz1 - box.iz0) * f.cell / 2;
    const seconds = o.back ? H.arrive.FALL.terrainBack : H.arrive.FALL.terrainSeconds;
    t.grow = { from: from.slice(), to, box: grown, t: 0, seconds, meshT: 0, fx: H.arrive.quake(at, { radius, rise: peak, seconds, back: o.back }) };
    return true;
  }
  /** The ground at k (0 the old shape, 1 the new one) in the moving box. */
  function growAt(t, k) {
    const g = t.grow, f = t.f, n = f.n, b = g.box;
    for (let iz = b.iz0; iz <= b.iz1; iz++) for (let ix = b.ix0; ix <= b.ix1; ix++) { const i = iz * n + ix; f.heights[i] = g.from[i] + (g.to[i] - g.from[i]) * k; }
    if (k >= 1) { let lo = Infinity, hi = -Infinity; for (let i = 0; i < f.heights.length; i++) { const h = f.heights[i]; if (h < lo) lo = h; if (h > hi) hi = h; } f.min = lo; f.max = hi; }
    else for (let iz = b.iz0; iz <= b.iz1; iz++) for (let ix = b.ix0; ix <= b.ix1; ix++) { const h = f.heights[iz * n + ix]; if (h < f.min) f.min = h; if (h > f.max) f.max = h; }
  }
  function growMeshes(t, final) {
    const b = t.grow.box;
    shade(t, b);
    refreshChunks(t, b);
    if (final || (t.grow.scatterT = (t.grow.scatterT || 0) + 1) % 6 === 0) scatterAfterEdit(t, b);
    t.version++;
    // The collider: every half second while it moves (players are kept on the surface every step meanwhile).
    t.havokAt = final ? -1 : (H.world ? H.world.time : 0) + 0.25;
  }
  function stepGrow(t, dt) {
    const g = t.grow;
    g.t += dt;
    const k = Math.min(1, g.t / g.seconds);
    const e = k * k * (3 - 2 * k);
    growAt(t, e);
    if ((g.meshT += dt) >= 1 / GROW_HZ || k >= 1) { g.meshT = 0; growMeshes(t, k >= 1); }
    // Whatever stands on the moving ground rides with it (the player, things, animals).
    const w = H.world, f = t.f, b = g.box;
    const x0 = f.x0 + b.ix0 * f.cell, x1 = f.x0 + b.ix1 * f.cell, z0 = f.z0 + b.iz0 * f.cell, z1 = f.z0 + b.iz1 * f.cell;
    if (w) for (const en of w.entities) if (en.x >= x0 && en.x <= x1 && en.z >= z0 && en.z <= z1 && (en.physics === 'dynamic' || en.isPlayer)) liftOne(t, en);
    if (k >= 1) endGrow(t);
  }
  function endGrow(t) {
    const g = t.grow;
    if (!g) return;
    if (g.t < g.seconds) { g.t = g.seconds; growAt(t, 1); growMeshes(t, true); }
    t.grow = null;
    if (g.fx) g.fx.end();
    if (H.game) try { H.game.emit('terrain', { grown: true, box: [t.f.x0 + g.box.ix0 * t.f.cell, t.f.z0 + g.box.iz0 * t.f.cell, t.f.x0 + g.box.ix1 * t.f.cell, t.f.z0 + g.box.iz1 * t.f.cell] }); } catch { /* a listener's error is its own */ }
  }

  // ------------------------------------------------------------------ H.terrain: the contract everyone uses
  const off = () => !cur;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const xz = (a, b) => (Array.isArray(a) ? [num(a[0], 0), num(a.length >= 3 ? a[2] : a[1], 0)] : a && a.__entity ? [a.x, a.z] : a && typeof a === 'object' ? [num(a.x, 0), num(a.z, 0)] : [num(a, 0), num(b, 0)]);
  /** Runs edits here (and, with share: true, for everyone). */
  function edit(edits, o = {}) {
    if (off()) { H.report(new Error('There is no terrain in this world: turn it on with config.terrain first'), 'terrain'); return false; }
    const list = edits.filter(T.validEdit).map(T.compact);
    if (!list.length) return false;
    if (o.share) shareEdits(list, o);
    else applyEdits(cur, list, o);
    return true;
  }
  const LAYER_OF = (name) => { const i = T.LAYERS.indexOf(String(name || '').toLowerCase()); return i >= 0 ? i : /erase|clear|none/.test(String(name)) ? -1 : /road|path|mud|earth/.test(String(name)) ? 1 : /stone|cliff|gravel/.test(String(name)) ? 2 : /ice/.test(String(name)) ? 3 : /beach/.test(String(name)) ? 4 : 0; };
  const api = {
    get active() { return Boolean(cur); },
    /** Ground height (world y) at x, z, or null where there is no terrain. */
    heightAt(x, z) { if (off()) return null; const p = xz(x, z); return T.heightAt(cur.f, p[0], p[1]); },
    /** The ground's up direction at x, z: [nx, ny, nz], or null. */
    normalAt(x, z) { if (off()) return null; const p = xz(x, z); return T.normalAt(cur.f, p[0], p[1]); },
    /** Steepness in degrees (0 flat, 90 a wall), or null. */
    slopeAt(x, z) { const n = api.normalAt(x, z); return n ? Math.acos(n[1]) * 180 / Math.PI : null; },
    /** What the ground is made of there: 'grass', 'dirt', 'rock', 'snow' or 'sand' (or null). */
    materialAt(x, z) { if (off()) return null; const p = xz(x, z); return T.layerAt(cur.f, p[0], p[1]); },
    /** A hole: radius and depth in meters (a flat bottom, steep sides). dig(x, z, 20, 15) is a giant one. */
    dig(x, z, radius = 3, depth = 2, o = {}) {
      const r = Math.max(0.5, num(radius, 3)), d = num(depth, 2);
      const list = [[r >= 4 ? 'hole' : 'dig', r, d, x, z], ['paint', r * 0.9, 1, x, z]];
      if (r >= 4 && !o.clear) o = { ...o, clear: [x, z, r * 0.8] };
      if (o.pile) { const pr = r * 0.8, v = d * T.bumpVolume(r) * (r >= 4 ? 1.6 : 1); const ang = num(o.angle, 0); list.push(['raise', pr, Math.min(d * 1.2, v / T.bumpVolume(pr)), x + Math.sin(ang) * r * 1.6, z + Math.cos(ang) * r * 1.6]); }
      if (o.rim) list.push(['crater', r * 1.05, 0, x, z]);
      return edit(list, o);
    },
    raise(x, z, radius = 4, height = 2, o = {}) { return edit([['raise', num(radius, 4), num(height, 2), x, z]], o); },
    lower(x, z, radius = 4, depth = 2, o = {}) { return edit([['lower', num(radius, 4), num(depth, 2), x, z]], o); },
    /** Makes the ground level (at `height`, or at the height in the middle). */
    flatten(x, z, radius = 6, height, o = {}) { const h = num(height, api.heightAt(x, z) ?? 0); return edit([['flatten', num(radius, 6), h, x, z], ['flatten', num(radius, 6), h, x, z], ['flatten', num(radius, 6), h, x, z]], o); },
    smooth(x, z, radius = 6, strength = 0.6, o = {}) { return edit([['smooth', num(radius, 6), num(strength, 0.6), x, z]], o); },
    /** Paints the ground: 'grass', 'dirt' (roads, paths), 'rock', 'snow', 'sand', or 'erase'. */
    paint(x, z, radius = 4, layer = 'dirt', o = {}) { return edit([['paint', num(radius, 4), LAYER_OF(layer), x, z]], o); },
    crater(x, z, radius = 6, depth, o = {}) { const r = num(radius, 6); return edit([['crater', r, num(depth, r * 0.4), x, z], ['paint', r * 0.9, 1, x, z]], { clear: [x, z, r], ...o }); },
    /** A mountain (radius, height, road: false for none) or a hill, added where you say. */
    mountain(x, z, o = {}) { return api.addStamp({ type: 'mountain', at: [x, z], ...o }); },
    hill(x, z, radius = 25, height = 10) { return api.addStamp({ type: 'hill', at: [x, z], radius, height }); },
    /** Adds a stamp (config.terrain.add's shape) to the live terrain: rebuilt here, not saved. */
    addStamp(s) {
      if (off()) return false;
      const raw = { ...(cur.cfg.raw || {}), add: [...((cur.cfg.raw && cur.cfg.raw.add) || []), s] };
      cur.cfg.raw = raw;
      rebuildWith(cur, cur.shared);
      return true;
    },
    /** A raw edit list ([op, radius, amount, x, z, ...]: WORLD.md "Terrain"). */
    edit: (edits, o) => edit(Array.isArray(edits[0]) ? edits : [edits], o),
    /** Puts a thing (or [x, y, z]) on the ground; returns the ground height. */
    place(thing, lift = 0) {
      if (off()) return null;
      if (thing && thing.__entity) { const g = T.heightAt(cur.f, thing.x, thing.z); if (g !== null) { thing.node.position.y += g + lift - thing.bottom; thing.velocity = [0, 0, 0]; } return g; }
      const p = xz(thing); return T.heightAt(cur.f, p[0], p[1]);
    },
    /** A random spot on the ground [x, y, z] (o: { near: [x, z], radius, maxSlope: 30, avoidWater: true }). */
    randomPoint(o = {}) {
      if (off()) return null;
      const f = cur.f, c = o.near ? xz(o.near) : cur.cfg.center, R = num(o.radius, cur.cfg.size * 0.45);
      for (let k = 0; k < 60; k++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * R;
        const x = c[0] + Math.cos(a) * d, z = c[1] + Math.sin(a) * d;
        const h = T.heightAt(f, x, z);
        if (h === null) continue;
        if ((api.slopeAt(x, z) ?? 0) > num(o.maxSlope, 30)) continue;
        const sea = H.water && H.water.surfaceAt ? H.water.surfaceAt(x, z) : cur.cfg.sea !== false ? f.y + cur.cfg.sea : null;
        if (o.avoidWater !== false && sea !== null && sea !== undefined && h < sea + 0.3) continue;
        return [x, h, z];
      }
      return null;
    },
    /** The terrain's extent and heights: { center, size, min, max, shape, cell }. */
    get info() { return cur ? { center: cur.cfg.center.slice(), size: cur.cfg.size, min: cur.f.y + cur.f.min, max: cur.f.y + cur.f.max, shape: cur.cfg.shape, cell: cur.f.cell, ms: cur.ms, timing: cur.timing } : null; },
    /** The road up the mountain (shape "mountain"), as [x, z] points from the foot to the top. */
    get road() { return cur && cur.f.road ? cur.f.road.slice() : null; },
    get entity() { return cur ? cur.entity : null; },
    /** For other modules: the field and the core math (read only). */
    get field() { return cur ? cur.f : null; },
    core: T,
    _share: shareEdits,
    _applyLocal: (edits) => (cur ? applyEdits(cur, edits.filter(T.validEdit)) : null),
    get _cur() { return cur; },
  };
  H.terrain = api;

  // ------------------------------------------------------------------ the world feature: config.terrain
  /** config.terrain as an object (it may be true or a shape's name). */
  function rebuild(value, ctx) {
    const t = ctx.state.t;
    const shared = t ? t.shared : [];
    destroy(t);
    const n = build(value, ctx);
    n.cfg.raw = rawOf(value);
    ctx.state.t = n;
    cur = n;
    if (shared.length) rebuildWith(n, shared);
    for (const e of H.world.entities) e.wake();
  }
  /** Which ground textures and scatter models the game has now (a change rebuilds the looks). */
  function assetSig(cfg) {
    const s = cfg.scatter && typeof cfg.scatter === 'object' ? (cfg.scatter.models || cfg.scatter.model || {}) : {};
    const models = ['tree', 'rock', 'bush'].map((k) => (s[k] && isMesh(s[k]) ? s[k] : null) || H.assets.pick(`terrain ${k}`, { kind: 'model' }) || H.assets.pick(k, { kind: 'model' }) || '');
    const url = (r) => H.assets.url(r) || '';
    return JSON.stringify([layerAssets(cfg), models].flat().map((x) => (typeof x === 'string' ? x + url(x) : JSON.stringify(Object.entries(x).map(([k, v]) => [k, v, url(v)])))));
  }
  const rawOf = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : typeof v === 'string' ? { shape: v } : {});
  H.features.register('terrain', {
    codex: {
      title: 'Terrain', group: 'World features',
      what: 'Ground you can drive across, dig into and reshape: hills, a mountain with a road, an island in a sea, a canyon, dunes. A flat ground the world already had is hidden while it is on.',
      value: { shape: 'island', size: 256, seed: 2 },
      fields: [['shape', 'flat, hills, mountain, mountains, island, canyon, valley, craters, dunes (or words: "volcano", "beach")', 'hills'], ['height', 'meters', 'per shape'], ['size', 'meters across', '512'], ['seed', 'another landscape of the same kind', '1'], ['sea', 'sea level, or false', 'island: 0'], ['scatter', '{ trees, rocks, bushes } or false', 'by shape'], ['craters', 'false: explosions leave no holes', 'true']],
    },
    apply(value, ctx) {
      setupSync();
      const t = build(value, ctx);
      t.cfg.raw = rawOf(value);
      cur = t;
      ctx.state.t = t;
      ctx.game.terrain = api;
      // Explosions leave craters (the engine's 'explosion' event): only where it was decided (authoritative), and
      // everyone gets the edit.
      ctx.game.on('explosion', (d) => {
        if (cur !== t || !d || !d.authoritative || (t.cfg.raw && t.cfg.raw.craters === false)) return;
        const p = d.position;
        if (!p) return;
        const g = T.heightAt(t.f, p[0], p[2]);
        const R = Math.max(1, Number(d.radius) || 4);
        if (g === null || p[1] - g > R * 0.8) return; // high in the air: no mark on the ground
        const r = Math.min(30, R * 0.7), depth = Math.min(12, r * 0.35 * Math.max(0.5, Math.min(2, (Number(d.force) || 15) / 15)));
        shareEdits([['crater', r, depth, p[0], p[2]], ['paint', r * 0.85, 1, p[0], p[2]]], { clear: [p[0], p[2], r * 0.9] });
      });
    },
    change(value, old, ctx) {
      const t = ctx.state.t;
      const a = T.normalize(old), b = T.normalize(value);
      const strip = (c) => JSON.stringify({ ...c, edits: 0 });
      const prefix = t && a.edits.length <= b.edits.length && a.edits.every((e, i) => JSON.stringify(e) === JSON.stringify(b.edits[i]));
      // Stamps added or taken back (a mountain here, undo): the ground moves there (H.arrive), the rest stays.
      const stripAdd = (c) => JSON.stringify({ ...c, edits: 0, add: 0 });
      if (t && prefix && a.edits.length === b.edits.length && stripAdd(a) === stripAdd(b) && JSON.stringify(a.add) !== JSON.stringify(b.add) && H.arrive && H.arrive.quake) {
        const back = b.add.length < a.add.length;
        if (growTo(t, value, { back })) return;
      }
      if (t && prefix && strip(a) === strip(b)) {
        // Only new edits (the brush): apply what isn't already showing.
        const fresh = [];
        for (const e of b.edits.slice(a.edits.length)) { const k = JSON.stringify(e); if (t.preview.has(k)) t.preview.delete(k); else fresh.push(e); }
        if (fresh.length) applyEdits(t, fresh);
        t.cfg = { ...b, raw: rawOf(value) };
        return;
      }
      rebuild(value, ctx);
    },
    update(dt, ctx) {
      if (ctx.state.t && ctx.state.t.grow) stepGrow(ctx.state.t, dt);
      // A texture or model arrived (generated, or added in the Assets panel): the ground picks it up.
      const t = ctx.state.t;
      if (!t || (t.assetCheck = (t.assetCheck || 0) + dt) < 1) return;
      t.assetCheck = 0;
      if (assetSig(t.cfg) !== t.assetSig) rebuild(t.cfg.raw, ctx);
    },
    dispose(ctx) {
      const t = ctx.state.t;
      if (t && t.grow) { if (t.grow.fx) t.grow.fx.end(); t.grow = null; }
      if (cur === t) cur = null;
      destroy(t);
    },
  });
  // Scripts can always reach game.terrain (it says active: false when the world has none).
  H.hooks.game.push((g) => { g.terrain = api; });
})();
