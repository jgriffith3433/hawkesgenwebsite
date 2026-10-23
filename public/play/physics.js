// H.physics: the engine's physics, the one way modules (vehicles, mayhem, terrain, water, creatures...) touch it.
// docs/engine-modules.md is the contract; scripts see the friendly part through entities (e.push, e.impulse, ...)
// and game.physics.
//
// Two engines stand behind the same API:
//   'havok'   Havok (Babylon Physics v2), loaded from the CDN by HawkesModules: rotation, real shapes, joints,
//             forces, casts, sleeping, collision events, filters, a character controller.
//   'legacy'  the engine's first box physics (runtime.js), used until Havok is ready and where it can't load.
// What a call needs from Havok says so in its doc; on 'legacy' it does the nearest thing it can (or nothing).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const RAD = Math.PI / 180;
  const vec = L.vec;
  const W = () => H.world;

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
    /** Ground from heights: rows x cols samples over width x depth meters, heights row by row (Float32Array or array). */
    heightfield: ({ width, depth, rows, cols, heights }) => ({ type: 'heightfield', width, depth, rows, cols, heights }),
    /** Several shapes as one body: [{ shape, position: [x, y, z], rotation: [x, y, z] (degrees) }]. */
    compound: (parts) => ({ type: 'compound', parts }),
  };

  // ------------------------------------------------------------------ events
  const listeners = { collision: [], 'collision-end': [], trigger: [], before: [], after: [] };
  const on = (name, fn) => {
    const list = listeners[name];
    if (!list) throw new Error(`H.physics.on: one of ${Object.keys(listeners).filter((k) => k !== 'before' && k !== 'after').join(', ')}`);
    list.push(fn);
    return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  };
  const fire = (name, data) => { for (const f of [...listeners[name]]) try { f(data); } catch (err) { H.report(err, `physics ${name}`); } };

  // Legacy: touching starts are collisions (no point or speed), and forces are applied as velocity before the step.
  H.hooks.contact.push((a, b) => {
    if (a.physics === 'trigger' || b.physics === 'trigger') fire('trigger', { trigger: a.physics === 'trigger' ? a : b, entity: a.physics === 'trigger' ? b : a, entered: true });
    else fire('collision', { a, b, point: null, normal: null, speed: 0 });
  });
  H.hooks.step.push((dt) => {
    fire('before', dt);
    const w = W();
    if (!w) return;
    for (const e of w.entities) {
      const f = e._force;
      if (!f) continue;
      e._force = null;
      if (e.physics !== 'dynamic' || e.remote || e.held) continue;
      e.vx += (f[0] / e.mass) * dt; e.vy += (f[1] / e.mass) * dt; e.vz += (f[2] / e.mass) * dt;
      e.wake();
    }
  });
  H.hooks.afterStep.push((dt) => fire('after', dt));

  // ------------------------------------------------------------------ entities: forces, impulses, layers
  const P = L.Entity.prototype;
  Object.assign(P, {
    /** A kick, in newton-seconds: the velocity changes by impulse / mass. `at` (a point) also spins it (Havok). */
    impulse(v, at) { const p = vec(v); if (this.physics !== 'dynamic') return this; this.vx += p[0] / this.mass; this.vy += p[1] / this.mass; this.vz += p[2] / this.mass; this.grounded = false; this.wake(); void at; return this; },
    /** A push in newtons for this step only (call it every step for a steady force: thrust, wind, buoyancy). */
    force(v, at) { const p = vec(v); const f = this._force || (this._force = [0, 0, 0]); f[0] += p[0]; f[1] += p[1]; f[2] += p[2]; void at; return this; },
    /** A twist in newton-meters for this step only (Havok). */
    torque(v) { void v; return this; },
    sleep() { this.sleeping = true; return this; },
  });
  Object.defineProperties(P, {
    /** Spin in degrees a second around x, y, z (Havok; always still on 'legacy'). */
    angularVelocity: { get() { return this._spin || [0, 0, 0]; }, set(v) { this._spin = vec(v); }, configurable: true },
    /** True: it never tips over (characters, animals that walk). */
    upright: { get() { return this._upright ?? (this.kind === 'capsule' || Boolean(this.isPlayer)); }, set(v) { this._upright = Boolean(v); }, configurable: true },
    layer: { get() { return this._layer || 'default'; }, set(v) { layer(v); this._layer = String(v); }, configurable: true },
    collidesWith: { get() { return this._collides || 'all'; }, set(v) { maskOf(v); this._collides = v; }, configurable: true },
  });

  // ------------------------------------------------------------------ queries
  function raycast(from, dir, dist = 100, o = {}) { return H.game ? H.game.raycast(from, dir, dist, o) : null; }
  /** Things whose bounds are inside a shape (a sphere or a box for now) at a point. */
  function overlap(shape, at, o = {}) {
    const w = W();
    if (!w) return [];
    const p = vec(at);
    const out = [];
    for (const e of w.entities) {
      if (!e.alive || (o.ignore && (e === o.ignore || (Array.isArray(o.ignore) && o.ignore.includes(e))))) continue;
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
  /** Sweeps a shape from one point to another: the first thing in the way (Havok; 'legacy' casts a ray). */
  function shapeCast(shape, from, to, o = {}) {
    const a = vec(from), b = vec(to);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d) || 1;
    const hit = raycast(a, d, len, o);
    return hit ? { ...hit, fraction: hit.distance / len } : null;
    void shape;
  }

  /** An explosion's push: every dynamic thing within `radius` is thrown away from `at` (stronger closer), things with
   *  health are hurt by `damage` (less farther). Returns what it touched. Online, the host runs it for everyone
   *  (net.js: H.sync.action), so pass it through game.physics.explode, not your own loop. */
  function explode(at, o = {}) {
    const p = vec(at);
    const R = Number(o.radius) || 4.5, force = o.force ?? 14, up = o.up ?? 0.6;
    const hit = [];
    for (const e of overlap(shapes.sphere(R), p, { all: false })) {
      if (!e.alive || e.kind === 'light') continue;
      const c = [e.x, e.y, e.z];
      const d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
      const k = Math.max(0, 1 - d / R);
      if (e.physics === 'dynamic' && !e.isPlayer) {
        const dir = new B.Vector3(c[0] - p[0], c[1] - p[1] + up, c[2] - p[2]).normalize();
        // Same feel as before on 'legacy' (a velocity change), a real impulse (mass-aware) on Havok.
        e.impulse([dir.x * force * k * e.mass, dir.y * force * 0.7 * k * e.mass, dir.z * force * k * e.mass]);
        if (o.owner !== undefined && H.hooks.push) for (const f of H.hooks.push) f(e, o.owner);
      }
      if (o.damage && H.game && (e.hp !== undefined || e.isPlayer)) H.game.damage(e, o.damage * k, o.owner || null);
      hit.push(e);
    }
    return hit;
  }

  /** A joint between two things (or a thing and the world: b = null). Needs Havok. */
  function joint(type, a, b, o = {}) {
    if (H.physics.engine !== 'havok') { H.report(new Error(`Joints need the physics engine (it hasn't loaded yet): ${type}`), 'physics'); return null; }
    return H.physics._joint(type, a, b, o);
  }

  /** Changes a thing's collider (a shape from H.physics.shapes, or 'box' | 'sphere' | 'capsule' | 'cylinder' |
   *  'convex' | 'mesh' | 'auto'). 'legacy' always uses the box around it. */
  function setShape(e, shape) { e._shapeSpec = shape; if (H.physics._setShape) H.physics._setShape(e, shape); return e; }

  /** A character controller on any entity: walks, climbs slopes and steps, stands on moving things. The player has
   *  one; creatures and AI friends get their own. move() each step with the velocity you want. */
  function character(e, o = {}) {
    if (H.physics._character) return H.physics._character(e, o);
    e.upright = true;
    if (e.physics !== 'dynamic') e.physics = 'dynamic';
    return {
      entity: e,
      move(v) { const p = vec(v); e.vx = p[0]; e.vz = p[2]; if (p[1]) e.vy = p[1]; e._walked = true; e.wake(); },
      jump(speed = 7) { return e.jump(speed); },
      teleport(p) { e.position = p; e.velocity = [0, 0, 0]; },
      get grounded() { return e.grounded; },
      get standing() { return e.standing; },
      get normal() { return [0, 1, 0]; },
      remove() {},
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
    explode, joint, character,
    on,
    beforeStep: (fn) => on('before', fn),
    afterStep: (fn) => on('after', fn),
    _fire: fire,
  };
})();
