// The platform's rules (src/platform.ts): plans and entitlements, roles, OAuth scopes, and the platform token (EdDSA JWT)
// as Gen and Studio will verify it. Pure: no Firestore, no keys.
//   node --test --disable-warning=ExperimentalWarning test/platform.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  PLANS, offeredPlans, planOf, entitlementsOf, canSetRole, can, takesSeat, parseScopes, allowedScopes, grantScopes,
  personalOrgId, loadSigningKeys, newSigningKeyPem, mintPlatformToken, verifyPlatformToken, signJwt, thumbprint, SCOPES,
  type PlatformClaims,
} from '../src/platform.ts';

const plan = (id: string) => PLANS.find((p) => p.id === id)!;

test('plans: platform tiers offered only when switched on; old subscribers keep theirs', () => {
  assert.deepEqual(offeredPlans(false).map((p) => p.id), ['free', 'maker', 'pro']);
  assert.deepEqual(offeredPlans(true).map((p) => p.id), ['free', 'indie', 'team', 'studio']);
  assert.equal(planOf({ plan: 'maker', sub_status: 'active' }).id, 'maker', 'a maker subscriber keeps maker');
  assert.equal(planOf({ plan: 'pro', sub_status: 'past_due' }).id, 'pro', 'past_due is the grace period');
  assert.equal(planOf({ plan: 'team', sub_status: 'canceled' }).id, 'free');
  assert.equal(planOf({ plan: 'nope', sub_status: 'active' }).id, 'free');
  assert.equal(planOf(null).id, 'free');
  // The shape games.ts reads is still there for every plan.
  for (const p of PLANS) for (const k of ['games', 'members', 'monthlyCredits', 'priceCents', 'seats'] as const) assert.equal(typeof p[k], 'number', `${p.id}.${k}`);
  assert.deepEqual(['free', 'indie', 'team', 'studio'].map((id) => plan(id).priceCents), [0, 2900, 9900, 29900]);
});

test('entitlements: per product from the plan, grants only raise', () => {
  const free = entitlementsOf(plan('free'));
  assert.equal(free.gen.on, true);
  assert.equal(free.studio.games, 1);
  assert.equal(free.studio.schedule, 'weekly');
  assert.equal(free.net.rooms, 'test');
  assert.equal(entitlementsOf(plan('free'), { net: 'live' }).net.rooms, 'live', 'an old purchase keeps Net live');
  assert.equal(plan('free').entitlements.net.rooms, 'test', 'granting never changes the plan itself');
  const team = entitlementsOf(plan('team'));
  assert.equal(team.studio.agents, true);
  assert.equal(team.studio.cloudBuilds, false);
  assert.equal(team.studio.desktopMinutes, 600);
  assert.equal(team.gen.monthlyCredits, 5000);
  assert.equal(entitlementsOf(plan('studio')).studio.cloudBuilds, true);
  assert.equal(entitlementsOf(plan('maker')).net.rooms, 'live', 'a maker subscriber has Net as before');
  assert.equal(entitlementsOf(plan('indie')).studio.schedule, 'nightly');
});

test('roles: owners do anything, admins manage members and viewers, the rest nothing', () => {
  assert.equal(canSetRole('owner', 'admin', 'owner'), true);
  assert.equal(canSetRole('owner', 'owner', null), true, 'the last-owner check is the store\'s, with the count');
  assert.equal(canSetRole('admin', null, 'member'), true);
  assert.equal(canSetRole('admin', 'member', 'viewer'), true);
  assert.equal(canSetRole('admin', 'viewer', null), true);
  assert.equal(canSetRole('admin', null, 'admin'), false, 'admins do not make admins');
  assert.equal(canSetRole('admin', 'admin', null), false, 'nor remove them');
  assert.equal(canSetRole('admin', 'member', 'owner'), false);
  assert.equal(canSetRole('member', null, 'viewer'), false);
  assert.equal(canSetRole('viewer', 'member', null), false);
  assert.equal(can.billing('admin'), false);
  assert.equal(can.billing('owner'), true);
  assert.equal(can.work('viewer'), false);
  assert.equal(can.read('viewer'), true);
  assert.equal(takesSeat('viewer'), false);
  assert.equal(takesSeat('member'), true);
});

test('scopes: parsed, then cut to the plan and the role', () => {
  assert.deepEqual(parseScopes(null), ['generate'], 'no scope asked: what every token had before');
  assert.deepEqual(parseScopes('openid profile'), ['generate']);
  assert.deepEqual(parseScopes('playtest  backlog playtest nonsense'), ['playtest', 'backlog']);
  const free = entitlementsOf(plan('free'));
  const team = entitlementsOf(plan('team'));
  const studio = entitlementsOf(plan('studio'));
  assert.deepEqual(allowedScopes(free, 'owner'), ['generate', 'playtest', 'backlog']);
  assert.deepEqual(allowedScopes(team, 'member'), ['generate', 'playtest', 'backlog', 'agents']);
  assert.deepEqual(allowedScopes(studio, 'owner'), [...SCOPES]);
  assert.deepEqual(allowedScopes(studio, 'viewer'), ['backlog'], 'a viewer reads; nothing that spends or changes');
  assert.deepEqual(grantScopes(['generate', 'agents', 'build'], free, 'owner'), ['generate']);
  assert.deepEqual(grantScopes(['agents'], team, 'viewer'), []);
});

test('personal org ids follow the account id, on live and beta', () => {
  assert.equal(personalOrgId('usr_0123456789abcdef'), 'org_0123456789abcdef');
  assert.equal(personalOrgId('ustg_0123456789abcdef'), 'org_0123456789abcdef');
  assert.throws(() => personalOrgId('nobody'));
});

// ------------------------------------------------------------------ the platform token

const keys = loadSigningKeys(newSigningKeyPem());
const ISS = 'https://beta.hawkesgen.ai';
const claims = (): Omit<PlatformClaims, 'iat' | 'nbf' | 'exp' | 'jti' | 'sub'> => ({
  iss: ISS, aud: ['hawkesgen', 'hawkesstudio', 'hawkesnet'], org: 'org_0123456789abcdef', user: 'ustg_0123456789abcdef', project: 'ustg_0123456789abcdef',
  role: 'owner', plan: 'team', entitlements: entitlementsOf(plan('team')), scopes: ['generate', 'playtest'], via: { kind: 'session', id: 'session:x' },
});
const tamper = (t: string, f: (c: any) => void) => {
  const [h, b, s] = t.split('.');
  const c = JSON.parse(Buffer.from(b, 'base64url').toString());
  f(c);
  return [h, Buffer.from(JSON.stringify(c)).toString('base64url'), s].join('.');
};

test('platform token: minted, then verified with the JWKS as Gen and Studio do', () => {
  const now = Date.UTC(2026, 9, 29, 12);
  const t = mintPlatformToken(claims(), keys, { now });
  assert.equal(t.expires_in, 600);
  const [h] = t.token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'EdDSA', typ: 'JWT', kid: keys.kid });
  const c = verifyPlatformToken(t.token, keys.jwks, { iss: ISS, aud: 'hawkesstudio', now: now + 60_000 });
  assert.equal(c.org, 'org_0123456789abcdef');
  assert.equal(c.sub, 'ustg_0123456789abcdef');
  assert.equal(c.role, 'owner');
  assert.equal(c.plan, 'team');
  assert.deepEqual(c.scopes, ['generate', 'playtest']);
  assert.equal(c.entitlements.studio.agents, true);
  assert.equal(c.exp - c.iat, 600);
  // The JWKS is a public key only, with an RFC 7638 key id.
  const jwk = keys.jwks.keys[0];
  assert.deepEqual(Object.keys(jwk).sort(), ['alg', 'crv', 'kid', 'kty', 'use', 'x']);
  assert.equal(jwk.kid, thumbprint(jwk.x));
  // A standard verifier (Node's own JWK import) agrees with the signature.
  const [hh, bb, ss] = t.token.split('.');
  assert.ok(crypto.verify(null, Buffer.from(`${hh}.${bb}`), crypto.createPublicKey({ key: jwk as any, format: 'jwk' }), Buffer.from(ss, 'base64url')));
});

test('platform token: refused when expired, tampered, for another audience or issuer, or signed by another key', () => {
  const now = Date.UTC(2026, 9, 29, 12);
  const t = mintPlatformToken(claims(), keys, { now }).token;
  const v = (tok: string, o: Partial<{ iss: string; aud: string; now: number }> = {}) => () => verifyPlatformToken(tok, keys.jwks, { iss: ISS, aud: 'hawkesgen', now, ...o });
  assert.doesNotThrow(v(t));
  assert.throws(v(t, { now: now + 11 * 60_000 }), /expired/);
  assert.throws(v(t, { now: now - 5 * 60_000 }), /not yet valid/);
  assert.throws(v(t, { aud: 'someone-else' }), /audience/);
  assert.throws(v(t, { iss: 'https://hawkesgen.ai' }), /issuer/, 'a beta token is not a live one');
  assert.throws(v(tamper(t, (c) => { c.role = 'owner'; c.org = 'org_ffffffffffffffff'; })), /signature/);
  assert.throws(v(tamper(t, (c) => { c.scopes.push('agents'); })), /signature/);
  const other = loadSigningKeys(newSigningKeyPem());
  assert.throws(v(mintPlatformToken(claims(), other, { now }).token), /unknown key/);
  // Same kid, other key: the signature still fails.
  assert.throws(v(signJwt({ ...JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()) }, { ...other, kid: keys.kid })), /signature/);
  // alg none and HS256 tricks.
  const none = [Buffer.from(JSON.stringify({ alg: 'none', kid: keys.kid })).toString('base64url'), t.split('.')[1], ''].join('.');
  assert.throws(v(none), /alg/);
  assert.throws(v('nope'), /not a JWT/);
});

test('platform token: a key rotation publishes both keys; the first signs', () => {
  const oldPem = newSigningKeyPem();
  const before = loadSigningKeys(oldPem);
  const both = loadSigningKeys(`${newSigningKeyPem()}\n${oldPem}`);
  assert.equal(both.jwks.keys.length, 2);
  assert.notEqual(both.kid, before.kid);
  const now = Date.now();
  const old = mintPlatformToken(claims(), before, { now }).token;
  assert.equal(verifyPlatformToken(old, both.jwks, { iss: ISS, aud: 'hawkesnet', now }).org, 'org_0123456789abcdef', 'tokens from before the rotation still verify');
  assert.throws(() => loadSigningKeys('unset'), /no PEM/);
  assert.throws(() => loadSigningKeys(crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()), /Ed25519/);
});
