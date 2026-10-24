// The guest sandbox (/play/sandbox, src/templates.ts 'sandbox') in the real engine: it builds with no errors, things
// land on the island, the tools are on the belt, and public/play/guest.js turns the changed world back into scene ops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { load, world as run } from './harness.ts';
import { templateBundle } from '../../src/templates.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = await load();
const g = globalThis as any;
const errors: string[] = [];
H.report = (e: any, where?: string) => { errors.push(String(where || '') + ': ' + String((e && e.message) || e)); };
const errorBox = () => (g.document.getElementById('error').children as any[]).map((c) => c.textContent);

const bundle = templateBundle('sandbox')!;
const scene = JSON.parse(bundle.files['scene.json']);

// guest.js's pure part (the snapshot as ops), loaded the way the page does: a script that sets window.HawkesGuest.
const guestSrc = fs.readFileSync(path.join(ROOT, 'public', 'play', 'guest.js'), 'utf8');
const sandboxCtx: any = { window: {}, console };
vm.runInNewContext(guestSrc, sandboxCtx, { filename: 'guest.js' });
const Guest = sandboxCtx.window.HawkesGuestCore;

function start() {
  errors.length = 0;
  run(H, { ...scene, config: { ...scene.config, look: false, shadows: false } }, { mode: 'play', scripts: { 'scripts/main.js': bundle.files['scripts/main.js'] } });
  return H.game;
}

test('sandbox: the island builds from the modules with no errors', () => {
  const game = start();
  H.tick(3);
  assert.deepEqual([...errors, ...errorBox()], []);
  assert.ok(game.terrain && game.terrain.heightAt(0, 0) !== null, 'terrain is on');
  assert.ok(Math.abs(game.terrain.heightAt(0, 0) - 4) < 0.6, 'the middle is the flat home ground');
  for (const id of ['jeep', 'boat', 'pip', 'barrel_1', 'crate_1', 'rod', 'dock', 'sheep', 'cows']) assert.ok(H.world.byId.get(id), id);
  // Things stood on the island, not under it or in the sea.
  for (const id of ['jeep', 'barrel_1', 'pip']) {
    const e = H.world.byId.get(id);
    const ground = game.terrain.heightAt(e.x, e.z);
    assert.ok(e.y > ground - 0.2 && e.y < ground + 3, `${id} at y ${e.y.toFixed(2)} over ground ${ground.toFixed(2)}`);
  }
  // The boat floats by the dock.
  const boat = H.world.byId.get('boat');
  assert.ok(boat.y > -1 && boat.y < 1.5, `boat y ${boat.y.toFixed(2)}`);
  // Empty-handed at first: the tour hands out the rocket launcher at the barrels step (sandbox.js), the rest at the end.
  assert.ok(!game.player.tool, 'no tool until the tour gives one');
});

test('sandbox: guest snapshot turns the changed world into scene ops', () => {
  const game = start();
  H.tick(1);
  // Play a little: move the 4x4, blow up a barrel (gone), spawn a cow, dig the ground.
  const jeep = H.world.byId.get('jeep');
  jeep.position = [10, 6, 8];
  H.world.byId.get('barrel_1').destroy();
  game.spawnMany('cow', 1, { at: [0, 5, -6] });
  const edits: any[] = [];
  game.on('terrain', (d: any) => { for (const e of d.edits || []) edits.push(e); });
  game.terrain.dig(-8, 8, 3, 1.5, { share: false });
  H.tick(0.5);
  const snap = Guest.snapshot(H, { edits });
  assert.ok(snap.entities.jeep, 'the 4x4 is kept');
  assert.ok(Math.abs(snap.entities.jeep.transform.position[0] - jeep.x) < 0.05, 'where it is now');
  assert.ok(!snap.entities.barrel_1, 'the blown-up barrel is gone');
  assert.ok(Object.values(snap.entities).some((e: any) => e.type === 'critter' || (e.shape && e.shape.species === 'cow' && e.type !== 'herd')), 'the spawned cow is kept');
  assert.ok(snap.config.terrain.edits && snap.config.terrain.edits.length >= 1, 'the dig is kept');
  const ops = Guest.toOps(scene, snap);
  assert.ok(ops.some((o: any) => o.op === 'delete' && o.id === 'barrel_1'));
  assert.ok(ops.some((o: any) => o.op === 'replace' && o.entity.id === 'jeep'));
  assert.ok(ops.some((o: any) => o.op === 'config' && o.patch.terrain));
  const chunks = Guest.chunks(ops, 200);
  assert.ok(chunks.every((c: any[]) => c.length <= 200));
  // Grenades in the air are not things to keep.
  assert.ok(!Object.values(snap.entities).some((e: any) => e.data && (e.data.grenade || e.data.sticky)));
});

test('sandbox: the tour asks for the Overseer in the chat, and passes that step by itself where there is no chat', () => {
  const game = start();
  H.tick(1);
  const q = game.events.quests;
  const steps = (scene.config.quests[0].steps as any[]).map((st) => st.id);
  assert.deepEqual(steps.slice(-3), ['spawn', 'ask', 'fly'], 'asking the Overseer comes after spawning, before the helicopter');
  if (q.state('tour') !== 'active') q.start('tour');
  H.tick(0.5);
  for (const id of ['drive', 'rod', 'fish', 'boom', 'spawn']) { if (q.step('tour') === id) q.advance('tour'); H.tick(0.3); }
  assert.equal(q.step('tour'), 'ask');
  // No editor here (window.HawkesBuild): the step passes by itself within a couple of seconds.
  for (let i = 0; i < 40 && q.step('tour') === 'ask'; i++) H.tick(0.1);
  assert.equal(q.step('tour'), 'fly');
  // (The quest tracker draws its panel and arrow from innerHTML, which this harness's page doesn't parse: those lines
  // are the harness's, not the game's.)
  assert.deepEqual([...errors, ...errorBox()].filter((e) => !/^quests: Cannot (read|set) properties of (null|undefined)/.test(e)), []);
});
