// The MCP server and its OAuth, against a fake Gen: an editor discovers us, registers, gets the customer's approval
// (PKCE), calls tools that run multi-step tasks, gets previews and signed download links, uploads with a one-time link,
// streams progress, and stops at its daily limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const jobs = new Map<string, any>();
const assets = new Map<string, { project: string; data: Buffer }>();
const seen: { url: string; as?: string; body?: any }[] = [];
const fakeGen = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const as = req.headers['x-hawkesgen-project'] as string;
  const body = String(req.headers['content-type'] ?? '').includes('json') && raw.length ? JSON.parse(raw.toString()) : undefined;
  seen.push({ url: req.url!, as, body });
  const json = (s: number, b: unknown) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  const url = new URL(req.url!, 'http://gen');
  if (url.pathname === '/v1/billing/quote') return json(200, { tool: body.tool, credits: { 'image.generate': 5, 'image.cutout': 2 }[body.tool as string] ?? 10 });
  if (url.pathname === '/v1/jobs' && req.method === 'POST') {
    const job = { id: `j_${crypto.randomBytes(4).toString('hex')}`, tool: body.tool, status: 'queued', project: as, inputs: body.inputs, params: body.params, outputs: [], polls: 0 };
    jobs.set(job.id, job);
    return json(200, { jobs: [job] });
  }
  let m = /^\/v1\/jobs\/(j_[0-9a-f]+)$/.exec(url.pathname);
  if (m) {
    const j = jobs.get(m[1]);
    if (!j || j.project !== as && as) return json(404, { error: 'no job' });
    // Each job runs for one poll, then finishes with one image per `count`.
    if (++j.polls > 1 && j.status === 'queued') {
      j.status = 'done';
      j.outputs = Array.from({ length: Number(j.params?.count ?? 1) }, () => {
        const a = `a_${crypto.randomBytes(6).toString('hex')}`;
        assets.set(a, { project: j.project, data: PNG });
        return { asset: a, kind: 'image', mime: 'image/png', title: 'Save Image' };
      });
    } else if (j.status === 'queued') j.detail = 'running on GPU';
    return json(200, j);
  }
  m = /^\/v1\/assets\/(a_[0-9a-f]+)\/file$/.exec(url.pathname);
  if (m) {
    const a = assets.get(m[1]);
    if (!a || a.project !== as) return json(404, { error: 'no asset' });
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': a.data.length });
    return res.end(a.data);
  }
  if (url.pathname === '/v1/assets' && req.method === 'POST') {
    const a = `a_${crypto.randomBytes(6).toString('hex')}`;
    assets.set(a, { project: url.searchParams.get('project')!, data: raw });
    return json(200, { id: a, kind: 'image', mime: 'image/png' });
  }
  if (url.pathname === '/v1/checkout/sessions') {
    const f = new URLSearchParams(raw.toString());
    return json(200, { id: 'cs_test_mcp', url: `https://checkout.stripe.test/pay/${f.get('metadata[pack_id]')}?success=${encodeURIComponent(f.get('success_url')!)}` });
  }
  if (url.pathname === '/v1/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hi\n\n'); return; }
  return json(404, { error: 'not in the fake' });
});
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));

process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-mcp-'));
process.env.HAWKESGEN_URL = `http://127.0.0.1:${(fakeGen.address() as any).port}`;
process.env.HAWKESGEN_KEY = 'hg_portal_test_key';
process.env.STARTER_CREDITS = '50';
process.env.PORTAL_TASK_POLL_MS = '30';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
process.env.STRIPE_API_BASE = process.env.HAWKESGEN_URL;

const { handle } = await import('../src/server.ts');
const portal = http.createServer((req, res) => void handle(req, res));
await new Promise<void>((r) => portal.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(portal.address() as any).port}`;
process.env.PUBLIC_URL = base;
test.after(() => { portal.closeAllConnections(); portal.close(); fakeGen.closeAllConnections(); fakeGen.close(); });

const post = async (route: string, body: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) as any };
};
let rpcId = 0;
const rpc = (token: string, method: string, params?: unknown) => post('/mcp', { jsonrpc: '2.0', id: ++rpcId, method, params }, { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' });

async function connectEditor(cap: number | null = 1000) {
  const signup = await post('/v1/users/signup', { email: `dev${crypto.randomBytes(3).toString('hex')}@studio.test`, password: 'password123' }, { 'X-Forwarded-For': `10.9.${Math.floor(Math.random() * 250)}.1` });
  const cookie = (signup.headers.get('set-cookie') ?? '').split(';')[0];
  const reg = await post('/oauth/register', { client_name: 'Cursor', redirect_uris: ['cursor://anysphere.cursor-retrieval/oauth/callback'] });
  assert.equal(reg.status, 201);
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.body.client_id, redirect_uri: 'cursor://anysphere.cursor-retrieval/oauth/callback', code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: `${base}/mcp` });
  const ok = await post('/v1/oauth/approve', { query: q.toString(), daily_cap: cap }, { Cookie: cookie });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const back = new URL(ok.body.redirect);
  assert.equal(back.searchParams.get('state'), 'xyz');
  const form = (o: Record<string, string>) => fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) }).then(async (r) => ({ status: r.status, body: await r.json() as any }));
  const bad = await form({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, code_verifier: 'wrong'.repeat(10), client_id: reg.body.client_id });
  assert.equal(bad.body.error, 'invalid_grant');
  return { cookie, user: signup.body.user, form, reg, q, verifier, code: back.searchParams.get('code')! };
}

test('discovery: an unauthenticated call points at the OAuth metadata', async () => {
  const r = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate')!, /resource_metadata=".*\/\.well-known\/oauth-protected-resource\/mcp"/);
  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.equal(prm.resource, `${base}/mcp`);
  const asm = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual(asm.code_challenge_methods_supported, ['S256']);
  assert.ok(asm.registration_endpoint.endsWith('/oauth/register'));
  assert.equal((await post('/oauth/register', { redirect_uris: ['javascript:alert(1)'] })).status, 400);
  assert.equal((await fetch(`${base}/mcp`, { method: 'OPTIONS' })).headers.get('access-control-allow-origin'), '*');
});

test('OAuth: approve, exchange with PKCE (once), refresh rotates, revoke ends it', async () => {
  const e = await connectEditor();
  // The wrong verifier spent the code: a code works once, so a fresh approval is needed.
  const again = await post('/v1/oauth/approve', { query: e.q.toString(), daily_cap: 1000 }, { Cookie: e.cookie });
  const code = new URL(again.body.redirect).searchParams.get('code')!;
  const t = await e.form({ grant_type: 'authorization_code', code, code_verifier: e.verifier, client_id: e.reg.body.client_id, redirect_uri: 'cursor://anysphere.cursor-retrieval/oauth/callback' });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.match(t.body.access_token, /^hgo_/);
  assert.equal((await e.form({ grant_type: 'authorization_code', code, code_verifier: e.verifier })).body.error, 'invalid_grant', 'codes are single-use');
  const init = await rpc(t.body.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1' } });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal(init.body.result.serverInfo.name, 'hawkesgen');
  const r2 = await e.form({ grant_type: 'refresh_token', refresh_token: t.body.refresh_token });
  assert.match(r2.body.access_token, /^hgo_/);
  assert.equal((await e.form({ grant_type: 'refresh_token', refresh_token: t.body.refresh_token })).body.error, 'invalid_grant', 'refresh tokens rotate');
  // A bearer token can't approve a connection; only the signed-in browser can.
  assert.ok([401, 403].includes((await post('/v1/oauth/approve', { query: e.q.toString() }, { Authorization: `Bearer ${r2.body.access_token}` })).status));
  const conns = await (await fetch(`${base}/v1/connections`, { headers: { Cookie: e.cookie } })).json();
  const id = conns.connections[0].id;
  await post(`/v1/connections/${id}`, { revoke: true }, { Cookie: e.cookie });
  assert.equal((await rpc(r2.body.access_token, 'tools/list')).status, 401);
});

async function token(cap: number | null = 1000) {
  const e = await connectEditor(cap);
  const again = await post('/v1/oauth/approve', { query: e.q.toString(), daily_cap: cap }, { Cookie: e.cookie });
  const code = new URL(again.body.redirect).searchParams.get('code')!;
  const t = await e.form({ grant_type: 'authorization_code', code, code_verifier: e.verifier });
  return { access: t.body.access_token as string, ...e };
}

test('tools: a transparent image is two paid steps; the result has a preview and a working download link', async () => {
  const { access, cookie, user } = await token();
  const list = await rpc(access, 'tools/list');
  const names = list.body.result.tools.map((t: any) => t.name);
  for (const n of ['make_sprite_sheet', 'generate_image', 'image_to_3d', 'sound_effect', 'upload_file', 'get_task']) assert.ok(names.includes(n), n);
  assert.ok((await rpc(access, 'prompts/list')).body.result.prompts.some((p: any) => p.name === 'sprite_sheet'));

  const r = await rpc(access, 'tools/call', { name: 'generate_image', arguments: { prompt: 'a red potion', transparent: true } });
  const result = r.body.result;
  assert.ok(!result.isError, JSON.stringify(result));
  assert.equal(result.structuredContent.state, 'done');
  assert.equal(result.structuredContent.credits, 7);
  assert.ok(result.content.some((c: any) => c.type === 'image' && c.mimeType === 'image/png'));
  const link = result.content.find((c: any) => c.type === 'resource_link');
  const dl = await fetch(link.uri);
  assert.equal(dl.status, 200);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), PNG);
  // The cutout step got the generate step's output, and everything ran as this customer.
  const steps = seen.filter((s) => s.url === '/v1/jobs' && s.as === user.project);
  assert.deepEqual(steps.map((s) => s.body.tool), ['image.generate', 'image.cutout']);
  assert.match(steps[1].body.inputs.image, /^asset:a_/);
  const me = await (await fetch(`${base}/v1/users/me`, { headers: { Cookie: cookie } })).json();
  assert.equal(me.user.credits, 43);
  // A forged or other link gets nothing.
  assert.equal((await fetch(link.uri.replace(/\/dl\/[^.]+/, '/dl/eyJwIjoieCJ9'))).status, 410);
});

test('uploads: a one-time curl link puts a local file in the library', async () => {
  const { access } = await token();
  const r = await rpc(access, 'tools/call', { name: 'upload_file', arguments: { filename: 'hero.png' } });
  const up = r.body.result.structuredContent.upload;
  assert.match(up.curl, /^curl -sS -T "hero.png" "http.*\/up\//);
  const put = await fetch(up.url, { method: 'PUT', body: new Uint8Array(PNG) });
  const got = await put.json() as any;
  assert.match(got.ref, /^asset:a_/);
  assert.equal((await fetch(up.url, { method: 'PUT', body: new Uint8Array(PNG) })).status, 410, 'one use');
  const inline = await rpc(access, 'tools/call', { name: 'upload_file', arguments: { filename: 'tiny.png', content_base64: PNG.toString('base64') } });
  assert.match(inline.body.result.structuredContent.uploaded.ref, /^asset:a_/);
  const local = await rpc(access, 'tools/call', { name: 'remove_background', arguments: { image: 'C:/art/hero.png' } });
  assert.ok(local.body.result.isError);
  assert.match(local.body.result.content[0].text, /upload_file/);
});

test('progress streams as server-sent events, then the result', async () => {
  const { access } = await token();
  const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'make_texture', arguments: { surface: 'mossy cobblestone' }, _meta: { progressToken: 'p1' } } }) });
  assert.match(r.headers.get('content-type')!, /text\/event-stream/);
  const events = (await r.text()).split('\n\n').filter((b) => b.startsWith('event: message')).map((b) => JSON.parse(b.split('data: ')[1]));
  const progress = events.filter((e) => e.method === 'notifications/progress');
  assert.ok(progress.length >= 1);
  assert.equal(progress[0].params.progressToken, 'p1');
  assert.ok(progress.every((p, i) => i === 0 || p.params.progress > progress[i - 1].params.progress));
  assert.equal(events.at(-1).id, 7);
  assert.equal(events.at(-1).result.structuredContent.state, 'done');
});

test('a connection stops at its daily limit, before Gen hears of the job', async () => {
  const { access } = await token(6);
  const one = await rpc(access, 'tools/call', { name: 'generate_image', arguments: { prompt: 'a crate' } });
  assert.ok(!one.body.result.isError);
  const before = seen.length;
  const two = await rpc(access, 'tools/call', { name: 'generate_image', arguments: { prompt: 'a barrel' } });
  assert.ok(two.body.result.isError);
  assert.match(two.body.result.content[0].text, /daily limit of 6 credits/);
  assert.ok(!seen.slice(before).some((s) => s.url === '/v1/jobs'));
});

test('editing and buying from the editor: variations, transforms, get_file, buy_credits', async () => {
  const { access } = await token();
  const v = await rpc(access, 'tools/call', { name: 'make_variations', arguments: { image: 'https://example.invalid/x.png' } });
  assert.ok(v.body.result.isError, 'a URL that cannot be fetched is an error, not a charge');
  const img = (await rpc(access, 'tools/call', { name: 'generate_image', arguments: { prompt: 'a crate' } })).body.result.structuredContent.files[0];
  const vars = await rpc(access, 'tools/call', { name: 'make_variations', arguments: { image: img.ref, change: 'fire and ice versions', count: 2 } });
  assert.equal(vars.body.result.structuredContent.files.length, 2);
  const sent = seen.filter((s) => s.url === '/v1/jobs').at(-1)!;
  assert.match(sent.body.params.prompt, /fire and ice versions/);
  const tr = await rpc(access, 'tools/call', { name: 'transform_image', arguments: { image: img.ref, steps: [{ op: 'trim' }, { op: 'pixelate', size: 64 }] } });
  assert.equal(tr.body.result.structuredContent.state, 'done');
  assert.deepEqual(seen.filter((s) => s.url === '/v1/jobs').at(-1)!.body.params.ops, [{ op: 'trim' }, { op: 'pixelate', size: 64 }]);
  const gf = await rpc(access, 'tools/call', { name: 'get_file', arguments: { ref: img.ref, filename: 'crate.png' } });
  assert.match(gf.body.result.structuredContent.file.curl, /curl -L -o "crate.png"/);
  assert.ok(gf.body.result.content.some((c: any) => c.type === 'image'));
  const packs = await rpc(access, 'tools/call', { name: 'buy_credits', arguments: {} });
  assert.equal(packs.body.result.structuredContent.packs.length, 3);
  const buy = await rpc(access, 'tools/call', { name: 'buy_credits', arguments: { pack: 'creator_25' } });
  assert.match(buy.body.result.structuredContent.checkout_url, /checkout\.stripe\.test\/pay\/creator_25/);
  assert.match(decodeURIComponent(buy.body.result.structuredContent.checkout_url), /\/thanks\?pack=creator_25/);
});
