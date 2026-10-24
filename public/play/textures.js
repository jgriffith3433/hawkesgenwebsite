// Textures by level of detail (H.textures). Every image a game uses has smaller copies (128, 256, 512, 1024, 2048 px
// and the full size, as WebP: src/variants.ts, in the bundle as asset.variants). The engine:
//   - loads every texture at its smallest copy first (assetUrl gives the smallest: the first frame comes fast and small),
//   - every half second, works out how many pixels each texture covers on screen (near, big and in view: more), and
//     upgrades the ones that need it, most needed first, as long as the device's texture memory budget allows,
//   - and when over budget (a big new thing, the Overseer's sky...), downgrades the least visible first, so the page is
//     never killed for memory (iOS Safari reloads a page that takes too much).
// Textures that aren't managed (inside models, shadow maps, a module's own) still count against the budget.
//
//   H.textures.stats()                    { tier, budgetMB, usedMB, managedMB, otherMB, managed, upgrades, downgrades, loading }
//   H.textures.reserve(owner, bytes)      a module keeps room for something big it will make (the sky, a planet): the
//                                         budget for the rest shrinks; reserve(owner, 0) gives it back
//   H.textures.track(texture, o)          manage a texture a module made from an asset (o.asset: its id or name)
//   H.textures.startUrl(entry)            the address a texture of this asset starts at (runtime.js assetUrl uses it)
//   H.textures.plan(items, budget)        the planner on its own (pure; tests use it)
// The budget per device is H.budget.textureMB (scale.js: strict on phones, iOS strictest; roomy on desktop).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = window.BABYLON;
  const MB = 1048576;

  // ------------------------------------------------------------------ the levels of an asset
  /** An asset's levels, smallest first: [{ size (long side, px), url, w, h, bytes (on the GPU, with mipmaps) }]. The
   *  last is the original (its size when known). Assets without variants have one level. */
  function levelsOf(entry) {
    if (!entry) return [];
    const out = [];
    const v = entry.variants && typeof entry.variants === 'object' ? entry.variants : null;
    const size = Array.isArray(entry.size) ? entry.size : null;
    const long = size ? Math.max(size[0], size[1]) : 0;
    const dims = (s, x) => (x && x.w && x.h ? [x.w, x.h] : size ? (size[0] >= size[1] ? [s, Math.max(1, Math.round((size[1] * s) / size[0]))] : [Math.max(1, Math.round((size[0] * s) / size[1])), s]) : [s, s]);
    if (v) for (const k of Object.keys(v).map(Number).filter((n) => n > 0).sort((a, b) => a - b)) {
      const x = v[k];
      const url = typeof x === 'string' ? x : x && x.url;
      if (!url) continue;
      const [w, h] = dims(k, x);
      out.push({ size: k, url, w, h, bytes: gpuBytes(w, h) });
    }
    // The original: only when it's bigger than the biggest copy (a full-size WebP copy stands for it).
    if (!out.length || !long || long > out[out.length - 1].size) {
      const [w, h] = size || [long || 1024, long || 1024];
      out.push({ size: long || Infinity, url: entry.url, w, h, bytes: gpuBytes(w, h), original: true });
    }
    return out;
  }
  /** Bytes a texture takes on the GPU: 4 per pixel, a third more for its mipmaps. */
  function gpuBytes(w, h, mips = true) { return Math.round(w * h * 4 * (mips ? 4 / 3 : 1)); }
  /** The smallest level that covers `need` pixels (and at most maxSize), as an index. */
  function levelFor(levels, need, maxSize = Infinity) {
    let best = 0;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].size > maxSize && i > 0) break;
      best = i;
      if (levels[i].size >= need) break;
    }
    return best;
  }

  /**
   * The planner: which level each texture gets. items: [{ key, levels: [{ bytes }], want (index), prio (higher: more
   * needed), min (index, default 0) }]; budget: bytes for all of them (what other textures take already subtracted).
   * Every texture starts at its smallest; then, round by round, each one that wants more goes up one level, the most
   * needed first, while it fits. So under pressure the most visible are sharp and the least visible stay small.
   * Returns Map key -> index.
   */
  function plan(items, budget) {
    const at = new Map();
    let used = 0;
    for (const it of items) { const i = Math.min(it.min || 0, it.levels.length - 1); at.set(it.key, i); used += it.levels[i].bytes; }
    const order = items.filter((it) => it.want > (it.min || 0)).sort((a, b) => b.prio - a.prio);
    for (let changed = true; changed;) {
      changed = false;
      for (const it of order) {
        const i = at.get(it.key);
        if (i >= it.want) continue;
        const d = it.levels[i + 1].bytes - it.levels[i].bytes;
        if (used + d > budget) continue;
        at.set(it.key, i + 1);
        used += d;
        changed = true;
      }
    }
    return at;
  }
  /** Under pressure: which textures go down first (the least needed), until `over` bytes are freed. items as plan's,
   *  with cur (index now). Returns [{ key, to }]. */
  function shed(items, over) {
    const out = [];
    const order = items.filter((it) => it.cur > (it.min || 0)).sort((a, b) => a.prio - b.prio);
    for (const it of order) {
      if (over <= 0) break;
      let to = it.cur;
      while (to > (it.min || 0) && over > 0) { over -= it.levels[to].bytes - it.levels[to - 1].bytes; to--; }
      out.push({ key: it.key, to });
    }
    return out;
  }

  // ------------------------------------------------------------------ the textures in the world
  const byUrl = new Map(); // url -> { entry, index }
  let indexed = null;
  /** Every level's address of every image in the bundle, so a texture made from any of them is recognised. */
  function index() {
    const assets = (H.bundle && H.bundle.assets) || {};
    if (indexed === assets) return;
    byUrl.clear();
    for (const [name, a] of Object.entries(assets)) {
      if (!a || !a.variants) continue;
      const entry = { name, ...a };
      const levels = levelsOf(entry);
      levels.forEach((l, i) => byUrl.set(l.url, { entry, levels, index: i }));
    }
    indexed = assets;
  }
  /** Where a texture of this asset starts: its smallest copy (or the asset itself when it has none). */
  function startUrl(entry) {
    if (!entry || !entry.variants || H.textures.off) return entry && entry.url;
    const levels = levelsOf(entry);
    return levels.length ? levels[0].url : entry.url;
  }

  const reserved = new Map();
  const stats = { upgrades: 0, downgrades: 0, failed: 0, loading: 0, usedMB: 0, managedMB: 0, otherMB: 0, managed: 0 };
  const budgetBytes = () => {
    const b = H.budget || {};
    let r = 0;
    for (const v of reserved.values()) r += v;
    return Math.max(8 * MB, (Number(b.textureMB) || 256) * MB - r);
  };

  /** A texture becomes managed: its levels, where it is now. */
  function adopt(t, info) {
    t._lod = { key: t.uniqueId, entry: info.entry, levels: info.levels, cur: info.index, want: info.index, prio: 0, since: 0, failed: new Set() };
    return t._lod;
  }
  function track(t, o = {}) {
    if (!t || t._lod) return t;
    index();
    const a = o.asset !== undefined ? (H.lib.assetEntry(o.asset) || null) : null;
    const info = a ? byUrl.get(t.url) || { entry: a, levels: levelsOf(a), index: 0 } : byUrl.get(t.url);
    if (info) adopt(t, info);
    return t;
  }

  /** Swaps a texture to another level without a blank frame: the new file loads beside it, then takes its place. */
  function swap(t, i) {
    const l = t._lod;
    const lv = l.levels[i];
    if (!lv || l.loading != null) return;
    l.loading = i;
    stats.loading++;
    const done = () => { stats.loading--; l.loading = null; };
    let nt = null;
    const onLoad = () => {
      done();
      if (t.isDisposed && t.isDisposed()) { nt.dispose(); return; }
      const it = nt._texture;
      if (!it) return;
      nt._texture = null;
      nt.dispose();
      const old = t._texture;
      t._texture = it;
      t.url = lv.url;
      if (old && old !== it) old.dispose();
      if (i > l.cur) stats.upgrades++; else stats.downgrades++;
      l.cur = i;
      // (No material is marked dirty: the same kind of texture, only bigger or smaller; materials bind the texture's
      // current file every frame. Marking every material dirty walks every mesh: seconds in a big world.)
    };
    const onError = () => { done(); l.failed.add(i); stats.failed++; try { nt.dispose(); } catch {} };
    try {
      nt = new B.Texture(lv.url, t.getScene(), t.noMipmap, t.invertY, t.samplingMode, onLoad, onError);
      nt._lodTemp = true; // (the one loading beside it: never managed itself)
      nt.hasAlpha = t.hasAlpha;
    } catch { onError(); }
  }

  // ------------------------------------------------------------------ how much of the screen each texture covers
  const TMPV = B ? new B.Vector3() : null;
  const SLOTS = ['diffuseTexture', 'albedoTexture', 'emissiveTexture', 'reflectionTexture', 'opacityTexture', 'baseTexture'];
  /** Pixels a mesh covers on screen, about (its bounding sphere's diameter), and whether it's in view. */
  function screenPx(m, cam, vh, planes) {
    if (!m.isEnabled() || !m.isVisible || m.visibility === 0) return null;
    const bi = m.getBoundingInfo && m.getBoundingInfo();
    if (!bi) return null;
    const s = bi.boundingSphere;
    const c = s.centerWorld, r = s.radiusWorld;
    cam.globalPosition.subtractToRef(c, TMPV);
    const d = TMPV.length();
    if (d <= r) return { px: vh * 2, inView: true, inside: true };
    const fov = cam.fov || 0.8;
    const px = (r / (d * Math.tan(fov / 2))) * vh;
    let inView = true;
    try { if (planes && !bi.isInFrustum(planes)) inView = false; } catch {}
    return { px, inView, inside: false };
  }

  /** Every half second: what each managed texture needs, the plan within the budget, the swaps. */
  function update() {
    const w = H.world;
    if (!w || !w.scene || H.textures.off) return;
    const sc = w.scene;
    const cam = sc.activeCamera;
    if (!cam) return;
    index();
    const eng = sc.getEngine();
    const vh = Math.max(1, eng.getRenderHeight(true)), vw = Math.max(1, eng.getRenderWidth(true));
    const planes = sc.frustumPlanes && sc.frustumPlanes.length ? sc.frustumPlanes : null;
    const managed = [];
    const seen = new Set();
    let other = 0;
    for (const t of sc.textures) {
      if (t._lodTemp) continue;
      if (!t._lod && t.url && byUrl.has(t.url)) adopt(t, byUrl.get(t.url));
      const it = t.getInternalTexture && t.getInternalTexture();
      if (t._lod) { managed.push(t); t._lod.need = 0; t._lod.prio = 0; t._lod.inView = false; if (it) seen.add(it); continue; }
      if (!it || seen.has(it)) continue;
      seen.add(it);
      const f = it.isCube ? 6 : 1;
      other += (it.width || 0) * (it.height || 0) * 4 * f * (it.generateMipMaps ? 4 / 3 : 1);
    }
    if (managed.length) {
      // Which meshes use each texture: materials' active textures, then the meshes (and instances) wearing them.
      const users = new Map();
      for (const mat of sc.materials) {
        let list = [];
        try { list = mat.getActiveTextures(); } catch { /* */ }
        // (Some materials don't list theirs: a sky's BackgroundMaterial keeps it as its reflection or diffuse.)
        for (const k of SLOTS) { const x = mat[k]; if (x && x._lod && !list.includes(x)) list = list.concat(x); }
        for (const t of list) if (t && t._lod) { if (!users.has(mat)) users.set(mat, []); if (!users.get(mat).includes(t)) users.get(mat).push(t); }
      }
      const meshes = sc.meshes;
      for (let k = 0; k < meshes.length; k++) {
        const m = meshes[k];
        const mat = m.material;
        if (!mat) continue;
        const mats = mat.subMaterials ? mat.subMaterials : [mat];
        let ts = null;
        for (const x of mats) { const u = x && users.get(x); if (u) ts = ts ? ts.concat(u) : u; }
        if (!ts) continue;
        const s = screenPx(m, cam, vh, planes);
        if (!s) continue;
        for (const t of ts) {
          const l = t._lod;
          const tile = Math.max(1, Math.abs(t.uScale || 1), Math.abs(t.vScale || 1));
          // A sky around the camera shows the whole picture across the field of view: the full width it needs.
          let need = s.px * tile;
          if (s.inside && /sky|dome/i.test(m.name || '')) { const hfov = 2 * Math.atan(Math.tan((cam.fov || 0.8) / 2) * (vw / vh)); need = (vw * Math.PI * 2) / Math.max(0.3, hfov); }
          need = Math.min(need, 16384);
          if (need > l.need) l.need = need;
          const p = s.inView ? s.px * (s.inside ? 4 : 1) : s.px * 0.15;
          if (p > l.prio) l.prio = p;
          if (s.inView) l.inView = true;
        }
      }
    }
    const max = Number(H.budget && H.budget.maxTexture) || 8192;
    const items = managed.map((t) => {
      const l = t._lod;
      let want = levelFor(l.levels, l.need, max);
      while (want > 0 && l.failed.has(want)) want--;
      l.want = want;
      return { key: l.key, levels: l.levels, want, prio: l.prio, cur: l.cur, t };
    });
    const budget = budgetBytes();
    const room = Math.max(0, budget - other);
    const target = plan(items, room);
    // (Two textures of the same file at the same level share it on the GPU: counted once.)
    let used = other;
    const counted = new Set();
    for (const it of items) { const lv = it.levels[it.cur]; if (!counted.has(lv.url)) { counted.add(lv.url); used += lv.bytes; } }
    stats.usedMB = +(used / MB).toFixed(1); stats.otherMB = +(other / MB).toFixed(1); stats.managedMB = +((used - other) / MB).toFixed(1); stats.managed = items.length;
    stats.budgetMB = +(budget / MB).toFixed(1);
    // Over the budget: the least needed go down now (the page is never killed for memory).
    if (used > budget) {
      for (const s of shed(items.map((it) => ({ ...it, cur: it.cur })), used - budget)) { const it = items.find((x) => x.key === s.key); if (it && s.to < it.cur) swap(it.t, s.to); }
      for (const f of pressure) try { f(used - budget); } catch {}
      return;
    }
    // Upgrades, most needed first, a few at a time; downgrades of what's no longer needed after a while (memory back).
    const now = performance.now();
    const loads = Number(H.budget && H.budget.loads) || 4;
    const ups = items.filter((it) => target.get(it.key) > it.cur && it.t._lod.loading == null).sort((a, b) => b.prio - a.prio);
    for (const it of ups) { if (stats.loading >= loads) break; swap(it.t, target.get(it.key)); }
    // (Only when the budget is getting full: with room to spare, a sharp texture stays sharp for when you turn back.)
    const tight = used > budget * 0.6;
    for (const it of items) {
      const l = it.t._lod;
      const to = target.get(it.key);
      if (tight && to < it.cur) { if (!l.since) l.since = now; else if (now - l.since > 8000 && l.loading == null) { l.since = 0; swap(it.t, to); } }
      else l.since = 0;
    }
  }
  const pressure = [];
  let acc = 0;
  H.hooks.frame.push((dt) => { acc += dt; if (acc < 0.5) return; acc = 0; try { update(); } catch (err) { if (!update.warned) { update.warned = true; console.warn('Hawkes Play: texture levels of detail', err); } } });
  H.hooks.world.push({ leave() { indexed = null; } });

  H.textures = {
    plan, shed, levelsOf, levelFor, gpuBytes, startUrl, track, update,
    /** A module keeps room for something big (bytes); 0 gives it back. */
    reserve(owner, bytes) { if (!bytes) reserved.delete(owner); else reserved.set(owner, Math.max(0, Number(bytes) || 0)); },
    /** Called with the bytes over budget when downgrading textures isn't enough (models drop their full-detail copies). */
    onPressure(fn) { pressure.push(fn); },
    /** Free room in the budget now (bytes; negative: over). */
    headroom() { return budgetBytes() - stats.usedMB * MB; },
    stats() { return { tier: H.device ? H.device.tier : null, ...stats }; },
    off: false,
  };
})();
