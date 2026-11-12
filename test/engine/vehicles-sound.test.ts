// Vehicle sounds (public/play/modules/vehicles/vehicles-sound.js): the engine model's numbers, and that the module loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.ts';

const H = await load();
const M = H.vehicles.sound.math;

test('rest to top speed climbs through the gears with a drop at each shift', () => {
  let gear = 1, shifts = 0, last = M.rpm(0, 1, 30), dips = 0;
  for (let s = 0; s <= 31; s += 0.05) {
    const g = M.gearFor(gear, s, 30, 0.6);
    const r = M.rpm(s, g, 30, 0.6);
    if (g > gear) { shifts++; if (r < last - 0.15) dips++; }
    gear = g; last = r;
  }
  assert.equal(gear, 4);
  assert.ok(shifts >= 3 && dips >= 3, `shifts ${shifts}, dips ${dips}`);
});

test('four layers crossfade in turn; a phone keeps two', () => {
  const active = (rpm: number, wide: boolean, n = 4) => M.topLayers(M.layerGains(rpm, wide), n).map((x: number, i: number) => (x > 0.05 ? i : -1)).filter((i: number) => i >= 0);
  const seen = new Set<number>();
  for (let r = 0; r <= 1.1; r += 0.02) active(r, true).forEach((i: number) => seen.add(i));
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
  for (let r = 0; r <= 1.1; r += 0.02) assert.ok(active(r, false, 2).length <= 2);
  const g = M.layerGains(0.5, true);
  assert.ok(Math.abs(g.reduce((s: number, x: number) => s + x * x, 0) - 1) < 1e-6);
  assert.equal(M.maxLayers('phone'), 2);
  assert.equal(M.maxLayers('desktop'), 4);
});

test('hills load the engine, a shift dips the volume, tyres pick a loop by ground', () => {
  assert.ok(M.load(0.5, 0.3) > M.load(0.5, 0));
  assert.ok(M.rpm(10, 2, 30, 1) > M.rpm(10, 2, 30, 0));
  assert.equal(M.shiftDip(0), 1);
  assert.ok(M.shiftDip(0.15) < 0.5 && M.shiftDip(0.4) === 1);
  assert.deepEqual(['road', 'sand', 'grass', 'shallows', 'hard'].map(M.tyreLoop), ['road', 'sand', 'grass', 'water', 'road']);
  assert.ok(M.tyre(20, false, 'road').gain > M.tyre(5, false, 'road').gain && M.tyre(0, false, 'road').gain === 0);
});

test('doppler: higher coming, lower going; rotor follows collective; the roar goes dull with distance', () => {
  assert.ok(M.doppler(-30) > 1 && M.doppler(30) < 1);
  assert.ok(M.rotor(0, 1).low > M.rotor(0, 1).full && M.rotor(1, 1).full > M.rotor(1, 1).low);
  assert.ok(M.rotor(0.5, 0).rate < M.rotor(0.5, 1).rate);
  assert.ok(M.roar(1, 100, 2000).cutoff < M.roar(1, 100, 10).cutoff && M.roar(1, 200, 0).rate > M.roar(1, 0, 0).rate);
});

test('the module is there and says what it plays', () => {
  const s = H.vehicles.sound.sample();
  assert.equal(s.voices, 0);
  assert.ok(H.vehicles.sound.files.car.includes('engine-high'));
});
