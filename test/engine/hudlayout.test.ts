// HUD layout (modules/hudlayout): the rule for how much of the right side a panel takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.ts';

const H = await load();

test('a side panel reserves its width and a gap; closed or a bottom sheet reserves nothing', () => {
  const c = H.hudLayout.compute;
  assert.equal(c(1280, 864, 400), 1280 - 864 + 12);
  assert.equal(c(1440, 1024, 400), 1440 - 1024 + 12);
  assert.equal(c(1280, 864, 0), 0, 'no panel');
  assert.equal(c(390, 10, 370), 0, 'a phone: the panel is a bottom sheet');
  assert.equal(c(1280, 200, 400), 0, 'not at the right side');
  assert.equal(H.hudLayout.reserved(), 0);
});
