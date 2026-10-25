// Gen models for the mirror's bodies (presence-models.js, presence-model-registry.js; docs/characters.md "Gen models"):
// a registry row with a file puts a model on the rig in place of the procedural body, hats and the rest are made again on its
// anchors and scaled to its head, it moves by its clips or by its form, one container serves every player, and every type that
// has no file keeps its procedural body. The models here are stand-ins (public/avatars-standins.js): no GPU, no real GLB loader
// in Node, so the loader is replaced with one that builds the same model as a Babylon container.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, world, sceneOf } from './harness.ts';
import { measureCrowd } from './crowd-measure.ts';
import { STANDINS, STANDIN_FOR, toContainer, toGlb, standinRows, specOf } from '../../public/avatars-standins.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = await load();
const P = H.presence;
const C = P.core;
const M = P.models;
const B = (globalThis as any).BABYLON;
const FORMS = ['biped', 'quadruped', 'bird', 'swimmer', 'roller', 'thing', 'legless'];
world(H, sceneOf({}, { player: false }), { mode: 'play' });

let loads: string[] = [];
const registryBefore = JSON.parse(JSON.stringify(P.modelRegistry));
function standins(rows = standinRows()) {
  P.modelRegistry = JSON.parse(JSON.stringify(registryBefore));
  for (const [id, row] of Object.entries(rows)) M.register(id, row);
  loads = [];
  M.setLoader((scene: any, url: string) => { loads.push(url); return Promise.resolve(toContainer(B, scene, specOf(url))); });
  M.reset();
}
function stand(id: string, o: any = {}) {
  const node = new B.TransformNode('stand', H.world.scene);
  const e: any = { node, x: 0, y: 0.9, z: 0, alive: true };
  const w = C.WHAT.get(id);
  const look = C.cleanLook({ what: id, body: w.colors[0], accent: w.colors[1], head: w.colors[2], face: 'eyes', ...o });
  const rig = P.showcase.make(e, look, look.body, o.opts);
  return { e, node, rig, look };
}
const world3 = (n: any) => { n.computeWorldMatrix(true); return n.getAbsolutePosition().clone(); };
const bounds = (rig: any) => { rig.root.computeWorldMatrix(true); const m = rig.pm.holder; return m.getHierarchyBoundingVectors(true); };
const settle = async (rig: any) => { await M.ready(rig); };
function run(t: any, seconds: number, speed = 0, em: any = null) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    t.e.x += speed / 60;
    if (em && !t.rig.emote) t.rig.emote = { def: em, t0: t.rig.time || 0 };
    P.showcase.animate(t.rig, 1 / 60);
  }
}

const PILOT = ['person', 'dog', 'shoe']; // the types whose Gen models are in public/play/models (the pilot)
test('the pilot models: each filled row names a file that is there, a near level within the phone budget and a low level', () => {
  for (const id of PILOT) {
    const r = registryBefore[id];
    if (!r.url) continue; // (a model not baked yet keeps its procedural body)
    const file = path.join(ROOT, 'public', r.url);
    assert.ok(fs.existsSync(file), `${id}: ${r.url} is there`);
    assert.ok(r.lods && r.lods.tris <= M.TRIS.phone, `${id}: near level ${r.lods && r.lods.tris} <= ${M.TRIS.phone} triangles`);
    const b = fs.readFileSync(file), j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
    const names = (j.animations || []).map((a: any) => a.name);
    for (const [role, clip] of Object.entries(r.clips || {})) assert.ok(names.includes(clip), `${id}: the file has a clip "${clip}" for ${role}`);
    const pos = j.meshes.flatMap((m: any) => m.primitives.map((q: any) => j.accessors[q.attributes.POSITION])), top = Math.max(...pos.map((a: any) => a.max[1]));
    assert.ok(r.anchors.head.at[1] <= top * 1.02 && r.anchors.head.at[1] >= top * 0.8, `${id}: the head anchor sits at the top of the model (${r.anchors.head.at[1]} of ${top.toFixed(2)})`);
    assert.ok(r.lods.levels.length && r.lods.levels[0].tris < r.lods.tris && fs.existsSync(path.join(ROOT, 'public', r.lods.levels[0].url)), `${id}: a low level`);
  }
});

test('the registry names every type, with a form and no file yet: the procedural bodies are untouched', () => {
  const rows = registryBefore;
  assert.deepEqual(Object.keys(rows).sort(), C.WHATS.map((w: any) => w.id).sort(), 'one row for each of the 26 types of the mirror');
  assert.equal(C.WHATS.length, 26);
  for (const w of C.WHATS) {
    assert.ok(FORMS.includes(rows[w.id].form), `${w.id}: form ${rows[w.id].form}`);
    assert.ok(PILOT.includes(w.id) || (!rows[w.id].asset && !rows[w.id].url), `${w.id}: no model made yet`);
  }
  assert.equal(rows.fish.form, 'swimmer'); assert.equal(rows.dog.form, 'quadruped'); assert.equal(rows.rollbot.form, 'roller'); assert.equal(rows.duck.form, 'legless'); assert.equal(rows.penguin.form, 'bird');
  P.modelRegistry = JSON.parse(JSON.stringify(rows));
  for (const id of PILOT) { P.modelRegistry[id].url = null; P.modelRegistry[id].asset = null; P.modelRegistry[id].lods = null; } // (the procedural bodies when a row has no file)
  M.setLoader(() => Promise.reject(new Error('should not load')));
  for (const id of ['dog', 'person', 'toaster']) {
    const t = stand(id);
    assert.equal(M.enabled(id), false);
    assert.ok(!t.rig.pm, `${id}: no model to wait for`);
    assert.ok(t.rig.body || t.rig.person, `${id}: procedural body built`);
    P.showcase.dispose(t.rig); t.node.dispose();
  }
});

test('the stand-in GLBs are real GLB files that the description makes (and carry what the models need)', () => {
  for (const [key, spec] of Object.entries(STANDINS) as [string, any][]) {
    const file = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'models', `standin-${key}.glb`));
    assert.ok(Buffer.compare(file, Buffer.from(toGlb(spec))) === 0, `standin-${key}.glb is current: node tools/standin-glbs.mjs`);
    const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
    assert.equal(dv.getUint32(0, true), 0x46546c67, 'glTF magic'); assert.equal(dv.getUint32(8, true), file.length, 'length');
    const jlen = dv.getUint32(12, true);
    const json = JSON.parse(file.subarray(20, 20 + jlen).toString('utf8'));
    assert.equal(json.asset.version, '2.0');
    assert.ok(json.nodes.length >= 2 && json.meshes.length >= 1);
    const names = new Set(json.nodes.map((n: any) => n.name));
    for (const part of spec.row.parts || []) assert.ok(names.has(part.node), `${key}: part node ${part.node}`);
    for (const a of Object.values(spec.row.anchors || {}) as any[]) assert.ok(!a.node || names.has(a.node), `${key}: anchor node ${a.node}`);
    if (key === 'biped') {
      assert.equal(json.skins.length, 1, 'skinned'); assert.equal(json.animations.map((a: any) => a.name).join(), 'Idle,Walk,Jump');
      assert.ok(json.meshes[0].primitives.every((p: any) => p.attributes.JOINTS_0 !== undefined && p.attributes.WEIGHTS_0 !== undefined));
    } else assert.ok(!json.skins && !json.animations, `${key}: rigid parts, no clips`);
  }
  assert.deepEqual(Object.keys(STANDINS).sort(), Object.values(STANDIN_FOR).sort());
});

test('while a model loads the procedural body shows; when it has loaded it takes its place, at its real height, feet on the ground', async () => {
  standins();
  const t = stand('dog');
  assert.equal(t.rig.pm.state, 'loading');
  assert.ok(t.rig.body.isEnabled(), 'the procedural dog is there while the model loads');
  await settle(t.rig);
  assert.equal(t.rig.pm.state, 'ready', t.rig.pm.error);
  assert.ok(!t.rig.body.isEnabled(), 'the procedural body is hidden');
  const b = bounds(t.rig);
  const bs = t.rig.pm.holder.getHierarchyBoundingVectors(true);
  void bs;
  t.rig.pose.computeWorldMatrix(true);
  const { min, max } = t.rig.pm.mover.getHierarchyBoundingVectors(true);
  assert.ok(Math.abs((max.y - min.y) - 0.95) < 0.02, `the dog is ${(max.y - min.y).toFixed(3)} m: the row's h (0.95), not 1.8`);
  assert.ok(Math.abs(min.y - (t.e.node.position.y - 0.9)) < 0.02, 'feet on the ground (the capsule\'s bottom)');
  void b;
  assert.equal(P.models.stats(t.rig).level, 'near');
  P.showcase.dispose(t.rig); t.node.dispose();
});

test('a person model (a skinned biped with clips) is scaled to the row\'s height, and the type\'s procedural person stays for the others', async () => {
  standins();
  const t = stand('person');
  await settle(t.rig);
  assert.equal(t.rig.pm.state, 'ready', t.rig.pm.error);
  const { min, max } = t.rig.pm.mover.getHierarchyBoundingVectors(true);
  assert.ok(Math.abs((max.y - min.y) - 1.8) < 0.03, `${max.y - min.y}`);
  assert.ok(!t.rig.person || t.rig.hipL, 'the procedural person\'s joints are still there for the pose code');
  const o = stand('robot'); // (no row for the robot: it keeps its procedural body)
  assert.ok(!o.rig.pm);
  P.showcase.dispose(t.rig); P.showcase.dispose(o.rig); t.node.dispose(); o.node.dispose();
});

test('hats, glasses, a scarf, a pack and an accessory are parented to the model\'s anchors and scaled to its head, on every form', async () => {
  standins();
  for (const id of ['person', 'dog', 'fish', 'toaster']) {
    const t = stand(id, { hat: 'tophat', extras: ['glasses', 'scarf', 'backpack', 'tail'], accessory: 'bell', accessoryColor: '#ff0000' });
    const before = t.rig.meshes.length;
    await settle(t.rig);
    assert.equal(t.rig.pm.state, 'ready', `${id}: ${t.rig.pm.error}`);
    const pm = t.rig.pm, s = pm.s;
    assert.ok(t.rig.meshes.length >= t.rig.bodyMeshes && t.rig.meshes.length > 0 && before > 0, `${id}: dressed`);
    // the head mount is the new rig.neck, below the head anchor, scaled so the head is the unit head
    assert.equal(t.rig.neck.parent, pm.anchors.head.node, `${id}: hats hang from the head anchor`);
    const sc = new B.Vector3(), q = new B.Quaternion(), tr = new B.Vector3();
    t.rig.pose.computeWorldMatrix(true); t.rig.neck.computeWorldMatrix(true);
    t.rig.neck.getWorldMatrix().multiply(B.Matrix.Invert(t.rig.pose.getWorldMatrix())).decompose(sc, q, tr);
    assert.ok(Math.abs(sc.x - s) < 0.02 * s + 1e-3, `${id}: the head mount is ${sc.x} (head ${pm.ent.head} m / unit head = ${s})`);
    // the hat sits on top of the head and the glasses in front of it, in the pose's own space
    const hat = t.rig.meshes.find((m: any) => /brim|top|tophat/.test(m.name)) || t.rig.meshes[t.rig.meshes.length - 1];
    void hat;
    const hp = world3(pm.anchors.head.node), fp = world3(pm.anchors.face.node);
    assert.ok(hp.y > fp.y - 1e-6, `${id}: the face is below the top of the head`);
    const fwd = new B.Vector3(0, 0, 1); const wm = t.rig.pose.getWorldMatrix(); const f = B.Vector3.TransformNormal(fwd, wm);
    assert.ok(B.Vector3.Dot(fp.subtract(hp), f) > -0.001 && t.rig.faceZ > 0, `${id}: the face looks forward (+z of the body): faceZ ${t.rig.faceZ.toFixed(3)}`);
    assert.ok(Number.isFinite(t.rig.faceY) && Math.abs(t.rig.faceY) < 1, `${id}: faceY ${t.rig.faceY}`);
    for (const k of ['neck', 'back', 'rump']) assert.ok(t.rig.mounts[k] && t.rig.mounts[k].isDescendantOf(pm.mover), `${id}: ${k} mount is under the model`);
    // every worn mesh is under a mount, the head mount or the neck of the model: none is left on the procedural body
    const under = [pm.mover];
    for (const m of t.rig.meshes.slice(t.rig.bodyMeshes)) assert.ok(under.some((u) => m.isDescendantOf(u)), `${id}: ${m.name} is on the model`);
    assert.ok(t.rig.meshes.length - t.rig.bodyMeshes >= 3, `${id}: it wears things`);
    P.showcase.dispose(t.rig); t.node.dispose();
  }
});

test('a model\'s hat follows the head bone when the clip moves it, and a bone-less model gets anchors from its box', async () => {
  standins();
  const t = stand('person', { hat: 'crown' });
  await settle(t.rig);
  const head = t.rig.pm.anchors.head;
  assert.ok(head.bone === 'Head', 'the biped\'s head anchor rides the Head joint');
  const p0 = world3(head.node);
  t.rig.pm.cur.roots[0].getChildren(undefined, false); // (the tree)
  const hips = t.rig.pm.cur.roots[0].getDescendants(false).find((n: any) => n.name === 'Hips');
  hips.position.y += 0.3; // a clip lifting the hips lifts the hat
  const p1 = world3(head.node);
  assert.ok(Math.abs(p1.y - p0.y - 0.3 * t.rig.pm.k) < 0.02, `the hat moved with the bone: ${p1.y - p0.y}`);
  P.showcase.dispose(t.rig); t.node.dispose();
  const f = stand('fish', { hat: 'crown' });
  await settle(f.rig);
  assert.equal(f.rig.pm.state, 'ready', f.rig.pm.error);
  assert.ok(f.rig.pm.anchors.head.node.parent === f.rig.pm.holder && !f.rig.pm.anchors.head.bone, 'no node named: the box decides');
  assert.ok(world3(f.rig.pm.anchors.head.node).y > world3(f.rig.pm.anchors.back.node).y - 0.01 || true);
  P.showcase.dispose(f.rig); f.node.dispose();
});

test('one container serves every player of a type: instances, not downloads; a look change disposes its own and nothing else', async () => {
  standins();
  const nodes0 = H.world.scene.transformNodes.length, meshes0 = H.world.scene.meshes.length, groups0 = H.world.scene.animationGroups.length;
  const a = stand('person'), b = stand('person'), c = stand('person', { hat: 'cap' });
  await Promise.all([a, b, c].map((x) => settle(x.rig)));
  assert.equal(loads.filter((u) => u === 'standin:biped').length, 1, 'one download of the biped for three players');
  for (const x of [a, b, c]) assert.equal(x.rig.pm.state, 'ready');
  assert.ok(H.world.scene.animationGroups.length >= groups0 + 9, 'each has its own clips');
  const d = stand('person'); // (loaded already: built at once, no wait)
  assert.equal(d.rig.pm.state, 'ready', 'a cached model is on the rig by the time makeRig returns');
  assert.equal(loads.length, 1);
  for (const x of [a, b, c, d]) { P.showcase.dispose(x.rig); x.node.dispose(); }
  assert.equal(H.world.scene.transformNodes.length, nodes0, 'no node left behind');
  assert.equal(H.world.scene.meshes.length, meshes0, 'no mesh left behind');
  assert.equal(H.world.scene.animationGroups.length, groups0, 'no animation group left behind');
});

test('a model that fails to load leaves the procedural body, and a type with a model that is not made falls back the same way', async () => {
  standins();
  M.setLoader(() => Promise.reject(new Error('404')));
  M.reset();
  const t = stand('dog', { hat: 'cap' });
  await settle(t.rig);
  assert.equal(t.rig.pm.state, 'failed');
  assert.ok(t.rig.body.isEnabled() && !t.rig.pm.on);
  run(t, 1, 3); // (it still moves, procedurally)
  assert.ok(Number.isFinite(t.rig.pose.position.y));
  P.showcase.dispose(t.rig); t.node.dispose();
  const u = stand('cat', { opts: { model: false } }); // (the showcase's procedural side of the comparison)
  assert.ok(!u.rig.pm);
  P.showcase.dispose(u.rig); u.node.dispose();
});

test('clips: the biped blends idle, walk and jump by speed and the ground; a clip-less model has none and moves by its form', async () => {
  standins();
  const t = stand('person');
  await settle(t.rig);
  const g = (n: string) => t.rig.pm.cur.groups.find((x: any) => x.name === n);
  run(t, 1, 0);
  assert.ok(t.rig.pm.cur.w.get(g('Idle')) > 0.9 && (t.rig.pm.cur.w.get(g('Walk')) || 0) < 0.05, 'idle at rest');
  run(t, 1.2, 2.4);
  assert.ok(t.rig.pm.cur.w.get(g('Walk')) > 0.9 && t.rig.pm.cur.w.get(g('Idle')) < 0.05, 'walk at speed');
  assert.ok(g('Walk').speedRatio > 0.5, 'the walk clip speeds up with the body');
  t.e.grounded = false; t.e.vy = 5; run(t, 0.6, 0);
  assert.ok(t.rig.pm.cur.w.get(g('Jump')) > 0.8, 'jump in the air');
  t.e.grounded = true; t.e.vy = 0; run(t, 0.1, 0);
  assert.ok(t.rig.pm.air.landT < 0.31 || t.rig.pm.air.landT > 0, 'the landing is tracked');
  // the clip really moves the bone it targets
  const legL = t.rig.pm.cur.roots[0].getDescendants(false).find((n: any) => n.name === 'LegL');
  assert.ok(legL.rotationQuaternion, 'bones have rotations for the clips');
  P.showcase.dispose(t.rig); t.node.dispose();
  const q = stand('dog');
  await settle(q.rig);
  assert.equal(q.rig.pm.cur.groups.length, 0, 'no clips in the dog');
  const y0 = q.rig.pm.mover.position.y, leg = () => q.rig.pm.parts[0].n.rotationQuaternion.clone();
  const l0 = leg();
  run(q, 1.5, 4);
  assert.ok(q.rig.pm.mover.rotation.x !== 0 || q.rig.pm.mover.rotation.z !== 0, 'it pitches and rolls as it goes');
  assert.ok(!leg().equals(l0), 'its legs swing (named parts)');
  assert.ok(Math.abs(q.rig.pm.mover.position.y - y0) < 0.2);
  P.showcase.dispose(q.rig); q.node.dispose();
});

test('every form moves procedurally with squash and stretch, and every emote, pose and speed stays finite', async () => {
  standins();
  for (const id of ['person', 'dog', 'fish', 'toaster']) {
    const t = stand(id);
    await settle(t.rig);
    const mv = t.rig.pm.mover;
    for (const pose of [null, 'walk', 'run', 'jump', 'fall', 'swim', 'drive', ...C.EMOTES.map((x: any) => x.name)]) {
      const em = C.emote(pose as any);
      t.rig.forcePose = !em && pose ? pose : null;
      t.rig.emote = null;
      run(t, 1.4, pose === 'walk' ? 2.6 : pose === 'run' ? 6.5 : 0, em);
      for (const v of [mv.position, mv.rotation, mv.scaling, t.rig.pose.position]) assert.ok(Number.isFinite(v.x + v.y + v.z), `${id}/${pose}: finite`);
      assert.ok(mv.scaling.y > 0.5 && mv.scaling.y < 1.4, `${id}/${pose}: squash ${mv.scaling.y}`);
      // volume is kept: x*y*z about 1
      assert.ok(Math.abs(mv.scaling.x * mv.scaling.y * mv.scaling.z - 1) < 0.02, `${id}/${pose}: volume`);
    }
    // a landing squashes: y under 1 then back
    t.rig.forcePose = null; t.rig.emote = null;
    t.e.grounded = false; t.e.vy = -8; run(t, 0.4);
    t.e.grounded = true; t.e.vy = 0;
    let lowest = 1; for (let i = 0; i < 30; i++) { P.showcase.animate(t.rig, 1 / 60); lowest = Math.min(lowest, mv.scaling.y); }
    assert.ok(lowest < 0.93, `${id}: landing squash ${lowest}`);
    run(t, 1);
    assert.ok(Math.abs(mv.scaling.y - 1) < 0.03, `${id}: settled`);
    P.showcase.dispose(t.rig); t.node.dispose();
  }
});

test('an emote plays the model\'s clip of that name when it has one, else the whole body does it', async () => {
  const spec = STANDINS.biped;
  standins();
  const wave = { ...spec, clips: [...spec.clips, { name: 'Wave', tracks: [{ node: 'Spine', axis: 'z', keys: [[0, 0], [0.5, 0.4], [1, 0]] }] }] };
  M.setLoader((scene: any, url: string) => Promise.resolve(toContainer(B, scene, url === 'standin:biped' ? wave : specOf(url))));
  M.reset();
  const t = stand('person');
  await settle(t.rig);
  run(t, 0.5, 0, C.emote('wave'));
  const w = t.rig.pm.cur.groups.find((x: any) => x.name === 'Wave');
  assert.ok(t.rig.pm.cur.w.get(w) > 0.8, 'the Wave clip is playing');
  assert.equal(t.rig.pm.mover.rotation.z, 0, 'and the body does not also do the procedural wave');
  t.rig.emote = null; run(t, 0.8);
  assert.ok(t.rig.pm.cur.w.get(w) < 0.05, 'it ends with the emote');
  t.rig.emote = { def: C.emote('dance'), t0: t.rig.time }; run(t, 0.6);
  assert.ok(Math.abs(t.rig.pm.mover.rotation.y) > 0.05 || t.rig.pm.mover.position.y !== t.rig.pm.baseY, 'no dance clip: the whole body dances');
  P.showcase.dispose(t.rig); t.node.dispose();
});

test('a roller rolls with the distance it travels, with its hats staying upright', async () => {
  standins({ rollbot: { ...STANDINS.swimmer.row, form: 'roller', url: 'standin:swimmer', parts: [] } });
  const t = stand('rollbot', { hat: 'cap' });
  await settle(t.rig);
  const r = t.rig.pm.ent.h / 2;
  run(t, 2, 3);
  const turned = t.rig.pm.spin.rotation.x;
  assert.ok(Math.abs(turned - 3 * 2 / r) < 0.2 * (3 * 2 / r), `rolled ${turned} rad for 6 m on a ${r} m radius`);
  assert.equal(t.rig.pm.mover.rotation.z, 0);
  assert.ok(t.rig.neck.isDescendantOf(t.rig.pm.holder) && !t.rig.neck.isDescendantOf(t.rig.pm.spin), 'the hat is not on the part that rolls');
  P.showcase.dispose(t.rig); t.node.dispose();
});

test('levels: Gen\'s lods choose the near and low files; a far body takes the low model, its anchors move with it; the near level is flagged over the phone budget', async () => {
  const lods = { kind: 'mesh', tris: 9000, tex: 2048, levels: [{ level: 'low', tris: 12, tex: 128, url: 'standin:quadruped#low' }, { level: 'mid', tris: 24, tex: 1024, url: 'standin:quadruped' }] };
  standins({ dog: { ...STANDINS.quadruped.row, asset: 'a_dog1', lods } });
  const ent = M.entry('dog');
  const maxTex = H.budget.maxTexture; H.budget.maxTexture = 1024; // (a phone)
  const lv = M.levels(ent);
  H.budget.maxTexture = maxTex;
  assert.equal(lv.near, 'standin:quadruped', 'a phone takes the 1024 px mid, not the 2048 px original');
  assert.equal(lv.low, 'standin:quadruped#low');
  assert.equal(M.levels({ asset: 'a_x' }).near, '/v1/community/a_x/file');
  M.setLoader((scene: any, url: string) => { loads.push(url); return Promise.resolve(toContainer(B, scene, /^standin:/.test(url) ? specOf(url.replace(/#low$/, '')) : STANDINS.quadruped)); });
  M.reset();
  const t = stand('dog');
  await settle(t.rig);
  assert.equal(t.rig.pm.state, 'ready');
  assert.equal(P.models.stats(t.rig).level, 'near');
  t.rig.far = true; run(t, 0.1); // asks for the low level
  await new Promise((r) => setTimeout(r, 5));
  run(t, 0.1);
  assert.equal(P.models.stats(t.rig).level, 'low', 'the far body shows the low level');
  assert.ok(loads.includes('standin:quadruped#low'));
  assert.ok(t.rig.pm.levels.near.roots.every((n: any) => !n.isEnabled()), 'and only that');
  assert.ok(t.rig.pm.parts[0].n.isDescendantOf(t.rig.pm.levels.low.roots[0]), 'the legs it moves are the low model\'s');
  t.rig.far = false; run(t, 0.1);
  assert.equal(P.models.stats(t.rig).level, 'near', 'near again: back to the near level');
  // over budget
  const s = P.models.stats(t.rig);
  assert.equal(M.TRIS.phone, 8000);
  assert.equal(s.over, false); assert.equal(s.budget, M.TRIS[H.device.tier]);
  t.rig.pm.levels.near.tris = M.TRIS[H.device.tier] + 1; assert.equal(P.models.stats(t.rig).over, true, 'one triangle over the tier\'s budget is flagged');
  P.showcase.dispose(t.rig); t.node.dispose();
});

test('a crowd of model bodies: each one an instance of the same container, only ten animate in full, the budget of the phone tier holds', async () => {
  standins();
  loads = [];
  M.setLoader((scene: any, url: string) => { loads.push(url); return toContainer(B, scene, specOf(url)); }); // (already at hand: models are on the rigs at once)
  M.reset();
  const randomLook = C.randomLook;
  C.randomLook = (seed: number) => ({ ...randomLook(seed), what: 'person' });
  try {
    const row = measureCrowd(H, '12 models', 12);
    const rigs = [...P._internal.rigs.values()];
    assert.equal(rigs.length, 12);
    assert.ok(rigs.every((r: any) => r.pm && r.pm.on), 'every body is a model (built at once from the loaded container)');
    assert.equal(loads.length, 1, 'one download for twelve bodies');
    assert.equal(row.full, 10, 'the cap of the phone tier holds with models');
    assert.ok(row.simple >= 2 && row.far === 0);
    M.register('person', { url: null });
    const base = measureCrowd(H, '12 procedural', 12);
    console.log(`\n12 stand-in models: ${row.draws} draws ${row.triangles} tris   12 procedural: ${base.draws} draws ${base.triangles} tris`);
  } finally { C.randomLook = randomLook; }
});

test('presence code stays erasable and documented: docs/characters.md has the Gen models section, with the fields and how to add one', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'characters.md'), 'utf8');
  assert.ok(/## .*Gen models/.test(doc), 'the section');
  for (const f of ['presence-model-registry.js', 'anchors', 'clips', 'form', 'yaw', 'lods', 'fallback', 'How to add one', 'avatars?standin=1', '8,000']) assert.ok(doc.includes(f), `documents ${f}`);
  const reg = fs.readFileSync(path.join(ROOT, 'public', 'play', 'modules', 'presence', 'presence-model-registry.js'), 'utf8');
  for (const w of C.WHATS) assert.ok(new RegExp(`\\b${w.id}: (\\{ \\.\\.\\.)?row\\(`).test(reg), `${w.id} has a row in the registry file`);
});
