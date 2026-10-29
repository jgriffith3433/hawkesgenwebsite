// GET /v1/health/details (src/metrics.ts, what still makes sense on a function): admins only (404 to anyone else; a
// function has no "this machine" to trust). One function instance speaks for itself: its memory, CPU since it started
// and how long it has lived, plus what is true for everyone: how long Hawkes Gen and Hawkes Net take to answer now (asked
// while the request waits), and the jobs not yet settled. No event loop window, sockets, rooms, request counters or
// backups: those belonged to the box (a function keeps no state between requests; Firestore keeps its own backups).
import { db } from './store.ts';
import { genUrl, env } from './config.ts';
import { genFetch } from './gen.ts';
import { netUrl } from './hnet.ts';
import { adminFrom } from './accounts.ts';
import { route, send } from './http.ts';

const started = Date.now();

/** How long a GET takes (ms) and whether it answered 2xx. */
async function timed(get: () => Promise<Response>) {
  const at = performance.now();
  try {
    const r = await get();
    await r.arrayBuffer().catch(() => null);
    return { ok: r.ok, status: r.status, ms: Math.round(performance.now() - at) };
  } catch (e: any) {
    return { ok: false, error: e?.name === 'TimeoutError' ? 'timed out' : String(e?.message ?? e), ms: Math.round(performance.now() - at) };
  }
}

async function oldestUnsettled() {
  const open = db.collection('jobs').where('settled', '==', null);
  const [n, first] = await Promise.all([open.count().get(), open.orderBy('created').limit(1).get()]);
  const r = first.docs[0];
  return { open: n.data().count, oldest: r ? { id: r.id, tool: r.get('tool'), status: r.get('status'), ageSeconds: Math.round((Date.now() - Number(r.get('created'))) / 1000) } : null };
}

export async function details() {
  const mem = process.memoryUsage();
  const mb = (n: number) => Math.round((n / 1048576) * 10) / 10;
  const cpu = process.cpuUsage();
  const [gen, net, jobs] = await Promise.all([
    timed(() => genFetch('/v1/health', { signal: AbortSignal.timeout(8000) })),
    timed(() => fetch(`${netUrl()}/v1/net/status`, { signal: AbortSignal.timeout(8000) })),
    oldestUnsettled().catch((e: Error) => ({ error: e.message })),
  ]);
  return {
    ok: true,
    instance: {
      service: process.env.K_SERVICE ?? null, revision: process.env.K_REVISION ?? null, region: process.env.FUNCTION_REGION ?? env('FUNCTION_REGION') ?? null,
      uptimeSeconds: Math.round((Date.now() - started) / 1000),
      cpuSeconds: Math.round(((cpu.user + cpu.system) / 1e6) * 10) / 10,
    },
    memoryMB: { heapUsed: mb(mem.heapUsed), heapTotal: mb(mem.heapTotal), rss: mb(mem.rss) },
    gen: { url: genUrl(), ...gen },
    net: { url: netUrl(), ...net },
    jobs,
  };
}

route('GET', '/v1/health/details', async ({ req, res }) => {
  if (!(await adminFrom(req))) return send(res, 403, { error: 'Admins only', code: 'not_admin' });
  return details();
});
