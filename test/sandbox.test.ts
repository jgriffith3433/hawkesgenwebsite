// Play before signing up: the guest sandbox page, its world, and the hand-over (the world a guest changed becomes
// their first game through the existing routes: POST /v1/games with the 'sandbox' template, then scene ops).
// None of it reaches Gen (HAWKESGEN_URL points nowhere).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-sandbox-'));
process.env.HAWKESGEN_URL = 'http://127.0.0.1:9';
process.env.HAWKESGEN_KEY = 'hg_test';
process.env.STARTER_CREDITS = '50';
process.env.SIGNUPS_PER_HOUR = '100';
process.env.PORTAL_DEV_OPEN_PLAY = '0'; // a developer's local .env may turn open play on; this test checks the real headers

const { handle } = await import('../src/server.ts');
const portal = http.createServer((req, res) => void handle(req, res));
await new Promise<void>((r) => portal.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(portal.address() as any).port}`;
test.after(() => portal.close());

async function call(route: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.cookie) headers.Cookie = o.cookie;
  const r = await fetch(base + route, { method: o.body !== undefined ? 'POST' : 'GET', headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, cookie: r.headers.get('set-cookie')?.split(';')[0], headers: r.headers };
}

const ctx: any = { window: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'play', 'guest.js'), 'utf8'), ctx);
const Guest = ctx.window.HawkesGuestCore;

test('the sandbox page is the game page, served unsandboxed (our template only); other games stay sandboxed', async () => {
  const page = await fetch(`${base}/play/sandbox`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-security-policy'), null);
  assert.match(await page.text(), /slug === 'sandbox'/);
  const other = await fetch(`${base}/play/t/sandbox`);
  assert.match(String(other.headers.get('content-security-policy')), /sandbox allow-scripts/);
  const t = await call('/v1/play-template/sandbox');
  assert.equal(t.status, 200);
  const scene = JSON.parse(t.body.files['scene.json']);
  for (const k of ['terrain', 'water', 'player', 'mayhem']) assert.ok(scene.config[k], k);
  const types = new Set(Object.values(scene.entities).map((e: any) => e.type));
  for (const k of ['truck', 'boat', 'helicopter', 'herd', 'tool-pickup', 'friend']) assert.ok(types.has(k), k);
  // The fuel barrels are the library's, and they still go off (Mayhem's explosive behavior).
  assert.ok((scene.entities.barrel_1.behaviors || []).some((b: any) => b.use === 'explosive'), 'barrels explode');
  // It's a new game's world: the round planet (an ocean round it), the Overseer's intro every time, Pip's tour.
  assert.equal(scene.config.planet.sphere, true);
  assert.equal(scene.config.overseer.intro, 'always');
  assert.ok(scene.config.quests.some((q: any) => q.id === 'tour' && q.giver === 'Pip'));
  // Its art and sound are community things, served with the template.
  assert.ok(Object.keys(t.body.assets).length === 0 || Object.values(t.body.assets).every((a: any) => /^\/v1\/community\/a_/.test(a.url)));
  // No paid AI talk: the friends use the free phrasebook.
  assert.equal(scene.config.friends, undefined);
  assert.equal((await fetch(`${base}/play/guest.js`)).status, 200);
});

test('a guest\'s changed island becomes their first game: the template, then the changes as scene ops', async () => {
  const s = await call('/v1/users/signup', { body: { email: 'guest@example.test', password: 'correct horse battery', name: 'Guest' } });
  assert.equal(s.status, 200);
  const cookie = s.cookie!;
  const tpl = JSON.parse((await call('/v1/play-template/sandbox')).body.files['scene.json']);
  // What the guest did: drove the 4x4 off, blew up two barrels, spawned a cow, dug a hole.
  const snap = JSON.parse(JSON.stringify(tpl));
  snap.entities.jeep.transform.position = [20, 3, 9];
  delete snap.entities.barrel_1;
  delete snap.entities.barrel_2;
  snap.entities.mh_cow_0 = { id: 'mh_cow_0', type: 'critter', name: 'Cow', shape: { species: 'cow' }, physics: 'dynamic', transform: { position: [1, 4.5, -6], rotation: [0, 40, 0] } };
  snap.config.terrain.edits = [['dig', 3, 1.5, -8, 8]];
  const ops = Guest.toOps(tpl, snap);
  assert.equal(ops.length, 5, JSON.stringify(ops.map((o: any) => o.op)));

  const game = await call('/v1/games', { cookie, body: { title: 'My island', template: 'sandbox' } });
  assert.equal(game.status, 200, JSON.stringify(game.body));
  for (const part of Guest.chunks(ops, 200)) {
    const r = await call(`/v1/games/${game.body.id}/scene`, { cookie, body: { ops: part } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.errors, []);
  }
  const files = (await call(`/v1/games/${game.body.id}`, { cookie })).body.files;
  const saved = JSON.parse(files.find((f: any) => f.path === 'scene.json').content);
  assert.deepEqual(saved.entities.jeep.transform.position, [20, 3, 9]);
  assert.equal(saved.entities.barrel_1, undefined);
  assert.equal(saved.entities.mh_cow_0.type, 'critter');
  assert.deepEqual(saved.config.terrain.edits, [['dig', 3, 1.5, -8, 8]]);
  assert.ok(saved.entities.pip && saved.entities.boat, 'the rest of the island is there');
  // Without an account nothing is made.
  assert.equal((await call('/v1/games', { body: { title: 'x', template: 'sandbox' } })).status, 401);
});

test('the landing page sends visitors to play first, and keeps "Start building" second', async () => {
  const html = await (await fetch(`${base}/`)).text();
  const hero = html.slice(html.indexOf('class="hero"'), html.indexOf('class="hero-demo"'));
  const play = hero.indexOf('href="/play/sandbox"');
  const build = hero.indexOf('Start building');
  assert.ok(play > 0 && build > play, 'Play now comes first, Start building second');
  assert.match(hero, /Play now \(no sign-up\)/);
});
