// Flying while building: forward goes where you look (look down and press W to dive), and E is never "up" (E is use).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', name: 'Ground', shape: { size: [80, 1, 80] }, transform: { position: [0, -0.5, 0] }, physics: 'static' };
const spawnPt = { type: 'spawn', name: 'Start', transform: { position: [0, 30, 0] }, data: { role: 'player' } };

/** Holds a key (as the phone buttons do) for a while, then lets go. */
function hold(k: string, seconds: number) {
  const b: any = { addEventListener(t: string, f: Function) { b[t] = f; }, style: {} };
  H.bindTouchKey(b, k);
  b.pointerdown({ preventDefault() {}, stopPropagation() {} });
  for (let t = 0; t < seconds; t += 1 / 60) H.tick(1 / 60);
  b.pointerup();
  H.tick(1 / 60);
}

test('flying: W goes where the camera looks, down included; E does not lift you', () => {
  world(H, sceneOf({ floor, start: spawnPt }), { mode: 'build' });
  const p = H.world.player;
  p.flying = true;
  H.tick(1 / 60);
  // Look steeply down (the camera's pitch: positive looks down, first person or behind the player).
  H.world.camera.pitch = 1.1;
  H.tick(1 / 60);
  const y0 = p.y;
  hold('w', 0.5);
  assert.ok(p.y < y0 - 1, `looking down, forward dives (from ${y0.toFixed(2)} to ${p.y.toFixed(2)})`);
  const y1 = p.y;
  hold('e', 0.5);
  assert.ok(Math.abs(p.y - y1) < 0.05, `E doesn't fly up (moved ${(p.y - y1).toFixed(2)})`);
  hold('space', 0.5);
  assert.ok(p.y > y1 + 1, 'space still rises');
});
