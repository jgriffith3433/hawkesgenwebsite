// Accounts on Firebase Auth. Signing in is Google only (no passwords): the portal's own "Continue with Google" (OpenID
// Connect, code + PKCE) gets Google's ID token, Firebase Auth signs that identity in (signInWithIdp), and the browser gets
// a Firebase session cookie (`__session`, the one cookie Hosting forwards). A Firebase user maps to a portal account
// (usr_..., its Gen project) through logins/{uid}; an account made before (email and password) is linked by its email.
// Personal API keys (hg_...) stay as they were.
import crypto from 'node:crypto';
import type { Request } from 'firebase-functions/https';
import type { Response } from 'express';
import { auth, db, users, ledgerOf, first } from './store.ts';
import { env, publicUrl, PROJECT_PREFIX, SECRETS } from './config.ts';
import { PortalError, id, sha256, cookies, route, redirect, send, json, Limiter } from './http.ts';
import { sendWelcome } from './mail.ts';

export type User = {
  id: string;
  email: string;
  name: string | null;
  project: string;
  credits: number;
  /** Stored but grants nothing: admin is `adminFrom` (J's verified Google sign-in on PORTAL_ADMIN_EMAILS), per request. */
  role: 'customer' | 'admin';
  disabled?: boolean;
  plan?: import('./platform.ts').PlanId;
  sub_status?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  period_end?: number | null;
  cancel_at_period_end?: boolean;
  ref_code?: string | null;
  referred_by?: string | null;
  referral_paid?: boolean;
  source?: string | null;
  low_emailed?: number | null;
  overseer?: unknown;
  created: number;
  last_login: number | null;
};

export const SESSION_COOKIE = '__session';
const SESSION_DAYS = 14; // Firebase's longest session cookie
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const REFERRAL_BONUS = 50;
export const REFERRAL_REWARD = 100;

/** `admin`: whether this request is an admin's (`adminFrom`); the stored role is never shown as one. */
export const toPublicUser = (u: User, admin = false) => ({ id: u.id, email: u.email, name: u.name, project: u.project, credits: u.credits, role: admin ? 'admin' as const : 'customer' as const, created: u.created, last_login: u.last_login, plan: ['active', 'trialing', 'past_due'].includes(String(u.sub_status)) ? (u.plan ?? 'free') : 'free' });

export async function getUser(userId: string): Promise<User | null> {
  const s = await users().doc(userId).get();
  return s.exists ? ({ id: s.id, ...(s.data() as Omit<User, 'id'>) }) : null;
}
export const getUserByEmail = async (email: string) => first<User>(users().where('email', '==', String(email ?? '').trim().toLowerCase()));
const active = (u: User | null) => (u && !u.disabled ? u : null);

export function starterCredits() {
  const n = Math.floor(Number(env('STARTER_CREDITS') ?? 50));
  return Number.isFinite(n) && n >= 0 ? n : 50;
}

/** Where a sign-up came from (?ref= and ?utm_source=, which the landing page passes along to the sign-in). */
export type Origin = { ref?: string | null; source?: string | null };
const cleanOrigin = (o: any): Origin => {
  const clean = (v: unknown, n: number) => (typeof v === 'string' && /^[a-z0-9_.-]{1,60}$/i.test(v) ? v.toLowerCase().slice(0, n) : null);
  return { ref: clean(o?.ref, 16), source: clean(o?.source, 40) };
};

const signupsByIp = new Limiter(5, 3600_000);

/** A new account with the starter credits (and a friend's bonus with their code), its ledger rows in the same write. */
export async function createAccount(input: { email: string; name?: string | null; uid?: string }, ip = '', origin: Origin = {}): Promise<User> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) throw new PortalError('Enter a valid email address', { code: 'bad_email' });
  if (await getUserByEmail(email)) throw new PortalError('An account with that email already exists', { status: 409, code: 'email_exists' });
  if (ip && !signupsByIp.hit(ip)) throw new PortalError('Too many sign-ups from this address; try again in an hour', { status: 429, code: 'signup_limit' });
  const userId = id(PROJECT_PREFIX, 8);
  const starter = starterCredits();
  const referrer = origin.ref ? await first<User>(users().where('ref_code', '==', origin.ref)) : null;
  const bonus = referrer && !referrer.disabled ? REFERRAL_BONUS : 0;
  const now = Date.now();
  const user: Omit<User, 'id'> = {
    email, name: input.name?.trim().slice(0, 120) || email.split('@')[0], project: userId, credits: starter + bonus, role: 'customer',
    disabled: false, plan: 'free', created: now, last_login: now, referred_by: bonus ? referrer!.id : null,
    source: origin.source ?? (bonus ? 'referral' : null), referral_paid: false,
  };
  const batch = db.batch();
  batch.create(users().doc(userId), user);
  if (input.uid) batch.set(db.collection('logins').doc(input.uid), { user: userId });
  if (starter > 0) batch.create(ledgerOf(userId).doc(id('tx_', 6)), { delta: starter, balance_after: starter, kind: 'signup_bonus', detail: `Welcome bonus (${starter} credits)`, created: now });
  if (bonus) batch.create(ledgerOf(userId).doc(id('tx_', 6)), { delta: bonus, balance_after: starter + bonus, kind: 'referral_bonus', detail: `Invited by a friend (+${bonus} credits)`, created: now });
  await batch.commit();
  await sendWelcome(email, input.name?.trim() ? user.name : null, starter + bonus);
  return { id: userId, ...user };
}

// ------------------------------------------------------------ Google, through Firebase Auth

const GOOGLE_COOKIE_TTL = 600;
const googleClientId = () => env('GOOGLE_CLIENT_ID') ?? '';
const redirectUri = () => `${publicUrl()}/auth/google/callback`;
/** Only our own pages: a path, never another site. */
const safeNext = (n: unknown) => (typeof n === 'string' && /^\/(?!\/)[^\s\\]*$/.test(n) ? n : '/app');
const netDashboard = () => (env('PORTAL_NET_DASHBOARD') ?? 'https://net.hawkesgen.ai').replace(/\/+$/, '');
const problemPage = (next: unknown, q: string) => (safeNext(next) === '/net/back' ? `${netDashboard()}/?${q}` : `/?${q}`);

/** Signed, short-lived state (HMAC with the portal's signing key). */
function sign(data: unknown, ttlSec: number) {
  const body = Buffer.from(JSON.stringify({ d: data, e: Date.now() + ttlSec * 1000 })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', SECRETS.signing.value()).update(body).digest('base64url')}`;
}
function verify<T>(token: string): T | null {
  const [body, mac] = String(token ?? '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', SECRETS.signing.value()).update(body).digest('base64url');
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return v.e > Date.now() ? v.d : null;
}

// The sign-in in progress rides in the `__session` cookie too (Hosting forwards no other) until Google answers.
type Pending = { s: string; v: string; n: string; o: Origin };

const loginsPerIp = new Limiter(20, 15 * 60_000);

route('GET', '/auth/google', ({ req, res, url }) => {
  const next = url.searchParams.get('next');
  if (!googleClientId()) return redirect(res, problemPage(next, `signin_error=${encodeURIComponent('Google sign-in is not available here.')}`));
  const state = crypto.randomBytes(16).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const origin = cleanOrigin({ ref: url.searchParams.get('ref'), source: url.searchParams.get('src') });
  const pending: Pending = { s: state, v: verifier, n: safeNext(next), o: origin };
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=g.${sign(pending, GOOGLE_COOKIE_TTL)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${GOOGLE_COOKIE_TTL}`);
  const q = new URLSearchParams({ client_id: googleClientId(), redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email profile', state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' });
  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  void req;
});

route('GET', '/auth/google/callback', async ({ req, res, url, ip }) => {
  const raw = cookies(req)[SESSION_COOKIE] ?? '';
  const saved = raw.startsWith('g.') ? verify<Pending>(raw.slice(2)) : null;
  try {
    if (url.searchParams.get('error')) return redirect(res, saved?.n === '/auth/popup' ? '/auth/popup?cancelled=1' : problemPage(saved?.n, 'signin=cancelled'));
    if (!saved || saved.s !== url.searchParams.get('state')) throw new PortalError('That sign-in link expired. Try Continue with Google again.');
    loginsPerIp.take(ip, 'Too many sign-in attempts; wait a few minutes');
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code') ?? '', client_id: googleClientId(), client_secret: SECRETS.googleSecret.value(), redirect_uri: redirectUri(), grant_type: 'authorization_code', code_verifier: saved.v }),
      signal: AbortSignal.timeout(15_000),
    });
    const t: any = await r.json().catch(() => ({}));
    if (!r.ok || !t.id_token) throw new PortalError(`Google said no: ${t.error_description ?? t.error ?? r.status}`);
    const cookie = await signInWithGoogleToken(t.id_token, ip, saved.o);
    res.setHeader('Set-Cookie', sessionCookieHeader(cookie));
    redirect(res, saved.n);
  } catch (e: any) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
    redirect(res, problemPage(saved?.n, `signin_error=${encodeURIComponent(e.message ?? 'Google sign-in failed')}`));
  }
});

/** Google's ID token → a Firebase Auth user (made on first sign-in) → the portal account → a session cookie. */
export async function signInWithGoogleToken(googleIdToken: string, ip: string, origin: Origin = {}) {
  const key = env('PORTAL_WEB_API_KEY');
  if (!key) throw new PortalError('Sign-in is not set up here', { status: 503 });
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody: `id_token=${googleIdToken}&providerId=google.com`, requestUri: publicUrl(), returnSecureToken: true }),
    signal: AbortSignal.timeout(15_000),
  });
  const f: any = await r.json().catch(() => ({}));
  if (!r.ok || !f.idToken) throw new PortalError(`Sign-in failed: ${f.error?.message ?? r.status}`);
  if (!f.email || f.emailVerified === false) throw new PortalError('Your Google account needs a verified email');
  await accountForLogin(f.localId, String(f.email).toLowerCase(), f.displayName ?? f.fullName ?? null, ip, origin);
  return auth.createSessionCookie(f.idToken, { expiresIn: SESSION_DAYS * 24 * 3600_000 });
}

/** The portal account for a Firebase user: its mapping, else the account with its email (linked now), else a new one. */
export async function accountForLogin(uid: string, email: string, name: string | null, ip = '', origin: Origin = {}): Promise<User> {
  const map = await db.collection('logins').doc(uid).get();
  let user = map.exists ? await getUser(map.get('user')) : null;
  if (!user) {
    user = await getUserByEmail(email);
    if (user) await db.collection('logins').doc(uid).set({ user: user.id });
    else user = await createAccount({ email, name, uid }, ip, origin);
  }
  if (user.disabled) throw new PortalError('This account is disabled. Contact support@hawkesgen.ai.', { status: 403 });
  await users().doc(user.id).update({ last_login: Date.now(), uid });
  return user;
}

export const sessionCookieHeader = (cookie: string) => `${SESSION_COOKIE}=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 3600}`;

// ------------------------------------------------------------ who is calling

/** The bearer token a request carries (Authorization: Bearer ..., or X-Hawkesgen-Key). */
export const bearer = (req: Request) => {
  const h = String(req.headers.authorization ?? '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : String(req.headers['x-hawkesgen-key'] ?? '').trim();
};

/** A personal API key's account and its key (id, daily limit). */
export async function fromApiKey(key: string) {
  const ref = db.collection('apiKeys').doc(sha256(key));
  const k = await ref.get();
  if (!k.exists || k.get('disabled')) return null;
  const user = active(await getUser(k.get('user_id')));
  if (!user) return null;
  void ref.update({ last_used: Date.now() }).catch(() => {});
  return { user, key: { id: k.get('id') as string, prefix: k.get('prefix') as string, daily_cap: (k.get('daily_cap') ?? null) as number | null } };
}

/** The signed-in account behind the session cookie. */
export async function fromSession(req: Request): Promise<User | null> {
  // A stream link (?st=, from /v1/stream-link): the page's own session, carried to the function's direct address.
  const st = new URL(req.originalUrl || req.url || '/', 'https://x');
  const link = st.searchParams.get('st');
  if (link) {
    const v = verify<{ u: string; p: string }>(link);
    return v && v.p === st.pathname ? active(await getUser(v.u)) : null;
  }
  const c = cookies(req)[SESSION_COOKIE];
  if (!c || c.startsWith('g.')) return null;
  try {
    const d = await auth.verifySessionCookie(c);
    const map = await db.collection('logins').doc(d.uid).get();
    return map.exists ? active(await getUser(map.get('user'))) : null;
  } catch {
    return null;
  }
}

/** The customer behind a request: their API key, else their session. (OAuth tokens: caller.ts.) */
export async function authenticate(req: Request): Promise<User | null> {
  const key = bearer(req);
  if (key) return key.startsWith('hg_') ? (await fromApiKey(key))?.user ?? null : null;
  return fromSession(req);
}

export async function requireUser(req: Request) {
  const u = await authenticate(req);
  if (!u) throw new PortalError('Sign in first', { status: 401 });
  return u;
}

// ------------------------------------------------------------ admin: J alone
// Admin is never a stored role (anyone with Firestore access, or a bug, could set one) and never an API key or OAuth
// token. It is a Google sign-in, checked on every request: the session cookie verified with Firebase (and not revoked),
// signed in with google.com, its email verified by Google and on PORTAL_ADMIN_EMAILS (J's address when unset), and the
// same email as the portal account it maps to.

export const DEFAULT_ADMIN_EMAILS = 'piercehawkes3@gmail.com';
/** Who may use the admin features: PORTAL_ADMIN_EMAILS, comma-separated (set but empty: nobody). */
export const adminEmails = () => (process.env.PORTAL_ADMIN_EMAILS ?? DEFAULT_ADMIN_EMAILS).split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

/** What a verified Firebase session cookie says (the parts the admin check reads). */
export type SessionClaims = { uid: string; email?: string; email_verified?: boolean; firebase?: { sign_in_provider?: string } };

/** The rule, on its own: a Google-verified email on the list, matching the account; the account's role plays no part. */
export function isAdmin(claims: SessionClaims | null | undefined, user: Pick<User, 'email' | 'disabled'> | null | undefined, allow = adminEmails()) {
  if (!claims || !user || user.disabled) return false;
  const email = String(claims.email ?? '').trim().toLowerCase();
  return Boolean(email) && claims.email_verified === true && claims.firebase?.sign_in_provider === 'google.com'
    && allow.includes(email) && String(user.email ?? '').trim().toLowerCase() === email;
}

/** How the check reaches Firebase and Firestore (tests replace these). */
export const adminDeps = {
  verify: async (cookie: string): Promise<SessionClaims> => (await auth.verifySessionCookie(cookie, true)) as SessionClaims,
  account: async (uid: string): Promise<User | null> => {
    const map = await db.collection('logins').doc(uid).get();
    return map.exists ? getUser(map.get('user')) : null;
  },
};

/** The admin making this request, or null. Bearer tokens (hg_ keys, hgo_ OAuth tokens) and stream links never are. */
export async function adminFrom(req: Request): Promise<User | null> {
  if (bearer(req)) return null;
  const c = cookies(req)[SESSION_COOKIE];
  if (!c || c.startsWith('g.')) return null;
  let claims: SessionClaims;
  try { claims = await adminDeps.verify(c); } catch { return null; }
  const user = claims?.uid ? await adminDeps.account(claims.uid) : null;
  return isAdmin(claims, user) ? user : null;
}

/** 403 for anyone but an admin (signed out, a customer, a stored role, a key or a token). */
export async function requireAdmin(req: Request): Promise<User> {
  const a = await adminFrom(req);
  if (!a) throw new PortalError('Admins only', { status: 403, code: 'not_admin' });
  return a;
}

// ------------------------------------------------------------ the account's own routes

/** A new personal API key; the old ones stop working. Shown once. */
export async function mintApiKey(userId: string) {
  const key = `hg_${crypto.randomBytes(24).toString('base64url')}`;
  const keyId = id('k_', 6);
  const old = await db.collection('apiKeys').where('user_id', '==', userId).where('disabled', '==', false).get();
  const batch = db.batch();
  for (const d of old.docs) batch.update(d.ref, { disabled: true });
  batch.create(db.collection('apiKeys').doc(sha256(key)), { id: keyId, user_id: userId, prefix: key.slice(0, 7), created: Date.now(), last_used: null, disabled: false, daily_cap: null });
  await batch.commit();
  return { apiKey: key, prefix: key.slice(0, 7), client: await currentKey(userId) };
}

async function currentKey(userId: string) {
  const s = await db.collection('apiKeys').where('user_id', '==', userId).where('disabled', '==', false).orderBy('created', 'desc').limit(1).get();
  if (s.empty) return null;
  const k = s.docs[0].data();
  return { id: k.id, prefix: k.prefix, created: k.created, last_used: k.last_used ?? null };
}

export async function profile(user: User, admin = false) {
  const bought = !(await ledgerOf(user.id).where('kind', '==', 'stripe_purchase').limit(1).get()).empty;
  return { user: { ...toPublicUser(user, admin), bought, source: user.source ?? null }, client: await currentKey(user.id) };
}

/** A customer's referral code (made the first time it's asked for). */
export async function refCode(user: User): Promise<string> {
  if (user.ref_code) return user.ref_code;
  for (;;) {
    const code = crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, '').toLowerCase().slice(0, 7);
    if (code.length < 6) continue;
    const taken = await db.runTransaction(async (t) => {
      const ref = db.collection('refCodes').doc(code);
      if ((await t.get(ref)).exists) return true;
      t.create(ref, { user: user.id });
      t.update(users().doc(user.id), { ref_code: code });
      return false;
    });
    if (!taken) return code;
  }
}

route('GET', '/v1/users/me', async ({ req }) => profile(await requireUser(req), Boolean(await adminFrom(req))));
route('GET', '/v1/me', async ({ req }) => profile(await requireUser(req), Boolean(await adminFrom(req))));
route('POST', '/v1/users/api-key', async ({ req }) => mintApiKey((await requireUser(req)).id));
route('POST', '/v1/users/logout', async ({ req, res }) => {
  const c = cookies(req)[SESSION_COOKIE];
  if (c && !c.startsWith('g.')) {
    try { await auth.revokeRefreshTokens((await auth.verifySessionCookie(c)).sub); } catch {}
  }
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  send(res, 200, { ok: true });
});
route('GET', '/v1/referral', async ({ req }) => {
  const user = await requireUser(req);
  const code = await refCode(user);
  const count = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count;
  const earned = (await ledgerOf(user.id).where('kind', '==', 'referral_reward').get()).docs.reduce((s, d) => s + Number(d.get('delta') ?? 0), 0);
  return {
    code, link: `${publicUrl()}/?ref=${code}`, bonus: REFERRAL_BONUS, reward: REFERRAL_REWARD,
    invited: await count(users().where('referred_by', '==', user.id)),
    bought: await count(users().where('referred_by', '==', user.id).where('referral_paid', '==', true)),
    earned,
  };
});
// Passwords are gone: these answer plainly so an old page or client knows to use Google.
for (const p of ['/v1/users/login', '/v1/users/signup', '/v1/users/forgot', '/v1/users/reset']) {
  route('POST', p, ({ res }) => send(res, 410, { error: 'Sign in with Google: email and password sign-in has ended.', code: 'google_only' }));
}
void json;

// ------------------------------------------------------------ stream links
// Firebase Hosting holds a function's answer until it ends, so a server-sent stream (the editor's live feed, the job
// feed) can't pass through hawkesgen.ai. The page asks here, on its own origin with its session, for a link to the
// function's direct address that carries a signed token for that one path (ten minutes); the stream goes there.
export const STREAMS = /^\/v1\/(games\/g_[0-9a-f]+\/live|events)$/;
export const streamUrl = () => (env('PORTAL_STREAM_URL') ?? '').replace(/\/+$/, '');
route('GET', '/v1/stream-link', async ({ req, url }) => {
  const user = await requireUser(req);
  const path = String(url.searchParams.get('path') ?? '');
  if (!STREAMS.test(path)) throw new PortalError('Not a stream', { status: 400 });
  if (!streamUrl()) return { url: path };
  return { url: `${streamUrl()}${path}?st=${encodeURIComponent(sign({ u: user.id, p: path }, 600))}`, ttl: 600 };
});
