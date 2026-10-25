// The cluster primary (PORTAL_ROLE=web): keeps PORTAL_WEB_PROCS web processes (default: the CPU count) sharing the
// portal's port, and exactly one worker (PORTAL_ROLE=worker: every background loop, and the bus the web processes
// share, src/bus.ts). It serves nothing itself. SIGUSR2 (systemctl reload) restarts the children one at a time on the
// code now on disk: a new web process is up and answering before the old one is asked to leave (it finishes the
// requests it has, ends its editor streams cleanly so the browsers come back with Last-Event-ID, and exits), the
// worker last. `.data/roll.json` says how it went. Web processes keep game rooms by the hash of the room, so the
// primary also passes sockets between them (a room's players must all be on one process).
import cluster, { type Worker } from 'node:cluster';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { envInt } from './util.ts';
import { busPath } from './proc.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function runPrimary({ port, dataDir }: { port: number; dataDir: string }) {
  const n = envInt((k) => process.env[k], 'PORTAL_WEB_PROCS', os.availableParallelism());
  const bus = busPath(dataDir);
  const common = { PORTAL_CLUSTER: '1', PORTAL_PROCS: String(n), PORTAL_BUS: bus };
  const slots: (Worker | undefined)[] = Array.from({ length: n });
  let worker: Worker | undefined;
  const retiring = new Set<Worker>();
  let stopping = false, rolling = false;
  const say = (...a: unknown[]) => console.log('[portal]', ...a);
  const status = (state: string, extra: Record<string, unknown> = {}) => { try { fs.writeFileSync(path.join(dataDir, 'roll.json'), JSON.stringify({ state, at: Date.now(), ...extra })); } catch {} };

  const forkWorker = () => {
    const w = cluster.fork({ ...common, PORTAL_ROLE: 'worker' });
    w.process.stdout?.setEncoding?.('utf8');
    worker = w;
    return new Promise<Worker>((res, rej) => {
      const done = (m: any) => { if (m?.t === 'ready') { w.off('message', done); res(w); } };
      w.on('message', done);
      w.once('exit', () => rej(new Error('the worker exited while starting')));
    });
  };
  const forkWeb = (i: number) => {
    const w = cluster.fork({ ...common, PORTAL_ROLE: 'web', PORTAL_WEB_INDEX: String(i) });
    return new Promise<Worker>((res, rej) => {
      w.once('listening', () => res(w));
      w.once('exit', () => rej(new Error(`web process ${i} exited while starting`)));
    });
  };
  const exited = (w: Worker, ms: number) => new Promise<void>((res) => {
    if (w.isDead()) return res();
    const t = setTimeout(() => { try { w.process.kill('SIGKILL'); } catch {} res(); }, ms);
    w.once('exit', () => { clearTimeout(t); res(); });
  });
  const retire = async (w: Worker, how: 'disconnect' | 'kill') => {
    retiring.add(w);
    // (Not worker.disconnect(): that waits for every connection to end before the child hears of it. The child is told to
    // leave; closing its server takes it out of the primary's round robin, and a connection already on its way is passed on.)
    if (how === 'disconnect') w.send({ t: 'leave' }); else w.process.kill('SIGTERM');
    await exited(w, 12_000);
    retiring.delete(w);
  };
  /** The portal answers (through the shared port) five times running. */
  const healthy = async () => {
    for (let ok = 0, tries = 0; ok < 5; tries++) {
      if (tries > 40) return false;
      try { if ((await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(3000) })).ok) ok++; else ok = 0; } catch { ok = 0; }
      await sleep(100);
    }
    return true;
  };

  // A child that dies unasked comes back in its own slot.
  cluster.on('exit', (w, code, signal) => {
    if (stopping || retiring.has(w)) return;
    say(`a ${w === worker ? 'worker' : 'web'} process exited (${signal ?? code}); starting another`);
    setTimeout(() => {
      if (stopping) return;
      if (w === worker) void forkWorker().catch((e) => say(e.message));
      else { const i = slots.indexOf(w); if (i >= 0) void forkWeb(i).then((nw) => { slots[i] = nw; }).catch((e) => say(e.message)); }
    }, 500);
  });
  // A game room is kept by one web process: a socket that arrived at another is handed to it.
  cluster.on('message', (_from, m: any, handle: any) => {
    if (m?.t !== 'ws-handoff') return;
    const target = slots[m.to];
    if (!target || !handle) return void handle?.destroy?.();
    target.send(m, handle);
  });

  async function roll() {
    if (rolling || stopping) return;
    rolling = true;
    status('rolling');
    const t0 = Date.now();
    try {
      for (let i = 0; i < n; i++) {
        const old = slots[i];
        const nw = await forkWeb(i);
        say(`web process ${i}: new one listening after ${Date.now() - t0} ms`);
        if (!(await healthy())) { retiring.add(nw); nw.process.kill('SIGTERM'); throw new Error(`the new web process ${i} did not answer`); }
        slots[i] = nw;
        say(`web process ${i}: new one answers after ${Date.now() - t0} ms`);
        if (old) await retire(old, 'disconnect');
        say(`web process ${i} restarted`);
      }
      // The worker last: the old one stops its loops before the new one starts them.
      if (worker) await retire(worker, 'kill');
      await forkWorker();
      say(`restarted ${n} web process${n === 1 ? '' : 'es'} and the worker in ${Math.round((Date.now() - t0) / 100) / 10} s`);
      status('done', { ms: Date.now() - t0 });
    } catch (e: any) {
      say(`rolling restart stopped: ${e.message}`);
      status('failed', { error: e.message });
    } finally { rolling = false; }
  }

  async function start() {
    say(`cluster: ${n} web process${n === 1 ? '' : 'es'} and a worker on http://127.0.0.1:${port}`);
    await forkWorker();
    await Promise.all(slots.map(async (_, i) => { slots[i] = await forkWeb(i); }));
    status('done', { ms: 0 });
  }

  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const w of Object.values(cluster.workers ?? {})) try { w?.process.kill('SIGTERM'); } catch {}
    const t = setInterval(() => { if (!Object.values(cluster.workers ?? {}).some((w) => w && !w.isDead())) process.exit(0); }, 100);
    t.unref();
    setTimeout(() => process.exit(0), 12_000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('SIGUSR2', () => void roll());
  process.on('uncaughtException', (e) => console.error('[portal] primary:', e));
  void start().catch((e) => { console.error('[portal] could not start:', e.message); stop(); });
}
