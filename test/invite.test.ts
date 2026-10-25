// Island invitations (src/invites.ts, rooms.ts, relay.ts, the routes): the link and what it is worth, the room a friend joins
// and what the inviter hears when they do, closed / full / expired links, and the referral code riding in the link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-invite-'));
process.env.HAWKESGEN_URL = 'http://127.0.0.1:9';
process.env.HAWKESGEN_KEY = 'hg_test';
process.env.SIGNUPS_PER_HOUR = '100';
process.env.PORTAL_DEV_OPEN_PLAY = '0';

const { handle } = await import('../src/server.ts');
const rooms = await import('../src/rooms.ts');
const invites = await import('../src/invites.ts');
const relay = await import('../src/relay.ts');
const { sign } = await import('../src/sign.ts');

const server = http.createServer((req, res) => void handle(req, res));
server.on('upgrade', (req, raw) => rooms.upgrade(req, raw));
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as net.AddressInfo).port;
const base = `http://127.0.0.1:${port}`;
test.after(() => { server.closeAllConnections?.(); server.close(); });

async function call(route: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.cookie) headers.Cookie = o.cookie;
  const r = await fetch(base + route, { method: o.body !== undefined ? 'POST' : 'GET', headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}

/** A bare WebSocket client: the upgrade, then the server's text frames (unmasked) as parsed messages. */
function open(query: string) {
  return new Promise<{ status: number; msgs: any[]; sock: net.Socket }>((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`GET /v1/ws?${query} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    const msgs: any[] = [];
    let buf = Buffer.alloc(0);
    let status = 0;
    let headed = false;
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!headed) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        status = Number(/^HTTP\/1\.1 (\d+)/.exec(buf.subarray(0, end).toString())?.[1]);
        buf = buf.subarray(end + 4);
        headed = true;
        resolve({ status, msgs, sock });
      }
      for (;;) {
        if (buf.length < 2) return;
        let len = buf[1] & 0x7f, at = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
        if (buf.length < at + len) return;
        if ((buf[0] & 0x0f) === 1) { const m = JSON.parse(buf.subarray(at, at + len).toString()); (m.t === 'b' ? m.m : [m]).forEach((x: any) => msgs.push(x)); }
        buf = buf.subarray(at + len);
      }
    });
  });
}
const until = async (f: () => boolean, ms = 3000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 25)); } };

test('an invitation: a signed link to a room of the island, with the name and referral code cleaned', () => {
  const inv = invites.createInvite('https://hawkesgen.com', { name: '  <b>Mo</b>  ', ref: 'ABC123x' });
  assert.match(inv.room, /^[a-z0-9]{8}$/);
  assert.equal(inv.link, `https://hawkesgen.com/play/sandbox?invite=${inv.token}&ref=abc123x`);
  assert.equal(invites.createInvite('https://x', { name: 'A', ref: 'no way!' }).link.includes('&ref='), false, 'a code that is not one is left out');
  assert.equal(invites.cleanName('x'.repeat(80)).length, 24);
  assert.equal(invites.islandKey('abcd1234'), 'play:t/sandbox:abcd1234');
});

test('what an invitation is worth: open while the room is there, otherwise closed, full, expired or unreadable, each in plain words', () => {
  const inv = invites.createInvite('https://x', { name: 'Mo', ref: 'abc123' });
  const state = (open: boolean, people = 1) => () => ({ open, people, limit: 32 });
  const ok: any = invites.inviteStatus(inv.token, state(true));
  assert.equal(ok.state, 'open');
  assert.deepEqual([ok.room, ok.name, ok.ref], [inv.room, 'Mo', 'abc123']);
  const closed: any = invites.inviteStatus(inv.token, state(false, 0));
  assert.equal(closed.state, 'closed');
  assert.match(closed.message, /Mo has left their island/);
  assert.match(closed.message, /start an island of your own/);
  const full: any = invites.inviteStatus(inv.token, state(true, 32));
  assert.equal(full.state, 'full');
  assert.match(full.message, /Mo's island is full/);
  const old = invites.createInvite('https://x', { name: 'Mo' }, -5);
  assert.equal(invites.inviteStatus(old.token, state(true)).state, 'expired');
  assert.match(invites.inviteStatus(old.token, state(true)).message!, /run out/);
  assert.equal(invites.inviteStatus('nonsense', state(true)).state, 'invalid');
  assert.equal(invites.inviteStatus(inv.token.slice(0, -2) + 'xx', state(true)).state, 'invalid', 'a changed token is not ours');
  assert.equal(invites.inviteStatus(sign({ k: 'download', r: 'abcd1234' }, 60), state(true)).state, 'invalid', 'another kind of signed link is not an invitation');
});

test('the relay: the friend joins the inviter\'s room, who hears their name; the friend\'s hello lists the inviter', () => {
  const room = relay.newRoom(invites.islandKey('abcd1234'), 't:sandbox');
  const got: any[][] = [[], []];
  const mk = (i: number, name: string) => relay.newConn({ id: `c${i}`, name, color: '#fff', user: null, v: 2, now: i, send: (t) => got[i].push(JSON.parse(t)) });
  const inviter = mk(0, 'Mo');
  relay.join(room, inviter, 0);
  const friend = mk(1, 'Ana');
  relay.join(room, friend, 5);
  const flat = (m: any[]) => m.flatMap((x) => (x.t === 'b' ? x.m : [x]));
  relay.flush(room, 20);
  const hello = flat(got[1]).find((m) => m.t === 'hello');
  assert.equal(hello.host, 'c0', 'the inviter holds the island');
  assert.ok(hello.peers.some((p: any) => p.c === 'c0' && p.name === 'Mo'), 'the inviter is in the list');
  const joined = flat(got[0]).find((m) => m.t === 'join');
  assert.equal(joined.name, 'Ana', 'the inviter is told who came');
  // The friend's pose reaches the inviter (where the beam goes); the friend leaving does not close the island.
  relay.receive(room, friend, JSON.stringify({ t: 'me', at: 10, s: { p: [1, 0, 2], y: 0, pi: 0, f: 0 } }), 10);
  relay.flush(room, 50);
  assert.ok(flat(got[0]).some((m) => m.t === 'me' || m.c === 'c1'));
  relay.leave(room, friend);
  assert.equal(room.conns.size, 1);
});

test('the routes: a guest makes a link, a closed island says so, a signed-in inviter\'s referral code rides in the link', async () => {
  const g = await call('/v1/island-invite', { body: { name: 'Guest Mo' } });
  assert.equal(g.status, 200);
  assert.equal(g.body.ref, null);
  const token = new URL(g.body.link).searchParams.get('invite')!;
  assert.equal(new URL(g.body.link).pathname, '/play/sandbox');
  // Nobody is in the room yet: closed, with words and no way to join.
  const closed = await call(`/v1/island-invite/${token}`);
  assert.equal(closed.status, 200);
  assert.equal(closed.body.state, 'closed');
  assert.match(closed.body.message, /Guest Mo/);
  assert.equal((await call('/v1/island-invite/garbage')).body.state, 'invalid');

  // A signed-in inviter: their referral code is in the link (users.ts refCode), the same one the invite card in /app shows.
  const up = await call('/v1/users/signup', { body: { email: `inviter-${Date.now()}@example.com`, password: 'a-long-password', name: 'Ines' } });
  assert.equal(up.status, 200);
  const mine = await call('/v1/island-invite', { body: {}, cookie: up.cookie });
  const code = (await call('/v1/referral', { cookie: up.cookie })).body.code;
  assert.equal(mine.body.ref, code);
  assert.equal(new URL(mine.body.link).searchParams.get('ref'), code);
  const status: any = (await call(`/v1/island-invite/${new URL(mine.body.link).searchParams.get('invite')}`)).body;
  assert.equal(status.name, 'Ines', 'the name comes from the account when none is sent');
});

test('over the wire: the friend joins the open island beside its inviter; a closed one is refused; a full one is refused', async () => {
  const made = await call('/v1/island-invite', { body: { name: 'Mo' } });
  const token = new URL(made.body.link).searchParams.get('invite')!;
  const room = made.body.room;
  const q = (extra: string) => `play=t/sandbox&room=${room}&v=2${extra}`;

  // A friend who comes while no one is there is told the island is closed, and does not make an empty one.
  const early = await open(q('&name=Ana&join=1'));
  assert.equal(early.status, 403);
  assert.equal(rooms.roomState(invites.islandKey(room)).open, false);
  early.sock.destroy();

  // The inviter takes the room; the invitation is open.
  const inviter = await open(q('&name=Mo'));
  assert.equal(inviter.status, 101);
  await until(() => inviter.msgs.some((m) => m.t === 'hello'));
  assert.equal(((await call(`/v1/island-invite/${token}`)).body as any).state, 'open');

  const friend = await open(q('&name=Ana&join=1'));
  assert.equal(friend.status, 101);
  await until(() => friend.msgs.some((m) => m.t === 'hello'));
  const hello = friend.msgs.find((m) => m.t === 'hello');
  assert.ok(hello.peers.some((p: any) => p.name === 'Mo'));
  assert.equal(hello.host, inviter.msgs.find((m) => m.t === 'hello').you, 'the inviter holds the island');
  await until(() => inviter.msgs.some((m) => m.t === 'join'));
  assert.equal(inviter.msgs.find((m) => m.t === 'join').name, 'Ana');

  // Full: the status says so, and the room turns the next friend away.
  const filled: net.Socket[] = [];
  for (let i = 0; i < rooms.ROOM_LIMITS.people - 2; i++) { const c = await open(q(`&name=P${i}&join=1`)); assert.equal(c.status, 101); filled.push(c.sock); }
  assert.equal(((await call(`/v1/island-invite/${token}`)).body as any).state, 'full');
  const late = await open(q('&name=Late&join=1'));
  assert.equal(late.status, 403);
  late.sock.destroy();

  // Everyone gone: closed again.
  for (const s of [inviter.sock, friend.sock, ...filled]) s.destroy();
  await until(() => !rooms.roomState(invites.islandKey(room)).open);
  assert.equal(((await call(`/v1/island-invite/${token}`)).body as any).state, 'closed');
});
