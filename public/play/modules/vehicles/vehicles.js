// Vehicles, part 2: the kinds (car, truck, bicycle, motorbike, boat, submarine, airplane, helicopter and the general
// 'vehicle'), and how they move.
//
// How a vehicle moves: the vehicles module simulates it as a rigid body (mass, inertia, velocity and spin) with
// raycast wheels (springs and dampers, tire grip that lets go when you push it: drifting), buoyancy where there is
// water, wings that lift and stall, a rotor that hovers. To the engine's physics a vehicle is a kinematic body: solid
// to everything else, moved only by this file, so it behaves the same on the first box physics and on Havok. Crashing
// into loose things throws them (real impulses, mass against mass); walls stop it; explosions throw it and hurt it.
//
// Who simulates it online: the driver (they feel no lag), or the host when nobody drives. Its pose, seats, lights and
// horn go to everyone through H.sync; seats are taken in the room's one order, so two people can't take one seat.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const V = H.vehicles;
  const RAD = Math.PI / 180;
  const W = () => H.world;
  const UP = new B.Vector3(0, 1, 0);
  const ZERO_INPUT = Object.freeze({ x: 0, y: 0, up: false, down: false, boost: false, brake: false });

  // ------------------------------------------------------------------ small vector helpers
  const v3 = (a) => (a instanceof B.Vector3 ? a.clone() : Array.isArray(a) ? new B.Vector3(+a[0] || 0, +a[1] || 0, +a[2] || 0) : a && typeof a === 'object' ? new B.Vector3(+a.x || 0, +a.y || 0, +a.z || 0) : new B.Vector3(0, 0, 0));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const r2 = (n) => Math.round(n * 100) / 100;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const r4 = (n) => Math.round(n * 10000) / 10000;
  const gravity = () => { const g = W() && W().config ? Number(W().config.gravity ?? -24) : -24; return isFinite(g) ? g : -24; };

  // ------------------------------------------------------------------ the world's vehicles
  const list = () => { const w = W(); if (!w) return []; if (!w.vehicles) w.vehicles = new Set(); return [...w.vehicles].filter((e) => e.alive); };
  const myId = () => (H.sync && H.sync.online && H.sync.me ? H.sync.me : 'local');
  const isMe = (who) => who === 'local' || (who && H.sync && who === H.sync.me);

  const havokOn = () => H.physics.engine === 'havok' && Boolean(W() && W().havok);
  /** Its pose travels with the engine's own sync (a scene thing with a real body), or with ours. */
  const engineSynced = (v) => Boolean(v.e.sceneId) && v.e.physics === 'dynamic';

  /** True when this player simulates the vehicle: the driver does (they take it over when they get in); with no driver
   *  (or an NPC at the wheel) the host. */
  function simulatedByMe(v) {
    if (!H.sync || !H.sync.online) return true;
    if (engineSynced(v)) return H.sync.mine(v.e);
    const d = v.seats[0] && v.seats[0].who;
    if (d && d !== 'npc') return isMe(d);
    return H.sync.isHost;
  }

  // ------------------------------------------------------------------ water: the Water module's, or things tagged "water"
  let waterCache = { at: -1, list: [], world: null };
  function waterThings() {
    const w = W();
    if (!w) return [];
    if (waterCache.world !== w || w.time - waterCache.at > 1) {
      waterCache = { at: w.time, world: w, list: [...w.entities].filter((e) => e.alive && isWaterThing(e)) };
    }
    return waterCache.list;
  }
  const isWaterThing = (e) => e.tag === 'water' || e.kind === 'water' || Boolean(e.data && e.data.water);
  /** The water's surface height at (x, z), or null where there is none. */
  function waterLevel(x, z) {
    if (H.water && typeof H.water.surfaceAt === 'function') {
      try { const s = H.water.surfaceAt(x, z); if (s !== null && s !== undefined && isFinite(s)) return Number(s); } catch (err) { H.report(err, 'vehicles water'); }
    }
    let best = null;
    for (const e of waterThings()) {
      if (!e.alive) continue;
      const b = e.box();
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) best = best === null ? b.max[1] : Math.max(best, b.max[1]);
    }
    return best;
  }

  // ------------------------------------------------------------------ rays: what the wheels and the hull touch
  const ray = new B.Ray(B.Vector3.Zero(), new B.Vector3(0, -1, 0), 1);
  function makePredicate(v) {
    return (m) => {
      if (!m.isEnabled() || m.isPickable === false || (m.metadata && m.metadata.decor)) return false;
      const en = H.entityOf(m);
      if (!en || !en.alive || en === v.e || en.isPlayer || en.remotePlayer || en.ghost || en._vehRider) return false;
      const ph = en.physics;
      if (ph === 'none' || ph === 'trigger') return false;
      if (ph === 'dynamic' && en.mass < v.mass * 0.3) return false; // light loose things are thrown, not driven on
      if (isWaterThing(en)) return false;
      return true;
    };
  }
  /** The first solid thing along a ray (and the terrain, when the Terrain module is on): { dist, point, normal, entity }. */
  function cast(v, from, dir, len) {
    const w = W();
    ray.origin.copyFrom(from); ray.direction.copyFrom(dir); ray.length = len;
    let out = null;
    const hit = w.scene.pickWithRay(ray, v.pred);
    if (hit && hit.hit && hit.pickedPoint) {
      const n = hit.getNormal(true, true) || UP.clone();
      out = { dist: hit.distance, point: hit.pickedPoint.clone(), normal: n, entity: H.entityOf(hit.pickedMesh) };
    }
    const T = H.terrain;
    if (T && typeof T.heightAt === 'function' && dir.y < -0.3) {
      let h = null;
      try { h = T.heightAt(from.x, from.z); } catch { h = null; }
      if (h !== null && h !== undefined && isFinite(h)) {
        let d = (from.y - h) / -dir.y;
        if (d < len && (!out || d < out.dist)) {
          d = Math.max(0, d);
          let n = null;
          try { n = T.normalAt ? T.normalAt(from.x, from.z) : null; } catch { n = null; }
          out = { dist: d, point: from.add(dir.scale(d)), normal: n ? v3(n).normalize() : UP.clone(), entity: null, terrain: true };
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ building a vehicle
  /** A vehicle type with the spec's tuning applied and scaled: shape.speed (top speed, m/s), shape.power (x engine),
   *  shape.grip (x grip), shape.mass (kg), shape.handling ('drift' slides more, 'grippy' less), scale (a number). */
  function tuned(type, sh, scale) {
    const base = V.types[type];
    const s = Number(scale) > 0 ? Number(scale) : 1;
    const S = (a) => a.map((x) => x * s);
    const d = { ...base, type };
    d.size = S(base.size);
    d.wheels = (base.wheels || []).map((w) => ({ ...w, at: S(w.at), r: w.r * s, w: w.w * s }));
    d.suspension = { ...(base.suspension || { travel: 0.3 }), travel: (base.suspension ? base.suspension.travel : 0.3) * s };
    d.seats = base.seats.map((x) => ({ ...x, at: S(x.at) }));
    d.eye = S(base.eye || [0, 1, 0]);
    d.contacts = base.contacts ? base.contacts.map(S) : null;
    d.collider = (base.collider || [{ size: base.size, at: [0, 0, 0] }]).map((c) => ({ size: S(c.size), at: S(c.at) }));
    d.cam = { ...base.cam, distance: base.cam.distance * Math.max(1, s * 0.8), height: base.cam.height * Math.max(1, s * 0.8) };
    d.engine = { ...base.engine };
    if (Number(sh.speed) > 0) d.engine.top = Number(sh.speed);
    if (Number(sh.power) > 0) d.engine.accel = base.engine.accel * Number(sh.power);
    d.grip = base.grip * (Number(sh.grip) > 0 ? Number(sh.grip) : 1);
    if (sh.handling === 'drift') { d.drift = (base.drift || 0.5) * 0.6; d.grip *= 0.9; }
    if (sh.handling === 'grippy') { d.drift = Math.min(1, (base.drift || 0.5) * 1.8); d.grip *= 1.2; }
    d.mass = Number(sh.mass) > 0 ? Number(sh.mass) : base.mass * s * s * s;
    d.health = Number(sh.health) > 0 ? Number(sh.health) : 100;
    d.scale = s;
    return d;
  }

  function buildVehicle(type, sh, o, spec, kindName = type) {
    const w = W();
    const scene = w.scene;
    const def = tuned(type, sh || {}, typeof o.scale === 'number' ? o.scale : sh && sh.scale);
    const root = new B.TransformNode(type, scene);
    // A real body on Havok (dynamic: it crashes, tumbles and is thrown like anything else, its wheels and engine
    // driving it); on the first physics a kinematic one this file moves itself.
    const phys = o.physics === 'static' || o.physics === 'none' ? o.physics : havokOn() ? 'dynamic' : 'kinematic';
    const e = new L.Entity(root, { ...o, physics: phys, mass: def.mass, scale: undefined }, kindName);
    const color = o.color || (spec && spec.material && spec.material.color) || def.color;
    const mats = V.materials(scene, color);
    e._mat = mats.paint;
    const body = new B.TransformNode('veh-body', scene);
    body.parent = root;
    body.scaling.setAll(def.scale);
    const ctx = V.bodyCtx(scene, body, mats);
    if (def.body) def.body(ctx);
    // Wheels: a steering pivot at each mount, a spinner inside it, the tire and hub inside that.
    const wheels = def.wheels.map((wd) => {
      const steer = new B.TransformNode('veh-wheel', scene);
      steer.parent = root;
      steer.position.set(wd.at[0], wd.at[1], wd.at[2]);
      const spin = new B.TransformNode('veh-spin', scene);
      spin.parent = steer;
      const tire = B.MeshBuilder.CreateCylinder('veh-tire', { diameter: wd.r * 2, height: wd.w, tessellation: 20 }, scene);
      tire.material = mats.dark; tire.rotation.z = Math.PI / 2; tire.parent = spin; tire.receiveShadows = true;
      const hub = B.MeshBuilder.CreateBox('veh-hub', { width: wd.w * 1.05, height: wd.r * 1.1, depth: wd.r * 0.28 }, scene);
      hub.material = mats.metal; hub.parent = spin; hub.metadata = { decor: true }; hub.isPickable = false;
      return { ...wd, steerNode: steer, spinNode: spin, tire, hub, comp: 0, contact: false, hitDist: def.suspension.travel + wd.r, spin: 0, spinRate: 0 };
    });
    // Lamps: headlights and taillights (they glow; L turns real light on).
    const lampMeshes = [];
    if (def.lamps) {
      const lp = def.lamps, xs = lp.x ? [-lp.x, lp.x] : [0];
      for (const x of xs) {
        const hl = ctx.part('box', [0.32, 0.16, 0.06], 'head', [x, lp.y, lp.front], [0, 0, 0], { decor: true });
        const tl = ctx.part('box', [0.3, 0.12, 0.06], 'tail', [x, lp.y, lp.back], [0, 0, 0], { decor: true });
        lampMeshes.push(hl, tl);
      }
    }
    // Spinning things: a propeller, rotors.
    const spinners = [];
    const blades = (at, len, axis, decorParent = body) => {
      const hubN = new B.TransformNode('veh-rotor', scene);
      hubN.parent = decorParent;
      hubN.position.set(at[0], at[1], at[2]);
      const a = ctx.part('box', axis === 'y' ? [len, 0.05, 0.28] : axis === 'z' ? [len, 0.18, 0.05] : [0.05, len, 0.18], 'dark', [0, 0, 0], [0, 0, 0], { decor: true, parent: hubN });
      const b = ctx.part('box', axis === 'y' ? [0.28, 0.05, len] : axis === 'z' ? [0.18, len, 0.05] : [0.05, 0.18, len], 'dark', [0, 0, 0], [0, 0, 0], { decor: true, parent: hubN });
      void a; void b;
      spinners.push({ node: hubN, axis });
      return hubN;
    };
    if (type === 'helicopter') { blades([0, 1.35, 0], 7.6, 'y'); blades([0.12, 0.85, -5.05], 1.4, 'x'); }
    if (type === 'airplane') blades([0, 0, 3.8], 2.2, 'z');
    if (type === 'submarine') blades([0, 0, -4.15], 1.3, 'z');

    const v = {
      type, def, e, root, body, mats, wheels, lampMeshes, spinners, parts: ctx.made,
      mass: def.mass,
      vel: new B.Vector3(0, 0, 0), w: new B.Vector3(0, 0, 0),
      q: B.Quaternion.FromEulerAngles(root.rotation.x, root.rotation.y, root.rotation.z),
      euler: null, posW: null,
      input: { ...ZERO_INPUT }, steer: 0, throttle: 0, collective: 0, spool: 0, ballast: def.class === 'sub' ? 1 : 0,
      boostFuel: 1, boosting: false, health: def.health, wrecked: false, lights: Boolean(def.lightsOn), horn: false,
      seats: def.seats.map((s, i) => ({ ...s, i, who: null, entity: null })),
      autopilot: (spec && spec.data && spec.data.autopilot) || (o.data && o.data.autopilot) || null,
      sleeping: false, still: 0, airTime: 0, flipT: 0, grounded: false, submerged: 0, stalled: false, aoa: 0,
      key: null, net: null, seatEvents: false, lastCrash: 0, light: null, smoke: null,
    };
    v.pred = makePredicate(v);
    e.vehicle = v;
    e.handlers.enter = [];
    e.handlers.exit = [];
    vehicleApi(e, v);
    if (o.lenient === undefined) o = { ...o, lenient: true };
    // The placement the engine does for every kind; a script that gives no height gets it on the floor.
    const at = o.position ? L.vec(o.position) : [Number(o.x) || 0, o.y === undefined ? V.restHeight(def) : Number(o.y) || 0, Number(o.z) || 0];
    L.place(e, { ...o, position: at, scale: undefined });
    v.q = B.Quaternion.FromEulerAngles(root.rotation.x, root.rotation.y, root.rotation.z);
    v.euler = root.rotation.clone();
    v.posW = root.position.clone();
    for (const p of [...ctx.made, ...wheels.map((x) => x.tire)]) p.metadata = p.metadata && p.metadata.decor ? p.metadata : { entity: e };
    // Its collider: the body (wheels are rays, not colliders), as boxes.
    const parts = def.collider.map((c) => ({ shape: { type: 'box', size: c.size }, position: c.at }));
    H.physics.setShape(e, parts.length === 1 && !parts[0].position.some(Boolean) ? parts[0].shape : H.physics.shapes.compound(parts));
    if (sh && (sh.model || sh.asset)) wearModel(v, String(sh.model || sh.asset), sh, o);
    const w2 = W();
    if (!w2.vehicles) w2.vehicles = new Set();
    w2.vehicles.add(e);
    w2.vehicleCount = (w2.vehicleCount || 0) + 1;
    v.key = e.sceneId ? null : (o.name ? `n:${o.name}:${[...w2.vehicles].filter((x) => x.name === o.name).length}` : `i:${w2.vehicleCount}`);
    // Its key settles once the engine gives it its scene id (fromSpec sets it right after build).
    Promise.resolve().then(() => { if (e.alive && e.sceneId) v.key = `s:${e.sceneId}`; register(v); });
    e.onDestroy(() => unregister(v));
    return e;
  }

  /** A model as the body (an asset by name): fitted to the vehicle's length, sitting on its wheels. Its own wheels (nodes
   *  named wheel/tire/tyre) spin; otherwise the stand-in wheels hide unless shape.showWheels. */
  function wearModel(v, name, sh, o) {
    const e = v.e, scene = W().scene, world = W();
    let url;
    try { url = L.assetUrl(name); } catch (err) { if (!o.lenient) throw err; e._waiting = name; return; }
    e._loaded = false;
    e.ready = B.SceneLoader.ImportMeshAsync('', '', url, scene, null, '.glb').then((r) => {
      if (!e.alive || world !== W()) { for (const m of r.meshes) m.dispose(); return e; }
      const holder = new B.TransformNode('veh-model', scene);
      for (const m of r.meshes) if (!m.parent) m.parent = holder;
      for (const t of r.transformNodes) if (!t.parent) t.parent = holder;
      holder.rotation.y = (Number(sh.modelYaw) || 0) * RAD;
      holder.computeWorldMatrix(true);
      let { min, max } = holder.getHierarchyBoundingVectors(true);
      const len = Math.max(1e-3, Math.max(max.z - min.z, max.x - min.x));
      const want = Number(sh.modelLength) > 0 ? Number(sh.modelLength) : v.def.size[2] * 1.02;
      holder.scaling.setAll(want / len);
      holder.computeWorldMatrix(true);
      ({ min, max } = holder.getHierarchyBoundingVectors(true));
      const bottom = -V.restHeight(v.def);
      holder.position.set(-(min.x + max.x) / 2, bottom - min.y + (Number(sh.modelLift) || 0), -(min.z + max.z) / 2);
      holder.parent = v.root;
      const wheelNodes = [...r.transformNodes, ...r.meshes].filter((n) => /wheel|tire|tyre/i.test(n.name));
      v.modelWheels = wheelNodes;
      for (const p of v.parts) p.setEnabled(false);
      for (const p of v.lampMeshes) p.setEnabled(true);
      if (wheelNodes.length || !sh.showWheels) for (const w of v.wheels) w.steerNode.setEnabled(false);
      if (W().shadows) for (const m of r.meshes) if (m.getTotalVertices() > 0) { W().shadows.addShadowCaster(m); m.receiveShadows = true; }
      for (const m of r.meshes) m.metadata = { entity: e };
      if (sh.color || o.color) for (const m of r.meshes) if (m.material && m.material.albedoColor && sh.tint) m.material.albedoColor = L.hex(o.color);
      e._loaded = true;
      e.measure();
      return e;
    }).catch((err) => { e._loaded = true; H.report(new Error(`Could not load ${name}: ${err.message || err}`)); return e; });
  }

  // ------------------------------------------------------------------ what scripts can do with a vehicle entity
  function vehicleApi(e, v) {
    Object.defineProperties(e, {
      velocity: { get: () => [v.vel.x, v.vel.y, v.vel.z], set: (x) => { const p = L.vec(x); v.vel.set(p[0], p[1], p[2]); if (havokOn()) { e.vx = p[0]; e.vy = p[1]; e.vz = p[2]; e._wakeBody = true; e.sleeping = false; } wake(v); }, configurable: true },
      speed: { get: () => v.vel.length(), configurable: true },
      driver: { get: () => seatHolder(v.seats[0]), configurable: true },
      riders: { get: () => v.seats.map(seatHolder).filter(Boolean), configurable: true },
      health: { get: () => v.health, set: (x) => { v.health = clamp(Number(x) || 0, 0, v.def.health); if (v.health <= 0) wreck(v); }, configurable: true },
      lights: { get: () => v.lights, set: (x) => setLights(v, Boolean(x)), configurable: true },
      wrecked: { get: () => v.wrecked, configurable: true },
      autopilot: { get: () => v.autopilot, set: (x) => { v.autopilot = x || null; wake(v); }, configurable: true },
    });
    // Kicks land in the vehicle's own step (on Havok after it reads the body, so nothing is lost).
    const kick = (J, r) => { (v.pending || (v.pending = [])).push([J, r]); wake(v); if (havokOn()) { e.sleeping = false; e._wakeBody = true; } else { applyPending(v); } };
    e.push = (x) => { const p = v3(x); kick(p.scale(v.mass), B.Vector3.Zero()); return e; };
    e.impulse = (x, at) => { kick(v3(x), at ? v3(at).subtract(e.node.position) : B.Vector3.Zero()); return e; };
    e.force = (x) => { const p = L.vec(x); (v.extForce || (v.extForce = new B.Vector3())).addInPlaceFromFloats(p[0], p[1], p[2]); wake(v); return e; };
    e.enter = (o) => V.enter(e, o);
    e.exit = () => V.exit();
    e.honk = (seconds = 0.6) => { v.horn = true; v.hornUntil = (W() ? W().time : 0) + seconds; return e; };
    e.flip = () => { flipUpright(v); return e; };
    e.repair = () => { repair(v); return e; };
    e.drive = (input) => { V.drive(e, input); return e; };
  }
  function seatHolder(s) {
    if (!s || !s.who) return null;
    if (s.who === 'npc') return s.entity;
    if (isMe(s.who)) return W() && W().player;
    const pl = H.game && H.game.net.players.find((p) => p.id === s.who);
    return pl ? pl.entity || { id: s.who, name: pl.name } : { id: s.who };
  }

  // ------------------------------------------------------------------ the rigid body
  const tmpM = new B.Matrix();
  function axes(v) {
    B.Matrix.FromQuaternionToRef(v.q, tmpM);
    v.M = tmpM.clone();
    v.right = B.Vector3.TransformNormal(B.Axis.X, v.M);
    v.up = B.Vector3.TransformNormal(B.Axis.Y, v.M);
    v.fwd = B.Vector3.TransformNormal(B.Axis.Z, v.M);
  }
  const toWorld = (v, local) => B.Vector3.TransformNormal(Array.isArray(local) ? new B.Vector3(local[0], local[1], local[2]) : local, v.M).addInPlace(v.pos);
  /** Inertia (a box, a little heavier than its size, so it handles calmly), as the inverse in the vehicle's frame. */
  function invInertia(v) {
    const [w, h, l] = v.def.size, m = v.mass * 1.4;
    return new B.Vector3(12 / (m * (h * h + l * l)), 12 / (m * (w * w + l * l)), 12 / (m * (w * w + h * h)));
  }
  /** I⁻¹·x in world space. */
  function iinv(v, x) {
    const inv = v.Iinv || (v.Iinv = invInertia(v));
    const lx = B.Vector3.Dot(x, v.right) * inv.x, ly = B.Vector3.Dot(x, v.up) * inv.y, lz = B.Vector3.Dot(x, v.fwd) * inv.z;
    return v.right.scale(lx).addInPlace(v.up.scale(ly)).addInPlace(v.fwd.scale(lz));
  }
  function applyPending(v) {
    const list = v.pending;
    v.pending = null;
    if (list) for (const [J, r] of list) applyImpulse(v, J, r);
  }
  function applyImpulse(v, J, r) {
    if (!v.M) { v.pos = v.e.node.position.clone(); axes(v); }
    v.vel.addInPlace(J.scale(1 / v.mass));
    v.w.addInPlace(iinv(v, B.Vector3.Cross(r, J)));
  }
  function addForceAt(v, f, point) {
    v.F.addInPlace(f);
    v.T.addInPlace(B.Vector3.Cross(point.subtract(v.com), f));
  }
  /** Velocity of a point on the body (world). */
  const pointVel = (v, p) => v.vel.add(B.Vector3.Cross(v.w, p.subtract(v.com)));
  /** Steers the spin toward a rate (radians a second) around a world axis, firmly (k per second). */
  function steerRate(v, axis, rate, k, dt) {
    const cur = B.Vector3.Dot(v.w, axis);
    v.w.addInPlace(axis.scale((rate - cur) * Math.min(1, k * dt)));
  }

  function wake(v) { v.sleeping = false; v.still = 0; }

  /** The pose as the node has it now (someone may have moved it: the editor, a script, an edit from a friend). */
  function readPose(v) {
    const n = v.e.node;
    if (!v.euler || Math.abs(n.rotation.x - v.euler.x) > 1e-5 || Math.abs(n.rotation.y - v.euler.y) > 1e-5 || Math.abs(n.rotation.z - v.euler.z) > 1e-5) {
      v.q = B.Quaternion.FromEulerAngles(n.rotation.x, n.rotation.y, n.rotation.z);
      if (v.euler) { v.w.setAll(0); wake(v); }
    }
    if (v.posW && B.Vector3.DistanceSquared(v.posW, n.position) > 1e-8) { wake(v); if (B.Vector3.DistanceSquared(v.posW, n.position) > 0.25) { v.vel.setAll(0); v.w.setAll(0); } }
    v.pos = n.position.clone();
    // Pushes and kicks from elsewhere (behaviors, the old physics) land in vx/vy/vz: they join the velocity.
    const e = v.e;
    if (e.vx || e.vy || e.vz) { v.vel.addInPlaceFromFloats(e.vx, e.vy, e.vz); e.vx = 0; e.vy = 0; e.vz = 0; wake(v); }
  }
  function writePose(v) {
    const n = v.e.node;
    n.position.copyFrom(v.pos);
    const eul = v.q.toEulerAngles();
    n.rotation.copyFrom(eul);
    v.euler = eul.clone();
    v.posW = v.pos.clone();
    if (havokOn() && v.e.physics === 'dynamic') { v.e.vx = v.vel.x; v.e.vy = v.vel.y; v.e.vz = v.vel.z; v.e.angularVelocity = [v.w.x / RAD, v.w.y / RAD, v.w.z / RAD]; v.e.sleeping = false; v.e._wakeBody = true; }
    else v.e.measure();
  }

  // ------------------------------------------------------------------ input: the driver's, an autopilot's, or nothing
  function inputOf(v) {
    if (v.wrecked) return ZERO_INPUT;
    if (v.seats[0].who && v.seats[0].who !== 'npc') return v.input;
    const a = v.autopilot;
    if (!a) return v.seats[0].who === 'npc' ? v.input : ZERO_INPUT;
    const fwdSpeed = B.Vector3.Dot(v.vel, v.fwd || B.Axis.Z);
    let y = Number(a.throttle) || 0;
    if (a.speed !== undefined) y = clamp((Number(a.speed) - fwdSpeed) * 0.35, -1, 1);
    let up = Boolean(a.up), down = Boolean(a.down);
    if (a.hover !== undefined && v.def.class === 'heli') { const hNow = heightAboveGround(v); up = hNow < Number(a.hover) - 0.3; down = hNow > Number(a.hover) + 0.3; }
    return { x: clamp(Number(a.steer) || 0, -1, 1), y, up, down, boost: Boolean(a.boost), brake: Boolean(a.brake) };
  }
  function heightAboveGround(v) {
    const hit = cast(v, v.e.node.position, new B.Vector3(0, -1, 0), 200);
    return hit ? hit.dist : 200;
  }

  // ------------------------------------------------------------------ one step of one vehicle
  function simulate(v, dt) {
    const e = v.e;
    if (e.held || e.physics === 'static' || e.physics === 'none') { v.vel.setAll(0); v.w.setAll(0); if (e.physics !== 'dynamic') { e.vx = e.vy = e.vz = 0; } v.euler = null; return; }
    if (havokOn() && e.physics === 'dynamic') simulateHavok(v, dt);
    else simulateOwn(v, dt);
  }

  /** The forces of one step (wheels, water, wings, rotor, engine, controls) into v.F and v.T, and spin steering into
   *  v.w. Gravity only when this file integrates (Havok adds its own). Returns the wheels on the ground. */
  function forces(v, dt, withGravity) {
    const D = v.def;
    const g = gravity();
    axes(v);
    v.Iinv = v.Iinv || invInertia(v);
    v.com = v.pos.add(v.up.scale(D.class === 'wheeled' ? -D.size[1] * 0.35 : 0));
    v.F = new B.Vector3(0, withGravity ? v.mass * g : 0, 0);
    v.T = new B.Vector3(0, 0, 0);
    if (v.extForce) { v.F.addInPlace(v.extForce); v.extForce = null; }
    const inp = inputOf(v);
    v.cur = inp;
    // Boost: a tank that empties while you hold it and fills back up.
    v.boosting = Boolean(inp.boost) && v.boostFuel > 0.02 && !v.wrecked;
    v.boostFuel = clamp(v.boostFuel + (v.boosting ? -0.32 : 0.14) * dt, 0, 1);
    if (v.horn && v.hornUntil && W().time > v.hornUntil) { v.horn = false; v.hornUntil = 0; }
    // Wheels (cars, trucks, bikes, the airplane's landing gear).
    let contacts = 0;
    if (v.wheels.length) contacts = wheelForces(v, inp, dt, g);
    v.grounded = contacts > 0;
    if (!v.wheels.length) v.grounded = Boolean(cast(v, v.pos, new B.Vector3(0, -1, 0), V.restHeight(D) + 0.25));
    // Water: things float (boats well, cars a little), water slows everything in it. The Water module floats real
    // bodies (waterBuoyancy, before this); otherwise ours.
    if (!v.waterDone) buoyancy(v, dt, g);
    else waterSettle(v, dt);
    v.waterDone = false;
    // What each class does with its input.
    if (D.class === 'wheeled') wheeledControl(v, inp, dt, contacts);
    else if (D.class === 'boat') boatControl(v, inp, dt);
    else if (D.class === 'sub') subControl(v, inp, dt, g);
    else if (D.class === 'plane') planeControl(v, inp, dt, g, contacts);
    else if (D.class === 'heli') heliControl(v, inp, dt, g);
    // A little air drag.
    const sp = v.vel.length();
    if (sp > 0.01) v.F.addInPlace(v.vel.scale(-v.mass * 0.0012 * sp));
    return contacts;
  }
  function integrate(v, dt, damping) {
    v.vel.addInPlace(v.F.scale(dt / v.mass));
    v.w.addInPlace(iinv(v, v.T).scale(dt));
    v.w.scaleInPlace(Math.max(0, 1 - dt * damping));
    if (v.w.length() > 12) v.w.normalize().scaleInPlace(12);
    if (v.vel.length() > 160) v.vel.normalize().scaleInPlace(160);
  }
  /** Upside down and stuck: it rights itself after a moment (R does it at once). */
  function selfRight(v, dt) {
    if (!(v.seats.some((s) => s.who) || v.autopilot)) return;
    if (v.up.y < 0.25 && v.vel.length() < 2 && !(v.def.class === 'sub' && v.submerged > 0.5)) { v.flipT += dt; if (v.flipT > 2.5) flipUpright(v); } else v.flipT = 0;
  }
  const occupiedOf = (v) => v.seats.some((s) => s.who);

  /** On Havok: read the body, work out the step's forces, give the body its new velocity and spin. Havok moves it and
   *  does every collision (walls, ramps, crates, other vehicles, explosions). */
  function simulateHavok(v, dt) {
    const e = v.e, n = e.node;
    const busy = occupiedOf(v) || v.autopilot || v.pending || v.extForce;
    if (v.sleeping) {
      if (busy || !e.sleeping) wake(v);
      else return;
    }
    v.pos = n.position.clone();
    v.q = B.Quaternion.FromEulerAngles(n.rotation.x, n.rotation.y, n.rotation.z);
    v.vel.set(e._v[0], e._v[1], e._v[2]);
    // A sudden change from what it was given last step is a crash (a wall, a hard landing, something hitting it).
    if (v.gave && !v.sleeping) { const dv = v.vel.subtract(v.gave).length(); if (dv > 7) crash(v, dv, null, null); }
    const av = e.angularVelocity;
    v.w.set(av[0] * RAD, av[1] * RAD, av[2] * RAD);
    v.M = null;
    axes(v);
    waterBuoyancy(v);
    applyPending(v);
    forces(v, dt, false);
    integrate(v, dt, v.grounded ? 0.5 : 0.1);
    selfRight(v, dt);
    // Parked and still: the body sleeps (and wakes when something hits it).
    const still = !busy && v.vel.length() < 0.08 && v.w.length() < 0.08 && v.grounded;
    v.still = still ? v.still + dt : 0;
    if (v.still > 0.6) { v.sleeping = true; v.gave = null; v.vel.setAll(0); v.w.setAll(0); e.vx = 0; e.vy = 0; e.vz = 0; e.angularVelocity = [0, 0, 0]; e.sleep(); return; }
    e.vx = v.vel.x; e.vy = v.vel.y; e.vz = v.vel.z;
    e.angularVelocity = [v.w.x / RAD, v.w.y / RAD, v.w.z / RAD];
    v.gave = v.vel.clone();
    v.euler = null;
  }

  /** Without Havok: this file integrates the body itself and does its own collisions (kinematic to the engine). */
  function simulateOwn(v, dt) {
    const e = v.e;
    readPose(v);
    if (v.sleeping) {
      if (occupiedOf(v) || v.autopilot || v.extForce || v.pending) wake(v);
      else if ((v.sleepProbe = (v.sleepProbe || 0) + dt) > 0.5) {
        v.sleepProbe = 0;
        if (!cast(v, v.pos, new B.Vector3(0, -1, 0), V.restHeight(v.def) + 0.4)) wake(v);
      }
      if (v.sleeping) return;
    }
    axes(v);
    applyPending(v);
    forces(v, dt, true);
    integrate(v, dt, v.grounded ? 0.8 : 0.35);
    // Move, stopping at walls (and sliding along them).
    moveAgainstWalls(v, dt);
    // Turn.
    const wl = v.w.length();
    if (wl > 1e-6) { const dq = B.Quaternion.RotationAxis(v.w.scale(1 / wl), wl * dt); v.q = dq.multiply(v.q); v.q.normalize(); }
    axes(v);
    v.com = v.pos.add(v.up.scale(v.def.class === 'wheeled' ? -v.def.size[1] * 0.35 : 0));
    // The hull against the ground: landings, rolling over, scraping.
    const hullHit = hullContacts(v, dt);
    v.grounded = v.grounded || hullHit;
    // Loose things in the way are thrown; other vehicles bump.
    pushThings(v, dt);
    bumpVehicles(v, dt);
    selfRight(v, dt);
    // Fell out of the world: back where it started.
    if (v.pos.y < (W().catchY ?? -25)) { caughtVehicle(v); return; }
    const still = !occupiedOf(v) && !v.autopilot && v.vel.length() < 0.06 && v.w.length() < 0.06 && v.grounded;
    v.still = still ? v.still + dt : 0;
    if (v.still > 0.6) { v.sleeping = true; v.vel.setAll(0); v.w.setAll(0); }
    e.vx = e.vy = e.vz = 0;
    writePose(v);
  }

  // ------------------------------------------------------------------ wheels: springs, grip, engine, brakes
  function wheelForces(v, inp, dt, g) {
    const D = v.def, n = v.wheels.length, travel = D.suspension.travel, soft = D.suspension.soft || 1;
    const k = (v.mass * Math.abs(g)) / (n * 0.45 * travel) * soft;
    const c = 2 * 0.5 * Math.sqrt(k * v.mass / n);
    const down = v.up.scale(-1);
    const fwdSpeed = B.Vector3.Dot(v.vel, v.fwd);
    // Throttle, brakes, reverse.
    let throttle = 0, brake = 0;
    const plane = D.class === 'plane';
    if (!plane) {
      if (inp.y > 0.05) { if (fwdSpeed < -1) brake = inp.y; else throttle = inp.y; }
      else if (inp.y < -0.05) { if (fwdSpeed > 1) brake = -inp.y; else throttle = inp.y; }
    } else if (inp.y < -0.05 && fwdSpeed < 18 && fwdSpeed > 0.5) brake = 0.5;
    const handbrake = Boolean(inp.brake) && !D.hop;
    const boostK = v.boosting && throttle > 0 ? D.engine.boost : 1;
    const top = D.engine.top * boostK;
    let drive = 0;
    if (throttle > 0) drive = v.mass * D.engine.accel * throttle * (v.boosting ? 1.7 : 1) * Math.max(0, 1 - Math.pow(clamp(fwdSpeed / top, 0, 1), 2));
    else if (throttle < 0) drive = v.mass * D.engine.accel * 0.6 * throttle * Math.max(0, 1 - Math.pow(clamp(-fwdSpeed / Math.max(1, D.engine.reverse), 0, 1), 2));
    if (v.wrecked) drive = 0;
    const driven = v.wheels.filter((w) => w.drive).length || 1;
    // Steering: less lock the faster you go.
    const spd = Math.abs(fwdSpeed);
    const want = inp.x * D.steer * RAD / (1 + spd / (D.twoWheels ? 14 : 20));
    v.steer += (want - v.steer) * Math.min(1, dt * 8);
    const parking = throttle === 0 && brake === 0 && spd < 0.6 && (!plane || v.throttle < 0.05);
    let count = 0;
    v.loadSum = 0;
    for (const w of v.wheels) {
      const len = travel + w.r;
      const mount = toWorld(v, w.at);
      const hit = cast(v, mount, down, len);
      if (!hit) { w.contact = false; w.comp = 0; w.hitDist = len; w.spinRate += ((w.drive ? throttle * 30 : 0) - w.spinRate) * dt * 2; continue; }
      count++;
      const comp = len - hit.dist;
      const vComp = (comp - w.comp) / dt;
      w.comp = comp; w.contact = true; w.hitDist = hit.dist; w.ground = hit.entity;
      let fs = k * Math.min(comp, travel) + c * vComp;
      if (comp > travel) fs += k * 8 * (comp - travel) + c * Math.max(0, vComp);
      fs = clamp(fs, 0, v.mass * Math.abs(g) * 4);
      v.loadSum += fs;
      // The tire: which way it points (steered), along the ground.
      const N = hit.normal.y > 0.05 ? hit.normal : UP;
      const s = w.steer ? v.steer : 0;
      const f = v.fwd.scale(Math.cos(s)).addInPlace(v.right.scale(Math.sin(s)));
      const fg = f.subtract(N.scale(B.Vector3.Dot(f, N))).normalize();
      const sg = B.Vector3.Cross(N, fg).normalize();
      const vc = pointVel(v, hit.point);
      const vlong = B.Vector3.Dot(vc, fg), vlat = B.Vector3.Dot(vc, sg);
      const per = v.mass / n;
      const mu = D.grip * (handbrake && w.rear ? D.drift : 1);
      const maxF = mu * fs;
      let lat = -vlat * per / dt * 0.5;
      let lon = 0;
      if (w.drive) lon += drive / driven;
      if (brake > 0) lon += -Math.sign(vlong) * Math.min(Math.abs(vlong) * per / dt, v.mass * 30 * brake / n);
      if (handbrake && w.rear) lon = -vlong * per / dt * 0.3;
      else if (parking) lon = -vlong * per / dt * 0.6;
      else lon += -vlong * per * (plane ? 0.02 : throttle === 0 ? 0.5 : 0.08); // (a plane's wheels roll free)
      const mag = Math.hypot(lat, lon);
      if (mag > maxF && mag > 0) { lat *= maxF / mag; lon *= maxF / mag; }
      addForceAt(v, v.up.scale(fs).addInPlace(sg.scale(lat)).addInPlace(fg.scale(lon)), hit.point);
      w.slip = Math.abs(vlat) > 3 || (handbrake && w.rear && spd > 4);
      w.spinRate = vlong / w.r;
      // Light loose things under a wheel are kicked aside (heavy ones carry the weight).
      // What it stands on takes its weight (a plank, a seesaw, another vehicle's roof).
      const under = hit.entity;
      if (under && under.physics === 'dynamic' && !under.remote && havokOn() && under !== v.e) under.impulse([-v.up.x * fs * dt, -v.up.y * fs * dt, -v.up.z * fs * dt], [hit.point.x, hit.point.y, hit.point.z]);
    }
    v.throttleNow = throttle;
    return count;
  }

  /** Cars, trucks and bikes: air control, two wheels staying up, hopping, rolling over. */
  function wheeledControl(v, inp, dt, contacts) {
    const D = v.def;
    const sp = v.vel.length();
    if (contacts === 0) {
      v.airTime += dt;
      // In the air: W/S tip the nose, A/D turn: land your jumps.
      if (v.airTime > 0.15) { steerRate(v, v.right, inp.y * 2.4, 3, dt); steerRate(v, v.up, inp.x * 2.4, 3, dt); }
    } else v.airTime = 0;
    if (D.twoWheels) {
      // Two wheels stay up and lean into the turn.
      const phi = Math.asin(clamp(v.right.y, -1, 1));
      const target = -clamp(v.steer / (D.steer * RAD), -1, 1) * clamp(sp / 8, 0, 1) * 0.5;
      steerRate(v, v.fwd, (target - phi) * 8, 15, dt);
      const pitch = Math.asin(clamp(v.fwd.y, -1, 1));
      if (contacts === 0 && Math.abs(pitch) > 0.9) steerRate(v, v.right, Math.sign(pitch) * 2, 4, dt);
    } else if (contacts > 0) {
      // Four wheels: anti-roll, so it corners flat-ish (and doesn't trip over itself).
      const phi = Math.asin(clamp(v.right.y, -1, 1));
      steerRate(v, v.fwd, -phi * 3, 2, dt);
    }
    // Space on a bicycle hops.
    if (D.hop && inp.brake && contacts > 0 && !v.hopped) { v.vel.addInPlace(v.up.scale(D.hop)); v.hopped = true; }
    if (!inp.brake) v.hopped = false;
  }

  // ------------------------------------------------------------------ water
  function floatPoints(v) {
    if (v.floatPts) return v.floatPts;
    const [w, h, l] = v.def.size;
    const y = -h / 2;
    const pts = [[-w * 0.4, y, l * 0.4], [w * 0.4, y, l * 0.4], [-w * 0.4, y, -l * 0.4], [w * 0.4, y, -l * 0.4], [0, y, 0], [0, y + h * 0.5, 0]];
    v.floatPts = pts;
    return pts;
  }
  function buoyancy(v, dt, g) {
    const D = v.def;
    const pts = floatPoints(v);
    const h = D.size[1];
    let floatK = D.float || 0.55;
    if (D.class === 'sub') floatK = 1 + 0.35 * v.ballast;
    let sub = 0, any = false;
    for (const pt of pts) {
      const P = toWorld(v, pt);
      const s = waterLevel(P.x, P.z);
      if (s === null) continue;
      any = true;
      const depth = s - P.y;
      if (depth <= 0) continue;
      const frac = Math.min(1, depth / h);
      sub += frac / pts.length;
      addForceAt(v, new B.Vector3(0, v.mass * Math.abs(g) * floatK * frac / pts.length, 0), P);
      // Bobbing settles (up and down at each point: it also stops rocking).
      const vp = pointVel(v, P);
      addForceAt(v, new B.Vector3(0, -vp.y * v.mass * 2.2 * frac / pts.length, 0), P);
    }
    v.submerged = sub;
    v.nearWater = any;
    if (sub > 0.02) {
      // Water drag: hulls are made to slip through it, everything else wallows.
      v.F.addInPlace(v.vel.scale(-v.mass * (D.class === 'boat' ? 0.08 : D.class === 'sub' ? 0.25 : 0.8) * sub));
      // Water keeps a hull upright.
      const axis = B.Vector3.Cross(v.up, UP);
      v.w.addInPlace(axis.scale(Math.min(1, dt * 3 * sub * (D.class === 'boat' || D.class === 'sub' ? 3 : 1))));
      v.w.scaleInPlace(Math.max(0, 1 - dt * 1.5 * sub));
    }
  }

  /** The Water module's buoyancy (H.water.buoyancy, its waves and currents) for a real body: hull points, a density
   *  per vehicle (a boat floats high, a sub's ballast sets its own, a car sinks slowly). Returns true if it ran. */
  const DENSITY = { boat: 0.38, plane: 0.75, heli: 0.85, wheeled: 1.35 };
  function waterBuoyancy(v) {
    const Wm = H.water;
    if (!Wm || typeof Wm.buoyancy !== 'function' || v.e.physics !== 'dynamic') return false;
    const D = v.def;
    const lo = v.e._loff || [0, 0, 0];
    const points = floatPoints(v).slice(0, 4).map((p) => [p[0] - lo[0], p[1] - lo[1], p[2] - lo[2]]);
    const density = D.class === 'sub' ? 1 / (1 + 0.35 * v.ballast) : DENSITY[D.class] || 1;
    let r = null;
    try { r = Wm.buoyancy(v.e, { density, drag: D.class === 'boat' ? 0.22 : D.class === 'sub' ? 0.5 : 1.6, points, always: D.class === 'sub' }); } catch (err) { H.report(err, 'vehicles water'); }
    v.submerged = r ? r.submerged : 0;
    v.nearWater = Boolean(r);
    v.waterDone = Boolean(r); // (no water of the module's here: things tagged "water" still float it, ours)
    return true;
  }
  /** With the Water module floating it: the hull stays upright and stops rocking. */
  function waterSettle(v, dt) {
    const sub = v.submerged;
    if (sub <= 0.02) return;
    const keel = v.def.class === 'boat' || v.def.class === 'sub' ? 3 : 1;
    v.w.addInPlace(B.Vector3.Cross(v.up, UP).scale(Math.min(1, dt * 3 * sub * keel)));
    v.w.scaleInPlace(Math.max(0, 1 - dt * 1.5 * sub));
  }

  function boatControl(v, inp, dt) {
    const D = v.def;
    const stern = toWorld(v, [0, -D.size[1] / 2, -D.size[2] / 2]);
    const s = waterLevel(stern.x, stern.z);
    const prop = s !== null && stern.y < s + 0.25;
    const fwdFlat = new B.Vector3(v.fwd.x, 0, v.fwd.z).normalize();
    const fwdSpeed = B.Vector3.Dot(v.vel, fwdFlat);
    if (prop && v.submerged > 0.02 && !v.wrecked) {
      const top = D.engine.top * (v.boosting ? D.engine.boost : 1);
      let thrust = 0;
      if (inp.y > 0.05) thrust = inp.y * D.engine.accel * (v.boosting ? 1.6 : 1) * Math.max(0, 1 - Math.pow(clamp(fwdSpeed / top, 0, 1), 2));
      else if (inp.y < -0.05) thrust = inp.y * D.engine.accel * 0.5 * (fwdSpeed < -D.engine.reverse ? 0 : 1);
      v.F.addInPlace(fwdFlat.scale(v.mass * thrust));
      const turn = inp.x * D.engine.turn * clamp(Math.abs(fwdSpeed) / 6, 0.3, 1) * (fwdSpeed < -0.5 ? -1 : 1);
      steerRate(v, UP, turn, 3, dt);
      // Banking into the turn, the bow lifting with speed.
      steerRate(v, v.fwd, -turn * 0.25, 1.5, dt);
      const right = new B.Vector3(v.right.x, 0, v.right.z).normalize();
      const vlat = B.Vector3.Dot(v.vel, right);
      v.F.addInPlace(right.scale(-vlat * v.mass * 2.2 * Math.min(1, v.submerged * 3)));
      v.throttleNow = inp.y;
    } else v.throttleNow = 0;
  }

  function subControl(v, inp, dt, g) {
    const D = v.def;
    // Ballast: C (down) floods it and you dive, space blows it and you rise; let go deep and it holds its depth.
    if (inp.down) v.ballast = clamp(v.ballast - dt * 0.9, -1, 1);
    else if (inp.up) v.ballast = clamp(v.ballast + dt * 0.9, -1, 1);
    else if (v.ballast < 0 && v.submerged > 0.9) v.ballast = Math.min(0, v.ballast + dt * 0.9);
    const inWater = v.submerged > 0.3;
    if (inWater && !v.wrecked) {
      v.F.y -= v.vel.y * v.mass * 1.4 * v.submerged;
      const fwdSpeed = B.Vector3.Dot(v.vel, v.fwd);
      const top = D.engine.top * (v.boosting ? D.engine.boost : 1);
      let thrust = 0;
      if (inp.y > 0.05) thrust = inp.y * D.engine.accel * (v.boosting ? 1.5 : 1) * Math.max(0, 1 - Math.pow(clamp(fwdSpeed / top, 0, 1), 2));
      else if (inp.y < -0.05) thrust = inp.y * D.engine.accel * 0.6 * (fwdSpeed < -D.engine.reverse ? 0 : 1);
      v.F.addInPlace(v.fwd.scale(v.mass * thrust));
      steerRate(v, UP, inp.x * D.engine.turn * clamp(Math.abs(fwdSpeed) / 3, 0.35, 1), 2.5, dt);
      const vlat = B.Vector3.Dot(v.vel, v.right);
      v.F.addInPlace(v.right.scale(-vlat * v.mass * 2));
      // Level, nose following the climb or dive a little.
      const pitchNow = Math.asin(clamp(v.fwd.y, -1, 1));
      const pitchWant = clamp(v.vel.y * 0.06, -0.35, 0.35);
      steerRate(v, v.right, -(pitchWant - pitchNow) * 2, 2, dt);
      const roll = Math.asin(clamp(v.right.y, -1, 1));
      steerRate(v, v.fwd, -roll * 3, 3, dt);
      v.throttleNow = inp.y;
    } else v.throttleNow = 0;
    void g;
  }

  // ------------------------------------------------------------------ flying
  function planeControl(v, inp, dt, g, contacts) {
    const D = v.def, A = D.aero;
    // Throttle: space up, C down; on the ground W also opens it (hold W to roll, then S lifts the nose).
    const onGround = contacts > 0;
    const fwdSpeedNow = B.Vector3.Dot(v.vel, v.fwd);
    if (inp.up) v.throttle += dt * 0.6;
    if (inp.down) v.throttle -= dt * 0.6;
    if (onGround && fwdSpeedNow < 18 && inp.y > 0.05) v.throttle += dt * 0.8 * inp.y;
    v.throttle = clamp(v.wrecked ? 0 : v.throttle, 0, 1);
    const vel = v.vel, speed = vel.length();
    const vb = { x: B.Vector3.Dot(vel, v.right), y: B.Vector3.Dot(vel, v.up), z: B.Vector3.Dot(vel, v.fwd) };
    const vf = Math.max(0, vb.z);
    const alpha = Math.atan2(-vb.y, Math.max(1, vb.z));
    const stall = A.stall * RAD;
    let cl = A.cl0 + A.clA * alpha;
    v.stalled = !onGround && Math.abs(alpha) > stall && speed > 3;
    if (Math.abs(alpha) > stall) cl = (A.cl0 + A.clA * stall * Math.sign(alpha)) * Math.max(0.15, 1 - (Math.abs(alpha) - stall) * 3);
    v.aoa = alpha;
    const lift = A.lift * vf * vf * cl;
    v.F.addInPlace(v.up.scale(v.mass * lift));
    if (speed > 0.5) v.F.addInPlace(vel.scale(-v.mass * A.drag * speed * (A.cd0 + A.induced * cl * cl)));
    v.F.addInPlace(v.right.scale(-v.mass * vb.x * 1.4 * clamp(speed / 10, 0, 1)));
    v.F.addInPlace(v.fwd.scale(v.mass * D.engine.accel * v.throttle * (v.boosting ? D.engine.boost : 1)));
    v.throttleNow = v.throttle;
    // Controls: S pulls the nose up, W pushes it down, A/D roll. They bite with speed.
    const eff = clamp(speed / 25, 0, 1);
    const effv = clamp(speed / 15, 0, 1);
    const pitchIn = onGround && fwdSpeedNow < 18 ? 0 : -inp.y;
    const beta = Math.atan2(vb.x, Math.max(1, vf));
    // Pulling up eases off near the stall (it still stalls when slow: gravity wins).
    const guard = pitchIn > 0 ? clamp((stall - alpha) / stall * 1.5, 0.15, 1) : 1;
    let rx = -pitchIn * 0.9 * eff * guard + alpha * 1.2 * effv;   // around right: + is nose down
    let ry = beta * 2 * effv;                               // around up: toward where it's going
    let rz = -inp.x * 1.7 * eff;                            // around forward: - rolls right
    // Let go of the roll and it levels its wings, gently.
    if (Math.abs(inp.x) < 0.1) rz += Math.asin(clamp(-v.right.y, -1, 1)) * 0.9 * eff;
    if (v.stalled) { rx += 1.0; rz += Math.sin(W().time * 3) * 0.4; }
    if (!onGround) {
      // Bank turns it: a coordinated turn's yaw from the roll.
      ry += -Math.asin(clamp(v.right.y, -1, 1)) * 0.6 * eff;
      steerRate(v, v.right, rx, 5, dt); steerRate(v, v.up, ry, 4, dt); steerRate(v, v.fwd, rz, 5, dt);
    } else if (fwdSpeedNow >= 18 && pitchIn > 0.05) steerRate(v, v.right, -pitchIn * 0.6 * eff, 4, dt);
  }

  function heliControl(v, inp, dt, g) {
    const D = v.def;
    const G = Math.abs(g);
    // The rotor spins up when someone's flying it (or an autopilot is), down when not.
    const flown = (v.seats[0].who || v.autopilot) && !v.wrecked;
    v.spool = clamp(v.spool + (flown ? dt / 2 : -dt / 4), 0, 1);
    const hover = G / (2 * G * Math.max(0.5, v.up.y));
    let c = hover - v.vel.y * 0.12;
    if (inp.up) c = hover + 0.28;
    else if (inp.down) c = hover - 0.3;
    if (v.grounded && !inp.up) c = Math.min(c, hover * 0.6);
    v.collective = clamp(c, 0, 1);
    v.F.addInPlace(v.up.scale(v.mass * 2 * G * v.collective * v.spool));
    // Drag, more so sideways and up and down.
    const h = new B.Vector3(v.vel.x, 0, v.vel.z);
    v.F.addInPlace(h.scale(-v.mass * (v.boosting ? 0.25 : 0.38)));
    v.F.y -= v.vel.y * v.mass * 0.9;
    // Attitude: W tips the nose down and you fly forward; A/D turn; no input levels it.
    const tilt = (v.boosting ? 35 : 24) * RAD;
    const pitchDown = Math.asin(clamp(-v.fwd.y, -1, 1));
    const rollRight = Math.asin(clamp(-v.right.y, -1, 1));
    const wantPitch = inp.y * tilt, wantRoll = inp.x * 10 * RAD;
    if (!v.grounded || v.collective > hover * 0.7) {
      steerRate(v, v.right, (wantPitch - pitchDown) * 3, 4, dt);
      steerRate(v, v.fwd, -(wantRoll - rollRight) * 3, 4, dt);
      steerRate(v, UP, inp.x * D.engine.turn * v.spool, 3, dt);
    }
    v.throttleNow = v.collective;
  }

  // ------------------------------------------------------------------ collisions
  const SKIN = 0.05;
  function samplePoints(v) {
    if (v.samples) return v.samples;
    const [w, h, l] = v.def.size;
    const pts = [];
    for (const y of [-h / 2 + 0.12, 0]) for (const x of [-w / 2, w / 2]) for (const z of [-l / 2, l / 2]) pts.push([x, y, z]);
    if (v.def.contacts) for (const c of v.def.contacts) pts.push(c);
    v.samples = pts;
    return pts;
  }
  /** Moves by the velocity, stopping at walls (and ceilings): the velocity into the wall goes, the rest slides on. */
  function moveAgainstWalls(v, dt) {
    const disp = v.vel.scale(dt);
    const len = disp.length();
    if (len < 1e-5) return;
    const dir = disp.scale(1 / len);
    let best = 1, bestN = null, bestE = null, bestP = null;
    for (const s of samplePoints(v)) {
      const P = toWorld(v, s);
      const hit = cast(v, P, dir, len + SKIN);
      if (!hit || hit.terrain) continue;
      const n = hit.normal;
      if (B.Vector3.Dot(n, dir) >= 0 || n.y > 0.6) continue;
      const frac = Math.max(0, (hit.dist - SKIN) / len);
      if (frac < best) { best = frac; bestN = n; bestE = hit.entity; bestP = hit.point; }
    }
    if (!bestN) { v.pos.addInPlace(disp); return; }
    v.pos.addInPlace(disp.scale(best));
    const vn = B.Vector3.Dot(v.vel, bestN);
    if (vn < 0) {
      v.vel.subtractInPlace(bestN.scale(vn * 1.2));
      v.w.scaleInPlace(0.7);
      crash(v, -vn, bestE, bestP);
    }
  }
  function contactPoints(v) {
    if (v.contactPts) return v.contactPts;
    if (v.def.contacts) return (v.contactPts = v.def.contacts);
    const [w, h, l] = v.def.size.map((x) => x * 0.48);
    const pts = [];
    for (const y of [-h, h]) for (const x of [-w, w]) for (const z of [-l, l]) pts.push([x, y, z]);
    return (v.contactPts = pts);
  }
  /** The hull touching the ground: bounces and scrapes (impulses at each point), and never sinks into it. */
  function hullContacts(v, dt) {
    let lift = 0, any = false;
    const fall = Math.max(0, -v.vel.y * dt) * 2;
    for (const c of contactPoints(v)) {
      const P = toWorld(v, c);
      const from = P.add(new B.Vector3(0, 0.7 + fall, 0));
      const hit = cast(v, from, new B.Vector3(0, -1, 0), 0.7 + fall);
      if (!hit) continue;
      const pen = hit.point.y - P.y;
      if (pen <= 0) continue;
      any = true;
      const n = hit.normal.y > 0.3 ? hit.normal : UP;
      const r = P.subtract(v.com);
      const vc = pointVel(v, P);
      const vn = B.Vector3.Dot(vc, n);
      if (vn < 0) {
        const rn = B.Vector3.Cross(r, n);
        const denom = 1 / v.mass + B.Vector3.Dot(n, B.Vector3.Cross(iinv(v, rn), r));
        const j = -(1 + (-vn > 6 ? 0.25 : 0.05)) * vn / denom;
        applyImpulse(v, n.scale(j), r);
        const vt = vc.subtract(n.scale(vn));
        const vtl = vt.length();
        if (vtl > 1e-3) {
          const t = vt.scale(1 / vtl);
          const rt = B.Vector3.Cross(r, t);
          const dt2 = 1 / v.mass + B.Vector3.Dot(t, B.Vector3.Cross(iinv(v, rt), r));
          const jt = Math.min(vtl / dt2, 0.6 * j);
          applyImpulse(v, t.scale(-jt), r);
        }
        if (-vn > 10) crash(v, -vn * 0.8, hit.entity, hit.point);
      }
      lift = Math.max(lift, pen);
    }
    if (lift > 0) v.pos.y += lift * 0.7;
    return any;
  }
  /** Loose things (crates, balls, animals, people) in the way: mass against mass, they fly. */
  function pushThings(v, dt) {
    const w = W();
    const speed = v.vel.length();
    const [hw, hh, hl] = v.def.size.map((x) => x / 2);
    const reach = Math.hypot(hw, hh, hl) + 1.5;
    for (const o of w.entities) {
      if (o === v.e || !o.alive || o.physics !== 'dynamic' || o.held || o._vehRider || o.vehicle || !o.node.isEnabled()) continue;
      const c = new B.Vector3(o.x + o.offset[0], o.y + o.offset[1], o.z + o.offset[2]);
      const d = c.subtract(v.pos);
      if (d.length() > reach + Math.max(...o.half)) continue;
      const lx = B.Vector3.Dot(d, v.right), ly = B.Vector3.Dot(d, v.up), lz = B.Vector3.Dot(d, v.fwd);
      const ox = Math.max(o.half[0], o.half[2]);
      if (Math.abs(lx) > hw + ox * 0.8 || Math.abs(ly) > hh + o.half[1] || Math.abs(lz) > hl + ox * 0.8) continue;
      const n = new B.Vector3(d.x, Math.max(0, d.y) * 0.3, d.z);
      if (n.lengthSquared() < 1e-6) n.copyFrom(v.fwd);
      n.normalize();
      const ov = new B.Vector3(o.vx, o.vy, o.vz);
      const vrel = B.Vector3.Dot(v.vel.subtract(ov), n);
      if (vrel <= 0.3 && speed > 0.5) continue;
      const mo = o.isPlayer ? 80 : o.mass;
      const J = Math.max(vrel, 1.5) * 1.3 / (1 / v.mass + 1 / mo);
      v.vel.subtractInPlace(n.scale(J / v.mass * (vrel > 0.3 ? 1 : 0)));
      const dv = n.scale(Math.min(30, J / mo));
      dv.y += Math.min(6, J / mo * 0.3);
      if (o.remote && H.sync && H.sync.claim) H.sync.claim(o);
      for (const f of H.hooks.push) try { f(o, v.e); } catch {}
      o.push([dv.x, dv.y, dv.z]);
      if (o.isPlayer && vrel > 7 && H.game && !o._vehRider) H.game.damage(o, Math.round((vrel - 7) * 3), v.e);
      if (vrel > 2 && H.physics && H.physics._fire) H.physics._fire('collision', { a: v.e, b: o, point: [c.x, c.y, c.z], normal: [n.x, n.y, n.z], speed: vrel });
      void dt;
    }
  }
  /** Two vehicles meeting: they push each other apart (both, if I simulate both; else I bounce off). */
  function bumpVehicles(v, dt) {
    const [hw, hh, hl] = v.def.size.map((x) => x / 2);
    for (const oe of list()) {
      const u = oe.vehicle;
      if (u === v || !u) continue;
      const d = oe.node.position.subtract(v.pos);
      const ur = Math.hypot(...u.def.size) / 2;
      if (d.length() > Math.hypot(hw, hh, hl) + ur) continue;
      // Any of its corners inside me, or mine inside it?
      let inside = false;
      for (const c of [[0, 0, 0], ...contactPointsOf(u)]) {
        const P = B.Vector3.TransformNormal(new B.Vector3(c[0], c[1], c[2]), oe.node.getWorldMatrix().getRotationMatrix()).addInPlace(oe.node.position);
        const q = P.subtract(v.pos);
        if (Math.abs(B.Vector3.Dot(q, v.right)) < hw && Math.abs(B.Vector3.Dot(q, v.up)) < hh && Math.abs(B.Vector3.Dot(q, v.fwd)) < hl) { inside = true; break; }
      }
      if (!inside) continue;
      const n = new B.Vector3(-d.x, 0, -d.z);
      if (n.lengthSquared() < 1e-6) n.set(1, 0, 0);
      n.normalize();
      const uv = u.vel;
      const vrel = B.Vector3.Dot(v.vel.subtract(uv), n);
      if (vrel < 0) {
        const mine = simulatedByMe(u);
        const J = -vrel * 1.3 / (1 / v.mass + (mine ? 1 / u.mass : 0));
        v.vel.addInPlace(n.scale(J / v.mass));
        if (mine) { u.vel.subtractInPlace(n.scale(J / u.mass)); wake(u); }
        crash(v, -vrel, oe, null);
      }
      v.pos.addInPlace(n.scale(0.04));
      void dt;
    }
  }
  const contactPointsOf = (u) => contactPoints(u);

  // ------------------------------------------------------------------ damage, wrecks, explosions
  function crash(v, speed, other, point) {
    const w = W();
    if (speed < 7 || w.time - v.lastCrash < 0.25) return;
    v.lastCrash = w.time;
    if (speed > 11) hurtVehicle(v, (speed - 11) * 2.5);
    const at = point ? [point.x, point.y, point.z] : [v.pos.x, v.pos.y, v.pos.z];
    if (H.game) {
      H.game.burst(at, { color: '#ffd28a', count: Math.min(40, 8 + speed * 1.5), speed: 3 + speed * 0.2, size: 0.12 });
      H.game.emit('crash', { vehicle: v.e, speed, other: other || null, at });
    }
    if (V._crashFx) V._crashFx(v, speed);
  }
  function hurtVehicle(v, amount) {
    if (v.wrecked || !(amount > 0)) return;
    v.health = Math.max(0, v.health - amount);
    if (v.health <= 0) wreck(v);
  }
  /** Out of health: the engine dies, the paint burns, it smokes, and everyone in it is thrown out. */
  function wreck(v) {
    if (v.wrecked) return;
    v.wrecked = true;
    v.health = 0;
    const scene = W().scene;
    for (const m of Object.values(v.mats)) if (m.diffuseColor) m.diffuseColor = m.diffuseColor.scale(0.22);
    setLights(v, false);
    try {
      const ps = new B.ParticleSystem('veh-smoke', 160, scene);
      ps.particleTexture = W().dot;
      ps.emitter = v.e.node;
      ps.minEmitBox = new B.Vector3(-0.3, 0.2, -0.3); ps.maxEmitBox = new B.Vector3(0.3, 0.6, 0.3);
      ps.color1 = new B.Color4(0.25, 0.23, 0.22, 0.7); ps.color2 = new B.Color4(0.1, 0.1, 0.1, 0.5); ps.colorDead = new B.Color4(0, 0, 0, 0);
      ps.minSize = 0.6; ps.maxSize = 1.6; ps.minLifeTime = 1.2; ps.maxLifeTime = 2.6; ps.emitRate = 40;
      ps.direction1 = new B.Vector3(-0.3, 1, -0.3); ps.direction2 = new B.Vector3(0.3, 1.6, 0.3); ps.minEmitPower = 1; ps.maxEmitPower = 2.2;
      ps.gravity = new B.Vector3(0, 0.6, 0);
      ps.start();
      v.smoke = ps;
    } catch { /* no particles here */ }
    if (H.game) {
      H.game.burst([v.pos ? v.pos.x : v.e.x, (v.pos ? v.pos.y : v.e.y) + 0.5, v.pos ? v.pos.z : v.e.z], { color: '#ff7a2a', count: 60, speed: 7, size: 0.35 });
      H.game.emit('wrecked', { vehicle: v.e });
    }
    if (V._ejectAll) V._ejectAll(v);
  }
  function repair(v) {
    v.health = v.def.health;
    if (!v.wrecked) return;
    v.wrecked = false;
    const fresh = V.materials(W().scene, v.e.spec && v.e.spec.material && v.e.spec.material.color || v.def.color);
    for (const [k, m] of Object.entries(v.mats)) if (m.diffuseColor && fresh[k]) m.diffuseColor = fresh[k].diffuseColor;
    for (const m of Object.values(fresh)) m.dispose();
    if (v.smoke) { v.smoke.dispose(); v.smoke = null; }
  }
  /** An explosion near vehicles: thrown (by the one who simulates each) and hurt. Comes from the engine's one
   *  'explosion' event (H.physics.on): where it was decided (authoritative) Havok already threw the bodies. */
  let lastBlast = null;
  function blast(at, o = {}) {
    const p = v3(at);
    const w = W();
    if (!w) return [];
    const now = performance.now();
    if (lastBlast && now - lastBlast.t < 150 && B.Vector3.Distance(lastBlast.p, p) < 0.6) return [];
    lastBlast = { t: now, p };
    const R = Number(o.radius) || 4.5, force = Number(o.force ?? 14), dmg = Number(o.damage || 0);
    const hit = [];
    for (const e of list()) {
      const v = e.vehicle;
      const c = e.node.position;
      const d = B.Vector3.Distance(c, p);
      if (d > R + Math.max(...v.def.size) / 2) continue;
      const k = Math.max(0, 1 - Math.max(0, d - Math.max(...v.def.size) / 3) / R);
      if (k <= 0) continue;
      hit.push(e);
      if (!simulatedByMe(v)) continue;
      const dir = c.subtract(p).addInPlaceFromFloats(0, 1.2, 0).normalize();
      if (!v.M) { v.pos = c.clone(); axes(v); }
      const kick = dir.scale(force * k * 1.1 * v.mass);
      const lever = p.subtract(c).normalize().scale(-0.6 * Math.max(...v.def.size) / 2);
      // (On Havok, H.physics.explode already kicked the body: only the damage is ours then.)
      if (!(o._fromExplode && havokOn() && v.e.physics === 'dynamic')) {
        (v.pending || (v.pending = [])).push([kick, new B.Vector3(lever.x, lever.y, lever.z)]);
        v.e.sleeping = false; v.e._wakeBody = true;
        if (!havokOn() || v.e.physics !== 'dynamic') applyPending(v);
      }
      wake(v);
      if (dmg) hurtVehicle(v, dmg * k * 1.4);
    }
    return hit;
  }
  H.physics.on('explosion', (d) => { try { blast(d.position, { ...d, _fromExplode: Boolean(d.authoritative) }); } catch (err) { H.report(err, 'vehicles'); } });

  function flipUpright(v) {
    const e = v.e;
    const n = e.node;
    const yaw = Math.atan2(v.fwd ? v.fwd.x : Math.sin(n.rotation.y), v.fwd ? v.fwd.z : Math.cos(n.rotation.y));
    v.q = B.Quaternion.RotationYawPitchRoll(yaw, 0, 0);
    v.pos = n.position.clone();
    const ground = cast(v, v.pos.add(new B.Vector3(0, 6, 0)), new B.Vector3(0, -1, 0), 30);
    if (ground) v.pos.y = ground.point.y + V.restHeight(v.def) + 0.4;
    else v.pos.y += 1.5;
    v.vel.setAll(0); v.w.setAll(0); v.flipT = 0;
    axes(v);
    writePose(v);
    wake(v);
  }
  function caughtVehicle(v) {
    const e = v.e;
    if (e.home) {
      const r = e.home.rotation || [0, 0, 0];
      v.q = B.Quaternion.FromEulerAngles((r[0] || 0) * RAD, (r[1] || 0) * RAD, (r[2] || 0) * RAD);
      v.pos = v3(e.home.position);
      v.vel.setAll(0); v.w.setAll(0);
      axes(v);
      writePose(v);
    } else if (!v.seats.some((s) => s.who)) e.destroy();
    else flipUpright(v);
  }

  // ------------------------------------------------------------------ lights
  function setLights(v, on) {
    v.lights = on;
    const scene = W() && W().scene;
    if (!scene) return;
    if (v.light) { v.light.dispose(); v.light = null; }
    if (on && v.def.lamps) {
      const lp = v.def.lamps;
      const sp = new B.SpotLight('veh-headlight', new B.Vector3(0, lp.y * v.def.scale, lp.front * v.def.scale + 0.2), new B.Vector3(0, -0.12, 1), 75 * RAD, 2, scene);
      sp.parent = v.e.node;
      sp.diffuse = new B.Color3(1, 0.96, 0.85);
      sp.intensity = 2.2;
      sp.range = 45 * v.def.scale;
      v.light = sp;
    }
    if (v.mats) {
      v.mats.head.emissiveColor = on ? new B.Color3(1, 1, 0.85) : new B.Color3(0.55, 0.55, 0.5);
      v.mats.tail.emissiveColor = on ? new B.Color3(0.9, 0.05, 0.05) : new B.Color3(0.35, 0.02, 0.02);
    }
  }

  // ------------------------------------------------------------------ how it looks moving: wheels, rotors
  function animate(v, dt) {
    const D = v.def;
    for (const w of v.wheels) {
      const drop = Math.min(w.hitDist - w.r, D.suspension.travel);
      w.steerNode.position.y += ((w.at[1] - drop) - w.steerNode.position.y) * Math.min(1, dt * 30);
      w.steerNode.rotation.y = w.steer ? v.steer : 0;
      w.spin += w.spinRate * dt;
      w.spinNode.rotation.x = w.spin;
    }
    if (v.modelWheels) for (const n of v.modelWheels) n.rotation.x = (v.wheels[0] && v.wheels[0].spin) || 0;
    const t = v.def.class;
    for (const s of v.spinners) {
      const rate = t === 'heli' ? v.spool * (s.axis === 'x' ? 70 : 28) : t === 'plane' ? (v.seats[0].who || v.autopilot ? 8 + v.throttle * 55 : 0) : (v.throttleNow || 0) * 25;
      if (s.axis === 'y') s.node.rotation.y += rate * dt; else if (s.axis === 'x') s.node.rotation.x += rate * dt; else s.node.rotation.z += rate * dt;
    }
  }

  // ------------------------------------------------------------------ playing together
  function snapshot(v) {
    const p = v.e.node.position;
    const q = v.q;
    const pose = engineSynced(v) ? {} : { p: [r3(p.x), r3(p.y), r3(p.z)], q: [r4(q.x), r4(q.y), r4(q.z), r4(q.w)], v: [r2(v.vel.x), r2(v.vel.y), r2(v.vel.z)], w: [r2(v.w.x), r2(v.w.y), r2(v.w.z)] };
    return {
      ...pose,
      s: v.seats.map((s) => s.who || 0), l: v.lights ? 1 : 0, h: v.horn ? 1 : 0, b: v.boosting ? 1 : 0,
      st: r2(v.steer), t: r2(v.throttleNow || v.throttle || 0), sp: r2(v.spool), hp: Math.round(v.health), x: v.wrecked ? 1 : 0,
    };
  }
  function applyRemote(v, s) {
    if (s.p && s.q) v.net = { p: v3(s.p), q: new B.Quaternion(s.q[0], s.q[1], s.q[2], s.q[3]), v: v3(s.v || [0, 0, 0]), at: performance.now() };
    if (s.v) v.vel.copyFrom(v3(s.v));
    if (s.w) v.w.copyFrom(v3(s.w));
    if (s.s && !v.seatEvents) s.s.forEach((who, i) => { if (v.seats[i]) v.seats[i].who = who || null; });
    if (s.l !== undefined && Boolean(s.l) !== v.lights) setLights(v, Boolean(s.l));
    if (s.h !== undefined) v.horn = Boolean(s.h);
    if (s.b !== undefined) v.boosting = Boolean(s.b);
    if (s.st !== undefined) v.steer = s.st;
    if (s.t !== undefined) { v.throttleNow = s.t; if (v.def.class === 'plane') v.throttle = s.t; }
    if (s.sp !== undefined) v.spool = s.sp;
    if (s.hp !== undefined) v.health = s.hp;
    if (s.x && !v.wrecked) wreck(v);
    if (s.x === 0 && v.wrecked) repair(v);
  }
  /** Each frame: vehicles someone else simulates glide to where they say (a little ahead, by their speed). */
  function followRemote(v, dt) {
    const n = v.net;
    if (!n) { const fs = B.Vector3.Dot(new B.Vector3(v.e._v ? v.e._v[0] : 0, v.e._v ? v.e._v[1] : 0, v.e._v ? v.e._v[2] : 0), B.Vector3.TransformNormal(B.Axis.Z, v.e.node.getWorldMatrix()).normalize()); for (const w of v.wheels) w.spinRate = fs / w.r; return; }
    const n2 = v.e.node;
    const ahead = Math.min(0.25, (performance.now() - n.at) / 1000);
    const target = n.p.add(n.v.scale(ahead));
    const k = 1 - Math.exp(-dt * 14);
    if (B.Vector3.Distance(target, n2.position) > 6) n2.position.copyFrom(target);
    else n2.position.copyFrom(B.Vector3.Lerp(n2.position, target, k));
    v.q = B.Quaternion.Slerp(v.q, n.q, k);
    n2.rotation.copyFrom(v.q.toEulerAngles());
    v.euler = n2.rotation.clone();
    v.posW = n2.position.clone();
    v.pos = n2.position.clone();
    if (!havokOn() && (v.measureT = (v.measureT || 0) + dt) > 0.1) { v.measureT = 0; v.e.measure(); }
    // Wheels roll by its speed.
    axes(v);
    const fs = B.Vector3.Dot(v.vel, v.fwd);
    for (const w of v.wheels) { w.spinRate = fs / w.r; if (!w.contact) w.hitDist = v.def.suspension.travel * 0.55 + w.r; }
  }
  function register(v) {
    if (!H.sync || !v.e.alive) return;
    if (v.sync) v.sync.remove();
    v.sync = H.sync.state(`veh:${v.key}`, { rate: 20, owner: () => v.e.alive && simulatedByMe(v), get: () => snapshot(v), set: (s) => applyRemote(v, s) });
  }
  function unregister(v) {
    if (v.sync) { v.sync.remove(); v.sync = null; }
    if (v.light) { v.light.dispose(); v.light = null; }
    if (v.smoke) { v.smoke.dispose(); v.smoke = null; }
    const w = W();
    if (w && w.vehicles) w.vehicles.delete(v.e);
    if (V._onGone) V._onGone(v);
  }

  // ------------------------------------------------------------------ the engine's step and frame
  H.physics.beforeStep((dt) => {
    for (const e of list()) {
      const v = e.vehicle;
      try {
        const mine = simulatedByMe(v);
        // Not ours: on Havok its body follows where it's said to be (a scene thing's remote flag is the engine's).
        if (!engineSynced(v) && havokOn()) e.remote = !mine;
        if (mine) { simulate(v, dt); v.net = null; } else if (!havokOn()) { e.vx = e.vy = e.vz = 0; }
      } catch (err) { H.report(err, `vehicle ${e.name || v.type}`); }
    }
  });
  H.hooks.frame.push((dt) => {
    for (const e of list()) {
      const v = e.vehicle;
      if (!simulatedByMe(v)) followRemote(v, dt);
      animate(v, dt);
    }
  });

  // ------------------------------------------------------------------ the kinds
  const FIELDS = [
    ['material.color', 'its paint', ''],
    ['shape.model', 'a model asset to wear as its body (the physics stays the vehicle\'s)', 'none: shapes'],
    ['shape.modelYaw', 'turns the model (degrees) if it faces the wrong way', '0'],
    ['shape.speed', 'top speed in m/s', ''],
    ['shape.power', 'engine strength, times', '1'],
    ['shape.grip', 'tire grip, times', '1'],
    ['shape.handling', '"drift" slides more, "grippy" less', ''],
    ['shape.mass', 'kilograms', ''],
    ['shape.health', 'crashes and explosions take it; 0 is a wreck', '100'],
    ['transform.scale', 'a number: a bigger or smaller one (it drives the same way)', '1'],
    ['data.autopilot', '{ speed, steer, hover }: drives itself (circles, laps, a helicopter holding a height)', ''],
    ['physics', '"dynamic" (drives: a real body) or "static" (a parked prop nobody can drive)', 'dynamic'],
  ];
  const CODEX = {
    car: { what: 'A car. E gets in (B on a phone). W/S drive and brake, A/D steer, space is the handbrake (drift!), shift boosts, H honks, L lights, V camera, R flips it back.', auto: { speed: 4, steer: 1 } },
    truck: { what: 'A 4x4 with long, soft suspension and all-wheel drive: it climbs mountains. Two seats inside, two in the back.', auto: { speed: 3.5, steer: 1 } },
    bicycle: { what: 'A bicycle: pedal with W, steer with A/D, space hops, shift sprints.', auto: { speed: 4, steer: 1 } },
    motorbike: { what: 'A motorbike: fast, leans into turns, wheelies off jumps. A passenger rides behind.', auto: { speed: 4, steer: 1 } },
    boat: { what: 'A speedboat: floats on water (the Water module\'s, or anything tagged "water"), planes over waves.' },
    submarine: { what: 'A submarine: C dives, space rises, W/S thrust, A/D turn. Let go deep and it holds its depth.' },
    airplane: { what: 'An airplane: hold W to roll down the runway, S lifts the nose at speed. In the air: W/S pitch, A/D roll, space/C throttle. Too slow and it stalls.' },
    helicopter: { what: 'A helicopter: space climbs, C descends (it hovers by itself), W/S tilt to fly forward and back, A/D turn.', auto: { hover: 2.5 } },
  };
  function codexSpec(type) {
    const c = CODEX[type] || {};
    const def = V.types[type];
    const spec = { type, name: def.title, transform: { position: [0, V.restHeight(def) + 0.05, 0] }, material: { color: def.color } };
    if (c.auto && type !== 'helicopter') {
      spec.data = { autopilot: c.auto };
      // Circling the middle of the codex's little floor: start a turning circle's radius to the left of it.
      const wb = def.wheels[0].at[2] - def.wheels[def.wheels.length - 1].at[2];
      const lock = def.steer * RAD / (1 + c.auto.speed / (def.twoWheels ? 14 : 20));
      // (The codex's floor is 14 m across: cars and 4x4s show at three quarters size so their circle fits on it.)
      const k = def.twoWheels ? 1 : 0.75;
      if (k !== 1) { spec.transform.scale = k; spec.transform.position[1] = V.restHeight(def) * k + 0.05; }
      spec.transform.position[0] = -Math.round(wb * k / Math.tan(lock) * 11.5) / 10; // (tires slip a little: the circle is wider)
      spec.transform.position[2] = 1.2;
    }
    if (type === 'helicopter') spec.data = { autopilot: { hover: 2.5 } };
    return spec;
  }
  function registerKind(type, name = type) {
    const def = V.types[type];
    H.kinds.register(name, {
      physics: 'dynamic',
      maker: true,
      build: (sh, o, spec) => buildVehicle(type, sh || {}, o, spec),
      destroy(e) { if (e.vehicle) unregister(e.vehicle); },
      editor: {
        word: `a ${def.title.toLowerCase()}`,
        lift: (spec) => V.restHeight(tuned(type, (spec && spec.shape) || {}, spec && spec.transform && typeof spec.transform.scale === 'number' ? spec.transform.scale : 1)) + 0.05,
        motion: [['dynamic', 'Drives'], ['static', 'Parked']],
        hotbar: type === 'car' ? [{ order: 120, icon: '🚗', label: 'Car', make: () => ({ type: 'car', name: 'Car', material: { color: def.color } }) }]
          : type === 'truck' ? [{ order: 121, icon: '🛻', label: '4x4', make: () => ({ type: 'truck', name: '4x4', material: { color: def.color } }) }] : [],
      },
      codex: { group: 'Vehicles', what: (CODEX[type] || {}).what || def.title, spec: codexSpec(type), fields: FIELDS },
    });
  }
  for (const type of Object.keys(V.types)) registerKind(type);
  // The general one: { "type": "vehicle", "shape": { "vehicle": "truck", "model": "monster.glb" } }.
  H.kinds.register('vehicle', {
    physics: 'dynamic',
    maker: false,
    build: (sh, o, spec) => buildVehicle(V.typeOf((sh && (sh.vehicle || sh.kind)) || 'car') || 'car', sh || {}, o, spec, 'vehicle'),
    destroy(e) { if (e.vehicle) unregister(e.vehicle); },
    editor: { word: 'a vehicle', lift: (spec) => V.restHeight(V.types[V.typeOf((spec && spec.shape && spec.shape.vehicle) || 'car') || 'car']) + 0.05, motion: [['dynamic', 'Drives'], ['static', 'Parked']] },
    codex: { group: 'Vehicles', what: 'Any vehicle by name (shape.vehicle: car, truck/4x4, bicycle, motorbike, boat, submarine, airplane, helicopter), usually wearing a model (shape.model).', spec: { type: 'vehicle', name: 'Monster truck', shape: { vehicle: 'truck' }, transform: { position: [0, 1.2, 0], scale: 1.3 }, material: { color: '#7c3aed' } }, fields: [['shape.vehicle', 'which vehicle it drives like', 'car'], ...FIELDS] },
  });

  Object.assign(V, {
    list, simulatedByMe, waterLevel, blast, isMe, myId,
    _: { ...(V._ || {}), simulate, wake, flipUpright, repair, wreck, setLights, axes, toWorld, cast, register, snapshot, applyRemote, ZERO_INPUT, hurtVehicle },
    /** The vehicle an entity is (or null). */
    of: (e) => (e && e.vehicle ? e : null),
    /** Drives it from code (an AI friend, a script): { steer -1..1, throttle -1..1 or speed m/s, up, down, boost, brake,
     *  hover (helicopter height) }; null stops. */
    drive(e, input) { const v = e && e.vehicle; if (!v) return; v.autopilot = input || null; wake(v); },
    repair: (e) => e && e.vehicle && repair(e.vehicle),
    flip: (e) => e && e.vehicle && flipUpright(e.vehicle),
  });
})();
