// Wind and wildlife (public/play/modules/wind): the plain logic, with no Babylon and no DOM, so the engine tests run it
// in Node. wind.js draws the sway, the grass and the petals; wildlife.js the gulls, butterflies, fireflies and the fish.
//
//   TIERS[tier]               what each device draws: grass density and reach, gulls, butterflies, fireflies, petals
//   tierFor(quality, device)  'desktop' | 'tablet' | 'phone' | 'low' (the same rule as the light stack's)
//   gustAt(g, along, t)       0..1: how hard a gust is blowing at a point `along` the wind (m) now (a bump travelling with the wind)
//   nextGust(rng, now, o)     { at, speed, len, str }: when the next gust starts and how it blows
//   cell(ix, iz, ...)         the grass clumps of one cell of the meadow: the same for every player and every visit
//   isNight(hour) / nightness(hour)    fireflies by the clock
//   boids: flockStep(...)     one step of a gull flock: circling, separating, scattering and settling again
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ------------------------------------------------------------------ what a device draws
  // grass: clumps per m2 are GRASS_PER_M2 x grass (phone 30%); reach: how far round you grass is drawn (it shrinks to
  // nothing at the edge, so nothing pops); gulls 12 on a desktop, 6 on a phone; petals none on a phone.
  const GRASS_PER_M2 = 1.1;
  const TIERS = {
    desktop: { grass: 1, reach: 46, flowers: 0.07, gulls: 12, butterflies: 10, fireflies: 48, petals: 36, push: 4, palms: 10, fish: true },
    tablet: { grass: 0.6, reach: 38, flowers: 0.06, gulls: 10, butterflies: 7, fireflies: 28, petals: 20, push: 3, palms: 8, fish: true },
    phone: { grass: 0.3, reach: 30, flowers: 0.05, gulls: 6, butterflies: 4, fireflies: 14, petals: 0, push: 2, palms: 5, fish: true },
    low: { grass: 0.2, reach: 24, flowers: 0.04, gulls: 6, butterflies: 3, fireflies: 10, petals: 0, push: 1, palms: 4, fish: false },
  };
  function tierFor(quality, device) {
    if (quality === 'low') return 'low';
    if (quality === 'medium') return 'tablet';
    if (quality === 'high') return 'desktop';
    const t = device && device.tier;
    return t === 'phone' || t === 'tablet' ? t : 'desktop';
  }

  // ------------------------------------------------------------------ random numbers
  /** A seeded generator (the same sequence for the same seed). */
  function rng(seed) {
    let a = (seed | 0) ^ 0x9e3779b9;
    return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  /** One number 0..1 from two integers and a salt. */
  function hash(ix, iz, k) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(k | 0, 2147483647 - 11);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // ------------------------------------------------------------------ gusts
  // A gust is a bump travelling along the wind: g = { front (m along the wind), len (m), str (0..1) }. The shader and the
  // ear both read the same numbers, so a gust is heard where it is seen.
  const GUST_SPEED = 13;
  function gustAt(g, along) {
    if (!g || !(g.str > 0)) return 0;
    const d = (along - g.front) / (g.len || 20);
    return g.str * Math.exp(-d * d);
  }
  /** The next gust: 6 to 12 s after the last one began, 13 m/s, 18 to 32 m long, 0.6 to 1 strong. */
  function nextGust(r, now, o = {}) {
    const gap = o.gap || [6, 12];
    return { at: now + gap[0] + r() * (gap[1] - gap[0]), speed: GUST_SPEED * (0.85 + r() * 0.3), len: 18 + r() * 14, str: 0.6 + r() * 0.4 };
  }
  /** A calm breath that is always there (0..1), slow and uneven, never still. */
  const breath = (t) => 0.5 + 0.28 * Math.sin(t * 0.37) + 0.22 * Math.sin(t * 0.91 + 1.3);

  // ------------------------------------------------------------------ the meadow's clumps
  /** The clumps of one cell: [x, z, scale, yaw, tint, flower (0 none, 1..4 a colour)]. `cell` m a side. */
  function cellClumps(ix, iz, cell, density, flowers, out = []) {
    const per = density * cell * cell;
    let n = Math.floor(per) + (hash(ix, iz, 1) < per - Math.floor(per) ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const x = (ix + hash(ix, iz, 10 + k * 5)) * cell, z = (iz + hash(ix, iz, 11 + k * 5)) * cell;
      const f = hash(ix, iz, 12 + k * 5) < flowers ? 1 + Math.floor(hash(ix, iz, 13 + k * 5) * 4) : 0;
      out.push([x, z, 0.7 + hash(ix, iz, 14 + k * 5) * 0.8, hash(ix, iz, 15 + k * 5) * Math.PI * 2, hash(ix, iz, 16 + k * 5), f]);
    }
    return out;
  }
  /** 1 within `inner` of the centre, 0 at `reach`: how much of a clump's height is drawn (it grows out of the ground). */
  const fadeAt = (d, reach) => 1 - smooth(reach * 0.72, reach, d);

  // ------------------------------------------------------------------ the clock
  /** 0 by day, 1 at night: dusk 18.5-20.5, dawn 4.5-6.5 (hours 0-24). */
  function nightness(hour) {
    const h = ((Number(hour) % 24) + 24) % 24;
    return Math.max(smooth(18.5, 20.5, h), 1 - smooth(4.5, 6.5, h));
  }
  const isNight = (hour) => nightness(hour) > 0.5;
  /** 0 at night, 1 in the day: butterflies fly from about 7 to 18. */
  function dayness(hour) {
    const h = ((Number(hour) % 24) + 24) % 24;
    return smooth(6.5, 8, h) * (1 - smooth(17.5, 19, h));
  }

  // ------------------------------------------------------------------ the gulls
  // Each gull has a circle of its own (a radius and height round the flock's centre, going one way or the other), flies
  // to the place on it a little ahead, keeps off the others and glides or flaps (flap for about a second, glide for
  // two). Scattered, it flies away from the fright at speed, climbing, for a few seconds, then returns to its circle.
  /** A gull: x, y, z, vx, vy, vz, a (angle on the circle), r, h (height over the ground), dir (+1 / -1), phase, state, until. */
  function makeGull(r, i, n, c) {
    const a = (i / n) * Math.PI * 2 + r() * 0.5;
    return { x: c.x + Math.cos(a) * c.r, y: c.y + c.h, z: c.z + Math.sin(a) * c.r, vx: 0, vy: 0, vz: 0, a, r: c.r * (0.55 + r() * 0.5), h: c.h * (0.8 + r() * 0.5), dir: r() < 0.82 ? 1 : -1, phase: r() * 10, state: 'circle', until: 0, flap: 0, wing: 0, bank: 0 };
  }
  const SPEED = 7.5;
  /** One step (dt s) of one gull. `c`: the circle's centre { x, z, base (the lowest sky over it) }, `others` the flock,
   *  `ground(x, z)` the height of what is under it (the sea counts), `now` seconds. Returns the gull. */
  function flockStep(b, dt, c, others, ground, now, fright) {
    if (fright && b.state !== 'scatter') {
      b.state = 'scatter'; b.until = now + 3.5 + Math.random() * 2.5;
      const dx = b.x - fright.x, dz = b.z - fright.z, l = Math.hypot(dx, dz) || 1;
      b.fx = dx / l; b.fz = dz / l;
      b.vx = b.fx * SPEED * 1.5; b.vz = b.fz * SPEED * 1.5; b.vy = 4.5 + Math.random() * 2;
      b.flapUntil = now + 4;
    }
    let tx, ty, tz, speed = SPEED, climb = 1.2;
    if (b.state === 'scatter') {
      if (now > b.until) b.state = 'settle';
      // away, up, widening: the shape of a flock going off in every direction
      tx = b.x + b.fx * 40 + (b.dir * -b.fz) * 12; tz = b.z + b.fz * 40 + (b.dir * b.fx) * 12; ty = b.y + 9;
      speed = SPEED * 1.45; climb = 4;
    } else {
      // on the circle: the point a little ahead of where it is on it
      const dx = b.x - c.x, dz = b.z - c.z;
      b.a = Math.atan2(dz, dx);
      const ahead = b.a + b.dir * 0.5;
      tx = c.x + Math.cos(ahead) * b.r; tz = c.z + Math.sin(ahead) * b.r;
      ty = c.base + b.h + Math.sin(now * 0.4 + b.phase) * 0.8;
      if (b.state === 'settle') {
        // coming back: straight at the circle, easing the speed in, and it is a circler again when it is near it
        if (Math.hypot(dx, dz) < b.r + 5 && Math.abs(b.y - ty) < 4) b.state = 'circle';
        speed = SPEED * 1.1;
      }
    }
    // steering: toward the target, away from close neighbours
    let ax = tx - b.x, ay = ty - b.y, az = tz - b.z;
    const al = Math.hypot(ax, ay, az) || 1;
    ax = (ax / al) * speed; az = (az / al) * speed; ay = clamp(ay, -climb, climb);
    for (const o of others) {
      if (o === b) continue;
      const dx = b.x - o.x, dy = b.y - o.y, dz = b.z - o.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 9 && d2 > 1e-4) { const d = Math.sqrt(d2), k = (3 - d) * 2.4; ax += (dx / d) * k; ay += (dy / d) * k * 0.6; az += (dz / d) * k; }
    }
    const turn = 1 - Math.exp(-dt * (b.state === 'scatter' ? 5 : 2.2));
    b.vx += (ax - b.vx) * turn; b.vy += (ay - b.vy) * turn; b.vz += (az - b.vz) * turn;
    const sp = Math.hypot(b.vx, b.vz), cap = speed * 1.25;
    if (sp > cap) { b.vx *= cap / sp; b.vz *= cap / sp; }
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    // never in geometry: at least 3.2 m over what is under it (the pier's lamps and lantern are under 2.5 m)
    const g = ground(b.x, b.z);
    if (b.y < g + 3.2) { b.y = g + 3.2; if (b.vy < 0) b.vy = 0; }
    // flap and glide: flap in bursts, glide between; a scattered gull flaps the whole time
    const cycle = 2.6, flapFor = 1.0, u = ((now + b.phase) % cycle);
    const flapping = (b.state === 'scatter') || u < flapFor || b.y < g + 3.6;
    b.flap = flapping ? 1 : 0;
    // the wing's angle: beats at ~5 Hz while flapping, held a little up in a glide
    b.wing = flapping ? Math.sin((now + b.phase) * 11) : 0.12;
    b.bank = clamp(-b.dir * 0.35, -0.5, 0.5) * (b.state === 'circle' ? 1 : 0.4);
    return b;
  }

  const api = { TIERS, GRASS_PER_M2, GUST_SPEED, tierFor, rng, hash, gustAt, nextGust, breath, cellClumps, fadeAt, nightness, isNight, dayness, makeGull, flockStep, clamp, smooth };
  if (typeof window !== 'undefined') { window.HawkesWindCore = api; if (window.HawkesPlay) window.HawkesPlay.windCore = api; }
})();
