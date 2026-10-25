// The first minutes of a guest on /play/sandbox, in order (docs/story.md; public/play/guest.js, src/overseer-games/sandbox.js,
// modules/overseer/lines.js): the Overseer's intro, then the mirror, then the account sheet (it can't be put away, and the
// world behind it takes no input), then Pip's tour. A returning visitor skips the intro and the mirror. Nothing asks Gen for
// anything before the account. The Overseer's first-time lines come once per device and never over the intro, the mirror or
// a tour moment. The real engine and the real guest.js run; fetch and the clock are fakes (fast: no real waiting).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { load } from './harness.ts';
import { templateBundle } from '../../src/templates.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = await load();
const g = globalThis as any;
const win = g.window;
const bundle = templateBundle('sandbox')!;
const errors: string[] = [];
H.report = (e: any, where?: string) => { errors.push(String(where || '') + ': ' + String((e && e.message) || e)); };

// ------------------------------------------------------------------ fakes: storage, the network, analytics
const stored: Record<string, string> = {};
win.localStorage = { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = String(v); }, removeItem: (k: string) => { delete stored[k]; } };
const fetched: string[] = [];
g.fetch = async (url: string, init: any = {}) => {
  fetched.push(`${init.method || 'GET'} ${url}`);
  const json = (body: any, ok = true, status = 200) => ({ ok, status, json: async () => body });
  if (url === '/v1/play-template/sandbox') return json({ title: 'Sandbox', assets: {}, files: { 'scene.json': g.__scene, 'scripts/main.js': bundle.files['scripts/main.js'] } });
  if (url === '/v1/users/me') return json({ error: 'Sign in' }, false, 401);
  return json({});
};
const events: { name: string; props: any }[] = [];
win.hawkesAnalytics = { track: (name: string, props: any) => events.push({ name, props }), setContext() {} };
win.HawkesModules = { load: async () => {} };
let startup: { name: string; props: any }[] = [];
const names = () => events.map((e) => e.name);

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'public', 'play', 'guest.js'), 'utf8'), { filename: 'guest.js' });
const Guest = win.HawkesGuest;
const realRun = H.run.bind(H);
let ran: any = null;
H.run = (b: any, o: any) => { ran = JSON.parse(b.files['scene.json']); return realRun(b, { ...o, loop: false }); };

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const sheetOpen = () => Boolean(g.document.body.dataset.gsSheet);

/** A new page of /play/sandbox: fresh island and guest state, then the page's own boot. */
async function visit(o: { intro?: boolean } = {}) {
  if (!o.intro) delete stored.hg_overseer_intro; // (the intro writes its own flag; a first visit has none)
  for (const k of Object.keys(win)) if (k.startsWith('__island')) delete win[k];
  delete g.document.body.dataset.gsSheet;
  Object.assign(Guest, { accountFirst: true, resume: null, resumed: null, skipped: null });
  g.__scene = bundle.files['scene.json'];
  fetched.length = 0; events.length = 0; errors.length = 0; ran = null;
  H.lines.reset(); H.lines.clock = () => 100; // (the lines' clock is moved by hand below)
  await Guest.boot();
  H.tick(0.2);
  startup = events.splice(0); // (what the page itself did while it started is not the player's order)
  return H.game;
}

test.beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }));
test.afterEach(() => mock.timers.reset());

const advance = async (ms: number) => { mock.timers.tick(ms); await settle(); };

test('a first visit: intro, then the mirror, then the account sheet, and only then the tour', async () => {
  // (In Node there is no screen, so the intro never plays on its own: say it is wanted, so the mirror waits for its end.)
  const wanted = H.overseer.introWanted;
  H.overseer.introWanted = () => true;
  try { await firstVisit(); } finally { H.overseer.introWanted = wanted; }
});

async function firstVisit() {
  const game = await visit();
  // The world starts with the Overseer's intro and the mirror both on (a return turns them off, below).
  assert.notEqual(ran.config.overseer && ran.config.overseer.intro, false, 'the intro is on');
  assert.notEqual(ran.entities.mirror.shape.character.start, false, 'the mirror starts by itself');
  const q = game.events.quests;

  game.emit('intro', { state: 'start' });
  await advance(30000);
  assert.equal(sheetOpen(), false, 'no sheet over the intro');
  game.emit('intro', { state: 'end', skipped: true });
  await advance(30000);
  assert.equal(sheetOpen(), false, 'no sheet while the mirror has not been answered');

  game.emit('mirror', { state: 'open', auto: true });
  game.emit('mirror', { state: 'step', step: 'what' });
  game.emit('mirror', { state: 'step', step: 'look' });
  await advance(30000);
  assert.equal(sheetOpen(), false, 'no sheet in the middle of the mirror');
  assert.notEqual(q.state('tour'), 'active', 'no tour before the account');

  game.emit('mirror', { state: 'step', step: 'name' });
  game.emit('mirror', { state: 'done', what: 'toaster', name: 'Toast' });
  await advance(1500);
  assert.equal(sheetOpen(), true, 'the sheet comes right after the mirror');

  // The tour waits for the account: Pip does not offer it over the sheet.
  H.tick(12);
  assert.notEqual(q.state('tour'), 'active', 'no tour with the sheet open');
  assert.equal(Guest.accountFirst, true);
  assert.equal(names().includes('sandbox_tour_start'), false);

  // The funnel keeps the order (listed in AGENTS.md).
  const order = ['sandbox_intro_start', 'sandbox_intro_skip', 'sandbox_mirror_open', 'sandbox_mirror_answer', 'sandbox_gate', 'sandbox_sheet_shown'];
  const at = order.map((n) => names().indexOf(n));
  // (intro_start comes from the intro's own emit; the rest in the order above)
  assert.ok(at.every((i) => i >= 0), `all of ${order} happened: ${names()}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'intro > mirror > gate > sheet');
  assert.equal(names().filter((n) => n === 'sandbox_sheet_shown').length, 1, 'one sheet');
  assert.deepEqual(errors, []);

  // With the account, the same Pip starts the tour.
  Guest.accountFirst = false;
  H.tick(12);
  assert.equal(q.state('tour'), 'active', 'the tour starts once there is an account');
  assert.ok(names().indexOf('sandbox_tour_start') > names().indexOf('sandbox_sheet_shown'), 'the tour starts after the sheet');
}

test('while the sheet is open the world takes no input, and gives it back after', async () => {
  const game = await visit();
  const p = H.world.player;
  p.controls = true;
  game.emit('mirror', { state: 'done', what: 'toaster', name: 'Toast' });
  await advance(1500);
  assert.equal(sheetOpen(), true);
  assert.equal(p.controls, false, 'the player is held');
  assert.match(fs.readFileSync(path.join(ROOT, 'public', 'play', 'guest.js'), 'utf8'), /const close = \(\) => \{ unlock\(\)/, 'closing gives it back');
  // The sheet opens once: a second end of the mirror (or a skip) does not open another.
  game.emit('mirror', { state: 'skip' });
  await advance(5000);
  assert.equal(names().filter((n) => n === 'sandbox_sheet_shown').length, 1);
});

test('nothing is asked of Gen before the account', async () => {
  const game = await visit();
  game.emit('intro', { state: 'start' });
  game.emit('intro', { state: 'end', skipped: false });
  game.emit('mirror', { state: 'open', auto: true });
  game.emit('mirror', { state: 'done', what: 'toaster', name: 'Toast' });
  await advance(3000);
  assert.equal(sheetOpen(), true);
  H.tick(5);
  await advance(60000);
  // Only the world, who the player is (to know it is nobody) and the sheet's own health check.
  const allowed = /^GET \/v1\/(play-template\/sandbox|users\/me|health)$/;
  assert.deepEqual(fetched.filter((f) => !allowed.test(f)), [], `fetched: ${fetched}`);
  assert.equal(names().includes('sandbox_signup_ok'), false);
});

// (Before the return: guest.js keeps `session.returning` for the page, and a test run is one page.)
test('cleared storage is a first visit again: the full beginning', async () => {
  stored.hg_sandbox_return = JSON.stringify({ v: 1, name: 'Toast', at: 1 }); // (the record without the intro flag)
  try {
    await visit();
    assert.notEqual(ran.config.overseer && ran.config.overseer.intro, false);
    assert.equal(startup.some((e) => e.name === 'sandbox_return'), false);
  } finally { delete stored.hg_sandbox_return; }
});

test('a returning visitor skips the intro and the mirror, is welcomed by name, and still meets the sheet', async () => {
  stored.hg_overseer_intro = '1';
  stored.hg_sandbox_return = JSON.stringify({ v: 1, name: 'Toast', tour: 'fish', at: 1 });
  const chat: string[] = [];
  const line = H.chat.line;
  H.chat.line = (m: any) => { chat.push(m.text); return line(m); };
  try {
    const game = await visit({ intro: true });
    assert.equal(ran.config.overseer.intro, false, 'no intro');
    assert.equal(ran.entities.mirror.shape.character.start, false, 'no mirror');
    H.tick(3);
    assert.equal(names().includes('sandbox_intro_start'), false);
    assert.equal(names().includes('sandbox_mirror_open'), false);
    assert.equal(startup.some((e) => e.name === 'sandbox_return'), true);
    await advance(2600);
    assert.ok(chat.some((t) => /^Welcome back, Toast\./.test(t)), `welcomed: ${chat}`);
    assert.equal(sheetOpen(), false);
    await advance(4000);
    assert.equal(sheetOpen(), true, 'a guest without an account still meets the sheet');
    assert.equal(game.events.quests.state('tour') === 'active', false);
  } finally {
    H.chat.line = line;
    delete stored.hg_overseer_intro; delete stored.hg_sandbox_return;
  }
});

// ------------------------------------------------------------------ the Overseer's first-time lines
test('first-time lines: each once per device, and none over the intro, the mirror or the tour', async () => {
  const L = H.lines;
  const game = await visit();
  let t = 100;
  L.clock = () => t;
  H.speech.clock = () => t;
  H.speech.reset();
  L.rand = () => 0;
  L.reset();
  const said: string[] = [];
  game.on('overseer-line', (d: any) => said.push(d.id));
  t += L.SETTLE + 1;
  const step = (s = 0.3) => { t += s; H.tick(0.05); };
  const first = ['catch', 'wrecked', 'docked', 'spawned'];
  const fire = () => {
    game.emit('catch', { mine: true }); game.emit('wrecked', {}); game.emit('docked', {}); game.emit('spawned', { things: [] });
  };

  // The intro: everything waits.
  const was = Object.getOwnPropertyDescriptor(H.overseer, 'introPlaying')!;
  Object.defineProperty(H.overseer, 'introPlaying', { configurable: true, get: () => true });
  fire(); step(); step(5);
  assert.deepEqual(said, [], 'nothing over the intro');
  assert.equal(L.blocked(), 'intro');
  // The mirror: still waits.
  Object.defineProperty(H.overseer, 'introPlaying', was);
  game.mirror = { pending: true };
  step(2);
  assert.deepEqual(said, [], 'nothing over the mirror');
  assert.equal(L.blocked(), 'mirror');
  game.mirror = { pending: false };
  // Then one at a time, never two at once.
  for (let i = 0; i < 12; i++) { t += 9; step(); assert.ok(said.length <= i + 1); }
  assert.deepEqual([...said].sort(), ['boom', 'build', 'dock', 'fish']);

  // Once per device: the same moments again say nothing, now or after a reload of the page's memory.
  for (let i = 0; i < 3; i++) { t += 60; fire(); step(); step(); }
  assert.equal(said.length, 4, 'not twice');
  L.reload();
  for (const id of ['fish', 'boom', 'dock', 'build']) assert.ok(L.seen(id), id);
  t += 60; fire(); step(); step();
  assert.equal(said.length, 4, 'not twice on the same device');

  // A tour moment holds a new line back until the Overseer is done answering.
  t += 60;
  game.emit('tour', { step: 'fish' });
  game.emit('docked', {}); // (said already; a line that has a first time left would wait: use a fresh one)
  game.emit('death', {});
  L.reset();
  game.emit('tour', { step: 'boom' });
  game.emit('catch', { mine: true }); step(); step();
  assert.equal(L.blocked(), 'moment');
  assert.equal(said.length, 4, 'nothing over a tour moment');
  void first;
});
