// Customer accounts: scrypt passwords, session cookies, personal API keys (hg_...), and who a request is.
// Each customer works in their own Gen project (usr_<id>); the portal's Gen key is narrowed to it on every call.
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db, tx } from './db.ts';
import { env, PROJECT_PREFIX, publicUrl } from './config.ts';
import { id, sha256, PortalError } from './util.ts';
import { sendWelcome } from './mail.ts';

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
  role: 'customer' | 'admin';
  disabled: number;
};

export const SESSION_COOKIE = 'hg_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const toPublicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, project: u.project, credits: u.credits, role: u.role, created: u.created, last_login: u.last_login });

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

export function signup(input: { email?: unknown; password?: unknown; name?: unknown }, ip = '', origin: Origin = {}) {
  const password = typeof input.password === 'string' ? input.password : '';
  if (password.length < 8) throw new PortalError('Password must be at least 8 characters');
  const user = createAccount({ email: input.email, name: input.name, password }, ip, origin);
  const key = mintApiKey(user.id);
  return { user: toPublicUser(user), apiKey: key.apiKey, sessionToken: createSession(user.id) };
}

/** Where a sign-up came from: a friend's referral code and a source (?ref= / ?utm_source=), from the landing page's cookies. */
export type Origin = { ref?: string | null; source?: string | null };
export const REFERRAL_BONUS = 50; // the friend who signs up with a link
export const REFERRAL_REWARD = 100; // the customer who invited them, when the friend first buys credits

/** The sign-up origin from the request's cookies (hg_ref, hg_src), cleaned. */
export function originOf(req: IncomingMessage): Origin {
  const c = parseCookies(req);
  const clean = (v: string | undefined, n: number) => (v && /^[a-z0-9_.-]{1,60}$/i.test(v) ? v.toLowerCase().slice(0, n) : null);
  return { ref: clean(c.hg_ref, 16), source: clean(c.hg_src, 40) };
}

/** A customer's referral code (made the first time it's asked for): hawkesgen.com/?ref=<code>. */
export function refCode(userId: string): string {
  const u = db.prepare('SELECT ref_code FROM users WHERE id = ?').get(userId) as { ref_code: string | null } | undefined;
  if (u?.ref_code) return u.ref_code;
  for (;;) {
    const code = crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, '').toLowerCase().slice(0, 7);
    if (code.length < 6 || db.prepare('SELECT 1 FROM users WHERE ref_code = ?').get(code)) continue;
    db.prepare('UPDATE users SET ref_code = ? WHERE id = ?').run(code, userId);
    return code;
  }
}

/** The customer's invite link and how it's done: friends who signed up, who bought, credits earned. */
export function referral(user: User) {
  const code = refCode(user.id);
  const n = (sql: string) => Number((db.prepare(sql).get(user.id) as { n: number }).n);
  return {
    code, link: `${publicUrl()}/?ref=${code}`, bonus: REFERRAL_BONUS, reward: REFERRAL_REWARD,
    invited: n('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?'),
    bought: n('SELECT COUNT(*) AS n FROM users WHERE referred_by = ? AND referral_paid = 1'),
    earned: n("SELECT COALESCE(SUM(delta), 0) AS n FROM credit_ledger WHERE user_id = ? AND kind = 'referral_reward'"),
  };
}

/** A new customer account with the starter credits (and a friend's bonus with a referral code). Without a password
 *  (Google sign-in) it gets a random one. */
export function createAccount(input: { email?: unknown; name?: unknown; password?: string }, ip = '', origin: Origin = {}) {
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) throw new PortalError('Enter a valid email address');
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 120) : email.split('@')[0];
  if (getUserByEmail(email)) throw new PortalError('An account with that email already exists', { status: 409 });
  if (ip) limitSignups(ip);

  const userId = id(PROJECT_PREFIX, 8);
  const starter = starterCredits();
  const referrer = origin.ref ? (db.prepare('SELECT id FROM users WHERE ref_code = ? AND disabled = 0').get(origin.ref) as { id: string } | undefined) : undefined;
  const bonus = referrer ? REFERRAL_BONUS : 0;
  const now = Date.now();
  tx(() => {
    db.prepare('INSERT INTO users (id, email, name, password_hash, project, credits, created, last_login, referred_by, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(userId, email, name, hashPassword(input.password ?? crypto.randomBytes(24).toString('base64url')), userId, starter + bonus, now, now, referrer?.id ?? null, origin.source ?? (referrer ? 'referral' : null));
    if (starter > 0) {
      db.prepare("INSERT INTO credit_ledger (id, user_id, delta, balance_after, kind, detail, created) VALUES (?, ?, ?, ?, 'signup_bonus', ?, ?)")
        .run(id('tx_', 6), userId, starter, starter, `Welcome bonus (${starter} credits)`, now);
    }
    if (bonus) {
      db.prepare("INSERT INTO credit_ledger (id, user_id, delta, balance_after, kind, detail, created) VALUES (?, ?, ?, ?, 'referral_bonus', ?, ?)")
        .run(id('tx_', 6), userId, bonus, starter + bonus, `Invited by a friend (+${bonus} credits)`, now);
    }
  });
  sendWelcome(email, typeof input.name === 'string' && input.name.trim() ? name : null, starter + bonus);
  return getUser(userId)!;
}

export function login(input: { email?: unknown; password?: unknown }) {
  const email = String(input.email ?? '').trim().toLowerCase();
  const password = typeof input.password === 'string' ? input.password : '';
  if (!email || !password) throw new PortalError('Email and password are required');
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) throw new PortalError('Invalid email or password', { status: 401 });
  if (user.disabled) throw new PortalError('This account is disabled. Contact support@hawkesgen.com.', { status: 403 });
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
  const bought = !!db.prepare("SELECT 1 FROM credit_ledger WHERE user_id = ? AND kind = 'stripe_purchase' LIMIT 1").get(user.id);
  const source = (db.prepare('SELECT source FROM users WHERE id = ?').get(user.id) as { source: string | null } | undefined)?.source ?? null;
  return { user: { ...toPublicUser(user), bought, source }, client: currentKey(user.id) };
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

/** The bearer token a request carries (Authorization: Bearer ..., or X-Hawkesgen-Key). */
export const bearer = (req: IncomingMessage) => {
  const header = String(req.headers.authorization ?? '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.headers['x-hawkesgen-key'] ?? '').trim();
};

/** A personal API key's account and its key row (id, daily limit). */
export function fromApiKey(key: string) {
  const row = db.prepare('SELECT id, user_id, prefix, daily_cap FROM api_keys WHERE key_hash = ? AND disabled = 0').get(sha256(key)) as { id: string; user_id: string; prefix: string; daily_cap: number | null } | undefined;
  if (!row) return null;
  const user = active(getUser(row.user_id));
  if (!user) return null;
  db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').run(Date.now(), row.id);
  return { user, key: row };
}

/** The customer behind a request: their API key, else their session. (OAuth tokens: see caller.ts.) */
export function authenticate(req: IncomingMessage): User | null {
  const key = bearer(req);
  if (key) return fromApiKey(key)?.user ?? null;
  const token = sessionToken(req);
  if (!token) return null;
  const s = db.prepare('SELECT user_id, expires FROM sessions WHERE token_hash = ?').get(sha256(token)) as { user_id: string; expires: number } | undefined;
  if (!s) return null;
  if (s.expires < Date.now()) {
    deleteSession(token);
    return null;
  }
  return active(getUser(s.user_id));
}

const active = (u: User | null) => (u && !u.disabled ? u : null);

/** A one-time link to set a password, good for a day. */
export function passwordLink(userId: string, site: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO password_tokens (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now, now + 24 * 3600_000);
  return `${site}/reset?token=${token}`;
}

/** Sets the password a link was made for; the link is spent, and every other session ends. */
export function setPasswordWithToken(token: string, password: string) {
  if (typeof password !== 'string' || password.length < 8) throw new PortalError('Password must be at least 8 characters');
  const row = db.prepare('SELECT user_id, expires, used FROM password_tokens WHERE token_hash = ?').get(sha256(String(token ?? ''))) as { user_id: string; expires: number; used: number | null } | undefined;
  if (!row || row.used || row.expires < Date.now()) throw new PortalError('This link has expired or was already used. Ask for a new one.', { status: 410 });
  tx(() => {
    db.prepare('UPDATE password_tokens SET used = ? WHERE token_hash = ?').run(Date.now(), sha256(token));
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
  });
  const user = getUser(row.user_id)!;
  return { user: toPublicUser(user), sessionToken: createSession(user.id) };
}

/** An account made by an admin (no starter credits; a password link to finish it), or an existing one promoted. */
export function ensureAdmin(email: string, name?: string) {
  const norm = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(norm)) throw new PortalError('Enter a valid email address');
  const found = getUserByEmail(norm);
  if (found) {
    db.prepare("UPDATE users SET role = 'admin', disabled = 0 WHERE id = ?").run(found.id);
    return getUser(found.id)!;
  }
  const userId = id(PROJECT_PREFIX, 8);
  db.prepare("INSERT INTO users (id, email, name, password_hash, project, credits, created, role) VALUES (?, ?, ?, ?, ?, 0, ?, 'admin')")
    .run(userId, norm, name?.trim() || norm.split('@')[0], hashPassword(crypto.randomBytes(24).toString('base64url')), userId, Date.now());
  return getUser(userId)!;
}
