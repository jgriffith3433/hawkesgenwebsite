// Tasks: one thing a customer asked for, as a chain of Gen jobs ("cut out, put on green, animate, make a sprite sheet").
// Each step is a job paid like any other (jobs.ts submit, with the connection's limit); its inputs can be the outputs of
// earlier steps. Kept in Firestore `tasks/{task_...}`. No process lives between requests, so a task moves on when
// someone asks about it (GET /v1/tasks, /v1/tasks/<id>, MCP get_task and the tool call that started it) and from the
// scheduled `advanceTasks` (every minute). `advance` holds a short lease on the task so two of them never submit the same
// step twice. `steps` and `outputs` are kept as JSON text, as the SQLite columns were (outputs is a list of lists, which
// Firestore can't hold as such).
import { onSchedule } from 'firebase-functions/scheduler';
import { db } from './store.ts';
import { gen } from './gen.ts';
import { submit, settle } from './jobs.ts';
import { getUser, requireUser, type User } from './accounts.ts';
import type { Via } from './caller.ts';
import { SECRETS } from './config.ts';
import { id, PortalError, route } from './http.ts';

/** An input: an asset ref ("asset:a_..."), or the outputs of an earlier step (`pick`: which, by kind or position). */
export type Ref = string | { from: number; pick?: 'first' | 'last' | 'all' | number; kind?: string };
export type Step = { tool: string; title: string; params?: Record<string, unknown>; inputs?: Record<string, Ref | Ref[] | undefined>; keep?: boolean };
export type Output = { asset: string; kind: string; mime: string; title?: string; step: number };
export type Task = { id: string; user_id: string; via: Via | null; name: string; steps: Step[]; state: 'running' | 'done' | 'failed' | 'cancelled'; step: number; jobs: string[]; outputs: Output[][]; detail: string | null; error: string | null; credits: number; created: number; updated: number; stepStarted?: number };

const tasks = () => db.collection('tasks');
const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const LEASE_MS = 90_000;

const parse = (v: unknown, d: any) => { try { return typeof v === 'string' ? JSON.parse(v) : (v ?? d); } catch { return d; } };
function row(s: FirebaseFirestore.DocumentSnapshot): Task | null {
  if (!s.exists) return null;
  const r = s.data()!;
  // The running step's own share (from Gen's "45%"), for progressOf: not enumerable, so answers stay as they were.
  return Object.defineProperty({
    id: s.id, user_id: r.user_id, via: r.via ?? null, name: r.name, steps: parse(r.steps, []), state: r.state, step: Number(r.step ?? 0),
    jobs: (r.jobs ?? []).map((j: string | null) => j || undefined) as string[], outputs: parse(r.outputs, []), detail: r.detail ?? null, error: r.error ?? null,
    credits: Number(r.credits ?? 0), created: r.created, updated: r.updated, stepStarted: r.step_started ?? r.created,
  } as Task, 'fraction', { value: r.step_fraction ?? null, enumerable: false });
}

export async function getTask(taskId: string, userId?: string) {
  if (!/^task_[0-9a-f]+$/.test(taskId)) return null;
  const t = row(await tasks().doc(taskId).get());
  return t && (!userId || t.user_id === userId) ? t : null;
}

/** Writes a task's changes, unless it stopped meanwhile (cancelled by its owner): then the stored state wins. */
async function save(t: Task, patch: Partial<Task> & { fraction?: number | null }) {
  const { fraction, ...rest } = patch;
  Object.assign(t, rest, { updated: Date.now() });
  const fields: Record<string, unknown> = { state: t.state, step: t.step, jobs: t.jobs.map((j) => j ?? null), outputs: JSON.stringify(t.outputs), detail: t.detail, error: t.error, credits: t.credits, updated: t.updated, step_started: t.stepStarted ?? t.created };
  if (fraction !== undefined) fields.step_fraction = fraction;
  const ref = tasks().doc(t.id);
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (cur.get('state') !== 'running' && t.state === 'running') { t.state = cur.get('state'); return; }
    if (cur.get('state') !== 'running' && cur.get('state') !== t.state) { t.state = cur.get('state'); return; }
    tx.update(ref, fields);
  });
}

/** How far along a task is, 0-1: its finished steps, plus the running one's share. Inside a step: what Gen's job says
 *  ("12/30", "45%") when it says, else time (a step creeps toward 85% of its share and never claims more until it's
 *  done). Waiting in line counts as just begun. */
export function progressOf(t: Task & { fraction?: number | null }): number {
  if (t.state === 'done') return 1;
  const n = Math.max(1, t.steps.length);
  if (t.state !== 'running') return Math.min(1, t.step / n);
  let f = t.fraction ?? undefined;
  if (f === undefined) {
    const s = (Date.now() - (t.stepStarted ?? t.created)) / 1000;
    f = /in line|queued|starting/.test(t.detail ?? '') ? 0.02 : 0.85 * (1 - Math.exp(-s / 45));
  }
  return Math.max(0, Math.min(0.99, (t.step + Math.min(0.95, f)) / n));
}
/** A job's own progress from its words, when it has any: "45%", "step 12/30". */
function fraction(detail: unknown): number | undefined {
  const d = String(detail ?? '');
  const pc = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(d);
  if (pc) return Math.min(1, Number(pc[1]) / 100);
  const of = /(\d+)\s*\/\s*(\d+)/.exec(d);
  if (of && Number(of[2]) > 0) return Math.min(1, Number(of[1]) / Number(of[2]));
  return undefined;
}

/** What the customer keeps: the steps marked keep, else the last step's outputs. */
export function results(t: Task): Output[] {
  const kept = t.steps.flatMap((s, i) => (s.keep ? t.outputs[i] ?? [] : []));
  return kept.length ? kept : t.outputs[t.steps.length - 1] ?? [];
}

function resolve(t: Task, ref: Ref | Ref[]): string | string[] {
  if (Array.isArray(ref)) return ref.flatMap((r) => resolve(t, r));
  if (typeof ref === 'string') return ref;
  const outs = (t.outputs[ref.from] ?? []).filter((o) => !ref.kind || o.kind === ref.kind || o.mime.startsWith(`${ref.kind}/`));
  if (!outs.length) throw new PortalError(`Step ${ref.from + 1} made nothing to use here`);
  const pick = ref.pick ?? 'first';
  if (pick === 'all') return outs.map((o) => `asset:${o.asset}`);
  const o = pick === 'last' ? outs[outs.length - 1] : typeof pick === 'number' ? outs[pick] : outs[0];
  if (!o) throw new PortalError(`Step ${ref.from + 1} has no output ${pick}`);
  return `asset:${o.asset}`;
}

/** Takes the task's lease (null: it isn't running, or someone else is moving it right now). */
async function lease(taskId: string) {
  const ref = tasks().doc(taskId);
  const mark = id('l', 4);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.get('state') !== 'running') return null;
    if (s.get('lease') && Number(s.get('lease_until') ?? 0) > Date.now()) return null;
    tx.update(ref, { lease: mark, lease_until: Date.now() + LEASE_MS });
    return mark;
  });
}
async function unlease(taskId: string, mark: string) {
  const ref = tasks().doc(taskId);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.get('lease') === mark) tx.update(ref, { lease: null, lease_until: null });
  }).catch(() => {});
}

/**
 * Moves a running task on as far as it can now: submits the step's job when it has none (paid: jobs.ts submit with the
 * task's `via`), asks Gen once how the step's job stands, and on to the next step when it is done. Returns the task as
 * it is afterwards. Never waits for a job; `budgetMs` bounds a chain of steps that finish at once.
 */
export async function advance(taskId: string, budgetMs = 20_000): Promise<Task | null> {
  const mark = await lease(taskId);
  if (!mark) return getTask(taskId);
  const t = (await getTask(taskId))!;
  const until = Date.now() + budgetMs;
  try {
    const user = await getUser(t.user_id);
    if (!user || user.disabled) throw new PortalError('Account not found');
    while (t.state === 'running' && t.step < t.steps.length && Date.now() < until) {
      const s = t.steps[t.step];
      let jobId = t.jobs[t.step];
      if (!jobId) {
        const inputs = Object.fromEntries(Object.entries(s.inputs ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, resolve(t, v!)]));
        const [job] = await submit(user, [{ tool: s.tool, params: s.params ?? {}, inputs }], t.via ?? undefined);
        const charged = Number((await db.collection('jobs').doc(job.id).get()).get('credits') ?? 0);
        jobId = job.id;
        t.jobs[t.step] = jobId;
        await save(t, { jobs: t.jobs, credits: t.credits + charged, detail: `${s.title}: starting`, fraction: null });
        if (t.state !== 'running') {
          // Cancelled while the job was being sent: stop that job too (its hold comes back when it settles).
          await gen(`/v1/jobs/${jobId}/cancel`, { as: user.project, body: {} }).catch(() => {});
          break;
        }
      }
      const j: any = await gen(`/v1/jobs/${jobId}`, { as: user.project }).catch((e) => ({ status: 'unknown', detail: e.message }));
      if (!TERMINAL.has(j.status)) {
        // Waiting its turn: say where in line it is (Gen counts the jobs ahead in the same lane, from every customer).
        const line = j.status === 'queued' && j.queue ? (j.queue.ahead ? `in line, ${j.queue.ahead} job${j.queue.ahead === 1 ? '' : 's'} ahead of yours` : 'next in line') : null;
        const detail = `${s.title}: ${line ?? j.detail ?? j.status}`;
        const f = line ? 0 : fraction(j.detail);
        await save(t, { detail, fraction: f ?? null });
        break;
      }
      await settle(j);
      if (j.status !== 'done') {
        await save(t, { state: j.status === 'cancelled' ? 'cancelled' : 'failed', error: j.status === 'cancelled' ? 'Cancelled' : `${s.title} failed: ${j.error ?? j.detail ?? 'unknown error'}`, detail: null, fraction: null });
        break;
      }
      t.outputs[t.step] = (j.outputs ?? []).map((o: any) => ({ asset: o.asset, kind: o.kind, mime: o.mime, title: o.title, step: t.step }));
      const next = t.steps[t.step + 1];
      await save(t, { outputs: t.outputs, step: t.step + 1, stepStarted: Date.now(), detail: next ? `${next.title}: starting` : null, fraction: null });
    }
    if (t.state === 'running' && t.step >= t.steps.length) await save(t, { state: 'done', detail: null, fraction: null });
  } catch (e: any) {
    if (t.state === 'running') await save(t, { state: 'failed', error: e.message ?? String(e), detail: null, fraction: null }).catch(() => {});
  } finally {
    await unlease(taskId, mark);
  }
  return getTask(taskId);
}

export async function startTask(user: User, via: Via | null, name: string, steps: Step[]) {
  if (!steps.length) throw new PortalError('Nothing to do');
  const now = Date.now();
  const t: Task = { id: id('task_', 8), user_id: user.id, via, name, steps, state: 'running', step: 0, jobs: [], outputs: [], detail: 'starting', error: null, credits: 0, created: now, updated: now, stepStarted: now };
  await tasks().doc(t.id).create({ user_id: user.id, via, name, steps: JSON.stringify(steps), state: 'running', step: 0, jobs: [], outputs: '[]', detail: 'starting', error: null, credits: 0, created: now, updated: now, step_started: now, step_fraction: null, lease: null, lease_until: null });
  return (await advance(t.id)) ?? t;
}

/** Moves the task on every couple of seconds until it ends or `ms` pass, calling onUpdate each time. */
export async function waitTask(taskId: string, ms: number, onUpdate?: (t: Task) => void, signal?: AbortSignal): Promise<Task> {
  const until = Date.now() + ms;
  let t = (await advance(taskId))!;
  for (;;) {
    onUpdate?.(t);
    if (t.state !== 'running' || Date.now() >= until || signal?.aborted) return t;
    await new Promise<void>((r) => {
      const timer = setTimeout(r, Math.min(Number(process.env.PORTAL_TASK_POLL_MS ?? 2000), Math.max(0, until - Date.now())));
      signal?.addEventListener('abort', () => { clearTimeout(timer); r(); }, { once: true });
    });
    t = (await advance(taskId)) ?? t;
  }
}

export async function cancelTask(user: User, taskId: string) {
  const t = await getTask(taskId, user.id);
  if (!t) throw new PortalError('No such task', { status: 404 });
  if (t.state !== 'running') return t;
  const jobId = t.jobs[t.step];
  if (jobId) await gen(`/v1/jobs/${jobId}/cancel`, { as: user.project, body: {} }).catch(() => {});
  await tasks().doc(t.id).update({ state: 'cancelled', error: 'Cancelled', detail: null, updated: Date.now() });
  // The job's credits come back when it settles (asked now, else the jobs sweep).
  if (jobId) await gen(`/v1/jobs/${jobId}`, { as: user.project }).then((j: any) => settle(j)).catch(() => {});
  return { ...t, state: 'cancelled' as const, error: 'Cancelled', detail: null };
}

export async function recentTasks(userId: string, limit = 20) {
  const s = await tasks().where('user_id', '==', userId).orderBy('created', 'desc').limit(Math.max(1, Math.min(100, limit))).get();
  return s.docs.map((d) => row(d)!) as Task[];
}

/** Every running task, moved on (the scheduled function). */
export async function advanceAll() {
  const s = await tasks().where('state', '==', 'running').limit(300).get();
  for (let i = 0; i < s.docs.length; i += 10) await Promise.all(s.docs.slice(i, i + 10).map((d) => advance(d.id, 10_000).catch((e) => console.error('[portal] task', d.id, e))));
  return s.size;
}

export const advanceTasks = onSchedule({ schedule: 'every 1 minutes', secrets: [SECRETS.genKey], timeoutSeconds: 240 }, async () => { await advanceAll(); });

// ------------------------------------------------------------ routes

route('GET', '/v1/tasks', async ({ req, url }) => {
  const user = await requireUser(req);
  let list = await recentTasks(user.id, Number(url.searchParams.get('limit')) || 20);
  if (list.some((t) => t.state === 'running')) list = await Promise.all(list.map(async (t) => (t.state === 'running' ? (await advance(t.id, 5_000)) ?? t : t)));
  return { tasks: list.map((t) => ({ ...t, results: results(t) })) };
});
route('GET', /^\/v1\/tasks\/(task_[0-9a-f]+)$/, async ({ req, res, params }) => {
  const user = await requireUser(req);
  let t = await getTask(params[0], user.id);
  if (!t) return res.status(404).set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).send(JSON.stringify({ error: 'No such task' }));
  if (t.state === 'running') t = (await advance(t.id)) ?? t;
  return { ...t, results: results(t) };
});
