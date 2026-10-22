// hawkesgen.com: the customer portal. Pages (public/), accounts, credits and Stripe here; every job, file and event is
// Hawkes Gen's, reached with the portal's key narrowed to the customer's project. Only the routes listed below go to Gen.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PORT, ROOT, genKey } from './config.ts';
import { genFetch, gen } from './gen.ts';
import { send, readJson, readBody, PortalError } from './util.ts';
import * as users from './users.ts';
import { PACKS, FIRST_PURCHASE_BONUS, stripeStatus, checkout, ledger, stripeWebhook } from './billing.ts';
import { quote, submit, settle, watch } from './jobs.ts';
import { getPortfolio } from './portfolio.ts';
import * as admin from './admin.ts';
import * as oauth from './oauth.ts';
import { caller } from './caller.ts';
import { handleMcp } from './mcp.ts';
import { serveDownload, receiveUpload, uploadLink } from './files.ts';
import { resumeTasks, recentTasks, getTask, results } from './tasks.ts';
import { publicUrl } from './config.ts';
import * as google from './google.ts';

const PUBLIC = path.join(ROOT, 'public');
const PAGES: Record<string, string> = { '/': 'index.html', '/home': 'index.html', '/app': 'app.html', '/admin': 'admin.html', '/reset': 'reset.html', '/legal': 'legal.html', '/terms': 'legal.html', '/privacy': 'legal.html', '/refunds': 'legal.html', '/connect': 'connect.html', '/thanks': 'thanks.html', '/examples': 'examples.html', '/oauth/authorize': 'authorize.html', '/client/hawkesgen.mjs': 'hawkesgen.mjs' };
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.unitypackage': 'application/octet-stream', '.pdf': 'application/pdf' };

// Gen routes a signed-in customer may use as they are (Gen scopes them to the customer's project).
const PASS_GET = [/^\/v1\/jobs$/, /^\/v1\/jobs\/j_[0-9a-f]+$/, /^\/v1\/assets$/, /^\/v1\/assets\/a_[0-9a-f]+(\/file)?$/, /^\/v1\/files\/a_[0-9a-f]+$/, /^\/v1\/presets$/, /^\/v1\/tools(\/[\w.-]+)?$/, /^\/v1\/motions$/, /^\/v1\/providers\/elevenlabs\/voices$/, /^\/v1\/entities$/];
const PASS_POST = [/^\/v1\/jobs\/j_[0-9a-f]+\/cancel$/, /^\/v1\/recipes\/check$/];
const UPLOADS = [/^\/v1\/assets$/, /^\/v1\/blobs$/];
const UPLOAD_LIMIT = 64 * 1024 * 1024;

const clientIp = (req: IncomingMessage) => {
  const peer = req.socket.remoteAddress ?? '';
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',').pop()?.trim();
  return /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(peer) && fwd ? fwd : peer;
};

// Sign-in attempts per address: 20 a quarter hour.
const attempts = new Map<string, number[]>();
function limitLogins(ip: string) {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 15 * 60_000);
  if (recent.length >= 20) throw new PortalError('Too many sign-in attempts; wait a few minutes', { status: 429 });
  recent.push(now);
  attempts.set(ip, recent);
}

/** Gen's answer straight to the customer: status, the headers that matter, the body as it streams. */
async function relay(gr: Response, res: ServerResponse) {
  const headers: Record<string, string> = {};
  for (const h of ['content-type', 'content-length', 'content-disposition', 'cache-control', 'etag', 'last-modified', 'accept-ranges', 'content-range']) {
    const v = gr.headers.get(h);
    if (v) headers[h] = v;
  }
  res.writeHead(gr.status, headers);
  if (!gr.body) return void res.end();
  await pipeline(Readable.fromWeb(gr.body as any), res).catch(() => {});
}

// MCP clients and their OAuth run from other origins (editors, claude.ai, the MCP inspector): CORS for bearer-token routes
// only. /mcp never takes the session cookie, so a page elsewhere can't act as a signed-in customer.
const CORS_ROUTES = /^\/(mcp|oauth\/(register|token|revoke)|\.well-known\/.*)$/;
function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
}

const oauthFail = (res: ServerResponse, e: any) => send(res, e.status === 401 ? 401 : 400, { error: e.oauth ?? 'invalid_request', error_description: e.message });

async function readForm(req: IncomingMessage) {
  const raw = (await readBody(req)).toString('utf8');
  if (String(req.headers['content-type'] ?? '').includes('application/json')) return JSON.parse(raw || '{}');
  return Object.fromEntries(new URLSearchParams(raw));
}

async function serveStatic(route: string, res: ServerResponse) {
  const rel = PAGES[route] ?? route.slice(1);
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=300' });
  fs.createReadStream(file).pipe(res);
  return true;
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://portal');
  const route = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';
  try {
    if (CORS_ROUTES.test(route)) {
      cors(res);
      if (method === 'OPTIONS') return void res.writeHead(204).end();
    }

    // ------------------------------------------------------------ MCP and its OAuth
    if (route === '/.well-known/oauth-protected-resource' || route === '/.well-known/oauth-protected-resource/mcp') return send(res, 200, oauth.protectedResourceMetadata());
    if (route === '/.well-known/oauth-authorization-server' || route === '/.well-known/openid-configuration') return send(res, 200, oauth.authorizationServerMetadata());
    if (route === '/oauth/register' && method === 'POST') {
      try {
        return send(res, 201, oauth.registerClient(await readJson(req)));
      } catch (e: any) {
        return send(res, 400, { error: e.oauth ?? 'invalid_client_metadata', error_description: e.message });
      }
    }
    if (route === '/oauth/token' && method === 'POST') {
      try {
        return send(res, 200, oauth.token(await readForm(req)));
      } catch (e: any) {
        return oauthFail(res, e);
      }
    }
    if (route === '/oauth/revoke' && method === 'POST') {
      oauth.revokeToken(String((await readForm(req)).token ?? ''));
      return send(res, 200, {});
    }
    if (route === '/mcp') {
      if (method !== 'POST') return void res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'This server answers POST (Streamable HTTP, stateless).' }));
      const c = users.bearer(req) ? caller(req) : null;
      if (!c) {
        res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${publicUrl()}/.well-known/oauth-protected-resource/mcp"${users.bearer(req) ? ', error="invalid_token"' : ''}`);
        return send(res, 401, { error: 'Sign in: connect at https://hawkesgen.com/connect, or send an API key (Authorization: Bearer hg_...)' });
      }
      return await handleMcp(c, req, res);
    }

    // ------------------------------------------------------------ Continue with Google
    if (route === '/auth/google' && method === 'GET') return google.start(req, res, url.searchParams.get('next'));
    if (route === '/auth/google/callback' && method === 'GET') {
      limitLogins(clientIp(req));
      try {
        return void (await google.callback(req, res, url.searchParams, clientIp(req)));
      } catch (e: any) {
        return void res.writeHead(302, { Location: `/?signin_error=${encodeURIComponent(e.message ?? 'Google sign-in failed')}` }).end();
      }
    }

    // ------------------------------------------------------------ signed file links (no auth header: the link is the key)
    let f = /^\/dl\/([\w-]+\.[\w-]+)(?:\/[^/]*)?$/.exec(route);
    if (f && (method === 'GET' || method === 'HEAD')) return await serveDownload(f[1], res);
    f = /^\/up\/([\w-]+\.[\w-]+)$/.exec(route);
    if (f && (method === 'PUT' || method === 'POST')) return send(res, 200, await receiveUpload(f[1], req, users.getUser));

    if (!route.startsWith('/v1/')) {
      if ((method === 'GET' || method === 'HEAD') && (await serveStatic(route, res))) return;
      return send(res, 404, { error: 'Not found' });
    }

    // ------------------------------------------------------------ open to everyone
    if (route === '/v1/health') return send(res, 200, { ok: true, service: 'hawkesgen-portal', gen: Boolean(genKey()), payments: stripeStatus().configured, google: google.googleEnabled() });
    if (route === '/v1/portfolio' && method === 'GET') return send(res, 200, getPortfolio());
    // The landing page's free demo (demo.ts): pixel art or a cutout, no account, a few a day.
    if (route === '/v1/demo' && method === 'GET') return send(res, 200, (await import('./demo.ts')).demoAllowance(clientIp(req)));
    if (route === '/v1/demo' && method === 'POST') {
      const demo = await import('./demo.ts');
      const kind = String(url.searchParams.get('kind') ?? '');
      const type = String(req.headers['content-type'] ?? '').split(';')[0].trim();
      const early = demo.demoProblem(kind, Number(req.headers['content-length'] ?? 1), type, clientIp(req));
      if (early) throw early;
      const r = await demo.runDemo(kind, await readBody(req, 6 * 1024 * 1024), type, clientIp(req));
      res.writeHead(200, { 'Content-Type': r.mime, 'Cache-Control': 'no-store', 'X-Demo-Left': String(r.left) });
      return void res.end(r.bytes);
    }
    if (route === '/v1/billing/packs' && method === 'GET') {
      const s = stripeStatus();
      return send(res, 200, { packs: PACKS, firstPurchaseBonus: FIRST_PURCHASE_BONUS, stripe: { configured: s.configured, publishableKey: s.publishableKey, mode: s.mode } });
    }
    if (route === '/v1/billing/webhook' && method === 'POST') return send(res, 200, stripeWebhook(await readBody(req), String(req.headers['stripe-signature'] ?? '')));
    if (route === '/v1/users/signup' && method === 'POST') {
      const r = users.signup(await readJson(req), clientIp(req), users.originOf(req));
      users.setSessionCookie(res, req, r.sessionToken);
      return send(res, 200, { user: r.user, apiKey: r.apiKey });
    }
    if (route === '/v1/users/login' && method === 'POST') {
      limitLogins(clientIp(req));
      const r = users.login(await readJson(req));
      users.setSessionCookie(res, req, r.sessionToken);
      return send(res, 200, { user: r.user });
    }
    if (route === '/v1/users/password' && method === 'POST') {
      limitLogins(clientIp(req));
      const b = await readJson(req);
      const r = users.setPasswordWithToken(b.token, b.password);
      users.setSessionCookie(res, req, r.sessionToken);
      return send(res, 200, { user: r.user });
    }
    if (route === '/v1/users/logout' && method === 'POST') {
      users.deleteSession(users.sessionToken(req));
      users.clearSessionCookie(res, req);
      return send(res, 200, { ok: true });
    }

    // ------------------------------------------------------------ a customer
    const user = users.authenticate(req);
    if (!user) return send(res, 401, { error: 'Sign in, or send your API key (Authorization: Bearer hg_...)' });

    if ((route === '/v1/users/me' || route === '/v1/me') && method === 'GET') return send(res, 200, users.profile(user));
    if (route === '/v1/referral' && method === 'GET') return send(res, 200, users.referral(user));

    // The approve screen (/oauth/authorize): what's asking, then yes or no. Session only: a token can't approve itself.
    if (route === '/v1/oauth/request' && method === 'GET') return send(res, 200, oauth.authorizeRequest(url.searchParams));
    if ((route === '/v1/oauth/approve' || route === '/v1/oauth/deny') && method === 'POST') {
      if (users.bearer(req) || !String(req.headers['content-type'] ?? '').includes('application/json')) throw new PortalError('Approve from the browser', { status: 403 });
      const b = await readJson(req);
      const q = new URLSearchParams(String(b.query ?? ''));
      return send(res, 200, { redirect: route.endsWith('approve') ? oauth.approve(user, q, b.daily_cap) : oauth.deny(q) });
    }
    if (route === '/v1/connections' && method === 'GET') return send(res, 200, { connections: oauth.listConnections(user.id), default_daily_cap: oauth.DEFAULT_DAILY_CAP });
    const conn = /^\/v1\/connections\/(conn_[0-9a-f]+)$/.exec(route);
    if (conn && method === 'POST') return send(res, 200, oauth.updateConnection(user.id, conn[1], await readJson(req)));
    if (route === '/v1/uploads' && method === 'POST') return send(res, 200, uploadLink(user, String((await readJson(req)).filename ?? 'upload.bin')));
    if (route === '/v1/tasks' && method === 'GET') return send(res, 200, { tasks: recentTasks(user.id, Number(url.searchParams.get('limit')) || 20).map((t) => ({ ...t, results: results(t) })) });
    const task = /^\/v1\/tasks\/(task_[0-9a-f]+)$/.exec(route);
    if (task && method === 'GET') {
      const t = getTask(task[1], user.id);
      if (!t) return send(res, 404, { error: 'No such task' });
      return send(res, 200, { ...t, results: results(t) });
    }
    if (route === '/v1/users/api-key' && method === 'POST') return send(res, 200, users.mintApiKey(user.id));
    if (route === '/v1/billing/quote' && method === 'POST') return send(res, 200, await quote(user, await readJson(req)));
    if (route === '/v1/billing/checkout' && method === 'POST') return send(res, 200, await checkout(user, await readJson(req)));
    if (route === '/v1/billing/ledger' && method === 'GET') return send(res, 200, ledger(user.id, Number(url.searchParams.get('limit')) || 100));

    // ------------------------------------------------------------ admins (anyone else gets a 404)
    if (route.startsWith('/v1/admin/')) {
      admin.requireAdmin(user);
      const m = /^\/v1\/admin\/users\/(usr_[0-9a-f]+)(?:\/(credits|gift|disable|enable|role|password-link))?$/.exec(route);
      if (route === '/v1/admin/overview' && method === 'GET') return send(res, 200, admin.overview());
      if (route === '/v1/admin/users' && method === 'GET') return send(res, 200, admin.listUsers({ search: url.searchParams.get('q'), limit: Number(url.searchParams.get('limit')), offset: Number(url.searchParams.get('offset')) }));
      if (route === '/v1/admin/jobs' && method === 'GET') return send(res, 200, { jobs: admin.recentJobs(Number(url.searchParams.get('limit')) || 100) });
      if (route === '/v1/admin/purchases' && method === 'GET') return send(res, 200, { purchases: admin.purchases(Number(url.searchParams.get('limit')) || 100) });
      if (m && !m[2] && method === 'GET') return send(res, 200, admin.userDetail(m[1]));
      if (m && method === 'POST') {
        const b = await readJson(req);
        if (m[2] === 'credits') return send(res, 200, admin.adjustCredits(user, m[1], b.delta, b.note));
        if (m[2] === 'gift') return send(res, 200, admin.giftCredits(user, m[1], b.credits, b.message));
        if (m[2] === 'disable' || m[2] === 'enable') return send(res, 200, admin.setDisabled(user, m[1], m[2] === 'disable'));
        if (m[2] === 'role') return send(res, 200, admin.setRole(user, m[1], b.role));
        if (m[2] === 'password-link') return send(res, 200, admin.resetLink(m[1]));
      }
      return send(res, 404, { error: 'Not found' });
    }

    if (route === '/v1/jobs' && method === 'POST') {
      const body = await readJson(req);
      return send(res, 200, { jobs: await submit(user, Array.isArray(body.jobs) ? body.jobs : [body]) });
    }
    if (route === '/v1/run' && method === 'POST') {
      // Submit and wait (up to `timeout` seconds, default 10 minutes).
      const body = await readJson(req);
      let gone = false;
      res.on('close', () => { gone = true; });
      let [job] = await submit(user, [body]);
      const until = Date.now() + Math.max(1, Math.min(3600, Number(body.timeout) || 600)) * 1000;
      while (!['done', 'failed', 'cancelled'].includes(job.status) && Date.now() < until && !gone) {
        await new Promise((r) => setTimeout(r, 2000));
        job = await gen(`/v1/jobs/${job.id}`, { as: user.project });
      }
      settle(job);
      return send(res, 200, job);
    }

    // The customer's live feed: Gen's own stream, narrowed to their project.
    if (route === '/v1/events' && method === 'GET') {
      const ctrl = new AbortController();
      req.on('close', () => ctrl.abort());
      const gr = await genFetch('/v1/events', { as: user.project, signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
      res.writeHead(gr.status, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      if (gr.body) await pipeline(Readable.fromWeb(gr.body as any), res).catch(() => {});
      return void res.end();
    }

    if (method === 'POST' && UPLOADS.some((r) => r.test(route))) {
      if (Number(req.headers['content-length'] ?? 0) > UPLOAD_LIMIT) throw new PortalError('Files up to 64 MB', { status: 413 });
      const headers: Record<string, string> = {};
      for (const h of ['content-type', 'x-filename']) if (req.headers[h]) headers[h] = String(req.headers[h]);
      const body = await readBody(req, UPLOAD_LIMIT);
      url.searchParams.set('project', user.project);
      return relay(await genFetch(`${route}?${url.searchParams}`, { as: user.project, method: 'POST', rawBody: new Uint8Array(body), headers, signal: AbortSignal.timeout(300_000) }), res);
    }
    const pass = method === 'GET' ? PASS_GET : method === 'POST' ? PASS_POST : [];
    if (pass.some((r) => r.test(route))) {
      const body = method === 'POST' ? await readJson(req) : undefined;
      return relay(await genFetch(`${route}${url.search}`, { as: user.project, method, body, signal: AbortSignal.timeout(120_000) }), res);
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e: any) {
    if (res.headersSent) return void res.end();
    if (e instanceof PortalError) return send(res, e.status, { error: e.message });
    console.error(`[portal] ${method} ${route}:`, e);
    return send(res, 500, { error: 'Something went wrong on our side' });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'src', 'server.ts')) {
  if (!genKey()) console.warn('[portal] HAWKESGEN_KEY is not set: jobs will fail until it is');
  watch();
  resumeTasks();
  http.createServer((req, res) => void handle(req, res)).listen(PORT, '127.0.0.1', () => console.log(`[portal] http://127.0.0.1:${PORT}`));
}
