// Scale: keeping a world playable when it fills up (a hundred animals, a pile of crates, an explosion's debris), on
// every device. Phone first: the budgets come from the device's tier, and desktop is never capped to a phone's.
//   H.device = { tier: 'phone' | 'tablet' | 'desktop', ios, memoryGB, cores, pixelRatio }
//   H.budget = { entities, bodies, shadows, detail, textureMB, maxTexture, pixelRatio, drawDistance, shadowDistance,
//                loads, lights, catchUp, characters, farCharacter }  per tier; games and modules may lower or raise them (game.json / scene "budget": { ... } too).
//   - entities:  past it, the oldest things scripts made (never the world's own, never players) are removed with a puff
//   - characters: at most this many players' bodies animate in full (face, springs, gaze); the rest move simply (presence.js)
//   - farCharacter: past this many meters a body draws its half-detail meshes and moves simply, without blinking
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
//   - lights:    the most lights one material takes (a house's rooms); lamps with a range light only what's in it
//   - catchUp:   the most fixed steps one frame runs to catch up (a slow phone plays in slow motion instead of
//                spending ever longer frames catching up)
//   Shadows: only the nearest `shadows` things within shadowDistance cast, and each frame only those whose shadow
//   can fall where the camera looks (none when looking at the sky).
// Shared materials and instanced copies (game.many, "instanced": true) are in runtime.js; this file does the budgets.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = window.BABYLON;
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
    if (d.tier === 'phone') return { entities: 900, bodies: 150, shadows: 30, detail: 0.5, textureMB: d.ios ? 64 : d.memoryGB && d.memoryGB <= 3 ? 64 : 96, maxTexture: 1024, pixelRatio: 2, drawDistance: 220, shadowDistance: 45, loads: 3, lights: 4, catchUp: 3, characters: 10, farCharacter: 30 };
    if (d.tier === 'tablet') return { entities: 1500, bodies: 250, shadows: 70, detail: 0.75, textureMB: d.ios ? 128 : 160, maxTexture: 2048, pixelRatio: 2, drawDistance: 320, shadowDistance: 70, loads: 4, lights: 6, catchUp: 4, characters: 20, farCharacter: 30 };
    const m = d.memoryGB;
    return { entities: 2500, bodies: 400, shadows: 160, detail: 1, textureMB: m && m <= 4 ? 256 : 512, maxTexture: 8192, pixelRatio: 0, drawDistance: 700, shadowDistance: 160, loads: 6, lights: 8, catchUp: 8, characters: 40, farCharacter: 30 };
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
      shadow.near = null;
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
    const map = sg && sg.getShadowMap();
    if (map && map.renderList) {
      const casters = [];
      const sd = Number(H.budget.shadowDistance) || 0;
      for (const e of w.entities) if (e._casters && e._casters.size && e.alive && e.node.isEnabled() && (!sd || dist(e) <= (sd + (e.half ? Math.max(...e.half) : 0)) ** 2)) casters.push(e);
      if (casters.length > H.budget.shadows) casters.sort((a, b) => dist(a) - dist(b));
      const near = new Set();
      for (const e of casters.slice(0, H.budget.shadows)) for (const m of e._casters) near.add(m);
      // Shadows not from entities (a module's own meshes: creatures' parts, models' meshes) by their own distance.
      const owned = new Set();
      for (const e of w.entities) if (e._casters) for (const m of e._casters) owned.add(m);
      for (const m of map.renderList) {
        if (owned.has(m) || m.isDisposed()) continue;
        const s = m.getBoundingInfo().boundingSphere;
        if (!sd || (s.centerWorld.x - c.x) ** 2 + (s.centerWorld.y - c.y) ** 2 + (s.centerWorld.z - c.z) ** 2 <= (sd + s.radiusWorld) ** 2) near.add(m);
      }
      shadow.near = near;
      shadow.seen = new Set(map.renderList);
      if (map.getCustomRenderList !== castersInView) map.getCustomRenderList = castersInView;
    }

    // Lamps light what's in their range, not every mesh in the world.
    lightByRange(w);
  }

  /** A point or spot light with a range lights only the meshes within it (Babylon's includedOnlyMeshes), so a house
   *  full of lamps doesn't add a light to every shader in the world. A light whose owner chose its meshes (the house's
   *  rooms) is left alone. Changed only when the meshes in range change (each change recompiles their shaders). */
  function lightByRange(w) {
    const sc = w.scene;
    const lamps = [];
    for (const l of sc.lights) {
      const range = Number(l.range);
      if (!(range > 0 && range < 1e6) || !(l instanceof B.PointLight || l instanceof B.SpotLight) || l.isDisposed()) continue;
      const own = l.includedOnlyMeshes;
      if (own && own.length && own !== l._hpRange) continue;
      lamps.push({ l, range, p: l.getAbsolutePosition(), near: [] });
    }
    if (!lamps.length) return;
    for (const m of sc.meshes) {
      if (m.isDisposed() || !m.isEnabled(false)) continue;
      if (m.instances && m.instances.length) { for (const k of lamps) k.near.push(m); continue; } // (instances light by their source mesh)
      const s = m.getBoundingInfo().boundingSphere;
      for (const k of lamps) if ((s.centerWorld.x - k.p.x) ** 2 + (s.centerWorld.y - k.p.y) ** 2 + (s.centerWorld.z - k.p.z) ** 2 <= (k.range + s.radiusWorld) ** 2) k.near.push(m);
    }
    for (const { l, near } of lamps) {
      // (An empty list means every mesh to Babylon: a light with nothing near lights a hidden mesh of its own.)
      if (!near.length) near.push(nothing(sc));
      const was = l._hpRange;
      if (was && was.length === near.length && was.every((m, i) => m === near[i])) continue;
      l._hpRange = near;
      l.includedOnlyMeshes = near;
    }
  }
  function nothing(sc) {
    if (!sc._hpNothing || sc._hpNothing.isDisposed()) { sc._hpNothing = new B.Mesh('lit-nothing', sc); sc._hpNothing.setEnabled(false); sc._hpNothing.metadata = { decor: true }; }
    return sc._hpNothing;
  }
  H.hooks.step.push(each);

  // The GPU governor: a desktop's budget doesn't know how fast its graphics card is. When the frame rate stays low the
  // most expensive full-screen extras go, one step at a time (never back up: it would only flap): the bloom and the
  // soft shadow's blur passes, then the screen is drawn at a lower resolution (1.25x, then 1.5x coarser).
  const gov = { slow: 0, step: 0, base: 0, set: 0 };
  H.hooks.world.push({ enter() { gov.slow = 0; gov.step = 0; gov.base = 0; gov.set = 0; } });
  H.hooks.frame.push((dt) => {
    const w = H.world;
    const eng = w && w.scene && w.scene.getEngine();
    if (!eng || gov.step >= 3 || (typeof document !== 'undefined' && document.hidden) || dt > 0.25) return;
    if (eng.getFps() < 36) gov.slow += dt; else gov.slow = Math.max(0, gov.slow - dt * 2);
    if (gov.slow < 4) return;
    gov.slow = 0;
    gov.step++;
    if (gov.step === 1) {
      if (w.look) w.look.bloomEnabled = false;
      const sg = w.shadows;
      if (sg && sg.useBlurExponentialShadowMap) { sg.useBlurExponentialShadowMap = false; sg.useExponentialShadowMap = true; }
    } else {
      const now = eng.getHardwareScalingLevel();
      if (!gov.base) gov.base = now;
      if (gov.set && Math.abs(now - gov.set) > 1e-6) return; // (photo mode or a module has it for a moment)
      gov.set = gov.base * (gov.step === 2 ? 1.25 : 1.5);
      eng.setHardwareScalingLevel(gov.set);
    }
  });

  // The shadow map is drawn every frame from its casters, and Babylon doesn't cull them (looking at the sky still drew
  // every caster in the world). Each frame it draws only the near ones (above) whose shadow can fall where the camera
  // looks: the thing and the shadow it throws along the sun (about twice its size) in the camera's view.
  // map.renderList keeps every caster (modules add theirs as before); this is the list drawn.
  const shadow = { near: null, seen: null, list: [], frame: -1, planes: null, scene: null, sig: 0 };
  // And it's drawn again only when what it shows changed: a caster moved, came or went, or the sun turned (a still
  // world, or one looked at from where nothing moves, draws no shadow map at all). Seen a frame late: a moved
  // thing's matrix is worked out as the frame draws.
  H.hooks.frame.push(() => {
    const w = H.world;
    const map = w && w.shadows && shadow.near && w.shadows.getShadowMap();
    if (!map || map.getCustomRenderList !== castersInView) return;
    const list = castersInView(0, map.renderList, map.renderList.length);
    let sig = list.length + 1;
    for (const m of list) sig = (sig * 31 + m.uniqueId * 7 + m.getWorldMatrix().updateFlag) % 2147483647;
    const d = w.sun && w.sun.direction;
    if (d) sig = (sig * 31 + Math.round(d.x * 1e4) * 3 + Math.round(d.y * 1e4) * 5 + Math.round(d.z * 1e4) * 7) % 2147483647;
    if (map.refreshRate !== 0) map.refreshRate = 0; // (drawn once, then again when asked)
    if (sig !== shadow.sig) { shadow.sig = sig; map.resetRefreshCounter(); map._hpRedraws = (map._hpRedraws || 0) + 1; }
  });
  function castersInView(pass, all, count) {
    const w = H.world;
    const sc = w && w.scene;
    if (!sc || !shadow.near) return null;
    const frame = sc.getFrameId();
    if (shadow.frame === frame && shadow.scene === sc) return shadow.list;
    shadow.frame = frame; shadow.scene = sc;
    const out = shadow.list;
    out.length = 0;
    const cam = sc.activeCamera;
    const planes = cam ? (shadow.planes ||= [0, 1, 2, 3, 4, 5].map(() => new B.Plane(0, 0, 0, 0))) : null;
    if (planes) B.Frustum.GetPlanesToRef(cam.getTransformationMatrix(), planes);
    const sun = w.sun && w.sun.direction;
    const sl = sun ? Math.hypot(sun.x, sun.y, sun.z) || 1 : 1;
    const dx = sun ? sun.x / sl : 0, dy = sun ? sun.y / sl : -1, dz = sun ? sun.z / sl : 0;
    for (let i = 0; i < count; i++) {
      const m = all[i];
      if (!shadow.near.has(m) && shadow.seen.has(m)) continue; // (new since the last pass: drawn until it's judged)
      if (!m.isVisible || !m.isEnabled()) continue;
      if (planes) {
        const s = m.getBoundingInfo().boundingSphere;
        const r = s.radiusWorld, half = (r * 2 + 1) / 2; // (the shadow: up to about twice its size along the sun)
        // Too small to see a shadow of (a knob, a handle; a cup across the room).
        const cp = cam.globalPosition;
        if (r < 0.05 || r < 0.008 * Math.hypot(s.centerWorld.x - cp.x, s.centerWorld.y - cp.y, s.centerWorld.z - cp.z)) continue;
        const x = s.centerWorld.x + dx * half, y = s.centerWorld.y + dy * half, z = s.centerWorld.z + dz * half;
        let inside = true;
        for (const p of planes) if (p.normal.x * x + p.normal.y * y + p.normal.z * z + p.d <= -(r + half)) { inside = false; break; }
        if (!inside) continue;
      }
      out.push(m);
    }
    return out;
  }

  /** A thing built from many parts drawn as one mesh per material: H.mergeParts(meshes) joins the ones with the same
   *  parent, material and role (pickable, decor, shadows) into one mesh each, in the parent's space, and gives back
   *  the meshes now standing for them (merged ones and those left as they were). Only for parts that never move
   *  against their parent: leave moving parts (wheels, doors, rotors, flames) out, or give o.keep(mesh) for them. */
  function mergeParts(parts, o = {}) {
    const groups = new Map();
    const out = [];
    for (const m of parts) {
      const plain = m && !m.isDisposed() && m.material && m.parent && m.getClassName() === 'Mesh' && !m.getChildren().length && !m.skeleton && !m.morphTargetManager && m.isVisible && m.isEnabled(false) && !m.hasInstances && !(m.getLODLevels && m.getLODLevels().length) && !(o.keep && o.keep(m));
      if (!plain) { if (m) out.push(m); continue; }
      const md = m.metadata || {};
      const key = `${m.parent.uniqueId}|${m.material.uniqueId}|${md.decor ? 1 : 0}|${m.isPickable ? 1 : 0}|${m.receiveShadows ? 1 : 0}|${m.renderingGroupId}|${m.layerMask}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    const M = new B.Matrix(), Q = new B.Quaternion();
    for (const list of groups.values()) {
      if (list.length < 2) { out.push(...list); continue; }
      let joined = null;
      try {
        const vds = list.map((m) => {
          const vd = B.VertexData.ExtractFromMesh(m, true, true);
          const q = m.rotationQuaternion || B.Quaternion.FromEulerAnglesToRef(m.rotation.x, m.rotation.y, m.rotation.z, Q);
          B.Matrix.ComposeToRef(m.scaling, q, m.position, M);
          vd.transform(M);
          return vd;
        });
        const vd = vds[0];
        vd.merge(vds.slice(1), true);
        const first = list[0];
        joined = new B.Mesh(`${first.name}-parts`, first.getScene());
        vd.applyToMesh(joined, false);
        joined.parent = first.parent;
        joined.material = first.material;
        joined.metadata = first.metadata ? { ...first.metadata } : null;
        joined.isPickable = first.isPickable;
        joined.receiveShadows = first.receiveShadows;
        joined.renderingGroupId = first.renderingGroupId;
        joined.layerMask = first.layerMask;
      } catch (err) {
        // (Parts whose vertex data can't be joined, colors on some and not others: left as they were.)
        if (joined) joined.dispose();
        out.push(...list);
        continue;
      }
      for (const m of list) m.dispose();
      out.push(joined);
    }
    return out;
  }
  H.mergeParts = mergeParts;
})();
