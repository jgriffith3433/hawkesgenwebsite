// Island invitations: a link to the player's island room that works for someone with no account (docs/story.md,
// "Visitors"). The room is the sandbox template's play room (rooms.ts: play:t/sandbox:<code>), made by the inviter's own
// connection; the link carries a signed token (sign.ts) with the code, the inviter's name and, when they have an account,
// their referral code, so a friend who signs up afterwards credits them like ?ref= on the landing page (users.ts originOf).
// Nothing here starts Gen work or touches credits.
import crypto from 'node:crypto';
import { sign, check } from './sign.ts';

export const INVITE_TTL = 24 * 3600; // seconds a link works
export const ISLAND = 'sandbox'; // the template whose room an invitation opens

export type RoomState = { open: boolean; people: number; limit: number };
export type Invite = { room: string; name: string; ref: string | null };
export type Status =
  | ({ state: 'open'; message?: undefined } & Invite)
  | { state: 'expired' | 'closed' | 'full' | 'invalid'; message: string; name?: string };

/** A name as the room and the chat show it: letters, numbers and a few marks, at most 24. */
export const cleanName = (v: unknown) => String(v ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 24);
/** A referral code as users.ts makes them (originOf accepts the same shape). */
export const cleanRef = (v: unknown) => { const s = String(v ?? '').toLowerCase(); return /^[a-z0-9]{4,16}$/.test(s) ? s : null; };
/** A room code is 4 to 16 letters and numbers (rooms.ts); invitations make theirs, nobody picks one. */
export const newRoomCode = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toLowerCase().slice(0, 8);
export const islandKey = (code: string) => `play:t/${ISLAND}:${code}`;

/** The link for a new invitation: /play/sandbox?invite=<token>&ref=<code>. `ref` goes in the address too, so the landing
 *  page's cookie logic (and the sandbox's, guest.js) keeps it for the sign-up. */
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

/** The room code an invitation names (or null), to ask whether its room is open before inviteStatus. */
export function codeOf(token: string): string | null {
  const v = check<{ k: string; r: string }>(String(token ?? ''))?.payload;
  return v && v.k === 'island' && /^[a-z0-9]{4,16}$/.test(String(v.r)) ? String(v.r) : null;
}

/** What an invitation is worth now: open (join this room), or why not, in words for the person who opened it. `state` says
 *  how the room is (rooms.ts roomState). */
export function inviteStatus(token: string, state: (key: string) => RoomState): Status {
  const c = check<{ k: string; r: string; n: string; f: string | null }>(String(token ?? ''));
  const v = c?.payload;
  if (!c || !v || v.k !== 'island' || !/^[a-z0-9]{4,16}$/.test(String(v.r))) return { state: 'invalid', message: MESSAGES.invalid };
  if (c.expired) return { state: 'expired', message: MESSAGES.expired, name: cleanName(v.n) };
  const invite: Invite = { room: v.r, name: cleanName(v.n), ref: cleanRef(v.f) };
  const s = state(islandKey(v.r));
  if (!s.open) return { state: 'closed', message: MESSAGES.closed(invite.name), name: invite.name };
  if (s.people >= s.limit) return { state: 'full', message: MESSAGES.full(invite.name), name: invite.name };
  return { state: 'open', ...invite };
}
