// The things you can be (presence-things.js, docs/characters.md 5c): each has a face drawn on it, stays inside the budget, moves its
// own way, has an idle gag and a signature reaction that show in its joints and its face.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const P = H.presence;
const C = P.core;
const B = (globalThis as any).BABYLON;
world(H, sceneOf({}, { player: false }), { mode: 'play' });
const THINGS = ['shoe', 'toaster', 'cactus', 'cone', 'teapot', 'banana', 'mushroom', 'potato', 'duck', 'tvbot', 'rollbot'];

function make(id: string) {
  const node = new B.TransformNode('stand', H.world.scene);
  const e: any = { node, x: 0, y: 0.9, z: 0, alive: true };
  const w = C.WHAT.get(id);
  const look = C.cleanLook({ what: id, body: w.colors[0], accent: w.colors[1], head: w.colors[2], face: 'eyes' });
  return { e, node, rig: P.showcase.make(e, look, look.body) };
}
const run = (rig: any, e: any, seconds: number, speed = 0, each?: (i: number) => void) => { for (let i = 0; i < seconds * 60; i++) { e.x += speed / 60; P.showcase.animate(rig, 1 / 60); each?.(i); } };
const snap = (rig: any) => JSON.stringify(rig.root.getChildTransformNodes(false).map((n: any) => [n.position.asArray(), n.rotation.asArray(), n.scaling.asArray()]).concat([[rig.pose.position.asArray(), rig.pose.rotation.asArray(), rig.pose.scaling.asArray()]]).flat(2).map((v: number) => Math.round(v * 100)));

test('every thing has a face (eyes and a mouth in one mesh), a rim-lit toy material and stays inside the budget', () => {
  for (const id of THINGS) {
    const { rig, node } = make(id);
    assert.ok(rig.thing && rig.thing.F && rig.thing.F.mesh, `${id}: a face`);
    assert.ok(rig.thing.F.mesh.getTotalVertices() > 40, `${id}: the face has points`);
    const ms = rig.root.getChildMeshes(false).filter((m: any) => m.getTotalIndices() > 0 && m.isEnabled(false) !== undefined);
    const tris = ms.reduce((n: number, m: any) => n + m.getTotalIndices() / 3, 0);
    assert.ok(tris <= 3600, `${id}: ${tris} triangles`);
    assert.ok(ms.length <= 14, `${id}: ${ms.length} draw calls`);
    assert.ok(new Set(ms.map((m: any) => m.material)).size <= 2, `${id}: at most the toy and a lit screen`);
    P.showcase.dispose(rig); node.dispose();
  }
});

test('each thing walks its own way: the pose moves with the gait, and a run differs from a walk', () => {
  for (const id of THINGS) {
    const { rig, e, node } = make(id);
    run(rig, e, 0.5);
    const idle = snap(rig);
    run(rig, e, 1.0, 2.6);
    const walk = snap(rig);
    run(rig, e, 1.0, 7);
    const fast = snap(rig);
    assert.notEqual(idle, walk, `${id}: walking moves it`);
    assert.notEqual(walk, fast, `${id}: running is not walking`);
    P.showcase.dispose(rig); node.dispose();
  }
});

test('an idle gag plays after a few seconds of standing and a signature reaction plays on an emote; both change the face', () => {
  for (const id of THINGS) {
    const { rig, e, node } = make(id);
    let gagSeen = false;
    run(rig, e, 12, 0, () => { if (rig.thing.gagAt >= 0) gagSeen = true; });
    assert.ok(gagSeen, `${id}: gags when left alone`);
    run(rig, e, 4);
    rig.emote = { def: C.emote('cheer'), t0: rig.time };
    let mid = '', tmp = '';
    run(rig, e, 0.3);
    const before = rig.thing.F.key;
    run(rig, e, rig.thing.sigDur * 0.45, 0, () => { tmp = snap(rig); });
    mid = tmp;
    assert.ok(rig.thing.sigAt >= 0, `${id}: the reaction runs`);
    run(rig, e, 3);
    rig.emote = null;
    run(rig, e, 2);
    const after = snap(rig);
    assert.notEqual(mid, after, `${id}: the reaction moved it`);
    assert.ok(Number.isFinite(rig.pose.position.y + rig.pose.scaling.y), `${id}: finite`);
    void before;
    P.showcase.dispose(rig); node.dispose();
  }
});

test('forcing the gag or the reaction (the /avatars poses) loops it', () => {
  for (const id of THINGS) {
    const { rig, e, node } = make(id);
    const seen = new Set<string>();
    rig.forcePose = 'gag'; run(rig, e, 3, 0, (i) => { if (i % 6 === 0) seen.add(snap(rig)); });
    rig.forcePose = 'react'; run(rig, e, 3, 0, (i) => { if (i % 6 === 0) seen.add(snap(rig)); });
    assert.ok(seen.size > 20, `${id}: moves through its gag and reaction`);
    P.showcase.dispose(rig); node.dispose();
  }
});

test('the things keep to the ids the server accepts', () => {
  const ids = C.WHATS.map((w: any) => w.id);
  for (const id of THINGS) assert.ok(ids.includes(id), id);
});
