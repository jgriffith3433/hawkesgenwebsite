// Orgs, members, invites and the platform token against the staging project's Firestore (no emulator on
// J's PC): throwaway accounts and orgs under test ids, deleted after. Skipped unless GOOGLE_CLOUD_PROJECT=hawkes-staging.
//   GOOGLE_CLOUD_PROJECT=hawkes-staging node --test --disable-warning=ExperimentalWarning test/orgs.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const ON = process.env.GOOGLE_CLOUD_PROJECT === 'hawkes-staging';
// Settings the modules read (staging's own; nothing here sends mail or reaches Gen).
process.env.PORTAL_PROJECT_PREFIX = 'ustg_';
process.env.PUBLIC_URL = 'https://beta.hawkesgen.ai';
process.env.PORTAL_STUDIO_URL = 'https://studio-beta.hawkesgen.ai/';
const { newSigningKeyPem, loadSigningKeys, verifyPlatformToken, personalOrgId } = await import('../src/platform.ts');
const PEM = newSigningKeyPem();
process.env.PORTAL_PLATFORM_KEY = PEM; // defineSecret reads the environment

type U = import('../src/accounts.ts').User;
const hex = () => `feed${crypto.randomBytes(6).toString('hex')}`;
const made = { users: [] as string[], orgs: [] as string[] };
const FRONT = 'https://studio-beta.hawkesgen.ai/';

test("Open Studio: the lane's front door, or an org's own Studio at /o/<id>/ (no Firestore)", async () => {
  const { studioLink, STUDIO_ORG_RE } = await import('../src/orgs.ts');
  const { handle } = await import('../src/http.ts');
  assert.equal(studioLink(null), FRONT);
  assert.equal(studioLink({ studio: null }), FRONT);
  assert.equal(studioLink({ studio: 'acme-games-3f2a' }), 'https://studio-beta.hawkesgen.ai/o/acme-games-3f2a/');
  for (const bad of ['../x', 'A', 'a/b', 'x'.repeat(64), '-a', 'a b']) {
    assert.ok(!STUDIO_ORG_RE.test(bad), bad);
    assert.equal(studioLink({ studio: bad }), FRONT, `a bad stored id is never put in a link: ${bad}`);
  }
  // Signed out, /studio is the front door (its sign-up), whatever org is asked for.
  for (const path of ['/studio', '/studio?org=org_0123456789abcdef', '/studio?org=https://evil.example']) {
    const res: any = { headersSent: false, statusCode: 0, headers: {} as Record<string, string>, status(s: number) { this.statusCode = s; return this; }, set(k: string, v: string) { this.headers[k] = v; return this; }, end() { this.headersSent = true; }, json() { this.headersSent = true; }, send() { this.headersSent = true; } };
    await handle({ method: 'GET', url: path, originalUrl: path, headers: {}, socket: {} } as any, res);
    assert.equal(res.statusCode, 302, path);
    assert.equal(res.headers.Location, FRONT, path);
  }
});

test('orgs, members and the platform token on staging', { skip: !ON && 'set GOOGLE_CLOUD_PROJECT=hawkes-staging' }, async (t) => {
  const { db, users, ledgerOf } = await import('../src/store.ts');
  const O = await import('../src/orgs.ts');
  const { mintApiKey } = await import('../src/accounts.ts');
  const { platformToken, jwks } = await import('../src/platform-token.ts');

  after(async () => {
    const refs: FirebaseFirestore.DocumentReference[] = [];
    for (const o of made.orgs) {
      refs.push(O.orgs().doc(o));
      for (const c of [O.orgMembers(), O.orgInvites()]) refs.push(...(await c.where('org_id', '==', o).get()).docs.map((d) => d.ref));
    }
    for (const u of made.users) {
      refs.push(users().doc(u), ...(await ledgerOf(u).get()).docs.map((d) => d.ref));
    }
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

  await t.test('Open Studio: an org records its Studio id; members are sent there, others to the front door', async () => {
    assert.equal((await O.myOrgs(ana)).map(O.publicOrg)[0].studio, FRONT, 'no Studio yet: the front door');
    await assert.rejects(O.updateOrg(bo, team, { studio: 'test-team-ab12' }), (e: any) => e.status === 403, 'a member cannot set it');
    await assert.rejects(O.updateOrg(ana, team, { studio: '../../evil' }), (e: any) => e.status === 400);
    await assert.rejects(O.updateOrg(ana, team, {}), (e: any) => e.status === 400);
    assert.deepEqual(await O.updateOrg(ana, team, { studio: 'Test-Team-AB12' }), { name: 'Test Team', studio: 'https://studio-beta.hawkesgen.ai/o/test-team-ab12/' });
    const own = 'https://studio-beta.hawkesgen.ai/o/test-team-ab12/';
    assert.equal((await O.orgDetail(bo, team)).studio, own, 'members see the link');
    assert.equal(await O.studioFor(bo, team), own);
    assert.equal(await O.studioFor(bo, null), own, 'no org asked: the first of theirs with a Studio');
    assert.equal(await O.studioFor(sub, team), FRONT, 'not a member: the front door, nothing about the org');
    assert.equal(await O.studioFor(sub, null), FRONT);
    assert.equal(await O.studioFor(null, team), FRONT);
    // Renaming keeps it; "" forgets it. A personal org can have one too.
    assert.equal((await O.updateOrg(ana, team, { name: 'Test Team' })).studio, own);
    assert.equal((await O.updateOrg(ana, team, { studio: '' })).studio, FRONT);
    assert.equal(await O.studioFor(bo, team), FRONT);
    assert.equal((await O.updateOrg(sub, personalOrgId(sub.id), { studio: 'solo-9c1d' })).studio, 'https://studio-beta.hawkesgen.ai/o/solo-9c1d/');
    assert.equal(await O.studioFor(sub, null), 'https://studio-beta.hawkesgen.ai/o/solo-9c1d/');
  });

  await t.test('the platform token: the org asked for, its role and plan as they are now', async () => {
    const { apiKey } = await mintApiKey(bo.id);
    const req = (body: object = {}) => ({ headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body } as any);
    const p = await platformToken(req({ org: team }));
    const claims = verifyPlatformToken(p.token, jwks(), { iss: 'https://beta.hawkesgen.ai', aud: 'hawkesstudio' });
    assert.equal(claims.org, team);
    assert.equal(claims.user, bo.id);
    assert.equal(claims.role, 'member');
    assert.equal(claims.plan, 'team');
    assert.equal(claims.via.kind, 'key');
    assert.equal(loadSigningKeys(PEM).kid, jwks().keys[0].kid);
    // Demoted to viewer: the next token says so, and loses what a viewer can't do.
    await O.setRole(ana, team, bo.id, 'viewer');
    const later = verifyPlatformToken((await platformToken(req({ org: team }))).token, jwks(), { iss: 'https://beta.hawkesgen.ai', aud: 'hawkesgen' });
    assert.equal(later.role, 'viewer');
    assert.deepEqual(later.scopes, []);
    // Out of the org: no token for it.
    await O.setRole(ana, team, bo.id, null);
    await assert.rejects(platformToken(req({ org: team })), (e: any) => e.status === 403 || e.status === 404);
    await db.collection('apiKeys').doc(crypto.createHash('sha256').update(apiKey).digest('hex')).delete().catch(() => {});
  });

  await t.test('invites and orgs go away with their org', async () => {
    assert.ok(inviteLink);
    await assert.rejects(O.deleteOrg(bo, team), (e: any) => e.status === 404);
    assert.deepEqual(await O.deleteOrg(ana, team), { deleted: true });
    assert.equal((await O.orgMembers().where('org_id', '==', team).get()).size, 0);
  });
});
