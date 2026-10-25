// The Overseer's memory (public/play/modules/overseer/memory.js): what it keeps, how a greeting is chosen from what is
// true, that a return never repeats the greeting before, and that it is stored in the account when signed in and on the
// device otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const M = H.memory;
const L = H.lines;
const C = M.core;
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };
const MIN = 60e3, HOUR = 3600e3, DAY = 24 * HOUR;

let t = 0; // the wall clock, ms
let seconds = 100; // the lines' clock, s
const stored: Record<string, string> = {};
let account: any = null; // what the account holds (null: signed out)
let signedIn = false;
const posts: any[] = [];
const win = (globalThis as any).window;
const priorStore = win.localStorage;
win.localStorage = { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = String(v); } };
test.after(() => { win.localStorage = priorStore; });

M.now = () => t;
M.api = async (route: string, body?: any) => {
  if (!signedIn) throw Object.assign(new Error('Sign in'), { status: 401 });
  if (body) { posts.push(body.overseer); account = body.overseer; return { overseer: account }; }
  return { overseer: account };
};
L.clock = () => seconds;
L.now = () => t;
const said: { id: string; text: string }[] = [];
const flush = () => new Promise((r) => setTimeout(r, 5));
let rolls = 0;
M.rand = () => ((rolls++ * 0.37) % 1);

/** A new page: the world starts, the Overseer's memory is read and the visit counted. */
async function visit(at: number, o: { look?: any } = {}): Promise<any> {
  const before = said.length;
  t = at;
  seconds += 1000;
  L.rand = () => 0;
  M.reload();
  world(H, sceneOf({ floor, start }));
  H.presence.look = o.look ?? H.presence.look;
  H.tick(0.2);
  H.game.on('overseer-line', (d: any) => said.push({ id: d.id, text: d.text }));
  await flush();
  seconds += L.SETTLE + 1; t += (L.SETTLE + 1) * 1000;
  H.tick(0.05); H.tick(0.05);
  return said.slice(before).find((x) => x.id === 'return');
}
const step = (s = 0.3) => { seconds += s; t += s * 1000; H.tick(0.05); };
const clear = () => { for (const k of Object.keys(stored)) delete stored[k]; account = null; signedIn = false; posts.length = 0; said.length = 0; L.reset(); M.reset(); H.presence.look = { ...H.presence.look, name: null, what: 'person' }; };
const lookOf = (name: string, what: string) => ({ ...H.presence.look, name, what });

test('there are at least twenty greetings, in the Overseer\'s voice', () => {
  assert.ok(C.VARIANTS.length >= 20, `${C.VARIANTS.length}`);
  const ids = new Set(C.VARIANTS.map((v: any) => v.id));
  assert.equal(ids.size, C.VARIANTS.length, 'ids are unique');
  // Every variant, said against a rich context: calm, short, and about the game only.
  const ctx = { visit: 5, seenBefore: true, deed: 'fish', gapMs: 3 * DAY, since: '3 days', name: 'Sir Laces', what: 'a shoe', ord: 'fifth', neverDocked: true, alwaysDrives: true, breaksThings: true };
  const bad = /[!]|\b(watch|watching|saw you|camera|screen|browser|device|computer|email|account|credits?|price|login|logged|loading|error|player|user|human|session|click|keyboard|mouse|office|work)\b|[\u{1F300}-\u{1FAFF}]/iu;
  for (const v of C.VARIANTS) {
    const variants = [ctx, { ...ctx, gapMs: 10 * MIN }, { ...ctx, gapMs: 30 * DAY, since: '4 weeks' }, { ...ctx, name: null, deed: v.id.split('-')[0] }, { ...ctx, deed: v.id.split('-')[0] }, { visit: 1, seenBefore: false, name: null, what: null, deed: null }];
    let any = false;
    for (const c of variants) {
      if (!v.need(c)) continue;
      any = true;
      const text = v.say(c);
      assert.ok(text.length > 12 && text.length < 110, `${v.id}: ${text}`);
      assert.ok(!bad.test(text), `${v.id}: ${text}`);
      assert.ok(!/undefined|null|\{n\}|NaN/.test(text), `${v.id}: ${text}`);
    }
    assert.ok(any, `${v.id} can be picked`);
  }
});

test('a record is cleaned: only in-game facts, bounded, and a bad one is a blank one', () => {
  const r = C.clean({ visits: 3.9, name: ' <b>Sam</b>\n', what: 'toaster', last: { id: 'fish', at: 5, visit: 3 }, n: { fish: 2, spy: 5 }, extra: 'x', greet: { recent: ['a-b', 'No Way'] } });
  assert.equal(r.visits, 3); assert.equal(r.name, 'b Sam /b'); assert.equal(r.n.fish, 2); assert.equal(r.n.spy, undefined); assert.equal(r.extra, undefined);
  assert.deepEqual(r.greet.recent, ['a-b']);
  assert.equal(C.clean({ last: { id: 'spy' } }).last, null);
  assert.deepEqual(C.clean('junk'), C.blank());
  assert.equal(C.clean({ visits: -4 }).visits, 0);
});

test('facts hold only what the record holds: the last thing counts only if it was last visit', () => {
  const rec = (o: any) => C.clean({ visits: 2, lastAt: 1000, name: 'Ada', what: 'toaster', last: { id: 'boom', at: 900, visit: 2 }, ...o });
  const f = C.facts(rec({}), 1000 + 2 * DAY);
  assert.equal(f.deed, 'boom'); assert.equal(f.name, 'Ada'); assert.equal(f.what, 'a toaster'); assert.equal(f.visit, 3); assert.equal(f.since, '2 days');
  assert.equal(C.facts(rec({ last: { id: 'boom', at: 900, visit: 1 } }), 5000).deed, null, 'an older visit is not "last time"');
  assert.equal(C.facts(rec({ what: 'person' }), 5000).what, null, 'a person has no joke');
  assert.equal(C.facts(rec({ visits: 1 }), 5000).neverDocked, false, 'only from the third visit');
  assert.equal(C.facts(rec({ visits: 3, last: null }), 5000).neverDocked, true);
  assert.equal(C.facts(rec({ visits: 3, n: { dock: 1 } }), 5000).neverDocked, false);
  assert.equal(C.facts(rec({ driveS: 600, playS: 700 }), 5000).alwaysDrives, true);
  assert.equal(C.facts(rec({ driveS: 100, playS: 100 }), 5000).alwaysDrives, false, 'too little to say');
  assert.equal(C.facts(rec({ driveS: 600, playS: 3000 }), 5000).alwaysDrives, false, 'not always');
  assert.equal(C.facts(rec({ n: { boom: 12 } }), 5000).breaksThings, true);
  assert.equal(C.facts(rec({ n: { boom: 3 } }), 5000).breaksThings, false);
});

test('nothing on record: a plain warm greeting that claims nothing', () => {
  for (const c of [C.facts(null, 5000), C.facts(C.blank(), 5000)]) {
    for (let i = 0; i < 20; i++) {
      const g = C.pick(c, null, () => i / 20);
      assert.ok(/^new-/.test(g.id), g.id);
      assert.ok(!/last time|came as|again|back|your \w+ visit|\d|days/i.test(g.text), g.text);
    }
  }
  // Came back with nothing done and no name: warm, and again nothing invented.
  const bare = C.facts(C.clean({ visits: 1, lastAt: 1000 }), 1000 + 3 * HOUR);
  assert.equal(bare.deed, null); assert.equal(bare.name, null);
  for (let i = 0; i < 30; i++) { const g = C.pick(bare, null, () => i / 30); assert.ok(!/last time|came as|great many|drive|hangar has not/i.test(g.text), g.text); }
});

test('a second visit greets by name and names a true thing from last time', () => {
  const deeds = { fish: /fish/, boom: /(went up|broke)/, build: /made/, dock: /(hangar|docked)/, high: /(high|flew|up)/, space: /(above the air|quiet)/, drive: /(driving|wheel)/, ask: /ask/, fall: /(fell|down)/ };
  for (const [deed, re] of Object.entries(deeds)) {
    for (let i = 0; i < 12; i++) {
      const f = C.facts(C.clean({ visits: 1, lastAt: 1000, name: 'Ada', last: { id: deed, at: 900, visit: 1 } }), 1000 + 2 * DAY);
      const g = C.pick(f, null, () => i / 12);
      assert.ok(g.text.includes('Ada'), g.text);
      assert.ok((re as RegExp).test(g.text), `${deed}: ${g.text}`);
    }
  }
  // Without a name it still says the deed, and does not invent a name.
  const f = C.facts(C.clean({ visits: 1, lastAt: 1000, last: { id: 'fish', at: 900, visit: 1 } }), 1000 + 2 * DAY);
  const g = C.pick(f, null, () => 0.5);
  assert.ok(/fish/.test(g.text) && !/undefined|null/.test(g.text), g.text);
});

test('never the same greeting twice in a row, whatever the dice say', () => {
  const f = C.facts(C.clean({ visits: 4, lastAt: 1000, name: 'Ada', what: 'cactus', last: { id: 'fish', at: 900, visit: 4 }, n: { boom: 20 } }), 1000 + 3 * DAY);
  for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
    let greet = { last: null as string | null, recent: [] as string[] };
    let before = '';
    for (let i = 0; i < 40; i++) {
      const g = C.pick(f, greet, () => roll);
      assert.notEqual(g.id, before);
      before = g.id;
      greet = { last: g.id, recent: [...greet.recent, g.id].slice(-8) };
    }
  }
  // Even with a single candidate left it picks it (a repeat beats silence only if there is nothing else).
  const lone = C.pick(C.facts(null, 1), { last: 'new-a', recent: ['new-a'] }, () => 0);
  assert.notEqual(lone.id, 'new-a');
});

test('the deeds are noted as they happen, and only after the world has settled', async () => {
  clear();
  await visit(1000 * DAY, { look: lookOf('Ada', 'toaster') });
  assert.equal(M.get().visits, 1);
  assert.equal(said.filter((x) => x.id === 'return').length, 0, 'the first visit is greeted by the beginning, not by memory');
  H.game.emit('catch', { mine: true });
  H.game.emit('catch', { mine: false });
  H.game.emit('wrecked', {});
  step();
  const m = M.get();
  assert.equal(m.n.fish, 1, 'only my catch'); assert.equal(m.n.boom, 1);
  assert.equal(m.last.id, 'boom'); assert.equal(m.last.visit, 1);
  assert.equal(m.name, 'Ada'); assert.equal(m.what, 'toaster');
  // Driving: getting in is the deed, time at the wheel adds up.
  H.game.player._vehRider = {};
  t += 600; H.tick(0.05); t += 600; H.tick(0.05);
  assert.equal(M.get().last.id, 'drive');
  assert.ok(M.get().driveS > 0);
  H.game.player._vehRider = null;
});

test('visit 2, 3, 4: each greeted by name with something true, three different greetings', async () => {
  clear();
  await visit(1000 * DAY, { look: lookOf('Ada', 'toaster') });
  H.game.emit('catch', { mine: true }); step();
  assert.equal(said.filter((x) => x.id === 'return').length, 0);
  const greetings: string[] = [];
  let at = 1000 * DAY + 5 * MIN;
  const deeds = [() => H.game.emit('catch', { mine: true }), () => H.game.emit('wrecked', {}), () => H.game.emit('spawned', {})];
  for (let i = 0; i < 3; i++) {
    const g = await visit(at);
    assert.ok(g && g.id === 'return', `visit ${i + 2} is greeted`);
    greetings.push(g.text);
    if (i === 0) assert.ok(g.text.includes('Ada'), g.text);
    deeds[i](); step();
    at += (i + 1) * DAY;
  }
  assert.equal(new Set(greetings).size, 3, greetings.join(' | '));
  assert.ok(/fish/.test(greetings[0]), greetings[0]);
  for (const g of greetings.slice(1)) assert.ok(!/undefined|null/.test(g), g);
  assert.equal(M.get().visits, 4);
});

test('a page back within seconds is the same visit: no greeting', async () => {
  clear();
  await visit(2000 * DAY);
  H.game.emit('catch', { mine: true }); step();
  const g = await visit(2000 * DAY + 10e3);
  assert.equal(g, undefined);
  assert.equal(M.get().visits, 1);
  const g2 = await visit(2000 * DAY + 10 * MIN);
  assert.equal(g2.id, 'return');
  assert.equal(M.get().visits, 2);
});

test('no history: a generic warm greeting, no invented facts, on a return with nothing done', async () => {
  clear();
  await visit(3000 * DAY);
  const g = await visit(3000 * DAY + 2 * HOUR);
  assert.equal(g.id, 'return');
  assert.ok(!/last time|came as|\d/.test(g.text), g.text);
  assert.ok(!/undefined|null/.test(g.text));
});

test('stored on the device when signed out, in the account when signed in; signing in keeps the newer', async () => {
  clear();
  await visit(4000 * DAY, { look: lookOf('Ada', 'cactus') });
  H.game.emit('catch', { mine: true }); step();
  const local = JSON.parse(stored.hg_overseer_memory);
  assert.equal(local.visits, 1); assert.equal(local.name, 'Ada'); assert.equal(local.n.fish, 1);
  assert.equal(posts.length, 0, 'nothing sent anywhere without an account');
  // Signs in: the account has nothing, so this device's record is kept there too.
  signedIn = true;
  await M.sync();
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(posts.length > 0, true);
  assert.equal(account.name, 'Ada'); assert.equal(account.n.fish, 1);
  // Another device with an older record: the account's newer one wins, and is what the greeting is made from.
  M.reset(); delete stored.hg_overseer_memory;
  account = { ...account, visits: 1, lastAt: 4000 * DAY + 2 * HOUR, last: { id: 'dock', at: 1, visit: 1 }, name: 'Ada' };
  const g = await visit(4000 * DAY + 2 * HOUR + 5 * MIN);
  assert.ok(g && /(hangar|docked)/.test(g.text), g && g.text);
  assert.equal(M.get().visits, 2);
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(account.visits, 2, 'saved back to the account');
  assert.equal(JSON.parse(stored.hg_overseer_memory).visits, 2, 'and kept on the device');
});

test('merge: the record seen most recently wins whole; an empty one never wins', () => {
  const a = C.clean({ visits: 2, lastAt: 100, name: 'A' });
  const b = C.clean({ visits: 5, lastAt: 200, name: 'B' });
  assert.equal(C.merge(a, b).name, 'B'); assert.equal(C.merge(b, a).name, 'B');
  assert.equal(C.merge(C.blank(), a).name, 'A'); assert.equal(C.merge(a, null).name, 'A');
});

test('the sandboxed stage keeps it through the page that holds it (the bundle and a message to the editor)', async () => {
  clear();
  await visit(5000 * DAY, { look: lookOf('Ada', 'duck') });
  H.game.emit('catch', { mine: true }); step();
  assert.equal(H.bundle.overseerMemory.name, 'Ada');
  // A fresh sandboxed load has no storage of its own: the bundle brings it back.
  for (const k of Object.keys(stored)) delete stored[k];
  const r = M.reload();
  assert.equal(r.visits, 1);
});
