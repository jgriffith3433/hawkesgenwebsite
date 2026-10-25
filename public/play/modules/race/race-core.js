// Races, the pure parts (no engine, no page): times, gates, the ghost and the board. race.js is the module that
// uses them; test/engine/race.test.ts runs both. Everything here works in the flat plane of the world file's numbers
// (x, z in meters; y up), which is also what a round world's scene.json holds.
(function () {
  'use strict';
  const C = {};
  const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

  /** 62310 -> "1:02.31"; 5320 -> "5.32". */
  C.fmt = function (ms) {
    const t = Math.max(0, Math.round(num(ms) / 10)); // centiseconds
    const cs = t % 100, s = Math.floor(t / 100) % 60, m = Math.floor(t / 6000);
    const two = (n) => String(n).padStart(2, '0');
    return m > 0 ? `${m}:${two(s)}.${two(cs)}` : `${s}.${two(cs)}`;
  };
  /** A difference: "+0.41" (slower) or "-0.30" (faster) seconds. */
  C.fmtDelta = function (ms) {
    const d = Math.round(num(ms) / 10) / 100;
    return `${d > 0 ? '+' : d < 0 ? '-' : '±'}${Math.abs(d).toFixed(2)}`;
  };

  /** The gates of a course as lines across the way: each has a travel direction (from the one before to the one after,
   *  so a loop's first gate faces the lap), the line across it and its half width. */
  C.gates = function (points, half, ys) {
    const n = points.length;
    return points.map((p, i) => {
      const a = points[(i - 1 + n) % n], b = points[(i + 1) % n];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      return { i, x: p[0], z: p[1], y: num(p[2], ys ? ys[i] : 0), dx, dz, lx: -dz, lz: dx, half };
    });
  };

  /** Did the step from `prev` to `cur` (each { x, z }) go through the gate, the right way? Returns the fraction of the
   *  step where it crossed, or null. A gate is a line `half` meters either side of its middle (and a little slack). */
  C.crossed = function (prev, cur, g, slack = 1.5) {
    if (!prev || !cur) return null;
    const s0 = (prev.x - g.x) * g.dx + (prev.z - g.z) * g.dz;
    const s1 = (cur.x - g.x) * g.dx + (cur.z - g.z) * g.dz;
    if (!(s0 < 0 && s1 >= 0)) return null; // only forward, only once
    const f = s0 / (s0 - s1);
    const x = prev.x + (cur.x - prev.x) * f, z = prev.z + (cur.z - prev.z) * f;
    const lat = (x - g.x) * g.lx + (z - g.z) * g.lz;
    return Math.abs(lat) <= g.half + slack ? f : null;
  };

  // ------------------------------------------------------------------ the ghost: a run as a few numbers
  const STEP = 200; // ms between samples
  C.GHOST_STEP = STEP;
  /** Samples [x, y, z, ...] (meters) -> { ms, step, p: [decimeters...] }, the run's time with them. */
  C.packGhost = function (flat, ms) {
    return { ms: Math.round(ms), step: STEP, p: flat.map((v) => Math.round(num(v) * 10)) };
  };
  C.cleanGhost = function (g) {
    if (!g || typeof g !== 'object' || !Array.isArray(g.p) || g.p.length < 6 || g.p.length % 3 !== 0 || g.p.length > 3 * 6000) return null;
    const ms = Math.floor(num(g.ms));
    if (ms <= 0) return null;
    return { ms, step: STEP, p: g.p.map((v) => Math.round(num(v))) };
  };
  /** Where the ghost is `t` ms into the run: { x, y, z, yaw (degrees, 0 faces +z), done }. */
  C.ghostAt = function (g, t) {
    const n = g.p.length / 3;
    const f = Math.max(0, t) / g.step;
    const i = Math.min(n - 1, Math.floor(f)), j = Math.min(n - 1, i + 1);
    const k = Math.min(1, f - i);
    const at = (a, b, o) => (g.p[a * 3 + o] + (g.p[b * 3 + o] - g.p[a * 3 + o]) * k) / 10;
    // (the way it faces: along the sample step, or the one before at the very end)
    let a = i, b = j;
    if (a === b && a > 0) a = a - 1;
    const dx = g.p[b * 3] - g.p[a * 3], dz = g.p[b * 3 + 2] - g.p[a * 3 + 2];
    return { x: at(i, j, 0), y: at(i, j, 1), z: at(i, j, 2), yaw: Math.hypot(dx, dz) > 0.2 ? (Math.atan2(dx, dz) * 180) / Math.PI : null, done: f >= n - 1 };
  };

  // ------------------------------------------------------------------ the board: the best runs of a course
  C.BOARD = 10;
  /** Adds a run ({ ms, name, at }) to the runs, keeps the best ten (slowest dropped). Returns the new list. */
  C.addRun = function (runs, run) {
    const list = (Array.isArray(runs) ? runs : []).filter((r) => r && num(r.ms) > 0).map((r) => ({ ms: Math.round(r.ms), name: String(r.name || 'You').slice(0, 24), at: num(r.at) }));
    list.push({ ms: Math.round(run.ms), name: String(run.name || 'You').slice(0, 24), at: num(run.at) });
    list.sort((a, b) => a.ms - b.ms || a.at - b.at);
    return list.slice(0, C.BOARD);
  };
  /** The board as shown: the runs and the rival's par in order, at most ten rows. [{ rank, name, ms, rival }]. */
  C.board = function (runs, rival) {
    const rows = (Array.isArray(runs) ? runs : []).map((r) => ({ name: r.name, ms: r.ms, rival: false, at: r.at }));
    if (rival && rival.ms > 0) rows.push({ name: rival.name || 'Pip', ms: Math.round(rival.ms), rival: true, at: 0 });
    rows.sort((a, b) => a.ms - b.ms || (a.rival ? 1 : 0) - (b.rival ? 1 : 0));
    return rows.slice(0, C.BOARD).map((r, i) => ({ rank: i + 1, name: r.name, ms: r.ms, rival: r.rival }));
  };

  /** A course from the world's config, checked: an id, a name, a vehicle class, laps and at least three gates. */
  C.course = function (c) {
    if (!c || typeof c !== 'object') return null;
    const id = String(c.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32);
    const gates = (Array.isArray(c.gates) ? c.gates : []).filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))).map((p) => [Number(p[0]), Number(p[1]), num(p[2])]);
    if (!id || gates.length < 3) return null;
    return {
      id, name: String(c.name || id).slice(0, 40), vehicle: String(c.vehicle || 'wheeled'), laps: Math.max(1, Math.min(9, Math.floor(num(c.laps, 1)))),
      width: Math.max(4, Math.min(80, num(c.width, 14))), color: /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#34d399',
      par: Math.max(0, Math.floor(num(c.par))), rival: String(c.rival || 'Pip').slice(0, 24), gates,
    };
  };

  window.HawkesRaceCore = C;
})();
