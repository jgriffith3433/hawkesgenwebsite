// Homes and media, the core: things you use (look at one, press E or tap the prompt), seats and beds (the "seat"
// controller), state everyone in a game shares (a door is open for everybody), sounds near things, and assemblies
// (a house or a wall made of many solid pieces that move together). furniture.js, screens.js and house.js build on it.
// H.homes is this file's API for the other files (and other modules); scripts see game.homes (docs/api/65-homes.md).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const RAD = Math.PI / 180;
  const W = () => H.world;
  const vec = L.vec;
  const hex = L.hex;
  const homes = (H.homes = {});

  // ------------------------------------------------------------------ materials (shared per world for details)
  let matCache = { scene: null, map: new Map() };
  /** A shared material for a detail (legs, handles, shelves): one per color in a world. o: { emissive, alpha, glow, texture, tile } */
  function mat(color, o = {}) {
    const sc = W().scene;
    if (matCache.scene !== sc) matCache = { scene: sc, map: new Map() };
    const key = `${color}|${o.emissive || ''}|${o.alpha ?? 1}|${o.glow ? 1 : 0}|${o.texture || ''}|${o.tile || ''}|${o.spec || ''}`;
    let m = matCache.map.get(key);
    if (m) return m;
    m = new B.StandardMaterial(`homes:${color}`, sc);
    m.diffuseColor = hex(color, '#cccccc');
    m.specularColor = new B.Color3(o.spec || 0.06, o.spec || 0.06, o.spec || 0.06);
    if (o.emissive) m.emissiveColor = hex(o.emissive, '#000000');
    if (o.glow) { m.emissiveColor = hex(color); m.disableLighting = true; }
    if (o.alpha !== undefined && o.alpha < 1) { m.alpha = o.alpha; m.backFaceCulling = false; }
    if (o.texture && L.hasAsset(o.texture)) {
      try {
        const t = new B.Texture(L.assetUrl(o.texture), sc);
        const tl = Array.isArray(o.tile) ? o.tile : [o.tile || 1, o.tile || 1];
        t.uScale = tl[0] || 1; t.vScale = tl[1] || 1;
        m.diffuseTexture = t; m.diffuseColor = new B.Color3(1, 1, 1);
      } catch { /* a stand-in color it is */ }
    }
    matCache.map.set(key, m);
    return m;
  }

  // ------------------------------------------------------------------ building furniture out of primitives
  /** A part of a thing: a box, cylinder, sphere... as a child of `parent`, at [x, y, z] (y from the floor). */
  function part(parent, kind, size, at, material, o = {}) {
    const sc = W().scene;
    let m;
    const s = Array.isArray(size) ? size : [size, size, size];
    if (kind === 'box') m = B.MeshBuilder.CreateBox('part', { width: s[0], height: s[1], depth: s[2] }, sc);
    else if (kind === 'cyl') m = B.MeshBuilder.CreateCylinder('part', { diameter: s[0], height: s[1], tessellation: o.tess || 16 }, sc);
    else if (kind === 'cone') m = B.MeshBuilder.CreateCylinder('part', { diameterTop: s[2] ?? 0, diameterBottom: s[0], height: s[1], tessellation: o.tess || 16 }, sc);
    else if (kind === 'sphere') m = B.MeshBuilder.CreateSphere('part', { diameterX: s[0], diameterY: s[1] ?? s[0], diameterZ: s[2] ?? s[0], segments: o.seg || 12 }, sc);
    else if (kind === 'plane') m = B.MeshBuilder.CreatePlane('part', { width: s[0], height: s[1], sideOrientation: o.double ? B.Mesh.DOUBLESIDE : B.Mesh.DEFAULTSIDE }, sc);
    else if (kind === 'torus') m = B.MeshBuilder.CreateTorus('part', { diameter: s[0], thickness: s[1], tessellation: o.tess || 24 }, sc);
    else throw new Error(`part: ${kind}`);
    m.parent = parent;
    const p = vec(at);
    m.position.set(p[0], p[1], p[2]);
    if (o.rot) { const r = vec(o.rot); m.rotation.set(r[0] * RAD, r[1] * RAD, r[2] * RAD); }
    m.material = typeof material === 'string' ? mat(material, o) : material;
    m.receiveShadows = true;
    if (o.decor) m.metadata = { decor: true };
    if (o.keep) m.metadata = { ...(m.metadata || {}), keep: true };
    return m;
  }

  /** A kind of furniture: an entity whose node sits on the floor (its position is the point on the floor under it).
   *  make(root, e) adds its parts; the main color (opts.color) is e._mat, so the editor's color works. A model asset
   *  (shape.model, or "<kind>.glb" when the game has one) replaces the stand-in's look; the stand-in stays as the
   *  collider and for the moving parts it keeps (metadata.keep). */
  function furniture(kind, sh, o, make, defaults = {}) {
    const sc = W().scene;
    const root = new B.TransformNode(kind, sc);
    const e = new L.Entity(root, o, kind);
    const main = new B.StandardMaterial(kind, sc);
    main.diffuseColor = hex(o.color, defaults.color || '#c8a27a');
    main.specularColor = new B.Color3(0.08, 0.08, 0.08);
    if (o.emissive) main.emissiveColor = hex(o.emissive, '#000000');
    if (o.texture && L.hasAsset(o.texture)) { try { main.diffuseTexture = new B.Texture(L.assetUrl(o.texture), sc); } catch {} }
    e._mat = main;
    make(root, e, main);
    for (const m of root.getChildMeshes()) m.metadata = { ...(m.metadata || {}), entity: e };
    L.place(e, o);
    const model = sh.model || (L.hasAsset(`${kind}.glb`) ? `${kind}.glb` : null);
    if (model) dress(e, model);
    return e;
  }

  /** Puts a model over a stand-in thing: scaled to the stand-in's height, standing on the floor, centered. */
  function dress(e, name) {
    let url;
    try { url = L.assetUrl(name); } catch { e._waiting = name; return; }
    const root = e.node;
    root.computeWorldMatrix(true);
    const kids = root.getChildMeshes();
    const { min, max } = root.getHierarchyBoundingVectors(true);
    const height = Math.max(0.05, (max.y - min.y) / (root.scaling.y || 1));
    const world = H.world;
    e.ready = B.SceneLoader.ImportMeshAsync('', '', url, W().scene, null, '.glb').then((r) => {
      if (!e.alive || world !== H.world) { for (const m of r.meshes) m.dispose(); return e; }
      const holder = new B.TransformNode('dress', W().scene);
      for (const m of r.meshes) if (!m.parent) m.parent = holder;
      holder.computeWorldMatrix(true);
      let b = holder.getHierarchyBoundingVectors(true);
      const k = height / Math.max(1e-3, b.max.y - b.min.y);
      holder.scaling.setAll(k);
      holder.computeWorldMatrix(true);
      b = holder.getHierarchyBoundingVectors(true);
      holder.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
      holder.parent = root;
      holder.rotation.y = 0;
      for (const m of r.meshes) { m.metadata = { decor: true, entity: e }; m.isPickable = false; if (W().shadows) { W().shadows.addShadowCaster(m); m.receiveShadows = true; } }
      // The stand-in stays as the collider (invisible), except the parts that move or glow (screens, water, doors).
      for (const m of kids) if (!(m.metadata && m.metadata.keep)) m.isVisible = false;
      e._dressed = holder;
      return e;
    }).catch((err) => { H.report(new Error(`Could not load ${name}: ${err.message || err}`)); return e; });
  }

  /** A point in a thing's own space ([x, y, z] from its floor point), in the world. */
  function worldPoint(e, at) {
    const p = vec(at);
    e.node.computeWorldMatrix(true);
    const v = B.Vector3.TransformCoordinates(new B.Vector3(p[0], p[1], p[2]), e.node.getWorldMatrix());
    return [v.x, v.y, v.z];
  }
  const yawOf = (e) => e.node.rotation.y;

  // ------------------------------------------------------------------ state everyone shares
  // Every thing you can use has an id (its scene id, "<house>/<part>" for a house's parts, "s<n>" for ones scripts
  // make) and a small state ({ open: true }, { on: false, channel: 2 }). A change goes to everyone at once
  // (H.sync.action: the host decides, everyone applies the same patch), and the host's copy reaches people who join.
  const things = new Map(); // id -> entity
  let scriptSeq = 0;
  /** Gives a thing shared state. key: its spec's id (scene things), opts.homesKey (a house's parts), else made up. */
  function track(e, initial, apply, key) {
    const id = key || `s${++scriptSeq}`;
    e.homes = { id, state: { ...initial }, apply };
    e.homesKey = id;
    things.set(id, e);
    e.onDestroy(() => { if (things.get(id) === e) things.delete(id); });
    try { apply(e.homes.state, Object.keys(initial), 'init'); } catch (err) { H.report(err, `homes ${e.kind}`); }
    return e.homes;
  }
  function applyPatch(id, patch, quiet) {
    const e = things.get(id);
    if (!e || !e.alive || !patch) return;
    const changed = [];
    for (const [k, v] of Object.entries(patch)) if (JSON.stringify(e.homes.state[k]) !== JSON.stringify(v)) { e.homes.state[k] = v; changed.push(k); }
    if (!changed.length) return;
    try { e.homes.apply(e.homes.state, changed, Boolean(quiet)); } catch (err) { H.report(err, `homes ${e.kind}`); }
    for (const f of e.handlers.change || []) f({ ...e.homes.state }, changed);
  }
  const shareSet = H.sync ? H.sync.action('homes:set', (d) => applyPatch(d.id, d.p)) : (d) => applyPatch(d.id, d.p);
  /** Changes a thing's state for everyone: set(door, { open: true }). */
  function set(e, patch) { if (e && e.homes) shareSet({ id: e.homes.id, p: patch }); }
  if (H.sync) {
    H.sync.state('homes', {
      rate: 2,
      get: () => { const o = {}; for (const [id, e] of things) if (e.alive && e.homes) o[id] = e.homes.state; return o; },
      set: (st, changed) => { for (const id of changed) applyPatch(id, st[id], true); },
    });
  }

  // ------------------------------------------------------------------ using things: look at it, E (or tap)
  // e._use: [{ label (text or a function), at: [x, y, z] in its own space, use(ctx), when?() }]. The point nearest to
  // where you look (and within reach) is the one E uses; the prompt says what it does ("E  Sit").
  const REACH = 2.6;
  function usable(e, points) {
    e._use = (e._use || []).concat(points);
    if (!e.handlers.use) e.handlers.use = [];
    if (!e.handlers.change) e.handlers.change = [];
    if (!e._useClick) {
      e._useClick = true;
      // On a phone, tapping a thing in reach uses it too.
      e.on('click', (pt) => { if (H.touchUi && H.mode === 'play' && W().player) { const c = choose(e, pt); if (c) use(e, c, 'tap'); } });
    }
    return e;
  }
  const labelOf = (e, pt) => String(typeof pt.label === 'function' ? pt.label(e) : pt.label || 'use');
  function choose(e, hitPoint) {
    const p = W().player;
    if (!p || !e._use) return null;
    let best = null, bd = Infinity;
    for (const pt of e._use) {
      if (pt.when && !pt.when(e)) continue;
      const wp = worldPoint(e, pt.at || [0, 0.5, 0]);
      const reach = Math.hypot(wp[0] - p.x, wp[2] - p.z) - (pt.reach || 0);
      if (reach > REACH || Math.abs(wp[1] - (p.bottom + 1)) > 2.4) continue;
      const d = hitPoint ? Math.hypot(wp[0] - hitPoint[0], wp[1] - hitPoint[1], wp[2] - hitPoint[2]) : reach;
      if (d < bd) { bd = d; best = pt; }
    }
    return best;
  }
  const ownerOf = (e) => { let x = e; for (let i = 0; i < 4 && x; i++) { if (x._use) return x; x = x._useOwner; } return null; };
  function lookTarget() {
    const w = W(), p = w.player, g = H.game;
    if (!p || !p.alive || !g) return null;
    const cam = w.scene.activeCamera;
    const far = Math.hypot(cam.position.x - p.x, cam.position.y - (p.bottom + 1.6), cam.position.z - p.z) + REACH + 0.5;
    const hit = g.aim(far);
    if (hit && hit.entity) {
      const e = ownerOf(hit.entity);
      if (e && e.alive) { const pt = choose(e, hit.point); if (pt) return { e, pt }; }
    }
    // Nothing under the crosshair: the closest thing in front of you, within a step or two.
    const f = { x: Math.sin(w.camera.yaw || 0), z: Math.cos(w.camera.yaw || 0) };
    let best = null, bd = 1.7;
    for (const e of usables()) {
      for (const pt of e._use) {
        if (pt.when && !pt.when(e)) continue;
        const wp = worldPoint(e, pt.at || [0, 0.5, 0]);
        const dx = wp[0] - p.x, dz = wp[2] - p.z, d = Math.hypot(dx, dz);
        if (d > bd || Math.abs(wp[1] - (p.bottom + 1)) > 1.6) continue;
        if (d > 0.4 && (dx * f.x + dz * f.z) / d < 0.45) continue;
        bd = d; best = { e, pt };
      }
    }
    return best;
  }
  function* usables() { for (const e of W().entities) if (e._use && e.alive) yield e; }
  function use(e, pt, how = 'key') {
    const g = H.game;
    const ctx = { game: g, H, player: W().player, thing: e, how, set: (patch) => set(e, patch) };
    try { pt.use(ctx); } catch (err) { H.report(err, `homes ${e.kind}`); }
    for (const f of e.handlers.use || []) f({ action: labelOf(e, pt), player: W().player });
    unlockAudio();
  }

  // The prompt: "E  Sit" over the bottom of the screen; on a phone it's a button (B does it too).
  let promptEl = null;
  function prompt(text) {
    if (!promptEl) {
      promptEl = document.createElement('button');
      promptEl.type = 'button';
      promptEl.id = 'homesPrompt';
      promptEl.style.cssText = 'position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:6;display:none;align-items:center;gap:10px;padding:8px 16px 8px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(10,14,24,.62);color:#fff;font:600 16px/1 Inter,system-ui,sans-serif;backdrop-filter:blur(6px);pointer-events:auto;touch-action:none;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5)';
      promptEl.innerHTML = '<b style="display:inline-grid;place-items:center;min-width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.9);color:#111;font:700 15px/1 Inter,system-ui,sans-serif"></b><span></span>';
      promptEl.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); tapped = true; });
      document.body.appendChild(promptEl);
    }
    if (!text) { if (promptEl.style.display !== 'none') promptEl.style.display = 'none'; return; }
    promptEl.firstChild.textContent = H.touchUi ? 'B' : 'E';
    if (promptEl.lastChild.textContent !== text) promptEl.lastChild.textContent = text;
    if (promptEl.style.display !== 'inline-flex') promptEl.style.display = 'inline-flex';
  }
  let tapped = false;
  let target = null;
  function runInteract() {
    const w = W(), p = w.player;
    const playing = H.mode === 'play' && p && p.alive && !w.paused && w.camera.target === p;
    const tappedNow = tapped;
    const pressed = H.input.pressed.has('e') || tapped;
    tapped = false;
    if (!playing) { target = null; prompt(null); return; }
    if (p.controller === 'seat') {
      const c = p._controller.opts || {};
      prompt(c.instrument ? 'Get up (space) · keys play notes' : c.pose === 'lie' ? 'Get up' : 'Stand up');
      // At an instrument E is a note: the prompt (or space) gets you up.
      if (c.instrument ? tappedNow : pressed) stand(p);
      return;
    }
    if (p.controller && p.controller !== 'walk') { target = null; prompt(null); return; }
    target = lookTarget();
    if (!target) { prompt(null); return; }
    const label = labelOf(target.e, target.pt);
    prompt(label.charAt(0).toUpperCase() + label.slice(1));
    if (pressed) use(target.e, target.pt);
  }

  // ------------------------------------------------------------------ sitting and lying (the "seat" controller)
  // game.player.control('seat', { thing, at: [x, y, z] (the seat's top, in the thing's own space), yaw (degrees, the
  // way you face, in its space), pose: 'sit' | 'lie', instrument }). E, space or walking away gets you up.
  function seatWorld(o) {
    const e = o.thing;
    const at = worldPoint(e, o.at || [0, 0.45, 0]);
    return { at, yaw: yawOf(e) + (Number(o.yaw) || 0) * RAD };
  }
  function hold(p, o) {
    if (!o.thing || !o.thing.alive) return false;
    const s = seatWorld(o);
    const drop = o.pose === 'lie' ? 1.15 : 0.45;
    const bottom = s.at[1] - drop;
    p.node.position.set(s.at[0], bottom - p.offset[1] + p.half[1], s.at[2]);
    p.vx = 0; p.vy = 0; p.vz = 0; p._walked = true;
    return true;
  }
  function stand(p) {
    if (!p || p.controller !== 'seat') return;
    p.control('walk');
  }
  H.controllers.register('seat', {
    title: 'Sitting or lying down: E, space or walking away gets you up',
    speed: 6,
    enter(p, ctx) {
      const o = ctx.opts;
      ctx.state.was = { held: p.held, gravity: p.gravity };
      p.held = true; // out of the physics while seated (it stays where the seat is)
      const s = seatWorld(o);
      W().camera.yaw = s.yaw;
      W().camera.pitch = o.pose === 'lie' ? -0.6 : 0.05;
      hold(p, o);
      if (o.thing) o.thing._occupied = (o.thing._occupied || 0) + 1;
      if (o.pose === 'lie') { if (o.thing && o.thing._sleeper) { o.thing._sleeper.setEnabled(p._view !== 'first'); o.thing._sleeper.material = mat(H.hooks.myColor || '#4a9eff'); } p.node.visibility = 0; }
      ctx.state.t = 0;
      if (o.say) H.game.ui.message(o.say, 1.6);
      for (const f of homes.onSeat) f(p, o, true);
    },
    idle(p, ctx) { hold(p, ctx.opts); },
    update(p, dt, ctx) {
      const o = ctx.opts;
      if (!hold(p, o)) { p.control('walk'); return; }
      ctx.state.t += dt;
      const input = ctx.game.input;
      if (o.instrument && o.thing && o.thing._play) o.thing._play(input, dt);
      const a = input.axis();
      const away = !o.instrument && ctx.state.t > 0.5 && Math.hypot(a.x, a.y) > 0.6;
      if (input.pressed('space') || away) p.control('walk');
    },
    exit(p, ctx) {
      const o = ctx.opts;
      p.held = ctx.state.was ? ctx.state.was.held : false;
      if (o.thing) { o.thing._occupied = Math.max(0, (o.thing._occupied || 1) - 1); if (o.thing._sleeper) o.thing._sleeper.setEnabled(false); }
      // Stand up in front of the seat (or beside the bed), on the floor it stands on.
      if (o.thing && o.thing.alive) {
        const s = seatWorld(o);
        const out = o.pose === 'lie' ? (o.out || [0.9, 0]) : [0, 0.75];
        const ex = s.at[0] + Math.cos(s.yaw) * out[0] + Math.sin(s.yaw) * out[1];
        const ez = s.at[2] - Math.sin(s.yaw) * out[0] + Math.cos(s.yaw) * out[1];
        const floor = o.thing.node.getAbsolutePosition().y;
        p.node.position.set(ex, floor + 0.02 - p.offset[1] + p.half[1], ez);
      }
      p.velocity = [0, 0, 0];
      if (p._view !== 'first' && p._view !== 'rts') p.node.visibility = 1;
      for (const f of homes.onSeat) f(p, o, false);
    },
  });
  homes.onSeat = [];
  /** Sits the player down on a seat point of a thing (or lies them down). */
  function sit(e, at, yaw = 0, o = {}) {
    const p = W().player;
    if (!p) return;
    p.control('seat', { thing: e, at, yaw, pose: o.pose || 'sit', instrument: o.instrument || false, say: o.say, out: o.out });
  }

  // ------------------------------------------------------------------ steps and stairs (until Havok's character controller)
  // The first physics can't climb a step. Floors, stairs and doorsteps of houses are "steppable": walking into one up to
  // 45 cm high lifts you onto it, so stairs and porches just work.
  const steppables = new Set();
  function steppable(e) { steppables.add(e); e.onDestroy(() => steppables.delete(e)); return e; }
  function stepUp(dt) {
    const w = W(), p = w && w.player;
    if (!p || !p.alive || p.held || p.flying || p.physics !== 'dynamic' || !steppables.size) return;
    if (H.physics && H.physics.engine === 'havok' && H.physics._character) return;
    if (Math.hypot(p.vx, p.vz) < 0.2 || p.vy > 1) return;
    const b = p.box();
    const ax = p.vx * dt * 3, az = p.vz * dt * 3;
    let rise = 0;
    for (const s of steppables) {
      if (!s.alive || !s.solid) continue;
      const sb = s.box();
      const r = sb.max[1] - p.bottom;
      if (r <= 0.01 || r > 0.45) continue;
      if (b.min[0] + ax < sb.max[0] && b.max[0] + ax > sb.min[0] && b.min[2] + az < sb.max[2] && b.max[2] + az > sb.min[2]) rise = Math.max(rise, r);
    }
    if (rise) { p.node.position.y += rise + 0.01; p.vy = Math.max(0, p.vy); p.grounded = true; }
  }

  // ------------------------------------------------------------------ assemblies: one thing made of solid pieces
  // A house is one thing in scene.json, but its walls, floors and stairs are separate solid pieces (so you can walk in
  // through the door). The pieces follow the thing when it's moved (turned in quarter turns) and go with it.
  const assemblies = new Set();
  function assemble(root, list) {
    root._parts = root._parts || [];
    for (const it of list) {
      it.e._homesOwner = root;
      it.e._useOwner = it.e._useOwner || null;
      root._parts.push({ e: it.e, at: vec(it.at), yaw: Number(it.yaw) || 0 });
    }
    assemblies.add(root);
    root._pose = null;
    if (!root._assembled) {
      root._assembled = true;
      root.onDestroy(() => { assemblies.delete(root); for (const pt of root._parts) if (pt.e.alive) pt.e.destroy(); root._parts = []; });
    }
    follow(root, true);
    return root;
  }
  const quarter = (y) => Math.round(y / (Math.PI / 2)) * (Math.PI / 2);
  function follow(root, force) {
    const n = root.node;
    const pose = `${n.position.x.toFixed(3)},${n.position.y.toFixed(3)},${n.position.z.toFixed(3)},${quarter(n.rotation.y).toFixed(3)}`;
    if (!force && pose === root._pose) return;
    root._pose = pose;
    const yaw = quarter(n.rotation.y), c = Math.cos(yaw), s = Math.sin(yaw);
    for (const pt of root._parts) {
      const e = pt.e;
      if (!e.alive || e.held) continue;
      const [x, y, z] = pt.at;
      e.node.position.set(n.position.x + x * c + z * s, n.position.y + y, n.position.z - x * s + z * c);
      e.node.rotation.y = yaw + pt.yaw * RAD;
      e.measure();
      if (e.physics === 'dynamic') { e.velocity = [0, 0, 0]; e.wake(); }
      e.home = { position: e.position, rotation: e.rotation3 };
    }
  }

  // ------------------------------------------------------------------ sound near things
  let ac = null;
  function actx() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }
  function unlockAudio() { actx(); for (const l of loops) if (l.el && l.el.paused && l.on) l.el.play().catch(() => {}); }
  /** How loud a sound at a point is where you are (1 next to it, 0 at `range` meters). */
  function near(at, range = 14) {
    const cam = W() && W().scene.activeCamera;
    if (!cam || !at) return 1;
    const d = Math.hypot(cam.position.x - at[0], cam.position.y - at[1], cam.position.z - at[2]);
    const k = Math.max(0, 1 - d / range);
    return k * k;
  }
  /** A note: frequency in Hz (or a note number, 60 = middle C), with a voice ('piano', 'organ', 'synth', 'bell'). */
  function note(n, o = {}) {
    const a = actx();
    if (!a) return;
    const f = n > 20 && n < 128 && Number.isInteger(n) ? 440 * Math.pow(2, (n - 69) / 12) : n;
    const vol = (o.volume ?? 0.3) * (o.at ? near(o.at, o.range || 18) : 1);
    if (vol < 0.005) return;
    const t = a.currentTime;
    const voice = o.voice || 'piano';
    const g = a.createGain();
    g.connect(a.destination);
    const dur = o.dur || (voice === 'organ' ? 0.8 : voice === 'bell' ? 1.6 : 1.1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    if (voice === 'organ') { g.gain.setValueAtTime(vol, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
    else g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const parts = voice === 'bell' ? [[1, 'sine', 1], [2.76, 'sine', 0.35], [5.4, 'sine', 0.15]] : voice === 'organ' ? [[1, 'sine', 0.7], [2, 'sine', 0.3], [3, 'sine', 0.18]] : voice === 'synth' ? [[1, 'sawtooth', 0.35], [1.005, 'square', 0.15]] : [[1, 'triangle', 0.8], [2, 'sine', 0.25], [3, 'sine', 0.08]];
    for (const [mul, type, amp] of parts) {
      const osc = a.createOscillator();
      osc.type = type; osc.frequency.value = f * mul;
      const og = a.createGain(); og.gain.value = amp;
      osc.connect(og).connect(g);
      osc.start(t); osc.stop(t + dur + 0.05);
    }
  }
  /** A short noise (a flush, a splash, a click): o.kind 'whoosh' | 'click' | 'splash'. */
  function noise(o = {}) {
    const a = actx();
    if (!a) return;
    const vol = (o.volume ?? 0.3) * (o.at ? near(o.at, 14) : 1);
    if (vol < 0.005) return;
    const dur = o.kind === 'click' ? 0.05 : o.dur || 1.4;
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = a.createBufferSource(); src.buffer = buf;
    const filt = a.createBiquadFilter(); filt.type = o.kind === 'click' ? 'highpass' : 'lowpass'; filt.frequency.value = o.kind === 'click' ? 2000 : 900;
    const g = a.createGain(); g.gain.value = vol;
    src.connect(filt).connect(g).connect(a.destination);
    src.start();
  }
  /** A sound asset by name if the game has it, else the stand-in (a function that makes one). */
  function sound(name, at, fallback, o = {}) {
    if (name && L.hasAsset(name) && H.game) { H.game.sound(name, { volume: (o.volume ?? 1) * (at ? near(at, 16) : 1) }); return; }
    if (fallback) fallback();
  }
  // Loops near a thing (running water, a radio, a TV): an asset by name, or a synth stand-in. Louder as you get close.
  const loops = new Set();
  function loop(o) {
    const l = { on: true, at: o.at, range: o.range || 14, volume: o.volume ?? 0.6, el: null, gain: null, stopSynth: null, thing: o.thing || null };
    if (o.asset && L.hasAsset(o.asset)) {
      l.el = new Audio(L.assetUrl(o.asset));
      l.el.crossOrigin = 'anonymous';
      l.el.loop = o.loop !== false;
      l.el.volume = 0;
      l.el.play().catch(() => {});
    } else if (o.synth) {
      const a = actx();
      if (a) { l.gain = a.createGain(); l.gain.gain.value = 0; l.gain.connect(a.destination); l.stopSynth = o.synth(a, l.gain, l); }
    }
    l.stop = () => {
      l.on = false;
      loops.delete(l);
      if (l.el) { l.el.pause(); l.el.removeAttribute('src'); }
      if (l.stopSynth) try { l.stopSynth(); } catch {}
      if (l.gain) try { l.gain.disconnect(); } catch {}
    };
    loops.add(l);
    if (o.thing) o.thing.onDestroy(() => l.stop());
    return l;
  }
  function runLoops() {
    for (const l of loops) {
      const at = l.thing && l.thing.alive ? worldPoint(l.thing, [0, 1, 0]) : l.at;
      const v = l.volume * near(at, l.range);
      if (l.el) l.el.volume = Math.max(0, Math.min(1, v));
      if (l.gain) l.gain.gain.value = v;
    }
  }
  /** A noise loop (running water, a shower, static). */
  function waterSynth(a, out) {
    const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 0.6;
    const g = a.createGain(); g.gain.value = 0.35;
    src.connect(f).connect(g).connect(out);
    src.start();
    return () => src.stop();
  }
  /** A little tune that never ends (a radio with no music asset yet): a pentatonic melody over a bass, by seed. */
  function tuneSynth(seed = 1, voice = 'synth') {
    return (a, out, l) => {
      const scale = [0, 2, 4, 7, 9, 12, 14, 16];
      let rnd = seed * 9301 + 49297;
      const r = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; };
      const root = 57 + Math.floor(r() * 7);
      const tempo = 0.24 + r() * 0.12;
      let t = a.currentTime + 0.05, i = 0;
      const play = (n, at, dur, amp, type) => {
        const osc = a.createOscillator(); osc.type = type; osc.frequency.value = 440 * Math.pow(2, (n - 69) / 12);
        const g = a.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(amp, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        osc.connect(g).connect(out); osc.start(at); osc.stop(at + dur + 0.02);
      };
      const timer = setInterval(() => {
        if (!l.on) return;
        while (t < a.currentTime + 0.4) {
          if (i % 2 === 0 || r() > 0.4) play(root + 12 + scale[Math.floor(r() * scale.length)], t, tempo * 1.6, 0.18, voice === 'synth' ? 'square' : 'triangle');
          if (i % 4 === 0) play(root - 12 + [0, 5, 7, 3][(i / 4) % 4 | 0], t, tempo * 3.5, 0.22, 'triangle');
          t += tempo; i++;
        }
      }, 120);
      return () => clearInterval(timer);
    };
  }

  // ------------------------------------------------------------------ every step and frame
  const perFrame = new Set();
  H.hooks.step.push((dt) => {
    const w = W();
    if (!w) return;
    for (const r of assemblies) if (r.alive) follow(r); else assemblies.delete(r);
    stepUp(dt);
  });
  H.hooks.frame.push((dt) => {
    const w = W();
    if (!w || !w.scene) return;
    try { runInteract(); } catch (err) { H.report(err, 'homes'); }
    runLoops();
    for (const f of perFrame) try { f(dt); } catch (err) { H.report(err, 'homes'); perFrame.delete(f); }
  });
  H.hooks.world.push({
    leave() {
      scriptSeq = 0;
      things.clear(); steppables.clear(); assemblies.clear(); perFrame.clear();
      for (const l of [...loops]) l.stop();
      prompt(null);
    },
  });

  // ------------------------------------------------------------------ the scripts' side: game.homes
  // The engine makes a new `game` every time a world starts and sets window.game right after (before any script runs),
  // so game.homes is attached there. (A core hook for this is requested; this keeps it working meanwhile.)
  const scriptApi = {
    /** Changes a thing's state for everyone: game.homes.set(fridge, { open: true }). */
    set: (e, patch) => set(e, patch),
    /** A thing's state ({ open, on, channel... }), or null. */
    state: (e) => (e && e.homes ? { ...e.homes.state } : null),
    /** Makes anything usable: game.homes.usable(npc, 'talk', (ctx) => npc.say('Hi!')). */
    usable(e, label, fn, at) { if (!e || !e.__entity) throw new Error('game.homes.usable(thing, label, fn)'); return usable(e, [{ label, at: at || [0, Math.max(0.3, e.size[1] / 2) - (e.kind === 'model' ? 0 : 0), 0], use: (ctx) => fn(ctx) }]); },
    /** Sits the player on a thing: game.homes.sit(chair). */
    sit: (e) => { if (e && e._use) { const pt = e._use.find((x) => /sit|lie|play/i.test(labelOf(e, x))); if (pt) return use(e, pt); } return sit(e, [0, (e.size[1] || 0.9) * 0.5, 0]); },
    /** Gets the player up. */
    stand: () => stand(W().player),
    /** What the player is looking at that they can use: { thing, action } or null. */
    get target() { return target ? { thing: target.e, action: labelOf(target.e, target.pt) } : null; },
    /** Uses a thing as if the player pressed E at it (optionally the action by name: 'open', 'sit'...). */
    use(e, action) {
      if (!e || !e._use) return false;
      const pt = (action && e._use.find((x) => labelOf(e, x).toLowerCase().includes(String(action).toLowerCase()))) || e._use.find((x) => !x.when || x.when(e));
      if (!pt) return false;
      use(e, pt, 'script');
      return true;
    },
    /** Plays a note (60 = middle C) or a frequency: game.homes.note(64, { voice: 'bell' }). */
    note: (n, o) => note(n, o),
  };
  homes.scriptApi = scriptApi;
  (function attachGame() {
    const d = Object.getOwnPropertyDescriptor(window, 'game');
    let current = d && 'value' in d ? d.value : undefined;
    const prevSet = d && d.set, prevGet = d && d.get;
    Object.defineProperty(window, 'game', {
      configurable: true,
      get() { return prevGet ? prevGet.call(window) : current; },
      set(v) {
        if (v && typeof v === 'object' && !v.homes) { try { Object.defineProperty(v, 'homes', { value: scriptApi, enumerable: true, configurable: true }); } catch {} }
        if (prevSet) prevSet.call(window, v); else current = v;
      },
    });
    if (current && !current.homes) window.game = current;
  })();

  /** Things that animate themselves (doors swinging, hands of a clock): fn(dt) every frame while the thing lives. */
  function animate(e, fn) { const f = (dt) => { if (!e.alive) { perFrame.delete(f); return; } fn(dt); }; perFrame.add(f); return f; }
  /** The shared-state key a kind should use: the scene id, or the one a house gave its part. */
  const keyOf = (o, spec) => (spec && spec.id) || (o && o.homesKey) || null;

  Object.assign(homes, { animate, keyOf, applyLocal: applyPatch, labelOf, mat, part, furniture, dress, worldPoint, track, set, usable, use, sit, stand, steppable, assemble, follow, note, noise, sound, loop, waterSynth, tuneSynth, near, actx, perFrame, things, quarter, get target() { return target; } });
})();
