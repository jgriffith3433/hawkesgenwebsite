// The terrain module (public/play/modules/terrain): ground made from words, its collider on Havok, digging, craters,
// the shovel and edits saved in scene.json. Runs the real engine in Node (harness.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const T = (globalThis as any).HawkesTerrainCore;
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b}`);

test('every shape is made from words, with the spawn area kept usable', () => {
  for (const shape of Object.keys(T.SHAPES)) {
    const f = T.generate({ shape, size: 256 });
    assert.ok(f.heights.every(Number.isFinite), `${shape}: heights are numbers`);
    const h0 = T.heightAt(f, 0, 0);
    assert.ok(h0 > -1 && h0 < 6, `${shape}: the spawn is near ground level (${h0})`);
  }
  assert.equal(T.normalize('a tropical island').shape, 'island');
  assert.equal(T.normalize({ shape: 'volcano' }).shape, 'mountain');
  const m = T.generate({ shape: 'mountain' });
  assert.ok(m.max > 60, `the mountain is tall (${m.max})`);
  assert.ok(m.road && m.road.length > 50, 'with a road up it');
  let steepest = 0;
  for (let i = 1; i < m.road.length; i++) {
    const [a, b] = [m.road[i - 1], m.road[i]];
    steepest = Math.max(steepest, Math.abs(T.heightAt(m, b[0], b[1]) - T.heightAt(m, a[0], a[1])) / Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  assert.ok(steepest < 0.3, `the road is drivable (steepest grade ${steepest.toFixed(2)})`);
  near(T.heightAt(m, ...m.road.at(-1)), m.max * 0.85, 12, 'the road reaches near the top');
});

test('edits: a giant hole, a pile, flatten, paint; the same edits make the same ground', () => {
  const f = T.generate({ shape: 'flat' });
  T.applyEdit(f, ['hole', 20, 15, 10, 10]);
  near(T.heightAt(f, 10, 10), -15, 0.01, 'the bottom of the hole');
  near(T.heightAt(f, 40, 10), 0, 0.01, 'outside the hole');
  T.applyEdit(f, ['raise', 4, 3, -20, 0]);
  near(T.heightAt(f, -20, 0), 3, 0.01, 'a pile');
  T.applyEdit(f, ['paint', 5, 4, 30, 30]);
  assert.equal(T.layerAt(f, 30, 30), 'sand');
  const a = T.generate({ shape: 'hills', seed: 4, edits: [['dig', 3, 2, 1, 1, 2, 2], ['flatten', 8, 5, -30, -30]] });
  const b = T.generate({ shape: 'hills', seed: 4, edits: [['dig', 3, 2, 1, 1, 2, 2], ['flatten', 8, 5, -30, -30]] });
  assert.deepEqual(Array.from(a.heights.slice(0, 2000)), Array.from(b.heights.slice(0, 2000)));
  assert.ok(Math.abs(T.heightAt(a, -30, -30) - 5) < 1.5, 'flattened toward 5 m');
});

test('the ground is a heightfield on Havok: things land on the surface where it says, slopes included', () => {
  world(H, sceneOf({}, { terrain: { shape: 'mountain', scatter: false } }));
  assert.equal(H.physics.engine, 'havok');
  assert.ok(H.terrain.active);
  const spots = [[20, 30], [-60, 90], [40, 150], [100, -50], [0, 200]];
  const balls = spots.map(([x, z]) => H.game.sphere({ x, z, y: H.terrain.heightAt(x, z) + 4, radius: 0.5, physics: 'dynamic' }));
  const crates = spots.map(([x, z]) => H.game.box({ x: x + 3, z, y: H.terrain.heightAt(x + 3, z) + 3, size: 1, physics: 'dynamic', friction: 1 }));
  H.tick(1.2);
  for (const [i, b] of balls.entries()) {
    const g = H.terrain.heightAt(b.x, b.z);
    assert.ok(b.y - 0.5 > g - 0.35 && b.y - 0.5 < g + 1.2, `ball ${i} is on the ground at ${spots[i]} (bottom ${(b.y - 0.5).toFixed(2)}, ground ${g.toFixed(2)})`);
  }
  for (const c of crates) assert.ok(c.y > H.terrain.heightAt(c.x, c.z) - 0.6, 'crates did not fall through');
  // A ball on the mountain's side rolls downhill.
  const ball = H.game.sphere({ x: 0, z: 110, y: H.terrain.heightAt(0, 110) + 1, radius: 0.5, physics: 'dynamic' });
  const start = H.terrain.heightAt(0, 110);
  H.tick(3);
  assert.ok(ball.y < start - 3, `the ball rolled down (${start.toFixed(1)} -> ${ball.y.toFixed(1)})`);
});

test('terrain away from the origin lines up with its collider; tree trunks are solid', () => {
  world(H, sceneOf({}, { terrain: { shape: 'flat', size: 128, center: [60, -40], add: [{ type: 'hill', at: [80, -30], radius: 15, height: 9 }], scatter: { trees: 40, rocks: 0, bushes: 0 } } }));
  const ball = H.game.sphere({ x: 80, z: -30, y: 14, radius: 0.5, physics: 'dynamic' });
  H.tick(1.5);
  near(ball.y - 0.5, H.terrain.heightAt(ball.x, ball.z), 0.4, 'the ball sits on the hill');
  const trees = H.terrain._cur.scatter.groups.find((g: any) => g.kind === 'trees');
  assert.ok(trees && trees.pts.length > 10, 'trees were scattered');
  const [tx, tz] = trees.pts[0];
  const hit = H.physics.raycast([tx - 4, H.terrain.heightAt(tx, tz) + 1, tz], [1, 0, 0], 8);
  assert.ok(hit && hit.entity && hit.entity.isScatter, 'a ray at a trunk hits the tree');
});

test('the player walks up the mountain road', () => {
  world(H, sceneOf({}, { terrain: { shape: 'mountain', scatter: false } }));
  const p = H.game.player;
  const road = H.terrain.road;
  p.position = [road[0][0], H.terrain.heightAt(road[0][0], road[0][1]) + 1.2, road[0][1]];
  let k = 0;
  H.game.onUpdate(() => {
    while (k < road.length - 1 && Math.hypot(road[k][0] - p.x, road[k][1] - p.z) < 3) k++;
    const t = road[k], d = [t[0] - p.x, t[1] - p.z], l = Math.hypot(d[0], d[1]) || 1;
    p.walk({ x: d[0] / l, z: d[1] / l }, 9);
  });
  H.tick(30);
  assert.ok(k > road.length * 0.5, `got past halfway up the road (${k} of ${road.length})`);
  assert.ok(p.y > 30, `and high up (${p.y.toFixed(1)})`);
  assert.ok(p.y > H.terrain.heightAt(p.x, p.z) - 0.3, 'on the ground, not in it');
});

test('dig a giant hole: what stood there falls in; explosions leave craters', () => {
  world(H, sceneOf({ crate: { type: 'box', physics: 'dynamic', transform: { position: [30, 0.5, 20] } } }, { terrain: { shape: 'flat', scatter: false } }));
  H.tick(0.5);
  H.game.terrain.dig(30, 20, 20, 15);
  H.tick(3);
  const crate = H.game.entity('crate');
  assert.ok(crate.y < -13, `the crate fell into the hole (${crate.y.toFixed(1)})`);
  const before = H.terrain.heightAt(-40, -40);
  // The engine's explosion event: only the one who decided it (authoritative) digs; everyone gets the edit.
  H.physics.announce({ position: [-40, before, -40], radius: 8, force: 20, authoritative: false });
  assert.equal(H.terrain.heightAt(-40, -40), before, 'not where it was only seen');
  H.physics.explode([-40, before, -40], { radius: 8, force: 20 });
  assert.ok(H.terrain.heightAt(-40, -40) < before - 1, 'a crater');
  H.game.emit('explosion', { at: [40, 60, 40], radius: 8 });
  near(H.terrain.heightAt(40, 40), 0, 0.01, 'no crater under an explosion high in the air');
});

test('the shovel digs where you look and throws the dirt beside the hole', () => {
  world(H, sceneOf({}, { terrain: { shape: 'flat', scatter: false } }));
  const p = H.game.player;
  p.tool = 'shovel';
  H.tick(0.1);
  H.world.camera.yaw = 0; H.world.camera.pitch = 0.7;
  H.tick(0.05);
  const def = H.tools.get('shovel');
  const ctx = { game: H.game, H, player: p, opts: {}, state: {} };
  const aim = H.game.aim(6);
  assert.ok(aim && aim.entity && aim.entity.isTerrain, 'aiming at the ground');
  for (let i = 0; i < 4; i++) assert.ok(def.use(ctx, false));
  assert.ok(H.terrain.heightAt(aim.point[0], aim.point[2]) < -1, 'a hole');
  const f = H.terrain.field;
  let piled = 0;
  for (let i = 0; i < f.heights.length; i++) if (f.heights[i] > 0.2) piled++;
  assert.ok(piled > 5, 'and a pile beside it');
  assert.equal(H.terrain.materialAt(aim.point[0], aim.point[2]), 'dirt');
});

test('edits saved in scene.json come back; the brush adds strokes without rebuilding; turning it off removes it', () => {
  world(H, sceneOf({}, { terrain: { shape: 'flat', scatter: false, add: [{ type: 'hill', at: [20, 20], radius: 15, height: 8 }], edits: [['raise', 5, 4, -20, -20]] } }));
  near(H.terrain.heightAt(20, 20), 8, 0.01, 'the hill');
  near(H.terrain.heightAt(-20, -20), 4, 0.01, 'the saved edit');
  const field = H.terrain.field;
  H.applyOps([{ op: 'config', patch: { terrain: { edits: [['raise', 5, 4, -20, -20], ['lower', 5, 2, 40, 0]] } } }]);
  assert.equal(H.terrain.field, field, 'a new stroke edits the same ground');
  near(H.terrain.heightAt(40, 0), -2, 0.01, 'the stroke');
  H.applyOps([{ op: 'config', patch: { terrain: { shape: 'island' } } }]);
  assert.equal(H.terrain.info.shape, 'island');
  H.applyOps([{ op: 'config', patch: { terrain: null } }]);
  assert.equal(H.terrain.active, false);
  assert.equal(H.terrain.heightAt(0, 0), null);
});

test('terrain over a world that has a flat ground: the ground hides, the player and loose things end up on top', () => {
  // The Playground template: a 60 m "Ground" plane, the start, a crate, a step.
  world(H, sceneOf({
    ground: { type: 'plane', name: 'Ground', shape: { width: 60, depth: 60 }, transform: { position: [0, 0, 0] } },
    start: { type: 'spawn', transform: { position: [0, 0.1, 8] } },
    crate: { type: 'box', physics: 'dynamic', transform: { position: [20, 0.5, 20] } },
    step: { type: 'box', shape: { size: [3, 1, 3] }, transform: { position: [6, 0.5, -4] } },
  }));
  H.tick(0.5);
  const ground = H.game.entity('ground'), p = H.game.player, crate = H.game.entity('crate');
  assert.ok(ground.visible);
  // The assistant turns hills on in the running world.
  H.applyOps([{ op: 'config', patch: { terrain: { shape: 'hills', height: 14, scatter: false, home: false, seed: 4 } } }]);
  assert.ok(!ground.visible && ground.physics === 'none', 'the old ground is hidden while the terrain is on');
  assert.ok(H.game.entity('step').visible, 'a small step is not a ground');
  H.tick(1);
  for (const [what, e] of [['the player', p], ['the crate', crate]] as const) {
    const g = H.terrain.heightAt(e.x, e.z);
    assert.ok(e.bottom > g - 0.25 && e.bottom < g + 1.5, `${what} stands on the terrain (${e.bottom.toFixed(2)} on ${g.toFixed(2)})`);
  }
  // A respawn at a start under a hill comes up on top too.
  H.respawn();
  H.tick(0.3);
  assert.ok(p.bottom > H.terrain.heightAt(p.x, p.z) - 0.25, 'after a respawn');
  H.applyOps([{ op: 'config', patch: { terrain: null } }]);
  assert.ok(ground.visible && ground.physics === 'static', 'turned off: the ground is back');
});
