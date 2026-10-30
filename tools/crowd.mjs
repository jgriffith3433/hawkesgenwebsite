#!/usr/bin/env node
// A load test with no browser: simulated players, page loads, editor streams and sign-ins against one portal, ramped up
// step by step, with the numbers that say how many one process holds. Local by default (it starts the portal itself, on a
// free port, with its own database and a stand-in for Hawkes Gen); a URL tests another portal (beta).
//
//   node tools/crowd.mjs                              25, 50, 100 players, 8 s each
//   node tools/crowd.mjs --levels 100,300,600,1000    the full local run (docs/performance.md "Server capacity")
//   node tools/crowd.mjs --url https://hawkesgenwebsite.hawkesgen.ai --cookie 'hawkes_session=...' --levels 50,100,200
//   options: --hold <s> per level (8)  --room 16 players per room  --pages 5 page/asset loads a second  --editors 6 live streams
//            --signins 3 sign-ins per level  --json (one JSON line)  --tiny (what npm test runs: 6 players, 1.5 s)
//            --web N  start the portal as a cluster of N web processes and a worker (PORTAL_ROLE=web), not one process
//            --roll   restart the cluster's processes one at a time (SIGUSR2) during the last level, saving files as it goes:
//                     no request may fail and every editor stream must come back with every save, once (needs --web, local)
//
// What a player sends is what a real one does (public/play/net.js, test/engine/netsim.ts): its pose ('me') every 66 ms
// inside a 'b' bundle, a ping every 2 s (a real page pings every 5 s: more samples), and one player in eight drives a
// thing it owns ('own', then 'xf' every 33 ms). It receives the room's bundles every 33 ms. The latency is the ping's
// round trip through the portal's event loop. A level counts as held when p99 stayed under 100 ms (pings and page loads),
// nobody was refused or reset, and this tool's own loop kept up (else the generator, not the portal, was the limit).
// Beta runs on the studio's control server next to Gen and Studio: never more than 200 players there.
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : (process.argv[i + 1] ?? true); };
const flag = (k) => process.argv.includes(`--${k}`);
const tiny = flag('tiny');
const levels = String(arg('levels', tiny ? '6' : '25,50,100')).split(',').map(Number).filter((n) => n > 0);
const holdS = Number(arg('hold', tiny ? 1.5 : 8));
const roomSize = Math.max(2, Math.min(30, Number(arg('room', 16))));
const pagesPerS = Number(arg('pages', tiny ? 4 : 5));
const editorCount = Number(arg('editors', tiny ? 3 : 6));
const signinsPer = Number(arg('signins', tiny ? 1 : 3));
const json = flag('json');
const webProcs = Number(arg('web', 0));
const roll = flag('roll');
if (roll && !webProcs) { console.error('--roll needs --web N'); process.exit(2); }
const cookie = arg('cookie', '');
const urlArg = arg('url', '');
const log = (...a) => { if (!json) console.log(...a); };

const maxN = Math.max(...levels);
if (urlArg && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(String(urlArg)) && maxN > 200) {
  console.error(`Not more than 200 players against ${urlArg}: beta shares the studio's control server with Gen and Studio.`);
  process.exit(2);
}

// ---------------------------------------------------------------- the portal under test
let child = null, stub = null, dataDir = null;
let base;
if (urlArg) base = new URL(String(urlArg));
else {
  const free = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  const port = await free();
  stub = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-crowd-'));
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.ts'], {
    cwd: ROOT, stdio: process.env.CROWD_LOG ? 'inherit' : ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, PORT: String(port), PORTAL_DATA_DIR: dataDir, HAWKESGEN_URL: `http://127.0.0.1:${stub.address().port}`, HAWKESGEN_KEY: 'hg_crowd', SIGNUPS_PER_HOUR: '100000', PORTAL_PROJECT_PREFIX: 'ubeta_', ...(webProcs ? { PORTAL_ROLE: 'web', PORTAL_WEB_PROCS: String(webProcs) } : {}) },
  });
  base = new URL(`http://127.0.0.1:${port}`);
  for (let i = 0; i < 200; i++) { try { if ((await fetch(new URL('/v1/health', base))).ok && (!webProcs || fs.existsSync(path.join(dataDir, 'roll.json')))) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
}
const secure = base.protocol === 'https:';
const local = !urlArg;
const stop = async () => { child?.kill('SIGTERM'); stub?.close(); if (dataDir) setTimeout(() => fs.rmSync(dataDir, { recursive: true, force: true }), 600).unref(); };

// ---------------------------------------------------------------- measuring
const pctl = (xs, p) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : 0);
const r1 = (n) => Math.round(n * 10) / 10;
let ipSeq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeIp = () => `11.${(++ipSeq >> 8) & 255}.${ipSeq & 255}.1`; // (the portal reads X-Forwarded-For from a local peer)
const authHeaders = () => ({ ...(cookie ? { Cookie: cookie } : {}), ...(local ? { 'X-Forwarded-For': fakeIp() } : {}) });

// The whole cluster's CPU and memory (Linux): the primary and everything below it.
const tree = (root) => { const kids = new Map(); for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; try { const f = fs.readFileSync(`/proc/${d}/stat`, 'utf8'); const after = f.slice(f.lastIndexOf(')') + 2).split(' '); const ppid = after[1]; (kids.get(ppid) ?? kids.set(ppid, []).get(ppid)).push(d); } catch {} } const out = [String(root)]; for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) ?? [])); return out; };
const treeUsage = () => { let ticks = 0, rss = 0; for (const p of tree(child.pid)) { try { const f = fs.readFileSync(`/proc/${p}/stat`, 'utf8').slice(0); const a = f.slice(f.lastIndexOf(')') + 2).split(' '); ticks += Number(a[11]) + Number(a[12]); rss += Number(a[21]) * 4096; } catch {} } return { cpu: ticks / 100, rssMB: rss / 1048576, procs: tree(child.pid).length }; };
let usageAt = null;
async function details(reset) {
  if (!local) return null; // (admins only elsewhere: the notes say how to read it by hand)
  try { return await (await fetch(new URL(`/v1/health/details${reset ? '?reset=1' : ''}`, base))).json(); } catch { return null; }
}

// Players live in worker threads (tools/crowd-worker.mjs): about 200 each, so the tool never measures itself.
const shards = Math.max(1, Math.min(os.cpus().length - 2, Math.ceil(maxN / 200)));
const pingEvery = tiny ? 12 : 60; // steps of 33 ms
const workers = await Promise.all(Array.from({ length: shards }, (_, shard) => new Promise((res) => {
  const w = new Worker(new URL('./crowd-worker.mjs', import.meta.url), { workerData: { base: base.href, local, cookie, roomSize, pingEvery, shard } });
  w.once('message', () => res(w));
})));
const ask = (cmd, extra = {}) => Promise.all(workers.map((w) => new Promise((res) => { w.once('message', res); w.postMessage({ cmd, shards, ...extra }); })));

// ---------------------------------------------------------------- pages, sign-ins, editor streams
const PAGES = ['/', '/play/sandbox', '/community', '/games', '/play/modules.js', '/play/runtime.js', '/play/WORLD.md', '/v1/portfolio', '/v1/health'];
async function pageLoads(until, out) {
  let n = 0;
  while (performance.now() < until) {
    const path_ = PAGES[n++ % PAGES.length], t0 = performance.now();
    const go = (async () => {
      try { const r = await fetch(new URL(path_, base), { headers: authHeaders() }); const b = await r.arrayBuffer(); out.bytes += b.byteLength; out.lat.push(performance.now() - t0); if (r.status >= 500 || r.status === 429 || r.status === 503) out.errors++; out.n++; }
      catch { out.errors++; out.n++; }
    })();
    out.inflight = go;
    await new Promise((r) => setTimeout(r, 1000 / pagesPerS));
  }
}
async function post(route, body, extra = {}) {
  const r = await fetch(new URL(route, base), { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(), ...extra }, body: JSON.stringify(body) });
  return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0], body: await r.json().catch(() => ({})) };
}
const accounts = [];
async function makeAccount() {
  const email = `crowd-${Date.now().toString(36)}-${accounts.length}@example.com`, password = 'crowd-test-pass-1';
  const r = await post('/v1/users/signup', { email, password });
  if (r.status !== 200 || !r.cookie) return null;
  const g = await fetch(new URL('/v1/games', base), { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: r.cookie, ...authHeaders() }, body: JSON.stringify({ title: 'Crowd', template: 'blank' }) });
  const game = await g.json().catch(() => ({}));
  const a = { email, password, cookie: r.cookie, game: game.id ?? game.game?.id ?? null };
  accounts.push(a);
  return a;
}
const streams = [];
/** An editor stream that comes back by itself with Last-Event-ID, as a browser does, and keeps the saves it saw. */
async function runStream(s) {
  let raw = '';
  while (!s.ctl.signal.aborted) {
    try {
      const r = await fetch(new URL(`/v1/games/${s.a.game}/live`, base), { headers: { Cookie: s.a.cookie, Accept: 'text/event-stream', ...(s.last ? { 'Last-Event-ID': s.last } : {}), ...authHeaders() }, signal: s.ctl.signal });
      s.ok = s.ok || r.ok; s.status = r.status;
      if (!r.ok || !r.body) { await sleep(300); continue; }
      raw = '';
      for await (const c of r.body) {
        s.bytes += c.length;
        raw += Buffer.from(c).toString('utf8');
        let i;
        while ((i = raw.indexOf('\n\n')) >= 0) {
          const block = raw.slice(0, i); raw = raw.slice(i + 2);
          const id = /^id: (.+)$/m.exec(block)?.[1];
          if (id) s.last = id;
          if (/^event: file$/m.test(block)) { try { s.got.push(JSON.parse(/^data: (.+)$/m.exec(block)[1]).content); } catch {} }
        }
      }
    } catch {}
    if (s.ctl.signal.aborted) return;
    s.reconnects++;
    await sleep(150);
  }
}
async function openStreams(want) {
  while (streams.length < want) {
    let a = accounts.find((x) => x.game && streams.filter((s) => s.a === x).length < 5);
    if (!a) a = await makeAccount();
    if (!a?.game) return;
    const s = { a, bytes: 0, ok: false, ctl: new AbortController(), last: '', got: [], reconnects: 0 };
    streams.push(s);
    void runStream(s);
  }
}
/** A rolling restart under way: saves go in every 150 ms while the cluster restarts its processes one at a time. */
async function rolling() {
  const a = streams[0].a, saved = [];
  const t0 = performance.now();
  let go = true, failures = 0, n = 0;
  const why = [];
  const saver = (async () => {
    while (go) {
      const content = `// roll ${n++}`;
      const r = await fetch(new URL(`/v1/games/${a.game}/files`, base), { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: a.cookie, ...authHeaders() }, body: JSON.stringify({ path: 'roll.js', content }) }).catch((e) => ({ status: 0, why: e.cause?.code ?? e.message }));
      if (r.status === 200) saved.push(content); else { failures++; why.push(r.status || r.why); }
      await sleep(150);
    }
  })();
  fs.rmSync(path.join(dataDir, 'roll.json'), { force: true });
  child.kill('SIGUSR2');
  let state = 'rolling';
  for (let i = 0; i < 600 && state === 'rolling'; i++) { await sleep(100); try { state = JSON.parse(fs.readFileSync(path.join(dataDir, 'roll.json'), 'utf8')).state; } catch {} }
  await sleep(1500);
  go = false;
  await saver;
  await sleep(1000);
  const mine = streams.filter((s) => s.a === a);
  const missed = mine.reduce((m, s) => m + saved.filter((c) => !s.got.includes(c)).length, 0);
  const twice = mine.reduce((m, s) => m + s.got.length - new Set(s.got).size, 0);
  return { state, ms: Math.round(performance.now() - t0), saves: saved.length, saveFailures: failures, saveFailureWhy: why, streamsWatched: mine.length, streamsMissedSaves: missed, streamsDuplicateSaves: twice, streamReconnects: streams.reduce((m, s) => m + s.reconnects, 0) };
}

// ---------------------------------------------------------------- the ramp
const results = [];
log(`crowd: ${base.origin} (${local ? 'started here' : 'as given'}), levels ${levels.join(', ')}, ${holdS} s each, rooms of ${roomSize}, ${pagesPerS} pages/s, ${editorCount} editor streams, ${shards} player thread${shards > 1 ? 's' : ''}`);
const baseline = await details(false);
let previous = 0, misses = 0;
for (const level of levels) {
  const t0 = performance.now();
  const grown = await (Promise.all(workers.map((w, k) => new Promise((res) => {
    w.once('message', res);
    w.postMessage({ cmd: 'grow', shards, count: Math.floor(level / shards) + (k < level % shards ? 1 : 0) });
  }))));
  const joinMs = performance.now() - t0;
  await openStreams(editorCount);
  const reset = await ask('reset'); // forget the joining
  await details(true);
  const pages = { n: 0, errors: 0, lat: [], bytes: 0 };
  const start = performance.now(), until = start + holdS * 1000;
  const sign = { lat: [], failed: 0 };
  const signer = (async () => { // a few sign-ins, spread over the hold
    const a = accounts[0] ?? (await makeAccount());
    for (let k = 0; k < signinsPer && a; k++) {
      await new Promise((r) => setTimeout(r, (holdS * 1000) / (signinsPer + 1)));
      const t = performance.now();
      const r = await post('/v1/users/login', { email: a.email, password: a.password }).catch(() => ({ status: 0 }));
      sign.lat.push(performance.now() - t);
      if (r.status !== 200) sign.failed++;
    }
  })();
  const rollJob = roll && level === levels.at(-1) ? sleep(Math.min(2000, holdS * 200)).then(rolling) : null;
  const cpu0 = webProcs ? treeUsage().cpu : 0;
  await pageLoads(until, pages);
  const rolled = rollJob ? await rollJob : null;
  await signer;
  await pages.inflight;
  const secs = (performance.now() - start) / 1000;
  const use = webProcs ? treeUsage() : null;
  const d = await details(false);
  const reports = await ask('report');
  const rtt = reports.flatMap((r) => r.rtt);
  const sum = (k) => reports.reduce((n, r) => n + r[k], 0);
  const open = sum('open');
  const resets = sum('resets') - reset.reduce((n, r) => n + r.resets, 0);
  const refusedAll = sum('refused');
  const row = {
    players: level, open, refused: refusedAll - previous, refusedStatuses: [...new Set(grown.flatMap((g) => g.statuses))], resets,
    joinSeconds: r1(joinMs / 1000), pingSamples: rtt.length, pingP50Ms: r1(pctl(rtt, 0.5)), pingP99Ms: r1(pctl(rtt, 0.99)), pingMaxMs: r1(Math.max(0, ...rtt)),
    pageLoads: pages.n, pageErrors: pages.errors, pageP50Ms: r1(pctl(pages.lat, 0.5)), pageP99Ms: r1(pctl(pages.lat, 0.99)),
    signinP99Ms: r1(pctl(sign.lat, 0.99)), signinFailed: sign.failed,
    editorStreams: streams.filter((s) => s.ok).length, editorStreamsAsked: streams.length,
    serverLoopP50Ms: d?.eventLoopMs?.p50 ?? null, serverLoopP99Ms: d?.eventLoopMs?.p99 ?? null, serverLoopMaxMs: d?.eventLoopMs?.max ?? null,
    serverCpuPercent: use ? Math.round(((use.cpu - cpu0) / secs) * 1000) / 10 : d?.cpuPercent ?? null, serverRssMB: use ? Math.round(use.rssMB) : d?.memoryMB?.rss ?? null, serverHeapMB: d?.memoryMB?.heapUsed ?? null,
    kbPerPlayerPerSecDown: open ? r1(sum('rx') / open / secs / 1024) : 0,
    kbPerPlayerPerSecUp: open ? r1(sum('tx') / open / secs / 1024) : 0,
    generatorLoopP99Ms: Math.max(...reports.map((r) => r.loopP99)),
    ...(webProcs ? { webProcesses: webProcs, serverProcessesRunning: use.procs, playerReconnects: sum('restarts') } : {}),
    ...(rolled ? { roll: rolled } : {}),
  };
  previous = refusedAll;
  row.rssKBPerPlayer = !webProcs && row.serverRssMB != null && baseline && level ? Math.round(((row.serverRssMB - baseline.memoryMB.rss) * 1024) / level) : null; // (growth over the idle process, per player)
  row.generatorSaturated = row.generatorLoopP99Ms > 50;
  row.rollClean = rolled ? rolled.state === 'done' && rolled.saveFailures === 0 && rolled.streamsMissedSaves === 0 && rolled.streamsDuplicateSaves === 0 && row.pageErrors === 0 : null;
  row.held = (row.rollClean !== false) && row.pingP99Ms < 100 && row.pageP99Ms < 100 && row.refused === 0 && resets === 0 && row.open === level && !row.generatorSaturated;
  results.push(row);
  log(`  ${String(level).padStart(5)} players: ping p50 ${row.pingP50Ms} / p99 ${row.pingP99Ms} ms, pages p99 ${row.pageP99Ms} ms, refused ${row.refused}, resets ${row.resets}, server loop p99 ${row.serverLoopP99Ms ?? '-'} ms, cpu ${row.serverCpuPercent ?? '-'}%, rss ${row.serverRssMB ?? '-'} MB, ${row.kbPerPlayerPerSecDown} KB/s down ${row.kbPerPlayerPerSecUp} up per player${row.generatorSaturated ? '  [generator saturated]' : ''} -> ${row.held ? 'held' : 'NOT held'}`);
  if (rolled) log(`        rolling restart: ${rolled.state} in ${rolled.ms} ms, ${rolled.saves} saves (${rolled.saveFailures} failed), ${rolled.streamsWatched} streams saw every save once: ${rolled.streamsMissedSaves === 0 && rolled.streamsDuplicateSaves === 0 ? 'yes' : `NO (${rolled.streamsMissedSaves} missed, ${rolled.streamsDuplicateSaves} twice)`}, ${rolled.streamReconnects} stream reconnects, ${row.playerReconnects} player reconnects, page errors ${row.pageErrors}`);
  misses = row.held ? 0 : misses + 1;
  if (misses >= 2 || row.refused || (resets && !webProcs)) break; // more would only repeat it
}
const heldLevels = results.filter((r) => r.held).map((r) => r.players);
const report = {
  target: base.origin, local, webProcesses: webProcs || 1, node: process.version, cores: os.cpus().length, playerThreads: shards, at: new Date().toISOString(),
  levels: results, largestHeld: heldLevels.length ? Math.max(...heldLevels) : 0,
  note: 'largestHeld is the largest level where ping and page p99 stayed under 100 ms with nobody refused or reset and the generator keeping up.',
};
for (const s of streams) s.ctl.abort();
await Promise.all(workers.map((w) => w.terminate()));
if (json) console.log(JSON.stringify(report));
else log(`\nlargest N that kept p99 under 100 ms: ${report.largestHeld} players (${report.cores} cores, node ${report.node})`);
await stop();
process.exit(0);
