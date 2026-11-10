// Playtests signed in on beta (J, 2026-11-10: "Yes." to a beta test sign-in so Studio's playtests can ask the Overseer).
// Studio's protocol (hawkesstudio src/playtest-signin.ts): before a beta playtest, Studio POSTs
//   { project, exp, nonce, sig, issuer }  (sig = HMAC-SHA256 of `${project}.${exp}.${nonce}` with the project's secret)
// to the project's testSignIn url. We hold no secret: we ask the Studio that signed it (`${issuer}/api/signin/verify`,
// which checks the signature, the expiry and spends the nonce once). Only an allowlisted Studio is asked.
// What it signs in is one throwaway account (playtest@hawkesgames.test, marked test), never a real person's, and only on
// beta: the route answers 404 unless PORTAL_TEST_SIGNIN=on (.env.hawkes-staging alone) and the project is hawkes-staging.
// The session is our own signed cookie (`t.` + sign.ts), good for a few hours, read only where this is on.
import type { Request } from 'firebase-functions/https';
import { db, users, changeCredits } from './store.ts';
import { env } from './config.ts';
import { PortalError, route, json, Limiter } from './http.ts';
import { sign, verify } from './sign.ts';
import { SESSION_COOKIE, createAccount, getUserByEmail, type User } from './accounts.ts';

export const TEST_EMAIL = 'playtest@hawkesgames.test';
const TEST_TTL = 6 * 3600;
/** A playtest asks the Overseer a few times; topped up to this when it runs low (beta credits, Gen beta). */
const TEST_FLOOR = 20, TEST_TOPUP_TO = 100;
const ISSUERS = () => (env('PORTAL_TEST_SIGNIN_ISSUERS') ?? 'https://studio.hawkesgen.ai').split(',').map((s) => s.trim()).filter(Boolean);
const PROJECTS = () => (env('PORTAL_TEST_SIGNIN_PROJECTS') ?? 'hawkes-games').split(',').map((s) => s.trim()).filter(Boolean);

/** The Google Cloud project we run in. */
export function cloudProject() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try { return JSON.parse(process.env.FIREBASE_CONFIG ?? '{}').projectId ?? ''; } catch { return ''; }
}
/** On beta only: switched on there, and never in the live project whatever its settings say. */
export const testSignInOn = () => env('PORTAL_TEST_SIGNIN') === 'on' && cloudProject() === 'hawkes-staging';

/** An issuer we may ask: an allowlisted origin, at its root or one customer cell (/o/<org>). Its base, or null. */
export function allowedIssuer(issuer: unknown, issuers = ISSUERS()): string | null {
  let u: URL;
  try { u = new URL(String(issuer)); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
  if (!issuers.some((o) => { try { return new URL(o).origin === u.origin; } catch { return false; } })) return null;
  if (!/^(\/|\/o\/[a-z0-9-]{1,60}\/?)$/.test(u.pathname)) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** Throws a sentence unless the Studio that signed this token says it did, now, for one of our projects. */
export async function checkToken(body: any, now = Date.now(), fetchImpl: typeof fetch = fetch) {
  const { project, exp, nonce, sig } = body ?? {};
  if (typeof project !== 'string' || !PROJECTS().includes(project) || typeof nonce !== 'string' || !nonce || nonce.length > 100
    || typeof sig !== 'string' || sig.length > 100 || !Number.isFinite(exp)) throw new PortalError('Not a test sign-in token', { status: 401 });
  const nowS = Math.floor(now / 1000);
  if (exp < nowS || exp > nowS + 600) throw new PortalError('That test sign-in token has expired', { status: 401 });
  const base = allowedIssuer(body.issuer);
  if (!base) throw new PortalError('That test sign-in token comes from a Studio we do not trust', { status: 401 });
  let r: Response;
  try {
    r = await fetchImpl(`${base}/api/signin/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, exp, nonce, sig }), redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  } catch (e: any) { throw new PortalError(`Could not reach the Studio that signed the token: ${e.message ?? e}`, { status: 502 }); }
  const j: any = r.ok ? await r.json().catch(() => null) : null;
  if (j?.ok !== true) throw new PortalError(`The Studio that signed the token refused it (${r.status})`, { status: 401 });
}

/** The test account (made the first time), its credits topped up when low. */
export async function testAccount(): Promise<User> {
  const u: User = (await getUserByEmail(TEST_EMAIL)) ?? await createAccount({ email: TEST_EMAIL, name: 'Studio playtest' });
  if (!(u as any).test) await users().doc(u.id).update({ test: true });
  if (Number(u.credits ?? 0) < TEST_FLOOR) {
    await db.runTransaction(async (t) => {
      const have = Number((await t.get(users().doc(u.id))).get('credits') ?? 0);
      if (have < TEST_FLOOR) await changeCredits(u.id, TEST_TOPUP_TO - have, { kind: 'test_topup', detail: 'Beta playtest account topped up' }, { t });
    });
  }
  await clearOldGames({ ...u, test: true } as User);
  return { ...u, test: true } as User;
}

/** A playtest makes a new game each run and the free plan keeps 3, so the test account's games from earlier runs go
 *  (older than a run lasts, so a playtest running beside this one keeps its game). Only ever the test account's own. */
export const OLD_GAME_MS = 30 * 60_000;
async function clearOldGames(u: User, now = Date.now()) {
  if (u.email !== TEST_EMAIL || (u as any).test !== true) return;
  const { deleteGame } = await import('./games.ts');
  const mine = await db.collection('games').where('owner_id', '==', u.id).get();
  for (const g of mine.docs) {
    if (Number(g.get('created') ?? 0) > now - OLD_GAME_MS) continue;
    await deleteGame(u, g.id).catch((e) => console.warn(`[test-signin] could not clear ${g.id}: ${e.message ?? e}`));
  }
}

/** The test account behind a `t.` session cookie, where test sign-in is on; else null. */
export async function fromTestCookie(c: string, getUser: (id: string) => Promise<User | null>): Promise<User | null> {
  if (!testSignInOn() || !c.startsWith('t.')) return null;
  const v = verify<{ k: string; u: string }>(c.slice(2));
  if (!v || v.k !== 'test') return null;
  const u = await getUser(v.u);
  return u && (u as any).test === true && u.email === TEST_EMAIL && !u.disabled ? u : null;
}

export const testCookieHeader = (userId: string) =>
  `${SESSION_COOKIE}=t.${sign({ k: 'test', u: userId }, TEST_TTL)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${TEST_TTL}`;

const perIp = new Limiter(30, 15 * 60_000);
route('POST', '/v1/test-signin', async ({ req, res, ip }) => {
  if (!testSignInOn()) throw new PortalError('Not found', { status: 404 });
  perIp.take(ip, 'Too many test sign-ins; wait a few minutes');
  await checkToken(json(req as Request));
  const u = await testAccount();
  res.setHeader('Set-Cookie', testCookieHeader(u.id));
  return { ok: true, user: u.id };
});
