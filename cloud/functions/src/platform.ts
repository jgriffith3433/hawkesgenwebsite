// The platform's rules, as pure functions (no Firestore, no secrets: test/platform.test.ts runs them anywhere). The
// portal is the one account system for Gen, Studio and Net (hawkesstudio docs/platform-plan.md, 4.2 and 7):
//   - plans: one set of plans with entitlements per product (gen, studio, net); maker and pro are the old Gen plans,
//     kept for their subscribers and no longer offered
//   - roles in an org: owner > admin > member > viewer
//   - OAuth scopes: what an app may do for an org, limited by the org's plan and the member's role
//   - the platform token: a short-lived JWT (EdDSA) Gen and Studio verify with the keys at /.well-known/jwks.json
import crypto from 'node:crypto';

// ------------------------------------------------------------------ plans and entitlements

export type PlanId = 'free' | 'indie' | 'team' | 'studio' | 'maker' | 'pro';
export type Entitlements = {
  gen: { on: boolean; monthlyCredits: number };
  studio: {
    on: boolean;
    /** Games Studio builds, playtests and reviews (not the portal's own Creator Studio games: Plan.games). */
    games: number;
    schedule: 'weekly' | 'nightly';
    desktopMinutes: number;
    windows: boolean;
    aiPlayer: boolean;
    agents: boolean;
    talk: boolean;
    cloudBuilds: boolean;
    priority: boolean;
  };
  net: { on: boolean; rooms: 'test' | 'live' };
};
export type Plan = {
  id: PlanId;
  name: string;
  priceCents: number;
  priceUsd: number;
  monthlyCredits: number;
  /** Creator Studio games an account owns (games.ts). */
  games: number;
  /** People per Creator Studio game (games.ts). */
  members: number;
  /** People in an org who count as seats (owners, admins, members; viewers are free). */
  seats: number;
  blurb: string;
  /** No longer offered: kept so its subscribers keep what they pay for. */
  legacy?: boolean;
  entitlements: Entitlements;
};

const studio = (o: Partial<Entitlements['studio']>): Entitlements['studio'] => ({ on: true, games: 1, schedule: 'weekly', desktopMinutes: 0, windows: false, aiPlayer: false, agents: false, talk: false, cloudBuilds: false, priority: false, ...o });
const ent = (credits: number, s: Partial<Entitlements['studio']>, rooms: 'test' | 'live'): Entitlements => ({ gen: { on: true, monthlyCredits: credits }, studio: studio(s), net: { on: true, rooms } });

// Prices, seats and limits of free/indie/team/studio are PROVISIONAL (platform-plan.md section 7: "to test with design
// partners"). A new price gets a new Stripe lookup key (plans.ts priceFor), so changing one here never moves a subscriber.
export const PLANS: Plan[] = [
  { id: 'free', name: 'Free', priceCents: 0, priceUsd: 0, monthlyCredits: 0, games: 3, members: 3, seats: 1, blurb: 'One game, web playtests every week with a review, starter credits, Hawkes Net test rooms.', entitlements: ent(0, { games: 1 }, 'test') },
  { id: 'indie', name: 'Indie', priceCents: 2900, priceUsd: 29, monthlyCredits: 1500, games: 20, members: 8, seats: 2, blurb: '3 games playtested every night with reviews, pull request checks, the MCP, 120 desktop minutes, 1,500 credits a month.', entitlements: ent(1500, { games: 3, schedule: 'nightly', desktopMinutes: 120 }, 'live') },
  { id: 'team', name: 'Team', priceCents: 9900, priceUsd: 99, monthlyCredits: 5000, games: 100, members: 25, seats: 5, blurb: '10 games, real Windows runs, the AI player, agent fixes, Talk and the PM, 5 seats, 600 desktop minutes, 5,000 credits a month.', entitlements: ent(5000, { games: 10, schedule: 'nightly', desktopMinutes: 600, windows: true, aiPlayer: true, agents: true, talk: true }, 'live') },
  { id: 'studio', name: 'Studio', priceCents: 29900, priceUsd: 299, monthlyCredits: 15000, games: 300, members: 50, seats: 20, blurb: '30 games, priority lanes, cloud builds, 20 seats, 2,000 desktop minutes, 15,000 credits a month.', entitlements: ent(15000, { games: 30, schedule: 'nightly', desktopMinutes: 2000, windows: true, aiPlayer: true, agents: true, talk: true, cloudBuilds: true, priority: true }, 'live') },
  // The Gen plans before the platform: still billed and honored, not offered to new subscribers.
  { id: 'maker', name: 'Maker', priceCents: 1500, priceUsd: 15, monthlyCredits: 1500, games: 20, members: 8, seats: 2, legacy: true, blurb: '1,500 credits every month for AI help, art, models, sound and music.', entitlements: ent(1500, { games: 1 }, 'live') },
  { id: 'pro', name: 'Pro', priceCents: 4000, priceUsd: 40, monthlyCredits: 4500, games: 100, members: 25, seats: 3, legacy: true, blurb: '4,500 credits every month, room for a whole crew and many games.', entitlements: ent(4500, { games: 1 }, 'live') },
];
/**
 * The plans a customer may choose now. With the platform plans on (PORTAL_PLATFORM_PLANS=on: beta first), free, indie,
 * team and studio; off (live, until J sets the prices and Studio takes customers), free, maker and pro as before.
 * Whatever a subscriber already has stays in force either way (planOf).
 */
export const offeredPlans = (platformOn: boolean) => PLANS.filter((p) => p.id === 'free' || (platformOn ? !p.legacy : p.legacy));

export const PAID_STATES = ['active', 'trialing', 'past_due'];

/** The plan in force: a paid plan counts while Stripe calls it paid, or retries a card (past_due) in its grace period. */
export function planOf(x: { plan?: unknown; sub_status?: unknown } | null | undefined): Plan {
  const id = x && PAID_STATES.includes(String(x.sub_status)) ? x.plan : 'free';
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

/** Grants on an org beyond its plan (only ever up): `net: 'live'` for accounts that bought credits before plans
 *  carried Hawkes Net (hnet.ts's old "paid = any purchase"). */
export type Grants = { net?: 'live' };

export function entitlementsOf(plan: Plan, grants: Grants = {}): Entitlements {
  const e: Entitlements = structuredClone(plan.entitlements);
  if (grants.net === 'live') e.net.rooms = 'live';
  return e;
}

// ------------------------------------------------------------------ roles

export const ROLES = ['viewer', 'member', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (r: unknown): r is Role => ROLES.includes(r as Role);
export const rank = (r: Role) => ROLES.indexOf(r);
export const atLeast = (r: Role, min: Role) => rank(r) >= rank(min);

/** Who may do what in an org. */
export const can = {
  read: (r: Role) => atLeast(r, 'viewer'),
  /** Run work that spends the org's credits or changes its games. */
  work: (r: Role) => atLeast(r, 'member'),
  manageMembers: (r: Role) => atLeast(r, 'admin'),
  rename: (r: Role) => atLeast(r, 'admin'),
  billing: (r: Role) => r === 'owner',
  deleteOrg: (r: Role) => r === 'owner',
};

/**
 * May `actor` move someone from role `from` (null: not in the org yet, an invite) to role `to` (null: out of the org)?
 * Owners may do anything (the last owner is orgs.ts's check: it needs the count). Admins manage members and viewers only.
 */
export function canSetRole(actor: Role, from: Role | null, to: Role | null) {
  if (actor === 'owner') return true;
  if (actor !== 'admin') return false;
  const low = (r: Role | null) => r === null || r === 'member' || r === 'viewer';
  return low(from) && low(to);
}

/** Seats count everyone but viewers. */
export const takesSeat = (r: Role) => r !== 'viewer';

// ------------------------------------------------------------------ OAuth scopes

export const SCOPES = ['generate', 'playtest', 'backlog', 'build', 'agents'] as const;
export type Scope = (typeof SCOPES)[number];

/** Each scope in plain words (the consent page shows these), what the plan must include, and the least role. */
export const SCOPE_INFO: Record<Scope, { label: string; needs: (e: Entitlements) => boolean; role: Role; plan: string }> = {
  generate: { label: 'Run Hawkes Gen tools (art, models, sound, music, AI help), which spends credits, and read the files they make', needs: (e) => e.gen.on, role: 'member', plan: 'every plan' },
  playtest: { label: "Start playtests of your games and see how they went: videos, reviews and what broke", needs: (e) => e.studio.on, role: 'member', plan: 'every plan' },
  backlog: { label: "Read your games' bug lists and daily reports, and mark bugs fixed", needs: (e) => e.studio.on, role: 'viewer', plan: 'every plan' },
  build: { label: 'Build your games in the cloud', needs: (e) => e.studio.cloudBuilds, role: 'member', plan: 'Studio' },
  agents: { label: "Have AI agents change your games' code and open pull requests", needs: (e) => e.studio.agents, role: 'member', plan: 'Team and Studio' },
};

export const isScope = (s: unknown): s is Scope => SCOPES.includes(s as Scope);

/** The scopes in an OAuth `scope` parameter (space separated). Unknown ones are dropped; none at all means
 *  `generate`, what every token carried before scopes, so existing editors keep working. */
export function parseScopes(scope: string | null | undefined): Scope[] {
  const asked = [...new Set(String(scope ?? '').split(/\s+/).filter(isScope))];
  return asked.length ? asked : ['generate'];
}

/** The scopes an org's plan and a member's role allow. */
export const allowedScopes = (e: Entitlements, role: Role): Scope[] => SCOPES.filter((s) => SCOPE_INFO[s].needs(e) && atLeast(role, SCOPE_INFO[s].role));

/** What a token gets: what was asked, cut to what's allowed now. */
export const grantScopes = (asked: readonly Scope[], e: Entitlements, role: Role): Scope[] => {
  const ok = allowedScopes(e, role);
  return asked.filter((s) => ok.includes(s));
};

// ------------------------------------------------------------------ org ids

/** A user's personal org: the same hex as the account (usr_<hex> / ustg_<hex> -> org_<hex>), so it is found, never looked up. */
export function personalOrgId(userId: string) {
  const m = /^[a-z][a-z0-9]{0,15}_([0-9a-f]{8,32})$/.exec(userId);
  if (!m) throw new Error(`not an account id: ${userId}`);
  return `org_${m[1]}`;
}
export const ORG_ID = /^org_[0-9a-f]{8,32}$/;

// ------------------------------------------------------------------ the platform token (JWT, EdDSA / Ed25519)

export const PLATFORM_TTL = 600; // seconds
export const PLATFORM_AUDIENCES = ['hawkesgen', 'hawkesstudio', 'hawkesnet'] as const;

export type PlatformClaims = {
  iss: string;
  sub: string;
  aud: string | string[];
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
  org: string;
  user: string;
  /** The user's Gen project (usr_…), until Gen keys tenants by org. */
  project: string;
  role: Role;
  plan: PlanId;
  entitlements: Entitlements;
  scopes: Scope[];
  /** How the caller signed in: a browser session, an API key, or an OAuth connection (its id). */
  via: { kind: 'session' | 'key' | 'connection'; id: string };
};

export type Jwk = { kty: 'OKP'; crv: 'Ed25519'; x: string; kid: string; use: 'sig'; alg: 'EdDSA' };
export type SigningKeys = { kid: string; privateKey: crypto.KeyObject; jwks: { keys: Jwk[] } };

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** RFC 7638 thumbprint of an Ed25519 public key: its key id. */
export function thumbprint(x: string) {
  return b64u(crypto.createHash('sha256').update(JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x })).digest());
}

function publicJwk(key: crypto.KeyObject): Jwk {
  const j = crypto.createPublicKey(key).export({ format: 'jwk' }) as { kty: string; crv: string; x: string };
  if (j.kty !== 'OKP' || j.crv !== 'Ed25519') throw new Error('the platform key must be Ed25519');
  return { kty: 'OKP', crv: 'Ed25519', x: j.x, kid: thumbprint(j.x), use: 'sig', alg: 'EdDSA' };
}

/**
 * The signing keys from the secret's text: one or more PKCS#8 PEM private keys (Ed25519). The first signs; all are
 * published, so a new key can go first while tokens signed by the old one (10 minutes) still verify.
 */
export function loadSigningKeys(pemText: string): SigningKeys {
  const pems = String(pemText ?? '').match(/-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/g) ?? [];
  if (!pems.length) throw new Error('PORTAL_PLATFORM_KEY holds no PEM private key');
  const keys = pems.map((p) => crypto.createPrivateKey(p));
  const jwks = keys.map(publicJwk);
  return { kid: jwks[0].kid, privateKey: keys[0], jwks: { keys: jwks } };
}

/** A new Ed25519 key as PKCS#8 PEM (cloud/setup-secrets.mjs makes the secret the same way). */
export const newSigningKeyPem = () => crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

export function signJwt(payload: Record<string, unknown>, keys: SigningKeys) {
  const head = b64u(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: keys.kid }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.sign(null, Buffer.from(`${head}.${body}`), keys.privateKey);
  return `${head}.${body}.${b64u(sig)}`;
}

/** Mints a platform token for `ttl` seconds (at most PLATFORM_TTL). */
export function mintPlatformToken(c: Omit<PlatformClaims, 'iat' | 'nbf' | 'exp' | 'jti' | 'sub'>, keys: SigningKeys, o: { now?: number; ttl?: number } = {}) {
  const iat = Math.floor((o.now ?? Date.now()) / 1000);
  const ttl = Math.max(1, Math.min(PLATFORM_TTL, Math.floor(o.ttl ?? PLATFORM_TTL)));
  const claims: PlatformClaims = { ...c, sub: c.user, iat, nbf: iat, exp: iat + ttl, jti: crypto.randomBytes(12).toString('base64url') };
  return { token: signJwt(claims, keys), claims, expires_in: ttl };
}

/**
 * Verifies a platform token against a JWKS (what Gen and Studio do with /.well-known/jwks.json): the signature by the
 * key its `kid` names, EdDSA only, the issuer, an audience, and the time (with `leeway` seconds for clocks). Throws
 * with a reason; returns the claims.
 */
export function verifyPlatformToken(token: string, jwks: { keys: Jwk[] }, o: { iss: string; aud: string; now?: number; leeway?: number }): PlatformClaims {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) throw new Error('not a JWT');
  let head: any, claims: any;
  try {
    head = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('not a JWT');
  }
  if (head?.alg !== 'EdDSA') throw new Error('alg must be EdDSA');
  const jwk = jwks.keys.find((k) => k.kid === head.kid);
  if (!jwk) throw new Error('unknown key id');
  const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
  if (!crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw new Error('bad signature');
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  const leeway = o.leeway ?? 30;
  if (claims.iss !== o.iss) throw new Error('wrong issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(o.aud)) throw new Error('wrong audience');
  if (!(Number(claims.exp) > now - leeway)) throw new Error('expired');
  if (Number(claims.nbf ?? claims.iat) > now + leeway) throw new Error('not yet valid');
  if (!ORG_ID.test(String(claims.org)) || !isRole(claims.role) || !Array.isArray(claims.scopes)) throw new Error('missing claims');
  return claims as PlatformClaims;
}
