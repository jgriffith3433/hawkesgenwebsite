// The hangar approach, as numbers (no Babylon, no page): where a ship is to the pad, how fast it should be going there,
// what the bay's approach readout says (distance, speed, align), and the gentle "catch" that guides a careful ship the
// last way in. dock.js reads them each step; the engine tests check them in Node.
//
// Everything is in the bay's own frame (dock.js `local`): [across, up from the Overseer's middle, out of the bay], with
// the numbers of its `frameOf`: { halfW, floor, top, back, front, padZ, padR }.
/* global HawkesPlay */
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a || 1), 0, 1); return t * t * (3 - 2 * t); };
  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const DEG = 180 / Math.PI;

  /** The speed (m/s) a ship should have at `distance` meters from the pad: fast far out, a walking pace at the pad. */
  function allowedSpeed(distance) { return clamp(2 + distance * 0.11, 2, 70); }

  /** Where to aim from `l`: out in front of the bay, the middle of the opening (held inside its height); in it, the pad. */
  function aimPoint(l, f) {
    const pad = [0, f.floor + 1.2, f.padZ];
    const inside = l[2] < f.front - 30 && Math.abs(l[0]) < f.halfW;
    if (inside) return pad;
    const lo = f.floor + 24, hi = f.top - 26;
    // The gate in the opening, then the pad; a ship far out heads for the gate.
    return [0, clamp(l[1], lo, Math.max(lo, hi)), f.front - 40];
  }

  /** The approach readout for a ship at `l` with velocity `vel`:
   *  { distance (to the pad), speed, closing (m/s toward it), align (degrees between its way and the pad; 0 straight at it),
   *    lateral (m off the bay's middle line, + to the right), height (m above the pad's floor), allowed (m/s), tooFast,
   *    state ('far' | 'closing' | 'inside'), advice (what to do, in words) } */
  function gauge(l, vel, f) {
    const toPad = sub([0, f.floor, f.padZ], l);
    const distance = len(toPad);
    const speed = len(vel);
    const closing = distance > 1e-6 ? (vel[0] * toPad[0] + vel[1] * toPad[1] + vel[2] * toPad[2]) / distance : 0;
    const align = speed > 1 && distance > 1e-6 ? Math.acos(clamp(closing / speed, -1, 1)) * DEG : 0;
    const allowed = allowedSpeed(distance);
    const tooFast = speed > allowed * 1.6 + 4;
    const inside = Math.abs(l[0]) < f.halfW && l[1] > f.floor - 2 && l[1] < f.top + 2 && l[2] > f.back && l[2] < f.front + f.apron;
    const state = inside ? 'inside' : distance > f.front * 0.6 + 400 ? 'far' : 'closing';
    let advice = 'Good';
    if (tooFast) advice = 'Slow down';
    else if (speed > 3 && align > 25) advice = 'Turn toward the bay';
    else if (state !== 'inside' && Math.abs(l[0]) > f.halfW * 0.8 && distance < f.front + 300) advice = l[0] > 0 ? 'Move left' : 'Move right';
    else if (state !== 'inside' && (l[1] < f.floor + 8 || l[1] > f.top - 8) && distance < f.front + 300) advice = l[1] < f.floor + 8 ? 'Climb to the bay' : 'Descend to the bay';
    return { distance, speed, closing, align, lateral: l[0], height: l[1] - f.floor, allowed, tooFast, state, advice };
  }

  /** The catch. A ship in front of the bay (or in it), not coming in crazily, is eased toward the pad: its velocity
   *  moves toward the right one for where it is (the gate, then the pad, slower as it nears) and the pull of gravity is
   *  taken off it. It is a steady hand from afar and a firm one at the pad; a ship that is too fast or off to the side
   *  is left to its pilot (a careful player never is).
   *  opts: { g (gravity, 9.8), range (m from the pad, how far out it starts), gain (per second), maxAcc, maxSpeed (fastest it will help) }
   *  → { active, k (0..1), acc: [x,y,z] (m/s², in the bay's frame), aim, want: [vx,vy,vz] } */
  function catchPlan(l, vel, f, opts = {}) {
    const range = opts.range || Math.max(900, f.front - f.back + 500);
    const g = opts.g === undefined ? 9.8 : opts.g;
    const gain = opts.gain || 1.1, maxAcc = opts.maxAcc || 16, maxSpeed = opts.maxSpeed || 110;
    const none = { active: false, k: 0, acc: [0, 0, 0], aim: null, want: [0, 0, 0] };
    const toPad = sub([0, f.floor, f.padZ], l);
    const distance = len(toPad);
    const speed = len(vel);
    const ahead = l[2] > f.back && Math.abs(l[0]) < f.halfW * 1.35;
    if (!ahead || distance > range || speed > maxSpeed) return none;
    if (l[1] < f.floor - 60 || l[1] > f.top + 90) return none; // (well below or above the opening: not in the bay's lane)
    const k = smooth(range, f.padR * 2, distance);
    const aim = aimPoint(l, f);
    const d = sub(aim, l);
    const dl = len(d);
    const want = dl > 1e-6 ? d.map((x) => (x / dl) * Math.min(allowedSpeed(distance), allowedSpeed(dl) + 6)) : [0, 0, 0];
    const kn = 0.3 + 0.7 * k; // (a steady hand from the edge of the range, firmer toward the pad)
    let acc = [(want[0] - vel[0]) * gain * kn, (want[1] - vel[1]) * gain * kn, (want[2] - vel[2]) * gain * kn];
    const a = len(acc);
    if (a > maxAcc) acc = acc.map((x) => (x / a) * maxAcc); // (a nudge, never a shove)
    acc[1] += g * smooth(range, range - 120, distance); // (what the pull of the planet takes off it, on top: weightless in the lane, so a rocket that has cut its engine does not sink out of it)
    return { active: true, k, acc, aim, want };
  }

  const api = { allowedSpeed, aimPoint, gauge, catchPlan, smooth, clamp };
  if (typeof window !== 'undefined') window.HawkesDockMath = api;
  const H = typeof window !== 'undefined' ? window.HawkesPlay : null;
  if (H) H.dockMath = api;
})();
