// Player analytics for pages that can't send it themselves (src/analytics.ts on the old server; Gen's Hawkes Analytics,
// product hawkesgen). A published game runs in a sandbox with no origin and no storage of its own, so its SDK sends to
// this site (POST /v1/analytics/collect, open CORS), and we pass the batch on to Gen's relay with our key, the page's
// origin, the visitor's address and browser. The play page is given its ids when the player is signed in (playIds).
//
// Changed: the old server answered 202 and sent to Gen afterwards. A function may be paused once it has answered, so the
// relay to Gen is awaited (at most 5 s) before the 202; a beacon never reads the answer, and errors still never reach it.
// The 120 a minute per address limit is a soft in-memory Limiter (per function instance).
import crypto from 'node:crypto';
import { genKey, genUrl, publicUrl, SECRETS } from './config.ts';
import { Limiter, route } from './http.ts';
import type { User } from './accounts.ts';

const LIMIT = 64 * 1024;
const posts = new Limiter(120, 60_000);
const OPEN = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

route('OPTIONS', '/v1/analytics/collect', ({ res }) => void res.status(204).set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }).end());
route('POST', '/v1/analytics/collect', async ({ req, res, ip }) => {
  const done = (status: number) => void res.status(status).set(OPEN).send(JSON.stringify({ ok: status === 202 }));
  if (!posts.hit(ip)) return void res.status(429).set(OPEN).send('{"ok":false}');
  const body: Buffer = req.rawBody ?? Buffer.alloc(0);
  if (body.length > LIMIT) return done(413);
  await fetch(`${genUrl()}/v1/analytics/relay`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${genKey()}`,
      'Content-Type': 'text/plain;charset=UTF-8',
      'X-Hawkes-Relay-Origin': new URL(publicUrl()).origin,
      'X-Hawkes-Visitor-Ip': ip,
      'X-Hawkes-Visitor-Ua': String(req.headers['user-agent'] ?? '').slice(0, 500),
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(5_000),
  }).then((r) => r.body?.cancel()).catch(() => {});
  done(202);
});

/** A keyed digest (base64url) with the portal's signing key, as the old sign.ts digest. */
const digest = (text: string) => crypto.createHmac('sha256', SECRETS.signing.value()).update(text).digest('base64url');

/** A signed-in player's ids for a game page: their account id and a stable anonymous id made from it (never the reverse). */
export function playIds(user: User | null): { anon: string; user: string } | null {
  if (!user) return null;
  return { anon: `u_${digest(`analytics:${user.id}`).slice(0, 22)}`, user: user.id };
}

/** The script tag that hands them to the page (before the page's own scripts). */
export function playIdsScript(ids: { anon: string; user: string } | null) {
  if (!ids) return '';
  return `<script>window.HAWKES_PLAY_IDS=${JSON.stringify(ids).replace(/</g, '\\u003c')};</script>`;
}
