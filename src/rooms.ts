// Realtime rooms for the game engine, over WebSocket (/v1/ws). Everyone in a world shares one room:
//   edit:<gameId>            the game's members, in the editor (a signed token from GET /v1/games/:id/bundle)
//   play:<slug>:<room code>  anyone playing a game together (/play/<slug>?room=<code>; no account). Games are live:
//                            world edits reach these rooms too, so players see the game being built
// The server relays what each player does (their avatar, the things they simulate, script events) and keeps who is in
// the room, who is the host (the oldest connection, which simulates everything nobody else holds), who owns each moving
// thing, and the newest pose of moving things and copy of synced states (src/relay.ts: what's kept, and how each player
// gets only what's relevant to them, within a byte budget). Nothing said here is saved: edits to the world are POSTed
// (/v1/games/:id/scene, with the member's cookie), saved to scene.json, then sent out here as ops.
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { accept, type Socket } from './ws.ts';
import { verify } from './sign.ts';
import { env } from './config.ts';
import { Limiter, clientIp, envInt } from './util.ts';
import { getUser } from './users.ts';
import { gameBySlug, getGame } from './games.ts';
import { templateBundle } from './templates.ts';
import * as relay from './relay.ts';

type Conn = relay.Conn & { s: Socket };
type Room = relay.Room;

const rooms = new Map<string, Room>();
const COLORS = ['#4a9eff', '#a855f7', '#34d399', '#fbbf24', '#ef4444', '#f97316', '#22d3ee', '#ec4899'];
export const ROOM_LIMITS = relay.LIMITS;
/** How a room is right now (an island invitation asks before the friend loads anything: invites.ts). A room exists while
 *  someone is in it, so a room that isn't there is closed. */
export function roomState(key: string) {
  const r = rooms.get(key);
  return { open: Boolean(r && r.conns.size), people: r?.conns.size ?? 0, limit: ROOM_LIMITS.people };
}
let seq = 0;

// Caps, so a crowd (or one address) can't use up the process. All from the environment, read at each connection.
//   PORTAL_WS_MAX 3000 sockets in all, PORTAL_WS_PER_IP 12 at once from one address, PORTAL_ROOMS_MAX 1000 rooms,
//   PORTAL_WS_PER_MIN 30 new connections a minute from one address. A refusal is a real status (429 for the address,
//   503 for the server) with a plain sentence; a room already running is never touched by them.
export const wsCaps = () => ({
  total: envInt(env, 'PORTAL_WS_MAX', 3000),
  perIp: envInt(env, 'PORTAL_WS_PER_IP', 12),
  rooms: envInt(env, 'PORTAL_ROOMS_MAX', 1000),
  perMinute: envInt(env, 'PORTAL_WS_PER_MIN', 30),
});
let sockets = 0;
const socketsByIp = new Map<string, number>();
const newByIp = new Map<number, Limiter>(); // (one limiter per cap value, so a changed env takes effect)
function perMinute(max: number) {
  let l = newByIp.get(max);
  if (!l) newByIp.set(max, (l = new Limiter(max, 60_000)));
  return l;
}
export const socketStats = () => ({ sockets, addresses: socketsByIp.size });

// One timer sends every room's bundles (relay.ts flush: interest, priority, the byte budget).
let timer: ReturnType<typeof setInterval> | null = null;
function tick() {
  const now = Date.now();
  for (const room of rooms.values()) relay.flush(room, now);
  if (!rooms.size && timer) { clearInterval(timer); timer = null; }
}

/** The token the editor's sandbox joins its game's edit room with. */
export function editToken(sign: (p: Record<string, unknown>, ttl: number) => string, gameId: string, user: { id: string; name: string | null }) {
  return sign({ k: 'edit', g: gameId, u: user.id }, 12 * 3600);
}

/** An upgrade request for /v1/ws: joins a room or answers why not. `v=2` on the URL: the bundled protocol (relay.ts). */
export function upgrade(req: IncomingMessage, raw: Duplex) {
  const url = new URL(req.url ?? '/', 'http://x');
  const deny = (why: string, status = 403, reason = 'Forbidden') => raw.end(`HTTP/1.1 ${status} ${reason}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${why}`);
  const ip = clientIp(req);
  const caps = wsCaps();
  if (!perMinute(caps.perMinute).hit(ip)) return deny('Too many connections from this address; wait a minute', 429, 'Too Many Requests');
  if ((socketsByIp.get(ip) ?? 0) >= caps.perIp) return deny('Too many games open from this address', 429, 'Too Many Requests');
  if (sockets >= caps.total) return deny('The game servers are full; try again in a moment', 503, 'Service Unavailable');
  let key: string, gameId: string, edit = false, user: string | null = null, name: string;
  const t = url.searchParams.get('t');
  if (t) {
    const v = verify<{ k: string; g: string; u: string }>(t);
    if (!v || v.k !== 'edit') return deny('This link has expired; reload the editor');
    const g = getGame(v.g);
    const u = getUser(v.u);
    if (!g || !u || u.disabled) return deny('No such game');
    key = `edit:${g.id}`; gameId = g.id; edit = true; user = u.id; name = u.name || 'Builder';
  } else {
    const slug = String(url.searchParams.get('play') ?? '');
    const code = String(url.searchParams.get('room') ?? '').toLowerCase();
    if (!/^[a-z0-9]{4,16}$/.test(code)) return deny('A room code is 4 to 16 letters and numbers');
    const t = /^t\/([a-z0-9-]+)$/.exec(slug);
    if (t) {
      // An Overseer game (a template), played together.
      if (!templateBundle(t[1])) return deny('No such game');
      key = `play:t/${t[1]}:${code}`; gameId = `t:${t[1]}`;
    } else {
      const g = gameBySlug(slug);
      if (!g) return deny('No such game');
      key = `play:${g.slug}:${code}`; gameId = g.id;
    }
    name = String(url.searchParams.get('name') ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 24) || '';
  }
  // A friend answering an invitation (join=1) joins the island that is there; it never makes an empty one.
  if (!edit && url.searchParams.get('join') === '1' && !roomState(key).open) return deny('This island is closed');
  if (!rooms.has(key) && rooms.size >= caps.rooms) return deny('The game servers are full; try again in a moment', 503, 'Service Unavailable');
  const room = rooms.get(key) ?? relay.newRoom(key, gameId, edit);
  if (room.conns.size >= ROOM_LIMITS.people) return deny('This room is full');
  // (Nothing heard for 20 s: the player is gone, and a host that went quiet hands the world on.)
  const s = accept(req, raw, { maxMessage: ROOM_LIMITS.message, idleMs: 20_000 });
  if (!s) return;
  rooms.set(key, room);
  sockets++;
  socketsByIp.set(ip, (socketsByIp.get(ip) ?? 0) + 1);
  if (!timer) { timer = setInterval(tick, ROOM_LIMITS.flushMs); timer.unref?.(); }
  const id = `c${(++seq).toString(36)}`;
  const used = new Set([...room.conns.values()].map((c) => c.color));
  const color = COLORS.find((c) => !used.has(c)) ?? COLORS[seq % COLORS.length];
  // A client that stops reading is dropped rather than buffered forever.
  const send = (text: string) => { if (s.buffered > 4 * 1024 * 1024) s.close(1013, 'too slow'); else s.send(text); };
  const c = relay.newConn({ id, name: name || `Player ${room.conns.size + 1}`, color, user, v: Number(url.searchParams.get('v')) >= 2 ? 2 : 1, send, close: (code, why) => s.close(code, why), now: Date.now() }) as Conn;
  c.s = s;
  relay.join(room, c, Date.now());
  s.onMessage = (text) => relay.receive(room, c, text, Date.now());
  s.onClose = () => {
    sockets--;
    const left = (socketsByIp.get(ip) ?? 1) - 1;
    if (left > 0) socketsByIp.set(ip, left); else socketsByIp.delete(ip);
    if (relay.leave(room, c) && !room.conns.size) rooms.delete(room.key);
  };
}

/** Saved world changes: everyone in the game's rooms applies them (except the connection that made them). */
export function broadcastOps(gameId: string, ops: unknown[], by: string, fx: string | null = null, except?: string) {
  if (!ops.length) return;
  for (const room of rooms.values()) if (room.gameId === gameId) relay.ops(room, ops as any[], by, fx, except);
}

/** Tells the edit room something happened (an asset arrived, a script was saved) without the editor relaying it. */
export function roomEvent(gameId: string, name: string, data: unknown) {
  const room = rooms.get(`edit:${gameId}`);
  if (room) relay.event(room, name, data);
}

/** Ends a removed member's connections. */
export function kickFromRooms(gameId: string, userId: string) {
  const room = rooms.get(`edit:${gameId}`);
  if (room) for (const c of room.conns.values()) if (c.user === userId) (c as Conn).s.close(4003, 'removed');
}

export const roomStats = () => ({ rooms: rooms.size, people: [...rooms.values()].reduce((n, r) => n + r.conns.size, 0) });

// ------------------------------------------------------------------ who is in a game right now
// Building: the game's edit room. Playing: every play page says it's there every 30 s (POST /v1/play/<slug>/here),
// alone or in a room, so the count is people, not rooms.
const here = new Map<string, Map<string, number>>();
const HERE_MS = 75_000;
export function markHere(gameId: string, session: unknown) {
  const s = String(session ?? '').replace(/[^\w-]/g, '').slice(0, 40);
  if (!s) return;
  const m = here.get(gameId) ?? new Map<string, number>();
  m.set(s, Date.now());
  if (m.size > 5000) for (const [k, at] of m) if (Date.now() - at > HERE_MS) m.delete(k);
  here.set(gameId, m);
}
export function liveCounts(gameId: string) {
  const m = here.get(gameId);
  let playing = 0;
  if (m) for (const [k, at] of m) { if (Date.now() - at > HERE_MS) m.delete(k); else playing++; }
  return { playing, building: rooms.get(`edit:${gameId}`)?.conns.size ?? 0 };
}
