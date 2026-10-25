// Builds the halo, horns and bunny hat GLBs (public/play/models/hat-<kind>.glb) from geometry: node tools/hat-glbs.mjs
// The prop3d recipe (front-view image -> 3D) cannot make these (a floating ring, ears or horns without a base come out as donuts,
// headbands and eggs: docs/characters.md "Gen hats"), so each is one soft piece: a small cap with the parts growing out of it.
// Base at y = 0 and nothing below it, front +z, one white material (the registry row's `flat` colours it), smooth normals.
// No GPU, no network. Units are the file's own; presence-hats.js scales by the row's `width`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'play', 'models');
const SEG = 16;

/** A mesh: positions (x,y,z) and triangles. Parts are rings of SEG points joined row to row (wrapping, so no seam). */
class Mesh {
  constructor() { this.p = []; this.i = []; }
  /** rows: array of rings, each an array of [x,y,z] (closed loop). Rings are joined; a ring of one point is a pole. */
  rows(rows, flip = false) {
    const base = this.p.length / 3;
    const at = [];
    for (const r of rows) { at.push(this.p.length / 3); for (const v of r) this.p.push(...v); }
    for (let k = 0; k + 1 < rows.length; k++) {
      const a = rows[k], b = rows[k + 1], ia = at[k], ib = at[k + 1];
      const n = Math.max(a.length, b.length);
      for (let j = 0; j < n; j++) {
        const a0 = ia + (a.length === 1 ? 0 : j % a.length), a1 = ia + (a.length === 1 ? 0 : (j + 1) % a.length);
        const b0 = ib + (b.length === 1 ? 0 : j % b.length), b1 = ib + (b.length === 1 ? 0 : (j + 1) % b.length);
        const tri = (x, y, z) => this.i.push(...(flip ? [x, z, y] : [x, y, z]));
        if (a.length !== 1) tri(a0, b0, a1);
        if (b.length !== 1) tri(a1, b0, b1);
      }
    }
    return base;
  }
}
const ring = (r, y, cx = 0, cz = 0, n = SEG) => Array.from({ length: n }, (_, j) => { const t = (j / n) * Math.PI * 2; return [cx + Math.cos(t) * r, y, cz + Math.sin(t) * r]; });
/** A dome: a hemisphere of radius r, height h, flat base at y0 with a lip so nothing is open underneath. */
function dome(m, r, h, y0 = 0, cx = 0, cz = 0) {
  const rows = [[[cx, y0, cz]], ring(r, y0, cx, cz)]; // (the base disc, facing down)
  m.rows(rows, true);
  const up = [];
  const N = 6;
  for (let k = 0; k <= N; k++) { const a = (k / N) * (Math.PI / 2); up.push(k === N ? [[cx, y0 + h, cz]] : ring(r * Math.cos(a), y0 + h * Math.sin(a), cx, cz)); }
  m.rows(up, true);
}
/** A tube along a path of [x,y,z] points with a radius at each (radii taper), closed at both ends. */
function tube(m, path, radii, n = 10) {
  const rows = [];
  for (let k = 0; k < path.length; k++) {
    const p = path[k], q = path[Math.min(k + 1, path.length - 1)], o = path[Math.max(k - 1, 0)];
    let t = [q[0] - o[0], q[1] - o[1], q[2] - o[2]]; const tl = Math.hypot(...t); t = t.map((v) => v / tl);
    let u = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]; // a side vector not parallel to the path
    let a = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]]; const al = Math.hypot(...a); a = a.map((v) => v / al);
    const b = [t[1] * a[2] - t[2] * a[1], t[2] * a[0] - t[0] * a[2], t[0] * a[1] - t[1] * a[0]];
    rows.push(Array.from({ length: n }, (_, j) => { const w = (j / n) * Math.PI * 2, c = Math.cos(w) * radii[k], s = Math.sin(w) * radii[k]; return [p[0] + a[0] * c + b[0] * s, p[1] + a[1] * c + b[1] * s, p[2] + a[2] * c + b[2] * s]; }));
  }
  const first = path[0], last = path[path.length - 1];
  m.rows([[first], ...rows, [last]]);
}
/** A torus lying flat (a ring of light), radius R, tube radius r, centre height y. */
function torus(m, R, r, y, tilt = 0) {
  const rows = [];
  const M = 20, N = 10;
  for (let a = 0; a < M; a++) {
    const t = (a / M) * Math.PI * 2, cx = Math.cos(t) * R, cz = Math.sin(t) * R;
    rows.push(Array.from({ length: N }, (_, j) => { const w = (j / N) * Math.PI * 2, rr = R + Math.cos(w) * r; const x = Math.cos(t) * rr, z = Math.sin(t) * rr, yy = Math.sin(w) * r; return [x, y + yy + z * Math.sin(tilt), z * Math.cos(tilt)]; }));
    void cx; void cz;
  }
  rows.push(rows[0]);
  m.rows(rows);
}

const HATS = {
  // a small cap on the head, a thin post, and the ring of light over it
  halo() {
    const m = new Mesh();
    dome(m, 0.09, 0.07);
    tube(m, [[0, 0.05, 0], [0, 0.14, 0], [0, 0.22, 0]], [0.025, 0.02, 0.02], 8);
    torus(m, 0.2, 0.032, 0.26, 0.08);
    return m;
  },
  // a rounded cap with two horns growing out of its sides, curving up and in
  horns() {
    const m = new Mesh();
    dome(m, 0.2, 0.13);
    for (const s of [1, -1]) {
      const path = [[0.13, 0.06, 0], [0.19, 0.12, 0], [0.22, 0.22, 0], [0.2, 0.33, 0], [0.15, 0.41, 0]].map(([x, y, z]) => [x * s, y, z]);
      tube(m, path, [0.06, 0.052, 0.04, 0.026, 0.006], 10);
    }
    return m;
  },
  // a rounded cap with two long ears growing out of the top, one leaning out a little more
  bunny() {
    const m = new Mesh();
    dome(m, 0.17, 0.11);
    for (const [s, lean] of [[1, 0.08], [-1, 0.08]]) {
      const path = Array.from({ length: 9 }, (_, k) => { const t = k / 8; return [s * (0.07 + lean * t * t * 1.6 + t * 0.03), 0.07 + t * 0.4, 0.0 - t * t * 0.03]; });
      const radii = Array.from({ length: 9 }, (_, k) => { const t = k / 8; return 0.03 + 0.04 * Math.sin(Math.min(1, t * 1.15 + 0.1) * Math.PI * 0.95) ** 0.8 * (1 - t * 0.4); });
      radii[0] = 0.04; radii[8] = 0.008;
      tube(m, path, radii, 10);
    }
    return m;
  },
};

function glb(m, name) {
  const P = new Float32Array(m.p), n = P.length / 3, I = new Uint16Array(m.i);
  for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; } // (the parts above are wound the other way: glTF faces are counter-clockwise)
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) N[v * 3 + k] += f[k];
  }
  // the rings that wrap or close share positions but not indices (poles, the torus' last row): weld normals by position
  const key = (i) => [0, 1, 2].map((k) => P[i * 3 + k].toFixed(5)).join(',');
  const sum = new Map();
  for (let v = 0; v < n; v++) { const s = sum.get(key(v)) || [0, 0, 0]; for (let k = 0; k < 3; k++) s[k] += N[v * 3 + k]; sum.set(key(v), s); }
  for (let v = 0; v < n; v++) { const s = sum.get(key(v)), l = Math.hypot(...s) || 1; for (let k = 0; k < 3; k++) N[v * 3 + k] = s[k] / l; }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[v * 3 + k]); max[k] = Math.max(max[k], P[v * 3 + k]); }
  const bin = Buffer.concat([Buffer.from(P.buffer), Buffer.from(N.buffer), Buffer.from(I.buffer), Buffer.alloc((4 - (I.byteLength % 4)) % 4)]);
  const json = {
    asset: { version: '2.0', generator: 'hawkesgen tools/hat-glbs.mjs' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: `${name}-mat`, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.7 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: I.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: P.byteLength, target: 34962 },
      { buffer: 0, byteOffset: P.byteLength, byteLength: N.byteLength, target: 34962 },
      { buffer: 0, byteOffset: P.byteLength + N.byteLength, byteLength: I.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.write('glTF'); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4); return b; };
  return { bytes: Buffer.concat([head, ch(js.length, 'JSON'), js, ch(bin.length, 'BIN\0'), bin]), tris: I.length / 3, min, max };
}

for (const [kind, make] of Object.entries(HATS)) {
  const g = glb(make(), kind);
  fs.writeFileSync(path.join(out, `hat-${kind}.glb`), g.bytes);
  console.log(`hat-${kind}.glb  ${g.bytes.length} bytes  ${g.tris} triangles  x ${g.min[0].toFixed(2)}..${g.max[0].toFixed(2)}  y ${g.min[1].toFixed(2)}..${g.max[1].toFixed(2)}`);
}
