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
  for (const k of ['__islandEarly', '__islandNudged', '__islandRescue', '__islandPlayed', '__islandAsked', '__islandJourney', '__islandNoticed', '__islandFuelled', '__islanderDid', '__islanderHeard', '__islanderLog', '__islanderListening', '__islandJournal', '__island']) delete g.window[k];
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
  assert.deepEqual(steps, ['drive', 'rod', 'fish', 'boom', 'spawn', 'ask', 'hill', 'fly', 'launch'], 'Chapter One in order: the hill is quest 6, the helicopter 7, the launch pad 8');
  if (q.state('tour') !== 'active') q.start('tour');
  H.tick(0.5);
  for (const id of ['drive', 'rod', 'fish', 'boom', 'spawn']) { if (q.step('tour') === id) q.advance('tour'); H.tick(0.3); }
  assert.equal(q.step('tour'), 'ask');
  // No editor here (window.HawkesBuild): the step passes by itself within a couple of seconds.
  for (let i = 0; i < 40 && q.step('tour') === 'ask'; i++) H.tick(0.1);
  assert.equal(q.step('tour'), 'hill');
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
  assert.match(el().children[0].textContent, /2 of 8/);
  assert.ok(!el().classList.contains('hint'), 'no hint yet');
  H.tick(21);
  assert.ok(el().classList.contains('hint'), 'a hint after 20 s');
  assert.ok(el().children[2].textContent.length > 10);
  q.advance('tour');
  H.tick(0.5);
  assert.match(el().children[0].textContent, /3 of 8/);
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

test('sandbox: the rod rests on the pier\'s planks, however the load went and wherever Stuck? puts it', () => {
  const { game, q } = tourOn();
  const pier = H.world.byId.get('pier'), rod = H.world.byId.get('rod');
  const top = pier.y + 0.15; // (the planks are 0.3 m thick)
  const check = (why: string) => {
    const seat = rod.y - top; // (the pad sits on the planks; the floating tool bobs over it)
    assert.ok(seat > 0 && seat < 0.4, `${why}: the rod's pad is on the planks (${seat.toFixed(2)} m over them)`);
    const item = rod.pickup.item;
    assert.ok(item.position.y > 0.45 && item.position.y < 0.65, `${why}: the tool bobs about 0.55 m over its pad (${item.position.y.toFixed(2)})`);
  };
  check('at the start');
  H.tick(20);
  check('20 s later');
  // The world file and the guide agree on the rod's place (the guide puts it back with Stuck?).
  const home = scene.entities.rod.transform.position;
  assert.deepEqual([home[0], home[2]], [86.5, -0.4]);
  assert.ok(/rodY: ?1\.15\b/.test(bundle.files['scripts/main.js']) && Math.abs(home[1] - 1.15) < 1e-9, 'the guide\'s rod height is the world file\'s');
  // Stuck? on the rod step: the terrain there is the seabed 4 m down, and before it has answered it is a guess (the
  // guide once put the rod at that guess plus 1.15: under the sea, or 4 m over the planks).
  if (q.step('tour') === 'drive') q.advance('tour');
  H.tick(0.3);
  assert.equal(q.step('tour'), 'rod');
  const rescue = g.window.__islandRescueNow;
  const heightAt = game.terrain.heightAt;
  for (const [why, answer] of [['seabed', heightAt], ['terrain not answering', () => null]] as const) {
    rod.position = [rod.x, rod.y + 5, rod.z]; // (somewhere it should not be)
    game.terrain.heightAt = answer;
    g.window.__islandRescue.last = -99;
    assert.equal(rescue('key'), true);
    game.terrain.heightAt = heightAt;
    H.tick(0.3);
    check(`Stuck? (${why})`);
  }
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
  for (const id of ['boom', 'spawn', 'ask', 'hill']) { if (q.step('tour') === id) q.advance('tour'); H.tick(0.3); }
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
  game.emit('sandbox-planet', { height: 1200, mine: true });
  game.emit('sandbox-high', { height: 300, mine: true });
  game.emit('sandbox-hill', { mine: true });
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
  assert.deepEqual(played.filter((s) => ['drive', 'fish', 'boom', 'spawn', 'ask', 'hill', 'fly', 'launch'].includes(s)), ['drive', 'fish', 'boom', 'spawn', 'ask', 'hill', 'fly', 'launch'].filter((s) => played.includes(s)));
  for (const s of ['drive', 'fish', 'boom', 'spawn', 'ask', 'hill', 'fly', 'launch']) assert.ok(played.includes(s), `${s} has its moment`);
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
  for (const id of ['drive', 'rod', 'fish', 'boom', 'spawn', 'ask', 'hill']) { if (q.step('tour') === id) q.advance('tour'); H.tick(0.3); }
  assert.equal(q.step('tour'), 'fly');
  assert.equal(g.window.__islandJourney.state, 'off', 'nothing before the last quest is reached');
  game.emit('sandbox-high', { height: 300, mine: true });
  for (let i = 0; i < 80 && q.step('tour') === 'fly'; i++) H.tick(0.25);
  assert.equal(q.step('tour'), 'launch');
  for (let i = 0; i < 60 && g.window.__islandJourney.state === 'off'; i++) H.tick(0.25);
  assert.equal(g.window.__islandJourney.state, 'invited');
  H.tick(0.6);
  const box = game.ui.el('journey-track');
  assert.ok(box && !box.hidden, 'the tracker is up');
  assert.match(box.children[1].textContent, /Rolo's rocket/);
  assert.ok(game.ui.el('tour-track').hidden, 'and the tour tracker gives way to it');
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

// ------------------------------------------------------------------ the islanders (islanders.js; docs/story.md 5b)
const CAST_IDS = ['bobbin', 'ember', 'rolo', 'dolores', 'channel'];
const islanderLines = () => {
  const chat: any[] = [];
  H.chat = { ...(H.chat || {}), line: (m: any) => { chat.push(m); } };
  return chat;
};
const resetIslanders = () => { for (const k of ['__islanderDid', '__islanderHeard', '__islanderLog', '__islanderListening', '__islanders']) delete g.window[k]; };
// (The harness has no intro to end, so the mirror stays "about to open"; here it has been answered.)
const mirrorDone = (game: any) => { try { game.mirror.close(); } catch { /* none open */ } Object.defineProperty(game, 'mirror', { value: { pending: false }, configurable: true }); H.tick(0.3); };
const stand = (game: any, id: string, d = 1.8) => { const e = H.world.byId.get(id); game.player.position = [e.x - d, e.y + 0.5, e.z]; H.tick(0.7); return e; };
const BODY_WORDS = /\b(toaster|duck|cactus|roll-?bot|robot|television|shoe|potato|banana|teapot|mushroom|cone|dog|cat|fox|pig|bear|rabbit|penguin|chicken|cow|sheep|horse|dinosaur|person|human)\b/i;

test('sandbox islanders: five named neighbours stand on the island, in the mirror\'s bodies, with talk in the chat only', () => {
  resetIslanders();
  const game = start();
  H.tick(2);
  for (const id of CAST_IDS) {
    const e = H.world.byId.get(id);
    assert.ok(e && e.alive, id);
    // (Bobbin stands on the pier's planks, 1.1 m up over the sea's edge.)
    const ground = id === 'bobbin' ? 1.1 : game.terrain.heightAt(e.x, e.z);
    assert.ok(ground > 0, `${id} is on land (${ground.toFixed(1)})`);
    assert.ok(e.y > ground - 0.3 && e.y < ground + 3.5, `${id} stands at ${e.y.toFixed(2)} over ${ground.toFixed(2)}`);
    assert.equal(e.living.friend.talk, false, `${id} has no phrasebook panel: the chat window is where they talk`);
    assert.ok(e.living.friend.look && e.living.friend.look.what, `${id} wears a body`);
  }
  assert.deepEqual(CAST_IDS.map((id) => H.world.byId.get(id).living.friend.look.what), ['duck', 'toaster', 'rollbot', 'cactus', 'tvbot']);
  // The tag they carry is their name; none of the scene's voice lines or assets are new.
  assert.deepEqual(CAST_IDS.map((id) => H.world.byId.get(id).name), ['Admiral Bobbin', 'Mrs Ember', 'Rolo', 'Dolores', 'Channel']);
  assert.ok(!Object.keys(bundle.files).some((f) => /islander|bobbin|ember|rolo|dolores|channel/i.test(f) && /\.(mp3|wav|ogg)$/.test(f)), 'no voice files');
  assert.deepEqual(clean(), []);
});

test('sandbox islanders: E near one (H.use) puts a short line in the chat window, and phones get the same button', () => {
  resetIslanders();
  const chat = islanderLines();
  const game = start();
  H.tick(2);
  stand(game, 'rolo');
  const spoken: any[] = [];
  game.on('islander', (d: any) => spoken.push(d));
  const offers = H.use.offers(game.player);
  assert.ok(offers.some((o: any) => o.name === 'island:talk' && /Talk to Rolo/.test(o.label)), 'Talk to Rolo is on offer');
  assert.equal(offers[0].name, 'island:talk', 'it is the best offer near him');
  const before = chat.length;
  H.use.act();
  assert.ok(chat.length > before, 'a line in the chat window');
  const m = chat[chat.length - 1];
  assert.equal(m.kind, 'npc');
  assert.equal(m.who, 'Rolo');
  assert.ok(m.text.length > 5 && m.text.length < 200, 'short');
  // Never the same line twice in a row, however often you ask.
  const texts = [m.text];
  for (let i = 0; i < 8; i++) { H.use.act(); texts.push(chat[chat.length - 1].text); }
  for (let i = 1; i < texts.length; i++) assert.notEqual(texts[i], texts[i - 1]);
  assert.ok(spoken.length >= 1);
  assert.deepEqual(clean(), []);
});

test('sandbox islanders: what the player did changes what at least four of them say, and nobody names what the mirror made them', () => {
  resetIslanders();
  const chat = islanderLines();
  const game = start();
  H.tick(2);
  H.presence.look = { ...(H.presence.look || {}), name: 'Plink', what: 'shoe' };
  mirrorDone(game);
  assert.ok(!game.mirror.pending, 'the mirror is done: they greet only after it');
  const said = (id: string) => { stand(game, id); const n = chat.length; H.use.act(); return chat.slice(n).map((c: any) => c.text).join(' | '); };
  const topic = (id: string) => g.window.__islanderLog.filter((l: any) => l.id === id).map((l: any) => l.topic);
  // Before doing anything: hellos (they come by themselves when you walk up) and ordinary lines.
  for (const id of CAST_IDS) { stand(game, id); }
  for (const id of CAST_IDS) assert.equal(topic(id)[0], 'hello', `${id} greets`);
  // The deeds: a fish, a blast, a flight.
  game.emit('catch', { fish: 'tuna', mine: true });
  game.emit('explosion', { at: [50, 1, -18] });
  game.emit('sandbox-high', { height: 300, mine: true });
  H.tick(0.5);
  const after: Record<string, string> = {};
  for (const id of CAST_IDS) after[id] = said(id);
  const reacted = CAST_IDS.filter((id) => !topic(id).slice(-1).includes('base') && topic(id).slice(-1)[0] !== 'hello');
  assert.ok(reacted.length >= 4, `at least four react to a deed (${reacted.join(', ')}): ${JSON.stringify(topic('bobbin'))}`);
  assert.match(after.bobbin, /cast/i, 'Bobbin rates the cast');
  assert.match(after.channel, /BOOM|Sources/, 'Channel reports the blast');
  assert.match(after.dolores, /helicopter/i, 'Dolores watched the climb');
  assert.match(after.rolo + ' ' + after.ember, /./);
  // The name they chose is used; what the mirror made them is never mentioned, by anyone, in any line.
  const all = CAST_IDS.flatMap((id) => g.window.__islanders.CAST[id] ? [id] : []);
  assert.equal(all.length, 5);
  for (const id of CAST_IDS) for (let i = 0; i < 12; i++) said(id);
  const lines: string[] = g.window.__islanderLog.map((l: any) => l.text);
  assert.ok(lines.some((t) => t.includes('Plink')), 'the name they chose is used');
  for (const t of lines) assert.ok(!BODY_WORDS.test(t.replace(/Rolo|Channel/g, '')), `no remark on a body: ${t}`);
  // A different player body changes nothing in how they talk to them.
  assert.deepEqual(clean(), []);
});

test('sandbox islanders: an earlier visit is remembered (H.memory), the ordinary lines carry no work talk, and they stay clear of the tour', () => {
  resetIslanders();
  const chat = islanderLines();
  const game = start();
  H.tick(2);
  const mem = H.memory.get();
  const old = H.memory.get;
  H.memory.get = () => ({ ...mem, visits: 3, name: null, n: { ...mem.n, fish: 4, boom: 3 } });
  try {
    stand(game, 'bobbin'); H.use.act(); // hello was said on arrival; this is the first real line
    const topics = () => g.window.__islanderLog.filter((l: any) => l.id === 'bobbin').map((l: any) => l.topic);
    for (let i = 0; i < 4; i++) H.use.act();
    assert.ok(topics().includes('fish3') || topics().includes('back'), `Bobbin remembers earlier visits: ${topics()}`);
    const t = g.window.__islanderLog.find((l: any) => l.id === 'bobbin' && l.topic === 'fish3');
    if (t) assert.match(t.text, /Fish number 4/);
  } finally { H.memory.get = old; }
  // The story's rules: no office or game talk in anyone's mouth.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'overseer-games', 'islanders.js'), 'utf8');
  assert.ok(!/\b(quest|level|achievement|unlock|credits?|price|meeting|deadline|boss|office|salary|invoice|customer|subscribe)\b/i.test(src.split('const CAST')[1].split('const ids')[0]), 'no work, game or business words in the lines');
  // The tracker and the Stuck? button are not touched: the islanders add no screen element of their own.
  assert.ok(!src.includes('game.ui.'), 'no HUD of their own (phones keep the tracker and buttons clear)');
  assert.deepEqual(clean(), []);
});

// ------------------------------------------------------------------ Chapter One's new quests (docs/story.md section 5: 6 and 8)
test('sandbox chapter one: quest 6, the hill: Dolores says hello, the quest passes with her line, a beam on the helicopter', () => {
  const { game, q } = tourOn();
  mirrorDone(game);
  const chat = islanderLines();
  const beats: any[] = [];
  game.on('beat', (d: any) => beats.push(d));
  const tour: string[] = [];
  game.on('tour', (d: any) => tour.push(d.step));
  for (const id of ['drive', 'rod', 'fish', 'boom', 'spawn', 'ask']) { if (q.step('tour') === id) q.advance('tour'); H.tick(0.3); }
  assert.equal(q.step('tour'), 'hill');
  stand(game, 'dolores', 3);
  for (let i = 0; i < 10 && q.step('tour') === 'hill'; i++) H.tick(0.3);
  assert.equal(q.step('tour'), 'fly', 'saying hello passed the hill');
  H.tick(3);
  assert.ok(tour.includes('hill'));
  assert.ok(chat.some((m: any) => m.who === 'Dolores' && /wasn't waiting|was not waiting/.test(m.text)), 'Dolores says she was not waiting');
  assert.ok(beats.some((b: any) => b.who === 'Dolores' && /pad is free/.test(b.text)), 'and the pad is free');
  assert.deepEqual(clean(), []);
});

test('sandbox chapter one: quest 8, the launch pad: fuel, the planet whole, and the two closing lines, nothing about why', () => {
  const { game, q } = tourOn();
  mirrorDone(game);
  const said: string[] = []; const pipSaid: string[] = [];
  const o = game.overseer; o.say = (t: string) => { said.push(t); }; o.speak = (t: string) => { said.push(t); };
  const pip = game.all('Pip')[0]; pip.say = (t: string) => { pipSaid.push(t); };
  const chat = islanderLines();
  const events: string[] = [];
  game.on('bay-lit', () => events.push('bay-lit'));
  game.on('rocket-fuelled', () => events.push('fuelled'));
  for (const id of ['drive', 'rod', 'fish', 'boom', 'spawn', 'ask', 'hill', 'fly']) { if (q.step('tour') === id) q.advance('tour'); H.tick(0.3); }
  assert.equal(q.step('tour'), 'launch');
  H.tick(3);
  assert.equal(g.window.__islandJourney.state, 'invited', 'Rolo\'s rocket is pointed at');
  assert.ok(chat.some((m: any) => m.who === 'Rolo'), 'Rolo speaks');
  // E at the rocket pours in the last of the fuel.
  const rocket = game.all('Rocket')[0];
  game.player.position = [rocket.x + 3, rocket.y, rocket.z];
  H.tick(0.6);
  const offer = H.use.offers(game.player).find((o: any) => /tank/.test(o.label));
  assert.ok(offer, 'E at the rocket offers to fill its tank'); offer.act();
  game.emit('sandbox-planet', { height: 1200, mine: true });
  for (let i = 0; i < 40 && q.state('tour') === 'active'; i++) H.tick(0.25);
  H.tick(5);
  assert.equal(q.state('tour'), 'done', 'the chapter is done');
  assert.ok(events.includes('bay-lit'), 'the lit bay on the sphere');
  assert.ok(pipSaid.includes("Huh. That's new."), `Pip (${pipSaid.join(' | ')})`);
  assert.ok(said.includes('It is yours, if you come.'), `the Overseer (${said.join(' | ')})`);
  const all = [...said, ...pipSaid, ...chat.map((m: any) => m.text)].join(' ');
  assert.doesNotMatch(all, /\b(because|credit|price|account|why I|I wanted|I gave)\b/i, 'the Overseer never says why');
  assert.deepEqual(clean(), []);
});

test('sandbox chapter one: any quest can be done early and the rest are not blocked (the hill and the planet first)', () => {
  const { game, q } = tourOn();
  mirrorDone(game);
  game.emit('sandbox-planet', { height: 1200, mine: true });
  stand(game, 'dolores', 3);
  H.tick(1);
  assert.equal(q.step('tour'), 'drive', 'the first quest still waits for its deed');
  game.player.position = [60, 3, 0];
  H.tick(0.7);
  game.emit('pickup', { gives: 'tool', tool: 'rod' });
  game.emit('catch', { fish: 'tuna', mine: true });
  game.emit('explosion', { at: [50, 1, -18] });
  game.emit('spawned', { what: 'cow', count: 1 });
  game.emit('asked', { skipped: true });
  game.emit('sandbox-high', { height: 300, mine: true });
  for (let i = 0; i < 120 && q.state('tour') === 'active'; i++) H.tick(0.25);
  assert.equal(q.state('tour'), 'done', `stuck on ${q.step('tour')}`);
  assert.deepEqual(clean(), []);
});

test('sandbox chapter one: small things to notice (planks, logbook, "I saw the sea"), quiet and never frightening', () => {
  const { game } = tourOn();
  mirrorDone(game);
  const chat = islanderLines();
  const noticed: string[] = [];
  game.on('notice', (d: any) => noticed.push(d.id));
  assert.ok(H.world.byId.get('logbook') && H.world.byId.get('harbour_desk'), 'the logbook lies on the harbour desk');
  // E at the planks and at the logbook (the offers the script registered with H.use).
  const offerAt = (x: number, z: number) => { game.player.position = [x, 3, z]; H.tick(0.6); return H.use.offers(game.player).find((o: any) => /planks|logbook/.test(o.label)); };
  const planks = offerAt(68, 0);
  assert.ok(planks, 'planks offer'); planks.act();
  const book = offerAt(62.5, 4.2);
  assert.ok(book, 'logbook offer'); book.act();
  assert.ok(chat.some((m: any) => /cut by hand/.test(m.text)) && chat.some((m: any) => /torn out/.test(m.text)));
  assert.deepEqual(noticed, ['planks', 'logbook']);
  const said: string[] = [];
  game.overseer.say = (t: string) => { said.push(t); };
  game.emit('asked', { chars: 30, text: 'What did you see before me?' });
  H.tick(2);
  assert.ok(said.includes('I saw the sea.'), `the Overseer says only that (${said.join(' | ')})`);
  assert.ok(noticed.includes('sea'));
  assert.deepEqual(clean(), []);
});

test('sandbox chapter one: the funnel keeps its events and adds one per new quest', () => {
  assert.match(guestSrc, /STEP_N = \{ drive: 1, fish: 2, boom: 3, spawn: 4, ask: 5, fly: 6, hill: 7, launch: 8 \}/, 'older steps keep their n');
  assert.match(guestSrc, /'sandbox_quest_' \+ d\.step/);
  assert.match(guestSrc, /sandbox_bay_lit/);
  assert.match(guestSrc, /'sandbox_tour_start'/);
  assert.match(guestSrc, /'sandbox_tour_done'/);
});

// ------------------------------------------------------------------ the journal (journal.js; docs/story.md sections 5 and 7)
const J = () => g.window.__island.journal;
const lorePlace = (game: any, id: string) => { const l = J().LORE.find((x: any) => x.id === id); const y = game.terrain.heightAt(l.at[0], l.at[1]); game.player.position = [l.at[0] - 0.8, y + 0.6, l.at[1]]; H.tick(0.5); return l; };

test('sandbox journal: lists the eight quests, the six neighbours and the twelve lore titles', () => {
  H.memory.reset();
  const game = start();
  H.tick(2);
  const m = J().model();
  assert.equal(m.quests.length, 8);
  assert.deepEqual(m.quests.map((q: any) => q.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(m.quests.every((q: any) => q.skippable), 'every quest can be skipped');
  assert.equal(m.quests[0].state, 'now');
  assert.equal(m.cast.length, 6);
  assert.equal(m.lore.length, 12);
  assert.ok(m.lore.filter((l: any) => l.here).length >= 4 && m.lore.filter((l: any) => l.here).length === 8);
  assert.ok(m.lore.every((l: any) => !l.found && l.text === null), 'nothing found yet');
  game.emit('tour', { step: 'drive' });
  game.emit('tour', { step: 'fish' });
  const q = J().model().quests;
  assert.deepEqual(q.map((x: any) => x.state), ['now', 'done', 'done', 'todo', 'todo', 'todo', 'todo', 'todo']);
  assert.deepEqual(clean(), []);
});

test('sandbox journal: opens from the button, N and the menu message; one funnel event each open; the panel shows all three lists', () => {
  const game = start();
  H.tick(2);
  const sent: any[] = [];
  g.window.hgFunnel = (name: string, props: any) => sent.push({ name, props });
  const btn = game.ui.el('journal-btn');
  assert.ok(btn && btn.className === 'jr-btn', 'a small button');
  btn.onclick && btn.onclick({});
  const el = game.ui.el('journal');
  assert.ok(el && !el.hidden, 'the panel is open');
  assert.match(el.innerHTML, /Chapter One/);
  assert.match(el.innerHTML, /Neighbours met/);
  assert.match(el.innerHTML, /Lore found/);
  assert.equal((el.innerHTML.match(/class="jr-q /g) || []).length, 8);
  assert.equal((el.innerHTML.match(/skippable/g) || []).length, 8);
  assert.deepEqual(sent.map((e) => e.name), ['sandbox_journal_open']);
  assert.equal(sent[0].props.from, 'button');
  J().close();
  assert.ok(el.hidden && !game.paused, 'closing resumes the game');
  J().open('menu');
  assert.equal(sent[1].props.from, 'menu');
  J().close();
  delete g.window.hgFunnel;
  assert.deepEqual(clean(), []);
});

test('sandbox journal: E at the objects on the island finds at least four lore items, with their text in the journal and a funnel event', () => {
  H.memory.reset();
  const game = start();
  H.tick(2);
  mirrorDone(game);
  const sent: any[] = [];
  g.window.hgFunnel = (name: string, props: any) => sent.push({ name, props });
  const chat = islanderLines();
  for (const id of ['lamp', 'tally', 'receipt', 'chair', 'drawing']) {
    const l = lorePlace(game, id);
    const o = H.use.offers(game.player).find((x: any) => x.name === 'island:lore');
    assert.ok(o, `${id} is on offer`);
    o.act(); // (a wandering animal can be the nearer offer; E picks the best, this one is the lore's)
    const m = J().model().lore.find((x: any) => x.id === id);
    assert.ok(m.found && m.text.length >= 2, `${id} is found with its text`);
    assert.equal(chat[chat.length - 1].who, l.title);
  }
  // The planks and the logbook are Chapter One's notices (sandbox.js); the letter is at Mrs Ember's mailbox.
  game.emit('notice', { id: 'planks' });
  game.emit('notice', { id: 'logbook' });
  const lore = J().model().lore;
  assert.equal(lore.filter((l: any) => l.found).length, 7);
  assert.equal(sent.filter((e) => e.name === 'sandbox_lore_found').length, 7);
  // Twice is not new: no second event.
  lorePlace(game, 'lamp'); H.use.act();
  assert.equal(sent.filter((e) => e.name === 'sandbox_lore_found').length, 7);
  // The journal shows the found ones' words and the others as not yet found.
  J().open('key');
  const html = game.ui.el('journal').innerHTML;
  assert.match(html, /already lit|The Lamp That Was Already Lit/);
  assert.match(html, /three wobbles/);
  assert.match(html, /Not yet found/);
  assert.match(html, /not on this island yet/);
  // Nobody says why the Overseer does anything, and no prices or work talk.
  const all = J().LORE.map((l: any) => (l.text || []).join(' ')).join(' ');
  assert.doesNotMatch(all, /overseer|free will|credit|price|office|work day|achievement/i);
  J().close();
  delete g.window.hgFunnel;
  assert.deepEqual(clean(), []);
});

test('sandbox journal: neighbours met and lore found are kept with the Overseer\'s memory and survive a return', () => {
  const game = start();
  H.tick(2);
  mirrorDone(game);
  H.memory.reset();
  stand(game, 'dolores');
  H.use.act(); // (Talk to Dolores)
  game.emit('lore-test', {});
  J().find('tally');
  game.emit('islander', { id: 'channel' });
  const rec = H.memory.journal.get();
  assert.ok(rec.met.includes('dolores') && rec.met.includes('channel'));
  assert.deepEqual(rec.lore, ['tally']);
  // A return: the page again, the record read back from the device.
  delete g.window.__islandJournal;
  H.memory.reload();
  const back = H.memory.journal.get();
  assert.deepEqual(back.met.sort(), ['channel', 'dolores']);
  assert.deepEqual(back.lore, ['tally']);
  const game2 = start();
  H.tick(2);
  const m = J().model();
  assert.ok(m.cast.find((c: any) => c.id === 'dolores').met && m.cast.find((c: any) => c.id === 'channel').met);
  assert.ok(m.lore.find((l: any) => l.id === 'tally').found);
  assert.ok(!m.cast.find((c: any) => c.id === 'rolo').met);
  // The account's record and this device's merge by union; the server's cleaner agrees with the engine's.
  const c = H.memory.core;
  const merged = c.merge({ visits: 1, lastAt: 1, met: ['pip'], lore: ['lamp'] }, { visits: 1, lastAt: 2, met: ['rolo'], lore: ['tally', 'bad id!'] });
  assert.deepEqual(merged.met.sort(), ['pip', 'rolo']);
  assert.deepEqual(merged.lore.sort(), ['lamp', 'tally']);
  assert.equal(game2 === H.game, true);
  H.memory.reset();
  assert.deepEqual(clean(), []);
});

test('a return: no intro or mirror, welcomed by name, the tour resumes where it stopped (guest.js + sandbox.js)', () => {
  assert.match(guestSrc, /const RET = 'hg_sandbox_return'/);
  assert.match(guestSrc, /localStorage\.getItem\('hg_overseer_intro'\) && ret\.get\(\)/, 'a return needs the intro flag and the record: cleared storage is a first visit');
  assert.match(guestSrc, /\(q\.get\('return'\) === 'observatory' \|\| comingBack\)/, 'the same switches as the Observatory return turn the intro and the mirror off');
  assert.match(guestSrc, /ret\.patch\(\{ name: lookName\(H\) \|\| null \}\)/, 'the mirror\'s name is kept when it is done');
  assert.match(guestSrc, /ret\.patch\(\{ tour: STEPS\[i \+ 1\] \|\| 'done' \}\)/, 'the tour step is kept as it moves');
  assert.match(guestSrc, /Welcome back, \$\{name\}/);
  assert.match(guestSrc, /want\('tour', 'return'\)/, 'a guest without an account still meets the sheet: the gate does not move');
  assert.match(guestSrc, /data-look/, 'a button to change the look');
  const sb = fs.readFileSync(path.join(ROOT, 'src', 'overseer-games', 'sandbox.js'), 'utf8');
  assert.match(sb, /HawkesGuest\.resume|GU\.resume/);
  assert.match(sb, /for \(const s of before\) played\.add\(s\)/, 'no moment is told again');
  assert.match(sb, /q\.advance\('tour'\)/);
});
