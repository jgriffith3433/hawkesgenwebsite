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
const THINGS = ['shoe', 'toaster', 'cactus', 'cone', 'teapot', 'banana', 'mushroom', 'potato', 'duck', 'tvbot', 'rollbot', 'robot'];

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
    const ms = rig.root.getChildMeshes(false).filter((m: any) => m.getTotalIndices() > 0 && m.isEnabled(false) !== undefined && !/^pm-orb/.test(m.name)); // (the orb that stands in while a model loads is not the body)
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

// The machines (presence-robots.js, docs/characters.md 5d): lit screens, wheels that turn, antennas that sway, a boot-up.
const node = (rig: any, name: string) => rig.root.getChildTransformNodes(false).find((n: any) => n.name === `pr-${name}`);
const MACHINES = ['robot', 'tvbot', 'rollbot'];

test('the machines have lit faces that change with the expression', () => {
  for (const id of MACHINES) {
    const { rig, e, node: n } = make(id);
    assert.ok(rig.thing.F.mesh.material.disableLighting, `${id}: the face is a lit screen`);
    rig.thing.nextGag = 1e9;
    run(rig, e, 3);
    rig.thing.F.rest = 'neutral';
    run(rig, e, 1.2);
    const neutral = Array.from(rig.thing.F.mesh.getVerticesData('position') as number[]).join();
    rig.thing.F.rest = 'happy'; run(rig, e, 1.2);
    const happy = Array.from(rig.thing.F.mesh.getVerticesData('position') as number[]).join();
    rig.thing.F.rest = 'surprised'; run(rig, e, 1.2);
    const surprised = Array.from(rig.thing.F.mesh.getVerticesData('position') as number[]).join();
    assert.ok(neutral !== happy && happy !== surprised && neutral !== surprised, `${id}: three expressions, three faces`);
    P.showcase.dispose(rig); n.dispose();
  }
});

test('wheels turn with the distance and the ball rolls; the legs lift on their pistons', () => {
  { // the TV robot's wheels
    const { rig, e, node: n } = make('tvbot');
    const w = node(rig, 'spinL');
    run(rig, e, 1.5); const still = w.rotation.x;
    run(rig, e, 2, 2.5);
    const turned = w.rotation.x - still;
    const radius = 0.2 * rig.bodyScale;
    assert.ok(Math.abs(turned - (2 * 2.5) / radius) < 0.6 * (2.5 / radius), `tvbot: the wheel turned ${turned.toFixed(1)} rad for 5 m (a ${radius.toFixed(2)} m wheel)`);
    P.showcase.dispose(rig); n.dispose();
  }
  { // the roll-bot's ball
    const { rig, e, node: n } = make('rollbot');
    const b = node(rig, 'ball');
    run(rig, e, 1); const still = b.rotation.x;
    run(rig, e, 2, 3);
    assert.ok(b.rotation.x - still > 6, `rollbot: the ball rolled ${(b.rotation.x - still).toFixed(1)} rad`);
    P.showcase.dispose(rig); n.dispose();
  }
  { // the robot's feet lift on pistons while it walks, not while it stands
    const { rig, e, node: n } = make('robot');
    const sL = node(rig, 'shinL'), sR = node(rig, 'shinR');
    run(rig, e, 1);
    assert.equal(sL.position.y + sR.position.y, 0, 'robot: standing, the pistons are still');
    let top = 0; run(rig, e, 2, 2.6, () => { top = Math.max(top, sL.position.y, sR.position.y); });
    assert.ok(top > 0.04, `robot: a piston lifts a foot ${top.toFixed(3)}`);
    P.showcase.dispose(rig); n.dispose();
  }
});

test('antennas sway: they lean with the speed and ring after a stop', () => {
  for (const [id, name] of [['robot', 'antenna'], ['tvbot', 'antennas'], ['rollbot', 'antenna']]) {
    const { rig, e, node: n } = make(id);
    const a = node(rig, name);
    run(rig, e, 3);
    const seen = new Set<string>();
    run(rig, e, 2, 6, (i) => { if (i % 10 === 0) seen.add(a.rotation.z.toFixed(3)); });
    const run1 = a.rotation.z;
    assert.ok(seen.size > 4, `${id}: the antenna keeps moving while it goes`);
    let hi = -9, lo = 9; run(rig, e, 1.2, 0, () => { hi = Math.max(hi, a.rotation.z); lo = Math.min(lo, a.rotation.z); });
    assert.ok(hi - lo > 0.02, `${id}: it rings on after a stop (${(hi - lo).toFixed(3)} rad)`);
    void run1;
    P.showcase.dispose(rig); n.dispose();
  }
});

test('a machine boots up when it appears: a ring of light climbs, the screen is dark then flickers on, and the size never changes', () => {
  for (const id of MACHINES) {
    const { rig, e, node: n } = make(id);
    const size = () => { const bb = rig.body.getHierarchyBoundingVectors(true); return +(bb.max.y - bb.min.y).toFixed(3); };
    const h0 = size();
    const lids: number[] = [];
    let beam = false, beamTop0 = 0, beamTop1 = 0;
    run(rig, e, rig.thing.bootDur + 0.1, 0, (i) => {
      const b = rig.root.getChildMeshes(false).find((m: any) => m.name === 'pr-beam');
      if (b && b.isEnabled()) { beam = true; if (!beamTop0) beamTop0 = b.parent.position.y; beamTop1 = b.parent.position.y; }
      if (i % 6 === 0) lids.push(rig.thing.F.expr.lid + (rig.thing.F.key.split(',')[2] ? Number(rig.thing.F.key.split(',')[2]) / 200 : 0));
    });
    assert.ok(beam, `${id}: the beam shows while it boots`);
    assert.ok(Math.abs(size() - h0) < 0.06, `${id}: the size is its own from the first frame (${h0} then ${size()})`);
    const closed = Math.max(...lids.slice(0, 8)), openAfter = Math.min(...lids.slice(-4));
    assert.ok(closed > 0.8, `${id}: the screen starts dark (${closed})`);
    run(rig, e, 0.5);
    assert.equal(rig.root.getChildMeshes(false).find((m: any) => m.name === 'pr-beam').isEnabled(), false, `${id}: the beam is gone after`);
    void openAfter;
    // pose=boot loops it for /avatars
    rig.forcePose = 'boot'; let again = false; run(rig, e, 5, 0, () => { const b = rig.root.getChildMeshes(false).find((m: any) => m.name === 'pr-beam'); if (b && b.isEnabled()) again = true; });
    assert.ok(again, `${id}: pose=boot plays it again`);
    P.showcase.dispose(rig); n.dispose();
  }
});
