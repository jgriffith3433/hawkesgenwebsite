// Tasks: one thing a customer asked for, as a chain of Gen jobs ("cut out, put on green, animate, make a sprite sheet").
// Each step is a job paid like any other (jobs.ts submit, with the connection's limit); its inputs can be the outputs of
// earlier steps. Tasks run in this process, are kept in the database, and pick up where they were after a restart.
import { EventEmitter } from 'node:events';
import { db } from './db.ts';
import { gen } from './gen.ts';
import { submit, settle } from './jobs.ts';
import { getUser, type User } from './users.ts';
import type { Via } from './oauth.ts';
import { id, PortalError } from './util.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  via TEXT,
  name TEXT NOT NULL,
  steps TEXT NOT NULL,
  state TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,
  jobs TEXT NOT NULL DEFAULT '[]',
  outputs TEXT NOT NULL DEFAULT '[]',
  detail TEXT,
  error TEXT,
  credits INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_user ON tasks (user_id, created);
`);

/** An input: an asset ref ("asset:a_..."), or the outputs of an earlier step (`pick`: which, by kind or position). */
export type Ref = string | { from: number; pick?: 'first' | 'last' | 'all' | number; kind?: string };
export type Step = { tool: string; title: string; params?: Record<string, unknown>; inputs?: Record<string, Ref | Ref[] | undefined>; keep?: boolean };
export type Output = { asset: string; kind: string; mime: string; title?: string; step: number };
export type Task = { id: string; user_id: string; via: Via | null; name: string; steps: Step[]; state: 'running' | 'done' | 'failed' | 'cancelled'; step: number; jobs: string[]; outputs: Output[][]; detail: string | null; error: string | null; credits: number; created: number; updated: number; stepStarted?: number };

export const events = new EventEmitter();
events.setMaxListeners(0);

const row = (r: any): Task | null => (r ? { ...r, via: r.via ? JSON.parse(r.via) : null, steps: JSON.parse(r.steps), jobs: JSON.parse(r.jobs), outputs: JSON.parse(r.outputs), stepStarted: started.get(r.id) ?? r.created } : null);
export const getTask = (taskId: string, userId?: string) => row(db.prepare(`SELECT * FROM tasks WHERE id = ?${userId ? ' AND user_id = ?' : ''}`).get(...(userId ? [taskId, userId] : [taskId])));

function save(t: Task, patch: Partial<Task>) {
  Object.assign(t, patch, { updated: Date.now() });
  db.prepare('UPDATE tasks SET state = ?, step = ?, jobs = ?, outputs = ?, detail = ?, error = ?, credits = ?, updated = ? WHERE id = ?')
    .run(t.state, t.step, JSON.stringify(t.jobs), JSON.stringify(t.outputs), t.detail, t.error, t.credits, t.updated, t.id);
  events.emit(t.id, t);
}

/** How far along a task is, 0-1: its finished steps, plus the running one's share. Inside a step: what Gen's job says
 *  ("12/30", "45%") when it says, else time (a step creeps toward 85% of its share and never claims more until it's
 *  done). Waiting in line counts as just begun. */
const within = new Map<string, number>();
export function progressOf(t: Task): number {
  if (t.state === 'done') return 1;
  const n = Math.max(1, t.steps.length);
  if (t.state !== 'running') return Math.min(1, t.step / n);
  let f = within.get(t.id);
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
  let outs = (t.outputs[ref.from] ?? []).filter((o) => !ref.kind || o.kind === ref.kind || o.mime.startsWith(`${ref.kind}/`));
  if (!outs.length) throw new PortalError(`Step ${ref.from + 1} made nothing to use here`);
  const pick = ref.pick ?? 'first';
  if (pick === 'all') return outs.map((o) => `asset:${o.asset}`);
  const o = pick === 'last' ? outs[outs.length - 1] : typeof pick === 'number' ? outs[pick] : outs[0];
  if (!o) throw new PortalError(`Step ${ref.from + 1} has no output ${pick}`);
  return `asset:${o.asset}`;
}

async function waitJob(user: User, jobId: string, t: Task) {
  let last = '';
  for (;;) {
    const j: any = await gen(`/v1/jobs/${jobId}`, { as: user.project }).catch((e) => ({ status: 'unknown', detail: e.message }));
    if (['done', 'failed', 'cancelled'].includes(j.status)) {
      settle(j);
      return j;
    }
    // Waiting its turn: say where in line it is (Gen counts the jobs ahead in the same lane, from every customer).
    const line = j.status === 'queued' && j.queue ? (j.queue.ahead ? `in line, ${j.queue.ahead} job${j.queue.ahead === 1 ? '' : 's'} ahead of yours` : 'next in line') : null;
    const detail = `${t.steps[t.step].title}: ${line ?? j.detail ?? j.status}`;
    const f = line ? 0 : fraction(j.detail);
    if (f === undefined) within.delete(t.id); else within.set(t.id, f);
    if (detail !== last) {
      last = detail;
      save(t, { detail });
    }
    const fresh = getTask(t.id);
    if (fresh?.state === 'cancelled') return { status: 'cancelled' };
    await new Promise((r) => setTimeout(r, Number(process.env.PORTAL_TASK_POLL_MS ?? 2000)));
  }
}

const running = new Set<string>();
const started = new Map<string, number>();

async function run(t: Task) {
  if (running.has(t.id)) return;
  running.add(t.id);
  const user = getUser(t.user_id);
  try {
    if (!user) throw new PortalError('Account not found');
    while (t.state === 'running' && t.step < t.steps.length) {
      const s = t.steps[t.step];
      let jobId = t.jobs[t.step];
      if (!jobId) {
        save(t, { detail: `${s.title}: starting` });
        const inputs = Object.fromEntries(Object.entries(s.inputs ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, resolve(t, v!)]));
        const [job] = await submit(user, [{ tool: s.tool, params: s.params ?? {}, inputs }], t.via ?? undefined);
        const charged = (db.prepare('SELECT credits FROM jobs WHERE id = ?').get(job.id) as { credits: number } | undefined)?.credits ?? 0;
        jobId = job.id;
        t.jobs[t.step] = jobId;
        save(t, { jobs: t.jobs, credits: t.credits + charged });
      }
      const j = await waitJob(user, jobId, t);
      if (j.status !== 'done') {
        save(t, { state: j.status === 'cancelled' ? 'cancelled' : 'failed', error: j.status === 'cancelled' ? 'Cancelled' : `${s.title} failed: ${j.error ?? j.detail ?? 'unknown error'}`, detail: null });
        break;
      }
      t.outputs[t.step] = (j.outputs ?? []).map((o: any) => ({ asset: o.asset, kind: o.kind, mime: o.mime, title: o.title, step: t.step }));
      const next = t.steps[t.step + 1];
      started.set(t.id, Date.now());
      within.delete(t.id);
      t.stepStarted = Date.now();
      save(t, { outputs: t.outputs, step: t.step + 1, detail: next ? `${next.title}: starting` : null });
    }
    within.delete(t.id);
    if (t.state === 'running') save(t, { state: 'done', detail: null });
  } catch (e: any) {
    save(t, { state: 'failed', error: e.message ?? String(e), detail: null });
  } finally {
    running.delete(t.id);
  }
}

export function startTask(user: User, via: Via | null, name: string, steps: Step[]) {
  if (!steps.length) throw new PortalError('Nothing to do');
  const now = Date.now();
  const t: Task = { id: id('task_', 8), user_id: user.id, via, name, steps, state: 'running', step: 0, jobs: [], outputs: [], detail: 'starting', error: null, credits: 0, created: now, updated: now, stepStarted: now };
  started.set(t.id, now);
  db.prepare('INSERT INTO tasks (id, user_id, via, name, steps, state, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(t.id, user.id, via ? JSON.stringify(via) : null, name, JSON.stringify(steps), 'running', now, now);
  void run(t);
  return t;
}

/** Waits until the task ends or `ms` pass, calling onUpdate on every change. */
export function waitTask(taskId: string, ms: number, onUpdate?: (t: Task) => void, signal?: AbortSignal): Promise<Task> {
  return new Promise((resolveP) => {
    const end = (t: Task) => {
      clearTimeout(timer);
      events.off(taskId, on);
      signal?.removeEventListener('abort', abort);
      resolveP(t);
    };
    const on = (t: Task) => {
      onUpdate?.(t);
      if (t.state !== 'running') end(t);
    };
    const abort = () => end(getTask(taskId)!);
    const timer = setTimeout(abort, ms);
    events.on(taskId, on);
    signal?.addEventListener('abort', abort);
    const now = getTask(taskId)!;
    if (now.state !== 'running') end(now);
  });
}

export async function cancelTask(user: User, taskId: string) {
  const t = getTask(taskId, user.id);
  if (!t) throw new PortalError('No such task', { status: 404 });
  if (t.state !== 'running') return t;
  const jobId = t.jobs[t.step];
  if (jobId) await gen(`/v1/jobs/${jobId}/cancel`, { as: user.project, body: {} }).catch(() => {});
  save(t, { state: 'cancelled', error: 'Cancelled', detail: null });
  return t;
}

export function recentTasks(userId: string, limit = 20) {
  return (db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY created DESC LIMIT ?').all(userId, Math.max(1, Math.min(100, limit))) as any[]).map(row) as Task[];
}

/** After a restart: carry on with every task that was running. */
export function resumeTasks() {
  for (const r of db.prepare("SELECT * FROM tasks WHERE state = 'running'").all()) void run(row(r)!);
}
