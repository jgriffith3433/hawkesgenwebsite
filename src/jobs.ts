// Paying for Gen jobs: quote (Gen prices it), take the credits, send the job to Gen as the customer, and settle it
// when Gen says how it ended (done: kept; failed or cancelled: given back). Gen's event stream settles jobs as they end;
// a sweep on start, on every reconnect and every few minutes catches any the stream missed.
import { db } from './db.ts';
import { gen, genFetch } from './gen.ts';
import { hold, attach, refund } from './billing.ts';
import type { User } from './users.ts';
import type { Via } from './oauth.ts';
import { PortalError } from './util.ts';

const TERMINAL = new Set(['done', 'failed', 'cancelled']);
// What a customer may say about a job; the project is theirs (Gen narrows the key) and priority is Gen's to set.
const SPEC_FIELDS = ['tool', 'preset', 'params', 'inputs', 'labels', 'key', 'reuse'];

export async function quote(user: User, spec: any) {
  const q = await gen('/v1/billing/quote', { as: user.project, body: { tool: spec.tool, preset: spec.preset, params: spec.params ?? {}, count: spec.count } });
  return { ...q, userCredits: user.credits, canAfford: user.credits >= q.credits };
}

type GenJob = { id: string; tool: string; status: string; error?: string; [k: string]: unknown };

/** Submits each spec in turn. A spec Gen refuses gets its credits back and stops the batch with Gen's reason. */
/** What a connection or key has started in the last 24 hours (failed and cancelled jobs don't count). */
export const spentToday = (viaId: string) => Number((db.prepare("SELECT COALESCE(SUM(credits), 0) AS n FROM jobs WHERE via = ? AND created >= ? AND status NOT IN ('failed', 'cancelled')").get(viaId, Date.now() - 24 * 3600_000) as { n: number }).n);

/** `minCredits`: a floor on the price (the game assistant's messages cost at least this, whatever Gen quotes). */
export async function submit(user: User, specs: any[], via?: Via, opts: { minCredits?: number } = {}): Promise<GenJob[]> {
  if (!specs.length || specs.length > 20) throw new PortalError('Send 1 to 20 jobs');
  const out: GenJob[] = [];
  for (const raw of specs) {
    if (!raw || typeof raw !== 'object') throw new PortalError('Each job is { tool, params, inputs }');
    const spec = Object.fromEntries(SPEC_FIELDS.filter((k) => raw[k] !== undefined).map((k) => [k, raw[k]]));
    const q = await quote(user, raw);
    if (opts.minCredits && q.credits < opts.minCredits) q.credits = opts.minCredits;
    if (via?.cap != null && spentToday(via.id) + q.credits > via.cap) {
      throw new PortalError(`${via.name ?? 'This connection'} has a daily limit of ${via.cap} credits and has used ${spentToday(via.id)} today; this needs ${q.credits}. Raise the limit at hawkesgen.ai/connect.`, { status: 402 });
    }
    const holdId = hold(user.id, q.credits, `${q.credits} credits for ${q.tool}`);
    let job: GenJob;
    try {
      job = (await gen<{ jobs: GenJob[] }>('/v1/jobs', { as: user.project, body: spec })).jobs[0];
    } catch (e: any) {
      refund(holdId, `Not started: ${e.message}`);
      throw e;
    }
    // Gen hands back a job it already has (same key, or found in the library): no second charge.
    if (db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(job.id) || (job.status === 'done' && spec.reuse)) {
      refund(holdId, 'Already made: no charge');
    } else {
      attach(holdId, job.id);
      db.prepare('INSERT INTO jobs (id, user_id, tool, credits, status, created, via) VALUES (?, ?, ?, ?, ?, ?, ?)').run(job.id, user.id, job.tool, q.credits, job.status, Date.now(), via?.id ?? null);
      settle(job);
    }
    out.push(job);
  }
  return out;
}

/** Records how a job stands; at its end, keeps the credits (done) or gives them back (failed, cancelled). */
export function settle(job: { id: string; status: string; error?: string }) {
  const row = db.prepare('SELECT status, settled FROM jobs WHERE id = ?').get(job.id) as { status: string; settled: number | null } | undefined;
  if (!row || row.settled) return;
  if (!TERMINAL.has(job.status)) {
    if (row.status !== job.status) db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(job.status, job.id);
    return;
  }
  if (job.status !== 'done') refund(job.id, job.status === 'cancelled' ? 'Cancelled: credits returned' : `Failed: credits returned${job.error ? ` (${String(job.error).slice(0, 120)})` : ''}`);
  db.prepare('UPDATE jobs SET status = ?, settled = ? WHERE id = ?').run(job.status, Date.now(), job.id);
}

/** Asks Gen about every unsettled job. One Gen no longer knows, after an hour, is given back. */
export async function sweep() {
  const open = db.prepare('SELECT id, created FROM jobs WHERE settled IS NULL').all() as { id: string; created: number }[];
  for (const j of open) {
    const r = await genFetch(`/v1/jobs/${j.id}`).catch(() => null);
    if (r?.ok) settle(await r.json());
    else if (r?.status === 404 && Date.now() - j.created > 3600_000) settle({ id: j.id, status: 'failed', error: 'lost by the backend' });
  }
}

/** Follows Gen's event stream (every customer's jobs) for as long as the process runs. */
export function watch({ sweepEveryMs = 5 * 60_000 } = {}) {
  let stopped = false;
  let backoff = 2_000;
  const ctrl = new AbortController();
  const loop = async () => {
    while (!stopped) {
      try {
        const r = await genFetch('/v1/events', { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
        if (!r.ok || !r.body) throw new Error(`events answered ${r.status}`);
        backoff = 2_000;
        void sweep().catch(() => {});
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const event = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (event === 'job' && data) {
              try {
                settle(JSON.parse(data));
              } catch {}
            }
          }
        }
      } catch (e: any) {
        if (stopped) return;
        console.warn(`[portal] Gen events: ${e.message}; again in ${backoff / 1000}s`);
      }
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(60_000, backoff * 2);
    }
  };
  void loop();
  const timer = setInterval(() => void sweep().catch(() => {}), sweepEveryMs);
  return () => {
    stopped = true;
    clearInterval(timer);
    ctrl.abort();
  };
}
