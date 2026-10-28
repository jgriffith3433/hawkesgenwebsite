// Blocks, the data (J, 2026-10-27: "make a voxel mining game"): the block types, config.blocks made sound, a world
// grown from a seed (hills, caves, ores, trees), edits, the faces a chunk shows, and aiming along the grid. No Babylon
// here: blocks.js draws and plays it; tests and the server's checks can use this alone (window.HawkesBlocksCore).
(function (root) {
  'use strict';
  // id: [name, color, top color or null, seconds to mine by hand (0: never), what it drops (a name; '' nothing), see-through]
  const TYPES = [
    ['air', '', null, 0, '', true],
    ['grass', '#7b5c3b', '#5ea83b', 0.5, 'dirt', false],
    ['dirt', '#7b5a3a', null, 0.45, 'dirt', false],
    ['stone', '#8b8e93', null, 1.2, 'cobble', false],
    ['sand', '#dcc98a', null, 0.4, 'sand', false],
    ['wood', '#7a5530', '#a98455', 0.9, 'wood', false],
    ['leaves', '#3f8a35', null, 0.2, '', true],
    ['coal', '#3b3c40', null, 1.5, 'coal', false],
    ['iron', '#c7a58b', null, 1.8, 'iron', false],
    ['gold', '#e8c547', null, 2.0, 'gold', false],
    ['diamond', '#6fe0e6', null, 2.6, 'diamond', false],
    ['planks', '#c49a5c', null, 0.7, 'planks', false],
    ['glass', '#c9ecf6', null, 0.2, '', true],
    ['brick', '#a6503c', null, 1.3, 'brick', false],
    ['snow', '#f2f6fa', null, 0.35, 'snow', false],
    ['bedrock', '#2b2c30', null, 0, '', false],
    ['cobble', '#6f7276', null, 1.2, 'cobble', false],
    ['lamp', '#ffd66a', null, 0.3, 'lamp', false],
  ];
  const ID = Object.fromEntries(TYPES.map((t, i) => [t[0], i]));
  const WORLDS = {
    hills: 'rolling grass hills, dirt over stone, ores deeper down, trees',
    caves: 'hills with caves winding through the stone',
    flat: 'one flat grass layer over dirt and stone',
    desert: 'sand dunes over stone, no trees',
    snowy: 'snowy hills, ores, a few trees',
    empty: 'nothing: a space to build in, block by block',
  };
  const CH = 16; // blocks a side in a chunk
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const int = (v, d, a, b) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? clamp(Math.round(Number(v)), a, b) : d);
  const typeOf = (v) => {
    if (typeof v === 'number') return v > 0 && v < TYPES.length ? v | 0 : v === 0 ? 0 : -1;
    const k = String(v || '').toLowerCase().trim();
    return k in ID ? ID[k] : -1;
  };

  /** config.blocks (true, a world's name, or an object) made sound. */
  function config(raw) {
    const r = raw === true ? {} : typeof raw === 'string' ? { world: raw } : raw && typeof raw === 'object' ? raw : null;
    if (!r) return null;
    const s = Array.isArray(r.size) ? r.size : [r.size, r.height, r.size];
    const size = [int(s[0], 48, 8, 128), int(s[1], 32, 8, 96), int(s[2] ?? s[0], 48, 8, 128)];
    const at = Array.isArray(r.at) ? [0, 1, 2].map((i) => Number(r.at[i]) || 0) : [0, 0, 0];
    const world = r.world in WORLDS ? r.world : 'hills';
    const c = {
      raw: r, size, at, world,
      scale: clamp(Number(r.scale) || 1, 0.25, 4),
      seed: int(r.seed, 1, 0, 2 ** 31 - 1),
      ores: r.ores !== false,
      caves: r.caves === true || (world === 'caves' && r.caves !== false),
      trees: r.trees !== false && world !== 'desert' && world !== 'empty' && world !== 'flat' ? true : r.trees === true,
      creative: Boolean(r.creative),
      reach: clamp(Number(r.reach) || 6, 2, 16),
      edits: [],
    };
    const list = Array.isArray(r.edits) ? r.edits : [];
    for (const e of list) if (validEdit(e, c)) c.edits.push([e[0] | 0, e[1] | 0, e[2] | 0, typeOf(e[3])]);
    // What makes the same world from scratch: an edit of anything else (the edits) is not a new world.
    c.key = JSON.stringify([size, at, world, c.scale, c.seed, c.ores, c.caves, c.trees]);
    return c;
  }
  function validEdit(e, c) {
    if (!Array.isArray(e) || e.length < 4) return false;
    const [x, y, z] = e;
    if (![x, y, z].every((n) => Number.isInteger(n))) return false;
    if (c && (x < 0 || y < 0 || z < 0 || x >= c.size[0] || y >= c.size[1] || z >= c.size[2])) return false;
    return typeOf(e[3]) >= 0;
  }
  const index = (c, x, y, z) => (y * c.size[2] + z) * c.size[0] + x;
  const inside = (c, x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < c.size[0] && y < c.size[1] && z < c.size[2];
  function get(c, data, x, y, z) { return inside(c, x, y, z) ? data[index(c, x, y, z)] : 0; }

  // ------------------------------------------------------------------ the world from its seed
  function hash(seed, x, y, z) {
    let h = (seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const fade = (t) => t * t * (3 - 2 * t);
  function noise2(seed, x, z) {
    const x0 = Math.floor(x), z0 = Math.floor(z), fx = fade(x - x0), fz = fade(z - z0);
    const a = hash(seed, x0, 0, z0), b = hash(seed, x0 + 1, 0, z0), c = hash(seed, x0, 0, z0 + 1), d = hash(seed, x0 + 1, 0, z0 + 1);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
  }
  function noise3(seed, x, y, z) {
    const y0 = Math.floor(y), fy = fade(y - y0);
    const lo = noise2(seed + y0 * 7919, x, z), hi = noise2(seed + (y0 + 1) * 7919, x, z);
    return lo + (hi - lo) * fy;
  }
  /** The ground's height (blocks) at a column. */
  function height(c, x, z) {
    const [, h] = c.size, s = c.seed;
    if (c.world === 'flat') return Math.floor(h / 3);
    if (c.world === 'empty') return -1;
    const big = noise2(s, x / 22, z / 22) * 0.7 + noise2(s + 11, x / 47, z / 47) * 0.3;
    const small = noise2(s + 3, x / 7, z / 7);
    const amp = c.world === 'desert' ? 0.12 : 0.26;
    return clamp(Math.floor(h * 0.42 + (big - 0.5) * 2 * h * amp + (small - 0.5) * 3), 2, h - 8);
  }
  /** Every block of the world before anyone touched it, then its saved edits. */
  function generate(c) {
    const [w, h, d] = c.size, s = c.seed, data = new Uint8Array(w * h * d);
    const tops = new Int16Array(w * d);
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      const top = height(c, x, z);
      tops[z * w + x] = top;
      for (let y = 0; y <= top; y++) {
        let t;
        if (y === 0) t = ID.bedrock;
        else if (y === top) t = c.world === 'desert' ? ID.sand : c.world === 'snowy' || top > h * 0.72 ? ID.snow : ID.grass;
        else if (y > top - 4) t = c.world === 'desert' ? ID.sand : ID.dirt;
        else {
          t = ID.stone;
          if (c.ores) {
            const r = hash(s + 5, x, y, z);
            if (y < h * 0.12 && r < 0.004) t = ID.diamond;
            else if (y < h * 0.22 && r < 0.009) t = ID.gold;
            else if (y < h * 0.45 && r < 0.022) t = ID.iron;
            else if (r < 0.04) t = ID.coal;
          }
        }
        if (c.caves && y > 1 && y < top - 2) {
          const n = noise3(s + 17, x / 9, y / 7, z / 9) * 0.65 + noise3(s + 29, x / 4, y / 4, z / 4) * 0.35;
          if (n > 0.66) t = 0;
        }
        data[index(c, x, y, z)] = t;
      }
    }
    if (c.trees) for (let z = 3; z < d - 3; z++) for (let x = 3; x < w - 3; x++) {
      const top = tops[z * w + x];
      if (top < 2 || top > h - 9 || hash(s + 41, x, 0, z) > 0.012) continue;
      const g = data[index(c, x, top, z)];
      if (g !== ID.grass && g !== ID.snow) continue;
      const tall = 4 + Math.floor(hash(s + 43, x, 1, z) * 2);
      for (let y = 1; y <= tall; y++) data[index(c, x, top + y, z)] = ID.wood;
      for (let dy = tall - 1; dy <= tall + 1; dy++) {
        const r = dy === tall + 1 ? 1 : 2;
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && hash(s + 47, x + dx, dy, z + dz) < 0.6) continue;
          const X = x + dx, Y = top + dy, Z = z + dz;
          if (inside(c, X, Y, Z) && data[index(c, X, Y, Z)] === 0) data[index(c, X, Y, Z)] = ID.leaves;
        }
      }
    }
    for (const e of c.edits) data[index(c, e[0], e[1], e[2])] = e[3];
    return data;
  }

  // ------------------------------------------------------------------ the faces a chunk shows
  // Each face: its outward normal, its four corners (a unit cube), its shade (light from above).
  const FACES = [
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], 0.8],
    [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], 0.8],
    [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], 1],
    [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], 0.55],
    [[0, 0, 1], [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], 0.7],
    [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], 0.7],
  ];
  // Babylon's front faces: its normal is -(b - a) x (c - a). Put each face's corners in that order once.
  for (const f of FACES) {
    const [a, b, cc] = f[1];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
    const n = [-(u[1] * v[2] - u[2] * v[1]), -(u[2] * v[0] - u[0] * v[2]), -(u[0] * v[1] - u[1] * v[0])];
    if (n[0] * f[0][0] + n[1] * f[0][1] + n[2] * f[0][2] < 0) f[1].reverse();
  }
  const RGB = TYPES.map((t) => [t[1], t[2] || t[1]].map((h) => (h ? [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255] : [1, 1, 1])));
  const SEE = TYPES.map((t) => t[5]);
  function buffers() { return { positions: [], normals: [], colors: [], indices: [] }; }
  /** The faces of one chunk (cx, cy, cz: chunk numbers), in the chunk's own space (meters): { solid, glass }. */
  function chunkMesh(c, data, cx, cy, cz) {
    const out = { solid: buffers(), glass: buffers() }, s = c.scale;
    const x0 = cx * CH, y0 = cy * CH, z0 = cz * CH;
    const x1 = Math.min(c.size[0], x0 + CH), y1 = Math.min(c.size[1], y0 + CH), z1 = Math.min(c.size[2], z0 + CH);
    for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const t = data[index(c, x, y, z)];
      if (!t) continue;
      const glass = t === ID.glass, b = glass ? out.glass : out.solid;
      const v = 0.93 + hash(c.seed + 97, x, y, z) * 0.12;
      for (let f = 0; f < 6; f++) {
        const [n, corners, shade] = FACES[f];
        const o = get(c, data, x + n[0], y + n[1], z + n[2]);
        if (o && !(SEE[o] && o !== t)) continue; // (hidden behind a block; see-through shows what's behind it)
        if (o === 0 && y + n[1] < 0) continue; // (the world's floor)
        const col = RGB[t][f === 2 ? 1 : 0], k = shade * (t === ID.lamp ? 1.15 : v);
        const base = b.positions.length / 3;
        for (const p of corners) {
          b.positions.push((x - x0 + p[0]) * s, (y - y0 + p[1]) * s, (z - z0 + p[2]) * s);
          b.normals.push(n[0], n[1], n[2]);
          b.colors.push(Math.min(1, col[0] * k), Math.min(1, col[1] * k), Math.min(1, col[2] * k), glass ? 0.45 : 1);
        }
        b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ aiming along the grid
  /** From a point along a direction (both in blocks), the first block hit within `max` blocks: { x, y, z, n: the face's
   *  normal, t: distance, type } or null. With `floor`, an empty world's floor counts (y = 0's underside), to build on. */
  function ray(c, data, o, dir, max, floor) {
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1, d = [dir[0] / l, dir[1] / l, dir[2] / l];
    let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
    const step = d.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
    const tDelta = d.map((v) => (v ? Math.abs(1 / v) : Infinity));
    const tMax = [0, 1, 2].map((i) => (d[i] > 0 ? (Math.floor(o[i]) + 1 - o[i]) / d[i] : d[i] < 0 ? (o[i] - Math.floor(o[i])) / -d[i] : Infinity));
    let n = [0, 0, 0], t = 0;
    for (let i = 0; i < 1000 && t <= max; i++) {
      const b = get(c, data, x, y, z);
      if (b) return { x, y, z, n, t, type: b };
      if (floor && y === -1 && n[1] === 1 && inside(c, x, 0, z)) return { x, y: -1, z, n, t, type: 0, floor: true };
      const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      t = tMax[a];
      tMax[a] += tDelta[a];
      if (a === 0) x += step[0]; else if (a === 1) y += step[1]; else z += step[2];
      n = [0, 0, 0]; n[a] = -step[a];
    }
    return null;
  }

  /** A short number for a list of edits (late joiners compare theirs with the host's). */
  function fingerprint(list) {
    let h = 2166136261;
    for (const e of list) for (const v of e) { h ^= v & 0xffff; h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  /** The edits that make `data` from the generated world (what a save keeps): [x, y, z, type]. */
  function diff(c, base, data) {
    const out = [];
    for (let i = 0; i < data.length; i++) if (data[i] !== base[i]) {
      const x = i % c.size[0], z = Math.floor(i / c.size[0]) % c.size[2], y = Math.floor(i / (c.size[0] * c.size[2]));
      out.push([x, y, z, data[i]]);
    }
    return out;
  }

  const api = { TYPES, ID, WORLDS, CH, config, validEdit, typeOf, index, inside, get, generate, height, chunkMesh, ray, fingerprint, diff, hash };
  root.HawkesBlocksCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
