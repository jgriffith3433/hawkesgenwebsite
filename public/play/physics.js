// H.physics: the engine's physics, the one way modules (vehicles, mayhem, terrain, water, creatures...) touch it.
// docs/engine-modules.md is the contract; scripts see the friendly part through entities (e.push, e.impulse, ...)
// and game.physics.
//
// Two engines stand behind the same API:
//   'havok'   Havok (Babylon Physics v2; its wasm from the CDN, pinned in engine.json): rotation, real shapes (box,
//             sphere, capsule, cylinder, convex hulls, triangle meshes, heightfields, compounds), joints, forces,
//             casts, sleeping, collision events, layers, a character controller for the player and anyone else.
//   'legacy'  the engine's first box physics (runtime.js legacyStep), only if Havok can't load.
//
// How the engine and Havok share the work, each fixed step (runtime.js step):
//   behaviors, scripts and controllers set velocities and move things (node positions); then H.physics:
//   1. before-step listeners (forces: buoyancy, thrust, wind)
//   2. every solid entity gets the body it should have (made, remade when its shape changed, dropped when it stops
//      being solid); things moved by hand are teleported (dynamic) or driven to where they were put (static and
//      kinematic: their riders are carried); velocities set by scripts are given to the bodies
//   3. Havok steps; characters (the player) move with their controllers
//   4. dynamic bodies' poses and velocities come back to their entities; resting ones sleep
// Touching (hit / leave) stays the engine's: boxes around things, so triggers and ghosts work as before.
/* global HawkesPlay, BABYLON, HavokPhysics */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const RAD = Math.PI / 180;
  const vec = L.vec;
  const W = () => H.world;
  const V = (a) => new B.Vector3(a[0], a[1], a[2]);

  // ------------------------------------------------------------------ layers: who collides with whom
  // A thing is on one layer (e.layer, spec body.layer) and collides with a list of layers (e.collidesWith, spec
  // body.collides). Up to 16 layers; modules name their own with H.physics.layer('fish').
  const LAYERS = new Map();
  ['default', 'player', 'character', 'vehicle', 'debris', 'terrain', 'water', 'trigger'].forEach((n, i) => LAYERS.set(n, 1 << i));
  function layer(name) {
    const n = String(name || 'default');
    if (!LAYERS.has(n)) { if (LAYERS.size >= 16) throw new Error('At most 16 physics layers'); LAYERS.set(n, 1 << LAYERS.size); }
    return LAYERS.get(n);
  }
  const maskOf = (list) => (list === undefined || list === null || list === 'all' ? 0xffff : [].concat(list).reduce((m, n) => m | layer(n), 0));

  // ------------------------------------------------------------------ shapes (descriptions; the engine builds them)
  /** Collider shapes as plain descriptions: give one to H.physics.setShape, a spec's body.shape, shapeCast, overlap. */
  const shapes = {
    box: (size = [1, 1, 1]) => ({ type: 'box', size: Array.isArray(size) ? size : [size, size, size] }),
    sphere: (radius = 0.5) => ({ type: 'sphere', radius }),
    capsule: (radius = 0.4, height = 1.8) => ({ type: 'capsule', radius, height }),
    cylinder: (radius = 0.5, height = 1) => ({ type: 'cylinder', radius, height }),
    /** The convex hull of a mesh (an entity, or a Babylon mesh): good for models that move. */
    convex: (from) => ({ type: 'convex', from }),
    /** The exact triangles of a mesh: for things that stay put (static or kinematic only). */
    mesh: (from) => ({ type: 'mesh', from }),
    /** Ground from heights: rows x cols samples over width x depth meters, heights row by row (Float32Array or array),
     *  centered on the entity. Row r is z = -depth/2 + r * depth / (rows - 1); column c is x likewise. `id` and
     *  `version` name the data: the collider is remade when either changes (heights are never compared). */
    heightfield: ({ width, depth, rows, cols, heights, id, version }) => ({ type: 'heightfield', width, depth, rows, cols, heights, id, version }),
    /** Several shapes as one body: [{ shape, position: [x, y, z], rotation: [x, y, z] (degrees) }]. */
    compound: (parts) => ({ type: 'compound', parts }),
  };

  // ------------------------------------------------------------------ events
  const listeners = { collision: [], 'collision-end': [], trigger: [], explosion: [], before: [], after: [] };
  const on = (name, fn) => {
    const list = listeners[name];
    if (!list) throw new Error(`H.physics.on: one of ${Object.keys(listeners).filter((k) => k !== 'before' && k !== 'after').join(', ')}`);
    list.push(fn);
    return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  };
  const fire = (name, data) => { for (const f of [...listeners[name]]) try { f(data); } catch (err) { H.report(err, `physics ${name}`); } };

  // Touch starts with a trigger are trigger events (both engines); on 'legacy' every other touch start is a collision.
  H.hooks.contact.push((a, b) => {
    if (a.physics === 'trigger' || b.physics === 'trigger') fire('trigger', { trigger: a.physics === 'trigger' ? a : b, entity: a.physics === 'trigger' ? b : a, entered: true });
    else if (!havokOn()) fire('collision', { a, b, point: null, normal: null, speed: 0, impulse: 0 });
  });
  // 'legacy': before-step listeners run with the other step hooks (Havok runs them inside its step).
  H.hooks.step.push((dt) => { if (!havokOn()) fire('before', dt); });
  H.hooks.afterStep.push((dt) => fire('after', dt));

  // ------------------------------------------------------------------ entities: forces, impulses, layers
  const P = L.Entity.prototype;
  Object.assign(P, {
    /** A kick, in newton-seconds: the velocity changes by impulse / mass. `at` (a world point) also spins it. */
    impulse(v, at) {
      const p = vec(v);
      if (this.physics !== 'dynamic') return this;
      if (at && this._pb && this._pb.motion === DYNAMIC) (this._impulses ||= []).push([p, vec(at)]);
      else { this.vx += p[0] / this.mass; this.vy += p[1] / this.mass; this.vz += p[2] / this.mass; }
      this.grounded = false; this.wake();
      return this;
    },
    /** A push in newtons for this step only (call it every step for a steady force: thrust, wind, buoyancy). */
    force(v, at) {
      const p = vec(v);
      if (at && this._pb) { const dt = W() ? W().dt : 1 / 60; return this.impulse([p[0] * dt, p[1] * dt, p[2] * dt], at); }
      const f = this._force || (this._force = [0, 0, 0]); f[0] += p[0]; f[1] += p[1]; f[2] += p[2];
      return this;
    },
    /** A twist in newton-meters for this step only (Havok). */
    torque(v) { const p = vec(v); const t = this._torque || (this._torque = [0, 0, 0]); t[0] += p[0]; t[1] += p[1]; t[2] += p[2]; this._wakeBody = true; return this; },
    sleep() { this.sleeping = true; this._sleepBody = true; return this; },
  });
  Object.defineProperties(P, {
    /** Spin in degrees a second around x, y, z (Havok; always still on 'legacy'). */
    angularVelocity: {
      get() {
        const pb = this._pb;
        if (pb && pb.motion === DYNAMIC && !pb.gone) { const a = pb.plugin.getAngularVelocityToRef(pb.body, TMP_V) || TMP_V; void a; return [TMP_V.x / RAD, TMP_V.y / RAD, TMP_V.z / RAD]; }
        return this._spin ? this._spin.slice() : [0, 0, 0];
      },
      set(v) { this._spin = vec(v); this._spinSet = true; this._wakeBody = true; },
      configurable: true,
    },
    /** True: it never tips over (characters, animals that walk). */
    upright: { get() { return this._upright ?? (this.kind === 'capsule' || Boolean(this.isPlayer) || Boolean(this.spec && this.spec.body && this.spec.body.upright)); }, set(v) { this._upright = Boolean(v); }, configurable: true },
    layer: { get() { return this._layer || (this.spec && this.spec.body && this.spec.body.layer) || 'default'; }, set(v) { layer(v); this._layer = String(v); }, configurable: true },
    collidesWith: { get() { return this._collides || (this.spec && this.spec.body && this.spec.body.collides) || 'all'; }, set(v) { maskOf(v); this._collides = v; }, configurable: true },
  });

  // ------------------------------------------------------------------ Havok
  const STATIC = 0, ANIMATED = 1, DYNAMIC = 2; // B.PhysicsMotionType
  const TMP_V = new B.Vector3();
  const TMP_Q = new B.Quaternion();
  let hk = null;
  const havokOn = () => Boolean(hk && W() && W().havok);

  // Load Havok (the loader waits for this before running a game). Without it the engine plays on 'legacy'.
  H.ready = (async () => {
    if (typeof HavokPhysics !== 'function') return;
    try {
      const url = window.HawkesModules && window.HawkesModules.havok;
      const base = url ? url.replace(/[^/]*$/, '') : '';
      hk = await HavokPhysics(base ? { locateFile: (f) => base + f } : {});
      H.physics.engine = 'havok';
    } catch (err) {
      hk = null;
      console.warn('Havok did not load; playing on the first physics', err);
    }
  })();

  // Every world gets its own Havok world. The engine steps it itself (fixed steps, in runtime.js step).
  H.hooks.scene.push((scene, w) => {
    if (!hk) return;
    const plugin = new B.HavokPlugin(true, hk);
    scene.enablePhysics(new B.Vector3(0, -24, 0), plugin);
    scene._advancePhysicsEngineStep = () => {};
    plugin.setVelocityLimits(200, 60);
    w.havok = { plugin, scene, gravity: -24, joints: [], shapeCache: new Map() };
    plugin.onCollisionObservable.add((c) => onCollision(c, false));
    plugin.onCollisionEndedObservable.add((c) => onCollision(c, true));
  });
  const entityOfBody = (body) => { let n = body && body.transformNode; while (n && !(n.metadata && n.metadata.entity)) n = n.parent; return n ? n.metadata.entity : null; };
  function onCollision(c, ended) {
    const a = entityOfBody(c.collider), b = entityOfBody(c.collidedAgainst);
    if (!a || !b) return;
    if (ended) { if (listeners['collision-end'].length) fire('collision-end', { a, b }); return; }
    // Something local hit a thing another player simulates: take it over, so it moves for everyone (net.js claims).
    for (const [x, y] of [[a, b], [b, a]]) if (x.remote && x.sceneId && x.physics === 'dynamic' && y.physics === 'dynamic' && !y.remote) for (const f of H.hooks.push) f(x, y);
    if (!listeners.collision.length) return;
    const imp = Number(c.impulse) || 0;
    // The impact speed: an impulse J changes how fast they close by J (1/ma + 1/mb); things that don't move (static,
    // kinematic, held) count as infinitely heavy; a bounce carries the speed back out, so it's taken off.
    const inv = (e) => (e._pb && e._pb.motion === DYNAMIC && e.mass > 0 ? 1 / Math.max(0.05, e.mass) : 0);
    const k = inv(a) + inv(b) || 1 / Math.max(0.05, Math.min(a.mass || 1, b.mass || 1));
    const e1 = 1 + Math.max(0, Math.min(0.95, Math.max(Number(a.bounce) || 0, Number(b.bounce) || 0)));
    fire('collision', { a, b, point: c.point ? [c.point.x, c.point.y, c.point.z] : null, normal: c.normal ? [c.normal.x, c.normal.y, c.normal.z] : null, impulse: imp, speed: (imp * k) / e1 });
  }

  /** What collider a thing gets: its body.shape (a description), or 'auto' by its kind. */
  function shapeWanted(e, motion) {
    const d = e._shapeSpec || (e.spec && e.spec.body && e.spec.body.shape) || 'auto';
    if (typeof d === 'object') return d;
    if (d !== 'auto') return { type: d };
    switch (e.kind) {
      case 'sphere': return { type: 'sphere' };
      case 'capsule': return { type: 'capsule' };
      case 'cylinder': return { type: 'cylinder' };
      case 'cone': return { type: 'convex' };
      case 'torus': return { type: motion === DYNAMIC ? 'convex' : 'mesh' };
      case 'model': {
        if (!e._loaded || e._waiting) return { type: 'box' };
        if (motion === DYNAMIC) return { type: 'convex' };
        return vertices(e.node) < 60000 ? { type: 'mesh' } : { type: 'box' };
      }
      default: return { type: 'box' };
    }
  }
  function vertices(node) { let n = node.getTotalVertices ? node.getTotalVertices() : 0; for (const m of node.getChildMeshes(false)) n += m.getTotalVertices(); return n; }
  const meshOf = (x) => (x && x.__entity ? x.node : x);
  /** A Havok shape for a description, in the body's own space (centered on the entity, scaled, not turned). */
  function makeShape(e, d, scene) {
    const lh = e._lhalf || e.half, lo = e._loff || e.offset;
    const auto = !d.size && !d.radius && !d.height;
    const c = d.center ? V(d.center) : auto ? V(lo) : B.Vector3.Zero();
    switch (d.type) {
      case 'sphere': return new B.PhysicsShapeSphere(c, Number(d.radius) || Math.max(lh[0], lh[1], lh[2]), scene);
      case 'capsule': {
        const r = Number(d.radius) || Math.max(lh[0], lh[2]);
        const hh = Math.max(0, (Number(d.height) / 2 || lh[1]) - r);
        return new B.PhysicsShapeCapsule(c.add(new B.Vector3(0, -hh, 0)), c.add(new B.Vector3(0, hh, 0)), r, scene);
      }
      case 'cylinder': {
        const r = Number(d.radius) || Math.max(lh[0], lh[2]);
        const hh = Number(d.height) / 2 || lh[1];
        return new B.PhysicsShapeCylinder(c.add(new B.Vector3(0, -hh, 0)), c.add(new B.Vector3(0, hh, 0)), r, scene);
      }
      case 'convex': case 'mesh': {
        const m = meshOf(d.from) || e.node;
        const type = d.type === 'convex' ? B.PhysicsShapeType.CONVEX_HULL : B.PhysicsShapeType.MESH;
        if (vertices(m) < 3) return makeShape(e, { type: 'box' }, scene);
        return new B.PhysicsShape({ type, parameters: { mesh: m, includeChildMeshes: true } }, scene);
      }
      case 'heightfield': {
        const rows = Math.max(2, d.rows | 0), cols = Math.max(2, d.cols | 0);
        const data = d.heights instanceof Float32Array ? d.heights : Float32Array.from(d.heights || []);
        return new B.PhysicsShapeHeightField(Number(d.width) || 10, Number(d.depth) || 10, cols, rows, data, scene);
      }
      case 'compound': {
        const box = new B.PhysicsShapeContainer(scene);
        for (const p of d.parts || []) {
          const r = vec(p.rotation);
          box.addChild(makeShape(e, p.shape || p, scene), V(vec(p.position)), B.Quaternion.FromEulerAngles(r[0] * RAD, r[1] * RAD, r[2] * RAD));
        }
        return box;
      }
      default: {
        const s = d.size ? vec(d.size, [1, 1, 1]) : [lh[0] * 2, lh[1] * 2, lh[2] * 2];
        return new B.PhysicsShapeBox(c, B.Quaternion.Identity(), new B.Vector3(Math.max(0.01, s[0]), Math.max(0.01, s[1]), Math.max(0.01, s[2])), scene);
      }
    }
  }

  const solidKinds = { static: 1, dynamic: 1, kinematic: 1 };
  const wantsBody = (e) => e.alive && !e._cc && solidKinds[e.physics] === 1 && !e.ghost && e.kind !== 'light' && e.node.isEnabled();
  function motionFor(e) {
    if (e.physics === 'dynamic' && !e.remote && !e.held && !e.node.parent && !e._frozen && !e._far) return DYNAMIC; // (frozen: past the body budget, scale.js; far: round.js)
    if (e.physics === 'static' && !(e._pb && e._pb.moved) && !e.held) return STATIC;
    return ANIMATED;
  }
  /** Where a thing is and how it's turned, as the body should be: [x, y, z, qx, qy, qz, qw] in the world. */
  function nodePose(e) {
    const n = e.node;
    if (n.parent) { n.computeWorldMatrix(true); const p = n.absolutePosition, q = n.absoluteRotationQuaternion; return [p.x, p.y, p.z, q.x, q.y, q.z, q.w]; }
    if (n.rotationQuaternion) { const q = n.rotationQuaternion; return [n.position.x, n.position.y, n.position.z, q.x, q.y, q.z, q.w]; }
    B.Quaternion.FromEulerAnglesToRef(n.rotation.x, n.rotation.y, n.rotation.z, TMP_Q);
    return [n.position.x, n.position.y, n.position.z, TMP_Q.x, TMP_Q.y, TMP_Q.z, TMP_Q.w];
  }
  const samePose = (a, b) => { for (let i = 0; i < 7; i++) if (Math.abs(a[i] - b[i]) > 1e-5) return false; return true; };
  const hp = (pb) => pb.plugin._hknp;
  const qt = (p) => [[p[0], p[1], p[2]], [p[3], p[4], p[5], p[6]]];

  function createBody(e, motion, w) {
    const { plugin, scene } = w.havok;
    let want = shapeWanted(e, motion);
    // (Triangles are for things that stay put: a moving one gets their convex hull, which Havok handles cheaply.)
    if (motion === DYNAMIC && want.type === 'mesh') want = { ...want, type: 'convex' };
    let shape;
    try { shape = makeShape(e, want, scene); } catch (err) { H.report(new Error(`${e.name || e.kind}: its collider (${want.type}) could not be made: ${err.message || err}`)); shape = makeShape(e, { type: 'box' }, scene); }
    const n = e.node;
    const keepQ = n.rotationQuaternion, keepR = n.rotation.clone();
    const body = new B.PhysicsBody(n, motion, false, scene);
    // The engine keeps turning things with Euler angles (rotation), as scripts expect. (Babylon's body gave the node a
    // quaternion, which zeroes its Euler angles: put them back.)
    n.rotationQuaternion = keepQ;
    n.rotation.copyFrom(keepR);
    body.disablePreStep = true;
    body.disableSync = true;
    body.shape = shape;
    const pb = e._pb = { body, shape, plugin, motion, mv: e._mv || 0, dyn: motion === DYNAMIC, spec: specKey(e), pose: nodePose(e), moved: e._pb ? e._pb.moved : false, moving: false, id: body._pluginData.hpBodyId, matKey: '', filterKey: '', massKey: '', gravity: null, fr: UNSET, bo: UNSET, ly: UNSET, cw: UNSET, hd: UNSET };
    hp(pb).HP_Body_SetQTransform(pb.id, qt(pb.pose));
    refresh(e, pb);
    if (motion === DYNAMIC) {
      body.setLinearDamping(0.05);
      body.setAngularDamping(0.25);
      plugin.setLinearVelocity(body, V(e._v));
      hp(pb).HP_Body_SetEventMask(pb.id, hk.EventType.COLLISION_STARTED.value | hk.EventType.COLLISION_FINISHED.value);
    }
    for (const j of w.havok.joints) if (j.a === e || j.b === e) attachJoint(j);
    return pb;
  }
  function dropBody(e) {
    const pb = e._pb;
    if (!pb) return;
    e._pb = null;
    const w = W();
    if (w && w.havok) for (const j of w.havok.joints) if ((j.a === e || j.b === e) && j.constraint) { try { j.constraint.dispose(); } catch {} j.constraint = null; }
    pb.gone = true;
    try { pb.body.dispose(); } catch {}
    try { pb.shape.dispose(); } catch {}
  }
  // What a shape description is, as a short string: worked out once per description object (and again only when its
  // `version` changes). Heightfields and big arrays go by their id (or one given here), never by their numbers.
  const autoIds = new WeakMap();
  let autoId = 0;
  const idOf = (o) => { let n = autoIds.get(o); if (!n) { n = `#${++autoId}`; autoIds.set(o, n); } return n; };
  function describe(d) {
    return JSON.stringify(d, (k, v) => {
      if (v && v.__entity) return v.sceneId || idOf(v);
      if (v && typeof v === 'object' && v.getClassName) return v.name || idOf(v);
      if (ArrayBuffer.isView(v)) return idOf(v);
      if (Array.isArray(v) && v.length > 64) return idOf(v);
      if (v && typeof v === 'object' && v.type === 'heightfield') return `hf:${v.id ?? idOf(v.heights || v)}:${v.version ?? ''}:${v.rows}x${v.cols}:${v.width}x${v.depth}`;
      return v;
    });
  }
  function specKey(e) {
    const d = e._shapeSpec;
    if (!d) return '';
    if (typeof d !== 'object') return String(d);
    const c = e._shapeKeyCache;
    if (c && c.d === d && c.v === d.version) return c.key;
    const key = d.id !== undefined ? `id:${d.id}:${d.version ?? ''}` : describe(d);
    e._shapeKeyCache = { d, v: d.version, key };
    return key;
  }
  // (A body is remade when its entity's shape version (_mv), dynamic or not, or its body.shape description changes.)
  /** Material, filters, mass and gravity: kept in step with the entity's settings. */
  // (Every solid thing, every step: the settings are compared as they are, and keys made only when one changed.)
  const UNSET = Symbol('unset');
  function refresh(e, pb) {
    const fr = e.friction, bo = e.bounce;
    if (fr !== pb.fr || bo !== pb.bo) {
      const mk = `${fr}|${bo}`;
      pb.fr = fr; pb.bo = bo;
      if (mk !== pb.matKey) { pb.matKey = mk; pb.shape.material = { friction: Math.max(0, Number(fr) || 0), restitution: Math.max(0, Math.min(0.98, Number(bo) || 0)), restitutionCombine: B.PhysicsMaterialCombineMode.MAXIMUM }; }
    }
    const ly = e.layer, cw = e.collidesWith, held = Boolean(e.held);
    if (ly !== pb.ly || cw !== pb.cw || held !== pb.hd) {
      const fk = `${ly}|${JSON.stringify(cw)}|${held ? 1 : 0}`;
      pb.ly = ly; pb.cw = cw; pb.hd = held;
      if (fk !== pb.filterKey) { pb.filterKey = fk; pb.shape.filterMembershipMask = layer(ly); pb.shape.filterCollideMask = held ? 0 : maskOf(cw); }
    }
    if (pb.motion !== DYNAMIC) return;
    const mass = e.mass, up = Boolean(e.upright);
    if (!pb.massKey || mass !== pb.ms || up !== pb.up) {
      pb.ms = mass; pb.up = up;
      const sk = `${mass}|${up ? 1 : 0}`;
      if (sk !== pb.massKey) {
        pb.massKey = sk;
        const mp = pb.plugin.computeMassProperties(pb.body);
        // (Havok's inertia is per kilogram: it stays as computed whatever the mass.)
        pb.body.setMassProperties({ mass: e.mass, centerOfMass: mp.centerOfMass, inertia: e.upright ? B.Vector3.Zero() : mp.inertia, inertiaOrientation: mp.inertiaOrientation });
        if (e.upright) pb.plugin.setAngularVelocity(pb.body, B.Vector3.Zero());
      }
    }
    if (pb.gravity !== e.gravity) { pb.gravity = e.gravity; pb.body.setGravityFactor(Number(e.gravity)); }
  }
  function setMotion(e, pb, motion) {
    pb.body.setMotionType(motion);
    pb.body.disableSync = true;
    pb.motion = motion;
    pb.massKey = '';
    if (motion === DYNAMIC) {
      refresh(e, pb);
      pb.plugin.setLinearVelocity(pb.body, V(e._v));
      hp(pb).HP_Body_SetEventMask(pb.id, hk.EventType.COLLISION_STARTED.value | hk.EventType.COLLISION_FINISHED.value);
      wakeBody(pb);
    } else {
      pb.plugin.setLinearVelocity(pb.body, B.Vector3.Zero());
      pb.plugin.setAngularVelocity(pb.body, B.Vector3.Zero());
    }
  }
  const wakeBody = (pb) => { try { hp(pb).HP_Body_SetActivationState(pb.id, hk.ActivationState.ACTIVE); } catch {} };

  // Most things don't move: a node exactly where and as it was last step (no parent, Euler angles) is still, without
  // working out its pose again. (afterStep forgets it when Havok moves the node.)
  function stillAt(n, pb) {
    const s = pb.at;
    if (!s || n.parent || n.rotationQuaternion) return false;
    const p = n.position, r = n.rotation;
    return p.x === s[0] && p.y === s[1] && p.z === s[2] && r.x === s[3] && r.y === s[4] && r.z === s[5];
  }
  function remember(n, pb) {
    if (n.parent || n.rotationQuaternion) { pb.at = null; return; }
    const s = pb.at || (pb.at = [0, 0, 0, 0, 0, 0]);
    s[0] = n.position.x; s[1] = n.position.y; s[2] = n.position.z; s[3] = n.rotation.x; s[4] = n.rotation.y; s[5] = n.rotation.z;
  }

  /** Before Havok steps: bodies for what should have them, where they were put, with the velocities scripts set. */
  function beforeStep(dt, w) {
    for (const e of w.entities) {
      if (!wantsBody(e)) { if (e._pb) dropBody(e); e._vSet = false; continue; }
      const motion = motionFor(e);
      let pb = e._pb;
      if (!pb || pb.mv !== (e._mv || 0) || pb.dyn !== (motion === DYNAMIC) || pb.spec !== specKey(e)) { dropBody(e); pb = createBody(e, motion, w); e._vSet = false; }
      else if (pb.motion !== motion && !(pb.motion === ANIMATED && motion === STATIC)) setMotion(e, pb, motion);
      refresh(e, pb);
      const still = stillAt(e.node, pb);
      const pose = still ? pb.pose : nodePose(e);
      const moved = !still && !samePose(pose, pb.pose);
      if (!still) remember(e.node, pb);
      if (pb.motion === DYNAMIC) {
        if (moved) { hp(pb).HP_Body_SetQTransform(pb.id, qt(pose)); wakeBody(pb); }
        if (e._force) { const f = e._force; e._force = null; e._v[0] += (f[0] / e.mass) * dt; e._v[1] += (f[1] / e.mass) * dt; e._v[2] += (f[2] / e.mass) * dt; e._vSet = true; }
        // A velocity written: given to the body (and it wakes), unless it's a stop written to a resting body (a module
        // keeping its own still things still), or the entity says its writes never wake it (e.quietVelocity).
        if (e._vSet && !(e.sleeping && (e.quietVelocity || (Math.abs(e._v[0]) + Math.abs(e._v[1]) + Math.abs(e._v[2]) < 1e-4)))) { pb.plugin.setLinearVelocity(pb.body, V(e._v)); wakeBody(pb); }
        if (e._impulses) { for (const [j, at] of e._impulses) pb.plugin.applyImpulse(pb.body, V(j), V(at)); e._impulses = null; wakeBody(pb); }
        if (e._torque) { const t = e._torque; e._torque = null; pb.plugin.applyAngularImpulse(pb.body, new B.Vector3(t[0] * dt, t[1] * dt, t[2] * dt)); }
        if (e._spinSet) { e._spinSet = false; const s = e._spin || [0, 0, 0]; pb.plugin.setAngularVelocity(pb.body, new B.Vector3(s[0] * RAD, s[1] * RAD, s[2] * RAD)); }
        if (e._wakeBody) wakeBody(pb);
        if (e._sleepBody) { e._sleepBody = false; try { hp(pb).HP_Body_SetActivationState(pb.id, hk.ActivationState.INACTIVE); } catch {} }
      } else if (moved) {
        // Moved by a behavior, a script or the editor: driven there, so whatever stands on it is carried along.
        if (pb.motion === STATIC) { setMotion(e, pb, ANIMATED); pb.moved = true; }
        pb.plugin.setTargetTransform(pb.body, new B.Vector3(pose[0], pose[1], pose[2]), new B.Quaternion(pose[3], pose[4], pose[5], pose[6]));
        pb.moving = true;
      } else if (pb.moving) {
        pb.moving = false;
        pb.plugin.setLinearVelocity(pb.body, B.Vector3.Zero());
        pb.plugin.setAngularVelocity(pb.body, B.Vector3.Zero());
        hp(pb).HP_Body_SetQTransform(pb.id, qt(pose));
      }
      pb.pose = pose;
      e._vSet = false; e._wakeBody = false;
    }
  }

  /** After Havok stepped: dynamic things are where their bodies are, moving as they move; resting ones sleep. */
  function afterStep(w) {
    const ray = new B.PhysicsRaycastResult();
    for (const e of w.entities) {
      const pb = e._pb;
      if (!pb || pb.motion !== DYNAMIC) continue;
      const k = hp(pb);
      let active = true;
      try { active = k.HP_Body_GetActivationState(pb.id)[1] === hk.ActivationState.ACTIVE; } catch {}
      if (!active) { if (!e.sleeping) { e.sleeping = true; e._v[0] = e._v[1] = e._v[2] = 0; } continue; }
      e.sleeping = false;
      const t = k.HP_Body_GetQTransform(pb.id)[1];
      const p = t[0], q = t[1];
      const n = e.node;
      n.position.set(p[0], p[1], p[2]);
      if (n.rotationQuaternion) n.rotationQuaternion.set(q[0], q[1], q[2], q[3]);
      else { TMP_Q.set(q[0], q[1], q[2], q[3]); TMP_Q.toEulerAnglesToRef(n.rotation); }
      const v = k.HP_Body_GetLinearVelocity(pb.id)[1];
      e._v[0] = v[0]; e._v[1] = v[1]; e._v[2] = v[2];
      pb.pose = nodePose(e);
      pb.at = null;
      turnedBox(e);
      // Standing on something (jumping, hopping and walking need to know): a short look down.
      if (e.upright || e.behaviors.length || e.handlers.hit.length || e._walked) {
        const bottom = e.y + e.offset[1] - e.half[1];
        const from = new B.Vector3(e.x, bottom + 0.06, e.z), to = new B.Vector3(e.x, bottom - 0.1, e.z);
        let hit = null;
        for (let i = 0; i < 3; i++) {
          pb.plugin.raycast(from, to, ray, { collideWith: maskOf(e.collidesWith) });
          if (!ray.hasHit) break;
          const o = entityOfBody(ray.body);
          if (o !== e) { hit = o; break; }
          from.y = ray.hitPointWorld.y - 0.01;
          if (from.y <= to.y) break;
        }
        e.grounded = Boolean(hit) && e._v[1] < 0.6;
        e.standing = e.grounded ? hit : null;
      }
    }
  }
  /** A turned thing's box around it (for touching): its own box, turned. */
  const TMP_M = new B.Matrix();
  function turnedBox(e) {
    const lh = e._lhalf, lo = e._loff;
    if (!lh) return;
    const r = e.node.rotation;
    // A ball looks the same however it has rolled: its box stays its own (turning it would only grow it).
    const round = e.kind === 'sphere' && (!e._shapeSpec || e._shapeSpec === 'sphere' || e._shapeSpec.type === 'sphere');
    if (round || (!r.x && !r.z && !r.y)) { if (e.half[0] !== lh[0] || e.half[1] !== lh[1] || e.half[2] !== lh[2]) { e.half = lh.slice(); e.offset = lo.slice(); } return; }
    B.Matrix.RotationYawPitchRollToRef(r.y, r.x, r.z, TMP_M);
    const m = TMP_M.m;
    // Rows of m are where the local x, y, z axes point.
    e.half = [0, 1, 2].map((i) => Math.abs(m[i]) * lh[0] + Math.abs(m[4 + i]) * lh[1] + Math.abs(m[8 + i]) * lh[2]);
    e.offset = [0, 1, 2].map((i) => m[i] * lo[0] + m[4 + i] * lo[1] + m[8 + i] * lo[2]);
  }

  // ------------------------------------------------------------------ characters: the player, and anyone given one
  /** Moves a character with Babylon's character controller on Havok: slopes up to maxSlope, steps up to stepHeight,
   *  carried by what it stands on, pushing loose things. Gravity, jumping and walking speed are the engine's. */
  function stepCharacter(e, dt, w) {
    const c = e._cc;
    const n = e.node;
    const g = (w.config.gravity ?? -24) * (e.gravity ?? 1);
    const lh = e._lhalf || e.half;
    if (!c.cc) {
      const r = Number(c.opts.radius) || Math.max(lh[0], lh[2]);
      const h = Number(c.opts.height) || lh[1] * 2;
      c.cc = new B.PhysicsCharacterController(n.position.clone(), { capsuleHeight: h, capsuleRadius: r }, w.scene);
      c.cc.maxSlopeCosine = Math.cos((Number(c.opts.maxSlope) || 50) * RAD);
      c.cc.characterStrength = Number(c.opts.strength) || 4000;
      c.cc.characterMass = Number(c.opts.mass) || 70;
      c.cc.keepDistance = 0.02;
      c.last = n.position.clone();
      c.r = r; c.h = h;
    }
    const cc = c.cc;
    // Put somewhere by a script (respawn, a teleport): the controller goes there too.
    if (B.Vector3.DistanceSquared(n.position, c.last) > 1e-8) { cc._position.copyFrom(n.position); cc._manifold = []; }
    const v = e._v;
    // (A ghost goes through everything; _fast is flying high and fast in a round world: moved straight, no casts.)
    if (e.ghost || e._fast) { n.position.addInPlaceFromFloats(v[0] * dt, v[1] * dt, v[2] * dt); cc._position.copyFrom(n.position); c.last.copyFrom(n.position); e.grounded = false; e.standing = null; return; }
    // Carried by what it stands on: however that moved and turned since the last step (platforms, lifts, boats).
    const on = c.on;
    if (on && on.alive && e.grounded) {
      const op = whereIs(on.node), yaw = on.node.rotation.y;
      const dyaw = yaw - c.onYaw;
      let dx = op.x - c.onAt[0], dz = op.z - c.onAt[2];
      const dy = op.y - c.onAt[1];
      if (dyaw) {
        const rx = n.position.x - c.onAt[0], rz = n.position.z - c.onAt[2];
        const cs = Math.cos(dyaw), sn = Math.sin(dyaw);
        dx += rx * cs + rz * sn - rx; dz += -rx * sn + rz * cs - rz;
        if (e === w.player && w.camera) w.camera.yaw += dyaw;
        n.rotation.y += dyaw;
      }
      if (dx || dy || dz) { cc._position.addInPlaceFromFloats(dx, dy, dz); n.position.copyFrom(cc._position); }
    }
    const down = new B.Vector3(0, -1, 0);
    const support = cc.checkSupport(dt, down);
    const sv = B.Vector3.Zero(); // (riding is done above, from how the thing moved)
    // On the ground: supported, and not moving away from it. "Away" is measured against the ground's own slope: walking
    // up a 20 degree slope at 6 m/s rises 2.2 m/s, which is not a jump (it used to be: landing from a jump onto an uphill
    // slope left the character "in the air" for as long as it kept walking up, so it never played its landing).
    const nrm = support.averageSurfaceNormal;
    const supported = support.supportedState === 2 && g < 0;
    const alongVy = supported && nrm.y > 0.05 ? -(nrm.x * v[0] + nrm.z * v[2]) / nrm.y : 0; // (the rise the ground gives this walk)
    let onGround = supported && v[1] - Math.max(0, alongVy) <= sv.y + 0.5;
    // Ground snap: grounded a moment ago, not jumping, and walkable ground just under the feet (over a crest, down a step,
    // fast downhill): put the feet on it instead of starting a fall.
    if (!onGround && c.airT === 0 && v[1] <= 0.5 && g < 0 && !support.supportedState) onGround = snapDown(e, c, w);
    c.airT = onGround ? 0 : (c.airT || 0) + dt;
    if (onGround) {
      if (!e._walked) { const k = Math.max(0, 1 - (e.friction ?? 0.6) * 10 * dt); v[0] *= k; v[2] *= k; }
      v[1] = 0;
    } else v[1] = Math.max(-60, v[1] + g * dt);
    // Standing still on a walkable slope: no push down into it (that pushed along the slope, a slide). Moving: it follows
    // the ground's slope down (a level push would leave the ground going downhill) with a little push into it.
    const still = onGround && Math.hypot(v[0], v[2]) < 0.05;
    const glue = onGround && !still ? Math.min(0, alongVy) - 1.5 : 0;
    const want = new B.Vector3(v[0] + (onGround ? sv.x : 0), onGround ? sv.y + glue : v[1], v[2] + (onGround ? sv.z : 0));
    cc.setVelocity(want);
    const before = cc.getPosition().clone();
    cc.integrate(dt, support, new B.Vector3(0, g, 0));
    const got = cc.getVelocity();
    // Steps: blocked while walking on the ground, try the same move a step higher.
    const wantH = Math.hypot(v[0], v[2]);
    const moved = cc.getPosition().subtract(before);
    if (onGround && wantH > 0.5 && Math.hypot(moved.x, moved.z) < wantH * dt * 0.35) stepUp(e, c, v, dt, w);
    if (!onGround) { v[1] = got.y; if (v[1] > 0 && moved.y < v[1] * dt * 0.2) v[1] = 0; }
    n.position.copyFrom(cc.getPosition());
    c.last.copyFrom(n.position);
    // What it stands on and what it pushed.
    let standing = null, best = 0.5;
    for (const m of cc._manifold || []) {
      const o = m.bodyB && entityOfBody(m.bodyB.body);
      if (!o) continue;
      if (m.normal.y > best) { best = m.normal.y; standing = o; }
      if (o.physics === 'dynamic') { if (o.remote) for (const f of H.hooks.push) f(o, e); else if (o._pb) wakeBody(o._pb); }
    }
    e.grounded = onGround || (Boolean(standing) && v[1] <= 0.5);
    e.standing = e.grounded ? standing : null;
    c.on = e.standing;
    if (c.on) { const op = whereIs(c.on.node); c.onAt = [op.x, op.y, op.z]; c.onYaw = c.on.node.rotation.y; }
  }
  /** A character that was on the ground and now has nothing under it: walkable ground within SNAP below? Moves it there. */
  const SNAP = 0.35;
  function snapDown(e, c, w) {
    const plugin = w.havok.plugin, cc = c.cc;
    const pos = cc.getPosition();
    const inA = new B.ShapeCastResult(), hit = new B.ShapeCastResult();
    const to = pos.add(new B.Vector3(0, -SNAP, 0));
    plugin.shapeCast({ shape: cc._shape, rotation: B.Quaternion.Identity(), startPosition: pos, endPosition: to, shouldHitTriggers: false }, inA, hit);
    if (!hit.hasHit || hit.hitNormal.y < cc.maxSlopeCosine) return false;
    const o = entityOfBody(hit.body);
    if (o === e) return false;
    cc._position.copyFrom(B.Vector3.Lerp(pos, to, hit.hitFraction).add(new B.Vector3(0, 0.01, 0)));
    return true;
  }
  /** Where a node is in the world now (its parent may have moved since its matrix was last worked out). */
  const whereIs = (node) => (node.parent ? (node.computeWorldMatrix(true), node.absolutePosition) : node.position);
  function stepUp(e, c, v, dt, w) {
    const plugin = w.havok.plugin;
    const stepH = Number(c.opts.stepHeight) || 0.45;
    const cc = c.cc;
    const pos = cc.getPosition();
    const dir = new B.Vector3(v[0], 0, v[2]).normalize();
    const shape = cc._shape;
    const inA = new B.ShapeCastResult(), hitA = new B.ShapeCastResult();
    const up = pos.add(new B.Vector3(0, stepH, 0));
    plugin.shapeCast({ shape, rotation: B.Quaternion.Identity(), startPosition: pos, endPosition: up, shouldHitTriggers: false }, inA, hitA);
    if (hitA.hasHit) return;
    const ahead = up.add(dir.scale(Math.max(c.r * 0.6, Math.hypot(v[0], v[2]) * dt * 2)));
    plugin.shapeCast({ shape, rotation: B.Quaternion.Identity(), startPosition: up, endPosition: ahead, shouldHitTriggers: false }, inA, hitA);
    if (hitA.hasHit) return;
    const downTo = ahead.add(new B.Vector3(0, -stepH - 0.05, 0));
    plugin.shapeCast({ shape, rotation: B.Quaternion.Identity(), startPosition: ahead, endPosition: downTo, shouldHitTriggers: false }, inA, hitA);
    if (!hitA.hasHit || hitA.hitNormal.y < 0.7) return;
    const land = B.Vector3.Lerp(ahead, downTo, hitA.hitFraction).add(new B.Vector3(0, 0.02, 0));
    if (land.y - pos.y < 0.03) return;
    cc._position.copyFrom(land);
  }

  // ------------------------------------------------------------------ joints
  const AX = () => B.PhysicsConstraintAxis;
  function anchorFor(point, w) {
    const node = new B.TransformNode('joint-anchor', w.scene);
    node.position.copyFrom(point);
    const body = new B.PhysicsBody(node, STATIC, false, w.scene);
    body.shape = new B.PhysicsShapeSphere(B.Vector3.Zero(), 0.01, w.scene);
    body.shape.filterCollideMask = 0; body.shape.filterMembershipMask = 0;
    return { node, body };
  }
  function attachJoint(j) {
    const w = W();
    if (!w || !w.havok || j.removed) return;
    if (j.constraint) { try { j.constraint.dispose(); } catch {} j.constraint = null; }
    const pa = j.a._pb, pbB = j.b ? j.b._pb : (j.anchor || (j.anchor = anchorFor(V(j.worldPivot), w)));
    if (!pa || !pbB) return;
    const o = j.o, scene = w.scene;
    const pivotA = V(vec(o.pivotA)), pivotB = j.b ? V(vec(o.pivotB !== undefined ? o.pivotB : j.pivotBGuess)) : B.Vector3.Zero();
    const axisA = V(vec(o.axisA || o.axis, [0, 1, 0])), axisB = V(vec(o.axisB || o.axis, [0, 1, 0]));
    let c;
    switch (j.type) {
      case 'fixed': c = new B.LockConstraint(pivotA, pivotB, axisA, axisB, scene); break;
      case 'ball': c = new B.BallAndSocketConstraint(pivotA, pivotB, axisA, axisB, scene); break;
      // A slider and a hinge are 6-DoF constraints (Babylon's own Prismatic and Hinge have no limits or motors): every
      // axis locked but the one it moves along (LINEAR_X) or turns round (ANGULAR_X), the constraint's x being `axis`.
      case 'slider': c = new B.Physics6DoFConstraint({ pivotA, pivotB, axisA, axisB }, [AX().LINEAR_Y, AX().LINEAR_Z, AX().ANGULAR_X, AX().ANGULAR_Y, AX().ANGULAR_Z].map((axis) => ({ axis, minLimit: 0, maxLimit: 0 })), scene); break;
      case 'distance': c = new B.DistanceConstraint(Number(o.max ?? o.distance) || 1, scene); break;
      case 'spring': {
        const lim = [AX().LINEAR_X, AX().LINEAR_Y, AX().LINEAR_Z].map((axis) => ({ axis, minLimit: Number(o.min ?? 0), maxLimit: Number(o.max ?? 0), stiffness: Number(o.stiffness ?? 50), damping: Number(o.damping ?? 2) }));
        c = new B.Physics6DoFConstraint({ pivotA, pivotB, axisA, axisB }, lim, scene);
        break;
      }
      default: c = new B.Physics6DoFConstraint({ pivotA, pivotB, axisA, axisB }, [AX().LINEAR_X, AX().LINEAR_Y, AX().LINEAR_Z, AX().ANGULAR_Y, AX().ANGULAR_Z].map((axis) => ({ axis, minLimit: 0, maxLimit: 0 })), scene);
    }
    (pa.body).addConstraint(pbB.body, c);
    c.isCollisionsEnabled = Boolean(o.collide);
    j.constraint = c;
    if (o.limits) j.limits(o.limits[0], o.limits[1]);
    if (o.motor) j.motor(o.motor.speed, o.motor.force);
  }
  function joint(type, a, b, o = {}) {
    const w = W();
    if (!havokOn()) { H.report(new Error(`Joints need the physics engine (it isn't running here): ${type}`), 'physics'); return null; }
    if (!a || !a.__entity) throw new Error('H.physics.joint(type, a, b, options): a is an entity');
    beforeStep(0, w); // make sure both have bodies now
    const pivotA = vec(o.pivotA);
    // The pivot in the world (from a), and where that is in b's own space when b's pivot isn't given.
    a.node.computeWorldMatrix(true);
    const world = B.Vector3.TransformCoordinates(V(pivotA), a.node.getWorldMatrix());
    let guess = [0, 0, 0];
    if (b && b.__entity) { b.node.computeWorldMatrix(true); const inv = b.node.getWorldMatrix().clone().invert(); const l = B.Vector3.TransformCoordinates(world, inv); const s = b.node.scaling; guess = [l.x * s.x, l.y * s.y, l.z * s.z]; }
    const j = {
      type: String(type || 'hinge'), a, b: b && b.__entity ? b : null, o, constraint: null, worldPivot: !(b && b.__entity) && Array.isArray(o.worldPivot) ? vec(o.worldPivot) : [world.x, world.y, world.z], // (worldPivot: where a joint to the world holds, when not on a: a rope's knot above)
      pivotBGuess: guess, removed: false,
      remove() { j.removed = true; if (j.constraint) { try { j.constraint.dispose(); } catch {} } j.constraint = null; if (j.anchor) { j.anchor.body.dispose(); j.anchor.node.dispose(); } const list = W() && W().havok ? W().havok.joints : []; const i = list.indexOf(j); if (i >= 0) list.splice(i, 1); },
      motor(speed = 0, force = 100) {
        o.motor = { speed, force };
        const c = j.constraint;
        if (!c || !c.setAxisMotorType) return j;
        const axis = j.type === 'slider' ? AX().LINEAR_X : AX().ANGULAR_X;
        c.setAxisMotorType(axis, B.PhysicsConstraintMotorType.VELOCITY);
        // (Havok's constraint axis runs the other way round: positive is along +axis, and degrees/s the way e.angularVelocity counts.)
        c.setAxisMotorTarget(axis, j.type === 'slider' ? -Number(speed) : -Number(speed) * RAD);
        c.setAxisMotorMaxForce(axis, Number(force));
        if (j.a._pb) wakeBody(j.a._pb);
        return j;
      },
      limits(min, max) {
        o.limits = [min, max];
        const c = j.constraint;
        if (!c || !c.setAxisMinLimit) return j;
        const axis = j.type === 'slider' ? AX().LINEAR_X : AX().ANGULAR_X;
        const k = j.type === 'slider' ? 1 : RAD;
        c.setAxisMode(axis, B.PhysicsConstraintAxisLimitMode.LIMITED);
        // (The constraint's axis runs the other way in Havok's frame: positive along +axis here, and turning the way the
        // thing's own rotation counts, as the motor.)
        c.setAxisMinLimit(axis, -Number(max) * k);
        c.setAxisMaxLimit(axis, -Number(min) * k);
        return j;
      },
    };
    w.havok.joints.push(j);
    attachJoint(j);
    return j;
  }

  // ------------------------------------------------------------------ the step, for runtime.js
  H.hooks.physics = {
    get ready() { return havokOn(); },
    step(dt) {
      const w = W();
      fire('before', dt);
      const g = w.config.gravity ?? -24;
      if (g !== w.havok.gravity) { w.havok.gravity = g; w.havok.plugin.setGravity(new B.Vector3(0, g, 0)); }
      beforeStep(dt, w);
      if (w.round) roundGravity(dt, w, g);
      w.havok.plugin.executeStep(dt, []);
      for (const e of [...w.entities]) if (e._cc && e.alive) { if (e.remote || e.held || e._far) { e._cc.last && e._cc.last.copyFrom(e.node.position); continue; } stepCharacter(e, dt, w); }
      afterStep(w);
    },
  };

  // ------------------------------------------------------------------ a round world (round.js)
  /** Gravity toward the planet's middle. Havok pulls everything along -y (exact where you are: the frame is turned so
   *  that up is +y under you); a moving body away from you gets the rest of its pull toward the middle each step.
   *  Resting bodies are left asleep (they rest where they landed). */
  function roundGravity(dt, w, g) {
    const R = w.round.radius;
    for (const e of w.entities) {
      const pb = e._pb;
      if (!pb || pb.motion !== DYNAMIC || e.sleeping || !e.gravity) continue;
      const x = e.node.position.x, y = e.node.position.y + R, z = e.node.position.z;
      if (x * x + z * z < 4) continue; // (within 2 m of the axis: -y is the middle to within a few millidegrees)
      const len = Math.hypot(x, y, z) || 1;
      const k = Math.abs(g) * e.gravity * dt, s = g < 0 ? 1 : -1;
      // What it should get (toward the middle) less what Havok gives it (straight down).
      const ax = -s * (x / len) * k, ay = -s * (y / len) * k + s * k, az = -s * (z / len) * k;
      const v = hp(pb).HP_Body_GetLinearVelocity(pb.id)[1];
      hp(pb).HP_Body_SetLinearVelocity(pb.id, [v[0] + ax, v[1] + ay, v[2] + az]);
    }
  }
  /** The frame moved under the player (round.js has already moved and turned every entity's node): the bodies, their
   *  velocities, the characters and the joints' anchors go with them, as they are (nothing is woken, nothing is
   *  driven, nothing is remade). `tr` = { point([x, y, z]), dir([x, y, z]) }. */
  function rebase(tr) {
    const w = W();
    if (!w || !w.havok) return;
    for (const e of w.entities) {
      const pb = e._pb;
      if (pb && !pb.gone) {
        const pose = nodePose(e);
        const k = hp(pb);
        k.HP_Body_SetQTransform(pb.id, qt(pose));
        pb.pose = pose;
        if (pb.motion === DYNAMIC) {
          const v = k.HP_Body_GetLinearVelocity(pb.id)[1], a = k.HP_Body_GetAngularVelocity(pb.id)[1];
          k.HP_Body_SetLinearVelocity(pb.id, tr.dir(v));
          k.HP_Body_SetAngularVelocity(pb.id, tr.dir(a));
          // (A resting body stays asleep where it rests: moving the frame isn't a push.)
          if (e.sleeping) try { k.HP_Body_SetActivationState(pb.id, hk.ActivationState.INACTIVE); } catch {}
        } else if (pb.moving) pb.plugin.setTargetTransform(pb.body, new B.Vector3(pose[0], pose[1], pose[2]), new B.Quaternion(pose[3], pose[4], pose[5], pose[6]));
      }
      const c = e._cc;
      if (c && c.cc) {
        c.cc._position.copyFrom(e.node.position);
        if (c.last) c.last.copyFrom(e.node.position);
        c.cc._manifold = [];
        // (What it stands on is where it is now, moved or not: the ground stays under you.)
        if (c.on && c.on.alive) { const op = whereIs(c.on.node); c.onAt = [op.x, op.y, op.z]; c.onYaw = c.on.node.rotation.y; }
        if (c.cc._velocity) { const v = tr.dir([c.cc._velocity.x, c.cc._velocity.y, c.cc._velocity.z]); c.cc._velocity.set(v[0], v[1], v[2]); }
      }
    }
    for (const j of w.havok.joints) {
      if (j.worldPivot) j.worldPivot = tr.point(j.worldPivot);
      if (j.anchor) { j.anchor.node.position.set(j.worldPivot[0], j.worldPivot[1], j.worldPivot[2]); try { w.havok.plugin._hknp.HP_Body_SetQTransform(j.anchor.body._pluginData.hpBodyId, [j.worldPivot.slice(), [0, 0, 0, 1]]); } catch { /* it's remade with its joint */ } }
    }
  }
  // The player is a character. Bodies and controllers go with their entity.
  H.hooks.destroy.push((e) => { dropBody(e); if (e._cc && e._cc.cc) e._cc.cc = null; });
  const isCharacter = (e) => e.isPlayer && !e.remotePlayer;
  H.hooks.step.unshift(() => { const p = W() && W().player; if (p && isCharacter(p) && !p._cc && havokOn()) p._cc = { opts: { maxSlope: 50, stepHeight: 0.45 } }; });

  // ------------------------------------------------------------------ queries
  /** The first thing a ray hits: { entity, point, normal, distance } or null. Havok's colliders (and characters' boxes)
   *  when it runs; what you see ('legacy'). o.ignore: an entity (or list), o.layers: what it can hit, o.filter(entity):
   *  false to look past it, o.characters: false to leave characters out. */
  function raycast(from, dir, dist = 100, o = {}) {
    if (!havokOn()) return H.game ? H.game.raycast(from, dir, dist, o) : null;
    const w = W();
    const a = vec(from), d0 = Array.isArray(dir) ? vec(dir) : [dir.x || 0, dir.y || 0, dir.z || 0];
    const len = Math.hypot(...d0) || 1;
    const d = d0.map((x) => x / len);
    const ignore = o.ignore ? new Set([].concat(o.ignore)) : null;
    const skip = (e) => (ignore && ignore.has(e)) || (o.filter && !o.filter(e));
    const r = new B.PhysicsRaycastResult();
    const start = new B.Vector3(a[0], a[1], a[2]), end = new B.Vector3(a[0] + d[0] * dist, a[1] + d[1] * dist, a[2] + d[2] * dist);
    const q = { collideWith: maskOf(o.layers), shouldHitTriggers: false };
    let travelled = 0, best = null;
    for (let i = 0; i < 6 && travelled < dist; i++) {
      w.havok.plugin.raycast(start, end, r, q);
      if (!r.hasHit) break;
      const e = entityOfBody(r.body);
      const hitAt = r.hitPointWorld;
      const along = Math.hypot(hitAt.x - a[0], hitAt.y - a[1], hitAt.z - a[2]);
      if (e && !skip(e)) { best = { entity: e, point: [hitAt.x, hitAt.y, hitAt.z], normal: [r.hitNormalWorld.x, r.hitNormalWorld.y, r.hitNormalWorld.z], distance: along }; break; }
      travelled = along + 0.01;
      start.set(a[0] + d[0] * travelled, a[1] + d[1] * travelled, a[2] + d[2] * travelled);
    }
    // Characters have no body: their boxes.
    if (o.characters !== false) for (const e of w.entities) {
      if (!e._cc || !e.alive || skip(e) || !e.node.isEnabled()) continue;
      const t = rayBox(a, d, e.box());
      if (t !== null && t <= dist && (!best || t < best.distance)) best = { entity: e, point: [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t], normal: [-d[0], -d[1], -d[2]], distance: t };
    }
    return best;
  }
  function rayBox(a, d, b) {
    let t0 = 0, t1 = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (a[i] < b.min[i] || a[i] > b.max[i]) return null; continue; }
      let ta = (b.min[i] - a[i]) / d[i], tb = (b.max[i] - a[i]) / d[i];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
    return t0;
  }
  /** Things whose boxes are inside a shape (a sphere, or a box) at a point. */
  function overlap(shape, at, o = {}) {
    const w = W();
    if (!w) return [];
    const p = vec(at);
    const out = [];
    const ignore = new Set([].concat(o.ignore || []));
    for (const e of w.entities) {
      if (!e.alive || ignore.has(e)) continue;
      if (!o.all && e.physics === 'none') continue;
      const b = e.box();
      if (shape.type === 'sphere') {
        const cx = Math.max(b.min[0], Math.min(p[0], b.max[0])), cy = Math.max(b.min[1], Math.min(p[1], b.max[1])), cz = Math.max(b.min[2], Math.min(p[2], b.max[2]));
        if (Math.hypot(cx - p[0], cy - p[1], cz - p[2]) <= shape.radius) out.push(e);
      } else {
        const s = shape.size || [1, 1, 1];
        if (b.min[0] < p[0] + s[0] / 2 && b.max[0] > p[0] - s[0] / 2 && b.min[1] < p[1] + s[1] / 2 && b.max[1] > p[1] - s[1] / 2 && b.min[2] < p[2] + s[2] / 2 && b.max[2] > p[2] - s[2] / 2) out.push(e);
      }
    }
    return out;
  }
  /** Sweeps a shape from one point to another: the first thing in the way, { entity, point, normal, fraction }. */
  function shapeCast(shape, from, to, o = {}) {
    const a = vec(from), b = vec(to);
    if (!havokOn()) {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len = Math.hypot(...d) || 1;
      const hit = raycast(a, d, len, o);
      return hit ? { ...hit, fraction: hit.distance / len } : null;
    }
    const w = W();
    const key = JSON.stringify(shape);
    let s = w.havok.shapeCache.get(key);
    if (!s) { s = makeShape({ half: [0.5, 0.5, 0.5], offset: [0, 0, 0] }, shape, w.scene); w.havok.shapeCache.set(key, s); }
    const inR = new B.ShapeCastResult(), hitR = new B.ShapeCastResult();
    const ig = o.ignore && o.ignore._pb ? o.ignore._pb.body : undefined;
    const r = vec(o.rotation);
    w.havok.plugin.shapeCast({ shape: s, rotation: B.Quaternion.FromEulerAngles(r[0] * RAD, r[1] * RAD, r[2] * RAD), startPosition: V(a), endPosition: V(b), shouldHitTriggers: false, ignoreBody: ig }, inR, hitR);
    if (!hitR.hasHit) return null;
    const p = hitR.hitPoint, n = hitR.hitNormal;
    return { entity: entityOfBody(hitR.body), point: [p.x, p.y, p.z], normal: [n.x, n.y, n.z], fraction: hitR.hitFraction };
  }

  /** Tells everyone an explosion happened: H.physics.on('explosion', fn) for modules (across worlds) and
   *  game.on('explosion', fn) for scripts, with { position, radius, force, damage, authoritative, ...more }.
   *  authoritative: this player decided it (pushed things, did the damage): craters and other lasting changes are made
   *  only then; everyone gets the event for effects (startled animals, sounds). H.physics.explode and H.sync.explode
   *  call this themselves (once per explosion per player); a module that shows an explosion without either calls it. */
  function announce(d) {
    const p = vec(d.position || d.at);
    const ev = { ...d, position: p, radius: Number(d.radius) || 4.5, force: Number(d.force ?? 14), damage: Number(d.damage) || 0, authoritative: d.authoritative !== false };
    delete ev.at;
    fire('explosion', ev);
    if (H.game) try { H.game.emit('explosion', ev); } catch (err) { H.report(err, 'explosion'); }
    return ev;
  }
  /** An explosion's push: every dynamic thing within `radius` is thrown away from `at` (stronger closer), things with
   *  health are hurt by `damage` (less farther). Returns what it touched. Online, run it from a sync action
   *  (H.sync.action) so the host decides once for everyone (H.sync.explode does). It announces the explosion (the
   *  'explosion' event, authoritative) unless o.event is false (a second call for the same blast: damage only); o.info
   *  adds fields to the event. */
  function explode(at, o = {}) {
    const hit = blast(at, o);
    if (o.event !== false) announce({ ...(o.info || {}), position: vec(at), radius: Number(o.radius) || 4.5, force: o.force ?? 14, damage: o.damage || (o.info && o.info.damage) || 0, authoritative: o.authoritative !== false });
    return hit;
  }
  function blast(at, o) {
    const p = vec(at);
    const R = Number(o.radius) || 4.5, force = o.force ?? 14, up = o.up ?? 0.6;
    const hit = [];
    for (const e of overlap(shapes.sphere(R), p, { all: false })) {
      if (!e.alive || e.kind === 'light') continue;
      const d = Math.hypot(e.x - p[0], e.y - p[1], e.z - p[2]);
      const k = Math.max(0, 1 - d / R);
      if (e.physics === 'dynamic' && !e.isPlayer) {
        if (e.remote && force > 0 && o.owner !== undefined) for (const f of H.hooks.push) f(e, o.owner);
        const dir = new B.Vector3(e.x - p[0], e.y - p[1] + up, e.z - p[2]).normalize();
        // A real impulse (heavier things fly less), a little off center so things tumble.
        const j = [dir.x * force * k * e.mass, dir.y * force * 0.7 * k * e.mass, dir.z * force * k * e.mass];
        e.impulse(j, havokOn() ? [e.x - dir.x * 0.15 * e.half[0], e.y + e.half[1] * 0.3, e.z - dir.z * 0.15 * e.half[2]] : undefined);
      } else if (e.isPlayer && e === (W() && W().player) && o.push !== false) {
        const dir = new B.Vector3(e.x - p[0], e.y - p[1] + up, e.z - p[2]).normalize();
        e.push([dir.x * force * 0.6 * k, dir.y * force * 0.5 * k, dir.z * force * 0.6 * k]);
      }
      if (o.damage && H.game && (e.hp !== undefined || e.isPlayer)) H.game.damage(e, o.damage * k, o.owner || null);
      hit.push(e);
    }
    return hit;
  }

  /** Changes a thing's collider (a shape from H.physics.shapes, or 'box' | 'sphere' | 'capsule' | 'cylinder' |
   *  'convex' | 'mesh' | 'auto'). It is remade at the next step. */
  function setShape(e, shape) { e._shapeSpec = shape; return e; }

  /** A character controller on any entity (creatures, AI friends): walks over slopes and steps, rides moving things,
   *  pushes loose things. Each step, move() with the velocity you want (gravity is added; y only for jumps). */
  function character(e, o = {}) {
    if (!e || !e.__entity) throw new Error('H.physics.character(entity, options)');
    e.upright = true;
    if (e.physics !== 'dynamic') e.physics = 'dynamic';
    if (havokOn()) { dropBody(e); e._cc = { opts: { maxSlope: 50, stepHeight: 0.45, ...o } }; }
    return {
      entity: e,
      move(v) { const p = vec(v); e._v[0] = p[0]; e._v[2] = p[2]; if (p[1]) e._v[1] = p[1]; e._walked = true; e.wake(); },
      jump(speed = 7) { return e.jump(speed); },
      teleport(p) { e.position = p; e.velocity = [0, 0, 0]; },
      get grounded() { return e.grounded; },
      get standing() { return e.standing; },
      get normal() { return [0, 1, 0]; },
      remove() { e._cc = null; },
    };
  }

  H.physics = {
    engine: 'legacy',
    get ready() { return H.ready; },
    get gravity() { return W() ? W().config.gravity ?? -24 : -24; },
    set gravity(v) { if (W()) W().config.gravity = Number(v); },
    layer, layers: LAYERS, maskOf,
    shapes, setShape,
    raycast, shapeCast, overlap,
    explode, announce, joint, character,
    rebase,
    on,
    beforeStep: (fn) => on('before', fn),
    afterStep: (fn) => on('after', fn),
    /** The Havok body behind an entity (Babylon's PhysicsBody), for what this API doesn't cover. */
    bodyOf: (e) => (e && e._pb ? e._pb.body : null),
    _fire: fire,
  };
})();
