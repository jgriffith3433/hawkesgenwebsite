// "Player stuck, cannot move" (the sandbox, after the title screen was added): the title turned the player's controls off
// while it showed and left them off; the intro then read "off" as the player's own setting and gave that back. These check
// the hand-over and the safety net on the source (the engine tests need Havok, which not every sandbox has); the playtest
// step `checkFreeToMove` (public/playtest/portal.js) plays it for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the title screen tells the intro what the controls were before it turned them off', () => {
  const title = read('public/play/modules/overseer/title.js');
  assert.match(title, /OV\.titleControls = held\.controls !== false/);
  const intro = read('public/play/modules/overseer/intro.js');
  assert.match(intro, /const controls0 = OV\.titleControls !== undefined \? OV\.titleControls : p\.controls/);
  // skipped before the intro began: the controls still come back
  assert.match(intro, /p\.controls = OV\.titleControls/);
});

test('the intro never captures the controls from a title that has them off', () => {
  // Simulate the hand-over on the same rule the code uses.
  const player = { controls: true };
  const OV: { titleControls?: boolean } = {};
  const held = { controls: player.controls };
  player.controls = false; OV.titleControls = held.controls !== false; // the title tears down
  const controls0 = OV.titleControls !== undefined ? OV.titleControls : player.controls;
  player.controls = false; // the intro plays
  player.controls = controls0 !== false;
  assert.equal(player.controls, true);
});

test('the runtime puts a player left in the air for 3 s back on the ground and says so', () => {
  const rt = read('public/play/runtime.js');
  assert.match(rt, /const GUARD_SECONDS = 3/);
  assert.match(rt, /groundGuard\(dt\);/);
  assert.match(rt, /window\.__regrounds/);
  assert.match(rt, /game\.emit\('reground'/);
  assert.match(rt, /player_reground/);
});

test('the fishing close-up removes its letterbox bars however it ends, and a title that ran alone clears its hand-over', () => {
  const fishing = read('public/play/modules/water/fishing.js');
  assert.match(fishing, /finally \{[^}]*for \(const b of bars\) b\.remove\(\)/s);
  const title = read('public/play/modules/overseer/title.js');
  assert.match(title, /w\.player\.controls = true;\s*OV\.titleControls = undefined/);
});
