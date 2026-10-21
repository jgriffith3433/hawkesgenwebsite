// Customer accounts: scrypt passwords, session cookies, personal API keys (hg_...), and who a request is.
// Each customer works in their own Gen project (usr_<id>); the portal's Gen key is narrowed to it on every call.
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db, tx } from './db.ts';
import { env, PROJECT_PREFIX } from './config.ts';
import { id, sha256, PortalError } from './util.ts';

export type User = {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  project: string;
  credits: number;
  stripe_customer_id: string | null;
  created: number;
  last_login: number | null;
};

export const SESSION_COOKIE = 'hg_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const toPublicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, project: u.project, credits: u.credits, created: u.created, last_login: u.last_login });

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  return `scrypt:${salt.toString('hex')}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string) {
  const [kind, salt, hash] = String(stored ?? '').split(':');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'hex'), expected.length);
  return expected.length === 64 && crypto.timingSafeEqual(actual, expected);
}

export function starterCredits() {
  const n = Math.floor(Number(env('STARTER_CREDITS') ?? 50));
  return Number.isFinite(n) && n >= 0 ? n : 50;
}

export const getUser = (userId: string) => (db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined) ?? null;
export const getUserByEmail = (email: string) => (db.prepare('SELECT * FROM users WHERE email = ?').get(String(email ?? '').trim().toLowerCase()) as User | undefined) ?? null;

// Sign-ups per address: a few an hour, so free starter credits can't be farmed from one machine.
const signupsByIp = new Map<string, number[]>();
function limitSignups(ip: string) {
  const now = Date.now();
  const recent = (signupsByIp.get(ip) ?? []).filter((t) => now - t < 3600_000);
  const max = Number(env('SIGNUPS_PER_HOUR') ?? 5);
  if (recent.length >= max) throw new PortalError('Too many sign-ups from this address; try again in an hour', { status: 429 });
  recent.push(now);
  signupsByIp.set(ip, recent);
}

export function signup(input: { email?: unknown; password?: unknown; name?: unknown }, ip = '') {
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) throw new PortalError('Enter a valid email address');
  const password = typeof input.password === 'string' ? input.password : '';
  if (password.length < 8) throw new PortalError('Password must be at least 8 characters');
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 120) : email.split('@')[0];
  if (getUserByEmail(email)) throw new PortalError('An account with that email already exists', { status: 409 });
  if (ip) limitSignups(ip);

  const userId = id(PROJECT_PREFIX, 8);
  const starter = starterCredits();
  const now = Date.now();
  tx(() => {
    db.prepare('INSERT INTO users (id, email, name, password_hash, project, credits, created, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(userId, email, name, hashPassword(password), userId, starter, now, now);
    if (starter > 0) {
      db.prepare("INSERT INTO credit_ledger (id, user_id, delta, balance_after, kind, detail, created) VALUES (?, ?, ?, ?, 'signup_bonus', ?, ?)")
        .run(id('tx_', 6), userId, starter, starter, `Welcome bonus (${starter} credits)`, now);
    }
  });
  const key = mintApiKey(userId);
  return { user: toPublicUser(getUser(userId)!), apiKey: key.apiKey, sessionToken: createSession(userId) };
}

export function login(input: { email?: unknown; password?: unknown }) {
  const email = String(input.email ?? '').trim().toLowerCase();
  const password = typeof input.password === 'string' ? input.password : '';
  if (!email || !password) throw new PortalError('Email and password are required');
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) throw new PortalError('Invalid email or password', { status: 401 });
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);
  return { user: toPublicUser(getUser(user.id)!), sessionToken: createSession(user.id) };
}

export function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now, now + SESSION_TTL_MS);
  return token;
}

export function deleteSession(token: string | null) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

/** A new personal API key; the old ones stop working. The key is shown once. */
export function mintApiKey(userId: string) {
  const key = `hg_${crypto.randomBytes(24).toString('base64url')}`;
  const keyId = id('k_', 6);
  tx(() => {
    db.prepare('UPDATE api_keys SET disabled = 1 WHERE user_id = ?').run(userId);
    db.prepare('INSERT INTO api_keys (id, user_id, prefix, key_hash, created) VALUES (?, ?, ?, ?, ?)').run(keyId, userId, key.slice(0, 7), sha256(key), Date.now());
  });
  return { apiKey: key, prefix: key.slice(0, 7), client: currentKey(userId) };
}

const currentKey = (userId: string) => (db.prepare('SELECT id, prefix, created, last_used FROM api_keys WHERE user_id = ? AND disabled = 0 ORDER BY created DESC LIMIT 1').get(userId) as any) ?? null;

export function profile(user: User) {
  return { user: toPublicUser(user), client: currentKey(user.id) };
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {}
  }
  return out;
}

export const sessionToken = (req: IncomingMessage) => parseCookies(req)[SESSION_COOKIE] || null;

const secure = (req: IncomingMessage) => (String(req.headers['x-forwarded-proto'] ?? '') === 'https' || env('PUBLIC_URL')?.startsWith('https:') ? '; Secure' : '');

export function setSessionCookie(res: ServerResponse, req: IncomingMessage, token: string) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure(req)}`);
}

export function clearSessionCookie(res: ServerResponse, req: IncomingMessage) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure(req)}`);
}

/** The customer behind a request: their API key (Authorization: Bearer hg_... or X-Hawkesgen-Key), else their session. */
export function authenticate(req: IncomingMessage): User | null {
  const header = String(req.headers.authorization ?? '');
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.headers['x-hawkesgen-key'] ?? '').trim();
  if (key) {
    const row = db.prepare('SELECT id, user_id FROM api_keys WHERE key_hash = ? AND disabled = 0').get(sha256(key)) as { id: string; user_id: string } | undefined;
    if (!row) return null;
    db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').run(Date.now(), row.id);
    return getUser(row.user_id);
  }
  const token = sessionToken(req);
  if (!token) return null;
  const s = db.prepare('SELECT user_id, expires FROM sessions WHERE token_hash = ?').get(sha256(token)) as { user_id: string; expires: number } | undefined;
  if (!s) return null;
  if (s.expires < Date.now()) {
    deleteSession(token);
    return null;
  }
  return getUser(s.user_id);
}
