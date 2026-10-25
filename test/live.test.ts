// The editor/game live stream (src/live.ts): ids, heartbeats, a retry hint, replay after a drop with no duplicates,
// and a clean end (the final chunk goes out) when the server leaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-live-test-'));
const { join, broadcast, closeAll } = await import('../src/live.ts');

const server = http.createServer((req, res) => {
  const u = new URL(req.url!, 'http://x');
  join('g1', { id: 'usr_1', name: 'A' }, res, undefined, String(req.headers['last-event-id'] ?? u.searchParams.get('last') ?? '') || null, 60);
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as any).port;

type Ev = { id?: string; event?: string; data?: string };
function open(headers: Record<string, string> = {}) {
  const events: Ev[] = [];
  let raw = '', beats = 0, ended = false;
  const req = http.get({ host: '127.0.0.1', port, path: '/', headers }, (r) => {
    r.setEncoding('utf8');
    r.on('data', (chunk: string) => {
      raw += chunk;
      let i;
      while ((i = raw.indexOf('\n\n')) >= 0) {
        const block = raw.slice(0, i); raw = raw.slice(i + 2);
        if (block.startsWith(': beat')) { beats++; continue; }
        const e: Ev = {};
        for (const line of block.split('\n')) { const m = /^(\w+): ?(.*)$/.exec(line); if (m) (e as any)[m[1]] = m[2]; }
        events.push(e);
      }
    });
    r.on('end', () => { ended = true; });
  });
  return { events, req, get beats() { return beats; }, get ended() { return ended; } };
}
const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(f(), 'timed out'); };
const names = (c: ReturnType<typeof open>) => c.events.filter((e) => e.event === 'file').map((e) => JSON.parse(e.data!).n);

test('a dropped stream comes back with what it missed, once', async () => {
  const a = open();
  await until(() => a.events.some((e) => e.event === 'hello'));
  broadcast('g1', 'file', { n: 1 });
  broadcast('g1', 'file', { n: 2 });
  await until(() => names(a).length === 2);
  const lastId = a.events.filter((e) => e.event === 'file').at(-1)!.id!;
  assert.ok(lastId, 'durable events carry an id');
  a.req.destroy(); // the drop
  broadcast('g1', 'file', { n: 3 }); // while it is away
  broadcast('g1', 'presence', []); // state, never replayed
  const b = open({ 'Last-Event-ID': lastId });
  await until(() => names(b).length === 1);
  broadcast('g1', 'file', { n: 4 });
  await until(() => names(b).length === 2);
  assert.deepEqual(names(b), [3, 4]); // 1 and 2 not again, 3 not lost
  assert.equal(b.events.filter((e) => e.event === 'presence' && e.id).length, 0);
  b.req.destroy();
});

test('retry hint first, heartbeats while idle, and an id that is not one of ours replays nothing', async () => {
  const c = open({ 'Last-Event-ID': 'bxxxxxx-1' });
  await until(() => c.beats >= 2);
  assert.deepEqual(names(c), []);
  assert.ok(c.events[0].event === undefined, 'the retry line comes before the hello');
  c.req.destroy();
});

test('on shutdown the stream says bye and ends cleanly', async () => {
  const d = open();
  await until(() => d.events.some((e) => e.event === 'hello'));
  closeAll();
  await until(() => d.ended);
  assert.equal(d.events.at(-1)!.event, 'bye');
});

test.after(() => void server.close());
