// hawkesgen.com: the customer portal. Pages (public/), accounts, credits and Stripe here; every job, file and event is
// Hawkes Gen's, reached with the portal's key narrowed to the customer's project. Only the routes listed below go to Gen.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PORT, ROOT, USER_ID, genKey, env } from './config.ts';
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
import { PLANS, subscription, choosePlan, setCancel, billingPortal } from './plans.ts';
import * as games from './games.ts';
import * as friends from './friends.ts';
import { askAssistant, generateAsset, pendingGens, markSuggestion, resumeGens, KINDS, AI_CREDITS } from './gameai.ts';
import { join as joinLive, setPresence } from './live.ts';
import { templateBundle } from './templates.ts';
import { loaderScript, engineDoc } from './engine.ts';
import * as community from './community.ts';
import { upgrade as joinRoom, broadcastOps, markHere, liveCounts } from './rooms.ts';
import { companionTalk } from './companions.ts';
import * as shares from './shares.ts';
import type { Duplex } from 'node:stream';

const PUBLIC = path.join(ROOT, 'public');
const PAGES: Record<string, string> = { '/': 'index.html', '/home': 'index.html', '/app': 'games.html', '/app/studio': 'app.html', '/games': 'gallery.html', '/admin': 'admin.html', '/reset': 'reset.html', '/legal': 'legal.html', '/terms': 'legal.html', '/privacy': 'legal.html', '/refunds': 'legal.html', '/connect': 'connect.html', '/thanks': 'thanks.html', '/examples': 'examples.html', '/entities': 'entities.html', '/community': 'community.html','/oauth/authorize': 'authorize.html', '/client/hawkesgen.mjs': 'hawkesgen.mjs' };
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.unitypackage': 'application/octet-stream', '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8', '.glb': 'model/gltf-binary' };

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

// A game runs in a sandbox: its own opaque origin, so its scripts can't read this site's cookies or call its API as the
// player. Set on the page itself (not only on the editor's iframe) so a game opened directly is sandboxed too.
const PLAY_SANDBOX = 'sandbox allow-scripts allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation';
/** Local testing only: some test browsers refuse scripts from a sandboxed page on a local address. PORTAL_DEV_OPEN_PLAY=1
 *  serves games unsandboxed, and only to requests for localhost / 127.0.0.1. Never set it on the box. */
export const devOpenPlay = (req: IncomingMessage) => env('PORTAL_DEV_OPEN_PLAY') === '1' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers.host ?? ''));
function servePlayPage(res: ServerResponse, req: IncomingMessage) {
  const open = devOpenPlay(req);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...(open ? {} : { 'Content-Security-Policy': PLAY_SANDBOX }), 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(path.join(PUBLIC, 'play', 'play.html')).pipe(res);
}

/** A game's asset file, from Gen, for anyone playing it (open CORS: the game's sandbox has no origin). */
async function servePlayAsset(parts: Parameters<typeof games.resolvePlayAsset>[0], req: IncomingMessage, res: ServerResponse) {
  const a = games.resolvePlayAsset(parts);
  const headers: Record<string, string> = {};
  if (req.headers.range) headers.Range = String(req.headers.range);
  const gr = await genFetch(`/v1/assets/${a.asset}/file`, { as: a.project, headers, signal: AbortSignal.timeout(300_000) });
  if (!gr.ok && gr.status !== 206) throw new PortalError('File not found', { status: 404 });
  const out: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': a.immutable ? 'public, max-age=31536000, immutable' : 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' };
  for (const h of ['content-type', 'content-length', 'accept-ranges', 'content-range', 'etag']) {
    const v = gr.headers.get(h);
    if (v) out[h] = v;
  }
  // Never let an asset render as a page on this origin.
  if (/html|xml|javascript/i.test(out['content-type'] ?? '')) out['content-type'] = 'application/octet-stream';
  res.writeHead(gr.status, out);
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

/** WebSocket upgrades: only the game rooms (/v1/ws). */
export function onUpgrade(req: IncomingMessage, socket: Duplex) {
  socket.on('error', () => {});
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/v1/ws') return void socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  try { joinRoom(req, socket); } catch (e) { console.error('[portal] ws:', e); socket.destroy(); }
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

    // ------------------------------------------------------------ games: playing, the editor's pages
    if (method === 'GET' || method === 'HEAD') {
      // The engine: its manifest and loader (one script every engine page includes), and the assembled docs.
      if (route === '/play/modules.js') return void res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }).end(loaderScript());
      if (route === '/play/WORLD.md' || route === '/play/API.md') return void res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-cache' }).end(engineDoc(route === '/play/WORLD.md' ? 'world' : 'api'));
      if (/^\/play\/(_draft|t\/[a-z0-9-]+|[a-z0-9-]+(\/v\/\d+)?)$/.test(route) && route !== '/play/runtime.js') return servePlayPage(res, req);
      let pa = /^\/play-asset\/d\/([\w-]+\.[\w-]+)\/[^/]+$/.exec(route);
      if (pa) return await servePlayAsset({ token: pa[1] }, req, res);
      pa = /^\/play-asset\/([a-z0-9-]+)\/(\d+|live)\/([^/]+)$/.exec(route);
      if (pa) return await servePlayAsset({ slug: pa[1], version: pa[2] === 'live' ? 'live' : Number(pa[2]), name: decodeURIComponent(pa[3]) }, req, res);
      if (/^\/app\/g\/g_[0-9a-f]+$/.test(route)) return void (await serveStatic('/editor.html', res));
      if (/^\/app\/join\/[\w-]+$/.test(route)) return void (await serveStatic('/games.html', res));
      // Share links (src/shares.ts): the share window a game opens, a share's page, its file and picture.
      if (route === '/share/new') return void (await serveStatic('/share.html', res));
      const sp = /^\/s\/([\w-]{6,16})(?:\/(media|image))?$/.exec(route);
      if (sp) return sp[2] ? await shares.serveShareFile(sp[1], sp[2] as 'media' | 'image', req, res) : shares.sharePage(sp[1], res);
    }

    if (!route.startsWith('/v1/')) {
      if ((method === 'GET' || method === 'HEAD') && (await serveStatic(route, res))) return;
      return send(res, 404, { error: 'Not found' });
    }

    // ------------------------------------------------------------ open to everyone
    if (route === '/v1/health') return send(res, 200, { ok: true, service: 'hawkesgen-portal', gen: Boolean(genKey()), payments: stripeStatus().configured, google: google.googleEnabled() });
    // What Gen makes for a game, with its price (the codex reads it, so it never drifts from gameai.ts KINDS).
    if (route === '/v1/asset-kinds' && method === 'GET') return send(res, 200, Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { title: v.title, credits: v.credits }])));
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
    if (route === '/v1/plans' && method === 'GET') return send(res, 200, { plans: PLANS, aiCredits: AI_CREDITS() });
    const tb = /^\/v1\/play-template\/([a-z0-9-]+)$/.exec(route);
    if (tb && method === 'GET') {
      const b = templateBundle(tb[1]);
      if (!b) return send(res, 404, { error: 'No such game' });
      res.setHeader('Access-Control-Allow-Origin', '*');
      return send(res, 200, b);
    }
    // The community library is public: what's shared is for everyone (searching, browsing, its files).
    if (route === '/v1/community' && method === 'GET') {
      const p = (k: string) => url.searchParams.get(k);
      return send(res, 200, community.search({ q: p('q'), kind: p('kind'), tag: p('tag'), category: p('category'), limit: p('limit'), offset: p('offset'), sort: p('sort'), exact: p('exact') === '1' }));
    }
    if (route === '/v1/community/categories' && method === 'GET') return send(res, 200, community.categories());
    if (route === '/v1/community/tags' && method === 'GET') return send(res, 200, { tags: community.tagCounts(url.searchParams.get('kind') ?? undefined) });
    const cf = /^\/v1\/community\/(a_[0-9a-f]+)\/file$/.exec(route);
    if (cf && method === 'GET') return relay(await community.file(cf[1]), res);
    // The share window asks who's there without a 401 for guests (they can still download).
    if (route === '/v1/shares/session' && method === 'GET') { const u = users.authenticate(req); return send(res, 200, { user: u ? users.profile(u).user ?? null : null }); }
    const shv = /^\/v1\/shares\/([\w-]{6,16})$/.exec(route);
    if (shv && method === 'GET') { res.setHeader('Access-Control-Allow-Origin', '*'); return send(res, 200, shares.getShare(shv[1])); }
    if (route === '/v1/gallery' && method === 'GET') { const so = url.searchParams.get('sort'); return send(res, 200, games.gallery(so === 'new' ? 'new' : so === 'popular' ? 'popular' : 'live', Number(url.searchParams.get('limit')) || 60)); }
    // AI friends in a game (src/companions.ts): open (the game is sandboxed), paid by the owner only if they turned it on.
    const cmp = /^\/v1\/companion\/([\w-]+)$/.exec(route); if (cmp && method === 'POST') { res.setHeader('Access-Control-Allow-Origin', '*'); return send(res, 200, await companionTalk(cmp[1], await readJson(req), clientIp(req))); }
    // A play page says it's there (every 30 s), so games show how many people are playing.
    const ph = /^\/v1\/play\/(t\/[a-z0-9-]+|[a-z0-9-]+)\/here$/.exec(route);
    if (ph && method === 'POST') {
      const t = /^t\/(.+)$/.exec(ph[1]);
      const g = t ? null : games.gameBySlug(ph[1]);
      if (!t && !g) return send(res, 404, { error: 'No such game' });
      const gid = t ? `t:${t[1]}` : g!.id;
      markHere(gid, (await readJson(req)).s);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return send(res, 200, liveCounts(gid));
    }
    let pb = /^\/v1\/play\/([a-z0-9-]+)$/.exec(route);
    if (pb && method === 'GET') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return send(res, 200, games.playBundle(pb[1], url.searchParams.get('v') ? Number(url.searchParams.get('v')) : null));
    }
    pb = /^\/v1\/invites\/([\w-]+)$/.exec(route);
    if (pb && method === 'GET') return send(res, 200, games.inviteInfo(pb[1]));
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
    if (route === '/v1/billing/subscription' && method === 'GET') return send(res, 200, subscription(user));
    if (route === '/v1/billing/plan' && method === 'POST') return send(res, 200, await choosePlan(user, await readJson(req)));
    if (route === '/v1/billing/cancel' && method === 'POST') return send(res, 200, await setCancel(user, (await readJson(req)).cancel !== false));
    if (route === '/v1/billing/portal' && method === 'POST') return send(res, 200, await billingPortal(user));

    // ------------------------------------------------------------ sharing with the community
    if (route === '/v1/community' && method === 'POST') return send(res, 200, await community.share(user, await readJson(req)));
    if (route === '/v1/community/mine' && method === 'GET') return send(res, 200, community.mine(user));
    const cs = /^\/v1\/community\/(a_[0-9a-f]+)$/.exec(route);
    if (cs && method === 'DELETE') return send(res, 200, community.unshare(user, cs[1]));

    // ------------------------------------------------------------ share links for photos and clips (src/shares.ts)
    if (route === '/v1/shares' && method === 'POST') return send(res, 200, await shares.createShare(user, await readJson(req)));
    if (route === '/v1/shares/mine' && method === 'GET') return send(res, 200, shares.myShares(user));
    if (shv && method === 'DELETE') return send(res, 200, shares.deleteShare(user, shv[1]));

    // ------------------------------------------------------------ friends
    if (route === '/v1/friends' && method === 'GET') return send(res, 200, { friends: friends.listFriends(user.id) });
    const fr = new RegExp(`^/v1/friends/(${USER_ID})$`).exec(route);
    if (fr && method === 'DELETE') { friends.removeFriend(user.id, fr[1]); return send(res, 200, { ok: true }); }

    // ------------------------------------------------------------ games
    if (route === '/v1/games' && method === 'GET') return send(res, 200, games.listGames(user));
    if (route === '/v1/games' && method === 'POST') return send(res, 200, games.createGame(user, await readJson(req)));
    if (route === '/v1/remix' && method === 'POST') return send(res, 200, games.remix(user, await readJson(req)));
    const jb = /^\/v1\/play\/([a-z0-9-]+)\/join$/.exec(route);
    if (jb && method === 'POST') return send(res, 200, games.joinToBuild(user, jb[1]));
    const inv = /^\/v1\/invites\/([\w-]+)\/accept$/.exec(route);
    if (inv && method === 'POST') return send(res, 200, games.acceptInvite(user, inv[1]));
    const gm = /^\/v1\/games\/(g_[0-9a-f]+)(?:\/(.+))?$/.exec(route);
    if (gm) {
      const [, gid, sub = ''] = gm;
      const conn = String(req.headers['x-conn'] ?? '') || undefined;
      if (!sub && method === 'GET') return send(res, 200, { ...games.openGame(user, gid), ...(devOpenPlay(req) ? { devOpenPlay: true } : {}), kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { title: v.title, credits: v.credits }])), aiCredits: AI_CREDITS() });
      if (!sub && (method === 'PATCH' || method === 'POST')) return send(res, 200, games.updateGame(user, gid, await readJson(req)));
      if (!sub && method === 'DELETE') return send(res, 200, games.deleteGame(user, gid));
      if (sub === 'live' && method === 'GET') {
        games.memberGame(user, gid, 'player');
        return void joinLive(gid, user, res);
      }
      if (sub === 'presence' && method === 'POST') return games.memberGame(user, gid, 'player'), send(res, 200, setPresence(gid, conn ?? '', user.id, await readJson(req)));
      if (sub === 'files' && (method === 'PUT' || method === 'POST')) {
        games.memberGame(user, gid, 'editor');
        try {
          return send(res, 200, games.writeFile(user, gid, await readJson(req), { conn }));
        } catch (e: any) {
          if (e.status === 409 && e.file) return send(res, 409, { error: e.message, file: e.file });
          throw e;
        }
      }
      if (sub === 'files' && method === 'DELETE') return send(res, 200, games.deleteFile(user, gid, url.searchParams.get('path'), conn));
      if (sub === 'files/rename' && method === 'POST') return send(res, 200, games.renameFile(user, gid, await readJson(req), conn));
      if (sub === 'assets' && method === 'POST') return send(res, 200, await games.addAsset(user, gid, await readJson(req)));
      if (sub === 'community' && method === 'POST') {
        const b = await readJson(req);
        const r = await community.useInGame(user, gid, b);
        if (b.messageId && Number.isInteger(b.suggestion)) markSuggestion(String(b.messageId), b.suggestion, null, r.item);
        return send(res, 200, r);
      }
      const an = /^assets\/([^/]+)(\/rename)?$/.exec(sub);
      if (an && method === 'DELETE' && !an[2]) return send(res, 200, games.removeAsset(user, gid, decodeURIComponent(an[1])));
      if (an && method === 'POST' && an[2]) return send(res, 200, games.renameAsset(user, gid, decodeURIComponent(an[1]), (await readJson(req)).name));
      if (sub === 'bundle' && method === 'GET') return send(res, 200, games.draftBundle(user, gid));
      if (sub === 'scene' && method === 'POST') {
        const b = await readJson(req);
        const r = games.sceneOps(user, gid, b.ops, { by: user.name ?? undefined });
        // X-Room-Conn: the sender's own engine already shows the change.
        if (r.applied.length) broadcastOps(gid, r.applied, user.name ?? 'Someone', typeof b.fx === 'string' ? b.fx.slice(0, 20) : null, String(req.headers['x-room-conn'] ?? '') || undefined);
        return send(res, 200, { errors: r.errors, created: r.created, rev: r.rev });
      }
      if ((sub === 'save' || sub === 'publish') && method === 'POST') return send(res, 200, games.saveGame(user, gid, await readJson(req)));
      if (sub === 'saves' && method === 'GET') { games.memberGame(user, gid, 'player'); return send(res, 200, { saves: games.releases(gid) }); }
      if (sub === 'live-version' && method === 'POST') return send(res, 200, games.setLive(user, gid, (await readJson(req)).version));
      const rr = /^releases\/(\d+)\/restore$/.exec(sub);
      if (rr && method === 'POST') return send(res, 200, games.restoreRelease(user, gid, Number(rr[1])));
      if (sub === 'invites' && method === 'POST') return send(res, 200, games.createInvite(user, gid));
      const mem = new RegExp(`^members/(${USER_ID})$`).exec(sub);
      if (mem && method === 'POST') return send(res, 200, games.setMemberRole(user, gid, mem[1], (await readJson(req)).role));
      if (mem && method === 'DELETE') return send(res, 200, games.removeMember(user, gid, mem[1]));
      if (sub === 'chat' && method === 'GET') return send(res, 200, games.chatHistory(user, gid, Number(url.searchParams.get('limit')) || 80));
      if (sub === 'chat' && method === 'POST') return send(res, 200, games.postChat(user, gid, (await readJson(req)).text));
      if (sub === 'ai' && method === 'POST') return send(res, 200, await askAssistant(user, gid, await readJson(req)));
      if (sub === 'generate' && method === 'GET') return send(res, 200, pendingGens(user, gid));
      if (sub === 'generate' && method === 'POST') {
        const b = await readJson(req);
        const g = await generateAsset(user, gid, b);
        if (b.messageId && Number.isInteger(b.suggestion)) markSuggestion(String(b.messageId), b.suggestion, g.task_id);
        return send(res, 200, g);
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (route === '/v1/billing/ledger' && method === 'GET') return send(res, 200, ledger(user.id, Number(url.searchParams.get('limit')) || 100));

    // ------------------------------------------------------------ admins (anyone else gets a 404)
    if (route.startsWith('/v1/admin/')) {
      admin.requireAdmin(user);
      const m = new RegExp(`^/v1/admin/users/(${USER_ID})(?:/(credits|gift|disable|enable|role|password-link))?$`).exec(route);
      if (route === '/v1/admin/overview' && method === 'GET') return send(res, 200, admin.overview());
      if (route === '/v1/admin/community/sync' && method === 'POST') return send(res, 200, await community.syncStarter());
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
  resumeGens();
  community.watchStarter();
  const server = http.createServer((req, res) => void handle(req, res));
  server.on('upgrade', onUpgrade);
  server.listen(PORT, '127.0.0.1', () => console.log(`[portal] http://127.0.0.1:${PORT}`));
}
