// Presence, part 1c: the person, as a soft vinyl toy (docs/characters.md). Built from a few merged meshes with vertex colors and one
// shared material with a rim light (no textures): a big round head with a real face (eyes with pupils that follow, lids that
// blink, brows, a mouth that takes shapes: one small mesh whose points are rewritten when the face changes), six hairs, a
// soft body in the look's top, bottom and shoes colors (all tones from presence-core.js palette()). It moves like a toy: breathes,
// blinks, looks around, walks, runs, jumps, falls, swims and drives with squash and stretch, and its hair and shirt follow on
// damped springs. The rig keeps the old joints (hipL hipR shL shR neck pose root, faceY, faceZ), so emotes, hats, extras,
// the mirror, other players' views and the showcase work as they did. presence.js makeRig calls P.softPerson.build and animate calls
// P.softPerson.animate; rig.forcePose (the showcase) plays one pose on a loop.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const P = (H.presence = H.presence || {});
  const C = () => P.core;

  const HS = 1.48;            // the head is built small and scaled up: hats and glasses (built for the small head) follow it
  const NECK_Y = 0.14, HIP_Y = -0.38, FEET = -0.9;
  const HEAD = { cy: 0.22, rx: 0.21, ry: 0.223, rz: 0.206 };
  const EYE_X = 0.083, EYE_Y = 0.235, EYE_Z = 0.155, WR = [0.058, 0.062, 0.045]; // an eye's white: radii
  const FLIP = false;         // triangle winding (checked by test/engine/person.test.ts against Babylon's own sphere)

  // ------------------------------------------------------------------ geometry: lathes and domes with vertex colors
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const smooth = (x) => x * x * (3 - 2 * x);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const tonesRgb = (t) => ({ base: rgb(t.base), shade: rgb(t.shade), light: rgb(t.light) });
  /** Two soft steps: the underside takes the shade, the top the light, the sides the pick. */
  const toon = (t, ny) => { const s = clamp(ny * 1.5, -1, 1); return s < 0 ? mix3(t.base, t.shade, smooth(-s)) : mix3(t.base, t.light, smooth(s)); };

  class Geo {
    constructor() { this.p = []; this.n = []; this.c = []; this.i = []; }
    count() { return this.p.length / 3; }
    vert(p, n, c) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.c.push(c[0], c[1], c[2], 1); return this.p.length / 3 - 1; }
    tri(a, b, c) { if (a === b || b === c || a === c) return; if (FLIP) this.i.push(a, c, b); else this.i.push(a, b, c); }
  }
  /** scale, then rotate about z, then x, then move: points and normals. */
  function xf(o) {
    const [sx, sy, sz] = o.scale || [1, 1, 1], rz = o.rotZ || 0, rx = o.rotX || 0, at = o.at || [0, 0, 0];
    const cz = Math.cos(rz), sn = Math.sin(rz), cx = Math.cos(rx), sxn = Math.sin(rx);
    const rot = (x, y, z) => { const x1 = x * cz - y * sn, y1 = x * sn + y * cz; return [x1, y1 * cx - z * sxn, y1 * sxn + z * cx]; };
    return {
      p: (v) => { const r = rot(v[0] * sx, v[1] * sy, v[2] * sz); return [r[0] + at[0], r[1] + at[1], r[2] + at[2]]; },
      n: (v) => { const r = rot(v[0] / sx, v[1] / sy, v[2] / sz); const l = Math.hypot(r[0], r[1], r[2]) || 1; return [r[0] / l, r[1] / l, r[2] / l]; },
    };
  }
  /** Profile points [radius, y, normalRadius, normalY] turned around the y axis. */
  function lathe(g, profile, o) {
    const segs = o.segs || 10, T = xf(o), base = g.count(), m = profile.length;
    for (let k = 0; k < m; k++) {
      const [r, y] = profile[k];
      let nr = profile[k][2], ny = profile[k][3];
      if (nr === undefined) { const a = profile[Math.max(0, k - 1)], b = profile[Math.min(m - 1, k + 1)]; const dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1; nr = dy / l; ny = -dr / l; }
      for (let j = 0; j < segs; j++) {
        const ang = (j / segs) * Math.PI * 2, s = Math.sin(ang), c = Math.cos(ang);
        const p = T.p([r * s, y, r * c]), n = T.n([nr * s, ny, nr * c]);
        g.vert(p, n, o.color({ p, n }));
      }
    }
    for (let k = 0; k < m - 1; k++) for (let j = 0; j < segs; j++) {
      const a = base + k * segs + j, b = base + k * segs + (j + 1) % segs, c = base + (k + 1) * segs + j, d = base + (k + 1) * segs + (j + 1) % segs;
      g.tri(a, c, b); g.tri(b, c, d);
    }
  }
  const ELL = {};
  const ellipsoid = (rings) => ELL[rings] || (ELL[rings] = Array.from({ length: rings + 1 }, (_, k) => { const th = Math.PI - (Math.PI * k) / rings; return [Math.sin(th), Math.cos(th), Math.sin(th), Math.cos(th)]; }));
  /** A tapered capsule along y: bottom cap centered at y0 (radius r0), top at y1 (r1). */
  function capsule(y0, r0, y1, r1, rings = 4) {
    const out = [];
    for (let k = 0; k <= rings; k++) { const th = Math.PI - (Math.PI / 2) * (k / rings); out.push([r0 * Math.sin(th), y0 + r0 * Math.cos(th), Math.sin(th), Math.cos(th)]); }
    for (let k = 0; k <= rings; k++) { const th = Math.PI / 2 - (Math.PI / 2) * (k / rings); out.push([r1 * Math.sin(th), y1 + r1 * Math.cos(th), Math.sin(th), Math.cos(th)]); }
    return out;
  }
  const cone = [[0.0, 0, 0, -1], [1, 0, 0.9, -0.3], [0.55, 0.5, 0.9, 0.3], [0, 1, 0.5, 0.85]];
  /** Part of a sphere around the top: ring i runs from the top down to thetaMax(phi), so hair can stop higher at the front. */
  function dome(g, o) {
    const rows = o.rows || 7, cols = o.cols || 16, base = g.count();
    for (let i = 0; i <= rows; i++) for (let j = 0; j < cols; j++) {
      const phi = (j / cols) * Math.PI * 2, th = (i / rows) * o.thetaMax(phi);
      const d = [Math.sin(th) * Math.sin(phi), Math.cos(th), Math.sin(th) * Math.cos(phi)];
      const p = [o.center[0] + d[0] * o.radii[0], o.center[1] + d[1] * o.radii[1], o.center[2] + d[2] * o.radii[2]];
      let n = [d[0] / o.radii[0], d[1] / o.radii[1], d[2] / o.radii[2]]; const l = Math.hypot(n[0], n[1], n[2]); n = [n[0] / l, n[1] / l, n[2] / l];
      g.vert(p, n, o.color({ p, n }));
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = base + i * cols + j, b = base + i * cols + (j + 1) % cols, c = base + (i + 1) * cols + j, d = base + (i + 1) * cols + (j + 1) % cols;
      g.tri(a, b, c); g.tri(b, d, c);
    }
  }
  const ball = (g, at, r, color, segs = 8, rings = 5, sc = [1, 1, 1], extra = {}) => lathe(g, ellipsoid(rings), { segs, at, scale: [r * sc[0], r * sc[1], r * sc[2]], color, ...extra });
  const flat = (rgbv) => () => rgbv;

  /** The one material every person shares in a scene (per rim color): vertex colors, the rim light, no glints. */
  function toyMat(scene, rimHex) {
    const q = '#' + rgb(rimHex).map((v) => Math.round(v * 5).toString(16).padStart(1, '0')).map((h) => h + h).join('');
    const cache = scene.__prToy || (scene.__prToy = new Map());
    let m = cache.get(q);
    if (!m) {
      m = new B.StandardMaterial(`pr-toy-${q}`, scene);
      m.diffuseColor = new B.Color3(1, 1, 1); m.specularColor = new B.Color3(0, 0, 0); m.ambientColor = new B.Color3(0.45, 0.45, 0.5);
      try {
        const rim = B.Color3.FromHexString(rimHex);
        m.emissiveFresnelParameters = new B.FresnelParameters({ bias: 0.2, power: 2.5, leftColor: new B.Color3(rim.r * 0.55, rim.g * 0.55, rim.b * 0.55), rightColor: new B.Color3(0, 0, 0) });
      } catch { /* no fresnel in this Babylon */ }
      cache.set(q, m);
    }
    return m;
  }

  // ------------------------------------------------------------------ the head, hair and body
  const headSurf = (x, y) => HEAD.rz * Math.sqrt(Math.max(0.04, 1 - (x / HEAD.rx) ** 2 - ((y - HEAD.cy) / HEAD.ry) ** 2));
  const headNormal = (x, y, z) => { const n = [x / HEAD.rx ** 2, (y - HEAD.cy) / HEAD.ry ** 2, z / HEAD.rz ** 2]; const l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; };
  const whiteFront = (ex, x, y) => EYE_Z + WR[2] * Math.sqrt(Math.max(0, 1 - ((x - ex) / WR[0]) ** 2 - ((y - EYE_Y) / WR[1]) ** 2));

  function buildHead(g, pal, look) {
    const skin = tonesRgb(pal.skin), skinColor = ({ n }) => toon(skin, n[1]);
    lathe(g, ellipsoid(8), { segs: 16, at: [0, HEAD.cy, 0], scale: [HEAD.rx, HEAD.ry, HEAD.rz], color: skinColor });
    for (const s of [1, -1]) {
      ball(g, [s * 0.203, 0.215, -0.005], 1, ({ n }) => toon({ base: skin.shade, shade: skin.shade, light: skin.base }, n[1]), 6, 3, [0.028, 0.05, 0.036]);
    }
    ball(g, [0, 0.196, 0.205], 1, skinColor, 6, 3, [0.026, 0.022, 0.024]); // nose
    if (look.face === 'eyes' || look.face === 'smile') {
      const eye = rgb(pal.eye), cheek = rgb(pal.cheek);
      for (const s of [1, -1]) {
        ball(g, [s * EYE_X, EYE_Y, EYE_Z], 1, ({ n }) => mix3(eye, [0.82, 0.84, 0.9], clamp(-n[1] * 0.5, 0, 0.5)), 8, 4, WR);
        ball(g, [s * 0.128, 0.165, headSurf(s * 0.128, 0.165) - 0.004], 1, flat(cheek), 8, 4, [0.04, 0.026, 0.012]);
      }
    }
  }

  const HAIR_CAP = {
    short: [50, 84, 108], long: [50, 92, 122], ponytail: [50, 88, 116], curly: [54, 90, 112], spiky: [54, 86, 110], bun: [50, 88, 116],
  };
  /** The hair's cap goes into the head's mesh; what moves (a tail, a curtain, puffs, spikes, a bun, a tuft) is its own mesh on `hairJ`. */
  function buildHair(look, pal, head, moving) {
    const ht = tonesRgb(pal.hair), color = ({ n }) => toon(ht, n[1]);
    const [fr, sd, bk] = (HAIR_CAP[look.hair] || HAIR_CAP.short).map((d) => (d * Math.PI) / 180);
    const thetaMax = (phi) => { const c = Math.cos(phi); return sd + (c > 0 ? (fr - sd) * c : (bk - sd) * -c); };
    dome(head, { center: [0, HEAD.cy + 0.006, -0.01], radii: [HEAD.rx * 1.07, HEAD.ry * 1.07, HEAD.rz * 1.07], rows: 6, cols: 16, thetaMax, color });
    const top = HEAD.cy + HEAD.ry * 1.07;
    const O = (x, y, z, P0) => [x - P0[0], y - P0[1], z - P0[2]];
    switch (look.hair) {
      case 'long': {
        const P0 = [0, 0.33, -0.12]; moving.pivot = P0; moving.kind = 'hang';
        ball(moving.g, O(0, 0.08, -0.17, P0), 1, color, 12, 6, [0.205, 0.31, 0.085]);
        for (const s of [1, -1]) ball(moving.g, O(s * 0.2, 0.1, 0.01, P0), 1, color, 8, 4, [0.04, 0.15, 0.075]);
        break;
      }
      case 'ponytail': {
        const P0 = [0, 0.33, -0.19]; moving.pivot = P0; moving.kind = 'hang';
        ball(moving.g, [0, 0, 0], 0.052, color, 8, 4);
        ball(moving.g, [0, -0.19, -0.05], 1, color, 10, 5, [0.075, 0.23, 0.07], { rotX: -0.2 });
        ball(moving.g, [0, -0.01, 0.004], 0.058, flat(rgb(pal.accent)), 8, 3, [1, 0.45, 1]);
        break;
      }
      case 'curly': {
        const P0 = [0, HEAD.cy, 0]; moving.pivot = P0; moving.kind = 'puff';
        const spots = [[0, 0], [34, 0], [34, 90], [34, 180], [34, 270], [62, 100], [62, 260], [80, 140], [80, 180], [80, 220], [100, 160], [100, 200]];
        for (const [t, p] of spots) {
          const th = (t * Math.PI) / 180, ph = (p * Math.PI) / 180, R = 0.215;
          ball(moving.g, [Math.sin(th) * Math.sin(ph) * R * 1.02, Math.cos(th) * R * 1.05, Math.sin(th) * Math.cos(ph) * R * 0.98 - 0.015], 0.072, color, 6, 3);
        }
        break;
      }
      case 'spiky': {
        const P0 = [0, HEAD.cy, 0]; moving.pivot = P0; moving.kind = 'puff';
        const dirs = [[0, 0], [32, 0], [32, 90], [32, 180], [32, 270], [58, 45], [58, 225], [58, 315], [62, 135]];
        for (const [t, p] of dirs) {
          const th = (t * Math.PI) / 180, ph = (p * Math.PI) / 180;
          const d = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
          const ang = Math.atan2(d[2], d[1]), bz = -Math.asin(d[0]);
          lathe(moving.g, cone, { segs: 6, at: [d[0] * 0.2, d[1] * 0.21, d[2] * 0.19 - 0.01], scale: [0.06, 0.15, 0.06], rotZ: bz, rotX: ang, color });
        }
        break;
      }
      case 'bun': {
        const P0 = [0, top - 0.02, -0.05]; moving.pivot = P0; moving.kind = 'puff';
        ball(moving.g, [0, 0.07, 0], 0.105, color, 10, 5);
        ball(moving.g, [0, 0.0, 0], 0.075, flat(rgb(pal.accent)), 8, 3, [1.2, 0.4, 1.2]);
        break;
      }
      default: { // short: a tuft that bounces
        const P0 = [0.01, top - 0.01, 0.02]; moving.pivot = P0; moving.kind = 'puff';
        lathe(moving.g, cone, { segs: 6, at: [0, 0, 0], scale: [0.045, 0.1, 0.045], rotZ: -0.35, color });
        lathe(moving.g, cone, { segs: 6, at: [-0.04, -0.01, 0.0], scale: [0.04, 0.08, 0.04], rotZ: 0.3, color });
        break;
      }
    }
  }

  function buildTorso(g, pal) {
    const top = tonesRgb(pal.top), bot = tonesRgb(pal.bottom);
    lathe(g, ellipsoid(8), { segs: 12, at: [0, 0.25, 0], scale: [0.215, 0.31, 0.17], color: ({ n }) => toon(top, n[1]) });
    lathe(g, ellipsoid(5), { segs: 12, at: [0, 0.035, 0], scale: [0.205, 0.12, 0.172], color: ({ n }) => toon(bot, n[1]) });
    // a collar and a hem line in the top's shade: the shirt reads as a shirt
    lathe(g, ellipsoid(3), { segs: 10, at: [0, 0.5, 0.005], scale: [0.115, 0.04, 0.1], color: ({ n }) => toon({ base: top.shade, shade: top.shade, light: top.base }, n[1]) });
  }
  function buildLeg(g, pal, side) {
    const bot = tonesRgb(pal.bottom), sh = tonesRgb(pal.shoes), sole = { base: sh.shade, shade: sh.shade, light: sh.base };
    lathe(g, capsule(-0.41, 0.083, -0.06, 0.098, 3), { segs: 8, color: ({ n }) => toon(bot, n[1]) });
    lathe(g, ellipsoid(5), { segs: 8, at: [0, -0.445, 0.045], scale: [0.115, 0.078, 0.185], color: ({ n }) => toon(sh, n[1]) });
    lathe(g, ellipsoid(3), { segs: 8, at: [0, -0.505, 0.047], scale: [0.119, 0.02, 0.19], color: ({ n }) => toon(sole, n[1]) });
    void side;
  }
  function buildArm(g, pal) {
    const top = tonesRgb(pal.top), skin = tonesRgb(pal.skin);
    const sleeve = ({ n }) => toon(top, n[1]), arm = ({ n }) => toon(skin, n[1]);
    lathe(g, capsule(-0.3, 0.062, -0.21, 0.066, 2), { segs: 8, color: arm });                     // the forearm
    lathe(g, capsule(-0.2, 0.074, -0.03, 0.08, 3), { segs: 8, color: sleeve });                   // the sleeve, its cuff a soft ring
    ball(g, [0, -0.405, 0.008], 1, arm, 8, 4, [0.078, 0.078, 0.078]);
  }

  // ------------------------------------------------------------------ the face: one small mesh whose points are rewritten
  function makeFace(pal, look) {
    const skin = tonesRgb(pal.skin), hair = rgb(pal.hair.base), ink = rgb(pal.ink), eye = rgb(pal.eye);
    const browC = mix3(hair, ink, 0.4);
    let pos = [], first = true;
    const col = [], nrm = [], idx = [], tris = [];
    const v = (x, y, z, c) => {
      pos.push(x, y, z);
      if (first) { const n = headNormal(x, y, z); nrm.push(n[0], n[1], n[2]); const cc = typeof c === 'function' ? c(n) : c; col.push(cc[0], cc[1], cc[2], 1); }
      return pos.length / 3 - 1;
    };
    const tri = (a, b, c) => { if (first) tris.push(a, b, c); };
    const fan = (cx, cy, r, segs, zf, c) => {
      const o = v(cx, cy, zf(cx, cy), c);
      const ids = []; for (let j = 0; j < segs; j++) { const a = (j / segs) * Math.PI * 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; ids.push(v(x, y, zf(x, y), c)); }
      for (let j = 0; j < segs; j++) tri(o, ids[j], ids[(j + 1) % segs]);
    };
    const ribbon = (pts, c, z) => {
      const ids = pts.map(([x, yt, yb]) => [v(x, yt, headSurf(x, yt) + z, c), v(x, yb, headSurf(x, yb) + z, c)]);
      for (let j = 0; j < ids.length - 1; j++) { tri(ids[j][0], ids[j + 1][0], ids[j][1]); tri(ids[j + 1][0], ids[j + 1][1], ids[j][1]); }
    };
    const eyes = look.face === 'eyes' || look.face === 'smile';
    /** Writes every point for `st` ({ gx, gy, lid, open, smile, width, raise, tilt, pupil }); the first call also makes the colors and triangles. */
    function fill(st) {
      pos = [];
      if (eyes) {
        for (const s of [1, -1]) {
          const ex = s * EYE_X;
          const px = ex + st.gx * 0.022, py = EYE_Y + st.gy * 0.02;
          const zw = (x, y) => whiteFront(ex, x, y) + 0.003;
          fan(px, py, 0.034 * st.pupil, 12, zw, ink);
          fan(px + 0.011, py + 0.012, 0.011, 8, (x, y) => whiteFront(ex, x, y) + 0.006, eye);
          // the lid: the top of a circle just over the eye, down to the closing line, in the skin
          const R = 0.066, yTop = EYE_Y + R, yLine = yTop - clamp(st.lid, 0, 1) * 2 * R, cyL = (yTop + yLine) / 2;
          const zl = (x, y) => Math.max(headSurf(x, y) + 0.005, (Math.abs(x - ex) < WR[0] && Math.abs(y - EYE_Y) < WR[1] ? whiteFront(ex, x, y) + 0.005 : 0));
          const o = v(ex, cyL, zl(ex, cyL), (n) => toon(skin, n[1]));
          const ring = [];
          for (let j = 0; j < 18; j++) { const a = (j / 18) * Math.PI * 2; const x = ex + Math.cos(a) * R, y = Math.max(yLine, EYE_Y + Math.sin(a) * R); ring.push(v(x, y, zl(x, y), (n) => toon(skin, n[1]))); }
          for (let j = 0; j < 18; j++) tri(o, ring[j], ring[(j + 1) % 18]);
          // the brow
          const pts = [];
          for (let k = 0; k < 5; k++) {
            const u = -1 + k * 0.5, x = s * (EYE_X + u * 0.05);
            const y = 0.315 + st.raise * 0.022 + st.tilt * 0.022 * u + 0.008 * (1 - u * u);
            pts.push([x, y + 0.011, y - 0.011]);
          }
          ribbon(pts, browC, 0.007);
        }
      }
      if (eyes) {
        const w = 0.05 * st.width, th = 0.012, m0 = 0.112, pts = [];
        for (let k = 0; k < 9; k++) {
          const u = -1 + k * 0.25, yc = m0 + st.smile * 0.032 * (u * u - 0.45);
          pts.push([u * w, yc + th / 2, yc - th / 2 - Math.max(0, st.open) * 0.058 * Math.pow(1 - u * u, 0.8)]);
        }
        ribbon(pts, ink, 0.007);
      }
      if (first) {
        // (one winding, the one Babylon draws: facing the way the head's surface does)
        for (let q = 0; q < tris.length; q += 3) {
          const [a, b, c] = [tris[q], tris[q + 1], tris[q + 2]];
          const u = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]], w = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
          const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
          const d = cr[0] * nrm[a * 3] + cr[1] * nrm[a * 3 + 1] + cr[2] * nrm[a * 3 + 2];
          if (d < 0) idx.push(a, b, c); else idx.push(a, c, b);
        }
      }
      const out = new Float32Array(pos);
      first = false;
      return out;
    }
    return { fill, data: () => ({ nrm, col, idx }) };
  }

  // ------------------------------------------------------------------ build
  /** Builds the person on `rig` (presence.js makeRig): joints, meshes, face. `h` is makeRig's { joint, part } kit. */
  function build(rig, look, h) {
    const scene = rig.scene, pose = rig.pose;
    const pal = C().palette(look);
    const mat = toyMat(scene, pal.rim);
    const mesh = (name, g, parent, updatable) => {
      const m = new B.Mesh(`pr-${name}`, scene);
      const vd = new B.VertexData();
      vd.positions = g.p; vd.normals = g.n; vd.colors = g.c; vd.indices = g.i;
      vd.applyToMesh(m, Boolean(updatable));
      m.parent = parent; m.material = mat; m.isPickable = false; m.metadata = { decor: true, entity: rig.e };
      if (rig.shadows) try { rig.shadows.addShadowCaster(m); } catch { /* none */ }
      rig.meshes.push(m);
      return m;
    };
    rig.hipL = h.joint('hipL', [0.115, HIP_Y, 0]); rig.hipR = h.joint('hipR', [-0.115, HIP_Y, 0]);
    rig.shL = h.joint('shL', [0.245, 0.1, 0]); rig.shR = h.joint('shR', [-0.245, 0.1, 0]);
    rig.chest = h.joint('chest', [0, HIP_Y, 0]);
    rig.neck = h.joint('neck', [0, NECK_Y, 0]); rig.neck.scaling.set(HS, HS, HS);

    const leg = new Geo(); buildLeg(leg, pal, 1); mesh('legL', leg, rig.hipL); mesh('legR', leg, rig.hipR);
    const arm = new Geo(); buildArm(arm, pal); mesh('armL', arm, rig.shL); mesh('armR', arm, rig.shR);
    const torso = new Geo(); buildTorso(torso, pal); rig.torso = mesh('torso', torso, rig.chest);

    const head = new Geo(), moving = { g: new Geo(), pivot: [0, 0, 0], kind: 'puff' };
    buildHead(head, pal, look);
    buildHair(look, pal, head, moving);
    rig.head = mesh('head', head, rig.neck);
    const hairJ = new B.TransformNode('pr-hair', scene);
    hairJ.parent = rig.neck; hairJ.position.set(moving.pivot[0], moving.pivot[1], moving.pivot[2]);
    rig.hairJ = hairJ;
    rig.hairMesh = mesh('hair', moving.g, hairJ);

    let face = null, faceMesh = null;
    if (look.face === 'eyes' || look.face === 'smile') {
      face = makeFace(pal, look);
      const p0 = face.fill(RESTING);
      const d = face.data(), g = new Geo(); g.p = Array.from(p0); g.n = d.nrm; g.c = d.col; g.i = d.idx;
      faceMesh = mesh('face', g, rig.neck, true);
    }
    rig.faceY = EYE_Y; rig.faceZ = 0.205;
    if (look.face === 'visor') {
      const m = h.part(rig, 'visor', h.box(0.36, 0.1, 0.04), rig.neck, [0, EYE_Y, 0.19], look.accent === '#ffffff' ? '#d8f3ff' : look.accent, true);
      void m;
    }
    rig.person = {
      pal, face, faceMesh, rest: look.face === 'smile' ? 'happy' : 'neutral',
      expr: { ...C().EXPRESSIONS[look.face === 'smile' ? 'happy' : 'neutral'] },
      blink: { next: 1.2 + Math.random() * 3, start: -1, dbl: false },
      gaze: { x: 0, y: 0, wx: 0, wy: 0, next: 0 }, head: { yaw: 0, pitch: 0 },
      air: { t: 0, was: false, vy: 0, landT: 9, takeT: 9, depth: 0.82, peak: 0 },
      sp: { hp: { x: 0, v: 0 }, hr: { x: 0, v: 0 }, hs: { x: 0, v: 0 }, cx: { x: 0, v: 0 }, cz: { x: 0, v: 0 } },
      lastY: undefined, vy: 0, prevSpeed: 0, prevBob: 0, prevBobV: 0, prevYaw: undefined, idleT: 0, nextShift: 8, shiftAt: -9, shiftDir: 1, lastKey: '',
      tmpM: new B.Matrix(), tmpV: new B.Vector3(),
    };
    return rig;
  }
  const RESTING = { gx: 0, gy: 0, lid: 0, open: 0, smile: 0, width: 1, raise: 0, tilt: 0, pupil: 1 };

  // ------------------------------------------------------------------ motion
  function spring(s, target, f, z, dt) {
    const w = 2 * Math.PI * f, n = Math.max(1, Math.ceil(dt / 0.01)), hh = dt / n;
    for (let i = 0; i < n; i++) { s.v += (w * w * (target - s.x) - 2 * z * w * s.v) * hh; s.x += s.v * hh; }
    return s.x;
  }
  const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const lerp = (a, b, k) => a + (b - a) * k;

  /** Where the pose root goes so the feet stay put while it scales (sy) and leans forward (rx), about the feet. */
  function setPose(pose, sy, rx, sxz) {
    const fy = FEET * sy;
    pose.scaling.set(sxz === undefined ? 1 / Math.sqrt(sy) : sxz, sy, sxz === undefined ? 1 / Math.sqrt(sy) : sxz);
    pose.rotation.x = rx;
    pose.position.y = FEET - fy * Math.cos(rx);
    pose.position.z = -fy * Math.sin(rx);
  }
  /** The synthetic goings of the showcase: a looping jump (crouch, launch, air, landing), a long fall. */
  function forcedMotion(rig, name, t) {
    if (name === 'jump') {
      const T = 1.5, u = (t % T) / T;
      if (u < 0.08) return { grounded: true, vy: 0, lift: 0, crouch: ease(u / 0.08) };
      if (u < 0.8) { const a = (u - 0.08) / 0.72; return { grounded: false, vy: 7 * (1 - 2 * a), lift: 1.0 * 4 * a * (1 - a), crouch: 0 }; }
      return { grounded: true, vy: 0, lift: 0, crouch: 0 };
    }
    if (name === 'fall') return { grounded: false, vy: -9, lift: 0.7 + Math.sin(t * 2.2) * 0.1, crouch: 0 };
    return null;
  }
  function inWater(rig) {
    const w = H.water, e = rig.e;
    return Boolean(w && w.inWater && e && Number.isFinite(e.y) && w.inWater([e.x, e.y - 0.15, e.z]));
  }

  /** One frame of the person: the whole pose, the springs, the face. `em` is the emote playing (or null); it sets its own joints after. */
  function animate(rig, dt, em) {
    const pp = rig.person;
    if (!pp) return;
    dt = Math.min(Math.max(dt, 0), 0.05);
    const e = rig.e, t = rig.time || 0, pose = rig.pose, speed = rig.speed || 0;
    const forced = rig.forcePose || null;
    const w = H.world;

    // ---- what is it doing?
    let grounded = e.grounded !== false, vy = 0, lift = 0, crouch = 0, swim = false, seated = false;
    if (dt > 0) { const raw = pp.lastY === undefined ? 0 : (e.y - pp.lastY) / dt; pp.vy += (clamp(raw, -40, 40) - pp.vy) * Math.min(1, dt * 12); }
    pp.lastY = e.y;
    vy = typeof e.vy === 'number' && Math.abs(e.vy) > 1e-4 ? e.vy : pp.vy;
    const fm = forced ? forcedMotion(rig, forced, t) : null;
    if (fm) { grounded = fm.grounded; vy = fm.vy; lift = fm.lift; crouch = fm.crouch; }
    if (forced === 'swim') swim = true;
    else if (forced === 'drive') seated = true;
    else if (!forced) {
      seated = e._seatedAt !== undefined && w && w.time - e._seatedAt < 0.3;
      swim = !seated && !grounded && inWater(rig);
    }
    const A = pp.air;
    A.t = grounded ? 0 : A.t + dt;
    const airborne = !seated && !swim && !grounded && A.t > (fm ? 0 : 0.1);
    if (airborne) A.peak = Math.max(A.peak, -vy);
    if (airborne && !A.was) A.takeT = 0;
    if (!airborne && A.was && A.t < 0.01 && !swim) { A.landT = 0; A.depth = lerp(0.9, 0.8, clamp(A.peak / 10, 0, 1)); }
    if (!airborne && A.was) A.peak = 0;
    A.was = airborne;
    A.takeT += dt; A.landT += dt;

    // ---- how fast it goes: the stride
    const moving = !forced || forced === 'walk' || forced === 'run';
    const sp = moving ? speed : 0;
    pp.idleT = sp > 0.4 || airborne || swim || seated ? 0 : pp.idleT + dt;
    const ampW = sp < 0.15 ? 0 : sp < 2.5 ? 0.56 * Math.pow(sp / 2.5, 0.8) : Math.min(0.96, 0.56 + ((sp - 2.5) / 3.5) * 0.4);
    const run01 = clamp((sp - 2.5) / 3.5, 0, 1), walk01 = clamp(sp / 2.5, 0, 1);
    const ph = rig.phase;

    // ---- the joints
    const L = rig.hipL, R = rig.hipR, SL = rig.shL, SR = rig.shR, neck = rig.neck, chest = rig.chest;
    let sy = 1, rx = 0, bob = 0, headNod = 0, tilt = 0;
    let expr = pp.rest;
    L.rotation.set(0, 0, 0); R.rotation.set(0, 0, 0); SL.rotation.set(0, 0, 0.06); SR.rotation.set(0, 0, -0.06);
    pose.rotation.set(0, 0, 0); pose.position.set(0, 0, 0);
    neck.rotation.set(0, 0, 0);
    let swimming = false;

    if (seated) {
      // sits, hands on the wheel, the head turns with it
      const yaw = e.node && e.node.rotation ? e.node.rotation.y : 0;
      const rate = pp.prevYaw === undefined || dt <= 0 ? 0 : clamp(angleDiff(yaw, pp.prevYaw) / dt, -3, 3);
      pp.prevYaw = yaw;
      const steer = forced ? Math.sin(t * 0.9) : -rate;
      L.rotation.x = -1.5; R.rotation.x = -1.5; L.rotation.y = 0.06; R.rotation.y = -0.06;
      SL.rotation.set(-1.25, 0, 0.14); SR.rotation.set(-1.25, 0, -0.14);
      sy = 1 + Math.sin((t * 2 * Math.PI) / 3.2) * 0.012;
      setPose(pose, sy, 0.04 + steer * 0.0);
      pose.position.y += -0.42; pose.position.z += 0;
      pose.rotation.z = steer * 0.06;
      headNod = steer * 0.35; neck.rotation.y = headNod; expr = 'neutral';
    } else if (swim) {
      swimming = true;
      const sw = t * 3.6;
      L.rotation.x = Math.sin(t * 11) * 0.38; R.rotation.x = -Math.sin(t * 11) * 0.38;
      SL.rotation.set(-2.5 + Math.sin(sw) * 0.85, 0, 0.28); SR.rotation.set(-2.5 - Math.sin(sw) * 0.85, 0, -0.28);
      sy = 1 + Math.sin(sw * 2) * 0.03;
      pose.scaling.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
      pose.rotation.x = 1.22; pose.rotation.z = Math.sin(sw) * 0.07; pose.rotation.y = Math.sin(sw) * 0.05;
      pose.position.y = FEET * 0.2 + Math.sin(t * 2) * 0.04 + 0.12; pose.position.z = 0;
      neck.rotation.x = -0.85 + Math.sin(sw * 2) * 0.05; expr = 'happy';
    } else if (airborne) {
      const up = vy > 0.8;
      const tuck = up ? 1 : 0;
      if (up) {
        const k = Math.min(1, A.t / 0.12);
        sy = 1 + 0.12 * Math.min(1, A.takeT / 0.08) * (1 - ease(A.takeT / 0.5) * 0.4);
        L.rotation.x = -0.9 * k; R.rotation.x = -0.4 * k;
        SL.rotation.set(-2.5 * k, 0, 0.45 * k + 0.06); SR.rotation.set(-2.5 * k, 0, -0.45 * k - 0.06);
        rx = 0.04; expr = 'surprised';
      } else {
        const fl = Math.sin(t * 11);
        L.rotation.x = fl * 0.75 - 0.2; R.rotation.x = -fl * 0.75 - 0.2;
        SL.rotation.set(-2.3 + Math.sin(t * 9) * 0.25, 0, 0.75 + Math.sin(t * 7) * 0.1); SR.rotation.set(-2.3 - Math.sin(t * 9) * 0.25, 0, -0.75 - Math.sin(t * 7) * 0.1);
        rx = 0.14; sy = 1.06; expr = 'surprised'; headNod = -0.1;
      }
      void tuck;
      setPose(pose, sy, rx);
      pose.position.y += lift;
      neck.rotation.x = headNod;
    } else {
      // on the ground: idle, walk, run, a crouch, a landing
      const sxz = undefined;
      // stride
      const swing = Math.sin(ph) * ampW;
      L.rotation.x = swing; R.rotation.x = -swing;
      SL.rotation.x = -swing * 0.9; SR.rotation.x = swing * 0.9;
      SL.rotation.z = 0.06 + run01 * 0.08; SR.rotation.z = -0.06 - run01 * 0.08;
      bob = (1 - Math.cos(2 * ph)) * 0.5 * lerp(0.04, 0.09, run01) * walk01;
      const lean = run01 * 0.21 + walk01 * 0.03;
      pose.rotation.y = Math.sin(ph) * 0.07 * walk01;
      const breath = 1 + 0.0125 * (1 + Math.sin((t * 2 * Math.PI) / 3.2)) * (1 - walk01);
      sy = breath * (1 + 0.06 * run01);
      // idle: arms sway 4 degrees; weight shifts and a look around once it has been still a while
      const still = 1 - walk01;
      SL.rotation.z += Math.sin(t * 1.3) * 0.07 * still; SR.rotation.z -= Math.sin(t * 1.3 + 1) * 0.07 * still;
      if (pp.idleT > pp.nextShift && t - pp.shiftAt > 6) { pp.shiftAt = t; pp.nextShift = pp.idleT + 6 + Math.random() * 4; pp.shiftDir = -pp.shiftDir; }
      const su = (t - pp.shiftAt) / 1.8;
      if (su >= 0 && su <= 1) { const k = Math.sin(Math.PI * su); tilt = pp.shiftDir * 0.05 * k; L.rotation.z -= pp.shiftDir * 0.03 * k; R.rotation.z -= pp.shiftDir * 0.03 * k; bob -= 0.01 * k; }
      // a hard stop settles the body 0.05 s after the feet; here: it eases into its lean
      pp.leanS = (pp.leanS || 0) + (lean - (pp.leanS || 0)) * Math.min(1, dt * 14);
      rx = pp.leanS;
      // crouch before a jump (showcase) and the landing
      if (crouch > 0) { sy *= lerp(1, 0.88, crouch); L.rotation.x -= 0.5 * crouch; R.rotation.x -= 0.5 * crouch; SL.rotation.x += 0.4 * crouch; SR.rotation.x += 0.4 * crouch; }
      let landK = 1;
      if (A.landT < 0.31) {
        const tt = A.landT;
        landK = tt < 0.09 ? lerp(1, A.depth, ease(tt / 0.09)) : (() => { const u = (tt - 0.09) / 0.22; return u < 0.55 ? lerp(A.depth, 1.05, ease(u / 0.55)) : lerp(1.05, 1, ease((u - 0.55) / 0.45)); })();
        const dep = clamp((1 - landK) / 0.2, -0.3, 1);
        SL.rotation.x += 0.5 * dep; SR.rotation.x += 0.5 * dep; L.rotation.x -= 0.25 * dep; R.rotation.x -= 0.25 * dep;
      }
      sy *= landK;
      setPose(pose, sy, rx, sxz);
      pose.position.y += bob;
      pose.rotation.z = tilt + pose.rotation.z;
    }

    // ---- the jump's launch also shows in the face; the face follows what it is doing, an emote on top
    if (em && C().EMOTE_FACE[em.def.name]) expr = C().EMOTE_FACE[em.def.name];
    else if (!seated && !swim && !airborne && run01 > 0.5) expr = 'happy';

    // ---- secondary motion: hair, shirt
    const pbob = pose.position.y;
    const bobV = dt > 0 ? (pbob - pp.prevBob) / dt : 0;
    const bobA = dt > 0 ? clamp((bobV - pp.prevBobV) / dt, -90, 90) : 0;
    pp.prevBob = pbob; pp.prevBobV = bobV;
    const af = dt > 0 ? clamp((speed - pp.prevSpeed) / dt, -30, 30) : 0;
    pp.prevSpeed = speed;
    const yaw = e.node && e.node.rotation ? e.node.rotation.y : 0;
    const yawRate = pp.prevYaw === undefined || dt <= 0 ? 0 : clamp(angleDiff(yaw, pp.prevYaw) / dt, -6, 6);
    if (!seated) pp.prevYaw = yaw;
    const idleSway = Math.sin(t * 1.7) * 0.03;
    if (dt > 0) {
      const hair = pp.sp;
      spring(hair.hp, clamp(af * 0.02 + bobA * 0.0035 + idleSway + (swimming ? 0.3 : 0) + (airborne ? clamp(-vy * 0.03, -0.4, 0.4) : 0), -0.55, 0.55), 3.8, 0.4, dt);
      spring(hair.hr, clamp(yawRate * 0.05, -0.4, 0.4) + idleSway * 0.6, 3.6, 0.4, dt);
      spring(hair.hs, clamp(bobA * 0.0012, -0.12, 0.12), 4.5, 0.4, dt);
      spring(hair.cx, clamp(af * 0.006 + bobA * 0.0012 + (A.landT < 0.3 ? 0 : 0), -0.1, 0.1), 5, 0.5, dt);
      spring(hair.cz, clamp(yawRate * 0.02 + Math.sin(ph) * ampW * 0.035, -0.1, 0.1), 5, 0.5, dt);
    }
    rig.hairJ.rotation.x = pp.sp.hp.x; rig.hairJ.rotation.z = pp.sp.hr.x; rig.hairJ.scaling.y = 1 + pp.sp.hs.x; rig.hairJ.scaling.x = rig.hairJ.scaling.z = 1 / Math.sqrt(1 + pp.sp.hs.x);
    chest.rotation.x = pp.sp.cx.x; chest.rotation.z = pp.sp.cz.x;
    // the head lags the breath by 0.1 s and rides the bob
    neck.position.y = NECK_Y + 0.012 * Math.sin(((t - 0.1) * 2 * Math.PI) / 3.2) * (1 - clamp(sp / 2.5, 0, 1));

    // ---- the face: where it looks, the blink, the expression
    face(rig, dt, expr, em);
  }
  function angleDiff(a, b) { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

  function face(rig, dt, exprName, em) {
    const pp = rig.person, t = rig.time || 0, neck = rig.neck, scene = rig.scene;
    // the look target in the head's own space: the camera by default, a point it was told to watch, or somewhere nearby
    let ax = null, ay = 0;
    const target = rig.lookTarget || (scene && scene.activeCamera ? (scene.activeCamera.globalPosition || scene.activeCamera.position) : null);
    if (target && neck.getWorldMatrix) {
      try {
        const wm = neck.getWorldMatrix(); wm.invertToRef(pp.tmpM);
        const tv = Array.isArray(target) ? new B.Vector3(target[0], target[1], target[2]) : target;
        B.Vector3.TransformCoordinatesToRef(tv, pp.tmpM, pp.tmpV);
        const v = pp.tmpV, d = Math.hypot(v.x, v.y, v.z);
        if (d > 0.05 && d < 40 && v.z > 0.05 * d) { ax = Math.atan2(v.x, v.z); ay = Math.atan2(v.y, Math.hypot(v.x, v.z)); }
      } catch { ax = null; }
    }
    const G = pp.gaze;
    if (ax === null) {
      // nobody to look at: glance about now and then (wider once it has been still for a while)
      if (t > G.next) { const wide = pp.idleT > 4 ? 0.9 : 0.35; G.wx = (Math.random() * 2 - 1) * wide; G.wy = (Math.random() * 2 - 1) * wide * 0.4; G.next = t + 1.8 + Math.random() * 3.2; }
      ax = G.wx; ay = G.wy;
    }
    ax = clamp(ax, -1.3, 1.3); ay = clamp(ay, -0.8, 0.8);
    G.x += (ax - G.x) * Math.min(1, dt * 9); G.y += (ay - G.y) * Math.min(1, dt * 9);
    const Hd = pp.head;
    Hd.yaw += (clamp(G.x / 3, -0.5, 0.5) - Hd.yaw) * Math.min(1, dt * 4);
    Hd.pitch += (clamp(-G.y / 3, -0.3, 0.3) - Hd.pitch) * Math.min(1, dt * 4);
    neck.rotation.y += Hd.yaw; neck.rotation.x += Hd.pitch;
    // blink: shut in 80 ms, open in 120 ms, every 2.5 to 6 s, some in pairs
    const Bk = pp.blink;
    if (Bk.start < 0 && t >= Bk.next) { Bk.start = t; Bk.dbl = Math.random() < 0.15; }
    let blink = 0;
    if (Bk.start >= 0) {
      const d = t - Bk.start;
      blink = d < 0.08 ? d / 0.08 : d < 0.11 ? 1 : d < 0.23 ? 1 - (d - 0.11) / 0.12 : 0;
      if (d >= 0.23) { Bk.start = -1; Bk.next = Bk.dbl ? t + 0.12 : t + 2.5 + Math.random() * 3.5; Bk.dbl = false; }
    }
    // the expression, blended over 0.15 s
    const tgt = C().EXPRESSIONS[exprName] || C().EXPRESSIONS.neutral, cur = pp.expr, k = Math.min(1, dt / 0.15);
    for (const key of Object.keys(tgt)) cur[key] += (tgt[key] - cur[key]) * k;
    if (!pp.faceMesh) return;
    const rest = pp.rest === 'happy' ? 0.0 : 0;
    void rest;
    const st = {
      gx: clamp((G.x - Hd.yaw) / 0.7, -1, 1), gy: clamp((G.y + Hd.pitch) / 0.5, -1, 1),
      lid: Math.max(cur.lid, blink), open: cur.open, smile: cur.smile, width: cur.width, raise: cur.raise, tilt: cur.tilt,
      pupil: exprName === 'surprised' ? 0.82 : 1,
    };
    const key = [st.gx, st.gy, st.lid, st.open, st.smile, st.width, st.raise, st.tilt, st.pupil].map((x) => Math.round(x * 200)).join(',');
    if (key === pp.lastKey) return;
    pp.lastKey = key;
    pp.faceMesh.updateVerticesData(B.VertexBuffer.PositionKind, pp.face.fill(st), true);
    void em;
  }

  P.softPerson = { build, animate, HS, NECK_Y, Geo, lathe, ellipsoid, FLIP, toyMat };
})();
