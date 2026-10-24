// Player analytics for pages that can't send it themselves (Gen's Hawkes Analytics, product hawkesgen;
// hawkesgen/docs/analytics.md). A published game runs in a sandbox with no origin and no storage of its own, so:
// - its SDK sends to this site (POST /v1/analytics/collect), and we pass the batch on to Gen's relay route with our key, saying the
//   page's origin (this site), the visitor's address (Gen turns it into a city and drops it) and browser;
// - the play page is given its ids when the player is signed in: the account id and an anonymous id made from it, so
//   their sessions in games join the rest of theirs. A guest's game page has a new anonymous id each visit.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { genKey, genUrl, publicUrl } from './config.ts';
import { readBody } from './util.ts';
import { digest } from './sign.ts';
import type { User } from './users.ts';

const LIMIT = 64 * 1024;

export async function relayAnalytics(req: IncomingMessage, res: ServerResponse, ip: string) {
  const done = (status: number) => {
    res.writeHead(status, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: status === 202 }));
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' });
    return void res.end();
  }
  let body: Buffer;
  try {
    body = await readBody(req, LIMIT);
  } catch {
    return done(413);
  }
  // The page never waits on Gen (beacons don't read the answer), and never gets an error from here.
  void fetch(`${genUrl()}/v1/analytics/relay`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${genKey()}`,
      'Content-Type': 'text/plain;charset=UTF-8',
      'X-Hawkes-Relay-Origin': new URL(publicUrl()).origin,
      'X-Hawkes-Visitor-Ip': ip,
      'X-Hawkes-Visitor-Ua': String(req.headers['user-agent'] ?? '').slice(0, 500),
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {});
  done(202);
}

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
