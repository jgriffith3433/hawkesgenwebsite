// Island invitations (src/invites.ts; docs/story.md, "Visitors"): a link to the player's island room that works for
// someone with no account. The room is the sandbox template's room on Hawkes Net (t/sandbox/<code>); the link carries a
// signed token (sign.ts) with the code, the inviter's name and, when they have an account, their referral code, so a
// friend who signs up afterwards credits them like ?ref= on the landing page. Nothing here starts Gen work or touches
// credits. Whether the room is open is Hawkes Net's answer (hnet.ts roomInfo): there are no rooms in this process.
import crypto from 'node:crypto';
import { sign, check } from './sign.ts';
import { publicUrl } from './config.ts';
import { Limiter, route, json } from './http.ts';
import { authenticate, refCode } from './accounts.ts';
import { roomInfo } from './hnet.ts';

export const INVITE_TTL = 24 * 3600; // seconds a link works
export const ISLAND = 'sandbox'; // the template whose room an invitation opens
/** Seconds after a link is made in which an empty room still reads open: the inviter's own connection to the room is
 *  still being made (a ticket, a socket), and a friend or a check in that moment must not be told it is closed. */
export const FRESH = 20;

export type RoomState = { open: boolean; people: number; limit: number };
export type Invite = { room: string; name: string; ref: string | null };
export type Status =
  | ({ state: 'open'; message?: undefined } & Invite)
  | { state: 'expired' | 'closed' | 'full' | 'invalid'; message: string; name?: string };

/** A name as the room and the chat show it: letters, numbers and a few marks, at most 24. */
export const cleanName = (v: unknown) => String(v ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 24);
/** A referral code as accounts.ts makes them. */
export const cleanRef = (v: unknown) => { const s = String(v ?? '').toLowerCase(); return /^[a-z0-9]{4,16}$/.test(s) ? s : null; };
/** A room code is 4 to 16 letters and numbers; invitations make theirs, nobody picks one. */
export const newRoomCode = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toLowerCase().slice(0, 8);
/** The island's room on Hawkes Net. */
export const islandRoom = (code: string) => `t/${ISLAND}/${code}`;

/** The link for a new invitation: /play/sandbox?invite=<token>&ref=<code>. */
export function createInvite(base: string, o: { name?: unknown; ref?: unknown }, ttl = INVITE_TTL) {
  const room = newRoomCode();
  const name = cleanName(o.name);
  const ref = cleanRef(o.ref);
  const token = sign({ k: 'island', r: room, n: name, f: ref }, ttl);
  const link = `${base}/play/sandbox?invite=${token}${ref ? `&ref=${ref}` : ''}`;
  return { token, room, link, expires: Math.floor(Date.now() / 1000) + ttl };
}

export const MESSAGES = {
  expired: 'This invitation has run out. Ask for a new one, or start an island of your own.',
  closed: (name?: string) => `${name || 'Your friend'} has left their island, so it is closed for now. Ask for a new link when they are back, or start an island of your own.`,
  full: (name?: string) => `${name ? `${name}'s island` : 'That island'} is full right now. Try again in a little while, or start an island of your own.`,
  invalid: 'This link is not an invitation we can read. You can start an island of your own.',
};

/** The room code an invitation names (or null). */
export function codeOf(token: string): string | null {
  const v = check<{ k: string; r: string }>(String(token ?? ''))?.payload;
  return v && v.k === 'island' && /^[a-z0-9]{4,16}$/.test(String(v.r)) ? String(v.r) : null;
}

/** What an invitation is worth now: open (join this room), or why not, in words for the person who opened it. */
export function inviteStatus(token: string, s: RoomState): Status {
  const c = check<{ k: string; r: string; n: string; f: string | null }>(String(token ?? ''));
  const v = c?.payload;
  if (!c || !v || v.k !== 'island' || !/^[a-z0-9]{4,16}$/.test(String(v.r))) return { state: 'invalid', message: MESSAGES.invalid };
  if (c.expired) return { state: 'expired', message: MESSAGES.expired, name: cleanName(v.n) };
  const invite: Invite = { room: v.r, name: cleanName(v.n), ref: cleanRef(v.f) };
  const fresh = Date.now() / 1000 - (v.e - INVITE_TTL) < FRESH; // (links made with the usual lifetime only)
  if (!s.open && fresh) return { state: 'open', ...invite };
  if (!s.open) return { state: 'closed', message: MESSAGES.closed(invite.name), name: invite.name };
  if (s.people >= s.limit) return { state: 'full', message: MESSAGES.full(invite.name), name: invite.name };
  return { state: 'open', ...invite };
}

// A soft limit per address (one function instance's view).
const inviteMade = new Limiter(30, 3600_000);

// Open routes: neither starts Gen work or touches credits. The inviter may be a guest or an account.
route('POST', '/v1/island-invite', async ({ req, ip }) => {
  inviteMade.take(ip, 'That is a lot of invitations; try again in a while');
  let b: any = {};
  try { b = json(req); } catch { b = {}; }
  const me = await authenticate(req);
  const ref = me ? await refCode(me) : null;
  const inv = createInvite(publicUrl(), { name: b.name || me?.name, ref });
  return { link: inv.link, room: inv.room, expires: inv.expires, ref };
});
route('GET', /^\/v1\/island-invite\/([\w.-]+)$/, async ({ params }) => {
  const code = codeOf(params[0]);
  // Only a link we signed is worth a question to Hawkes Net; the rest are answered from the token alone.
  const c = check<{ k: string }>(params[0]);
  const state = code && c && !c.expired ? await roomInfo(islandRoom(code)) : { open: false, people: 0, limit: 32 };
  return inviteStatus(params[0], state);
});
