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
  // (What the script keeps on window across a hot reload is a fresh page's here.)
  for (const k of ['__islandEarly', '__islandNudged', '__islandRescue', '__islandPlayed', '__islandAsked', '__islandJourney']) delete g.window[k];
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

test('sandbox: the tour tracker shows the step, the count, a hint after 20 s and a flourish', () => {
  const game = start();
  H.tick(3);
  const q = game.events.quests;
  if (q.state('tour') !== 'active') q.start('tour');
  H.tick(0.5);
  const el = () => game.ui.el('tour-track');
  assert.ok(el() && !el().hidden, 'the tracker is up');
  assert.match(el().children[1].textContent, /Drive the 4x4 to the dock/);
  assert.match(el().children[0].textContent, /1 of 7/);
  assert.ok(!el().classList.contains('hint'), 'no hint yet');
  H.tick(21);
  assert.ok(el().classList.contains('hint'), 'a hint after 20 s');
  assert.ok(el().children[2].textContent.length > 10);
  q.advance('tour');
  H.tick(0.5);
  assert.match(el().children[0].textContent, /2 of 7/);
  assert.ok(el().classList.contains('flash'), 'a flourish');
  assert.ok(!el().classList.contains('hint'), 'the hint starts over');
  // (The quest module's screen-edge arrow needs a real DOM's lastChild: the fake one has none.)
  assert.deepEqual([...errors, ...errorBox()].filter((e) => !/^quests: .*textContent/.test(e)), []);
});

test('sandbox: the account sheet shows who they are and the Overseer asks, in its voice', () => {
  assert.match(Guest ? sandboxCtx.window.HawkesGuestCore.sheetLine('Toast') : '', /^Toast\. .*Tell me where to find you, and I will keep this world for you\.$/);
  const line = sandboxCtx.window.HawkesGuestCore.sheetLine('');
  assert.match(line, /Tell me where to find you/);
  assert.doesNotMatch(line, /!|\bmust\b|\bshould\b|credit|\bbecause\b/i);
  assert.equal(sandboxCtx.window.HawkesGuestCore.sheetLine('<b>x</b>').includes('<'), false);
  start();
  H.presence.setLook && H.presence.setLook({ what: 'penguin', body: '#112233', name: 'Waddle' });
  const who = sandboxCtx.window.HawkesGuestCore.character(H);
  assert.equal(who.label, 'A penguin');
  assert.equal(who.name, 'Waddle');
  assert.equal(who.color, '#112233');
});

test('sandbox: the sheet holds the game still (controls, keys and sounds) and gives it back', () => {
  const src = guestSrc;
  assert.match(src, /function lockGame/);
  assert.match(src, /p\.controls = false/);
  assert.match(src, /H\.audio\.hold\('guest-sheet', true\)/);
  assert.match(src, /stopImmediatePropagation/);
  assert.match(src, /const close = \(\) => \{ unlock\(\)/);
  // The engine's hold is a no-op without WebAudio (Node), and reports itself.
  assert.equal(H.audio.hold('t', true), true);
  assert.equal(H.audio.hold('t', false), false);
});

// ------------------------------------------------------------------ rescue, out of order, Pip's nudge
const tourOn = () => {
  const game = start();
  H.tick(3);
  const q = game.events.quests;
  if (q.state('tour') !== 'active') q.start('tour');
  H.tick(0.5);
  return { game, q };
};
const clean = () => [...errors, ...errorBox()].filter((e) => !/^quests: .*(textContent|properties of (null|undefined))/.test(e));
const upY = (e: any) => { const v = e.vehicle; return v && v.up ? v.up.y : 1; };

test('sandbox: Stuck? puts a flipped 4x4 and the player back, with a beam and the Overseer\'s line', () => {
  const { game, q } = tourOn();
  const jeep = H.world.byId.get('jeep');
  jeep.position = [30, 9, 40]; jeep.rotation = [0, 0, 180];
  const seen: any[] = []; const beams: any[] = []; const said: string[] = [];
  game.on('rescue', (d: any) => seen.push(d));
  game.on('beam', (d: any) => beams.push(d));
  const o = game.overseer; const say0 = o && o.say;
  if (o) o.say = (t: string) => { said.push(t); };
  game.player.position = [40, 6, 40];
  H.tick(3);
  g.window.__islandRescueNow('button');
  H.tick(1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].step, 'drive');
  assert.ok(Math.hypot(jeep.x - 4, jeep.z - 6.5) < 3, `the 4x4 is back by the start (${jeep.x.toFixed(1)}, ${jeep.z.toFixed(1)})`);
  assert.ok(upY(jeep) > 0.5, 'and the right way up');
  assert.ok(Math.hypot(game.player.x - jeep.x, game.player.z - jeep.z) < 12, 'the player is beside it');
  assert.ok(beams.length >= 1, 'a beam');
  assert.ok(said.length >= 1, 'the Overseer speaks');
  if (o) o.say = say0;
  assert.equal(q.step('tour'), 'drive', 'rescuing does not move the tour');
  assert.deepEqual(clean(), []);
});

test('sandbox: Stuck? gets the player out of the sea to the step\'s place, and the same press twice in a row is ignored', () => {
  const { game } = tourOn();
  const q = game.events.quests;
  for (const id of ['drive', 'rod']) { if (q.step('tour') === id) q.advance('tour'); H.tick(0.3); }
  assert.equal(q.step('tour'), 'fish');
  game.player.position = [95, -1, 12]; // in the sea beyond the pier
  H.tick(0.5);
  const rescue = g.window.__islandRescueNow;
  assert.equal(rescue('sea'), true);
  H.tick(0.5);
  assert.ok(game.player.x < 90 && Math.abs(game.player.z) < 3, `on the pier (${game.player.x.toFixed(1)}, ${game.player.z.toFixed(1)})`);
  assert.equal(game.player.tool, 'rod', 'the rod is in hand');
  assert.equal(rescue('key'), false, 'not twice in two seconds');
});

test('sandbox: Stuck? brings destroyed barrels and a lost launcher back on the boom step, and a wrecked helicopter on the last', () => {
  const { game } = tourOn();
  const q = game.events.quests;
  for (const id of ['drive', 'rod', 'fish']) { if (q.step('tour') === id) q.advance('tour'); H.tick(0.3); }
  assert.equal(q.step('tour'), 'boom');
  for (let i = 1; i <= 5; i++) H.world.byId.get(`barrel_${i}`).destroy();
  game.player.tool = null;
  H.tick(0.5);
  g.window.__islandRescueNow('key');
  H.tick(0.5);
  assert.equal((game.all('Fuel barrel') || []).filter((b: any) => b.alive).length, 5, 'five barrels again');
  assert.equal(game.player.tool, 'rocket-launcher');
  for (const id of ['boom', 'spawn', 'ask']) { if (q.step('tour') === id) q.advance('tour'); H.tick(0.3); }
  H.tick(3);
  game.all('Helicopter').forEach((h: any) => h.destroy());
  H.tick(3);
  g.window.__islandRescueNow('key');
  H.tick(1);
  const heli = game.all('Helicopter').find((h: any) => h.alive);
  assert.ok(heli, 'a helicopter again');
  assert.ok(Math.hypot(heli.x - 30, heli.z - 30) < 4, 'on its pad');
  assert.deepEqual(clean(), []);
});

test('sandbox: steps done out of order pass when the tour gets to them', () => {
  const { game, q } = tourOn();
  // Flying first and firing the barrels first: the deeds are kept.
  game.emit('sandbox-high', { height: 300, mine: true });
  game.emit('explosion', { at: [50, 1, -18] });
  game.emit('spawned', { what: 'cow', count: 1 });
  game.emit('asked', { skipped: true });
  H.tick(2);
  assert.equal(q.step('tour'), 'drive', 'the tour waits for the first four steps');
  const played: string[] = [];
  game.on('tour', (d: any) => played.push(d.step));
  game.player.position = [60, 3, 0]; // the dock
  H.tick(0.7);
  // The rod and the fish are done for real; then the rest pass by themselves, each with its moment.
  game.emit('pickup', { gives: 'tool', tool: 'rod' });
  game.emit('catch', { fish: 'tuna', mine: true });
  for (let i = 0; i < 80 && q.state('tour') === 'active'; i++) H.tick(0.25);
  assert.equal(q.state('tour'), 'done', 'the tour finishes');
  assert.deepEqual(played.filter((s) => ['drive', 'fish', 'boom', 'spawn', 'ask', 'fly'].includes(s)), ['drive', 'fish', 'boom', 'spawn', 'ask', 'fly'].filter((s) => played.includes(s)));
  for (const s of ['drive', 'fish', 'boom', 'spawn', 'ask', 'fly']) assert.ok(played.includes(s), `${s} has its moment`);
  assert.deepEqual(clean(), []);
});

test('sandbox: after the last step the Overseer invites them up, a beam and an arrow lead to the rocket, and a failed climb is never a dead end', () => {
  const { game, q } = tourOn();
  const said: string[] = [];
  const o = game.overseer; const say0 = o.say; const speak0 = o.speak;
  o.say = (t: string) => { said.push(t); };
  o.speak = (t: string) => { said.push(t); };
  const journey: string[] = [];
  game.on('journey', (d: any) => journey.push(d.state + (d.why ? `:${d.why}` : '')));
  for (const id of ['drive', 'rod', 'fish', 'boom', 'spawn', 'ask']) { if (q.step('tour') === id) q.advance('tour'); H.tick(0.3); }
  assert.equal(q.step('tour'), 'fly');
  assert.equal(g.window.__islandJourney.state, 'off', 'nothing before the tour is done');
  game.emit('sandbox-high', { height: 300, mine: true });
  for (let i = 0; i < 80 && q.state('tour') === 'active'; i++) H.tick(0.25);
  assert.equal(q.state('tour'), 'done');
  for (let i = 0; i < 60 && g.window.__islandJourney.state === 'off'; i++) H.tick(0.25);
  assert.equal(g.window.__islandJourney.state, 'invited');
  assert.ok(said.includes('Come and see where I live.'), `the invitation (${said.join(' | ')})`);
  H.tick(0.6);
  const box = game.ui.el('journey-track');
  assert.ok(box && !box.hidden, 'the tracker is up');
  assert.match(box.children[1].textContent, /Come and see where I live/);
  assert.ok(g.window.__islandJourney.beam, 'a beam over the rocket');
  assert.ok(g.window.__islandJourney.mark, 'and an arrow over it');
  assert.ok(game.ui.el('tour-stuck') && !game.ui.el('tour-stuck').hidden, 'Stuck? stays for the journey');
  // The rocket is wrecked on the way up: the Overseer says so, and a new one stands on the pad, free.
  const rocket = game.all('Rocket')[0];
  game.emit('ascent-failed', { why: 'wrecked', vehicle: rocket, handled: false });
  rocket.destroy();
  for (let i = 0; i < 40; i++) H.tick(0.25);
  const fresh = game.all('Rocket').find((r: any) => r.alive);
  assert.ok(fresh && Math.hypot(fresh.x - -38, fresh.z - -30) < 4, 'a new rocket on the pad');
  assert.ok(said.includes('That one is gone. I will send another.') && said.includes('A new one, from me.'), `the Overseer answers (${said.join(' | ')})`);
  assert.ok(journey.includes('retry:wrecked') && journey.includes('new-rocket:wrecked'));
  // Docking ends it.
  game.emit('docked-pad', { vehicle: fresh });
  H.tick(0.6);
  assert.equal(g.window.__islandJourney.state, 'docked');
  assert.ok(game.ui.el('journey-track').hidden, 'the lesson is put away');
  o.say = say0; o.speak = speak0;
  assert.deepEqual(clean(), []);
});

test('sandbox: Pip nudges after 30 s on a step, once per step', () => {
  const { game, q } = tourOn();
  const nudges: string[] = [];
  game.on('nudge', (d: any) => nudges.push(d.step));
  H.tick(25);
  assert.deepEqual(nudges, [], 'not yet');
  H.tick(8);
  assert.deepEqual(nudges, ['drive']);
  H.tick(40);
  assert.deepEqual(nudges, ['drive'], 'once per step');
  q.advance('tour');
  H.tick(25);
  assert.deepEqual(nudges, ['drive']);
  H.tick(10);
  assert.deepEqual(nudges, ['drive', 'rod'], 'the next step has its own');
  assert.deepEqual(clean(), []);
});
