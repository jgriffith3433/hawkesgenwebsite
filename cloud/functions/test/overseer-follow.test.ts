// The Overseer's run follows its Gen job (gameai.ts followJob) without ever waiting forever (J, 2026-11-10: "it just thinks
// forever"): a heartbeat every read, a busy or silent Gen read less often instead of hammered, a minute of silence ends
// the job as unreachable, and the deadline cancels it.
//   node --test --disable-warning=ExperimentalWarning test/overseer-follow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GCLOUD_PROJECT ??= 'demo-test';
const { followJob } = await import('../src/gameai.ts');

test('a job that streams to the end: text as it grows, a tick each read', async () => {
  const parts = ['', 'line one\n', 'line one\nline two\n'];
  let n = 0;
  const seen: string[] = [];
  let ticks = 0;
  const done = await followJob({ id: 'j_1', status: 'running', result: { partial: '' } }, 'p', Date.now() + 10_000,
    async (text) => { seen.push(text); }, async () => { ticks++; },
    { pollMs: 1, read: async () => (++n < parts.length ? { id: 'j_1', status: 'running', result: { partial: parts[n] } } : { id: 'j_1', status: 'done', result: { text: parts.at(-1) } }) });
  assert.equal(done.status, 'done');
  assert.equal(seen.at(-1), 'line one\nline two\n');
  assert.ok(ticks >= 2, `${ticks} ticks`);
});

test('Gen that never answers: the job ends as unreachable (and is cancelled), not after the deadline', async () => {
  let reads = 0, cancelled = 0;
  const t = Date.now();
  const out = await followJob({ id: 'j_2', status: 'running' }, 'p', Date.now() + 60_000, undefined, undefined,
    { pollMs: 1, quietMs: 300, read: async () => { reads++; throw Object.assign(new Error('busy'), { status: 429 }); }, cancel: async () => { cancelled++; return { id: 'j_2', status: 'cancelled' }; } });
  assert.equal(out.status, 'failed');
  assert.equal(out.error, 'unreachable');
  assert.equal(cancelled, 1);
  assert.ok(Date.now() - t < 5_000, 'well before the deadline');
  assert.ok(reads < 20, `a busy Gen is read less often (${reads} reads in ${Date.now() - t} ms)`);
});

test('a job past its deadline is cancelled with error timeout', async () => {
  const out = await followJob({ id: 'j_3', status: 'running' }, 'p', Date.now() + 50, undefined, undefined,
    { pollMs: 5, read: async () => ({ id: 'j_3', status: 'running' }), cancel: async () => ({ id: 'j_3', status: 'cancelled' }) });
  assert.equal(out.status, 'cancelled');
  assert.equal(out.error, 'timeout');
});
