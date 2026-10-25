// Presence, part 1e: the three machines you can be, rebuilt as hard-surface toys (docs/characters.md 5d): the robot, the TV robot and
// the roll-bot. Still the family's one shared rim-lit material and vertex colors, but their forms are beveled (chamfered boxes with a
// highlight on every edge), they carry panel lines, rivets, vents and pistons, and their faces are lit screens (the same five
// expression numbers as every face: eyes, brows and a mouth drawn in light). Their parts move on their own:
//   the robot       two-piston legs lift each foot, a piston neck, arms with a piston forearm, a whip antenna on a spring; hums (the
//                   chest lights breathe, the body trembles a hair), scans (the head sweeps left and right) when left alone
//   the TV robot    a TV on a chassis with two lugged wheels that turn with the distance on piston struts; rabbit-ear antennas that
//                   sway and splay; static rolls over the screen; hearts when it loves something
//   the roll-bot    a ball with a lugged tread band and seams that rolls, a yoke with hubs, a dome head on a piston neck, a whip antenna
// Each one boots up when it appears (rig.time 0; /avatars?pose=boot loops it): a ring of light climbs from the floor with a beam above
// it, the body stands dark under it, then the screen flickers on, the lights chase and the antenna jolts.
// Registered through presence-things.js (P.things.register), so the API, the sync and the mirror are as for every thing.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const P = (H.presence = H.presence || {});
  if (!P.things || !P.things.register) return;
  const C = () => P.core;
  const { Geo, rev, ball, sweep, capsule, radial, paint, flat, toon, tonesRgb, rgb, mix3, clamp, ease, bump, TAU, spring, sp, tilt, addFace } = P.things.kit;

  // ------------------------------------------------------------------ hard-surface geometry
  /** A box with its edges chamfered by `b`: 6 faces, 12 edge strips and 8 corner triangles (44 triangles). color({ p, n, e }): e is how far the normal is from an axis (0 on a face, 0.29 on a chamfer, 0.42 on a corner), for the edge highlight. */
  function bevel(g, at, size, b, color) {
    const Hh = [size[0] / 2, size[1] / 2, size[2] / 2], bb = Math.min(b, Hh[0] * 0.9, Hh[1] * 0.9, Hh[2] * 0.9), I = Hh.map((h) => h - bb);
    const vert = (p, n) => { const l = Math.hypot(n[0], n[1], n[2]) || 1, nn = [n[0] / l, n[1] / l, n[2] / l], q = [at[0] + p[0], at[1] + p[1], at[2] + p[2]]; return g.vert(q, nn, color({ p: q, n: nn, e: 1 - Math.max(Math.abs(nn[0]), Math.abs(nn[1]), Math.abs(nn[2])) })); };
    // a point where each axis is on its face (H), inset (I) or at the far inset (-I)
    const pt = (spec) => spec.map((s, k) => (s === 2 ? Hh[k] : s === -2 ? -Hh[k] : s * I[k]));
    for (let w = 0; w < 3; w++) for (const sg of [1, -1]) {
      const u = (w + 1) % 3, v = (w + 2) % 3, n = [0, 0, 0]; n[w] = sg;
      const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b2]) => { const s = [0, 0, 0]; s[w] = 2 * sg; s[u] = a; s[v] = b2; return vert(pt(s), n); });
      g.tri(ids[0], ids[1], ids[2]); g.tri(ids[0], ids[2], ids[3]);
    }
    for (let w1 = 0; w1 < 3; w1++) for (let w2 = w1 + 1; w2 < 3; w2++) for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
      const t = 3 - w1 - w2, n = [0, 0, 0]; n[w1] = s1; n[w2] = s2;
      const ids = [-1, 1].flatMap((e) => { const a = [0, 0, 0], c = [0, 0, 0]; a[w1] = 2 * s1; a[w2] = s2; a[t] = e; c[w1] = s1; c[w2] = 2 * s2; c[t] = e; return [vert(pt(a), n), vert(pt(c), n)]; });
      g.tri(ids[0], ids[1], ids[2]); g.tri(ids[1], ids[3], ids[2]);
    }
    for (const s0 of [1, -1]) for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
      const n = [s0, s1, s2], sp3 = (k) => { const a = [s0, s1, s2]; a[k] = 2 * a[k]; return vert(pt(a), n); };
      g.tri(sp3(0), sp3(1), sp3(2));
    }
  }
  /** A plain flat-faced box (panel lines, vents, rivets): 12 triangles. */
  function slab(g, at, size, c) {
    const h = [size[0] / 2, size[1] / 2, size[2] / 2];
    for (const [ax, sg] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
      const u = (ax + 1) % 3, v = (ax + 2) % 3, n = [0, 0, 0]; n[ax] = sg;
      const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const p = [0, 0, 0]; p[ax] = sg * h[ax]; p[u] = a * h[u]; p[v] = b * h[v]; return g.vert([at[0] + p[0], at[1] + p[1], at[2] + p[2]], n, c); });
      g.tri(ids[0], ids[1], ids[2]); g.tri(ids[0], ids[2], ids[3]);
    }
  }
  /** A cylinder along y (rotZ turns it to x, rotX to z): crisp caps, flat shading by `color`. */
  const cylinder = (g, at, r, h, color, o = {}) => rev(g, [[0, -h / 2, 0, -1], [r, -h / 2, 0, -1], [r, -h / 2, 1, 0], [r, h / 2, 1, 0], [r, h / 2, 0, 1], [0, h / 2, 0, 1]], { segs: o.segs || 10, at, rotX: o.rotX, rotZ: o.rotZ, color });
  const AXIS = { x: { rotZ: -Math.PI / 2 }, y: {}, z: { rotX: Math.PI / 2 } };
  const cyl = (g, at, r, h, color, axis = 'y', segs = 10) => cylinder(g, at, r, h, color, { ...AXIS[axis], segs });
  /** The shell's colors: the toy's two soft steps, plus a lit edge on every chamfer. */
  const shell = (t) => ({ n, e }) => { const c = toon(t, n[1] * 0.95 + n[0] * 0.18); const k = clamp((e || 0) * 3, 0, 1) * 0.75; return k > 0 ? mix3(c, t.light, k) : c; };
  const STEEL = tonesRgb('#cdd4df'), DARK = tonesRgb('#2b303b');
  const dark = (t) => mix3(t.shade, [0.05, 0.06, 0.09], 0.5);
  const lightOf = (hex, fallback) => rgb(C().tones(!hex || hex === '#ffffff' ? fallback : hex).light);
  const accentOf = (look, fallback) => (look.accent === '#ffffff' ? fallback : look.accent);

  /** A lit stand-in for the arrival: a ring of light with a beam above it, one mesh on a joint the animation lifts. */
  function bootBeam(x, radius, color) {
    const g = x.g(), c = lightOf(color, '#7dd3fc');
    rev(g, [[radius, -0.012, 0, -1], [radius + 0.03, 0, 1, 0], [radius, 0.012, 0, 1], [radius - 0.03, 0, -1, 0]], { segs: 20, at: [0, 0, 0], color: flat(c) });
    cyl(g, [0, 1.6, 0], 0.045, 3.2, flat(mix3(c, [1, 1, 1], 0.5)), 'y', 5);
    // (made on the first boot: a beam in the body's bounds would be measured as part of its height)
    // (and it hangs on the pose, beside the body rather than in it: the body's height is its own)
    const j = x.joint('beam', [0, 0, 0], x.rig.pose), o = { j, m: null, place(top, rr, body) { const hd = x.rig.body, k = x.rig.bodyScale || 1; j.position.set(hd.position.x, hd.position.y + top * k, hd.position.z); j.scaling.set(rr * k, k / body, rr * k); }, show(on) { if (on && !o.m) o.m = x.mk('beam', g, j, { glow: true }); if (o.m) o.m.setEnabled(on); } };
    return o;
  }
  /** The boot-up's shared timeline: where the ring is (0..1 of the height), (the body keeps its size: the mirror and the hats measure it from the first frame) and how far the screen has come on. */
  function bootState(bu) {
    if (bu < 0) return { on: false, rise: 1, body: 1, screen: 1, flick: 1, beam: 0 };
    const rise = ease(bu / 0.5), body = 1;
    const flick = bu < 0.66 ? 0 : bu < 0.7 ? 1 : bu < 0.74 ? 0 : bu < 0.8 ? 1 : bu < 0.83 ? 0.2 : 1;
    return { on: true, rise, body, screen: bu < 0.66 ? 0 : flick, flick, beam: bu < 0.58 ? 1 : 0 };
  }
  const ledWave = (bu, t, i, n) => { if (bu < 0) return 1; const k = (bu - 0.55) / 0.35 * (n + 1); return k < i ? 0.25 : k < i + 1 ? 1.5 : 1; };

  /** Arms for a machine: shoulder joints and a beveled arm with a piston forearm and a claw hand (the walk and the emotes swing the joints). */
  function machineArms(x, apart, y, len, t, trim) {
    const { rig } = x;
    rig.shL = x.joint('shL', [apart, y, 0]); rig.shR = x.joint('shR', [-apart, y, 0]);
    const g = x.g();
    bevel(g, [0, -len * 0.3, 0], [0.105, len * 0.5, 0.105], 0.025, shell(t));
    cyl(g, [0.0, -len * 0.62, 0], 0.03, len * 0.26, paint(STEEL), 'y', 6);
    bevel(g, [0, -len * 0.82, 0], [0.09, len * 0.3, 0.09], 0.022, shell(trim));
    bevel(g, [0, -len - 0.02, 0.0], [0.115, 0.095, 0.115], 0.03, shell(tonesRgb('#454b59')));
    slab(g, [0, -len * 0.3, 0.054], [0.07, 0.012, 0.004], dark(t));
    x.mk('armL', g, rig.shL); x.mk('armR', g, rig.shR);
    rig.shL.rotation.z = 0.06; rig.shR.rotation.z = -0.06;
  }
  const rivets = (g, pts, c) => { for (const p of pts) slab(g, p, [0.018, 0.018, 0.018], c); };

  // ------------------------------------------------------------------ the robot
  P.things.register('robot', (x) => {
    const { cols: { b, a, d }, joint, rig, look } = x;
    const accent = accentOf(look, '#3ee6ff'), glowC = lightOf(accent, '#3ee6ff'), ink = x.ink;
    const sh = shell(b), trim = shell(d), TRIM = tonesRgb('#454b59');
    // legs: a beveled thigh sleeve, a piston rod that slides in it, an ankle and a flat foot
    rig.hipL = joint('hipL', [0.17, 0.62, 0]); rig.hipR = joint('hipR', [-0.17, 0.62, 0]); rig.legged = true;
    const shin = [], lg = x.g();
    bevel(lg, [0, -0.17, 0], [0.15, 0.27, 0.15], 0.03, sh);
    cyl(lg, [0, -0.31, 0], 0.085, 0.03, flat(dark(b)), 'y', 10);
    slab(lg, [0, -0.1, 0.077], [0.07, 0.01, 0.004], dark(b));
    const sg = x.g();
    cyl(sg, [0, -0.25, 0], 0.036, 0.3, paint(STEEL), 'y', 8);
    cyl(sg, [0, -0.5, 0], 0.06, 0.13, paint(TRIM), 'y', 10);
    bevel(sg, [0, -0.575, 0.05], [0.19, 0.09, 0.33], 0.03, shell(d));
    slab(sg, [0, -0.53, 0.065], [0.12, 0.012, 0.12], dark(d));
    for (const [hip, n] of [[rig.hipL, 'L'], [rig.hipR, 'R']]) { x.mk(`legTop${n}`, lg, hip); const sj = joint(`shin${n}`, [0, 0, 0], hip); x.mk(`legLow${n}`, sg, sj); shin.push(sj); }
    // the body: pelvis, torso with a chest panel, vents, panel lines and rivets, collar
    const g = x.g();
    bevel(g, [0, 0.68, 0], [0.5, 0.14, 0.28], 0.04, shell(TRIM));
    bevel(g, [0, 1.0, 0], [0.56, 0.5, 0.34], 0.06, sh);
    slab(g, [0, 0.81, 0], [0.566, 0.012, 0.346], dark(b));
    slab(g, [0, 1.2, 0], [0.566, 0.012, 0.346], dark(b));
    slab(g, [0, 1.0, 0.171], [0.012, 0.5, 0.01], dark(b));
    bevel(g, [0, 1.07, 0.17], [0.32, 0.22, 0.03], 0.012, shell(DARK));
    for (let i = 0; i < 4; i++) slab(g, [0, 0.9 + i * 0.026, 0.18], [0.2, 0.01, 0.01], dark(b));
    for (const s of [1, -1]) bevel(g, [s * 0.37, 1.2, 0], [0.13, 0.15, 0.22], 0.04, trim);
    rivets(g, [[0.23, 1.2, 0.172], [-0.23, 1.2, 0.172], [0.23, 0.83, 0.172], [-0.23, 0.83, 0.172], [0.37, 1.27, 0.115], [-0.37, 1.27, 0.115]], paint(STEEL)({ n: [0, 1, 0] }));
    cyl(g, [0, 1.275, 0], 0.095, 0.05, paint(TRIM), 'y', 8);
    x.mk('body', g, x.holder);
    const lg2 = x.g();
    for (const [i, px] of [-0.08, 0, 0.08].entries()) ball(lg2, [px, 0, 0], [0.026, 0.026, 0.012], flat(glowC), { segs: 8, rings: 3 }), void i;
    const chest = joint('chest', [0, 1.07, 0.187]); x.mk('lights', lg2, chest, { glow: true });
    // the head: a beveled box on a piston neck, ear discs, a visor with the lit face, vents, a whip antenna
    const headJ = joint('head', [0, 1.3, 0]), hg = x.g();
    cyl(hg, [0, -0.02, 0], 0.045, 0.2, paint(STEEL), 'y', 8);
    bevel(hg, [0, 0.27, 0], [0.62, 0.44, 0.48], 0.07, sh);
    bevel(hg, [0, 0.31, 0.24], [0.5, 0.28, 0.05], 0.02, shell(DARK));
    for (const s of [1, -1]) { cyl(hg, [s * 0.33, 0.28, 0], 0.095, 0.06, paint(d), 'x', 8); cyl(hg, [s * 0.365, 0.28, 0], 0.045, 0.03, flat(glowC), 'x', 6); }
    for (let i = 0; i < 3; i++) slab(hg, [0, 0.484, -0.04 - i * 0.05], [0.26, 0.008, 0.02], dark(b));
    slab(hg, [0, 0.27, 0.0], [0.626, 0.012, 0.486], dark(b));
    cyl(hg, [0, 0.045, 0.02], 0.13, 0.07, paint(TRIM), 'y', 8);
    rivets(hg, [[0.26, 0.45, 0.245], [-0.26, 0.45, 0.245], [0.26, 0.1, 0.245], [-0.26, 0.1, 0.245]], paint(STEEL)({ n: [0, 1, 0] }));
    x.mk('head', hg, headJ);
    const F = addFace(x, headJ, [0, 0.31, 0], { surf: () => 0.268, ex: 0.11, ey: 0.02, er: 0.052, ery: 0.075, mouth: { y: -0.085, w: 0.1, th: 0.022, color: accent }, brow: { y: 0.1, w: 0.045, color: accent }, screen: { color: accent }, lid: '#0d1117', cheek: null, z: 0.004 });
    const ant = joint('antenna', [0.2, 0.49, -0.08], headJ), ag = x.g();
    cyl(ag, [0, 0.02, 0], 0.045, 0.04, paint(TRIM), 'y', 8);
    sweep(ag, (t) => [0, 0.04 + t * 0.3, 0], () => 0.014, paint(STEEL), { steps: 3, segs: 5 });
    x.mk('antenna', ag, ant);
    const tipG = x.g(); ball(tipG, [0, 0.36, 0], [0.05, 0.05, 0.05], flat(glowC), { segs: 8, rings: 4 });
    const tip = joint('tip', [0, 0, 0], ant); x.mk('antennaTip', tipG, tip, { glow: true });
    machineArms(x, 0.4, 1.2, 0.52, b, d);
    const BEAM = bootBeam(x, 0.5, accent);
    const sA = sp(), sAx = sp(), sH = sp(), sY = sp();
    let flashed = false;
    return {
      head: { head: [0, 1.58, 0], r: 0.3, top: 1.8, front: 0.28 }, F, gagFace: 'neutral', sigFace: 'happy', gagDur: 3.4, sigDur: 2.2, bootDur: 1.6, bootFace: 'neutral',
      faceExtra: (c) => { const bs = bootState(c.bu); return { lid: bs.on ? 1 - bs.screen : 0 }; },
      anim(rig, c) {
        const w = c.s, ph = c.ph, bs = bootState(c.bu), t = c.t, idleK = clamp(1 - c.sp / 0.6, 0, 1);
        // scanning: left alone, the head drifts side to side; the gag is a full scan, the visor following
        let yaw = Math.sin(t * 0.45) * 0.22 * idleK, gaze = null;
        if (c.gu >= 0) { const u = c.gu; yaw = Math.sin(u * TAU * 1.0) * 0.85 * bump(Math.min(1, u * 1.15)); gaze = [yaw * 0.9, 0]; }
        let hop = 0, pump = 0;
        if (c.su >= 0) { const u = c.su; pump = bump(u); hop = Math.abs(Math.sin(u * 16)) * 0.08 * pump; yaw += Math.sin(u * 12) * 0.25 * pump; }
        // the legs: each foot lifts on its piston as that leg swings forward
        const sw = Math.sin(ph);
        shin[0].position.y = Math.max(0, sw) * 0.075 * w; shin[1].position.y = Math.max(0, -sw) * 0.075 * w;
        const hum = (1 - w) * Math.sin(t * 61) * 0.0016 * (bs.on ? 0 : 1);
        tilt(rig, w * 0.05 + c.run * 0.12, Math.sin(ph) * 0.03 * w, 0, hop + Math.abs(sw) * 0.02 * w + hum, 1);
        headJ.position.y = 1.3 + Math.sin(t * 2.1) * 0.006 + Math.abs(Math.sin(ph * 2)) * 0.02 * w + pump * 0.03 * Math.abs(Math.sin(c.su * 24));
        headJ.rotation.y = spring(sY, yaw, 3.2, 0.55, c.dt); headJ.rotation.x = -w * 0.04 + Math.sin(t * 1.4) * 0.012;
        // the antenna whips: a spring fed by the speed and by the beat of its own hum
        const kick = bs.on ? (c.bu > 0.7 && c.bu < 0.78 ? 1 : 0) : 0;
        ant.rotation.z = spring(sA, -clamp(c.sp / 6, 0, 1) * 0.55 + Math.sin(t * 1.7) * 0.05 + pump * Math.sin(c.su * 40) * 0.25 + kick * 0.5, 3.4, 0.28, c.dt);
        ant.rotation.x = spring(sAx, Math.sin(t * 1.3 + 1) * 0.04 + w * 0.12 - kick * 0.3, 3, 0.3, c.dt);
        const pulse = 1 + Math.sin(t * (2.4 + w * 4 + pump * 8)) * 0.18;
        chest.scaling.set(pulse, pulse, 1); const tp = 1 + Math.sin(t * 3.1) * 0.15 + pump * 0.5; tip.scaling.set(tp, tp, tp);
        const wave = bs.on ? ledWave(c.bu, t, 0, 3) : 1; chest.scaling.x *= wave; chest.scaling.y *= wave;
        // the boot's beam: the ring climbs the body, the beam above it
        BEAM.show(bs.beam > 0);
        if (bs.beam > 0) { BEAM.place(2.2, 1 - bs.rise * 0.3, bs.body); }
        void flashed;
        this.gaze = gaze;
        void sH;
      },
    };
  });

  // ------------------------------------------------------------------ the TV robot
  P.things.register('tvbot', (x) => {
    const { cols: { b, a, d }, joint, rig, look } = x;
    const accent = accentOf(look, '#7dd3fc'), glowC = lightOf(accent, '#7dd3fc');
    const sh = shell(b), TRIM = tonesRgb('#454b59'), RUB = tonesRgb('#1c2029');
    // the chassis: a beveled base with panel lines, headlights; two lugged wheels on piston struts
    const g = x.g();
    bevel(g, [0, 0.29, 0], [0.54, 0.17, 0.46], 0.05, sh);
    slab(g, [0, 0.29, 0], [0.546, 0.012, 0.466], dark(b));
    for (const s of [1, -1]) { cyl(g, [s * 0.275, 0.3, 0.1], 0.04, 0.24, flat(dark(b)), 'y', 6); slab(g, [s * 0.1, 0.3, 0.232], [0.12, 0.014, 0.006], dark(b)); }
    bevel(g, [0, 0.62, 0], [0.5, 0.44, 0.34], 0.06, sh);
    slab(g, [0, 0.52, 0], [0.506, 0.012, 0.346], dark(b));
    bevel(g, [0, 0.67, 0.172], [0.3, 0.2, 0.03], 0.012, shell(DARKT()));
    for (let i = 0; i < 4; i++) slab(g, [0, 0.6 + i * 0.027, 0.19], [0.22, 0.012, 0.01], flat(dark(b))({}));
    rivets(g, [[0.2, 0.8, 0.172], [-0.2, 0.8, 0.172], [0.2, 0.46, 0.172], [-0.2, 0.46, 0.172]], paint(STEEL)({ n: [0, 1, 0] }));
    for (const s of [1, -1]) bevel(g, [s * 0.3, 0.8, 0], [0.12, 0.13, 0.22], 0.04, shell(d));
    cyl(g, [0, 0.855, 0], 0.09, 0.06, paint(TRIM), 'y', 8);
    x.mk('chassis', g, x.holder);
    rig.hipL = joint('hipL', [0.37, 0.2, 0]); rig.hipR = joint('hipR', [-0.37, 0.2, 0]); rig.legged = true;
    const R = 0.2, spins = [], tire = x.g();
    rev(tire, [[0, -0.07, 0, -1], [0.15, -0.07, 0, -1], [R, -0.04, 0.8, -0.6], [R, 0.04, 1, 0], [0.15, 0.07, 0, 1], [0, 0.07, 0, 1]], { segs: 20, rotZ: -Math.PI / 2, color: paint(RUB), mod: (ang, t, y) => (Math.abs(y) < 0.05 ? 1 + 0.075 * (Math.cos(ang * 10) > 0.15 ? 1 : 0) : 1) });
    cyl(tire, [0.072, 0, 0], 0.095, 0.02, flat(glowC), 'x', 8);
    cyl(tire, [-0.072, 0, 0], 0.095, 0.02, flat(glowC), 'x', 8);
    for (const [hip, n, sgn] of [[rig.hipL, 'L', 1], [rig.hipR, 'R', -1]]) {
      const strut = x.g();
      cyl(strut, [-sgn * 0.12, 0.17, 0], 0.03, 0.36, paint(STEEL), 'y', 6);
      bevel(strut, [-sgn * 0.06, 0.02, 0], [0.04, 0.09, 0.09], 0.01, shell(TRIM));
      const sj = joint(`spin${n}`, [0, 0, 0], hip); x.mk(`wheel${n}`, tire, sj);
      x.mk(`strut${n}`, strut, hip);
      spins.push(sj);
    }
    // the head: a beveled TV with a dark glass, knobs, a speaker grille, vents and a neck piston
    const headJ = joint('tv', [0, 0.9, 0]), tg = x.g();
    cyl(tg, [0, 0.02, 0], 0.045, 0.2, paint(STEEL), 'y', 8);
    bevel(tg, [0, 0.46, 0], [1.0, 0.72, 0.6], 0.09, sh);
    bevel(tg, [0, 0.46, 0.3], [0.82, 0.58, 0.05], 0.025, shell(DARKT()));
    slab(tg, [0, 0.46, 0], [1.006, 0.012, 0.606], dark(b));
    for (let i = 0; i < 5; i++) slab(tg, [0.43, 0.52 - i * 0.045, 0.31], [0.05, 0.012, 0.01], dark(b));
    for (const [yy, c2] of [[0.62, d], [0.52, tonesRgb(accent)]]) cyl(tg, [0.535, yy, 0.0], 0.05, 0.05, paint(c2), 'x', 10);
    for (let i = 0; i < 4; i++) slab(tg, [0, 0.815, -0.1 - i * 0.07], [0.46, 0.01, 0.025], dark(b));
    rivets(tg, [[0.44, 0.78, 0.31], [-0.44, 0.78, 0.31], [0.44, 0.15, 0.31], [-0.44, 0.15, 0.31]], paint(STEEL)({ n: [0, 1, 0] }));
    x.mk('tv', tg, headJ);
    const F = addFace(x, headJ, [0, 0.46, 0], { surf: (xx, yy) => 0.334 - (xx * xx + yy * yy) * 0.03, ex: 0.17, ey: 0.06, er: 0.065, ery: 0.1, mouth: { y: -0.13, w: 0.11, th: 0.03, color: accent }, brow: { y: 0.19, w: 0.045, color: accent }, screen: { color: accent }, lid: '#0d1117', cheek: null, z: 0.005 });
    const ant = joint('antennas', [0, 0.83, -0.05], headJ), ag = x.g();
    cyl(ag, [0, 0.01, 0], 0.07, 0.04, paint(TRIM), 'y', 10);
    for (const s of [1, -1]) sweep(ag, (t) => [s * t * 0.2, 0.02 + t * 0.36, 0], () => 0.014, paint(STEEL), { steps: 3, segs: 5, ref: [0, 0, 1] });
    x.mk('antennas', ag, ant);
    const tg2 = x.g(); for (const s of [1, -1]) ball(tg2, [s * 0.2, 0.4, 0], [0.05, 0.05, 0.05], flat(glowC), { segs: 8, rings: 3 });
    const tips = joint('tips', [0, 0, 0], ant); x.mk('antennaTips', tg2, tips, { glow: true });
    machineArms(x, 0.34, 0.8, 0.5, b, d);
    // static: grey bars that crawl over the glass (a lit mesh, shown for a moment)
    const sg = x.g(); for (let i = 0; i < 7; i++) { const yy = -0.24 + i * 0.08, c = 0.35 + ((i * 37) % 7) * 0.09; slab(sg, [0, yy, 0], [0.7, 0.045, 0.01], [c, c, c * 1.05]); }
    const stat = joint('static', [0, 0.46, 0.345], headJ); const stm = x.mk('static', sg, stat, { glow: true }); stm.setEnabled(false);
    const BEAM = bootBeam(x, 0.55, accent);
    const sA = sp(), sS = sp(); let spin = 0;
    return {
      head: { head: [0, 1.36, 0], r: 0.4, top: 1.78, front: 0.36 }, F, gagFace: 'surprised', sigFace: 'happy', gagDur: 2.4, sigDur: 2, bootDur: 1.6, bootFace: 'neutral',
      faceExtra: (c) => { const bs = bootState(c.bu); return { lid: bs.on ? 1 - bs.screen : 0 }; },
      anim(rig, c) {
        const w = c.s, st = Math.sin(c.ph), bs = bootState(c.bu), t = c.t;
        spin += (c.sp * c.dt) / (R * (rig.bodyScale || 1));
        for (const s of spins) s.rotation.x = spin;
        // the struts take the bumps: each wheel rides up and down on its piston at its own beat
        rig.hipL.rotation.x = 0; rig.hipR.rotation.x = 0;
        rig.hipL.position.y = 0.2 + Math.max(0, Math.sin(spin * 2.3)) * 0.02 * w; rig.hipR.position.y = 0.2 + Math.max(0, Math.sin(spin * 2.3 + 1.7)) * 0.02 * w;
        let rz = Math.sin(spin * 1.1) * 0.012 * w, rx = w * 0.07 + c.run * 0.1, lift = 0, noise = 0, love = 0;
        const idleK = clamp(1 - c.sp / 0.6, 0, 1), hum = idleK * Math.sin(t * 57) * 0.0014;
        if (c.gu >= 0) { noise = bump(c.gu) > 0.2 ? 1 : 0; rz += Math.sin(t * 30) * 0.012 * noise; }
        if (c.su >= 0) { const u = c.su; love = bump(clamp(u * 1.1, 0, 1)); lift += Math.abs(Math.sin(u * 14)) * 0.07 * love; rz += Math.sin(u * 14) * 0.05 * love; }
        tilt(rig, rx, rz, 0, lift + (bs.on ? 0 : hum), 1);
        // idle: the head scans a little side to side, the neck piston breathes
        headJ.position.y = 0.9 + Math.sin(t * 2.2) * 0.006 + Math.abs(st) * 0.012 * w;
        headJ.rotation.y = Math.sin(t * 0.5) * 0.14 * idleK; headJ.rotation.z = Math.sin(spin * 1.1) * 0.015 * w;
        const kick = bs.on ? (c.bu > 0.7 && c.bu < 0.78 ? 1 : 0) : 0;
        const a2 = spring(sA, -clamp(c.sp / 6, 0, 1) * 0.35 + Math.sin(t * 1.5) * 0.05 + love * 0.4 + kick * 0.5, 4, 0.3, c.dt), sp2 = spring(sS, w * 0.12 + love * 0.3 + kick * 0.3, 3.5, 0.25, c.dt);
        ant.rotation.z = a2 * 0.5; ant.rotation.x = Math.sin(t * 2) * 0.03 - w * 0.12; ant.scaling.x = 1 + sp2; tips.rotation.copyFrom(ant.rotation); tips.scaling.x = ant.scaling.x;
        stm.setEnabled(noise > 0);
        if (noise > 0) { stat.position.y = 0.46 + Math.sin(t * 26) * 0.03; stat.scaling.y = 0.7 + 0.5 * Math.abs(Math.sin(t * 9)); }
        F.heart = love > 0.2;
        const tsc = 1 + love * 0.6 * Math.abs(Math.sin(t * 10)) + Math.sin(t * 3) * 0.1; tips.scaling.y = tsc; tips.scaling.z = tsc;
        BEAM.show(bs.beam > 0);
        if (bs.beam > 0) { BEAM.place(2.15, 1 - bs.rise * 0.3, bs.body); }
      },
    };
  });
  /** (a dark glass tone, made on demand so the module has no load-order trap) */
  function DARKT() { return tonesRgb('#12161e'); }

  // ------------------------------------------------------------------ the roll-bot
  P.things.register('rollbot', (x) => {
    const { cols: { b, a, d }, joint, rig, look } = x;
    const accent = accentOf(look, '#22d3ee'), glowC = lightOf(accent, '#22d3ee'), AC = tonesRgb(accent), sh = shell(b), TRIM = tonesRgb('#454b59'), RUB = tonesRgb('#1c2029');
    const ballJ = joint('ball', [0, 0.46, 0]), g = x.g(), RB = 0.46;
    // the ball: panelled in the shell's color, a lugged tread band around the rolling axis, two seam rings, rivets between
    const bc = ({ n }) => toon(b, n[1]);
    ball(g, [0, 0, 0], [RB, RB, RB], bc, { segs: 16, rings: 8 });
    const ringProfile = (r, th) => [[r, th, 0, 1], [r + th, 0, 1, 0], [r, -th, 0, -1]];
    rev(g, [[RB * 0.55, -0.075, 0, -1], [RB * 0.97, -0.07, 0.3, -0.9], [RB * 1.04, -0.05, 0.8, -0.6], [RB * 1.05, 0.05, 1, 0], [RB * 0.97, 0.07, 0.3, 0.9], [RB * 0.55, 0.075, 0, 1]], { segs: 24, rotZ: -Math.PI / 2, color: paint(RUB), mod: (ang, t) => (t > 0.15 && t < 0.85 ? 1 + 0.05 * (Math.cos(ang * 12) > 0.1 ? 1 : 0) : 1) });
    for (const sx of [0.22, -0.22]) rev(g, ringProfile(RB * Math.sqrt(1 - (sx / RB) ** 2) + 0.004, 0.009), { segs: 20, at: [sx, 0, 0], rotZ: -Math.PI / 2, color: flat(dark(b)) });
    rev(g, ringProfile(RB + 0.003, 0.01), { segs: 20, at: [0, 0, 0], color: flat(dark(b)) });
    rev(g, ringProfile(RB + 0.004, 0.01), { segs: 20, at: [0, 0, 0], rotX: Math.PI / 2, color: flat(mix3(AC.base, AC.shade, 0.2)) });
    x.mk('ball', g, ballJ);
    // the yoke: hubs on the axle, two forks up the sides, a bridge and the neck sleeve over the top (it does not roll)
    const yoke = joint('yoke', [0, 0.46, 0]), yg = x.g();
    for (const s of [1, -1]) {
      cyl(yg, [s * 0.5, 0, 0], 0.14, 0.07, paint(TRIM), 'x', 10); cyl(yg, [s * 0.54, 0, 0], 0.07, 0.03, flat(glowC), 'x', 8);
      bevel(yg, [s * 0.5, 0.31, 0], [0.065, 0.46, 0.13], 0.02, sh);
      bevel(yg, [s * 0.38, 0.56, 0], [0.3, 0.07, 0.14], 0.02, sh);
    }
    bevel(yg, [0, 0.56, 0], [0.44, 0.075, 0.16], 0.025, shell(TRIM));
    cyl(yg, [0, 0.62, 0], 0.095, 0.08, paint(TRIM), 'y', 10);
    rivets(yg, [[0.5, 0.5, 0.068], [-0.5, 0.5, 0.068], [0.5, 0.12, 0.068], [-0.5, 0.12, 0.068]], paint(STEEL)({ n: [0, 1, 0] }));
    x.mk('yoke', yg, yoke);
    // the head: a dome with a dark visor ring, an accent seam, vents, a piston neck rod; the lit face on the visor
    const headJ = joint('head', [0, 1.1, 0]), dg = x.g();
    cyl(dg, [0, -0.1, 0], 0.045, 0.22, paint(STEEL), 'y', 8);
    rev(dg, [[0.0, 0.0, 0, -1], [0.38, 0.0, 0.2, -0.9], [0.5, 0.12, 1, -0.1], [0.52, 0.3, 1, 0.1], [0.42, 0.5, 0.7, 0.7], [0.22, 0.64, 0.3, 0.95], [0.0, 0.68, 0, 1]], { segs: 20, color: shell(b), smooth: true });
    rev(dg, [[0.505, 0.12, 0, -1], [0.522, 0.14, 1, 0], [0.535, 0.3, 1, 0.1], [0.45, 0.47, 0.7, 0.7], [0.4, 0.485, 0, 1]], { segs: 20, color: flat(rgb('#10151d')) });
    rev(dg, ringProfile(0.43, 0.012), { segs: 20, at: [0, 0.52, 0], color: flat(mix3(AC.base, AC.shade, 0.2)) });
    for (let i = 0; i < 3; i++) slab(dg, [0, 0.66 - i * 0.006, -0.12 - i * 0.03], [0.14, 0.008, 0.015], dark(b));
    x.mk('dome', dg, headJ);
    const F = addFace(x, headJ, [0, 0.3, 0.0], { surf: radial([[-0.18, 0.505], [-0.16, 0.522], [0, 0.535], [0.17, 0.45]], 0.005), ex: 0.15, ey: 0.045, er: 0.065, ery: 0.09, mouth: { y: -0.1, w: 0.08, th: 0.024, color: accent }, brow: { y: 0.15, w: 0.05, color: accent }, screen: { color: accent }, lid: '#101820', cheek: null, z: 0.005 });
    const ant = joint('antenna', [0.2, 0.55, -0.15], headJ), ag = x.g();
    cyl(ag, [0, 0.02, 0], 0.05, 0.04, paint(TRIM), 'y', 8);
    sweep(ag, (t) => [0, 0.04 + t * 0.28, 0], () => 0.014, paint(STEEL), { steps: 3, segs: 5 });
    x.mk('antenna', ag, ant);
    const tipG = x.g(); ball(tipG, [0, 0.34, 0], [0.05, 0.05, 0.05], flat(glowC), { segs: 8, rings: 4 });
    const tip = joint('tip', [0, 0, 0], ant); x.mk('antennaTip', tipG, tip, { glow: true });
    // tiny arms: stubby beveled paddles at the dome's sides
    rig.shL = joint('shL', [0.56, 1.38, 0]); rig.shR = joint('shR', [-0.56, 1.38, 0]);
        const pg = x.g(); bevel(pg, [0, -0.1, 0], [0.07, 0.2, 0.1], 0.02, shell(d)); ball(pg, [0, -0.22, 0.01], [0.065, 0.06, 0.065], paint(TRIM), { segs: 8, rings: 3 });
    x.mk('armL', pg, rig.shL); x.mk('armR', pg, rig.shR);
    rig.shL.rotation.z = 0.2; rig.shR.rotation.z = -0.2;
    const BEAM = bootBeam(x, 0.55, accent);
    let rolled = 0;
    const sAn = sp(), sY = sp(), sN = { x: 1.1, v: 0 };
    return {
      head: { head: [0, 1.4, 0], r: 0.45, top: 1.78, front: 0.52 }, F, gagFace: 'surprised', sigFace: 'happy', gagDur: 3, sigDur: 1.7, bootDur: 1.6, bootFace: 'neutral',
      faceExtra: (c) => { const bs = bootState(c.bu); return { lid: bs.on ? 1 - bs.screen : 0 }; },
      anim(rig, c) {
        const sg2 = c.sp, bs = bootState(c.bu), t = c.t, w = c.s, idleK = clamp(1 - sg2 / 0.6, 0, 1);
        rolled += (sg2 * c.dt) / (RB * (rig.bodyScale || 1));
        let lean = clamp(sg2 / 8, 0, 0.5) * 0.6, lift = 0, sy = 1, ant2 = 0, scan = Math.sin(t * 0.55) * 0.2 * idleK, spinH = 0, gaze = null;
        if (c.gu >= 0) { const u = c.gu; scan = Math.sin(u * TAU) * 0.9 * bump(Math.min(1, u * 1.1)); ant2 = bump(u); gaze = [Math.sin(u * TAU) * 0.9, 0]; }
        if (c.su >= 0) { const u = c.su; spinH = ease(clamp((u - 0.1) / 0.7, 0, 1)) * TAU; lift = Math.sin(clamp((u - 0.1) / 0.7, 0, 1) * Math.PI) * 0.3; sy = u < 0.1 ? 1 - 0.18 * ease(u / 0.1) : 1; ant2 = bump(u) * 2; rolled += u > 0.1 && u < 0.8 ? 0.2 : 0; }
        tilt(rig, lean, 0, 0, lift + idleK * Math.sin(t * 59) * 0.0014, sy);
        ballJ.rotation.x = rolled;
        // the neck piston: the head sinks as the ball leans into a roll and bobs as it hums
        headJ.position.y = spring(sN, 1.1 - lean * 0.05 + Math.sin(t * 2.3) * 0.006 + (c.su >= 0 ? 0 : Math.abs(Math.sin(rolled * 2)) * 0.015 * w), 5, 0.4, c.dt);
        headJ.rotation.y = spring(sY, scan, 3.5, 0.5, c.dt) + spinH; headJ.rotation.x = -lean * 0.4 + Math.sin(t * 1.3) * 0.01;
        const kick = bs.on ? (c.bu > 0.7 && c.bu < 0.78 ? 1 : 0) : 0;
        ant.rotation.z = spring(sAn, -clamp(sg2 / 5, 0, 1) * 0.5 + Math.sin(t * 1.9) * 0.06 + Math.sin(t * 14) * 0.15 * ant2 + kick * 0.5, 3.5, 0.3, c.dt);
        const tp = 1 + Math.sin(t * 3.4) * 0.15 + ant2 * 0.3; tip.scaling.set(tp, tp, tp);
        rig.shL.rotation.z = 0.2 + clamp(sg2 / 5, 0, 1) * 0.5 + ant2 * 0.4; rig.shR.rotation.z = -0.2 - clamp(sg2 / 5, 0, 1) * 0.5 - ant2 * 0.4;
        BEAM.show(bs.beam > 0);
        if (bs.beam > 0) { BEAM.place(2.0, 1 - bs.rise * 0.3, bs.body); }
        this.gaze = gaze;
      },
    };
  });
})();
