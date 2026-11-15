// Terrain, the pure part: a heightfield made from words (shapes, stamps, edits) and the math on it, with no Babylon and
// no DOM, so the engine tests run it in Node. terrain.js turns a field into meshes, physics, materials and scatter.
//
// A field is a square grid of heights centered on config.terrain.center:
//   { size, cells, n (= cells + 1 samples a side), cell (meters between samples), x0, z0 (the -x, -z corner),
//     heights: Float32Array(n * n) (row by row: index = iz * n + ix), paintLayer/paintAmt: Uint8Array(n * n) }
// Edits are compact arrays (so a world full of them still fits in scene.json):
//   [op, radius, amount, x1, z1, x2, z2, ...]   one dab per point (a brush stroke is one edit)
//   op: raise | lower | dig | hole | crater | flatten (amount = target height) | smooth (amount = strength 0-1) |
//       paint (amount = layer: 0 grass, 1 dirt, 2 rock, 3 snow, 4 sand, -1 erase)
/* global window */
(function (root) {
  'use strict';

  const LAYERS = ['grass', 'dirt', 'rock', 'snow', 'sand'];
  const COLORS = { grass: '#5f8f3e', dirt: '#8a6a48', rock: '#7f7c78', snow: '#f1f4f7', sand: '#d8c38c' };
  const OPS = ['raise', 'lower', 'dig', 'hole', 'crater', 'flatten', 'smooth', 'paint'];
  /** What each shape is, its default height (meters) and size, for the docs and the defaults. */
  const SHAPES = {
    flat: { height: 0, what: 'flat ground' },
    hills: { height: 14, what: 'rolling hills' },
    mountain: { height: 80, what: 'a meadow with one big mountain ahead, a road winding up it' },
    mountains: { height: 70, what: 'a range of ridged mountains, a valley where you start' },
    island: { height: 22, what: 'an island with beaches in the sea' },
    canyon: { height: 30, what: 'high ground cut by a deep canyon' },
    valley: { height: 45, what: 'a long valley between two ridges' },
    craters: { height: 12, what: 'a field of craters, like the moon' },
    dunes: { height: 10, what: 'sand dunes' },
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() && isFinite(Number(v)) ? Number(v) : d);

  // ------------------------------------------------------------------ seeded randomness and noise
  function hashSeed(s) {
    if (typeof s === 'number' && isFinite(s)) return (Math.floor(s) * 2654435761) >>> 0;
    let h = 2166136261;
    for (const c of String(s ?? 1)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = hashSeed(seed) || 1;
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  /** 2D gradient noise in [-1, 1] (Perlin's, with a seeded permutation). */
  function makeNoise(seed) {
    const r = rng(seed);
    const p = new Uint8Array(512);
    const base = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
    const gx = new Float64Array([1, -1, 1, -1, 1.41, -1.41, 0, 0]), gz = new Float64Array([1, 1, -1, -1, 0, 0, 1.41, -1.41]);
    return (x, z) => {
      const X = Math.floor(x), Z = Math.floor(z);
      const fx = x - X, fz = z - Z;
      const xi = X & 255, zi = Z & 255;
      const aa = p[p[xi] + zi] & 7, ab = p[p[xi] + zi + 1] & 7, ba = p[p[xi + 1] + zi] & 7, bb = p[p[xi + 1] + zi + 1] & 7;
      const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
      const gaa = gx[aa] * fx + gz[aa] * fz, gba = gx[ba] * (fx - 1) + gz[ba] * fz;
      const gab = gx[ab] * fx + gz[ab] * (fz - 1), gbb = gx[bb] * (fx - 1) + gz[bb] * (fz - 1);
      const x1 = gaa + u * (gba - gaa), x2 = gab + u * (gbb - gab);
      const r = (x1 + v * (x2 - x1)) * 0.75;
      return r < -1 ? -1 : r > 1 ? 1 : r;
    };
  }
  function fbm(noise, x, z, octaves = 5, gain = 0.5) {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) { sum += a * noise(x * f + i * 17.3, z * f - i * 9.1); norm += a; a *= gain; f *= 2.03; }
    return sum / norm;
  }
  function ridged(noise, x, z, octaves = 5) {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) { const n = 1 - Math.abs(noise(x * f + i * 31.7, z * f + i * 11.3)); sum += a * n * n; norm += a; a *= 0.5; f *= 2.1; }
    return sum / norm;
  }

  // ------------------------------------------------------------------ the config, read forgivingly
  /** config.terrain (true, a shape name, or an object) as a full description with defaults. */
  function normalize(value) {
    let v = value;
    if (v === true) v = {};
    if (typeof v === 'string') v = { shape: v };
    if (!v || typeof v !== 'object') v = {};
    const shape = SHAPES[String(v.shape || '').toLowerCase()] ? String(v.shape).toLowerCase() : v.shape === undefined ? 'hills' : guessShape(v.shape);
    const size = clamp(num(v.size, shape === 'flat' ? 256 : 512), 32, 4096);
    // Detail: meters between height samples. 1 m up to 512 m; bigger worlds get coarser (at most 1024 cells a side).
    const detail = clamp(num(v.detail, Math.max(1, size / 512)), size / 1024, 16);
    const cells = Math.max(64, Math.ceil(size / detail / 64) * 64); // whole chunks of 64 cells (terrain.js)
    const center = Array.isArray(v.center) ? [num(v.center[0], 0), num(v.center[1], 0)] : [0, 0];
    const height = num(v.height, SHAPES[shape].height);
    const seaDefault = shape === 'island' ? 0 : false;
    const sea = v.sea === true ? 0 : v.sea === false || v.sea === null ? false : num(v.sea, seaDefault);
    return {
      shape, size, cells, detail: size / cells, center, height, seed: v.seed ?? 1,
      y: num(v.y, 0), roughness: clamp(num(v.roughness, 0.5), 0, 1),
      home: v.home !== false, sea, road: v.road !== false,
      snow: v.snow === false ? false : v.snow === true ? null : num(v.snow, null),
      colors: v.colors && typeof v.colors === 'object' ? v.colors : {},
      textures: v.textures && typeof v.textures === 'object' ? v.textures : {},
      maps: v.maps && typeof v.maps === 'object' ? v.maps : {},
      tile: clamp(num(v.tile, 4), 0.25, 64),
      macro: v.macro === false ? false : v.macro && typeof v.macro === 'object' ? v.macro : (v.macro ? {} : null),
      splat: v.splat && typeof v.splat === 'object' ? v.splat : {},
      scatter: v.scatter === false ? false : v.scatter && typeof v.scatter === 'object' ? v.scatter : null,
      add: Array.isArray(v.add) ? v.add.filter((s) => s && typeof s === 'object') : [],
      edits: Array.isArray(v.edits) ? v.edits.filter(validEdit) : [],
    };
  }
  function guessShape(s) {
    const w = String(s || '').toLowerCase();
    if (/island|beach|sea|ocean/.test(w)) return 'island';
    if (/mountains|range|alps|peaks/.test(w)) return 'mountains';
    if (/mountain|peak|volcano|hill climb|summit/.test(w)) return 'mountain';
    if (/canyon|gorge|ravine/.test(w)) return 'canyon';
    if (/valley/.test(w)) return 'valley';
    if (/crater|moon/.test(w)) return 'craters';
    if (/dune|desert|sand/.test(w)) return 'dunes';
    if (/flat|plain|field/.test(w)) return 'flat';
    return 'hills';
  }
  function validEdit(e) {
    return Array.isArray(e) && e.length >= 5 && OPS.includes(e[0]) && e.slice(1).every((n) => typeof n === 'number' && isFinite(n));
  }

  // ------------------------------------------------------------------ the field
  function makeField(cfg) {
    const n = cfg.cells + 1;
    return {
      cfg, size: cfg.size, cells: cfg.cells, n, cell: cfg.size / cfg.cells,
      x0: cfg.center[0] - cfg.size / 2, z0: cfg.center[1] - cfg.size / 2, y: cfg.y,
      heights: new Float32Array(n * n), paintLayer: new Uint8Array(n * n), paintAmt: new Uint8Array(n * n),
      min: 0, max: 0,
    };
  }
  /** World position of a sample. */
  const sx = (f, ix) => f.x0 + ix * f.cell, sz = (f, iz) => f.z0 + iz * f.cell;
  function forEachSample(f, fn) {
    for (let iz = 0; iz < f.n; iz++) { const z = sz(f, iz); for (let ix = 0; ix < f.n; ix++) fn(ix, iz, sx(f, ix), z, iz * f.n + ix); }
  }
  /** Calls fn for samples within r of (x, z): fn(index, distance, ix, iz). Returns the touched box or null. */
  function around(f, x, z, r, fn) {
    const ix0 = Math.max(0, Math.floor((x - r - f.x0) / f.cell)), ix1 = Math.min(f.n - 1, Math.ceil((x + r - f.x0) / f.cell));
    const iz0 = Math.max(0, Math.floor((z - r - f.z0) / f.cell)), iz1 = Math.min(f.n - 1, Math.ceil((z + r - f.z0) / f.cell));
    if (ix0 > ix1 || iz0 > iz1) return null;
    for (let iz = iz0; iz <= iz1; iz++) {
      const dz = sz(f, iz) - z;
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = sx(f, ix) - x;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d <= r) fn(iz * f.n + ix, d, ix, iz);
      }
    }
    return { ix0, ix1, iz0, iz1 };
  }
  const grow = (a, b) => (!a ? b : !b ? a : { ix0: Math.min(a.ix0, b.ix0), ix1: Math.max(a.ix1, b.ix1), iz0: Math.min(a.iz0, b.iz0), iz1: Math.max(a.iz1, b.iz1) });

  // ------------------------------------------------------------------ shapes (heights relative to the base level y)
  /** A smooth bump: 1 in the middle, 0 at the edge (cosine). */
  const bump = (d, r) => (d >= r ? 0 : 0.5 * (1 + Math.cos(Math.PI * d / r)));
  /** 1 up to 60% of the radius, then a smooth fall to 0: a hole's flat bottom. */
  const flatBottom = (d, r) => (d <= r * 0.6 ? 1 : d >= r ? 0 : 0.5 * (1 + Math.cos(Math.PI * (d - r * 0.6) / (r * 0.4))));
  /** The mountain's profile: 1 at the top, 0 at the foot (t = distance / radius), and its inverse. */
  const peak = (t) => (t >= 1 ? 0 : t <= 0 ? 1 : Math.pow(1 - t * t * (3 - 2 * t), 1.15));
  function peakInv(y) { let lo = 0, hi = 1; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (peak(m) > y) lo = m; else hi = m; } return (lo + hi) / 2; }

  function base(f, noise) {
    const c = f.cfg, H = c.height, S = c.size, rough = 0.4 + c.roughness;
    const cx = c.center[0], cz = c.center[1];
    const fn = {
      flat: () => 0,
      hills: (x, z) => H * 1.7 * fbm(noise, x / 110, z / 110, 5, 0.3 * rough + 0.25),
      mountain: (x, z) => 1.5 * fbm(noise, x / 60, z / 60, 4),
      mountains: (x, z) => {
        const r = ridged(noise, x / 140, z / 140, 5);
        const valley = smooth(30, 110, Math.abs(x - cx));
        return H * Math.pow(r, 1.6) * valley * 1.3 + 2 * fbm(noise, x / 40, z / 40, 3);
      },
      island: (x, z) => {
        const R = S * 0.32;
        const d = Math.hypot(x - cx, z - cz) / R + 0.25 * fbm(noise, x / 120, z / 120, 3);
        const land = 1 - smooth(0.55, 1.05, d);
        const hills = 0.35 + 0.65 * (0.5 + 0.5 * fbm(noise, x / 70, z / 70, 4));
        return land * (3 + H * hills * (1 - smooth(0.2, 0.75, d) * 0.85)) - (1 - land) * 12 * smooth(1.0, 1.6, d) - (1 - land) * 1.5;
      },
      canyon: (x, z) => {
        const wiggle = 30 * fbm(noise, x / 160, 3.3, 3);
        const across = Math.abs(z - (cz + 40) - wiggle);
        const cut = 1 - smooth(8, 26, across);
        return 2 * fbm(noise, x / 50, z / 50, 4) - H * cut + 0.15 * H * cut * fbm(noise, x / 12, z / 12, 3);
      },
      valley: (x, z) => {
        const across = Math.abs(x - cx - 20 * fbm(noise, z / 200, 7.7, 2));
        return H * smooth(35, 150, across) * (0.75 + 0.25 * ridged(noise, x / 80, z / 80, 4)) + 1.5 * fbm(noise, x / 40, z / 40, 3);
      },
      craters: (x, z) => 1.2 * fbm(noise, x / 50, z / 50, 4),
      dunes: (x, z) => {
        const w = fbm(noise, x / 200, z / 200, 2) * 40;
        return H * (0.5 + 0.5 * Math.sin((x + w) / 22 + fbm(noise, x / 90, z / 90, 3) * 2.5)) * (0.6 + 0.4 * fbm(noise, x / 130, z / 130, 2)) - H * 0.3;
      },
    }[c.shape];
    forEachSample(f, (ix, iz, x, z, i) => { f.heights[i] = fn(x, z); });
    homePad(f);
    if (c.shape === 'craters') {
      const r = rng(`${c.seed}:craters`);
      const count = Math.round((S * S) / 2600);
      for (let k = 0; k < count; k++) {
        const x = f.x0 + r() * S, z = f.z0 + r() * S;
        if (Math.hypot(x, z) < 30) continue;
        const rad = 4 + Math.pow(r(), 3) * 36;
        crater(f, x, z, rad, rad * 0.35 * (H / 12));
      }
    }
    if (c.shape === 'mountain') {
      const R = Math.min(S * 0.24, 125);
      mountainStamp(f, { at: [cx, cz + R + 30], radius: R, height: H, road: c.road }, noise);
    }
  }

  /** The spawn area stays usable: the ground near the world's origin eases to a gentle level. */
  function homePad(f) {
    const c = f.cfg;
    if (!c.home) return;
    const level = c.shape === 'island' ? 4 : 0;
    forEachSample(f, (ix, iz, x, z, i) => {
      const d = Math.hypot(x, z);
      if (d > 45) return;
      const w = 1 - smooth(14, 45, d);
      f.heights[i] = f.heights[i] * (1 - w) + level * w;
    });
  }

  /** A mountain at `at`, with (unless road: false) a road winding up it at a slope a 4x4 can drive. */
  function mountainStamp(f, s, noise) {
    const at = vec2(s.at, [0, 0]);
    const R = Math.max(10, num(s.radius, 120)), H = num(s.height, 70);
    const nz = noise || makeNoise(`${f.cfg.seed}:m`);
    around(f, at[0], at[1], R, (i, d, ix, iz) => {
      const t = d / R;
      const rough = 1 + 0.22 * Math.sin(Math.PI * Math.min(1, t * 1.6)) * (ridged(nz, sx(f, ix) / 45, sz(f, iz) / 45, 4) - 0.45);
      f.heights[i] += H * peak(t) * rough;
    });
    if (s.road !== false && H > 6) road(f, at, R, H);
  }
  /** A spiral road from the mountain's foot (on the side facing the world's origin) to its top. */
  function road(f, at, R, H) {
    const grade = 0.17, width = 8, shoulder = 7, step = 1.5;
    let ang = Math.atan2(-at[1], -at[0]);
    const pts = [];
    for (let s = 0, h = 0; s < 4000; s += step) {
      h = Math.min(H * 0.86, grade * s);
      const t = peakInv(h / H * 0.97);
      const r = Math.max(10, t * R + 6);
      pts.push([at[0] + Math.cos(ang) * r, at[1] + Math.sin(ang) * r, h, r]);
      if (h >= H * 0.86) break;
      ang += step / r;
    }
    // Each cell takes the height of the road point nearest it (within the road and its shoulders).
    const best = new Map();
    for (const p of pts) {
      around(f, p[0], p[1], width / 2 + shoulder, (i, d) => {
        const b = best.get(i);
        if (!b || d < b.d) best.set(i, { d, h: p[2] + f.y * 0 });
      });
    }
    for (const [i, b] of best) {
      const w = b.d <= width / 2 ? 1 : 1 - smooth(width / 2, width / 2 + shoulder, b.d);
      f.heights[i] = f.heights[i] * (1 - w) + b.h * w;
      if (b.d <= width / 2 + 1) { f.paintLayer[i] = 2; f.paintAmt[i] = Math.max(f.paintAmt[i], Math.round(255 * (b.d <= width / 2 ? 1 : 0.5))); }
    }
    f.road = pts.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
  }
  function crater(f, x, z, r, depth) {
    return around(f, x, z, r * 1.5, (i, d) => {
      const t = d / r;
      const bowl = t < 1 ? -depth * (1 - t * t) : 0;
      const rim = depth * 0.3 * Math.exp(-((t - 1) * (t - 1)) / 0.06);
      f.heights[i] += bowl + rim;
    });
  }
  const vec2 = (v, d) => (Array.isArray(v) ? [num(v[0], d[0]), num(v[v.length >= 3 ? 2 : 1], d[1])] : v && typeof v === 'object' ? [num(v.x, d[0]), num(v.z, d[1])] : d);

  /** One of config.terrain.add: { type, at: [x, z] (or [x, y, z]), radius, height | depth }. */
  function stamp(f, s) {
    const type = String(s.type || 'hill').toLowerCase();
    const at = vec2(s.at || s.position, [0, 0]);
    const R = Math.max(1, num(s.radius, type === 'mountain' ? 120 : type === 'crater' ? 12 : 30));
    if (type === 'mountain' || type === 'volcano') {
      mountainStamp(f, { at, radius: R, height: num(s.height, 70), road: s.road });
      if (type === 'volcano') crater(f, at[0], at[1], R * 0.12, num(s.height, 70) * 0.18);
      return;
    }
    if (type === 'hill') return void around(f, at[0], at[1], R, (i, d) => { f.heights[i] += num(s.height, 12) * bump(d, R); });
    if (type === 'crater') return void crater(f, at[0], at[1], R, num(s.depth, R * 0.4));
    if (type === 'hole' || type === 'pit') return void around(f, at[0], at[1], R, (i, d) => { f.heights[i] -= num(s.depth, 10) * flatBottom(d, R); });
    if (type === 'lake' || type === 'pond' || type === 'bowl') return void around(f, at[0], at[1], R, (i, d) => { f.heights[i] -= num(s.depth, 4) * bump(d, R); });
    if (type === 'plateau' || type === 'mesa') return void around(f, at[0], at[1], R * 1.25, (i, d) => { const w = 1 - smooth(R * 0.8, R * 1.25, d); f.heights[i] = Math.max(f.heights[i], f.heights[i] * (1 - w) + num(s.height, 15) * w); });
    if (type === 'flat' || type === 'flatten') return void around(f, at[0], at[1], R * 1.3, (i, d) => { const w = 1 - smooth(R, R * 1.3, d); f.heights[i] = f.heights[i] * (1 - w) + num(s.height, 0) * w; });
    if (type === 'ridge') {
      const to = vec2(s.to, [at[0] + R * 2, at[1]]);
      const len = Math.hypot(to[0] - at[0], to[1] - at[1]) || 1, w = num(s.width, 20);
      for (let t = 0; t <= len; t += Math.max(1, f.cell)) {
        const x = at[0] + (to[0] - at[0]) * t / len, z = at[1] + (to[1] - at[1]) * t / len;
        around(f, x, z, w, (i, d) => { f.heights[i] = Math.max(f.heights[i], f.heights[i] * 0 + num(s.height, 15) * bump(d, w)); });
      }
    }
  }

  // ------------------------------------------------------------------ edits
  /** Applies one edit (see the top of this file). Returns the box of samples it touched, or null. */
  function applyEdit(f, e) {
    if (!validEdit(e)) return null;
    const op = e[0], r = Math.max(0.3, e[1]), a = e[2];
    let box = null;
    for (let k = 3; k + 1 < e.length; k += 2) {
      const x = e[k], z = e[k + 1];
      let b = null;
      if (op === 'raise') b = around(f, x, z, r, (i, d) => { f.heights[i] += a * bump(d, r); });
      else if (op === 'lower') b = around(f, x, z, r, (i, d) => { f.heights[i] -= a * bump(d, r); });
      else if (op === 'dig' || op === 'hole') b = around(f, x, z, r, (i, d) => { f.heights[i] -= a * (op === 'hole' ? flatBottom(d, r) : bump(d, r)); });
      else if (op === 'crater') b = crater(f, x, z, r, a);
      else if (op === 'flatten') b = around(f, x, z, r, (i, d) => { const w = Math.min(1, flatBottom(d, r) * 0.6); f.heights[i] += (a - f.y - f.heights[i]) * w; });
      else if (op === 'smooth') {
        const k2 = clamp(a, 0, 1), src = [];
        around(f, x, z, r, (i, d, ix, iz) => { src.push([i, d, avg(f, ix, iz)]); });
        for (const [i, d, v] of src) f.heights[i] += (v - f.heights[i]) * k2 * bump(d, r);
        b = around(f, x, z, r, () => {});
      } else if (op === 'paint') {
        const layer = Math.round(a);
        b = around(f, x, z, r, (i, d) => {
          const amt = Math.round(255 * Math.min(1, flatBottom(d, r) * 1.2));
          if (layer < 0) { f.paintAmt[i] = Math.max(0, f.paintAmt[i] - amt); return; }
          if (f.paintLayer[i] === layer + 1) f.paintAmt[i] = Math.max(f.paintAmt[i], amt);
          else if (amt >= f.paintAmt[i]) { f.paintLayer[i] = layer + 1; f.paintAmt[i] = amt; }
        });
      }
      box = grow(box, b);
    }
    if (box && op !== 'paint') for (let iz = box.iz0; iz <= box.iz1; iz++) for (let ix = box.ix0; ix <= box.ix1; ix++) { const h = f.heights[iz * f.n + ix]; if (h < f.min) f.min = h; if (h > f.max) f.max = h; }
    return box;
  }
  function avg(f, ix, iz) {
    let s = 0, c = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const x = ix + dx, z = iz + dz;
      if (x < 0 || z < 0 || x >= f.n || z >= f.n) continue;
      s += f.heights[z * f.n + x]; c++;
    }
    return s / c;
  }
  /** The terrain's volume of a dab (cosine bump of radius r, height 1): to pile what a shovel digs. */
  const bumpVolume = (r) => Math.PI * r * r * (0.5 - 2 / (Math.PI * Math.PI));

  /** The whole field from a config: the shape, the home pad, the stamps (add), then every edit in order.
   *  o.round ({ radius, floor }): the terrain stands on a round planet (terrain.js puts it upright at its middle), so
   *  its edges ease down to the planet's ground (floor: its height there, under the sea or 0) and the whole field
   *  follows the ball's curve, meeting the ground round it without a step. Edits come after: they are made on it. */
  function generate(value, o = {}) {
    const cfg = normalize(value);
    const f = makeField(cfg);
    const noise = makeNoise(cfg.seed);
    base(f, noise);
    for (const s of cfg.add) try { stamp(f, s); } catch { /* a bad stamp is skipped */ }
    if (o.round && o.round.radius > 0) curve(f, o.round.radius, num(o.round.floor, 0));
    measure(f);
    for (const e of cfg.edits) applyEdit(f, e);
    measure(f);
    return f;
  }
  /** On a round planet of radius R: the outside eases to the planet's ground (`floor`, meters under or at sea level), in
   *  a ring from 60% of the way to the edge and all of it by the edge (so no square shows under the sea; it ends just
   *  under the planet's ground, which covers the seam), and every
   *  height drops by the ball's curve from the middle (exact: R - √(R² - r²)). */
  function curve(f, R, floor) {
    const c = f.cfg, half = c.size / 2, cx = c.center[0], cz = c.center[1];
    forEachSample(f, (ix, iz, x, z, i) => {
      const dx = x - cx, dz = z - cz, r2 = dx * dx + dz * dz;
      const k = Math.max(smooth(0.6, 0.98, Math.sqrt(r2) / half), smooth(0.82, 1, Math.max(Math.abs(dx), Math.abs(dz)) / half));
      // (Never under the planet's ground inside: the ball would cover it and only patches would show. The edge ends a
      // little under the ground: it covers the seam.)
      const top = Math.max(f.heights[i], floor + 0.25 - f.y);
      const h = top * (1 - k) + (floor - 0.6 - f.y) * k;
      f.heights[i] = h - r2 / (R + Math.sqrt(Math.max(0, R * R - r2)));
    });
  }
  function measure(f) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < f.heights.length; i++) { const h = f.heights[i]; if (h < lo) lo = h; if (h > hi) hi = h; }
    f.min = lo; f.max = hi;
  }

  // ------------------------------------------------------------------ reading the field
  /** Height (world y) at x, z (bilinear), or null outside the terrain. */
  function heightAt(f, x, z) {
    const gx = (x - f.x0) / f.cell, gz = (z - f.z0) / f.cell;
    if (!(gx >= 0 && gz >= 0 && gx <= f.cells && gz <= f.cells)) return null;
    const ix = Math.min(f.cells - 1, Math.floor(gx)), iz = Math.min(f.cells - 1, Math.floor(gz));
    const tx = gx - ix, tz = gz - iz, n = f.n, h = f.heights;
    const a = h[iz * n + ix], b = h[iz * n + ix + 1], c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
    return f.y + (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  /** The ground's up direction at x, z: [nx, ny, nz] (unit), or null outside. */
  function normalAt(f, x, z) {
    const e = f.cell;
    const l = heightAt(f, x - e, z), r = heightAt(f, x + e, z), d = heightAt(f, x, z - e), u = heightAt(f, x, z + e);
    const c = heightAt(f, x, z);
    if (c === null) return null;
    const nx = ((l ?? c) - (r ?? c)) / ((l === null || r === null) ? e : 2 * e), nz = ((d ?? c) - (u ?? c)) / ((d === null || u === null) ? e : 2 * e);
    const len = Math.hypot(nx, 1, nz);
    return [nx / len, 1 / len, nz / len];
  }
  /** Normal at a sample (central differences on the grid): writes into out at o. */
  function sampleNormal(f, ix, iz, out, o) {
    const n = f.n, h = f.heights;
    const l = h[iz * n + Math.max(0, ix - 1)], r = h[iz * n + Math.min(n - 1, ix + 1)];
    const d = h[Math.max(0, iz - 1) * n + ix], u = h[Math.min(n - 1, iz + 1) * n + ix];
    const dx = (ix > 0 && ix < n - 1 ? 2 : 1) * f.cell, dz = (iz > 0 && iz < n - 1 ? 2 : 1) * f.cell;
    const nx = (l - r) / dx, nz = (d - u) / dz;
    const len = Math.hypot(nx, 1, nz);
    out[o] = nx / len; out[o + 1] = 1 / len; out[o + 2] = nz / len;
  }
  const tmpN = [0, 0, 0];
  /** Snow line height, or Infinity when this ground has no snow (island beaches use the snow channel for wet sand). */
  function snowLine(f) {
    const c = f.cfg;
    if (c.snow === false) return Infinity;
    if (c.snow !== null && c.snow !== undefined) return c.snow;
    return f.max > 40 ? Math.max(35, f.max * 0.72) : Infinity;
  }
  /** True when the snow weight channel is wet sand (sea beaches with no alpine snow line). */
  function wetSandMode(f) { return f.cfg.sea !== false && snowLine(f) === Infinity; }
  /** How much of each ground layer a sample shows (height, slope, beach, snow/wet sand, paint): writes 5 weights.
   *  Order: grass, dirt (roads), rock (cliffs above ~35°), snow (or wet sand below the tide), sand (dry beach). */
  function weightsAt(f, ix, iz, out, o, nrm) {
    const c = f.cfg, i = iz * f.n + ix, h = f.heights[i];
    let ny = nrm;
    if (ny === undefined) { sampleNormal(f, ix, iz, tmpN, 0); ny = tmpN[1]; }
    const slope = Math.acos(clamp(ny, -1, 1)) * 57.2958;
    // Cliffs from ~35° (brief: rock above 35 degrees); a soft shoulder so edges blend.
    let rock = smooth(35, 45, slope);
    let dirt = smooth(22, 31, slope) * (1 - rock);
    const line = snowLine(f);
    let sand = 0, snow = 0;
    if (c.shape === 'dunes') {
      sand = 1 - rock;
    } else if (c.sea !== false) {
      // Wet sand below the tide, dry sand up the shore, then grass inland (Uncharted-style soft bands).
      const wet = (1 - smooth(c.sea - 0.15, c.sea + 0.35, h)) * (1 - rock);
      sand = smooth(c.sea - 0.15, c.sea + 0.35, h) * (1 - smooth(c.sea + 1.1, c.sea + 2.6, h)) * (1 - rock);
      if (line === Infinity) snow = wet; // snow channel = wet sand on islands
      else snow = smooth(line - 4, line + 4, h) * (1 - smooth(40, 52, slope));
    } else if (line !== Infinity) {
      snow = smooth(line - 4, line + 4, h) * (1 - smooth(40, 52, slope));
    }
    if (c.shape === 'craters') { rock = Math.max(rock, 0.55); dirt = Math.max(dirt, 0.3); }
    const grass = Math.max(0, 1 - rock - dirt - sand - snow);
    const s = grass + dirt + rock + snow + sand || 1;
    out[o] = grass / s; out[o + 1] = dirt / s; out[o + 2] = rock / s; out[o + 3] = snow / s; out[o + 4] = sand / s;
    const pl = f.paintLayer[i], pa = f.paintAmt[i] / 255;
    if (pl && pa > 0) { for (let k = 0; k < 5; k++) out[o + k] *= 1 - pa; out[o + pl - 1] += pa; }
  }
  /** The name of the layer that shows most at x, z ('grass', 'rock', ...), or null outside.
   *  Wet sand (snow channel on islands) still reads as 'sand' so footsteps keep the same surface names. */
  function layerAt(f, x, z) {
    const ix = Math.round((x - f.x0) / f.cell), iz = Math.round((z - f.z0) / f.cell);
    if (ix < 0 || iz < 0 || ix >= f.n || iz >= f.n) return null;
    const w = new Float32Array(5);
    weightsAt(f, ix, iz, w, 0);
    let best = 0;
    for (let k = 1; k < 5; k++) if (w[k] > w[best]) best = k;
    if (best === 3 && wetSandMode(f)) return 'sand';
    return LAYERS[best];
  }

  // ------------------------------------------------------------------ edits, made small for scene.json and the network
  const q = (v) => Math.round(v * 10) / 10;
  /** An edit with its numbers rounded to 10 cm (what's saved and sent). */
  const compact = (e) => [e[0], ...e.slice(1).map(q)];
  /** A short, order-independent fingerprint of a list of edits (players compare theirs with the host's). */
  function fingerprint(list) {
    let s = 0;
    for (const e of list) s = (s + hashSeed(JSON.stringify(e))) >>> 0;
    return s;
  }

  const api = {
    LAYERS, COLORS, SHAPES, OPS,
    normalize, generate, makeField, applyEdit, stamp, heightAt, normalAt, sampleNormal, weightsAt, layerAt,
    snowLine, wetSandMode,
    measure, compact, fingerprint, validEdit, bumpVolume, rng, makeNoise, fbm, hashSeed, guessShape,
  };
  root.HawkesTerrainCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
