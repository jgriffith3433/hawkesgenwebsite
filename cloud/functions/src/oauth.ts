// OAuth 2.1 for MCP clients (Claude, Cursor, VS Code, ChatGPT...): the editor finds us (/.well-known/...), registers
// itself (dynamic client registration), sends the customer to /oauth/authorize (sign in, then approve with a daily credit
// limit), and swaps the code for tokens with PKCE (S256). Each approval is a connection the customer can see and revoke.
// Scopes (platform.ts SCOPES: generate, playtest, backlog, build, agents) say what the app may do; the customer picks the
// org it acts for (orgs.ts) and gets what was asked, cut to what that org's plan and their role allow. A token with no
// scope asked gets `generate`, as every token did before scopes. Connections made before carry no org or scopes: they
// are the account's personal org and `generate`.
// Firestore (secrets are kept only as their sha256, the document id):
//   oauthClients/{mcp_...}        a registered app: name, redirect_uris, created
//   oauthCodes/{sha256(code)}     a code for one app, customer and org, five minutes, used once
//   connections/{conn_...}        an approval: user_id, org_id, scopes, client_id, name, daily_cap (null: no limit),
//                                 last_used, revoked
//   oauthTokens/{sha256(token)}   access (an hour) and refresh (90 days) tokens of a connection
import crypto from 'node:crypto';
import { db } from './store.ts';
import { formerUrls, publicUrl } from './config.ts';
import { getUser, requireUser, bearer, type User } from './accounts.ts';
import { accessTokens, type Caller } from './caller.ts';
import { spentToday } from './jobs.ts';
import { id, sha256, PortalError, route, send, json, form, type Ctx } from './http.ts';
import { myOrgs, orgContext } from './orgs.ts';
import { SCOPES, SCOPE_INFO, parseScopes, grantScopes, personalOrgId, isScope, type Scope } from './platform.ts';

const ACCESS_TTL = 3600;
const REFRESH_TTL = 90 * 24 * 3600;
export const DEFAULT_DAILY_CAP = 1000;

const clients = () => db.collection('oauthClients');
const codes = () => db.collection('oauthCodes');
const connections = () => db.collection('connections');
const tokens = () => db.collection('oauthTokens');

export const resourceUrl = () => `${publicUrl()}/mcp`;

export function protectedResourceMetadata() {
  return { resource: resourceUrl(), authorization_servers: [publicUrl()], bearer_methods_supported: ['header'], scopes_supported: [...SCOPES], resource_name: 'Hawkes Gen' };
}

export function authorizationServerMetadata() {
  const base = publicUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    jwks_uri: `${base}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...SCOPES],
    service_documentation: `${base}/connect`,
  };
}

/** Where a client may send the code: https, a loopback http port, or an app's own scheme (cursor://, vscode://...). */
function allowedRedirect(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !['javascript:', 'data:', 'file:', 'vbscript:'].includes(u.protocol);
  } catch {
    return false;
  }
}

const oauthError = (code: string, description: string) => Object.assign(new PortalError(description), { oauth: code });

export async function registerClient(body: any) {
  const uris: string[] = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10 || !uris.every(allowedRedirect)) throw oauthError('invalid_redirect_uri', 'redirect_uris must be https, loopback http, or an app scheme');
  const name = String(body?.client_name ?? 'An MCP client').replace(/[\u0000-\u001f]/g, '').slice(0, 80) || 'An MCP client';
  const clientId = id('mcp_', 12);
  const now = Date.now();
  await clients().doc(clientId).create({ name, redirect_uris: uris, created: now });
  return { client_id: clientId, client_id_issued_at: Math.floor(now / 1000), client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: typeof body?.scope === 'string' ? parseScopes(body.scope).join(' ') : SCOPES.join(' ') };
}

/** A registered return address matches exactly, or, for a loopback http one, on any port (RFC 8252 7.3: desktop apps
 *  such as the Unity editor listen on whatever port is free). */
export function sameRedirect(registered: string, asked: string) {
  if (registered === asked) return true;
  try {
    const r = new URL(registered), a = new URL(asked);
    const loop = (u: URL) => u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
    return loop(r) && loop(a) && r.hostname === a.hostname && r.pathname === a.pathname && r.search === a.search;
  } catch {
    return false;
  }
}

async function getClient(clientId: string) {
  if (!/^mcp_[0-9a-f]+$/.test(clientId)) return null;
  const s = await clients().doc(clientId).get();
  return s.exists ? { id: s.id, name: String(s.get('name')), redirect_uris: (s.get('redirect_uris') ?? []) as string[] } : null;
}

/** What the approve screen needs, after checking the request is one we would honor. */
export async function authorizeRequest(q: URLSearchParams) {
  const client = await getClient(q.get('client_id') ?? '');
  if (!client) throw new PortalError('This app is not registered with Hawkes Gen. Remove it from your editor and add it again.');
  const redirect = q.get('redirect_uri') ?? '';
  if (!client.redirect_uris.some((u) => sameRedirect(u, redirect))) throw new PortalError("The app's return address doesn't match what it registered");
  if (q.get('response_type') !== 'code') throw new PortalError('Only response_type=code is supported');
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.get('code_challenge') ?? '')) throw new PortalError('PKCE (S256) is required');
  const resource = q.get('resource');
  const asked = resource?.replace(/\/+$/, '');
  const ours = [publicUrl(), ...formerUrls()].flatMap((u) => [u, `${u}/mcp`]);
  if (asked && !ours.includes(asked)) throw new PortalError('Unknown resource');
  return { client: { id: client.id, name: client.name }, redirect, state: q.get('state'), challenge: q.get('code_challenge')!, host: new URL(redirect).host || new URL(redirect).protocol.replace(':', ''), scopes: parseScopes(q.get('scope')) };
}

/**
 * The consent screen: the request, what it asks in plain words, and each of the customer's orgs with what it would get
 * there (the plan and their role decide; `missing` says why the rest is left out).
 */
export async function consentInfo(user: User, q: URLSearchParams) {
  const r = await authorizeRequest(q);
  const orgs = await myOrgs(user);
  return {
    ...r,
    scopes: r.scopes.map((s) => ({ id: s, label: SCOPE_INFO[s].label })),
    orgs: orgs.map((o) => {
      const granted = grantScopes(r.scopes, o.entitlements, o.role);
      return {
        id: o.org.id, name: o.org.name, personal: o.org.personal, role: o.role, plan: o.plan.name, granted,
        missing: r.scopes.filter((s) => !granted.includes(s)).map((s) => ({ id: s, why: SCOPE_INFO[s].needs(o.entitlements) ? `needs the ${SCOPE_INFO[s].role} role or higher` : `comes with ${SCOPE_INFO[s].plan}` })),
      };
    }),
  };
}

/** The customer said yes, for one of their orgs (none named: their personal org): a code for the app, back on its
 *  redirect, carrying the scopes that org allows them. */
export async function approve(user: User, q: URLSearchParams, dailyCap: unknown, orgId?: unknown) {
  const r = await authorizeRequest(q);
  const ctx = await orgContext(user, typeof orgId === 'string' && orgId ? orgId : null);
  const scopes = grantScopes(r.scopes, ctx.entitlements, ctx.role);
  if (!scopes.length) throw new PortalError(`${r.client.name} asks for what ${ctx.org.name} can't give on its ${ctx.plan.name} plan (or your ${ctx.role} role). Pick another org or upgrade.`, { status: 403, code: 'scope_not_allowed' });
  const cap = dailyCap === null || dailyCap === '' || dailyCap === undefined ? null : Math.max(0, Math.min(1_000_000, Math.round(Number(dailyCap))));
  const code = crypto.randomBytes(32).toString('base64url');
  await codes().doc(sha256(code)).create({ client_id: r.client.id, user_id: user.id, org_id: ctx.org.id, scopes, redirect_uri: r.redirect, challenge: r.challenge, daily_cap: Number.isNaN(cap) ? DEFAULT_DAILY_CAP : cap, expires: Date.now() + 5 * 60_000, used: null });
  const to = new URL(r.redirect);
  to.searchParams.set('code', code);
  if (r.state) to.searchParams.set('state', r.state);
  to.searchParams.set('iss', publicUrl());
  return to.toString();
}

export async function deny(q: URLSearchParams) {
  const r = await authorizeRequest(q);
  const to = new URL(r.redirect);
  to.searchParams.set('error', 'access_denied');
  if (r.state) to.searchParams.set('state', r.state);
  return to.toString();
}

/** A connection's scopes (one made before scopes: `generate`). */
const scopesOf = (v: unknown): Scope[] => (Array.isArray(v) ? v.filter(isScope) : ['generate']);

/** A new access and refresh token for a connection, written in the caller's transaction. */
function issue(t: FirebaseFirestore.Transaction, connectionId: string, scopes: Scope[]) {
  const access = `hgo_${crypto.randomBytes(32).toString('base64url')}`;
  const refresh = `hgr_${crypto.randomBytes(32).toString('base64url')}`;
  const now = Date.now();
  t.create(tokens().doc(sha256(access)), { connection_id: connectionId, kind: 'access', expires: now + ACCESS_TTL * 1000 });
  t.create(tokens().doc(sha256(refresh)), { connection_id: connectionId, kind: 'refresh', expires: now + REFRESH_TTL * 1000 });
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: scopes.join(' ') };
}

export async function token(body: Record<string, string>) {
  if (body.grant_type === 'authorization_code') {
    const codeRef = codes().doc(sha256(body.code ?? ''));
    // A refused exchange throws inside the transaction, so nothing is written (as SQLite's rollback did).
    return db.runTransaction(async (t) => {
      const s = await t.get(codeRef);
      const row = s.data();
      if (!row || row.used || row.expires < Date.now()) throw oauthError('invalid_grant', 'The code is invalid or expired');
      if (body.client_id && body.client_id !== row.client_id) throw oauthError('invalid_grant', 'The code was issued to another client');
      if (body.redirect_uri && body.redirect_uri !== row.redirect_uri) throw oauthError('invalid_grant', 'redirect_uri does not match');
      const verifier = body.code_verifier ?? '';
      if (crypto.createHash('sha256').update(verifier).digest('base64url') !== row.challenge) throw oauthError('invalid_grant', 'PKCE verification failed');
      const client = await t.get(clients().doc(String(row.client_id)));
      const connId = id('conn_', 8);
      t.update(codeRef, { used: Date.now() });
      const scopes = scopesOf(row.scopes);
      t.create(connections().doc(connId), { user_id: row.user_id, org_id: row.org_id ?? null, scopes, client_id: row.client_id, name: client.exists ? client.get('name') : 'An MCP client', daily_cap: row.daily_cap ?? null, created: Date.now(), last_used: null, revoked: null });
      return issue(t, connId, scopes);
    });
  }
  if (body.grant_type === 'refresh_token') {
    const ref = tokens().doc(sha256(body.refresh_token ?? ''));
    return db.runTransaction(async (t) => {
      const s = await t.get(ref);
      const row = s.data();
      if (!row || row.kind !== 'refresh') throw oauthError('invalid_grant', 'The refresh token is invalid or expired');
      const conn = await t.get(connections().doc(String(row.connection_id)));
      if (!conn.exists || conn.get('revoked') || row.expires < Date.now()) throw oauthError('invalid_grant', 'The refresh token is invalid or expired');
      t.delete(ref);
      return issue(t, String(row.connection_id), scopesOf(conn.get('scopes')));
    });
  }
  throw oauthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
}

export async function revokeToken(tokenValue: string) {
  if (!tokenValue) return;
  const s = await tokens().doc(sha256(tokenValue)).get();
  if (s.exists) await connections().doc(String(s.get('connection_id'))).update({ revoked: Date.now() });
}

/** The connection behind an OAuth access token. */
export async function fromAccessToken(tokenValue: string): Promise<Caller | null> {
  const s = await tokens().doc(sha256(tokenValue)).get();
  if (!s.exists || s.get('kind') !== 'access' || Number(s.get('expires')) <= Date.now()) return null;
  const conn = await connections().doc(String(s.get('connection_id'))).get();
  if (!conn.exists || conn.get('revoked')) return null;
  const user = await getUser(String(conn.get('user_id')));
  if (!user || user.disabled) return null;
  void conn.ref.update({ last_used: Date.now() }).catch(() => {});
  return { user, via: { kind: 'connection', id: conn.id, name: conn.get('name'), cap: (conn.get('daily_cap') ?? null) as number | null, org: (conn.get('org_id') as string | null) || personalOrgId(user.id), scopes: scopesOf(conn.get('scopes')) } };
}
accessTokens.from = fromAccessToken;

export async function listConnections(userId: string) {
  const s = await connections().where('user_id', '==', userId).where('revoked', '==', null).orderBy('created', 'desc').get();
  return Promise.all(s.docs.map(async (d) => ({ id: d.id, name: d.get('name'), org_id: d.get('org_id') || personalOrgId(userId), scopes: scopesOf(d.get('scopes')), daily_cap: d.get('daily_cap') ?? null, created: d.get('created'), last_used: d.get('last_used') ?? null, spent_today: await spentToday(d.id) })));
}

export async function updateConnection(userId: string, connId: string, b: { daily_cap?: unknown; revoke?: unknown }) {
  const ref = connections().doc(connId);
  const c = await ref.get();
  if (!c.exists || c.get('user_id') !== userId || c.get('revoked')) throw new PortalError('No such connection', { status: 404 });
  if (b.revoke) {
    await ref.update({ revoked: Date.now() });
    const toks = await tokens().where('connection_id', '==', connId).get();
    for (let i = 0; i < toks.docs.length; i += 400) {
      const batch = db.batch();
      for (const d of toks.docs.slice(i, i + 400)) batch.delete(d.ref);
      await batch.commit();
    }
    return { revoked: true };
  }
  const cap = b.daily_cap === null ? null : Math.max(0, Math.min(1_000_000, Math.round(Number(b.daily_cap))));
  if (cap !== null && Number.isNaN(cap)) throw new PortalError('daily_cap: a number of credits, or null for no limit');
  await ref.update({ daily_cap: cap });
  return { daily_cap: cap };
}

// ------------------------------------------------------------ CORS routes (MCP clients run from other origins)
// /mcp, /oauth/(register|token|revoke) and /.well-known/*: open CORS (bearer tokens only, never the session cookie), an
// OPTIONS preflight answered 204, and the CORS headers on every answer there, a 404 included. mcp.ts adds /mcp here.

const CORS_ROUTES = /^\/(mcp|oauth\/(?:register|token|revoke)|\.well-known\/.*)$/;
type CorsHandler = (c: Ctx) => unknown | Promise<unknown>;
const corsTable = new Map<string, CorsHandler>();
/** A handler on one of the CORS paths (any method; it answers non-matching methods itself). */
export function corsRoute(path: string, handler: CorsHandler) { corsTable.set(path, handler); }

function cors(res: Ctx['res']) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
}

for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
  route(method, CORS_ROUTES, async (c) => {
    cors(c.res);
    if (c.method === 'OPTIONS') return void c.res.status(204).end();
    const h = corsTable.get(c.route);
    if (!h) return send(c.res, 404, { error: 'Not found' });
    return h(c);
  });
}

const getOnly = (answer: () => unknown): CorsHandler => ({ method, res }) => (method === 'GET' || method === 'HEAD' ? answer() : send(res, 404, { error: 'Not found' }));
corsRoute('/.well-known/oauth-protected-resource', getOnly(protectedResourceMetadata));
corsRoute('/.well-known/oauth-protected-resource/mcp', getOnly(protectedResourceMetadata));
corsRoute('/.well-known/oauth-authorization-server', getOnly(authorizationServerMetadata));
corsRoute('/.well-known/openid-configuration', getOnly(authorizationServerMetadata));
corsRoute('/oauth/register', async ({ req, res, method }) => {
  if (method !== 'POST') return send(res, 404, { error: 'Not found' });
  try {
    return send(res, 201, await registerClient(json(req)));
  } catch (e: any) {
    return send(res, 400, { error: e.oauth ?? 'invalid_client_metadata', error_description: e.message });
  }
});
corsRoute('/oauth/token', async ({ req, res, method }) => {
  if (method !== 'POST') return send(res, 404, { error: 'Not found' });
  try {
    return send(res, 200, await token(form(req)));
  } catch (e: any) {
    if (!e?.oauth && !(e instanceof PortalError)) console.error('[portal] oauth token:', e);
    return send(res, e.status === 401 ? 401 : 400, { error: e.oauth ?? 'invalid_request', error_description: e instanceof PortalError ? e.message : 'The request could not be completed' });
  }
});
corsRoute('/oauth/revoke', async ({ req, res, method }) => {
  if (method !== 'POST') return send(res, 404, { error: 'Not found' });
  await revokeToken(String(form(req).token ?? ''));
  return send(res, 200, {});
});

// ------------------------------------------------------------ the approve screen and connections (session or API key)

// The approve screen (/oauth/authorize): what's asking, then yes or no. Session only: a token can't approve itself.
route('GET', '/v1/oauth/request', async ({ req, url }) => consentInfo(await requireUser(req), url.searchParams));
for (const p of ['/v1/oauth/approve', '/v1/oauth/deny']) {
  route('POST', p, async ({ req, route: path }) => {
    const user = await requireUser(req);
    if (bearer(req) || !String(req.headers['content-type'] ?? '').includes('application/json')) throw new PortalError('Approve from the browser', { status: 403 });
    const b = json(req);
    const q = new URLSearchParams(String(b.query ?? ''));
    return { redirect: path.endsWith('approve') ? await approve(user, q, b.daily_cap, b.org) : await deny(q) };
  });
}
route('GET', '/v1/connections', async ({ req }) => ({ connections: await listConnections((await requireUser(req)).id), default_daily_cap: DEFAULT_DAILY_CAP }));
route('POST', /^\/v1\/connections\/(conn_[0-9a-f]+)$/, async ({ req, params }) => updateConnection((await requireUser(req)).id, params[0], json(req)));
