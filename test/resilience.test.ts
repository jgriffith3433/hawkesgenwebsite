// The real server process under load and under SIGTERM: no connection is reset, health answers within seconds of
// starting, and a request under way when SIGTERM arrives is finished before the process leaves.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const freePort = () => new Promise<number>((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => res(p)); }); });
const fakeGen = http.createServer((_q, r) => { r.writeHead(404, { 'Content-Type': 'application/json' }); r.end('{}'); });
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));
after(() => void fakeGen.close());

async function start() {
  const port = await freePort();
  const began = Date.now();
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.ts'], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, PORT: String(port), PORTAL_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'portal-res-')), HAWKESGEN_URL: `http://127.0.0.1:${(fakeGen.address() as any).port}`, HAWKESGEN_KEY: 'hg_test', PUBLIC_URL: 'https://hawkesgen.test' },
  });
  const exited = new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/v1/health`)).ok) break; } catch {}
    assert.ok(Date.now() - began < 10_000, 'health did not answer within 10 s');
    await new Promise((r) => setTimeout(r, 50));
  }
  return { port, child, exited, upMs: Date.now() - began };
}
const stop = (child: ChildProcess) => { if (child.exitCode === null) child.kill('SIGKILL'); };

test('health answers within a few seconds of starting', async () => {
  const s = await start();
  try { assert.ok(s.upMs < 5000, `took ${s.upMs} ms`); } finally { stop(s.child); }
});

test('50 parallel loads of every main page and its assets: no reset, no blank page', async () => {
  const s = await start();
  try {
    const paths = ['/', '/connect', '/play/sandbox', '/community', '/fonts/fonts.css', '/fonts/inter.woff2', '/fonts/jetbrains-mono.woff2', '/v1/health', '/v1/community?limit=5', '/v1/community/categories'];
    const agent = new http.Agent({ keepAlive: true, maxSockets: 100 });
    const get = (p: string) => new Promise<{ status: number; bytes: number }>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: s.port, path: p, agent }, (r) => { let n = 0; r.on('data', (c) => (n += c.length)); r.on('end', () => resolve({ status: r.statusCode!, bytes: n })); r.on('error', reject); }).on('error', (e) => reject(new Error(`${p}: ${e.message}`)));
    });
    for (let round = 0; round < 3; round++) {
      const all = await Promise.all(paths.flatMap((p) => Array.from({ length: 50 }, () => get(p).then((r) => ({ p, ...r })))));
      for (const r of all) {
        assert.ok(r.status < 500, `${r.p} answered ${r.status}`);
        if (r.status === 200) assert.ok(r.bytes > 0, `${r.p} came back blank`);
      }
      for (const p of ['/', '/connect', '/play/sandbox', '/community']) assert.ok(all.filter((r) => r.p === p).every((r) => r.status === 200), `${p} is not 200`);
    }
    agent.destroy();
  } finally { stop(s.child); }
});

test('SIGTERM finishes a request under way, then exits; new connections are refused', async () => {
  const s = await start();
  try {
    // A signup whose body is still arriving when SIGTERM lands: the server must wait for it and answer.
    const answer = new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: s.port, path: '/v1/users/signup', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => { r.resume(); r.on('end', () => resolve({ status: r.statusCode! })); });
      req.on('error', reject);
      req.write('{"email":"x@example');
      setTimeout(() => { s.child.kill('SIGTERM'); setTimeout(() => req.end('.com","password":"short"}'), 400); }, 200);
    });
    const r = await answer;
    assert.ok(r.status >= 200 && r.status < 500, `in-flight request got ${r.status}`);
    const code = await Promise.race([s.exited, new Promise<string>((res) => setTimeout(() => res('still running'), 5000))]);
    assert.equal(code, 0, 'the process should leave cleanly after answering');
    await assert.rejects(fetch(`http://127.0.0.1:${s.port}/v1/health`));
  } finally { stop(s.child); }
});
