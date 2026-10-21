// The portal against a fake Hawkes Gen: accounts, keys, credits taken and given back, every Gen call narrowed to the
// customer's project, Stripe's webhook, and the routes that never reach Gen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// ------------------------------------------------------------------ a fake Gen
const seen: { method: string; url: string; as?: string; auth?: string; body?: any }[] = [];
const jobs = new Map<string, any>();
const streams = new Set<http.ServerResponse>();
const emit = (job: any) => { for (const s of streams) s.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`); };
let refuseNext = false;
const fakeGen = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const body = String(req.headers['content-type'] ?? '').includes('json') && raw.length ? JSON.parse(raw.toString()) : undefined;
  const as = req.headers['x-hawkesgen-project'] as string | undefined;
  seen.push({ method: req.method!, url: req.url!, as, auth: req.headers.authorization, body });
  const json = (status: number, b: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  const url = new URL(req.url!, 'http://gen');
  if (url.pathname === '/v1/billing/quote') return json(200, { tool: body.tool, credits: Number(body.params?.credits ?? 10) });
  if (url.pathname === '/v1/jobs' && req.method === 'POST') {
    if (refuseNext) { refuseNext = false; return json(400, { error: 'prompt is required' }); }
    const job = { id: `j_${crypto.randomBytes(4).toString('hex')}`, tool: body.tool, status: 'queued', project: as, priority: body.priority ?? 0 };
    jobs.set(job.id, job);
    return json(200, { jobs: [job] });
  }
  let m = /^\/v1\/jobs\/(j_[0-9a-f]+)$/.exec(url.pathname);
  if (m) return jobs.has(m[1]) ? json(200, jobs.get(m[1])) : json(404, { error: 'no job' });
  m = /^\/v1\/jobs\/(j_[0-9a-f]+)\/cancel$/.exec(url.pathname);
  if (m) { const j = { ...jobs.get(m[1]), status: 'cancelled' }; jobs.set(j.id, j); emit(j); return json(200, j); }
  if (url.pathname === '/v1/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': hello\n\n');
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return;
  }
  if (url.pathname === '/v1/assets' && req.method === 'GET') return json(200, { items: [{ id: 'a_1', project: as }] });
  if (url.pathname === '/v1/assets' && req.method === 'POST') return json(200, { id: 'a_2', project: url.searchParams.get('project'), size: raw.length, filename: req.headers['x-filename'] });
  return json(404, { error: 'not in the fake' });
});
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));

process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-test-'));
process.env.HAWKESGEN_URL = `http://127.0.0.1:${(fakeGen.address() as any).port}`;
process.env.HAWKESGEN_KEY = 'hg_portal_test_key';
process.env.PUBLIC_URL = 'https://hawkesgen.test';
process.env.STARTER_CREDITS = '50';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const { handle } = await import('../src/server.ts');
const { watch, sweep } = await import('../src/jobs.ts');
const portal = http.createServer((req, res) => void handle(req, res));
await new Promise<void>((r) => portal.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(portal.address() as any).port}`;
const stopWatch = watch({ sweepEveryMs: 3600_000 });
test.after(() => { stopWatch(); portal.close(); for (const s of streams) s.end(); fakeGen.close(); });

async function call(route: string, o: { body?: unknown; cookie?: string; key?: string; method?: string; raw?: Buffer; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.key) headers.Authorization = `Bearer ${o.key}`;
  const r = await fetch(base + route, { method: o.method ?? (o.body !== undefined || o.raw ? 'POST' : 'GET'), headers, body: o.raw ? new Uint8Array(o.raw) : o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const until = async (ok: () => Promise<boolean>) => { for (let i = 0; i < 50; i++) { if (await ok()) return; await new Promise((r) => setTimeout(r, 40)); } assert.fail('timed out'); };
const credits = async (cookie: string) => (await call('/v1/users/me', { cookie })).body.user.credits;
let n = 0;
async function newCustomer() {
  const r = await call('/v1/users/signup', { body: { email: `c${++n}@example.com`, password: 'password123' }, headers: { 'X-Forwarded-For': `10.0.0.${n}` } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { cookie: r.cookie!, key: r.body.apiKey as string, user: r.body.user };
}

test('pages and the open routes', async () => {
  assert.match((await call('/')).body, /<html/i);
  assert.match((await call('/app')).body, /<html/i);
  assert.equal((await call('/v1/portfolio')).body.items.length, 3);
  assert.equal((await call('/v1/billing/packs')).body.packs.length, 3);
  assert.equal((await call('/../src/config.ts')).status, 404);
  assert.equal((await call('/v1/jobs')).status, 401);
});

test('sign up, sign in, keys, sign out', async () => {
  const c = await newCustomer();
  assert.match(c.user.project, /^usr_[0-9a-f]{16}$/);
  assert.equal(c.user.credits, 50);
  assert.equal((await call('/v1/users/me', { key: c.key })).body.user.id, c.user.id);
  assert.equal((await call('/v1/users/signup', { body: { email: 'c1@example.com', password: 'password123' } })).status, 409);
  assert.equal((await call('/v1/users/signup', { body: { email: 'x@example.com', password: 'short' } })).status, 400);
  assert.equal((await call('/v1/users/login', { body: { email: c.user.email, password: 'wrong-password' } })).status, 401);
  const login = await call('/v1/users/login', { body: { email: c.user.email, password: 'password123' } });
  assert.equal(login.status, 200);

  const minted = await call('/v1/users/api-key', { cookie: c.cookie, method: 'POST' });
  assert.match(minted.body.apiKey, /^hg_/);
  assert.equal((await call('/v1/users/me', { key: c.key })).status, 401, 'the old key stops working');
  assert.equal((await call('/v1/users/me', { key: minted.body.apiKey })).status, 200);

  await call('/v1/users/logout', { cookie: login.cookie, method: 'POST' });
  assert.equal((await call('/v1/users/me', { cookie: login.cookie })).status, 401);
});

test("a job takes its credits, goes to Gen as the customer's project, and a failure gives them back", async () => {
  const c = await newCustomer();
  seen.length = 0;
  const r = await call('/v1/jobs', { cookie: c.cookie, body: { tool: 'image.generate', project: 'sickofit', priority: 9, params: { prompt: 'a lantern', credits: 12 } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const job = r.body.jobs[0];
  assert.equal(await credits(c.cookie), 38);
  const sent = seen.find((s) => s.url === '/v1/jobs')!;
  assert.equal(sent.as, c.user.project);
  assert.equal(sent.auth, 'Bearer hg_portal_test_key');
  assert.equal(sent.body.project, undefined);
  assert.equal(sent.body.priority, undefined);

  emit({ ...job, status: 'failed', error: 'GPU fell over' });
  await until(async () => (await credits(c.cookie)) === 50);
  emit({ ...job, status: 'failed' });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await credits(c.cookie), 50, 'given back once');
  const kinds = (await call('/v1/billing/ledger', { cookie: c.cookie })).body.entries.map((e: any) => e.kind);
  assert.deepEqual(kinds, ['job_refund', 'job_reserve', 'signup_bonus']);
});

test('done keeps the credits; cancel gives them back; the sweep settles what the stream missed', async () => {
  const c = await newCustomer();
  const a = (await call('/v1/jobs', { key: c.key, body: { tool: 'audio.sfx', params: { credits: 8 } } })).body.jobs[0];
  const b = (await call('/v1/jobs', { key: c.key, body: { tool: 'audio.sfx', params: { credits: 8 } } })).body.jobs[0];
  assert.equal(await credits(c.cookie), 34);
  emit({ ...a, status: 'done' });
  assert.equal((await call(`/v1/jobs/${b.id}/cancel`, { key: c.key, body: {} })).status, 200);
  await until(async () => (await credits(c.cookie)) === 42);

  const d = (await call('/v1/jobs', { key: c.key, body: { tool: 'audio.sfx', params: { credits: 8 } } })).body.jobs[0];
  jobs.set(d.id, { ...jobs.get(d.id), status: 'failed' });
  await sweep();
  assert.equal(await credits(c.cookie), 42);
});

test('/v1/run waits for the job to end', async () => {
  const c = await newCustomer();
  const pending = call('/v1/run', { key: c.key, body: { tool: 'llm.text', params: { credits: 3 }, timeout: 30 } });
  await until(async () => [...jobs.values()].some((j) => j.project === c.user.project));
  const job = [...jobs.values()].find((j) => j.project === c.user.project);
  setTimeout(() => jobs.set(job.id, { ...job, status: 'done', result: 'ok' }), 300);
  const r = await pending;
  assert.equal(r.body.status, 'done');
  assert.equal(await credits(c.cookie), 47);
});

test('not enough credits: 402, and Gen never hears of it; a job Gen refuses is not charged', async () => {
  const c = await newCustomer();
  seen.length = 0;
  const r = await call('/v1/jobs', { cookie: c.cookie, body: { tool: 'video.i2v', params: { credits: 400 } } });
  assert.equal(r.status, 402);
  assert.ok(!seen.some((s) => s.url === '/v1/jobs'));
  refuseNext = true;
  const refused = await call('/v1/jobs', { cookie: c.cookie, body: { tool: 'image.generate', params: { credits: 10 } } });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'prompt is required');
  assert.equal(await credits(c.cookie), 50);
});

test('Gen routes: listed ones pass through narrowed, the rest never reach Gen', async () => {
  const c = await newCustomer();
  const list = await call('/v1/assets', { cookie: c.cookie });
  assert.equal(list.body.items[0].project, c.user.project);
  const up = await call('/v1/assets', { cookie: c.cookie, raw: Buffer.from('png-bytes'), headers: { 'Content-Type': 'image/png', 'X-Filename': 'ref.png' } });
  assert.deepEqual([up.body.project, up.body.size, up.body.filename], [c.user.project, 9, 'ref.png']);
  seen.length = 0;
  for (const [route, method] of [['/v1/fleet/start', 'POST'], ['/v1/jobs/j_ab/rerun', 'POST'], ['/v1/keys', 'GET'], ['/v1/entities/usr_x/y/make', 'POST'], ['/v1/settings', 'GET']]) {
    assert.equal((await call(route, { cookie: c.cookie, method, body: method === 'POST' ? {} : undefined })).status, 404, route);
  }
  assert.equal(seen.length, 0);
});

test('Stripe: a signed, paid checkout adds the pack once; a bad signature adds nothing', async () => {
  const c = await newCustomer();
  const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', customer: 'cus_1', client_reference_id: c.user.id, metadata: { user_id: c.user.id, pack_id: 'starter_10', credits: '1000' } } } };
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = (secret: string) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
  const post = (s: string) => call('/v1/billing/webhook', { raw: Buffer.from(payload), headers: { 'Content-Type': 'application/json', 'Stripe-Signature': s } });
  assert.equal((await post(sig('whsec_wrong'))).status, 400);
  assert.equal(await credits(c.cookie), 50);
  const ok = await post(sig('whsec_test'));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.creditsAdded, 1000);
  assert.equal((await post(sig('whsec_test'))).body.duplicate, true);
  assert.equal(await credits(c.cookie), 1050);
});

test('admins: made from the CLI path with a one-time link; customers never see the admin routes', async () => {
  const { ensureAdmin, passwordLink } = await import('../src/users.ts');
  const a = ensureAdmin('boss@hawkesgen.com', 'Boss');
  const link = passwordLink(a.id, 'https://hawkesgen.test');
  const token = new URL(link).searchParams.get('token');
  assert.equal((await call('/v1/users/password', { body: { token, password: 'short' } })).status, 400);
  const set = await call('/v1/users/password', { body: { token, password: 'a-real-password' } });
  assert.equal(set.status, 200);
  assert.equal(set.body.user.role, 'admin');
  assert.equal((await call('/v1/users/password', { body: { token, password: 'another-password' } })).status, 410, 'one use');
  const boss = set.cookie!;

  const c = await newCustomer();
  assert.equal((await call('/v1/admin/overview', { cookie: c.cookie })).status, 404);
  assert.equal((await call(`/v1/admin/users/${c.user.id}/credits`, { cookie: c.cookie, body: { delta: 100, note: 'x' } })).status, 404);

  const o = await call('/v1/admin/overview', { cookie: boss });
  assert.equal(o.status, 200);
  assert.ok(o.body.accounts.total >= 2);
  assert.ok((await call(`/v1/admin/users?q=${encodeURIComponent(c.user.email)}`, { cookie: boss })).body.items.some((u: any) => u.id === c.user.id));

  assert.equal((await call(`/v1/admin/users/${c.user.id}/credits`, { cookie: boss, body: { delta: 25, note: '' } })).status, 400, 'a note is required');
  assert.equal((await call(`/v1/admin/users/${c.user.id}/credits`, { cookie: boss, body: { delta: -500, note: 'too much' } })).status, 400);
  assert.equal((await call(`/v1/admin/users/${c.user.id}/credits`, { cookie: boss, body: { delta: 25, note: 'Launch thank-you' } })).body.credits, 75);
  const detail = (await call(`/v1/admin/users/${c.user.id}`, { cookie: boss })).body;
  assert.match(detail.ledger[0].detail, /Launch thank-you \(by boss@hawkesgen.com\)/);

  await call(`/v1/admin/users/${c.user.id}/disable`, { cookie: boss, body: {} });
  assert.equal((await call('/v1/users/me', { cookie: c.cookie })).status, 401);
  assert.equal((await call('/v1/users/me', { key: c.key })).status, 401);
  assert.equal((await call('/v1/users/login', { body: { email: c.user.email, password: 'password123' } })).status, 403);
  await call(`/v1/admin/users/${c.user.id}/enable`, { cookie: boss, body: {} });
  assert.equal((await call('/v1/users/me', { key: c.key })).status, 200);

  assert.equal((await call(`/v1/admin/users/${a.id}/disable`, { cookie: boss, body: {} })).status, 400, 'not yourself');
  assert.equal((await call(`/v1/admin/users/${a.id}/role`, { cookie: boss, body: { role: 'customer' } })).status, 400);
  const reset = await call(`/v1/admin/users/${c.user.id}/password-link`, { cookie: boss, body: {} });
  assert.match(reset.body.url, /\/reset\?token=/);
});
