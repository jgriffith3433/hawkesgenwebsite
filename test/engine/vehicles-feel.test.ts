// How driving feels (public/play/modules/vehicles/vehicles-feel.js): the pure numbers, then a 4x4 driven in the real engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const errors: string[] = [];
const report = H.report;
H.report = (err: any, file?: string) => { errors.push(`${file || ''}: ${(err && err.message) || err}`); return report(err, file); };
const floor = { type: 'box', name: 'Sand flats', shape: { size: [800, 1, 800] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };
const keys = () => H.input.held as Set<string>;
// (a frame runs once per tick: tick in small steps, like a browser)
const hold = (k: string[], seconds: number) => { for (const x of k) keys().add(x); for (let t = 0; t < seconds - 1e-6; t += 0.05) H.tick(0.05); for (const x of k) keys().delete(x); };

test('the math: the view widens with speed, the body leans, the engine climbs', () => {
  const M = H.vehicles.feel.math;
  assert.equal(M.fovKick(0, 30), 0);
  assert.ok(M.fovKick(15, 30) > 0.02 && M.fovKick(30, 30) > M.fovKick(15, 30), 'wider the faster');
  assert.ok(M.fovKick(30, 30) < 0.25, 'but never absurd');
  assert.ok(M.fovKick(30, 30, { boosting: true }) > M.fovKick(30, 30), 'boost adds');
  assert.ok(M.fovKick(30, 30, { motion: 0.3 }) < M.fovKick(30, 30) * 0.4, 'reduce motion leaves little');
  assert.ok(M.camLag(30, 30).rate < M.camLag(0, 30).rate && M.camLag(30, 30).back > 0.5, 'the camera trails at speed');
  assert.ok(M.roll(10) > 0 && M.roll(-10) < 0 && M.roll(1000) === 0.14, 'the lean follows the bend and is capped');
  assert.ok(M.pitch(-20) > 0 && M.pitch(20) < 0, 'braking dips the nose, power squats');
  assert.ok(Math.abs(M.ease(0, 1, 1 / 60, 10) - 0.153) < 0.01 && M.ease(0, 1, 100, 10) <= 1, 'easing is stable at any step');
  assert.ok(M.driftYaw(8, 20) > 0 && M.driftYaw(-8, 20) < 0 && M.driftYaw(5, 2) === 0);
  // Dust: loose ground kicks it, paving hardly, a slide adds.
  assert.ok(M.dustAmount('sand', 20) > M.dustAmount('stone', 20) * 4);
  assert.ok(M.dustAmount('dirt', 20, { slip: true }) > M.dustAmount('dirt', 20));
  assert.equal(M.dustAmount('dirt', 1), 0, 'crawling kicks nothing');
  assert.ok(M.dustEvery(30, 1) < M.dustEvery(5, 1) && M.dustEvery(20, 0.5) > M.dustEvery(20, 1), 'faster is more often; a phone, less');
  // The engine rises with speed overall, drops at a gear change, and is higher under load.
  const rise = [0, 5, 10, 15, 20, 25, 30].map((s) => M.engineRpm(s, 30, 0.5));
  assert.ok(rise[6] > rise[0] + 0.3, `rises (${rise.map((x: number) => x.toFixed(2))})`);
  let dips = 0;
  for (let s = 0; s < 29.5; s += 0.25) if (M.engineRpm(s + 0.25, 30, 0.5) < M.engineRpm(s, 30, 0.5)) dips++;
  assert.ok(dips >= 3 && dips <= 6, `a few gear changes (${dips})`);
  assert.ok(M.engineRpm(15, 30, 1) > M.engineRpm(15, 30, 0), 'load raises it');
  assert.ok(M.engineRpm(15, 30, 1, { boosting: true }) > M.engineRpm(15, 30, 1));
  // Skid, landing, bumps, lights.
  assert.equal(M.skid(9, 1, true), 0, 'parked is silent');
  assert.ok(M.skid(7, 15, false) > 0.5 && M.skid(0.5, 15, false) === 0 && M.skid(0, 15, true) > 0.4, 'a slide or the handbrake squeals');
  assert.equal(M.landing(2), null, 'a hop is nothing');
  const small = M.landing(6), big = M.landing(16);
  assert.ok(big.dip > small.dip && big.dust > small.dust && big.shake > small.shake && big.size === 'crash' && small.size === 'knock');
  assert.equal(M.bump(1, 20), 0);
  assert.ok(M.bump(5, 20) > 0 && M.bump(5, 2) === 0 && M.bump(50, 20) <= 0.22);
  assert.ok(M.lightsWanted(0.12, false) && !M.lightsWanted(0.5, false) && M.lightsWanted(0.5, true) && !M.lightsWanted(0.8, true), 'night, with hysteresis');
});

test('driving a 4x4: the view widens, the body leans, dust rises, the engine climbs, the squeal comes with the handbrake', () => {
  world(H, sceneOf({ floor, start, jeep: { type: 'vehicle', shape: { vehicle: '4x4' }, transform: { position: [0, 1, 4] } } }, { juice: { level: 'full' } }));
  H.juice.deviceLevel = 'full';
  H.tick(0.5);
  const jeep = H.game.entity('jeep');
  assert.ok(H.game.vehicles.enter(jeep));
  H.tick(0.3);
  const F = H.vehicles.feel;
  const idle = F.sample();
  const cam = H.world.scene.activeCamera;
  const fov0 = cam.fov;
  hold(['w'], 1);
  const slow = F.sample();
  hold(['w'], 3);
  const fast = F.sample();
  assert.ok(jeep.speed > 15, `it is moving (${jeep.speed.toFixed(1)})`);
  assert.ok(fast.fov > 0.08 && fast.fov > slow.fov, `the view widens (${slow.fov.toFixed(3)} -> ${fast.fov.toFixed(3)})`);
  assert.ok(cam.fov > fov0 + 0.04, `the camera's FOV follows (${fov0.toFixed(3)} -> ${cam.fov.toFixed(3)})`);
  assert.ok(fast.rpm > idle.rpm + 0.2, `the engine climbs (${idle.rpm.toFixed(2)} -> ${fast.rpm.toFixed(2)})`);
  assert.ok(fast.camBack > 0.3, 'the camera trails');
  // A hard turn leans the body.
  let lean = 0, tilt: number[] = [];
  for (let i = 0; i < 40; i++) { keys().add('w'); keys().add('d'); H.tick(0.05); lean = Math.max(lean, Math.abs(F.sample().roll)); tilt.push(jeep.vehicle.body.rotation.z); }
  keys().delete('w'); keys().delete('d');
  assert.ok(lean > 0.02, `the body rolls in the bend (${lean.toFixed(3)} rad)`);
  assert.ok(Math.abs(jeep.vehicle.body.rotation.z) > 0 || tilt.some((x) => Math.abs(x) > 0.02), 'the body node is really tilted');
  assert.ok(F.sample().puffs > 0, `it kicks up dust (${F.sample().puffs} puffs)`);
  // The handbrake at speed squeals.
  hold(['w'], 2);
  let skid = 0;
  for (let i = 0; i < 30; i++) { keys().add('w'); keys().add('a'); keys().add('space'); H.tick(0.05); skid = Math.max(skid, F.sample().skid); }
  for (const k of ['w', 'a', 'space']) keys().delete(k);
  assert.ok(skid > 0.3, `the handbrake squeals (${skid.toFixed(2)})`);
});

test('landing from a jump: a camera dip, dust and a thud', () => {
  const ramp = { type: 'box', shape: { size: [10, 0.5, 14] }, transform: { position: [0, 0.6, 30], rotation: [-14, 0, 0] } };
  world(H, sceneOf({ floor, start, ramp, jeep: { type: 'vehicle', shape: { vehicle: '4x4' }, transform: { position: [0, 1, 6] } } }, { juice: { level: 'full' } }));
  H.juice.deviceLevel = 'full';
  H.tick(0.5);
  const jeep = H.game.entity('jeep');
  H.game.vehicles.enter(jeep);
  H.tick(0.3);
  const F = H.vehicles.feel;
  const before = F.sample();
  let dip = 0, sounds = 0;
  const play = H.juice.sound.play;
  H.juice.sound.play = (...a: any[]) => { sounds++; return play.apply(H.juice.sound, a); };
  for (let i = 0; i < 200; i++) { keys().add('w'); keys().add('shift'); H.tick(0.05); dip = Math.min(dip, F.sample().dip); }
  for (const k of ['w', 'shift']) keys().delete(k);
  H.juice.sound.play = play;
  const after = F.sample();
  assert.ok(after.landed > before.landed, `it landed from the air (${after.landed})`);
  assert.ok(dip < -0.01, `the camera dips (${dip.toFixed(3)})`);
  assert.ok(sounds > 0, 'and a thud is heard');
  assert.ok(after.puffs > before.puffs, 'with dust');
});

test('on a phone the juice level halves the dust, minimal makes a fifth', () => {
  world(H, sceneOf({ floor, start, jeep: { type: 'vehicle', shape: { vehicle: '4x4' }, transform: { position: [0, 1, 4] } } }));
  H.tick(0.5);
  const jeep = H.game.entity('jeep');
  H.game.vehicles.enter(jeep);
  const count = (level: string) => { H.juice.deviceLevel = level; const a = H.vehicles.feel.sample().puffs; hold(['w'], 3); const n = H.vehicles.feel.sample().puffs - a; hold(['s'], 2.5); return n; };
  const full = count('full'), reduced = count('reduced'), minimal = count('minimal');
  assert.ok(full > reduced && reduced > minimal, `full ${full}, reduced ${reduced}, minimal ${minimal}`);
  assert.ok(reduced <= full * 0.65 && minimal <= full * 0.3, 'a phone makes about half, the least level a fifth');
});

test('no errors were reported along the way', () => { assert.deepEqual(errors, []); });
