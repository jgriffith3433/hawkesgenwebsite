// Scale: keeping a world playable when it fills up (a hundred animals, a pile of crates, an explosion's debris), on
// every device. Phone first: the budgets come from the device's tier, and desktop is never capped to a phone's.
//   H.device = { tier: 'phone' | 'tablet' | 'desktop', ios, memoryGB, cores, pixelRatio }
//   H.budget = { entities, bodies, shadows, detail, textureMB, maxTexture, pixelRatio, drawDistance, shadowDistance,
//                loads }  per tier; games and modules may lower or raise them (game.json / scene "budget": { ... } too).
//   - entities:  past it, the oldest things scripts made (never the world's own, never players) are removed with a puff
//   - bodies:    at most this many dynamic things are simulated; the farthest from the camera rest where they are
//                (frozen) until you come closer
//   - shadows:   only the nearest this-many things cast shadows, and none farther than shadowDistance (m)
//   - detail:    round things get fewer sides (kinds.js)
//   - textureMB: GPU memory for textures (textures.js keeps under it: sharp near, small far; strictest on iOS Safari,
//                which reloads a page that takes too much)
//   - maxTexture: the largest texture size loaded (px)
//   - pixelRatio: the most screen pixels per CSS pixel drawn (a phone's 3x screen draws at 2x: half the pixels to fill)
//   - drawDistance: how far things are drawn, per meter of their size (a 1 m crate on a phone: 220 m; a house: much
//                farther); never past the fog's end
//   - loads:     how many models and textures load at once (nearest first)
// Shared materials and instanced copies (game.many, "instanced": true) are in runtime.js; this file does the budgets.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const nav = window.navigator || {};
  const ua = String(nav.userAgent || '');
  const touchPoints = Number(nav.maxTouchPoints) || 0;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  const scr = window.screen || {};
  const shortSide = Math.min(Number(scr.width) || 1e4, Number(scr.height) || 1e4);
  const tier = !H.touchUi ? 'desktop' : (/iPad|Tablet/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1) || (shortSide >= 600 && !/Mobi/.test(ua))) ? 'tablet' : 'phone';
  const memoryGB = Number(nav.deviceMemory) || null; // (Chrome and Android only)
  H.device = { tier, ios, memoryGB, cores: Number(nav.hardwareConcurrency) || null, pixelRatio: Number(window.devicePixelRatio) || 1 };

  /** The budgets for a device: phones strict (iOS strictest), tablets between, desktop scaled up with its memory. */
  function budgetsFor(d) {
    if (d.tier === 'phone') return { entities: 900, bodies: 150, shadows: 30, detail: 0.5, textureMB: d.ios ? 64 : d.memoryGB && d.memoryGB <= 3 ? 64 : 96, maxTexture: 1024, pixelRatio: 2, drawDistance: 220, shadowDistance: 45, loads: 3 };
    if (d.tier === 'tablet') return { entities: 1500, bodies: 250, shadows: 70, detail: 0.75, textureMB: d.ios ? 128 : 160, maxTexture: 2048, pixelRatio: 2, drawDistance: 320, shadowDistance: 70, loads: 4 };
    const m = d.memoryGB;
    return { entities: 2500, bodies: 400, shadows: 160, detail: 1, textureMB: m && m <= 4 ? 256 : 512, maxTexture: 8192, pixelRatio: 0, drawDistance: 700, shadowDistance: 160, loads: 6 };
  }
  const DEFAULTS = budgetsFor(H.device);
  H.budget = { ...DEFAULTS };
  H.budgetsFor = budgetsFor;
  let born = 0;
  let t = 0;
  let warned = false;

  /** A phone's 3x screen drawn at 2x (pixelRatio 0: the device's own, never capped). */
  function applyPixelRatio() {
    const w = H.world;
    const eng = w && w.scene && w.scene.getEngine();
    if (!eng || !eng.setHardwareScalingLevel) return;
    const dpr = Number(window.devicePixelRatio) || 1;
    const cap = Number(H.budget.pixelRatio) || 0;
    const want = 1 / (cap > 0 ? Math.min(dpr, cap) : dpr);
    // (Only from the device's own scaling: photo mode raises it for a moment and puts it back itself.)
    if (Math.abs(eng.getHardwareScalingLevel() - 1 / dpr) < 1e-6 && Math.abs(want - 1 / dpr) > 1e-6) eng.setHardwareScalingLevel(want);
  }

  H.hooks.world.push({
    enter(w) {
      const b = (w.config && w.config.budget) || (w.gameJson && w.gameJson.budget);
      H.budget = { ...DEFAULTS, ...(b && typeof b === 'object' ? b : {}) };
      warned = false;
      t = 1;
      applyPixelRatio();
    },
  });

  /** How far a mesh is drawn: its size times drawDistance, never past the fog's end (nothing shows past it) unless
   *  the fog doesn't touch it (a planet, the sky's own things: applyFog false, or a material without fog). */
  function cullDistance(m, fogEnd) {
    const bi = m.getBoundingInfo && m.getBoundingInfo();
    const r = bi ? bi.boundingSphere.radiusWorld : 1;
    let d = Math.max(40, r * (Number(H.budget.drawDistance) || 700));
    const fogged = m.applyFog !== false && !(m.material && m.material.fogEnabled === false);
    if (fogEnd > 0 && fogged) d = Math.min(d, fogEnd + r * 2 + 10);
    return d;
  }
  /** Things too small to see from far away aren't drawn (Babylon's level of detail with nothing at the far end). */
  function cull(w) {
    const cfg = w.config || {};
    const fog = cfg.fog && typeof cfg.fog === 'object' ? Number(cfg.fog.end) || 0 : 0;
    const key = `${H.budget.drawDistance}|${fog}`;
    for (const e of w.entities) {
      if (e.noCull || e.isPlayer || e.remotePlayer || e === w.player || !e.node || e.kind === 'light') continue; // (e.noCull: always drawn)
      const list = e.node.getChildMeshes ? e.node.getChildMeshes(false) : [];
      if (e.node.getClassName && e.node.getClassName() !== 'TransformNode' && e.node.addLODLevel) list.push(e.node);
      for (const m of list) {
        if (m._cullKey === key || !m.addLODLevel || m._masterMesh || (m.getClassName && m.getClassName() === 'InstancedMesh')) continue;
        if (m._cullKey === undefined && m.getLODLevels && m.getLODLevels().length) { m._cullKey = 'own'; continue; } // a mesh with its own levels
        if (m._cullKey === 'own') continue;
        if (m._cullAt) m.removeLODLevel(null);
        m._cullAt = cullDistance(m, fog);
        try { m.addLODLevel(m._cullAt, null); } catch { m._cullAt = 0; }
        m._cullKey = key;
      }
    }
  }

  function each(dt) {
    const w = H.world;
    if (!w) return;
    for (const e of w.entities) if (!e._born) e._born = ++born;
    t += dt;
    if (t < 0.5) return;
    t = 0;
    const cam = w.scene.activeCamera;
    const c = cam ? cam.globalPosition || cam.position : { x: 0, y: 0, z: 0 };
    const dist = (e) => (e.x - c.x) ** 2 + (e.y - c.y) ** 2 + (e.z - c.z) ** 2;

    // Too many things: the oldest made by scripts go.
    const made = [];
    for (const e of w.entities) if (!e.sceneId && !e.isPlayer && !e.remotePlayer && e !== w.player && !e.keep && e.kind !== 'light') made.push(e);
    const over = w.entities.size - H.budget.entities;
    if (over > 0) {
      made.sort((a, b) => a._born - b._born);
      for (const e of made.slice(0, over)) { if (H.game) H.game.burst(e.position, { color: '#c8d8ff', count: 6, speed: 2 }); e.destroy(); }
      if (!warned) { warned = true; console.warn(`Hawkes Play: more than ${H.budget.entities} things; the oldest made ones make room (H.budget.entities)`); }
    }

    // Too many moving things: the farthest rest (frozen) until the camera comes near.
    const dyn = [];
    for (const e of w.entities) if (e.physics === 'dynamic' && e.alive && !e.remote && !e.held && !e.isPlayer) dyn.push(e);
    if (dyn.length > H.budget.bodies) {
      dyn.sort((a, b) => dist(a) - dist(b));
      dyn.forEach((e, i) => { const f = i >= H.budget.bodies; if (e._frozen !== f) { e._frozen = f; if (!f) e.wake(); } });
    } else for (const e of dyn) if (e._frozen) { e._frozen = false; e.wake(); }

    // Draw distance: small things far away aren't drawn.
    if (H.budget.drawDistance) cull(w);

    // Shadows from the nearest things only, and none past the shadow distance.
    const sg = w.shadows;
    if (sg) {
      const casters = [];
      const sd = Number(H.budget.shadowDistance) || 0;
      for (const e of w.entities) if (e._casters && e._casters.size && e.alive && e.node.isEnabled() && (!sd || dist(e) <= (sd + (e.half ? Math.max(...e.half) : 0)) ** 2)) casters.push(e);
      const list = sg.getShadowMap() && sg.getShadowMap().renderList;
      if (list) {
        if (casters.length > H.budget.shadows) casters.sort((a, b) => dist(a) - dist(b));
        const keep = [];
        for (const e of casters.slice(0, H.budget.shadows)) for (const m of e._casters) if (!m.isDisposed()) keep.push(m);
        // Shadows not from entities (a module's own meshes) stay.
        const owned = new Set();
        for (const e of w.entities) if (e._casters) for (const m of e._casters) owned.add(m);
        const others = list.filter((m) => !owned.has(m) && !m.isDisposed());
        list.length = 0;
        list.push(...others, ...keep);
      }
    }
  }
  H.hooks.step.push(each);
})();
