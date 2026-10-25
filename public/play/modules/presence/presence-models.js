// Presence, part 1d: Gen-made models for the mirror's bodies (docs/characters.md "Gen models"). For each "What are you?" type
// the registry (presence-model-registry.js, data) may name a GLB; while it is missing or loading the procedural body shows,
// and when it has loaded the model takes its place on the same rig: the look, the name tag and the presence state do not change.
//
//   attach(rig)    makeRig calls it: loads the type's model once per scene (one container, every player an instance of it), then
//                  builds the model under rig.pose, finds its anchors, hides the procedural body and dresses the model again:
//                  rig.neck (hats and glasses: head, faceY, faceZ) and rig.mounts.{neck, back, rump} (the extras and accessories)
//                  are nodes under the model's own nodes (a bone or a part), scaled to the model's head, so the same hats fit everything.
//   animate(rig)   presence.js animate calls it for a rig with a model on: the GLB's clips blended by speed, ground and water,
//                  and for what has none a procedural motion of the whole model by form (and of named parts), squash and stretch.
//   dispose(rig)   the instance goes (animation groups, skeletons, nodes); the container stays for the next player.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const P = (H.presence = H.presence || {});
  const C = () => P.core;

  // The person's head, the unit hats and glasses are drawn in (presence.js hat/extra): about 0.43 wide, its top 0.44 above the
  // `neck` node, the face 0.27 up and 0.215 forward. A model's head is scaled so its width is that.
  const UNIT_HEAD = 0.43, HAT_BASE = 0.44, SCARF_Y = 0.28, PACK_Z = 0.24;
  /** A head's width as a share of the height, by form (docs/characters.md section 1), when a row gives no `head`. */
  const HEAD_SHARE = { biped: 0.22, quadruped: 0.3, bird: 0.3, swimmer: 0.3, roller: 0.45, thing: 0.5, legless: 0.45 };
  /** The most triangles a model's near level should have, by device tier: more is flagged in /avatars. */
  const TRIS = { phone: 8000, tablet: 14000, desktop: 30000 };
  const ROLE_RE = { idle: /idle|stand|breath|rest/i, walk: /walk|trot|waddle|hop/i, run: /run|gallop|sprint|dash/i, jump: /jump|leap/i, fall: /fall|air|glide/i, swim: /swim|paddle/i };
  const FALLBACK = { run: ['run', 'walk'], walk: ['walk', 'run'], jump: ['jump', 'fall'], fall: ['fall', 'jump'], swim: ['swim'], idle: ['idle'] };
  const STRIDE = { walk: 1.6, run: 4.5 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;

  // ------------------------------------------------------------------ the registry
  const reg = () => P.modelRegistry || {};
  /** A type's row with its defaults when it has a file to load, else null (its procedural body stays). */
  function entry(id) {
    const r = reg()[id];
    if (!r || !(r.asset || r.url)) return null;
    const w = C() && C().WHAT.get(id);
    const form = r.form || 'biped';
    const h = Number(r.h) > 0 ? Number(r.h) : (w && w.h) || 1.2;
    return { ...r, id, form, h, yaw: Number.isFinite(r.yaw) ? r.yaw : Math.PI, head: Number(r.head) > 0 ? Number(r.head) : (HEAD_SHARE[form] || 0.25) * h, anchors: r.anchors || {}, clips: r.clips || {}, parts: r.parts || [], stride: { ...STRIDE, ...(r.stride || {}) } };
  }
  /** Fills in (or changes) a type's row: P.models.register('dog', { asset: 'a_...', h: 0.9, anchors: {...} }). */
  function register(id, patch) {
    const r = (P.modelRegistry = P.modelRegistry || {});
    r[id] = { ...(r[id] || {}), ...patch };
    return r[id];
  }
  /** The addresses of a type's near and far levels: Gen's levels of detail when the row has them (kinds.js modelLevels), else the one file. */
  function levels(ent) {
    const url = ent.url || P.modelUrl(ent.asset);
    const lv = ent.lods && H.kinds && H.kinds.modelLevels ? H.kinds.modelLevels({ url, lods: ent.lods }) : null;
    if (lv) return { near: lv.near, low: lv.low };
    return { near: url, low: ent.low || null };
  }

  // ------------------------------------------------------------------ loading: one container per file per scene
  let loader = (scene, url) => {
    if (!B.SceneLoader || !B.SceneLoader.LoadAssetContainerAsync) return Promise.reject(new Error('no model loader'));
    return B.SceneLoader.LoadAssetContainerAsync(url, '', scene, null, '.glb');
  };
  const cache = new WeakMap(); // scene -> Map(url -> { promise, value, failed })
  function fetchContainer(scene, url) {
    let m = cache.get(scene);
    if (!m) cache.set(scene, (m = new Map()));
    let c = m.get(url);
    if (c && c.failed && (performance.now() - c.failed) < 30000) return c;
    if (!c || c.failed) {
      c = { promise: null, value: null, failed: 0 };
      m.set(url, c);
      let got;
      try { got = loader(scene, url); } catch (err) { got = Promise.reject(err); }
      if (got && typeof got.then !== 'function') { c.value = got; c.promise = Promise.resolve(got); } // (a loader that already has it: no wait)
      else c.promise = Promise.resolve(got).then((v) => { c.value = v; return v; }, (err) => { c.failed = performance.now() || 1; throw err; });
    }
    return c;
  }

  // ------------------------------------------------------------------ finding things in a model
  function findNode(roots, name) {
    const want = String(name).toLowerCase();
    const stack = [...roots];
    while (stack.length) {
      const n = stack.shift();
      if (String(n.name).toLowerCase() === want) return n;
      for (const c of n.getChildren(undefined, true)) stack.push(c);
    }
    return null;
  }
  /** World matrices from the top down: nodes made a moment ago have no world position until their parents do. */
  function refresh(node) {
    const chain = [];
    for (let n = node; n; n = n.parent) chain.unshift(n);
    for (const n of chain) n.computeWorldMatrix(true);
  }
  function scaleIn(node, frame) {
    refresh(node); refresh(frame);
    const rel = node.getWorldMatrix().multiply(B.Matrix.Invert(frame.getWorldMatrix()));
    const s = new B.Vector3(), q = new B.Quaternion(), t = new B.Vector3();
    rel.decompose(s, q, t);
    return Math.max(1e-4, (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3);
  }
  function meshesOf(roots) {
    const out = [];
    for (const r of roots) { if (r.getTotalIndices) out.push(r); for (const m of r.getChildMeshes(false)) out.push(m); }
    return out;
  }
  const trisOf = (roots) => Math.round(meshesOf(roots).reduce((n, m) => n + (m.getTotalIndices ? m.getTotalIndices() : 0) / 3, 0));

  /** The GLB's animation groups by what they are for: the row's `clips`, else a word in the name. */
  function mapClips(ent, groups) {
    const named = (n) => groups.find((g) => g.name === n) || groups.find((g) => g.name.toLowerCase() === String(n).toLowerCase()) || null;
    const roles = {};
    for (const r of Object.keys(ROLE_RE)) roles[r] = (ent.clips[r] ? named(ent.clips[r]) : null) || groups.find((g) => ROLE_RE[r].test(g.name)) || null;
    return { roles, named };
  }
  const roleGroup = (lvl, role) => { for (const r of FALLBACK[role] || [role]) if (lvl.roles[r]) return lvl.roles[r]; return null; };
  function emoteGroup(lvl, ent, name) {
    if (ent.clips[name]) return lvl.named(ent.clips[name]);
    const re = new RegExp(name, 'i');
    return lvl.groups.find((g) => re.test(g.name) && !Object.values(lvl.roles).includes(g)) || null;
  }

  // ------------------------------------------------------------------ building a model on a rig
  function instance(rig, pm, container, parent) {
    const inst = container.instantiateModelsToScene((n) => n, false);
    const roots = inst.rootNodes;
    for (const r of roots) r.parent = parent;
    const groups = inst.animationGroups || [];
    for (const g of groups) g.stop();
    const lvl = { inst, roots, groups, skeletons: inst.skeletons || [], w: new Map(), playing: new Set() };
    Object.assign(lvl, mapClips(pm.ent, groups));
    lvl.tris = trisOf(roots);
    return lvl;
  }
  function bounds(node) {
    refresh(node);
    const { min, max } = node.getHierarchyBoundingVectors(true);
    if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite) || max.y - min.y < 1e-6) throw new Error('the model has no size');
    return { min, max };
  }
  /** The anchors the row leaves out, from the model's box and its form, in the model's own units (front is z * f). */
  function defaults(ent, b, k, f) {
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, Hh = b.max.y - b.min.y, D = Math.max(b.max.z - b.min.z, 0.001);
    const hm = ent.head / k, quad = ent.form === 'quadruped' || ent.form === 'swimmer';
    const head = [cx, b.max.y, quad ? cz + f * D * 0.32 : cz];
    return {
      head: { at: head },
      face: { at: [cx, head[1] - hm * 0.55, head[2] + f * hm * 0.5] },
      neck: { at: [cx, head[1] - hm * 1.05, head[2] - f * hm * 0.1] },
      back: { at: [cx, b.min.y + Hh * (quad ? 0.75 : 0.62), cz - f * D * (quad ? 0.1 : 0.45)] },
      rump: { at: [cx, b.min.y + Hh * (quad ? 0.7 : 0.4), cz - f * D * 0.5] },
    };
  }
  function build(rig, pm, container) {
    const ent = pm.ent, scene = rig.scene, pose = rig.pose;
    // mover (the body's pivot: its middle) > fit (feet on the ground, centered) > holder (size and turn) > spin (a roller's pivot) > inner > the model
    const mk = (n, parent) => { const t = new B.TransformNode(`pm-${n}`, scene); t.parent = parent; return t; };
    const mover = mk('mover', null), fit = mk('fit', mover), holder = mk('holder', fit), spin = mk('spin', holder), inner = mk('inner', spin);
    let near;
    try {
      near = instance(rig, pm, container, inner);
      const b = bounds(holder);
      const k = ent.h / (b.max.y - b.min.y);
      const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
      spin.position.set(cx, cy, cz); inner.position.set(-cx, -cy, -cz);
      holder.rotation.y = ent.yaw; holder.scaling.setAll(k);
      const cs = Math.cos(ent.yaw), sn = Math.sin(ent.yaw);
      const rx = cx * cs + cz * sn, rz = cz * cs - cx * sn; // the middle after the turn
      fit.position.set(-k * rx, -ent.h / 2 - k * b.min.y, -k * rz);
      mover.parent = pose;
      mover.position.set(0, -0.9 + ent.h / 2, 0);
      Object.assign(pm, { mover, fit, holder, spin, inner, k, b, front: cs > 0 ? 1 : -1, s: clamp(ent.head / UNIT_HEAD, 0.2, 4), baseY: mover.position.y, nodes: [mover] });
    } catch (err) {
      if (near) disposeLevel(near);
      mover.dispose();
      throw err;
    }
    pm.levels = { near, low: null };
    pm.cur = near;
    pm.tris = near.tris;
    // anchors
    const def = defaults(ent, pm.b, pm.k, pm.front);
    pm.anchors = {};
    for (const name of ['head', 'face', 'neck', 'back', 'rump']) {
      const spec = { ...def[name], ...(ent.anchors[name] || {}) };
      const base = spec.node ? findNode(near.roots, spec.node) : null;
      if (spec.node && !base) (pm.missing = pm.missing || []).push(`${name}: no node "${spec.node}"`);
      // (an offset with no node is from the model's origin: the holder holds that, so the box middle is not in the way)
      const a = mk(`a-${name}`, base || holder);
      let at = spec.at || [0, 0, 0];
      const rot = spec.rot || [0, 0, 0];
      // An offset from the origin is written as the file was authored (front toward +z); the loader turned the model half way round
      // under __root__, so it is turned too. The anchor's own axes follow the body (+z forward) whatever the model's turn.
      if (!base) { if (ent.anchors[name] && ent.anchors[name].at) at = [-at[0], at[1], -at[2]]; a.rotation.y = -ent.yaw; }
      a.position.set(at[0], at[1], at[2]);
      a.rotation.set(rot[0], a.rotation.y + rot[1], rot[2]);
      pm.anchors[name] = { node: a, spec, bone: base ? spec.node : null };
    }
    // mounts, scaled to the head: the node a hat, glasses, a scarf or a pack is drawn in, as on a person
    const mount = (name, anchor, shift) => {
      const a = pm.anchors[anchor], m = mk(`m-${name}`, a.node);
      const s = pm.s * (a.spec.scale || 1) / scaleIn(a.node, pose);
      m.scaling.setAll(s); m.position.set(shift[0] * s, shift[1] * s, shift[2] * s);
      return m;
    };
    const neck = mount('head', 'head', [0, -HAT_BASE, 0]);
    pm.mounts = { neck: mount('neck', 'neck', [0, -SCARF_Y, 0]), back: mount('back', 'back', [0, 0, PACK_Z]), rump: mount('rump', 'rump', [0, 0.1, 0.2]) };
    refresh(neck);
    const fp = B.Vector3.TransformCoordinates(pm.anchors.face.node.getAbsolutePosition(), B.Matrix.Invert(neck.getWorldMatrix()));
    pm.faceY = fp.y; pm.faceZ = fp.z + 0.012;
    // parts moved by hand when no clip drives them
    pm.parts = [];
    for (const p of ent.parts) {
      const n = findNode(near.roots, p.node);
      if (!n) { (pm.missing = pm.missing || []).push(`part: no node "${p.node}"`); continue; }
      const q0 = n.rotationQuaternion ? n.rotationQuaternion.clone() : B.Quaternion.FromEulerAngles(n.rotation.x, n.rotation.y, n.rotation.z);
      pm.parts.push({ ...p, n, q0, spin: 0, role: p.role || 'leg', axis: p.axis || 'x', amp: Number.isFinite(p.amp) ? p.amp : ({ leg: 0.55, arm: 0.45, tail: 0.35, ear: 0.3, wing: 0.5, fin: 0.3, head: 0.12 }[p.role || 'leg'] || 0.3), ph: Number(p.ph) || 0 });
    }
    // the procedural body goes, the model's rig takes over: hats and the rest are made again on the model's anchors
    for (const c of pose.getChildren(undefined, true)) if (c !== mover) c.setEnabled(false);
    rig.neck = neck; rig.faceY = pm.faceY; rig.faceZ = pm.faceZ; rig.mounts = pm.mounts;
    rig.hasModel = true;
    pm.on = true; pm.state = 'ready';
    if (P._redress) P._redress(rig);
    pm.air = { t: 0, peak: 0, was: false, landT: 9, takeT: 9, depth: 0.85 };
    const idle = roleGroup(near, 'idle');
    if (idle) { idle.start(true); near.playing.add(idle); near.w.set(idle, 1); }
    if (pm.urls.low) pm.lowWanted = true;
  }
  function disposeLevel(lvl) {
    for (const g of lvl.groups) { try { g.stop(); g.dispose(); } catch {} }
    for (const s of lvl.skeletons) { try { s.dispose(); } catch {} }
    for (const r of lvl.roots) { try { r.dispose(false, false); } catch {} }
  }
  /** Gives the rig the model of its type if it has one: now when it is already loaded, else as soon as it has. */
  function attach(rig) {
    if (rig.noModel || !rig.root) return;
    const ent = entry(rig.what);
    if (!ent) return;
    const pm = (rig.pm = { on: false, ent, urls: levels(ent), state: 'loading' });
    const c = fetchContainer(rig.scene, pm.urls.near);
    const go = (v) => {
      if (rig.pm !== pm || !rig.root || rig.root.isDisposed()) return;
      try { build(rig, pm, v); } catch (err) { pm.state = 'failed'; pm.error = String(err && err.message || err); if (H.report) H.report(err, 'presence'); }
    };
    pm.wait = Promise.resolve();
    if (c.value) go(c.value);
    else if (!c.failed) { c.promise.then(go, () => { if (rig.pm === pm) pm.state = 'failed'; }); pm.wait = c.promise.then(() => {}, () => {}); }
    else pm.state = 'failed';
  }
  function dispose(rig) {
    const pm = rig.pm;
    if (!pm) return;
    rig.pm = null;
    for (const lvl of Object.values(pm.levels || {})) if (lvl) disposeLevel(lvl);
    for (const n of pm.nodes || []) try { n.dispose(); } catch {}
    pm.on = false;
  }
  /** The far body takes the model's low level (Gen's lowest), loaded the first time a body is far; node anchors move to it. */
  function wantLevel(rig, pm) {
    const far = Boolean(rig.far) && Boolean(pm.urls.low);
    const want = far ? 'low' : 'near';
    if (pm.cur === pm.levels[want] && pm.levels[want]) return;
    if (want === 'low' && !pm.levels.low) {
      if (pm.lowBusy) return;
      pm.lowBusy = true;
      const c = fetchContainer(rig.scene, pm.urls.low);
      c.promise.then((v) => {
        if (rig.pm !== pm || !pm.on) return;
        try { pm.levels.low = instance(rig, pm, v, pm.inner); pm.levels.low.roots.forEach((r) => r.setEnabled(false)); } catch { pm.urls.low = null; }
        pm.lowBusy = false;
      }, () => { pm.urls.low = null; pm.lowBusy = false; });
      return;
    }
    const to = pm.levels[want];
    if (!to || to === pm.cur) return;
    for (const g of pm.cur.groups) { try { g.pause(); } catch {} }
    pm.cur.playing.clear(); pm.cur.w.clear();
    pm.cur.roots.forEach((r) => r.setEnabled(false));
    to.roots.forEach((r) => r.setEnabled(true));
    pm.cur = to;
    pm.tris = to.tris;
    for (const a of Object.values(pm.anchors)) if (a.bone) { const n = findNode(to.roots, a.bone); if (n) a.node.parent = n; }
    for (const p of pm.parts) { const n = findNode(to.roots, p.node); if (n) { p.n = n; p.q0 = n.rotationQuaternion ? n.rotationQuaternion.clone() : p.q0; } }
  }

  // ------------------------------------------------------------------ moving
  const inWater = (rig) => { const w = H.water, e = rig.e; return Boolean(w && w.inWater && e && Number.isFinite(e.y) && w.inWater([e.x, e.y - 0.15, e.z])); };
  /** What a forced pose (the showcase's) stands for: the ground, the air, the water. */
  function forcedMotion(name, t) {
    if (name === 'jump') {
      const T = 1.3, u = (t % T) / T;
      if (u < 0.1) return { grounded: true, vy: 0 };
      if (u < 0.78) { const a = (u - 0.1) / 0.68; return { grounded: false, vy: 7 * (1 - 2 * a), lift: 0.95 * 4 * a * (1 - a) }; }
      return { grounded: true, vy: 0 };
    }
    if (name === 'fall') return { grounded: false, vy: -9, lift: 0.7 + Math.sin(t * 2.2) * 0.1 };
    return null;
  }
  /** The procedural motion of the whole body, by form: { y, rx, ry, rz } (meters, radians), before squash. */
  function gait(form, o) {
    const { ph, t, walk, run, speed, grounded, swim } = o;
    const bob = Math.abs(Math.sin(ph));
    switch (form) {
      case 'quadruped': return { y: bob * 0.04 * walk + run * Math.abs(Math.sin(ph * 2)) * 0.06, rx: Math.sin(ph * 2) * (0.03 * walk + 0.09 * run), rz: Math.sin(ph) * 0.035 * walk, ry: 0, stretch: 1 + run * 0.05 * Math.sin(ph * 2) };
      case 'bird': return { y: bob * 0.05 * walk, rx: Math.sin(ph * 2) * 0.04 * walk + run * 0.12, rz: Math.sin(ph) * 0.16 * walk, ry: 0, stretch: 1 };
      case 'swimmer': return swim || !grounded
        ? { y: Math.sin(t * 2) * 0.03, rx: Math.sin(t * 3) * 0.05, rz: 0, ry: Math.sin(t * (3 + speed)) * 0.2 * (0.35 + walk), stretch: 1 }
        : { y: Math.abs(Math.sin(t * 7)) * 0.12 * walk, rx: 0, rz: Math.sin(t * 7) * 0.4 * walk, ry: Math.sin(t * 5) * 0.12 * walk, stretch: 1 };
      case 'roller': return { y: Math.sin(ph * 2) * 0.015 * walk, rx: run * 0.2 + walk * 0.05, rz: 0, ry: 0, stretch: 1 };
      case 'legless': return { y: bob * 0.12 * walk, rx: run * 0.12, rz: Math.sin(ph) * 0.14 * walk, ry: 0, stretch: 1 };
      case 'thing': return { y: bob * 0.08 * walk + run * 0.05 * bob, rx: run * 0.25, rz: Math.sin(ph) * 0.09 * walk, ry: 0, stretch: 1 };
      default: return { y: bob * 0.04 * walk, rx: run * 0.2, rz: Math.sin(ph) * 0.03 * walk, ry: 0, stretch: 1 + run * 0.03 * Math.sin(ph * 2) };
    }
  }
  /** An emote done by the whole body when the model has no clip for it (the person's and the things' own are on their meshes). */
  function bodyEmote(name, k, h) {
    const sc = h / 1.8, o = { y: 0, rx: 0, ry: 0, rz: 0, sy: 1 };
    const b = Math.sin(k * 7);
    switch (name) {
      case 'wave': o.rz = Math.sin(k * 9) * 0.13; o.y = Math.abs(Math.sin(k * 4.5)) * 0.04; break;
      case 'dance': o.ry = Math.sin(k * 3.5) * 0.9; o.y = Math.abs(b) * 0.14 * sc; o.rz = b * 0.08; break;
      case 'cheer': o.y = Math.abs(b) * 0.2 * sc; o.sy = 1 + Math.max(0, b) * 0.06; break;
      case 'laugh': o.rx = -0.2 + Math.sin(k * 26) * 0.05; o.y = Math.abs(Math.sin(k * 13)) * 0.03; break;
      case 'shrug': o.sy = 1 - Math.max(0, Math.sin(Math.min(k, 0.5) * 6.3)) * 0.05; o.rz = Math.sin(k * 2.2) * 0.12; break;
      case 'point': o.rx = 0.18; o.ry = Math.sin(k * 3) * 0.1; break;
      case 'sit': o.y = -0.16 * sc; o.rx = -0.12; break;
      case 'sleep': o.rz = 1.3; o.y = -0.5 * sc; break;
      case 'clap': o.y = Math.abs(Math.sin(k * 16)) * 0.025; o.rx = Math.sin(k * 16) * 0.05; break;
      case 'thumbsup': o.y = Math.max(0, Math.sin(k * 3)) * 0.05 * sc; o.rx = 0.1; break;
      case 'heart': o.sy = 1 + (0.5 + 0.5 * Math.sin(k * 8)) * 0.07; break;
      default: o.y = Math.abs(b) * 0.1 * sc; break;
    }
    return o;
  }
  function setWeights(lvl, want, dt, rate) {
    for (const g of lvl.groups) {
      const target = want.get(g) || 0;
      const w = lerp(lvl.w.get(g) || 0, target, Math.min(1, dt * rate));
      lvl.w.set(g, w);
      if (w > 0.02) {
        if (!lvl.playing.has(g)) { g.start(true); lvl.playing.add(g); }
        g.setWeightForAllAnimatables(w);
      } else if (lvl.playing.has(g)) {
        lvl.playing.delete(g);
        if (target === 0) { if (lvl.emoting && lvl.emoting.has(g)) g.stop(); else g.pause(); }
      }
    }
  }
  const quatAxis = { x: B.Vector3.Right(), y: B.Vector3.Up(), z: B.Vector3.Forward() };
  function animate(rig, dt, em) {
    const pm = rig.pm;
    if (!pm || !pm.on) return;
    dt = clamp(dt, 0, 0.05);
    wantLevel(rig, pm);
    const lvl = pm.cur, ent = pm.ent, e = rig.e, t = rig.time || 0;
    // Out of view the clips are not evaluated at all.
    if (rig.out && !rig.forcePose) { for (const g of lvl.playing) { try { g.pause(); } catch {} } lvl.playing.clear(); lvl.w.clear(); return; }
    const forced = rig.forcePose || null, speed = forced === 'walk' ? Math.max(rig.speed || 0, 2.4) : forced === 'run' ? Math.max(rig.speed || 0, 6) : (forced ? 0 : rig.speed || 0);
    // ---- what is it doing?
    const A = pm.air;
    if (dt > 0) { const raw = pm.lastY === undefined ? 0 : (e.y - pm.lastY) / dt; pm.vy = (pm.vy || 0) + (clamp(raw, -40, 40) - (pm.vy || 0)) * Math.min(1, dt * 12); }
    pm.lastY = e.y;
    let grounded = e.grounded !== false, vy = typeof e.vy === 'number' && Math.abs(e.vy) > 1e-4 ? e.vy : pm.vy || 0, lift = 0, swim = false, seated = false;
    const fm = forced ? forcedMotion(forced, t) : null;
    if (fm) { grounded = fm.grounded; vy = fm.vy; lift = fm.lift || 0; }
    if (forced === 'swim') swim = true;
    else if (forced === 'drive') seated = true;
    else if (!forced) {
      const w = H.world;
      seated = e._seatedAt !== undefined && w && w.time - e._seatedAt < 0.3;
      swim = !seated && !grounded && inWater(rig);
    }
    A.t = grounded ? 0 : A.t + dt;
    const airborne = !seated && !swim && !grounded && A.t > (fm ? 0 : 0.1);
    if (airborne) A.peak = Math.max(A.peak, -vy);
    if (airborne && !A.was) A.takeT = 0;
    if (!airborne && A.was && !swim) { A.landT = 0; A.depth = lerp(0.9, 0.8, clamp(A.peak / 10, 0, 1)); }
    if (!airborne && A.was) A.peak = 0;
    A.was = airborne; A.takeT += dt; A.landT += dt;
    const walk = clamp(speed / 2.5, 0, 1), run = clamp((speed - 2.5) / 3.5, 0, 1);
    // ---- clips: the role this moment has, the emote over it
    const role = swim ? 'swim' : airborne ? (vy > 1.5 ? 'jump' : 'fall') : speed > 3.6 ? 'run' : speed > 0.25 ? 'walk' : 'idle';
    const loco = roleGroup(lvl, role);
    const want = new Map();
    let emoteClip = null;
    if (em && lvl.groups.length) emoteClip = emoteGroup(lvl, ent, em.def.name);
    lvl.emoting = emoteClip ? new Set([emoteClip]) : null;
    if (emoteClip) want.set(emoteClip, 1);
    else if (loco) want.set(loco, 1);
    else if (lvl.roles.idle) want.set(lvl.roles.idle, 1);
    if (loco && (loco === lvl.roles.walk || loco === lvl.roles.run)) { const st = loco === lvl.roles.run ? ent.stride.run : ent.stride.walk; loco.speedRatio = clamp(speed / st, 0.4, 2.5); }
    setWeights(lvl, want, dt, 9);
    const driven = emoteClip || loco; // a clip moves the body: the procedural gait keeps only what a clip never has
    // ---- the rest: the whole body by form, squash and stretch
    const g = lvl.groups.length && driven ? { y: 0, rx: 0, ry: 0, rz: 0, stretch: 1 } : gait(ent.form, { ph: rig.phase, t, walk: rig.lod ? walk * 0.8 : walk, run, speed, grounded, swim });
    let sy = 1, y = g.y + lift, rx = g.rx, ry = g.ry, rz = g.rz;
    if (!rig.lod) sy *= 1 + Math.sin((t * 2 * Math.PI) / 3.2) * 0.0125; // (breathing)
    sy *= g.stretch;
    if (swim && ent.form === 'biped') { rx += 1.2; y += -0.05 + Math.sin(t * 2) * 0.05; } else if (swim) { y += Math.sin(t * 2) * 0.05; }
    if (airborne && vy > 1) sy *= 1 + Math.min(0.1, vy * 0.012);
    if (airborne && A.takeT < 0.25 && vy > 2) sy *= 1 + 0.15 * (1 - A.takeT / 0.25);
    if (A.landT < 0.31) { // the landing: down in 90 ms, back over 220 ms with one overshoot
      const L = A.landT;
      sy *= L < 0.09 ? lerp(1, A.depth, L / 0.09) : 1 + (A.depth - 1) * (1 - (L - 0.09) / 0.22) + 0.05 * Math.sin(((L - 0.09) / 0.22) * Math.PI);
    }
    if (seated) y += -0.4 * (ent.h / 1.8);
    if (em && !emoteClip) {
      const o = bodyEmote(em.def.name, t - em.t0, ent.h);
      y += o.y; rx += o.rx; ry += o.ry; rz += o.rz; sy *= o.sy;
    }
    const sxz = 1 / Math.sqrt(sy), hh = ent.h / 2;
    const mv = pm.mover;
    mv.position.y = pm.baseY + hh * (sy - 1) + y;
    mv.rotation.set(rx, ry, rz);
    mv.scaling.set(sxz, sy, sxz);
    // ---- named parts and a roller's roll, when no clip has the body
    if (!rig.lod) {
      const strong = Boolean(driven && lvl.groups.length);
      for (const p of pm.parts) {
        let a = 0;
        if (p.role === 'wheel') { p.spin += speed * dt / Math.max(0.05, Number(p.radius) || ent.radius || ent.h / 2); a = p.spin; }
        else if (strong) continue;
        else if (p.role === 'leg' || p.role === 'arm') a = Math.sin(rig.phase + p.ph) * p.amp * walk;
        else if (p.role === 'tail') a = Math.sin(t * (2 + speed * 1.5) + p.ph) * p.amp * (0.4 + 0.6 * walk);
        else if (p.role === 'ear') a = Math.sin(t * 3 + p.ph) * 0.05 + run * p.amp;
        else if (p.role === 'wing') a = Math.sin(t * (airborne ? 14 : 2.5) + p.ph) * p.amp;
        else if (p.role === 'fin') a = Math.sin(t * (4 + speed * 2) + p.ph) * p.amp;
        else if (p.role === 'head') a = Math.sin(rig.phase * 2 + p.ph) * p.amp * walk;
        p.n.rotationQuaternion = p.q0.multiply(B.Quaternion.RotationAxis(quatAxis[p.axis] || quatAxis.x, a));
      }
    }
    if (ent.form === 'roller' && !pm.parts.some((p) => p.role === 'wheel')) {
      pm.spin.rotation.x += speed * dt / Math.max(0.05, ent.radius || ent.h / 2);
      if (!speed) pm.spin.rotation.x *= 1 - Math.min(1, dt * 4); // (settles upright)
    }
  }

  /** What a rig's model costs and whether it is over the device's budget, for /avatars and the monitor. */
  function stats(rig) {
    const pm = rig && rig.pm;
    if (!pm || !pm.on) return { loaded: false, state: pm ? pm.state : 'none', tris: 0, draws: 0, level: null, budget: TRIS[(H.device && H.device.tier) || 'phone'] || TRIS.phone, over: false, missing: [] };
    const meshes = meshesOf(pm.cur.roots).filter((m) => m.getTotalIndices && m.getTotalIndices() > 0 && m.isEnabled());
    const budget = TRIS[(H.device && H.device.tier) || 'phone'] || TRIS.phone;
    const near = pm.levels.near.tris;
    return { loaded: true, state: pm.state, tris: pm.tris, nearTris: near, draws: meshes.length, level: pm.cur === pm.levels.near ? 'near' : 'low', budget, over: near > budget, clips: pm.cur.groups.map((g) => g.name), missing: pm.missing || [] };
  }

  P.models = {
    entry, register, levels, attach, animate, dispose, stats, TRIS, HEAD_SHARE, ROLE_RE,
    enabled: (id) => Boolean(entry(id)),
    /** A promise that settles once a rig's model has loaded (or failed): for tests and the showcase. */
    ready: (rig) => (rig.pm ? rig.pm.wait : Promise.resolve()),
    /** Replaces how a file is loaded (tests and the showcase use it): (scene, url) => Promise<AssetContainer> (or the container itself, when it is already at hand). */
    setLoader: (fn) => { loader = fn || loader; },
    /** Forgets the loaded containers (a test's, or after a registry row changed its file). */
    reset: () => { cache.delete(H.world && H.world.scene); },
  };
})();
