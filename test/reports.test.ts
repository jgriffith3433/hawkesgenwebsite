// Reports and closing a world (src/games.ts reportGame / setHidden, /v1/play/<slug>/report, /v1/admin/reports,
// public/closed.html): anyone may report; an admin hides; a hidden world serves a closed page with no scripts and no bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-reports-'));
process.env.HAWKESGEN_URL = 'http://127.0.0.1:9';
process.env.HAWKESGEN_KEY = 'hg_test';
process.env.SIGNUPS_PER_HOUR = '100';

const { handle, onUpgrade } = await import('../src/server.ts');
const portal = http.createServer((req, res) => void handle(req, res));
portal.on('upgrade', onUpgrade);
await new Promise<void>((r) => portal.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(portal.address() as any).port}`;
test.after(() => { portal.closeAllConnections?.(); portal.close(); });

async function call(route: string, o: { body?: unknown; cookie?: string; text?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers['Content-Type'] = o.text ? 'text/plain' : 'application/json';
  if (o.cookie) headers.Cookie = o.cookie;
  const r = await fetch(base + route, { method: o.body !== undefined ? 'POST' : 'GET', headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, headers: r.headers, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
let n = 0;
const account = async (name: string) => (await call('/v1/users/signup', { body: { email: `${name}-${++n}@example.test`, password: 'correct horse battery', name } })).cookie!;

async function setup() {
  const owner = await account('Maker');
  const g = (await call('/v1/games', { cookie: owner, body: { title: 'Odd world', template: 'blank' } })).body;
  const { ensureAdmin, passwordLink } = await import('../src/users.ts');
  const a = await ensureAdmin('boss@hawkesgen.ai', 'Boss');
  const token = new URL(passwordLink(a.id, 'https://hawkesgen.test')).searchParams.get('token');
  const boss = (await call('/v1/users/password', { body: { token, password: 'a-real-password' } })).cookie!;
  return { owner, g, boss };
}

test('anyone can report a world: signed in or not, a reason is needed, the same report twice is one', async () => {
  const { g, boss } = await setup();
  const url = `/v1/play/${g.slug}/report`;
  const guest = await call(url, { body: { reason: 'scam', note: 'asks for my password' }, text: true });
  assert.equal(guest.status, 200, JSON.stringify(guest.body));
  assert.equal(guest.headers.get('access-control-allow-origin'), '*', 'the sandboxed play page has no origin');
  assert.equal((await call(url, { body: { reason: 'nonsense' } })).status, 400);
  assert.equal((await call(url, { body: {} })).status, 400);
  assert.equal((await call('/v1/play/no-such-world/report', { body: { reason: 'broken' } })).status, 404);
  const visitor = await account('Visitor');
  assert.equal((await call(url, { cookie: visitor, body: { reason: 'broken' } })).status, 200);
  await call(url, { cookie: visitor, body: { reason: 'broken' } });
  await call(url, { body: { reason: 'scam' }, text: true });
  const list = (await call('/v1/admin/reports', { cookie: boss })).body.games;
  const row = list.find((x: any) => x.slug === g.slug);
  assert.equal(row.reports, 2, 'a repeat from the same person is not counted twice');
  assert.deepEqual(row.byReason, { scam: 1, broken: 1 });
  assert.equal(row.owner.email.startsWith('maker-'), true);
  assert.equal(row.hidden, false);
});

test('reports are rate limited per address', async () => {
  const { g } = await setup();
  let last = 0;
  for (let i = 0; i < 14; i++) last = (await call(`/v1/play/${g.slug}/report`, { body: { reason: 'other', note: `n${i}` }, text: true })).status;
  assert.equal(last, 429);
});

test('only admins see reports or hide; a hidden world is closed, gone from the gallery, and unhide opens it', async () => {
  const { owner, g, boss } = await setup();
  const visitor = await account('Visitor');
  await call(`/v1/play/${g.slug}/report`, { body: { reason: 'scary' }, text: true });
  assert.equal((await call('/v1/admin/reports', { cookie: visitor })).status, 404);
  assert.equal((await call(`/v1/admin/games/${g.id}/hide`, { cookie: visitor, body: {} })).status, 404);
  assert.ok((await call('/v1/gallery')).body.games.some((x: any) => x.slug === g.slug), 'listed before');
  assert.equal((await fetch(`${base}/play/${g.slug}`)).status, 200);
  assert.equal((await call(`/v1/play/${g.slug}`)).status, 200);

  const hide = await call(`/v1/admin/games/${g.id}/hide`, { cookie: boss, body: { reason: 'It asks for passwords.' } });
  assert.equal(hide.status, 200, JSON.stringify(hide.body));
  assert.equal(hide.body.game.closed.reason, 'It asks for passwords.');

  const page = await fetch(`${base}/play/${g.slug}`);
  const html = await page.text();
  assert.equal(page.status, 410);
  assert.match(html, /This world is closed/);
  assert.doesNotMatch(html, /<script/i, 'no script of the page or the game');
  assert.doesNotMatch(html, /modules\.js|runtime\.js|\/v1\/play\//);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.equal((await fetch(`${base}/play/${g.slug}/v/1`)).status, 410, 'a save too');
  const bundle = await call(`/v1/play/${g.slug}`);
  assert.equal(bundle.status, 410, 'the bundle is not served');
  assert.match(bundle.body.error, /closed/);
  assert.equal((await call(`/v1/play/${g.slug}/here`, { body: { s: 'x' }, text: true })).status, 404);
  assert.equal((await call('/v1/gallery')).body.games.some((x: any) => x.slug === g.slug), false, 'leaves the gallery');
  assert.equal((await call('/v1/games/remix', { cookie: visitor, body: { slug: g.slug } })).status === 200, false, 'nobody remixes it');

  // The owner sees why, and can still open the editor.
  const mine = (await call('/v1/games', { cookie: owner })).body.games.find((x: any) => x.id === g.id);
  assert.equal(mine.closed.reason, 'It asks for passwords.');
  assert.equal((await call(`/v1/games/${g.id}`, { cookie: owner })).status, 200);
  const row = (await call('/v1/admin/reports', { cookie: boss })).body.games.find((x: any) => x.slug === g.slug);
  assert.equal(row.hidden, true);
  assert.equal(row.hiddenBy, 'boss@hawkesgen.ai');

  const open = await call(`/v1/admin/games/${g.id}/unhide`, { cookie: boss, body: {} });
  assert.equal(open.body.game.closed, null);
  assert.equal((await fetch(`${base}/play/${g.slug}`)).status, 200);
  assert.equal((await call(`/v1/play/${g.slug}`)).status, 200);
  assert.ok((await call('/v1/gallery')).body.games.some((x: any) => x.slug === g.slug), 'back in the gallery');
  assert.equal((await call('/v1/games', { cookie: owner })).body.games.find((x: any) => x.id === g.id).closed, null);
});

test('the play page offers Report in its pause menu and a corner button', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'play', 'play.html'), 'utf8');
  assert.match(html, /id="reportBtn"/);
  assert.match(html, /Report this world/);
  assert.match(html, /\/report'/);
});
