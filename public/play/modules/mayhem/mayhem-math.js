// Mayhem's pure math (no Babylon, no world): where mass spawns go, how a thing splits into pieces, how blasts fall off,
// how combos score. The rest of the module uses it, and the engine tests run it in Node (test/engine/mayhem.test.ts).
/* global HawkesPlay */
(function (root) {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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


  // ------------------------------------------------------------------ game feel (mayhem-feel.js uses these)
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  /** Seconds a sound takes to reach you from `dist` m (a stylised 170 m/s, never over `cap`): the flash first, the boom after. */
  const soundDelay = (dist, speed = 170, cap = 1.1) => clamp(Math.max(0, num(dist, 0)) / Math.max(1, speed), 0, cap);
  /** When each barrel in a chain goes off, in seconds from now (same order as `dists`, metres from the blast that set
   *  them off): the shock takes dist / speed to reach it, and no two go off closer than `gap`, so a row rolls
   *  one after another instead of all at once. The whole roll never takes longer than `cap`. */
  function chainSchedule(dists, o = {}) {
    const speed = Math.max(1, num(o.speed, 16)), gap = Math.max(0, num(o.gap, 0.12)), cap = Math.max(0.2, num(o.cap, 2.4));
    const order = dists.map((d, i) => [Math.max(0, num(d, 0)), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = new Array(dists.length);
    const step = order.length > 1 ? Math.min(gap, (cap - 0.08) / (order.length - 1)) : gap; // (many barrels: the gap shrinks to fit the cap)
    let last = -Infinity;
    order.forEach(([d, i], rank) => {
      const t = Math.min(cap - step * (order.length - 1 - rank), Math.max(0.06 + d / speed, last + step)); // (leave room for the ones after it)
      out[i] = Math.round(t * 1000) / 1000; last = t;
    });
    return out;
  }
  /** How much of a blast's show to make, so a chain of ten stays inside the budget. chain: how many blasts in a row (0 =
   *  the first); live: effects alive now; level: Mayhem's quality (0 all, 1 phone, 2 minimum). Returns { k (0-1 scale of
   *  particles and debris), light (a fireball light), embers, ring } . */
  function detail(chain, live = 0, level = 0, cap = 40) {
    const base = [1, 0.75, 0.55, 0.4, 0.3][Math.min(4, Math.max(0, Math.floor(num(chain, 0))))];
    const crowd = clamp(1 - num(live, 0) / Math.max(4, cap), 0.15, 1);
    const k = clamp(base * [1, 0.7, 0.45][clamp(Math.floor(num(level, 0)), 0, 2)] * (0.4 + 0.6 * crowd), 0.12, 1);
    return { k: Math.round(k * 100) / 100, light: num(chain, 0) < 2 && level < 2 && crowd > 0.4, embers: k >= 0.3, ring: k >= 0.2 };
  }
  /** The three layers of a boom heard from `dist` m: a crack (bright, straight away, fades fastest with distance), the
   *  boom (low) and a rumble that trails behind it; each with a delay in seconds, a gain 0-1 and a lowpass cutoff in Hz
   *  (far blasts are duller). size: the blast radius. */
  function boomLayers(size, dist) {
    const R = clamp(num(size, 5), 0.5, 40), d = Math.max(0, num(dist, 0)), big = clamp(R / 6, 0.5, 2);
    const delay = soundDelay(d);
    const air = clamp(1.2 - d / 70, 0.05, 1);
    const cutoff = clamp(9000 - d * 110, 700, 9000);
    return {
      crack: { delay, gain: clamp(air * air * 0.9, 0, 1), cutoff },
      boom: { delay: delay + 0.03, gain: clamp(air * 1, 0, 1), cutoff: Math.min(cutoff, 2400), seconds: 1.5 * big },
      rumble: { delay: delay + 0.18 + d / 400, gain: clamp(air * 0.55, 0, 1), cutoff: Math.min(cutoff, 500), seconds: 1.8 * big },
    };
  }
  /** Embers a blast throws: they scale with the radius and the detail asked (0 when the show is cut down). */
  const emberCount = (radius, k = 1) => Math.round(clamp(6 + num(radius, 5) * 2.2, 6, 60) * clamp(num(k, 1), 0, 1));
  /** A launcher's kick: how far the model comes back (0-1.7), the camera's nudge and how long the muzzle flash lasts. */
  const launcherKick = (power = 1) => ({ model: clamp(1 + 0.7 * num(power, 1), 1, 1.7), camera: clamp(0.14 * num(power, 1), 0.04, 0.3), flash: 0.07 });

  /** What each layer of a blast makes (mayhem-vfx.js). radius: the blast's; k: detail from `detail()` (0-1); tier:
   *  'phone' | 'tablet' | 'desktop'. The phone makes half the particles, has no heat ripple and reads 512 px flipbooks;
   *  the smoke column lingers 6 to 8 s; the flash lasts 0.15 s; the scorch fades over 60 s. */
  function vfxPlan(radius, k = 1, tier = 'desktop', chain = 0) {
    const R = clamp(num(radius, 5), 0.5, 40), kk = clamp(num(k, 1), 0.1, 1), phone = tier === 'phone';
    const mul = phone ? 0.5 : tier === 'tablet' ? 0.75 : 1;
    const n = (v) => Math.max(2, Math.round(v * kk * mul));
    return {
      size: R < 4 ? 'S' : R < 8 ? 'M' : 'L',
      fire: n(8 + R * 2.2), smoke: n(14 + R * 2.6), sparks: n(18 + R * 4), dust: n(10 + R * 2.5),
      smokeLife: clamp(6 + R * 0.15, 6, 8), flash: 0.15, flashRange: R * 4.5, ring: R * 3,
      scorchSeconds: 60, scorchSize: R * 0.9, sheet: phone ? 512 : 1024,
      distortion: tier === 'desktop' && num(chain, 0) < 1,
      lights: phone ? 1 : 2,
    };
  }

  const math = { vfxPlan, soundDelay, chainSchedule, detail, boomLayers, emberCount, launcherKick, rng, hashSeed, layout, fracture, falloff, score, arc, POINTS, PATTERNS };
  if (root && root.HawkesPlay) root.HawkesPlay.mayhemMath = math;
  if (typeof module !== 'undefined' && module.exports) module.exports = math;
  if (root) root.HawkesMayhemMath = math;
})(typeof window !== 'undefined' ? window : globalThis);
