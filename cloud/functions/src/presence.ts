// Presence on the platform (src/presence.ts): a player's look (users/{id}.avatar), what the Overseer remembers of them
// (users/{id}.overseer), who the people in a room really are (signed badges), and friend requests from inside a game.
// The game runs sandboxed (no cookies), so every route here also takes the game's signed room token (`t`: the editor's
// bundle carries it; sign.ts) and answers with open CORS; signed in on this site (session or API key) works too.
//   GET  /v1/users/me/avatar[?t=]          { user, avatar, badge, friends }   (badge: a signed "this is me" for the room)
//   POST /v1/users/me/avatar {avatar, t?}  { avatar }                         (validated, at most AVATAR.maxBytes)
//   GET/POST /v1/users/me/overseer         { overseer }                       (what the Overseer remembers of the player: cleanMemory)
//   POST /v1/presence/who {badges, t?}     { who: [{ i, user, name, friend }] } (only badges this server signed)
//   POST /v1/friends/request {to, t?}      { status: 'requested' | 'friends' } (friends once both have asked)
// The look and the memory are kept as maps on the user's document (the SQLite columns held JSON text; cloud/migrate.mjs
// parses it). Friend requests: friendRequests/{from_id}:{to_id} (the table's two-column key).
import type { Request } from 'firebase-functions/https';
import type { Response } from 'express';
import { db, users } from './store.ts';
import { USER_ID } from './config.ts';
import { PortalError, Limiter, route, send, json, type Ctx } from './http.ts';
import { sign, verify } from './sign.ts';
import { authenticate, getUser, type User } from './accounts.ts';
import { addFriend, areFriends, listFriends } from './friends.ts';

/** What a look may hold. Keep in step with public/play/modules/presence/presence-core.js (LOOK). */
export const AVATAR = {
  maxBytes: 1024,
  shapes: ['normal', 'tall', 'short', 'wide', 'tiny', 'big'],
  hats: ['none', 'cap', 'beanie', 'tophat', 'crown', 'cowboy', 'party', 'halo', 'horns', 'bunny', 'helmet', 'chef'],
  extras: ['glasses', 'shades', 'scarf', 'backpack', 'cape', 'bowtie', 'wings', 'tail'],
  faces: ['visor', 'eyes', 'smile', 'none'],
  hairs: ['short', 'long', 'ponytail', 'curly', 'spiky', 'bun'],
  maxExtras: 3,
  accessories: ['none', 'headphones', 'goggles', 'monocle', 'mustache', 'eyepatch', 'flower', 'antenna', 'medal', 'bell', 'jetpack', 'bandana', 'earrings'],
  // What you are (public/play/modules/presence/presence-core.js WHATS: keep the ids in step) and your character's name.
  whats: ['person', 'robot', 'tvbot', 'rollbot', 'dog', 'cat', 'fox', 'pig', 'bear', 'rabbit', 'penguin', 'chicken', 'cow', 'sheep', 'horse', 'dinosaur', 'fish', 'shoe', 'toaster', 'cactus', 'cone', 'teapot', 'banana', 'mushroom', 'potato', 'duck'],
  nameMax: 24,
};
const HEX = /^#[0-9a-f]{6}$/i;
const FRIEND_REQUESTS_PER_DAY = 60;

/** A look from anyone, cleaned: unknown keys dropped, every value checked. Throws on what can't be a look. */
export function cleanAvatar(v: unknown) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new PortalError('avatar must be an object');
  if (JSON.stringify(v).length > AVATAR.maxBytes) throw new PortalError(`avatar is too big (${AVATAR.maxBytes} bytes at most)`, { status: 413 });
  const a = v as Record<string, unknown>;
  const color = (k: string, d: string) => { const c = a[k] ?? d; if (typeof c !== 'string' || !HEX.test(c)) throw new PortalError(`avatar.${k} must be a color like #4a9eff`); return c.toLowerCase(); };
  const one = (k: string, list: string[], d: string) => { const x = a[k] ?? d; if (typeof x !== 'string' || !list.includes(x)) throw new PortalError(`avatar.${k} must be one of ${list.join(', ')}`); return x; };
  const ratio = (k: string, lo: number, hi: number) => { const x = Number(a[k]); return a[k] === undefined || a[k] === null || !Number.isFinite(x) ? 1 : Math.round(Math.max(lo, Math.min(hi, x)) * 100) / 100; };
  const extras = a.extras ?? [];
  if (!Array.isArray(extras) || extras.length > AVATAR.maxExtras || extras.some((x) => typeof x !== 'string' || !AVATAR.extras.includes(x))) throw new PortalError(`avatar.extras: up to ${AVATAR.maxExtras} of ${AVATAR.extras.join(', ')}`);
  const model = a.model ?? null;
  if (model !== null && (typeof model !== 'string' || !/^a_[0-9a-f]{6,40}$/.test(model))) throw new PortalError('avatar.model must be an asset id (a_...) or null');
  return {
    body: color('body', '#4a9eff'), head: color('head', '#f2c9a0'), accent: color('accent', '#ffffff'),
    shape: one('shape', AVATAR.shapes, 'normal'), hat: one('hat', AVATAR.hats, 'none'), face: one('face', AVATAR.faces, 'eyes'),
    extras: [...new Set(extras as string[])], model,
    what: one('what', AVATAR.whats, 'person'),
    // The person's hair and clothes (body is the top).
    hair: one('hair', AVATAR.hairs, 'short'), hairColor: color('hairColor', '#4a3322'), bottom: color('bottom', '#3b4a6b'), shoes: color('shoes', '#f2f2ee'),
    // The eyes' color, one accessory and its color.
    eyeColor: color('eyeColor', '#14161d'), accessory: one('accessory', AVATAR.accessories, 'none'), accessoryColor: color('accessoryColor', '#ffffff'),
    // Proportions: the head's size and the whole body's, times normal (out of range is clamped, not refused).
    headSize: ratio('headSize', 0.5, 3), bodySize: ratio('bodySize', 0.3, 4),
    // A name is only words over your head: one line, no markup, short (anything else is dropped, not refused).
    name: typeof a.name === 'string' ? a.name.replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, AVATAR.nameMax) || null : null,
  };
}

/** What the Overseer may remember of a player (public/play/modules/overseer/memory.js clean(): keep in step). Only in-game facts. */
export const MEMORY = {
  maxBytes: 4096,
  fishMax: 48,
  raceMax: 8,
  firsts: ['first-drive', 'first-fish', 'first-boom', 'first-build', 'first-dock', 'first-space', 'first-race', 'first-ask', 'first-help'],
  deeds: ['fish', 'boom', 'build', 'dock', 'high', 'space', 'drive', 'ask', 'fall'],
  counts: ['fish', 'boom', 'build', 'dock', 'high', 'space', 'ask', 'fall'],
  // Chapter One world marks (src/overseer-games/world-marks.js): lasting island changes per tour step.
  marks: ['drive', 'fish', 'boom', 'spawn', 'ask', 'hill', 'fly', 'launch'],
  recent: 8,
};
function cleanFish(f: unknown) {
  const out: Record<string, number[]> = {};
  if (!f || typeof f !== 'object' || Array.isArray(f)) return out;
  const int = (x: unknown, max: number) => { const n = Math.floor(Number(x)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
  for (const [id, e] of Object.entries(f as Record<string, unknown>)) {
    if (Object.keys(out).length >= MEMORY.fishMax) break;
    if (!/^[a-z0-9-]{1,32}$/.test(id) || !Array.isArray(e)) continue;
    const n = int(e[0], 100000);
    if (n) out[id] = [n, int(e[1], 1e7), int(e[2], 2000)];
  }
  return out;
}
function cleanRace(r: unknown) {
  const out: Record<string, number> = {};
  if (!r || typeof r !== 'object' || Array.isArray(r)) return out;
  for (const [id, v] of Object.entries(r as Record<string, unknown>)) {
    if (Object.keys(out).length >= MEMORY.raceMax) break;
    const ms = Math.floor(Number(v));
    if (/^[a-z0-9-]{1,32}$/.test(id) && Number.isFinite(ms) && ms > 0) out[id] = Math.min(ms, 1e7);
  }
  return out;
}
const cleanIds = (x: unknown): string[] => (Array.isArray(x) ? [...new Set(x.filter((i): i is string => typeof i === 'string' && /^[a-z0-9-]{1,32}$/.test(i)))].slice(0, 16) : []);
const dayOf = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(`${x}T00:00:00Z`)) ? x : null);
function cleanWish(w: any) {
  const n = (x: unknown, max: number) => { const v = Math.floor(Number(x)); return Number.isFinite(v) && v > 0 ? Math.min(v, max) : 0; };
  const last = dayOf(w?.last), st = last ? Math.max(1, n(w?.st, 100000)) : 0;
  const set = Array.isArray(w?.set) ? [...new Set((w.set as unknown[]).filter((x): x is string => typeof x === 'string' && /^[a-z0-9-]{1,32}$/.test(x)))].slice(0, 8) : [];
  return { last, st, best: Math.max(st, n(w?.best, 100000)), day: dayOf(w?.day), n: n(w?.n, 1e6), set, said: w?.said ? 1 : 0 };
}
function cleanMarks(m: any) {
  const done: string[] = [];
  if (Array.isArray(m?.done)) for (const x of m.done) if (typeof x === 'string' && MEMORY.marks.includes(x) && !done.includes(x) && done.length < 8) done.push(x);
  const last = typeof m?.last === 'string' && MEMORY.marks.includes(m.last) && done.includes(m.last) ? m.last : (done.length ? done[done.length - 1] : null);
  return { done, last };
}
export function cleanMemory(v: unknown) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new PortalError('overseer must be an object');
  if (JSON.stringify(v).length > MEMORY.maxBytes) throw new PortalError(`overseer is too big (${MEMORY.maxBytes} bytes at most)`, { status: 413 });
  const a = v as Record<string, any>;
  const int = (x: unknown, max: number) => { const n = Math.floor(Number(x)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
  const id = (x: unknown) => (typeof x === 'string' && /^[a-z0-9-]{1,32}$/.test(x) ? x : null);
  const last = a.last && typeof a.last === 'object' && MEMORY.deeds.includes(a.last.id) ? { id: a.last.id as string, at: int(a.last.at, 4e12), visit: int(a.last.visit, 100000) } : null;
  const g = a.greet && typeof a.greet === 'object' ? a.greet : {};
  return {
    v: 1, visits: int(a.visits, 100000), firstAt: int(a.firstAt, 4e12), lastAt: int(a.lastAt, 4e12),
    name: typeof a.name === 'string' ? a.name.replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, AVATAR.nameMax) || null : null,
    what: typeof a.what === 'string' && AVATAR.whats.includes(a.what) ? a.what : null,
    last,
    n: Object.fromEntries(MEMORY.counts.map((k) => [k, int(a.n?.[k], 100000)])),
    driveS: int(a.driveS, 1e8), playS: int(a.playS, 1e8),
    // The catch log (fishing): species id -> [times caught, heaviest in kg x 100, longest in cm].
    fish: cleanFish(a.fish), fishPts: int(a.fishPts, 1e9),
    // The race bests (race module): course id -> best time in ms.
    race: cleanRace(a.race),
    // The journal (the sandbox): ids of the neighbours met and the lore found.
    met: cleanIds(a.met), lore: cleanIds(a.lore),
    // The wardrobe (the Observatory): accessories owned (ids) and colors (hex without the #).
    own: { acc: cleanIds(a.own?.acc), col: cleanIds(a.own?.col).filter((c) => /^[0-9a-f]{6}$/i.test(c)).map((c) => c.toLowerCase()) },
    // Progress (modules/progress): points, the firsts done, meters driven, the highest level whose moment was shown.
    prog: { p: int(a.prog?.p, 1e7), f: Array.isArray(a.prog?.f) ? [...new Set((a.prog.f as unknown[]).filter((x): x is string => typeof x === 'string' && MEMORY.firsts.includes(x)))] : [], d: int(a.prog?.d, 1e9), s: Math.max(1, int(a.prog?.s, 20)) },
    // The daily wish (modules/wish): the day of the last wish done, its streak, and today's progress (days are UTC dates).
    wish: cleanWish(a.wish),
    // Chapter One world marks (world-marks.js): lasting visible changes on the island per tour step.
    marks: cleanMarks(a.marks),
    greet: { last: id(g.last), recent: Array.isArray(g.recent) ? (g.recent as unknown[]).map(id).filter((x: string | null): x is string => x !== null).slice(-MEMORY.recent) : [] },
  };
}
/** A stored look or memory: a map (here) or JSON text (a row copied as it was). */
const parsed = (v: unknown) => {
  if (typeof v !== 'string') return v ?? null;
  try { return JSON.parse(v); } catch { return null; }
};

export async function getMemory(userId: string) {
  const s = await users().doc(userId).get();
  const v = s.exists ? parsed(s.get('overseer')) : null;
  if (!v) return null;
  try { return cleanMemory(v); } catch { return null; }
}
export async function setMemory(userId: string, v: unknown) {
  const m = v === null ? null : cleanMemory(v);
  await users().doc(userId).update({ overseer: m });
  return m;
}

export async function getAvatar(userId: string, doc?: FirebaseFirestore.DocumentSnapshot) {
  const s = doc ?? await users().doc(userId).get();
  const v = s.exists ? parsed(s.get('avatar')) : null;
  if (!v) return null;
  try { return cleanAvatar(v); } catch { return null; }
}
export async function setAvatar(userId: string, v: unknown) {
  const a = v === null ? null : cleanAvatar(v);
  await users().doc(userId).update({ avatar: a });
  return a;
}

/** A signed "this is me" a player shows the room; others turn it into a user with /v1/presence/who. */
export const badgeFor = (u: User) => sign({ k: 'who', u: u.id }, 12 * 3600);

export async function who(me: User | null, badges: unknown) {
  if (!Array.isArray(badges)) throw new PortalError('badges must be a list');
  const seen = badges.slice(0, 40).map((b, i) => ({ i, v: verify<{ k: string; u: string }>(String(b ?? '')) })).filter((x) => x.v && x.v.k === 'who' && typeof x.v.u === 'string');
  if (!seen.length) return { who: [] };
  const docs = await db.getAll(...[...new Set(seen.map((x) => x.v!.u))].map((u) => users().doc(u)));
  const byId = new Map(docs.filter((d) => d.exists && !d.get('disabled')).map((d) => [d.id, d]));
  const out: { i: number; user: string; name: string | null; friend: boolean; avatar: unknown }[] = [];
  for (const { i, v } of seen) {
    const d = byId.get(v!.u);
    if (!d) continue;
    out.push({ i, user: d.id, name: (d.get('name') ?? null) as string | null, friend: Boolean(me && me.id !== d.id && await areFriends(me.id, d.id)), avatar: await getAvatar(d.id, d) });
  }
  return { who: out };
}

// Friend requests, a few a minute per player (a soft limit: one function instance's view) on top of the daily count kept
// in Firestore (a script in a game can post to the route).
const friendAsks = new Limiter(10, 60_000);
export const friendRequests = () => db.collection('friendRequests');

export async function requestFriend(me: User, to: unknown) {
  const id = String(to ?? '');
  if (!new RegExp(`^${USER_ID}$`).test(id)) throw new PortalError('to must be a player id');
  if (id === me.id) throw new PortalError("That's you");
  const them = await getUser(id);
  if (!them || them.disabled) throw new PortalError('No such player', { status: 404 });
  if (await areFriends(me.id, id)) return { status: 'friends' as const };
  friendAsks.take(me.id, 'Slow down a little; try again in a minute');
  return db.runTransaction(async (t) => {
    const theirs = friendRequests().doc(`${id}:${me.id}`);
    const mine = friendRequests().doc(`${me.id}:${id}`);
    const asked = await t.get(theirs);
    if (asked.exists) {
      t.delete(theirs);
      t.delete(mine);
      await addFriend(me.id, id, t);
      return { status: 'friends' as const };
    }
    const today = (await t.get(friendRequests().where('from_id', '==', me.id).where('created', '>', Date.now() - 86400_000).count())).data().count;
    if (today >= FRIEND_REQUESTS_PER_DAY) throw new PortalError('Too many friend requests today', { status: 429 });
    const had = await t.get(mine);
    if (!had.exists) t.create(mine, { from_id: me.id, to_id: id, created: Date.now() });
    return { status: 'requested' as const };
  });
}

/** Who is asking: the game's room token (`t`), else this site's sign-in. */
async function caller(req: Request, t: unknown): Promise<User | null> {
  if (t) {
    const v = verify<{ k: string; u: string }>(String(t));
    if (!v || v.k !== 'edit') return null;
    const u = await getUser(v.u);
    return u && !u.disabled ? u : null;
  }
  return authenticate(req);
}

// ------------------------------------------------------------ routes (open CORS: the game's sandbox has no origin)

const PATHS = ['/v1/users/me/avatar', '/v1/users/me/overseer', '/v1/presence/who', '/v1/friends/request'];
const openCors = (res: Response) => void res.set('Access-Control-Allow-Origin', '*');

for (const p of PATHS) {
  route('OPTIONS', p, ({ res }) => {
    res.status(204).set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }).end();
  });
}

/** Every presence request: open CORS, the body, the caller (token or sign-in); null `me` answered here. */
async function start(c: Ctx, needMe: boolean) {
  openCors(c.res);
  const body = c.method === 'POST' ? json(c.req) : {};
  const me = await caller(c.req, body.t ?? c.url.searchParams.get('t'));
  if (needMe && !me) {
    // ?soft=1: a page asking who it is before sign-in gets a plain "nobody" instead of a 401 in the console
    if (c.method === 'GET' && c.url.searchParams.get('soft')) { send(c.res, 200, { user: null, avatar: null, badge: null, friends: [], overseer: null }); return null; }
    send(c.res, 401, { error: 'Sign in to keep your look and make friends' });
    return null;
  }
  return { body, me };
}

route('POST', '/v1/presence/who', async (c) => { const s = await start(c, false); return s ? who(s.me, s.body.badges) : undefined; });
route('GET', '/v1/users/me/avatar', async (c) => {
  const s = await start(c, true);
  if (!s?.me) return;
  const me = s.me;
  return { user: { id: me.id, name: me.name }, avatar: await getAvatar(me.id), badge: badgeFor(me), friends: (await listFriends(me.id)).map((f) => f.id) };
});
route('POST', '/v1/users/me/avatar', async (c) => { const s = await start(c, true); return s?.me ? { avatar: await setAvatar(s.me.id, s.body.avatar ?? null) } : undefined; });
route('GET', '/v1/users/me/overseer', async (c) => { const s = await start(c, true); return s?.me ? { user: { id: s.me.id }, overseer: await getMemory(s.me.id) } : undefined; });
route('POST', '/v1/users/me/overseer', async (c) => { const s = await start(c, true); return s?.me ? { overseer: await setMemory(s.me.id, s.body.overseer ?? null) } : undefined; });
route('POST', '/v1/friends/request', async (c) => { const s = await start(c, true); return s?.me ? requestFriend(s.me, s.body.to) : undefined; });
// Any other method on these paths: 405, with open CORS like the rest.
for (const p of PATHS) {
  for (const m of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
    route(m, p, ({ res }) => { openCors(res); send(res, 405, { error: 'Method not allowed' }); });
  }
}
