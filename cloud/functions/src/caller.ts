// Who is calling, and through what: an OAuth connection (an editor the customer approved), a personal API key, or the
// signed-in browser. `via` carries the daily credit limit that applies. OAuth tokens are oauth.ts's: it registers
// `accessTokens.from` when it loads.
import type { Request } from 'firebase-functions/https';
import { bearer, fromApiKey, fromSession, type User } from './accounts.ts';
import { cookies } from './http.ts';

// A connection also carries the org it acts for and its OAuth scopes (oauth.ts). Everything else the portal's API does
// with a token is Gen work, so a connection without `generate` is no caller there: it may only mint platform tokens
// (platform-token.ts, `anyScope`) for Studio and Net.
export type Via = { kind: 'connection' | 'key' | 'session'; id: string; name?: string; cap: number | null; org?: string; scopes?: string[] };
export type Caller = { user: User; via: Via };

export const accessTokens: { from: (token: string) => Promise<Caller | null> } = { from: async () => null };

export async function caller(req: Request, o: { anyScope?: boolean } = {}): Promise<Caller | null> {
  const token = bearer(req);
  if (token.startsWith('hgo_')) {
    const c = await accessTokens.from(token);
    return c && (o.anyScope || (c.via.scopes ?? ['generate']).includes('generate')) ? c : null;
  }
  if (token) {
    const k = await fromApiKey(token);
    return k ? { user: k.user, via: { kind: 'key', id: k.key.id, name: `API key ${k.key.prefix}…`, cap: k.key.daily_cap } } : null;
  }
  const user = await fromSession(req);
  return user ? { user, via: { kind: 'session', id: `session:${String(cookies(req).__session ?? '').slice(-8)}`, cap: null } } : null;
}

export async function requireCaller(req: Request) {
  const c = await caller(req);
  if (!c) throw Object.assign(new Error('Sign in first'), { status: 401 });
  return c;
}
