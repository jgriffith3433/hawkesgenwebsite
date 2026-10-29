// The platform token (hawkesstudio docs/platform-plan.md 4.2): Gen and Studio don't hold accounts; they take a short-lived
// JWT the portal signs (EdDSA, Ed25519) and verify it with the public keys at /.well-known/jwks.json. Anyone the portal
// knows mints one for an org they're in: a browser session or an hg_ key (any of their orgs, `org` in the body; none:
// their personal org) or an OAuth connection (its own org only, its scopes only). The token carries the org, the user, the
// role, the plan, the entitlements and the scopes as they are now: a lapsed plan or a lost membership shows within
// PLATFORM_TTL. The private key is the secret PORTAL_PLATFORM_KEY (cloud/setup-secrets.mjs).
import { SECRETS, publicUrl } from './config.ts';
import { caller } from './caller.ts';
import { orgContext } from './orgs.ts';
import { corsRoute } from './oauth.ts';
import { PortalError, Limiter, route, send, json } from './http.ts';
import {
  loadSigningKeys, mintPlatformToken, grantScopes, parseScopes, SCOPES, PLATFORM_AUDIENCES, type SigningKeys, type Scope,
} from './platform.ts';

let cached: { text: string; keys: SigningKeys | null } | null = null;
/** The signing keys, or null where the secret is not set yet ("unset" or empty). */
export function signingKeys(): SigningKeys | null {
  const text = String(SECRETS.platformKey.value() ?? '');
  if (cached?.text === text) return cached.keys;
  let keys: SigningKeys | null = null;
  if (text.includes('PRIVATE KEY')) {
    try { keys = loadSigningKeys(text); } catch (e) { console.error('[portal] PORTAL_PLATFORM_KEY:', (e as Error).message); }
  }
  cached = { text, keys };
  return keys;
}

export const jwks = () => signingKeys()?.jwks ?? { keys: [] };

const mints = new Limiter(120, 60_000);

export async function platformToken(req: Parameters<typeof caller>[0]) {
  const c = await caller(req, { anyScope: true });
  if (!c) throw new PortalError('Sign in first', { status: 401 });
  const keys = signingKeys();
  if (!keys) throw new PortalError('Platform tokens are not set up here yet', { status: 503, code: 'no_platform_key' });
  mints.take(c.user.id, 'Too many tokens a minute; reuse one until it expires');
  const b = json(req);
  const askedOrg = typeof b.org === 'string' && b.org ? b.org : null;
  let orgId: string | null = askedOrg;
  let asked: Scope[];
  if (c.via.kind === 'connection') {
    // An app acts for the org it was approved for, with what it was approved for.
    if (askedOrg && askedOrg !== c.via.org) throw new PortalError('This connection was approved for another org', { status: 403 });
    orgId = c.via.org ?? null;
    asked = (c.via.scopes ?? ['generate']) as Scope[];
  } else {
    asked = typeof b.scope === 'string' ? parseScopes(b.scope) : [...SCOPES];
  }
  const ctx = await orgContext(c.user, orgId).catch((e) => {
    if (e?.status === 404 && c.via.kind === 'connection') throw new PortalError('You are no longer in the org this connection is for', { status: 403 });
    throw e;
  });
  const scopes = grantScopes(asked, ctx.entitlements, ctx.role);
  const aud = PLATFORM_AUDIENCES.includes(b.aud) ? b.aud : [...PLATFORM_AUDIENCES];
  const t = mintPlatformToken({
    iss: publicUrl(), aud, org: ctx.org.id, user: c.user.id, project: c.user.project, role: ctx.role, plan: ctx.plan.id,
    entitlements: ctx.entitlements, scopes, via: { kind: c.via.kind, id: c.via.id },
  }, keys);
  return { token: t.token, token_type: 'Bearer', expires_in: t.expires_in, claims: t.claims };
}

route('POST', '/v1/platform/token', async ({ req }) => platformToken(req));

corsRoute('/.well-known/jwks.json', ({ method, res }) => {
  if (method !== 'GET' && method !== 'HEAD') return send(res, 404, { error: 'Not found' });
  res.status(200).set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' }).send(JSON.stringify(jwks()));
});
