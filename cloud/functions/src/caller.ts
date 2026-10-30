// Who is calling, and through what: a personal API key or the signed-in browser. `via` carries the daily credit limit
// that applies.
import type { Request } from 'firebase-functions/https';
import { bearer, fromApiKey, fromSession, type User } from './accounts.ts';
import { cookies } from './http.ts';

export type Via = { kind: 'key' | 'session'; id: string; name?: string; cap: number | null };
export type Caller = { user: User; via: Via };

export async function caller(req: Request): Promise<Caller | null> {
  const token = bearer(req);
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
