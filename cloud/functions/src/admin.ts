// What an admin sees and does (/admin; src/admin.ts): the business at a glance, every account with its ledger and jobs,
// credit adjustments and gifts, disabling an account, roles. Every change of credits is a ledger row (store.ts
// changeCredits). /v1/admin/* answers 404 to anyone but an admin.
// Not here: reports and hiding games (/v1/admin/reports, /v1/admin/games/<id>/hide|unhide) are the games area's, the
// starter sync (/v1/admin/community/sync) the community area's. Password links are gone (Google only): 410.
// Firestore has no joins, LIKE or GROUP BY: counts and sums are aggregation queries, the search reads the accounts and
// matches here (fine at today's size), and what other areas keep (games, connections, shares...) is read by the shared
// convention (table -> camelCase collection, the same column names) and counts as zero where it isn't there yet.
import { db, users, ledgerOf, changeCredits, auth } from './store.ts';
import { USER_ID } from './config.ts';
import { PACKS } from './billing.ts';
import { getUser, requireUser, toPublicUser, type User } from './accounts.ts';
import { PortalError, route, send, json } from './http.ts';
import { AggregateField } from 'firebase-admin/firestore';

const DAY = 24 * 3600_000;

async function requireAdmin(req: Parameters<typeof requireUser>[0]) {
  const user = await requireUser(req);
  if (user.role !== 'admin') throw new PortalError('Not found', { status: 404 });
  return user;
}

// What a purchase paid, from its pack (credits bought -> the pack's price).
const centsFor = (credits: number) => PACKS.find((p) => p.credits === credits)?.priceCents ?? credits;
const count = async (q: FirebaseFirestore.Query) => { try { return (await q.count().get()).data().count; } catch { return 0; } };
const sum = async (q: FirebaseFirestore.Query, field: string) => { try { return Number((await q.aggregate({ s: AggregateField.sum(field) }).get()).data().s ?? 0); } catch { return 0; } };
const docs = async (q: FirebaseFirestore.Query) => { try { return (await q.get()).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>); } catch { return []; } };
const ledgerRows = () => db.collectionGroup('ledger');
const userOfRow = (d: FirebaseFirestore.QueryDocumentSnapshot) => d.ref.parent.parent?.id ?? '';

/** Every purchase row (kind stripe_purchase), newest first. A collection-group query (cloud/firestore.indexes.json). */
async function purchaseRows() {
  const s = await ledgerRows().where('kind', '==', 'stripe_purchase').get();
  return s.docs.map((d) => ({ user_id: userOfRow(d), ...(d.data() as { delta: number; created: number; detail?: string; stripe_session_id?: string }) })).sort((a, b) => b.created - a.created);
}

export async function overview() {
  const now = Date.now();
  const [bought, granted, jobs30, jobs24] = await Promise.all([
    purchaseRows(),
    ledgerRows().where('created', '>=', now - 30 * DAY).get(),
    db.collection('jobs').where('created', '>=', now - 30 * DAY).get(),
    db.collection('jobs').where('created', '>=', now - DAY).get(),
  ]);
  const revenueSince = (since: number) => bought.filter((r) => r.created >= since).reduce((n, r) => n + centsFor(r.delta), 0);
  const jobs24h: Record<string, number> = {};
  for (const d of jobs24.docs) jobs24h[d.get('status')] = (jobs24h[d.get('status')] ?? 0) + 1;
  return {
    accounts: {
      total: await count(users()),
      new7d: await count(users().where('created', '>=', now - 7 * DAY)),
      active7d: await count(users().where('last_login', '>=', now - 7 * DAY)),
      disabled: await count(users().where('disabled', '==', true)),
    },
    revenue: { cents30d: revenueSince(now - 30 * DAY), centsAll: revenueSince(0), purchases30d: bought.filter((r) => r.created >= now - 30 * DAY).length },
    credits: {
      outstanding: await sum(users(), 'credits'),
      spent30d: jobs30.docs.filter((d) => d.get('status') === 'done').reduce((n, d) => n + Number(d.get('credits') ?? 0), 0),
      granted30d: granted.docs.filter((d) => ['signup_bonus', 'admin_grant', 'referral_bonus', 'referral_reward'].includes(d.get('kind')) && Number(d.get('delta')) > 0).reduce((n, d) => n + Number(d.get('delta')), 0),
    },
    jobs24h,
  };
}

/** An account's row in the list: with its games, jobs, credits spent and bought. */
async function listRow(u: User) {
  const jobs = db.collection('jobs').where('user_id', '==', u.id);
  return {
    id: u.id, email: u.email, name: u.name, credits: u.credits, role: u.role, disabled: u.disabled ? 1 : 0, created: u.created, last_login: u.last_login,
    plan: u.plan ?? 'free', sub_status: u.sub_status ?? null, source: u.source ?? null,
    games: await count(db.collection('games').where('owner_id', '==', u.id)),
    jobs: await count(jobs),
    spent: await sum(jobs.where('status', '==', 'done'), 'credits'),
    bought: await sum(ledgerOf(u.id).where('kind', '==', 'stripe_purchase'), 'delta'),
  };
}

export async function listUsers(q: { search?: string | null; limit?: number; offset?: number }) {
  const limit = Math.max(1, Math.min(200, q.limit || 50));
  const offset = Math.max(0, q.offset || 0);
  const search = String(q.search ?? '').trim();
  let found: User[];
  let total: number;
  if (search) {
    // email LIKE, name LIKE or the exact id (SQLite's LIKE ignores case for ASCII; so does this).
    const s = search.toLowerCase();
    const all = (await users().orderBy('created', 'desc').get()).docs.map((d) => ({ id: d.id, ...d.data() }) as User);
    const hits = all.filter((u) => u.id === search || String(u.email ?? '').toLowerCase().includes(s) || String(u.name ?? '').toLowerCase().includes(s));
    total = hits.length;
    found = hits.slice(offset, offset + limit);
  } else {
    total = await count(users());
    found = (await users().orderBy('created', 'desc').offset(offset).limit(limit).get()).docs.map((d) => ({ id: d.id, ...d.data() }) as User);
  }
  return { items: await Promise.all(found.map(listRow)), total };
}

export async function userDetail(userId: string) {
  const u = await getUser(userId);
  if (!u) throw new PortalError('No such account', { status: 404 });
  const x = u as User & { avatar?: unknown; google_sub?: string | null; uid?: string | null };
  const now = Date.now();
  const referrer = u.referred_by ? await getUser(String(u.referred_by)) : null;
  let look: { what?: string; name?: string } | null = null;
  try {
    const a: any = typeof x.avatar === 'string' ? JSON.parse(x.avatar) : x.avatar;
    if (a && typeof a === 'object') look = { what: a.what ? String(a.what) : undefined, name: a.name ? String(a.name) : undefined };
  } catch { /* not ours to fix here */ }
  const ledgerAll = (await ledgerOf(userId).get()).docs.map((d) => ({ id: d.id, user_id: userId, ...d.data() }) as Record<string, any>);
  const purchases = ledgerAll.filter((r) => r.kind === 'stripe_purchase');
  const jobs = (await docs(db.collection('jobs').where('user_id', '==', userId))).sort((a, b) => b.created - a.created);
  const done = jobs.filter((j) => j.status === 'done');
  const tools = new Map<string, { tool: string; n: number; credits: number }>();
  for (const j of jobs) { const t = tools.get(j.tool) ?? { tool: j.tool, n: 0, credits: 0 }; t.n++; t.credits += Number(j.credits ?? 0); tools.set(j.tool, t); }
  const byNewest = (a: any, b: any) => Number(b.created ?? 0) - Number(a.created ?? 0);
  const keys = (await docs(db.collection('apiKeys').where('user_id', '==', userId))).sort(byNewest);
  return {
    user: {
      ...toPublicUser(u), disabled: Boolean(u.disabled), stripe_customer_id: u.stripe_customer_id ?? null,
      sub_status: u.sub_status ?? null, period_end: u.period_end ?? null, cancel_at_period_end: Boolean(u.cancel_at_period_end),
      source: u.source ?? null, google: Boolean(x.uid || x.google_sub), look,
      referrer: referrer ? { id: referrer.id, email: referrer.email } : null, referral_paid: Boolean(u.referral_paid),
    },
    // What they've done: money, credits, work, what they built and how they connect.
    stats: {
      paidCents: purchases.reduce((n, r) => n + centsFor(r.delta), 0),
      purchases: purchases.length,
      lastPurchase: purchases.reduce((t, r) => Math.max(t, r.created), 0) || null,
      bought: purchases.reduce((n, r) => n + r.delta, 0),
      granted: ledgerAll.filter((r) => r.delta > 0 && r.kind !== 'stripe_purchase' && !String(r.kind).includes('refund')).reduce((n, r) => n + r.delta, 0),
      spent: done.reduce((n, j) => n + Number(j.credits ?? 0), 0),
      spent30d: done.filter((j) => j.created >= now - 30 * DAY).reduce((n, j) => n + Number(j.credits ?? 0), 0),
      jobs: jobs.length,
      failed: jobs.filter((j) => j.status === 'failed' || j.status === 'cancelled').length,
      lastJob: jobs[0]?.created ?? null,
      // Sessions are Firebase session cookies now, which can't be counted: 0 (the page then shows no device tag).
      sessions: 0,
      invited: await count(users().where('referred_by', '==', userId)),
      invitedBought: await count(users().where('referred_by', '==', userId).where('referral_paid', '==', true)),
      memberOf: await count(db.collectionGroup('members').where('user_id', '==', userId)),
      friends: await count(db.collection('friends').where('user_id', '==', userId)),
      shared: await count(db.collection('communityAssets').where('by_user', '==', userId)),
      shareLinks: await count(db.collection('shares').where('user_id', '==', userId)),
    },
    tools: [...tools.values()].sort((a, b) => b.n - a.n).slice(0, 6),
    games: (await docs(db.collection('games').where('owner_id', '==', userId))).sort((a, b) => Number(b.updated ?? 0) - Number(a.updated ?? 0)).slice(0, 20)
      .map((g) => ({ id: g.id, slug: g.slug, title: g.title, visibility: g.visibility, plays: g.plays, created: g.created, updated: g.updated, hidden: g.hidden ?? null })),
    keys: keys.slice(0, 10).map((k) => ({ prefix: k.prefix, created: k.created, last_used: k.last_used ?? null, disabled: k.disabled ? 1 : 0 })),
    connections: (await docs(db.collection('connections').where('user_id', '==', userId))).sort(byNewest).slice(0, 10)
      .map((c) => ({ name: c.name, daily_cap: c.daily_cap ?? null, created: c.created, last_used: c.last_used ?? null, revoked: c.revoked ?? null })),
    key: (() => { const k = keys.find((k) => !k.disabled); return k ? { prefix: k.prefix, created: k.created, last_used: k.last_used ?? null } : null; })(),
    ledger: ledgerAll.sort(byNewest).slice(0, 200),
    jobs: jobs.slice(0, 100),
  };
}

/** Adds (or, negative, takes) credits, with a note naming the admin. A balance never goes below zero. */
export async function adjustCredits(admin: User, userId: string, delta: unknown, note: unknown) {
  const n = Math.round(Number(delta));
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 1_000_000) throw new PortalError('Credits: a whole number, not zero');
  const why = String(note ?? '').trim().slice(0, 200);
  if (!why) throw new PortalError('Say why (it goes in their ledger)');
  const e = await db.runTransaction(async (t) => {
    const u = await t.get(users().doc(userId));
    if (!u.exists) throw new PortalError('No such account', { status: 404 });
    const have = Number(u.get('credits') ?? 0);
    if (have + n < 0) throw new PortalError(`They have ${have} credits; can't take ${-n}`);
    return changeCredits(userId, n, { kind: n > 0 ? 'admin_grant' : 'admin_debit', detail: `${why} (by ${admin.email})` }, { t });
  });
  return { credits: e!.balance_after };
}

/** A gift: credits added (in their ledger as a gift, with the admin's message). The cloud portal sends no email yet,
 *  so `emailed` is false and the page says so. */
export async function giftCredits(admin: User, userId: string, credits: unknown, message: unknown) {
  const n = Math.round(Number(credits));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) throw new PortalError('Gift: a whole number of credits, more than zero');
  const note = String(message ?? '').trim().slice(0, 500);
  const r = await adjustCredits(admin, userId, n, note ? `Gift: ${note.slice(0, 180)}` : 'Gift');
  return { ...r, emailed: false };
}

export async function setDisabled(admin: User, userId: string, disabled: boolean) {
  if (userId === admin.id) throw new PortalError("You can't disable your own account");
  const u = await getUser(userId);
  if (!u) throw new PortalError('No such account', { status: 404 });
  await users().doc(userId).update({ disabled });
  // Signed out everywhere (their session cookies stop at the next check: accounts.ts refuses a disabled account anyway).
  const uid = (u as User & { uid?: string }).uid;
  if (disabled && uid) await auth.revokeRefreshTokens(uid).catch(() => {});
  return (await userDetail(userId)).user;
}

export async function setRole(admin: User, userId: string, role: unknown) {
  if (role !== 'admin' && role !== 'customer') throw new PortalError('Role is admin or customer');
  if (userId === admin.id && role !== 'admin') throw new PortalError("You can't remove your own admin role");
  if (!(await getUser(userId))) throw new PortalError('No such account', { status: 404 });
  await users().doc(userId).update({ role });
  return (await userDetail(userId)).user;
}

export async function recentJobs(limit = 100) {
  const s = await db.collection('jobs').orderBy('created', 'desc').limit(Math.max(1, Math.min(500, limit))).get();
  const ids = [...new Set(s.docs.map((d) => String(d.get('user_id'))))];
  const people = ids.length ? await db.getAll(...ids.map((u) => users().doc(u))) : [];
  const email = new Map(people.map((p) => [p.id, p.exists ? (p.get('email') as string) : null]));
  return s.docs.filter((d) => email.get(String(d.get('user_id')))).map((d) => ({ id: d.id, ...d.data(), email: email.get(String(d.get('user_id'))) }));
}

export async function purchases(limit = 100) {
  const rows = (await purchaseRows()).slice(0, Math.max(1, Math.min(500, limit)));
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const people = ids.length ? await db.getAll(...ids.map((u) => users().doc(u))) : [];
  const email = new Map(people.map((p) => [p.id, p.exists ? (p.get('email') as string) : null]));
  return rows.filter((r) => email.get(r.user_id)).map((r) => ({ created: r.created, delta: r.delta, detail: r.detail ?? null, stripe_session_id: r.stripe_session_id ?? null, email: email.get(r.user_id), user_id: r.user_id, cents: centsFor(r.delta) }));
}

// ------------------------------------------------------------ routes

route('GET', '/v1/admin/overview', async ({ req }) => { await requireAdmin(req); return overview(); });
route('GET', '/v1/admin/users', async ({ req, url }) => {
  await requireAdmin(req);
  return listUsers({ search: url.searchParams.get('q'), limit: Number(url.searchParams.get('limit')), offset: Number(url.searchParams.get('offset')) });
});
route('GET', '/v1/admin/jobs', async ({ req, url }) => { await requireAdmin(req); return { jobs: await recentJobs(Number(url.searchParams.get('limit')) || 100) }; });
route('GET', '/v1/admin/purchases', async ({ req, url }) => { await requireAdmin(req); return { purchases: await purchases(Number(url.searchParams.get('limit')) || 100) }; });
route('GET', new RegExp(`^/v1/admin/users/(${USER_ID})$`), async ({ req, params }) => { await requireAdmin(req); return userDetail(params[0]); });
route('POST', new RegExp(`^/v1/admin/users/(${USER_ID})/(credits|gift|disable|enable|role|password-link)$`), async ({ req, res, params }) => {
  const admin = await requireAdmin(req);
  const [userId, what] = params;
  const b = json(req);
  if (what === 'credits') return adjustCredits(admin, userId, b.delta, b.note);
  if (what === 'gift') return giftCredits(admin, userId, b.credits, b.message);
  if (what === 'disable' || what === 'enable') return setDisabled(admin, userId, what === 'disable');
  if (what === 'role') return setRole(admin, userId, b.role);
  // Password links: signing in is Google only, so there is no password to set.
  send(res, 410, { error: 'There are no passwords any more: they sign in with Google, with the same email as their account.', code: 'google_only' });
});
