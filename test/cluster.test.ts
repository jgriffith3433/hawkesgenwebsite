// The portal as a cluster (PORTAL_ROLE=web: src/primary.ts): two web processes and a worker. A change saved through one
// reaches an editor stream on the other, once; the assistant's lock holds across processes; a rolling restart drops no
// request and no editor stream (a stream ends cleanly and comes back with Last-Event-ID, missing nothing).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile, type ChildProcess } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const free = () => new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => res(p)); }); });
const fakeGen = http.createServer((q, r) => { q.resume(); r.writeHead(200, { 'Content-Type': 'application/json' }); r.end('{}'); });
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));
const children: ChildProcess[] = [];
after(() => { for (const c of children) c.kill('SIGKILL'); fakeGen.close(); });

async function startCluster(web = 2) {
  const port = await free();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-cluster-'));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.ts'], {
    cwd: ROOT, stdio: process.env.CLUSTER_LOG ? 'inherit' : ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, PORT: String(port), PORTAL_ROLE: 'web', PORTAL_WEB_PROCS: String(web), PORTAL_DATA_DIR: dir, HAWKESGEN_URL: `http://127.0.0.1:${(fakeGen.address() as any).port}`, HAWKESGEN_KEY: 'hg_test', SIGNUPS_PER_HOUR: '1000', PORTAL_PROJECT_PREFIX: 'ubeta_' },
  });
  children.push(child);
  const began = Date.now();
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/v1/health`)).ok && fs.existsSync(path.join(dir, 'roll.json'))) break; } catch {}
    assert.ok(Date.now() - began < 20_000, 'the cluster did not come up');
    await sleep(100);
  }
  return { port, dir, child, base: `http://127.0.0.1:${port}` };
}

async function account(base: string) {
  const r = await fetch(`${base}/v1/users/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `c${Date.now()}@example.com`, password: 'cluster-pass-1' }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  const g = await fetch(`${base}/v1/games`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ title: 'Cluster', template: 'blank' }) });
  const game: any = await g.json();
  assert.ok(game.id, JSON.stringify(game));
  return { cookie, game: game.id as string };
}

type Ev = { id?: string; event?: string; data?: string };
/** An editor stream that comes back by itself the way a browser does: after a close, with Last-Event-ID. */
function editor(base: string, cookie: string, game: string) {
  const seen: { event: string; data: any; id?: string }[] = [];
  const procs = new Set<string>();
  let last = '', stopped = false, reconnects = 0, req: http.ClientRequest | null = null;
  const connect = () => {
    if (stopped) return;
    let raw = '';
    req = http.get(`${base}/v1/games/${game}/live`, { headers: { Cookie: cookie, Accept: 'text/event-stream', ...(last ? { 'Last-Event-ID': last } : {}) }, agent: false }, (r) => {
      r.setEncoding('utf8');
      r.on('data', (chunk: string) => {
        raw += chunk;
        let i;
        while ((i = raw.indexOf('\n\n')) >= 0) {
          const block = raw.slice(0, i); raw = raw.slice(i + 2);
          const e: Ev = {};
          for (const line of block.split('\n')) { const m = /^(\w+): ?(.*)$/.exec(line); if (m) (e as any)[m[1]] = m[2]; }
          if (!e.event) continue;
          const data = e.data ? JSON.parse(e.data) : null;
          if (e.event === 'hello') procs.add(data.proc);
          if (e.id) last = e.id;
          seen.push({ event: e.event, data, id: e.id });
        }
      });
      r.on('close', () => { if (!stopped) { reconnects++; setTimeout(connect, 150); } });
    });
    req.on('error', () => { if (!stopped) { reconnects++; setTimeout(connect, 150); } });
  };
  connect();
  return { seen, procs, get reconnects() { return reconnects; }, stop() { stopped = true; req?.destroy(); },
    files: () => seen.filter((e) => e.event === 'file').map((e) => e.data.path as string),
    contents: () => seen.filter((e) => e.event === 'file').map((e) => e.data.content as string) };
}
const until = async (f: () => boolean, ms = 8000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await sleep(20); assert.ok(f(), 'timed out'); };
const save = (base: string, cookie: string, game: string, name: string, content = `// ${name}`) =>
  fetch(`${base}/v1/games/${game}/files`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ path: name, content }) });

test('two web processes: a change saved through one reaches editors on the other, once each', async () => {
  const c = await startCluster(2);
  const { cookie, game } = await account(c.base);
  const eds = Array.from({ length: 6 }, () => editor(c.base, cookie, game));
  try {
    await until(() => eds.every((e) => e.procs.size > 0));
    const procs = new Set(eds.flatMap((e) => [...e.procs]));
    assert.equal(procs.size, 2, `the editors are on ${[...procs].join(', ')}`);
    // Several saves, each through whichever process takes the request.
    for (let i = 0; i < 6; i++) assert.equal((await save(c.base, cookie, game, `s${i}.js`)).status, 200);
    await until(() => eds.every((e) => e.files().length >= 6));
    await sleep(300);
    for (const e of eds) assert.deepEqual([...e.files()].sort(), ['s0.js', 's1.js', 's2.js', 's3.js', 's4.js', 's5.js'], 'every save once on every stream');
    // Who has the editor open is the whole list, from either process.
    const last = [...eds[0].seen].reverse().find((e) => e.event === 'presence')!;
    assert.equal(last.data.length, 6);
    // A stream that comes back from the other process gets what it missed, once.
    const id = eds[0].seen.filter((e) => e.id).at(-1)!.id!;
    await save(c.base, cookie, game, 'later.js');
    const back = editor(c.base, cookie, game);
    back.stop();
    const again = await new Promise<string[]>((res) => {
      const got: string[] = [];
      const r = http.get(`${c.base}/v1/games/${game}/live`, { headers: { Cookie: cookie, 'Last-Event-ID': id }, agent: false }, (rs) => {
        rs.setEncoding('utf8'); let raw = '';
        rs.on('data', (ch: string) => { raw += ch; for (const m of raw.matchAll(/event: file\ndata: (.+)\n/g)) got.push(JSON.parse(m[1]).path); setTimeout(() => { r.destroy(); res([...new Set(got)]); }, 300); });
      });
    });
    assert.deepEqual(again, ['later.js']);
  } finally { for (const e of eds) e.stop(); c.child.kill('SIGTERM'); }
});

test('the assistant lock is one for every process', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-lock-'));
  const run = (code: string) => new Promise<string>((res, rej) => execFile(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', code], { cwd: ROOT, env: { ...process.env, PORTAL_DATA_DIR: dir } }, (e, so) => (e ? rej(e) : res(so.trim()))));
  const take = `import { lock, unlock, locked } from './src/shared.ts'; console.log(String(lock('thinking:g_1', 60000)));`;
  assert.equal(await run(take), 'true'); // (a process that took it and went away still holds it until it lets go or runs out)
  assert.equal(await run(take), 'false', 'a second process is refused');
  assert.equal(await run(`import { unlock, locked } from './src/shared.ts'; unlock('thinking:g_1'); console.log(String(locked('thinking:g_1')));`), 'true', 'only the holder lets go');
  assert.equal(await run(`import { lock } from './src/shared.ts'; console.log(String(lock('thinking:g_2', 60000)));`), 'true', 'another game is free');
  assert.equal(await run(`import { lock, unlock, locked } from './src/shared.ts'; lock('x', 1); await new Promise((r) => setTimeout(r, 20)); console.log(String(lock('x', 5000)));`), 'true', 'a lock that ran out is free');
  // And the generation limit is shared the same way.
  assert.equal(await run(`import { SharedLimiter } from './src/shared.ts'; const l = new SharedLimiter(2, 60000, 't'); console.log(String(l.hit('u')), String(l.hit('u')), String(l.hit('u')));`), 'true true false');
  assert.equal(await run(`import { SharedLimiter } from './src/shared.ts'; const l = new SharedLimiter(2, 60000, 't'); console.log(String(l.hit('u')));`), 'false', 'the next process sees the same window');
});

test('a rolling restart drops no request and no editor stream', async () => {
  const c = await startCluster(2);
  const { cookie, game } = await account(c.base);
  const eds = Array.from({ length: 4 }, () => editor(c.base, cookie, game));
  await until(() => eds.every((e) => e.procs.size > 0));
  let stop = false, requests = 0;
  const failures: string[] = [];
  const hammer = async () => {
    while (!stop) {
      try {
        const r = await fetch(`${c.base}/v1/health`, { headers: { Connection: 'close' }, signal: AbortSignal.timeout(5000) });
        if (!r.ok) failures.push(`health ${r.status}`);
        const p = await fetch(`${c.base}/v1/portfolio`, { signal: AbortSignal.timeout(5000) });
        if (p.status >= 500) failures.push(`portfolio ${p.status}`);
        await p.arrayBuffer();
      } catch (e: any) { failures.push(e.message); }
      requests++;
      await sleep(10);
    }
  };
  const hammers = [hammer(), hammer(), hammer()];
  let n = 0;
  const saves: string[] = [];
  const saver = (async () => { while (!stop) { const name = `// r${n++}`; const r = await save(c.base, cookie, game, 'edit.js', name).catch((e) => ({ status: 0, statusText: e.message })); if (r.status === 200) saves.push(name); else failures.push(`save ${r.status}`); await sleep(40); } })();
  try {
    await until(() => eds.every((e) => e.procs.size > 0));
    await sleep(300);
    fs.rmSync(path.join(c.dir, 'roll.json'));
    c.child.kill('SIGUSR2');
    await until(() => { try { return JSON.parse(fs.readFileSync(path.join(c.dir, 'roll.json'), 'utf8')).state === 'done'; } catch { return false; } }, 30_000);
    console.log('roll', fs.readFileSync(path.join(c.dir, 'roll.json'), 'utf8'), 'requests', requests);
    await sleep(500);
    stop = true;
    await Promise.all([...hammers, saver]);
    await sleep(500);
    assert.ok(requests > 20, `only ${requests} requests were made`);
    assert.deepEqual(failures, [], 'no request failed');
    assert.ok(eds.some((e) => e.reconnects > 0), 'the streams on the restarted processes came back');
    for (const e of eds) {
      const got = e.contents();
      assert.deepEqual(got.filter((f, i) => got.indexOf(f) !== i), [], 'nothing twice');
      assert.deepEqual(saves.filter((s) => !got.includes(s)), [], 'nothing missed');
    }
  } finally { stop = true; for (const e of eds) e.stop(); c.child.kill('SIGTERM'); }
});
