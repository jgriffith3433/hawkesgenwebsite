// Paying for Gen jobs: quote (Gen prices it), take the credits, send the job to Gen as the customer, and settle it when
// Gen says how it ended (done: kept; failed or cancelled: given back). There is no process that lives between requests,
// so jobs settle when anyone asks about them (the pass-through, /v1/run) and a scheduled sweep catches the rest.
import { onSchedule } from 'firebase-functions/scheduler';
import { db } from './store.ts';
import { gen, genFetch } from './gen.ts';
import { hold, attach, release, releaseIn, releaseOrphanHolds } from './billing.ts';
import { requireCaller, type Via } from './caller.ts';
import type { User } from './accounts.ts';
import { PortalError, route, send } from './http.ts';
import { SECRETS } from './config.ts';

const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const SPEC_FIELDS = ['tool', 'preset', 'params', 'inputs', 'labels', 'key', 'reuse'];
type GenJob = { id: string; tool: string; status: string; error?: string; [k: string]: unknown };
const jobs = () => db.collection('jobs');

export async function quote(user: User, spec: any) {
  const q = await gen('/v1/billing/quote', { as: user.project, body: { tool: spec.tool, preset: spec.preset, params: spec.params ?? {}, count: spec.count } });
  return { ...q, userCredits: user.credits, canAfford: user.credits >= q.credits };
}

/** What a connection or key has started in the last 24 hours (failed and cancelled jobs don't count). */
export async function spentToday(viaId: string) {
  const s = await jobs().where('via', '==', viaId).where('created', '>=', Date.now() - 24 * 3600_000).get();
  return s.docs.filter((d) => !['failed', 'cancelled'].includes(d.get('status'))).reduce((n, d) => n + Number(d.get('credits') ?? 0), 0);
}

/** Submits each spec in turn. A spec Gen refuses gets its credits back and stops the batch with Gen's reason.
 *  `minCredits`: a floor on the price (the game assistant's messages cost at least this). */
export async function submit(user: User, specs: any[], via?: Via, opts: { minCredits?: number } = {}): Promise<GenJob[]> {
  if (!specs.length || specs.length > 20) throw new PortalError('Send 1 to 20 jobs');
  const out: GenJob[] = [];
  for (const raw of specs) {
    if (!raw || typeof raw !== 'object') throw new PortalError('Each job is { tool, params, inputs }');
    const spec = Object.fromEntries(SPEC_FIELDS.filter((k) => raw[k] !== undefined).map((k) => [k, raw[k]]));
    const q = await quote(user, raw);
    if (opts.minCredits && q.credits < opts.minCredits) q.credits = opts.minCredits;
    if (via?.cap != null) {
      const spent = await spentToday(via.id);
      if (spent + q.credits > via.cap) throw new PortalError(`${via.name ?? 'This connection'} has a daily limit of ${via.cap} credits and has used ${spent} today; this needs ${q.credits}. Raise the limit at hawkesgen.ai/connect.`, { status: 402 });
    }
    const holdId = await hold(user.id, q.credits, `${q.credits} credits for ${q.tool}`);
    let job: GenJob;
    try {
      job = (await gen<{ jobs: GenJob[] }>('/v1/jobs', { as: user.project, body: spec })).jobs[0];
    } catch (e: any) {
      await release(holdId, `Not started: ${e.message}`);
      throw e;
    }
    // Gen hands back a job it already has (same key, or found in the library): no second charge.
    if ((await jobs().doc(job.id).get()).exists || (job.status === 'done' && spec.reuse)) {
      await release(holdId, 'Already made: no charge');
    } else {
      await attach(holdId, job.id);
      await jobs().doc(job.id).create({ user_id: user.id, tool: job.tool, credits: q.credits, status: job.status, created: Date.now(), via: via?.id ?? null, hold: holdId, settled: null });
      await settle(job);
    }
    out.push(job);
  }
  return out;
}

/** Records how a job stands; at its end, keeps the credits (done) or gives them back (failed, cancelled). Once. */
// The job's end and its refund are one transaction: a function stopped between them can't leave a failed job settled
// with its credits kept.
export async function settle(job: { id: string; status: string; error?: string }) {
  const ref = jobs().doc(job.id);
  await db.runTransaction(async (t) => {
    const row = await t.get(ref);
    if (!row.exists || row.get('settled')) return;
    if (!TERMINAL.has(job.status)) {
      if (row.get('status') !== job.status) t.update(ref, { status: job.status });
      return;
    }
    const holdId = row.get('hold') as string | null;
    if (holdId && job.status !== 'done') await releaseIn(t, holdId, job.status === 'cancelled' ? 'Cancelled: credits returned' : `Failed: credits returned${job.error ? ` (${String(job.error).slice(0, 120)})` : ''}`);
    t.update(ref, { status: job.status, settled: Date.now() });
  });
}

/** Asks Gen about every unsettled job. One Gen no longer knows, after an hour, is given back. */
export async function sweep() {
  const open = await jobs().where('settled', '==', null).limit(500).get();
  for (const d of open.docs) {
    const r = await genFetch(`/v1/jobs/${d.id}`).catch(() => null);
    if (r?.ok) await settle(await r.json());
    else if (r?.status === 404 && Date.now() - Number(d.get('created')) > 3600_000) await settle({ id: d.id, status: 'failed', error: 'lost by the backend' });
  }
  await releaseOrphanHolds().catch((e) => console.error('[portal] orphan holds:', e));
  return open.size;
}

export const settleJobs = onSchedule({ region: 'us-east4', schedule: 'every 2 minutes', secrets: [SECRETS.genKey], timeoutSeconds: 240 }, async () => { await sweep(); });

// ------------------------------------------------------------ routes

route('POST', '/v1/billing/quote', async ({ req }) => quote((await requireCaller(req)).user, req.body ?? {}));
route('POST', '/v1/jobs', async ({ req }) => {
  const c = await requireCaller(req);
  const body: any = req.body ?? {};
  return { jobs: await submit(c.user, Array.isArray(body.jobs) ? body.jobs : [body], c.via) };
});
// Submit and wait (up to `timeout` seconds, default 10 minutes; a function answers within its own timeout).
route('POST', '/v1/run', async ({ req, res }) => {
  const c = await requireCaller(req);
  const body: any = req.body ?? {};
  let gone = false;
  res.on('close', () => { gone = true; });
  let [job] = await submit(c.user, [body], c.via);
  const until = Date.now() + Math.max(1, Math.min(280, Number(body.timeout) || 280)) * 1000;
  while (!TERMINAL.has(job.status) && Date.now() < until && !gone) {
    await new Promise((r) => setTimeout(r, 2000));
    job = await gen(`/v1/jobs/${job.id}`, { as: c.user.project });
  }
  await settle(job);
  return job;
});

// Gen routes a signed-in customer may use as they are (Gen scopes them to the customer's project).
const PASS_GET = [/^\/v1\/jobs$/, /^\/v1\/jobs\/(j_[0-9a-f]+)$/, /^\/v1\/assets$/, /^\/v1\/assets\/a_[0-9a-f]+(\/file)?$/, /^\/v1\/files\/a_[0-9a-f]+$/, /^\/v1\/presets$/, /^\/v1\/tools(\/[\w.-]+)?$/, /^\/v1\/motions$/, /^\/v1\/providers\/elevenlabs\/voices$/, /^\/v1\/entities$/];
const PASS_POST = [/^\/v1\/jobs\/j_[0-9a-f]+\/cancel$/, /^\/v1\/recipes\/check$/];
const UPLOAD = /^\/v1\/(assets|blobs)$/;
const UPLOAD_LIMIT = 30 * 1024 * 1024; // a function takes at most 32 MB; bigger files go through /v1/uploads links

async function relay(gr: Response, res: any) {
  const headers: Record<string, string> = {};
  for (const h of ['content-type', 'content-length', 'content-disposition', 'cache-control', 'etag', 'last-modified', 'accept-ranges', 'content-range']) {
    const v = gr.headers.get(h);
    if (v) headers[h] = v;
  }
  res.status(gr.status).set(headers);
  if (!gr.body) return void res.end();
  res.end(Buffer.from(await gr.arrayBuffer()));
}

for (const re of PASS_GET) {
  route('GET', re, async ({ req, res, route: path, url }) => {
    const c = await requireCaller(req);
    const gr = await genFetch(`${path}${url.search}`, { as: c.user.project, headers: req.headers.range ? { Range: String(req.headers.range) } : {}, signal: AbortSignal.timeout(120_000) });
    if (path === '/v1/assets' && gr.ok) {
      const list: any = await gr.json();
      if (Array.isArray(list?.items)) list.items = list.items.filter((a: any) => !(a?.labels?.lod !== undefined && a?.labels?.of));
      return send(res, 200, list);
    }
    // A job the customer looks at settles here if it has ended.
    if (/^\/v1\/jobs\/j_/.test(path) && gr.ok) {
      const job: any = await gr.json();
      await settle(job);
      return send(res, 200, job);
    }
    return relay(gr, res);
  });
}
for (const re of PASS_POST) {
  route('POST', re, async ({ req, res, route: path, url }) => {
    const c = await requireCaller(req);
    return relay(await genFetch(`${path}${url.search}`, { as: c.user.project, method: 'POST', body: req.body ?? {}, signal: AbortSignal.timeout(120_000) }), res);
  });
}
route('POST', UPLOAD, async ({ req, res, route: path, url }) => {
  const c = await requireCaller(req);
  if ((req.rawBody?.length ?? 0) > UPLOAD_LIMIT) throw new PortalError('Files over 30 MB: ask for an upload link (POST /v1/uploads)', { status: 413 });
  const headers: Record<string, string> = {};
  for (const h of ['content-type', 'x-filename']) if (req.headers[h]) headers[h] = String(req.headers[h]);
  url.searchParams.set('project', c.user.project);
  return relay(await genFetch(`${path}?${url.searchParams}`, { as: c.user.project, method: 'POST', rawBody: new Uint8Array(req.rawBody), headers, signal: AbortSignal.timeout(280_000) }), res);
});

// The customer's job feed: Gen's own stream narrowed to their project, for up to ~4.5 minutes (a function's answer has an
// end; the page's EventSource opens it again). Reached at the function's direct address through a stream link.
route('GET', '/v1/events', async ({ req, res }) => {
  const c = await requireCaller(req);
  const ctrl = new AbortController();
  const stop = setTimeout(() => ctrl.abort(), 270_000);
  req.on('close', () => ctrl.abort());
  try {
    const gr = await genFetch('/v1/events', { as: c.user.project, signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
    res.status(gr.status).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    if (!gr.body) return void res.end();
    const reader = gr.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch { /* the page left, or the time is up */ } finally {
    clearTimeout(stop);
    if (!res.writableEnded) res.end();
  }
});
