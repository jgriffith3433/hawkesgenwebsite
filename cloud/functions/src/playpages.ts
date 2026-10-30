// Playing games (server.ts's play routes on the old box): the play page with its sandbox and Content-Security-Policy,
// closed worlds, the engine's loader and docs, game asset files from Gen, the Overseer games' bundles, the gallery, the
// "I'm here" pings and reports. Firebase Hosting serves everything static under /play/ itself (runtime.js, modules...);
// what reaches the function here is what the old server made (firebase.json rewrites /play/** and /play-asset/**).
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import type { Request } from 'firebase-functions/https';
import { env, publicUrl } from './config.ts';
import { genFetch } from './gen.ts';
import { authenticate } from './accounts.ts';
import { PortalError, route, send, Limiter } from './http.ts';
import { closedHtml, engineDoc, loaderScript, playHtml, templates } from './engine.ts';
import { cdnHosts, digest, gallery, gameBySlug, isClosed, netUrl, playBundle, reportGame, resolvePlayAsset, templateAssets } from './games.ts';
import { liveCounts, markHere } from './live.ts';

// A game runs in a sandbox: its own opaque origin, so its scripts can't read this site's cookies or call its API as the
// player. No allow-popups-to-escape-sandbox and no top navigation.
const PLAY_SANDBOX = 'sandbox allow-scripts allow-pointer-lock allow-popups';
/** Hawkes Net's sockets (hnet.ts netHosts): the service's own, plus PORTAL_NET_HOSTS. */
export function netHosts(): string[] {
  const g = new URL(netUrl());
  const own = `${g.protocol === 'https:' ? 'wss' : 'ws'}://${g.host}`;
  const extra = (env('PORTAL_NET_HOSTS') ?? '').split(',').map((h) => h.trim().replace(/\/+$/, '')).filter((h) => /^wss?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(h));
  return [...new Set([own, ...extra])];
}
/** What a game page may load and call. ADD A HOST HERE only when the engine starts to use one. */
const PLAY_HOSTS = {
  gen: ['https://hawkesgen.ai'],
  models: ['https://models.babylonjs.com'],
  get realtime(): string[] { return netHosts(); },
  get assets(): string[] { return cdnHosts(); },
};
export function playCsp(nonce: string): string {
  const self = new URL(publicUrl()).host;
  const ws = `${publicUrl().startsWith('https:') ? 'wss' : 'ws'}://${self}`;
  const list = (...a: string[][]) => a.flat().join(' ');
  return [
    PLAY_SANDBOX,
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' 'wasm-unsafe-eval' ${list(PLAY_HOSTS.gen)}`,
    `connect-src 'self' blob: data: ${ws} ${list(PLAY_HOSTS.realtime, PLAY_HOSTS.gen, PLAY_HOSTS.models, PLAY_HOSTS.assets)}`,
    `img-src 'self' data: blob: ${list(PLAY_HOSTS.assets, PLAY_HOSTS.models)}`,
    `media-src 'self' data: blob: ${list(PLAY_HOSTS.assets)}`,
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src blob: 'self'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].map((d) => d.replace(/\s+/g, ' ').trim()).join('; ');
}

/** A signed-in player's analytics ids (src/analytics.ts playIds): the sandboxed page has no storage to keep its own. */
const playIdsScript = (ids: { anon: string; user: string } | null) => (ids ? `<script>window.HAWKES_PLAY_IDS=${JSON.stringify(ids).replace(/</g, '\\u003c')};</script>` : '');

async function servePlayPage(req: Request, res: Response, o: { guest?: boolean } = {}) {
  // The guest sandbox and the Overseer's featured games run only our own scripts: served without the play sandbox.
  const open = o.guest === true;
  const nonce = crypto.randomBytes(16).toString('base64');
  let html = playHtml();
  if (!o.guest) {
    const user = await authenticate(req).catch(() => null);
    if (user) html = html.replace('</head>', `${playIdsScript({ anon: `u_${digest(`analytics:${user.id}`).slice(0, 22)}`, user: user.id })}</head>`);
  }
  res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...(open ? {} : { 'Content-Security-Policy': playCsp(nonce) }), 'X-Content-Type-Options': 'nosniff' });
  res.send(req.method === 'HEAD' ? '' : html.replace(/<script>/g, `<script nonce="${nonce}">`));
}

/** A game's asset file, from Gen, for anyone playing it (open CORS: the game's sandbox has no origin). Streamed. */
async function servePlayAsset(parts: Parameters<typeof resolvePlayAsset>[0], lod: { lod?: number; v?: string | null }, req: Request, res: Response) {
  const a = await resolvePlayAsset(parts);
  const headers: Record<string, string> = {};
  if (req.headers.range) headers.Range = String(req.headers.range);
  if (req.headers['if-none-match']) headers['If-None-Match'] = String(req.headers['if-none-match']);
  const gr = await genFetch(`/v1/assets/${a.asset}/file${lod.lod ? `?lod=${lod.lod}` : ''}`, { as: a.project, headers, signal: AbortSignal.timeout(280_000) });
  if (!gr.ok && gr.status !== 206 && gr.status !== 304) throw new PortalError('File not found', { status: 404 });
  const named = Boolean(lod.v && /^[0-9a-f]{8,64}$/.test(lod.v) && String(gr.headers.get('etag') ?? '').replace(/"/g, '').startsWith(lod.v));
  const out: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': a.immutable || named ? 'public, max-age=31536000, immutable' : 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' };
  for (const h of ['content-type', 'content-length', 'accept-ranges', 'content-range', 'etag']) {
    const v = gr.headers.get(h);
    if (v) out[h] = v;
  }
  // Never let an asset render as a page on this origin.
  if (/html|xml|javascript/i.test(out['content-type'] ?? '')) out['content-type'] = 'application/octet-stream';
  res.status(gr.status).set(out);
  if (!gr.body || req.method === 'HEAD') return void res.end();
  const body = Readable.fromWeb(gr.body as any);
  body.on('error', () => { if (!res.destroyed) res.destroy(); });
  await pipeline(body, res).catch(() => {});
}

/** A body sent as text/plain or JSON (the sandboxed play page sends simple requests: no preflight). */
function smallJson(req: Request, max: number): any {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = (req.rawBody ?? Buffer.alloc(0));
  if (raw.length > max) throw new PortalError('That is too long', { status: 413 });
  try { return JSON.parse(raw.toString('utf8') || '{}'); } catch { throw new PortalError('That report could not be read'); }
}

// ------------------------------------------------------------------ the engine
route('GET', '/play/modules.js', ({ res }) => void res.status(200).set({ 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }).send(loaderScript()));
for (const [p, which] of [['/play/WORLD.md', 'world'], ['/play/API.md', 'api']] as const) {
  route('GET', p, ({ res }) => void res.status(200).set({ 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-cache' }).send(engineDoc(which)));
}

// ------------------------------------------------------------------ the play pages
route('GET', '/play/sandbox', ({ req, res }) => servePlayPage(req, res, { guest: true }));
route('GET', /^\/play\/(_draft|t\/[a-z0-9-]+|[a-z0-9-]+(?:\/v\/\d+)?)$/, async ({ req, res, route: path }) => {
  // The Overseer's featured games are our own scripts, like the sandbox: served without the play sandbox.
  const featuredId = /^\/play\/t\/([a-z0-9-]+)$/.exec(path)?.[1];
  if (featuredId && (await templates()).featured().some((f) => f.id === featuredId)) return servePlayPage(req, res, { guest: true });
  // A world an admin closed: a plain page, with no scripts and no bundle.
  const closed = /^\/play\/([a-z0-9-]+)(?:\/v\/\d+)?$/.exec(path)?.[1];
  if (closed && closed !== '_draft' && (await isClosed(closed))) {
    return void res.status(410).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'", 'X-Content-Type-Options': 'nosniff' }).send(req.method === 'HEAD' ? '' : closedHtml());
  }
  return servePlayPage(req, res);
});

// ------------------------------------------------------------------ asset files
const lodOf = (url: URL) => ({ lod: Number(url.searchParams.get('lod')) || undefined, v: url.searchParams.get('v') });
route('GET', /^\/play-asset\/d\/([\w-]+\.[\w-]+)\/[^/]+$/, ({ req, res, url, params }) => servePlayAsset({ token: params[0] }, lodOf(url), req, res));
route('GET', /^\/play-asset\/([a-z0-9-]+)\/(\d+|live)\/([^/]+)$/, ({ req, res, url, params }) =>
  servePlayAsset({ slug: params[0], version: params[1] === 'live' ? 'live' : Number(params[1]), name: decodeURIComponent(params[2]) }, lodOf(url), req, res));

// ------------------------------------------------------------------ open routes
route('GET', /^\/v1\/play-template\/([a-z0-9-]+)$/, async ({ req, res, params }) => {
  const T = await templates();
  const b = T.templateBundle(params[0]);
  if (!b) return send(res, 404, { error: 'No such game' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  // A revisit within a minute is the browser's own copy; after that it revalidates (304).
  const text = JSON.stringify({ ...b, assets: await templateAssets(b.template) });
  const etag = `"${crypto.createHash('sha1').update(text).digest('base64url').slice(0, 22)}"`;
  const headers = { ETag: etag, 'Cache-Control': 'public, max-age=60, must-revalidate', 'Access-Control-Expose-Headers': 'ETag' };
  if (String(req.headers['if-none-match'] ?? '').split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) return void res.status(304).set(headers).end();
  res.status(200).set({ ...headers, 'Content-Type': 'application/json; charset=utf-8' }).send(text);
});

route('GET', '/v1/gallery', async ({ url }) => {
  const so = url.searchParams.get('sort');
  return gallery(so === 'new' ? 'new' : so === 'popular' ? 'popular' : 'live', Number(url.searchParams.get('limit')) || 60);
});

// "I'm here" pings (every 30 s a page): per page session, with a cap per address. (Per instance: a soft limit.)
const herePings = new Limiter(10, 60_000);
const herePingsByIp = new Limiter(600, 60_000);
route('POST', /^\/v1\/play\/(t\/[a-z0-9-]+|[a-z0-9-]+)\/here$/, async ({ req, res, ip, params }) => {
  const t = /^t\/(.+)$/.exec(params[0]);
  const g = t ? null : await gameBySlug(params[0]);
  if (!t && (!g || g.hidden)) return send(res, 404, { error: 'No such game' });
  const gid = t ? `t:${t[1]}` : g!.id;
  let s = '';
  try { s = String(smallJson(req, 4096)?.s ?? '').slice(0, 32); } catch {}
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!herePingsByIp.hit(`${ip}:${gid}`) || !herePings.hit(`${ip}:${gid}:${s}`)) return send(res, 429, { error: 'Once every few seconds is enough' });
  await markHere(gid, s);
  return liveCounts(gid);
});

// Report a world: from its pause menu or the gallery, signed in or not. text/plain keeps it a simple request; open CORS.
const reportsMade = new Limiter(10, 3600_000);
route('OPTIONS', /^\/v1\/play\/([a-z0-9-]+)\/report$/, ({ res }) => void res.status(204).set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }).end());
route('POST', /^\/v1\/play\/([a-z0-9-]+)\/report$/, async ({ req, res, ip, params }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  reportsMade.take(ip, 'You have sent a lot of reports; try again in a while');
  const b = smallJson(req, 4096);
  return reportGame(params[0], b, (await authenticate(req).catch(() => null))?.id ?? null, ip);
});

route('GET', /^\/v1\/play\/([a-z0-9-]+)$/, async ({ req, res, url, ip, params }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const me = await authenticate(req).catch(() => null);
  return playBundle(params[0], url.searchParams.get('v') ? Number(url.searchParams.get('v')) : null, me ? me.id : `ip:${digest(ip).slice(0, 22)}`);
});
