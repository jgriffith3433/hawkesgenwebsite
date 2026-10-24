// The kinds of things a world is made of (scene.json "type"), each registered with H.kinds.register(type, def):
//   build(shape, opts, spec)  makes the entity: shape is spec.shape (or a script maker's options), opts the common
//                             options (position, color, physics...), spec the scene.json spec (null from a script)
//   physics                   how it moves unless the spec says ('static', 'none', 'trigger'...)
//   maker                     true: game.<type>(opts); a function: game.<type>(...args) as it likes
//   destroy(e)                undoes what build made outside the entity's node (lights, observers, videos)
//   editor                    { word, lift(spec), textureable, motion, hotbar: [{ order, icon, label, make(yaw) }],
//                               asset: { kind, make(asset, { title, yaw }) } }: how build.js offers it
//   codex                     { group, what, spec, fields, uses, noFloor, props, config }: its page in /entities
// A module adds its own kinds the same way, in its own file (docs/engine-modules.md), and lists them in its
// module.json "kinds" so worlds may hold them.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const { Entity, shape, place, size3, hex, vec, assetUrl, hasAsset, setFrame } = L;
  // The world now (a new one is made every time the game starts over).
  const W = new Proxy({}, { get: (_, k) => H.world[k], set: (_, k, v) => { H.world[k] = v; return true; } });

  function model(name, opts = {}) {
    const root = new B.TransformNode(`model:${name}`, W.scene);
    const e = new Entity(root, opts, 'model');
    e._loaded = false;
    const want = Number(opts.size) || 0;
    e.half = [want / 2 || 0.5, want / 2 || 0.5, want / 2 || 0.5];
    place(e, opts);
    const world = H.world;
    let url;
    try { url = assetUrl(name); } catch (err) {
      if (!opts.lenient) throw err;
      // Not made yet: a wireframe stand-in until the asset arrives (setAssets rebuilds it).
      e._waiting = name;
      const box = B.MeshBuilder.CreateBox('waiting', { size: want || 1 }, W.scene);
      const m = new B.StandardMaterial('waiting', W.scene);
      m.wireframe = true; m.emissiveColor = new B.Color3(0.55, 0.7, 1); m.disableLighting = true; m.alpha = 0.8;
      box.material = m;
      box.parent = root;
      box.metadata = { entity: e };
      e._loaded = true;
      e.measure();
      return e;
    }
    // Level of detail: a low-detail copy (opts.low, or "<name>_low.glb" when the game has one) loads first and is
    // shown far away; the full model takes over up close. lodDistance is where they swap (meters).
    const named = (L.assetEntry(name) || { name }).name; // (an id: its name, for the low copy beside it)
    const lowName = opts.low !== undefined ? opts.low : (/\.glb$/i.test(named) && hasAsset(named.replace(/\.glb$/i, '_low.glb')) ? named.replace(/\.glb$/i, '_low.glb') : null);
    const load = (assetName, isLow) => B.SceneLoader.ImportMeshAsync('', '', assetName === name ? url : assetUrl(assetName), W.scene, null, '.glb').then((r) => {
      if (!e.alive || world !== H.world) { for (const m of r.meshes) m.dispose(); return null; }
      const holder = new B.TransformNode(isLow ? 'lod-low' : 'holder', W.scene);
      for (const m of r.meshes) if (!m.parent) m.parent = holder;
      for (const t of r.transformNodes) if (!t.parent) t.parent = holder;
      holder.computeWorldMatrix(true);
      let { min, max } = holder.getHierarchyBoundingVectors(true);
      const h = Math.max(1e-3, max.y - min.y);
      const k = want ? want / h : 1;
      holder.scaling.setAll(k);
      holder.computeWorldMatrix(true);
      ({ min, max } = holder.getHierarchyBoundingVectors(true));
      holder.position.set(-(min.x + max.x) / 2, -(min.y + max.y) / 2, -(min.z + max.z) / 2);
      holder.parent = root;
      root.computeWorldMatrix(true);
      if (opts.color) for (const m of r.meshes) if (m.material && m.material.albedoColor) m.material.albedoColor = hex(opts.color);
      if (W.shadows && opts.shadow !== false) for (const m of r.meshes) if (m.getTotalVertices() > 0) { W.shadows.addShadowCaster(m); (e._casters ||= new Set()).add(m); m.receiveShadows = true; }
      for (const m of r.meshes) m.metadata = { entity: e };
      return { holder, r };
    });
    const ready = () => { if (!e._loaded) { e._loaded = true; e.measure(); for (const f of H.hooks.world) if (f.loaded) f.loaded(e); } };
    if (lowName) {
      e._lod = { low: null, high: null, d: Number(opts.lodDistance) || 25 };
      load(lowName, true).then((x) => { if (!x) return; e._lod.low = x.holder; if (!e._lod.high) ready(); }).catch(() => {});
    }
    e.ready = load(name, false).then((x) => {
      if (!x) return e;
      const { r, holder } = x;
      if (e._lod) { e._lod.high = holder; }
      e.animations = r.animationGroups || [];
      for (const a of e.animations) a.stop();
      if (opts.animation && !e.play(opts.animation)) { if (e.animations[0]) e.animations[0].start(true); } else if (!opts.animation && opts.autoplay !== false && e.animations[0]) e.animations[0].start(true);
      ready();
      e.measure();
      return e;
    }).catch((err) => { H.report(new Error(`Could not load ${name}: ${err.message || err}`)); return e; });
    return e;
  }

  /** Each frame: models with a low-detail copy show the one that fits how far away they are. */
  function updateLods() {
    const cam = W.scene.activeCamera;
    if (!cam) return;
    for (const e of W.entities) {
      const l = e._lod;
      if (!l || !l.low) continue;
      if (!l.high) { l.low.setEnabled(true); continue; }
      const d = B.Vector3.Distance(cam.position, e.node.getAbsolutePosition());
      // A little either way of the swap distance, so it doesn't flicker at the edge.
      const far = l.far ? d > l.d * 0.9 : d > l.d * 1.1;
      if (far !== l.far || l.far === undefined) { l.far = far; l.low.setEnabled(far); l.high.setEnabled(!far); }
    }
  }

  function sprite(name, opts = {}) {
    const height = Number(opts.size) || 1;
    const plane = B.MeshBuilder.CreatePlane(`sprite:${name}`, { width: 1, height: 1, sideOrientation: B.Mesh.DOUBLESIDE }, W.scene);
    const e = new Entity(plane, { physics: 'none', ...opts }, 'sprite');
    const m = new B.StandardMaterial('sprite', W.scene);
    let t = null;
    try { t = new B.Texture(assetUrl(name), W.scene, false, true, W.pixelated || opts.pixel ? B.Texture.NEAREST_SAMPLINGMODE : B.Texture.TRILINEAR_SAMPLINGMODE); } catch (err) { if (!opts.lenient) throw err; e._waiting = name; }
    if (t) { t.hasAlpha = true; m.diffuseTexture = t; m.useAlphaFromDiffuseTexture = true; }
    else { m.wireframe = true; }
    m.emissiveColor = new B.Color3(1, 1, 1);
    m.disableLighting = true;
    m.backFaceCulling = false;
    if (opts.color) m.emissiveColor = hex(opts.color);
    plane.material = e._mat = m;
    e._tex = t;
    if (opts.billboard !== false) plane.billboardMode = B.Mesh.BILLBOARDMODE_Y;
    const frames = opts.frames || null;
    if (frames && t) { e._sheet = { cols: Math.max(1, frames.cols | 0), rows: Math.max(1, frames.rows | 0), from: 0, to: 0, fps: 0, loop: true, t: 0, frame: 0 }; setFrame(e, 0); }
    plane.scaling.set(height, height, 1);
    if (t) t.onLoadObservable.addOnce(() => {
      const sz = t.getSize();
      const cw = sz.width / (e._sheet ? e._sheet.cols : 1), ch = sz.height / (e._sheet ? e._sheet.rows : 1);
      plane.scaling.x = height * (cw / ch || 1);
      e.measure();
    });
    return place(e, opts);
  }

  function text(str, opts = {}) {
    const plane = H.textPlane(str, opts);
    const e = new Entity(plane, { physics: 'none', ...opts }, 'text');
    e._mat = plane.material;
    e._text = String(str);
    return place(e, { shadow: false, ...opts });
  }

  /** A light as an entity: it can be moved, found and edited like anything else. */
  function lightEntity(o = {}) {
    const node = new B.TransformNode('light', W.scene);
    const e = new Entity(node, { physics: 'none', ...o }, 'light');
    const p = vec(o.position, [0, 5, 0]);
    node.position.set(p[0], p[1], p[2]);
    makeLight(e, o.light || o);
    e.measure();
    return e;
  }

  function makeLight(e, l) {
    if (e._light) e._light.dispose();
    let light;
    const type = l.type || 'point';
    if (type === 'sun' || type === 'directional') { const d = vec(l.direction, [-0.4, -1, 0.3]); light = new B.DirectionalLight('sun', new B.Vector3(d[0], d[1], d[2]), W.scene); }
    else if (type === 'spot') { const d = vec(l.direction, [0, -1, 0]); light = new B.SpotLight('spot', B.Vector3.Zero(), new B.Vector3(d[0], d[1], d[2]), (l.angle || 60) * RAD, 2, W.scene); }
    else light = new B.PointLight('point', B.Vector3.Zero(), W.scene);
    light.parent = e.node;
    light.diffuse = hex(l.color, '#ffffff');
    light.intensity = l.intensity ?? 1;
    if (l.range) light.range = l.range;
    e._light = light;
    e.lightSpec = { type, color: l.color || '#ffffff', intensity: light.intensity, range: l.range || null };
    if (H.mode === 'build') {
      // In the editor a light is a small glowing ball you can grab.
      if (!e._marker) {
        const ball = B.MeshBuilder.CreateSphere('light-marker', { diameter: 0.35, segments: 12 }, W.scene);
        const m = new B.StandardMaterial('light-marker', W.scene);
        m.disableLighting = true;
        ball.material = m;
        ball.parent = e.node;
        ball.metadata = { entity: e };
        e._marker = ball;
      }
      e._marker.material.emissiveColor = hex(l.color, '#ffffff');
    }
    return light;
  }

  /** A waypoint: a glowing orb over a ring on the ground (not a box). Players reach it by coming close. Its role
   *  (data.role): 'waypoint' (a stop on a route), 'checkpoint' (you come back here), 'finish' (wins), 'start'.
   *  shape.radius is how close counts; data.next is the next one's id, and a line of small orbs shows the way. */
  const WAYPOINT_COLORS = { waypoint: '#22d3ee', checkpoint: '#34d399', finish: '#f4c430', start: '#a855f7' };

  function waypoint(spec, o) {
    const sh = spec.shape || {};
    const role = (spec.data && spec.data.role) || 'waypoint';
    const r = Number(sh.radius) || 1.6;
    const color = hex((spec.material && spec.material.color) || WAYPOINT_COLORS[role] || '#22d3ee');
    const root = new B.TransformNode('waypoint', W.scene);
    const mk = (mesh, alpha, glow = 1) => { const m = new B.StandardMaterial('wp', W.scene); m.emissiveColor = color.scale(glow); m.diffuseColor = color; m.disableLighting = true; m.alpha = alpha; mesh.material = m; mesh.parent = root; return mesh; };
    const orb = mk(B.MeshBuilder.CreateSphere('wp-orb', { diameter: 0.6, segments: 20 }, W.scene), 0.95);
    orb.position.y = 1.2;
    const ring = mk(B.MeshBuilder.CreateTorus('wp-ring', { diameter: r * 2, thickness: 0.06, tessellation: 48 }, W.scene), 0.85);
    ring.position.y = 0.05;
    const beam = mk(B.MeshBuilder.CreateCylinder('wp-beam', { diameterTop: 0.02, diameterBottom: 0.5, height: 6, tessellation: 12 }, W.scene), 0.12, 0.8);
    beam.position.y = 3;
    beam.isPickable = false;
    beam.metadata = { decor: true };
    const e = new Entity(root, { ...o, physics: 'none' }, 'waypoint');
    for (const m of [orb, ring]) m.metadata = { entity: e };
    e._mat = orb.material;
    e.waypoint = { role, radius: r, next: spec.data && spec.data.next, reached: false, orb, ring, beam, color };
    place(e, { ...o, shadow: false });
    e.half = [r, 1.5, r]; e.offset = [0, 1.2, 0];
    return e;
  }

  /** Each step: reaching a waypoint, its glow, and the dotted line to the next one. */
  function runWaypoints(dt) {
    const p = W.player;
    for (const e of W.entities) {
      const wp = e.waypoint;
      if (!wp || !e.alive) continue;
      const t = (Date.now() + L.clockOffset) / 1000;
      wp.orb.position.y = 1.2 + Math.sin(t * 2 + e.x) * 0.12;
      wp.ring.rotation.y += dt * 0.6;
      if (!wp.route && wp.next) drawRoute(e);
      if (!p || !p.alive || (H.mode === 'build' && wp.role !== 'checkpoint')) continue;
      const d = Math.hypot(p.x - e.x, (p.bottom) - (e.y), p.z - e.z);
      if (d > wp.radius + 0.4 || wp.reached && wp.role !== 'checkpoint') continue;
      if (wp.role === 'checkpoint') { if (wp.reached && W.checkpoint && W.checkpoint[0] === e.x && W.checkpoint[2] === e.z) continue; W.checkpoint = [e.x, e.y + 0.05, e.z]; for (const o of W.entities) if (o.waypoint && o.waypoint.role === 'checkpoint') o.waypoint.reached = o === e; H.game.ui.message('Checkpoint', 1.1); }
      wp.reached = true;
      H.game.burst([e.x, e.y + 1.2, e.z], { color: wp.color.toHexString(), count: 26, speed: 4 });
      W.state.waypoints = (W.state.waypoints || 0) + (wp.role === 'waypoint' ? 1 : 0);
      H.game.emit(wp.role === 'finish' ? 'finish' : wp.role === 'checkpoint' ? 'checkpoint' : 'waypoint', { entity: e });
      // A game that listens for 'finish' shows its own results; otherwise the engine says well done.
      if (wp.role === 'finish') { if (H.mode === 'build') H.game.ui.message('Finish! (in the game this ends it)', 2); else if (!(W.events.get('finish') || []).length) H.game.over((e.data && e.data.message) || 'You made it!'); }
      for (const h of e.handlers.hit) h(p);
      L.runBehaviorHit(e, p);
      wp.orb.material.alpha = 0.55;
      wp.beam.material.alpha = 0.05;
    }
  }

  function drawRoute(e) {
    const next = W.byId.get(e.waypoint.next);
    e.waypoint.route = [];
    if (!next || !next.alive) return;
    const a = new B.Vector3(e.x, e.y + 0.35, e.z), b = new B.Vector3(next.x, next.y + 0.35, next.z);
    const n = Math.max(1, Math.floor(B.Vector3.Distance(a, b) / 1.2));
    const m = new B.StandardMaterial('wp-dot', W.scene);
    m.emissiveColor = e.waypoint.color.scale(0.9); m.disableLighting = true; m.alpha = 0.7;
    for (let i = 1; i < n; i++) {
      const dot = B.MeshBuilder.CreateSphere('wp-dot', { diameter: 0.14, segments: 6 }, W.scene);
      dot.position = B.Vector3.Lerp(a, b, i / n);
      dot.material = m; dot.isPickable = false; dot.metadata = { decor: true };
      e.waypoint.route.push(dot);
    }
  }

  /** A screen playing a video asset (muted until clicked: browsers only allow sound after a click). */
  function screen(sh, o) {
    const w = Number(sh.width) || 3.2, h = Number(sh.height) || w * 9 / 16;
    const plane = B.MeshBuilder.CreatePlane('video', { width: w, height: h, sideOrientation: B.Mesh.DOUBLESIDE }, W.scene);
    const mat = new B.StandardMaterial('video', W.scene);
    mat.disableLighting = true;
    mat.emissiveColor = new B.Color3(1, 1, 1);
    plane.material = mat;
    const e = new Entity(plane, o, 'video');
    e._mat = mat;
    let url = null;
    try { url = assetUrl(sh.asset || ''); } catch { e._waiting = sh.asset || null; mat.wireframe = true; }
    if (url) {
      const vt = new B.VideoTexture('video', url, W.scene, true, false, B.Texture.TRILINEAR_SAMPLINGMODE, { autoPlay: true, loop: sh.loop !== false, muted: true, autoUpdateTexture: true });
      mat.diffuseTexture = vt;
      e._video = vt.video;
      e._video.crossOrigin = 'anonymous';
      e.on('click', () => { const v = e._video; v.muted = !v.muted; v.play().catch(() => {}); });
    }
    return place(e, { ...o, shadow: false });
  }

  function mirror(spec, o) {
    const sh = spec.shape || {};
    const w = Number(sh.width) || 2, h = Number(sh.height) || 3;
    const frame = new B.TransformNode('mirror', W.scene);
    const surface = B.MeshBuilder.CreatePlane('mirror-surface', { width: w, height: h }, W.scene);
    surface.parent = frame;
    const mat = new B.StandardMaterial('mirror', W.scene);
    const tex = new B.MirrorTexture('mirror-tex', 512, W.scene, true);
    tex.mirrorPlane = new B.Plane(0, 0, 1, 0);
    tex.level = 0.85;
    mat.reflectionTexture = tex;
    mat.diffuseColor = new B.Color3(0.05, 0.05, 0.08);
    surface.material = mat;
    const bm = new B.StandardMaterial('mirror-frame', W.scene);
    bm.diffuseColor = new B.Color3(0.6, 0.65, 0.7);
    for (const [sx, sy, sw, sht] of [[0, h / 2 + 0.03, w + 0.12, 0.06], [0, -h / 2 - 0.03, w + 0.12, 0.06], [-w / 2 - 0.03, 0, 0.06, h], [w / 2 + 0.03, 0, 0.06, h]]) {
      const seg = B.MeshBuilder.CreateBox('mirror-edge', { width: sw, height: sht, depth: 0.05 }, W.scene);
      seg.parent = frame; seg.position.set(sx, sy, 0); seg.material = bm;
    }
    const e = new Entity(frame, o, 'mirror');
    e._mat = bm;
    for (const c of frame.getChildMeshes()) c.metadata = { entity: e };
    place(e, { ...o, shadow: false });
    // What it reflects: everything, kept up to date as the world changes.
    let last = 0;
    e._mirrorObs = W.scene.onBeforeRenderObservable.add(() => {
      const now = performance.now();
      if (now - last < 1000) return;
      last = now;
      surface.computeWorldMatrix(true);
      const n = B.Vector3.TransformNormal(new B.Vector3(0, 0, -1), surface.getWorldMatrix()).normalize();
      tex.mirrorPlane = B.Plane.FromPositionAndNormal(surface.getAbsolutePosition(), n.scale(-1));
      tex.renderList = W.scene.meshes.filter((x) => x !== surface && x.isEnabled() && x.isVisible);
    });
    return e;
  }
  // Each frame: the right level of detail; each step: waypoints reached.
  H.hooks.frame.unshift(() => { if (H.world) updateLods(); });
  H.hooks.step.unshift((dt) => { if (H.world) runWaypoints(dt); });

  // ------------------------------------------------------------------ the kinds
  const TEXTURE = { textureable: true };
  const num = (v, d) => Number(v) || d;
  /** Round things are made with fewer sides on phones (H.budget.detail): they look the same at a glance. */
  const detail = (n) => Math.max(6, Math.round(n * ((H.budget && H.budget.detail) || 1)));
  const SAMPLE_GLB = 'https://models.babylonjs.com/boombox.glb';

  H.kinds.register('box', {
    physics: 'static', maker: true,
    build: (sh, o) => { const s = size3(sh.size, 1); return shape('box', () => B.MeshBuilder.CreateBox('box', { width: s[0], height: s[1], depth: s[2] }, W.scene), o, s.join(',')); },
    editor: {
      word: 'a block', ...TEXTURE,
      lift: (spec) => size3(spec.shape && spec.shape.size, 1)[1] / 2 + 0.02,
      hotbar: [
        { order: 10, icon: '▣', label: 'Crate', make: () => ({ type: 'box', name: 'Crate', shape: { size: [1, 1, 1] }, material: { color: '#b07a45' }, physics: 'dynamic' }) },
        { order: 30, icon: '▬', label: 'Platform', make: () => ({ type: 'box', name: 'Platform', shape: { size: [4, 0.4, 4] }, material: { color: '#8a93a8' }, physics: 'static' }) },
        { order: 40, icon: '▮', label: 'Wall', make: (yaw) => ({ type: 'box', name: 'Wall', shape: { size: [4, 3, 0.4] }, material: { color: '#cfc6b4' }, physics: 'static', transform: { rotation: [0, Math.round(yaw / L.RAD / 15) * 15, 0] } }) },
      ],
      // A texture from the library dropped on nothing plain: a floor tile wearing it.
      asset: { kind: 'texture', make: (a, o) => ({ type: 'box', name: o.title || 'Tile', shape: { size: [4, 0.2, 4] }, material: { texture: a.name, tile: 2, color: '#ffffff' }, physics: 'static', lift: 0.1 }) },
    },
    codex: {
      group: 'Shapes', what: 'A box. Floors, walls, crates, platforms: most levels start as boxes.',
      spec: { type: 'box', name: 'Crate', transform: { position: [0, 0.6, 0], rotation: [0, 25, 0] }, shape: { size: [1.2, 1.2, 1.2] }, material: { color: '#c8843f' }, physics: 'static' },
      fields: [['shape.size', 'a number, or [w, h, d] in meters', '1']],
    },
  });

  H.kinds.register('sphere', {
    physics: 'static', maker: true,
    build: (sh, o) => { const r = num(sh.radius, 0.5), n = detail(num(sh.segments, 24)); return shape('sphere', () => B.MeshBuilder.CreateSphere('sphere', { diameter: r * 2, segments: n }, W.scene), o, `${r},${n}`); },
    editor: {
      word: 'a ball', ...TEXTURE,
      lift: (spec) => num(spec.shape && spec.shape.radius, 0.5) + 0.02,
      hotbar: [{ order: 20, icon: '●', label: 'Ball', make: () => ({ type: 'sphere', name: 'Ball', shape: { radius: 0.4 }, material: { color: '#e04f5f' }, physics: 'dynamic', body: { bounce: 0.6 } }) }],
    },
    codex: {
      group: 'Shapes', what: 'A ball. Dynamic spheres fall, bounce and roll; this one drops onto the floor.',
      spec: { type: 'sphere', name: 'Ball', transform: { position: [0, 4, 0] }, shape: { radius: 0.6, segments: 32 }, material: { color: '#e04f5f' }, physics: 'dynamic' },
      fields: [['shape.radius', 'meters', '0.5'], ['shape.segments', 'smoothness', '24']],
    },
  });

  H.kinds.register('cylinder', {
    physics: 'static', maker: true,
    build: (sh, o) => { const r = num(sh.radius, 0.5), h = num(sh.height, 1), n = detail(num(sh.segments, 32)); return shape('cylinder', () => B.MeshBuilder.CreateCylinder('cylinder', { diameter: r * 2, height: h, tessellation: n }, W.scene), o, `${r},${h},${n}`); },
    editor: {
      word: 'a pillar', ...TEXTURE,
      lift: (spec) => (spec.transform && spec.transform.rotation ? 0.9 : num(spec.shape && spec.shape.height, 1) / 2 + 0.02),
      hotbar: [
        { order: 60, icon: '◎', label: 'Coin', make: () => ({ type: 'cylinder', name: 'Coin', shape: { radius: 0.35, height: 0.08 }, material: { color: '#f4c430', emissive: '#5a4200' }, physics: 'static', transform: { rotation: [90, 0, 0] }, behaviors: [{ use: 'collectible' }, { use: 'spin', speed: 120, axis: 'z' }] }) },
        { order: 70, icon: '⇑', label: 'Launch pad', make: () => ({ type: 'cylinder', name: 'Launch pad', shape: { radius: 0.8, height: 0.15 }, material: { color: '#22d3ee', emissive: '#063a44' }, physics: 'static', behaviors: [{ use: 'launch', power: 18 }] }) },
      ],
      // A sound from the library: a speaker that plays it when touched.
      asset: { kind: 'audio', make: (a, o) => ({ type: 'cylinder', name: o.title || 'Speaker', shape: { radius: 0.3, height: 0.6 }, material: { color: '#2b2f3a', emissive: '#2a1450' }, behaviors: [{ use: 'sound', asset: a.name }, { use: 'glow', color: '#a855f7' }], lift: 0.3 }) },
    },
    codex: {
      group: 'Shapes', what: 'A cylinder. Pillars, coins (thin and flat), barrels, towers.',
      spec: { type: 'cylinder', name: 'Pillar', transform: { position: [0, 1, 0] }, shape: { radius: 0.5, height: 2, segments: 24 }, material: { color: '#9aa4b8' }, physics: 'static' },
      fields: [['shape.radius', 'meters', '0.5'], ['shape.height', 'meters', '1'], ['shape.segments', 'smoothness', '32']],
    },
  });

  H.kinds.register('cone', {
    physics: 'static', maker: true,
    build: (sh, o) => { const r = num(sh.radius, 0.5), h = num(sh.height, 1), n = detail(num(sh.segments, 32)); return shape('cone', () => B.MeshBuilder.CreateCylinder('cone', { diameterTop: 0, diameterBottom: r * 2, height: h, tessellation: n }, W.scene), o, `${r},${h},${n}`); },
    editor: { word: 'a cone', ...TEXTURE, lift: (spec) => num(spec.shape && spec.shape.height, 1) / 2 + 0.02 },
    codex: {
      group: 'Shapes', what: 'A cone. Spikes, tree tops, roofs on round towers, traffic cones.',
      spec: { type: 'cone', name: 'Spike', transform: { position: [0, 0.75, 0] }, shape: { radius: 0.6, height: 1.5 }, material: { color: '#f97316' }, physics: 'static', behaviors: [{ use: 'hurts', damage: 20 }] },
      fields: [['shape.radius', 'meters at the base', '0.5'], ['shape.height', 'meters', '1']],
    },
  });

  H.kinds.register('capsule', {
    physics: 'static', maker: true,
    build: (sh, o) => { const r = num(sh.radius, 0.4), h = Math.max(r * 2, num(sh.height, 1.8)), n = detail(16); return shape('capsule', () => B.MeshBuilder.CreateCapsule('capsule', { radius: r, height: h, tessellation: n }, W.scene), o, `${r},${h},${n}`); },
    editor: { word: 'a capsule', ...TEXTURE, lift: (spec) => num(spec.shape && spec.shape.height, 1.8) / 2 + 0.02 },
    codex: {
      group: 'Shapes', what: 'A pill. The usual body for players and enemies: round ends slide over edges.',
      spec: { type: 'capsule', name: 'Player', tag: 'player', transform: { position: [0, 1, 0] }, shape: { radius: 0.4, height: 1.8 }, material: { color: '#4a9eff', emissive: '#0a1830' }, physics: 'dynamic' },
      fields: [['shape.radius', 'meters', '0.4'], ['shape.height', 'meters, end to end', '1.8']],
    },
  });

  H.kinds.register('torus', {
    physics: 'static', maker: true,
    build: (sh, o) => { const r = num(sh.radius, 1), t = num(sh.thickness, 0.3), n = detail(40); return shape('torus', () => B.MeshBuilder.CreateTorus('torus', { diameter: r * 2, thickness: t, tessellation: n }, W.scene), o, `${r},${t},${n}`); },
    editor: { word: 'a ring', ...TEXTURE, lift: () => 0.2 },
    codex: {
      group: 'Shapes', what: 'A ring. Hoops to fly through, wheels, halos.',
      spec: { type: 'torus', name: 'Hoop', transform: { position: [0, 1.4, 0], rotation: [90, 0, 0] }, shape: { radius: 1, thickness: 0.2 }, material: { color: '#22d3ee', emissive: '#063a44' }, physics: 'trigger', behaviors: [{ use: 'spin', speed: 45, axis: 'z' }] },
      fields: [['shape.radius', 'meters to the middle of the ring', '1'], ['shape.thickness', 'meters', '0.3']],
    },
  });

  H.kinds.register('plane', {
    physics: 'static',
    // game.plane({ size: [w, d] }) or { size: 10 }; scene.json { width, depth }.
    maker: (o = {}) => H.kinds.get('plane').build(o, o, null),
    build: (sh, o) => {
      const s = Array.isArray(sh.size) ? sh.size : sh.size !== undefined ? [Number(sh.size), Number(sh.size)] : [];
      const w = num(sh.width ?? s[0], 10), d = num(sh.depth ?? s[1], w);
      return shape('plane', () => B.MeshBuilder.CreateBox('plane', { width: w, height: 0.02, depth: d }, W.scene), o, `${w},${d}`);
    },
    editor: { word: 'a floor', ...TEXTURE, lift: () => 0.05 },
    codex: {
      group: 'Shapes', what: 'Flat ground. Give it a tiling texture from Gen and repeat it with material.tile.',
      spec: { type: 'plane', name: 'Ground', transform: { position: [0, 0, 0] }, shape: { width: 12, depth: 12 }, material: { color: '#3a7d44' }, physics: 'static' },
      fields: [['shape.width', 'meters along x', '10'], ['shape.depth', 'meters along z', 'the width']],
      noFloor: true,
    },
  });

  H.kinds.register('model', {
    physics: 'static',
    maker: (name, o = {}) => model(name, o),
    build: (sh, o, spec) => model(sh.asset || (spec && spec.data && spec.data.asset) || '', { ...o, size: Number(sh.size) || 0, animation: sh.animation, low: sh.lod && sh.lod.low !== undefined ? sh.lod.low : undefined, lodDistance: sh.lod && sh.lod.distance }),
    editor: {
      word: 'a 3D model', lift: (spec) => num(spec.shape && spec.shape.size, 1) / 2,
      asset: { kind: 'mesh', make: (a, o) => ({ type: 'model', name: o.title || 'Model', shape: { asset: a.name, size: 1.6 }, physics: 'static', lift: 0.8 }) },
    },
    codex: {
      group: 'World', what: 'A 3D model: a .glb file. Ask for one and Hawkes Gen draws it, builds the mesh and adds it to your assets; until the file arrives you see a wireframe.',
      uses: 'The model shown is a Babylon.js sample, so the page works without an account. In your game, shape.asset is the name of an asset in it.',
      spec: { type: 'model', name: 'Boombox', transform: { position: [0, 0.8, 0] }, shape: { asset: SAMPLE_GLB, size: 1.6 } },
      fields: [['shape.asset', 'an asset name in the game (tree.glb) or an https URL', ''], ['shape.size', 'its height in meters', 'its own size'], ['shape.animation', 'the animation to play', 'the first'], ['shape.lod', '{ low, distance }: a low-detail copy far away', '<name>_low.glb, 25 m']],
    },
  });

  H.kinds.register('sprite', {
    physics: 'none',
    maker: (name, o = {}) => sprite(name, o),
    build: (sh, o, spec) => sprite(sh.image || sh.asset || '', { ...o, physics: (spec && spec.physics) || o.physics || 'none', size: Number(sh.size) || 1, frames: sh.frames, billboard: sh.billboard }),
    editor: {
      word: 'a picture', lift: () => 1.2,
      asset: { kind: 'image', make: (a, o) => ({ type: 'sprite', name: o.title || 'Picture', shape: { image: a.name, size: 1.6, billboard: false }, transform: { rotation: [0, o.yaw, 0] }, lift: 1.2 }) },
    },
    codex: {
      group: 'World', what: 'A picture: an image from your library, facing you (or flat, like a poster). Shows as a wireframe until its picture exists.',
      spec: { type: 'sprite', name: 'Poster', transform: { position: [0, 1.2, 0] }, shape: { image: 'poster.png', size: 1.6, billboard: false } },
      fields: [['shape.image', 'an image asset in the game', ''], ['shape.size', 'height in meters', '1'], ['shape.frames', '{ cols, rows } for a sprite sheet', ''], ['shape.billboard', 'false keeps it flat', 'true']],
    },
  });

  H.kinds.register('text', {
    physics: 'none',
    maker: (str, o = {}) => text(str, o),
    build: (sh, o, spec) => text(sh.text ?? (spec && spec.name) ?? 'Text', { ...o, size: Number(sh.size) || 0.5, color: spec ? spec.material && spec.material.color : o.color, billboard: sh.billboard, background: sh.background }),
    editor: { word: 'a sign', lift: () => 1.2, hotbar: [{ order: 80, icon: 'T', label: 'Sign', make: () => ({ type: 'text', name: 'Sign', shape: { text: 'Hello!', size: 0.5 } }) }] },
    codex: {
      group: 'World', what: 'A floating sign. Instructions, names, scores, jokes.',
      spec: { type: 'text', name: 'Sign', transform: { position: [0, 1.5, 0] }, shape: { text: 'Welcome!\nGrab anything.', size: 0.35 } },
      fields: [['shape.text', 'the words (\\n for a new line)', ''], ['shape.size', 'letter height in meters', '0.5'], ['shape.billboard', 'false keeps it flat', 'true'], ['shape.background', 'a CSS color, or false', 'dark glass']],
    },
  });

  H.kinds.register('light', {
    physics: 'none',
    maker: (o = {}) => {
      const p = o.position ? vec(o.position) : [Number(o.x) || 0, o.y === undefined ? 5 : Number(o.y), Number(o.z) || 0];
      const e = lightEntity({ ...o, position: p, light: o });
      return Object.assign(e, { light: e._light, dispose: () => e.destroy() });
    },
    build: (sh, o, spec) => lightEntity({ ...o, light: (spec && spec.light) || {} }),
    destroy: (e) => { if (e._light) e._light.dispose(); },
    editor: { word: 'a light', lift: () => 1.5, motion: [], hotbar: [{ order: 50, icon: '✦', label: 'Light', make: () => ({ type: 'light', name: 'Lamp', light: { type: 'point', color: '#ffd9a0', intensity: 1.2, range: 12 } }) }] },
    codex: {
      group: 'World', what: 'A light: point (a bulb), spot (a cone) or sun (sunlight). Every scene already has a sky light and a sun.',
      spec: { type: 'light', name: 'Lamp', transform: { position: [0, 2.2, 0] }, light: { type: 'point', color: '#ffaa55', intensity: 1.6, range: 9 } },
      fields: [['light.type', 'point, spot or sun', 'point'], ['light.color', '#rrggbb', '#ffffff'], ['light.intensity', 'brightness', '1'], ['light.range', 'meters (point, spot)', ''], ['light.direction', '[x, y, z] (spot, sun)', '[0, -1, 0]'], ['light.angle', 'cone width in degrees (spot)', '60']],
      config: { ambient: 0.08, sun: 0.1 }, props: true,
    },
  });

  H.kinds.register('video', {
    physics: 'static',
    build: (sh, o) => screen(sh, o),
    destroy: (e) => { if (e._video) { try { e._video.pause(); e._video.removeAttribute('src'); e._video.load(); } catch {} } },
    editor: {
      word: 'a screen', lift: () => 1.4,
      asset: { kind: 'video', make: (a, o) => ({ type: 'video', name: o.title || 'Screen', shape: { asset: a.name, width: 3.2 }, transform: { rotation: [0, o.yaw, 0] }, lift: 1.4 }) },
    },
    codex: {
      group: 'World', what: 'A screen playing a video from your library, muted until someone clicks it. Shows as a wireframe until its video exists.',
      spec: { type: 'video', name: 'Screen', transform: { position: [0, 1.5, 0] }, shape: { asset: 'trailer.mp4', width: 3.2 } },
      fields: [['shape.asset', 'a video asset in the game', ''], ['shape.width', 'meters', '3.2'], ['shape.height', 'meters', '16:9 of the width'], ['shape.loop', 'false plays it once', 'true']],
    },
  });

  H.kinds.register('mirror', {
    physics: 'static',
    build: (sh, o, spec) => mirror(spec || { shape: sh }, o),
    destroy: (e) => { if (e._mirrorObs) e.node.getScene().onBeforeRenderObservable.remove(e._mirrorObs); },
    editor: { word: 'a mirror', lift: (spec) => num(spec.shape && spec.shape.height, 3) / 2 },
    codex: {
      group: 'World', what: 'A framed mirror with a live reflection: a doorway look for portals between games.',
      uses: 'It reflects the world, refreshed about once a second.',
      spec: { type: 'mirror', name: 'Mirror', transform: { position: [0, 1.6, 0] }, shape: { width: 2, height: 3 } },
      fields: [['shape.width', 'meters', '2'], ['shape.height', 'meters', '3']],
      props: true,
    },
  });

  /** spawn and trigger: boxes you see while building and not when playing. */
  function zone(type, sh, o, spec) {
    const isSpawn = type === 'spawn';
    const s = isSpawn ? [1.2, 0.15, 1.2] : size3(sh.size, 1);
    const e = shape(type, () => B.MeshBuilder.CreateBox(type, { width: s[0], height: s[1], depth: s[2] }, W.scene), { ...o, color: isSpawn ? '#34d399' : '#fbbf24', emissive: isSpawn ? '#0b3d2a' : '#3d2a05', opacity: 0.35, shadow: false, physics: isSpawn ? 'none' : ((spec && spec.physics) || o.physics || 'trigger') });
    e.node.isPickable = H.mode === 'build';
    if (H.mode !== 'build') e.node.visibility = 0;
    return e;
  }
  H.kinds.register('spawn', {
    physics: 'none',
    build: (sh, o, spec) => zone('spawn', sh, o, spec),
    editor: { word: 'where players start', lift: () => 0.1, motion: [], hotbar: [{ order: 90, icon: '⌂', label: 'Start', make: () => ({ type: 'spawn', name: 'Player start', data: { role: 'player' } }) }] },
    codex: {
      group: 'Logic', what: 'Where players start. A green box in the editor, invisible when the game plays.',
      spec: { type: 'spawn', name: 'Start', tag: 'player-start', transform: { position: [0, 0.5, 0] } },
      fields: [['data.role', 'who starts here', 'player']],
    },
  });
  H.kinds.register('trigger', {
    physics: 'trigger',
    build: (sh, o, spec) => zone('trigger', sh, o, spec),
    editor: { word: 'an invisible zone', lift: (spec) => size3(spec.shape && spec.shape.size, 1)[1] / 2, motion: [['trigger', 'Zone'], ['none', 'Off']] },
    codex: {
      group: 'Logic', what: 'An invisible zone: goals, danger, anything that should notice you. Amber in the editor; you walk through it, and it notices.',
      spec: { type: 'trigger', name: 'Goal', transform: { position: [0, 1, 0] }, shape: { size: [3, 2, 3] }, physics: 'trigger', behaviors: [{ use: 'goal', message: 'You made it!' }] },
      fields: [['shape.size', 'the zone, [w, h, d]', '1'], ['behaviors', 'what happens inside: goal, hurts, launch...', '']],
    },
  });

  H.kinds.register('waypoint', {
    physics: 'none',
    build: (sh, o, spec) => waypoint(spec || { shape: sh, data: o.data }, o),
    destroy: (e) => {
      if (e.waypoint && e.waypoint.route) for (const d of e.waypoint.route) d.dispose();
      for (const x of W.entities) if (x.waypoint && x.waypoint.next === e.sceneId && x.waypoint.route) { for (const d of x.waypoint.route) d.dispose(); x.waypoint.route = null; }
    },
    editor: { word: 'a waypoint', lift: () => 0.02, motion: [], hotbar: [{ order: 100, icon: '◉', label: 'Checkpoint', make: () => ({ type: 'waypoint', name: 'Checkpoint', shape: { radius: 1.6 }, data: { role: 'checkpoint' } }) }] },
    codex: {
      group: 'Logic', what: 'A glowing orb over a ring: a stop on a route, a checkpoint (players come back here after falling), the finish (wins) or a start. A dotted line leads to the next one.',
      spec: { type: 'waypoint', name: 'Checkpoint', transform: { position: [0, 0, 0] }, shape: { radius: 1.6 }, data: { role: 'checkpoint' } },
      fields: [['data.role', 'waypoint, checkpoint, finish or start', 'waypoint'], ['data.next', 'the next waypoint\'s id', ''], ['data.message', 'what the finish says', 'You made it!'], ['shape.radius', 'how close counts, meters', '1.6']],
    },
  });

  H.kinds.lift = (spec) => { const k = H.kinds.get(spec.type); return k && k.editor && k.editor.lift ? k.editor.lift(spec) : 0.1; };
})();
