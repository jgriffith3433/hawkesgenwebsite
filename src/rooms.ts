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
import { publishOps, publishEvent, kick } from './hnet.ts';
import { presenceCount } from './live.ts';
import { publish, on } from './bus.ts';
import { clustered, procName, procs, role, slot } from './proc.ts';

type Conn = relay.Conn & { s: Socket };
type Room = relay.Room;

const rooms = new Map<string, Room>();
const COLORS = ['#4a9eff', '#a855f7', '#34d399', '#fbbf24', '#ef4444', '#f97316', '#22d3ee', '#ec4899'];
export const ROOM_LIMITS = relay.LIMITS;
/** How a room is right now (an island invitation asks before the friend loads anything: invites.ts). A room exists while
 *  someone is in it, so a room that isn't there is closed. */
export function roomState(key: string) {
  const r = rooms.get(key);
  const people = r?.conns.size ?? roomsElsewhere.get(key) ?? 0;
  return { open: people > 0, people, limit: ROOM_LIMITS.people };
}
// Rooms are kept by one web process each (the hash of the room: `owner`), and this process hears how full the others'
// are, so an invitation can be answered by any of them.
const roomsElsewhere = new Map<string, number>();
const sayPeople = (room: Room) => { if (clustered()) publish({ t: 'room', key: room.key, proc: procName(), n: room.conns.size }); };
on('room', (m) => { if (m.proc !== procName()) { if (m.n > 0) roomsElsewhere.set(m.key, m.n); else roomsElsewhere.delete(m.key); } });
let seq = 0;

// Caps, so a crowd (or one address) can't use up the process. All from the environment, read at each connection.
//   PORTAL_WS_MAX 3000 sockets in all, PORTAL_WS_PER_IP 12 at once from one address, PORTAL_ROOMS_MAX 1000 rooms,
//   PORTAL_WS_PER_MIN 30 new connections a minute from one address. A refusal is a real status (429 for the address,
//   503 for the server) with a plain sentence; a room already running is never touched by them.
export const wsCaps = () => ({
  total: Math.ceil(envInt(env, 'PORTAL_WS_MAX', 3000) / procs()),
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

/** Which web process keeps a room: everyone in it must be on the same one (the relay is in its memory). */
const ownerOf = (key: string) => { let h = 2166136261; for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0; return h % procs(); };
function routeKey(url: URL): string | null {
  const t = url.searchParams.get('t');
  if (t) { const v = verify<{ k: string; g: string }>(t); return v?.k === 'edit' ? `edit:${v.g}` : null; }
  const slug = String(url.searchParams.get('play') ?? ''), code = String(url.searchParams.get('room') ?? '').toLowerCase();
  return slug && /^[a-z0-9]{4,16}$/.test(code) ? `play:${slug}:${code}` : null;
}
/** Hands the socket (and the request as it came) to the process that keeps the room, through the cluster's primary. */
function handoff(req: IncomingMessage, raw: Duplex, head: Buffer, owner: number) {
  if (!process.send) return false;
  const lines = [`${req.method} ${req.url} HTTP/1.1`];
  for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
  lines.push('X-Hg-Handoff: 1');
  const bytes = Buffer.concat([Buffer.from(`${lines.join('\r\n')}\r\n\r\n`), head ?? Buffer.alloc(0)]);
  return process.send({ t: 'ws-handoff', to: owner, head: bytes.toString('base64') }, raw as any);
}

/** An upgrade request for /v1/ws: joins a room or answers why not. `v=2` on the URL: the bundled protocol (relay.ts). */
export function upgrade(req: IncomingMessage, raw: Duplex, head?: Buffer) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (clustered() && role() === 'web' && procs() > 1 && !req.headers['x-hg-handoff']) {
    const key = routeKey(url);
    const owner = key ? ownerOf(key) : slot();
    if (owner !== slot() && handoff(req, raw, head ?? Buffer.alloc(0), owner)) return;
  }
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
      if (!g || g.hidden) return deny('No such game');
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
  const id = `c${clustered() ? procName() : ''}${(++seq).toString(36)}`;
  const used = new Set([...room.conns.values()].map((c) => c.color));
  const color = COLORS.find((c) => !used.has(c)) ?? COLORS[seq % COLORS.length];
  // A client that stops reading is dropped rather than buffered forever.
  const send = (text: string) => { if (s.buffered > 4 * 1024 * 1024) s.close(1013, 'too slow'); else s.send(text); };
  const c = relay.newConn({ id, name: name || `Player ${room.conns.size + 1}`, color, user, v: Number(url.searchParams.get('v')) >= 2 ? 2 : 1, send, close: (code, why) => s.close(code, why), now: Date.now() }) as Conn;
  c.s = s;
  relay.join(room, c, Date.now());
  sayPeople(room);
  s.onMessage = (text) => relay.receive(room, c, text, Date.now());
  s.onClose = () => {
    sockets--;
    const left = (socketsByIp.get(ip) ?? 1) - 1;
    if (left > 0) socketsByIp.set(ip, left); else socketsByIp.delete(ip);
    if (relay.leave(room, c) && !room.conns.size) rooms.delete(room.key);
    sayPeople(room);
  };
}

/** Saved world changes: everyone in the game's rooms applies them (except the connection that made them), whichever web
 *  process keeps the room. */
export function broadcastOps(gameId: string, ops: unknown[], by: string, fx: string | null = null, except?: string) {
  if (!ops.length) return;
  publish({ t: 'ops', game: gameId, ops, by, fx, except });
  // And the game's rooms on Hawkes Net (hnet.ts): the editor's and every play room's. (Once: from the process that made the change.)
  if (gameId.startsWith('g_')) publishOps(gameId, ops, by, fx, except);
}
on('ops', (m) => { for (const room of rooms.values()) if (room.gameId === m.game) relay.ops(room, m.ops as any[], m.by, m.fx ?? null, m.except); });

/** Tells the edit room something happened (an asset arrived, a script was saved) without the editor relaying it. */
export function roomEvent(gameId: string, name: string, data: unknown) {
  publish({ t: 'room-event', game: gameId, name, data });
  publishEvent(gameId, name, data);
}
on('room-event', (m) => { const room = rooms.get(`edit:${m.game}`); if (room) relay.event(room, m.name, m.data); });

/** Ends a removed member's connections. */
export function kickFromRooms(gameId: string, userId: string) {
  publish({ t: 'room-kick', game: gameId, user: userId });
  kick(`g/${gameId}/edit`, userId);
}
on('room-kick', (m) => { const room = rooms.get(`edit:${m.game}`); if (room) for (const c of room.conns.values()) if (c.user === m.user) (c as Conn).s.close(4003, 'removed'); });

/** An admin closed a game: everyone playing it together is let go. */
export function closePlayRooms(slug: string, gameId?: string) {
  publish({ t: 'room-close', slug });
  if (gameId) kick(`g/${gameId}/p/*`);
}
on('room-close', (m) => { for (const [key, room] of rooms) if (key.startsWith(`play:${m.slug}:`)) for (const c of room.conns.values()) (c as Conn).s.close(4003, 'closed'); });

export const roomStats = () => ({ rooms: rooms.size, people: [...rooms.values()].reduce((n, r) => n + r.conns.size, 0) });

// ------------------------------------------------------------------ who is in a game right now
// Building: the game's edit room. Playing: every play page says it's there every 30 s (POST /v1/play/<slug>/here),
// alone or in a room, so the count is people, not rooms.
const here = new Map<string, Map<string, number>>();
const HERE_MS = 75_000;
export function markHere(gameId: string, session: unknown) {
  const s = String(session ?? '').replace(/[^\w-]/g, '').slice(0, 40);
  if (!s) return;
  publish({ t: 'here', game: gameId, s });
}
on('here', (msg) => noteHere(msg.game, msg.s));
function noteHere(gameId: string, s: string) {
  const m = here.get(gameId) ?? new Map<string, number>();
  m.set(s, Date.now());
  if (m.size > 5000) for (const [k, at] of m) if (Date.now() - at > HERE_MS) m.delete(k);
  here.set(gameId, m);
}
export function liveCounts(gameId: string) {
  const m = here.get(gameId);
  let playing = 0;
  if (m) for (const [k, at] of m) { if (Date.now() - at > HERE_MS) m.delete(k); else playing++; }
  // Building: the edit room here, or (its rooms on Hawkes Net) the people with the editor's live feed open.
  return { playing, building: Math.max(rooms.get(`edit:${gameId}`)?.conns.size ?? 0, presenceCount(gameId)) };
}
