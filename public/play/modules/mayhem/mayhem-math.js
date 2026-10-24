// Mayhem's pure math (no Babylon, no world): where mass spawns go, how a thing splits into pieces, how blasts fall off,
// how combos score. The rest of the module uses it, and the engine tests run it in Node (test/engine/mayhem.test.ts).
/* global HawkesPlay */
(function (root) {
  'use strict';

  /** A small seeded random (mulberry32): the same seed gives the same numbers on every player's machine. */
  function rng(seed) {
    let a = (Number(seed) >>> 0) || 0x9e3779b9;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** A seed from a string (ids, names). */
  function hashSeed(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  const PATTERNS = ['scatter', 'grid', 'circle', 'line', 'pile', 'rain', 'stack'];
  /** Where `count` things go around `at` ([x, y, z]): offsets [dx, dy, dz] from it.
   *  pattern: scatter (random in the area, the default), grid, circle (a ring), line, pile (a heap that falls
   *  together), rain (dropped from the sky over the area), stack (a tower). area: a radius, or [width, depth].
   *  spacing: meters between things in grid / line / stack (default from the size). size: about how big one is. */
  function layout(count, o = {}) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const pattern = PATTERNS.includes(o.pattern) ? o.pattern : 'scatter';
    const size = Math.max(0.2, Number(o.size) || 1);
    const spacing = Math.max(0.1, Number(o.spacing) || size * 1.6);
    const r = rng(o.seed ?? 1);
    let aw, ad;
    if (Array.isArray(o.area)) { aw = Number(o.area[0]) || 10; ad = Number(o.area[1]) || aw; }
    else { const rad = Number(o.area) || Math.max(4, Math.sqrt(n) * spacing * 0.75); aw = ad = rad * 2; }
    const out = [];
    if (n === 1 && pattern !== 'rain') return [[0, 0, 0]];
    if (pattern === 'grid') {
      const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
      const rows = Math.ceil(n / cols);
      for (let i = 0; i < n; i++) { const cx = i % cols, cz = Math.floor(i / cols); out.push([(cx - (cols - 1) / 2) * spacing, 0, (cz - (rows - 1) / 2) * spacing]); }
    } else if (pattern === 'circle') {
      const rad = Array.isArray(o.area) ? aw / 2 : (Number(o.area) || Math.max(2, (n * spacing) / (2 * Math.PI)));
      for (let i = 0; i < n; i++) { const a = (i / Math.max(1, n)) * Math.PI * 2; out.push([Math.sin(a) * rad, 0, Math.cos(a) * rad]); }
    } else if (pattern === 'line') {
      for (let i = 0; i < n; i++) out.push([0, 0, (i - (n - 1) / 2) * spacing]);
    } else if (pattern === 'stack') {
      for (let i = 0; i < n; i++) out.push([(r() - 0.5) * 0.05, i * size * 1.02, (r() - 0.5) * 0.05]);
    } else if (pattern === 'pile') {
      // A rough cone of things, a little apart so they tumble into a heap.
      for (let i = 0; i < n; i++) {
        const layer = Math.floor(Math.cbrt(i * 1.5));
        const rad = Math.max(0.3, (Math.sqrt(n) * size * 0.5) / (1 + layer * 0.5));
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
        out.push([Math.sin(a) * d, layer * size * 1.1 + r() * size, Math.cos(a) * d]);
      }
    } else {
      // scatter and rain: random spots in the area, kept a little apart where they can be.
      const minD = size * 0.9;
      for (let i = 0; i < n; i++) {
        let best = null;
        for (let tries = 0; tries < 6; tries++) {
          // A rectangle for [width, depth], a circle for a radius.
          let p;
          if (Array.isArray(o.area)) p = [(r() - 0.5) * aw, 0, (r() - 0.5) * ad];
          else { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (aw / 2); p = [Math.sin(a) * d, 0, Math.cos(a) * d]; }
          best = p;
          if (n > 400 || !out.some((q) => Math.abs(q[0] - p[0]) < minD && Math.abs(q[2] - p[2]) < minD)) break;
        }
        if (pattern === 'rain') best[1] = 12 + r() * 10;
        out.push(best);
      }
    }
    return out;
  }

  /** How a box of size [w, h, d] splits into about `pieces` chunks: [{ offset: [x, y, z], size: [w, h, d] }]
   *  (offsets from its middle). Chunks are uneven, like something that really broke. */
  function fracture(size, pieces = 8, seed = 1) {
    const s = [Math.max(0.05, size[0]), Math.max(0.05, size[1]), Math.max(0.05, size[2])];
    const want = Math.max(2, Math.min(64, Math.round(Number(pieces) || 8)));
    // Cuts per axis in proportion to the axis' length (a long plank splits along its length).
    const vol = s[0] * s[1] * s[2];
    const k = Math.cbrt(want / vol);
    const cuts = s.map((x) => Math.max(1, Math.round(x * k)));
    while (cuts[0] * cuts[1] * cuts[2] > want * 1.5) { const i = cuts.indexOf(Math.max(...cuts)); cuts[i]--; }
    while (cuts[0] * cuts[1] * cuts[2] < Math.max(2, want * 0.6)) {
      // One more cut across the longest pieces.
      const per = s.map((x, j) => x / cuts[j]);
      cuts[per.indexOf(Math.max(...per))]++;
    }
    const r = rng(seed);
    const splits = cuts.map((c, ax) => {
      // c pieces along the axis: c - 1 jittered cut points.
      const pts = [0];
      for (let i = 1; i < c; i++) pts.push((i + (r() - 0.5) * 0.5) / c);
      pts.push(1);
      return pts.map((t) => (t - 0.5) * s[ax]);
    });
    const out = [];
    for (let i = 0; i < cuts[0]; i++) for (let j = 0; j < cuts[1]; j++) for (let l = 0; l < cuts[2]; l++) {
      const a = [splits[0][i], splits[1][j], splits[2][l]], b = [splits[0][i + 1], splits[1][j + 1], splits[2][l + 1]];
      out.push({ offset: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], size: [b[0] - a[0], b[1] - a[1], b[2] - a[2]] });
    }
    return out;
  }

  /** How strongly a blast reaches something `d` meters away (1 at the middle, 0 at the edge). */
  const falloff = (d, radius) => Math.max(0, 1 - Math.max(0, d) / Math.max(0.01, radius)) ** 1.2;

  /** Points for mayhem: what a blast or a fire did, times the combo (things done within a couple of seconds of
   *  each other). */
  const POINTS = { hit: 10, broke: 25, kill: 50, boom: 15, burn: 5 };
  function score(what, combo = 1) { return Math.round((POINTS[what] || 0) * Math.max(1, Math.min(10, combo))); }

  /** Where something thrown is after t seconds (a grenade's arc): from + v t + g t² / 2. */
  function arc(from, v, g, t) { return [from[0] + v[0] * t, from[1] + v[1] * t + 0.5 * g * t * t, from[2] + v[2] * t]; }

  const math = { rng, hashSeed, layout, fracture, falloff, score, arc, POINTS, PATTERNS };
  if (root && root.HawkesPlay) root.HawkesPlay.mayhemMath = math;
  if (typeof module !== 'undefined' && module.exports) module.exports = math;
  if (root) root.HawkesMayhemMath = math;
})(typeof window !== 'undefined' ? window : globalThis);
