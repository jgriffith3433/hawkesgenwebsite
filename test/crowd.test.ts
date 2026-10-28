// The load test (tools/crowd.mjs) runs tiny: a few players, a page load a few times a second, a couple of editor streams, a
// sign-in, against a portal it starts itself; and /v1/health/details answers an admin or this machine, nobody else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { AddressInfo } from 'node:net';

process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-crowd-test-'));
process.env.HAWKESGEN_URL = 'http://127.0.0.1:9';
process.env.HAWKESGEN_KEY = 'hg_test';
process.env.SIGNUPS_PER_HOUR = '1000';

const { handle } = await import('../src/server.ts');
const users = await import('../src/users.ts');

test('npm test runs the crowd tool tiny: players join, are heard back, nobody refused or reset', async () => {
  const out: string = await new Promise((res, rej) => execFile(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/crowd.mjs', '--tiny', '--json'], { cwd: path.resolve(import.meta.dirname, '..'), timeout: 60_000 }, (e, so) => (e ? rej(e) : res(so))));
  const r = JSON.parse(out.trim().split('\n').pop()!);
  const l = r.levels[0];
  assert.equal(l.open, l.players);
  assert.equal(l.refused, 0);
  assert.equal(l.resets, 0);
  assert.ok(l.pingSamples > 0, 'pings were answered');
  assert.ok(l.pageLoads > 0 && l.pageErrors === 0);
  assert.ok(l.editorStreams > 0, 'an editor stream opened');
  assert.equal(l.signinFailed, 0);
  assert.ok(l.kbPerPlayerPerSecDown > 0 && l.serverRssMB > 0);
  assert.equal(typeof r.largestHeld, 'number');
});

test('the tool will not point more than 200 players at another address', async () => {
  const code: number = await new Promise((res) => execFile(process.execPath, ['tools/crowd.mjs', '--url', 'https://hawkesgenwebsite.hawkesgen.ai', '--levels', '300'], { cwd: path.resolve(import.meta.dirname, '..') }, (e: any) => res(e ? e.code : 0)));
  assert.equal(code, 2);
});

test('/v1/health stays a plain 200; /v1/health/details is for admins and this machine', async () => {
  const server = http.createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/v1/health`)).status, 200);
    // From this machine itself (no proxy in front).
    const local = await fetch(`${base}/v1/health/details`);
    assert.equal(local.status, 200);
    const d: any = await local.json();
    for (const k of ['eventLoopMs', 'memoryMB', 'connections', 'rooms', 'requestsPerSecond', 'gen', 'jobs', 'lastBackup']) assert.ok(k in d, k);
    assert.ok('p50' in d.eventLoopMs && 'p99' in d.eventLoopMs);
    assert.ok('websockets' in d.connections && 'sseStreams' in d.connections && 'http' in d.connections);
    assert.ok('open' in d.jobs && 'oldest' in d.jobs);
    // Through the proxy (an outside address in X-Forwarded-For): a stranger gets a 404.
    assert.equal((await fetch(`${base}/v1/health/details`, { headers: { 'X-Forwarded-For': '203.0.113.5' } })).status, 404);
    // An ordinary customer too; an admin sees it.
    const mk = async (email: string) => (await fetch(`${base}/v1/users/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.7' }, body: JSON.stringify({ email, password: 'details-pass-1' }) })).headers.get('set-cookie')!.split(';')[0];
    const customer = await mk('plain@example.com');
    const boss = await mk('boss@example.com');
    const row = users.getUserByEmail('boss@example.com');
    assert.ok(row, 'the admin account exists');
    (await import('../src/db.ts')).db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run('boss@example.com');
    const outside = { 'X-Forwarded-For': '203.0.113.9' };
    assert.equal((await fetch(`${base}/v1/health/details`, { headers: { ...outside, Cookie: customer } })).status, 404);
    const seen = await fetch(`${base}/v1/health/details`, { headers: { ...outside, Cookie: boss } });
    assert.equal(seen.status, 200);
    assert.ok(((await seen.json()) as any).eventLoopMs);
  } finally { server.closeAllConnections?.(); server.close(); }
});
