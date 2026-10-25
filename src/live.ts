// Real time for a game's editors: one SSE stream per open editor (GET /v1/games/:id/live). Saves, assets, chat and
// releases are broadcast to everyone in the game; presence says who is here and which file each has open. Each stream
// gets a connection id, which the editor sends back with its writes (X-Conn) so it can skip its own echoes.
import type { ServerResponse } from 'node:http';
import { id } from './util.ts';

type Conn = { id: string; res: ServerResponse; userId: string; name: string; file: string | null; color: string };
const rooms = new Map<string, Map<string, Conn>>();

const COLORS = ['#c8421d', '#2f6b4a', '#2f4f8f', '#9a6a12', '#7a3b8f', '#1f7a7a', '#8f2f4f', '#4b4840'];
const colorFor = (userId: string) => COLORS[[...userId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];

const write = (c: Conn, event: string, data: unknown) => {
  try {
    c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {}
};

export function broadcast(gameId: string, event: string, data: unknown) {
  const room = rooms.get(gameId);
  if (room) for (const c of room.values()) write(c, event, data);
}

const presence = (gameId: string) => [...(rooms.get(gameId)?.values() ?? [])].map((c) => ({ conn: c.id, user: c.userId, name: c.name, file: c.file, color: c.color }));

/** Opens an editor's stream; it lives until the browser goes away. */
export function join(gameId: string, user: { id: string; name: string | null }, res: ServerResponse, onClose: () => void = () => {}) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  const c: Conn = { id: id('c_', 6), res, userId: user.id, name: user.name ?? 'someone', file: null, color: colorFor(user.id) };
  if (!rooms.has(gameId)) rooms.set(gameId, new Map());
  rooms.get(gameId)!.set(c.id, c);
  write(c, 'hello', { conn: c.id, color: c.color, presence: presence(gameId) });
  broadcast(gameId, 'presence', presence(gameId));
  const beat = setInterval(() => {
    try {
      res.write(': beat\n\n');
    } catch {}
  }, 25_000);
  res.on('close', () => {
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
  for (const c of rooms.get(gameId)?.values() ?? []) if (c.userId === userId) c.res.end();
}

/** Ends every stream properly (the chunked terminator goes out) so a restart is a clean close the browser reconnects from, not a reset. */
export function closeAll() {
  for (const room of rooms.values()) for (const c of room.values()) try { c.res.end(); } catch {}
}
