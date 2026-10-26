// Animation clips as data (public/play/modules/presence/presence-anim.js, public/play/anim/<class>.json; docs/animations.md):
// one clip format for three rig classes (mixamo, quadruped, object), checked against the class skeletons read from the real GLBs
// (the Mixamo class from a Mixamo-rigged GLB when one is in public/play/models, else test/fixtures/mixamo-skeleton.json), a sampler
// that applies clips as deltas on the rest pose the model has, blends over 0.15 s, one-shots over loops, events, the fallbacks (the
// model's own clip, then the procedural motion), a template-rigged biped that keeps animating, and ten characters on the phone tier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, world, sceneOf } from './harness.ts';
import { measureCrowd } from './crowd-measure.ts';
import { STANDINS, STANDIN_FOR, mixamoPuppet, toContainer, standinRows, specOf } from '../../public/avatars-standins.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = await load();
const P = H.presence;
const C = P.core;
const M = P.models;
const A = P.anim;
const B = (globalThis as any).BABYLON;
world(H, sceneOf({}, { player: false }), { mode: 'play' });
const scene = H.world.scene;

const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const FILES: Record<string, any> = { mixamo: readJson('test/fixtures/mixamo-starter.json') /* the starter idle and walk: these tests are about the sampler; the real set is checked by mixamo-poses.test.ts */, quadruped: readJson('public/play/anim/quadruped.json'), object: readJson('public/play/anim/object.json') };
for (const [cls, f] of Object.entries(FILES)) A.setData(cls, f);
const registryBefore = JSON.parse(JSON.stringify(P.modelRegistry));

/** A GLB's JSON: nodes, skins, animations (the real files, no loader needed). */
function glb(id: string) {
  const b = fs.readFileSync(path.join(ROOT, 'public', 'play', 'models', `${id}.glb`));
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
}
const joints = (id: string): string[] => { const j = glb(id); return j.skins && j.skins[0] ? j.skins[0].joints.map((i: number) => j.nodes[i].name) : []; };
/** A real GLB's nodes as Babylon transform nodes under the loader's own root (rest pose as the file has it). */
function glbTree(id: string) {
  const j = glb(id);
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
/** The Mixamo puppet as nodes (the container instanced, as a model on a rig is). */
function puppetRoots(prefix = 'mixamorig:') {
  const inst = toContainer(B, scene, mixamoPuppet(prefix)).instantiateModelsToScene((n: string) => n, false);
  return inst.rootNodes;
}
const world3 = (node: any) => { const chain: any[] = []; for (let n = node; n; n = n.parent) chain.unshift(n); chain.forEach((n) => n.computeWorldMatrix(true)); return node.getAbsolutePosition().clone(); };
const at = (b: any, bone: string) => world3(b.bones.get(bone).n);

const MIXAMO = ['person', 'robot', 'tvbot', 'cat', 'pig', 'bear', 'rabbit', 'penguin', 'chicken', 'cow']; // the files on the standard Mixamo skeleton
const TEMPLATE_BIPED = ['person', 'robot', 'tvbot', 'dinosaur', 'penguin', 'chicken', 'cat', 'pig', 'bear', 'cow', 'rabbit'];
const QUADS = ['dog', 'fox', 'sheep', 'horse'];
const OBJECTS = ['toaster', 'shoe', 'teapot', 'cactus', 'cone', 'banana', 'mushroom', 'potato', 'duck', 'rollbot', 'fish'];

// ------------------------------------------------------------------ the class skeletons and the files
test('the class skeletons are read from the real GLBs: the quadruped template, the objects\' Body, the Mixamo names from a Mixamo-rigged file or the fixture', () => {
  // quadruped: the four models share the 15 joints, and the class names exactly them
  for (const id of QUADS) assert.deepEqual([...joints(id)].sort(), [...A.CLASSES.quadruped.bones].sort(), `${id}: the quadruped template's joints`);
  // objects: one node called Body
  for (const id of OBJECTS) assert.ok(glb(id).nodes.some((n: any) => n.name === 'Body'), `${id}: a Body node`);
  assert.deepEqual(A.CLASSES.object.bones, ['Body', 'ToastL', 'ToastR'], 'the Body, and the toaster\'s two virtual toast slices (props made in presence-things.js)');
  // mixamo: every GLB whose skeleton is Mixamo's (the biped pilot once it has landed) must agree with the class; else the fixture is the reference
  const mixamoGlbs = fs.readdirSync(path.join(ROOT, 'public', 'play', 'models')).filter((f) => f.endsWith('.glb') && !f.includes('-low') && !f.startsWith('hat-')).map((f) => f.replace('.glb', '')).filter((id) => joints(id).some((n) => A.norm(n) === 'LeftUpLeg'));
  for (const id of mixamoGlbs) {
    const names = joints(id).map(A.norm);
    for (const n of A.CLASSES.mixamo.need) assert.ok(names.includes(n), `${id}: has the Mixamo bone ${n}`);
    for (const n of names) assert.ok(A.CLASSES.mixamo.bones.includes(n), `${id}: ${n} is a Mixamo bone`);
  }
  const fixture = readJson('test/fixtures/mixamo-skeleton.json').bones;
  assert.equal(fixture.length, 65, 'the standard skeleton has 65 bones');
  assert.deepEqual([...A.CLASSES.mixamo.bones].sort(), [...fixture].sort(), 'the class names the fixture\'s bones (the standard Mixamo skeleton)');
  console.log(`mixamo skeleton checked against ${mixamoGlbs.length ? mixamoGlbs.join(', ') : 'the fixture (no Mixamo-rigged GLB in public/play/models yet)'}`);
});

test('every bone a shipped clip names exists in its class skeleton (read from the GLBs), and the three files are sound', () => {
  for (const [cls, f] of Object.entries(FILES)) {
    assert.deepEqual(A.validate(cls, f), [], `${cls}.json has no problems`);
    assert.ok(f.clips.idle && f.clips.walk, `${cls}.json has a starter idle and walk`);
  }
  const named = (cls: string) => new Set<string>(Object.values<any>(FILES[cls].clips).flatMap((c: any) => Object.keys(c.tracks)));
  const dog = new Set(joints('dog'));
  for (const b of named('quadruped')) assert.ok(dog.has(b), `quadruped clips name ${b}: the dog's GLB has it`);
  const toaster = new Set([...glb('toaster').nodes.map((n: any) => n.name), ...A.CLASSES.object.parts]); // (the toast slices are props, not nodes of the file)
  for (const b of named('object')) assert.ok(toaster.has(b), `object clips name ${b}: the toaster's GLB has it`);
  const mx = new Set<string>(readJson('test/fixtures/mixamo-skeleton.json').bones);
  for (const b of named('mixamo')) assert.ok(mx.has(A.norm(b)), `mixamo clips name ${b}: the Mixamo skeleton has it`);
});

test('a clip that names a bone the class skeleton lacks fails; Mixamo-prefixed and unprefixed names both match', () => {
  const tweak = (cls: string, fn: (f: any) => void) => { const f = JSON.parse(JSON.stringify(FILES[cls])); fn(f); return A.validate(cls, f); };
  const tail = tweak('quadruped', (f) => { f.clips.walk.tracks.Tail = { rot: [[0, 0, 0, 0], [0.5, 0, 10, 0]] }; });
  assert.equal(tail.length, 1);
  assert.match(tail[0], /clip "walk".*quadruped skeleton has no bone "Tail"/);
  assert.ok(tweak('mixamo', (f) => { f.clips.idle.tracks.LegFLTip = { rot: [[0, 0, 0, 0]] }; }).some((p: string) => /no bone "LegFLTip"/.test(p)), 'a quadruped bone is not a Mixamo bone');
  assert.ok(tweak('mixamo', (f) => { f.clips.idle.tracks.LeftArm.rot = [[0, 1, 2]]; }).some((p: string) => /needs 4 numbers/.test(p)));
  assert.ok(tweak('mixamo', (f) => { f.clips.walk.tracks.LeftArm.pos = [[0, 0, 0, 0]]; }).some((p: string) => /cannot have pos/.test(p)), 'only Hips moves');
  assert.ok(tweak('object', (f) => { f.clips.idle.tracks.Toast = { scl: [[0, 1, 1, 1]] }; }).some((p: string) => /no bone "Toast"/.test(p)));
  assert.ok(tweak('mixamo', (f) => { f.clips.walk.seconds = 0; }).some((p: string) => /seconds/.test(p)));
  assert.ok(tweak('mixamo', (f) => { f.clips.walk.tracks.Hips.rot = [[0.5, 0, 0, 0], [0.2, 0, 0, 0]]; }).some((p: string) => /times must rise/.test(p)));
  // the same bone with any of Mixamo's prefixes is the bone
  for (const prefix of ['mixamorig:', 'mixamorig7:', 'mixamorig_', '']) {
    const prefixed = tweak('mixamo', (f) => { for (const c of Object.values<any>(f.clips)) c.tracks = Object.fromEntries(Object.entries<any>(c.tracks).map(([k, v]) => [prefix + k, v])); });
    assert.deepEqual(prefixed, [], `"${prefix}LeftArm" is accepted`);
    assert.equal(A.norm(`${prefix}LeftUpLeg`), 'LeftUpLeg');
  }
  // and finds the nodes of a rig written either way
  for (const prefix of ['mixamorig:', 'mixamorig7:', '']) {
    const b = A.bind(puppetRoots(prefix), 'mixamo', { unit: 1.8 });
    assert.ok(b.fit, `a rig with the prefix "${prefix}" fits`);
    assert.ok(b.bones.has('LeftForeArm') && b.bones.has('RightFoot'));
  }
  assert.equal(A.bind(puppetRoots(), 'quadruped', {}).fit, false, 'a Mixamo rig is not a quadruped');
});

test('a model\'s class comes from its registry row: `rig`, else its form', () => {
  assert.equal(A.classOf({ form: 'biped' }), 'mixamo');
  assert.equal(A.classOf({ form: 'bird' }), 'mixamo');
  assert.equal(A.classOf({ form: 'quadruped' }), 'quadruped');
  assert.equal(A.classOf({ form: 'thing' }), 'object');
  assert.equal(A.classOf({ form: 'legless' }), 'object');
  assert.equal(A.classOf({ form: 'roller' }), null, 'a roller rolls with the distance: no set unless the row asks');
  assert.equal(A.classOf({ form: 'swimmer' }), null);
  assert.equal(A.classOf({ form: 'swimmer', rig: 'object' }), 'object');
  assert.equal(A.classOf({ form: 'biped', rig: 'none' }), null);
  assert.equal(A.classOf({ form: 'biped', rig: 'quadruped' }), 'quadruped');
  // the registry as shipped: the template bipeds are `biped` (the set waits for their re-rig), the four quadrupeds and the things are in
  for (const id of QUADS) assert.equal(A.classOf(M.entry(id)), 'quadruped', id);
  for (const id of ['toaster', 'shoe', 'teapot', 'cactus', 'cone', 'banana', 'mushroom', 'potato', 'duck']) assert.equal(A.classOf(M.entry(id)), 'object', id);
});

// ------------------------------------------------------------------ the sampler
test('keys: a loop wraps from the last key to the first, a one-shot holds its ends, splines pass through the keys', () => {
  const keys = [[0, 0], [0.25, 10], [0.5, 0], [0.75, -10]];
  for (const ease of ['linear', 'smooth', 'spline']) {
    for (const [t, v] of keys) assert.ok(Math.abs(A.evalKeys(keys, 1, t, true, ease)[0] - v) < 1e-9, `${ease} at ${t}`);
    const a = A.evalKeys(keys, 1, 0, true, ease)[0], z = A.evalKeys(keys, 1, 0.99999, true, ease)[0];
    assert.ok(Math.abs(a - z) < 0.01, `${ease}: the end of the loop meets its start (${a} ${z})`);
  }
  assert.ok(A.evalKeys(keys, 1, 0.875, true, 'linear')[0] === -5, 'between the last key and the first, a loop interpolates');
  assert.equal(A.evalKeys(keys, 1, 0.9, false, 'linear')[0], -10, 'a one-shot holds its last key');
  assert.equal(A.evalKeys([[0.2, 7], [0.8, 9]], 1, 0.05, false, 'linear')[0], 7, 'and its first');
  assert.equal(A.evalKeys([[0.5, 3]], 1, 0.9, true, 'spline')[0], 3, 'one key is a constant');
  const q = A.compile({ loop: true, seconds: 1, tracks: { Head: { rot: [[0, 0, 0, 0], [0.5, 0, 90, 0]] } } });
  const s = A.sampleClip(q, 0.5).get('Head');
  assert.ok(Math.abs(Math.hypot(...s.q) - 1) < 1e-9, 'a rotation is a unit quaternion');
  assert.ok(Math.abs(A.q.angle(s.q) - 90) < 1e-6, 'ry 90 is a quarter turn');
});

test('the Euler order is z, then x, then y (Babylon\'s yaw / pitch / roll), and a rotation is relative to the axes: x left, y up, z front', () => {
  const q = A.q.euler(30, 40, 50), b = B.Quaternion.RotationYawPitchRoll(40 * Math.PI / 180, 30 * Math.PI / 180, 50 * Math.PI / 180);
  const sign = q[3] * b.w < 0 ? -1 : 1;
  assert.ok(Math.abs(q[0] - sign * b.x) < 1e-6 && Math.abs(q[1] - sign * b.y) < 1e-6 && Math.abs(q[2] - sign * b.z) < 1e-6);
  const v = (x: number, y: number, z: number) => A.q.rot(A.q.euler(x, y, z), [0, -1, 0]).map((n: number) => Math.round(n * 100) / 100 + 0);
  assert.deepEqual(v(90, 0, 0), [0, 0, -1], 'rx > 0 swings a hanging limb back');
  assert.deepEqual(A.q.rot(A.q.euler(0, 90, 0), [0, 0, 1]).map((n: number) => Math.round(n) + 0), [1, 0, 0], 'ry > 0 turns the front toward x, the character\'s left');
  assert.deepEqual(A.q.rot(A.q.euler(0, 0, -90), [1, 0, 0]).map((n: number) => Math.round(n) + 0), [0, -1, 0], 'rz < 0 drops the left arm (along +x)');
});

test('clips are deltas on the rest pose: no clip is the rest, a delta composes with whatever rest the bone has, and bones a clip leaves out come back', () => {
  const b = A.bind(puppetRoots(), 'mixamo', { unit: 1.8 });
  const rest = Object.fromEntries(['LeftHand', 'RightFoot', 'Head'].map((n) => [n, at(b, n)]));
  // a bone that rests turned: a delta of nothing keeps it there
  const arm = b.bones.get('LeftArm');
  const turned = A.q.euler(0, 25, 0);
  arm.n.rotationQuaternion.set(...turned); arm.restQ = turned; arm.wrest = A.q.mul([0, 0, 0, 1], turned);
  const restTurned = at(b, 'LeftHand');
  A.apply(b, new Map([['LeftArm', { q: [0, 0, 0, 1], p: null, s: null }]]));
  assert.ok(restTurned.subtract(at(b, 'LeftHand')).length() < 1e-5, 'a zero delta leaves the rest where it is');
  // a delta turns it about the model's axes from there: rz -90 drops a hand that was along +x down, from wherever the shoulder is
  A.apply(b, new Map([['LeftArm', { q: A.q.euler(0, 0, -90), p: null, s: null }]]));
  const hand = at(b, 'LeftHand'), shoulder = at(b, 'LeftArm');
  assert.ok(hand.y < shoulder.y - 0.2, `the hand hangs below the shoulder (${hand.y.toFixed(2)} < ${shoulder.y.toFixed(2)})`);
  // a pose without the bone puts it back at rest
  A.apply(b, new Map([['Head', { q: A.q.euler(0, 40, 0), p: null, s: null }]]));
  assert.ok(restTurned.subtract(at(b, 'LeftHand')).length() < 1e-5, 'LeftArm is back at its rest once a pose leaves it out');
  assert.ok(rest.Head.subtract(at(b, 'Head')).length() < 1e-5, 'turning the head about its own joint does not move it');
});

test('rest-pose differences: a rig that rests in an A-pose reads the same clip as the T-pose rig (the limbs are measured), and `restFix: false` turns it off', () => {
  const idle = A.setOf('mixamo').clips.idle, pose = A.sampleClip(idle, 0.25);
  const t = A.bind(puppetRoots(), 'mixamo', { unit: 1.8 });
  A.apply(t, pose);
  const want = { hand: at(t, 'LeftHand'), rhand: at(t, 'RightHand'), foot: at(t, 'LeftFoot') };
  const aPose = (opts: any) => { // the same puppet, arms already down 40 degrees and a leg bent forward at rest
    const roots = puppetRoots();
    const find = (n: string) => { const s = [...roots]; while (s.length) { const x = s.shift(); if (x.name === `mixamorig:${n}`) return x; s.push(...x.getChildren(undefined, true)); } };
    find('LeftArm').rotationQuaternion = new B.Quaternion(...A.q.euler(0, 0, -40));
    find('RightArm').rotationQuaternion = new B.Quaternion(...A.q.euler(0, 0, 40));
    find('LeftUpLeg').rotationQuaternion = new B.Quaternion(...A.q.euler(-12, 0, 0));
    return A.bind(roots, 'mixamo', { unit: 1.8, ...opts });
  };
  const fixed = aPose({});
  assert.ok(A.q.angle(fixed.bones.get('LeftArm').fix) > 30, 'the left arm is measured 40 degrees off the T-pose');
  A.apply(fixed, pose);
  // (the fix puts each bone's direction at rest in the Mixamo place: the hand lands where the T-pose rig's does, to a few centimeters)
  const d = at(fixed, 'LeftHand').subtract(want.hand).length(), dr = at(fixed, 'RightHand').subtract(want.rhand).length();
  assert.ok(d < 0.05 && dr < 0.05, `hands within 5 cm of the T-pose rig's (${d.toFixed(3)} ${dr.toFixed(3)})`);
  const off = aPose({ restFix: false });
  A.apply(off, pose);
  assert.ok(at(off, 'LeftHand').subtract(want.hand).length() > 0.2, 'without the fix the arm is 40 degrees too low');
  // a row can set a bone's fix by hand (degrees): the rig's own number wins over the measuring
  const own = aPose({ restFix: { LeftArm: [0, 0, 40] } });
  assert.ok(Math.abs(A.q.angle(own.bones.get('LeftArm').fix) - 40) < 0.01);
});

test('the starter clips move the right limbs the right way (checked on the puppet and on the real dog\'s rest pose)', () => {
  const set = A.setOf('mixamo'), walk = set.clips.walk;
  const b = A.bind(puppetRoots(), 'mixamo', { unit: 1.8 });
  const feet = (u: number) => { A.apply(b, A.sampleClip(walk, u)); return { lf: at(b, 'LeftFoot'), rf: at(b, 'RightFoot'), lh: at(b, 'LeftHand'), rh: at(b, 'RightHand'), hips: at(b, 'Hips'), head: at(b, 'Head') }; };
  const a = feet(0), c = feet(0.5);
  assert.ok(a.lf.z > a.rf.z + 0.3, 'at the start the left foot is ahead of the right');
  assert.ok(c.rf.z > c.lf.z + 0.3, 'half a stride on, the right is ahead');
  assert.ok(a.lh.z < a.rh.z - 0.2 && c.rh.z < c.lh.z - 0.2, 'the arms swing against the legs');
  assert.ok(Math.abs(a.lf.x) > 0.05 && Math.abs(a.rf.x) > 0.05 && a.lf.x * a.rf.x < 0, 'the feet stay either side of the middle');
  for (const u of [0, 0.125, 0.25, 0.375, 0.5, 0.75]) { const f = feet(u); assert.ok(f.lf.y > 0.0 && f.rf.y > 0.0 && f.hips.y > 0.88 && f.hips.y < 1.0, `u ${u}: feet above the floor, hips within 6 cm of standing`); assert.ok(Math.abs(f.lh.x) > 0.2 && f.lh.y < f.hips.y + 0.1, 'hands hang beside the body'); }
  const idle = set.clips.idle;
  A.apply(b, A.sampleClip(idle, 0.3));
  assert.ok(at(b, 'LeftHand').y < at(b, 'Hips').y + 0.1 && at(b, 'LeftHand').y > 0.6, 'idle: the hands hang at the hips');

  // the real dog: its legs are turned 130 degrees at rest, and the clip still swings them front to back
  const dog = glbTree('dog');
  const q = A.bind([dog], 'quadruped', { unit: 1 });
  assert.ok(q.fit, 'the dog fits the quadruped class');
  const qs = A.setOf('quadruped').clips.walk;
  const tips = (u: number) => { A.apply(q, A.sampleClip(qs, u)); return { fl: at(q, 'LegFLTip'), fr: at(q, 'LegFRTip'), bl: at(q, 'LegBLTip'), br: at(q, 'LegBRTip'), body: at(q, 'Body') }; };
  A.apply(q, new Map());
  const t0 = tips(0.06), t5 = tips(0.56);
  assert.ok(t0.fl.z > t5.fl.z + 0.02 && t0.fr.z < t5.fr.z - 0.02, 'a third of the way in the left front leg is forward and the right is back; half a stride on, the other way');
  assert.ok(t0.br.z > t5.br.z + 0.02 && t0.bl.z < t5.bl.z - 0.02, 'the diagonal pairs: the right hind goes with the left front');
  assert.ok(Math.abs(t0.body.x) < 0.02 && t0.body.y > 0.3 && t0.body.y < 0.6, 'the body stays over the legs');
});

test('the object class: Body is the whole body, the clips keep volume, a walk hops and rolls', () => {
  const walk = A.setOf('object').clips.walk, idle = A.setOf('object').clips.idle;
  for (const [name, c] of [['walk', walk], ['idle', idle]] as const) for (let i = 0; i < 16; i++) {
    const s = A.sampleClip(c, i / 16).get('Body').s;
    assert.ok(Math.abs(s[0] * s[1] * s[2] - 1) < 0.01, `${name} ${i}/16: squash and stretch keeps volume (${(s[0] * s[1] * s[2]).toFixed(3)})`);
  }
  const lo = A.sampleClip(walk, 0).get('Body'), hi = A.sampleClip(walk, 0.25).get('Body');
  assert.ok(hi.p[1] > lo.p[1] + 0.02, 'a hop');
  assert.ok(hi.s[1] > lo.s[1], 'stretched in the air, squashed on landing');
  assert.ok(Math.abs(A.q.angle(A.sampleClip(walk, 0.25).get('Body').q)) > 5, 'a roll');
});

// ------------------------------------------------------------------ blending, one-shots, events
const loopClip = (name: string) => A.setOf('mixamo').clips[name];
test('blends: a new loop fades in over 0.15 s while the old one fades out, then the old one is gone', () => {
  const pl = new A.Player(A.setOf('mixamo'));
  pl.update(0.1, { name: 'idle', rate: 1 }, null);
  assert.equal(pl.loops.length, 1);
  pl.update(1 / 60, { name: 'walk', rate: 1 }, null);
  assert.equal(pl.loops.length, 2, 'both are playing while they cross');
  const w = () => pl.loops.map((l: any) => +l.w.toFixed(3));
  let t = 1 / 60;
  while (t < 0.07) { pl.update(1 / 60, { name: 'walk', rate: 1 }, null); t += 1 / 60; }
  const [old, nw] = w();
  assert.ok(old > 0.3 && old < 0.7 && nw > 0.3 && nw < 0.7, `half way through they are about half each (${old} ${nw})`);
  // the pose between: the hip swing is between idle's and walk's
  const mid = A.q.angle(pl.pose().get('LeftUpLeg').q);
  assert.ok(mid > 3 && mid < 22, `the thigh is part way (${mid.toFixed(1)} degrees)`);
  while (t < A.FADE + 0.05) { pl.update(1 / 60, { name: 'walk', rate: 1 }, null); t += 1 / 60; }
  assert.equal(pl.loops.length, 1, 'idle is gone after the fade');
  assert.equal(pl.loops[0].name, 'walk');
  assert.equal(A.FADE, 0.15);
});

test('one-shots play over loops on the bones they name, and leave', () => {
  const set = A.setData('mixamo', { ...FILES.mixamo, clips: { ...FILES.mixamo.clips, wave: { loop: false, seconds: 1.0, ease: 'smooth', tracks: { RightArm: { rot: [[0, 0, 0, ARMDOWN], [0.3, 0, 0, -20], [1, 0, 0, ARMDOWN]] }, RightForeArm: { rot: [[0, 0, 0, 0], [0.3, 0, -70, 0], [1, 0, 0, 0]] } } } } });
  void set;
  const pl = new A.Player(A.setOf('mixamo'));
  const key = {};
  for (let i = 0; i < 20; i++) pl.update(1 / 60, { name: 'walk', rate: 1 }, null);
  const legBefore = A.q.angle(pl.pose().get('LeftUpLeg').q);
  const armWalk = pl.pose().get('RightArm').q;
  for (let i = 0; i < 30; i++) pl.update(1 / 60, { name: 'walk', rate: 1 }, { key, name: 'wave' });
  assert.equal(pl.shots.length, 1);
  assert.ok(pl.shots[0].w > 0.99, 'the shot is fully in after the fade');
  const arm = pl.pose().get('RightArm').q;
  assert.ok(A.q.angle(A.q.mul(arm, A.q.inv(armWalk))) > 15, 'the right arm is waving, not swinging');
  assert.ok(pl.pose().has('LeftUpLeg') && A.q.angle(pl.pose().get('LeftUpLeg').q) > 0, 'the legs go on walking under it');
  void legBefore;
  for (let i = 0; i < 90; i++) pl.update(1 / 60, { name: 'walk', rate: 1 }, null);
  assert.equal(pl.shots.length, 0, 'and it is gone once the emote has ended');
  // an unfinished one-shot is let go when the emote ends
  const p2 = new A.Player(A.setOf('mixamo'));
  for (let i = 0; i < 10; i++) p2.update(1 / 60, { name: 'idle', rate: 1 }, { key, name: 'wave' });
  for (let i = 0; i < 12; i++) p2.update(1 / 60, { name: 'idle', rate: 1 }, null);
  assert.equal(p2.shots.length, 0);
});
const ARMDOWN = 76;

test('events fire once as the clip passes them: two footsteps in a walk cycle, a loop\'s wrap included', () => {
  const pl = new A.Player(A.setOf('mixamo'));
  const seen: string[] = [];
  for (let i = 0; i < 180; i++) pl.update(1 / 60, { name: 'walk', rate: 1 }, null, (ev: any) => seen.push(`${ev.name}:${ev.foot}`));
  assert.equal(seen.length, 6, 'three seconds of walk: six steps');
  assert.deepEqual(seen.slice(0, 4), ['footstep:R', 'footstep:L', 'footstep:R', 'footstep:L'], 'right at half a cycle, then left as it wraps: alternating');
  const count = (rate: number) => { const p = new A.Player(A.setOf('mixamo')); let n = 0; for (let i = 0; i < 90; i++) p.update(1 / 60, { name: 'walk', rate }, null, () => n++); return n; };
  assert.ok(count(2) >= count(1) + 2, `a faster stride gives more steps in the same time (${count(1)} then ${count(2)})`);
  assert.ok(Array.isArray(A.setOf('object').clips.walk.events) && A.setOf('object').clips.walk.events.some((e: any) => e.name === 'hop'), 'a thing\'s walk has hops');
  const heard: any[] = []; const off = A.on((name: string, rig: any, ev: any) => heard.push([name, ev.clip])); off();
  assert.deepEqual(heard, []);
});

// ------------------------------------------------------------------ on a rig (presence-models.js)
const registryRows = () => JSON.parse(JSON.stringify(registryBefore));
function register(rows: Record<string, any>, sync = false) {
  P.modelRegistry = registryRows();
  for (const [id, row] of Object.entries(rows)) M.register(id, row);
  M.setLoader((sc: any, url: string) => { const c = toContainer(B, sc, url.startsWith('mixamo:') ? mixamoPuppet(url.slice(7) || '') : specOf(url)); return sync ? c : Promise.resolve(c); });
  M.reset();
}
function stand(id: string, o: any = {}) {
  const node = new B.TransformNode('stand', scene);
  const e: any = { node, x: 0, y: 0.9, z: 0, alive: true };
  const w = C.WHAT.get(id);
  const look = C.cleanLook({ what: id, body: w.colors[0], accent: w.colors[1], head: w.colors[2], face: 'eyes' });
  return { e, node, rig: P.showcase.make(e, look, look.body) };
}
function run(t: any, seconds: number, speed = 0, em: any = null) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    t.e.x += speed / 60;
    if (em && !t.rig.emote) t.rig.emote = { def: em, t0: t.rig.time || 0 };
    P.showcase.animate(t.rig, 1 / 60);
  }
}
const rowFor = (prefix: string, extra: any = {}) => ({ ...mixamoPuppet(prefix).row, url: `mixamo:${prefix}`, lods: null, low: null, clips: {}, yaw: 0, ...extra });
const node = (rig: any, name: string) => { const s = [...rig.pm.cur.roots]; while (s.length) { const x = s.shift(); if (x.name === name) return x; s.push(...x.getChildren(undefined, true)); } return null; };

test('a Mixamo-rigged model walks from the data: its bones turn by the walk clip, the footsteps are told, the procedural gait is off', async () => {
  register({ person: rowFor('mixamorig:') });
  const t = stand('person');
  await M.ready(t.rig);
  assert.ok(t.rig.pm.on);
  const steps: string[] = [];
  const off = A.on((name: string, rig: any, ev: any) => { if (rig === t.rig) steps.push(ev.foot); });
  run(t, 0.5, 0);
  const idleLeg = A.q.angle([node(t.rig, 'mixamorig:LeftUpLeg').rotationQuaternion.x, node(t.rig, 'mixamorig:LeftUpLeg').rotationQuaternion.y, node(t.rig, 'mixamorig:LeftUpLeg').rotationQuaternion.z, node(t.rig, 'mixamorig:LeftUpLeg').rotationQuaternion.w]);
  assert.ok(idleLeg < 1, 'standing: the thigh rests');
  run(t, 1.5, 1.6);
  off();
  const lq = node(t.rig, 'mixamorig:LeftUpLeg').rotationQuaternion;
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) { run(t, 1 / 40, 1.6); seen.add(lq.x.toFixed(2)); }
  assert.ok(seen.size > 8, 'the thigh swings through many angles');
  assert.ok(steps.length >= 2 && steps.includes('L') && steps.includes('R'), `footsteps told: ${steps.join(',')}`);
  assert.ok(Math.abs(t.rig.pm.mover.rotation.x) < 0.05 && Math.abs(t.rig.pm.mover.rotation.z) < 0.05, 'no procedural lean or sway on top of the clip');
  assert.equal(A.info(t.rig).state, 'ready');
  // a walk that stops goes back to the idle through a blend
  run(t, 0.5, 0);
  assert.ok(t.rig.pm.anim.player.loops.every((l: any) => l.name === 'idle'));
  P.showcase.dispose(t.rig); t.node.dispose();
});

test('emotes the set has play over the loop; those it lacks fall to the procedural body motion', async () => {
  register({ person: rowFor('mixamorig:') });
  const t = stand('person');
  await M.ready(t.rig);
  A.setData('mixamo', { ...FILES.mixamo, clips: { ...FILES.mixamo.clips, wave: { loop: false, seconds: 1.0, ease: 'smooth', tracks: { RightArm: { rot: [[0, 0, 0, ARMDOWN], [0.3, 0, 0, -20], [1, 0, 0, ARMDOWN]] } } } } });
  run(t, 0.3, 0);
  const rq = node(t.rig, 'mixamorig:RightArm').rotationQuaternion;
  const before = A.q.angle([rq.x, rq.y, rq.z, rq.w]);
  run(t, 0.6, 0, C.emote('wave'));
  const during = A.q.angle([rq.x, rq.y, rq.z, rq.w]);
  assert.ok(Math.abs(during - before) > 20, `the right arm moved for the wave (${before.toFixed(0)} to ${during.toFixed(0)})`);
  t.rig.emote = null; run(t, 0.5, 0);
  // an emote the set has no clip for: the body's own motion (presence-models.js bodyEmote) moves the whole model
  const y0 = t.rig.pm.mover.position.y;
  run(t, 1.0, 0, C.emote('cheer'));
  assert.ok(t.rig.pm.mover.position.y !== y0 || t.rig.pm.mover.scaling.y !== 1, 'cheer has no clip: the procedural motion bounces the body');
  A.setData('mixamo', FILES.mixamo);
  P.showcase.dispose(t.rig); t.node.dispose();
});

test('a role the set lacks keeps the model\'s own clip, then the procedural motion', async () => {
  const spec = mixamoPuppet('mixamorig:');
  spec.clips = [{ name: 'Jump', tracks: [{ node: 'mixamorig:LeftUpLeg', axis: 'x', keys: [[0, 0], [0.4, -0.8], [0.8, 0]] }] }];
  STANDINS.mixamoJump = spec;
  const loader = (sc: any, url: string) => Promise.resolve(toContainer(B, sc, STANDINS[url.slice(4)] || specOf(url)));
  P.modelRegistry = registryRows(); M.register('person', { ...spec.row, url: 'own:mixamoJump', lods: null, low: null, clips: { jump: 'Jump' }, yaw: 0 });
  M.setLoader(loader); M.reset();
  const t = stand('person');
  await M.ready(t.rig);
  // in the air, rising: the set has no jump or fall, so the model's own Jump clip plays
  t.e.grounded = false; t.e.vy = 6;
  run(t, 0.4, 0);
  const lvl = t.rig.pm.cur;
  const g = lvl.groups.find((x: any) => x.name === 'Jump');
  assert.ok(g && lvl.playing.has(g) && lvl.w.get(g) > 0.3, 'the model\'s Jump clip plays for a role the set lacks');
  assert.equal(t.rig.pm.anim.player.loops.length, 0, 'and the set plays nothing');
  // swimming: neither the set nor the model has a clip: the procedural lean of a swimming biped
  t.e.grounded = true; t.e.vy = 0; t.rig.forcePose = 'swim';
  run(t, 0.5, 0);
  assert.ok(t.rig.pm.mover.rotation.x > 1, `procedural swim: the body lies forward (${t.rig.pm.mover.rotation.x.toFixed(2)})`);
  delete STANDINS.mixamoJump;
  P.showcase.dispose(t.rig); t.node.dispose();
});

test('a biped that still has the old 11-joint template rig does not fit the Mixamo set and keeps animating by its own clips', async () => {
  register({ person: standinRows().person });
  const t = stand('person');
  await M.ready(t.rig);
  run(t, 0.3, 0);
  assert.equal(A.info(t.rig).state, 'unfit', 'the set does not fit a template rig');
  assert.ok(A.info(t.rig).missing.includes('LeftArm'));
  run(t, 1.2, 2.2);
  const lvl = t.rig.pm.cur, walkGroup = lvl.groups.find((x: any) => x.name === 'Walk');
  assert.ok(lvl.w.get(walkGroup) > 0.9 && lvl.playing.has(walkGroup), 'its own Walk clip plays, as before the sets');
  assert.equal(t.rig.pm.anim.player, null, 'the data player was never started');
  P.showcase.dispose(t.rig); t.node.dispose();
});

test('a thing takes the object set: its whole body hops and rolls from the clip, the other forms keep theirs', async () => {
  register({ toaster: { ...standinRows().toaster, rig: 'object' }, fish: { ...standinRows().fish } });
  const t = stand('toaster');
  await M.ready(t.rig);
  const mv = t.rig.pm.mover;
  const ys = new Set<string>(), rs = new Set<string>();
  run(t, 0.2, 0);
  for (let i = 0; i < 60; i++) { run(t, 1 / 60, 1.6); ys.add(mv.position.y.toFixed(3)); rs.add(mv.rotation.z.toFixed(3)); }
  assert.ok(ys.size > 8 && rs.size > 8, 'it hops and rolls');
  assert.ok(Math.max(...[...rs].map((x) => Math.abs(Number(x)))) > 0.08, 'the roll reaches ~8 degrees');
  assert.equal(A.info(t.rig).cls, 'object');
  const f = stand('fish');
  await M.ready(f.rig);
  assert.equal(A.classOf(M.entry('fish')), 'object');
  assert.ok(f.rig.pm.anim && !A.has(f.rig, 'swim') && !A.has(f.rig, 'walk') && A.has(f.rig, 'idle') && A.has(f.rig, 'hurt'), 'a swimmer takes the set for idle, emotes and hurt only: its swim stays its own (keepGait)');
  P.showcase.dispose(t.rig); t.node.dispose(); P.showcase.dispose(f.rig); f.node.dispose();
});

test('/avatars: any clip of a set is drawn at the moment asked for, from the data', async () => {
  register({ person: rowFor('mixamorig:'), toaster: { ...standinRows().toaster, rig: 'object' } });
  const p = stand('person'); await M.ready(p.rig);
  const q = (u: number) => { p.rig.forceClip = { name: 'walk', t: u * 1.0 }; P.showcase.animate(p.rig, 1 / 60); const n = node(p.rig, 'mixamorig:LeftUpLeg').rotationQuaternion; return [n.x, n.y, n.z, n.w]; };
  const a = q(0), b = q(0.5), a2 = q(0);
  assert.ok(A.q.angle(A.q.mul(a, A.q.inv(b))) > 30, 'half a second into the walk is another pose than the start');
  assert.deepEqual(a.map((n: number) => +n.toFixed(6)), a2.map((n: number) => +n.toFixed(6)), 'the same moment is the same pose, whatever came before');
  assert.ok(A.has(p.rig, 'walk') && !A.has(p.rig, 'nope'));
  p.rig.forceClip = { name: 'walk', t: 1.5 };
  P.showcase.animate(p.rig, 1 / 60);
  const w = node(p.rig, 'mixamorig:LeftUpLeg').rotationQuaternion; assert.ok(A.q.angle(A.q.mul(b, A.q.inv([w.x, w.y, w.z, w.w]))) < 1, 'a loop repeats: 1.5 s is 0.5 s');
  const o = stand('toaster'); await M.ready(o.rig);
  o.rig.forceClip = { name: 'walk', t: 0.25 }; P.showcase.animate(o.rig, 1 / 60);
  const hi = o.rig.pm.mover.position.y; o.rig.forceClip = { name: 'walk', t: 0 }; P.showcase.animate(o.rig, 1 / 60);
  assert.ok(hi > o.rig.pm.mover.position.y + 0.02, 'the object class draws the hop at 0.25');
  const js = fs.readFileSync(path.join(ROOT, 'public', 'avatars.js'), 'utf8');
  assert.ok(js.includes('forceClip') && js.includes("standin=mixamo") && js.includes('anim.load'), 'the page asks for clips by name, loads the sets and has the Mixamo stand-in');
  P.showcase.dispose(p.rig); p.node.dispose(); P.showcase.dispose(o.rig); o.node.dispose();
});

// ------------------------------------------------------------------ the phone budget
test('ten animating characters stay inside the phone budget (draws, triangles, the frame, and only ten in full)', async () => {
  register({ person: rowFor('mixamorig:') }, true);
  const randomLook = C.randomLook;
  C.randomLook = (seed: number) => ({ ...randomLook(seed), what: 'person' });
  try {
    const row = measureCrowd(H, '10 on the Mixamo set', 10);
    const rigs = [...P._internal.rigs.values()];
    assert.equal(rigs.length, 10);
    assert.ok(rigs.every((r: any) => r.pm && r.pm.on && r.pm.anim), 'every body is a model with the set');
    assert.ok(rigs.some((r: any) => r.pm.anim.state !== 'unfit' && r.pm.anim.player), 'the set is playing');
    assert.ok(row.frameMs <= 33, `${row.frameMs.toFixed(2)} ms a frame`);
    assert.equal(row.full, 10);
    // (the stand-in is 26 boxes a body, so its own draws are not the phone's 110: the data adds none, which is what is held)
    A.reset();
    const without = measureCrowd(H, '10 without the set', 10);
    for (const [cls, f] of Object.entries(FILES)) A.setData(cls, f);
    assert.equal(row.draws, without.draws, `the clips add no draw calls (${row.draws})`);
    assert.equal(row.triangles, without.triangles, 'and no triangles');
    console.log(`ten characters: ${row.draws} draws ${row.triangles} tris ${row.frameMs.toFixed(2)} ms a frame with the set, ${without.frameMs.toFixed(2)} ms without`);
  } finally { C.randomLook = randomLook; }
  // the sampler itself: ten walking characters, one frame each, in a tenth of a frame at 60 fps (Node, loose)
  const crowd = Array.from({ length: 10 }, () => stand('person'));
  for (const t of crowd) await M.ready(t.rig);
  for (const t of crowd) run(t, 0.3, 1.6);
  const t0 = performance.now();
  const frames = 120;
  for (let i = 0; i < frames; i++) for (const t of crowd) { t.e.x += 1.6 / 60; P.showcase.animate(t.rig, 1 / 60); }
  const ms = (performance.now() - t0) / frames;
  console.log(`ten walking characters on the Mixamo set: ${ms.toFixed(3)} ms of animation a frame (Node)`);
  assert.ok(ms < 4, `ten characters animate in ${ms.toFixed(2)} ms a frame (budget for animation: a quarter of a 33 ms frame at 30 fps is 8 ms)`);
  for (const t of crowd) { P.showcase.dispose(t.rig); t.node.dispose(); }
});

test('the sets load from /play/anim/<class>.json: one fetch a class, a failure leaves the model as it was', async () => {
  A.reset();
  const urls: string[] = [];
  const got = await Promise.all([A.load('quadruped', async (c: string) => { urls.push(c); return FILES.quadruped; }), A.load('quadruped', async (c: string) => { urls.push(c); return FILES.quadruped; })]);
  assert.equal(urls.length, 1, 'one fetch');
  assert.ok(got[0] && got[0].names.includes('walk'));
  assert.equal(await A.load('object', async () => { throw new Error('404'); }), null, 'a failed file resolves to nothing');
  assert.equal(A.setOf('object'), null);
  for (const [cls, f] of Object.entries(FILES)) A.setData(cls, f);
  // the file is served with the right type and open CORS (the play page has no origin)
  const server = fs.readFileSync(path.join(ROOT, 'src', 'server.ts'), 'utf8');
  assert.ok(server.includes("'.json': 'application/json") && server.includes("route.startsWith('/play/anim/')"));
  const mod = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'play', 'modules', 'presence', 'module.json'), 'utf8'));
  assert.ok(mod.scripts.indexOf('presence-anim.js') > -1 && mod.scripts.indexOf('presence-anim.js') < mod.scripts.indexOf('presence-models.js'), 'registered in module.json before presence-models.js');
});

test('the docs say how it works: the format, the rest-pose handling, the registry field', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'animations.md'), 'utf8');
  for (const f of ['mixamorig:', 'presence-anim.js', 'restFix', 'delta', '0.15', 'rig:', '/avatars?body=', 'quadruped.json', 'object.json']) assert.ok(doc.includes(f), `animations.md: ${f}`);
  const chars = fs.readFileSync(path.join(ROOT, 'docs', 'characters.md'), 'utf8');
  assert.ok(chars.includes('Mixamo') && chars.includes('`rig`'), 'characters.md names the Mixamo skeleton and the registry `rig` field');
  const eng = fs.readFileSync(path.join(ROOT, 'docs', 'engine-modules.md'), 'utf8');
  assert.ok(eng.includes('presence-anim.js') && eng.includes('P.anim'), 'engine-modules.md');
  void STANDIN_FOR; void loopClip;
});

// ------------------------------------------------------------------ the quadruped set (docs/animations.md 2B)
// name -> [loops, seconds] as the table lists them
const QUAD_SET: Record<string, [boolean, number]> = {
  idle: [true, 3], idle_sniff: [true, 3], idle_fidget: [false, 2], walk: [true, 1], trot: [true, 0.7], run: [true, 0.5],
  jump_start: [false, 0.25], jump: [true, 0.7], land: [false, 0.3], fall: [true, 0.9], swim: [true, 0.9], sit: [true, 4],
  lie_down: [false, 0.8], sleep: [true, 4], drive: [true, 2], wave: [false, 1.6], dance: [true, 2.4], cheer: [false, 1.4],
  laugh: [false, 1.6], point: [false, 1.2], clap: [false, 1.6], thumbsup: [false, 1.2], heart: [false, 1.6], bark: [false, 0.8],
  shake_off: [false, 1.2], shrug: [false, 1.2], hurt: [false, 0.5], knock_down: [false, 0.9], get_up: [false, 1.0],
};
const quadSet = () => A.setOf('quadruped');
/** The playing rotation of a bone in a clip at u, as an angle from rest (degrees). */
const turnOf = (clip: any, bone: string, u: number) => { const v = A.sampleClip(clip, u).get(bone); return v && v.q ? A.q.angle(v.q) : 0; };
const rxOf = (clip: any, bone: string, u: number) => { const v = A.sampleClip(clip, u).get(bone); if (!v || !v.q) return 0; const [x, , , w] = v.q; return 2 * Math.atan2(x, w) * 180 / Math.PI; };
const corr = (a: number[], b: number[]) => { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let ab = 0, aa = 0, bb = 0; for (let i = 0; i < n; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; } return ab / Math.sqrt(aa * bb || 1); };
const ticks = Array.from({ length: 48 }, (_, i) => i / 48);

test('the quadruped set has every clip of the table, with its loop flag and length, and the file is sound', () => {
  const have = Object.keys(FILES.quadruped.clips).sort(), want = Object.keys(QUAD_SET).sort();
  assert.deepEqual(have, want, 'exactly the 29 clips of docs/animations.md 2B');
  for (const [name, [loop, seconds]] of Object.entries(QUAD_SET)) {
    const c = FILES.quadruped.clips[name];
    assert.equal(c.loop, loop, `${name}: loop`);
    assert.ok(Math.abs(c.seconds - seconds) < 1e-9, `${name}: ${seconds} s`);
  }
  assert.deepEqual(A.setOf('quadruped').problems, [], 'no problems in the file');
  assert.ok(fs.statSync(path.join(ROOT, 'public/play/anim/quadruped.json')).size < 160000, 'the class file stays small (one fetch a class)');
});

test('quadruped loops close: the last frame runs into the first, and a one-shot that ends at rest ends there', () => {
  for (const [name, [loop]] of Object.entries(QUAD_SET)) {
    const c = quadSet().clips[name];
    if (loop) {
      for (const tr of c.tracks) {
        const a = A.sampleClip({ ...c, tracks: [tr] }, 0).get(tr.bone), b = A.sampleClip({ ...c, tracks: [tr] }, 0.9999).get(tr.bone);
        if (a.q) assert.ok(A.q.angle(A.q.mul(a.q, A.q.inv(b.q))) < 2, `${name}.${tr.bone}: the turn closes`);
        for (const k of ['p', 's'] as const) if (a[k]) a[k].forEach((x: number, i: number) => assert.ok(Math.abs(x - b[k][i]) < 0.01, `${name}.${tr.bone}.${k}: closes`));
      }
    }
  }
  // the emotes and the takes that come back to standing (the rest of the one-shots end lying, up in the air or on the move)
  for (const name of ['land', 'wave', 'cheer', 'laugh', 'point', 'clap', 'thumbsup', 'heart', 'bark', 'shake_off', 'shrug', 'hurt', 'get_up', 'idle_fidget']) {
    const c = quadSet().clips[name];
    for (const tr of c.tracks) {
      const v = A.sampleClip({ ...c, tracks: [tr] }, 1).get(tr.bone);
      if (v.q) assert.ok(A.q.angle(v.q) < 1.5, `${name}.${tr.bone}: ends at rest (${A.q.angle(v.q).toFixed(2)} degrees)`);
      if (v.p) v.p.forEach((x: number) => assert.ok(Math.abs(x) < 0.004, `${name}.${tr.bone}: ends in place`));
      if (v.s) v.s.forEach((x: number) => assert.ok(Math.abs(x - 1) < 0.004, `${name}.${tr.bone}: ends at its size`));
    }
  }
  // lying down ends where sleep starts, and getting up starts where the knock-down ends
  const near = (a: string, ua: number, b: string, ub: number, tol = 4) => { const A1 = A.sampleClip(quadSet().clips[a], ua), B1 = A.sampleClip(quadSet().clips[b], ub); for (const bone of new Set([...A1.keys(), ...B1.keys()])) { const x = (A1.get(bone) || { q: [0, 0, 0, 1] }).q, y = (B1.get(bone) || { q: [0, 0, 0, 1] }).q; if (x && y && /^Leg|^Root|^Body/.test(bone)) assert.ok(A.q.angle(A.q.mul(x, A.q.inv(y))) < tol, `${a} to ${b}: ${bone} is where the next clip starts`); } };
  near('lie_down', 1, 'sleep', 0, 14);
  near('knock_down', 1, 'get_up', 0, 6);
});

test('quadruped clips keep volume when they squash and stretch', () => {
  for (const name of Object.keys(QUAD_SET)) for (const u of ticks) for (const [bone, v] of A.sampleClip(quadSet().clips[name], u)) if (v.s) {
    const vol = v.s[0] * v.s[1] * v.s[2];
    assert.ok(Math.abs(vol - 1) < 0.015, `${name} ${bone} at ${u.toFixed(2)}: volume ${vol.toFixed(3)}`);
    assert.ok(v.s.every((x: number) => x > 0.8 && x < 1.2), `${name} ${bone}: a believable squash`);
  }
});

test('the gaits: a walk and a trot are diagonal pairs, a run is a gallop (the hind pair against the front pair, the back stretching 1.1)', () => {
  const seq = (name: string, bone: string) => ticks.map((u) => rxOf(quadSet().clips[name], bone, u));
  const lag = (a: number, b: number) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };
  for (const name of ['walk', 'trot']) {
    const c = quadSet().clips[name], when = Object.fromEntries(c.events.map((e: any) => [e.foot, e.t]));
    assert.ok(lag(when.FL, when.BR) <= 0.15 && lag(when.FR, when.BL) <= 0.15, `${name}: the left front lands with the right hind, the right front with the left hind (${JSON.stringify(when)})`);
    assert.ok(Math.abs(lag(when.FL, when.FR) - 0.5) < 0.05 && Math.abs(lag(when.BL, when.BR) - 0.5) < 0.05, `${name}: the two sides take turns, half a cycle apart`);
    const FL = seq(name, 'LegFL');
    assert.ok(Math.max(...FL) - Math.min(...FL) > 18, `${name}: the legs really swing (${(Math.max(...FL) - Math.min(...FL)).toFixed(0)} degrees)`);
    assert.equal(c.loop, true);
  }
  const trotWhen = Object.fromEntries(quadSet().clips.trot.events.map((e: any) => [e.foot, e.t])), walkWhen = Object.fromEntries(quadSet().clips.walk.events.map((e: any) => [e.foot, e.t]));
  assert.ok(lag(trotWhen.FL, trotWhen.BR) < 0.03, 'a trot lands the pair together');
  assert.ok(lag(walkWhen.FL, walkWhen.BR) > 0.08, 'a walk lets the hind foot follow the front one (four beats)');
  const run = quadSet().clips.run, front = seq('run', 'LegFL'), hind = seq('run', 'LegBL');
  assert.ok(corr(front, hind) < -0.7, `a gallop: the front pair reaches while the hind pair pushes (${corr(front, hind).toFixed(2)})`);
  assert.ok(corr(seq('run', 'LegFL'), seq('run', 'LegFR')) > 0.9 && corr(seq('run', 'LegBL'), seq('run', 'LegBR')) > 0.9, 'the pairs bound together');
  assert.ok(Math.max(...front) - Math.min(...front) > 50 && Math.max(...hind) - Math.min(...hind) > 50, 'a big stride');
  const sz = ticks.map((u) => A.sampleClip(run, u).get('Body').s[2]);
  assert.ok(Math.max(...sz) >= 1.095 && Math.max(...sz) <= 1.11 && Math.min(...sz) < 1, `the back stretches 1.1 (${Math.max(...sz).toFixed(3)}) and gathers`);
  const ry = ticks.map((u) => A.sampleClip(run, u).get('Root').p[1]);
  assert.ok(Math.max(...ry) - Math.min(...ry) > 0.05, 'the whole body rises and falls in the flights');
  // the cycle's own times: walk 1.0, trot 0.7, run 0.5 seconds, and a faster gait is a shorter cycle
  assert.ok(quadSet().clips.walk.seconds > quadSet().clips.trot.seconds && quadSet().clips.trot.seconds > run.seconds);
});

test('footsteps: four a cycle on the walk, the trot and the run, one for each foot, at the moment it lands', () => {
  for (const name of ['walk', 'trot', 'run']) {
    const ev = quadSet().clips[name].events;
    assert.equal(ev.length, 4, `${name}: four footsteps`);
    assert.ok(ev.every((e: any) => e.name === 'footstep'), `${name}: they are footsteps`);
    assert.deepEqual(ev.map((e: any) => e.foot).sort(), ['BL', 'BR', 'FL', 'FR'], `${name}: each foot once`);
  }
  // the walk's foot is forward (landing) when its step is told: its leg is at the front of its swing
  const walk = quadSet().clips.walk;
  for (const e of walk.events) {
    const bone = `Leg${e.foot}`, now = rxOf(walk, bone, e.t), later = rxOf(walk, bone, (e.t + 0.2) % 1);
    assert.ok(later > now + 2, `${e.foot} is carried back once it lands (${now.toFixed(1)} then ${later.toFixed(1)} degrees)`);
  }
  const seen: string[] = []; const pl = new A.Player(quadSet());
  for (let i = 0; i < 120; i++) pl.update(1 / 60, { name: 'trot', rate: 1 }, null, (ev: any) => seen.push(ev.foot));
  assert.ok(seen.length >= 4 * Math.floor(2 / 0.7) - 1, `two seconds of trot tell ${seen.length} footsteps`);
});

for (const id of QUADS) {
  test(`${id}: every clip of the quadruped set binds to its bones and plays without breaking the body`, () => {
    const model = glbTree(id), b = A.bind([model], 'quadruped', { unit: 1 });
    assert.ok(b.fit, `${id} fits the class`);
    const rest = new Map<string, number[]>();
    A.apply(b, new Map());
    for (const n of b.bones.keys()) rest.set(n, at(b, n).asArray());
    const height = Math.max(...[...rest.values()].map((p) => p[1])) * 1.3;
    for (const [name, c] of Object.entries<any>(quadSet().clips)) {
      for (const tr of c.tracks) assert.ok(b.bones.has(tr.bone), `${id}: ${name} names ${tr.bone}: the model has it`);
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        A.apply(b, A.sampleClip(c, Math.min(u, 0.9999)));
        for (const n of b.bones.keys()) {
          const p = at(b, n).asArray();
          assert.ok(p.every(Number.isFinite), `${id} ${name} ${u}: ${n} is a place`);
          assert.ok(Math.hypot(p[0] - rest.get(n)![0], p[1] - rest.get(n)![1], p[2] - rest.get(n)![2]) < height * 1.6, `${id} ${name} ${u}: ${n} stays with the body (${p.map((x: number) => x.toFixed(2)).join(',')})`);
        }
        // the head is never inside the ground and the feet never past the middle of the body
        assert.ok(at(b, 'Head').y > 0.05, `${id} ${name} ${u}: the head is up`);
      }
    }
    A.apply(b, new Map());
    model.dispose();
  });
}

test('the dog plays every role from the set: walk, trot and run by speed, jump, fall, swim, drive, and sit and sleep as emotes', () => {
  const dog = glbTree('dog');
  const pm: any = { ent: { rig: 'quadruped', form: 'quadruped', h: 0.95, stride: { walk: 0.95, trot: 1.9, run: 3.23 } }, k: 1, anim: { cls: 'quadruped', player: null, binds: new Map(), state: 'loading', events: [] } };
  const lvl = { roots: [dog] };
  const rig: any = {};
  const play = (role: string, speed = 0, em: any = null, seconds = 0.6) => {
    let out: any = null;
    for (let i = 0; i < seconds * 60; i++) out = A.drive(rig, pm, lvl, { dt: 1 / 60, role, em, speed, glb: false, glbEmote: false, took: false, landed: false, stride: pm.ent.stride });
    const top = pm.anim.player.loops[pm.anim.player.loops.length - 1];
    return { out, loop: top && top.name, rate: top && top.rate, shot: pm.anim.player.shots.map((s: any) => s.name) };
  };
  assert.equal(play('idle').loop, 'idle');
  assert.equal(play('walk', 1.4).loop, 'walk', 'a walking pace walks');
  assert.equal(play('walk', 3.0).loop, 'trot', 'a quicker one trots');
  assert.equal(play('run', 6).loop, 'run');
  assert.equal(play('jump', 2).loop, 'jump');
  assert.equal(play('fall', 2).loop, 'fall');
  assert.equal(play('swim', 1).loop, 'swim');
  assert.equal(play('drive', 0).loop, 'drive');
  assert.ok(play('walk', 3.0).rate > 0.4 && play('walk', 3.0).rate <= 2.5, 'the cycle follows the speed');
  for (const name of ['sit', 'sleep', 'wave', 'dance', 'cheer', 'laugh', 'point', 'clap', 'thumbsup', 'heart', 'shrug']) {
    const r = play('idle', 0, { def: { name } }, 0.5);
    assert.ok(r.out && r.out.driven && r.out.emote, `${name}: played from the set as an emote`);
    assert.ok(r.shot.includes(name), `${name}: a one-shot (or a held loop) over the idle`);
    play('idle', 0, null, 0.5);
  }
  // it moves its bones: a sit sits (the hind legs fold forward), a walk swings the legs
  A.apply(pm.anim.binds.get(lvl), new Map());
  play('idle', 0, { def: { name: 'sit' } }, 0.8);
  const b = pm.anim.binds.get(lvl);
  assert.ok(at(b, 'LegBLTip').z > at(b, 'LegBL').z + 0.02 || Math.abs(at(b, 'LegBL').y - 0.4) > 0.02, 'the sit moved the hind legs');
  dog.dispose();
});

test('standing still, the dog now and then sniffs (a loop of three seconds) or fidgets (a one-shot), and a step cancels it', () => {
  const dog = glbTree('dog');
  const pm: any = { ent: { rig: 'quadruped', form: 'quadruped', h: 0.95, stride: { walk: 0.95, trot: 1.9, run: 3.23 } }, k: 1, anim: { cls: 'quadruped', player: null, binds: new Map(), state: 'loading', events: [] } };
  const lvl = { roots: [dog] }, rig: any = {};
  const names = new Set<string>();
  const step = (role: string, speed = 0) => { A.drive(rig, pm, lvl, { dt: 0.05, role, em: null, speed, glb: false, glbEmote: false, took: false, landed: false, stride: pm.ent.stride }); for (const L of pm.anim.player.loops) names.add(L.name); for (const S of pm.anim.player.shots) names.add(S.name); };
  const real = Math.random; let n = 12345; Math.random = () => { n = (Math.imul(n, 1103515245) + 12345) >>> 0; return (n >>> 8) / 16777216; }; // (waits and picks that vary)
  try { for (let i = 0; i < 60 * 20 * 3; i++) step('idle'); } finally { Math.random = real; }
  assert.ok(names.has('idle_sniff') && names.has('idle_fidget'), `both idle variations played in a minute standing (${[...names].join(', ')})`);
  step('walk', 1.4);
  assert.ok(!pm.anim.take, 'moving cancels a fidget');
  dog.dispose();
});

// ------------------------------------------------------------------ the object set (docs/animations.md 2C), made on the toaster
const OBJECT_CLIPS = ['idle', 'idle_fidget', 'walk', 'run', 'jump_start', 'jump', 'land', 'fall', 'swim', 'sit', 'sleep', 'wave', 'dance', 'cheer', 'laugh', 'point', 'clap', 'thumbsup', 'heart', 'shrug', 'hurt', 'knock_down', 'get_up'];
const objSet = () => A.setOf('object');
/** A GLB's box in its own units (the accessor's min and max), as presence-models.js measures a model. */
function glbBox(id: string) {
  const j = glb(id), a = j.accessors[j.meshes[0].primitives[0].attributes.POSITION];
  return { min: { x: a.min[0], y: a.min[1], z: a.min[2] }, max: { x: a.max[0], y: a.max[1], z: a.max[2] } };
}
/** What presence-models.js has for a model when it drives it: its box, the scale to its height, its row. */
function fakeModel(id: string) {
  const ent = M.entry(id) || { id, ...registryBefore[id], form: registryBefore[id].form, h: registryBefore[id].h }, b = glbBox(id);
  return { ent, b, k: ent.h / (b.max.y - b.min.y), anim: null };
}
const bodyAt = (pm: any, name: string, u: number) => A.finish(pm, { virtual: true }, A.sampleClip(objSet().clips[name], u)).body;
/** How high the lowest corner of the leaning, squashed box is over the ground (the box is on it when 0), in meters. */
function floorGap(pm: any, o: any) {
  const q = B.Quaternion.FromEulerAngles(o.rx, o.ry, o.rz), hx = (pm.b.max.x - pm.b.min.x) / 2 * pm.k, hy = pm.ent.h / 2, hz = (pm.b.max.z - pm.b.min.z) / 2 * pm.k;
  const sxz = 1 / Math.sqrt(o.sy);
  let low = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const v = new B.Vector3(sx * hx * sxz * o.sx, sy * hy * o.sy, sz * hz * sxz * o.sz).rotateByQuaternionToRef(q, new B.Vector3());
    low = Math.min(low, v.y);
  }
  return hy * (o.sy - 1) + o.y + low + hy; // (models.js: the mover's middle sits at hy, and the squash keeps the bottom still)
}

test('the object set has every clip of docs/animations.md 2C, sound, with loops that close and a toy rule that keeps volume', () => {
  const set = objSet();
  assert.deepEqual(OBJECT_CLIPS.filter((n) => !set.clips[n]), [], 'every clip is there');
  assert.deepEqual(set.problems, [], 'the file is sound');
  const once = ['idle_fidget', 'jump_start', 'land', 'wave', 'cheer', 'laugh', 'point', 'clap', 'thumbsup', 'heart', 'shrug', 'hurt', 'knock_down', 'get_up'];
  for (const n of OBJECT_CLIPS) assert.equal(set.clips[n].loop, !once.includes(n), `${n}: ${once.includes(n) ? 'plays once' : 'loops'}`);
  const secs: Record<string, number> = { idle: 3.2, idle_fidget: 1.5, walk: 1, run: 0.6, jump_start: 0.25, jump: 0.7, land: 0.3, fall: 0.9, swim: 2, sit: 4, sleep: 4, wave: 1.6, dance: 2.4, cheer: 1.4, laugh: 1.6, point: 1.2, clap: 1.6, thumbsup: 1.2, heart: 1.6, shrug: 1.2, hurt: 0.5, knock_down: 0.9, get_up: 1.2 };
  for (const [n, s] of Object.entries(secs)) assert.equal(set.clips[n].seconds, s, `${n}: ${s} s`);
  const same = (a: any, b: any, what: string, tolDeg = 1.5) => {
    const ba = a.get('Body'), bb = b.get('Body');
    if (ba && bb) {
      if (ba.q) assert.ok(Math.abs(A.q.angle(A.q.mul(ba.q, A.q.inv(bb.q)))) < tolDeg, `${what}: the lean is the same`);
      for (const [x, y] of [[ba.p, bb.p], [ba.s, bb.s]]) if (x && y) for (let i = 0; i < 3; i++) assert.ok(Math.abs(x[i] - y[i]) < 0.012, `${what}: ${i} is the same`);
    }
  };
  for (const n of OBJECT_CLIPS) {
    const c = set.clips[n];
    for (let i = 0; i <= 48; i++) {
      const s = A.sampleClip(c, i / 48).get('Body').s;
      assert.ok(Math.abs(s[0] * s[1] * s[2] - 1) < 0.01, `${n} at ${i}/48: squash and stretch keeps volume (${(s[0] * s[1] * s[2]).toFixed(3)})`);
    }
    if (c.loop) same(A.sampleClip(c, 0.99999), A.sampleClip(c, 0), `${n} closes`);
    else {
      // a one-shot starts where the body stands and (but for a fall that lies there, and a take-off that ends stretched) ends there too
      const first = A.sampleClip(c, 0).get('Body'), last = A.sampleClip(c, 1).get('Body');
      if (!['land', 'jump_start', 'get_up'].includes(n)) assert.ok(Math.abs(A.q.angle(first.q || [0, 0, 0, 1])) < 1 && Math.abs(first.s[1] - 1) < 0.01, `${n} starts upright`);
      if (!['knock_down', 'jump_start'].includes(n)) assert.ok(Math.abs(A.q.angle(last.q || [0, 0, 0, 1])) < 1 && Math.abs(last.s[1] - 1) < 0.01 && Math.abs((last.p || [0, 0, 0])[1]) < 0.002, `${n} ends where it stands`);
    }
  }
  const down = A.sampleClip(set.clips.knock_down, 1).get('Body'), up = A.sampleClip(set.clips.get_up, 0).get('Body');
  assert.ok(Math.abs(A.q.angle(down.q) - 90) < 4 && Math.abs(A.q.angle(up.q) - 90) < 4, 'knock_down ends on its side and get_up begins there');
  // the footsteps: a waddle and a run hop on each foot
  for (const n of ['walk', 'run']) assert.deepEqual(set.clips[n].events.map((e: any) => [e.t, e.name, e.foot]), [[0, 'hop', 'L'], [0.5, 'hop', 'R']], `${n}: hop events on each foot`);
  assert.equal(set.clips.clap.events.length, 6, 'six claps, six events');
});

test('the toast slices pop in idle_fidget, cheer, point, thumbsup and hurt, and are back in their slots when the clip ends', () => {
  const set = objSet();
  for (const n of ['idle_fidget', 'cheer', 'point', 'thumbsup', 'hurt']) {
    let top = 0, topZ = 0;
    for (let i = 0; i <= 60; i++) for (const k of ['ToastL', 'ToastR']) { const v = A.sampleClip(set.clips[n], i / 60).get(k); if (v) { top = Math.max(top, v.p[1]); topZ = Math.max(topZ, v.p[2]); } }
    assert.ok(top > 0.15, `${n}: a slice comes up out of its slot (${top.toFixed(2)} heights)`);
    for (const k of ['ToastL', 'ToastR']) { const v = A.sampleClip(set.clips[n], 1).get(k); if (v) assert.ok(Math.abs(v.p[1]) < 0.01 && Math.abs(v.p[2]) < 0.01, `${n}: ${k} is home at the end`); }
    assert.ok(set.clips[n].events.some((e: any) => e.name === 'toast'), `${n}: tells the listeners about the pop`);
    if (n === 'point') assert.ok(topZ > 0.4, 'point: the slice goes out toward the target');
  }
  assert.ok(A.sampleClip(set.clips.cheer, 0.5).get('ToastL') && A.sampleClip(set.clips.cheer, 0.5).get('ToastR'), 'cheer pops both');
  const one = (n: string) => ['ToastL', 'ToastR'].filter((k) => FILES.object.clips[n].tracks[k]);
  assert.equal(one('thumbsup').length, 1, 'thumbsup pops one');
  // thumbsup: the slice stays up through the middle of the clip
  assert.ok(A.sampleClip(set.clips.thumbsup, 0.3).get('ToastR').p[1] > 0.3 && A.sampleClip(set.clips.thumbsup, 0.7).get('ToastR').p[1] > 0.3, 'thumbsup: it pops up and stays');
});

test('on the toaster the slices are meshes in the slots that come up with the clip, follow the body, and stay hidden when at rest', async () => {
  register({ toaster: { ...standinRows().toaster, rig: 'object' } });
  const t = stand('toaster');
  await M.ready(t.rig);
  const pr = t.rig.pm.props;
  assert.ok(pr && pr.parts.length === 2, 'two slices made');
  const at = (name: string, sec: number) => { t.rig.forceClip = { name, t: sec }; P.showcase.animate(t.rig, 1 / 60); return pr.parts.map((p: any) => ({ on: p.node.isEnabled(), y: p.node.position.y, parent: p.node.parent })); };
  const rest = at('idle', 0);
  assert.ok(rest.every((p: any) => !p.on), 'at rest both are hidden in their slots');
  for (const [clipName, sec, slices] of [['idle_fidget', 0.6, 1], ['cheer', 0.7, 2], ['point', 0.5, 1], ['thumbsup', 0.5, 1], ['hurt', 0.2, 2]] as const) {
    const s = at(clipName, sec), shown = s.filter((p: any) => p.on).length;
    assert.equal(shown, slices, `${clipName}: ${slices} slice(s) out at ${sec} s`);
    assert.ok(s.filter((p: any) => p.on).every((p: any) => p.y > rest[0].y + 0.1), `${clipName}: and up above the slot`);
  }
  assert.equal(pr.parts[0].node.parent, t.rig.pm.inner, 'they hang on the model\'s frame, so they follow Body\'s squash, hop and lean');
  at('knock_down', 0);
  assert.ok(pr.parts.every((p: any) => !p.node.isEnabled()), 'a clip that does not lift them hides them again');
  // in the game, the emote does it: the radial menu's cheer (no forced clip)
  t.rig.forceClip = null;
  run(t, 0.1, 0);
  t.rig.emote = { def: C.emote('cheer'), t0: t.rig.time || 0 };
  let seen = 0;
  for (let i = 0; i < 90; i++) { P.showcase.animate(t.rig, 1 / 60); if (pr.parts.every((p: any) => p.node.isEnabled())) seen++; }
  assert.ok(seen > 15, `cheer from the emote menu pops both slices (${seen} frames)`);
  P.showcase.dispose(t.rig); t.node.dispose();
});

test('the same clips fit the shoe, teapot, cactus and duck by their proportions, and rest every pose on the ground', () => {
  const ids = ['toaster', 'shoe', 'teapot', 'cactus', 'duck', 'cone', 'banana', 'mushroom', 'potato'];
  const motion: Record<string, any> = {};
  for (const id of ids) motion[id] = A.motionOf(fakeModel(id));
  assert.ok(motion.cactus.sway < motion.toaster.sway && motion.cactus.hop < motion.toaster.hop, 'a tall thin cactus sways and hops less than the toaster');
  assert.ok(motion.shoe.sway > motion.toaster.sway, 'a long low shoe leans more');
  assert.ok(motion.duck.hop < motion.toaster.hop * 0.9 && motion.duck.sway > motion.toaster.sway, 'the duck waddles: low hops, wide sway');
  assert.ok(Math.abs(motion.toaster.sway - 1) < 0.1 && Math.abs(motion.toaster.hop - 1) < 0.1, 'the toaster is the model the set was made on');
  // the hop is a share of the model's own height: the cactus (1.7 m) hops higher in meters than the shoe (0.5 m)
  const top = (id: string) => { const pm = fakeModel(id); let y = 0; for (let i = 0; i < 32; i++) y = Math.max(y, bodyAt(pm, 'walk', i / 32).y); return y; };
  assert.ok(top('cactus') > top('shoe') * 1.5, `walk hop: cactus ${top('cactus').toFixed(3)} m, shoe ${top('shoe').toFixed(3)} m`);
  // no clipping: through every clip that stays on the ground, the box of the leaning body never goes under it, and touches it
  for (const id of ['toaster', 'shoe', 'teapot', 'cactus', 'duck']) {
    const pm = fakeModel(id);
    for (const n of OBJECT_CLIPS) {
      if (objSet().clips[n].air) continue;
      let worst = Infinity;
      for (let i = 0; i <= 40; i++) { const gap = floorGap(pm, bodyAt(pm, n, i / 40)); worst = Math.min(worst, gap); }
      assert.ok(worst > -0.005, `${id} ${n}: never through the floor (${worst.toFixed(3)} m)`);
    }
    // knocked down it lies on its side: the middle is as high as half its width (or depth), not as high as it stood
    const lying = bodyAt(pm, 'knock_down', 1);
    assert.ok(Math.abs(floorGap(pm, lying)) < 0.01, `${id}: lies on the floor, not in the air (${floorGap(pm, lying).toFixed(3)} m)`);
  }
});

test('the fish and the roll-bot keep their own swim and roll, taking the set for idle, emotes and hurt', async () => {
  for (const id of ['fish', 'rollbot']) {
    assert.equal(registryBefore[id].keepGait, true, `${id}'s row keeps its gait`);
    assert.equal(A.classOf(M.entry(id)), 'object', `${id} takes the object set`);
  }
  register({ fish: { ...standinRows().fish }, toaster: { ...standinRows().toaster, rig: 'object' } });
  const f = stand('fish'), t = stand('toaster');
  await M.ready(f.rig); await M.ready(t.rig);
  for (const n of ['walk', 'run', 'jump', 'swim', 'fall', 'land']) assert.ok(!A.has(f.rig, n), `the fish does not take ${n}`);
  for (const n of ['idle', 'wave', 'cheer', 'hurt', 'dance']) assert.ok(A.has(f.rig, n), `the fish takes ${n}`);
  run(f, 1, 2.6);
  assert.equal(f.rig.pm.anim.player ? f.rig.pm.anim.player.loops.length : 0, 0, 'swimming along, the set plays nothing: its own gait moves it');
  run(t, 1, 2.6);
  assert.ok(t.rig.pm.anim.player.loops.length > 0, 'the toaster, walking, does play the set');
  run(f, 0.3, 0);
  assert.ok(f.rig.pm.anim.player.loops.length > 0, 'standing, the fish takes the set\'s idle');
  P.showcase.dispose(f.rig); f.node.dispose(); P.showcase.dispose(t.rig); t.node.dispose();
});

test('a landing and a take-off are the set\'s own squash, not squashed twice, and a hurt entity plays hurt', async () => {
  register({ toaster: { ...standinRows().toaster, rig: 'object' } });
  const t = stand('toaster');
  await M.ready(t.rig);
  run(t, 0.3, 0);
  t.e.grounded = false; t.e.vy = -5;
  run(t, 0.4, 0);
  t.e.grounded = true; t.e.vy = 0;
  let low = 9;
  for (let i = 0; i < 20; i++) { run(t, 1 / 60, 0); low = Math.min(low, t.rig.pm.mover.scaling.y); }
  assert.ok(low > 0.74 && low < 0.9, `the land clip squashes to about 0.8, once (${low.toFixed(2)})`);
  const js = fs.readFileSync(path.join(ROOT, 'public', 'play', 'modules', 'presence', 'presence.js'), 'utf8');
  assert.ok(js.includes("name: 'hurt'") && js.includes("P.anim.has(rig, 'hurt')"), 'a hurt event plays the set\'s hurt');
  P.showcase.dispose(t.rig); t.node.dispose();
});

// ------------------------------------------------------------------ the Mixamo models (person, robot): the real files
test('the Mixamo models (Gen mesh.rig, mixamorig: bones) bind to the Mixamo set, stand up, face +z, and walk with the legs against each other', () => {
  const set = A.setOf('mixamo');
  for (const id of MIXAMO) {
    const model = glbTree(id), b = A.bind([model], 'mixamo', { unit: 1.8 });
    assert.ok(b.fit, `${id}: every bone the set needs is there (missing ${b.missing})`);
    assert.equal(joints(id).length, 52, `${id}: the full skeleton, fingers included`);
    A.apply(b, new Map()); // rest
    const rest = { hips: at(b, 'Hips'), head: at(b, 'Head'), toe: at(b, 'LeftToeBase'), foot: at(b, 'LeftFoot'), lh: at(b, 'LeftHand'), rh: at(b, 'RightHand') };
    assert.ok(rest.head.y > rest.hips.y + 0.2 && rest.hips.y > rest.foot.y + 0.2, `${id}: standing up: head over hips over feet`);
    assert.ok(rest.toe.z > rest.foot.z + 0.05, `${id}: the toes point to +z (the front)`);
    assert.ok(Math.abs(rest.lh.x) > 0.3 && Math.abs(rest.rh.x) > 0.3 && rest.lh.x * rest.rh.x < 0, `${id}: the arms are out to either side`);
    const walk = set.clips.walk, feet = (u: number) => { A.apply(b, A.sampleClip(walk, u)); return { lf: at(b, 'LeftFoot'), rf: at(b, 'RightFoot'), hips: at(b, 'Hips') }; };
    const a = feet(0), c = feet(0.5);
    const reach = Math.abs(a.lf.z - a.rf.z);
    // A stride is measured against the legs: a quarter of the hips' height over the feet (0.2 on a person's; a penguin's are stubs).
    const leg = rest.hips.y - rest.foot.y;
    assert.ok(reach > 0.25 * leg, `${id}: the feet are a stride apart at the start (${reach.toFixed(2)}, legs ${leg.toFixed(2)})`);
    assert.ok((a.lf.z - a.rf.z) * (c.lf.z - c.rf.z) < 0, `${id}: half a stride on the other foot is ahead`);
  }
});
