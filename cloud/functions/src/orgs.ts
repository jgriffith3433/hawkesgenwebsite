// Orgs: the tenant of the platform (hawkesstudio docs/platform-plan.md 4.2). Every account has a personal org, made the
// first time anything asks for it (idempotent: its id is the account's hex, org_<hex>, so two first touches make one org).
// Team orgs are made by a person, who becomes their owner, and filled by email invites. The rules (roles, seats, plans,
// entitlements) are platform.ts's; this module keeps them in Firestore:
//   orgs/{org_…}                    name, personal, owner_id, created; a team org's own plan and sub_status (set by an
//                                   admin for design partners until Stripe bills orgs), grants (platform.ts Grants),
//                                   studio (the org's id in Hawkes Studio, when it has a Studio there: its link only)
//   orgMembers/{org_…}__{usr_…}     org_id, user_id, role, email, added, by
//   orgInvites/{sha256(token)}      org_id, email, role, by, created, expires, accepted, revoked
// A personal org's plan is its owner's subscription (users/{id} plan and sub_status: Stripe keeps billing accounts as
// before), so existing subscribers keep their plan in their personal org with no move of billing.
import crypto from 'node:crypto';
import { db, users, ledgerOf } from './store.ts';
import { publicUrl, studioPage } from './config.ts';
import { getUser, requireUser, requireAdmin, authenticate, type User } from './accounts.ts';
import { sendEmail } from './mail.ts';
import { PortalError, sha256, id, route, json, redirect, Limiter } from './http.ts';
import {
  planOf, entitlementsOf, personalOrgId, canSetRole, can, takesSeat, isRole, PLANS, PAID_STATES, ORG_ID,
  type Role, type Plan, type Grants, type Entitlements,
} from './platform.ts';

export const orgs = () => db.collection('orgs');
export const orgMembers = () => db.collection('orgMembers');
export const orgInvites = () => db.collection('orgInvites');
export const memberId = (orgId: string, userId: string) => `${orgId}__${userId}`;

export const INVITE_DAYS = 7;
/** Team orgs one person may own (personal org aside). */
export const MAX_OWNED = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const invitesByUser = new Limiter(30, 3600_000);

export type Org = { id: string; name: string; personal: boolean; owner_id: string; created: number; plan?: string | null; sub_status?: string | null; grants?: Grants; studio?: string | null };
export type Member = { org_id: string; user_id: string; role: Role; email: string; name?: string | null; added: number; by: string | null };
/** An org as one member sees it. */
export type OrgContext = { org: Org; role: Role; plan: Plan; entitlements: Entitlements };

const cleanName = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);

/** Has this account ever paid (a credit pack or a plan's month)? Hawkes Net's test before plans carried it. */
const everPaid = async (userId: string) => !(await ledgerOf(userId).where('kind', 'in', ['stripe_purchase', 'subscription_credits']).limit(1).get()).empty;

/**
 * The account's personal org, made on first touch. Safe to call on every request and from many at once: the id is fixed
 * and the transaction creates it only if it is missing. Accounts that already paid keep Hawkes Net's live rooms (grants).
 */
export async function ensurePersonalOrg(user: Pick<User, 'id' | 'email' | 'name'>): Promise<Org> {
  const orgId = personalOrgId(user.id);
  const ref = orgs().doc(orgId);
  const have = await ref.get();
  if (have.exists) return { id: orgId, ...(have.data() as Omit<Org, 'id'>) };
  const paid = await everPaid(user.id);
  const now = Date.now();
  const org: Omit<Org, 'id'> = { name: user.name ? `${user.name}` : user.email.split('@')[0], personal: true, owner_id: user.id, created: now, grants: paid ? { net: 'live' } : {} };
  return db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (s.exists) return { id: orgId, ...(s.data() as Omit<Org, 'id'>) };
    t.create(ref, org);
    t.create(orgMembers().doc(memberId(orgId, user.id)), { org_id: orgId, user_id: user.id, role: 'owner', email: user.email, name: user.name ?? null, added: now, by: null } satisfies Member);
    return { id: orgId, ...org };
  });
}

/** The plan an org is on: a personal org's is its owner's subscription; a team org carries its own. */
export async function orgPlan(org: Org, owner?: Pick<User, 'plan' | 'sub_status'> | null): Promise<Plan> {
  if (org.personal) return planOf(owner ?? (await getUser(org.owner_id)));
  return planOf({ plan: org.plan, sub_status: org.sub_status });
}

export async function getOrg(orgId: string): Promise<Org | null> {
  if (!ORG_ID.test(orgId)) return null;
  const s = await orgs().doc(orgId).get();
  return s.exists ? { id: s.id, ...(s.data() as Omit<Org, 'id'>) } : null;
}

async function memberOf(orgId: string, userId: string): Promise<Member | null> {
  const s = await orgMembers().doc(memberId(orgId, userId)).get();
  return s.exists ? (s.data() as Member) : null;
}

/**
 * The org as `user` sees it: their role, the plan and its entitlements. No org named: their personal org. Not a member:
 * 404 (an org's existence is not told to strangers).
 */
export async function orgContext(user: User, orgId?: string | null): Promise<OrgContext> {
  const personal = personalOrgId(user.id);
  const oid = orgId || personal;
  if (oid === personal) {
    const org = await ensurePersonalOrg(user);
    const plan = await orgPlan(org, user);
    return { org, role: 'owner', plan, entitlements: entitlementsOf(plan, org.grants) };
  }
  const [org, m] = await Promise.all([getOrg(oid), memberOf(oid, user.id)]);
  if (!org || !m) throw new PortalError('No such org', { status: 404 });
  const plan = await orgPlan(org);
  return { org, role: m.role, plan, entitlements: entitlementsOf(plan, org.grants) };
}

/** Every org the account is in, personal first. */
export async function myOrgs(user: User): Promise<OrgContext[]> {
  await ensurePersonalOrg(user);
  const ms = (await orgMembers().where('user_id', '==', user.id).get()).docs.map((d) => d.data() as Member);
  const out = await Promise.all(ms.map(async (m) => {
    const org = await getOrg(m.org_id);
    if (!org) return null;
    const plan = await orgPlan(org, org.owner_id === user.id ? user : null);
    return { org, role: m.role, plan, entitlements: entitlementsOf(plan, org.grants) };
  }));
  return out.filter((x): x is OrgContext => Boolean(x)).sort((a, b) => Number(b.org.personal) - Number(a.org.personal) || a.org.created - b.org.created);
}

// Hawkes Studio (hawkesstudio docs/studio-customers.md): every customer org has a Studio of its own at
// studio.hawkesgen.ai/o/<its Studio id>/, and the front door (studio.hawkesgen.ai) signs people in with Google and takes
// them there, or to a short sign-up. Studio's org ids are its own (a slug and 4 hex), so an org records its Studio id
// when it has one (`studio`, set by its owners and admins); without one the link is the front door. It is only a link:
// the Studio checks who signs in. No platform token rides along (Studio's own Google sign-in is the way in).
export const STUDIO_ORG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Where "Open Studio" goes for an org: its own Studio, else the front door. Per lane (config.ts studioUrl). */
export const studioLink = (org?: Pick<Org, 'studio'> | null) => studioPage(org?.studio && STUDIO_ORG_RE.test(org.studio) ? `/o/${org.studio}/` : '/');

export const publicOrg = (c: OrgContext) => ({ id: c.org.id, name: c.org.name, personal: c.org.personal, role: c.role, plan: { id: c.plan.id, name: c.plan.name, seats: c.plan.seats }, entitlements: c.entitlements, studio: studioLink(c.org) });

async function need(user: User, orgId: string, ok: (r: Role) => boolean, what: string) {
  const c = await orgContext(user, orgId);
  if (!ok(c.role)) throw new PortalError(`Only ${what} can do that`, { status: 403 });
  return c;
}

export async function createOrg(user: User, body: any) {
  const name = cleanName(body?.name);
  if (!name) throw new PortalError('Give the org a name');
  await ensurePersonalOrg(user);
  const owned = await orgMembers().where('user_id', '==', user.id).where('role', '==', 'owner').get();
  if (owned.size - 1 >= MAX_OWNED) throw new PortalError(`You own ${MAX_OWNED} orgs already`, { status: 409 });
  const orgId = id('org_', 8);
  const now = Date.now();
  const batch = db.batch();
  batch.create(orgs().doc(orgId), { name, personal: false, owner_id: user.id, created: now, plan: 'free', sub_status: null, grants: {} });
  batch.create(orgMembers().doc(memberId(orgId, user.id)), { org_id: orgId, user_id: user.id, role: 'owner', email: user.email, name: user.name ?? null, added: now, by: user.id } satisfies Member);
  await batch.commit();
  return publicOrg(await orgContext(user, orgId));
}

/** An org's page: who is in it and who is invited (members and viewers see it; invites only for admins). */
export async function orgDetail(user: User, orgId: string) {
  const c = await need(user, orgId, can.read, 'its members');
  const members = (await orgMembers().where('org_id', '==', orgId).get()).docs.map((d) => d.data() as Member)
    .map((m) => ({ user_id: m.user_id, email: m.email, name: m.name ?? null, role: m.role, added: m.added }))
    .sort((a, b) => a.added - b.added);
  const invites = can.manageMembers(c.role) ? (await pendingInvites(orgId)).map((i) => ({ id: i.id, email: i.email, role: i.role, created: i.created, expires: i.expires })) : [];
  return { ...publicOrg(c), members, invites, seats: { used: await seatsUsed(orgId), of: c.plan.seats } };
}

/** Renames an org and/or records its Hawkes Studio id (`studio`: "" or null forgets it). Owners and admins. */
export async function updateOrg(user: User, orgId: string, body: any) {
  const c = await need(user, orgId, can.rename, 'owners and admins');
  const set: Partial<Org> = {};
  if (body?.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) throw new PortalError('Give the org a name');
    set.name = name;
  }
  if (body?.studio !== undefined) {
    const s = String(body.studio ?? '').trim().toLowerCase();
    if (s && !STUDIO_ORG_RE.test(s)) throw new PortalError('A Studio id is lowercase letters, digits and dashes (the part after /o/ in its address)');
    set.studio = s || null;
  }
  if (!Object.keys(set).length) throw new PortalError('Nothing to change: send name or studio');
  // A personal org is made on first touch (orgContext made it), so the doc is there to update.
  await orgs().doc(c.org.id).update(set);
  const org = { ...c.org, ...set };
  return { name: org.name, studio: studioLink(org) };
}

/** Where /studio sends a person: the asked org's Studio (if they are in it), else the first of their orgs with one, else
 *  the front door. Signed out (or any error), the front door. */
export async function studioFor(user: User | null, orgId?: string | null): Promise<string> {
  if (!user) return studioLink(null);
  try {
    if (orgId) return studioLink((await orgContext(user, orgId)).org);
    return studioLink((await myOrgs(user)).find((c) => c.org.studio)?.org);
  } catch { return studioLink(null); }
}

async function pendingInvites(orgId: string, t?: FirebaseFirestore.Transaction) {
  const q = orgInvites().where('org_id', '==', orgId).where('accepted', '==', null).where('revoked', '==', null);
  const s = t ? await t.get(q) : await q.get();
  const now = Date.now();
  return s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((i) => i.expires > now) as { id: string; email: string; role: Role; created: number; expires: number }[];
}
/** Seats taken: members who aren't viewers. */
async function seatsUsed(orgId: string, t?: FirebaseFirestore.Transaction) {
  const q = orgMembers().where('org_id', '==', orgId);
  const s = t ? await t.get(q) : await q.get();
  return s.docs.filter((d) => takesSeat(d.get('role'))).length;
}

/** An email invite: a link the invited person opens signed in with that email. The link is returned too (no mail on beta). */
export async function invite(user: User, orgId: string, body: any) {
  const c = await need(user, orgId, can.manageMembers, 'owners and admins');
  if (c.org.personal) throw new PortalError('A personal org is yours alone: make a team org to invite people', { status: 409 });
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) throw new PortalError('Enter a valid email address');
  const role: Role = isRole(body?.role) ? body.role : 'member';
  if (!canSetRole(c.role, null, role)) throw new PortalError(`An ${c.role} can't invite an ${role}`, { status: 403 });
  invitesByUser.take(user.id, 'Too many invites this hour');
  const already = (await orgMembers().where('org_id', '==', orgId).where('email', '==', email).limit(1).get());
  if (!already.empty) throw new PortalError('They are in this org already', { status: 409 });
  const pending = await pendingInvites(orgId);
  if (pending.some((i) => i.email === email)) throw new PortalError('They have an invite already: cancel it to send a new one', { status: 409 });
  if (takesSeat(role) && (await seatsUsed(orgId)) + pending.filter((i) => takesSeat(i.role)).length >= c.plan.seats) {
    throw new PortalError(`The ${c.plan.name} plan has ${c.plan.seats} seat${c.plan.seats === 1 ? '' : 's'}, and they are taken or promised. Invite them as a viewer, or upgrade.`, { status: 402, code: 'no_seats' });
  }
  const token = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  await orgInvites().doc(sha256(token)).create({ org_id: orgId, email, role, by: user.id, created: now, expires: now + INVITE_DAYS * 86400_000, accepted: null, revoked: null });
  const link = `${publicUrl()}/orgs/join#${token}`;
  const who = user.name || user.email;
  await sendEmail(email, `${who} invited you to ${c.org.name} on Hawkes`,
    `${who} invited you to join ${c.org.name} on Hawkes as ${role === 'admin' ? 'an' : 'a'} ${role}.\n\nJoin: ${link}\n\nThe link works for ${INVITE_DAYS} days, signed in as ${email}.`,
    `<p>${esc(who)} invited you to join <b>${esc(c.org.name)}</b> on Hawkes as ${role === 'admin' ? 'an' : 'a'} ${role}.</p><p><a href="${link}">Join ${esc(c.org.name)}</a></p><p>The link works for ${INVITE_DAYS} days, signed in as ${esc(email)}.</p>`,
  ).catch((e) => console.error('[portal] invite mail:', e));
  return { invite: { email, role, expires: now + INVITE_DAYS * 86400_000 }, link };
}
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export async function revokeInvite(user: User, orgId: string, inviteId: string) {
  await need(user, orgId, can.manageMembers, 'owners and admins');
  const ref = orgInvites().doc(inviteId);
  const s = await ref.get();
  if (!/^[0-9a-f]{64}$/.test(inviteId) || !s.exists || s.get('org_id') !== orgId) throw new PortalError('No such invite', { status: 404 });
  await ref.update({ revoked: Date.now() });
  return { revoked: true };
}

async function inviteByToken(token: string) {
  const ref = orgInvites().doc(sha256(String(token ?? '')));
  const s = await ref.get();
  const i = s.data();
  if (!i || i.revoked) throw new PortalError('This invite is not valid. Ask for a new one.', { status: 404 });
  if (i.accepted) throw new PortalError('This invite was used already', { status: 410 });
  if (i.expires <= Date.now()) throw new PortalError('This invite has expired. Ask for a new one.', { status: 410 });
  return { ref, invite: i };
}

/** What an invite link is for (the join page shows it before the person accepts). */
export async function peekInvite(user: User, token: string) {
  const { invite: i } = await inviteByToken(token);
  const org = await getOrg(i.org_id);
  if (!org) throw new PortalError('This org is gone', { status: 410 });
  return { org: { id: org.id, name: org.name }, role: i.role, email: i.email, you: user.email, matches: user.email.toLowerCase() === i.email };
}

/** Accepts an invite: the signed-in account must have the invited email, and the org still a seat for them. */
export async function acceptInvite(user: User, token: string) {
  const { ref } = await inviteByToken(token);
  const out = await db.runTransaction(async (t) => {
    const i = (await t.get(ref)).data();
    if (!i || i.revoked || i.accepted || i.expires <= Date.now()) throw new PortalError('This invite is not valid any more', { status: 410 });
    if (user.email.toLowerCase() !== i.email) throw new PortalError(`This invite is for ${i.email}. Sign in with that Google account to join.`, { status: 403, code: 'wrong_account' });
    const org = await t.get(orgs().doc(i.org_id));
    if (!org.exists) throw new PortalError('This org is gone', { status: 410 });
    const mRef = orgMembers().doc(memberId(i.org_id, user.id));
    const m = await t.get(mRef);
    const used = await seatsUsed(i.org_id, t);
    const plan = planOf({ plan: org.get('plan'), sub_status: org.get('sub_status') });
    t.update(ref, { accepted: Date.now(), accepted_by: user.id });
    if (m.exists) return { org_id: i.org_id, role: m.get('role') as Role };
    // The seat was promised when the invite went out; this is the last check, against what is taken now.
    if (takesSeat(i.role) && used >= plan.seats) throw new PortalError(`${org.get('name')} has no seat left. Ask its owner to upgrade.`, { status: 402, code: 'no_seats' });
    t.create(mRef, { org_id: i.org_id, user_id: user.id, role: i.role, email: user.email, name: user.name ?? null, added: Date.now(), by: i.by } satisfies Member);
    return { org_id: i.org_id, role: i.role as Role };
  });
  return publicOrg(await orgContext(user, out.org_id));
}

/** Owners in an org (the last one may not leave or step down). */
const ownerCount = async (orgId: string, t: FirebaseFirestore.Transaction) => (await t.get(orgMembers().where('org_id', '==', orgId).where('role', '==', 'owner'))).size;

/** Changes someone's role (`to`), or takes them out of the org (`to` null; yourself: leaving). */
export async function setRole(user: User, orgId: string, targetId: string, to: Role | null) {
  const c = await orgContext(user, orgId);
  const self = targetId === user.id;
  if (c.org.personal) throw new PortalError("A personal org is its account's alone", { status: 409 });
  return db.runTransaction(async (t) => {
    const ref = orgMembers().doc(memberId(orgId, targetId));
    const s = await t.get(ref);
    if (!s.exists) throw new PortalError('They are not in this org', { status: 404 });
    const from = s.get('role') as Role;
    const leaving = self && to === null;
    if (!leaving && !canSetRole(c.role, from, to)) throw new PortalError(c.role === 'admin' ? 'Admins manage members and viewers; only an owner changes admins and owners' : 'Only owners and admins manage members', { status: 403 });
    if (from === 'owner' && to !== 'owner' && (await ownerCount(orgId, t)) <= 1) throw new PortalError('An org needs an owner: make someone else owner first', { status: 409, code: 'last_owner' });
    if (to && takesSeat(to) && !takesSeat(from)) {
      const used = await seatsUsed(orgId, t);
      if (used >= c.plan.seats) throw new PortalError(`The ${c.plan.name} plan has ${c.plan.seats} seats, all taken`, { status: 402, code: 'no_seats' });
    }
    if (to === null) t.delete(ref);
    else if (to !== from) t.update(ref, { role: to });
    return { user_id: targetId, role: to };
  });
}

/** Deletes a team org (owners only): its members and invites go with it. Its Gen and Studio data are theirs to clean up. */
export async function deleteOrg(user: User, orgId: string) {
  const c = await need(user, orgId, can.deleteOrg, 'its owners');
  if (c.org.personal) throw new PortalError('A personal org stays with its account', { status: 409 });
  const refs = [
    ...(await orgMembers().where('org_id', '==', orgId).get()).docs.map((d) => d.ref),
    ...(await orgInvites().where('org_id', '==', orgId).get()).docs.map((d) => d.ref),
    orgs().doc(orgId),
  ];
  for (let i = 0; i < refs.length; i += 400) {
    const b = db.batch();
    for (const r of refs.slice(i, i + 400)) b.delete(r);
    await b.commit();
  }
  return { deleted: true };
}

/** A team org's plan, set by a portal admin (design partners; Stripe bills orgs later). */
export async function setOrgPlan(admin: User, orgId: string, body: any) {
  const user = admin; // the route has checked: requireAdmin (J's Google sign-in), never a stored role
  const org = await getOrg(orgId);
  if (!org) throw new PortalError('No such org', { status: 404 });
  if (org.personal) throw new PortalError("A personal org's plan is its owner's subscription", { status: 409 });
  const plan = PLANS.find((p) => p.id === body?.plan);
  if (!plan) throw new PortalError(`plan: one of ${PLANS.map((p) => p.id).join(', ')}`);
  const status = plan.id === 'free' ? null : PAID_STATES.includes(body?.status) ? body.status : 'active';
  await orgs().doc(orgId).update({ plan: plan.id, sub_status: status, plan_set_by: user.id, plan_set_at: Date.now() });
  return { plan: plan.id, status };
}

/** A purchase opens Hawkes Net's live rooms for the buyer, as it always has (billing.ts after a credit pack). */
export async function grantNetLive(userId: string) {
  const u = await getUser(userId);
  if (!u) return;
  const org = await ensurePersonalOrg(u);
  if (org.grants?.net !== 'live') await orgs().doc(org.id).update({ 'grants.net': 'live' });
}

// ------------------------------------------------------------------ routes

const ORG = '(org_[0-9a-f]{8,32})';
const USER = '([a-z][a-z0-9]{0,15}_[0-9a-f]{8,32})';
route('GET', '/v1/orgs', async ({ req }) => ({ orgs: (await myOrgs(await requireUser(req))).map(publicOrg) }));
route('POST', '/v1/orgs', async ({ req }) => ({ org: await createOrg(await requireUser(req), json(req)) }));
route('POST', '/v1/orgs/invites/peek', async ({ req }) => peekInvite(await requireUser(req), String(json(req).token ?? '')));
route('POST', '/v1/orgs/invites/accept', async ({ req }) => ({ org: await acceptInvite(await requireUser(req), String(json(req).token ?? '')) }));
route('GET', new RegExp(`^/v1/orgs/${ORG}$`), async ({ req, params }) => orgDetail(await requireUser(req), params[0]));
route('PATCH', new RegExp(`^/v1/orgs/${ORG}$`), async ({ req, params }) => updateOrg(await requireUser(req), params[0], json(req)));
// "Open Studio" on every page links here, so the lane's Studio address and the org's own Studio are decided in one place.
route('GET', '/studio', async ({ req, res, url }) => {
  const org = url.searchParams.get('org');
  redirect(res, await studioFor(await authenticate(req).catch(() => null), org && ORG_ID.test(org) ? org : null));
});
route('DELETE', new RegExp(`^/v1/orgs/${ORG}$`), async ({ req, params }) => deleteOrg(await requireUser(req), params[0]));
route('POST', new RegExp(`^/v1/orgs/${ORG}/invites$`), async ({ req, params }) => invite(await requireUser(req), params[0], json(req)));
route('DELETE', new RegExp(`^/v1/orgs/${ORG}/invites/([0-9a-f]{64})$`), async ({ req, params }) => revokeInvite(await requireUser(req), params[0], params[1]));
route('PATCH', new RegExp(`^/v1/orgs/${ORG}/members/${USER}$`), async ({ req, params }) => {
  const role = json(req).role;
  if (!isRole(role)) throw new PortalError('role: owner, admin, member or viewer');
  return setRole(await requireUser(req), params[0], params[1], role);
});
route('DELETE', new RegExp(`^/v1/orgs/${ORG}/members/${USER}$`), async ({ req, params }) => setRole(await requireUser(req), params[0], params[1], null));
route('POST', new RegExp(`^/v1/orgs/${ORG}/plan$`), async ({ req, params }) => setOrgPlan(await requireAdmin(req), params[0], json(req)));
