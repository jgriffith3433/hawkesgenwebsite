// HUD layout (modules/hudlayout): the rule for how much of the right side a panel takes, and the phone compact fold.
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
  assert.equal(c(700, 300, 380), 0, 'under 760 wide: bottom sheet, no right reserve');
  assert.equal(c(1280, 200, 400), 0, 'not at the right side');
  assert.equal(H.hudLayout.reserved(), 0);
});

test('phone compact folds under 760 wide or under 500 tall; sheet is bottom or side', () => {
  const { compact, sheet } = H.hudLayout;
  assert.equal(compact(390, 844), true, 'portrait phone');
  assert.equal(compact(844, 390), true, 'short landscape');
  assert.equal(compact(1280, 720), false, 'desktop');
  assert.equal(compact(760, 500), false, 'exactly at the cuts');
  assert.equal(compact(759, 900), true);
  assert.equal(compact(900, 499), true);
  assert.equal(sheet(390, 844), 'bottom');
  assert.equal(sheet(844, 390), 'side');
  assert.equal(sheet(1280, 720), null);
  // Short landscape still reserves on the right when the panel is a side sheet (width >= 760).
  assert.equal(H.hudLayout.compute(844, 844 - 10 - 280, 280), 844 - (844 - 10 - 280) + 12);
});
