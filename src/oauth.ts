// OAuth 2.1 for MCP clients (Claude, Cursor, VS Code, ChatGPT...): the editor finds us (/.well-known/...), registers
// itself (dynamic client registration), sends the customer to /oauth/authorize (sign in, then approve with a daily credit
// limit), and swaps the code for tokens with PKCE (S256). Each approval is a connection the customer can see and revoke.
import crypto from 'node:crypto';
import { db, tx } from './db.ts';
import { publicUrl } from './config.ts';
import { getUser, type User } from './users.ts';
import { id, sha256, PortalError } from './util.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  daily_cap INTEGER,
  expires INTEGER NOT NULL,
  used INTEGER
);
-- An editor the customer approved. Its tokens act as the customer, within daily_cap credits a day (NULL: no limit).
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  daily_cap INTEGER,
  created INTEGER NOT NULL,
  last_used INTEGER,
  revoked INTEGER
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_tokens_conn ON oauth_tokens (connection_id);
`);

const ACCESS_TTL = 3600;
const REFRESH_TTL = 90 * 24 * 3600;
export const DEFAULT_DAILY_CAP = 1000;

export const resourceUrl = () => `${publicUrl()}/mcp`;

export function protectedResourceMetadata() {
  return { resource: resourceUrl(), authorization_servers: [publicUrl()], bearer_methods_supported: ['header'], scopes_supported: ['generate'], resource_name: 'Hawkes Gen' };
}

export function authorizationServerMetadata() {
  const base = publicUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['generate'],
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

export function registerClient(body: any) {
  const uris: string[] = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10 || !uris.every(allowedRedirect)) throw Object.assign(new PortalError('redirect_uris must be https, loopback http, or an app scheme'), { oauth: 'invalid_redirect_uri' });
  const name = String(body?.client_name ?? 'An MCP client').replace(/[\u0000-\u001f]/g, '').slice(0, 80) || 'An MCP client';
  const clientId = id('mcp_', 12);
  const now = Date.now();
  db.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created) VALUES (?, ?, ?, ?)').run(clientId, name, JSON.stringify(uris), now);
  return { client_id: clientId, client_id_issued_at: Math.floor(now / 1000), client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'generate' };
}

const getClient = (clientId: string) => db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(clientId) as { id: string; name: string; redirect_uris: string } | undefined;

/** What the approve screen needs, after checking the request is one we would honor. */
export function authorizeRequest(q: URLSearchParams) {
  const client = getClient(q.get('client_id') ?? '');
  if (!client) throw new PortalError('This app is not registered with Hawkes Gen. Remove it from your editor and add it again.');
  const redirect = q.get('redirect_uri') ?? '';
  if (!JSON.parse(client.redirect_uris).includes(redirect)) throw new PortalError("The app's return address doesn't match what it registered");
  if (q.get('response_type') !== 'code') throw new PortalError('Only response_type=code is supported');
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.get('code_challenge') ?? '')) throw new PortalError('PKCE (S256) is required');
  const resource = q.get('resource');
  if (resource && resource.replace(/\/+$/, '') !== resourceUrl() && resource.replace(/\/+$/, '') !== publicUrl()) throw new PortalError('Unknown resource');
  return { client: { id: client.id, name: client.name }, redirect, state: q.get('state'), challenge: q.get('code_challenge')!, host: new URL(redirect).host || new URL(redirect).protocol.replace(':', '') };
}

/** The customer said yes: a code for the app, back on its redirect. */
export function approve(user: User, q: URLSearchParams, dailyCap: unknown) {
  const r = authorizeRequest(q);
  const cap = dailyCap === null || dailyCap === '' || dailyCap === undefined ? null : Math.max(0, Math.min(1_000_000, Math.round(Number(dailyCap))));
  const code = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, daily_cap, expires) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sha256(code), r.client.id, user.id, r.redirect, r.challenge, Number.isNaN(cap) ? DEFAULT_DAILY_CAP : cap, Date.now() + 5 * 60_000);
  const to = new URL(r.redirect);
  to.searchParams.set('code', code);
  if (r.state) to.searchParams.set('state', r.state);
  to.searchParams.set('iss', publicUrl());
  return to.toString();
}

export function deny(q: URLSearchParams) {
  const r = authorizeRequest(q);
  const to = new URL(r.redirect);
  to.searchParams.set('error', 'access_denied');
  if (r.state) to.searchParams.set('state', r.state);
  return to.toString();
}

function issue(connectionId: string) {
  const access = `hgo_${crypto.randomBytes(32).toString('base64url')}`;
  const refresh = `hgr_${crypto.randomBytes(32).toString('base64url')}`;
  const now = Date.now();
  db.prepare("INSERT INTO oauth_tokens (token_hash, connection_id, kind, expires) VALUES (?, ?, 'access', ?)").run(sha256(access), connectionId, now + ACCESS_TTL * 1000);
  db.prepare("INSERT INTO oauth_tokens (token_hash, connection_id, kind, expires) VALUES (?, ?, 'refresh', ?)").run(sha256(refresh), connectionId, now + REFRESH_TTL * 1000);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: 'generate' };
}

const oauthError = (code: string, description: string) => Object.assign(new PortalError(description), { oauth: code });

export function token(body: Record<string, string>) {
  if (body.grant_type === 'authorization_code') {
    return tx(() => {
      const row = db.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').get(sha256(body.code ?? '')) as any;
      if (!row || row.used || row.expires < Date.now()) throw oauthError('invalid_grant', 'The code is invalid or expired');
      db.prepare('UPDATE oauth_codes SET used = ? WHERE code_hash = ?').run(Date.now(), row.code_hash);
      if (body.client_id && body.client_id !== row.client_id) throw oauthError('invalid_grant', 'The code was issued to another client');
      if (body.redirect_uri && body.redirect_uri !== row.redirect_uri) throw oauthError('invalid_grant', 'redirect_uri does not match');
      const verifier = body.code_verifier ?? '';
      if (crypto.createHash('sha256').update(verifier).digest('base64url') !== row.challenge) throw oauthError('invalid_grant', 'PKCE verification failed');
      const client = getClient(row.client_id);
      const connId = id('conn_', 8);
      db.prepare('INSERT INTO connections (id, user_id, client_id, name, daily_cap, created) VALUES (?, ?, ?, ?, ?, ?)').run(connId, row.user_id, row.client_id, client?.name ?? 'An MCP client', row.daily_cap, Date.now());
      return issue(connId);
    });
  }
  if (body.grant_type === 'refresh_token') {
    return tx(() => {
      const row = db.prepare("SELECT t.*, c.revoked FROM oauth_tokens t JOIN connections c ON c.id = t.connection_id WHERE t.token_hash = ? AND t.kind = 'refresh'").get(sha256(body.refresh_token ?? '')) as any;
      if (!row || row.revoked || row.expires < Date.now()) throw oauthError('invalid_grant', 'The refresh token is invalid or expired');
      db.prepare('DELETE FROM oauth_tokens WHERE token_hash = ?').run(row.token_hash);
      return issue(row.connection_id);
    });
  }
  throw oauthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
}

export function revokeToken(tokenValue: string) {
  const row = db.prepare('SELECT connection_id FROM oauth_tokens WHERE token_hash = ?').get(sha256(tokenValue ?? '')) as any;
  if (row) db.prepare('UPDATE connections SET revoked = ? WHERE id = ?').run(Date.now(), row.connection_id);
}

export type Via = { kind: 'session' | 'key' | 'oauth'; id: string; name?: string; cap: number | null };

/** The connection behind an OAuth access token. */
export function fromAccessToken(tokenValue: string): { user: User; via: Via } | null {
  const row = db.prepare("SELECT c.* FROM oauth_tokens t JOIN connections c ON c.id = t.connection_id WHERE t.token_hash = ? AND t.kind = 'access' AND t.expires > ?").get(sha256(tokenValue), Date.now()) as any;
  if (!row || row.revoked) return null;
  const user = getUser(row.user_id);
  if (!user || user.disabled) return null;
  db.prepare('UPDATE connections SET last_used = ? WHERE id = ?').run(Date.now(), row.id);
  return { user, via: { kind: 'oauth', id: row.id, name: row.name, cap: row.daily_cap } };
}

export function listConnections(userId: string) {
  return db.prepare(`SELECT c.id, c.name, c.daily_cap, c.created, c.last_used,
      (SELECT COALESCE(SUM(j.credits), 0) FROM jobs j WHERE j.via = c.id AND j.created >= ? AND j.status != 'failed' AND j.status != 'cancelled') AS spent_today
    FROM connections c WHERE c.user_id = ? AND c.revoked IS NULL ORDER BY c.created DESC`).all(Date.now() - 24 * 3600_000, userId);
}

export function updateConnection(userId: string, connId: string, b: { daily_cap?: unknown; revoke?: unknown }) {
  const c = db.prepare('SELECT id FROM connections WHERE id = ? AND user_id = ? AND revoked IS NULL').get(connId, userId);
  if (!c) throw new PortalError('No such connection', { status: 404 });
  if (b.revoke) {
    db.prepare('UPDATE connections SET revoked = ? WHERE id = ?').run(Date.now(), connId);
    db.prepare('DELETE FROM oauth_tokens WHERE connection_id = ?').run(connId);
    return { revoked: true };
  }
  const cap = b.daily_cap === null ? null : Math.max(0, Math.min(1_000_000, Math.round(Number(b.daily_cap))));
  if (cap !== null && Number.isNaN(cap)) throw new PortalError('daily_cap: a number of credits, or null for no limit');
  db.prepare('UPDATE connections SET daily_cap = ? WHERE id = ?').run(cap, connId);
  return { daily_cap: cap };
}
