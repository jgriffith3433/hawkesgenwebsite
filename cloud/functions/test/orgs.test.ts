// Orgs, members, invites, OAuth scopes and the platform token against the staging project's Firestore (no emulator on
// J's PC): throwaway accounts and orgs under test ids, deleted after. Skipped unless GOOGLE_CLOUD_PROJECT=hawkes-staging.
//   GOOGLE_CLOUD_PROJECT=hawkes-staging node --test --disable-warning=ExperimentalWarning test/orgs.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const ON = process.env.GOOGLE_CLOUD_PROJECT === 'hawkes-staging';
// Settings the modules read (staging's own; nothing here sends mail or reaches Gen).
process.env.PORTAL_PROJECT_PREFIX = 'ustg_';
process.env.PUBLIC_URL = 'https://beta.hawkesgen.ai';
const { newSigningKeyPem, loadSigningKeys, verifyPlatformToken, personalOrgId } = await import('../src/platform.ts');
const PEM = newSigningKeyPem();
process.env.PORTAL_PLATFORM_KEY = PEM; // defineSecret reads the environment

type U = import('../src/accounts.ts').User;
const hex = () => `feed${crypto.randomBytes(6).toString('hex')}`;
const made = { users: [] as string[], orgs: [] as string[], clients: [] as string[] };

test('orgs, members and the platform token on staging', { skip: !ON && 'set GOOGLE_CLOUD_PROJECT=hawkes-staging' }, async (t) => {
  const { db, users, ledgerOf } = await import('../src/store.ts');
  const O = await import('../src/orgs.ts');
  const oauth = await import('../src/oauth.ts');
  const { caller } = await import('../src/caller.ts');
  const { platformToken, jwks } = await import('../src/platform-token.ts');

  after(async () => {
    const refs: FirebaseFirestore.DocumentReference[] = [];
    for (const o of made.orgs) {
      refs.push(O.orgs().doc(o));
      for (const c of [O.orgMembers(), O.orgInvites()]) refs.push(...(await c.where('org_id', '==', o).get()).docs.map((d) => d.ref));
    }
    for (const u of made.users) {
      refs.push(users().doc(u), ...(await ledgerOf(u).get()).docs.map((d) => d.ref));
      for (const c of ['connections', 'oauthCodes']) refs.push(...(await db.collection(c).where('user_id', '==', u).get()).docs.map((d) => d.ref));
    }
    for (const c of made.clients) refs.push(db.collection('oauthClients').doc(c));
    const conns = refs.filter((r) => r.parent.id === 'connections').map((r) => r.id);
    for (const id of conns) refs.push(...(await db.collection('oauthTokens').where('connection_id', '==', id).get()).docs.map((d) => d.ref));
    for (const r of refs) await r.delete().catch(() => {});
  });

  const account = async (email: string, extra: Partial<U> = {}): Promise<U> => {
    const id = `ustg_${hex()}`;
    made.users.push(id);
    made.orgs.push(personalOrgId(id));
    const u = { email, name: email.split('@')[0], project: id, credits: 100, role: 'customer' as const, plan: 'free' as const, created: Date.now(), last_login: null, ...extra };
    await users().doc(id).create(u);
    return { id, ...u };
  };
  const ana = await account(`ana-${hex()}@example.com`);
  const bo = await account(`bo-${hex()}@example.com`);
  const buyer = await account(`buyer-${hex()}@example.com`);
  const sub = await account(`sub-${hex()}@example.com`, { plan: 'maker', sub_status: 'active' });

  await t.test('migration: a personal org on first touch, once, however many ask', async () => {
    const all = await Promise.all(Array.from({ length: 5 }, () => O.ensurePersonalOrg(ana)));
    assert.ok(all.every((o) => o.id === personalOrgId(ana.id) && o.personal));
    const members = await O.orgMembers().where('org_id', '==', personalOrgId(ana.id)).get();
    assert.equal(members.size, 1);
    assert.equal(members.docs[0].get('role'), 'owner');
    assert.equal((await O.ensurePersonalOrg(ana)).created, all[0].created, 'a second touch changes nothing');
    // An account that bought credits keeps Net's live rooms; one that didn't, doesn't.
    await ledgerOf(buyer.id).doc('tx_test').create({ delta: 500, balance_after: 600, kind: 'stripe_purchase', created: Date.now() });
    assert.equal((await O.orgContext(buyer)).entitlements.net.rooms, 'live');
    assert.equal((await O.orgContext(ana)).entitlements.net.rooms, 'test');
    // A maker subscriber's personal org is on maker.
    const s = await O.orgContext(sub);
    assert.equal(s.plan.id, 'maker');
    assert.equal(s.role, 'owner');
  });

  let team = '';
  let inviteLink = '';
  await t.test('team orgs: seats, invites by email link, roles', async () => {
    const org = await O.createOrg(ana, { name: 'Test Team' });
    team = org.id;
    made.orgs.push(team);
    assert.equal(org.role, 'owner');
    assert.equal(org.plan.id, 'free');
    // Free has one seat, the owner's: a member waits for an upgrade, a viewer is free.
    await assert.rejects(O.invite(ana, team, { email: bo.email, role: 'member' }), (e: any) => e.code === 'no_seats');
    await O.orgs().doc(team).update({ plan: 'team', sub_status: 'active' });
    const inv = await O.invite(ana, team, { email: bo.email, role: 'member' });
    inviteLink = inv.link;
    assert.match(inv.link, /^https:\/\/beta\.hawkesgen\.ai\/orgs\/join#[A-Za-z0-9_-]{32}$/);
    await assert.rejects(O.invite(ana, team, { email: bo.email }), (e: any) => e.status === 409, 'one invite per person');
    const token = inv.link.split('#')[1];
    // Only the invited email may use it, and strangers learn nothing of the org from a guess.
    await assert.rejects(O.acceptInvite(sub, token), (e: any) => e.code === 'wrong_account');
    await assert.rejects(O.peekInvite(bo, 'x'.repeat(32)), (e: any) => e.status === 404);
    await assert.rejects(O.orgContext(bo, team), (e: any) => e.status === 404);
    assert.equal((await O.peekInvite(bo, token)).matches, true);
    const joined = await O.acceptInvite(bo, token);
    assert.equal(joined.role, 'member');
    await assert.rejects(O.acceptInvite(bo, token), (e: any) => e.status === 410, 'used once');
    const mine = (await O.myOrgs(bo)).map((o) => o.org.id);
    assert.deepEqual(mine, [personalOrgId(bo.id), team], 'personal first');
    // A member can't manage; an admin manages members but not admins; the last owner stays.
    await assert.rejects(O.invite(bo, team, { email: 'x@example.com', role: 'viewer' }), (e: any) => e.status === 403);
    await O.setRole(ana, team, bo.id, 'admin');
    await assert.rejects(O.setRole(bo, team, ana.id, 'member'), (e: any) => e.status === 403);
    await assert.rejects(O.setRole(ana, team, ana.id, null), (e: any) => e.code === 'last_owner');
    await assert.rejects(O.setRole(ana, personalOrgId(ana.id), ana.id, null), (e: any) => e.status === 409);
    await O.setRole(ana, team, bo.id, 'member');
    const d = await O.orgDetail(ana, team);
    assert.equal(d.members.length, 2);
    assert.equal(d.seats.used, 2);
    assert.equal(d.seats.of, 5);
  });

  await t.test('OAuth: scopes cut to the org picked; the token carries the org', async () => {
    const client = await oauth.registerClient({ client_name: 'Test editor', redirect_uris: ['http://127.0.0.1:7777/cb'], scope: 'generate agents' });
    made.clients.push(client.client_id);
    assert.equal(client.scope, 'generate agents');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const q = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'http://127.0.0.1:7777/cb', response_type: 'code', code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), scope: 'generate playtest agents build' });
    const info = await oauth.consentInfo(bo, q);
    assert.deepEqual(info.scopes.map((s) => s.id), ['generate', 'playtest', 'agents', 'build']);
    assert.ok(info.scopes.every((s) => s.label.length > 10), 'plain words for each');
    const personal = info.orgs.find((o) => o.personal)!;
    const onTeam = info.orgs.find((o) => o.id === team)!;
    assert.deepEqual(personal.granted, ['generate', 'playtest']);
    assert.deepEqual(onTeam.granted, ['generate', 'playtest', 'agents'], "team: agents yes, cloud builds are Studio's");
    assert.match(onTeam.missing.find((m) => m.id === 'build')!.why, /Studio/);
    await assert.rejects(oauth.approve(bo, q, 100, 'org_ffffffffffffffff'), (e: any) => e.status === 404);
    const redirect = new URL(await oauth.approve(bo, q, 100, team));
    const tok = await oauth.token({ grant_type: 'authorization_code', code: redirect.searchParams.get('code')!, code_verifier: verifier, client_id: client.client_id, redirect_uri: 'http://127.0.0.1:7777/cb' });
    assert.equal(tok.scope, 'generate playtest agents');
    const c = await oauth.fromAccessToken(tok.access_token);
    assert.equal(c?.via.org, team);
    assert.deepEqual(c?.via.scopes, ['generate', 'playtest', 'agents']);
    const refreshed = await oauth.token({ grant_type: 'refresh_token', refresh_token: tok.refresh_token });
    assert.equal(refreshed.scope, tok.scope, 'a refresh keeps the scopes');

    // The platform token for that connection: its org, its scopes, as the plan allows now.
    const req = (token: string, body: object = {}) => ({ headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body } as any);
    const p = await platformToken(req(refreshed.access_token));
    const claims = verifyPlatformToken(p.token, jwks(), { iss: 'https://beta.hawkesgen.ai', aud: 'hawkesstudio' });
    assert.equal(claims.org, team);
    assert.equal(claims.user, bo.id);
    assert.equal(claims.role, 'member');
    assert.equal(claims.plan, 'team');
    assert.deepEqual(claims.scopes, ['generate', 'playtest', 'agents']);
    assert.equal(claims.via.kind, 'connection');
    assert.equal(loadSigningKeys(PEM).kid, jwks().keys[0].kid);
    await assert.rejects(platformToken(req(refreshed.access_token, { org: personalOrgId(bo.id) })), (e: any) => e.status === 403, 'a connection acts for its own org only');
    // Demoted to viewer: the next token says so, and loses what a viewer can't do.
    await O.setRole(ana, team, bo.id, 'viewer');
    const later = verifyPlatformToken((await platformToken(req(refreshed.access_token))).token, jwks(), { iss: 'https://beta.hawkesgen.ai', aud: 'hawkesgen' });
    assert.equal(later.role, 'viewer');
    assert.deepEqual(later.scopes, []);
    // Out of the org: no token at all.
    await O.setRole(ana, team, bo.id, null);
    await assert.rejects(platformToken(req(refreshed.access_token)), (e: any) => e.status === 403);

    // A connection without `generate` is no caller for Gen work, but may still mint platform tokens.
    await O.orgs().doc(team).update({ plan: 'studio' });
    const q2 = new URLSearchParams(q);
    q2.set('scope', 'build');
    const code2 = new URL(await oauth.approve(ana, q2, null, team)).searchParams.get('code')!;
    const tok2 = await oauth.token({ grant_type: 'authorization_code', code: code2, code_verifier: verifier });
    assert.equal(tok2.scope, 'build');
    assert.equal(await caller(req(tok2.access_token)), null);
    assert.equal((await caller(req(tok2.access_token), { anyScope: true }))?.via.org, team);
    const owner = verifyPlatformToken((await platformToken(req(tok2.access_token))).token, jwks(), { iss: 'https://beta.hawkesgen.ai', aud: 'hawkesgen' });
    assert.deepEqual(owner.scopes, ['build']);
    assert.deepEqual(owner.entitlements.studio.cloudBuilds, true);
    // Old connections (no org, no scopes) read as the personal org with generate.
    await db.collection('connections').doc(String(c?.via.id)).update({ org_id: null, scopes: null, revoked: null });
    const old = await oauth.fromAccessToken(tok.access_token);
    assert.equal(old?.via.org, personalOrgId(bo.id));
    assert.deepEqual(old?.via.scopes, ['generate']);
  });

  await t.test('invites and orgs go away with their org', async () => {
    assert.ok(inviteLink);
    await assert.rejects(O.deleteOrg(bo, team), (e: any) => e.status === 404);
    assert.deepEqual(await O.deleteOrg(ana, team), { deleted: true });
    assert.equal((await O.orgMembers().where('org_id', '==', team).get()).size, 0);
  });
});
