// Presence, part 1b: what you are, drawn. A look's `what` (presence-core.js WHATS; the mirror's first question) is a
// body other than the block person: a Living species (dog, cat, bear, penguin, dinosaur, robot...: species.js builds
// it, in the look's colors) or a thing made here from primitives (a shoe, a toaster, a cactus, a traffic cone, a
// teapot, a banana, a mushroom, a potato, a rubber duck, a TV robot, a roll-bot). Each is built at its own size, then
// scaled to its height (WHATS h) with its feet on the ground, and gets an anchor where hats and glasses sit (rig.neck,
// rig.faceY, rig.faceZ), so every hat and extra fits everything. presence.js calls P.bodies.build from makeRig and
// moves them (P.bodies.animate): legs and arms swing, tails wag, things without legs waddle and hop, the roll-bot rolls.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const P = (H.presence = H.presence || {});
  const C = () => P.core;

  // ------------------------------------------------------------------ things: soft toys with faces (presence-things.js registers them here)
  // THINGS[id](kit, colors, { rig, holder, look }) returns where its head is ({ head: [x, y, z], r, top, front }, in its own units).
  const THINGS = {};

  // ------------------------------------------------------------------ the kit a builder uses
  function kit(rig, holder, shade) {
    const scene = rig.scene;
    const part = (name, make, parent, pos, color, glow) => P.bodies._part(rig, name, make, parent, pos, color, glow);
    const k = {
      scene,
      box: (w, h, d) => (s) => B.MeshBuilder.CreateBox('b', { width: w, height: h, depth: d }, s),
      cyl: (top, bottom, h, n = 16) => (s) => B.MeshBuilder.CreateCylinder('c', { diameterTop: top, diameterBottom: bottom, height: h, tessellation: n }, s),
      torus: (d, t) => (s) => B.MeshBuilder.CreateTorus('t', { diameter: d, thickness: t, tessellation: 24 }, s),
      sphere: (d, sc = [1, 1, 1], slice = 1, n = 14) => (s) => { const m = B.MeshBuilder.CreateSphere('s', { diameter: d, segments: n, slice }, s); m.scaling.set(sc[0], sc[1], sc[2]); m.bakeCurrentTransformIntoVertices(); return m; },
      /** A part: name, a maker, where, its color, { rot, glow, parent }. */
      add(name, make, pos, color, o = {}) {
        const m = part(name, make, o.parent || holder, pos, color, o.glow);
        if (o.rot) m.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
        return m;
      },
      joint(name, at, parent) { const t = new B.TransformNode(`pr-${name}`, scene); t.parent = parent || holder; t.position.set(at[0], at[1], at[2]); return t; },
      /** Two little legs (on hip joints the walk swings) whose feet stand on y = 0. */
      legs(apart, h, r, color) {
        rig.hipL = k.joint('hipL', [apart, h, 0]); rig.hipR = k.joint('hipR', [-apart, h, 0]);
        rig.legged = true;
        for (const [hip, n] of [[rig.hipL, 'L'], [rig.hipR, 'R']]) {
          k.add(`leg${n}`, k.cyl(r * 2, r * 2, h, 10), [0, -h / 2, 0], shade(color, -0.1), { parent: hip });
          k.add(`foot${n}`, k.box(r * 3, r * 1.2, r * 4.2), [0, -h + r * 0.6, r], color, { parent: hip });
        }
      },
      /** Two little arms on shoulder joints (the walk and the emotes swing them). */
      arms(apart, y, len, color) {
        rig.shL = k.joint('shL', [apart, y, 0]); rig.shR = k.joint('shR', [-apart, y, 0]);
        for (const [sh, n] of [[rig.shL, 'L'], [rig.shR, 'R']]) {
          k.add(`arm${n}`, k.cyl(0.07, 0.07, len, 8), [0, -len / 2, 0], color, { parent: sh });
          k.add(`hand${n}`, k.sphere(0.13), [0, -len, 0], color, { parent: sh });
        }
      },
      /** Googly eyes: whites and pupils looking slightly up. */
      eyes(at, apart, d) {
        for (const sx of [-1, 1]) {
          k.add(`eye${sx}`, k.sphere(d), [at[0] + sx * apart * 0.5 * 1.25, at[1], at[2]], '#ffffff');
          k.add(`pupil${sx}`, k.sphere(d * 0.48), [at[0] + sx * apart * 0.5 * 1.25, at[1] + d * 0.1, at[2] + d * 0.4], '#0b0d12');
        }
      },
      roll(mesh, radius) { rig.roll = { mesh, radius }; },
    };
    return k;
  }

  // ------------------------------------------------------------------ building one: a thing or a Living species, then sized
  /** Builds `what` (a WHATS row) for this rig: rig.body (the sized holder), rig.neck (where hats sit), faceY/faceZ. */
  function build(rig, what, look, shade) {
    const scene = rig.scene;
    const c = { body: look.body, accent: look.accent, detail: look.head };
    // Built at the world's origin with no parent, so its size and its head are measured in its own units.
    const holder = new B.TransformNode('pr-body', scene);
    let head = null;
    const thing = THINGS[what.body];
    if (thing) {
      head = thing(kit(rig, holder, shade), c, { rig, holder, look });
    } else {
      const L = H.living;
      const sp = L && L.species && L.species.get(what.body);
      if (!sp || !L.body || !L.body.build) { holder.dispose(); return false; }
      const colors = sp.plan === 'human'
        ? { body: c.body, head: c.detail, legs: shade(c.body, -0.25), accent: c.accent }
        : { body: c.body, head: c.body, legs: shade(c.body, -0.12), accent: c.accent };
      const lv = L.body.build(scene, holder, sp, { colors, size: 1 });
      rig.lv = lv;
      if (lv.head) {
        const hb = lv.head.getHierarchyBoundingVectors(true);
        const hc = hb.min.add(hb.max).scale(0.5);
        head = { head: [hc.x, hc.y, hc.z], r: Math.max(0.05, (hb.max.z - hb.min.z) / 2), top: hb.max.y, front: hb.max.z };
      }
    }
    const bb = holder.getHierarchyBoundingVectors(true);
    const height = Math.max(0.05, bb.max.y - bb.min.y);
    const k = (what.h || 1.2) / height;
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    holder.parent = rig.pose;
    holder.scaling.set(k, k, k);
    holder.position.set(-cx * k, -0.9 - bb.min.y * k, -cz * k);
    rig.body = holder;
    rig.bodyScale = k;
    // Where its head is, in the pose's space: hats sit on its top, glasses on its front.
    const at = (x, y, z) => [(x - cx) * k, -0.9 + (y - bb.min.y) * k, (z - cz) * k];
    const h = head || { head: [cx, bb.max.y - 0.2, cz], r: 0.2, top: bb.max.y };
    const top = at(h.head[0], h.top, h.head[2]);
    const mid = at(h.head[0], h.head[1], h.head[2]);
    const front = h.front != null ? at(0, 0, h.front)[2] : mid[2] + h.r * k;
    const neck = new B.TransformNode('pr-neck', scene);
    neck.parent = rig.pose;
    neck.position.set(top[0], top[1] - 0.42, top[2]);
    rig.neck = neck;
    rig.faceY = mid[1] - neck.position.y;
    rig.faceZ = front - neck.position.z + 0.01;
    return true;
  }

  // ------------------------------------------------------------------ moving: legs, arms and tails; waddles and rolls
  /** After the walk's rest pose (presence.js animate): what this body does on its own. s: 0..1 how fast it walks. */
  function animate(rig, dt, s) {
    const t = rig.time || 0;
    if (rig.thing && P.things) { P.things.animate(rig, dt, s); return; }
    if (rig.lv) {
      const lv = rig.lv, sw = Math.sin(rig.phase) * 0.55 * s;
      for (const h of lv.hips || []) h.n.rotation.x = Math.sin(rig.phase + (h.ph || 0)) * 0.55 * s;
      for (const a of lv.arms || []) a.n.rotation.x = Math.sin(rig.phase + (a.ph || 0)) * 0.45 * s;
      if (lv.tail) lv.tail.rotation.y = Math.sin(t * (4 + s * 6)) * 0.35;
      if (lv.head) lv.head.rotation.x = (lv.headBase || 0) + Math.sin(t * 1.7) * 0.04 + sw * 0.05;
      for (const w of lv.wings || []) if (w && w.n) w.n.rotation.z = Math.sin(t * 3) * 0.08 * (w.side || 1);
    } else if (!rig.legged) {
      // No legs: a waddle and a little hop as it goes.
      rig.pose.rotation.z = Math.sin(rig.phase) * 0.14 * s;
      rig.pose.position.y = Math.abs(Math.sin(rig.phase)) * 0.12 * s;
    }
    if (rig.roll && rig.e) {
      const r = rig.roll;
      r.mesh.rotation.x += (rig.speed || 0) * dt / Math.max(0.1, r.radius * (rig.bodyScale || 1));
      rig.pose.rotation.z = 0;
      rig.pose.position.y = 0;
    }
  }

  P.bodies = { THINGS, build, animate, _part: null };
})();
