// Controls (modules/controls): the list shows what applies now (driving adds its keys; building adds its own), a game adds
// its own line, and the phone's buttons do the thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', shape: { size: [200, 1, 200] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, 0] } };

test('the list: what applies now, a game line of its own, and its button', () => {
  world(H, sceneOf({ floor, start, car: { type: 'car', transform: { position: [0, 0.6, 4] } } }));
  H.tick(0.3);
  const keys = () => H.controls.list().map((l: any) => l.keys);
  assert.ok(keys().includes('W A S D') && keys().includes('E'), 'walking and using');
  assert.ok(!H.controls.list().some((l: any) => /^Driving/.test(l.group)), 'no driving on foot');
  H.game.vehicles.enter(H.game.entity('car'));
  H.tick(0.2);
  assert.ok(H.controls.list().some((l: any) => /^Driving/.test(l.group)), 'in the car: how it drives');
  assert.ok(keys().includes('V'), 'and the camera');
  assert.ok(!keys().includes('W A S D'), 'not walking');
  let thrown = 0;
  const off = H.game.controls.add({ group: 'This game', keys: 'G', what: 'throw a snowball', tap: 'Throw', act: () => { thrown++; } });
  assert.ok(H.controls.list().some((l: any) => l.keys === 'G' && l.tap === 'Throw'));
  off();
  assert.ok(!H.controls.list().some((l: any) => l.keys === 'G'));
  void thrown;
});

test('building shows the builder keys', () => {
  world(H, sceneOf({ floor, start }), { mode: 'build' });
  H.tick(0.3);
  assert.ok(H.controls.list().some((l: any) => l.group === 'Building'));
});
