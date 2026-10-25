// Writes public/play/anim/object.json: the object set (docs/animations.md 2C), 23 clips for a rigid thing whose one node is `Body`.
//   node tools/object-clips.mjs          writes the file
// Each clip is a function of u (0 to 1 of the clip) that says what the body and the two toast slices do; it is sampled into keys
// (`keys` a clip, enough for a spline to follow it) so the file stays plain data the engine's sampler plays as it is.
// Body: rot [rx, ry, rz] degrees; pos [x, y, z] in model heights; sy the squash (x and z follow by 1 / sqrt(sy): volume is kept).
// ToastL / ToastR are the toaster's two slices (presence-things.js props): pos in model heights from their slot, rot degrees. A model
// without them ignores those tracks. `air: true` marks a clip where the body leaves the ground (no ground snap, presence-anim.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAU = Math.PI * 2, D = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const win = (u, a, b) => (u <= a || u >= b ? 0 : Math.sin(Math.PI * (u - a) / (b - a))); // a bump from a to b
const rise = (u, a, b) => sm((u - a) / (b - a));
const wave = (u, a, b) => 0.5 - 0.5 * Math.cos(TAU * (u - a) / (b - a)); // 0 at a and b, 1 in the middle
const edge = (u) => sm(u / 0.06) * sm((1 - u) / 0.06); // a one-shot starts and ends at rest unless it says otherwise

/** A slice's height over its slot: up over [a, b], held, down over [c, d], with a small settle at the end. */
const toast = (u, a, b, c, d, h) => {
  const up = rise(u, a, b), down = rise(u, c, d);
  const settle = u > d ? Math.sin((u - d) * 40) * Math.exp(-(u - d) * 30) * 0.012 : 0;
  return h * (up * (1 - down)) + settle * (down >= 1 ? 1 : 0);
};

const clips = {};
/** Adds a clip. f(u) returns { rot, pos, sy, L: { y, z, rx, rz }, R: {...} } (anything left out is rest). */
function clip(name, { loop, seconds, keys, events, air, fade }, f) {
  const tracks = { Body: { rot: [], pos: [], scl: [] }, ToastL: { rot: [], pos: [] }, ToastR: { rot: [], pos: [] } };
  const n = loop ? keys : keys + 1;
  const r = (x) => Math.round(x * 1000) / 1000;
  let used = { ToastL: false, ToastR: false }, usedPos = false, usedRot = false;
  for (let i = 0; i < n; i++) {
    const u = loop ? i / keys : i / keys, t = Math.round(u * 10000) / 10000, s = f(u);
    const rot = s.rot || [0, 0, 0], pos = s.pos || [0, 0, 0], sy = s.sy || 1, sxz = 1 / Math.sqrt(sy);
    tracks.Body.rot.push([t, r(rot[0]), r(rot[1]), r(rot[2])]);
    tracks.Body.pos.push([t, r(pos[0]), r(pos[1]), r(pos[2])]);
    tracks.Body.scl.push([t, r(sxz), r(sy), r(sxz)]);
    for (const k of ['L', 'R']) {
      const p = s[k] || {}, name = `Toast${k}`;
      tracks[name].pos.push([t, r(p.x || 0), r(p.y || 0), r(p.z || 0)]);
      tracks[name].rot.push([t, r(p.rx || 0), r(p.ry || 0), r(p.rz || 0)]);
      if (p.y || p.z || p.x) used[name] = true;
    }
    if (rot.some((x) => x)) usedRot = true;
    if (pos.some((x) => x)) usedPos = true;
  }
  if (!usedRot) delete tracks.Body.rot;
  if (!usedPos) delete tracks.Body.pos;
  for (const k of ['ToastL', 'ToastR']) if (!used[k]) delete tracks[k];
  clips[name] = { loop, seconds, ease: 'spline', ...(air ? { air: true } : {}), ...(fade ? { fade } : {}), ...(events ? { events } : {}), tracks };
}

// ---- stands and moves --------------------------------------------------------------------------------------------------------
// idle: breathing (1.0 to 1.025), a tiny sway, and it looks around by turning 8 degrees
clip('idle', { loop: true, seconds: 3.2, keys: 16 }, (u) => ({ rot: [0, 8 * Math.sin(TAU * u), 1.5 * Math.sin(2 * TAU * u)], sy: 1 + 0.0125 * (1 - Math.cos(TAU * u)) }));

// idle_fidget: a squash, a shiver, and the toaster pops one slice half way and drops it (a teapot, a shoe, a cactus just rattle)
clip('idle_fidget', { loop: false, seconds: 1.5, keys: 36, events: [{ t: 0.2, name: 'toast', slice: 'L', what: 'pop' }, { t: 0.7, name: 'toast', slice: 'L', what: 'drop' }] }, (u) => {
  const pre = win(u, 0, 0.2), shake = win(u, 0.2, 0.62) * Math.sin(TAU * 7 * u);
  return {
    rot: [shake * 1.5, 0, shake * 3.5],
    pos: [0, 0.008 * win(u, 0.2, 0.34), 0],
    sy: 1 - 0.07 * pre + 0.04 * win(u, 0.2, 0.34),
    L: { y: toast(u, 0.2, 0.32, 0.62, 0.8, 0.17) },
  };
});

// walk: a waddle: roll 8 degrees side to side, hop 3% of its height (the roll lifts it over a corner too), a tiny squash on each step
clip('walk', { loop: true, seconds: 1, keys: 24, events: [{ t: 0, name: 'hop', foot: 'L' }, { t: 0.5, name: 'hop', foot: 'R' }] }, (u) => {
  const hop = Math.abs(Math.sin(TAU * u));
  return { rot: [2, 4 * Math.sin(TAU * u), 8 * Math.sin(TAU * u)], pos: [0, 0.03 * hop, 0], sy: 0.95 + 0.1 * hop };
});

// run: leans 18 degrees, bounces 6% of its height, squashes on every landing and stretches in the air
clip('run', { loop: true, seconds: 0.6, keys: 24, events: [{ t: 0, name: 'hop', foot: 'L' }, { t: 0.5, name: 'hop', foot: 'R' }] }, (u) => {
  const hop = Math.abs(Math.sin(TAU * u));
  return { rot: [18, 3 * Math.sin(TAU * u), 5 * Math.sin(TAU * u)], pos: [0, 0.06 * hop, 0], sy: 0.9 + 0.22 * hop };
});

// jump_start: squash to 0.8, then stretch to 1.15 and launch (it ends where `jump` begins)
clip('jump_start', { loop: false, seconds: 0.25, keys: 12, air: true, fade: 0.04, events: [{ t: 0.55, name: 'hop', what: 'launch' }] }, (u) => ({
  pos: [0, 0.05 * rise(u, 0.55, 1), 0],
  sy: u < 0.55 ? 1 - 0.2 * sm(u / 0.55) : 0.8 + 0.35 * sm((u - 0.55) / 0.45),
  rot: [-4 * win(u, 0, 0.55), 0, 0],
}));

// jump: stretched at take-off, tucked in the middle, swings a quarter turn each way
clip('jump', { loop: true, seconds: 0.7, keys: 16, air: true }, (u) => ({ rot: [0, 45 * Math.sin(TAU * u), 6 * Math.sin(TAU * u)], sy: 1.07 + 0.08 * Math.cos(TAU * u) - 0.04 * (1 - Math.cos(TAU * u)) / 2 }));

// land: squash to 0.8 in 70 ms, wobble back through a small stretch and settle
clip('land', { loop: false, seconds: 0.3, keys: 24, fade: 0.03, events: [{ t: 0, name: 'hop', what: 'land' }] }, (u) => {
  const t = u * 0.3, d = Math.max(0, t - 0.07), fade = 1 - sm((u - 0.78) / 0.22);
  const sq = t < 0.07 ? 0.2 * sm(t / 0.07) : 0.2 * Math.exp(-d * 11) * Math.cos(TAU * 2.2 * d) * fade;
  return { sy: 1 - sq, rot: [-3 * sm(t / 0.07) * (1 - sm(d / 0.2)), 0, 0] };
});

// fall: tumbles slowly round its middle (a slow circle of lean, never a full turn)
clip('fall', { loop: true, seconds: 0.9, keys: 16, air: true }, (u) => ({ rot: [32 * Math.sin(TAU * u), 20 * Math.sin(TAU * u + 1), 32 * Math.cos(TAU * u)], sy: 1.03 + 0.03 * Math.cos(2 * TAU * u) }));

// swim: floats: bobs 3% of its height, drifts in a slow turn
clip('swim', { loop: true, seconds: 2, keys: 16, air: true }, (u) => ({ rot: [3 * Math.sin(2 * TAU * u), 20 * Math.sin(TAU * u), 6 * Math.sin(TAU * u + 1)], pos: [0, 0.03 * Math.sin(TAU * u), 0], sy: 1 + 0.01 * Math.sin(2 * TAU * u) }));

// sit: settles low (scale y 0.9), still but breathing
clip('sit', { loop: true, seconds: 4, keys: 12 }, (u) => ({ rot: [2, 0, 0], sy: 0.9 + 0.012 * (1 - Math.cos(TAU * u)) }));

// sleep: tilts onto one side, a slow breath (the face closes its eyes)
clip('sleep', { loop: true, seconds: 4, keys: 12 }, (u) => ({ rot: [0, 0, 14 + 0.8 * Math.sin(TAU * u)], sy: 0.97 + 0.025 * (1 - Math.cos(TAU * u)) }));

// ---- emotes -------------------------------------------------------------------------------------------------------------------
// wave: a bow forward and back, three times
clip('wave', { loop: false, seconds: 1.6, keys: 36 }, (u) => {
  const b = 0.5 - 0.5 * Math.cos(TAU * 3 * u);
  return { rot: [22 * b, 0, 0], sy: 1 - 0.03 * b };
});

// dance: hops in time, swings a half turn each beat, the slices flap
clip('dance', { loop: true, seconds: 2.4, keys: 32, events: [0, 0.25, 0.5, 0.75].map((t) => ({ t, name: 'hop', what: 'beat' })) }, (u) => {
  const hop = Math.abs(Math.sin(TAU * 2 * u)), flap = Math.max(0, Math.sin(TAU * 4 * u));
  return {
    rot: [0, 90 * Math.sin(TAU * 2 * u + 0.5 * Math.PI), 10 * Math.sin(TAU * 2 * u)],
    pos: [0, 0.07 * hop, 0],
    sy: 0.94 + 0.14 * hop,
    L: { y: 0.1 * flap }, R: { y: 0.1 * Math.max(0, -Math.sin(TAU * 4 * u)) },
  };
});

// cheer: squash, a high jump, both slices pop up, lands, settles
clip('cheer', { loop: false, seconds: 1.4, keys: 42, events: [{ t: 0.2, name: 'toast', slice: 'both', what: 'pop' }, { t: 0.85, name: 'toast', slice: 'both', what: 'drop' }, { t: 0.78, name: 'hop', what: 'land' }] }, (u) => {
  const air = u > 0.2 && u < 0.74 ? 4 * ((u - 0.2) / 0.54) * (1 - (u - 0.2) / 0.54) : 0;
  const pre = win(u, 0, 0.2), post = win(u, 0.74, 0.92);
  return {
    pos: [0, 0.32 * air, 0],
    sy: 1 - 0.22 * pre + 0.13 * Math.sqrt(air) * (air > 0 ? 1 : 0) - 0.12 * post,
    rot: [0, 0, 5 * Math.sin(TAU * 1.5 * u) * win(u, 0.2, 0.8)],
    L: { y: toast(u, 0.2, 0.42, 0.62, 0.86, 0.5), rz: 40 * win(u, 0.22, 0.8) }, R: { y: toast(u, 0.22, 0.45, 0.64, 0.88, 0.42), rz: -40 * win(u, 0.24, 0.82) },
  };
});

// laugh: shakes quickly side to side, a little squash on each beat
clip('laugh', { loop: false, seconds: 1.6, keys: 64, events: [{ t: 0.15, name: 'hop', what: 'ha' }, { t: 0.45, name: 'hop', what: 'ha' }, { t: 0.75, name: 'hop', what: 'ha' }] }, (u) => {
  const w = win(u, 0, 1), beat = 0.5 - 0.5 * Math.cos(TAU * 8 * u);
  return { rot: [-3 * w * beat, 0, 7 * w * Math.sin(TAU * 4 * u)], pos: [0, 0.012 * w * beat, 0], sy: 1 - 0.05 * w * (1 - beat) };
});

// point: leans toward the target, and a slice shoots out that way and comes back
clip('point', { loop: false, seconds: 1.2, keys: 40, events: [{ t: 0.3, name: 'toast', slice: 'L', what: 'shoot' }, { t: 0.82, name: 'toast', slice: 'L', what: 'drop' }] }, (u) => ({
  rot: [15 * win(u, 0, 1) ** 0.6, 0, 0],
  sy: 1 - 0.04 * win(u, 0, 0.25),
  L: { y: 0.46 * rise(u, 0.08, 0.28) * (1 - rise(u, 0.7, 0.92)), z: 0.62 * rise(u, 0.32, 0.5) * (1 - rise(u, 0.55, 0.7)), rx: 70 * rise(u, 0.32, 0.5) * (1 - rise(u, 0.55, 0.7)) },
}));

// clap: presses down and pops back up six times
clip('clap', { loop: false, seconds: 1.6, keys: 48, events: [0, 1, 2, 3, 4, 5].map((k) => ({ t: (k + 0.5) / 6, name: 'clap', n: k })) }, (u) => {
  const p = 0.5 - 0.5 * Math.cos(TAU * 6 * u);
  return { sy: 1 - 0.11 * p, pos: [0, 0.01 * (1 - p) * win(u, 0, 1), 0] };
});

// thumbsup: one slice pops up and stays, a nod, and it drops back
clip('thumbsup', { loop: false, seconds: 1.2, keys: 36, events: [{ t: 0.12, name: 'toast', slice: 'R', what: 'pop' }, { t: 0.86, name: 'toast', slice: 'R', what: 'drop' }] }, (u) => ({
  rot: [14 * win(u, 0.1, 0.5) + 8 * win(u, 0.5, 0.82), 0, 0],
  sy: 1 - 0.06 * win(u, 0, 0.2),
  R: { y: toast(u, 0.1, 0.24, 0.86, 0.98, 0.34) },
}));

// heart: pulses 1.0 to 1.15 twice (glowing: the event is for the light)
clip('heart', { loop: false, seconds: 1.6, keys: 32, events: [{ t: 0.25, name: 'glow' }, { t: 0.75, name: 'glow' }] }, (u) => ({ sy: 1 + 0.15 * (0.5 - 0.5 * Math.cos(TAU * 2 * u)) * win(u, 0, 1) ** 0.4 }));

// shrug: tilts to one side, then the other, drooping
clip('shrug', { loop: false, seconds: 1.2, keys: 32 }, (u) => ({ rot: [4 * win(u, 0, 1), 0, 13 * Math.sin(TAU * u) * win(u, 0, 1) ** 0.5], sy: 1 - 0.06 * win(u, 0, 1) }));

// hurt: a squash-jolt, a shake that dies away, and the slices fly up a little
clip('hurt', { loop: false, seconds: 0.5, keys: 30, fade: 0.05, events: [{ t: 0.05, name: 'toast', slice: 'both', what: 'jolt' }] }, (u) => {
  const d = Math.exp(-u * 5);
  return {
    sy: 1 - 0.2 * win(u, 0, 0.32) + 0.06 * win(u, 0.32, 0.7),
    rot: [-6 * win(u, 0, 0.3), 0, 10 * Math.sin(TAU * 3 * u) * d * edge(u)],
    L: { y: 0.2 * win(u, 0.05, 0.75), rz: 30 * win(u, 0.1, 0.7) }, R: { y: 0.16 * win(u, 0.08, 0.7), rz: -30 * win(u, 0.1, 0.7) },
  };
});

// knock_down: tips over onto its side (a rebound at the end) and lies there
clip('knock_down', { loop: false, seconds: 0.9, keys: 30, events: [{ t: 0.55, name: 'hop', what: 'thud' }] }, (u) => {
  const fall = rise(u, 0.08, 0.58), bounce = win(u, 0.58, 0.9);
  return { rot: [0, 0, 90 * fall - 5 * bounce], sy: 1 - 0.1 * win(u, 0.5, 0.7) };
});

// get_up: rocks up from its side, overshoots a little and settles
clip('get_up', { loop: false, seconds: 1.2, keys: 36, events: [{ t: 0.7, name: 'hop', what: 'thud' }] }, (u) => {
  const up = rise(u, 0.1, 0.62), over = win(u, 0.62, 0.9);
  return { rot: [0, 0, 90 * (1 - up) - 6 * over], sy: 1 - 0.14 * win(u, 0.62, 0.82) + 0.05 * win(u, 0.82, 1), pos: [0, 0.03 * win(u, 0.35, 0.65), 0] };
});

const out = { class: 'object', version: 2, note: 'A rigid thing: one Body (the whole body), plus the toaster\'s two toast slices ToastL and ToastR. pos is in model heights, scl keeps volume (sy up, sx and sz by 1 / sqrt(sy)). Written by tools/object-clips.mjs.', clips };
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'play', 'anim', 'object.json');
const text = JSON.stringify(out, (k, v) => v, 1).replace(/\[\n\s+([-\d.e,\s\n]+?)\n\s+\]/g, (m, a) => `[${a.replace(/\s+/g, ' ')}]`);
fs.writeFileSync(file, text + '\n');
console.log(`${Object.keys(clips).length} clips, ${(text.length / 1024).toFixed(0)} KB -> ${file}`);
