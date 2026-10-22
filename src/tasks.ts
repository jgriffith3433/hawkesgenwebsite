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
export type Task = { id: string; user_id: string; via: Via | null; name: string; steps: Step[]; state: 'running' | 'done' | 'failed' | 'cancelled'; step: number; jobs: string[]; outputs: Output[][]; detail: string | null; error: string | null; credits: number; created: number; updated: number };

export const events = new EventEmitter();
events.setMaxListeners(0);

const row = (r: any): Task | null => (r ? { ...r, via: r.via ? JSON.parse(r.via) : null, steps: JSON.parse(r.steps), jobs: JSON.parse(r.jobs), outputs: JSON.parse(r.outputs) } : null);
export const getTask = (taskId: string, userId?: string) => row(db.prepare(`SELECT * FROM tasks WHERE id = ?${userId ? ' AND user_id = ?' : ''}`).get(...(userId ? [taskId, userId] : [taskId])));

function save(t: Task, patch: Partial<Task>) {
  Object.assign(t, patch, { updated: Date.now() });
  db.prepare('UPDATE tasks SET state = ?, step = ?, jobs = ?, outputs = ?, detail = ?, error = ?, credits = ?, updated = ? WHERE id = ?')
    .run(t.state, t.step, JSON.stringify(t.jobs), JSON.stringify(t.outputs), t.detail, t.error, t.credits, t.updated, t.id);
  events.emit(t.id, t);
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
    const detail = `${t.steps[t.step].title}: ${j.detail ?? j.status}`;
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
      save(t, { outputs: t.outputs, step: t.step + 1 });
    }
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
  const t: Task = { id: id('task_', 8), user_id: user.id, via, name, steps, state: 'running', step: 0, jobs: [], outputs: [], detail: 'starting', error: null, credits: 0, created: now, updated: now };
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
