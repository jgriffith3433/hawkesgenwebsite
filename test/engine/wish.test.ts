// The daily wish (public/play/modules/wish): the table of 40, the pick by date (UTC, the same for everyone), the completion
// rules, the streak that forgives, the record kept in the Overseer's memory, and the wish played in a world: in the HUD,
// spoken once, points and a line when done, the streak across days and a quiet reset after a missed one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const C = H.wishCore;
const W = H.wish;
const P = H.progress;
const M = H.memory;
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };

const noon = (key: string) => Date.parse(`${key}T12:00:00Z`);
let t = noon('2026-10-25');
const stored: Record<string, string> = {};
const win = (globalThis as any).window;
const priorStore = win.localStorage;
win.localStorage = { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = String(v); } };
test.after(() => { win.localStorage = priorStore; });
M.now = () => t;
M.api = async () => { throw Object.assign(new Error('Sign in'), { status: 401 }); };
P.clock.now = () => t;
W.clock.now = () => t;
const flush = () => new Promise((r) => setTimeout(r, 5));
const said: string[] = [];
const events: any[] = [];

/** A new page on `key`: the world starts, the memory is read, and the world has settled. */
async function visit(key: string) {
  t = noon(key);
  M.reload(); P.reset(); W.reset();
  world(H, sceneOf({ floor, start }));
  H.tick(0.2);
  H.game.on('wish', (d: any) => { events.push(d); if (d.state === 'line') said.push(d.text); });
  await flush();
  t += 4000;
  H.tick(0.6); H.tick(0.6); H.tick(0.6);
}
const tick = (s = 0.6) => { t += s * 1000; H.tick(s > 0.05 ? 0.05 : s); };
const clear = () => { for (const k of Object.keys(stored)) delete stored[k]; M.reset(); P.reset(); W.reset(); said.length = 0; events.length = 0; };
/** The first day from `from` whose wish is of `kind` (and needs nothing the island lacks). */
function dayWith(kind: string, from = '2026-10-25') {
  for (let i = 0; i < 400; i++) { const k = C.fromNum ? C.fromNum(C.dayNum(from) + i) : new Date((C.dayNum(from) + i) * 86400000).toISOString().slice(0, 10); const w = C.wishFor(k); if (w.kind === kind && !w.needs) return k; }
  throw new Error(`no ${kind} day`);
}
const nextDay = (k: string) => new Date((C.dayNum(k) + 1) * 86400000).toISOString().slice(0, 10);

test('the table: 40 wishes, well formed, in the Overseer\'s voice, with gifts that exist and are not level unlocks', () => {
  assert.equal(C.WISHES.length, 40);
  assert.deepEqual(C.check(), []);
  const accs = H.presence.core.ACCESSORIES.map((a: any) => a.id);
  const levelIds = new Set(H.progressCore.UNLOCKS.map((u: any) => u.id));
  for (const w of C.WISHES) {
    assert.ok(w.say.length > 14 && w.say.length < 110, w.say);
    if (w.gift && w.gift[0] === 'acc') assert.ok(accs.includes(w.gift[1]), `${w.id}: no such accessory`);
    if (w.gift) assert.ok(!levelIds.has(w.gift[1]), `${w.id}: a level already gives it`);
  }
  assert.ok(C.WISHES.some((w: any) => w.gift), 'sometimes a gift');
  // the examples J gave are all there
  for (const kind of ['catch-kinds', 'race-time', 'boom-seated', 'hut-friend', 'still', 'photo-dawn']) assert.ok(C.WISHES.some((w: any) => w.kind === kind), kind);
  // a check catches a mistake
  assert.ok(C.check(C.WISHES.slice(1)).length);
  assert.ok(C.check([{ ...C.WISHES[0], say: 'Buy it now!' }, ...C.WISHES.slice(1)]).length);
});

test('the pick: by date (UTC), the same for everyone, never twice in a cycle, never the same two days running', () => {
  assert.equal(C.dayKey(Date.parse('2026-10-25T23:59:59.999Z')), '2026-10-25');
  assert.equal(C.dayKey(Date.parse('2026-10-26T00:00:00.000Z')), '2026-10-26');
  assert.equal(C.wishFor('2026-10-25').id, C.wishFor('2026-10-25').id, 'the same day, the same wish');
  assert.notEqual(C.wishFor('2026-10-25').id, C.wishFor('2026-10-26').id);
  // 40 days in a row are 40 different wishes (inside a cycle), and the whole table is used
  const start0 = C.dayNum('2026-01-01') - (C.dayNum('2026-01-01') % 40); // a cycle's first day
  for (let c = 0; c < 6; c++) {
    const ids = new Set<string>();
    for (let i = 0; i < 40; i++) ids.add(C.wishFor(new Date((start0 + c * 40 + i) * 86400000).toISOString().slice(0, 10)).id);
    assert.equal(ids.size, 40, `cycle ${c}`);
  }
  let prev = '';
  for (let i = 0; i < 800; i++) { const id = C.wishFor(new Date((start0 + i) * 86400000).toISOString().slice(0, 10)).id; assert.notEqual(id, prev, `day ${i}`); prev = id; }
  // nothing about the player goes into the pick: only the date
  assert.equal(C.wishFor.length, 1);
});

test('completion rules: each kind moves on with the events it names, and only those', () => {
  const run = (id: string, evs: any[], rec: any = C.blank()) => { const w = C.byId(id); let r = rec, done = false; for (const e of evs) { const a = C.advance(w, r, e); r = a.rec; done = a.done; } return { r, done }; };
  const trout = { type: 'catch', species: 'trout' }, bass = { type: 'catch', species: 'bass' }, carp = { type: 'catch', species: 'carp' };
  assert.equal(run('fish-three-kinds', [trout, trout, bass]).done, false, 'the same fish twice is one kind');
  assert.equal(run('fish-three-kinds', [trout, bass, carp]).done, true);
  assert.equal(run('fish-three', [trout, trout, trout]).done, true);
  assert.equal(run('boom-seated-three', [{ type: 'boom', seated: true }, { type: 'boom', seated: true }, { type: 'boom', seated: false }]).done, false, 'on foot does not count');
  assert.equal(run('boom-seated-three', [{ type: 'boom', seated: true }, { type: 'boom', seated: true }, { type: 'unseat' }, { type: 'boom', seated: true }]).done, false, 'leaving the 4x4 starts again');
  assert.equal(run('boom-seated-three', Array(3).fill({ type: 'boom', seated: true })).done, true);
  assert.equal(run('ridge-ninety', [{ type: 'race', course: 'ridge', ms: 95000 }]).done, false, 'too slow');
  assert.equal(run('ridge-ninety', [{ type: 'race', course: 'harbour', ms: 60000 }]).done, false, 'the other course');
  assert.equal(run('ridge-ninety', [{ type: 'race', course: 'ridge', ms: 89000 }]).done, true);
  assert.equal(run('still-sixty', [{ type: 'still', s: 40 }, { type: 'moved' }, { type: 'still', s: 20 }]).done, false, 'moving starts again');
  assert.equal(run('still-sixty', [{ type: 'still', s: 30 }, { type: 'still', s: 61 }]).done, true);
  assert.equal(run('drive-three-hundred', [{ type: 'meters', n: 120 }, { type: 'meters', n: 200 }]).done, true);
  assert.equal(run('photo-sphere-dawn', [{ type: 'photo', space: 1, hour: 14 }]).done, false, 'not at dawn');
  assert.equal(run('photo-sphere-dawn', [{ type: 'photo', space: 0, hour: 6 }]).done, false, 'not the whole planet');
  assert.equal(run('photo-sphere-dawn', [{ type: 'photo', space: 1, hour: 6.2 }]).done, true);
  assert.equal(run('hut-friend', [{ type: 'hut-friend' }]).done, true);
  assert.equal(run('swim-fifteen', [{ type: 'swim', s: 10 }, { type: 'swim', s: 16 }]).done, true);
  assert.equal(run('ask-one', [trout, { type: 'boom' }]).done, false, 'other events do nothing');
  assert.equal(C.progressText(C.byId('fish-three'), { n: 1 } as any), '1 / 3');
});

test('the streak counts consecutive days; a missed day resets it, quietly', () => {
  let r = C.blank();
  assert.equal(C.streakShown(r, '2026-10-25'), 0);
  r = C.complete(r, '2026-10-25'); assert.equal(r.st, 1);
  r = C.complete(r, '2026-10-26'); assert.equal(r.st, 2);
  r = C.complete(r, '2026-10-26'); assert.equal(r.st, 2, 'a day is counted once');
  r = C.complete(r, '2026-10-27'); assert.equal(r.st, 3); assert.equal(r.best, 3);
  assert.equal(C.streakShown(r, '2026-10-27'), 3, 'done today');
  assert.equal(C.streakShown(r, '2026-10-28'), 3, 'yesterday\'s still counts: today can carry it on');
  assert.equal(C.streakShown(r, '2026-10-29'), 0, 'a missed day: gone from the HUD, with nothing said');
  const after = C.complete(r, '2026-10-30'); assert.equal(after.st, 1, 'begins again at one'); assert.equal(after.best, 3, 'the best is kept');
  // across a month and a year
  assert.equal(C.complete(C.complete(C.blank(), '2026-12-31'), '2027-01-01').st, 2);
  assert.equal(C.complete(C.complete(C.blank(), '2028-02-28'), '2028-02-29').st, 2, 'leap day');
  assert.ok(C.pointsFor(C.byId('fish-one'), 5) > C.pointsFor(C.byId('fish-one'), 1));
  assert.ok(C.pointsFor(C.byId('fish-one'), 500) <= C.byId('fish-one').pts + 10, 'a long streak adds only a little');
});

test('the record: cleaned, merged (the later day wins), and the memory keeps the same shape', () => {
  assert.deepEqual(C.clean(null), { last: null, st: 0, best: 0, day: null, n: 0, set: [], said: 0 });
  assert.deepEqual(C.clean({ last: 'nope', st: 5, day: '2026-02-30x', n: -3, set: ['a', 'A b', 'a'], said: 'yes' }), { last: null, st: 0, best: 0, day: null, n: 0, set: ['a'], said: 1 });
  const a = { last: '2026-10-24', st: 2, best: 2, day: '2026-10-25', n: 1, set: ['trout'], said: 1 };
  const b = { last: '2026-10-25', st: 3, best: 3, day: '2026-10-25', n: 2, set: ['bass'], said: 0 };
  assert.deepEqual(C.merge(a, b), { last: '2026-10-25', st: 3, best: 3, day: '2026-10-25', n: 2, set: ['trout', 'bass'], said: 1 });
  assert.deepEqual(C.merge(b, { ...a, day: '2026-10-24' }).n, 2, 'an older day\'s progress is not added to today\'s');
  assert.deepEqual(M.core.clean({ wish: a }).wish, a);
  assert.deepEqual(M.core.clean({ wish: { last: 'x', st: 4, best: 2, day: 'y', n: 9.9, set: [3], said: 0 } }).wish, C.clean({ last: 'x', st: 4, best: 2, day: 'y', n: 9.9, set: [3], said: 0 }));
  assert.deepEqual(M.core.merge({ visits: 1, lastAt: 5, wish: a }, { visits: 2, lastAt: 9, wish: b }).wish, C.merge(a, b));
});

test('in a world: the wish is in the HUD, spoken once on arrival, and does not come back the same day', async () => {
  clear();
  const key = dayWith('ask');
  await visit(key);
  const w = C.wishFor(key);
  for (let i = 0; i < 8; i++) tick();
  assert.equal(W.state.wish, w.id);
  assert.ok(W.hud.includes(w.hud), `HUD: ${W.hud}`);
  assert.equal(said.filter((s) => s === w.say).length, 1, 'spoken once');
  assert.ok(events.some((e) => e.state === 'offer' && e.id === w.id));
  assert.ok(!said.some((s) => /streak|missed|lost|again/i.test(s)));
  // a reload the same day: the HUD again, the words not again
  await visit(key);
  for (let i = 0; i < 8; i++) tick();
  assert.ok(W.hud.includes(w.hud));
  assert.equal(said.filter((s) => s === w.say).length, 1, 'not said twice in a day');
});

test('doing it gives points and a short line, once; the streak goes on the next day and resets quietly after a missed one', async () => {
  clear();
  const d1 = dayWith('ask');
  await visit(d1);
  for (let i = 0; i < 8; i++) tick();
  const p0 = P.state.pts;
  H.game.emit('asked', {});
  const w = C.wishFor(d1);
  assert.equal(W.state.done, true);
  assert.equal(W.state.streak, 1);
  const done = events.find((e) => e.state === 'done');
  assert.ok(done && done.id === w.id && done.pts === w.pts);
  assert.ok(P.state.pts >= p0 + w.pts, `points ${p0} -> ${P.state.pts}`);
  for (let i = 0; i < 8; i++) tick();
  const line = said.find((s) => s === C.doneLine(d1, 1, null));
  assert.ok(line, `an Overseer line (said: ${said.join(' | ')})`);
  assert.ok(line.length < 60 && !/!/.test(line));
  assert.ok(W.hud.includes('Done'), W.hud);
  const pts1 = P.state.pts;
  H.game.emit('asked', {}); assert.equal(P.state.pts, pts1, 'a wish is done once a day');
  // the next day: a new wish, the streak is kept in the HUD until it is carried on
  const d2 = nextDay(d1);
  await visit(d2);
  for (let i = 0; i < 8; i++) tick();
  assert.equal(W.state.wish, C.wishFor(d2).id);
  assert.equal(W.state.done, false);
  assert.equal(W.state.streak, 1, 'yesterday\'s streak is still alive');
  assert.ok(/1 day in a row/.test(W.hud), W.hud);
  const w2 = W.state.wish ? C.byId(W.state.wish) : C.wishFor(d2);
  for (const e of C.eventsFor(w2)) W.feed(e);
  assert.equal(W.state.done, true, `day 2 wish ${w2.id} done`);
  assert.equal(W.state.streak, 2);
  // a missed day (d3 is skipped) and then d4: the HUD shows no streak at d4's start, and nothing is said about it
  const d4 = nextDay(nextDay(nextDay(d2)));
  said.length = 0;
  await visit(d4);
  for (let i = 0; i < 10; i++) tick();
  assert.equal(W.state.streak, 0, 'the streak is gone');
  assert.ok(!/in a row/.test(W.hud), `no streak shown: ${W.hud}`);
  assert.ok(!said.some((s) => /streak|miss|lost|reset|broke|days/i.test(s)), `nothing said about it: ${said.join(' | ')}`);
  assert.ok(!events.some((e) => /miss|lost|reset|penalty/.test(JSON.stringify(e))));
  assert.equal(W.record().best, 2, 'the best is still on record');
  // and the next completion begins again at one
  for (const e of C.eventsFor(C.byId(W.state.wish))) W.feed(e);
  assert.equal(W.state.done, true);
  assert.equal(W.state.streak, 1, 'begins again at one');
});

test('a wish the world cannot offer is swapped for a plain one: there is always one in the HUD', async () => {
  clear();
  let key = '2026-10-25';
  for (let i = 0; i < 400; i++) { key = new Date((C.dayNum('2026-10-25') + i) * 86400000).toISOString().slice(0, 10); if (C.wishFor(key).needs === 'clock') break; }
  const own = C.wishFor(key);
  assert.equal(own.needs, 'clock');
  assert.equal(C.offer(own, () => true).id, own.id, 'a world that has it gets the wish itself');
  assert.equal(C.offer(own, () => false).id, C.INSTEAD.clock);
  await visit(key); // (the test world has no running clock)
  for (let i = 0; i < 8; i++) tick();
  assert.equal(W.state.wish, C.INSTEAD.clock);
  assert.ok(W.hud.includes(C.byId(C.INSTEAD.clock).hud), W.hud);
  assert.ok(!said.includes(own.say));
});

test('the wish stays out of the intro and the mirror', async () => {
  clear();
  const key = dayWith('ask');
  t = noon(key); M.reload(); P.reset(); W.reset();
  world(H, sceneOf({ floor, start }));
  H.tick(0.2); await flush(); t += 4000;
  H.game.on('wish', (d: any) => { events.push(d); if (d.state === 'line') said.push(d.text); });
  H.game.emit('intro', { state: 'start' });
  for (let i = 0; i < 6; i++) tick();
  assert.equal(W.hud, '');
  assert.ok(!said.includes(C.wishFor(key).say));
  H.game.emit('intro', { state: 'end' });
  for (let i = 0; i < 8; i++) tick();
  assert.ok(W.hud.includes(C.wishFor(key).hud));
});
