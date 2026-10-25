// The way in to the Overseer's hangar: the approach math (readout and catch), the catch guiding a careful ship onto the
// pad in the real engine, the readout, and a climb that fails saying so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const M = H.dockMath;
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };
// A bay like the default ship's (radius 1400): 322 m wide, 150 m tall, 390 m deep.
const F = { halfW: 161, floor: -100, top: 50, back: 1008, front: 1396, apron: 84, padZ: 1231, padR: 26 };

test('allowed speed falls toward the pad; the readout says what to do', () => {
  assert.ok(M.allowedSpeed(2000) <= 70 && M.allowedSpeed(300) > M.allowedSpeed(60) && M.allowedSpeed(0) >= 2);
  const far = M.gauge([0, -20, 3200], [0, 0, -30], F);
  assert.equal(far.state, 'far');
  assert.ok(far.align < 5 && !far.tooFast, 'straight at it, at a fair speed');
  assert.equal(far.advice, 'Good');
  const fast = M.gauge([0, -20, 1700], [0, 0, -150], F);
  assert.ok(fast.tooFast);
  assert.equal(fast.advice, 'Slow down');
  const off = M.gauge([0, -20, 1700], [40, 0, 0], F);
  assert.ok(off.align > 60);
  assert.equal(off.advice, 'Turn toward the bay');
  const right = M.gauge([150, -20, 1700], [0, 0, -2], F);
  assert.equal(right.advice, 'Move left', 'at the bay\'s right edge: move left');
  const low = M.gauge([0, -98, 1700], [0, 0, -2], F);
  assert.equal(low.advice, 'Climb to the bay');
  assert.equal(M.gauge([0, -90, 1300], [0, 0, 0], F).state, 'inside');
});

test('the catch: only for a ship in the bay\'s lane and not coming in wildly; grows toward the pad; never a shove', () => {
  const g = 24;
  assert.equal(M.catchPlan([0, -20, 6000], [0, 0, -30], F, { g }).active, false, 'too far out');
  assert.equal(M.catchPlan([0, -20, 1700], [0, 0, -300], F, { g }).active, false, 'a reckless speed is left to its pilot');
  assert.equal(M.catchPlan([900, -20, 1700], [0, 0, -20], F, { g }).active, false, 'far off to the side');
  assert.equal(M.catchPlan([0, 900, 1700], [0, 0, -20], F, { g }).active, false, 'far above the opening');
  const a = M.catchPlan([0, -20, 1850], [0, 0, -30], F, { g }), b = M.catchPlan([0, -20, 1300], [0, 0, -30], F, { g });
  assert.ok(a.active && b.active && b.k > a.k, 'firmer as it nears');
  for (const p of [a, b]) {
    const push = Math.hypot(p.acc[0], p.acc[2], p.acc[1] - g);
    assert.ok(push <= 16.001, `the nudge is bounded (${push.toFixed(1)} m/s²)`);
  }
  assert.ok(b.acc[1] > 0 && Math.abs(b.acc[1] - g) < 16.001, 'gravity is taken off it');
});

test('a careful ship, left to the catch alone, always ends on the pad slowly (a point mass, many starts)', () => {
  const g = 24, dt = 1 / 30;
  const starts: Array<[number[], number[]]> = [];
  for (const side of [-120, 0, 120]) for (const up of [-40, 10, 40]) for (const dist of [300, 500, 650]) for (const sp of [0, 25, 60]) starts.push([[side, up, F.padZ + dist], [0, 0, -sp]]);
  let worst = 0;
  for (const [p0, v0] of starts) {
    const p = p0.slice(), v = v0.slice();
    let t = 0, ok = false;
    for (; t < 240; t += dt) {
      const plan = M.catchPlan(p, v, F, { g });
      const acc = plan.active ? plan.acc : [0, 0, 0];
      v[0] += acc[0] * dt; v[1] += (acc[1] - g) * dt; v[2] += acc[2] * dt; // (gravity pulls; the plan takes it off)
      for (let i = 0; i < 3; i++) p[i] += v[i] * dt;
      if (p[1] < F.floor) { p[1] = F.floor; if (v[1] < 0) v[1] = 0; }
      if (Math.hypot(p[0], p[2] - F.padZ) < F.padR && p[1] < F.floor + 6 && Math.hypot(v[0], v[1], v[2]) < 2.5) { ok = true; break; }
    }
    assert.ok(ok, `from ${p0} at ${v0[2]} m/s it docks (ended ${p.map((x) => x.toFixed(0))} at ${Math.hypot(v[0], v[1], v[2]).toFixed(1)} m/s)`);
    worst = Math.max(worst, t);
  }
  assert.ok(worst < 200, `and in good time (${worst.toFixed(0)} s the slowest)`);
});

test('in the engine: a rocket brought in carefully docks, with the Docked moment, and the readout is there on the way', () => {
  world(H, sceneOf({ floor, start, rocket: { type: 'rocket', transform: { position: [10, 30, 10] } } }));
  H.tick(0.5);
  const hg = H.overseer.hangar;
  assert.ok(hg && hg.pad[1] > 4000);
  const rocket = H.game.entity('rocket');
  // 400 m out from the opening, level with it, coming in at 20 m/s.
  const ax = Math.sin(hg.yaw), az = Math.cos(hg.yaw);
  const out = (d: number, up: number) => [hg.mouth[0] + ax * d, hg.floor + up, hg.mouth[2] + az * d];
  const p0 = out(400, 30);
  rocket.position = p0; rocket.velocity = [-ax * 20, 0, -az * 20];
  H.world.player.position = [p0[0] + 4, p0[1], p0[2]];
  H.tick(0.1);
  H.game.vehicles.enter(rocket);
  const events: string[] = [];
  H.game.on('bay-catch', () => events.push('catch'));
  H.game.on('docked-pad', () => events.push('docked'));
  let sawReadout = false;
  for (let t = 0; t < 120 && !events.includes('docked'); t += 0.1) {
    H.tick(0.1);
    const a = H.overseer.approach;
    if (a && a.distance > 0) sawReadout = true;
  }
  assert.ok(sawReadout, 'the readout reports distance, speed and align');
  assert.ok(events.includes('catch'), 'the catch took hold');
  assert.ok(events.includes('docked'), 'and it ends Docked on the pad');
  assert.ok(H.overseer.hangar.landed);
});

test('a climb that fails says so: ascent-failed, and the Overseer speaks unless the game answers', () => {
  world(H, sceneOf({ floor, start, rocket: { type: 'rocket', transform: { position: [10, 30, 10] } } }));
  H.tick(0.5);
  const rocket = H.game.entity('rocket');
  H.world.player.position = [14, 30, 10];
  H.game.vehicles.enter(rocket);
  const heard: any[] = [];
  H.game.on('ascent-failed', (d: any) => { heard.push(d); d.handled = true; });
  rocket.position = [10, 500, 10]; rocket.velocity = [0, -5, 0];
  rocket.vehicle.fuel = 0;
  for (let t = 0; t < 5 && !heard.length; t += 0.1) H.tick(0.1);
  assert.equal(heard.length, 1, 'out of fuel high up: said once');
  assert.equal(heard[0].why, 'fuel');
  for (let t = 0; t < 10; t += 0.1) H.tick(0.1);
  assert.equal(heard.length, 1, 'once per climb');
});
