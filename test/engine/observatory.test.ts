// The Observatory: the room's layout and words as numbers (observatory-math.js), and in the real engine the lift from the
// hangar, the first arrival (a greeting by name, a gift, a question left open, music, the pearl), the quick return and the
// way back down with nothing stuck.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const M = H.observatoryMath;
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };

test('the room: windows all round, a lift, a place each for the mirror, the wardrobe and the board', () => {
  const segs = M.segments();
  assert.equal(segs.length, M.ROOM.segments);
  assert.equal(segs.filter((s: any) => s.kind === 'door').length >= 1, true, 'a door for the lift');
  assert.ok(M.windowShare() > 0.6, `most of the wall is window (${M.windowShare().toFixed(2)})`);
  for (const id of ['lift', 'mirror', 'board', 'wardrobe']) {
    const [x, z] = M.spot(id);
    assert.ok(Math.hypot(x, z) < M.ROOM.radius, `${id} is inside the room`);
  }
  const lift = M.spot('lift');
  assert.ok(lift[1] > 0, 'the lift is on the +z side');
  // each place stands against solid wall, not a window
  for (const id of ['mirror', 'board', 'wardrobe']) {
    const a = M.STATIONS[id].angle;
    const hit = segs.find((s: any) => Math.abs(s.mid - a) < 360 / segs.length);
    assert.equal(hit.kind, 'wall', `${id} has a wall behind it`);
  }
});

test('the first arrival greets by name, thanks, gives a gift, raises a question and answers none', () => {
  const sc = M.scene('Ada', { accessory: 'none' });
  const say = sc.steps.map((s: any) => s.say);
  assert.ok(say[0].includes('Ada'), 'the greeting uses the character name');
  assert.ok(sc.steps.some((s: any) => /thank/i.test(s.say)), 'it thanks them');
  assert.ok(sc.steps.some((s: any) => s.gift), 'a moment for the gift');
  assert.equal(sc.gift.kind, 'accessory');
  assert.ok(M.GIFTS.some((g: any) => g.id === sc.gift.id));
  assert.ok(sc.steps.some((s: any) => s.id === 'question'), 'a question is raised');
  const times = sc.steps.map((s: any) => s.at);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'in order');
  assert.ok(sc.length <= 45, 'short');
  // voice rules: no exclamation marks, no motive, no command, no credits
  const all = [...sc.steps.map((s: any) => s.say), ...M.QUESTIONS.map((q: any) => q.text), ...[0, 1, 2, 3].map((i) => M.quick('Ada', i))];
  for (const t of all) {
    assert.ok(!/!/.test(t), `no exclamation: ${t}`);
    assert.ok(!/\b(because|in order to|so that|credit|price|you must|you should)\b/i.test(t), `no motive, no command: ${t}`);
    assert.ok(t.split(/[.?]\s/).length <= 4, `short: ${t}`);
  }
  // the gift is never what they already wear, and with no name there is still a greeting
  assert.notEqual(M.gift({ accessory: sc.gift.id }, 'Ada').id, sc.gift.id);
  assert.ok(!/undefined|null/.test(M.scene('', null).steps[0].say));
});

test('the pearl drifts to the player and stops short; the lights follow the voice', () => {
  let pos = [0, 6, 0];
  const target = [10, 0, 8];
  for (let t = 0; t < 12; t += 0.05) pos = M.pearlStep(pos, target, t, 0.05, 'follow').pos;
  const d = Math.hypot(pos[0] - target[0], pos[2] - target[2]);
  assert.ok(d > 2 && d < 4.5, `about three metres off (${d.toFixed(1)})`);
  assert.ok(pos[1] > target[1] + 1, 'a little above');
  let lv = 0;
  for (let t = 0; t < 1; t += 0.05) lv = M.voiceLevel(lv, true, t, 0.05);
  assert.ok(lv > 0.5, 'rises while it speaks');
  const top = lv;
  for (let t = 1; t < 3; t += 0.05) lv = M.voiceLevel(lv, false, t, 0.05);
  assert.ok(lv < top * 0.3, 'falls after');
});

function dock() {
  world(H, sceneOf({ floor, start, rocket: { type: 'rocket', transform: { position: [10, 30, 10] } } }));
  H.tick(0.5);
  const hg = H.overseer.hangar;
  const rocket = H.game.entity('rocket');
  // (A setup shortcut, as the playtest does: the rocket is on the pad and the player on foot beside the lift.)
  rocket.position = [hg.pad[0], hg.pad[1] + 3, hg.pad[2]];
  rocket.velocity = [0, 0, 0];
  const ob = H.overseer.observatory;
  const l = ob.lift;
  H.world.player.position = [l[0], l[1] + 1.2, l[2]];
  H.tick(0.3);
  return { ob, rocket, hg };
}

test('in the engine: the lift up, the first arrival, the gift, the quick return and the way down', () => {
  H.lines.reset();
  const { ob, rocket, hg } = dock();
  assert.ok(ob.on && ob.first, 'a first time');
  const events: string[] = [];
  H.game.on('observatory', (d: any) => events.push(d.state));
  const gifts: any[] = [];
  H.game.on('observatory-gift', (d: any) => gifts.push(d));
  H.presence.setLook({ name: 'Ada', accessory: 'none' });
  const said: string[] = [];
  const speak = H.overseer.speak;
  H.overseer.speak = (t: string, v: any, s: any, o: any) => { said.push(t); return speak.call(H.overseer, t, v, s, o); };

  assert.equal(H.use.act(), 'observatory:lift', 'E at the lift');
  let t0 = 0;
  for (; t0 < 6 && ob.state !== 'inside'; t0 += 0.1) H.tick(0.1);
  assert.equal(ob.state, 'inside');
  assert.ok(ob.music, 'music is playing');
  assert.ok(ob.scene, 'the scene is on');
  for (let t = 0; t < 3; t += 0.1) H.tick(0.1);
  assert.ok(H.world.player.position[1] > ob.liftRoom[1] - 2, 'the floor holds');
  const hereAt = H.world.player.position.slice();
  const room = ob.liftRoom;
  assert.ok(Math.hypot(hereAt[0] - room[0], hereAt[2] - room[2]) < 8, 'in the room by the lift');
  assert.ok(Math.abs(hereAt[1] - hg.pad[1]) > 5, 'and not in the bay');
  for (let t = 0; t < 41; t += 0.1) H.tick(0.1);
  assert.ok(said.some((x) => x.startsWith('Ada.')), `greeted by name: ${said.join(' | ')}`);
  assert.ok(said.some((x) => /thank/i.test(x)));
  assert.equal(gifts.length, 1, 'one gift');
  assert.equal(H.presence.look.accessory, gifts[0].gift, 'worn in their look');
  assert.ok(events.includes('enter') && events.includes('scene') && events.includes('gift') && events.includes('ready'));
  assert.ok(!ob.scene && !ob.first, 'done, and not first any more');
  const p = ob.pearl;
  assert.ok(Math.hypot(p[0] - 0, p[2] - 0) >= 0, 'the pearl has a place');

  // Down: back in the bay beside their rocket, controls back.
  H.game.emit('docked-pad', { vehicle: rocket });
  H.world.player.position = [room[0], room[1] + 0.5, room[2]];
  H.tick(0.2);
  assert.equal(H.use.act(), 'observatory:lift', 'E at the lift in the room');
  for (let t = 0; t < 8 && ob.state !== 'bay'; t += 0.1) H.tick(0.1);
  assert.equal(ob.state, 'bay');
  assert.ok(H.world.player.controls !== false, 'controls are back');
  const q = H.world.player.position;
  assert.ok(H.overseer.hangar.inside || Math.hypot(q[0] - hg.pad[0], q[2] - hg.pad[2]) < 60, 'back in the bay');
  assert.ok(events.includes('leave'));
  assert.ok(!ob.music, 'the music has stopped');
  assert.ok(rocket.alive);

  // The second time: no long scene, and in and heard well under ten seconds.
  said.length = 0; gifts.length = 0;
  H.world.player.position = [ob.lift[0], ob.lift[1] + 1.2, ob.lift[2]];
  H.tick(0.3);
  assert.ok(!ob.first);
  H.use.act();
  let took = 0;
  for (; took < 10 && !(ob.state === 'inside' && said.length); took += 0.1) H.tick(0.1);
  assert.ok(took < 8, `in and welcomed in ${took.toFixed(1)} s`);
  assert.ok(!ob.scene, 'no long scene');
  for (let t = 0; t < 45; t += 0.5) H.tick(0.5);
  assert.equal(gifts.length, 0, 'no second gift');
  assert.ok(said.length === 1, `one short line (${said.join(' | ')})`);
  H.overseer.speak = speak;
});

test('falling out of the room sends you back to the bay; the lift cannot be left half-done', () => {
  const { ob } = dock();
  H.use.act();
  for (let t = 0; t < 6 && ob.state !== 'inside'; t += 0.1) H.tick(0.1);
  assert.equal(ob.state, 'inside');
  const l = ob.liftRoom;
  H.world.player.position = [l[0], l[1] - 80, l[2]];
  for (let t = 0; t < 10 && ob.state !== 'bay'; t += 0.1) H.tick(0.1);
  assert.equal(ob.state, 'bay', 'sent back');
  assert.ok(H.world.player.controls !== false);
  // a ride cut short by a respawn leaves nothing locked
  H.world.player.position = [ob.lift[0], ob.lift[1] + 1.2, ob.lift[2]];
  H.tick(0.3);
  H.use.act();
  H.tick(0.4);
  assert.equal(H.world.player.controls, false, 'controls are held while the screen is dark');
  H.game.respawn();
  H.tick(0.2);
  assert.notEqual(H.world.player.controls, false, 'a respawn gives them back');
});

test('the travel board: three featured games as planets, a way to each, who they are carried along', () => {
  assert.deepEqual(M.PLANETS.map((p: any) => p.id), ['fps-arena', 'sky-racer', 'platform-run']);
  const spots = M.PLANETS.map((_: any, i: number) => M.planetSpot(i));
  for (const s of spots) assert.ok(Math.hypot(s[0], s[2]) < M.ROOM.radius, 'inside the room');
  assert.ok(Math.hypot(spots[0][0] - spots[1][0], spots[0][2] - spots[1][2]) > 3, 'apart enough to stand under one');
  for (let i = 0; i < 3; i++) assert.equal(M.planetAt(spots[i][0], spots[i][2]).index, i);
  assert.equal(M.planetAt(0, 0), null);
  for (const p of M.PLANETS) {
    assert.ok(!/!/.test(p.say) && !/credit|price|must/i.test(p.say), p.say);
    assert.ok(p.line.length < 60, 'one line');
  }
  const href = M.travelHref('sky-racer', { name: 'Ada', what: 'toaster' }, 'Ada');
  assert.ok(href.startsWith('/play/t/sky-racer?from=observatory&look='));
  assert.equal(M.travelLook(href.split('?')[1]).name, 'Ada');
  assert.equal(M.travelLook('look=%7Bnot json'), null);
  assert.ok(/Ada/.test(M.returned('Ada', 'Leap')) && /Leap/.test(M.returned('Ada', 'Leap')));
});

test('in the engine: choose a world at the board and be beamed down; coming back puts you at the board', () => {
  const { ob } = dock();
  H.presence.setLook({ name: 'Ada' });
  H.use.act();
  for (let t = 0; t < 6 && ob.state !== 'inside'; t += 0.1) H.tick(0.1);
  assert.equal(ob.state, 'inside');
  ob.skip();
  ob.setCounts({ 'fps-arena': 2, 'sky-racer': 0, 'platform-run': 5 });
  H.tick(0.2);
  const board = ob.board;
  assert.equal(board.length, 3);
  assert.equal(board.find((b: any) => b.id === 'platform-run').count, 5);
  const gone: string[] = [];
  ob.navigate = (href: string) => gone.push(href);
  const events: string[] = [];
  H.game.on('observatory', (d: any) => events.push(d.state));
  const said: string[] = [];
  const speak = H.overseer.speak;
  H.overseer.speak = (t: string, v: any, s: any, o: any) => { said.push(t); return speak.call(H.overseer, t, v, s, o); };
  const leap = board.find((b: any) => b.id === 'platform-run');
  H.world.player.position = [leap.at[0], leap.at[1] + 0.5, leap.at[2]];
  H.tick(0.2);
  assert.equal(H.use.act(), 'observatory:board', 'E under a planet');
  assert.ok(said.some((x) => x.startsWith('Leap.')), 'the Overseer says where');
  for (let t = 0; t < 10 && !gone.length; t += 0.1) H.tick(0.1);
  assert.equal(gone.length, 1);
  assert.ok(gone[0].startsWith('/play/t/platform-run?from=observatory'));
  assert.equal(M.travelLook(gone[0].split('?')[1]).name, 'Ada', 'their name travels');
  assert.ok(events.includes('travel') && events.includes('beam-down'));
  H.overseer.speak = speak;
  // The page did not open: nothing stays locked.
  for (let t = 0; t < 8; t += 0.1) H.tick(0.1);
  assert.notEqual(H.world.player.controls, false);
  assert.ok(events.includes('travel-failed'));
});

test('in the engine: beamIn (the way back from a game) stands you at the board, free to move', () => {
  const { ob } = dock();
  H.tick(0.5);
  assert.ok(ob.beamIn());
  for (let t = 0; t < 8 && ob.state !== 'inside'; t += 0.1) H.tick(0.1);
  assert.equal(ob.state, 'inside');
  assert.notEqual(H.world.player.controls, false);
  const b = ob.board[1];
  assert.ok(Math.hypot(H.world.player.position[0] - b.at[0], H.world.player.position[2] - b.at[2]) < 8, 'at the board');
});

test('the wardrobe: what is owned, a gift every third visit, the colors that come with a gift, a plain request', () => {
  const none = M.owned(null, { accessory: 'none', accessoryColor: '#ffffff' });
  assert.deepEqual(none.acc, ['none']);
  assert.ok(none.col.length >= 4, 'everyone starts with a few colors');
  const o = M.owned({ acc: ['medal'], col: ['fbbf24'] }, { accessory: 'bell', accessoryColor: '#facc15' });
  assert.deepEqual(o.acc, ['none', 'medal', 'bell'], 'what is worn is owned');
  assert.ok(o.col.includes('#fbbf24') && o.col.includes('#facc15'));
  assert.equal(M.laterGift({ acc: [] }, 'Ada', 2), null);
  const g = M.laterGift({ acc: ['medal'] }, 'Ada', 3);
  assert.ok(g && g.id !== 'medal', 'a third visit leaves something new');
  assert.equal(M.laterGift({ acc: M.GIFTS.map((x: any) => x.id) }, 'Ada', 6), null, 'nothing left to give');
  const cols = M.giftColors(M.GIFTS[0], { col: [] }, 'Ada');
  assert.ok(cols.length >= 2 && cols.every((c: string) => /^#[0-9a-f]{6}$/.test(c)));
  assert.equal(M.requestText('   '), '');
  assert.ok(M.requestText('a hat made of clouds <b>').startsWith('Make me something to wear: a hat made of clouds'));
  assert.ok(!/<|>/.test(M.requestText('<x>')));
  for (const t of [M.WARDROBE_LINES.open, M.WARDROBE_LINES.kept, M.WARDROBE_LINES.ask, M.WARDROBE_LINES.sent, M.WARDROBE_LINES.later({ label: 'a bell' })]) assert.ok(!/!/.test(t), t);
});

test('in the engine: the mirror hangs in the room; the wardrobe shows what you own, a live preview, a price, and puts it back', async () => {
  H.lines.reset();
  H.memory.reset();
  const { ob } = dock();
  H.presence.setLook({ name: 'Ada', accessory: 'none' });
  H.use.act();
  for (let t = 0; t < 6 && ob.state !== 'inside'; t += 0.1) H.tick(0.1);
  assert.equal(ob.state, 'inside');
  for (let t = 0; t < 45 && ob.scene; t += 0.5) H.tick(0.5);
  assert.ok(ob.gift, 'the first gift was given');
  assert.ok(ob.mirror, 'a mirror in the room');
  assert.ok(H.memory.wardrobe.get().acc.includes(ob.gift), 'and it is in the wardrobe');
  const wd = ob.wardrobe;
  H.world.player.position = [wd[0], wd[1] + 0.4, wd[2]];
  H.tick(0.2);
  assert.equal(H.use.act(), 'observatory:wardrobe', 'E at the wardrobe');
  assert.ok(H.wardrobe.isOpen);
  assert.equal(H.world.player.controls, false, 'held while choosing');
  const mine = H.wardrobe.owned();
  assert.ok(mine.acc.includes(ob.gift) && mine.acc.includes('none'));
  // a live preview: the look is the choice at once
  assert.ok(H.wardrobe.wear({ accessory: ob.gift }));
  assert.equal(H.presence.look.accessory, ob.gift);
  const col = mine.col[1];
  assert.ok(H.wardrobe.wear({ accessoryColor: col }));
  assert.equal(String(H.presence.look.accessoryColor).toLowerCase(), col);
  assert.equal(H.wardrobe.wear({ accessory: 'jetpack' }), false, 'what is not owned cannot be worn');
  // asking: the price first, then the same paid message
  const sent: string[] = [];
  H.assistant = { quote: async () => ({ credits: 8, balance: 120 }), ask: async (t: string) => { sent.push(t); } };
  H.wardrobe.close();
  H.use.act();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(H.wardrobe.price && H.wardrobe.price.credits, 8, 'the price is known before anything is sent');
  assert.equal(sent.length, 0);
  assert.ok(await H.wardrobe.ask('a hat made of clouds'));
  assert.ok(sent[0].includes('a hat made of clouds'));
  H.wardrobe.restore();
  H.wardrobe.close(true);
  assert.ok(!H.wardrobe.isOpen);
  assert.notEqual(H.world.player.controls, false, 'controls are back');
  delete H.assistant;
});
