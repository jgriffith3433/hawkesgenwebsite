// The share module's math, with no Babylon and no page: easing, camera paths through keyframes (Catmull-Rom on positions
// and look-at targets, an ease per stretch), orbits, follow/dolly framing, and the "clip that" ring of recorders. The
// camera (cinematic.js), photo mode and clips (share.js) use it, and the engine tests check it in Node.
/* global HawkesPlay */
(function () {
  'use strict';
  const RAD = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const v3 = (v, d = [0, 0, 0]) => (Array.isArray(v) && v.length >= 3 ? [num(v[0], 0), num(v[1], 0), num(v[2], 0)] : v && typeof v === 'object' && 'x' in v ? [num(v.x, 0), num(v.y, 0), num(v.z, 0)] : d.slice());
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // ------------------------------------------------------------------ easing: t in 0..1 to 0..1
  const EASES = {
    linear: (t) => t,
    in: (t) => t * t * t,
    out: (t) => 1 - Math.pow(1 - t, 3),
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    smooth: (t) => t * t * (3 - 2 * t),
    sine: (t) => (1 - Math.cos(Math.PI * t)) / 2,
  };
  // Words people (and the assistant) use for them.
  const EASE_WORDS = { 'ease-in': 'in', easein: 'in', 'ease-out': 'out', easeout: 'out', 'ease-in-out': 'inOut', easeinout: 'inOut', inout: 'inOut', 'in-out': 'inOut', both: 'inOut', soft: 'smooth', none: 'linear', constant: 'linear' };
  function ease(name, t) {
    const k = String(name || 'inOut');
    const f = EASES[k] || EASES[EASE_WORDS[k.toLowerCase()]] || EASES.inOut;
    return f(clamp(t, 0, 1));
  }

  /** One Catmull-Rom coordinate between p1 and p2 (p0 and p3 are the neighbours). */
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  const cr3 = (a, b, c, d, t) => [cr(a[0], b[0], c[0], d[0], t), cr(a[1], b[1], c[1], d[1], t), cr(a[2], b[2], c[2], d[2], t)];

  /**
   * A camera path from its spec: { keys: [{ pos, look, at?, ease?, fov?, roll?, hold? }], seconds?, speed?, loop?,
   * smooth? }. Every key gets `at` (seconds from the start): given ones are kept; missing ones are spread by distance
   * (so the camera moves at an even speed) over `seconds` (or at `speed` m/s, or 2 s a key). `hold` waits at a key.
   * Keys may say `position`/`target`/`lookAt` instead of pos/look, and a key without a look looks where the next goes.
   */
  function normalizePath(spec) {
    const s = spec && typeof spec === 'object' ? spec : {};
    const raw = Array.isArray(s.keys) ? s.keys : Array.isArray(s.points) ? s.points : [];
    const keys = raw.map((k) => {
      const pos = v3(k.pos || k.position || k.p);
      const lookIn = k.look || k.lookAt || k.target || k.l;
      return { pos, look: lookIn ? v3(lookIn) : null, at: Number.isFinite(Number(k.at)) ? Number(k.at) : null, ease: k.ease || null, fov: Number.isFinite(Number(k.fov)) ? Number(k.fov) : null, roll: num(k.roll, 0), hold: Math.max(0, num(k.hold, 0)) };
    });
    // A key with nothing to look at looks along the path (at the next key, the last one onward).
    keys.forEach((k, i) => {
      if (k.look) return;
      const next = keys[i + 1] || null, prev = keys[i - 1] || null;
      if (next) k.look = next.pos.slice();
      else if (prev) k.look = [k.pos[0] + (k.pos[0] - prev.pos[0]), k.pos[1] + (k.pos[1] - prev.pos[1]), k.pos[2] + (k.pos[2] - prev.pos[2])];
      else k.look = [k.pos[0], k.pos[1], k.pos[2] + 1];
    });
    if (keys.length && keys[0].at === null) keys[0].at = 0;
    // Spread the missing times: by distance, so speed is even.
    const lens = keys.map((k, i) => (i ? Math.max(0.001, dist(keys[i - 1].pos, k.pos)) : 0));
    const total = lens.reduce((a, b) => a + b, 0);
    const holds = keys.reduce((a, k) => a + k.hold, 0);
    const seconds = Number(s.seconds) > 0 ? Number(s.seconds) : Number(s.speed) > 0 ? total / Number(s.speed) + holds : Math.max(1, (keys.length - 1) * 2) + holds;
    const perMeter = Math.max(0.001, seconds - holds) / Math.max(0.001, total);
    let i = 1;
    while (i < keys.length) {
      if (keys[i].at !== null) { i++; continue; }
      // A run of keys without times (i..j-1), after one that has a time (i-1), up to the next that has one (j) or the end.
      let j = i;
      while (j < keys.length && keys[j].at === null) j++;
      const a = keys[i - 1];
      let rate = perMeter;
      if (j < keys.length) {
        const runLen = lens.slice(i, j + 1).reduce((x, y) => x + y, 0);
        const runHolds = keys.slice(i - 1, j).reduce((x, k) => x + k.hold, 0);
        rate = Math.max(0, keys[j].at - a.at - runHolds) / Math.max(0.001, runLen);
      }
      let t = a.at + a.hold;
      for (let k = i; k < j; k++) {
        t += lens[k] * rate;
        keys[k].at = t;
        t += keys[k].hold;
      }
      i = j;
    }
    // Times only go forward.
    for (let k = 1; k < keys.length; k++) if (keys[k].at < keys[k - 1].at + keys[k - 1].hold) keys[k].at = keys[k - 1].at + keys[k - 1].hold;
    const last = keys[keys.length - 1];
    const duration = last ? last.at + last.hold : 0;
    return { keys, duration, loop: s.loop === true, ease: s.ease || null, fov: Number.isFinite(Number(s.fov)) ? Number(s.fov) : null };
  }

  /** Where the camera is t seconds into a path: { pos, look, fov, roll, done }. */
  function samplePath(path, t) {
    const p = path && path.keys ? path : normalizePath(path);
    const keys = p.keys;
    if (!keys.length) return { pos: [0, 2, -6], look: [0, 0, 0], fov: p.fov, roll: 0, done: true };
    let time = num(t, 0);
    const done = !p.loop && time >= p.duration;
    if (p.loop && p.duration > 0) time = ((time % p.duration) + p.duration) % p.duration;
    time = clamp(time, 0, p.duration);
    if (keys.length === 1 || time <= keys[0].at) { const k = keys[0]; return { pos: k.pos.slice(), look: k.look.slice(), fov: k.fov ?? p.fov, roll: k.roll, done }; }
    // The stretch we're in: from key i (after its hold) to key i+1.
    let i = 0;
    while (i < keys.length - 1 && time >= keys[i + 1].at) i++;
    if (i >= keys.length - 1) { const k = keys[keys.length - 1]; return { pos: k.pos.slice(), look: k.look.slice(), fov: k.fov ?? p.fov, roll: k.roll, done }; }
    const a = keys[i], b = keys[i + 1];
    const start = a.at + a.hold;
    if (time <= start) return { pos: a.pos.slice(), look: a.look.slice(), fov: a.fov ?? p.fov, roll: a.roll, done };
    const u = ease(b.ease || a.ease || p.ease || (keys.length === 2 ? 'inOut' : 'smooth'), (time - start) / Math.max(1e-6, b.at - start));
    const k0 = keys[i - 1] || a, k3 = keys[i + 2] || b;
    // Ends of the path: mirror the neighbour so the curve leaves and arrives straight.
    const p0 = keys[i - 1] ? k0.pos : [2 * a.pos[0] - b.pos[0], 2 * a.pos[1] - b.pos[1], 2 * a.pos[2] - b.pos[2]];
    const p3 = keys[i + 2] ? k3.pos : [2 * b.pos[0] - a.pos[0], 2 * b.pos[1] - a.pos[1], 2 * b.pos[2] - a.pos[2]];
    const l0 = keys[i - 1] ? k0.look : a.look, l3 = keys[i + 2] ? k3.look : b.look;
    const fa = a.fov ?? p.fov, fb = b.fov ?? p.fov;
    return {
      pos: cr3(p0, a.pos, b.pos, p3, u),
      look: cr3(l0, a.look, b.look, l3, u),
      fov: fa === null || fb === null ? fa ?? fb : lerp(fa, fb, u),
      roll: lerp(a.roll, b.roll, u),
      done,
    };
  }

  /**
   * An orbit around a point: { center, radius, height, from (degrees), degrees (how far it goes round), seconds, ease,
   * lookHeight }. Angle 0 looks from the south (-z) toward the center.
   */
  function orbitPose(o, t) {
    const c = v3(o.center);
    const seconds = Math.max(0.001, num(o.seconds, 10));
    const degrees = num(o.degrees, 360);
    const k = o.loop ? (num(t, 0) / seconds) % 1 : clamp(num(t, 0) / seconds, 0, 1);
    const u = o.loop || degrees >= 360 ? k : ease(o.ease || 'inOut', k);
    const ang = (num(o.from, 0) + degrees * u) * RAD;
    const r = Math.max(0.5, num(o.radius, 12));
    const pos = [c[0] - Math.sin(ang) * r, c[1] + num(o.height, r * 0.45), c[2] - Math.cos(ang) * r];
    return { pos, look: [c[0], c[1] + num(o.lookHeight, 0), c[2]], fov: Number.isFinite(Number(o.fov)) ? Number(o.fov) : null, roll: 0, done: !o.loop && num(t, 0) >= seconds };
  }

  /**
   * A camera that rides with a moving thing: { distance, height, side, lead, angle }. `side` (m) moves it to the right
   * (a dolly shot alongside), `angle` (degrees) swings it round the thing (0 behind, 90 its right, 180 in front), `lead`
   * looks that far ahead of it. Returns where the camera wants to be; the caller smooths toward it (damp).
   */
  function followPose(at, yaw, o = {}) {
    const p = v3(at);
    const d = num(o.distance, 8), h = num(o.height, 3), side = num(o.side, 0), lead = num(o.lead, 4);
    const ang = num(yaw, 0) + num(o.angle, 0) * RAD;
    const fx = Math.sin(ang), fz = Math.cos(ang); // the way it faces, turned by angle
    const rx = Math.cos(ang), rz = -Math.sin(ang); // its right
    const pos = [p[0] - fx * d + rx * side, p[1] + h, p[2] - fz * d + rz * side];
    const fy = Math.sin(num(yaw, 0)), fyz = Math.cos(num(yaw, 0));
    return { pos, look: [p[0] + fy * lead, p[1] + num(o.lookHeight, 1), p[2] + fyz * lead], fov: Number.isFinite(Number(o.fov)) ? Number(o.fov) : null, roll: 0, done: false };
  }

  /** Frame-rate independent smoothing: moves a toward b, `k` = how much is left after a second (0.001 snappy, 0.3 lazy). */
  const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.pow(clamp(num(k, 0.05), 1e-6, 0.999), Math.max(0, dt)));
  const damp3 = (a, b, k, dt) => [damp(a[0], b[0], k, dt), damp(a[1], b[1], k, dt), damp(a[2], b[2], k, dt)];

  /** Yaw and pitch (radians, Babylon's: yaw from +z toward +x, pitch down is positive) to look from a to b. */
  function lookAngles(from, to) {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    return { yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)) };
  }
  /** The point `d` meters ahead along yaw/pitch (Babylon's convention). */
  function ahead(from, yaw, pitch, d = 10) {
    const c = Math.cos(pitch);
    return [from[0] + Math.sin(yaw) * c * d, from[1] - Math.sin(pitch) * d, from[2] + Math.cos(yaw) * c * d];
  }

  /** The free camera's step: { pos, yaw, pitch } moved by an input { x (right), y (up), z (forward) } at speed m/s. */
  function flyStep(cam, input, speed, dt) {
    const yaw = cam.yaw, pitch = cam.pitch;
    const c = Math.cos(pitch);
    const fwd = [Math.sin(yaw) * c, -Math.sin(pitch), Math.cos(yaw) * c];
    const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const s = speed * dt;
    return {
      pos: [cam.pos[0] + (fwd[0] * input.z + right[0] * input.x) * s, cam.pos[1] + (fwd[1] * input.z + input.y) * s, cam.pos[2] + (fwd[2] * input.z + right[2] * input.x) * s],
      yaw, pitch,
    };
  }

  // ------------------------------------------------------------------ "clip that": a ring of recorders
  // A recording can't be cut anywhere without re-encoding (only its start has the header and a keyframe), so two
  // recorders take turns: each runs up to 2 × the clip length, and they start `clip` seconds apart. Whenever someone
  // presses "clip that", the older one has been running between 1 and 2 clip lengths: stop it, and it's one playable
  // file holding at least the last `clip` seconds (the review trims it to exactly that). Memory stays bounded.
  function ringPlan(clipSeconds) {
    const clip = clamp(num(clipSeconds, 15), 3, 120);
    return { clip, life: clip * 2, stagger: clip, recorders: 2 };
  }
  /**
   * Which recorders to (re)start now, from the ages in seconds of the running ones (null: not running). Indexes.
   * Nothing running: the first starts. One not running starts once the other has a stagger's worth. One past its life
   * restarts only when the other already holds a whole clip (so a press right after still gets the full clip); until
   * then it keeps going a little longer, which also puts the pair back in step after a clip restarts one of them.
   */
  function ringDue(ages, plan) {
    if (ages.every((a) => a === null)) return [0];
    const due = [];
    ages.forEach((age, i) => {
      const others = ages.filter((_, j) => j !== i);
      if (age === null) { if (others.every((b) => b !== null && b >= plan.stagger)) due.push(i); }
      else if (age >= plan.life && others.every((b) => b !== null && b >= plan.clip)) due.push(i);
    });
    return due.slice(0, 1);
  }
  /** The recorder to stop for a clip: the oldest running one (the one with the most of the last `clip` seconds). */
  function ringPick(ages) {
    let best = -1;
    ages.forEach((a, i) => { if (a !== null && (best < 0 || a > ages[best])) best = i; });
    return best;
  }
  /** The part of a recording to keep: the last `clip` seconds of `duration`. */
  const clipWindow = (duration, clip) => ({ from: Math.max(0, num(duration, 0) - num(clip, 15)), to: Math.max(0, num(duration, 0)) });

  /** Letterbox bars for a w × h picture at an aspect (2.39 is cinema): the bar height in pixels (0 when wider). */
  const letterbox = (w, h, aspect = 2.39) => Math.max(0, Math.round((h - w / aspect) / 2));

  const api = { RAD, EASES, ease, normalizePath, samplePath, orbitPose, followPose, damp, damp3, lookAngles, ahead, flyStep, ringPlan, ringDue, ringPick, clipWindow, letterbox, v3, lerp3, dist, clamp };
  if (typeof window !== 'undefined') window.HawkesShareMath = api;
  const H = typeof window !== 'undefined' ? window.HawkesPlay : null;
  if (H) H.shareMath = api;
})();
