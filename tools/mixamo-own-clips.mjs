// Writes our own clips into public/play/anim/mixamo.json (docs/animations.md 2D): what the CC0 library does not have (idle_look, idle_fidget,
// fall, sleep, wave, cheer, laugh, point, clap, thumbsup, heart, shrug, bow, get_up) and the toy touches on the library's jump_start and land
// (a squash on the Hips that keeps its volume, an 80 ms anticipation before a jump).
//   node tools/mixamo-own-clips.mjs          writes (our clips are marked "own": true, so tools/mixamo-clips.mjs never replaces them)
// Every clip is a function of u (0 to 1 of the clip) that says what each Mixamo bone does, as degrees `[rx, ry, rz]` delta from the T-pose
// rest in the model's axes (docs/animations.md 3: rx > 0 pitches a hanging limb back and nods a head down, ry > 0 turns to the left, rz > 0
// rolls to the right; the left arm rests along +x, so it drops with rz < 0 and rises with rz > 0). The right side is written as the left
// one and mirrored (`R`: ry and rz change sign). Hips `pos` is in model heights. Sampled into keys so the file stays plain data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'public/play/anim/mixamo.json');
const TAU = Math.PI * 2, D = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const rise = (u, a, b) => sm((u - a) / (b - a));
const bump = (u, a, b, c, d) => rise(u, a, b) * (1 - rise(u, c, d)); // up over a..b, held, down over c..d
const win = (u, a, b) => (u <= a || u >= b ? 0 : Math.sin(Math.PI * (u - a) / (b - a)));
const lerp = (a, b, k) => a + (b - a) * k;

// the idle's arms: hanging at the sides with a slight bend; every one-shot starts and ends here so it blends into the idle
const HANG = { arm: [0, 0, -76], fore: [0, -8, 0], shoulder: [0, 0, -2] };

/** A pose under construction: bone -> [rx, ry, rz]. `L(bone, v)` sets a left bone, `R(bone, v)` the right one from the left's values (mirrored). */
function pose() {
  const p = {};
  const add = (bone, v) => { const o = p[bone] || (p[bone] = [0, 0, 0]); o[0] += v[0]; o[1] += v[1]; o[2] += v[2]; };
  return {
    p, add,
    L: (name, v) => add(`Left${name}`, v),
    R: (name, v) => add(`Right${name}`, [v[0], -v[1], -v[2]]),
    both(name, v) { this.L(name, v); this.R(name, v); },
    /** Arms hanging, plus a delta; `false` for an arm leaves it out (it keeps doing what the loop underneath does: the idle's, the walk's). */
    hang(lv, rv) {
      for (const [n, k] of [['Arm', 'arm'], ['ForeArm', 'fore'], ['Shoulder', 'shoulder']]) { if (lv !== false) this.L(n, HANG[k]); if (rv !== false) this.R(n, HANG[k]); }
      if (lv) for (const [n, v] of Object.entries(lv)) this.L(n, v);
      if (rv) for (const [n, v] of Object.entries(rv)) this.R(n, v);
    },
  };
}

/** How far the Hips drop (model heights, negative) so the feet stay on the floor with the thighs forward by `a` degrees and the shins folded back by `b` (the person's thigh .18, shin .12, ankle .09). */
const plantY = (a, b) => 0.18 * Math.cos(a * D) + 0.12 * Math.cos((a - b) * D) + 0.09 - 0.39;

/**
 * A knees-bent stance: c from 0 (standing) to 1 (a crouch of `deg` at the thigh). The thigh goes forward (rx < 0), the shin back by twice that,
 * the foot stays flat; the hips come down by what the legs lose and move back to stay over the feet. Returns the Hips drop in heights.
 */
function crouch(pz, c, deg = 50) {
  const a = deg * c;
  pz.both('UpLeg', [-a, 0, 0]); pz.both('Leg', [2 * a, 0, 0]); pz.both('Foot', [-a, 0, 0]);
  pz.add('Spine', [a * 0.35, 0, 0]); pz.add('Spine1', [a * 0.2, 0, 0]);
  return { y: plantY(a, 2 * a), z: -0.05 * Math.sin(a * D) };
}

const clips = {};
/**
 * Adds a clip. f(u, z) fills the pose `z` (and may return { pos: [x, y, z], scl: sy, events }); the keys come from sampling f `keys` times.
 * A one-shot has keys + 1 samples (the last at u = 1).
 */
function clip(name, { loop, seconds, keys, events, ease }, f) {
  const n = loop ? keys : keys + 1, tracks = {}, r = (x) => Math.round(x * 1000) / 1000;
  for (let i = 0; i < n; i++) {
    const u = i / keys, t = Math.round(u * 10000) / 10000, z = pose(), extra = f(u, z) || {};
    for (const [bone, v] of Object.entries(z.p)) (tracks[bone] || (tracks[bone] = { rot: [] })).rot.push([t, r(v[0]), r(v[1]), r(v[2])]);
    if (extra.pos) (tracks.Hips || (tracks.Hips = { rot: [] })).pos = [...((tracks.Hips && tracks.Hips.pos) || []), [t, r(extra.pos[0] || 0), r(extra.pos[1] || 0), r(extra.pos[2] || 0)]];
    if (extra.sy) { const sy = extra.sy, sxz = 1 / Math.sqrt(sy); (tracks.Hips || (tracks.Hips = { rot: [] })).scl = [...((tracks.Hips && tracks.Hips.scl) || []), [t, r(sxz), r(sy), r(sxz)]]; }
  }
  for (const [bone, tr] of Object.entries(tracks)) { // a bone that never leaves rest has no track; a Hips with only pos or scl has no rot
    if (tr.rot && tr.rot.every((k) => !k[1] && !k[2] && !k[3])) delete tr.rot;
    if (!tr.rot && !tr.pos && !tr.scl) delete tracks[bone];
  }
  clips[name] = { loop, seconds, ease: ease || (loop ? 'spline' : 'smooth'), own: true, ...(events ? { events } : {}), tracks };
}

// ---- stands ---------------------------------------------------------------------------------------------------------------------
// idle_look: breathes, then looks left, right and up at the sky (the Overseer), the head leading and the neck and chest following; plays once over the idle
// (only the head, the neck and the chest are named, so the idle's arms and legs go on)
clip('idle_look', { loop: false, seconds: 5, keys: 50 }, (u, z) => {
  const left = bump(u, 0.1, 0.2, 0.32, 0.42), right = bump(u, 0.42, 0.52, 0.64, 0.74), up = bump(u, 0.76, 0.86, 0.92, 0.99);
  const yaw = 38 * left - 38 * right;
  z.add('Head', [-14 * up, yaw * 0.7, 3 * (left - right)]); z.add('Neck', [-8 * up, yaw * 0.4, 0]);
  z.add('Spine2', [-3 * up, yaw * 0.12, 0]); z.add('Spine1', [0, yaw * 0.06, 0]);
});

// idle_fidget: a stretch: up on the toes, both arms overhead, chest open, head back, then a shoulder roll on the way down
clip('idle_fidget', { loop: false, seconds: 2.5, keys: 50 }, (u, z) => {
  const up = bump(u, 0.12, 0.38, 0.52, 0.72), roll = win(u, 0.7, 0.98);
  z.hang({ Arm: [0, 0, 156 * up] , ForeArm: [0, 6 * up, 20 * up], Shoulder: [0, 0, 8 * up + 6 * Math.sin(TAU * 2 * u) * roll] }, { Arm: [0, 0, 156 * up], ForeArm: [0, 6 * up, 20 * up], Shoulder: [0, 0, 8 * up - 6 * Math.sin(TAU * 2 * u) * roll] });
  z.add('Spine', [-4 * up, 0, 0]); z.add('Spine1', [-6 * up, 0, 0]); z.add('Spine2', [-6 * up, 0, 0]); z.add('Head', [-14 * up, 0, 0]); z.add('Neck', [-6 * up, 0, 0]);
  z.both('Foot', [16 * up, 0, 0]); // up on the toes (foot rx > 0 is toes down, so the heels rise)
  return { pos: [0, 0.018 * up, 0] };
});

// ---- the air --------------------------------------------------------------------------------------------------------------------
// fall: arms out and up, legs bicycling, a slight lean back (8 degrees: the wind)
clip('fall', { loop: true, seconds: 0.9, keys: 18 }, (u, z) => {
  const s = Math.sin(TAU * u), c = Math.cos(TAU * u);
  z.hang({ Arm: [-10 * s, 0, 62 + 8 * c], ForeArm: [0, -14 + 6 * s, 10], Shoulder: [0, 0, 5] }, { Arm: [10 * s, 0, 62 + 8 * c], ForeArm: [0, -14 - 6 * s, 10], Shoulder: [0, 0, 5] });
  z.L('UpLeg', [-24 * s - 8, 0, 0]); z.R('UpLeg', [24 * s - 8, 0, 0]);
  z.L('Leg', [22 + 22 * Math.max(0, s), 0, 0]); z.R('Leg', [22 + 22 * Math.max(0, -s), 0, 0]);
  z.both('Foot', [14, 0, 0]);
  z.add('Spine', [-8, 0, 0]); z.add('Head', [4 + 2 * s, 0, 0]); z.add('Hips', [0, 0, 1.5 * s]);
  return { pos: [0, 0.01 * c, 0] };
});

// sleep: curled on its right side (the Hips turned over), knees up, hands tucked under the cheek, a slow breath
clip('sleep', { loop: true, seconds: 4, keys: 16 }, (u, z) => {
  const breath = 0.5 - 0.5 * Math.cos(TAU * u);
  z.add('Hips', [0, 0, 88]); z.add('Spine', [14, 0, 0]); z.add('Spine1', [8 + 1.2 * breath, 0, 0]); z.add('Spine2', [4 + 1.6 * breath, 0, 0]);
  z.add('Head', [10, 0, 6]); z.add('Neck', [6, 0, 0]);
  z.both('UpLeg', [-78, 0, 0]); z.both('Leg', [112, 0, 0]); z.both('Foot', [10, 0, 0]);
  z.L('Arm', [-40, 0, -58]); z.L('ForeArm', [0, -100, 0]); z.R('Arm', [0, -90, 8]); z.R('ForeArm', [0, -24, 0]); // the arm under it stretched forward along the floor, under the head
  return { pos: [0, -0.19 + 0.003 * breath, 0], sy: 1 + 0.012 * breath };
});

// ---- emotes ---------------------------------------------------------------------------------------------------------------------
// wave: the right arm up and out, the forearm waving three times, the head tilting to it
clip('wave', { loop: false, seconds: 1.6, keys: 32 }, (u, z) => {
  const up = bump(u, 0.08, 0.26, 0.82, 0.97), sw = Math.sin(TAU * 3 * clamp((u - 0.26) / 0.56, 0, 1)) * up;
  z.hang(false, { Arm: [0, 0, 138 * up], ForeArm: [0, -6 * up, 28 * up + 24 * sw], Shoulder: [0, 0, 6 * up], Hand: [0, 0, 14 * sw] });
  z.add('Head', [0, -6 * up, -7 * up]); z.add('Spine', [0, 0, -2 * up]); z.add('Spine2', [0, 0, 2 * up]);
  return {};
});

// cheer: crouch, jump with both arms up and a whoop, land soft
clip('cheer', { loop: false, seconds: 1.4, keys: 28 }, (u, z) => {
  const sq = bump(u, 0.0, 0.14, 0.2, 0.24), air = bump(u, 0.2, 0.34, 0.54, 0.7), land = bump(u, 0.66, 0.74, 0.78, 0.9), arms = bump(u, 0.12, 0.34, 0.74, 0.96);
  const c = crouch(z, Math.max(sq, land * 0.6), 44);
  z.hang({ Arm: [0, 0, 158 * arms + 8 * sq], ForeArm: [0, 10 * arms, 12 * arms], Shoulder: [0, 0, 8 * arms] }, { Arm: [0, 0, 158 * arms + 8 * sq], ForeArm: [0, 10 * arms, 12 * arms], Shoulder: [0, 0, 8 * arms] });
  z.both('UpLeg', [10 * air, 0, 0]); z.both('Leg', [26 * air, 0, 0]); z.both('Foot', [12 * air, 0, 0]);
  z.add('Head', [-12 * arms, 0, 0]); z.add('Spine1', [-8 * arms, 0, 0]);
  return { pos: [0, c.y + 0.12 * air, c.z], sy: 1 - 0.1 * sq + 0.06 * air };
});

// laugh: head back, the shoulders shaking, one hand on the belly, a lean forward at the end
clip('laugh', { loop: false, seconds: 1.6, keys: 40 }, (u, z) => {
  const on = bump(u, 0.05, 0.2, 0.82, 0.97), sh = Math.sin(TAU * 7 * u) * on;
  z.hang(false, { Arm: [-42 * on, -38 * on, 16 * on], ForeArm: [0, -100 * on, 0], Shoulder: [0, 0, 3 * sh] });
  z.add('Head', [-16 * on + 2 * sh, 0, 0]); z.add('Neck', [-6 * on, 0, 0]); z.add('Spine', [-4 * on + 1.2 * sh, 0, 0]); z.add('Spine2', [-3 * on, 0, 0]);
  return { pos: [0, 0.006 * sh, 0] };
});

// point: the right arm straight ahead, the head and chest turn to it, a small step of weight
clip('point', { loop: false, seconds: 1.2, keys: 24 }, (u, z) => {
  const on = bump(u, 0.08, 0.28, 0.76, 0.95), pop = win(u, 0.2, 0.4);
  z.hang(false, { Arm: [0, -90 * on, 72 * on - 3 * pop], ForeArm: [0, 0, 0], Hand: [0, 0, 0], Shoulder: [0, 0, 4 * on] });
  z.add('Head', [0, -12 * on, 0]); z.add('Spine2', [0, -10 * on, 0]); z.add('Spine', [2 * on, -6 * on, 0]);
  return {};
});

// clap: both hands together in front of the chest six times, a bounce on each
clip('clap', { loop: false, seconds: 1.6, keys: 40 }, (u, z) => {
  const on = bump(u, 0.06, 0.18, 0.86, 0.97), ph = clamp((u - 0.18) / 0.68, 0, 1), hit = 0.5 + 0.5 * Math.cos(TAU * 6 * ph); // 1 apart, 0 together
  const apart = lerp(0, 1, hit) * on;
  const arm = [10 * on, -66 * on, 70 * on - 4 * apart], fore = [0, (-64 + 26 * apart) * on, 0];
  z.hang({ Arm: arm, ForeArm: fore, Shoulder: [0, 0, 4 * on] }, { Arm: arm, ForeArm: fore, Shoulder: [0, 0, 4 * on] });
  z.add('Spine1', [3 * on, 0, 0]); z.add('Head', [4 * on * (1 - hit), 0, 0]);
  return { pos: [0, 0.01 * on * (1 - hit), 0] };
});

// thumbsup: the right forearm up with the thumb out, a nod
clip('thumbsup', { loop: false, seconds: 1.2, keys: 24 }, (u, z) => {
  const on = bump(u, 0.08, 0.28, 0.74, 0.94), nod = win(u, 0.4, 0.62);
  z.hang(false, { Arm: [-14 * on, -42 * on, 38 * on], ForeArm: [0, 0, 94 * on], Hand: [0, 10 * on, -16 * on], Shoulder: [0, 0, 3 * on] });
  z.add('Head', [10 * nod - 2 * on, 0, 0]); z.add('Spine1', [2 * on, 0, 0]);
  return {};
});

// heart: both arms over the head making a loop, a small pulse of the whole body at the top
clip('heart', { loop: false, seconds: 1.6, keys: 32, events: [{ t: 0.45, name: 'glow' }] }, (u, z) => {
  const on = bump(u, 0.08, 0.34, 0.8, 0.96), pulse = win(u, 0.4, 0.6);
  const arm = [0, 6 * on, 116 * on], fore = [0, 12 * on, 34 * on];
  z.hang({ Arm: arm, ForeArm: fore, Hand: [0, 0, 18 * on], Shoulder: [0, 0, 8 * on] }, { Arm: arm, ForeArm: fore, Hand: [0, 0, 18 * on], Shoulder: [0, 0, 8 * on] });
  z.add('Head', [-6 * on, 0, 5 * on]); z.add('Spine1', [-2 * on, 0, 0]);
  return { sy: 1 + 0.03 * pulse, pos: [0, 0.01 * pulse, 0] };
});

// shrug: shoulders up, elbows out, palms up, the head tilting
clip('shrug', { loop: false, seconds: 1.2, keys: 24 }, (u, z) => {
  const on = bump(u, 0.1, 0.32, 0.66, 0.9);
  const arm = [0, -20 * on, 40 * on], fore = [0, -24 * on, 44 * on];
  z.hang({ Arm: arm, ForeArm: fore, Hand: [0, 0, 22 * on], Shoulder: [0, 0, 14 * on] }, { Arm: arm, ForeArm: fore, Hand: [0, 0, 22 * on], Shoulder: [0, 0, 14 * on] });
  z.add('Head', [2 * on, 0, 9 * on]); z.add('Neck', [0, 0, 3 * on]); z.add('Spine2', [-2 * on, 0, 0]);
  return { pos: [0, 0.004 * on, 0] };
});

// bow: a bend from the waist, the right hand across the chest, the left behind, and up again
clip('bow', { loop: false, seconds: 1.4, keys: 28 }, (u, z) => {
  const down = bump(u, 0.1, 0.4, 0.58, 0.9);
  z.hang({ Arm: [18 * down, 0, 6 * down], ForeArm: [0, -14 * down, 0] }, { Arm: [-30 * down, -40 * down, 14 * down], ForeArm: [0, -108 * down, 0] });
  z.add('Spine', [30 * down, 0, 0]); z.add('Spine1', [22 * down, 0, 0]); z.add('Spine2', [12 * down, 0, 0]); z.add('Neck', [10 * down, 0, 0]); z.add('Head', [6 * down, 0, 0]);
  z.both('UpLeg', [-4 * down, 0, 0]);
  return { pos: [0, 0, -0.05 * down] };
});

// get_up: from lying on the back: sit up with the legs out, tuck the feet in, rise (the other half of knock_down)
clip('get_up', { loop: false, seconds: 1.1, keys: 30 }, (u, z) => {
  const lie = 1 - rise(u, 0.08, 0.38), tuck = rise(u, 0.4, 0.6), stand = rise(u, 0.62, 0.92);
  const a = lerp(lerp(88, 62, tuck), 0, stand), b = lerp(lerp(0, 124, tuck), 0, stand); // thigh forward, shin folded back
  z.add('Hips', [-86 * lie, 0, 0]);
  z.both('UpLeg', [-a, 0, 0]); z.both('Leg', [b, 0, 0]); z.both('Foot', [-(a - b) * 0.5 * (1 - lie), 0, 0]);
  z.add('Spine', [14 * (1 - lie) * (1 - stand) + 24 * tuck * (1 - stand), 0, 0]); z.add('Head', [-4 * lie, 0, 0]);
  const reach = rise(u, 0.08, 0.38) * (1 - stand) * (1 - tuck * 0.6);
  z.hang({ Arm: [-40 * reach, 0, 30 * reach] }, { Arm: [-40 * reach, 0, 30 * reach] });
  const y = lerp(-0.38, plantY(a, b), rise(u, 0.1, 0.4));
  return { pos: [0, y, -0.08 * (tuck - stand) * (1 - stand) - 0.04 * lie] };
});

// ---- the library's clips get the toy's touches (a squash that keeps its volume, an anticipation) ---------------------------------------
/** Squash and stretch on Hips for a clip of the library: keys [u, sy]; x and z follow by 1 / sqrt(sy). */
export function addSquash(clipData, keys) {
  const tr = clipData.tracks.Hips || (clipData.tracks.Hips = {});
  tr.scl = keys.map(([t, sy]) => { const sxz = 1 / Math.sqrt(sy); return [t, Math.round(sxz * 1000) / 1000, sy, Math.round(sxz * 1000) / 1000]; });
}
/** The keys for a landing: squash 0.82 then spring with one overshoot (docs/animations.md: land). */
export const landKeys = () => [[0, 1], [0.12, 0.82], [0.34, 1.05], [0.56, 0.98], [0.8, 1.0], [1, 1]];
/** The keys for a take-off: an 80 ms anticipation (a dip to 0.88), then the stretch as the feet leave. */
export const jumpKeys = (seconds) => { const a = clamp(0.08 / seconds, 0.04, 0.45); return [[0, 1], [a, 0.88], [clamp(a + 0.3 * (1 - a), a + 0.05, 0.9), 1.07], [1, 1]]; };

// ---- standing the way the library's idle stands -----------------------------------------------------------------------------------------
// Our poses are small turns about the T-pose rest; the library's idle stands in its own posture (a little arch, the hips tilted, the knees
// soft). A one-shot of ours that named the spine or a leg would pop to the rest posture when it fades in over that idle, so the body bones
// (not the arms, which our poses write whole) are written on top of the library idle's first pose: q = ours * idle.
const BASE_BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot'];
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qeuler = (x, y, z) => { // Babylon's order (docs/animations.md 3): z, then x, then y
  const e = (a, i) => { const h = a * D / 2, q = [0, 0, 0, Math.cos(h)]; q[i] = Math.sin(h); return q; };
  return qmul(e(y, 1), qmul(e(x, 0), e(z, 2)));
};
const ARM_BONES = /^(Left|Right)(Shoulder|Arm|ForeArm|Hand)$/;
const slerp = (a, b, k) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((v) => -v); d = -d; }
  if (d > 0.9995) { const q = a.map((v, i) => v + (b[i] - v) * k), l = Math.hypot(...q); return q.map((v) => v / l); }
  const th = Math.acos(d), sn = Math.sin(th), x = Math.sin((1 - k) * th) / sn, y = Math.sin(k * th) / sn;
  return a.map((v, i) => v * x + b[i] * y);
};
const r4 = (x) => Math.round(x * 10000) / 10000;
/**
 * Writes our clip on top of the library idle (a loop of ours replaces the idle, a one-shot plays over it, so either would pop to the T-pose
 * rest or to our own stance): the body bones are ours composed with the idle's first pose, the chest chain is always named so it stays one
 * line, and the arms of a one-shot ease in from the idle's over 0.2 s and back out (`slerp` by an envelope), so where the clip is not
 * using an arm it is where the idle has it.
 */
function onIdle(ours, idle) {
  if (!idle) return;
  const base = (bone) => { const k = idle.tracks[bone] && idle.tracks[bone].q && idle.tracks[bone].q[0]; return k ? [k[1], k[2], k[3], k[4]] : null; };
  const keysOf = (tr) => (tr.rot || []).map((k) => k[0]);
  const times = Object.values(ours.tracks).map((tr) => keysOf(tr)).find((t) => t.length) || [0, 1];
  const ramp = ours.loop ? 0 : Math.min(0.25, 0.2 / ours.seconds);
  const env = (u) => (ours.loop ? 1 : rise(u, 0, ramp) * (1 - rise(u, 1 - ramp, 1)));
  const eul = (tr, i) => qeuler(tr.rot[i][1], tr.rot[i][2], tr.rot[i][3]);
  for (const bone of ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head']) if (!ours.tracks[bone] && base(bone)) ours.tracks[bone] = { rot: times.map((t) => [t, 0, 0, 0]) };
  for (const [bone, tr] of Object.entries(ours.tracks)) {
    const b = base(bone);
    if (!b || !tr.rot) continue;
    let prev = null;
    const out = tr.rot.map((k, i) => {
      let q;
      if (BASE_BONES.includes(bone)) q = qmul(eul(tr, i), b);
      else if (ARM_BONES.test(bone) && !ours.loop) q = slerp(b, eul(tr, i), env(k[0]));
      else return null;
      if (prev && q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < 0) q = q.map((v) => -v);
      prev = q;
      return [k[0], r4(q[0]), r4(q[1]), r4(q[2]), r4(q[3])];
    });
    if (out.every(Boolean)) { tr.q = out; delete tr.rot; }
  }
}

export function build(file = FILE) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [name, c] of Object.entries(data.clips)) if (c.own) delete data.clips[name]; // regenerate ours, keep the library's
  const fresh = JSON.parse(JSON.stringify(clips));
  for (const c of Object.values(fresh)) onIdle(c, data.clips.idle && data.clips.idle.source ? data.clips.idle : null);
  Object.assign(data.clips, fresh);
  const squash = [['land', landKeys()], ['jump_start', null]];
  for (const [name, keys] of squash) {
    const c = data.clips[name];
    if (!c) continue;
    addSquash(c, keys || jumpKeys(c.seconds));
    c.toy = true;
  }
  return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = build();
  fs.writeFileSync(FILE, JSON.stringify(data));
  const own = Object.entries(data.clips).filter(([, c]) => c.own).map(([n]) => n);
  console.log(`wrote ${Object.keys(data.clips).length} clips (${own.length} ours: ${own.join(', ')})`);
}
