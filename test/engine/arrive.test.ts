// Arrivals (public/play/modules/overseer/arrive.js): everything comes down from the Overseer, by what it is. Dropped
// things fall from high in the beam and land (on a roof when there is one), herds rain down one by one, plants grow up
// out of the ground, terrain rises over ~5 s, building saves one op that undo removes, and nothing is left behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, world, sceneOf } from './harness.ts';

const every = globalThis.setInterval;
(globalThis as any).setInterval = (...a: any[]) => { const t = (every as any)(...a); t.unref?.(); return t; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = await load({ extra: [path.join(ROOT, 'public', 'play', 'build.js')], anyId: true });
const g = globalThis as any;
const sent: any[] = [];
H.post = (m: any) => { if (m && m.type === 'ops') sent.push(m); };
const floor = { type: 'box', physics: 'static', shape: { size: [200, 1, 200] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-12, 0.1, -12] } };
const roof = { type: 'box', name: 'Roof', physics: 'static', shape: { size: [8, 0.3, 8] }, transform: { position: [0, 4, 0] } };
const settle = (s: number) => { for (let t = 0; t < s; t += 0.1) H.tick(0.1); };

test('a dropped thing appears high in the beam, falls with real physics and ends on the ground', () => {
  world(H, sceneOf({ floor, start }));
  H.tick(0.3);
  const [crate] = H.game.spawnMany('crate', 1, { at: [0, 0, 8] });
  assert.ok(H.arrive.of(crate), 'it is arriving');
  assert.equal(crate.node.isEnabled(), false, 'hidden while the beam locks on');
  assert.ok(H.overseer.beams >= 1, 'the Overseer beam is on the spot');
  H.tick(0.4);
  assert.ok(crate.node.isEnabled() && crate.bottom > 10, `up in the beam (${crate.bottom.toFixed(1)} m)`);
  let low = Infinity;
  for (let i = 0; i < 40; i++) { H.tick(0.05); low = Math.min(low, crate.y); }
  settle(2);
  assert.ok(Math.abs(crate.bottom) < 0.15, `on the ground (${crate.bottom.toFixed(2)})`);
  assert.ok(Math.hypot(crate.x, crate.z - 8) < 1, 'where it was asked for');
  assert.equal(H.arrive.active, 0);
});

test('asked for under a roof, it lands on the roof (a crate and a car)', () => {
  world(H, sceneOf({ floor, start, roof }));
  H.tick(0.3);
  const [crate] = H.game.spawnMany('crate', 1, { at: [-1.5, 0, 0] });
  const [car] = H.game.spawnMany({ type: 'car', name: 'Car' }, 1, { at: [1.5, 0, 0] });
  settle(4);
  assert.ok(crate.bottom > 4, `the crate is on the roof (${crate.bottom.toFixed(2)}), not under it`);
  assert.ok(car.y > 4, `so is the car (${car.y.toFixed(2)})`);
});

test('a herd rains down one by one in a cluster and every animal ends on its feet on the ground', () => {
  world(H, sceneOf({ floor, start }));
  H.tick(0.3);
  const cows = H.game.spawnMany('cow', 8, { at: [6, 0, 6] });
  assert.equal(cows.length, 8);
  H.tick(0.6);
  const shown = cows.filter((c: any) => c.node.isEnabled()).length;
  assert.ok(shown >= 1 && shown < 8, `one by one (${shown} of 8 so far)`);
  assert.equal(H.arrive.beams, 1, 'one wide beam for the cluster');
  settle(6);
  assert.ok(cows.every((c: any) => c.node.isEnabled() && c.bottom > -0.3 && c.bottom < 0.6), `all down: ${cows.map((c: any) => c.bottom.toFixed(2)).join(' ')}`);
  assert.equal(H.arrive.active, 0);
});

test('plants grow up out of the ground; lights and signs are beamed in where they are', () => {
  world(H, sceneOf({ floor, start }), { mode: 'build' });
  H.tick(0.3);
  H.applyOps([
    { op: 'create', entity: { id: 'tree', type: 'cone', name: 'Tree', shape: { radius: 1.1, height: 3.6 }, physics: 'static', transform: { position: [4, 1.8, 4] } } },
    { op: 'create', entity: { id: 'lamp', type: 'light', name: 'Lamp', transform: { position: [0, 5, 4] } } },
  ], { local: true, fx: 'materialize' });
  const tree = H.world.byId.get('tree');
  assert.equal(H.arrive.of(tree).kind, 'grow');
  assert.equal(H.arrive.of(H.world.byId.get('lamp')), null, 'the lamp is beamed (not dropped)');
  H.tick(0.6);
  assert.ok(tree.y < 1.6, `coming up out of the ground (${tree.y.toFixed(2)})`);
  settle(2.5);
  assert.ok(Math.abs(tree.y - 1.8) < 1e-6 && Math.abs(tree.node.scaling.x - 1) < 1e-6, 'full height, where it was put');
  assert.equal(tree.physics, 'static', 'solid again');
});

test('building: the spot is worked out first (on the roof), the fall ends exactly there, one op, undo removes it', () => {
  world(H, sceneOf({ floor, start, roof }), { mode: 'build' });
  H.tick(0.3);
  sent.length = 0;
  const spec: any = { id: 'ball', type: 'sphere', name: 'Ball', physics: 'dynamic', shape: { radius: 0.4 }, transform: { position: [0, 0.4, 0] } };
  H.arrive.plan(spec);
  assert.ok(spec.transform.position[1] > 4.1, `planned onto the roof (${spec.transform.position[1]})`);
  g.HawkesBuild.edit([{ op: 'create', entity: spec }], { label: 'adding a ball', fx: 'materialize' });
  assert.equal(sent.length, 1, 'one op');
  const ball = H.world.byId.get('ball');
  H.tick(0.5);
  assert.ok(ball.y > spec.transform.position[1] + 3, 'falling from the sky');
  settle(2.5);
  assert.deepEqual(ball.position.map((n: number) => Math.round(n * 100) / 100), spec.transform.position, 'exactly where the op saved it');
  assert.equal(ball.physics, 'dynamic');
  g.HawkesBuild.undo();
  assert.equal(H.world.graph.entities.ball, undefined, 'one undo removes it');
  assert.equal(H.world.byId.get('ball'), undefined);
});

test('terrain grows: a mountain rises over about 5 s to the asked height, carrying the player up; then rests', () => {
  world(H, sceneOf({ start: { type: 'spawn', transform: { position: [30, 1, 30] } } }, { terrain: { shape: 'flat', size: 128, scatter: false, home: false } }));
  H.tick(0.3);
  const T = H.terrain.core;
  const want = { type: 'mountain', at: [30, 30], radius: 30, height: 28, road: false };
  const target = T.heightAt(T.generate({ shape: 'flat', size: 128, scatter: false, home: false, add: [want] }), 30, 30);
  const before = H.terrain.heightAt(30, 30);
  H.applyOps([{ op: 'config', patch: { terrain: { shape: 'flat', size: 128, scatter: false, home: false, add: [want] } } }], { local: true });
  assert.ok(H.arrive.quakes === 1, 'the ground rumbles');
  settle(1);
  const mid = H.terrain.heightAt(30, 30);
  assert.ok(mid > before + 0.5 && mid < target - 3, `rising (${before.toFixed(1)} → ${mid.toFixed(1)} of ${target.toFixed(1)})`);
  settle(4.5);
  assert.ok(Math.abs(H.terrain.heightAt(30, 30) - target) < 0.05, `the asked height (${H.terrain.heightAt(30, 30).toFixed(2)} vs ${target.toFixed(2)})`);
  const p = H.world.player;
  assert.ok(p.bottom > target - 1.5, `the player rode up (${p.bottom.toFixed(1)})`);
  // Taking it back: it sinks again.
  H.applyOps([{ op: 'config', patch: { terrain: { shape: 'flat', size: 128, scatter: false, home: false, add: [] } } }], { local: true });
  settle(3.5);
  assert.ok(Math.abs(H.terrain.heightAt(30, 30) - before) < 0.05, 'and down again');
  settle(6);
  assert.equal(H.arrive.quakes, 0, 'the quake is over');
  assert.equal([...H.world.entities].filter((e: any) => e.data && e.data.arrivalRock).length, 0, 'its rocks are gone');
});

test('nothing is left behind: beams, rings and arrivals end; a world change clears them', () => {
  world(H, sceneOf({ floor, start }));
  H.tick(0.3);
  H.game.spawnMany('crate', 12, { at: [0, 0, 10] });
  H.game.spawnMany('barrel', 3, { at: [8, 0, 10] });
  settle(8);
  assert.equal(H.arrive.active, 0);
  assert.equal(H.arrive.beams, 0);
  assert.equal(H.overseer.beams, 0);
  const names = H.world.scene.meshes.map((m: any) => m.name);
  assert.equal(names.filter((n: string) => /^ov-beam(?!-src)/.test(n)).length, 0, 'no beam meshes left');
  assert.ok(names.filter((n: string) => n === 'arrive-ring').length <= H.arrive.LIMITS.rings, 'landing rings are a small pool');
  H.game.spawnMany('crate', 5, { at: [0, 0, 4] });
  world(H, sceneOf({ floor, start }));
  assert.equal(H.arrive.active, 0, 'a new world starts with none');
  // Asked for none: it just appears.
  H.tick(0.3);
  const [c] = H.game.spawnMany('crate', 1, { at: [0, 0, 5], arrive: 'none' });
  assert.equal(H.arrive.of(c), null);
  assert.ok(c.node.isEnabled());
});
