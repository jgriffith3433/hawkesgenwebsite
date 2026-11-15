// The cast's living faces (presence-alive.js, pure rules): a mouth that follows a voice's loudness, a head that follows the player
// within 6 m inside a natural range, gestures on the arms and head only, idle life, and the phone's three nearest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.ts';

const H = await load();
const A = H.presence.aliveCore;

test('the mouth opens on a syllable and shuts in silence', () => {
  const m = { open: 0 };
  const dt = 1 / 60;
  for (let i = 0; i < 12; i++) A.mouthStep(m, 0.2, dt); // 200 ms of a loud vowel
  assert.ok(m.open > 0.7, `open ${m.open}`);
  for (let i = 0; i < 30; i++) A.mouthStep(m, 0, dt); // half a second of silence
  assert.ok(m.open < 0.02, `closed ${m.open}`);
  const q = { open: 0 };
  for (let i = 0; i < 60; i++) A.mouthStep(q, 0.01, dt); // breath under the gate
  assert.equal(q.open, 0);
});

test('loudness from an analyser block: silence is 128, a tone is loud', () => {
  assert.equal(A.rms(new Uint8Array(512).fill(128)), 0);
  const tone = Uint8Array.from({ length: 512 }, (_, i) => 128 + Math.round(60 * Math.sin(i / 5)));
  assert.ok(A.rms(tone) > 0.3);
});

test('the look-at: inside 6 m, held to 6.6 m, clamped to a natural range', () => {
  assert.equal(A.lookIn(false, 5.9), true);
  assert.equal(A.lookIn(false, 6.3), false);
  assert.equal(A.lookIn(true, 6.3), true, 'hysteresis');
  assert.equal(A.lookIn(true, 6.7), false);
  const side = A.headAim({ x: 5, y: 0, z: 0.1 });
  assert.ok(Math.abs(side.yaw - A.YAW_MAX) < 1e-9, 'a head does not turn past 60 degrees');
  const behind = A.headAim({ x: -1, y: 0, z: -5 });
  assert.ok(behind.yaw < 0 && behind.yaw >= -A.YAW_MAX);
  assert.ok(A.headAim({ x: 0, y: 9, z: 1 }).pitch <= 0.4 + 1e-9);
  const L = { yaw: 0, pitch: 0, w: 0 };
  for (let i = 0; i < 60; i++) A.lookStep(L, { yaw: 0.5, pitch: 0 }, 1 / 60);
  assert.ok(L.w > 0.95 && Math.abs(L.yaw - 0.5) < 0.01);
  for (let i = 0; i < 120; i++) A.lookStep(L, null, 1 / 60);
  assert.ok(L.w < 0.05, 'lets go');
});

test('gestures touch the arms and the head only, and every context has one', () => {
  for (const [name, fn] of Object.entries(A.GESTURES) as [string, any][]) {
    for (const k of [0, 0.4, 1.1]) for (const joint of Object.keys(fn(k, 2))) assert.ok(['shL', 'shR', 'neck'].includes(joint), `${name} sets ${joint}`);
  }
  for (const n of ['point', 'wave', 'shrug', 'laugh', 'salute']) assert.ok(A.GESTURES[n], n);
  for (const ctx of Object.keys(A.BY_CTX)) for (const who of Object.keys(A.HABIT)) for (let n = 0; n < 6; n++) assert.ok(A.GESTURES[A.gestureFor(who, ctx, n)], `${who} ${ctx} ${n}`);
  assert.equal(A.gestureFor('bobbin', 'first', 0), 'wave');
  assert.equal(A.envelope(-1, 2), 0); assert.equal(A.envelope(3, 2), 0); assert.ok(A.envelope(1, 2) > 0.99);
  assert.equal(A.gestureForText('Hello there', 0), 'wave');
  assert.ok(A.gestureSeconds('a'.repeat(200)) <= 4.5);
});

test('idle life stays small, and the phone animates the 3 nearest plus whoever speaks', () => {
  for (let t = 0; t < 60; t += 0.5) { const p = A.idlePose(t, 0.3); for (const j of ['shL', 'shR', 'neck']) for (const v of (p as any)[j]) assert.ok(Math.abs(v) < 0.12); }
  const list = [{ id: 'a', dist: 9 }, { id: 'b', dist: 2 }, { id: 'c', dist: 4 }, { id: 'd', dist: 5 }, { id: 'e', dist: 1 }, { id: 'f', dist: 30 }];
  assert.deepEqual([...A.pickActive(list, 3, new Set())].sort(), ['b', 'c', 'e']);
  assert.deepEqual([...A.pickActive(list, 3, new Set(['f']))].sort(), ['b', 'c', 'e', 'f']);
});
