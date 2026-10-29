// Hawkes Net for the games here (src/hnet.ts; hawkesgen docs/net.md): the engine's rooms run on the Hawkes Net service
// (https://net.hawkesgen.ai: tickets, rooms and the relay). The game pages are sandboxed and hold no keys, so they ask
// here for a ticket and the portal asks the service with its Gen key (which the service checks with Gen). This module also
// says whether an invitation's room is open, sends world edits into the rooms (for the games area), serves the Net
// dashboard's account routes (with CORS for https://net.hawkesgen.ai and credentials) and its two redirects.
//
// Room names (one Hawkes Net project, "hawkesgenwebsite"):
//   g/<gameId>/edit          the game's members in the editor (a signed edit token from /bundle)
//   g/<gameId>/p/<code>      people playing a game together (/play/<slug>?room=<code>; "live" is the public room)
//   t/<template>/<code>      an Overseer game or the guest island played together (/play/t/<id>, island invitations)
//   d/<code>                 the public demo on /net
//
// There are no rooms in this process any more (no /v1/ws on Cloud Functions), so PORTAL_NET defaults to "hawkesnet":
// every ticket is a Hawkes Net ticket. "auto" (ask the service's /v1/net/status, cached 30 s per instance) still works;
// "local" answers { mode: 'local' } as before, for a page that still has its own rooms to go to.
import type { Request } from 'firebase-functions/https';
import type { Response } from 'express';
import { env } from './config.ts';
import { genHeaders, type GenCall } from './gen.ts';
import { verify } from './sign.ts';
import { db } from './store.ts';
import { PortalError, Limiter, route, send, json, redirect } from './http.ts';
import { getUser, requireUser, profile, type User } from './accounts.ts';
import { orgContext } from './orgs.ts';

export const NET_PROJECT = 'hawkesgenwebsite';
const CODE = /^[a-z0-9]{4,16}$/;
// Soft limits (one function instance's view): the service has its own.
const ticketsByIp = new Limiter(40, 60_000);
const customerTickets = new Limiter(600, 60_000);
const projectCalls = new Limiter(120, 60_000);

/** The Hawkes Net service: tickets, room info and publish go here (not through Gen, which only checks the key). */
export const netUrl = () => (env('PORTAL_NET_URL') ?? 'https://net.hawkesgen.ai').replace(/\/+$/, '');
/** The Net dashboard (its own site): the one origin that may call the account routes below with the session. */
export const netDashboard = () => (env('PORTAL_NET_DASHBOARD') ?? 'https://net.hawkesgen.ai').replace(/\/+$/, '');

async function netFetch(path: string, o: GenCall = {}) {
  return fetch(`${netUrl()}${path}`, {
    method: o.method ?? (o.body !== undefined ? 'POST' : 'GET'),
    headers: genHeaders(o.as, o.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    signal: o.signal ?? AbortSignal.timeout(15_000),
  });
}
/** A call to the Hawkes Net service, its JSON answer or a PortalError (a 401 there is our key's problem: 502). */
async function net<T = any>(path: string, o: GenCall = {}): Promise<T> {
  let r: globalThis.Response;
  try { r = await netFetch(path, o); }
  catch (e: any) { throw new PortalError(`Multiplayer is not answering (${e.name === 'TimeoutError' ? 'timed out' : e.message}); try again in a minute`, { status: 503 }); }
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new PortalError(data?.error ?? `Multiplayer answered ${r.status}`, { status: r.status === 401 ? 502 : r.status });
  return data as T;
}

// A cache of the service's answer for "auto" (an instance's own; nothing relies on it being shared).
let state = { at: 0, up: false };
/** Should the engine use Hawkes Net? */
export async function netUp(): Promise<boolean> {
  const mode = env('PORTAL_NET') ?? 'hawkesnet';
  if (mode === 'local') return false;
  if (mode !== 'auto') return true;
  if (Date.now() - state.at < 30_000) return state.up;
  state.at = Date.now();
  try {
    const r = await netFetch('/v1/net/status', { signal: AbortSignal.timeout(4000) });
    state.up = r.ok && Boolean((await r.json() as any)?.up);
  } catch { state.up = false; }
  return state.up;
}

/** What a game page must be allowed to reach (its Content-Security-Policy): the Hawkes Net service's sockets, plus any
 *  other relay boxes named in PORTAL_NET_HOSTS (wss://net2.hawkesgen.ai,...). */
export function netHosts(): string[] {
  const g = new URL(netUrl());
  const own = `${g.protocol === 'https:' ? 'wss' : 'ws'}://${g.host}`;
  const extra = (env('PORTAL_NET_HOSTS') ?? '').split(',').map((h) => h.trim().replace(/\/+$/, '')).filter((h) => /^wss?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(h));
  return [...new Set([own, ...extra])];
}

const clean = (v: unknown) => String(v ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 24);

/**
 * What a ticket needs to know about games, which are the games area's: it replaces these when it loads (as caller.ts
 * accessTokens). They read Firestore where games.ts keeps it: games/{id} (slug, hidden) and games/{id}/members/{user_id}
 * (role), which cloud/migrate.mjs writes the same way.
 */
export const netGames = {
  /** Throws 404 unless `user` is a member of the game (any role: playing is enough). */
  async member(user: User, gameId: string): Promise<void> {
    const g0 = db.collection('games').doc(gameId);
    const [g, m] = await db.getAll(g0, g0.collection('members').doc(user.id));
    if (!g.exists || !m.exists) throw new PortalError('No such game', { status: 404 });
  },
  /** A game by its slug (null when there is none). */
  async bySlug(slug: string): Promise<{ id: string; hidden?: unknown } | null> {
    const s = await db.collection('games').where('slug', '==', String(slug).toLowerCase()).limit(1).get();
    return s.empty ? null : { id: s.docs[0].id, hidden: s.docs[0].get('hidden') };
  },
  /** Is there a starter game (template) with this id? (src/templates.ts TEMPLATES) */
  template(id: string): boolean {
    return ['fps-arena', 'sky-racer', 'platform-run', 'collector', 'runner', 'arena', 'blank', 'planet', 'sandbox'].includes(id);
  },
};

/**
 * POST /v1/net/ticket from a game page: { token } (the editor's room) or { play: '<slug>' | 't/<id>' | 'net-demo',
 * room: '<code>', name, join }. Answers { mode: 'local' } when Hawkes Net isn't in use, else the service's ticket answer
 * plus { mode: 'hawkesnet', room }.
 */
export async function ticket(body: any, ip: string) {
  if (!(await netUp())) return { mode: 'local' };
  let room: string, name: string | null, sub: string | undefined;
  const transport = 'relay'; // every room on the relay (J, 2026-10-26: peer to peer is not the default)
  if (body?.token) {
    const v = verify<{ k: string; g: string; u: string }>(String(body.token));
    if (!v || v.k !== 'edit') throw new PortalError('This link has expired; reload the editor', { status: 401 });
    const user = await getUser(v.u);
    if (!user || user.disabled) throw new PortalError('No such game', { status: 404 });
    await netGames.member(user, v.g);
    room = `g/${v.g}/edit`; name = user.name ?? 'Builder'; sub = user.id;
  } else if (body?.play === 'net-demo') {
    // The public demo (/net): dots in a room, anyone, a few joins a minute per address.
    if (!ticketsByIp.hit(ip)) throw new PortalError('Too many joins from here; wait a moment', { status: 429 });
    const code = String(body?.room ?? '').toLowerCase();
    if (!CODE.test(code)) throw new PortalError('A room code is 4 to 16 letters and numbers');
    room = `d/${code}`; name = clean(body?.name) || null;
    const r: any = await net('/v1/net/ticket', { body: { project: NET_PROJECT, room, name, transport, role: 'player', config: { profile: 'light', maxPlayers: 32, p2pMax: 8 }, client: { sdk: String(body?.sdk ?? ''), protocols: [3] } } });
    return { mode: 'hawkesnet', room, ...r };
  } else {
    if (!ticketsByIp.hit(ip)) throw new PortalError('Too many joins from here; wait a moment', { status: 429 });
    const play = String(body?.play ?? '');
    const code = String(body?.room ?? '').toLowerCase();
    if (!CODE.test(code)) throw new PortalError('A room code is 4 to 16 letters and numbers');
    const t = /^t\/([a-z0-9-]+)$/.exec(play);
    if (t) {
      if (!netGames.template(t[1])) throw new PortalError('No such game', { status: 404 });
      room = `t/${t[1]}/${code}`;
    } else {
      const g = await netGames.bySlug(play);
      if (!g || g.hidden) throw new PortalError('No such game', { status: 404 });
      room = `g/${g.id}/p/${code}`;
    }
    // A friend answering an invitation joins the room that is there; it never makes an empty one.
    if (body?.join) {
      const info = await roomInfo(room);
      if (!info.open) throw new PortalError('This island is closed', { status: 409 });
    }
    name = clean(body?.name) || null;
  }
  const r: any = await net('/v1/net/ticket', { body: { project: NET_PROJECT, room, name, sub, transport, role: 'player', client: { sdk: String(body?.sdk ?? ''), protocols: [3] } } });
  return { mode: 'hawkesnet', room, ...r };
}

/** May this account's own games use Hawkes Net's live rooms? Its personal org's `net` entitlement (orgs.ts): a paid plan,
 *  or a purchase (before plans carried Net, buying credits did; orgs.ts grants it). Relay traffic is ours until billed. */
const paid = async (user: User) => (await orgContext(user)).entitlements.net.rooms === 'live';

/**
 * A customer's own game (POST /v1/net/rooms/ticket with their API key, from their game's server): a ticket for a room in
 * one of their Hawkes Net projects, the portal's key narrowed to their account.
 */
export async function customerTicket(user: User, body: any) {
  if (user.role !== 'admin' && !(await paid(user))) throw new PortalError('Hawkes Net for your own games needs an account that has bought credits or a plan', { status: 402 });
  customerTickets.take(user.id, 'Too many tickets a minute for this account');
  const project = String(body?.project ?? '');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(project)) throw new PortalError('project is your Hawkes Net project id (net.hawkesgen.ai)');
  const room = String(body?.room ?? '');
  if (!/^[a-z0-9][a-z0-9/_.-]{0,63}$/i.test(room)) throw new PortalError('room is 1 to 64 of letters, digits and / _ . -');
  const transport = ['auto', 'p2p', 'relay'].includes(body?.transport) ? body.transport : 'relay';
  const config = body?.config && typeof body.config === 'object' ? { maxPlayers: body.config.maxPlayers, p2pMax: body.config.p2pMax, profile: body.config.profile, sendHz: body.config.sendHz } : undefined;
  const role = body?.role === 'spectator' ? 'spectator' : 'player';
  return net('/v1/net/ticket', { as: user.project, body: { project, room, name: clean(body?.name) || null, sub: typeof body?.sub === 'string' ? body.sub.slice(0, 64) : undefined, transport, role, config, client: { sdk: String(body?.sdk ?? ''), protocols: [3] } } });
}

// ------------------------------------------------------------ Hawkes Net projects (the net.hawkesgen.ai dashboard)

const who = async (user: User) => ({ owner: user.project, admin: user.role === 'admin', tier: user.role === 'admin' || (await paid(user)) ? 'paid' : 'free' });
const whoQuery = async (user: User) => { const w = await who(user); return `owner=${encodeURIComponent(w.owner)}&admin=${w.admin}&tier=${w.tier}`; };
const PID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const pid = (id: string) => { if (!PID.test(id)) throw new PortalError('No such project', { status: 404 }); return encodeURIComponent(id); };
const ROOM = /^[a-z0-9][a-z0-9/_.-]{0,63}$/i;
const slow = (user: User) => projectCalls.take(user.id, 'Too many requests a minute; wait a moment');

export async function projects(user: User, all = false) {
  slow(user);
  return net(`/v1/net/projects?${await whoQuery(user)}${all && user.role === 'admin' ? '&all=1' : ''}`);
}
export async function createProject(user: User, body: any) {
  slow(user);
  return net('/v1/net/projects', { body: { ...(await who(user)), name: String(body?.name ?? '').slice(0, 80), ...(body?.id ? { id: String(body.id).slice(0, 40) } : {}) } });
}
export async function project(user: User, id: string) {
  slow(user);
  return net(`/v1/net/projects/${pid(id)}?${await whoQuery(user)}`);
}
export async function updateProject(user: User, id: string, body: any) {
  slow(user);
  const w = await who(user);
  const sites = Array.isArray(body?.sites) ? body.sites.slice(0, 50).map((o: unknown) => String(o ?? '').slice(0, 200)) : body?.sites === null ? null : undefined;
  if (sites && sites.some((s: string) => s.trim()) && w.tier !== 'paid') throw new PortalError("Your game's own sites open once your account has bought credits or a plan. Until then, test on localhost: it always may join the test rooms.", { status: 402 });
  const patch: Record<string, unknown> = {};
  if (body?.name !== undefined) patch.name = String(body.name).slice(0, 80);
  if (sites !== undefined) patch.sites = sites;
  if (body?.p2p !== undefined) patch.p2p = body.p2p === true;
  if (body?.maxPlayers !== undefined) patch.maxPlayers = body.maxPlayers === null ? null : Number(body.maxPlayers);
  return net(`/v1/net/projects/${pid(id)}`, { body: { ...w, ...patch } });
}
export async function deleteProject(user: User, id: string) {
  slow(user);
  return net(`/v1/net/projects/${pid(id)}?${await whoQuery(user)}`, { method: 'DELETE' });
}
export async function claimProject(user: User, id: string) {
  if (user.role !== 'admin') throw new PortalError('Only an admin takes one of Hawkes\'s games', { status: 403 });
  return net(`/v1/net/projects/${pid(id)}/claim`, { body: await who(user) });
}
export async function roomPlayers(user: User, id: string, room: string) {
  slow(user);
  if (!ROOM.test(room)) throw new PortalError('No such room', { status: 404 });
  return net(`/v1/net/projects/${pid(id)}/rooms/${encodeURIComponent(room)}?${await whoQuery(user)}`);
}
export async function kickPlayer(user: User, id: string, room: string, body: any) {
  if (!ROOM.test(room)) throw new PortalError('No such room', { status: 404 });
  return net(`/v1/net/projects/${pid(id)}/rooms/${encodeURIComponent(room)}/kick`, { body: { ...(await who(user)), sub: typeof body?.sub === 'string' ? body.sub.slice(0, 64) : undefined, peer: typeof body?.peer === 'string' ? body.peer.slice(0, 12) : undefined } });
}

/** The developer's account on the Hawkes Net dashboard (GET /v1/net/me). A part that fails says so instead of failing. */
export async function developer(user: User) {
  const w = await who(user);
  const key = (await profile(user)).client;
  const list = await projects(user).catch((e: Error) => ({ error: e.message }));
  return { project: user.project, email: user.email ?? null, name: user.name ?? null, paid: w.tier === 'paid', admin: w.admin, key: key ? { prefix: key.prefix, created: key.created, lastUsed: key.last_used } : null, service: netUrl(), projects: list };
}

/** Is a room open and how full? (Invitations ask before a friend loads anything.) */
export async function roomInfo(room: string, again = true): Promise<{ open: boolean; people: number; limit: number }> {
  let info: { open: boolean; people: number; limit: number };
  try {
    const r: any = await net('/v1/net/room', { body: { project: NET_PROJECT, room } });
    info = { open: Boolean(r.open), people: Number(r.players) || 0, limit: Number(r.limit) || 32 };
  } catch (e) {
    console.warn(`[portal] hawkes net room info for ${room}: ${(e as Error).message}`);
    info = { open: false, people: 0, limit: 32 };
  }
  // An island whose player is reconnecting (a sign-in, a phone that woke) is empty for a second: ask once more before
  // telling a friend it is closed.
  if (!info.open && again) {
    await new Promise((r) => setTimeout(r, 1500));
    return roomInfo(room, false);
  }
  return info;
}

// For the games area. A function may stop running once it has answered, so these are awaited by the caller (they never
// throw: a failure is logged, the request goes on).
const quietly = async (what: string, body: unknown) => {
  if (!(await netUp())) return;
  await net('/v1/net/publish', { body }).then(() => undefined, (e: Error) => console.warn(`[portal] hawkes net ${what}: ${e.message}`));
};
/** World edits this server saved: into the game's editor room and every play room of it. */
export const publishOps = (gameId: string, ops: unknown[], by: string, fx: string | null, except?: string) =>
  ops.length ? quietly('publish', { project: NET_PROJECT, room: `g/${gameId}/*`, ops, by, fx, except: except ?? null }) : Promise.resolve();
/** Puts people out of a game's rooms: everyone under `room` ("g/<id>/p/*"), or only those who joined as `sub`. */
export const kick = (room: string, sub?: string) => quietly('kick', { project: NET_PROJECT, room, kick: { sub: sub ?? null } });
/** A server event to the editor room (an asset arrived, a script was saved). */
export const publishEvent = (gameId: string, name: string, data: unknown) => quietly('event', { project: NET_PROJECT, room: `g/${gameId}/edit`, event: { name, data } });

// ------------------------------------------------------------ CORS for the Net dashboard

// The Net dashboard (net.hawkesgen.ai) reads the signed-in developer's Net data and makes their key here, with the
// session cookie. Only that origin, only these routes, credentials allowed (src/server.ts NET_DASHBOARD_ROUTES).
export const NET_DASHBOARD_ROUTES = /^\/v1\/(net\/me|net\/projects(\/.*)?|users\/api-key|users\/(login|signup|forgot|logout))$/;
/** Sets the dashboard's CORS headers when the request comes from it; true when it did. */
export function netDashboardCors(req: Request, res: Response): boolean {
  if (req.headers.origin !== netDashboard()) return false;
  res.set({
    'Access-Control-Allow-Origin': netDashboard(),
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  });
  return true;
}
route('OPTIONS', NET_DASHBOARD_ROUTES, ({ req, res }) => {
  if (netDashboardCors(req, res)) return void res.status(204).set('Access-Control-Max-Age', '600').end();
  send(res, 404, { error: 'Not found' });
});

// ------------------------------------------------------------ routes

// Back to the Net dashboard after signing in here (Google's next= takes paths on this site only).
route('GET', '/net/back', ({ res }) => redirect(res, netDashboard() + '/'));
// The Hawkes Net docs live on net.hawkesgen.ai (J, 2026-10-26).
route('GET', '/net/docs', ({ res }) => redirect(res, netDashboard() + '/', 301));

// Tickets for the engine's rooms. Open CORS: game pages are sandboxed (origin null) and send no cookies.
const ticketCors = (res: Response) => void res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
route('OPTIONS', '/v1/net/ticket', ({ res }) => { ticketCors(res); res.status(204).end(); });
route('POST', '/v1/net/ticket', async ({ req, res, ip }) => { ticketCors(res); return ticket(json(req), ip); });

// A customer's own game: a ticket in their own project, from their game's server (their API key).
route('POST', '/v1/net/rooms/ticket', async ({ req }) => customerTicket(await requireUser(req), json(req)));
route('GET', '/v1/net/me', async ({ req, res }) => { netDashboardCors(req, res); return developer(await requireUser(req)); });

// Projects: the signed-in account's own. Writes are JSON only: a form on another site can't send one without asking
// first, and CORS lets only the Net dashboard.
const NP = /^\/v1\/net\/projects(?:\/([^/]+)(?:\/(claim|rooms)(?:\/(.+?)(?:\/(kick))?)?)?)?$/;
for (const method of ['GET', 'POST', 'DELETE', 'PUT', 'PATCH']) {
  route(method, NP, async ({ req, res, url, params }) => {
    netDashboardCors(req, res);
    const user = await requireUser(req);
    const [id, part, roomRaw, kickIt] = params;
    const room = roomRaw ? decodeURIComponent(roomRaw) : '';
    const body = () => { if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw new PortalError('Send JSON', { status: 415 }); return json(req); };
    if (!id && method === 'GET') return projects(user, url.searchParams.get('all') === '1');
    if (!id && method === 'POST') return createProject(user, body());
    if (id && !part && method === 'GET') return project(user, id);
    if (id && !part && method === 'POST') return updateProject(user, id, body());
    if (id && !part && method === 'DELETE') return deleteProject(user, id);
    if (id && part === 'claim' && method === 'POST') { body(); return claimProject(user, id); }
    if (id && part === 'rooms' && room && !kickIt && method === 'GET') return roomPlayers(user, id, room);
    if (id && part === 'rooms' && room && kickIt && method === 'POST') return kickPlayer(user, id, room, body());
    send(res, 405, { error: 'Not a projects route' });
  });
}
