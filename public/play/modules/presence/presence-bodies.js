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

  // ------------------------------------------------------------------ things: built from primitives, feet at y = 0, facing +z
  // Each builder gets the kit (k) and the colors (c: body, accent, detail) and returns where its head is
  // ({ head: [x, y, z], r: head radius, top: y of the head's top }), in its own units.
  const THINGS = {
    shoe(k, c) {
      k.legs(0.16, 0.22, 0.06, c.detail);
      const y = 0.22;
      k.add('sole', k.box(0.52, 0.12, 1.12), [0, y + 0.06, 0], c.accent);
      k.add('upper', k.box(0.48, 0.42, 0.72), [0, y + 0.33, -0.18], c.body);
      k.add('toe', k.sphere(0.5, [1, 0.62, 0.9]), [0, y + 0.18, 0.28], c.body);
      k.add('heel', k.box(0.5, 0.1, 0.3), [0, y + 0.52, -0.42], c.accent);
      k.add('tongue', k.box(0.3, 0.18, 0.12), [0, y + 0.6, -0.02], c.body, { rot: [-0.35, 0, 0] });
      for (let i = 0; i < 3; i++) k.add(`lace${i}`, k.box(0.34, 0.04, 0.05), [0, y + 0.47 - i * 0.04, 0.08 + i * 0.1], c.accent, { rot: [-0.5, 0, 0] });
      k.eyes([0, y + 0.42, 0.38], 0.13, 0.15);
      return { head: [0, y + 0.42, 0.2], r: 0.25, top: y + 0.7 };
    },
    toaster(k, c) {
      k.legs(0.2, 0.24, 0.07, c.detail);
      const y = 0.24;
      k.add('body', k.box(0.9, 0.7, 0.56), [0, y + 0.35, 0], c.body);
      for (const x of [-0.18, 0.18]) {
        k.add(`slot${x}`, k.box(0.12, 0.04, 0.42), [x, y + 0.71, 0], c.detail);
        k.add(`toast${x}`, k.box(0.1, 0.34, 0.38), [x, y + 0.82, 0], c.accent, { rot: [0, 0, x > 0 ? 0.08 : -0.06] });
      }
      k.add('lever', k.box(0.06, 0.08, 0.16), [0.48, y + 0.5, 0], c.detail);
      k.add('dial', k.cyl(0.1, 0.1, 0.04), [0.47, y + 0.25, 0.1], c.accent, { rot: [0, 0, Math.PI / 2] });
      k.arms(0.47, y + 0.45, 0.32, c.detail);
      k.eyes([0, y + 0.42, 0.29], 0.14, 0.17);
      k.add('mouth', k.box(0.22, 0.03, 0.02), [0, y + 0.22, 0.29], c.detail);
      return { head: [0, y + 0.42, 0], r: 0.29, top: y + 0.99 };
    },
    cactus(k, c) {
      k.add('pot', k.cyl(0.62, 0.46, 0.42), [0, 0.21, 0], c.detail);
      k.add('soil', k.cyl(0.58, 0.58, 0.04), [0, 0.42, 0], '#5b4636');
      k.add('trunk', k.cyl(0.44, 0.48, 1.1), [0, 0.95, 0], c.body);
      k.add('dome', k.sphere(0.44), [0, 1.5, 0], c.body);
      const arm = (sx, y, h) => {
        k.add(`armOut${sx}`, k.cyl(0.18, 0.18, 0.3), [sx * 0.33, y, 0], c.body, { rot: [0, 0, Math.PI / 2] });
        k.add(`armUp${sx}`, k.cyl(0.18, 0.18, h), [sx * 0.46, y + h / 2 - 0.05, 0], c.body);
        k.add(`armTop${sx}`, k.sphere(0.18), [sx * 0.46, y + h - 0.05, 0], c.body);
      };
      arm(1, 0.95, 0.4); arm(-1, 0.8, 0.32);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; k.add(`spine${i}`, k.box(0.02, 0.06, 0.02), [Math.sin(a) * 0.235, 0.7 + (i % 3) * 0.3, Math.cos(a) * 0.235], '#f5f5dc'); }
      k.add('flower', k.sphere(0.16, [1, 0.6, 1]), [0.06, 1.72, 0], c.accent);
      k.eyes([0, 1.32, 0.21], 0.12, 0.15);
      k.add('mouth', k.box(0.14, 0.03, 0.02), [0, 1.18, 0.23], '#14532d');
      return { head: [0, 1.38, 0], r: 0.22, top: 1.72 };
    },
    cone(k, c) {
      k.add('base', k.box(0.84, 0.08, 0.84), [0, 0.04, 0], c.detail);
      k.add('cone', k.cyl(0.12, 0.7, 1.2, 20), [0, 0.68, 0], c.body);
      k.add('stripe1', k.cyl(0.43, 0.53, 0.14, 20), [0, 0.55, 0], c.accent);
      k.add('stripe2', k.cyl(0.25, 0.33, 0.12, 20), [0, 0.92, 0], c.accent);
      k.eyes([0, 0.78, 0.22], 0.11, 0.13);
      k.add('mouth', k.box(0.12, 0.025, 0.02), [0, 0.66, 0.25], c.detail);
      return { head: [0, 0.82, 0], r: 0.18, top: 1.28 };
    },
    teapot(k, c) {
      k.legs(0.18, 0.2, 0.07, c.detail);
      const y = 0.2;
      k.add('pot', k.sphere(0.9, [1, 0.78, 0.86]), [0, y + 0.36, 0], c.body);
      k.add('lid', k.sphere(0.5, [1, 0.42, 1]), [0, y + 0.7, 0], c.accent);
      k.add('knob', k.sphere(0.13), [0, y + 0.82, 0], c.detail);
      k.add('band', k.cyl(0.92, 0.92, 0.06, 24), [0, y + 0.36, 0], c.accent);
      k.add('spout', k.cyl(0.08, 0.16, 0.52), [0, y + 0.48, 0.5], c.body, { rot: [1.0, 0, 0] });
      k.add('handle', k.torus(0.42, 0.07), [0, y + 0.38, -0.42], c.detail, { rot: [0, 0, Math.PI / 2] });
      k.eyes([0, y + 0.46, 0.37], 0.13, 0.16);
      return { head: [0, y + 0.45, 0], r: 0.38, top: y + 0.88 };
    },
    banana(k, c) {
      k.legs(0.12, 0.26, 0.06, c.detail);
      // A curved stack of rounds, thick in the middle, bending back at the top.
      const N = 9;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const d = 0.26 + Math.sin(t * Math.PI) * 0.2;
        k.add(`seg${i}`, k.sphere(d), [0, 0.32 + t * 1.15, -Math.sin(t * 1.4) * 0.28], c.body);
      }
      k.add('stem', k.cyl(0.08, 0.1, 0.18), [0, 1.53, -0.34], c.accent, { rot: [-0.5, 0, 0] });
      k.add('tip', k.sphere(0.12), [0, 0.28, 0], c.detail);
      k.eyes([0, 1.0, 0.03], 0.11, 0.14);
      k.add('mouth', k.box(0.12, 0.025, 0.02), [0, 0.86, 0.08], c.accent);
      return { head: [0, 1.02, -0.18], r: 0.22, top: 1.5 };
    },
    mushroom(k, c) {
      k.legs(0.14, 0.18, 0.06, c.detail);
      k.add('stem', k.cyl(0.42, 0.5, 0.62), [0, 0.49, 0], c.detail);
      k.add('cap', k.sphere(1.05, [1, 0.62, 1], 0.5), [0, 0.68, 0], c.body);
      for (const [x, y, z, d] of [[0.26, 1.0, 0.2, 0.14], [-0.22, 1.04, 0.16, 0.11], [0.02, 1.13, -0.05, 0.13], [-0.3, 0.92, -0.2, 0.12], [0.34, 0.9, -0.18, 0.1], [0.05, 0.96, 0.36, 0.09]]) k.add(`spot${x}`, k.sphere(d, [1, 0.5, 1]), [x, y, z], c.accent);
      k.eyes([0, 0.52, 0.22], 0.11, 0.14);
      k.add('mouth', k.box(0.14, 0.025, 0.02), [0, 0.4, 0.24], '#7f1d1d');
      return { head: [0, 0.55, 0], r: 0.24, top: 1.2 };
    },
    potato(k, c) {
      k.legs(0.16, 0.2, 0.06, c.detail);
      k.add('body', k.sphere(0.8, [0.86, 1.08, 0.74]), [0, 0.62, 0], c.body);
      for (const [x, y, z, d] of [[0.22, 0.84, 0.12, 0.34], [-0.26, 0.46, 0.08, 0.3], [0.1, 0.36, -0.2, 0.32], [-0.12, 0.95, -0.12, 0.3]]) k.add(`lump${x}`, k.sphere(d), [x, y, z], c.body);
      for (const [x, y, z] of [[0.24, 0.62, 0.24], [-0.2, 0.78, 0.22], [0.05, 0.4, 0.27], [-0.3, 0.6, -0.1]]) k.add(`spot${x}${y}`, k.sphere(0.05), [x, y, z], c.accent);
      k.arms(0.36, 0.66, 0.26, c.body);
      k.eyes([0, 0.74, 0.27], 0.13, 0.15);
      k.add('mouth', k.box(0.14, 0.03, 0.02), [0, 0.6, 0.29], '#3f2a18');
      return { head: [0, 0.74, 0], r: 0.3, top: 1.07 };
    },
    duck(k, c) {
      k.add('body', k.sphere(0.95, [1, 0.62, 1.15]), [0, 0.3, 0], c.body);
      k.add('head', k.sphere(0.58), [0, 0.78, 0.22], c.body);
      k.add('tail', k.cyl(0, 0.3, 0.32, 10), [0, 0.5, -0.5], c.body, { rot: [-0.9, 0, 0] });
      k.add('beak', k.sphere(0.32, [1, 0.42, 1.1]), [0, 0.72, 0.52], c.accent);
      k.add('wingL', k.sphere(0.36, [0.4, 0.62, 1]), [0.44, 0.34, -0.02], c.body);
      k.add('wingR', k.sphere(0.36, [0.4, 0.62, 1]), [-0.44, 0.34, -0.02], c.body);
      k.add('eyeL', k.sphere(0.1), [0.15, 0.86, 0.44], c.detail);
      k.add('eyeR', k.sphere(0.1), [-0.15, 0.86, 0.44], c.detail);
      return { head: [0, 0.8, 0.22], r: 0.29, top: 1.07 };
    },
    tvbot(k, c) {
      k.legs(0.14, 0.62, 0.09, c.body);
      k.add('torso', k.box(0.56, 0.5, 0.36), [0, 0.86, 0], c.body);
      k.add('chest', k.box(0.24, 0.14, 0.02), [0, 0.9, 0.19], c.accent, { glow: true });
      k.arms(0.33, 1.06, 0.5, c.body);
      k.add('neck', k.cyl(0.12, 0.12, 0.12), [0, 1.16, 0], c.detail);
      k.add('tv', k.box(0.86, 0.62, 0.52), [0, 1.52, 0], c.body);
      k.add('screen', k.box(0.68, 0.46, 0.02), [0, 1.52, 0.265], c.accent, { glow: true });
      k.add('eyeL', k.box(0.09, 0.14, 0.02), [0.14, 1.56, 0.28], '#0b0d12');
      k.add('eyeR', k.box(0.09, 0.14, 0.02), [-0.14, 1.56, 0.28], '#0b0d12');
      k.add('smile', k.box(0.24, 0.035, 0.02), [0, 1.42, 0.28], '#0b0d12');
      for (const sx of [-1, 1]) {
        k.add(`ant${sx}`, k.cyl(0.02, 0.02, 0.4), [sx * 0.14, 1.97, -0.05], c.detail, { rot: [0, 0, -sx * 0.45] });
        k.add(`antTip${sx}`, k.sphere(0.07), [sx * 0.23, 2.15, -0.05], c.accent, { glow: true });
      }
      return { head: [0, 1.52, 0], r: 0.27, top: 1.84 };
    },
    rollbot(k, c) {
      const ball = k.add('ball', k.sphere(0.9, [1, 1, 1], 1, 18), [0, 0.45, 0], c.body);
      k.add('band', k.torus(0.9, 0.07), [0, 0, 0], c.accent, { parent: ball, rot: [0, 0, Math.PI / 2] });
      k.add('band2', k.torus(0.9, 0.05), [0, 0, 0], c.detail, { parent: ball });
      k.roll(ball, 0.45);
      k.add('neck', k.cyl(0.14, 0.18, 0.12), [0, 0.92, 0], c.detail);
      k.add('dome', k.sphere(0.5, [1, 0.8, 1], 0.55), [0, 0.94, 0], c.body);
      k.add('visor', k.box(0.36, 0.1, 0.04), [0, 1.08, 0.21], c.accent, { glow: true });
      k.add('ant', k.cyl(0.02, 0.02, 0.3), [0.1, 1.28, 0], c.detail);
      k.add('antTip', k.sphere(0.08), [0.1, 1.45, 0], c.accent, { glow: true });
      return { head: [0, 1.06, 0], r: 0.22, top: 1.22 };
    },
  };

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
      head = thing(kit(rig, holder, shade), c);
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
