// Real time for a game's editors: one SSE stream per open editor (GET /v1/games/:id/live). Saves, assets, chat and
// releases are broadcast to everyone in the game; presence says who is here and which file each has open. Each stream
// gets a connection id, which the editor sends back with its writes (X-Conn) so it can skip its own echoes.
import type { ServerResponse } from 'node:http';
import { id, PortalError, envInt } from './util.ts';
import { env } from './config.ts';

type Conn = { id: string; res: ServerResponse; userId: string; name: string; file: string | null; color: string };
const rooms = new Map<string, Map<string, Conn>>();

// Streams are long-lived, so they are capped: PORTAL_LIVE_PER_USER (6) for one account, PORTAL_LIVE_MAX (2000) in all.
export const liveCaps = () => ({ perUser: envInt(env, 'PORTAL_LIVE_PER_USER', 6), total: envInt(env, 'PORTAL_LIVE_MAX', 2000) });
let streams = 0;
export const liveStats = () => ({ streams, users: streamsByUser.size });
const streamsByUser = new Map<string, number>();

// Every durable event gets an id `<boot>-<n>` and the last few of a game are kept, so a stream that drops and comes back
// (the browser sends Last-Event-ID itself; a manual reconnect sends ?last=) gets what it missed, once. A new boot has a
// new prefix: ids from before a restart replay nothing (the editor reloads its state from `hello`, nothing is repeated).
// Presence, cursors and the hello are state, not history: they are never replayed.
const BOOT = id('b', 3);
const KEEP = 200;
const RETRY_MS = 3000;
const NOT_REPLAYED = new Set(['presence', 'cursor', 'hello', 'thinking']);
const history = new Map<string, { seq: number; events: { n: number; event: string; data: unknown }[] }>();

const COLORS = ['#c8421d', '#2f6b4a', '#2f4f8f', '#9a6a12', '#7a3b8f', '#1f7a7a', '#8f2f4f', '#4b4840'];
const colorFor = (userId: string) => COLORS[[...userId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];

const frame = (event: string, data: unknown, evId?: string) => `${evId ? `id: ${evId}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const write = (c: Conn, event: string, data: unknown, evId?: string) => {
  if (c.res.destroyed || c.res.writableEnded) return;
  try {
    c.res.write(frame(event, data, evId));
  } catch {}
};

export function broadcast(gameId: string, event: string, data: unknown) {
  const room = rooms.get(gameId);
  let evId: string | undefined;
  if (!NOT_REPLAYED.has(event)) {
    let h = history.get(gameId);
    if (!h) history.set(gameId, (h = { seq: 0, events: [] }));
    h.events.push({ n: ++h.seq, event, data });
    if (h.events.length > KEEP) h.events.shift();
    evId = `${BOOT}-${h.seq}`;
  }
  if (room) for (const c of room.values()) write(c, event, data, evId);
}

/** The events after `last` (an id from this boot), or none when the id is from before a restart or too old to be kept. */
export function missed(gameId: string, last: string | null | undefined) {
  const m = /^(\w+)-(\d+)$/.exec(last ?? '');
  const h = history.get(gameId);
  if (!m || m[1] !== BOOT || !h) return [];
  return h.events.filter((e) => e.n > Number(m[2])).map((e) => ({ id: `${BOOT}-${e.n}`, event: e.event, data: e.data }));
}

/** How many people have the game open in the editor (its live feed). */
export const presenceCount = (gameId: string) => rooms.get(gameId)?.size ?? 0;
const presence = (gameId: string) => [...(rooms.get(gameId)?.values() ?? [])].map((c) => ({ conn: c.id, user: c.userId, name: c.name, file: c.file, color: c.color }));

/** Opens an editor's stream; it lives until the browser goes away. */
export function join(gameId: string, user: { id: string; name: string | null }, res: ServerResponse, onClose: () => void = () => {}, last?: string | null, beatMs = 25_000) {
  const caps = liveCaps();
  if ((streamsByUser.get(user.id) ?? 0) >= caps.perUser) throw new PortalError('Too many editor windows open on this account; close one and try again', { status: 429 });
  if (streams >= caps.total) throw new PortalError('The editor is busy; try again in a moment', { status: 503 });
  streams++;
  streamsByUser.set(user.id, (streamsByUser.get(user.id) ?? 0) + 1);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  const c: Conn = { id: id('c_', 6), res, userId: user.id, name: user.name ?? 'someone', file: null, color: colorFor(user.id) };
  if (!rooms.has(gameId)) rooms.set(gameId, new Map());
  rooms.get(gameId)!.set(c.id, c);
  res.write(`retry: ${RETRY_MS}\n\n`); // how long the browser waits before it comes back on its own
  write(c, 'hello', { conn: c.id, color: c.color, presence: presence(gameId), resumed: !!last });
  for (const e of missed(gameId, last)) write(c, e.event, e.data, e.id);
  broadcast(gameId, 'presence', presence(gameId));
  const beat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) try { res.write(': beat\n\n'); } catch {}
  }, beatMs);
  res.on('error', () => {}); // a browser that vanished mid-write is a close, not a crash
  res.on('close', () => {
    streams--;
    const left = (streamsByUser.get(user.id) ?? 1) - 1;
    if (left > 0) streamsByUser.set(user.id, left); else streamsByUser.delete(user.id);
    clearInterval(beat);
    rooms.get(gameId)?.delete(c.id);
    if (!rooms.get(gameId)?.size) rooms.delete(gameId);
    broadcast(gameId, 'presence', presence(gameId));
    onClose();
  });
  return c.id;
}

/** Which file someone has open (and where their cursor is), for everyone else's file list and gutter. */
export function setPresence(gameId: string, conn: string, userId: string, body: { file?: unknown; line?: unknown }) {
  const c = rooms.get(gameId)?.get(conn);
  if (!c || c.userId !== userId) return { ok: false };
  c.file = typeof body.file === 'string' ? body.file.slice(0, 200) : null;
  broadcast(gameId, 'presence', presence(gameId));
  if (body.line !== undefined) broadcast(gameId, 'cursor', { conn, name: c.name, color: c.color, file: c.file, line: Number(body.line) || 0 });
  return { ok: true };
}

/** Ends the streams of someone removed from a game. */
export function kick(gameId: string, userId: string) {
  for (const c of rooms.get(gameId)?.values() ?? []) if (c.userId === userId) c.res.end(`event: bye\ndata: {}\n\n`);
}

/** Ends every stream properly (the chunked terminator goes out) so a restart is a clean close the browser reconnects from, not a reset. */
export function closeAll() {
  for (const room of rooms.values()) for (const c of room.values()) try { c.res.end(`event: bye\ndata: {}\n\n`); } catch {}
}
