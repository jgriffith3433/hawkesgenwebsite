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
const projectsKept = new Map<string, any>();
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
  if (url.pathname === '/v1/net/projects' && req.method === 'POST') { const id = body.id ?? String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'); projectsKept.set(id, { id, name: body.name, owner: body.owner, sites: [], p2p: false }); return json(200, projectsKept.get(id)); }
  if (url.pathname === '/v1/net/projects') { const owner = url.searchParams.get('owner'); return json(200, { owner, admin: url.searchParams.get('admin') === 'true', tier: url.searchParams.get('tier'), projects: [...projectsKept.values()].filter((x) => x.owner === owner), unowned: [] }); }
  const pm = /^\/v1\/net\/projects\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (pm) {
    const kept = projectsKept.get(pm[1]);
    const owner = body?.owner ?? url.searchParams.get('owner');
    if (!kept || kept.owner !== owner) return json(404, { error: 'No project in this account' });
    if (pm[2] === '/claim') return json(200, { ...kept });
    if (pm[2]?.startsWith('/rooms/')) return json(200, pm[2].endsWith('/kick') ? { kicked: 1, echo: body } : { players: [{ peer: 'p1', name: 'Ada' }], room: decodeURIComponent(pm[2].slice(7)) });
    if (req.method === 'DELETE') { projectsKept.delete(pm[1]); return json(200, { ok: true }); }
    if (req.method === 'POST') { Object.assign(kept, { ...(body.sites !== undefined ? { sites: body.sites } : {}), ...(body.p2p !== undefined ? { p2p: body.p2p } : {}), ...(body.name ? { name: body.name } : {}) }); return json(200, { ...kept, tier: body.tier }); }
    return json(200, { ...kept, rooms: [], tickets: [] });
  }
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
  assert.equal(j.echo.transport, 'relay', 'every room on the relay (peer to peer is not the default)');
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

test('the public demo (/net) gets a room of its own on the relay, light', async () => {
  const j = await (await ticket({ play: 'net-demo', room: 'demo1234', name: 'Ada' })).json();
  assert.equal(j.room, 'd/demo1234');
  assert.equal(j.echo.transport, 'relay');
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
  assert.equal((await post({ room: 'lobby' }, apiKey)).status, 400, 'which project: a customer has several');
  const r = await post({ project: 'acme-arena', room: 'lobby', name: 'Ada', transport: 'relay', role: 'spectator', config: { maxPlayers: 64, evil: 1 } }, apiKey);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ticket, 'hn1.x.y');
  assert.equal(j.echo.project, 'acme-arena', 'the project it named (the service checks it is theirs)');
  assert.equal(j.echo.room, 'lobby');
  assert.equal(j.echo.transport, 'relay');
  assert.equal(j.echo.role, 'spectator');
  assert.equal(j.echo.config.maxPlayers, 64);
  assert.equal(j.echo.config.evil, undefined, 'only the known room settings pass');
  assert.equal(calls.find((c) => c.path === '/v1/net/ticket')!.project, user.project, 'the portal key narrowed to their project');
  assert.equal((await post({ project: 'acme-arena', room: '../x y' }, apiKey)).status, 400);
  assert.equal((await post({ project: 'acme-arena', room: 'lobby2' }, apiKey).then((x) => x.json())).echo.transport, 'relay', 'the relay unless asked');
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
  assert.equal(me.admin, false);
  assert.match(me.key.prefix, /^hg_/);
  assert.deepEqual(me.projects.projects, [], 'no projects yet');
  assert.equal(me.projects.tier, 'free', 'the service is told the account is free');
  const docs = await fetch(`${base}/net/docs`, { redirect: 'manual' });
  assert.equal(docs.status, 301, '/net/docs moved to net.hawkesgen.com');
  assert.equal(docs.headers.get('location'), 'https://net.hawkesgen.com/');
  const page = await (await fetch(`${base}/net`)).text();
  assert.match(page, /Games on Hawkes Net/, '/net is the offering');
  assert.match(page, /https:\/\/net\.hawkesgen\.com\//, 'its buttons open net.hawkesgen.com');
  assert.match(page, /sickofitgame\.com/);
  assert.doesNotMatch(page, /\/net\/docs/);
});

test('signing in from the Net dashboard: its page may sign in, sign up and sign out here; Google and a reset come back to it', async () => {
  const dash = 'https://net.hawkesgen.com';
  for (const r of ['/v1/users/login', '/v1/users/signup', '/v1/users/forgot', '/v1/users/logout']) {
    const pre = await fetch(`${base}${r}`, { method: 'OPTIONS', headers: { Origin: dash, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(pre.status, 204, r);
    assert.equal(pre.headers.get('access-control-allow-origin'), dash, r);
    assert.equal(pre.headers.get('access-control-allow-credentials'), 'true', r);
  }
  const other = await fetch(`${base}/v1/users/login`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null, 'no other site');
  const users = await import('../src/users.ts');
  await users.createAccount({ email: 'net-signin@example.com', password: 'a long password 1' });
  const login = await fetch(`${base}/v1/users/login`, { method: 'POST', headers: { Origin: dash, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'net-signin@example.com', password: 'a long password 1' }) });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('access-control-allow-origin'), dash, 'the dashboard reads the answer');
  assert.match(login.headers.get('set-cookie') ?? '', /hg_session=/, 'and the session is set on hawkesgen.com');
  // Google (not set up in tests): the problem goes back to the page the sign-in started from.
  const fromNet = await fetch(`${base}/auth/google?next=/net/back`, { redirect: 'manual' });
  assert.match(fromNet.headers.get('location') ?? '', /^https:\/\/net\.hawkesgen\.com\/\?signin_error=/);
  const fromHome = await fetch(`${base}/auth/google?next=/app`, { redirect: 'manual' });
  assert.match(fromHome.headers.get('location') ?? '', /^\/\?signin_error=/);
  const back = await fetch(`${base}/net/back`, { redirect: 'manual' });
  assert.equal(back.headers.get('location'), `${dash}/`);
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

test("a developer's Hawkes Net projects (the Net dashboard): made, listed, changed and read as their account; sites need a paid account; JSON only", async () => {
  const users = await import('../src/users.ts');
  const u: any = await users.createAccount({ email: 'net-projects@example.com', password: 'a long password 1' });
  const user = u.user ?? u;
  const { apiKey } = users.mintApiKey(user.id);
  const call = (method: string, path: string, body?: any, type = 'application/json') => fetch(`${base}${path}`, { method, headers: { 'Content-Type': type, Authorization: `Bearer ${apiKey}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal((await fetch(`${base}/v1/net/projects`)).status, 401, 'signed in only');
  assert.equal((await call('POST', '/v1/net/projects', { name: 'Acme Arena' }, 'text/plain')).status, 415, 'JSON only');
  calls.length = 0;
  const made = await (await call('POST', '/v1/net/projects', { name: 'Acme Arena', owner: 'usr_someone_else', admin: true })).json();
  assert.equal(made.id, 'acme-arena');
  const sent = calls.find((c) => c.path === '/v1/net/projects')!;
  assert.equal(sent.body.owner, user.project, 'always their own account, whatever the page says');
  assert.equal(sent.body.admin, false, 'and never an admin unless they are one');
  assert.equal(sent.body.tier, 'free');
  assert.equal(sent.project, undefined, "the portal's key as it is: the service checks the account it names is one of the key's");
  const list = await (await call('GET', '/v1/net/projects')).json();
  assert.deepEqual(list.projects.map((x: any) => x.id), ['acme-arena']);
  assert.equal((await call('POST', '/v1/net/projects/acme-arena', { sites: ['https://acme.games'] })).status, 402, 'sites need a paid account');
  assert.equal((await call('POST', '/v1/net/projects/acme-arena', { p2p: true, maxPlayers: 8 })).status, 200, 'settings are fine on the free tier');
  const billing = await import('../src/billing.ts');
  billing.add(user.id, 500, 'stripe_purchase', 'test pack');
  const set = await (await call('POST', '/v1/net/projects/acme-arena', { sites: ['https://acme.games'] })).json();
  assert.deepEqual(set.sites, ['https://acme.games']);
  assert.equal(set.tier, 'paid', 'paid now: the service hears it');
  assert.equal((await call('GET', '/v1/net/projects/acme-arena/rooms/lobby')).status, 200, 'who is in a room');
  assert.equal((await (await call('POST', '/v1/net/projects/acme-arena/rooms/lobby/kick', { sub: 'u-bo' })).json()).kicked, 1);
  assert.equal((await call('POST', '/v1/net/projects/sickofit/claim', {})).status, 403, 'only an admin takes a Hawkes game');
  assert.equal((await call('GET', '/v1/net/projects/not-mine')).status, 404);
  assert.equal((await call('DELETE', '/v1/net/projects/acme-arena')).status, 200);
  const pre = await fetch(`${base}/v1/net/projects/acme-arena`, { method: 'OPTIONS', headers: { Origin: 'https://net.hawkesgen.com', 'Access-Control-Request-Method': 'DELETE' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://net.hawkesgen.com', 'the dashboard may call it');
  assert.match(pre.headers.get('access-control-allow-methods') ?? '', /DELETE/);
});
