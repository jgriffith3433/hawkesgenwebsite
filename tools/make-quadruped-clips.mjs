// Writes public/play/anim/quadruped.json: the quadruped class's clips (dog, fox, sheep, horse), docs/animations.md section 2B.
// Every clip is a function of u (0 to 1 of the clip) that lays rotations on bones; the file keeps the sampled keys, so the data
// stays what the game plays (no code at runtime). Run: node tools/make-quadruped-clips.mjs
//
// The template rig, as measured from the GLBs (docs/animations.md section 1):
//  - Root > Body > Head, LegFL/FR/BL/BR (each with a Tip), ArmL/ArmR (each with a Tip). The legs hang from Body, the hips close to
//    Body's own pivot, so pitching Body rocks the torso on its legs and a leg has to turn back by the same angle to stay down.
//  - Weights: on the dog, fox and horse the Tips and ArmL/ArmR move no vertex (the dog's ArmL/ArmR, a second pair of limbs under the
//    body, are not skinned: nothing draws them; the sheep's are two small meshes). The fox's and horse's tails are part of the body
//    mesh, and the body mesh is weighted to Body, Root and the legs, so a tail moves only with Body's yaw and the hind legs.
//  - Rotations are deltas in the model's axes (x the character's left, y up, front +z): rx < 0 swings a hanging leg forward or
//    lifts the nose, rx > 0 the other way; rz > 0 swings a hanging leg to the character's left (out for FL and BL, in for FR and BR).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAU = Math.PI * 2;
const sin = (u, k = 1, ph = 0) => Math.sin(TAU * (k * u + ph));
const cos = (u, k = 1, ph = 0) => Math.cos(TAU * (k * u + ph));
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
/** 0 before a, up to 1 at b, 1 until c, down to 0 at d (smooth). */
const env = (u, a, b, c, d) => smooth((u - a) / (b - a)) * (1 - smooth((u - c) / (d - c)));
/** Height of the Root pivot over the ground, in model heights (the squash keeps the feet down by this). */
const RR = 0.18;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

class Pose {
  constructor() { this.rot = {}; this.pos = {}; this.scl = {}; }
  /** Adds degrees to a bone's rotation. */
  r(b, x = 0, y = 0, z = 0) { const o = (this.rot[b] = this.rot[b] || [0, 0, 0]); o[0] += x; o[1] += y; o[2] += z; return this; }
  /** Adds a move (model heights) to Root or Body. */
  p(b, x = 0, y = 0, z = 0) { const o = (this.pos[b] = this.pos[b] || [0, 0, 0]); o[0] += x; o[1] += y; o[2] += z; return this; }
  /** Multiplies a scale. */
  s(b, x = 1, y = 1, z = 1) { const o = (this.scl[b] = this.scl[b] || [1, 1, 1]); o[0] *= x; o[1] *= y; o[2] *= z; return this; }
  /** Squash and stretch about Root that keeps volume and the feet down: k is the height (0.9 squashes, 1.1 stretches). */
  squash(k) { const w = 1 / Math.sqrt(k); return this.s('Root', w, k, w).p('Root', 0, -RR * (1 - k), 0); }
  /** The four legs turned by the same amount (to undo what Body's pitch did to them: keep(-pitch)). */
  legs(x = 0, y = 0, z = 0) { for (const l of LEGS) this.r(l, x, y, z); return this; }
}
const LEGS = ['LegFL', 'LegFR', 'LegBL', 'LegBR'];
const OUT = { LegFL: 1, LegFR: -1, LegBL: 1, LegBR: -1 }; // rz sign that swings a leg outward

/**
 * A leg's swing as a gait gives it: the angle at u of a foot that lands (at `contact`, in degrees, rx < 0 forward) at phase ph,
 * is carried back through `stance` of the cycle to `liftoff`, then swings forward again, lifted by `arc` in the middle of the swing.
 * The legs are rigid and the dog's front legs rest leaning 28 degrees forward (the hind ones 11 back), so a paw is on the ground
 * for a front angle of about 0 to +10 and a hind one of -25 to +5; leaning further forward lifts the front paw, back lifts the hind.
 */
function swing(u, ph, contact, liftoff, arc, stance = 0.58) {
  const p = (((u - ph) % 1) + 1) % 1;
  if (p < stance) { const a = p / stance; return lerp(contact, liftoff, a * 0.85 + 0.15 * smooth(a)); }
  const a = (p - stance) / (1 - stance);
  return lerp(liftoff, contact, smooth(a)) + arc * Math.sin(Math.PI * a) ** 1.3;
}

/** 0 while a foot is on the ground, a bump from 0 to 1 and back across its swing. */
function swingOf(u, ph, stance) { const p = (((u - ph) % 1) + 1) % 1; return p < stance ? 0 : Math.sin(Math.PI * (p - stance) / (1 - stance)); }

const CLIPS = {};
/** def: { loop, seconds, n (keys per clip), events, ease }, f(u, pose). */
function clip(name, def, f) { CLIPS[name] = { def, f }; }

// ------------------------------------------------------------------ standing
clip('idle', { loop: true, seconds: 3, n: 12 }, (u, p) => {
  const br = sin(u, 1);                                       // one breath a loop: chest up and a little long
  p.s('Body', 1 - 0.006 * br, 1 + 0.012 * br, 1 - 0.006 * br).p('Body', 0, 0.002 * br, 0);
  p.r('Body', 0.6 * br, 0, 0.9 * sin(u, 1, 0.25));              // a slow weight shift side to side
  p.r('LegFL', 0.8 * sin(u, 1, 0.25), 0, 0).r('LegBR', -0.8 * sin(u, 1, 0.25), 0, 0);
  const look = sin(u, 1, 0.1) * 0.7 + sin(u, 2, 0.3) * 0.3;     // the head turns, a long way each side
  p.r('Head', 2 + 1.5 * sin(u, 2, 0.1), 15 * look, 0).r('Head', 0, 0, 2.5 * sin(u, 1, 0.3));
  p.r('Head', 0, 0, 5 * Math.exp(-(((u - 0.64) / 0.025) ** 2)));  // an ear flick (the ears are the head's)
  p.r('Body', 0, 3.5 * sin(u, 2, 0.1), 0).r('Head', 0, -3 * sin(u, 2, 0.1), 0); // the tail's slow swing, the head kept steady
});
clip('idle_sniff', { loop: true, seconds: 3, n: 24 }, (u, p) => {
  const s = sin(u, 4, 0.1);                                    // four snuffles a loop
  const down = 0.8 + 0.2 * sin(u, 1, 0.1);
  p.r('Body', 14 * down, 0, 0).legs(-14 * down).r('LegBL', 3 * down).r('LegBR', 3 * down);
  p.r('Head', 46 * down + 4 * s, 12 * sin(u, 1, 0.2), 0);
  p.r('Body', 0, 6 * sin(u, 2, 0.3), 2 * sin(u, 1, 0.5)).r('Head', 0, -4 * sin(u, 2, 0.3), 0); // tail up and wagging a little
  p.p('Body', 0, -0.006 * (0.5 - 0.5 * s), 0);
  p.r('LegFL', 5 * down, 0, 0).r('LegFR', 2 * down, 0, 0);
});
clip('idle_fidget', { loop: false, seconds: 2, n: 40 }, (u, p) => {
  // scratches behind the ear with the left hind leg: weight onto the other three, the leg up and out, the head tilted into it
  const e = env(u, 0.0, 0.22, 0.78, 1);
  const strokes = sin(u * 2.4, 3, 0.0);                       // fast strokes while it is up
  p.r('Body', 0, 0, -4 * e).r('Head', 5 * e, 8 * e, 14 * e);
  p.r('Body', -6 * e, 0, 0).legs(6 * e);                        // sit back a little
  p.r('LegBL', -(85 * e) + 12 * strokes * e, 0, 28 * e).r('LegBR', 8 * e);
  p.p('Body', 0, -0.012 * e, 0);
  p.r('Head', 3 * strokes * e, 0, 5 * strokes * e);
});

// ------------------------------------------------------------------ gaits
// A foot lands (forward extreme) at its phase; the legs are rigid so the hip carries the lift.
const walkPhase = { LegFL: 0, LegBR: 0.12, LegFR: 0.5, LegBL: 0.62 };
clip('walk', { loop: true, seconds: 1, n: 16, events: ['FL', 'BR', 'FR', 'BL'].map((f, i) => ({ t: [0, 0.12, 0.5, 0.62][i], name: 'footstep', foot: f })).sort((a, b) => a.t - b.t) }, (u, p) => {
  for (const l of LEGS) {
    const front = l.startsWith('LegF'), a = front ? swing(u, walkPhase[l], -8, 10, -16, 0.6) : swing(u, walkPhase[l], -20, 12, 8, 0.6);
    p.r(l, a, 0, OUT[l] * 2.5 * swingOf(u, walkPhase[l], 0.6));  // out a little as it swings
  }
  p.p('Body', 0, 0.007 * cos(u, 2, 0.04) - 0.004, 0);          // two dips and rises a stride, on the diagonal pairs
  p.r('Body', 1.2 * sin(u, 2, 0.1), -3 * sin(u, 1, 0.0), 2.8 * sin(u, 1, 0.0)); // shoulders and hips roll against each other
  p.r('Head', 2 - 1.8 * sin(u, 2, 0.35), 4 * sin(u, 1, 0), -2.5 * sin(u, 1, 0)); // the head stays almost level and nods with each step
  p.r('Body', 0, 5 * sin(u, 1, 0.3), 0);                       // the tail swings, one side then the other (its follow-through is the body's yaw)
});
clip('trot', { loop: true, seconds: 0.7, n: 16, events: [{ t: 0, name: 'footstep', foot: 'FL' }, { t: 0, name: 'footstep', foot: 'BR' }, { t: 0.5, name: 'footstep', foot: 'FR' }, { t: 0.5, name: 'footstep', foot: 'BL' }] }, (u, p) => {
  const ph = { LegFL: 0, LegBR: 0.02, LegFR: 0.5, LegBL: 0.52 };
  for (const l of LEGS) { const front = l.startsWith('LegF'); p.r(l, front ? swing(u, ph[l], -10, 11, -20, 0.5) : swing(u, ph[l], -22, 14, 8, 0.5), 0, 0); }
  p.p('Root', 0, 0.026 * (0.5 - 0.5 * cos(u, 2, 0)), 0);     // a bounce twice a stride: up in the suspension between the pairs
  p.r('Body', 2.2 * sin(u, 2, 0.0), -2.5 * sin(u, 1, 0.0), 2 * sin(u, 1, 0.0));
  p.r('Head', 1 - 2 * sin(u, 2, 0.0), 2.5 * sin(u, 1, 0), -1.5 * sin(u, 1, 0));
  p.r('Body', 0, 4 * sin(u, 1, 0.3), 0);
});
clip('run', { loop: true, seconds: 0.5, n: 16, events: [{ t: 0, name: 'footstep', foot: 'FL' }, { t: 0.04, name: 'footstep', foot: 'FR' }, { t: 0.55, name: 'footstep', foot: 'BL' }, { t: 0.59, name: 'footstep', foot: 'BR' }] }, (u, p) => {
  // a gallop: the front pair lands reaching (u 0), pushes back and folds under the chest (gathered, u 0.5) while the hind pair
  // comes forward and lands (u 0.55), pushes off to the back and the body stretches 1.1 (extended); the left of each pair leads by 0.04
  const fa = (d) => -(8 + 32 * cos(u, 1, -0.95 + d)), ha = (d) => 4 - 28 * cos(u, 1, -0.45 + d);
  p.r('LegFL', fa(0)).r('LegFR', fa(-0.04)).r('LegBL', ha(0)).r('LegBR', ha(-0.04));
  const ext = 0.5 + 0.5 * cos(u, 1, -0.97);                    // 1 extended, 0 gathered
  const sz = 0.97 + 0.13 * ext;                                // the back 0.97 to 1.1 long, the height and width keep the volume
  p.s('Body', 1 / Math.sqrt(sz), 1 / Math.sqrt(sz), sz);
  p.p('Root', 0, 0.075 + 0.06 * (0.5 - 0.5 * cos(u, 2, -0.06)), 0); // two flights a stride, down at each landing (the paws just touch at the dips)
  p.r('Body', -8 * cos(u, 1, -0.9) + 2, 0, 1.2 * sin(u, 1, 0.5)).legs(5 * cos(u, 1, -0.9));
  p.r('Head', 7 * cos(u, 1, -0.9) - 8, 0, 0);                  // the head stays level and forward, the ears laid back
  p.r('Body', 0, 3 * sin(u, 1, 0.3), 0);
});

// ------------------------------------------------------------------ jumping
clip('jump_start', { loop: false, seconds: 0.25, n: 12 }, (u, p) => {
  // crouches for 40% of it (the back legs gathered, the chest down), then pushes off and stretches with the front legs reaching
  const c = env(u, 0, 0.3, 0.4, 0.62), push = smooth((u - 0.38) / 0.5);
  p.squash(1 - 0.16 * c + 0.14 * push * (1 - smooth((u - 0.8) / 0.2) * 0.4));
  p.r('Body', 10 * c - 26 * push, 0, 0).legs(-10 * c + 26 * push);
  p.r('LegFL', -20 * c - 22 * push, 0, 0).r('LegFR', -20 * c - 22 * push, 0, 0).r('LegBL', -16 * c + 44 * push, 0, 0).r('LegBR', -16 * c + 44 * push, 0, 0);
  p.r('Head', 6 * c - 12 * push, 0, 0);
});
clip('jump', { loop: true, seconds: 0.7, n: 8 }, (u, p) => {
  // in the air: the front legs reach, the hind legs trail, the nose up; a small rock and a flutter keep it alive
  p.squash(1.04).r('Body', -8 + 1.5 * sin(u, 1), 0, 0).legs(8 - 1.5 * sin(u, 1));
  p.r('LegFL', -38 + 4 * sin(u, 1, 0), 0, OUT.LegFL * 8).r('LegFR', -34 - 4 * sin(u, 1, 0), 0, OUT.LegFR * 8);
  p.r('LegBL', 32 - 4 * sin(u, 1, 0.25), 0, OUT.LegBL * 6).r('LegBR', 30 + 4 * sin(u, 1, 0.25), 0, OUT.LegBR * 6);
  p.r('Head', -4, 3 * sin(u, 1, 0.5), 0).r('Body', 0, 6 * sin(u, 2, 0.1), 0);
});
clip('land', { loop: false, seconds: 0.3, n: 16 }, (u, p) => {
  // the front legs take the weight first, the chest dips, the hind legs come under; one overshoot and it stands
  const reach = 1 - smooth(u / 0.25);
  p.r('LegFL', -34 * reach, 0, OUT.LegFL * 6 * reach).r('LegFR', -34 * reach, 0, OUT.LegFR * 6 * reach);
  p.r('LegBL', 28 * reach - 10 * env(u, 0.1, 0.35, 0.5, 0.8), 0, 0).r('LegBR', 28 * reach - 10 * env(u, 0.1, 0.35, 0.5, 0.8), 0, 0);
  const dip = env(u, 0.1, 0.34, 0.4, 0.66);
  const k = 1 - 0.17 * dip + 0.04 * env(u, 0.55, 0.72, 0.74, 0.92);
  p.squash(k);
  p.r('Body', 13 * dip - 6 * reach, 0, 0).legs(-13 * dip + 6 * reach);
  p.r('Head', -8 * reach + 8 * dip - 4 * env(u, 0.55, 0.7, 0.75, 0.95), 0, 0);
});
clip('fall', { loop: true, seconds: 0.9, n: 12 }, (u, p) => {
  // legs spread and paddling the air, the rump up and the head forward
  p.r('Body', 8 + 2 * sin(u, 1, 0.1), 0, 3 * sin(u, 1, 0.5)).legs(-8 - 2 * sin(u, 1, 0.1));
  p.r('LegFL', -28 + 10 * sin(u, 1, 0), 0, 28 + 6 * sin(u, 1, 0.1)).r('LegFR', -28 + 10 * sin(u, 1, 0.5), 0, -28 - 6 * sin(u, 1, 0.6));
  p.r('LegBL', 26 + 10 * sin(u, 1, 0.5), 0, 30 + 6 * sin(u, 1, 0.3)).r('LegBR', 26 + 10 * sin(u, 1, 0), 0, -30 - 6 * sin(u, 1, 0.8));
  p.r('Head', -10 + 3 * sin(u, 2, 0), 5 * sin(u, 1, 0.25), 3 * sin(u, 1, 0.1)).r('Body', 0, 5 * sin(u, 2, 0), 0);
});
clip('swim', { loop: true, seconds: 0.9, n: 16 }, (u, p) => {
  // the dog paddle: the head and chest up, the front legs reach and pull, the hind legs follow on the diagonal
  p.r('Body', -14 + 2 * sin(u, 2, 0), 0, 3 * sin(u, 1, 0)).legs(14);
  p.r('LegFL', -26 + 34 * sin(u, 1, 0), 0, OUT.LegFL * 10).r('LegBR', -4 + 30 * sin(u, 1, 0.08), 0, OUT.LegBR * 8);
  p.r('LegFR', -26 + 34 * sin(u, 1, 0.5), 0, OUT.LegFR * 10).r('LegBL', -4 + 30 * sin(u, 1, 0.58), 0, OUT.LegBL * 8);
  p.r('Head', 12 + 2 * sin(u, 2, 0.25), 3 * sin(u, 1, 0.25), -2 * sin(u, 1, 0));    // chin up, level
  p.p('Body', 0, 0.01 * sin(u, 2, 0.2), 0).r('Body', 0, 5 * sin(u, 1, 0.3), 0);
});

// ------------------------------------------------------------------ sitting, lying
/** The sit as a share a of the way (1 is sat). */
function sitPose(p, a, o = {}) {
  const lean = (o.lean ?? 38) * a;
  p.r('Body', -lean, 0, 0).legs(lean);
  p.r('LegBL', -(o.hind ?? 42) * a, 0, OUT.LegBL * 14 * a).r('LegBR', -(o.hind ?? 42) * a, 0, OUT.LegBR * 14 * a);
  p.p('Root', 0, -0.045 * a, 0);
  p.r('Head', (o.head ?? 12) * a, 0, 0);
}
clip('sit', { loop: true, seconds: 4, n: 16 }, (u, p) => {
  sitPose(p, 1);
  const br = sin(u, 1);
  p.s('Body', 1 - 0.005 * br, 1 + 0.01 * br, 1 - 0.005 * br);
  p.r('Body', 0, 0, 0.8 * sin(u, 1, 0.25)).r('Head', 0, 16 * (0.7 * sin(u, 1, 0.1) + 0.3 * sin(u, 2, 0.3)), 2 * sin(u, 1, 0.3));
  p.r('Body', 0, 9 * sin(u, 4, 0.2), 0).r('Head', 0, -8 * sin(u, 4, 0.2), 0);              // the tail sweeping the ground, a wide slow wag
  p.r('Head', 0, 0, 5 * Math.exp(-(((u - 0.7) / 0.02) ** 2)));                                 // an ear flick
});
clip('lie_down', { loop: false, seconds: 0.8, n: 24 }, (u, p) => {
  // sits, then slides the front legs out and the belly to the ground, the head last
  const a = smooth(u / 0.45), b = smooth((u - 0.35) / 0.65);
  p.r('Body', -38 * a + 38 * b, 0, 0).legs(38 * a - 38 * b);
  p.r('LegBL', -42 * a - 22 * b, 0, OUT.LegBL * (14 * a + 22 * b)).r('LegBR', -42 * a - 22 * b, 0, OUT.LegBR * (14 * a + 22 * b));
  p.r('LegFL', -86 * b, 0, OUT.LegFL * 8 * b).r('LegFR', -86 * b, 0, OUT.LegFR * 8 * b);
  p.p('Root', 0, -0.045 * a - 0.08 * b, 0);
  p.r('Head', 12 * a - 4 * b + 8 * env(u, 0.6, 0.85, 0.9, 1), 0, 0);
});
clip('sleep', { loop: true, seconds: 4, n: 16 }, (u, p) => {
  // on the belly, the legs tucked, the head turned back with the nose on the tail; a slow breath
  const br = sin(u, 1);
  p.p('Root', 0, -0.125, 0);
  p.r('LegFL', -86, 0, OUT.LegFL * 26).r('LegFR', -86, 0, OUT.LegFR * 26).r('LegBL', -66, 0, OUT.LegBL * 48).r('LegBR', -66, 0, OUT.LegBR * 48);
  p.r('Body', 0, 0, 0).s('Body', 1 - 0.01 * br, 1 + 0.02 * br, 1 - 0.01 * br);
  p.r('Head', 20 + 1.5 * br, 70, 10).r('Body', 0, 6, 0);
  p.r('Head', 0, 0, 2 * Math.exp(-(((u - 0.45) / 0.03) ** 2)));
});
clip('drive', { loop: true, seconds: 2, n: 16 }, (u, p) => {
  // up on the seat, the front paws forward on the wheel and the ears back; the head turns with the road
  sitPose(p, 1, { lean: 24, hind: 50, head: -6 });
  p.r('LegFL', -42, 0, OUT.LegFL * 6).r('LegFR', -42, 0, OUT.LegFR * 6);
  p.r('Head', 0, 14 * sin(u, 1, 0), 3 * sin(u, 1, 0.25)).r('Body', 0.5 * sin(u, 3, 0), 0, 1 * sin(u, 2, 0.1));
  p.p('Root', 0, 0.002 * sin(u, 5, 0), 0).r('Body', 0, 5 * sin(u, 2, 0.4), 0);
});

// ------------------------------------------------------------------ emotes
clip('wave', { loop: false, seconds: 1.6, n: 32 }, (u, p) => {
  // sits, lifts the right front paw and shakes it three times, then stands again
  const a = env(u, 0, 0.18, 0.84, 1), up = env(u, 0.14, 0.3, 0.74, 0.88);
  sitPose(p, a, { lean: 34, hind: 44 });
  p.r('LegFR', -78 * up + 14 * sin((u - 0.3) * 1.6 / 0.44, 3, 0) * up, 0, -10 * up + 4 * up + 12 * sin((u - 0.3) * 1.6 / 0.44, 3, 0.25) * up);
  p.r('Head', 0, 0, -8 * up).r('Body', 0, 0, 2 * up);
  p.r('Body', 0, 6 * a * sin(u, 3, 0), 0);
});
clip('dance', { loop: true, seconds: 2.4, n: 24 }, (u, p) => {
  // up on the hind legs, a hop on each beat, the front paws up one then the other, a full turn a loop
  const hop = Math.abs(sin(u, 2, 0)), beat = sin(u, 2, 0.25);
  const lean = 34;
  p.r('Body', -lean, 0, 3 * sin(u, 2, 0.25)).legs(lean).r('LegBL', -4 * hop).r('LegBR', -4 * hop);
  p.p('Root', 0, 0.045 * hop - 0.01, 0).r('Root', 0, 360 * u, 0).squash(1 + 0.04 * (hop - 0.5));
  p.r('LegFL', -100 - 40 * Math.max(0, sin(u, 2, 0)) , 0, OUT.LegFL * (20 + 12 * beat)).r('LegFR', -100 - 40 * Math.max(0, -sin(u, 2, 0)), 0, OUT.LegFR * (20 - 12 * beat));
  p.r('Head', 14 - 10 * hop + 4 * lean / 38, 0, 8 * beat);
});
clip('cheer', { loop: false, seconds: 1.4, n: 28 }, (u, p) => {
  // crouches, springs up onto the hind legs with both paws high, a hop at the top, and lands
  const crouch = env(u, 0, 0.14, 0.2, 0.3), up = env(u, 0.2, 0.36, 0.72, 0.9), hop = env(u, 0.46, 0.55, 0.57, 0.66);
  p.squash(1 - 0.1 * crouch).p('Root', 0, 0.055 * hop, 0);
  p.r('Body', 8 * crouch - 38 * up, 0, 0).legs(-8 * crouch + 38 * up);
  p.r('LegFL', -112 * up - 20 * hop, 0, OUT.LegFL * 24 * up).r('LegFR', -112 * up - 20 * hop, 0, OUT.LegFR * 24 * up);
  p.r('Head', -22 * up + 6 * crouch, 0, 3 * sin(u * 1.4, 3, 0) * up);
});
clip('laugh', { loop: false, seconds: 1.6, n: 40 }, (u, p) => {
  // head back and the whole chest shaking in a bark-pant, the body bobbing on every beat
  const e = env(u, 0, 0.14, 0.82, 1), pant = sin(u * 1.6, 6.5, 0);
  p.r('Head', -34 * e + 5 * pant * e, 0, 4 * e).r('Body', -7 * e + 2.2 * pant * e, 0, 0).legs(7 * e);
  p.s('Body', 1, 1 + 0.025 * pant * e, 1).p('Body', 0, 0.007 * Math.abs(pant) * e, 0).p('Root', 0, 0.003 * pant * e, 0);
  p.r('Body', 0, 8 * sin(u * 1.6, 3.25, 0) * e, 0).r('Head', 0, -5 * sin(u * 1.6, 3.25, 0) * e, 0);
});
clip('point', { loop: false, seconds: 1.2, n: 24 }, (u, p) => {
  // the pointer: the nose forward and level, the body low in front, one front paw up, the tail rigid and still
  const e = env(u, 0, 0.22, 0.78, 1), tremor = sin(u * 1.2, 7, 0) * 0.35;
  p.r('Body', 9 * e, 0, 0).legs(-9 * e).p('Root', 0, -0.01 * e, 0);
  p.r('LegFL', -74 * e + tremor * e, 0, OUT.LegFL * -4 * e);
  p.r('LegBL', 6 * e).r('LegBR', 6 * e).r('LegFR', 4 * e);
  p.r('Head', -10 * e + 0.5 * tremor * e, 0, 0);
});
clip('clap', { loop: false, seconds: 1.6, n: 48 }, (u, p) => {
  // front paws pat the ground in turn, six pats, a little bounce and a nod with each
  const e = env(u, 0, 0.1, 0.9, 1), w = (u - 0.1) / 0.8;
  const pat = (ph) => Math.max(0, sin(w, 3, ph)) ** 1.5;
  p.r('Body', 6 * e, 0, 0).legs(-6 * e).r('Head', -4 * e, 0, 0);
  p.r('LegFL', -48 * pat(0.0) * e, 0, 0).r('LegFR', -48 * pat(0.5) * e, 0, 0);
  p.p('Body', 0, 0.006 * Math.abs(sin(w, 3, 0.25)) * e, 0).r('Head', 5 * Math.abs(sin(w, 3, 0.25)) * e, 0, 0);
});
clip('thumbsup', { loop: false, seconds: 1.2, n: 48 }, (u, p) => {
  // the tail going, a quick nod and a proud chest
  const e = env(u, 0, 0.12, 0.8, 1), wag = sin(u * 1.2, 7, 0);
  p.r('Body', -3 * e, 14 * wag * e, 0).r('Head', 0, -10 * wag * e, 0).r('Root', 0, -3 * wag * e, 0).legs(3 * e);
  p.r('Head', 12 * Math.max(0, sin(u, 2, 0.1)) * e + (-4 * e), 0, 0);
  p.s('Body', 1, 1 + 0.015 * e, 1);
});
clip('heart', { loop: false, seconds: 1.6, n: 40 }, (u, p) => {
  // a play-bow, chest to the ground and the rump and tail high, spinning round once
  const bow = env(u, 0.0, 0.2, 0.8, 1), spin = smooth((u - 0.2) / 0.6);
  p.r('Body', 22 * bow, 0, 0).legs(-22 * bow).r('LegFL', -52 * bow, 0, 0).r('LegFR', -52 * bow, 0, 0).p('Body', 0, -0.02 * bow, 0);
  p.r('Root', 0, 360 * spin, 0).p('Root', 0, 0.01 * Math.abs(sin(u, 2, 0)) * bow, 0);
  p.r('Head', -14 * bow, 0, 4 * sin(u, 3, 0) * bow).r('Body', 0, 12 * sin(u, 4, 0) * bow, 0);
});
clip('bark', { loop: false, seconds: 0.8, n: 32 }, (u, p) => {
  // two barks: gather back, then head up and a lunge forward; the second one smaller
  const g1 = env(u, 0, 0.12, 0.16, 0.26), b1 = env(u, 0.14, 0.26, 0.3, 0.45), g2 = env(u, 0.4, 0.5, 0.52, 0.6), b2 = env(u, 0.52, 0.62, 0.66, 0.82);
  const gather = g1 + 0.5 * g2, bark = b1 + 0.7 * b2;
  p.p('Root', 0, 0, 0.06 * bark - 0.02 * gather).r('Body', 5 * gather - 7 * bark, 0, 0).legs(-5 * gather + 7 * bark);
  p.r('Head', 6 * gather - 30 * bark, 0, 0).r('LegFL', 10 * gather - 14 * bark).r('LegFR', 10 * gather - 14 * bark);
  p.squash(1 - 0.04 * gather + 0.025 * bark);
});
clip('shake_off', { loop: false, seconds: 1.2, n: 60 }, (u, p) => {
  // the wet-dog shake: the head goes first, the shoulders follow, then the whole rump, the legs braced wide
  const e = env(u, 0.0, 0.1, 0.8, 1), f = 5;
  const head = sin(u, f, 0), body = sin(u, f, -0.14), root = sin(u, f, -0.28);
  p.r('Head', 0, 32 * head * e, 8 * head * e).r('Body', 0, 14 * body * e, 4 * body * e).r('Root', 0, 9 * root * e, 0);
  p.legs(0, 0, 0); for (const l of LEGS) p.r(l, 0, 0, OUT[l] * 9 * e);
  p.s('Body', 1 + 0.02 * sin(u, f * 2, 0) * e, 1 - 0.02 * sin(u, f * 2, 0) * e, 1).p('Root', 0, -0.012 * e, 0);
});
clip('shrug', { loop: false, seconds: 1.2, n: 24 }, (u, p) => {
  // a head tilt, one ear down, a small sigh: the chest drops, the head looks off to the side
  const e = env(u, 0, 0.25, 0.7, 1), sigh = env(u, 0.45, 0.6, 0.65, 0.85);
  p.r('Head', 6 * e, 12 * e, 16 * e).r('Body', 0, 0, 1.5 * e);
  p.s('Body', 1 + 0.02 * e, 1 - 0.03 * sigh - 0.01 * e, 1 + 0.02 * e).p('Root', 0, -0.012 * sigh, 0);
});
clip('hurt', { loop: false, seconds: 0.5, n: 20 }, (u, p) => {
  // a yelp: it jerks back and tucks, the legs in, the head down; it settles with a small bounce
  const hit = env(u, 0, 0.12, 0.2, 0.5), tail = env(u, 0.1, 0.25, 0.4, 0.8);
  p.squash(1 - 0.1 * hit + 0.02 * env(u, 0.55, 0.7, 0.72, 0.9)).p('Root', 0, 0, -0.04 * hit);
  p.r('Body', 12 * hit, 0, 1.5 * hit).legs(-12 * hit + 0 * hit).r('Head', 16 * hit - 6 * env(u, 0.5, 0.65, 0.7, 0.9), 0, -5 * hit);
  p.r('LegBL', -10 * hit).r('LegBR', -10 * hit).r('LegFL', 10 * hit).r('LegFR', 10 * hit).r('Body', 0, -4 * tail, 0);
});
clip('knock_down', { loop: false, seconds: 0.9, n: 36 }, (u, p) => {
  // thrown off its feet: a pop up and back, the legs flung, then over onto its right side; it ends lying there
  const pop = env(u, 0, 0.18, 0.22, 0.55), roll = smooth((u - 0.1) / 0.6), over = 1 + 0.06 * env(u, 0.55, 0.7, 0.72, 0.9);
  const fling = env(u, 0.05, 0.3, 0.4, 0.8);
  p.r('Root', 0, 0, 90 * roll * over).p('Root', 0, 0.045 * pop + 0.14 * roll + 0.09 * env(u, 0.4, 0.62, 0.7, 0.85), -0.03 * pop);
  p.r('Body', -14 * pop, 0, 0).legs(14 * pop);
  p.r('LegFL', -40 * fling + 30 * roll, 0, OUT.LegFL * 34 * fling).r('LegFR', -44 * fling + 20 * roll, 0, OUT.LegFR * 34 * fling);
  p.r('LegBL', 36 * fling - 20 * roll, 0, OUT.LegBL * 30 * fling).r('LegBR', 40 * fling - 30 * roll, 0, OUT.LegBR * 30 * fling);
  p.r('Head', -12 * pop + 12 * roll, 0, -12 * roll);
});
clip('get_up', { loop: false, seconds: 1.0, n: 40 }, (u, p) => {
  // rolls back over onto its feet and shakes once as it stands
  const roll = 1 - smooth(u / 0.45), over = 1 - 0.1 * env(u, 0.35, 0.5, 0.52, 0.65);
  const pad = env(u, 0.0, 0.2, 0.3, 0.55), shake = env(u, 0.55, 0.65, 0.8, 0.97);
  p.r('Root', 0, 0, 90 * roll).p('Root', 0, 0.14 * roll + 0.09 * env(u, 0.0, 0.15, 0.3, 0.5) + 0.02 * env(u, 0.35, 0.5, 0.55, 0.7), 0).squash(over);
  p.r('LegFL', 30 * roll - 24 * pad * sin(u, 3, 0), 0, 0).r('LegFR', 20 * roll + 24 * pad * sin(u, 3, 0), 0, 0);
  p.r('LegBL', -20 * roll + 22 * pad * sin(u, 3, 0.25), 0, 0).r('LegBR', -30 * roll - 22 * pad * sin(u, 3, 0.25), 0, 0);
  p.r('Head', 12 * roll + 0, 20 * sin(u, 3.5, 0) * shake, -12 * roll + 8 * sin(u, 3.5, 0) * shake).r('Body', 0, 9 * sin(u, 3.5, -0.12) * shake, 0);
});

// ------------------------------------------------------------------ writing the file
const HIDE = new Set();
function bake(name, { def, f }) {
  const N = def.n, count = def.loop ? N : N + 1, samples = [];
  for (let i = 0; i < count; i++) { const u = i / N, p = new Pose(); f(u, p); samples.push([u, p]); }
  const tracks = {};
  const bones = new Set(samples.flatMap(([, p]) => [...Object.keys(p.rot), ...Object.keys(p.pos), ...Object.keys(p.scl)]));
  const sameAll = (rows, rest) => rows.every((v) => v.every((x, i) => Math.abs(x - rest[i]) < 0.0005));
  const span = (rows, rest) => Math.max(...rows.map((v) => Math.max(...v.map((x, i) => Math.abs(x - rest[i])))));
  for (const b of bones) {
    const rot = samples.map(([, p]) => p.rot[b] || [0, 0, 0]), pos = samples.map(([, p]) => p.pos[b] || [0, 0, 0]), scl = samples.map(([, p]) => p.scl[b] || [1, 1, 1]);
    const keep = { rot: span(rot, [0, 0, 0]) >= 0.2, pos: span(pos, [0, 0, 0]) >= 0.0008, scl: span(scl, [1, 1, 1]) >= 0.0008 };
    // a track that does not change is one key (the sampler holds a single key)
    const flat = (rows) => span(rows, rows[0]) < 0.005;
    const put = (kind, rows, f) => { const idx = flat(rows) ? [0] : rows.map((_, i) => i); ((tracks[b] = tracks[b] || {})[kind] = idx.map((i) => [r3(samples[i][0]), ...rows[i].map(f)])); };
    if (keep.rot) put('rot', rot, r2);
    if (keep.pos) put('pos', pos, r3);
    if (keep.scl) put('scl', scl, r3);
  }
  const out = { loop: def.loop, seconds: def.seconds, ease: 'spline' };
  if (def.events) out.events = def.events;
  out.tracks = tracks;
  return out;
}
const file = {
  class: 'quadruped', version: 2,
  note: 'The template rig (dog, fox, sheep, horse), authored by tools/make-quadruped-clips.mjs. Deltas from rest in the model\'s axes: rx < 0 swings a leg forward or lifts the nose; rz > 0 swings a hanging leg to the character\'s left. pos is in model heights. The Tips and ArmL/ArmR move no vertex on the dog, fox and horse (docs/animations.md 2B).',
  clips: {},
};
for (const [name, c] of Object.entries(CLIPS)) file.clips[name] = bake(name, c);
const dir = path.dirname(fileURLToPath(import.meta.url));
const text = JSON.stringify(file, (k, v) => v, 1).replace(/\n\s*(?=[\d\-\[\]])/g, (m) => m.includes('[') ? m : '').replace(/\[\s+/g, '[').replace(/\s+\]/g, ']');
fs.writeFileSync(path.join(dir, '..', 'public', 'play', 'anim', 'quadruped.json'), text + '\n');
console.log(`quadruped.json: ${Object.keys(file.clips).length} clips, ${text.length} bytes`);
