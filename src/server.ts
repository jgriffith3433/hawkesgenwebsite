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
import { PACKS, stripeStatus, checkout, ledger, stripeWebhook } from './billing.ts';
import { quote, submit, settle, watch } from './jobs.ts';
import { getPortfolio } from './portfolio.ts';

const PUBLIC = path.join(ROOT, 'public');
const PAGES: Record<string, string> = { '/': 'index.html', '/home': 'index.html', '/app': 'app.html', '/client/hawkesgen.mjs': 'hawkesgen.mjs' };
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' };

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
    if (!route.startsWith('/v1/')) {
      if ((method === 'GET' || method === 'HEAD') && (await serveStatic(route, res))) return;
      return send(res, 404, { error: 'Not found' });
    }

    // ------------------------------------------------------------ open to everyone
    if (route === '/v1/health') return send(res, 200, { ok: true, service: 'hawkesgen-portal', gen: Boolean(genKey()), payments: stripeStatus().configured });
    if (route === '/v1/portfolio' && method === 'GET') return send(res, 200, getPortfolio());
    if (route === '/v1/billing/packs' && method === 'GET') {
      const s = stripeStatus();
      return send(res, 200, { packs: PACKS, stripe: { configured: s.configured, publishableKey: s.publishableKey, mode: s.mode } });
    }
    if (route === '/v1/billing/webhook' && method === 'POST') return send(res, 200, stripeWebhook(await readBody(req), String(req.headers['stripe-signature'] ?? '')));
    if (route === '/v1/users/signup' && method === 'POST') {
      const r = users.signup(await readJson(req), clientIp(req));
      users.setSessionCookie(res, req, r.sessionToken);
      return send(res, 200, { user: r.user, apiKey: r.apiKey });
    }
    if (route === '/v1/users/login' && method === 'POST') {
      limitLogins(clientIp(req));
      const r = users.login(await readJson(req));
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
    if (route === '/v1/users/api-key' && method === 'POST') return send(res, 200, users.mintApiKey(user.id));
    if (route === '/v1/billing/quote' && method === 'POST') return send(res, 200, await quote(user, await readJson(req)));
    if (route === '/v1/billing/checkout' && method === 'POST') return send(res, 200, await checkout(user, await readJson(req)));
    if (route === '/v1/billing/ledger' && method === 'GET') return send(res, 200, ledger(user.id, Number(url.searchParams.get('limit')) || 100));

    if (route === '/v1/jobs' && method === 'POST') {
      const body = await readJson(req);
      return send(res, 200, { jobs: await submit(user, Array.isArray(body.jobs) ? body.jobs : [body]) });
    }
    if (route === '/v1/run' && method === 'POST') {
      // Submit and wait (up to `timeout` seconds, default 10 minutes).
      const body = await readJson(req);
      let [job] = await submit(user, [body]);
      const until = Date.now() + Math.max(1, Math.min(3600, Number(body.timeout) || 600)) * 1000;
      while (!['done', 'failed', 'cancelled'].includes(job.status) && Date.now() < until && !req.destroyed) {
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
  http.createServer((req, res) => void handle(req, res)).listen(PORT, '127.0.0.1', () => console.log(`[portal] http://127.0.0.1:${PORT}`));
}
