// The frame's cost (public/play/scale.js and the modules' stand-ins): shadows only from near things the camera can see
// the shadows of, lamps lighting only what's in their range, stand-ins drawn as one mesh per material (moving parts
// kept apart), no moving bodies with triangle colliders, and vehicles' rays against the colliders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const B = (globalThis as any).BABYLON;
const floor = { type: 'box', shape: { size: [900, 1, 900] }, transform: { position: [0, -0.5, 0] } };
const box = (x: number, y: number, z: number) => ({ type: 'box', transform: { position: [x, y, z] } });
const half = () => H.tick(0.6); // (scale.js judges twice a second)

function castersDrawn() {
  const sc = H.world.scene;
  sc.render();
  const map = H.world.shadows.getShadowMap();
  return map.getCustomRenderList(0, map.renderList, map.renderList.length) || map.renderList;
}

test('shadows: only near things whose shadow can be seen are drawn into the shadow map, none looking at the sky', () => {
  world(H, sceneOf({ floor, ahead: box(0, 0.5, 12), behind: box(0, 0.5, -40), far: box(0, 0.5, 600) }, { shadows: true, player: false }));
  H.game.camera.fixed([0, 2, 0], [0, 1, 12]);
  half();
  const drawn = castersDrawn();
  const has = (id: string) => [...H.game.entity(id)._casters].some((m: any) => drawn.includes(m));
  assert.ok(has('ahead'), 'the box in front casts');
  assert.ok(!has('behind'), 'behind the camera: its shadow is out of view');
  assert.ok(!has('far'), `past the shadow distance (${H.budget.shadowDistance} m)`);
  assert.ok(H.world.shadows.getShadowMap().renderList.length >= 3, 'every caster stays in the list (modules add theirs)');
  H.game.camera.fixed([0, 2, 0], [0, 200, 1]);
  half();
  assert.ok(!castersDrawn().some((m: any) => H.game.entity('ahead')._casters.has(m)), 'looking at the sky: nothing to shade');
});

test('the shadow map is drawn again only when a caster moved', () => {
  world(H, sceneOf({ floor, a: box(0, 0.5, 8), b: { ...box(2, 0.5, 8), physics: 'static' } }, { shadows: true, player: false }));
  H.game.camera.fixed([0, 2, 0], [0, 1, 8]);
  half();
  const map = H.world.shadows.getShadowMap();
  // (Babylon also redraws a map while one of its meshes isn't ready, which a test engine's never quite are: counted
  // here is how often scale.js asks for it to be drawn again.)
  const asked = () => map._hpRedraws || 0;
  const frames = (n: number) => { for (let i = 0; i < n; i++) { H.tick(1 / 60); H.world.scene.render(); } };
  frames(5);
  assert.equal(map.refreshRate, 0, 'drawn when asked');
  const n0 = asked();
  frames(10);
  assert.ok(asked() - n0 <= 1, `nothing moved: asked ${asked() - n0} times in 10 frames`);
  H.game.entity('b').position = [3, 0.5, 8];
  frames(3);
  assert.ok(asked() - n0 >= 1, 'a caster moved: asked to be drawn again');
});

test('lamps with a range light only the meshes in it', () => {
  world(H, sceneOf({ floor, lamp: { type: 'light', light: { type: 'point', range: 6 }, transform: { position: [0, 2, 0] } }, near: box(2, 0.5, 0), far: box(60, 0.5, 0) }, { player: false }));
  half();
  const l = H.game.entity('lamp')._light;
  assert.ok(l.includedOnlyMeshes.length > 0);
  assert.ok(l.includedOnlyMeshes.includes(H.game.entity('near').node), 'the box beside it is lit');
  assert.ok(!l.includedOnlyMeshes.includes(H.game.entity('far').node), 'the box 60 m away is not');
  assert.ok(!H.game.entity('far').node.lightSources.includes(l), 'so its shader has one light fewer');
  H.game.entity('far').position = [3, 0.5, 2];
  H.world.scene.render(); // (bounds as drawn: each frame works out where everything is)
  half();
  assert.ok(l.includedOnlyMeshes.includes(H.game.entity('far').node), 'brought near, it is lit');
});

test('H.mergeParts: fixed parts become one mesh per material; kept parts and other materials stay apart', () => {
  world(H, sceneOf({ floor }, { player: false }));
  const sc = H.world.scene;
  const root = new B.TransformNode('thing', sc);
  root.position.set(5, 0, 0);
  const red = new B.StandardMaterial('red', sc), blue = new B.StandardMaterial('blue', sc);
  const part = (x: number, mat: any, keep = false) => { const m = B.MeshBuilder.CreateBox('p', { size: 1 }, sc); m.parent = root; m.position.set(x, 1, 0); m.rotation.y = 0.3; m.material = mat; if (keep) m.metadata = { keep: true }; return m; };
  const parts = [part(0, red), part(2, red), part(4, red), part(6, blue), part(8, red, true)];
  const verts = parts.slice(0, 3).reduce((n, m) => n + m.getTotalVertices(), 0);
  root.computeWorldMatrix(true);
  const before = root.getHierarchyBoundingVectors(true);
  const out = H.mergeParts(parts, { keep: (m: any) => Boolean(m.metadata && m.metadata.keep) });
  assert.equal(out.length, 3, 'the three red ones as one, the blue one, the kept one');
  const joined = out.find((m: any) => m.material === red && !(m.metadata && m.metadata.keep));
  assert.equal(joined.getTotalVertices(), verts);
  assert.equal(joined.parent, root, 'still the thing\'s: it moves with it');
  assert.ok(parts.slice(0, 3).every((m: any) => m.isDisposed()) && !parts[4].isDisposed());
  root.computeWorldMatrix(true);
  const after = root.getHierarchyBoundingVectors(true);
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(before.min[k] - after.min[k]) < 1e-4 && Math.abs(before.max[k] - after.max[k]) < 1e-4, `where it was (${k})`);
});

test('a car is a handful of meshes; its wheels still turn on their own', () => {
  world(H, sceneOf({ floor, car: { type: 'car', transform: { position: [0, 0.6, 0] } } }, { player: false }));
  H.tick(0.2);
  const v = H.game.entity('car').vehicle;
  const body = v.body.getChildMeshes(true);
  assert.ok(body.length <= 8, `the body in ${body.length} meshes (one per material), not ~20 parts`);
  assert.ok(v.wheels.every((w: any) => w.tire && !w.tire.isDisposed() && w.tire.parent === w.spinNode), 'each tire under its own spinner');
  assert.ok(v.lampMeshes.length >= 1 && v.lampMeshes.every((m: any) => !m.isDisposed()));
  assert.ok(v.parts.every((m: any) => !m.isDisposed()));
});

test('a house is drawn in a few meshes; a piece that goes is drawn on its own again', () => {
  world(H, sceneOf({ floor, home: { type: 'house', shape: { rooms: 2, furnish: false }, transform: { position: [6, 0, -4], rotation: [0, 30, 0] } } }, { player: false }));
  H.tick(0.2);
  const home = H.game.entity('home');
  const pieces = home._parts.map((x: any) => x.e).filter((e: any) => e._together);
  assert.ok(pieces.length > 10, `pieces drawn together (${pieces.length})`);
  assert.ok(home._drawn.filter((g: any) => g.mesh).length < pieces.length / 2, 'in far fewer meshes');
  assert.ok(pieces.every((e: any) => !e.node.isVisible && (e.physics === 'none' || e._pb)), 'each piece still a body, just not drawn itself');
  for (const gr of home._drawn.filter((x: any) => x.mesh)) {
    // (Every vertex in the world, its pieces' and its own: the same lowest and highest corners.)
    const box = (ms: any[]) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const m of ms) { m.computeWorldMatrix(true); const p = m.getVerticesData(B.VertexBuffer.PositionKind); const wm = m.getWorldMatrix(); for (let i = 0; i < p.length; i += 3) { const v = B.Vector3.TransformCoordinates(new B.Vector3(p[i], p[i + 1], p[i + 2]), wm); [v.x, v.y, v.z].forEach((x, k) => { lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x); }); } } return [...lo, ...hi]; };
    const a = box(gr.members.map((e: any) => e.node)), b = box([gr.mesh]);
    assert.ok(a.every((v: number, i: number) => Math.abs(v - b[i]) < 1e-3), `drawn where its pieces are (${a.map((v: number) => v.toFixed(2))} / ${b.map((v: number) => v.toFixed(2))})`);
  }
  const wall = pieces[0];
  const g = wall._together;
  wall.destroy();
  H.tick(0.6);
  assert.equal(g.mesh, null, 'its group is drawn piece by piece');
  assert.ok(g.members.filter((e: any) => e.alive).every((e: any) => e.node.isVisible));
});

test('moving things never get a triangle collider (their convex hull instead)', () => {
  world(H, sceneOf({ floor, ring: { type: 'torus', physics: 'dynamic', body: { shape: 'mesh' }, transform: { position: [0, 3, 0] } }, still: { type: 'torus', physics: 'static', body: { shape: 'mesh' }, transform: { position: [4, 1, 0] } } }, { player: false }));
  H.tick(0.1);
  assert.equal(H.physics.bodyOf(H.game.entity('ring')).shape.type, B.PhysicsShapeType.CONVEX_HULL);
  assert.equal(H.physics.bodyOf(H.game.entity('still')).shape.type, B.PhysicsShapeType.MESH);
});

test('vehicles\' rays hit colliders, not every triangle in the world', () => {
  world(H, sceneOf({ floor, car: { type: 'car', transform: { position: [0, 0.6, 0] } } }, { player: false }));
  const sc = H.world.scene;
  let picks = 0;
  const pick = sc.pickWithRay;
  sc.pickWithRay = function (...a: any[]) { picks++; return pick.apply(this, a); };
  try { H.tick(1); } finally { sc.pickWithRay = pick; }
  assert.equal(picks, 0, 'no scene picking for the wheels');
  assert.ok(H.game.entity('car').vehicle.wheels.some((w: any) => w.contact), 'and the wheels still stand on the floor');
});
