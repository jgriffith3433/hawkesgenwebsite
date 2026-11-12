// The painted sky's plain logic (public/play/modules/overseer/skypaint.js): which sky owns an hour, and that a jump in the
// clock still takes at least 20 s to dissolve. The GPU parts are the island-look playtest's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const src = fs.readFileSync(path.join(process.cwd(), 'public/play/modules/overseer/skypaint.js'), 'utf8');
const win: any = {};
const B: any = { Effect: { ShadersStore: {} } };
win.HawkesPlay = { lib: {}, sky: { onEnter() {} } };
vm.runInNewContext(src, { window: win, BABYLON: B, document: {}, performance: { now: () => 0 } });
const P = win.HawkesPlay.skyPaint;

test('each key hour belongs to its own sky and the weights sum to one', () => {
  const at = (h: number) => P.weightsAt(h);
  assert.ok(at(6.3)[0] > 0.99 && at(12)[1] > 0.99 && at(18.9)[2] > 0.99 && at(23.5)[3] > 0.99 && at(1)[3] > 0.99);
  for (let h = 0; h < 24; h += 0.25) assert.ok(Math.abs(at(h).reduce((a: number, b: number) => a + b, 0) - 1) < 1e-9, `sum at ${h}`);
});

test('a jump from dusk to night dissolves over at least 20 s, never in one frame', () => {
  let w = P.weightsAt(18.9);
  const target = P.weightsAt(22.4);
  let t = 0, worst = 0;
  while (w[3] < 0.999 && t < 60) { const n = P.follow(w, target, 1 / 60); worst = Math.max(worst, ...n.map((v: number, i: number) => Math.abs(v - w[i]))); w = n; t += 1 / 60; }
  assert.ok(t >= 19.5, `took ${t} s`);
  assert.ok(worst <= 1 / (20 * 60) + 1e-6, `worst frame step ${worst}`);
});
