// Hawkes Net for the games here (src/hnet.ts): the ticket route game pages call (local mode, Hawkes Net mode, edit
// tokens, invitations to a closed island, room codes), world edits saved here going to the game's rooms on Hawkes Net,
// invitations asking Gen whether the island's room is open, and the play page's CSP naming the relay. Against a fake Gen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const calls: { path: string; body: any }[] = [];
let openRooms = new Set<string>();
const fakeGen = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') : null;
  const url = new URL(req.url!, 'http://gen');
  calls.push({ path: url.pathname, body });
  const json = (status: number, b: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (url.pathname === '/v1/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hi\n\n'); return; }
  if (url.pathname === '/v1/net/status') return json(200, { up: true });
  if (url.pathname === '/v1/net/ticket') return json(200, { ticket: 'hn1.x.y', peer: 'p1', relayUrl: 'wss://gen.example/v1/net/ws', echo: body });
  if (url.pathname === '/v1/net/room') return json(200, { open: openRooms.has(body.room), players: openRooms.has(body.room) ? 2 : 0, limit: 32 });
  if (url.pathname === '/v1/net/publish') return json(200, { delivered: 1, rooms: 1 });
  if (url.pathname === '/v1/lods') return json(200, { lods: {}, queued: 0 });
  return json(404, { error: 'not in the fake' });
});
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));
process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-hnet-'));
process.env.HAWKESGEN_URL = `http://127.0.0.1:${(fakeGen.address() as any).port}`;
process.env.HAWKESGEN_KEY = 'hg_test';
process.env.PORTAL_DEV_OPEN_PLAY = '0';
process.env.PORTAL_NET = 'hawkesnet';

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
  assert.equal((await (await fetch(`${base}/v1/island-invite/${inv.token}`)).json()).state, 'closed');
  openRooms = new Set([`t/sandbox/${inv.room}`]);
  assert.equal((await (await fetch(`${base}/v1/island-invite/${inv.token}`)).json()).state, 'open');
});

test("the play page's CSP lets games reach Gen's relay", () => {
  const csp = playCsp('n');
  const connect = csp.split(';').find((d: string) => d.trim().startsWith('connect-src'))!;
  assert.match(connect, /ws:\/\/127\.0\.0\.1:\d+/, 'the node inside Gen');
});
