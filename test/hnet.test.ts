// Hawkes Net for the games here (src/hnet.ts): the ticket route game pages call (local mode, Hawkes Net mode, edit
// tokens, invitations to a closed island, room codes), world edits saved here going to the game's rooms on Hawkes Net,
// invitations asking Gen whether the island's room is open, and the play page's CSP naming the relay. Against a fake Gen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const calls: { path: string; body: any; project?: string }[] = [];
let openRooms = new Set<string>();
const sitesKept = new Map<string, any>();
const fakeGen = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') : null;
  const url = new URL(req.url!, 'http://gen');
  calls.push({ path: url.pathname, body, project: req.headers['x-hawkesgen-project'] as string | undefined });
  const json = (status: number, b: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (url.pathname === '/v1/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hi\n\n'); return; }
  if (url.pathname === '/v1/net/status') return json(200, { up: true });
  if (url.pathname === '/v1/net/ticket') return json(200, { ticket: 'hn1.x.y', peer: 'p1', relayUrl: 'wss://gen.example/v1/net/ws', echo: body });
  if (url.pathname === '/v1/net/room') return json(200, { open: openRooms.has(body.room), players: openRooms.has(body.room) ? 2 : 0, limit: 32 });
  if (url.pathname === '/v1/net/publish') return json(200, { delivered: 1, rooms: 1 });
  if (url.pathname === '/v1/lods') return json(200, { lods: {}, queued: 0 });
  if (url.pathname === '/v1/net/sites' && req.method === 'POST') { sitesKept.set(body.project, body); return json(200, { project: body.project, name: body.name, origins: body.origins, max: 20 }); }
  if (url.pathname === '/v1/net/sites') { const k = sitesKept.get(url.searchParams.get('project') ?? ''); return json(200, { sites: k ? [{ project: k.project, name: k.name, origins: k.origins }] : [], max: 20 }); }
  return json(404, { error: 'not in the fake' });
});
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));
process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-hnet-'));
process.env.HAWKESGEN_URL = `http://127.0.0.1:${(fakeGen.address() as any).port}`;
process.env.HAWKESGEN_KEY = 'hg_test';
process.env.PORTAL_DEV_OPEN_PLAY = '0';
process.env.PORTAL_NET = 'hawkesnet';
process.env.PORTAL_NET_URL = process.env.HAWKESGEN_URL; // the fake answers the Hawkes Net service's routes too

const { handle, playCsp } = await import('../src/server.ts');
const { sign } = await import('../src/sign.ts');
const rooms = await import('../src/rooms.ts');
const invites = await import('../src/invites.ts');
const portal = http.createServer((req, res) => void handle(req, res));
await new Promise<void>((r) => portal.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(portal.address() as any).port}`;
test.after(() => { portal.closeAllConnections(); portal.close(); fakeGen.closeAllConnections(); fakeGen.close(); });
const ticket = (body: any) => fetch(`${base}/v1/net/ticket`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });

test('a game page gets a Hawkes Net ticket for a template room: Gen is asked with the portal key, the room named by the template and code', async () => {
  const r = await ticket({ play: 't/sandbox', room: 'abcd1234', name: 'Ada <b>' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*', 'open CORS: game pages are sandboxed');
  const j = await r.json();
  assert.equal(j.mode, 'hawkesnet');
  assert.equal(j.room, 't/sandbox/abcd1234');
  assert.equal(j.echo.project, 'hawkesgenwebsite');
  assert.equal(j.echo.transport, 'auto', 'rooms of friends start peer to peer');
  assert.equal(j.echo.name, 'Ada b', 'the name is cleaned');
});

test('the live room of a game is on the relay from the start; a game that does not exist has no rooms; bad codes are refused', async () => {
  assert.equal((await ticket({ play: 'no-such-game', room: 'live' })).status, 404);
  assert.equal((await ticket({ play: 't/sandbox', room: 'x' })).status, 400);
  const j = await (await ticket({ play: 't/sandbox', room: 'live' })).json();
  assert.equal(j.echo.transport, 'relay');
});

test("the editor's room needs a signed edit token; a friend can't open a closed island", async () => {
  assert.equal((await ticket({ token: 'nope' })).status, 401);
  assert.equal((await ticket({ token: sign({ k: 'edit', g: 'g_0000', u: 'usr_00' }, 60) })).status, 404, 'a token for a game that is not there');
  assert.equal((await ticket({ play: 't/sandbox', room: 'closed01', join: true })).status, 409);
  openRooms = new Set(['t/sandbox/open0001']);
  assert.equal((await ticket({ play: 't/sandbox', room: 'open0001', join: true })).status, 200);
});

test("local mode: the page is told to use this site's rooms (/v1/ws)", async () => {
  process.env.PORTAL_NET = 'local';
  try { assert.deepEqual(await (await ticket({ play: 't/sandbox', room: 'live' })).json(), { mode: 'local' }); }
  finally { process.env.PORTAL_NET = 'hawkesnet'; }
});

test("world edits saved here go to every room of the game on Hawkes Net (g/<id>/*), with the sender left out", async () => {
  calls.length = 0;
  rooms.broadcastOps('g_abc123', [{ op: 'create', entity: { id: 'tree' } }], 'Ada', 'beam', 'p3');
  await new Promise((r) => setTimeout(r, 100));
  const pub = calls.find((c) => c.path === '/v1/net/publish');
  assert.ok(pub, 'published');
  assert.equal(pub!.body.room, 'g/g_abc123/*');
  assert.equal(pub!.body.except, 'p3');
  assert.equal(pub!.body.by, 'Ada');
});

test("an invitation asks Gen whether the island's room is open", async () => {
  const inv = invites.createInvite(base, { name: 'Bo' });
  openRooms = new Set();
  assert.equal((await (await fetch(`${base}/v1/island-invite/${inv.token}`)).json()).state, 'open', 'just made: the inviter is still connecting');
  const aged = sign({ k: 'island', r: inv.room, n: 'Bo', f: null }, invites.INVITE_TTL - 60);
  assert.equal((await (await fetch(`${base}/v1/island-invite/${aged}`)).json()).state, 'closed');
  openRooms = new Set([`t/sandbox/${inv.room}`]);
  assert.equal((await (await fetch(`${base}/v1/island-invite/${inv.token}`)).json()).state, 'open');
});

test("the play page's CSP lets games reach Gen's relay", () => {
  const csp = playCsp('n');
  const connect = csp.split(';').find((d: string) => d.trim().startsWith('connect-src'))!;
  assert.match(connect, /ws:\/\/127\.0\.0\.1:\d+/, 'the node inside Gen');
});

test('the public demo (/net) gets a peer-to-peer room of its own, light, up to 8 before the relay', async () => {
  const j = await (await ticket({ play: 'net-demo', room: 'demo1234', name: 'Ada' })).json();
  assert.equal(j.room, 'd/demo1234');
  assert.equal(j.echo.transport, 'auto');
  assert.equal(j.echo.config.profile, 'light');
  assert.equal(j.echo.config.p2pMax, 8);
  assert.equal((await ticket({ play: 'net-demo', room: 'no' })).status, 400);
});

test("a customer's server gets a ticket in its own Hawkes Net project with its API key; no key, no ticket", async () => {
  const users = await import('../src/users.ts');
  const u: any = await users.createAccount({ email: 'net-customer@example.com', password: 'a long password 1' });
  const user = u.user ?? u;
  const { apiKey } = users.mintApiKey(user.id);
  const post = (body: any, key?: string) => fetch(`${base}/v1/net/rooms/ticket`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post({ room: 'lobby' })).status, 401);
  assert.equal((await post({ room: 'lobby' }, apiKey)).status, 402, 'a free account: the relay costs us, so no tickets yet');
  const billing = await import('../src/billing.ts');
  billing.add(user.id, 500, 'stripe_purchase', 'test pack');
  calls.length = 0;
  const r = await post({ room: 'lobby', name: 'Ada', transport: 'relay', role: 'spectator', config: { maxPlayers: 64, evil: 1 } }, apiKey);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ticket, 'hn1.x.y');
  assert.equal(j.echo.project, user.project, "the customer's own project");
  assert.equal(j.echo.room, 'lobby');
  assert.equal(j.echo.transport, 'relay');
  assert.equal(j.echo.role, 'spectator');
  assert.equal(j.echo.config.maxPlayers, 64);
  assert.equal(j.echo.config.evil, undefined, 'only the known room settings pass');
  assert.equal(calls.find((c) => c.path === '/v1/net/ticket')!.project, user.project, 'the portal key narrowed to their project');
  assert.equal((await post({ room: '../x y' }, apiKey)).status, 400);
});

test("a closed world: no tickets for its rooms, and the people in them are put out on Hawkes Net", async () => {
  const users = await import('../src/users.ts');
  const games = await import('../src/games.ts');
  const u: any = await users.createAccount({ email: 'net-owner@example.com', password: 'a long password 1' });
  const owner = u.user ?? u;
  const g: any = games.createGame(owner, { title: 'Net closed', template: 'blank' });
  const game = g.game ?? g;
  assert.equal((await ticket({ play: game.slug, room: 'abcd1234' })).status, 200);
  calls.length = 0;
  games.setHidden('admin', game.id, true, 'test');
  await new Promise((r) => setTimeout(r, 100));
  const kick = calls.find((c) => c.path === '/v1/net/publish' && c.body?.kick);
  assert.ok(kick, 'a kick was published');
  assert.equal(kick!.body.room, `g/${game.id}/p/*`);
  assert.equal(kick!.body.kick.sub, null, 'everyone');
  assert.equal((await ticket({ play: game.slug, room: 'abcd1234' })).status, 404);
});

test("sandboxed game pages (origin null) can import the Hawkes Net SDK: its modules are served with open CORS", async () => {
  for (const f of ['hawkes-net.mjs', 'hawkes-net-core.mjs']) {
    const r = await fetch(`${base}/play/${f}`, { headers: { Origin: 'null' } });
    assert.equal(r.status, 200, f);
    assert.equal(r.headers.get('access-control-allow-origin'), '*', f);
    assert.match(String(r.headers.get('content-type')), /javascript/, f);
  }
});

test("a developer's own Hawkes Net (/v1/net/me): their project, whether they may use it, rooms and usage, each part on its own", async () => {
  assert.equal((await fetch(`${base}/v1/net/me`)).status, 401, 'signed in only');
  const users = await import('../src/users.ts');
  const u: any = await users.createAccount({ email: 'net-dev@example.com', password: 'a long password 1' });
  const user = u.user ?? u;
  const { apiKey } = users.mintApiKey(user.id);
  const me = await (await fetch(`${base}/v1/net/me`, { headers: { Authorization: `Bearer ${apiKey}` } })).json();
  assert.equal(me.project, user.project);
  assert.equal(me.paid, false);
  assert.match(me.key.prefix, /^hg_/);
  assert.ok(me.rooms && me.usage, 'both parts answer (here with the fake service\'s errors, not a failed page)');
  const page = await fetch(`${base}/net/docs`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Your Hawkes Net/);
});

test('the Net dashboard (net.hawkesgen.com) may read /v1/net/me and make a key with the session; no other origin may', async () => {
  const dash = 'https://net.hawkesgen.com';
  const pre = await fetch(`${base}/v1/users/api-key`, { method: 'OPTIONS', headers: { Origin: dash, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), dash);
  assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');
  const me = await fetch(`${base}/v1/net/me`, { headers: { Origin: dash } });
  assert.equal(me.status, 401, 'signed out: the page shows the sign-in');
  assert.equal(me.headers.get('access-control-allow-origin'), dash, 'and can read that it is signed out');
  const other = await fetch(`${base}/v1/net/me`, { headers: { Origin: 'https://studio.hawkesgen.com' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null, 'another subdomain gets no CORS');
  const elsewhere = await fetch(`${base}/v1/users/me`, { headers: { Origin: dash } });
  assert.equal(elsewhere.headers.get('access-control-allow-origin'), null, 'only the two dashboard routes');
  const back = await fetch(`${base}/net/back`, { redirect: 'manual' });
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), dash + '/');
});

test("a developer's web game sites (the Net dashboard): paid accounts only, set in their own project with the portal's key, JSON only", async () => {
  const users = await import('../src/users.ts');
  const u: any = await users.createAccount({ email: 'net-sites@example.com', password: 'a long password 1' });
  const user = u.user ?? u;
  const { apiKey } = users.mintApiKey(user.id);
  const post = (body: any, type = 'application/json') => fetch(`${base}/v1/net/sites`, { method: 'POST', headers: { 'Content-Type': type, Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/v1/net/sites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401, 'signed in only');
  assert.equal((await post({ origins: ['https://acme.games'] })).status, 402, 'a free account: the relay costs us');
  const billing = await import('../src/billing.ts');
  billing.add(user.id, 500, 'stripe_purchase', 'test pack');
  assert.equal((await post({ origins: ['https://acme.games'] }, 'text/plain')).status, 415, 'JSON only: no form from another site');
  calls.length = 0;
  const r = await post({ project: 'usr_someone_else', name: 'Acme <b>Arena', origins: ['https://acme.games'] });
  assert.equal(r.status, 200);
  const sent = calls.find((c) => c.path === '/v1/net/sites')!;
  assert.equal(sent.body.project, user.project, 'always their own project, whatever the page says');
  assert.equal(sent.body.name, 'Acme bArena');
  assert.equal(sent.project, undefined, "asked with the portal's key as it is (the service lets only pattern keys set sites)");
  const got = await (await fetch(`${base}/v1/net/sites`, { headers: { Authorization: `Bearer ${apiKey}` } })).json();
  assert.deepEqual(got.origins, ['https://acme.games']);
  const me = await (await fetch(`${base}/v1/net/me`, { headers: { Authorization: `Bearer ${apiKey}` } })).json();
  assert.deepEqual(me.sites.origins, ['https://acme.games'], '/v1/net/me carries them for the dashboard');
  const pre = await fetch(`${base}/v1/net/sites`, { method: 'OPTIONS', headers: { Origin: 'https://net.hawkesgen.com', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://net.hawkesgen.com', 'the dashboard may call it');
});
