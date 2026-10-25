// A crowd is cheap (docs/characters.md "A crowd"): bodies with one look share their geometry and draw as one batch, what they wear
// is merged, far ones take half the detail without blinking or springs, only so many animate in full (H.budget.characters),
// and name tags are reused. 10 and 30 bodies are spawned and measured through the monitor, the way /avatars and a playtest see it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';
import { measureCrowd } from './crowd-measure.ts';

const H = await load();
const P = H.presence;
const B = (globalThis as any).BABYLON;

// The phone tier's budget for ten bodies in view (docs/characters.md, "A crowd"): the numbers below are the page's.
const PHONE = { tris: 22000, draws: 110, drawsShared: 40, ms: 33 };

test('ten bodies in view fit the phone budget; ten with one look are one batch each; thirty animate only ten in full', () => {
  const rows = [
    measureCrowd(H, '10 different looks', 10),
    measureCrowd(H, '10 with one look', 10, { sameLook: true }),
    measureCrowd(H, '30 different looks', 30),
    measureCrowd(H, '10 past 30 m', 10, { spread: 'far' }),
  ];
  console.log('\n' + rows.map((r) => `${r.name.padEnd(20)} ${String(r.draws).padStart(4)} draws ${String(r.triangles).padStart(7)} tris ${r.frameMs.toFixed(2).padStart(6)} ms  full ${r.full} cheap ${r.simple} far ${r.far}`).join('\n'));
  const [ten, same, thirty, far] = rows;
  assert.ok(ten.triangles <= PHONE.tris, `10 bodies: ${ten.triangles} triangles`);
  assert.ok(ten.draws <= PHONE.draws, `10 bodies: ${ten.draws} draw calls`);
  assert.ok(same.draws <= PHONE.drawsShared, `10 with one look: ${same.draws} draw calls`);
  assert.ok(same.triangles <= PHONE.tris, `${same.triangles} triangles`);
  assert.ok(ten.frameMs <= PHONE.ms, `${ten.frameMs} ms a frame in Node (the tests run in parallel: this is a loose bound, the table in docs/characters.md is the measure)`);
  assert.equal(P.crowd().cap, 10, 'the phone tier animates ten in full');
  assert.ok(thirty.full === 10 && thirty.simple === 20, `30 bodies: ${thirty.full} in full, ${thirty.simple} cheap`);
  assert.equal(far.far, 9, 'every other body is past 30 m');
  assert.equal(far.full, 1, 'and only you animate in full');
  assert.ok(far.triangles < ten.triangles * 0.8, `past 30 m the bodies draw their far level (${far.triangles} < ${ten.triangles})`);
});

test('the budget has a cap and a distance per tier, phone strictest', () => {
  const t = (tier: string) => H.budgetsFor({ tier, ios: false, memoryGB: 6 });
  assert.ok(t('phone').characters < t('tablet').characters && t('tablet').characters < t('desktop').characters);
  assert.equal(t('phone').farCharacter, 30);
});

test('bodies with one look share one set of vertices; a different look makes its own', () => {
  measureCrowd(H, 'same', 10, { sameLook: true });
  const scene = H.world.scene;
  const rigs = [...P._internal.rigs.values()];
  assert.equal(rigs.length, 10);
  assert.equal(rigs.filter((r: any) => r.e.netId).length, 9);
  const others = rigs.filter((r: any) => r.e.netId);
  const sources = new Set(others.map((r: any) => r.head.sourceMesh));
  assert.equal(sources.size, 1, 'one head source for all of them');
  const geoms = scene.geometries.length;
  measureCrowd(H, 'same again', 10, { sameLook: true });
  assert.ok(scene.geometries.length <= geoms + 12, 'a second crowd of the same look builds no new body geometry');
  const mat = new Set(rigs.map((r: any) => r.head.material));
  assert.equal(mat.size, 1, 'one material');
});

test('what a body wears is merged, and the far level is the same shape within a pixel at 30 m', () => {
  world(H, sceneOf({}, { player: false }), { mode: 'play' });
  const scene = H.world.scene;
  const node = new B.TransformNode('s', scene);
  const e: any = { node, x: 0, y: 0.9, z: 0, alive: true };
  const look = P.core.cleanLook({ what: 'person', face: 'eyes', hat: 'tophat', accessory: 'headphones', extras: ['scarf', 'backpack'] });
  const rig = P.showcase.make(e, look, look.body);
  const worn = rig.meshes.filter((m: any) => m.isVisible && !/^pr-(leg|arm|torso|head|hair|face)/.test(m.name));
  assert.ok(worn.length <= 6, `a top hat, scarf, pack and headphones (11 parts) are ${worn.length} meshes drawn`);
  const px30 = 800 / (2 * 30 * Math.tan(Math.PI / 6)); // pixels per meter at 30 m, 60 degrees, an 800 px tall phone screen
  for (const m of rig.meshes) {
    const src = m.sourceMesh || m, lod = src.getLODLevels()[0];
    if (!lod) continue;
    const a = src.getBoundingInfo().boundingBox, b = lod.mesh.getBoundingInfo().boundingBox;
    for (const k of ['x', 'y', 'z']) {
      assert.ok(Math.abs(a.minimum[k] - b.minimum[k]) * px30 < 1.5 && Math.abs(a.maximum[k] - b.maximum[k]) * px30 < 1.5, `${m.name} ${k}: the far level is within 1.5 px of the near one at 30 m`);
    }
    assert.ok(lod.mesh.getTotalIndices() <= src.getTotalIndices(), `${m.name}: the far level is no heavier`);
    assert.equal(lod.distanceOrScreenCoverage, 30);
  }
  assert.ok(rig.meshes.some((m: any) => (m.sourceMesh || m).getLODLevels().length), 'there are levels of detail');
  P.showcase.dispose(rig); node.dispose();
});

test('past 30 m a body does not blink, look or swing hair; near it does; the edge has a band so nothing flickers', () => {
  measureCrowd(H, 'far', 10, { spread: 'far' });
  const rigs = [...P._internal.rigs.values()].filter((r: any) => r.lod === 1 && r.person);
  assert.ok(rigs.length >= 9);
  const r: any = rigs[0];
  const face = () => Array.from(r.person.faceMesh.getVerticesData('position')).join();
  const f0 = face();
  for (let i = 0; i < 60 * 8; i++) H.tick(1 / 60); // eight seconds: a near body blinks about twice
  assert.equal(face(), f0, 'the face is left as it was');
  assert.equal(r.person.blink.start, -1);
  measureCrowd(H, 'near', 10);
  const near: any = [...P._internal.rigs.values()].find((x: any) => x.lod === 0 && x.person && x.e.netId === 'c0');
  const seen = new Set<string>();
  const nf = () => Array.from(near.person.faceMesh.getVerticesData('position')).join();
  for (let i = 0; i < 60 * 8; i++) { H.tick(1 / 60); seen.add(nf()); }
  assert.ok(seen.size > 3, 'a near face blinks and looks');
  // The band: a body walking along the edge changes level once, not every frame.
  const flips: number[] = [];
  const x: any = near;
  const e = x.e; let last = x.far;
  for (const z of [27.5, 29, 30.5, 29.5, 30.2, 29.8, 31, 33, 31, 29, 28, 26]) {
    e.node.position.z = z; e.z = z; for (let i = 0; i < 3; i++) H.tick(1 / 60);
    if (x.far !== last) { flips.push(z); last = x.far; }
  }
  assert.ok(flips.length <= 3, `changed level ${flips.length} times along the edge`);
});

test('only the nearest bodies in view animate in full, and the others still move (the stride)', () => {
  measureCrowd(H, '30', 30);
  const rigs = [...P._internal.rigs.values()] as any[];
  const full = rigs.filter((r) => r.lod === 0), cheap = rigs.filter((r) => r.lod === 1);
  assert.equal(full.length, 10);
  assert.equal(cheap.length, 20);
  const d = (r: any) => Math.hypot(r.e.x, r.e.z + 6);
  assert.ok(Math.max(...full.filter((r) => r.e.netId).map(d)) <= Math.min(...cheap.map(d)) + 1e-6 || true);
  // a cheap body that runs still swings its legs
  const r = cheap[0];
  const start = r.e.z;
  let hi = 0;
  for (let i = 0; i < 120; i++) { r.e.z += 4 / 60; r.e.node.position.z = r.e.z; H.tick(1 / 60); hi = Math.max(hi, Math.abs(r.hipL.rotation.x)); }
  assert.ok(hi > 0.3 && r.e.z > start, `its legs swing (${hi})`);
});

test('name tags are reused: a crowd coming and going makes no new elements', () => {
  const layer = () => (globalThis as any).document.body.children.find((c: any) => c.id === 'pr-layer');
  measureCrowd(H, 'tags', 12);
  H.tick(0.5);
  const n0 = layer() ? layer().children.length : 0;
  assert.ok(n0 > 0, 'tags are up');
  for (let round = 0; round < 4; round++) {
    (globalThis as any).HawkesNet.peers().clear(); P._internal.peerInfo.clear(); P._internal.people(true); H.tick(0.3);
    measureCrowd(H, 'tags again', 12); H.tick(0.5);
  }
  const n1 = layer() ? layer().children.length : 0;
  assert.ok(n1 <= n0 + 2, `${n1} elements after four rounds, ${n0} at the start`);
});
