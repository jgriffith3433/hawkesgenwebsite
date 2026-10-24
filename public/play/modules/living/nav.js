// Living things, part 1: finding the way. A navigation grid laid over the world on demand (flat ground, the solid
// things standing on it, H.terrain's slopes and H.water's deep water when those modules are there), A* over it, and
// string pulling so creatures walk straight lines between corners. Pure grid code (solve, smooth) needs no Babylon, so
// the engine tests run it in Node. The rest of the module (species.js, living.js, friends.js) uses H.living.nav.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const living = (H.living = H.living || {});

  // ------------------------------------------------------------------ the grid: w x h cells, 1 = blocked
  /** A grid: { x0, z0, cell, w, h, blocked: Uint8Array, heights: Float32Array | null, rise }. */
  function makeGrid(x0, z0, w, h, cell) {
    return { x0, z0, cell, w, h, blocked: new Uint8Array(w * h), heights: null, rise: Infinity };
  }
  const cellOf = (g, x, z) => [Math.max(0, Math.min(g.w - 1, Math.round((x - g.x0) / g.cell))), Math.max(0, Math.min(g.h - 1, Math.round((z - g.z0) / g.cell)))];
  const centerOf = (g, cx, cz) => [g.x0 + cx * g.cell, g.z0 + cz * g.cell];
  /** Can you step from cell a to the neighbor b (not blocked, not too steep)? */
  function passable(g, a, b) {
    if (g.blocked[b]) return false;
    if (g.heights && Math.abs(g.heights[b] - g.heights[a]) > g.rise) return false;
    return true;
  }

  // A binary heap of node indices ordered by f.
  function heap(f) {
    const a = [];
    return {
      get size() { return a.length; },
      push(i) { a.push(i); let k = a.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (f[a[p]] <= f[a[k]]) break; [a[p], a[k]] = [a[k], a[p]]; k = p; } },
      pop() {
        const top = a[0], last = a.pop();
        if (a.length) { a[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < a.length && f[a[l]] < f[a[m]]) m = l; if (r < a.length && f[a[r]] < f[a[m]]) m = r; if (m === k) break; [a[m], a[k]] = [a[k], a[m]]; k = m; } }
        return top;
      },
    };
  }

  /** The nearest free cell to (cx, cz) within `reach` cells, or -1. */
  function nearestFree(g, cx, cz, reach = 6) {
    if (!g.blocked[cz * g.w + cx]) return cz * g.w + cx;
    for (let r = 1; r <= reach; r++) {
      let best = -1, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0 || x >= g.w || z >= g.h || g.blocked[z * g.w + x]) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = z * g.w + x; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** A* from cell index s to cell index t, 8 ways (no cutting corners). Returns { cells: [index...], partial } or null.
   *  When t can't be reached, the path goes to the reachable cell nearest it (partial: true). */
  function solve(g, s, t, o = {}) {
    const n = g.w * g.h, max = o.max || 12000;
    const gs = new Float32Array(n).fill(Infinity), f = new Float32Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    const tx = t % g.w, tz = (t / g.w) | 0;
    const hfun = (i) => { const dx = Math.abs((i % g.w) - tx), dz = Math.abs(((i / g.w) | 0) - tz); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    gs[s] = 0; f[s] = hfun(s);
    const open = heap(f);
    open.push(s);
    let best = s, bh = f[s], expanded = 0;
    while (open.size) {
      const c = open.pop();
      if (closed[c]) continue;
      closed[c] = 1;
      if (c === t) { best = c; bh = 0; break; }
      const hc = hfun(c);
      if (hc < bh) { bh = hc; best = c; }
      if (++expanded > max) break;
      const cx = c % g.w, cz = (c / g.w) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0 || x >= g.w || z >= g.h) continue;
        const i = z * g.w + x;
        if (closed[i] || !passable(g, c, i)) continue;
        if (dx && dz && (!passable(g, c, cz * g.w + x) || !passable(g, c, z * g.w + cx))) continue; // no corner cutting
        const step = dx && dz ? 1.4142 : 1;
        const climb = g.heights ? Math.abs(g.heights[i] - g.heights[c]) * 0.6 : 0;
        const ng = gs[c] + step + climb;
        if (ng < gs[i]) { gs[i] = ng; f[i] = ng + hfun(i); from[i] = c; open.push(i); }
      }
    }
    if (best === s && s !== t) return null;
    const cells = [];
    for (let i = best; i >= 0; i = from[i]) cells.push(i);
    cells.reverse();
    return { cells, partial: best !== t };
  }

  /** Is the straight line between two cells free (every cell it crosses passable)? */
  function lineFree(g, a, b) {
    let x0 = a % g.w, z0 = (a / g.w) | 0;
    const x1 = b % g.w, z1 = (b / g.w) | 0;
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0), sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz, prev = a;
    for (;;) {
      const i = z0 * g.w + x0;
      if (i !== prev && !passable(g, prev, i)) return false;
      prev = i;
      if (x0 === x1 && z0 === z1) return true;
      const e2 = 2 * err;
      // Moving diagonally: both sides must be free too, so the line never squeezes past a corner.
      if (e2 > -dz && e2 < dx) { if (g.blocked[z0 * g.w + x0 + sx] || g.blocked[(z0 + sz) * g.w + x0]) return false; }
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
    }
  }

  /** String pulling: keeps only the corners a straight walk needs. */
  function smooth(g, cells) {
    if (cells.length <= 2) return cells.slice();
    const out = [cells[0]];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) {
      if (!lineFree(g, cells[anchor], cells[i])) { out.push(cells[i - 1]); anchor = i - 1; }
    }
    out.push(cells[cells.length - 1]);
    return out;
  }

  // ------------------------------------------------------------------ the world as a grid
  const W = () => H.world;
  /** Things creatures walk around: solid things that don't move by themselves (not players, not creatures). */
  function obstacle(e, ignore) {
    if (!e.alive || !e.solid || e.isPlayer || e.remotePlayer || e.living || e === ignore) return false;
    if (e.physics === 'dynamic' && e.mass < 30) return false; // small loose things get pushed or stepped around
    return e.kind !== 'light' && e.kind !== 'spawn' && e.kind !== 'waypoint';
  }

  /** The navigation grid between two points: cells of `cell` meters (1 by default, coarser over long distances so a
   *  grid stays at most 160 x 160), blocked where something solid stands at body height, too steep where the terrain
   *  rises more than `step` per cell, and under deep water unless `swims`. */
  function grid(from, to, o = {}) {
    const margin = o.margin ?? 12;
    const r = o.radius ?? 0.4, tall = o.height ?? 1.2, step = o.step ?? 0.5;
    const minX = Math.min(from[0], to[0]) - margin, maxX = Math.max(from[0], to[0]) + margin;
    const minZ = Math.min(from[2], to[2]) - margin, maxZ = Math.max(from[2], to[2]) + margin;
    const cell = Math.max(o.cell || 1, (maxX - minX) / 159, (maxZ - minZ) / 159);
    const w = Math.ceil((maxX - minX) / cell) + 1, h = Math.ceil((maxZ - minZ) / cell) + 1;
    const g = makeGrid(minX, minZ, w, h, cell);
    const terrain = H.terrain && typeof H.terrain.heightAt === 'function' ? H.terrain : null;
    const feet = from[1];
    if (terrain) {
      g.heights = new Float32Array(w * h);
      for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) { const c = centerOf(g, x, z); const y = Number(terrain.heightAt(c[0], c[1])); g.heights[z * w + x] = Number.isFinite(y) ? y : feet; }
      g.rise = Math.max(step, (o.climb ?? 0.75) * cell);
    }
    const groundAt = (x, z) => (g.heights ? g.heights[z * w + x] : feet);
    const world = W();
    if (world) for (const e of world.entities) {
      if (!obstacle(e, o.ignore)) continue;
      const b = e.box();
      if (b.max[0] < minX - r || b.min[0] > maxX + r || b.max[2] < minZ - r || b.min[2] > maxZ + r) continue;
      const x0 = Math.max(0, Math.floor((b.min[0] - r - minX) / cell + 0.5)), x1 = Math.min(w - 1, Math.ceil((b.max[0] + r - minX) / cell - 0.5));
      const z0 = Math.max(0, Math.floor((b.min[2] - r - minZ) / cell + 0.5)), z1 = Math.min(h - 1, Math.ceil((b.max[2] + r - minZ) / cell - 0.5));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const ground = groundAt(x, z);
        // A floor (its top at your feet) or something overhead doesn't block.
        if (b.max[1] <= ground + step || b.min[1] >= ground + tall) continue;
        g.blocked[z * w + x] = 1;
      }
    }
    const water = H.water && typeof H.water.surfaceAt === 'function' ? H.water : null;
    if (water && !o.swims) {
      for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
        const c = centerOf(g, x, z);
        const s = water.surfaceAt(c[0], c[1]);
        if (s !== null && s !== undefined && Number(s) - groundAt(x, z) > (o.wade ?? 0.7)) g.blocked[z * w + x] = 1;
      }
    }
    return g;
  }

  /** A way from one point to another around what's in the way: { points: [[x, z], ...] (corners, then the end),
   *  partial (true when the end can't be reached: it goes as near as it can) } or null. `o`: radius, height, step,
   *  climb, swims, ignore (an entity), cell, margin. */
  function path(from, to, o = {}) {
    const g = grid(from, to, o);
    const [sx, sz] = cellOf(g, from[0], from[2]), [tx, tz] = cellOf(g, to[0], to[2]);
    const s = nearestFree(g, sx, sz, 4), t = nearestFree(g, tx, tz, 8);
    if (s < 0) return null;
    const r = solve(g, s, t < 0 ? tz * g.w + tx : t, o);
    if (!r) return null;
    const corners = smooth(g, r.cells).slice(1).map((i) => centerOf(g, i % g.w, (i / g.w) | 0));
    if (!r.partial && t === tz * g.w + tx && corners.length) corners[corners.length - 1] = [to[0], to[2]];
    return { points: corners, partial: r.partial || t < 0, grid: o.keepGrid ? g : undefined };
  }

  /** True if a creature can walk straight from one point to another: nothing solid across the way at knee height. */
  function clear(from, to, o = {}) {
    if (!H.physics || !H.physics.raycast) return true;
    const dx = to[0] - from[0], dz = to[2] - from[2], d = Math.hypot(dx, dz);
    if (d < 0.5) return true;
    const y = from[1] + (o.knee ?? 0.45);
    const hit = H.physics.raycast([from[0], y, from[2]], [dx, 0, dz], d, { ignore: o.ignore });
    return !hit || !hit.entity || !obstacle(hit.entity, o.ignore);
  }

  living.nav = { grid, path, clear, solve, smooth, lineFree, nearestFree, makeGrid, cellOf, centerOf, obstacle };
})();
