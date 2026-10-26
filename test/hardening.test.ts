// Hardening: password hashing off the event loop, one in-memory limiter, caps on realtime connections, open write routes
// limited per address, a play counted once per player per hour, and library fetches pinned to the address that was vetted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-hardening-'));
process.env.HAWKESGEN_URL = 'http://127.0.0.1:9';
process.env.HAWKESGEN_KEY = 'hg_test';
process.env.SIGNUPS_PER_HOUR = '1000';
process.env.PORTAL_DEV_OPEN_PLAY = '0';

const { handle } = await import('../src/server.ts');
const rooms = await import('../src/rooms.ts');
const live = await import('../src/live.ts');
const users = await import('../src/users.ts');
const games = await import('../src/games.ts');
const files = await import('../src/files.ts');
const { Limiter } = await import('../src/util.ts');

const server = http.createServer((req, res) => void handle(req, res));
server.on('upgrade', (req, raw) => rooms.upgrade(req, raw));
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as net.AddressInfo).port;
const base = `http://127.0.0.1:${port}`;
test.after(() => { server.closeAllConnections?.(); server.close(); });

async function call(route: string, o: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.cookie) headers.Cookie = o.cookie;
  const r = await fetch(base + route, { method: o.body !== undefined ? 'POST' : 'GET', headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}

// ------------------------------------------------------------------ passwords
test('the stored password format is unchanged, and old hashes still verify', async () => {
  const h = await users.hashPassword('correct horse');
  assert.match(h, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(await users.verifyPassword('correct horse', h), true);
  assert.equal(await users.verifyPassword('wrong horse', h), false);
  const salt = crypto.randomBytes(16);
  const old = `scrypt:${salt.toString('hex')}:${crypto.scryptSync('legacy', salt, 64).toString('hex')}`; // what scryptSync made
  assert.equal(await users.verifyPassword('legacy', old), true);
  assert.equal(await users.verifyPassword('x', 'nonsense'), false);
});

test('twenty sign-ins at once never block the event loop for more than 50 ms', async () => {
  const email = 'loop@example.com';
  assert.equal((await call('/v1/users/signup', { body: { email, password: 'twenty-parallel' }, headers: { 'X-Forwarded-For': '10.9.0.1' } })).status, 200);
  // A ticker that notices how long the loop was held: setInterval fires late by as long as something blocked it.
  let worst = 0, last = performance.now();
  const tick = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last - 5); last = now; }, 5);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => users.login({ email, password: i % 5 === 4 ? 'wrong' : 'twenty-parallel' }).then((r) => r.user.email, (e) => e.status)));
  clearInterval(tick);
  assert.equal(results.filter((r) => r === email).length, 16);
  assert.equal(results.filter((r) => r === 401).length, 4);
  assert.ok(worst < 50, `the loop was held ${worst.toFixed(1)} ms`);
});

test('over HTTP the sign-in limit is 20 a quarter hour per address: the 21st is refused before any hash runs', async () => {
  const h = { 'X-Forwarded-For': '10.9.0.77' };
  assert.equal((await call('/v1/users/signup', { body: { email: 'burst@example.com', password: 'burst-password' }, headers: h })).status, 200);
  const codes = await Promise.all(Array.from({ length: 21 }, () => call('/v1/users/login', { body: { email: 'burst@example.com', password: 'burst-password' }, headers: h }).then((r) => r.status)));
  assert.equal(codes.filter((c) => c === 200).length, 20);
  assert.equal(codes.filter((c) => c === 429).length, 1);
});

// ------------------------------------------------------------------ the limiter
test('the limiter slides, refuses past its max without counting the refusal, and forgets keys', () => {
  const l = new Limiter(2, 1000, 5);
  assert.equal(l.hit('a', 0), true);
  assert.equal(l.hit('a', 100), true);
  assert.equal(l.hit('a', 200), false);
  assert.equal(l.over('a', 900), true);
  assert.equal(l.hit('a', 1050), true, 'the first hit slid out of the window');
  assert.equal(l.count('a', 1050), 2);
  for (const k of ['b', 'c', 'd']) l.hit(k, 1100);
  assert.equal(l.size, 4);
  l.sweep(2500); // nothing in any key's window
  assert.equal(l.size, 0, 'keys with no recent hit are dropped');
});

test('the limiter holds a hard cap of keys, the oldest first', () => {
  const l = new Limiter(1, 60_000, 3);
  for (let i = 0; i < 10; i++) l.hit(`k${i}`, 1000 + i);
  assert.equal(l.size, 3);
  assert.equal(l.over('k0', 1020), false, 'the oldest was let go');
  assert.equal(l.over('k9', 1020), true, 'the newest is still counted');
});

// ------------------------------------------------------------------ realtime caps
function open(path: string, ip: string) {
  return new Promise<{ status: number; sock: net.Socket }>((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nX-Forwarded-For: ${ip}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    sock.on('error', () => {});
    sock.once('data', (d) => resolve({ status: Number(/^HTTP\/1.1 (\d+)/.exec(d.toString())![1]), sock }));
  });
}
const ws = (room: string) => `/v1/ws?play=t/sandbox&room=${room}&v=2`;
const closeAll = async (socks: net.Socket[]) => { for (const s of socks) s.destroy(); await new Promise((r) => setTimeout(r, 100)); };

test('past the per-address cap new connections are refused with 429 while players already in rooms keep playing', async () => {
  process.env.PORTAL_WS_PER_IP = '3';
  process.env.PORTAL_WS_PER_MIN = '1000';
  const mine: net.Socket[] = [];
  for (let i = 0; i < 3; i++) { const c = await open(ws('abcd'), '10.1.1.1'); assert.equal(c.status, 101); mine.push(c.sock); }
  const fourth = await open(ws('abcd'), '10.1.1.1');
  assert.equal(fourth.status, 429);
  // Another address is not touched by it, and the three already in the room are still there and answering.
  const other = await open(ws('abcd'), '10.1.1.2');
  assert.equal(other.status, 101);
  assert.equal(rooms.roomState('play:t/sandbox:abcd').people, 4);
  const pong = new Promise<boolean>((res) => { mine[0].on('data', (d) => { if (d[0] === 0x8a) res(true); }); setTimeout(() => res(false), 1500); });
  mine[0].write(Buffer.from([0x89, 0x80, 1, 2, 3, 4])); // a masked ping frame
  assert.equal(await pong, true, 'a socket already in a room is still served');
  // One that leaves frees its place.
  mine[2].destroy();
  await new Promise((r) => setTimeout(r, 150));
  const again = await open(ws('abcd'), '10.1.1.1');
  assert.equal(again.status, 101);
  await closeAll([...mine, other.sock, again.sock, fourth.sock]);
  delete process.env.PORTAL_WS_PER_IP;
});

test('the totals: sockets in all and rooms refuse with 503, an existing room still takes people', async () => {
  process.env.PORTAL_ROOMS_MAX = String(rooms.roomStats().rooms + 1);
  process.env.PORTAL_WS_PER_MIN = '1000';
  const first = await open(ws('room1'), '10.2.0.1');
  assert.equal(first.status, 101);
  const second = await open(ws('room2'), '10.2.0.2');
  assert.equal(second.status, 503, 'a second new room is past the cap');
  const joined = await open(ws('room1'), '10.2.0.3');
  assert.equal(joined.status, 101, 'the room that is there still takes players');
  delete process.env.PORTAL_ROOMS_MAX;
  process.env.PORTAL_WS_MAX = String(rooms.socketStats().sockets);
  const over = await open(ws('room1'), '10.2.0.4');
  assert.equal(over.status, 503, 'past the total');
  delete process.env.PORTAL_WS_MAX;
  await closeAll([first.sock, second.sock, joined.sock, over.sock]);
});

test('new connections per address per minute', async () => {
  process.env.PORTAL_WS_PER_MIN = '2';
  const a = await open(ws('rate1'), '10.3.0.1');
  const b = await open(ws('rate1'), '10.3.0.1');
  await closeAll([a.sock, b.sock]); // they leave; the minute still counts them
  const c = await open(ws('rate1'), '10.3.0.1');
  assert.deepEqual([a.status, b.status, c.status], [101, 101, 429]);
  await closeAll([c.sock]);
  delete process.env.PORTAL_WS_PER_MIN;
});

test('live streams are capped per account and in all', async () => {
  process.env.PORTAL_LIVE_PER_USER = '2';
  const made: http.ServerResponse[] = [];
  const stream = () => { const res = new http.ServerResponse(new http.IncomingMessage(new net.Socket())); res.write = () => true; made.push(res); return res; };
  const user = { id: 'usr_aaaaaaaaaaaaaaaa', name: 'A' };
  const a = stream(), b = stream(), c = stream();
  live.join('gcap', user, a);
  live.join('gcap', user, b);
  assert.throws(() => live.join('gcap', user, c), (e: any) => e.status === 429);
  live.join('gcap', { id: 'usr_bbbbbbbbbbbbbbbb', name: 'B' }, stream());
  a.emit('close'); // one closes: the account can open one again
  assert.doesNotThrow(() => live.join('gcap', user, stream()));
  delete process.env.PORTAL_LIVE_PER_USER;
  process.env.PORTAL_LIVE_MAX = '1';
  assert.throws(() => live.join('gcap', { id: 'usr_cccccccccccccccc', name: 'C' }, stream()), (e: any) => e.status === 503);
  delete process.env.PORTAL_LIVE_MAX;
  for (const r of made) r.emit('close'); // (their heartbeats stop)
});

// ------------------------------------------------------------------ open write routes
test('analytics beacons are limited per address (120 a minute) and the here ping per game (6 a minute)', async () => {
  const hdr = { 'X-Forwarded-For': '10.4.0.1' };
  let refused = 0;
  for (let i = 0; i < 125; i++) if ((await fetch(`${base}/v1/analytics/collect`, { method: 'POST', headers: hdr, body: '[]' })).status === 429) refused++;
  assert.equal(refused, 5);
  assert.equal((await fetch(`${base}/v1/analytics/collect`, { method: 'POST', headers: { 'X-Forwarded-For': '10.4.0.2' }, body: '[]' })).status, 202, 'another address is fine');
  const statuses: number[] = [];
  for (let i = 0; i < 8; i++) statuses.push((await call('/v1/play/t/sandbox/here', { body: { s: 'tab' }, headers: hdr })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 429, 429]);
});

// ------------------------------------------------------------------ plays
test('reloading a game ten times counts one play; another player counts another', async () => {
  const owner = (await call('/v1/users/signup', { body: { email: 'maker@example.com', password: 'maker-pass-1' }, headers: { 'X-Forwarded-For': '10.5.0.1' } })).cookie!;
  const g = (await call('/v1/games', { cookie: owner, body: { title: 'Plays', template: 'blank' } })).body;
  assert.ok(g.slug, JSON.stringify(g));
  const plays = () => (games.gameBySlug(g.slug) as any).plays as number;
  const before = plays();
  for (let i = 0; i < 10; i++) assert.equal((await call(`/v1/play/${g.slug}`, { headers: { 'X-Forwarded-For': '10.5.1.1' } })).status, 200);
  assert.equal(plays(), before + 1, 'ten reloads from one address are one play');
  await call(`/v1/play/${g.slug}`, { headers: { 'X-Forwarded-For': '10.5.1.2' } });
  assert.equal(plays(), before + 2, 'a different address is a different player');
  for (let i = 0; i < 3; i++) await call(`/v1/play/${g.slug}`, { cookie: owner, headers: { 'X-Forwarded-For': '10.5.1.1' } });
  assert.equal(plays(), before + 3, 'a signed-in player counts by account, once');
  // An hour later the same player plays again.
  const id = (games.gameBySlug(g.slug) as any).id;
  assert.equal(games.countPlay(id, 'ip:x', 1_000), true);
  assert.equal(games.countPlay(id, 'ip:x', 1_000 + 3_599_000), false);
  assert.equal(games.countPlay(id, 'ip:x', 1_000 + 3_601_000), true);
});

// ------------------------------------------------------------------ library fetches
test('a name that resolves to a private address is refused, and the connection is pinned to the vetted one', async () => {
  const user = { id: 'usr_x', project: 'usr_x' } as any;
  for (const bad of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '::1', '192.168.1.1']) {
    await assert.rejects(files.fetchIntoLibrary(user, 'https://evil.example/pic.png', async () => [{ address: bad, family: bad.includes(':') ? 6 : 4 }]), /can't be fetched/, bad);
  }
  await assert.rejects(files.fetchIntoLibrary(user, 'https://evil.example/pic.png', async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]), /can't be fetched/, 'one private answer refuses the lot');
  await assert.rejects(files.fetchIntoLibrary(user, 'https://localhost/pic.png'), /can't be fetched/, 'localhost really resolves to the machine');
  await assert.rejects(files.fetchIntoLibrary(user, 'https://127.0.0.1/pic.png'), /can't be fetched/);
  await assert.rejects(files.fetchIntoLibrary(user, 'https://[::1]/pic.png'), /can't be fetched/);
  await assert.rejects(files.fetchIntoLibrary(user, 'http://example.com/pic.png'), /https/);
  // The lookup node:https uses answers with the vetted address whatever name it is asked about (a rebind finds nothing).
  const look = files.pinnedLookup({ address: '93.184.216.34', family: 4 });
  const one = await new Promise<any[]>((r) => look('rebind.example', {}, (e, a, f) => r([e, a, f])));
  assert.deepEqual(one, [null, '93.184.216.34', 4]);
  const all = await new Promise<any[]>((r) => look('rebind.example', { all: true }, (e, a) => r([e, a])));
  assert.deepEqual(all, [null, [{ address: '93.184.216.34', family: 4 }]]);
});
