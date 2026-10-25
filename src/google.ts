// "Continue with Google" (OpenID Connect, authorization code + PKCE). The state and verifier ride in a signed cookie for
// ten minutes; the ID token comes straight from Google's token endpoint over TLS, so its claims are checked (audience,
// issuer, expiry, verified email) without fetching keys. A Google account signs in to the account with its id, else to
// the one with its verified email (linking it), else a new one.
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from './db.ts';
import { env, publicUrl } from './config.ts';
import { sign, verify } from './sign.ts';
import { createAccount, originOf, type Origin, createSession, getUser, getUserByEmail, parseCookies, setSessionCookie, toPublicUser, type User } from './users.ts';
import { PortalError } from './util.ts';

const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
if (!cols.includes('google_sub')) {
  db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users (google_sub) WHERE google_sub IS NOT NULL');
}

const COOKIE = 'hg_google';
export const googleEnabled = () => Boolean(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'));
const redirectUri = () => `${publicUrl()}/auth/google/callback`;
/** Only our own pages: a path, never another site. */
const safeNext = (n: unknown) => (typeof n === 'string' && /^\/(?!\/)[^\s\\]*$/.test(n) ? n : '/app');

export function start(req: IncomingMessage, res: ServerResponse, next: unknown) {
  if (!googleEnabled()) throw new PortalError('Google sign-in is not set up yet', { status: 503 });
  const state = crypto.randomBytes(16).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const secure = publicUrl().startsWith('https:') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${sign({ s: state, v: verifier, n: safeNext(next) }, 600)}; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=600${secure}`);
  const q = new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID')!, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email profile', state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' });
  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${q}` }).end();
}

/** The claims of Google's ID token, once they check out. */
export function checkClaims(idToken: string, clientId: string, now = Date.now()) {
  const part = String(idToken ?? '').split('.')[1];
  if (!part) throw new PortalError('Google sent no ID token');
  const c = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  if (c.aud !== clientId) throw new PortalError('That Google sign-in was for another app');
  if (c.iss !== 'https://accounts.google.com' && c.iss !== 'accounts.google.com') throw new PortalError('That sign-in did not come from Google');
  if (!c.exp || c.exp * 1000 < now) throw new PortalError('That Google sign-in expired; try again');
  if (!c.sub || !c.email || c.email_verified !== true) throw new PortalError('Your Google account needs a verified email');
  return { sub: String(c.sub), email: String(c.email).toLowerCase(), name: c.name ? String(c.name) : null };
}

/** Finds, links or makes the account for a Google identity. */
export function accountFor(g: { sub: string; email: string; name: string | null }, ip = '', origin: Origin = {}): User {
  const bySub = db.prepare('SELECT id FROM users WHERE google_sub = ?').get(g.sub) as { id: string } | undefined;
  if (bySub) return getUser(bySub.id)!;
  const byEmail = getUserByEmail(g.email);
  if (byEmail) {
    db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(g.sub, byEmail.id);
    return getUser(byEmail.id)!;
  }
  const u = createAccount({ email: g.email, name: g.name }, ip, origin);
  db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(g.sub, u.id);
  return getUser(u.id)!;
}

export async function callback(req: IncomingMessage, res: ServerResponse, q: URLSearchParams, ip: string) {
  const saved = verify<{ s: string; v: string; n: string }>(parseCookies(req)[COOKIE] ?? '');
  const back = (path: string) => res.writeHead(302, { Location: path, 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=0` }).end();
  // (Cancelled in the sandbox's popup: the popup page says so and closes.)
  if (q.get('error')) return back(saved && saved.n === '/auth/popup' ? '/auth/popup?cancelled=1' : `/?signin=cancelled`);
  if (!saved || saved.s !== q.get('state')) throw new PortalError('That sign-in link expired. Try Continue with Google again.');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: q.get('code') ?? '', client_id: env('GOOGLE_CLIENT_ID')!, client_secret: env('GOOGLE_CLIENT_SECRET')!, redirect_uri: redirectUri(), grant_type: 'authorization_code', code_verifier: saved.v }),
    signal: AbortSignal.timeout(15_000),
  });
  const t: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new PortalError(`Google said no: ${t.error_description ?? t.error ?? r.status}`);
  const user = accountFor(checkClaims(t.id_token, env('GOOGLE_CLIENT_ID')!), ip, originOf(req));
  if (user.disabled) throw new PortalError('This account is disabled. Contact support@hawkesgen.com.', { status: 403 });
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);
  setSessionCookie(res, req, createSession(user.id));
  const next = user.role === 'admin' && saved.n === '/app' ? '/admin' : saved.n;
  res.setHeader('Set-Cookie', [res.getHeader('Set-Cookie') as string, `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=0`]);
  res.writeHead(302, { Location: next }).end();
  return toPublicUser(user);
}
