// Time while playing (public/play/rewind.js): the world keeps its last 10 s; rewinding plays it backwards and carries
// on from there (broken things come back, things made since go), and reset puts it back the way it loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const ground = { type: 'box', physics: 'static', shape: { size: [200, 1, 200] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, -20] } };

test('rewind: a rolled ball and a thrown crate go back to where they were, and carry on from there', () => {
  world(H, sceneOf({ ground, start, ball: { type: 'sphere', physics: 'dynamic', shape: { radius: 0.5 }, transform: { position: [0, 0.5, 0] } }, crate: { type: 'box', physics: 'dynamic', shape: { size: [1, 1, 1] }, transform: { position: [5, 0.5, 0] } } }));
  H.tick(1);
  const ball = H.game.entity('ball'), crate = H.game.entity('crate');
  ball.velocity = [5, 0, 0];
  H.tick(0.5);
  const mid = ball.x;
  crate.velocity = [0, 8, 0];
  H.tick(2);
  assert.ok(ball.x > mid + 2, 'it kept rolling');
  assert.ok(H.rewind.seconds > 3, `the world kept ${H.rewind.seconds.toFixed(1)} s`);
  // Hold rewind: it plays backwards (twice as fast) while held.
  H.rewind.hold(true);
  assert.equal(H.rewind.rewinding, true);
  assert.equal(H.world.paused, true, 'the world waits while it rewinds');
  H.tick(1); // 1 s held = 2 s back
  H.rewind.hold(false);
  assert.ok(Math.abs(ball.x - mid) < 0.6, `the ball is back about where it was 2 s ago (${ball.x.toFixed(2)} vs ${mid.toFixed(2)})`);
  assert.ok(crate.y < 1, 'the crate is back on the ground, before it was thrown');
  assert.ok(ball.vx > 2, 'and the ball is rolling again, as fast as it was then');
  H.tick(0.5);
  assert.ok(ball.x > mid + 1.5, 'it carries on from there');
});

test('rewind brings back what broke and takes away what was made since', () => {
  world(H, sceneOf({ ground, start, vase: { type: 'box', physics: 'dynamic', shape: { size: [0.5, 1, 0.5] }, transform: { position: [0, 0.5, 3] } } }));
  H.tick(1);
  H.game.entity('vase').destroy();
  const made = H.game.box({ x: 3, y: 4, z: 3, physics: 'dynamic' });
  H.tick(1);
  assert.equal(H.game.entity('vase'), null);
  assert.ok(H.rewind.back(1.5));
  const vase = H.game.entity('vase');
  assert.ok(vase && vase.alive, 'the vase is back');
  assert.ok(Math.abs(vase.z - 3) < 0.05);
  assert.equal(made.alive, false, 'the box made since is gone');
});

test('alone, the player goes back too; reset puts the world back the way it loaded', () => {
  world(H, sceneOf({ ground, start, ball: { type: 'sphere', physics: 'dynamic', shape: { radius: 0.5 }, transform: { position: [0, 0.5, 0] } } }));
  H.tick(1);
  const p = H.world.player;
  const z0 = p.z;
  p.position = [10, 1, 10];
  H.game.entity('ball').velocity = [0, 0, 6];
  H.tick(1.5);
  H.rewind.back(2);
  assert.ok(Math.abs(p.z - z0) < 0.5, 'the player is back where they were');
  H.game.entity('ball').velocity = [8, 0, 0];
  H.tick(1);
  H.rewind.reset();
  H.tick(0.1);
  const b = H.game.entity('ball');
  assert.ok(Math.hypot(b.x, b.z) < 0.1, 'reset: the ball is where the world file puts it');
  assert.equal(H.rewind.frames <= 2, true, 'and the rewind history starts over');
});

test('a world can turn rewind off (a race, a scored puzzle)', () => {
  world(H, sceneOf({ ground, start, ball: { type: 'sphere', physics: 'dynamic', shape: { radius: 0.5 }, transform: { position: [0, 0.5, 0] } } }, { rewind: false }));
  H.tick(1);
  H.rewind.hold(true);
  assert.equal(H.rewind.rewinding, false);
  assert.equal(H.rewind.frames, 0, 'nothing is kept');
});
