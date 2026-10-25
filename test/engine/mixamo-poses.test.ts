// The contact sheet as numbers (docs/animations.md 2D): every clip of public/play/anim/mixamo.json on the real person (public/play/models/person.glb,
// Gen's Mixamo rig) at four moments, through the engine's own bind and apply, and the checks a person would make by eye: no knee or elbow backwards,
// no hand through the body, nothing under the floor, the head above the feet unless the clip lies down, a loop that closes, the same clips on the robot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, world, sceneOf } from './harness.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = await load();
const A = H.presence.anim;
const B = (globalThis as any).BABYLON;
world(H, sceneOf({}, { player: false }), { mode: 'play' });
const scene = H.world.scene;
const FILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/play/anim/mixamo.json'), 'utf8'));
A.setData('mixamo', FILE);
const D = Math.PI / 180;

function glbTree(id: string) {
  const b = fs.readFileSync(path.join(ROOT, 'public', 'play', 'models', `${id}.glb`));
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  const root = new B.TransformNode('__root__', scene);
  root.rotationQuaternion = B.Quaternion.RotationAxis(B.Vector3.Up(), Math.PI); root.scaling.z = -1;
  const made = j.nodes.map((n: any) => {
    const t = new B.TransformNode(n.name, scene), r = n.rotation || [0, 0, 0, 1], p = n.translation || [0, 0, 0];
    t.rotationQuaternion = new B.Quaternion(r[0], r[1], r[2], r[3]); t.position.set(p[0], p[1], p[2]);
    if (n.scale) t.scaling.set(n.scale[0], n.scale[1], n.scale[2]);
    return t;
  });
  const kids = new Set<number>();
  j.nodes.forEach((n: any, i: number) => (n.children || []).forEach((k: number) => { made[k].parent = made[i]; kids.add(k); }));
  made.forEach((t: any, i: number) => { if (!kids.has(i)) t.parent = root; });
  return root;
}
/** A bone's place in the model's own axes (the loader's root turn undone), in model heights above the feet at rest. */
function rigOf(id: string) {
  const root = glbTree(id), b = A.bind([root], 'mixamo', { unit: 1 });
  const pos = (n: string) => { const node = b.bones.get(n).n; const chain: any[] = []; for (let x = node; x; x = x.parent) chain.unshift(x); chain.forEach((c) => c.computeWorldMatrix(true)); const p = node.getAbsolutePosition(); return [-p.x, p.y, p.z]; }; // (the loader's root turns 180 degrees about y and flips z: x changes sign, z does not)
  const floor = Math.min(pos('LeftFoot')[1], pos('RightFoot')[1], pos('LeftToeBase')[1]), top = pos('Head')[1], h = (top - floor) * 1.12;
  return { b, pos, floor, h, root };
}
const BONES = ['Hips', 'Spine2', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);

const person = rigOf('person');
/** The knee's bend at rest (a rig may rest a knee a few degrees either way): a clip is judged against it. */
function kneeBends(r: any, P: Record<string, number[]>) {
  return ['Left', 'Right'].map((s) => { const th = sub(P[`${s}Leg`], P[`${s}UpLeg`]), sh = sub(P[`${s}Foot`], P[`${s}Leg`]); return Math.atan2(th[1] * sh[2] - th[2] * sh[1], th[1] * sh[1] + th[2] * sh[2]) / D; });
}
A.apply(person.b, new Map());
const restBends = kneeBends(person, Object.fromEntries(BONES.map((n) => [n, person.pos(n)])));
const LIES = new Set(['sleep', 'get_up', 'knock_down', 'death', 'swim', 'swim_idle']);
const TOUCHES = new Set(['clap', 'heart', 'thumbsup', 'laugh', 'bow', 'sleep', 'point', 'get_up', 'knock_down', 'death', 'hurt', 'sit_down', 'stand_up', 'drive', 'interact', 'dance', 'cheer', 'idle_fidget', 'jump_start', 'jump', 'fall', 'land', 'swim', 'swim_idle', 'shrug']);

test('every clip on the person, at four moments: no broken pose', () => {
  const names = Object.keys(FILE.clips), problems: string[] = [];
  const sheet: string[] = [];
  for (const name of names) {
    const c = A.compile(FILE.clips[name]);
    for (const u of [0, 0.25, 0.5, 0.75]) {
      A.apply(person.b, A.sampleClip(c, u));
      const P = Object.fromEntries(BONES.map((n) => [n, person.pos(n)]));
      const h = person.h, at = `${name} @${u}`;
      // knees and elbows the right way: the shin folds back, never forward past the thigh's line
      for (const s of ['Left', 'Right']) {
        if (LIES.has(name)) continue; // (a body on the floor has no up to bend against)
        const bend = kneeBends(person, P)[s === 'Left' ? 0 : 1] - restBends[s === 'Left' ? 0 : 1]; // about x: positive when the shin turns back from the thigh
        if (bend < -8) problems.push(`${at}: ${s} knee bends backwards (${bend.toFixed(0)} degrees)`);
        const ua = sub(P[`${s}ForeArm`], P[`${s}Arm`]), fa = sub(P[`${s}Hand`], P[`${s}ForeArm`]);
        if (len(ua) * h < 0.01 || len(fa) * h < 0.01) continue;
        // a hand is never further from the shoulder than the arm is long
        const reach = len(sub(P[`${s}Hand`], P[`${s}Arm`])) / (len(ua) + len(fa));
        if (reach > 1.02) problems.push(`${at}: ${s} arm stretched (${reach.toFixed(2)})`);
      }
      // nothing under the floor (joints are inside the body, so a little under is a body on the ground)
      const lowest = BONES.reduce((m, n) => (P[n][1] < P[m][1] ? n : m), BONES[0]), low = P[lowest][1] - person.floor;
      if (low < -0.03 * h) problems.push(`${at}: ${lowest} is ${(-low / h * 100).toFixed(1)}% of the height under the floor`);
      // hands not through the trunk unless the clip puts them there on purpose
      if (!TOUCHES.has(name)) for (const s of ['Left', 'Right']) {
        const d = Math.abs(P[`${s}Hand`][0] - P.Hips[0]) / h;
        if (d < 0.05) problems.push(`${at}: ${s} hand is inside the body (${(d * 100).toFixed(1)}% of the height from the middle)`);
      }
      // the head is above the hips unless the body lies down
      if (!LIES.has(name) && P.Head[1] < P.Hips[1] + 0.1 * h) problems.push(`${at}: the head is not above the hips`);
      if (process.env.DUMP === name) console.log(`${at}: ` + BONES.map((n) => `${n} ${P[n].map((v, i) => ((i === 1 ? v - person.floor : v) / h).toFixed(2)).join(',')}`).join(' | '));
      sheet.push(`${at.padEnd(22)} head ${((P.Head[1] - person.floor) / h).toFixed(2)} hips ${((P.Hips[1] - person.floor) / h).toFixed(2)} hands ${((P.LeftHand[1] - person.floor) / h).toFixed(2)}/${((P.RightHand[1] - person.floor) / h).toFixed(2)}`);
    }
  }
  if (process.env.SHEET) console.log(sheet.join('\n'));
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('loops close: the pose at the end of the clip leads straight into its start', () => {
  const problems: string[] = [];
  for (const [name, clip] of Object.entries<any>(FILE.clips)) {
    if (!clip.loop) continue;
    const c = A.compile(clip), eps = 1e-3, a = A.sampleClip(c, 1 - eps), b = A.sampleClip(c, 0);
    for (const [bone, v] of b) {
      const w = a.get(bone); if (!w || !v.q || !w.q) continue;
      const d = 2 * Math.acos(Math.min(1, Math.abs(v.q[0] * w.q[0] + v.q[1] * w.q[1] + v.q[2] * w.q[2] + v.q[3] * w.q[3]))) / D;
      if (d > 2.5) problems.push(`${name}: ${bone} jumps ${d.toFixed(1)} degrees at the loop point`);
      if (v.p && w.p && Math.hypot(v.p[0] - w.p[0], v.p[1] - w.p[1], v.p[2] - w.p[2]) > 0.01) problems.push(`${name}: Hips position jumps at the loop point`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('every one-shot begins and ends where the idle stands (so it blends in and out without a pop)', () => {
  const idle = A.sampleClip(A.compile(FILE.clips.idle), 0), problems: string[] = [];
  for (const name of ['wave', 'cheer', 'laugh', 'point', 'clap', 'thumbsup', 'heart', 'shrug', 'bow', 'idle_fidget']) {
    const clip = FILE.clips[name]; if (!clip) { problems.push(`${name}: missing`); continue; }
    for (const u of [0, 1]) {
      const pose = A.sampleClip(A.compile(clip), u);
      for (const [bone, v] of pose) {
        if (!v.q) continue;
        const r = idle.get(bone), q0 = r && r.q ? r.q : [0, 0, 0, 1];
        const d = 2 * Math.acos(Math.min(1, Math.abs(v.q[0] * q0[0] + v.q[1] * q0[1] + v.q[2] * q0[2] + v.q[3] * q0[3]))) / D;
        if (d > 7) problems.push(`${name} @${u}: ${bone} is ${d.toFixed(0)} degrees from the idle`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('the robot, on the same Mixamo skeleton, takes the same clips: its hands stay on its arms and its feet near the floor', () => {
  const robot = rigOf('robot'), bad: string[] = [];
  for (const name of Object.keys(FILE.clips)) {
    const c = A.compile(FILE.clips[name]);
    for (const u of [0, 0.5]) {
      A.apply(robot.b, A.sampleClip(c, u));
      const hand = robot.pos('LeftHand'), arm = robot.pos('LeftArm'), fore = robot.pos('LeftForeArm');
      const reach = len(sub(hand, arm)) / (len(sub(fore, arm)) + len(sub(hand, fore)));
      if (reach > 1.02) bad.push(`${name} @${u}: arm stretched`);
      const low = Math.min(...BONES.map((n) => robot.pos(n)[1])) - robot.floor;
      if (low < -0.04 * robot.h) bad.push(`${name} @${u}: under the floor on the robot`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});
