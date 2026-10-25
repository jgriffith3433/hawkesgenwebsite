// Presence on the platform: a player's look (users.avatar), who the people in a room really are (signed badges), and
// friend requests from inside a game. The game runs sandboxed (no cookies), so every route here also takes the game's
// signed room token (`t`: the editor's bundle carries it) and answers with open CORS; signed in on this site (cookie or
// API key) works too. The engine side is public/play/modules/presence/.
//   GET  /v1/users/me/avatar[?t=]          { user, avatar, badge, friends }   (badge: a signed "this is me" for the room)
//   POST /v1/users/me/avatar {avatar, t?}  { avatar }                         (validated, at most AVATAR.maxBytes)
//   POST /v1/presence/who {badges, t?}     { who: [{ i, user, name, friend }] } (only badges this server signed)
//   POST /v1/friends/request {to, t?}      { status: 'requested' | 'friends' } (friends once both have asked)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db, tx } from './db.ts';
import { USER_ID } from './config.ts';
import { send, readJson, PortalError } from './util.ts';
import { sign, verify } from './sign.ts';
import { authenticate, getUser, type User } from './users.ts';
import { addFriend, areFriends, listFriends } from './friends.ts';

if (!(db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).some((c) => c.name === 'avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS friend_requests (
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
`);

/** What a look may hold. Keep in step with public/play/modules/presence/presence-core.js (LOOK). */
export const AVATAR = {
  maxBytes: 1024,
  shapes: ['normal', 'tall', 'short', 'wide', 'tiny', 'big'],
  hats: ['none', 'cap', 'beanie', 'tophat', 'crown', 'cowboy', 'party', 'halo', 'horns', 'bunny', 'helmet', 'chef'],
  extras: ['glasses', 'shades', 'scarf', 'backpack', 'cape', 'bowtie', 'wings', 'tail'],
  faces: ['visor', 'eyes', 'smile', 'none'],
  hairs: ['short', 'long', 'ponytail', 'curly', 'spiky', 'bun'],
  maxExtras: 3,
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
    // A name is only words over your head: one line, no markup, short (anything else is dropped, not refused).
    name: typeof a.name === 'string' ? a.name.replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, AVATAR.nameMax) || null : null,
  };
}

export function getAvatar(userId: string) {
  const row = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId) as { avatar: string | null } | undefined;
  if (!row || !row.avatar) return null;
  try { return cleanAvatar(JSON.parse(row.avatar)); } catch { return null; }
}
export function setAvatar(userId: string, v: unknown) {
  const a = v === null ? null : cleanAvatar(v);
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(a ? JSON.stringify(a) : null, userId);
  return a;
}

/** A signed "this is me" a player shows the room; others turn it into a user with /v1/presence/who. */
export const badgeFor = (u: User) => sign({ k: 'who', u: u.id }, 12 * 3600);

export function who(me: User | null, badges: unknown) {
  if (!Array.isArray(badges)) throw new PortalError('badges must be a list');
  const out: { i: number; user: string; name: string | null; friend: boolean; avatar: unknown }[] = [];
  badges.slice(0, 40).forEach((b, i) => {
    const v = verify<{ k: string; u: string }>(String(b ?? ''));
    if (!v || v.k !== 'who') return;
    const u = getUser(v.u);
    if (!u || u.disabled) return;
    out.push({ i, user: u.id, name: u.name, friend: Boolean(me && me.id !== u.id && areFriends(me.id, u.id)), avatar: getAvatar(u.id) });
  });
  return { who: out };
}

export function requestFriend(me: User, to: unknown) {
  const id = String(to ?? '');
  if (!new RegExp(`^${USER_ID}$`).test(id)) throw new PortalError('to must be a player id');
  if (id === me.id) throw new PortalError("That's you");
  const them = getUser(id);
  if (!them || them.disabled) throw new PortalError('No such player', { status: 404 });
  if (areFriends(me.id, id)) return { status: 'friends' as const };
  return tx(() => {
    const asked = db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?').get(id, me.id);
    if (asked) {
      db.prepare('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(id, me.id, me.id, id);
      addFriend(me.id, id);
      return { status: 'friends' as const };
    }
    const today = (db.prepare('SELECT COUNT(*) AS n FROM friend_requests WHERE from_id = ? AND created > ?').get(me.id, Date.now() - 86400_000) as { n: number }).n;
    if (today >= FRIEND_REQUESTS_PER_DAY) throw new PortalError('Too many friend requests today', { status: 429 });
    db.prepare('INSERT OR IGNORE INTO friend_requests (from_id, to_id, created) VALUES (?, ?, ?)').run(me.id, id, Date.now());
    return { status: 'requested' as const };
  });
}

/** Who is asking: the game's room token (`t`), else this site's sign-in. */
function caller(req: IncomingMessage, t: unknown): User | null {
  if (t) {
    const v = verify<{ k: string; u: string }>(String(t));
    if (!v || v.k !== 'edit') return null;
    const u = getUser(v.u);
    return u && !u.disabled ? u : null;
  }
  return authenticate(req);
}

/** Every /v1/users/me/avatar, /v1/presence/who and /v1/friends/request request (server.ts sends them here). */
export async function presenceRoute(req: IncomingMessage, res: ServerResponse, route: string, method: string) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return void res.writeHead(204).end();
  }
  const url = new URL(req.url ?? '/', 'http://x');
  const body = method === 'POST' ? await readJson(req) : {};
  const me = caller(req, body.t ?? url.searchParams.get('t'));
  if (route === '/v1/presence/who' && method === 'POST') return send(res, 200, who(me, body.badges));
  if (!me) return send(res, 401, { error: 'Sign in to keep your look and make friends' });
  if (route === '/v1/users/me/avatar' && method === 'GET') return send(res, 200, { user: { id: me.id, name: me.name }, avatar: getAvatar(me.id), badge: badgeFor(me), friends: listFriends(me.id).map((f) => f.id) });
  if (route === '/v1/users/me/avatar' && method === 'POST') return send(res, 200, { avatar: setAvatar(me.id, body.avatar ?? null) });
  if (route === '/v1/friends/request' && method === 'POST') return send(res, 200, requestFriend(me, body.to));
  return send(res, 405, { error: 'Method not allowed' });
}
