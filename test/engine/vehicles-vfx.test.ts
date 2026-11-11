// Surface-aware vehicle effects (public/play/modules/vehicles/vehicles-vfx.js): the numbers, then a 4x4 on four grounds and a
// helicopter over grass and sea in the real engine (Babylon's NullEngine and Havok in Node).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const errors: string[] = [];
const report = H.report;
H.report = (err: any, file?: string) => { errors.push(`${file || ''}: ${(err && err.message) || err}`); return report(err, file); };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };
const keys = () => H.input.held as Set<string>;
const hold = (k: string[], seconds: number) => { for (const x of k) keys().add(x); for (let t = 0; t < seconds - 1e-6; t += 0.05) H.tick(0.05); for (const x of k) keys().delete(x); };
const ground = (name: string, data: any = {}) => ({ type: 'box', name, data, shape: { size: [800, 1, 800] }, transform: { position: [0, -0.5, 0] } });
const jeep = { type: 'vehicle', shape: { vehicle: '4x4' }, transform: { position: [0, 1, 4] } };

test('the math: one effect per ground, tracks only on soft ground and gone in 30 s, the wash only under 8 m', () => {
  const M = H.vehicles.vfx.math;
  assert.deepEqual(['dirt', 'sand', 'grass', 'water', 'stone'].map((s) => M.classify(s, false)), ['road', 'sand', 'grass', 'shallows', 'hard']);
  assert.equal(M.classify('sand', true), 'shallows', 'a wet tire is in the shallows');
  const fx = new Set(Object.values(M.EFFECT_OF));
  assert.equal(fx.size, 5, 'five different effects');
  assert.ok(M.rate('sand', 20) > M.rate('road', 20) && M.rate('shallows', 20) > M.rate('grass', 20));
  assert.ok(M.rate('road', 20, { slip: true }) > M.rate('road', 20) && M.rate('road', 1) === 0);
  assert.equal(M.rate('hard', 20), 0, 'paving only smokes in a slide');
  assert.ok(M.rate('hard', 20, { slip: true }) > 0);
  assert.ok(M.tracksOn('sand', 8) && M.tracksOn('grass', 8) && !M.tracksOn('road', 8) && !M.tracksOn('shallows', 8) && !M.tracksOn('sand', 0.5));
  assert.ok(M.trackAlpha(0) > 0.5 && M.trackAlpha(29) > 0 && M.trackAlpha(29) < M.trackAlpha(10) && M.trackAlpha(30) === 0, 'fades out by 30 s');
  assert.equal(M.trackCap('phone'), 200);
  assert.ok(M.trackCap('desktop') > 200);
  assert.equal(M.particleShare('phone', 1), 0.5);
  assert.equal(M.particleShare('desktop', 1), 1);
  assert.ok(M.wash(2, 1).radius > 0 && M.wash(2, 1).strength > M.wash(7, 1).strength && M.wash(9, 1).strength === 0 && M.wash(2, 0.1).strength === 0);
  assert.equal(M.blur(0), 0);
  assert.ok(M.blur(1) > M.blur(0.3));
  assert.equal(M.coneAlpha(true, 0.1, 'phone'), 0, 'no cone on a phone');
  assert.ok(M.coneAlpha(true, 0.1, 'desktop') > 0 && M.coneAlpha(false, 0.1, 'desktop') === 0);
  assert.ok(M.braking({ y: -1 }, 5) && M.braking({ brake: true, y: 0 }, 0) && !M.braking({ y: 1 }, 5));
});

for (const [label, floor, want, extra] of [
  ['road', ground('Gravel road', { surface: 'dirt' }), 'road', {}],
  ['sand', ground('Beach sand'), 'sand', {}],
  ['grass', ground('Meadow grass'), 'grass', {}],
  ['shallows', ground('Sea floor', { surface: 'sand' }), 'shallows', { water: { level: 0.6, waves: 0 } }],
] as const) {
  test(`driving the 4x4 on ${label} logs one switch and makes its own effect`, () => {
    world(H, sceneOf({ floor, start, jeep }, { juice: { level: 'full' }, ...(extra as any) }));
    H.juice.deviceLevel = 'full';
    H.tick(0.5);
    assert.ok(H.game.vehicles.enter(H.game.entity('jeep')));
    H.tick(0.3);
    hold(['w'], 3.5);
    const s = H.vehicles.vfx.sample();
    assert.equal(s.surface, want, `the ground is ${want} (${JSON.stringify(s.switches)})`);
    const kind = H.vehicles.vfx.math.EFFECT_OF[want];
    assert.ok(s.emitted[kind] > 5, `${kind} particles made (${JSON.stringify(s.emitted)})`);
    assert.ok(s.switches.some((x: any) => x.ground === want && x.effect === kind), 'the switch is logged');
    if (want === 'sand' || want === 'grass') assert.ok(s.tracks.written > 3, `tracks left (${s.tracks.written})`);
    else assert.equal(s.tracks.written, 0, 'no tracks here');
  });
}

test('tracks on sand fade out within 30 s', () => {
  world(H, sceneOf({ floor: ground('Beach sand'), start, jeep }, { juice: { level: 'full' } }));
  H.tick(0.5);
  H.game.vehicles.enter(H.game.entity('jeep'));
  hold(['w'], 3);
  const s = H.vehicles.vfx.sample();
  assert.ok(s.tracks.live > 3, `live (${s.tracks.live})`);
  hold([' '], 8); // (the handbrake: stopped, so no new tracks)
  const written = H.vehicles.vfx.sample().tracks.written;
  for (let i = 0; i < 31 * 20; i++) H.tick(0.05);
  assert.equal(H.vehicles.vfx.sample().tracks.written, written, 'nothing new once it stands');
  assert.equal(H.vehicles.vfx.sample().tracks.live, 0, 'all gone after 30 s');
});

test('the helicopter hovering low over grass shows a ring, over the sea a spray disc, and a blur disc', () => {
  world(H, sceneOf({ floor: ground('Meadow grass'), start, heli: { type: 'helicopter', transform: { position: [0, 1.5, 4] }, data: { autopilot: { hover: 3 } } } }, { juice: { level: 'full' } }));
  H.tick(0.5);
  const heli = H.game.entity('heli');
  assert.ok(H.game.vehicles.enter(heli));
  hold([' '], 1.5);
  H.tick(1);
  const s = H.vehicles.vfx.sample();
  assert.ok(s.wash && s.wash.ring && s.wash.ground === 'grass', `a ring over grass (${JSON.stringify(s.wash)})`);
  assert.ok(s.wash.alt < 8);
  assert.ok(s.rotorBlur > 0.05, `the rotor blur (${s.rotorBlur})`);
  assert.ok(s.emitted.grass > 0, 'grass bits thrown');
  assert.ok(H.vehicles.vfx.washes().length > 0, 'the wash is told to the grass');
});

test('the helicopter over the sea throws spray', () => {
  world(H, sceneOf({ floor: ground('Sea floor', { surface: 'sand' }), start, heli: { type: 'helicopter', transform: { position: [0, 1.5, 4] } } }, { juice: { level: 'full' }, water: { level: 0.4, waves: 0 } }));
  H.tick(0.5);
  assert.ok(H.game.vehicles.enter(H.game.entity('heli')));
  hold([' '], 1.5);
  H.tick(1);
  const s = H.vehicles.vfx.sample();
  assert.ok(s.wash && s.wash.spray, `a spray disc (${JSON.stringify(s.wash)})`);
  assert.ok(s.emitted.spray > 0);
});

test('no errors were reported along the way', () => { assert.deepEqual(errors, []); });
