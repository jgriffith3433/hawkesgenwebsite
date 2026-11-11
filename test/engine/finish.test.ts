// Finish-math: the 5 cm ground rule, tilt cap and pivot table the finish module and the world audit share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
require(path.join(ROOT, 'public', 'play', 'modules', 'finish', 'finish-math.js'));
const M = (globalThis as any).HawkesFinishMath;

test('finish-math: 5 cm float rule and large-prop sink', () => {
  assert.equal(M.FLOAT_M, 0.05);
  assert.equal(M.badGap(0.06), 'floating');
  assert.equal(M.badGap(0.04), null);
  assert.equal(M.badGap(-0.06), 'sunk');
  const small = M.sinkOf([0.5, 0.5, 0.5], null);
  assert.equal(small.tilt, true);
  assert.ok(small.sink < 0.01);
  const large = M.sinkOf([2, 2, 2], null);
  assert.equal(large.tilt, false);
  assert.ok(large.sink >= M.LARGE_SINK_M);
});

test('finish-math: pivot table digs oaks and rocks', () => {
  const oak = M.sinkOf([1, 3, 1], 'a_3360deb351df9daa');
  assert.ok(oak.sink > 0 && oak.sink <= M.FLOAT_M, `oak sink ${oak.sink} within 5 cm`);
  const rock = M.pivotOf('rock.glb');
  assert.ok(rock && rock.sink > 0 && rock.sink <= M.FLOAT_M);
});

test('finish-math: tilt is capped at 15 degrees', () => {
  const steep = M.clampTilt(0.9, 0.1, 0, 15);
  const ang = Math.acos(Math.max(-1, Math.min(1, steep[1]))) * 180 / Math.PI;
  assert.ok(ang <= 15.1, `tilt ${ang}`);
  const t = M.tiltDegrees(0.9, 0.1, 0, 15);
  assert.ok(Math.abs(t.pitch) <= 15.1 || Math.abs(t.roll) <= 15.1);
});

test('finish-math: targetY puts the bottom on the ground with contact', () => {
  // Entity at y=5, bottom 1 m below → bottom at 4; ground at 4.2 → raise by 0.2 + contact.
  const y = M.targetY(4.2, 4, 5, { sink: 0, lift: 0 });
  assert.ok(Math.abs(y - (5 + (4.2 + M.CONTACT_M - 4))) < 1e-9);
});
