// Presence, part 1d: the things you can be, as toys (docs/characters.md 5c). A shoe, a toaster, a cactus, a traffic cone, a teapot, a
// banana, a mushroom, a potato, a rubber duck, a TV robot and a roll-bot: each the object's own shape in soft vertex-colored meshes (one
// shared toy material with the rim light, tones from presence-core.js tones()), with a face drawn on it (eyes that follow and blink, a
// mouth that takes the five expression numbers: one small mesh whose points are rewritten), tiny arms and feet or a hop or a roll that
// suits the thing, an idle gag every few seconds of standing still and a signature reaction to any emote.
//   the toaster pops · the shoe taps its toe · the teapot whistles and pours · the banana peels · the mushroom spores · the potato rolls
//   the duck waddles and squeaks · the cactus blooms and bristles · the cone directs traffic and spins · the TV flickers and loves
//   the roll-bot rolls and scans.
// presence-bodies.js build() calls THINGS[id] (registered here) and animate() calls P.things.animate(rig, dt, s); presence.js leaves
// a thing's emotes to it (rig.thing.own) apart from the arms. rig.forcePose = 'gag' | 'react' plays one on a loop (/avatars).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const P = (H.presence = H.presence || {});
  const C = () => P.core;

  // ------------------------------------------------------------------ small math
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (x) => x * x * (3 - 2 * x);
  const ease = (x) => smooth(clamp(x, 0, 1));
  const lerp = (a, b, k) => a + (b - a) * k;
  const bump = (u) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u));
  const TAU = Math.PI * 2;
  const tonesRgb = (hex) => { const t = C().tones(hex); return { base: rgb(t.base), shade: rgb(t.shade), light: rgb(t.light), rim: t.rim }; };
  /** Two soft steps: the underside takes the shade, the top the light, the sides the pick. */
  const toon = (t, ny) => { const s = clamp(ny * 1.5, -1, 1); return s < 0 ? mix3(t.base, t.shade, smooth(-s)) : mix3(t.base, t.light, smooth(s)); };
  const paint = (t) => ({ n }) => toon(t, n[1]);
  const flat = (c) => () => c;

  // ------------------------------------------------------------------ geometry
  class Geo {
    constructor() { this.p = []; this.n = []; this.c = []; this.i = []; }
    count() { return this.p.length / 3; }
    vert(p, n, c) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.c.push(c[0], c[1], c[2], 1); return this.p.length / 3 - 1; }
    tri(a, b, c) { if (a !== b && b !== c && a !== c) this.i.push(a, b, c); }
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
  const ELL = {};
  const ellipsoid = (rings) => ELL[rings] || (ELL[rings] = Array.from({ length: rings + 1 }, (_, k) => { const th = Math.PI - (Math.PI * k) / rings; return [Math.sin(th), Math.cos(th), Math.sin(th), Math.cos(th)]; }));
  /** A tapered capsule along y: bottom cap centered at y0 (radius r0), top at y1 (r1). */
  function capsule(y0, r0, y1, r1, rings = 3) {
    const out = [];
    for (let k = 0; k <= rings; k++) { const th = Math.PI - (Math.PI / 2) * (k / rings); out.push([r0 * Math.sin(th), y0 + r0 * Math.cos(th), Math.sin(th), Math.cos(th)]); }
    for (let k = 0; k <= rings; k++) { const th = Math.PI / 2 - (Math.PI / 2) * (k / rings); out.push([r1 * Math.sin(th), y1 + r1 * Math.cos(th), Math.sin(th), Math.cos(th)]); }
    return out;
  }
  /** Normals from the triangles themselves (for shapes the profile's own normals do not describe: squircles, lumps). */
  function smoothNormals(g, v0, i0) {
    const n = g.n, p = g.p, cnt = g.count();
    const acc = new Float32Array((cnt - v0) * 3);
    for (let t = i0; t < g.i.length; t += 3) {
      const a = g.i[t], b = g.i[t + 1], c = g.i[t + 2];
      const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2], vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { acc[(q - v0) * 3] += cx; acc[(q - v0) * 3 + 1] += cy; acc[(q - v0) * 3 + 2] += cz; }
    }
    let mx = 0, my = 0, mz = 0; for (let q = v0; q < cnt; q++) { mx += p[q * 3]; my += p[q * 3 + 1]; mz += p[q * 3 + 2]; }
    mx /= cnt - v0; my /= cnt - v0; mz /= cnt - v0;
    let out = 0; for (let q = v0; q < cnt; q++) out += acc[(q - v0) * 3] * (p[q * 3] - mx) + acc[(q - v0) * 3 + 1] * (p[q * 3 + 1] - my) + acc[(q - v0) * 3 + 2] * (p[q * 3 + 2] - mz);
    const sg = out < 0 ? -1 : 1;
    for (let q = v0; q < cnt; q++) {
      let x = acc[(q - v0) * 3] * sg, y = acc[(q - v0) * 3 + 1] * sg, z = acc[(q - v0) * 3 + 2] * sg; const l = Math.hypot(x, y, z);
      if (l < 1e-9) { x = p[q * 3] - mx; y = p[q * 3 + 1] - my; z = p[q * 3 + 2] - mz; const l2 = Math.hypot(x, y, z) || 1; n[q * 3] = x / l2; n[q * 3 + 1] = y / l2; n[q * 3 + 2] = z / l2; } else { n[q * 3] = x / l; n[q * 3 + 1] = y / l; n[q * 3 + 2] = z / l; }
    }
  }
  /** Profile points [radius, y, normalRadius, normalY] turned around the y axis. o: segs, at, scale, rotX, rotZ, color({p,n,a,t}), mod(angle, t) radial factor, smooth. */
  function rev(g, profile, o) {
    const segs = o.segs || 12, T = xf(o), v0 = g.count(), i0 = g.i.length, m = profile.length, mod = o.mod;
    for (let k = 0; k < m; k++) {
      const [r, y] = profile[k];
      let nr = profile[k][2], ny = profile[k][3];
      if (nr === undefined) { const a = profile[Math.max(0, k - 1)], b = profile[Math.min(m - 1, k + 1)]; const dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1; nr = dy / l; ny = -dr / l; }
      for (let j = 0; j < segs; j++) {
        const ang = (j / segs) * TAU, s = Math.sin(ang), c = Math.cos(ang), f = mod ? mod(ang, k / (m - 1), y) : 1;
        const p = T.p([r * f * s, y, r * f * c]), n = T.n([nr * s, ny, nr * c]);
        g.vert(p, n, o.color({ p, n, a: ang, t: k / (m - 1) }));
      }
    }
    for (let k = 0; k < m - 1; k++) for (let j = 0; j < segs; j++) {
      const a = v0 + k * segs + j, b = v0 + k * segs + (j + 1) % segs, c = v0 + (k + 1) * segs + j, d = v0 + (k + 1) * segs + (j + 1) % segs;
      g.tri(a, c, b); g.tri(b, c, d);
    }
    if (o.smooth || mod) smoothNormals(g, v0, i0);
    // (colors read the normal, so they are made after it when the normals are rewritten)
    if ((o.smooth || mod) && o.recolor !== false) for (let q = v0; q < g.count(); q++) { const c = o.color({ p: [g.p[q * 3], g.p[q * 3 + 1], g.p[q * 3 + 2]], n: [g.n[q * 3], g.n[q * 3 + 1], g.n[q * 3 + 2]], a: 0, t: 0 }); g.c[q * 4] = c[0]; g.c[q * 4 + 1] = c[1]; g.c[q * 4 + 2] = c[2]; }
  }
  /** An ellipsoid with radii r = [rx, ry, rz] at `at`. */
  const ball = (g, at, r, color, o = {}) => rev(g, ellipsoid(o.rings || 5), { segs: 10, ...o, at, scale: r, color });
  /** A soft box: a squircle around y with a rounded profile, [w, h, d] across. */
  function sbox(g, at, size, color, o = {}) {
    const n = o.n || 3.2, m = o.m || 3.2, rows = o.rows || 7;
    const prof = [];
    for (let k = 0; k <= rows; k++) { const y = -1 + (2 * k) / rows, r = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(y), m)), 1 / m); prof.push([r, y]); }
    const sq = (a) => 1 / Math.pow(Math.pow(Math.abs(Math.sin(a)), n) + Math.pow(Math.abs(Math.cos(a)), n), 1 / n);
    rev(g, prof, { segs: o.segs || 16, at, scale: [size[0] / 2, size[1] / 2, size[2] / 2], rotX: o.rotX, rotZ: o.rotZ, mod: (a) => sq(a) * 0.92, color, smooth: true });
  }
  /** A tube along a curve (path(t) -> [x, y, z]), radius rad(t) -> r or [rx, rz]; `ref` is a direction the curve never runs along. */
  function sweep(g, path, rad, color, o = {}) {
    const steps = o.steps || 8, segs = o.segs || 8, ref = o.ref || [1, 0, 0], v0 = g.count();
    const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const ring = (t) => {
      const e = 0.01, p0 = path(clamp(t - e, 0, 1)), p1 = path(clamp(t + e, 0, 1)), at = path(t);
      const T = norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]), Bv = norm(cross(T, ref)), Nv = cross(Bv, T);
      const r = rad(t), rx = Array.isArray(r) ? r[0] : r, rz = Array.isArray(r) ? r[1] : r;
      return { at, T, Bv, Nv, rx, rz };
    };
    const ids = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, R = ring(t), row = [];
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * TAU, ca = Math.cos(a), sa = Math.sin(a), f = o.mod ? o.mod(a, t) : 1;
        const p = [R.at[0] + (R.Bv[0] * ca * R.rx + R.Nv[0] * sa * R.rz) * f, R.at[1] + (R.Bv[1] * ca * R.rx + R.Nv[1] * sa * R.rz) * f, R.at[2] + (R.Bv[2] * ca * R.rx + R.Nv[2] * sa * R.rz) * f];
        const n = norm([R.Bv[0] * ca / R.rx + R.Nv[0] * sa / R.rz, R.Bv[1] * ca / R.rx + R.Nv[1] * sa / R.rz, R.Bv[2] * ca / R.rx + R.Nv[2] * sa / R.rz]);
        row.push(g.vert(p, n, color({ p, n, a, t })));
      }
      ids.push(row);
    }
    for (let s = 0; s < steps; s++) for (let j = 0; j < segs; j++) {
      const a = ids[s][j], b = ids[s][(j + 1) % segs], c = ids[s + 1][j], d = ids[s + 1][(j + 1) % segs];
      g.tri(a, c, b); g.tri(b, c, d);
    }
    for (const [t, sgn] of [[0, -1], [1, 1]]) {
      if (o.open) continue;
      const R = ring(t), n = [R.T[0] * sgn, R.T[1] * sgn, R.T[2] * sgn], c0 = g.vert(R.at, n, color({ p: R.at, n, a: 0, t })), row = ids[t === 0 ? 0 : steps];
      for (let j = 0; j < segs; j++) g.tri(c0, row[j], row[(j + 1) % segs]);
    }
    void v0;
  }
  /** A little cone (spines, petals' tips): base at `at`, pointing along dir. */
  function spike(g, at, dir, len, r, color, segs = 4) {
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1, d = [dir[0] / l, dir[1] / l, dir[2] / l];
    const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const bx = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]; const bl = Math.hypot(bx[0], bx[1], bx[2]) || 1; const u = [bx[0] / bl, bx[1] / bl, bx[2] / bl];
    const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    const cf = typeof color === 'function' ? color : () => color;
    const tipP = [at[0] + d[0] * len, at[1] + d[1] * len, at[2] + d[2] * len];
    const tip = g.vert(tipP, d, cf({ p: tipP, n: d }));
    const ring = [];
    for (let j = 0; j < segs; j++) { const a = (j / segs) * TAU, ca = Math.cos(a) * r, sa = Math.sin(a) * r; const p = [at[0] + u[0] * ca + w[0] * sa, at[1] + u[1] * ca + w[1] * sa, at[2] + u[2] * ca + w[2] * sa]; const nn = [u[0] * Math.cos(a) + w[0] * Math.sin(a), u[1] * Math.cos(a) + w[1] * Math.sin(a), u[2] * Math.cos(a) + w[2] * Math.sin(a)]; ring.push(g.vert(p, nn, cf({ p, n: nn }))); }
    for (let j = 0; j < segs; j++) g.tri(tip, ring[j], ring[(j + 1) % segs]);
  }
  /** Every triangle the way Babylon draws it (by the vertex normals). */
  function windings(g) {
    const out = [], p = g.p, n = g.n;
    for (let q = 0; q < g.i.length; q += 3) {
      const a = g.i[q], b = g.i[q + 1], c = g.i[q + 2];
      const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2], vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
      const d = (uy * vz - uz * vy) * (n[a * 3] + n[b * 3] + n[c * 3]) + (uz * vx - ux * vz) * (n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1]) + (ux * vy - uy * vx) * (n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]);
      if (d < 0) out.push(a, b, c); else out.push(a, c, b);
    }
    return out;
  }

  /** The surface of a solid of revolution as a face wants it: pts = [[y, radius], ...] (in the face joint's y), z at (x, y) in front of the axis. */
  function radial(pts, off = 0.004) {
    return (xx, yy) => {
      let r = pts[pts.length - 1][1];
      for (let i = 0; i < pts.length - 1; i++) if (yy <= pts[i + 1][0]) { const u = clamp((yy - pts[i][0]) / (pts[i + 1][0] - pts[i][0] || 1), 0, 1); r = lerp(pts[i][1], pts[i + 1][1], u); break; }
      if (yy < pts[0][0]) r = pts[0][1];
      return Math.sqrt(Math.max(0.0004, r * r - xx * xx)) + off;
    };
  }

  // ------------------------------------------------------------------ the face: eyes, a mouth, a brow, one mesh whose points are rewritten
  /**
   * o: surf(x, y) -> z (the surface the face sits on, in the face joint's space), ex ey (eye center), er ery (eye radii), outline,
   * lid (color of the lid), mouth { y, w, th, color }, brow { y, w, color } | null, cheek (color) | null, z (layer step),
   * screen: { color } draws a lit screen (eyes without whites) instead of a toy's eyes.
   */
  function makeFace(o) {
    const ink = rgb(C().palette({}).ink), white = rgb(C().palette({}).eye);
    const Z = o.z || 0.006;
    let pos = [], first = true;
    const col = [], nrm = [], idx = [], tris = [];
    const nOf = (x, y) => { const e = 0.004, dx = (o.surf(x + e, y) - o.surf(x - e, y)) / (2 * e), dy = (o.surf(x, y + e) - o.surf(x, y - e)) / (2 * e); const l = Math.hypot(dx, dy, 1); return [-dx / l, -dy / l, 1 / l]; };
    const v = (x, y, layer, c) => { pos.push(x, y, o.surf(x, y) + Z * layer); if (first) { const n = nOf(x, y); nrm.push(n[0], n[1], n[2]); col.push(c[0], c[1], c[2], 1); } return pos.length / 3 - 1; };
    const tri = (a, b, c) => { if (first) tris.push(a, b, c); };
    const fan = (cx, cy, rx, ry, segs, layer, c, clipY) => {
      const ids = [];
      for (let j = 0; j < segs; j++) { const a = (j / segs) * TAU; ids.push(v(cx + Math.cos(a) * rx, Math.max(clipY === undefined ? -1e9 : clipY, cy + Math.sin(a) * ry), layer, c)); }
      const mid = v(cx, clipY === undefined ? cy : Math.max(clipY, cy), layer, c);
      for (let j = 0; j < segs; j++) tri(mid, ids[j], ids[(j + 1) % segs]);
    };
    const heart = (cx, cy, r, layer, c) => {
      const ids = [], N = 14;
      for (let j = 0; j < N; j++) { const a = (j / N) * TAU, x = 16 * Math.pow(Math.sin(a), 3) / 17, y = (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 17; ids.push(v(cx + x * r, cy + y * r + r * 0.05, layer, c)); }
      const mid = v(cx, cy, layer, c);
      for (let j = 0; j < N; j++) tri(mid, ids[j], ids[(j + 1) % N]);
    };
    const ribbon = (pts, layer, c) => {
      const ids = pts.map(([x, yt, yb]) => [v(x, yt, layer, c), v(x, yb, layer, c)]);
      for (let j = 0; j < ids.length - 1; j++) { tri(ids[j][0], ids[j + 1][0], ids[j][1]); tri(ids[j + 1][0], ids[j + 1][1], ids[j][1]); }
    };
    const lid = rgb(o.lid), outline = mix3(ink, lid, 0.35), cheek = o.cheek ? rgb(o.cheek) : null;
    const screen = o.screen ? rgb(o.screen.color) : null;
    /** st: { gx, gy, lid, open, smile, width, raise, tilt, pupil, heart } */
    function fill(st) {
      pos = [];
      for (const s of [1, -1]) {
        const ex = s * o.ex;
        if (screen) {
          // a lit screen: the eye is a tall pill that shrinks when it blinks and slides where it looks; hearts when in love
          const h = o.ery * Math.max(0.12, 1 - st.lid * 0.9), px = ex + st.gx * o.er * 0.5, py = o.ey + st.gy * o.ery * 0.4 - (o.ery - h) * 0.2;
          if (st.heart) heart(px, py, o.er * 1.35, 2, screen); else fan(px, py, o.er * (st.pupil < 1 ? 0.8 : 1), h * (st.pupil < 1 ? 1.2 : 1), 14, 2, screen);
        } else {
          const px = ex + st.gx * o.er * 0.34, py = o.ey + st.gy * o.ery * 0.3;
          fan(ex, o.ey, o.er * 1.14, o.ery * 1.12, 16, 1, outline);
          fan(ex, o.ey, o.er, o.ery, 16, 2, white);
          fan(px, py, o.er * 0.6 * st.pupil, o.ery * 0.64 * st.pupil, 12, 3, ink);
          fan(px + o.er * 0.2, py + o.ery * 0.24, o.er * 0.17, o.ery * 0.17, 8, 4, white);
          // the lid: the top of the eye, closed down to the closing line
          const top = o.ey + o.ery * 1.14, line = top - clamp(st.lid, 0, 1) * 2 * o.ery * 1.14;
          { const k = st.lid > 0.02 ? 1 : 0; fan(ex, k ? (top + line) / 2 : top + 0.01, o.er * 1.16 * k, ((top - line) / 2) * k, 16, 5, lid); } // (always the same points, empty when open)
        }
        if (o.brow) {
          const pts = [];
          for (let k = 0; k < 5; k++) {
            const u = -1 + k * 0.5, x = s * (o.ex + u * o.brow.w);
            const y = o.brow.y + st.raise * o.er * 0.35 + st.tilt * o.er * 0.3 * u + 0.1 * o.er * (1 - u * u);
            pts.push([x, y + o.er * 0.13, y - o.er * 0.13]);
          }
          ribbon(pts, 3, rgb(o.brow.color));
        }
        if (cheek && !screen) fan(s * o.ex * 1.38, o.ey - o.ery * 1.75, o.er * 0.62, o.ery * 0.4, 10, 1, cheek);
      }
      const M = o.mouth;
      if (M) {
        const w = M.w * st.width, th = M.th || 0.016, pts = [];
        for (let k = 0; k < 9; k++) {
          const u = -1 + k * 0.25, yc = M.y + st.smile * M.w * 0.34 * (u * u - 0.45);
          pts.push([u * w, yc + th / 2, yc - th / 2 - Math.max(0, st.open) * M.w * 0.8 * Math.pow(1 - u * u, 0.8)]);
        }
        ribbon(pts, 3, M.color ? rgb(M.color) : (screen || ink));
      }
      if (first) {
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
  const RESTING = { gx: 0, gy: 0, lid: 0, open: 0, smile: 0, width: 1, raise: 0, tilt: 0, pupil: 1, heart: false };

  // ------------------------------------------------------------------ the toy material, meshes, joints
  const glows = new WeakMap();
  function glowMat(scene) {
    let m = glows.get(scene);
    if (!m) {
      m = new B.StandardMaterial('pr-toy-glow', scene);
      m.diffuseColor = new B.Color3(0, 0, 0); m.specularColor = new B.Color3(0, 0, 0); m.emissiveColor = new B.Color3(1, 1, 1); m.disableLighting = true;
      glows.set(scene, m);
    }
    return m;
  }
  function context(rig, holder, look) {
    const scene = rig.scene;
    const mat = P.softPerson && P.softPerson.toyMat ? P.softPerson.toyMat(scene, C().palette(look).rim) : null;
    const mk = (name, g, parent, o = {}) => {
      const m = new B.Mesh(`pr-${name}`, scene);
      const vd = new B.VertexData();
      vd.positions = g.p; vd.normals = g.n; vd.colors = g.c; vd.indices = o.fixed ? g.i : windings(g);
      vd.applyToMesh(m, Boolean(o.updatable));
      m.parent = parent; m.material = o.glow ? glowMat(scene) : mat; m.isPickable = false; m.metadata = { decor: true, entity: rig.e };
      if (rig.shadows) try { rig.shadows.addShadowCaster(m); } catch { /* none */ }
      rig.meshes.push(m);
      return m;
    };
    const joint = (name, at, parent) => { const t = new B.TransformNode(`pr-${name}`, scene); t.parent = parent || holder; t.position.set(at[0], at[1], at[2]); return t; };
    const pal = C().palette(look);
    const cols = { b: tonesRgb(look.body), a: tonesRgb(look.accent === '#ffffff' ? '#f4f4f0' : look.accent), d: tonesRgb(look.head) };
    return { rig, holder, scene, look, mk, joint, pal, cols, ink: rgb(pal.ink), white: rgb(pal.eye), g: () => new Geo() };
  }
  /** Two little legs (on hip joints the walk swings): thigh to a foot pad, standing on y = 0. */
  function legs(x, apart, h, r, T, shoe) {
    const { rig } = x;
    rig.hipL = x.joint('hipL', [apart, h, 0]); rig.hipR = x.joint('hipR', [-apart, h, 0]);
    rig.legged = true;
    const g = x.g(), S = shoe || T;
    rev(g, capsule(-h + r * 1.2, r * 0.95, -0.02, r * 0.85, 3), { segs: 8, color: paint(T) });
    ball(g, [0, -h + r * 0.75, r * 0.8], [r * 1.15, r * 0.78, r * 1.75], paint(S), { segs: 8, rings: 4 });
    x.mk('legL', g, rig.hipL); x.mk('legR', g, rig.hipR);
  }
  /** Two tiny arms on shoulder joints: a soft tube down to a mitten. */
  function arms(x, apart, y, len, r, T, o = {}) {
    const { rig } = x;
    rig.shL = x.joint('shL', [apart, y, 0]); rig.shR = x.joint('shR', [-apart, y, 0]);
    const g = x.g();
    rev(g, capsule(-len, r * 0.9, 0, r, 3), { segs: 8, color: paint(T) });
    ball(g, [0, -len - r * 0.2, 0.01], [r * 1.35, r * 1.3, r * 1.35], paint(o.hand || T), { segs: 8, rings: 4 });
    x.mk('armL', g, rig.shL); x.mk('armR', g, rig.shR);
    rig.shL.rotation.z = 0.06; rig.shR.rotation.z = -0.06;
  }
  /** A face on `parent` at `at`: o as makeFace; returns the state the animation drives. */
  function addFace(x, parent, at, o) {
    const face = makeFace({ lid: x.look.body, cheek: x.pal.cheek, ...o });
    const p0 = face.fill(RESTING), d = face.data(), g = new Geo();
    g.p = Array.from(p0); g.n = d.nrm; g.c = d.col; g.i = d.idx;
    const j = x.joint('face', at, parent);
    const mesh = x.mk('face', g, j, { updatable: true, fixed: true, glow: Boolean(o.screen) });
    return {
      j, mesh, face, rest: x.look.face === 'smile' ? 'happy' : 'neutral', expr: { ...C().EXPRESSIONS.neutral },
      blink: { next: 1 + Math.random() * 3, start: -1, dbl: false }, gaze: { x: 0, y: 0, wx: 0, wy: 0, next: 0 }, key: '', look: null,
      tmpM: new B.Matrix(), tmpV: new B.Vector3(),
    };
  }
  /** One frame of a face: where it looks (the camera, or a glance about), the blink, the expression blended over 0.15 s. */
  function stepFace(rig, F, dt, exprName, extra) {
    const t = rig.time || 0, scene = rig.scene;
    let ax = null, ay = 0;
    const spec = C().faceSpec(rig.what), md = rig.mood;
    const gz = C().gazeTarget({ speaking: Boolean(rig.overseerSpeaking), overseer: rig.overseerAt, explicit: rig.lookTarget, others: rig.others, camera: scene && scene.activeCamera ? (scene.activeCamera.globalPosition || scene.activeCamera.position) : null });
    const target = gz ? gz.pos : null;
    if (target && F.j.getWorldMatrix) {
      try {
        F.j.getWorldMatrix().invertToRef(F.tmpM);
        const tv = Array.isArray(target) ? new B.Vector3(target[0], target[1], target[2]) : target;
        B.Vector3.TransformCoordinatesToRef(tv, F.tmpM, F.tmpV);
        const v = F.tmpV, d = Math.hypot(v.x, v.y, v.z);
        if (gz.kind === 'overseer') { if (d > 0.05) { ax = Math.atan2(v.x, Math.abs(v.z) < 1e-3 ? 1e-3 : v.z); ay = Math.atan2(v.y, Math.hypot(v.x, v.z)); } }
        else if (d > 0.05 && d < 40 && v.z > 0.05 * d) { ax = Math.atan2(v.x, v.z); ay = Math.atan2(v.y, Math.hypot(v.x, v.z)); }
      } catch { ax = null; }
    }
    const G = F.gaze;
    if (extra && extra.gaze) { ax = extra.gaze[0]; ay = extra.gaze[1]; }
    if (ax === null) {
      if (t > G.next) { G.wx = (Math.random() * 2 - 1) * 0.8; G.wy = (Math.random() * 2 - 1) * 0.35; G.next = t + 1.8 + Math.random() * 3.2; }
      ax = G.wx; ay = G.wy;
    }
    G.x += (clamp(ax, -1.2, 1.2) - G.x) * Math.min(1, dt * 9); G.y += (clamp(ay, -0.8, 0.8) - G.y) * Math.min(1, dt * 9);
    const blink = spec.blink ? C().blinkStep(F.blink, t) : 0;
    if (P.alive) P.alive.blinkSeen(rig, blink);
    const tgt = C().EXPRESSIONS[exprName] || C().EXPRESSIONS.neutral, cur = F.expr, k = Math.min(1, dt / 0.15);
    for (const key of Object.keys(tgt)) cur[key] += (tgt[key] - cur[key]) * k;
    const shown = C().shape(cur, spec.gain), talk = rig.alive && rig.alive.mouthDraw != null && spec.talk ? rig.alive.mouthDraw : md && md.talking() && spec.talk ? C().talkOpen(t) : 0;
    const st = {
      gx: clamp(G.x / 0.7, -1, 1), gy: clamp(G.y / 0.5, -1, 1), lid: Math.max(shown.lid, blink, (extra && extra.lid) || 0),
      open: shown.open + talk + ((extra && extra.open) || 0), smile: shown.smile, width: shown.width, raise: shown.raise, tilt: shown.tilt,
      pupil: exprName === 'surprised' || exprName === 'scared' ? 0.82 : 1, heart: Boolean(extra && extra.heart),
    };
    const key = [st.gx, st.gy, st.lid, st.open, st.smile, st.width, st.raise, st.tilt, st.pupil, st.heart ? 1 : 0].map((v) => (typeof v === 'number' ? Math.round(v * 200) : v)).join(',');
    if (key === F.key) return;
    F.key = key;
    F.mesh.updateVerticesData(B.VertexBuffer.PositionKind, F.face.fill(st), true);
  }

  // ------------------------------------------------------------------ posing about the feet
  const FEET = new B.Vector3(0, -0.9, 0), tmpR = new B.Matrix(), tmpF = new B.Vector3();
  /** The pose root turned (pitch rx: + leans forward, roll rz, yaw ry), the feet staying where they are, `lift` meters up, squashed by sy. */
  function tilt(rig, rx, rz, ry, lift, sy) {
    const p = rig.pose, k = sy === undefined ? 1 : sy, kx = 1 / Math.sqrt(k);
    B.Matrix.RotationYawPitchRollToRef(ry || 0, rx || 0, rz || 0, tmpR);
    const f = new B.Vector3(0, -0.9 * k, 0);
    B.Vector3.TransformCoordinatesToRef(f, tmpR, tmpF);
    p.rotation.set(rx || 0, ry || 0, rz || 0);
    p.scaling.set(kx, k, kx);
    p.position.set(-tmpF.x, -0.9 - tmpF.y + (lift || 0), -tmpF.z);
  }
  /** Squash and stretch keeping the volume: sy in y, 1/sqrt(sy) across. */
  const squash = (rig, sy, lift) => tilt(rig, 0, 0, 0, lift || 0, sy);
  void FEET;

  /** A damped spring: s = { x, v }. */
  function spring(s, target, f, z, dt) {
    const w = TAU * f, n = Math.max(1, Math.ceil(dt / 0.01)), hh = dt / n;
    for (let i = 0; i < n; i++) { s.v += (w * w * (target - s.x) - 2 * z * w * s.v) * hh; s.x += s.v * hh; }
    return s.x;
  }
  const sp = () => ({ x: 0, v: 0 });
  /** A cluster of little balls (steam, spores, bubbles) as one mesh: n of them around the origin. */
  function puffs(x, parent, T, n, r, spread, name) {
    const g = x.g();
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU * 1.7, h = ((i * 0.618) % 1); ball(g, [Math.sin(a) * spread, h * spread * 1.6, Math.cos(a) * spread * 0.7], [r * (1 - h * 0.35), r * (1 - h * 0.35), r * (1 - h * 0.35)], flat(T), { segs: 7, rings: 3 }); }
    return x.mk(name, g, parent);
  }

  // ------------------------------------------------------------------ the things
  // Each builder gets the context (x) and returns { head: {head, r, top, front}, anim(rig, c), gagFace, sigFace, gagDur, sigDur, setup }.
  // c: { t, dt, s (0..1 walking), run (0..1), sp (m/s), ph (gait phase), gu (0..1 through the gag, -1 when none), su (0..1 through the
  // signature, -1 when none), em (the emote playing or null), th (the thing) }. anim sets the joints; the face is driven by the caller.
  const BUILD = {};

  // ---- the shoe: a sneaker walking toe first; the toe cap is the face
  BUILD.shoe = (x) => {
    const { cols: { b, a, d }, joint } = x, rig = x.rig;
    legs(x, 0.15, 0.2, 0.062, d, d);
    const y0 = 0.2, g = x.g();
    ball(g, [0, y0 + 0.07, 0.04], [0.35, 0.09, 0.74], paint(a), { segs: 16, rings: 5 });                       // the rubber sole
    ball(g, [0, y0 + 0.42, -0.3], [0.31, 0.38, 0.34], paint(b), { segs: 16, rings: 7 });                       // the tall heel counter
    ball(g, [0, y0 + 0.26, 0.2], [0.34, 0.2, 0.52], paint(b), { segs: 16, rings: 7 });                         // the low toe box
    ball(g, [0, y0 + 0.4, -0.02], [0.3, 0.22, 0.34], paint(b), { segs: 14, rings: 6 });                        // the vamp rising to the ankle
    ball(g, [0, y0 + 0.14, 0.62], [0.3, 0.1, 0.18], paint(a), { segs: 12, rings: 4 });                         // the rubber toe bumper
    ball(g, [0, y0 + 0.74, -0.3], [0.3, 0.075, 0.3], paint(a), { segs: 16, rings: 4 });                        // the padded collar
    ball(g, [0, y0 + 0.77, -0.3], [0.21, 0.04, 0.21], flat(x.ink), { segs: 12, rings: 3 });                    // the dark inside of the shoe
    for (const s of [1, -1]) {
      ball(g, [s * 0.325, y0 + 0.4, -0.2], [0.012, 0.045, 0.2], paint(a), { segs: 8, rings: 4, rotX: 0.45 });     // the side swoosh
      ball(g, [s * 0.26, y0 + 0.5, 0.1], [0.012, 0.02, 0.12], paint(a), { segs: 6, rings: 3 });
    }
    for (let i = 0; i < 3; i++) ball(g, [0, y0 + 0.52 - i * 0.03, 0.0 + i * 0.1], [0.15, 0.025, 0.045], paint(a), { segs: 8, rings: 3, rotX: -0.4 }); // the laces
    x.mk('shoe', g, x.holder);
    const tg = x.g();
    ball(tg, [0, 0.05, 0.07], [0.12, 0.04, 0.16], paint(a), { segs: 9, rings: 4, rotX: -0.45 });
    const tongue = joint('tongue', [0, y0 + 0.5, 0.06]); x.mk('tongue', tg, tongue);
    const lg = x.g();
    for (const s of [1, -1]) { rev(lg, capsule(-0.15, 0.016, 0, 0.016, 2), { segs: 6, color: paint(a), rotZ: s * 0.35 }); ball(lg, [s * 0.05, -0.17, 0], [0.035, 0.025, 0.02], paint(a), { segs: 6, rings: 3 }); }
    const lace = joint('laceTails', [0.0, y0 + 0.5, 0.26]); x.mk('laceTails', lg, lace);
    arms(x, 0.33, y0 + 0.4, 0.17, 0.045, d);
    const toe = (xx, yy) => 0.52 * Math.sqrt(Math.max(0.02, 1 - (xx / 0.34) ** 2 - ((yy + 0.0) / 0.2) ** 2));
    const F = addFace(x, x.holder, [0, y0 + 0.26, 0.2], { surf: toe, ex: 0.12, ey: 0.03, er: 0.07, ery: 0.082, mouth: { y: -0.09, w: 0.08, th: 0.02 }, brow: null, z: 0.007 });
    const sTongue = sp(), sLace = sp();
    return {
      head: { head: [0, y0 + 0.3, 0.2], r: 0.3, top: y0 + 0.7, front: 0.7 }, F, gagFace: 'mischief', sigFace: 'happy', gagDur: 2.4, sigDur: 1.5,
      anim(rig, c) {
        const w = c.s, hop = Math.abs(Math.sin(c.ph)) * 0.05 * w;
        // heel and toe: it rocks onto the toe with each step and settles back on the heel
        const rock = Math.sin(c.ph) * 0.1 * w + c.run * 0.14;
        let rx = rock, lift = hop, sy = 1;
        let tl = 0;
        if (c.gu >= 0) {
          // an impatient toe tap, three times, the tongue lolling out
          const tap = Math.max(0, Math.sin(c.gu * Math.PI * 6)) * bump(c.gu);
          rx = -0.2 * bump(c.gu) + tap * 0.28; tl = bump(c.gu) * 0.9;
        }
        if (c.su >= 0) {
          // heel click: crouch, a hop with a spin and the toes clicking together
          const u = c.su, up = u < 0.2 ? -ease(u / 0.2) : u < 0.7 ? Math.sin(((u - 0.2) / 0.5) * Math.PI) : 0;
          lift += Math.max(0, up) * 0.3; sy = up < 0 ? 1 + up * 0.18 : 1 + up * 0.08; rx += Math.sin(u * TAU) * 0.12;
          tl = bump(u);
        }
        tilt(rig, rx, Math.sin(c.ph * 0.5) * 0.04 * w, c.su >= 0 ? ease((c.su - 0.2) / 0.5) * TAU : 0, lift, sy);
        tongue.rotation.x = spring(sTongue, -0.15 - tl * 0.7 + Math.sin(c.t * 7) * 0.05 * tl - w * 0.2 * Math.abs(Math.sin(c.ph)), 3.4, 0.35, c.dt);
        lace.rotation.z = spring(sLace, Math.sin(c.t * 2.2) * 0.05 + Math.sin(c.ph) * 0.5 * w, 3, 0.25, c.dt);
        lace.rotation.x = Math.sin(c.t * 1.7) * 0.05 + w * 0.2;
      },
    };
  };

  // ---- the toaster: pops. Hops with a slice of toast jumping out of each slot
  const REST = 0.36;
  BUILD.toaster = (x) => {
    const { cols: { b, a, d }, joint } = x, rig = x.rig;
    legs(x, 0.24, 0.2, 0.07, d, d);
    const y0 = 0.2, g = x.g();
    sbox(g, [0, y0 + 0.37, 0], [1.0, 0.74, 0.62], paint(b), { n: 3.4, m: 3.6, segs: 20, rows: 8 });             // the chrome body
    ball(g, [0, y0 + 0.04, 0], [0.4, 0.07, 0.25], paint(d), { segs: 12, rings: 4 });                           // the dark base
    for (const z of [0.15, -0.15]) sbox(g, [0, y0 + 0.74, z], [0.62, 0.06, 0.1], flat(x.ink), { n: 3, m: 2, segs: 14, rows: 4 }); // the slots
    ball(g, [0, y0 + 0.55, 0.0], [0.5, 0.025, 0.31], paint(a), { segs: 12, rings: 3 });                             // a warm band round it
    ball(g, [0.51, y0 + 0.4, 0], [0.04, 0.2, 0.2], paint(d), { segs: 10, rings: 4 });                               // the side plate
    ball(g, [0.545, y0 + 0.28, 0.02], [0.04, 0.07, 0.07], paint(a), { segs: 10, rings: 3 });                         // the dial
    x.mk('toaster', g, x.holder);
    const lg = x.g(); ball(lg, [0, 0, 0], [0.06, 0.04, 0.09], paint(a), { segs: 8, rings: 3 }); sbox(lg, [0, 0.05, 0], [0.05, 0.1, 0.05], paint(d), { rows: 3, segs: 8 });
    const lever = joint('lever', [0.5, y0 + 0.58, 0.05]); x.mk('lever', lg, lever);
    const slice = (z) => {
      const j = joint(`toast${z}`, [0, y0 + REST, z]), tg = x.g();
      sbox(tg, [0, 0.2, 0], [0.46, 0.5, 0.075], flat(mix3(a.base, [0.3, 0.16, 0.06], 0.65)), { n: 3, m: 3, segs: 16, rows: 6 }); // the crust
      sbox(tg, [0, 0.2, 0.0], [0.37, 0.41, 0.086], paint(a), { n: 3, m: 3, segs: 16, rows: 6 });              // the crumb
      x.mk(`toast${z}`, tg, j);
      return j;
    };
    const toasts = [slice(0.15), slice(-0.15)];
    arms(x, 0.55, y0 + 0.5, 0.22, 0.05, d);
    // the toaster's face sits on the front of the chrome: flat, a little domed
    const front = (xx, yy) => 0.31 - Math.abs(xx) * Math.abs(xx) * 0.1 - Math.max(0, Math.abs(yy) - 0.3) * 0.2;
    const F = addFace(x, x.holder, [0, y0 + 0.4, 0], { surf: front, ex: 0.18, ey: 0.07, er: 0.09, ery: 0.1, mouth: { y: -0.1, w: 0.12, th: 0.022 }, brow: null, lid: x.look.body, z: 0.007 });
    const sT = [sp(), sp()], sL = sp();
    return {
      head: { head: [0, y0 + 0.4, 0], r: 0.4, top: y0 + 0.78, front: 0.33 }, F, gagFace: 'surprised', sigFace: 'happy', gagDur: 2.2, sigDur: 1.7,
      anim(rig, c) {
        const w = c.s;
        const hopU = Math.abs(Math.sin(c.ph)), hop = hopU * (0.1 + 0.08 * c.run) * w;
        let sy = 1 + (1 - hopU) * 0.0, pop = [hop * 1.9, hop * 1.9], spin = 0, lv = 0;
        if (c.gu >= 0) {
          // ding: the toast shoots up out of the slots, the toaster squashes and then catches its breath
          const u = c.gu, pre = u < 0.12 ? -ease(u / 0.12) : 0, fly = u > 0.12 && u < 0.7 ? Math.sin(((u - 0.12) / 0.58) * Math.PI) : 0;
          pop = [fly * 0.42, fly * 0.36]; sy = 1 + pre * 0.16 + (u > 0.1 && u < 0.2 ? 0.06 : 0); spin = fly; lv = pre * -1 + (u > 0.12 ? -0.8 * (1 - ease((u - 0.12) / 0.6)) : 0);
        }
        if (c.su >= 0) {
          // the signature: both slices launch, tumbling, and come back down into the slots
          const u = c.su, pre = u < 0.12 ? -ease(u / 0.12) : 0, fly = u > 0.12 && u < 0.85 ? Math.sin(((u - 0.12) / 0.73) * Math.PI) : 0;
          pop = [fly * 0.95, fly * 0.8]; sy = 1 + pre * 0.2 + (fly > 0.05 ? 0.07 : 0); spin = fly * 1.6; lv = pre;
        }
        squash(rig, sy, hop);
        toasts.forEach((j, i) => {
          const y = spring(sT[i], pop[i], 4.6, 0.32, c.dt);
          j.position.y = y0 + REST + Math.max(-0.22, y); j.rotation.z = (i ? -1 : 1) * spin * 0.5 * Math.sin(c.t * 7 + i); j.rotation.x = (i ? 1 : -1) * spin * 0.25;
        });
        lever.rotation.x = spring(sL, lv * 0.7, 4, 0.4, c.dt);
        rig.pose.rotation.z = Math.sin(c.ph) * 0.05 * w;
      },
    };
  };

  // ---- the cactus: lumbers, arms swinging; blooms in its idle and bristles when it is excited
  BUILD.cactus = (x) => {
    const { cols: { b, a, d }, joint } = x, rig = x.rig;
    legs(x, 0.2, 0.14, 0.06, d, d);
    const y0 = 0.14, g = x.g();
    // the pot: a terracotta cup with a rim and soil
    rev(g, [[0.3, 0.0, 0.5, -0.8], [0.44, 0.06, 0.9, -0.2], [0.5, 0.36, 0.95, 0.1], [0.56, 0.4, 0.3, 0.9], [0.56, 0.5, 0.4, 0.9], [0.5, 0.52, 0, 1], [0.42, 0.5, -0.7, 0.7]], { segs: 18, at: [0, y0, 0], color: paint(d) });
    ball(g, [0, y0 + 0.47, 0], [0.4, 0.04, 0.4], flat([0.28, 0.2, 0.15]), { segs: 14, rings: 3 });
    // the trunk: ribbed (eight ridges), round on top
    const rib = (ang) => 1 + 0.06 * Math.cos(ang * 8);
    rev(g, [[0.34, 0.5], [0.4, 0.62, 0.9, 0.1], [0.42, 1.0, 1, 0], [0.4, 1.4, 0.9, 0.2], [0.32, 1.64, 0.6, 0.6], [0.16, 1.78, 0.3, 0.9], [0.0, 1.82, 0, 1]], { segs: 24, at: [0, y0, 0], mod: (ang) => rib(ang), color: paint(b) });
    // the spines: tiny cream thorns in rings
    const cream = [0.97, 0.95, 0.82];
    for (let r = 0; r < 6; r++) for (let i = 0; i < 8; i++) {
      const ang = ((i + (r % 2) * 0.5) / 8) * TAU + 0.2, yy = y0 + 0.78 + r * 0.17; if (Math.abs(ang % TAU) > 5.6 && r > 3 && false) continue;
      if (Math.abs(Math.sin(ang)) < 0.55 && Math.cos(ang) > 0.55 && yy < y0 + 1.6) continue; // none across the face
      spike(g, [Math.sin(ang) * 0.4, yy, Math.cos(ang) * 0.4], [Math.sin(ang), 0.15, Math.cos(ang)], 0.075, 0.016, flat(cream), 3);
    }
    x.mk('cactus', g, x.holder);
    // the arms: a bend out and up on each side, each on its own shoulder joint (the walk and the emotes swing them)
    rig.shL = joint('shL', [0.36, y0 + 0.98, 0]); rig.shR = joint('shR', [-0.36, y0 + 0.98, 0]);
    for (const [sh, sd] of [[rig.shL, 1], [rig.shR, -1]]) {
      const ag = x.g();
      sweep(ag, (t) => (t < 0.5 ? [sd * (0.02 + t * 0.4), 0, 0] : [sd * (0.22 + 0.04 * Math.sin((t - 0.5) * 3)), (t - 0.5) * 0.7, 0]), (t) => 0.115 - t * 0.02, paint(b), { steps: 10, segs: 8, ref: [0, 0, 1] });
      ball(ag, [sd * 0.24, 0.37, 0], [0.095, 0.1, 0.095], paint(b), { segs: 8, rings: 4 });
      for (let i = 0; i < 4; i++) spike(ag, [sd * 0.24 + Math.sin(i * 1.6) * 0.09, 0.1 + i * 0.07, Math.cos(i * 1.6) * 0.09], [Math.sin(i * 1.6), 0.2, Math.cos(i * 1.6)], 0.06, 0.013, flat(cream), 3);
      x.mk(sd > 0 ? 'armL' : 'armR', ag, sh);
      sh.rotation.z = sd * 0.0;
    }
    // the flower on its head: five petals round a yellow heart, one joint (it blooms)
    const fl = joint('flower', [0.03, y0 + 1.84, 0.02]), fg = x.g();
    for (let i = 0; i < 6; i++) { const ang = (i / 6) * TAU; ball(fg, [Math.sin(ang) * 0.14, 0.03, Math.cos(ang) * 0.14], [0.1, 0.05, 0.13], paint(a), { segs: 8, rings: 3, rotX: 0, rotZ: 0 }); }
    ball(fg, [0, 0.07, 0], [0.09, 0.06, 0.09], flat([0.98, 0.82, 0.2]), { segs: 8, rings: 3 });
    x.mk('flower', fg, fl);
    const trunkFace = (xx, yy) => Math.sqrt(Math.max(0.01, 0.462 * 0.462 - xx * xx));
    const F = addFace(x, x.holder, [0, y0 + 1.22, 0], { surf: trunkFace, ex: 0.13, ey: 0.07, er: 0.075, ery: 0.088, mouth: { y: -0.11, w: 0.09, th: 0.02 }, brow: { y: 0.19, w: 0.05, color: '#1f5a2a' }, z: 0.007 });
    const sA = [sp(), sp()], sF = sp();
    return {
      head: { head: [0, y0 + 1.22, 0], r: 0.4, top: y0 + 1.84, front: 0.43 }, F, gagFace: 'happy', sigFace: 'surprised', gagDur: 3, sigDur: 1.6,
      anim(rig, c) {
        const w = c.s, step = Math.sin(c.ph);
        // a slow, careful lumber: the pot rolls from side to side with each step, the arms swing opposite
        let bloom = 0.35, ax = 0, az = 0, lean = 0, sy = 1;
        if (c.gu >= 0) { const u = c.gu; bloom = 0.35 + 0.65 * ease(u / 0.3) * (1 - ease((u - 0.8) / 0.2)); lean = Math.sin(u * TAU * 1.5) * 0.06 * bump(u); }
        if (c.su >= 0) {
          // "no hugs": the arms cross over the chest, the spines puff up and the flower pops
          const u = c.su, e = bump(u) ** 0.5; az = e; bloom = 1; sy = 1 + Math.sin(u * 20) * 0.015 * e;
        }
        tilt(rig, w * 0.02, step * 0.075 * w + lean, 0, Math.abs(step) * 0.03 * w, sy);
        const swing = Math.sin(c.ph) * 0.5 * w;
        rig.shL.rotation.set(-swing * 0.6, 0, az ? -(0.5 + 2.1 * az) : 0.05 + Math.abs(swing) * 0.12);
        rig.shR.rotation.set(swing * 0.6, 0, az ? (0.5 + 2.1 * az) : -0.05 - Math.abs(swing) * 0.12);
        if (az) { rig.shL.rotation.y = -0.9 * az; rig.shR.rotation.y = 0.9 * az; }
        const fs = spring(sF, bloom, 3.5, 0.4, c.dt);
        fl.scaling.set(0.5 + 0.6 * fs, 0.4 + 0.7 * fs, 0.5 + 0.6 * fs); fl.rotation.y += c.dt * 0.4; fl.rotation.z = Math.sin(c.t * 1.5) * 0.08;
      },
    };
  };

  // ---- the traffic cone: hops on its base, directs traffic, spins like a top
  BUILD.cone = (x) => {
    const { cols: { b, a, d }, joint } = x, rig = x.rig;
    const g = x.g();
    sbox(g, [0, 0.06, 0], [0.9, 0.12, 0.9], paint(d), { n: 4, m: 3, segs: 20, rows: 5 });                       // the square base, soft
    const stripe = (y) => (y > 0.52 && y < 0.7) || (y > 0.86 && y < 0.98);
    const col = ({ p, n }) => (stripe(p[1]) ? toon(a, n[1] * 0.6) : toon(b, n[1]));
    // the cone: a tall taper with a rounded tip, painted in bands (white stripes, orange between)
    const prof = [];
    for (let k = 0; k <= 22; k++) { const y = 0.1 + (k / 22) * 1.12, r = 0.36 - ((y - 0.1) / 1.12) * 0.31 + (k === 22 ? -0.3 : 0); prof.push([Math.max(0.02, r) * (k === 22 ? 0.4 : 1), y]); }
    rev(g, prof, { segs: 22, color: col, smooth: true });
    ball(g, [0, 1.24, 0], [0.06, 0.05, 0.06], paint(b), { segs: 8, rings: 3 });
    x.mk('cone', g, x.holder);
    arms(x, 0.31, 0.62, 0.2, 0.05, a, { hand: a });
    const coneR = (y) => 0.36 - ((y - 0.1) / 1.12) * 0.31;
    const F = addFace(x, x.holder, [0, 0.0, 0], { surf: (xx, yy) => Math.sqrt(Math.max(0.0004, coneR(yy) ** 2 - xx * xx)) + 0.012, ex: 0.115, ey: 0.34, er: 0.075, ery: 0.088, mouth: { y: 0.19, w: 0.08, th: 0.022 }, brow: { y: 0.46, w: 0.055, color: '#7c2d12' }, z: 0.007 });
    const sW = sp();
    return {
      head: { head: [0, 0.4, 0], r: 0.3, top: 1.26, front: 0.34 }, F, gagFace: 'angry', sigFace: 'happy', gagDur: 3, sigDur: 1.6,
      anim(rig, c) {
        const w = c.s, hop = Math.abs(Math.sin(c.ph * 0.9)) * (0.16 + 0.08 * c.run) * w;
        // hops on its base: squash on landing, stretch in the air, leaning where it is going
        const air = hop > 0.02 ? 1.0 + hop * 0.5 : 1 - (0.1 * w) * (1 - Math.abs(Math.sin(c.ph * 0.9)));
        let rz = Math.sin(c.ph * 0.9) * 0.05 * w, ry = 0, rxl = w * 0.08 + c.run * 0.12, lift = hop;
        let l = 0, r = 0;
        if (c.gu >= 0) {
          // traffic duty: a stern face, one arm up (stop), the other waving the cars on
          const u = c.gu, e = ease(u / 0.15) * (1 - ease((u - 0.85) / 0.15));
          l = e; r = e * (0.5 + 0.5 * Math.sin(u * TAU * 3));
          ry = Math.sin(u * TAU) * 0.3 * e; rxl = 0.04 * e;
        }
        if (c.su >= 0) {
          // spins like a top, leaping, then a settle with a wobble
          const u = c.su, sp2 = ease(u / 0.8); ry = sp2 * TAU * 2; lift += Math.sin(Math.min(1, u / 0.8) * Math.PI) * 0.35; rz += Math.sin(u * 24) * 0.12 * Math.max(0, (u - 0.75) * 4) * (1 - u);
        }
        tilt(rig, rxl, rz + spring(sW, 0, 3, 0.3, c.dt), ry, lift, air);
        rig.shL.rotation.set(-0.2 * Math.sin(c.ph) * w, 0, l ? 1.5 * l : 0.3 + w * 0.2); rig.shR.rotation.set(0.2 * Math.sin(c.ph) * w, 0, r || l ? -(0.3 + 2.4 * (r > 0.5 || l ? 1 : 0)) * (c.gu >= 0 ? 1 : 0) - 0.3 * (c.gu >= 0 ? 0 : 1) : -0.3 - w * 0.2);
        if (c.gu >= 0) rig.shR.rotation.z = -(0.4 + 1.9 * (0.5 + 0.5 * Math.sin(c.gu * TAU * 3))) * ease(c.gu / 0.15);
        if (c.su >= 0) { rig.shL.rotation.z = 1.2; rig.shR.rotation.z = -1.2; }
      },
    };
  };

  // ---- the teapot: waddles, its lid rattling; whistles with steam, pours when it is happy
  BUILD.teapot = (x) => {
    const { cols: { b, a, d }, joint } = x, rig = x.rig;
    legs(x, 0.2, 0.17, 0.07, d, d);
    const y0 = 0.17, g = x.g();
    const band = ({ p, n }) => (Math.abs(p[1] - (y0 + 0.5)) < 0.05 ? toon(a, n[1]) : toon(b, n[1]));
    // the pot: a plump belly with a foot ring and a shoulder; the glaze takes a band of the accent
    rev(g, [[0.2, 0.0, 0.5, -0.8], [0.34, 0.02, 0.8, -0.5], [0.52, 0.18, 1, -0.2], [0.62, 0.45, 1, 0], [0.6, 0.68, 0.9, 0.4], [0.46, 0.85, 0.6, 0.8], [0.3, 0.92, 0.2, 1]], { segs: 20, at: [0, y0, 0], color: band, smooth: true });
    ball(g, [0, y0 + 0.55, 0], [0.62, 0.035, 0.62], paint(a), { segs: 20, rings: 3, recolor: false });
    x.mk('pot', g, x.holder);
    const lg = x.g();
    ball(lg, [0, 0.0, 0], [0.34, 0.2, 0.34], paint(a), { segs: 14, rings: 6 });
    ball(lg, [0, 0.2, 0], [0.075, 0.07, 0.075], paint(d), { segs: 8, rings: 3 });
    const lid = joint('lid', [0, y0 + 0.9, 0]); x.mk('lid', lg, lid);
    // the spout: a curved tube out to the right, a handle looping on the left; each hangs on its own joint
    const sg = x.g(); sweep(sg, (t) => [0.0 + t * 0.55, 0 + t * t * 0.45 + t * 0.05, 0], (t) => 0.1 - t * 0.04, paint(b), { steps: 9, segs: 8, ref: [0, 0, 1] });
    ball(sg, [0.55, 0.5, 0], [0.065, 0.04, 0.065], flat(x.ink), { segs: 8, rings: 3 });
    const spout = joint('spout', [0.46, y0 + 0.3, 0]); x.mk('spout', sg, spout);
    const hg = x.g(); sweep(hg, (t) => { const a2 = -0.4 + t * Math.PI * 1.25; return [-Math.sin(a2) * 0.0 - 0.0 - (0.34 - Math.cos(a2) * 0.34) * 1.0 - 0.0, Math.sin(a2) * 0.4, 0]; }, () => 0.055, paint(d), { steps: 12, segs: 7, ref: [0, 0, 1] });
    const handle = joint('handle', [-0.5, y0 + 0.35, 0]); x.mk('handle', hg, handle);
    const steam = joint('steam', [0.97, y0 + 0.82, 0]); const stm = puffs(x, steam, [0.97, 0.97, 1], 4, 0.07, 0.07, 'steam'); stm.setEnabled(false);
    const front = radial([[-0.5, 0.2], [-0.48, 0.34], [-0.32, 0.52], [-0.05, 0.62], [0.18, 0.6], [0.35, 0.46]], 0.014);
    const F = addFace(x, x.holder, [0, y0 + 0.5, 0], { surf: front, ex: 0.17, ey: 0.09, er: 0.085, ery: 0.1, mouth: { y: -0.1, w: 0.1, th: 0.022 }, brow: null, lid: x.look.body, z: 0.007 });
    const sS = sp(), sH = sp(), sLid = sp();
    return {
      head: { head: [0, y0 + 0.5, 0], r: 0.5, top: y0 + 1.1, front: 0.62 }, F, gagFace: 'surprised', sigFace: 'happy', gagDur: 2.8, sigDur: 1.9,
      anim(rig, c) {
        const w = c.s, st = Math.sin(c.ph);
        let rz = st * 0.12 * w, rx = c.run * 0.1, lift = Math.abs(st) * 0.05 * w, lidK = Math.abs(st) * 0.5 * w, steamK = 0, sp2 = 0, open = 0;
        if (c.gu >= 0) {
          // the kettle's whistle: the lid chatters on its steam, the whole pot shudders
          const u = c.gu, e = ease(u / 0.1) * (1 - ease((u - 0.88) / 0.12));
          lidK = e * (0.8 + Math.sin(c.t * 40) * 0.8); rz += Math.sin(c.t * 38) * 0.03 * e; steamK = e; open = e * 0.8;
        }
        if (c.su >= 0) {
          // pours: leans over to the spout side, the lid pops and the steam comes out happy
          const u = c.su, e = u < 0.25 ? ease(u / 0.25) : u < 0.75 ? 1 : 1 - ease((u - 0.75) / 0.25);
          rz = -0.75 * e + Math.sin(c.t * 18) * 0.02 * e; lift += 0.0; lidK = e * 0.9; steamK = e; sp2 = e; open = e * 0.3;
        }
        tilt(rig, rx, rz, 0, lift, 1);
        lid.position.y = y0 + 0.9 + spring(sLid, lidK * 0.07, 6, 0.25, c.dt); lid.rotation.z = Math.sin(c.t * 33) * 0.05 * (lidK > 0.4 ? 1 : 0);
        spout.rotation.z = spring(sS, -st * 0.12 * w - 0.0 - sp2 * 0.2, 3.5, 0.3, c.dt); handle.rotation.z = spring(sH, st * 0.14 * w, 3.5, 0.3, c.dt);
        stm.setEnabled(steamK > 0.05);
        if (steamK > 0.05) { const k = (c.t * 1.6) % 1; steam.position.y = y0 + 0.82 + k * 0.4; steam.position.x = 0.97 + Math.sin(c.t * 5) * 0.05; const sc = steamK * Math.sin(k * Math.PI) * 1.2 + 0.001; steam.scaling.set(sc, sc, sc); }
        F.open = open;
      },
    };
  };

  // ---- the banana: a curved sway; peels when it is happy
  BUILD.banana = (x) => {
    const { cols: { b, a, d }, joint } = x, rig = x.rig;
    legs(x, 0.1, 0.24, 0.058, d, a);
    const y0 = 0.24, g = x.g();
    const path = (t) => [0, y0 + 0.02 + t * 1.25, 0.1 - Math.sin(t * 1.3) * 0.34];
    const tiltAt = (t) => Math.atan2(-(path(Math.min(1, t + 0.01))[2] - path(Math.max(0, t - 0.01))[2]), path(Math.min(1, t + 0.01))[1] - path(Math.max(0, t - 0.01))[1]);
    const radius = (t) => { const e = Math.min(1, t * 8, (1 - t) * 7); return Math.max(0.04, (0.085 + Math.pow(Math.sin(Math.PI * clamp(t * 1.04, 0, 1)), 0.7) * 0.13) * Math.pow(Math.max(e, 0.0), 0.3)); };
    const pale = tonesRgb('#fff2b0');
    // the fruit: a rounded five-ridged tube bending back; its top fifth is the pale inside the peel covers
    sweep(g, path, radius, ({ n, t }) => (t > 0.8 ? toon(pale, n[1]) : toon(b, n[1])), { steps: 16, segs: 12, ref: [1, 0, 0], mod: (ang) => 1 + 0.045 * Math.cos(ang * 5) });
    ball(g, [0, y0 + 0.0, 0.1], [0.06, 0.05, 0.06], paint(d), { segs: 8, rings: 3 });                          // the dark tip at the bottom
    x.mk('banana', g, x.holder);
    // the peel: three strips on hinges round the top, closed against the fruit, opening outward (the signature)
    const flaps = [], tf = 0.7, pf = path(tf), rf = radius(tf);
    for (let i = 0; i < 3; i++) {
      const fg = x.g(), ang = (i / 3) * TAU + 0.5;
      sweep(fg, (t) => [0, t * 0.38, -t * 0.09], (t) => [0.085 * (1 - t * 0.55) + 0.015, 0.016], paint(b), { steps: 5, segs: 8, ref: [1, 0, 0] });
      const tj = joint(`peelTilt${i}`, [pf[0], pf[1], pf[2]]); tj.rotation.x = -tiltAt(tf);
      const yj = joint(`peelYaw${i}`, [0, 0, 0], tj); yj.rotation.y = ang;
      const hj = joint(`peel${i}`, [0, 0, rf * 0.92], yj); x.mk(`peel${i}`, fg, hj); flaps.push(hj);
    }
    const stg = x.g(); sweep(stg, (t) => [0, t * 0.16, -t * 0.08], (t) => 0.04 + t * 0.008, paint(tonesRgb(a.base ? x.look.accent === '#ffffff' ? '#7a5a34' : x.look.accent : '#7a5a34')), { steps: 3, segs: 7 });
    const tip = path(1); const stem = joint('stem', [0, tip[1] - 0.03, tip[2]]); x.mk('stem', stg, stem);
    arms(x, 0.24, y0 + 0.8, 0.2, 0.045, b);
    const mid = path(0.4), rm = radius(0.4);
    const F = addFace(x, x.holder, [0, mid[1], mid[2]], { surf: (xx, yy) => Math.sqrt(Math.max(0.0004, rm * rm - xx * xx)) + 0.012, ex: 0.082, ey: 0.07, er: 0.055, ery: 0.066, mouth: { y: -0.06, w: 0.06, th: 0.016 }, brow: { y: 0.145, w: 0.035, color: '#6b4f10' }, z: 0.006 });
    F.j.rotation.x = -tiltAt(0.4);
    const sS = sp(), sFl = [sp(), sp(), sp()];
    return {
      head: { head: [0, mid[1], mid[2]], r: 0.2, top: path(1)[1] + 0.12, front: mid[2] + rm }, F, gagFace: 'surprised', sigFace: 'happy', gagDur: 2.6, sigDur: 2.2,
      anim(rig, c) {
        const w = c.s, st = Math.sin(c.ph);
        // swagger: the whole curve sways over the feet, a slow hip-roll, bouncing a little
        let rz = st * 0.12 * w + Math.sin(c.t * 1.4) * 0.015, rx = Math.sin(c.t * 0.9) * 0.01 + w * 0.05 + c.run * 0.12, lift = Math.abs(st) * 0.06 * w, open = 0, sq = 1;
        if (c.gu >= 0) {
          // about to slip: the foot kicks out, the body whirls over its feet, the peel flutters half open
          const u = c.gu, e = bump(u);
          rz += Math.sin(u * TAU * 2) * 0.28 * e; rx += -0.2 * e; lift += Math.max(0, Math.sin(u * TAU * 2)) * 0.05 * e; open = 0.3 * e * (1 + Math.sin(c.t * 14) * 0.3);
        }
        if (c.su >= 0) {
          // ta-da: the peel flaps open and hold, the banana leans back proudly
          const u = c.su, e = u < 0.3 ? ease(u / 0.3) : u < 0.8 ? 1 : 1 - ease((u - 0.8) / 0.2);
          open = e; rx += -0.1 * e; sq = 1 + 0.03 * Math.sin(u * 30) * e; lift += e * 0.02;
        }
        tilt(rig, rx, rz, 0, lift, sq);
        flaps.forEach((f, i) => { f.rotation.x = -0.05 + spring(sFl[i], open * (2.2 + i * 0.12), 4, 0.35, c.dt); });
        stem.rotation.x = spring(sS, -0.2 - st * 0.18 * w, 3.5, 0.3, c.dt);
      },
    };
  };

  // ---- the mushroom: bouncy; the cap squashes and puffs spores; the signature is a boing
  BUILD.mushroom = (x) => {
    const { cols: { b, a, d }, joint } = x, rig = x.rig;
    legs(x, 0.15, 0.14, 0.065, d, d);
    const y0 = 0.14, g = x.g();
    // the stem: a soft barrel flaring at the foot, a frill ring under the cap
    rev(g, [[0.0, 0.0, 0, -1], [0.3, 0.02, 0.7, -0.6], [0.36, 0.14, 1, -0.1], [0.33, 0.35, 1, 0], [0.31, 0.55, 1, 0], [0.34, 0.68, 0.8, 0.6], [0.0, 0.7, 0, 1]], { segs: 18, at: [0, y0, 0], color: paint(d), smooth: true });
    ball(g, [0, y0 + 0.64, 0], [0.4, 0.05, 0.4], paint(tonesRgb('#e8d9bd')), { segs: 18, rings: 3 });
    x.mk('stem', g, x.holder);
    // the cap: a fat dome, with the underside's gills in a darker cream
    const capJ = joint('cap', [0, y0 + 0.68, 0]), cg = x.g();
    const gill = tonesRgb('#cdbb97');
    const dome = [[0.0, 0.0, 0, -1], [0.5, 0.0, 0, -1], [0.76, 0.07, 0.9, -0.4], [0.86, 0.28, 1, 0], [0.74, 0.55, 0.8, 0.55], [0.46, 0.78, 0.5, 0.85], [0.0, 0.86, 0, 1]];
    rev(cg, dome, { segs: 24, color: ({ n }) => (n[1] < -0.6 ? toon(gill, n[1]) : toon(b, n[1])), smooth: true });
    x.mk('cap', cg, capJ);
    // the spots: white domes pressed onto the cap (a mesh of their own so they can flash)
    const sg = x.g(), spotC = mix3(a.base, a.light, 0.6);
    for (const [phi, u, r] of [[0.3, 4.1, 0.13], [2.2, 3.6, 0.1], [4.0, 3.9, 0.12], [5.3, 3.5, 0.09], [1.2, 4.7, 0.11], [3.1, 4.6, 0.1], [0.7, 3.2, 0.085], [4.7, 4.5, 0.1]]) {
      const k0 = Math.floor(u), f = u - k0, A = dome[k0], Bp = dome[Math.min(dome.length - 1, k0 + 1)];
      const rr = lerp(A[0], Bp[0], f), yy = lerp(A[1], Bp[1], f), nr = lerp(A[2], Bp[2], f), ny = lerp(A[3], Bp[3], f), nl = Math.hypot(nr, ny) || 1;
      spike(sg, [Math.sin(phi) * rr, yy, Math.cos(phi) * rr], [Math.sin(phi) * nr / nl, ny / nl, Math.cos(phi) * nr / nl], 0.03, r, spotC, 10);
    }
    const spotJ = joint('spots', [0, 0, 0], capJ); x.mk('spots', sg, spotJ);
    arms(x, 0.37, y0 + 0.42, 0.18, 0.05, d);
    const front = radial([[-0.28, 0.3], [-0.16, 0.36], [0.05, 0.33], [0.25, 0.31], [0.38, 0.34]], 0.012);
    const F = addFace(x, x.holder, [0, y0 + 0.3, 0], { surf: front, ex: 0.1, ey: 0.07, er: 0.07, ery: 0.082, mouth: { y: -0.07, w: 0.085, th: 0.018 }, brow: null, lid: x.look.head, z: 0.007 });
    const spores = joint('spores', [0, y0 + 1.3, 0]), spm = puffs(x, spores, [0.96, 0.9, 0.7], 5, 0.045, 0.16, 'spores'); spm.setEnabled(false);
    const sCap = sp(), sSp = sp();
    return {
      head: { head: [0, y0 + 0.3, 0], r: 0.4, top: y0 + 1.34, front: 0.35 }, F, gagFace: 'happy', sigFace: 'surprised', gagDur: 2.6, sigDur: 1.5,
      anim(rig, c) {
        const w = c.s, st = Math.abs(Math.sin(c.ph * 0.9)), bob = st * (0.12 + 0.08 * c.run) * w;
        let sy = 1 + (0.5 - st) * 0.0, rx = w * 0.06 + c.run * 0.1, rz = Math.sin(c.ph * 0.9) * 0.04 * w, lift = bob, capK = bob * 1.8 - w * 0.0, spore = 0, flash = 0;
        if (c.gu >= 0) {
          // a deep breath, then pfff: the cap swells and spores puff out of it
          const u = c.gu; sy = u < 0.35 ? 1 + 0.07 * ease(u / 0.35) : 1 - 0.1 * Math.sin(Math.min(1, (u - 0.35) / 0.15) * Math.PI) ; capK = u < 0.35 ? -ease(u / 0.35) * 0.5 : 0.5; spore = u > 0.4 ? (u - 0.4) / 0.6 : 0;
        }
        if (c.su >= 0) {
          // boing: crouch, spring high with the cap bouncing on the stem, the spots flashing
          const u = c.su, pre = u < 0.15 ? -ease(u / 0.15) : 0, fly = u > 0.15 && u < 0.75 ? Math.sin(((u - 0.15) / 0.6) * Math.PI) : 0;
          lift += fly * 0.55; sy = 1 + pre * 0.22 + fly * 0.1; capK = pre * 0.5 + fly * 0.6; flash = fly;
          rx += Math.sin(u * TAU) * 0.0;
        }
        tilt(rig, rx, rz, 0, lift, sy);
        const ck = spring(sCap, capK, 4.2, 0.28, c.dt);
        capJ.position.y = y0 + 0.68 + ck * 0.07; capJ.scaling.set(1 + ck * 0.05, 1 - ck * 0.08, 1 + ck * 0.05); capJ.rotation.z = Math.sin(c.ph * 0.9) * 0.05 * w;
        const fk = spring(sSp, flash, 8, 0.3, c.dt); spotJ.scaling.set(1 + fk * 0.0, 1 + fk * 0.0, 1 + fk * 0.0);
        spm.setEnabled(spore > 0 && spore < 1);
        if (spore > 0 && spore < 1) { spores.position.y = y0 + 1.3 + spore * 0.55; const sc = Math.sin(Math.PI * spore) * 1.3 + 0.001; spores.scaling.set(sc, sc, sc); spores.rotation.y = spore * 4; }
      },
    };
  };

  // ---- the potato: rocks along; at a run it tucks and rolls. Its sprout grows in its idle
  BUILD.potato = (x) => {
    const { cols: { b, a, d }, joint } = x, rig = x.rig;
    legs(x, 0.17, 0.13, 0.06, a, a);
    const y0 = 0.13, g = x.g();
    // the potato: a lumpy egg (low waves in the radius), skin freckles and a few dark eyes
    const lump = (ang, t) => 1 + 0.05 * Math.sin(ang * 3 + t * 5) + 0.035 * Math.cos(ang * 2 - t * 7 + 1);
    const prof = []; for (let k = 0; k <= 12; k++) { const th = Math.PI - (Math.PI * k) / 12; prof.push([Math.sin(th), Math.cos(th), Math.sin(th), Math.cos(th)]); }
    rev(g, prof, { segs: 20, at: [0, y0 + 0.5, 0], scale: [0.5, 0.55, 0.45], mod: lump, color: ({ n, p }) => { const spot = Math.sin(p[0] * 21) * Math.sin(p[1] * 17) * Math.sin(p[2] * 19) > 0.74; return spot ? toon(a, n[1]) : toon(b, n[1]); } });
    for (const [px, py, pz, r] of [[-0.3, 0.12, 0.35, 0.045], [0.34, -0.1, 0.3, 0.04], [-0.1, -0.3, 0.4, 0.04], [0.3, 0.3, 0.22, 0.04], [-0.38, 0.3, 0.1, 0.04]]) ball(g, [px, y0 + 0.5 + py, pz * 0.78], [r * 1.2, r, r * 0.5], paint(a), { segs: 7, rings: 3 });
    x.mk('potato', g, x.holder);
    const sg = x.g();
    sweep(sg, (t) => [0.0, t * 0.2, t * t * 0.04], (t) => 0.022 * (1 - t * 0.3), flat([0.62, 0.78, 0.35]), { steps: 4, segs: 6 });
    for (const s of [1, -1]) ball(sg, [s * 0.07, 0.2, 0.0], [0.075, 0.02, 0.045], flat([0.55, 0.75, 0.3]), { segs: 8, rings: 3, rotZ: s * 0.5 });
    const sprout = joint('sprout', [0.06, y0 + 1.04, 0]); x.mk('sprout', sg, sprout);
    sprout.scaling.set(0.625, 0.575, 0.625); // (its idle size, so the body is measured as it stands)
    arms(x, 0.46, y0 + 0.5, 0.2, 0.055, b);
    const front = (xx, yy) => 0.45 * Math.sqrt(Math.max(0.01, 1 - (xx / 0.5) ** 2 - (yy / 0.55) ** 2)) * 0.98;
    const F = addFace(x, x.holder, [0, y0 + 0.55, 0], { surf: front, ex: 0.14, ey: 0.08, er: 0.08, ery: 0.095, mouth: { y: -0.09, w: 0.1, th: 0.02 }, brow: null, lid: x.look.body, z: 0.007 });
    const sSp = sp();
    let roll = 0;
    return {
      head: { head: [0, y0 + 0.55, 0], r: 0.45, top: y0 + 1.05, front: 0.45 }, F, gagFace: 'happy', sigFace: 'happy', gagDur: 3.2, sigDur: 1.7,
      anim(rig, c) {
        const w = c.s, st = Math.sin(c.ph);
        // a gentle rock from heel to toe while walking; past a jog it curls up and rolls
        const curl = ease((c.sp - 4.2) / 2.2);
        let rx = Math.sin(c.ph * 0.9) * 0.2 * w * (1 - curl), rz = 0, lift = 0, sy = 1 - 0.06 * w * Math.abs(st) * (1 - curl), spinX = 0, grow = 0.25, look = null;
        if (curl > 0) { roll += c.sp * c.dt / 0.5; spinX = roll; lift = 0.0; sy = 1; }
        if (c.gu >= 0) { const u = c.gu; grow = 0.25 + 0.75 * ease(u / 0.4) * (1 - ease((u - 0.82) / 0.18)); look = ease(u / 0.3) * (1 - ease((u - 0.8) / 0.2)); rx += -0.05 * look; rz += Math.sin(u * TAU * 2) * 0.03 * look; }
        let ry = 0;
        if (c.su >= 0) {
          // a forward roll: tuck, tumble all the way over and pop back up
          const u = c.su; spinX = (u < 0.15 ? 0 : ease((u - 0.15) / 0.65)) * TAU; lift = Math.sin(clamp((u - 0.15) / 0.65, 0, 1) * Math.PI) * 0.18; sy = u < 0.15 ? 1 - 0.14 * ease(u / 0.15) : u > 0.85 ? 1 - 0.1 * Math.sin(((u - 0.85) / 0.15) * Math.PI) : 1; rx = 0;
        }
        tilt(rig, curl > 0 || c.su >= 0 ? spinX : rx, rz, ry, lift, sy);
        if (curl > 0 || c.su >= 0) rig.pose.position.y += 0.0;
        // curled up, the arms and feet tuck in
        const tuck = curl > 0 ? curl : c.su >= 0 ? bump(clamp((c.su - 0.05) / 0.8, 0, 1)) : 0;
        rig.hipL.rotation.x = -tuck * 1.2 + (tuck ? 0 : rig.hipL.rotation.x); rig.hipR.rotation.x = -tuck * 1.2 + (tuck ? 0 : rig.hipR.rotation.x);
        rig.shL.rotation.set(tuck ? -0.6 * tuck : rig.shL.rotation.x, 0, 0.1 + tuck * 0.6); rig.shR.rotation.set(tuck ? -0.6 * tuck : rig.shR.rotation.x, 0, -0.1 - tuck * 0.6);
        const gk = spring(sSp, grow, 3, 0.4, c.dt); sprout.scaling.set(0.5 + 0.5 * gk, 0.3 + 1.1 * gk, 0.5 + 0.5 * gk); sprout.rotation.z = Math.sin(c.t * 2.3) * 0.12 + Math.sin(c.ph) * 0.2 * w; sprout.rotation.x = Math.sin(c.t * 1.9) * 0.08;
        this.gaze = look ? [0, 0.7 * look] : null;
      },
    };
  };

  // ---- the rubber duck: waddles from side to side; squeaks (a squash and a beak); the signature is a squeaky spin
  BUILD.duck = (x) => {
    const { cols: { b, a, d }, joint } = x, rig = x.rig;
    // little orange paddle feet under the belly (the walk swings them)
    rig.hipL = joint('hipL', [0.17, 0.2, 0.05]); rig.hipR = joint('hipR', [-0.17, 0.2, 0.05]); rig.legged = true;
    const fg = x.g(); ball(fg, [0, -0.17, 0.1], [0.12, 0.035, 0.17], paint(a), { segs: 10, rings: 3 }); rev(fg, capsule(-0.17, 0.035, 0, 0.04, 2), { segs: 6, color: paint(a) });
    x.mk('footL', fg, rig.hipL); x.mk('footR', fg, rig.hipR);
    const g = x.g(), y0 = 0.2;
    // the body: a plump tub with a lifted tail; the head one big sphere on top
    ball(g, [0, y0 + 0.36, -0.03], [0.55, 0.42, 0.62], paint(b), { segs: 20, rings: 8 });
    ball(g, [0, y0 + 0.36, -0.58], [0.2, 0.17, 0.2], paint(b), { segs: 10, rings: 4, rotX: 0 });
    sweep(g, (t) => [0, y0 + 0.5 + t * 0.2, -0.56 - t * 0.2], (t) => 0.14 * (1 - t * 0.9) + 0.015, paint(b), { steps: 4, segs: 8, ref: [1, 0, 0] });
    ball(g, [0, y0 + 0.92, 0.2], [0.4, 0.38, 0.4], paint(b), { segs: 20, rings: 8 });
    x.mk('duck', g, x.holder);
    // the beak: the upper bill is fixed, the lower one hangs on a hinge (the mouth)
    const bg = x.g(); ball(bg, [0, 0.02, 0.12], [0.24, 0.07, 0.24], paint(a), { segs: 14, rings: 5 }); ball(bg, [0, 0.05, 0.0], [0.17, 0.06, 0.12], paint(a), { segs: 10, rings: 4 });
    x.mk('bill', bg, x.holder).position.set(0, y0 + 0.8, 0.5);
    const jg = x.g(); ball(jg, [0, -0.03, 0.12], [0.2, 0.045, 0.2], paint(tonesRgb(C().mixHex(look(x).accent === '#ffffff' ? '#f97316' : look(x).accent, '#000000', 0.15))), { segs: 10, rings: 3 });
    const jaw = joint('jaw', [0, y0 + 0.78, 0.5]); x.mk('jaw', jg, jaw);
    // the wings are the arms: soft leaf-shaped flippers hung from the shoulders
    rig.shL = joint('shL', [0.5, y0 + 0.52, 0.0]); rig.shR = joint('shR', [-0.5, y0 + 0.52, 0.0]);
    const wg = x.g(); ball(wg, [0.0, -0.17, -0.02], [0.06, 0.24, 0.2], paint(b), { segs: 10, rings: 5 });
    x.mk('wingL', wg, rig.shL); x.mk('wingR', wg, rig.shR);
    // eyes and cheeks on the front of the head; the beak is the mouth, so the face draws none
    const front = (xx, yy) => 0.4 * Math.sqrt(Math.max(0.01, 1 - (xx / 0.4) ** 2 - (yy / 0.38) ** 2)) * 0.99;
    const F = addFace(x, x.holder, [0, y0 + 0.92, 0.2], { surf: front, ex: 0.15, ey: 0.1, er: 0.075, ery: 0.09, mouth: null, brow: { y: 0.23, w: 0.05, color: '#a16207' }, lid: x.look.body, z: 0.007 });
    const bubbles = joint('bubbles', [0, y0 + 1.0, 0.6]), bm = puffs(x, bubbles, [0.8, 0.93, 1], 4, 0.05, 0.1, 'bubbles'); bm.setEnabled(false);
    const sW = [sp(), sp()], sJ = sp();
    return {
      head: { head: [0, y0 + 0.92, 0.2], r: 0.4, top: y0 + 1.3, front: 0.62 }, F, gagFace: 'surprised', sigFace: 'happy', gagDur: 2.2, sigDur: 1.7,
      anim(rig, c) {
        const w = c.s, st = Math.sin(c.ph);
        // the waddle: the whole duck rolls from foot to foot, dropping onto the side it steps on, head counter-swaying
        let rz = st * 0.2 * w, ry = Math.sin(c.ph * 0.5) * 0.08 * w, lift = Math.abs(st) * 0.045 * w, sy = 1, rx = c.run * 0.16 + w * 0.04, jawO = 0, wing = 0, bub = 0;
        if (c.gu >= 0) {
          // squeak, squeak: two squeezes, the beak open each time, a few bubbles
          const u = c.gu, q = Math.sin(u * Math.PI * 2 * 1.5 - 0.3); const e = bump(u);
          sy = 1 - 0.2 * Math.max(0, q) * e; jawO = Math.max(0, q) * e; bub = u > 0.2 ? (u - 0.2) / 0.8 : 0;
        }
        if (c.su >= 0) {
          // a squeaky spin: a hop with the wings wide, a full turn, a squeak on the landing
          const u = c.su, pre = u < 0.12 ? -ease(u / 0.12) : 0, fly = u > 0.12 && u < 0.72 ? Math.sin(((u - 0.12) / 0.6) * Math.PI) : 0, land = u > 0.72 ? Math.sin(((u - 0.72) / 0.28) * Math.PI) : 0;
          lift += fly * 0.3; sy = 1 + pre * 0.2 + fly * 0.06 - land * 0.16; ry = ease((u - 0.12) / 0.6) * TAU; wing = fly + 0.3 * bump(u); jawO = Math.max(fly, land) * 0.8;
        }
        tilt(rig, rx, rz, ry, lift, sy);
        rig.hipL.rotation.x = Math.sin(c.ph) * 0.6 * w; rig.hipR.rotation.x = -Math.sin(c.ph) * 0.6 * w;
        jaw.rotation.x = spring(sJ, jawO * 0.6 + Math.max(0, st) * 0.0, 8, 0.4, c.dt);
        rig.shL.rotation.set(0, 0, 0.12 + spring(sW[0], wing * 1.2 + Math.max(0, st) * 0.25 * w, 5, 0.35, c.dt)); rig.shR.rotation.set(0, 0, -0.12 - spring(sW[1], wing * 1.2 + Math.max(0, -st) * 0.25 * w, 5, 0.35, c.dt));
        bm.setEnabled(bub > 0 && bub < 1);
        if (bub > 0 && bub < 1) { bubbles.position.y = y0 + 1.0 + bub * 0.5; const sc = Math.sin(Math.PI * bub) * 1.2 + 0.001; bubbles.scaling.set(sc, sc, sc); }
      },
    };
  };

  /** The look a builder was given (its colors). */
  const look = (x) => x.look;

  // (the TV robot, the roll-bot and the robot are built in presence-robots.js: P.things.register)

  // ------------------------------------------------------------------ registry and the frame
  const ORDER = Object.keys(BUILD);
  /** presence-bodies.js build(): registered as THINGS[id](kit, colors, { rig, holder, look }) -> the head. */
  function builder(id) {
    return (k, c, ctx) => {
      const x = context(ctx.rig, ctx.holder, ctx.look);
      const th = BUILD[id](x);
      th.id = id; th.own = true; th.t0 = 0; th.idleT = 0; th.nextGag = 3 + Math.random() * 1.5; th.gagAt = -1; th.sigAt = -1; th.lastEm = null;
      ctx.rig.thing = th;
      return th.head;
    };
  }
  /** Every frame, after presence.js sets the walk's rest pose: schedules the gag and the signature, poses the thing, drives its face. */
  function animate(rig, dt, s) {
    const th = rig.thing;
    if (!th) return;
    const t = rig.time || 0, em = rig.emote;
    const name = em && em.def ? em.def.name : null;
    if (em !== th.lastEm) { th.lastEm = em; if (em && name !== 'sit' && name !== 'sleep') th.sigAt = t; }
    let su = -1, gu = -1;
    if (th.sigAt >= 0) { su = (t - th.sigAt) / th.sigDur; if (su > 1) { th.sigAt = -1; su = -1; } }
    const forced = rig.forcePose;
    if (forced === 'react') { const T = th.sigDur + 0.9, u = (t % T) / th.sigDur; su = u <= 1 ? u : -1; }
    // booting up (presence-robots.js): the first seconds a machine is there (or looped by /avatars pose=boot): bu is 0..1 through it, -1 when not
    let bu = -1;
    if (th.bootDur) { const bt = forced === 'boot' ? t % (th.bootDur + 1.4) : t - (th.bootAt || 0); bu = bt >= 0 && bt < th.bootDur ? bt / th.bootDur : -1; }
    const idle = rig.speed < 0.4 && !em && su < 0;
    th.idleT = idle ? th.idleT + dt : 0;
    if (forced === 'gag') { const T = th.gagDur + 0.9, u = (t % T) / th.gagDur; gu = u <= 1 ? u : -1; }
    else {
      if (th.gagAt < 0 && idle && th.idleT > th.nextGag) { th.gagAt = t; }
      if (th.gagAt >= 0) { gu = (t - th.gagAt) / th.gagDur; if (gu > 1 || !idle) { th.gagAt = -1; gu = -1; th.nextGag = th.idleT + 6 + Math.random() * 5; if (!idle) th.nextGag = 3 + Math.random() * 3; } }
    }
    const c = { t, dt, s, run: clamp((rig.speed - 3.2) / 3.5, 0, 1), sp: rig.speed || 0, ph: rig.phase, gu, su, bu, em: name, th };
    th.anim.call(th, rig, c);
    // the face: what it feels now (the signature, the gag, the emote, or how it rests)
    let expr = th.F.rest;
    const ef = name && C().EMOTE_FACE[name];
    if (ef) expr = ef;
    if (gu >= 0 && th.gagFace) expr = th.gagFace;
    if (su >= 0 && th.sigFace) expr = th.sigFace;
    if (!ef && gu < 0 && su < 0 && rig.forcePose && C().POSE_FACE[rig.forcePose]) expr = C().POSE_FACE[rig.forcePose];
    if (rig.mood) { rig.mood.tick(dt); const mf = rig.mood.face(); if (mf) expr = mf; else if (!ef && gu < 0 && su < 0 && expr === th.F.rest) expr = C().restFace(expr, th.idleT); }
    const fx = th.faceExtra ? th.faceExtra(c) : null;
    stepFace(rig, th.F, dt, bu >= 0 && th.bootFace ? th.bootFace : expr, { open: th.F.open || 0, heart: th.F.heart, gaze: th.gaze || null, lid: fx && fx.lid });
  }


  // ------------------------------------------------------------------ props: parts a model's clips drive (docs/animations.md 2C)
  // The toaster's GLB is one mesh with one slice of toast baked in. Its clips (anim/object.json) also key two virtual bones, ToastL and
  // ToastR: two more slices, made here as small meshes that sit in the slots (hidden inside the chrome) and pop up and out when a clip
  // lifts them (idle_fidget, cheer, point, thumbsup, hurt). They hang on the model's own frame, so they follow every squash, hop and
  // lean of Body. `at` is the slice's middle in the model's units; the clip's pos is in model heights (y up, z the front).
  const PROPS = {
    toaster: { size: [0.4, 0.42, 0.07], slices: { ToastL: [0, 0.43, 0.1], ToastR: [0, 0.43, -0.15] } },
  };
  const props = {
    PROPS,
    /** Makes a model's props if its type has them: pm.props = { parts: [{ name, node, at }] }. */
    attach(rig, pm) {
      const spec = PROPS[rig.what];
      if (!spec || !pm.inner || !B.MeshBuilder) return;
      const scene = rig.scene, crust = new B.Color4(0.52, 0.31, 0.13, 1), crumb = new B.Color4(0.94, 0.75, 0.43, 1);
      const mat = new B.StandardMaterial('pm-toast', scene);
      mat.diffuseColor = new B.Color3(1, 1, 1); mat.specularColor = new B.Color3(0, 0, 0); mat.emissiveColor = new B.Color3(0.22, 0.17, 0.1);
      const parts = [];
      for (const [name, at] of Object.entries(spec.slices)) {
        const node = B.MeshBuilder.CreateBox(`pm-toast-${name}`, { width: spec.size[0], height: spec.size[1], depth: spec.size[2], faceColors: [crumb, crumb, crust, crust, crust, crust] }, scene);
        node.material = mat; node.parent = pm.inner; node.isPickable = false; node.setEnabled(false);
        parts.push({ name, node, at, shown: false });
      }
      pm.props = { parts, mat };
    },
    /** One frame: `parts` is { ToastL: { x, y, z, rx, ry, rz } } from the clips (model heights, radians) or null. A slice at rest stays hidden in its slot. */
    apply(pm, parts) {
      const pr = pm.props;
      if (!pr) return;
      const u = pm.ent.h / (pm.k || 1); // model units in a model height
      for (const part of pr.parts) {
        const v = parts && parts[part.name], up = v && (Math.abs(v.y) > 0.004 || Math.abs(v.z) > 0.004 || Math.abs(v.x) > 0.004);
        if (up !== part.shown) { part.node.setEnabled(Boolean(up)); part.shown = Boolean(up); }
        if (!up) continue;
        part.node.position.set(part.at[0] + v.x * u, part.at[1] + v.y * u, part.at[2] + v.z * u);
        part.node.rotation.set(v.rx, v.ry, v.rz);
      }
    },
  };

  /** presence-robots.js registers a body here (same shape as BUILD.<id>) and hands it the helpers above. */
  function register(id, fn) { BUILD[id] = fn; if (!ORDER.includes(id)) ORDER.push(id); if (P.bodies) P.bodies.THINGS[id] = builder(id); }
  P.things = { BUILD, ORDER, animate, makeFace, ids: ORDER, register, props, kit: { Geo, rev, ball, sbox, sweep, spike, capsule, radial, paint, flat, toon, tonesRgb, rgb, mix3, clamp, smooth, ease, lerp, bump, TAU, spring, sp, tilt, addFace, glowMat } };
  if (P.bodies) for (const id of ORDER) P.bodies.THINGS[id] = builder(id);
})();
