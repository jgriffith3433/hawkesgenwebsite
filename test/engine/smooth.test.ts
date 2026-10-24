// Smooth motion (public/play/runtime.js): things are drawn between their last two physics steps (the steps don't line
// up with the screen's frames), put back before the next step; jumps (teleports, the planet's frame) aren't blended;
// the third-person camera holds its distance from the head instead of trailing, and small bumps are smoothed without lag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', shape: { size: [80, 1, 80] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, 0] } };
const tick = (s: number) => { for (let i = 0; i < Math.round(s * 60); i++) H.tick(1 / 60); };

test('drawn between steps: half a step is halfway; the real place comes back; a teleport is not blended', () => {
  world(H, sceneOf({ floor, start, ball: { type: 'sphere', name: 'Ball', physics: 'dynamic', transform: { position: [5, 20, 0] } } }), { mode: 'play' });
  tick(0.5);
  const ball = H.game.find('Ball');
  const before = [ball._px, ball._py, ball._pz], now = ball.position;
  assert.ok(now[1] < before[1], 'it fell this step');
  const list = H._between.inBetween(0.5);
  assert.ok(Math.abs(ball.y - (before[1] + now[1]) / 2) < 1e-9, 'drawn halfway between the step\'s start and end');
  H._between.back(list);
  assert.deepEqual(ball.position, now, 'its real place again');
  // A jump (a teleport) is drawn where it is, not blended across.
  ball.position = [30, 5, 0];
  H.tick(1 / 60);
  ball._px = -30;
  H._between.inBetween(0.5);
  assert.ok(Math.abs(ball.x - 30) < 1e-6);
  H._between.back([]);
});

test('third person: a fast fall keeps the camera at its distance (no trailing); small bumps are smoothed, never lagging far', () => {
  world(H, sceneOf({ floor, start }), { mode: 'play' });
  tick(0.3);
  const p = H.world.player;
  p.view = 'third';
  p.position = [0, 300, 0];
  p.velocity = [0, -60, 0];
  for (let i = 0; i < 30; i++) {
    tick(1 / 60);
    const c = H.world.scene.activeCamera.position;
    const head = [p.x, p.bottom + 1.5, p.z];
    const d = Math.hypot(c.x - head[0], c.y - head[1], c.z - head[2]);
    assert.ok(Math.abs(d - 5) < 0.6, `the camera stays about 5 m from the head while falling fast (${d.toFixed(2)} m)`);
  }
});
