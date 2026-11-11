// Mix: the pure numbers (tests: test/engine/mix.test.ts). Decibels, where a sound sits for a listener (distance gain,
// equal-power pan, the low-pass that muffles far blasts), the four reverb rooms and their impulse responses made in code,
// the zone blend, and BS.1770-style loudness (blocks, gates) with the slow leveler that aims the master at -16 LUFS.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const dbToGain = (db) => Math.pow(10, db / 20);
  const gainToDb = (g) => 20 * Math.log10(Math.max(1e-9, g));

  /** The duck: what a voice does to the beds. */
  const DUCK = { musicDb: 8, ambienceDb: 4, attack: 0.15, release: 0.6 };
  const TARGET_LUFS = -16;

  /** Where a source sits for a listener { pos: [x,y,z], right: [x,y,z] }: metres, inverse-distance gain (ref = full volume
   *  up to there), pan -1 (left) .. 1 (right), equal-power left/right gains, the low-pass cutoff and the sound's delay. */
  function place(listener, at, o = {}) {
    const ref = o.ref || 4, rolloff = o.rolloff ?? 1, max = o.max || 220;
    const dx = at[0] - listener.pos[0], dy = at[1] - listener.pos[1], dz = at[2] - listener.pos[2];
    const dist = Math.hypot(dx, dy, dz);
    const d = clamp(dist, ref, max);
    const gain = ref / (ref + rolloff * (d - ref));
    const r = listener.right;
    const pan = dist < 0.01 ? 0 : clamp((dx * r[0] + dy * r[1] + dz * r[2]) / dist, -1, 1);
    const a = (pan + 1) * Math.PI / 4;
    return { dist, gain, pan, left: Math.cos(a), right: Math.sin(a), cutoff: cutoffFor(dist, o.muffle), delay: o.delay ? Math.min(0.9, dist / 343) : 0, at: [dx + listener.pos[0], dy + listener.pos[1], dz + listener.pos[2]] };
  }
  /** The low-pass for a distance: open up close, ~3.9 kHz at 100 m, dull beyond (muffle: 2 for a blast, 0 for none). */
  function cutoffFor(dist, muffle = 1) {
    if (!muffle) return 20000;
    return clamp(20000 * Math.exp(-(dist * muffle) / 70), 800, 20000);
  }

  /** The reverb rooms: length (s), the decay's time constant, a dark/bright tilt and the wet level a zone sends. */
  const ZONES = {
    open: { len: 0.35, tc: 0.07, damp: 0.55, wet: 0.14, early: [] },
    hall: { len: 2.6, tc: 0.62, damp: 0.5, wet: 0.5, early: [[0.021, 0.7], [0.037, 0.55], [0.058, 0.5], [0.083, 0.4]] },
    wood: { len: 1.1, tc: 0.26, damp: 0.3, wet: 0.42, early: [[0.012, 0.8], [0.019, 0.6], [0.031, 0.5], [0.047, 0.35]] },
    room: { len: 0.5, tc: 0.12, damp: 0.7, wet: 0.24, early: [[0.008, 0.6], [0.014, 0.4], [0.022, 0.3]] },
  };
  const ZONE_NAMES = Object.keys(ZONES);
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /** A stereo impulse response made in code (never a file): early reflections, then noise decaying exponentially and
   *  darkening as it goes (a one-pole low-pass that closes). scale (0..1) shortens it for a phone. Returns { left, right }. */
  function impulse(zone, rate, scale = 1, seed = 1) {
    const z = ZONES[zone] || ZONES.room;
    const n = Math.max(64, Math.floor(rate * z.len * scale));
    const out = [new Float32Array(n), new Float32Array(n)];
    out.forEach((buf, ch) => {
      const r = rng(seed * 7919 + ch * 104729 + zone.length);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const k = clamp(0.9 - 0.8 * (t / (z.len * scale)) * z.damp * 2, 0.08, 0.9); // the filter closes with time
        lp += k * ((r() * 2 - 1) - lp);
        buf[i] = lp * Math.exp(-t / (z.tc * Math.max(0.6, scale)));
      }
      for (const [at, g] of z.early) { const j = Math.floor((at + (ch ? 0.0017 : 0)) * rate); if (j < n) buf[j] += g * (ch ? -1 : 1); }
      buf[0] = 0; // (the dry sound is not in the reverb)
      let e = 0; for (let i = 0; i < n; i++) e += buf[i] * buf[i];
      const norm = 1 / Math.sqrt(e || 1);
      for (let i = 0; i < n; i++) buf[i] *= norm;
    });
    return { left: out[0], right: out[1] };
  }

  /** Raw zone strengths (hangar, pier, building: 0..1) to the blend of the four rooms, summing to 1 (open air is what is left). */
  function blend(raw) {
    const hall = clamp(raw.hangar || 0, 0, 1), wood = clamp(raw.pier || 0, 0, 1), room = clamp(raw.building || 0, 0, 1);
    const used = Math.min(1, hall + wood + room);
    const open = 1 - used;
    const sum = open + hall + wood + room || 1;
    return { open: open / sum, hall: hall / sum, wood: wood / sum, room: room / sum };
  }
  /** The zone to name now: the strongest, kept until another is 0.15 ahead (standing on a line never flickers). */
  function activeZone(prev, w) {
    let best = 'open';
    for (const k of ZONE_NAMES) if (w[k] > w[best]) best = k;
    if (prev && w[prev] !== undefined && w[best] - w[prev] < 0.15) return prev;
    return best;
  }
  /** How far a point is inside a box (half sizes): 1 inside, falling to 0 at `reach` metres outside it. */
  function nearBox(p, c, half, reach) {
    const dx = Math.max(0, Math.abs(p[0] - c[0]) - half[0]), dy = Math.max(0, Math.abs(p[1] - c[1]) - half[1]), dz = Math.max(0, Math.abs(p[2] - c[2]) - half[2]);
    const d = Math.hypot(dx, dy, dz);
    return d <= 0 ? 1 : 1 - smooth(0, reach, d);
  }
  /** The wooden echo: full under the deck (the player below its top, inside its footprint), about half on and beside it. */
  function pierWeight(p, c, half) {
    const under = Math.abs(p[0] - c[0]) < half[0] + 1 && Math.abs(p[2] - c[2]) < half[2] + 1.5 && p[1] < c[1] - half[1] - 0.1 && p[1] > c[1] - half[1] - 3.5;
    if (under) return 1;
    return 0.7 * nearBox(p, c, half, 6);
  }

  /** BS.1770 loudness: feed it the K-weighted mean square of each 100 ms (summed over channels). */
  class Loudness {
    constructor() { this.sub = []; this.peak = 0; this.clipped = 0; this.samples = 0; }
    push(ms) { this.sub.push(ms); if (this.sub.length > 5400) this.sub.shift(); }
    static lufs(ms) { return ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity; }
    mean(from, to) { let s = 0; for (let i = from; i < to; i++) s += this.sub[i]; return s / Math.max(1, to - from); }
    /** The last 400 ms. */
    momentary() { const n = this.sub.length; return n >= 4 ? Loudness.lufs(this.mean(n - 4, n)) : -Infinity; }
    /** The last 3 s. */
    shortTerm() { const n = this.sub.length; return n >= 10 ? Loudness.lufs(this.mean(Math.max(0, n - 30), n)) : -Infinity; }
    /** The whole run: 400 ms blocks every 100 ms, gated at -70 LUFS and then 10 LU under what is left. */
    integrated() {
      const blocks = [];
      for (let i = 0; i + 4 <= this.sub.length; i++) blocks.push(this.mean(i, i + 4));
      const loud = blocks.filter((b) => Loudness.lufs(b) > -70);
      if (!loud.length) return -Infinity;
      const gate = Loudness.lufs(loud.reduce((a, b) => a + b, 0) / loud.length) - 10;
      const kept = loud.filter((b) => Loudness.lufs(b) > gate);
      return kept.length ? Loudness.lufs(kept.reduce((a, b) => a + b, 0) / kept.length) : -Infinity;
    }
    reset() { this.sub = []; this.peak = 0; this.clipped = 0; this.samples = 0; }
  }
  /** One step of the leveler: nudges the makeup (dB) toward the target by the short-term loudness, slowly, within -9..+9, and
   *  not at all while the mix is nearly silent (no pumping up a quiet moment). */
  function level(makeupDb, shortTerm, dt, target = TARGET_LUFS) {
    if (!Number.isFinite(shortTerm) || shortTerm < -48) return makeupDb;
    const err = clamp(target - shortTerm, -12, 12);
    return clamp(makeupDb + err * 0.18 * dt, -9, 9);
  }

  H.mixMath = { clamp, smooth, dbToGain, gainToDb, DUCK, TARGET_LUFS, place, cutoffFor, ZONES, ZONE_NAMES, impulse, blend, activeZone, nearBox, pierWeight, Loudness, level };
})();
