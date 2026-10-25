// Real time for a game's editors: one SSE stream per open editor (GET /v1/games/:id/live). Saves, assets, chat and
// releases are broadcast to everyone in the game; presence says who is here and which file each has open. Each stream
// gets a connection id, which the editor sends back with its writes (X-Conn) so it can skip its own echoes.
import type { ServerResponse } from 'node:http';
import { id, PortalError, envInt } from './util.ts';
import { env } from './config.ts';
import { publish, missed, on, onConnect, catchUp, markHeard } from './bus.ts';
import { procName, procs } from './proc.ts';

type Conn = { id: string; res: ServerResponse; userId: string; name: string; file: string | null; color: string; pending: { event: string; data: unknown; id?: string }[] | null };
const rooms = new Map<string, Map<string, Conn>>();

// Streams are long-lived, so they are capped: PORTAL_LIVE_PER_USER (6) for one account in a process, PORTAL_LIVE_MAX (2000) in all (shared out among the web processes).
export const liveCaps = () => ({ perUser: envInt(env, 'PORTAL_LIVE_PER_USER', 6), total: Math.ceil(envInt(env, 'PORTAL_LIVE_MAX', 2000) / procs()) });
let streams = 0;
export const liveStats = () => ({ streams, users: streamsByUser.size });
const streamsByUser = new Map<string, number>();

// Every durable event gets an id `<boot>-<n>` from the bus's hub (the worker's, src/bus.ts) and the last few of a game are
// kept there, so a stream that drops and comes back (the browser sends Last-Event-ID itself; a manual reconnect sends
// ?last=), to this process or another, gets what it missed, once. A new boot has a new prefix: ids from before a restart
// replay nothing (the editor reloads its state from `hello`, nothing is repeated). Presence, cursors and the hello are
// state, not history: they are never replayed. Every event goes through the hub and comes back to every web process, so
// each editor's stream gets it once wherever it is connected.
const RETRY_MS = 3000;
const PROC = procName();
// Who has the editor open, as the hub last told us: game -> process -> its streams. This process's own entry is always
// read from `rooms`, never from here.
const remote = new Map<string, Record<string, unknown[]>>();

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
  publish({ t: 'live', game: gameId, event, data });
}

const seqOf = (evId?: string) => Number(/-(\d+)$/.exec(evId ?? '')?.[1] ?? 0);

// The last events of each game as this process heard them, with their ids. Every web process hears every event, so a stream
// that comes back here (or to another process that was up) can be given what it missed from this, even when the worker
// restarted meanwhile and the hub's own ids are from another boot. The hub's history serves a process that is newer than the event.
const recent = new Map<string, { id: string; event: string; data: unknown }[]>();
const KEEP = 200;
const remember = (game: string, id: string, event: string, data: unknown) => {
  let r = recent.get(game);
  if (!r) recent.set(game, (r = []));
  r.push({ id, event, data });
  if (r.length > KEEP) r.shift();
};

on('live', (m) => {
  if (m.id) remember(m.game, m.id, m.event, m.data);
  const room = rooms.get(m.game);
  if (room) for (const c of room.values()) {
    if (c.pending) c.pending.push({ event: m.event, data: m.data, id: m.id });
    else write(c, m.event, m.data, m.id);
  }
});
on('presence', (m) => {
  if (Object.keys(m.procs).length) remote.set(m.game, m.procs); else remote.delete(m.game);
  const room = rooms.get(m.game);
  if (room?.size) { const list = presence(m.game); for (const c of room.values()) write(c, 'presence', list); }
});
on('kick', (m) => { for (const c of rooms.get(m.game)?.values() ?? []) if (c.userId === m.user) c.res.end(`event: bye\ndata: {}\n\n`); });
on('set-presence', (m) => {
  const c = rooms.get(m.game)?.get(m.conn);
  if (!c || c.userId !== m.user) return;
  c.file = typeof m.file === 'string' ? m.file.slice(0, 200) : null;
  announce(m.game);
  if (m.line !== undefined) broadcast(m.game, 'cursor', { conn: m.conn, name: c.name, color: c.color, file: c.file, line: Number(m.line) || 0 });
});

/** Tells the hub who of this process has the game open; it tells everyone the whole list. */
const mine = (gameId: string) => [...(rooms.get(gameId)?.values() ?? [])].map((c) => ({ conn: c.id, user: c.userId, name: c.name, file: c.file, color: c.color }));
const announce = (gameId: string) => publish({ t: 'presence-set', game: gameId, proc: PROC, conns: mine(gameId) });
catchUp(() => [...rooms.keys()]);
// A worker that restarted has forgotten: say again who is here.
onConnect(() => { for (const g of rooms.keys()) announce(g); });

/** How many people have the game open in the editor (its live feed), on every web process. */
export const presenceCount = (gameId: string) => presence(gameId).length;
const presence = (gameId: string) => {
  const others = Object.entries(remote.get(gameId) ?? {}).filter(([p]) => p !== PROC).flatMap(([, conns]) => conns);
  return [...mine(gameId), ...others];
};

/** Opens an editor's stream; it lives until the browser goes away. */
export function join(gameId: string, user: { id: string; name: string | null }, res: ServerResponse, onClose: () => void = () => {}, last?: string | null, beatMs = 25_000) {
  const caps = liveCaps();
  if ((streamsByUser.get(user.id) ?? 0) >= caps.perUser) throw new PortalError('Too many editor windows open on this account; close one and try again', { status: 429 });
  if (streams >= caps.total) throw new PortalError('The editor is busy; try again in a moment', { status: 503 });
  streams++;
  streamsByUser.set(user.id, (streamsByUser.get(user.id) ?? 0) + 1);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  const c: Conn = { id: `${id('c_', 6)}`, res, userId: user.id, name: user.name ?? 'someone', file: null, color: colorFor(user.id), pending: null };
  if (!rooms.has(gameId)) rooms.set(gameId, new Map());
  rooms.get(gameId)!.set(c.id, c);
  res.write(`retry: ${RETRY_MS}\n\n`); // how long the browser waits before it comes back on its own
  write(c, 'hello', { conn: c.id, proc: PROC, color: c.color, presence: presence(gameId), resumed: !!last });
  // What it missed: at once when the hub is in this process; else it asks the worker, and what arrives meanwhile waits
  // behind it, so nothing is written twice or out of order.
  const ring = recent.get(gameId);
  const at = last && ring ? ring.findIndex((e) => e.id === last) : -1;
  const gone = at >= 0 ? ring!.slice(at + 1).map((e) => ({ ...e, n: seqOf(e.id) })) : missed(gameId, last);
  if (Array.isArray(gone)) for (const e of gone) { write(c, e.event, e.data, e.id); markHeard((e as any).mid); }
  else {
    c.pending = [];
    void gone.then((list) => {
      for (const e of list) { write(c, e.event, e.data, e.id); markHeard(e.mid); }
      const upto = Math.max(0, ...list.map((e) => e.n));
      for (const e of c.pending ?? []) if (!e.id || seqOf(e.id) > upto) write(c, e.event, e.data, e.id);
      c.pending = null;
    });
  }
  announce(gameId);
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
    announce(gameId);
    onClose();
  });
  return c.id;
}

/** Which file someone has open (and where their cursor is), for everyone else's file list and gutter. The stream may
 *  be on another web process: then the hub carries the word to it. */
export function setPresence(gameId: string, conn: string, userId: string, body: { file?: unknown; line?: unknown }) {
  const c = rooms.get(gameId)?.get(conn);
  if (!c) {
    if (!conn || procs() < 2) return { ok: false };
    publish({ t: 'set-presence', game: gameId, conn, user: userId, file: body.file, line: body.line });
    return { ok: true };
  }
  if (c.userId !== userId) return { ok: false };
  c.file = typeof body.file === 'string' ? body.file.slice(0, 200) : null;
  announce(gameId);
  if (body.line !== undefined) broadcast(gameId, 'cursor', { conn, name: c.name, color: c.color, file: c.file, line: Number(body.line) || 0 });
  return { ok: true };
}

/** Ends the streams of someone removed from a game, on every web process. */
export function kick(gameId: string, userId: string) {
  publish({ t: 'kick', game: gameId, user: userId });
}

/** Ends every stream properly (the chunked terminator goes out) so a restart is a clean close the browser reconnects from, not a reset. */
export function closeAll() {
  for (const room of rooms.values()) for (const c of room.values()) try { c.res.end(`event: bye\ndata: {}\n\n`); } catch {}
}
