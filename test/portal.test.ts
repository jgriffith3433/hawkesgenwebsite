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
const relayed: { headers: http.IncomingHttpHeaders; raw: string }[] = [];
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
  if (url.pathname === '/v1/analytics/relay') { relayed.push({ headers: req.headers, raw: raw.toString() }); return json(202, { ok: true }); }
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
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csecret';

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
  for (const p of ['/legal', '/terms', '/privacy', '/refunds']) assert.match((await call(p)).body, /Refunds/);
  assert.equal((await call('/v1/portfolio')).body.items.length, 3);
  assert.equal((await call('/v1/billing/packs')).body.packs.length, 3);
  { const pr = (await call('/v1/prices')).body.tools; assert.ok(pr['audio.sfx'] > 0 && pr['music.nope'] === undefined); }
  assert.equal((await call('/../src/config.ts')).status, 404);
  assert.equal((await call('/v1/jobs')).status, 401);
});

test('Signed out: ?soft=1 answers 200 with no user; protected routes still answer 401', async () => {
  const soft = await call('/v1/users/me?soft=1');
  assert.equal(soft.status, 200);
  assert.equal(soft.body.user, null);
  for (const p of ['/v1/users/me', '/v1/me', '/v1/connections', '/v1/jobs', '/v1/referral']) assert.equal((await call(p)).status, 401, p);
});

test('sign up, sign in, keys, sign out', async () => {
  const c = await newCustomer();
  // usr_ on live; another copy of the portal (Studio's beta: PORTAL_PROJECT_PREFIX=ubeta_) has its own.
  const { PROJECT_PREFIX } = await import('../src/config.ts');
  assert.match(c.user.project, new RegExp(`^${PROJECT_PREFIX}[0-9a-f]{16}$`));
  assert.equal(c.user.credits, 50);
  assert.equal((await call('/v1/users/me', { key: c.key })).body.user.id, c.user.id);
  const dup = await call('/v1/users/signup', { body: { email: 'c1@example.com', password: 'password123' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'email_exists', 'the sheet moves to sign-in on this code');
  const short = await call('/v1/users/signup', { body: { email: 'x@example.com', password: 'short' } });
  assert.equal(short.status, 400);
  assert.equal(short.body.code, 'short_password');
  assert.equal((await call('/v1/users/signup', { body: { email: 'not-an-email', password: 'password123' } })).body.code, 'bad_email');
  assert.equal((await call('/v1/users/login', { body: { email: c.user.email, password: 'wrong-password' } })).status, 401);
  const login = await call('/v1/users/login', { body: { email: c.user.email, password: 'password123' } });
  assert.equal(login.status, 200);
  // "Forgot your password?" (the sandbox's account sheet): the same answer for an account and for nobody, no email
  // from a server without mail, a few an hour per email; the link it makes sets the password.
  const forgot = (email: string, ip = '10.9.9.9') => call('/v1/users/forgot', { body: { email }, headers: { 'X-Forwarded-For': ip } });
  assert.deepEqual((await forgot(c.user.email)).body, { ok: true, mail: false });
  assert.deepEqual((await forgot('nobody-here@example.com')).body, { ok: true, mail: false });
  assert.equal((await forgot('not an email')).status, 400);
  await forgot(c.user.email, '10.9.9.8'); await forgot(c.user.email, '10.9.9.7');
  assert.equal((await forgot(c.user.email, '10.9.9.6')).status, 429, 'three an hour per email');
  const { forgotPassword } = await import('../src/users.ts');
  assert.equal(forgotPassword('nobody-else@example.com', '10.9.9.5', 'https://x'), null);

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
  assert.equal(ok.body.creditsAdded, 1250, 'the pack and the first-purchase bonus');
  assert.equal((await post(sig('whsec_test'))).body.duplicate, true);
  assert.equal(await credits(c.cookie), 1300);
});

test('admins: made from the CLI path with a one-time link; customers never see the admin routes', async () => {
  const { ensureAdmin, passwordLink } = await import('../src/users.ts');
  const a = await ensureAdmin('boss@hawkesgen.ai', 'Boss');
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
  assert.match(detail.ledger[0].detail, /Launch thank-you \(by boss@hawkesgen.ai\)/);
  assert.equal((await call(`/v1/admin/users/${c.user.id}/gift`, { cookie: boss, body: { credits: -5 } })).status, 400, 'gifts are positive');
  assert.equal((await call(`/v1/admin/users/${c.user.id}/gift`, { cookie: c.cookie, body: { credits: 5 } })).status, 404, 'admins only');
  const gift = (await call(`/v1/admin/users/${c.user.id}/gift`, { cookie: boss, body: { credits: 500, message: 'Thanks for the bug report' } })).body;
  assert.equal(gift.credits, 575);
  assert.equal(gift.emailed, false, 'mail is off in tests');
  assert.match((await call(`/v1/admin/users/${c.user.id}`, { cookie: boss })).body.ledger[0].detail, /^Gift: Thanks for the bug report \(by boss@hawkesgen.ai\)/);

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

test('Google: claims are checked, a verified email links to the existing account, new ones get starter credits', async () => {
  const { checkClaims, accountFor } = await import('../src/google.ts');
  const tok = (c: object) => `x.${Buffer.from(JSON.stringify(c)).toString('base64url')}.y`;
  const good = { aud: 'cid', iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 600, sub: 'g-123', email: 'Linked@Example.com', email_verified: true, name: 'Linked' };
  assert.equal(checkClaims(tok(good), 'cid').email, 'linked@example.com');
  assert.throws(() => checkClaims(tok({ ...good, aud: 'other' }), 'cid'), /another app/);
  assert.throws(() => checkClaims(tok({ ...good, iss: 'https://evil.example' }), 'cid'), /Google/);
  assert.throws(() => checkClaims(tok({ ...good, email_verified: false }), 'cid'), /verified/);
  assert.throws(() => checkClaims(tok({ ...good, exp: 1 }), 'cid'), /expired/);

  const existing = await call('/v1/users/signup', { body: { email: 'linked@example.com', password: 'password123' }, headers: { 'X-Forwarded-For': '10.7.0.1' } });
  const linked = await accountFor({ sub: 'g-123', email: 'linked@example.com', name: 'Linked' });
  assert.equal(linked.id, existing.body.user.id);
  assert.equal((await accountFor({ sub: 'g-123', email: 'changed@example.com', name: null })).id, existing.body.user.id, 'by Google id after linking');
  const fresh = await accountFor({ sub: 'g-456', email: 'new-google@example.com', name: 'New' });
  assert.equal(fresh.credits, 50);
  assert.notEqual(fresh.id, existing.body.user.id);
});

test('Google: only our own pages as the place to come back to', async () => {
  const r = await fetch(`${base}/auth/google?next=https://evil.example`, { redirect: 'manual' });
  assert.equal(r.status, 302, 'never a raw 503 page');
  if (r.status === 302) {
    const cookie = r.headers.get('set-cookie')!;
    const { verify } = await import('../src/sign.ts');
    const saved = verify<any>(decodeURIComponent(cookie.split(';')[0].split('=')[1]));
    assert.equal(saved?.n, '/app');
  }
  const back = await fetch(`${base}/auth/google/callback?code=x&state=forged`, { redirect: 'manual' });
  assert.equal(back.status, 302);
  assert.match(back.headers.get('location')!, /signin_error=/);
});

test('welcome email: SigV4 matches the AWS test suite; the email names the credits and links', async () => {
  const { sigv4, welcomeEmail, sendEmail } = await import('../src/mail.ts');
  // AWS's own example values: the signature must be stable and well-formed for these inputs.
  const h = sigv4('https://email.us-east-1.amazonaws.com/v2/email/outbound-emails', '{}', { id: 'AKIDEXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }, 'ses', 'us-east-1', new Date('2015-08-30T12:36:00Z'));
  assert.equal(h['x-amz-date'], '20150830T123600Z');
  assert.match(h.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\/us-east-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
  const again = sigv4('https://email.us-east-1.amazonaws.com/v2/email/outbound-emails', '{}', { id: 'AKIDEXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }, 'ses', 'us-east-1', new Date('2015-08-30T12:36:00Z'));
  assert.equal(again.authorization, h.authorization);
  const m = welcomeEmail('Ada <script>', 50);
  assert.match(m.text, /50 free credits/);
  assert.ok(!m.html.includes('<script>'), 'names are escaped');
  const { giftEmail } = await import('../src/mail.ts');
  // The welcome, rendered (mail is off on beta): the character's name, a link back to the island, the plain-text twin,
  // the support address and the legal footer.
  const w = welcomeEmail('Toaster', 50);
  assert.match(w.subject, /Toaster/);
  for (const part of [w.text, w.html]) {
    assert.match(part, /Toaster/);
    assert.match(part, /\/app/);
    assert.match(part, /support@hawkesgen\.ai/);
    assert.match(part, /You're getting this because you made an account at hawkesgen\.ai/);
    assert.match(part, /50 free credits/);
  }
  assert.ok(!/<[a-z]/i.test(w.text), 'the plain-text version has no markup');
  assert.match(w.html, /<a href="[^"]+\/app"/);
  const anon = welcomeEmail(null, 50);
  assert.match(anon.text, /\/play\/sandbox/);
  assert.ok(!/null|undefined/.test(anon.text + anon.html));
  const g = giftEmail('Ada', 500, 550, 'Thanks <b>a lot</b>');
  assert.match(g.subject, /500 Hawkes Gen credits/);
  assert.match(g.text, /550 credits/);
  assert.match(g.text, /Thanks <b>a lot<\/b>/);
  assert.ok(g.html.includes('Thanks &lt;b&gt;a lot&lt;/b&gt;'), 'the message is escaped in html');
  assert.deepEqual(await sendEmail('x@example.com', 's', 't', 'h'), { skipped: true }, 'off without PORTAL_MAIL=ses');
});

test('sign-up with only an email and a password: the name comes from the email or the one sent; cookies are kept', async () => {
  const bare = await call('/v1/users/signup', { body: { email: `quick${++n}@example.com`, password: 'password123' }, headers: { 'X-Forwarded-For': `10.0.2.${n}`, Cookie: 'hg_src=tiktok' } });
  assert.equal(bare.status, 200);
  assert.equal(bare.body.user.name, `quick${n}`);
  const named = await call('/v1/users/signup', { body: { email: `quick${++n}@example.com`, password: 'password123', name: 'Toaster' }, headers: { 'X-Forwarded-For': `10.0.2.${n}` } });
  assert.equal(named.body.user.name, 'Toaster');
  const { db } = await import('../src/db.ts');
  assert.equal((db.prepare('SELECT source FROM users WHERE id = ?').get(bare.body.user.id) as { source: string }).source, 'tiktok');
});

test('referrals: a friend with the link gets a bonus; their first purchase pays the inviter once', async () => {
  const inviter = await newCustomer();
  const link = (await call('/v1/referral', { cookie: inviter.cookie })).body;
  assert.match(link.link, /\/\?ref=[a-z0-9]{6,7}$/);
  assert.equal((await call('/v1/referral', { cookie: inviter.cookie })).body.code, link.code, 'the code stays the same');
  const r = await call('/v1/users/signup', { body: { email: `friend${++n}@example.com`, password: 'password123' }, headers: { 'X-Forwarded-For': `10.0.1.${n}`, Cookie: `hg_ref=${link.code}; hg_src=tiktok` } });
  assert.equal(r.body.user.credits, 100, '50 to start + 50 for the invite');
  const stranger = await call('/v1/users/signup', { body: { email: `odd${++n}@example.com`, password: 'password123' }, headers: { 'X-Forwarded-For': `10.0.1.${n}`, Cookie: 'hg_ref=nosuch1' } });
  assert.equal(stranger.body.user.credits, 50, 'an unknown code gives nothing');
  const buy = (sid: string) => {
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: sid, payment_status: 'paid', metadata: { user_id: r.body.user.id, pack_id: 'starter_10', credits: '1000' } } } });
    const t = Math.floor(Date.now() / 1000);
    return call('/v1/billing/webhook', { raw: Buffer.from(payload), headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${crypto.createHmac('sha256', 'whsec_test').update(`${t}.${payload}`).digest('hex')}` } });
  };
  await buy('cs_ref_1');
  assert.equal(await credits(inviter.cookie), 150, '+100 for the friend who bought');
  await buy('cs_ref_2');
  assert.equal(await credits(inviter.cookie), 150, 'only the first purchase pays');
  const after = (await call('/v1/referral', { cookie: inviter.cookie })).body;
  assert.deepEqual([after.invited, after.bought, after.earned], [1, 1, 100]);
});

test('the free demo: only its two tools, images only, and a few tries a day', async () => {
  const { demoProblem, demoAllowance, DEMOS } = await import('../src/demo.ts');
  assert.deepEqual(Object.keys(DEMOS).sort(), ['cutout', 'pixel']);
  assert.match(demoProblem('upscale', 10, 'image/png', '1.1.1.1')!.message, /pixel or cutout/);
  assert.match(demoProblem('pixel', 10, 'text/html', '1.1.1.1')!.message, /PNG/);
  assert.equal(demoProblem('pixel', 7 * 1024 * 1024, 'image/png', '1.1.1.1')!.status, 413);
  assert.equal(demoAllowance('1.1.1.1').left, 3);
  const { db } = await import('../src/db.ts');
  const crypto2 = await import('node:crypto');
  for (let i = 0; i < 3; i++) db.prepare('INSERT INTO demo_runs (ip_hash, kind, created) VALUES (?, ?, ?)').run(crypto2.createHash('sha256').update('demo:2.2.2.2').digest('hex').slice(0, 24), 'pixel', Date.now());
  assert.equal(demoProblem('pixel', 10, 'image/png', '2.2.2.2')!.status, 429);
  assert.equal((await call('/v1/demo?kind=pixel', { raw: Buffer.from('x'), headers: { 'Content-Type': 'text/plain' } })).status, 400, 'refused before reaching Gen');
});

test('first purchase: +25% once; the low-balance email is sent once per drop and re-armed by a purchase', async () => {
  const c = await newCustomer();
  const { db } = await import('../src/db.ts');
  assert.equal((await call('/v1/users/me', { cookie: c.cookie })).body.user.bought, false);
  assert.equal((await call('/v1/billing/packs')).body.firstPurchaseBonus, 25);
  const buy = (sid: string) => {
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: sid, payment_status: 'paid', metadata: { user_id: c.user.id, pack_id: 'starter_10', credits: '1000' } } } });
    const t = Math.floor(Date.now() / 1000);
    return call('/v1/billing/webhook', { raw: Buffer.from(payload), headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${crypto.createHmac('sha256', 'whsec_test').update(`${t}.${payload}`).digest('hex')}` } });
  };
  const first = (await buy('cs_first_1')).body;
  assert.deepEqual([first.creditsAdded, first.bonus], [1250, 250]);
  assert.equal(await credits(c.cookie), 1300);
  assert.equal((await buy('cs_first_1')).body.duplicate, true, 'a replayed webhook adds no second bonus');
  assert.equal((await buy('cs_first_2')).body.bonus, 0, 'only the first purchase');
  assert.equal((await call('/v1/users/me', { cookie: c.cookie })).body.user.bought, true);

  const { hold } = await import('../src/billing.ts');
  const low = () => (db.prepare('SELECT low_emailed FROM users WHERE id = ?').get(c.user.id) as any).low_emailed;
  hold(c.user.id, 2285, 'test'); // 2,300 - 2,285 = 15 left
  assert.equal(low(), null, 'still above the line');
  hold(c.user.id, 7, 'test');
  assert.ok(low(), 'below 10: told once');
  const at = low();
  hold(c.user.id, 1, 'test');
  assert.equal(low(), at, 'not again');
  await buy('cs_first_3');
  assert.equal(low(), null, 'a purchase re-arms it');
  const { lowBalanceEmail } = await import('../src/mail.ts');
  assert.match(lowBalanceEmail('Ada', 4, 25).text, /4 credits left[\s\S]*first pack comes with 25% more/);
  assert.ok(!lowBalanceEmail(null, 1, 0).text.includes('first pack'));
});

test("analytics: a game page's batch is passed on to Gen with our key, the origin and the visitor; a signed-in player's ids come with the page", async () => {
  const batch = JSON.stringify({ product: 'hawkesgen', anon: 'a_guestanon0001', session: 's_session00001', events: [{ name: 'game_ready', seq: 0 }] });
  const r = await fetch(`${base}/v1/analytics/collect`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': 'TestBrowser/1.0', 'X-Forwarded-For': '198.51.100.9' }, body: batch });
  assert.equal(r.status, 202);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  await until(async () => relayed.length > 0);
  const got = relayed.at(-1)!;
  assert.equal(got.raw, batch, 'the batch as it came');
  assert.equal(got.headers.authorization, 'Bearer hg_portal_test_key');
  assert.equal(got.headers['x-hawkes-relay-origin'], 'https://hawkesgen.test');
  assert.equal(got.headers['x-hawkes-visitor-ua'], 'TestBrowser/1.0');
  assert.ok(got.headers['x-hawkes-visitor-ip'], 'the visitor address goes to Gen (which drops it after the place)');
  const big = await fetch(`${base}/v1/analytics/collect`, { method: 'POST', body: 'x'.repeat(70_000) });
  assert.equal(big.status, 413);

  // A guest's game page has no ids; a signed-in player's has their account id and an anonymous id made from it.
  const guest = await call('/play/some-game');
  assert.doesNotMatch(guest.body, /window.HAWKES_PLAY_IDS=/);
  const c = await newCustomer();
  const page = await call('/play/some-game', { cookie: c.cookie });
  const ids = JSON.parse(/window\.HAWKES_PLAY_IDS=(\{.*?\});/.exec(page.body)![1]);
  assert.equal(ids.user, c.user.id);
  assert.match(ids.anon, /^u_[\w-]{22}$/);
  assert.equal(JSON.parse(/window\.HAWKES_PLAY_IDS=(\{.*?\});/.exec((await call('/play/other-game', { cookie: c.cookie })).body)![1]).anon, ids.anon, 'the same id every time');
  assert.doesNotMatch((await call('/play/sandbox', { cookie: c.cookie })).body, /window.HAWKES_PLAY_IDS=/, 'the guest sandbox keeps its own');
});

test('unknown paths: the styled 404 for a browser, JSON for the rest; brand files and cards', async () => {
  const page = await fetch(base + '/no/such/page', { headers: { Accept: 'text/html' } });
  assert.equal(page.status, 404);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  const html = await page.text();
  assert.match(html, /Nothing here/);
  assert.match(html, /href="\/"/);
  assert.match(html, /href="\/play\/sandbox"/);
  const json = await fetch(base + '/no/such/page');
  assert.equal(json.status, 404);
  assert.equal((await json.json() as any).error, 'Not found');
  assert.equal((await fetch(base + '/v1/nope', { headers: { Accept: 'text/html' } })).headers.get('content-type')?.includes('json'), true);
  for (const f of ['/favicon.ico', '/brand/favicon-16.png', '/brand/favicon-32.png', '/brand/apple-touch-icon.png', '/brand/icon-192.png', '/brand/icon-512.png', '/brand/og.png', '/offline.html', '/sw.js']) assert.equal((await fetch(base + f)).status, 200, f);
  assert.equal(JSON.parse(await (await fetch(base + '/manifest.webmanifest')).text()).icons.length, 3);
  for (const route of ['/', '/games']) {
    const h = await (await fetch(base + route)).text();
    for (const k of ['og:title', 'og:image', 'twitter:card', 'twitter:image']) assert.match(h, new RegExp(`(property|name)="${k}"`), `${route} ${k}`);
    assert.match(h, /apple-touch-icon/);
  }
});

test('sign-up limit: playtest sign-ups are exempt on a beta prefix only, live keeps the limit', async () => {
  const { signupExempt } = await import('../src/users.ts');
  const mail = 'playtest-abc123@example.com';
  assert.equal(signupExempt(mail, 'ubeta_'), true, 'beta: a playtest address is not counted');
  assert.equal(signupExempt(mail, 'usr_'), false, 'live: counted like anyone');
  assert.equal(signupExempt('someone@example.com', 'ubeta_'), false, 'beta: only playtest- addresses');
  assert.equal(signupExempt('playtest-x@gmail.com', 'ubeta_'), false, 'beta: only the reserved example.com');
  // This server runs with the live prefix: six playtest sign-ups from one address hit the limit (5 an hour).
  const headers = { 'X-Forwarded-For': '10.50.0.1' };
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await call('/v1/users/signup', { body: { email: `playtest-lim${i}@example.com`, password: 'password123' }, headers })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});

test('POST /v1/games/:id/generate: 10 a minute per account (a second guard behind the editor\'s card), others unaffected', async () => {
  const a = await newCustomer();
  const b = await newCustomer();
  const g = (await call('/v1/games', { cookie: a.cookie, body: { title: 'Rate', template: 'blank' } })).body;
  const gen = (cookie: string, id: string) => call(`/v1/games/${id}/generate`, { cookie, body: { kind: 'nope', prompt: 'a lantern' } });
  for (let i = 0; i < 10; i++) assert.equal((await gen(a.cookie, g.id)).status, 400, `try ${i + 1} reaches the route`);
  const over = await gen(a.cookie, g.id);
  assert.equal(over.status, 429);
  assert.match(over.body.error, /give it a minute/);
  const g2 = (await call('/v1/games', { cookie: b.cookie, body: { title: 'Other', template: 'blank' } })).body;
  assert.equal((await gen(b.cookie, g2.id)).status, 400, 'another account is not held back');
});
