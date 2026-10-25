// Hawkes Net for the games here (hawkesgen docs/net.md): the engine's rooms run on Hawkes Gen's relay nodes and peer to
// peer, not in this process. This file hands out tickets for them (the game pages are sandboxed and hold no keys, so
// they ask here and the portal asks Gen with its key), sends the world edits this server saves into the rooms, and says
// whether an invitation's room is open.
//
// Room names (one Hawkes Net project, "hawkesgenwebsite"):
//   g/<gameId>/edit          the game's members in the editor (a signed edit token from /bundle)
//   g/<gameId>/p/<code>      people playing a game together (/play/<slug>?room=<code>; "live" is the public room)
//   t/<template>/<code>      an Overseer game or the guest island played together (/play/t/<id>, island invitations)
// A world edit is published to "g/<gameId>/*", so the editor and every play room of the game hear it.
//
// PORTAL_NET: "auto" (the default: Hawkes Net when Gen says a node is up, else the rooms in this process), "hawkesnet"
// or "local". The rooms in this process (rooms.ts) stay for "local" and for pages already open on /v1/ws.
import { env, genUrl } from './config.ts';
import { genFetch, gen } from './gen.ts';
import { verify } from './sign.ts';
import { PortalError, Limiter } from './util.ts';
import { getUser, type User } from './users.ts';
import { db } from './db.ts';
import { gameBySlug, getGame, memberGame } from './games.ts';
import { templateBundle } from './templates.ts';

export const NET_PROJECT = 'hawkesgenwebsite';
const CODE = /^[a-z0-9]{4,16}$/;
const ticketsByIp = new Limiter(40, 60_000);
const customerTickets = new Limiter(600, 60_000);

let state = { at: 0, up: false };
/** Should the engine use Hawkes Net? (Gen's /v1/net/status, asked at most every 30 s.) */
export async function netUp(): Promise<boolean> {
  const mode = env('PORTAL_NET') ?? 'auto';
  if (mode === 'local') return false;
  if (mode === 'hawkesnet') return true;
  if (Date.now() - state.at < 30_000) return state.up;
  state.at = Date.now();
  try {
    const r = await genFetch('/v1/net/status', { signal: AbortSignal.timeout(4000) });
    state.up = r.ok && Boolean((await r.json() as any)?.up);
  } catch { state.up = false; }
  return state.up;
}
/** The last answer, without asking (for code that can't wait). */
export const netUpCached = () => (env('PORTAL_NET') === 'hawkesnet' ? true : env('PORTAL_NET') === 'local' ? false : state.up);

/** The relay hosts a game page must be allowed to reach (its Content-Security-Policy): the node inside Gen, plus any
 *  relay boxes named in PORTAL_NET_HOSTS (wss://net.hawkesgen.com,...). */
export function netHosts(): string[] {
  const g = new URL(genUrl());
  const own = `${g.protocol === 'https:' ? 'wss' : 'ws'}://${g.host}`;
  const extra = (env('PORTAL_NET_HOSTS') ?? '').split(',').map((h) => h.trim().replace(/\/+$/, '')).filter((h) => /^wss?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(h));
  return [...new Set([own, ...extra])];
}

const clean = (v: unknown) => String(v ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 24);

/**
 * POST /v1/net/ticket from a game page: { token } (the editor's room) or { play: '<slug>' | 't/<id>', room: '<code>',
 * name, join }. Answers { mode: 'local' } when Hawkes Net isn't in use (the page uses /v1/ws as before), else Gen's
 * ticket answer plus { mode: 'hawkesnet', room }.
 */
export async function ticket(body: any, ip: string) {
  if (!(await netUp())) return { mode: 'local' };
  let room: string, name: string | null, sub: string | undefined, transport: 'auto' | 'relay' | 'p2p';
  if (body?.token) {
    const v = verify<{ k: string; g: string; u: string }>(String(body.token));
    if (!v || v.k !== 'edit') throw new PortalError('This link has expired; reload the editor', { status: 401 });
    const user = getUser(v.u);
    if (!user || user.disabled || !getGame(v.g)) throw new PortalError('No such game', { status: 404 });
    memberGame(user, v.g, 'player');
    room = `g/${v.g}/edit`; name = user.name ?? 'Builder'; sub = user.id; transport = 'relay';
  } else if (body?.play === 'net-demo') {
    // The public demo (/net): dots in a room, anyone, a few joins a minute per address.
    if (!ticketsByIp.hit(ip)) throw new PortalError('Too many joins from here; wait a moment', { status: 429 });
    const code = String(body?.room ?? '').toLowerCase();
    if (!CODE.test(code)) throw new PortalError('A room code is 4 to 16 letters and numbers');
    room = `d/${code}`; name = clean(body?.name) || null; transport = 'auto';
    const r: any = await gen('/v1/net/ticket', { body: { project: NET_PROJECT, room, name, transport, role: 'player', config: { profile: 'light', maxPlayers: 32, p2pMax: 8 }, client: { sdk: String(body?.sdk ?? ''), protocols: [3] } } });
    return { mode: 'hawkesnet', room, ...r };
  } else {
    if (!ticketsByIp.hit(ip)) throw new PortalError('Too many joins from here; wait a moment', { status: 429 });
    const play = String(body?.play ?? '');
    const code = String(body?.room ?? '').toLowerCase();
    if (!CODE.test(code)) throw new PortalError('A room code is 4 to 16 letters and numbers');
    const t = /^t\/([a-z0-9-]+)$/.exec(play);
    if (t) {
      if (!templateBundle(t[1])) throw new PortalError('No such game', { status: 404 });
      room = `t/${t[1]}/${code}`;
    } else {
      const g = gameBySlug(play);
      if (!g || g.hidden) throw new PortalError('No such game', { status: 404 });
      room = `g/${g.id}/p/${code}`;
    }
    // A friend answering an invitation joins the room that is there; it never makes an empty one.
    if (body?.join) {
      const info = await roomInfo(room);
      if (!info.open) throw new PortalError('This island is closed', { status: 409 });
    }
    name = clean(body?.name) || null;
    // The public live room of a game is many people: the relay from the start. Rooms of friends start peer to peer.
    transport = code === 'live' ? 'relay' : 'auto';
  }
  const r: any = await gen('/v1/net/ticket', { body: { project: NET_PROJECT, room, name, sub, transport, role: 'player', client: { sdk: String(body?.sdk ?? ''), protocols: [3] } } });
  return { mode: 'hawkesnet', room, ...r };
}

/**
 * A customer's own game (POST /v1/net/rooms/ticket with their API key, from their game's server): a ticket for a room in
 * their own Hawkes Net project (their Gen project, usr_...), so nobody else's game can join it. Their server hands the
 * ticket to the player's page, which passes it to join(). Usage is filed under their project in Gen.
 */
export async function customerTicket(user: User, body: any) {
  // Relay traffic costs us per byte and is not billed yet, so only accounts that have paid (or admins) get tickets: a
  // free sign-up can't run up the relay. (Studio's roadmap has the pricing decision.)
  if (user.role !== 'admin' && !paid(user.id)) throw new PortalError('Hawkes Net for your own games needs an account that has bought credits or a plan', { status: 402 });
  customerTickets.take(user.id, 'Too many tickets a minute for this account');
  const project = user.project;
  const room = String(body?.room ?? '');
  if (!/^[a-z0-9][a-z0-9/_.-]{0,63}$/i.test(room)) throw new PortalError('room is 1 to 64 of letters, digits and / _ . -');
  const transport = ['auto', 'p2p', 'relay'].includes(body?.transport) ? body.transport : 'auto';
  const config = body?.config && typeof body.config === 'object' ? { maxPlayers: body.config.maxPlayers, p2pMax: body.config.p2pMax, profile: body.config.profile, sendHz: body.config.sendHz } : undefined;
  const role = body?.role === 'spectator' ? 'spectator' : 'player';
  const r: any = await gen('/v1/net/ticket', { as: project, body: { project, room, name: clean(body?.name) || null, sub: typeof body?.sub === 'string' ? body.sub.slice(0, 64) : undefined, transport, role, config, client: { sdk: String(body?.sdk ?? ''), protocols: [3] } } });
  return r;
}

const paid = (userId: string) => !!db.prepare("SELECT 1 FROM credit_ledger WHERE user_id = ? AND kind IN ('stripe_purchase', 'subscription_credits') LIMIT 1").get(userId);

/** Is a room open and how full? (Invitations ask before a friend loads anything.) */
export async function roomInfo(room: string): Promise<{ open: boolean; people: number; limit: number }> {
  try {
    const r: any = await gen('/v1/net/room', { body: { project: NET_PROJECT, room } });
    return { open: Boolean(r.open), people: Number(r.players) || 0, limit: Number(r.limit) || 32 };
  } catch { return { open: false, people: 0, limit: 32 }; }
}

/** World edits this server saved: into the game's editor room and every play room of it. Never waits on the caller. */
export function publishOps(gameId: string, ops: unknown[], by: string, fx: string | null, except?: string) {
  if (!netUpCached() || !ops.length) return;
  void gen('/v1/net/publish', { body: { project: NET_PROJECT, room: `g/${gameId}/*`, ops, by, fx, except: except ?? null } }).catch((e) => console.warn(`[portal] hawkes net publish: ${e.message}`));
}
/** Puts people out of a game's rooms on Hawkes Net: everyone in rooms under `room` ("g/<id>/p/*": a world an admin
 *  closed), or only those who joined as `sub` (a removed member: their account id). Their page leaves and does not
 *  come back, since this site gives them no new ticket. */
export function kick(room: string, sub?: string) {
  if (!netUpCached()) return;
  void gen('/v1/net/publish', { body: { project: NET_PROJECT, room, kick: { sub: sub ?? null } } }).catch((e) => console.warn(`[portal] hawkes net kick: ${e.message}`));
}
/** A server event to the editor room (an asset arrived, a script was saved). */
export function publishEvent(gameId: string, name: string, data: unknown) {
  if (!netUpCached()) return;
  void gen('/v1/net/publish', { body: { project: NET_PROJECT, room: `g/${gameId}/edit`, event: { name, data } } }).catch(() => {});
}

// Warm the answer at start, so the first page doesn't wait on it.
void netUp();
