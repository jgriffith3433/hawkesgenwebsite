// Realtime rooms for the game engine, over WebSocket (/v1/ws). Everyone in a world shares one room:
//   edit:<gameId>            the game's members, in the editor (a signed token from GET /v1/games/:id/bundle)
//   play:<slug>:<room code>  anyone playing a published game together (/play/<slug>?room=<code>; no account)
// The server relays what each player does (their avatar, the things they simulate, script events) and keeps three
// things itself: who is in the room, who is the host (the oldest connection, which simulates everything nobody else
// holds), and who owns each moving thing (whoever grabbed or pushed it last). Nothing said here is saved: edits to the
// world are POSTed (/v1/games/:id/scene, with the member's cookie), saved to scene.json, then sent out here as ops.
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { accept, type Socket } from './ws.ts';
import { verify } from './sign.ts';
import { getUser } from './users.ts';
import { gameBySlug, getGame } from './games.ts';
import { templateBundle } from './templates.ts';

type Conn = { id: string; s: Socket; name: string; color: string; user: string | null; joined: number; rate: { at: number; n: number } };
type Room = { key: string; gameId: string; edit: boolean; conns: Map<string, Conn>; host: string | null; owners: Map<string, string> };

const rooms = new Map<string, Room>();
const COLORS = ['#4a9eff', '#a855f7', '#34d399', '#fbbf24', '#ef4444', '#f97316', '#22d3ee', '#ec4899'];
export const ROOM_LIMITS = { people: 32, message: 200 * 1024, perSecond: 90 };
let seq = 0;

const out = (c: Conn, m: unknown) => {
  // A client that stops reading is dropped rather than buffered forever.
  if (c.s.buffered > 4 * 1024 * 1024) return c.s.close(1013, 'too slow');
  c.s.send(JSON.stringify(m));
};
function toAll(room: Room, m: unknown, except?: string) {
  const text = JSON.stringify(m);
  for (const c of room.conns.values()) if (c.id !== except) { if (c.s.buffered > 4 * 1024 * 1024) c.s.close(1013, 'too slow'); else c.s.send(text); }
}
const peers = (room: Room) => [...room.conns.values()].map((c) => ({ c: c.id, name: c.name, color: c.color, user: c.user }));

/** The token the editor's sandbox joins its game's edit room with. */
export function editToken(sign: (p: Record<string, unknown>, ttl: number) => string, gameId: string, user: { id: string; name: string | null }) {
  return sign({ k: 'edit', g: gameId, u: user.id }, 12 * 3600);
}

/** An upgrade request for /v1/ws: joins a room or answers why not. */
export function upgrade(req: IncomingMessage, raw: Duplex) {
  const url = new URL(req.url ?? '/', 'http://x');
  const deny = (why: string) => raw.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${why}`);
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
      if (!g || !g.live_version) return deny('No such game');
      key = `play:${g.slug}:${code}`; gameId = g.id;
    }
    name = String(url.searchParams.get('name') ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 24) || '';
  }
  const room = rooms.get(key) ?? { key, gameId, edit, conns: new Map(), host: null, owners: new Map() };
  if (room.conns.size >= ROOM_LIMITS.people) return deny('This room is full');
  const s = accept(req, raw, { maxMessage: ROOM_LIMITS.message });
  if (!s) return;
  rooms.set(key, room);
  const id = `c${(++seq).toString(36)}`;
  const used = new Set([...room.conns.values()].map((c) => c.color));
  const color = COLORS.find((c) => !used.has(c)) ?? COLORS[seq % COLORS.length];
  const c: Conn = { id, s, name: name || `Player ${room.conns.size + 1}`, color, user, joined: Date.now(), rate: { at: 0, n: 0 } };
  room.conns.set(id, c);
  if (!room.host) room.host = id;
  out(c, { t: 'hello', you: id, name: c.name, color, host: room.host, peers: peers(room), owners: Object.fromEntries(room.owners), now: Date.now(), edit });
  toAll(room, { t: 'join', c: id, name: c.name, color, user }, id);
  s.onMessage = (text) => onMessage(room, c, text);
  s.onClose = () => leave(room, c);
}

function leave(room: Room, c: Conn) {
  if (!room.conns.delete(c.id)) return;
  for (const [eid, owner] of room.owners) if (owner === c.id) room.owners.delete(eid);
  toAll(room, { t: 'leave', c: c.id });
  if (room.host === c.id) {
    // The next oldest takes over simulating the world.
    const next = [...room.conns.values()].sort((a, b) => a.joined - b.joined)[0];
    room.host = next?.id ?? null;
    if (next) toAll(room, { t: 'host', c: next.id });
  }
  if (!room.conns.size) rooms.delete(room.key);
}

function onMessage(room: Room, c: Conn, text: string) {
  const now = Date.now();
  if (now - c.rate.at > 1000) { c.rate.at = now; c.rate.n = 0; }
  if (++c.rate.n > ROOM_LIMITS.perSecond) return;
  let m: any;
  try { m = JSON.parse(text); } catch { return; }
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'ping': return out(c, { t: 'pong', at: m.at, now });
    case 'me': return toAll(room, { t: 'me', c: c.id, s: m.s }, c.id);
    case 'xf': return toAll(room, { t: 'xf', c: c.id, x: m.x }, c.id);
    case 'ev': return toAll(room, { t: 'ev', c: c.id, name: String(m.name ?? '').slice(0, 64), data: m.data ?? null }, m.self ? undefined : c.id);
    case 'own': {
      const eid = String(m.id ?? '').slice(0, 64);
      if (!eid) return;
      if (m.on) room.owners.set(eid, c.id);
      else if (room.owners.get(eid) === c.id) room.owners.delete(eid);
      else return;
      return toAll(room, { t: 'own', id: eid, c: m.on ? c.id : null });
    }
  }
}

/** Saved world changes: everyone in the game's edit room applies them (except the connection that made them). */
export function broadcastOps(gameId: string, ops: unknown[], by: string, fx: string | null = null, except?: string) {
  const room = rooms.get(`edit:${gameId}`);
  if (room && ops.length) toAll(room, { t: 'ops', ops, by, c: except ?? null, fx }, except);
}

/** Tells the edit room something happened (an asset arrived, a script was saved) without the editor relaying it. */
export function roomEvent(gameId: string, name: string, data: unknown) {
  const room = rooms.get(`edit:${gameId}`);
  if (room) toAll(room, { t: 'ev', c: null, name, data });
}

/** Ends a removed member's connections. */
export function kickFromRooms(gameId: string, userId: string) {
  const room = rooms.get(`edit:${gameId}`);
  if (room) for (const c of room.conns.values()) if (c.user === userId) c.s.close(4003, 'removed');
}

export const roomStats = () => ({ rooms: rooms.size, people: [...rooms.values()].reduce((n, r) => n + r.conns.size, 0) });
