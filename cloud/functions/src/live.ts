// Real time for a game's editors (src/live.ts on the old box), on Firestore: every event of a game is a document
// games/{id}/live/{auto} ({ event, data (JSON text), n, at, expires }), and GET /v1/games/:id/live is still a
// server-sent stream, which reads new documents with an onSnapshot listener for up to LIVE_SECONDS and then ends: the
// page's EventSource comes back by itself with Last-Event-ID (or ?last=), and what it missed is replayed from the
// documents. Durable events have a number per game (liveSeq/{id}, counted in a transaction) and are sent as the SSE id;
// state (presence, cursors, the hello, thinking, the Overseer's show) has no number and is never replayed.
// Who has the editor open is games/{id}/presence/{conn} (refreshed while the stream lives; gone when it ends).
// Old documents leave by themselves: `expires` is a Firestore TTL field (cloud/firestore.indexes.json fieldOverrides).
import type { Request } from 'firebase-functions/https';
import type { Response } from 'express';
import { db } from './store.ts';
import { id, PortalError } from './http.ts';
import { env } from './config.ts';

/** How long one stream stays open (the function's own timeout is 300 s). */
export const LIVE_SECONDS = () => Math.max(20, Math.min(285, Number(env('PORTAL_LIVE_SECONDS') ?? 280)));
const RETRY_MS = 3000;
const BEAT_MS = 25_000;
const PRESENCE_MS = 60_000;
const HERE_MS = 75_000;
const KEEP_MS = 30 * 60_000; // how long an event can be replayed (the old box kept the last 200)
/** State, not history: never numbered or replayed. (`kick` is the server's own word to a removed member's streams.) */
const NOT_REPLAYED = new Set(['presence', 'cursor', 'hello', 'thinking', 'overseer', 'kick']);

const live = (gameId: string) => db.collection('games').doc(gameId).collection('live');
const presenceOf = (gameId: string) => db.collection('games').doc(gameId).collection('presence');
const expires = (ms: number) => new Date(Date.now() + ms);

const COLORS = ['#c8421d', '#2f6b4a', '#2f4f8f', '#9a6a12', '#7a3b8f', '#1f7a7a', '#8f2f4f', '#4b4840'];
const colorFor = (userId: string) => COLORS[[...userId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];

async function nextSeq(gameId: string) {
  const ref = db.collection('liveSeq').doc(gameId);
  return db.runTransaction(async (t) => {
    const n = Number((await t.get(ref)).get('n') ?? 0) + 1;
    t.set(ref, { n, at: Date.now() });
    return n;
  });
}
/** Whether the Overseer holds the game's lock (gameai.ts `lock`: locks/thinking:<game> with the time it lets go). */
async function thinkingNow(gameId: string) {
  try { const l = await db.collection('locks').doc(`thinking:${gameId}`).get(); return l.exists && Number(l.get('until')) > Date.now(); } catch { return false; }
}
const currentSeq = async (gameId: string) => Number((await db.collection('liveSeq').doc(gameId).get()).get('n') ?? 0);

/** Tells everyone with the game open (every stream, on every instance). */
export async function broadcast(gameId: string, event: string, data: unknown) {
  const n = NOT_REPLAYED.has(event) ? null : await nextSeq(gameId);
  await live(gameId).add({ event, data: JSON.stringify(data ?? null), n, at: Date.now(), expires: expires(KEEP_MS) });
}
/** A broadcast that must never fail what called it (it is a notice; the change itself is saved). */
export const tell = (gameId: string, event: string, data: unknown) => broadcast(gameId, event, data).catch((e) => console.warn(`[portal] live ${event}: ${e.message}`));

export type PresenceRow = { conn: string; user: string; name: string; file: string | null; color: string };
/** Who has the game open in the editor now. */
export async function presence(gameId: string): Promise<PresenceRow[]> {
  const s = await presenceOf(gameId).where('at', '>', Date.now() - PRESENCE_MS).get();
  return s.docs.map((d) => ({ conn: d.get('conn'), user: d.get('user'), name: d.get('name'), file: d.get('file') ?? null, color: d.get('color') }));
}
export const presenceCount = async (gameId: string) => (await presenceOf(gameId).where('at', '>', Date.now() - PRESENCE_MS).count().get()).data().count;
const announce = async (gameId: string) => tell(gameId, 'presence', await presence(gameId).catch(() => []));

/** What a stream does every beat while it is open (gameai.ts advances the game's generations here). */
export const streamTicks: ((gameId: string) => Promise<unknown>)[] = [];

/** Opens an editor's stream; it ends after LIVE_SECONDS (the browser comes back) or when the browser goes away. */
export async function join(gameId: string, user: { id: string; name: string | null }, req: Request, res: Response, last?: string | null) {
  const perUser = Math.max(1, Number(env('PORTAL_LIVE_PER_USER') ?? 6));
  const mine = await db.collectionGroup('presence').where('user', '==', user.id).get();
  if (mine.docs.filter((d) => Number(d.get('at')) > Date.now() - PRESENCE_MS).length >= perUser) throw new PortalError('Too many editor windows open on this account; close one and try again', { status: 429 });
  const conn = id('c_', 6);
  const color = colorFor(user.id);
  const name = user.name ?? 'someone';
  const after = /^\d+$/.test(last ?? '') ? Number(last) : null;
  // Nothing at or before what this stream already had (or, for a new one, what the editor loads as its state) is sent again.
  let floor = after ?? (await currentSeq(gameId));
  const got = new Set<number>();
  let max = floor;
  const startAt = Date.now();
  const pRef = presenceOf(gameId).doc(conn);
  await pRef.set({ conn, user: user.id, name, file: null, color, at: Date.now(), expires: expires(10 * 60_000) });

  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.flushHeaders?.();
  let open = true;
  const raw = (text: string) => { if (open && !res.writableEnded) try { res.write(text); } catch {} };
  const write = (event: string, data: unknown, n?: number | null) => {
    if (n) {
      if (n <= floor || got.has(n)) return;
      got.add(n);
      if (got.size > 600) got.delete(got.values().next().value!);
      max = Math.max(max, n);
    }
    raw(`${n ? `id: ${max}\n` : ''}event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  };
  raw(`retry: ${RETRY_MS}\n\n`);
  // `thinking`: whether the Overseer is working on a message now (its lock, gameai.ts). The `thinking` event is state and is
  // never replayed, so a stream that came back after the answer ended learns it here and the page stops showing "thinking".
  write('hello', { conn, proc: 'cloud', color, presence: await presence(gameId), resumed: !!last, thinking: await thinkingNow(gameId) });
  void announce(gameId);

  // What it missed (a stream that came back).
  if (after !== null) {
    const missed = await live(gameId).where('n', '>', after).orderBy('n').limit(300).get();
    for (const d of missed.docs) write(d.get('event'), d.get('data'), d.get('n'));
    floor = Math.max(floor, after);
  }

  await new Promise<void>((resolve) => {
    let done = false;
    const end = (bye = false) => {
      if (done) return;
      done = true;
      if (bye) raw('event: bye\ndata: {}\n\n');
      open = false;
      unsubscribe();
      clearInterval(beat);
      clearTimeout(stop);
      try { res.end(); } catch {}
      resolve();
    };
    const unsubscribe = live(gameId).where('at', '>=', startAt - 2000).onSnapshot((snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type !== 'added') continue;
        const d = ch.doc;
        const event = String(d.get('event'));
        const n = d.get('n') as number | null;
        if (event === 'kick') {
          try { if (JSON.parse(d.get('data'))?.user === user.id && Number(d.get('at')) >= startAt) return end(true); } catch {}
          continue;
        }
        if (!n && Number(d.get('at')) < startAt) continue; // state from before this stream: the hello has it
        write(event, d.get('data'), n);
      }
    }, (e) => { console.warn(`[portal] live listener ${gameId}: ${e.message}`); end(); });
    // (Inside this request only: the beat keeps proxies from closing the stream and says who is still here.)
    const beat = setInterval(() => {
      raw(': beat\n\n');
      void pRef.update({ at: Date.now(), expires: expires(10 * 60_000) }).catch(() => {});
      for (const tick of streamTicks) void tick(gameId).catch((e) => console.warn(`[portal] live tick: ${e.message}`));
    }, BEAT_MS);
    const stop = setTimeout(() => end(), LIVE_SECONDS() * 1000);
    // (The response's close, not the request's: a request "closes" as soon as its body has been read.)
    res.on('close', () => end());
    res.on('error', () => end());
    if (res.destroyed || req.socket?.destroyed) end();
  });
  await pRef.delete().catch(() => {});
  await announce(gameId);
}

/** Which file someone has open (and where their cursor is), for everyone else's file list and gutter. */
export async function setPresence(gameId: string, conn: string, userId: string, body: { file?: unknown; line?: unknown }) {
  if (!/^c_[0-9a-f]+$/.test(conn)) return { ok: false };
  const ref = presenceOf(gameId).doc(conn);
  const p = await ref.get();
  if (!p.exists || p.get('user') !== userId) return { ok: false };
  const file = typeof body.file === 'string' ? body.file.slice(0, 200) : null;
  await ref.update({ file, at: Date.now() });
  await announce(gameId);
  if (body.line !== undefined) await tell(gameId, 'cursor', { conn, name: p.get('name'), color: p.get('color'), file, line: Number(body.line) || 0 });
  return { ok: true };
}

/** Ends the streams of someone removed from a game, on every instance. */
export const kick = (gameId: string, userId: string) => tell(gameId, 'kick', { user: userId });

// ------------------------------------------------------------------ who is here (play pages' pings)
/** A play page says it is there (every 30 s): playHere/{game}_{session}, gone after HERE_MS. */
export async function markHere(gameId: string, session: unknown) {
  const s = String(session ?? '').replace(/[^\w-]/g, '').slice(0, 40);
  if (!s) return;
  await db.collection('playHere').doc(`${gameId.replace(/\//g, '_')}_${s}`).set({ game: gameId, s, at: Date.now(), expires: expires(10 * 60_000) });
}

/** How many are playing a game now (its pages' pings) and building it (the editor's live feed open). */
export async function liveCounts(gameId: string) {
  const [p, b] = await Promise.all([
    db.collection('playHere').where('game', '==', gameId).where('at', '>', Date.now() - HERE_MS).count().get(),
    gameId.startsWith('g_') ? presenceCount(gameId) : Promise.resolve(0),
  ]);
  return { playing: p.data().count, building: b };
}

/** Every game's counts at once (the gallery and the Games page: two queries, not two per game). */
export async function allLiveCounts(): Promise<(gameId: string) => { playing: number; building: number }> {
  const [here, editing] = await Promise.all([
    db.collection('playHere').where('at', '>', Date.now() - HERE_MS).get(),
    db.collectionGroup('presence').where('at', '>', Date.now() - PRESENCE_MS).get(),
  ]);
  const playing = new Map<string, number>();
  const building = new Map<string, number>();
  for (const d of here.docs) playing.set(d.get('game'), (playing.get(d.get('game')) ?? 0) + 1);
  for (const d of editing.docs) { const g = d.ref.parent.parent?.id; if (g) building.set(g, (building.get(g) ?? 0) + 1); }
  return (gameId) => ({ playing: playing.get(gameId) ?? 0, building: building.get(gameId) ?? 0 });
}
