// Gen hats (presence-hats.js, docs/characters.md "Gen hats"): a registry row with a file puts the model on rig.neck in place of the
// procedural hat, base at the head, width as the row says, tinted by the accent where the row says so; a load that fails, a file over
// the triangle budget and a hat with no row keep the procedural hat. The hat is a stand-in container (no GLB loader in Node).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';
import { STANDINS, STANDIN_FOR, toContainer, standinRows, specOf } from '../../public/avatars-standins.js';

const H = await load();
const P = H.presence;
const C = P.core;
const B = (globalThis as any).BABYLON;
world(H, sceneOf({}, { player: false }), { mode: 'play' });

const hatsBefore = JSON.parse(JSON.stringify(P.hatRegistry || {}));
function hatContainer(scene: any, segments = 8) {
  const c = new B.AssetContainer(scene);
  const root = new B.TransformNode('__root__', scene);
  root.rotationQuaternion = B.Quaternion.RotationAxis(B.Vector3.Up(), Math.PI);
  c.transformNodes.push(root);
  const m = B.MeshBuilder.CreateSphere('hat', { diameter: 3, segments }, scene); // (a file in its own units, origin in the middle)
  m.parent = root; m.position.set(5, 7, 1);
  const mat = new B.PBRMaterial('hat-mat', scene); mat.albedoColor = new B.Color3(1, 1, 1);
  m.material = mat; c.meshes.push(m); c.materials.push(mat);
  return c;
}
let loads: string[] = [];
function hats(rows: any, make: (scene: any, url: string) => any = (s) => Promise.resolve(hatContainer(s))) {
  P.hatRegistry = JSON.parse(JSON.stringify(rows));
  loads = [];
  P.hats.setLoader((scene: any, url: string) => { loads.push(url); return make(scene, url); });
  P.hats.reset();
}
function wear(id: string, hat: string, o: any = {}) {
  const node = new B.TransformNode('stand', H.world.scene);
  const e: any = { node, x: 0, y: 0.9, z: 0, alive: true };
  const w = C.WHAT.get(id);
  const look = C.cleanLook({ what: id, body: w.colors[0], accent: w.colors[1], head: w.colors[2], face: 'eyes', hat, ...o });
  const rig = P.showcase.make(e, look, look.body, o.opts);
  return { e, node, rig, look };
}
const procedural = (rig: any) => rig.meshes.some((m: any) => /^pr-(cap|beanie|brim)/.test(m.name));
const done = async (rig: any) => { if (P.models) await P.models.ready(rig); await P.hats.ready(rig); await new Promise((r) => setTimeout(r, 5)); };

test.after(() => { P.hatRegistry = hatsBefore; });

test('a loaded hat model sits on the head anchor of the person, scaled by the row, base at the head, and the procedural hat is gone', async () => {
  hats({ cap: { url: '/play/models/hat-cap.glb', width: 0.5, tint: true } });
  const t = wear('person', 'cap');
  assert.ok(procedural(t.rig), 'while it loads, the procedural hat shows');
  await done(t.rig);
  const s = P.hats.stats(t.rig);
  assert.ok(s && s.kind === 'cap', 'the model hat is worn');
  assert.ok(!procedural(t.rig), 'the procedural hat is gone');
  const holder = t.rig.hatModel.holder;
  assert.equal(holder.parent, t.rig.neck, 'parented to the head anchor (rig.neck)');
  const bb = holder.getHierarchyBoundingVectors(true);
  t.rig.neck.computeWorldMatrix(true);
  const k = t.rig.neck.absoluteScaling.y; // (the head is scaled up from the unit head)
  assert.ok(Math.abs((bb.max.x - bb.min.x) / k - 0.5) < 0.02, `0.5 wide in head units, got ${(bb.max.x - bb.min.x) / k}`);
  holder.computeWorldMatrix(true);
  const lo = (bb.min.y - holder.getAbsolutePosition().y) / k;
  assert.ok(Math.abs(lo) < 0.05, `its base is at the head's top: ${lo}`);
  P.showcase.dispose(t.rig); t.node.dispose();
});

test('the hat follows the head: moving the neck moves the model', async () => {
  hats({ beanie: { url: '/play/models/hat-beanie.glb', width: 0.48, tint: true } });
  const t = wear('person', 'beanie');
  await done(t.rig);
  const h = t.rig.hatModel.holder;
  h.computeWorldMatrix(true); const p0 = h.getAbsolutePosition().clone();
  t.rig.neck.parent.position.y += 0.3;
  h.computeWorldMatrix(true);
  assert.ok(h.getAbsolutePosition().y - p0.y > 0.2, 'the hat rose with the head');
  P.showcase.dispose(t.rig); t.node.dispose();
});

test('the hat colour pick tints a flat-coloured hat and leaves a detailed one alone', async () => {
  hats({ cap: { url: '/a.glb', width: 0.5, tint: true }, crown: { url: '/b.glb', width: 0.44 } });
  const a = wear('person', 'cap', { accent: '#ff0000' });
  await done(a.rig);
  assert.equal(a.rig.hatModel.mats[0].albedoColor.toHexString().toLowerCase(), '#ff0000', 'the accent tints the cap');
  assert.ok(a.rig.hatModel.tinted);
  const b = wear('person', 'crown', { accent: '#ff0000' });
  await done(b.rig);
  assert.equal(b.rig.hatModel.mats[0].albedoColor.toHexString().toLowerCase(), '#ffffff', 'the crown keeps its own colour');
  const c = wear('person', 'cap', { accent: '#00ff00' });
  await done(c.rig);
  assert.equal(c.rig.hatModel.mats[0].albedoColor.toHexString().toLowerCase(), '#00ff00', 'each wearer has its own material');
  assert.equal(a.rig.hatModel.mats[0].albedoColor.toHexString().toLowerCase(), '#ff0000', 'and the first is unchanged');
  for (const t of [a, b, c]) { P.showcase.dispose(t.rig); t.node.dispose(); }
});

test('a hat is worn by a dog and a shoe model too, on their head anchor', async () => {
  P.models.reset && P.models.reset();
  P.modelRegistry = JSON.parse(JSON.stringify(P.modelRegistry));
  for (const [id, row] of Object.entries(standinRows())) P.models.register(id, row);
  P.models.setLoader((scene: any, url: string) => Promise.resolve(toContainer(B, scene, specOf(url))));
  P.models.reset();
  hats({ tophat: { url: '/t.glb', width: 0.58 } });
  for (const id of ['person', 'dog', 'toaster']) {
    const t = wear(id, 'tophat');
    await done(t.rig);
    assert.ok(P.hats.stats(t.rig), `${id}: model hat worn`);
    assert.equal(t.rig.hatModel.holder.parent, t.rig.neck, `${id}: on the head anchor`);
    assert.ok(t.rig.pm ? t.rig.neck.parent === t.rig.pm.anchors.head.node : true, `${id}: the neck is under the head anchor`);
    P.showcase.dispose(t.rig); t.node.dispose();
  }
});

test('a failed load, a file over the triangle budget, and a hat with no row fall back to the procedural hat', async () => {
  hats({ cap: { url: '/404.glb', width: 0.5 } }, () => Promise.reject(new Error('404')));
  const a = wear('person', 'cap');
  await done(a.rig);
  assert.ok(!P.hats.stats(a.rig) && procedural(a.rig), 'failed load: procedural cap');
  hats({ cap: { url: '/heavy.glb', width: 0.5 } }, (s: any) => Promise.resolve(hatContainer(s, 40)));
  const b = wear('person', 'cap');
  await done(b.rig);
  assert.ok(!P.hats.stats(b.rig) && procedural(b.rig), 'over budget: procedural cap');
  hats({});
  const c = wear('person', 'beanie');
  await done(c.rig);
  assert.ok(!P.hats.stats(c.rig) && procedural(c.rig), 'no row: procedural beanie');
  assert.deepEqual(loads, []);
  for (const t of [a, b, c]) { P.showcase.dispose(t.rig); t.node.dispose(); }
});

test('the hat rows in the registry name a file that is there and a hat the mirror has', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  for (const [kind, r] of Object.entries(hatsBefore) as any) {
    assert.ok(C.LOOK.hats.includes(kind), `${kind} is a hat`);
    assert.ok(fs.existsSync(path.join(process.cwd(), 'public', r.url)), `${r.url} exists`);
  }
});

test('every hat file is a GLB of at most ~1.5k triangles with its base at the origin, and the registry holds the made hats', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const made = Object.keys(hatsBefore);
  assert.ok(made.length >= 8, `made hats: ${made.join(',')}`);
  for (const kind of made) {
    const b = fs.readFileSync(path.join(process.cwd(), 'public', hatsBefore[kind].url));
    const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
    let tris = 0;
    for (const m of j.meshes) for (const p of m.primitives) tris += j.accessors[p.indices].count / 3;
    assert.ok(tris > 100 && tris <= 1500, `${kind}: ${tris} triangles`);
    const pos = j.accessors[j.meshes[0].primitives[0].attributes.POSITION];
    assert.ok(Math.abs(pos.min[1]) < 0.02, `${kind}: base at y = 0 (${pos.min[1]})`);
  }
});

test('a hat with a flat colour drops its texture, and a helmet with no pick takes the body colour', async () => {
  hats({ crown: { url: '/c.glb', width: 0.44, flat: '#facc15' }, helmet: { url: '/h.glb', width: 0.5, tint: 'body' } });
  const a = wear('person', 'crown');
  await done(a.rig);
  assert.equal(a.rig.hatModel.mats[0].albedoColor.toHexString().toLowerCase(), '#facc15');
  const b = wear('person', 'helmet', { accent: '#ffffff', body: '#2563eb' });
  await done(b.rig);
  assert.equal(b.rig.hatModel.mats[0].albedoColor.toHexString().toLowerCase(), '#2563eb');
  for (const t of [a, b]) { P.showcase.dispose(t.rig); t.node.dispose(); }
});

test('a plain hat drops its blotchy bake and still takes the pick', async () => {
  hats({ beanie: { url: '/b.glb', width: 0.44, tint: true, plain: true } });
  const a = wear('person', 'beanie', { accent: '#dc2626' });
  await done(a.rig);
  assert.equal(a.rig.hatModel.mats[0].albedoTexture, null);
  assert.equal(a.rig.hatModel.mats[0].albedoColor.toHexString().toLowerCase(), '#dc2626');
  const b = wear('person', 'beanie', { accent: '#ffffff' });
  await done(b.rig);
  assert.equal(b.rig.hatModel.mats[0].albedoTexture, null);
  assert.equal(b.rig.hatModel.mats[0].albedoColor.toHexString().toLowerCase(), '#ffffff');
  for (const t of [a, b]) { P.showcase.dispose(t.rig); t.node.dispose(); }
});

test('the halo, horns and bunny files (tools/hat-glbs.mjs) are under budget with nothing below the base, and each has a registry row', async () => {
  const fs = await import('node:fs');
  for (const kind of ['halo', 'horns', 'bunny']) {
    const b = fs.readFileSync(new URL(`../../public/play/models/hat-${kind}.glb`, import.meta.url));
    const jl = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jl).toString());
    const tris = j.accessors[j.meshes[0].primitives[0].indices].count / 3;
    assert.ok(tris > 100 && tris <= 1500, `${kind}: ${tris} triangles`);
    assert.equal(j.accessors[0].min[1], 0, `${kind}: base at y = 0, nothing below`);
    assert.ok(hatsBefore[kind] && hatsBefore[kind].url === `/play/models/hat-${kind}.glb` && hatsBefore[kind].flat, `${kind}: a registry row`);
  }
});
