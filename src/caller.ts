// Who is calling, and through what: an OAuth connection (an editor the customer approved), a personal API key, or the
// signed-in browser. `via` carries the daily credit limit that applies.
import type { IncomingMessage } from 'node:http';
import { bearer, fromApiKey, sessionToken, authenticate, type User } from './users.ts';
import { fromAccessToken, type Via } from './oauth.ts';

export type Caller = { user: User; via: Via };

export function caller(req: IncomingMessage): Caller | null {
  const token = bearer(req);
  if (token.startsWith('hgo_')) return fromAccessToken(token);
  if (token) {
    const k = fromApiKey(token);
    return k ? { user: k.user, via: { kind: 'key', id: k.key.id, name: `API key ${k.key.prefix}…`, cap: k.key.daily_cap } } : null;
  }
  const user = authenticate(req);
  return user ? { user, via: { kind: 'session', id: `session:${sessionToken(req)?.slice(0, 8)}`, cap: null } } : null;
}
