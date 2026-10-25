// Progress (public/play/modules/progress): the earning table, the level curve, the unlock data (one line each), the
// record kept in the Overseer's memory, and the whole thing played in a world: points, a level-up with its moment,
// the wardrobe and the tool belt, kept after a reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const C = H.progressCore;
const P = H.progress;
const M = H.memory;
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };

let t = 1e12;
const stored: Record<string, string> = {};
const win = (globalThis as any).window;
const priorStore = win.localStorage;
win.localStorage = { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = String(v); } };
test.after(() => { win.localStorage = priorStore; });
M.now = () => t;
M.api = async () => { throw Object.assign(new Error('Sign in'), { status: 401 }); };
P.clock.now = () => t;
const flush = () => new Promise((r) => setTimeout(r, 5));
const said: string[] = [];

/** A new page: the world starts, the memory is read, the visit counted, and the world has settled. */
async function visit() {
  t += 3600e3;
  M.reload(); P.reset();
  world(H, sceneOf({ floor, start }));
  H.tick(0.2);
  H.game.on('overseer-line', (d: any) => said.push(d.text));
  await flush();
  t += 4000;
  H.tick(0.6); H.tick(0.6); H.tick(0.6);
}
const tick = (s = 0.6) => { t += s * 1000; H.tick(s > 0.05 ? 0.05 : s); };
const clear = () => { for (const k of Object.keys(stored)) delete stored[k]; M.reset(); P.reset(); said.length = 0; };

test('the earning table: every line is well formed and a first is worth more than a repeat', () => {
  for (const [id, e] of Object.entries<any>(C.EARN)) {
    assert.ok(e.label && e.pts > 0, id);
    assert.ok(!(e.once && e.per), `${id}: once and per together`);
  }
  for (const [kind, first] of Object.entries<any>(C.FIRST_OF)) {
    assert.ok(C.EARN[first]?.once, `${kind}: ${first} is a first-time line`);
    if (C.EARN[kind]) assert.ok(C.EARN[first].pts > C.EARN[kind].pts, `${kind}: a first is worth more`);
  }
  for (const need of ['fish', 'boom', 'distance', 'quest', 'lore', 'met', 'help', 'first-drive']) assert.ok(C.EARN[need], need);
});

test('the level curve: starts at 1, rises with every point, reaches the cap, the bar is honest', () => {
  assert.equal(C.levelAt(0), 1);
  assert.equal(C.levelAt(C.need(2) - 1), 1);
  assert.equal(C.levelAt(C.need(2)), 2);
  for (let l = 2; l <= C.MAX_LEVEL; l++) assert.ok(C.need(l) - C.need(l - 1) > C.need(l - 1) - C.need(l - 2) || l === 2, `level ${l} asks more`);
  assert.equal(C.levelAt(1e9), C.MAX_LEVEL);
  const b = C.bar(C.need(3) + 10);
  assert.equal(b.level, 3); assert.equal(b.into, 10); assert.ok(b.frac > 0 && b.frac < 1);
  assert.equal(C.bar(1e9).frac, 1);
});

test('the unlock data: one line each, well formed, real ids, in the Overseer\'s voice', () => {
  const accs = H.presence.core.ACCESSORIES.map((a: any) => a.id);
  assert.deepEqual(C.check(C.UNLOCKS, { acc: accs }), []);
  for (const u of C.UNLOCKS) {
    if (u.kind === 'tool') assert.ok(H.tools.get(u.id), `${u.key} is a tool`);
    const line = C.momentLine(u);
    assert.ok(line.length > 12 && line.length < 110, line);
  }
  // Nothing is for sale: no price, no money word in any line.
  assert.ok(C.UNLOCKS.every((u: any) => !/credits?|buy|\$|price/i.test(C.momentLine(u))));
});

test('adding an unlock is one line of data', () => {
  // The shape of a new line: [level, kind, id, label] and nothing else. Here one is added to a copy and read back.
  const one = { level: 3, kind: 'acc', id: 'bell', label: 'a bell', line: null, key: 'acc:bell' };
  const list = [...C.UNLOCKS, one];
  assert.deepEqual(C.check(list, { acc: H.presence.core.ACCESSORIES.map((a: any) => a.id) }), []);
  assert.ok(C.unlockedBy(3, list).some((u: any) => u.key === 'acc:bell'));
  assert.ok(!C.unlockedBy(2, list).some((u: any) => u.key === 'acc:bell'));
  assert.equal(C.momentLine(one), 'A new one, from me: a bell.');
  // ...and a mistake in a line is caught.
  assert.ok(C.check([{ ...one, kind: 'hat' }]).length);
  assert.ok(C.check([{ ...one, level: 99 }]).length);
  assert.ok(C.check([{ ...one, kind: 'col', id: 'nothex' }]).length);
  assert.ok(C.check([one, one]).length);
  assert.ok(C.check([{ ...one, line: 'Buy it for 5 credits!' }]).length);
});

test('the record: cleaned, merged to the further one, never invented', () => {
  assert.deepEqual(C.clean(null), { p: 0, f: [], d: 0, s: 1 });
  assert.deepEqual(C.clean({ p: 50.7, f: ['first-fish', 'first-fish', 'nonsense'], d: -4, s: 99 }), { p: 50, f: ['first-fish'], d: 0, s: 20 });
  assert.deepEqual(C.merge({ p: 10, f: ['first-fish'], d: 900, s: 1 }, { p: 30, f: ['first-drive'], d: 100, s: 2 }), { p: 30, f: ['first-fish', 'first-drive'], d: 900, s: 2 });
  // The memory keeps the same shape.
  assert.deepEqual(M.core.clean({ prog: { p: 7, f: ['first-boom', 'x'], d: 3, s: 2 } }).prog, { p: 7, f: ['first-boom'], d: 3, s: 2 });
});

test('doing things earns points; the first of each is worth more; a chain of booms is one', async () => {
  clear(); await visit();
  assert.equal(P.state.pts, 0);
  assert.equal(P.did('fish'), 25, 'the first fish: the fish and the first-time points');
  assert.equal(P.did('fish'), 5, 'a second fish: the repeat only');
  assert.equal(P.state.pts, 30, 'points add up');
  H.game.emit('wrecked', {});
  const afterBoom = P.state.pts;
  H.game.emit('wrecked', {}); H.game.emit('explosion', {});
  assert.equal(P.state.pts, afterBoom, 'a chain inside four seconds counts once');
  assert.ok(P.state.firsts.includes('first-boom'));
  // Distance: points per 250 m, carried over between samples.
  const d0 = P.state.pts;
  P.earn('distance', 200); assert.equal(P.state.pts, d0);
  P.earn('distance', 60); assert.equal(P.state.pts, d0 + 3);
});

test('nothing counts before the world has settled, or in the intro', async () => {
  clear();
  t += 3600e3; M.reload(); P.reset();
  world(H, sceneOf({ floor, start }));
  H.tick(0.2); await flush();
  assert.equal(P.earn('quest'), 0, 'not yet: the world is loading');
  t += 4000; H.tick(0.6); H.tick(0.6);
  H.game.emit('intro', { state: 'start' });
  H.game.emit('intro', { state: 'end' });
  assert.equal(P.earn('quest'), 30);
});

test('a level gives what the table says, the Overseer says so, the wardrobe and the belt have it, and a reload keeps it', async () => {
  clear(); await visit();
  const events: any[] = [];
  H.game.on('progress', (d: any) => events.push(d));
  assert.equal(M.wardrobe.get().acc.includes('goggles'), false);
  P.earn('quest'); // 30
  P.earn('quest'); // 60: level 2 (40)
  assert.equal(P.state.level, 2);
  const lv = events.find((e) => e.state === 'level');
  assert.ok(lv && lv.level === 2 && lv.unlocks.includes('acc:goggles'));
  assert.ok(events.some((e) => e.state === 'unlock' && e.key === 'col:84cc16'));
  assert.equal(P.waiting, 0, 'the Overseer was free: the moment was said at once');
  for (let i = 0; i < 4; i++) tick();
  const moment = events.find((e) => e.state === 'moment');
  assert.ok(moment && /goggles/.test(moment.text), moment && moment.text);
  assert.ok(!/[!]/.test(moment.text));
  // The wardrobe owns them.
  assert.ok(M.wardrobe.get().acc.includes('goggles'));
  assert.ok(M.wardrobe.get().col.includes('84cc16'));
  assert.ok(H.observatoryMath.owned(M.wardrobe.get(), {}).acc.includes('goggles'));
  // Up to level 4: the grenade is on the tool belt.
  for (let i = 0; i < 6; i++) P.earn('quest'); // 240
  assert.ok(P.state.level >= 4);
  for (let i = 0; i < 6; i++) tick();
  assert.ok(P.has('tool:grenade'));
  assert.ok(H.mayhem.belt.includes('grenade'), `belt: ${H.mayhem.belt}`);
  const pts = P.state.pts;
  // A reload: a new page reads the record back.
  await visit();
  for (let i = 0; i < 6; i++) tick();
  assert.equal(P.state.pts, pts);
  assert.ok(P.has('acc:goggles'));
  assert.ok(M.wardrobe.get().acc.includes('goggles'));
  assert.ok(H.mayhem.belt.includes('grenade'), `belt after reload: ${H.mayhem.belt}`);
  assert.equal(P.waiting, 0, 'no second moment for a level already celebrated');
});

test('the HUD moves in the frame of an award (a count-up, a flash) and the level-up line is not held back', async () => {
  clear(); await visit();
  const moments: any[] = [];
  H.game.on('progress', (d: any) => { if (d.state === 'moment') moments.push(d); });
  const flashes0 = P.hud.flashes;
  assert.equal(P.earn('quest'), 30);
  // No tick, no timer: the same call that earned the points has already moved the HUD.
  const first = P.hud;
  assert.ok(first.shown > 0 && first.shown < 30, `the HUD counts from the first frame: ${first.shown}`);
  assert.equal(first.flashes, flashes0 + 1, 'the bar flashes');
  tick(0.05);
  assert.ok(P.hud.shown > first.shown, 'the count goes on over the next frames');
  for (let i = 0; i < 12; i++) tick(0.1);
  assert.equal(P.hud.shown, 30, 'it lands on the real number');
  // A level-up while the Overseer is free: the line is said in the same call.
  P.earn('quest');
  assert.equal(P.state.level, 2);
  assert.equal(P.waiting, 0, 'said at once, not queued');
  assert.equal(moments.length, 1, 'the Overseer\'s line came with the level');
  assert.ok(H.speech.busy, 'and it is being spoken');
});

test('a level-up waits only behind a line being spoken, then follows it at the next frame', async () => {
  clear(); await visit();
  H.speech.reset(); H.speech.clock = () => t / 1000;
  H.speech.say({ text: 'The Overseer is in the middle of a long thought.', priority: 'normal', seconds: 2 });
  assert.ok(H.speech.busy, 'a line is being spoken');
  P.earn('quest'); P.earn('quest');
  assert.equal(P.state.level, 2);
  assert.equal(P.waiting, 1, 'another line is speaking: the moment waits');
  let frames = 0;
  while (P.waiting && frames++ < 200) tick(0.05);
  assert.ok(frames < 200, 'the line ended and the moment followed');
  assert.ok(frames > 1, 'but not before it ended');
  assert.equal(P.waiting, 0, 'it followed the line within the frame it ended');
});
