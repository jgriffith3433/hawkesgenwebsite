// What an admin sees and does (/admin): the business at a glance, every account with its ledger and jobs, credit
// adjustments and gifts (with an email), disabling an account, roles, password links. Every change is a ledger row or an audit line.
import { db, tx } from './db.ts';
import { publicUrl } from './config.ts';
import { PACKS } from './billing.ts';
import { sendGift } from './mail.ts';
import { getUser, passwordLink, toPublicUser, type User } from './users.ts';
import { id, PortalError } from './util.ts';

export function requireAdmin(user: User) {
  if (user.role !== 'admin') throw new PortalError('Not found', { status: 404 });
}

const DAY = 24 * 3600_000;
const one = (sql: string, ...args: any[]) => Number(Object.values((db.prepare(sql).get(...args) as Record<string, unknown>) ?? {})[0] ?? 0);
// What a purchase paid, from its pack (credits bought -> the pack's price).
const centsFor = (credits: number) => PACKS.find((p) => p.credits === credits)?.priceCents ?? credits;
const revenueSince = (since: number) => (db.prepare("SELECT delta FROM credit_ledger WHERE kind = 'stripe_purchase' AND created >= ?").all(since) as { delta: number }[]).reduce((n, r) => n + centsFor(r.delta), 0);

export function overview() {
  const now = Date.now();
  return {
    accounts: { total: one('SELECT COUNT(*) FROM users'), new7d: one('SELECT COUNT(*) FROM users WHERE created >= ?', now - 7 * DAY), active7d: one('SELECT COUNT(*) FROM users WHERE last_login >= ?', now - 7 * DAY), disabled: one('SELECT COUNT(*) FROM users WHERE disabled = 1') },
    revenue: { cents30d: revenueSince(now - 30 * DAY), centsAll: revenueSince(0), purchases30d: one("SELECT COUNT(*) FROM credit_ledger WHERE kind = 'stripe_purchase' AND created >= ?", now - 30 * DAY) },
    credits: {
      outstanding: one('SELECT COALESCE(SUM(credits), 0) FROM users'),
      spent30d: one("SELECT COALESCE(SUM(credits), 0) FROM jobs WHERE status = 'done' AND created >= ?", now - 30 * DAY),
      granted30d: one("SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE kind IN ('signup_bonus', 'admin_grant', 'referral_bonus', 'referral_reward') AND delta > 0 AND created >= ?", now - 30 * DAY),
    },
    jobs24h: Object.fromEntries((db.prepare('SELECT status, COUNT(*) AS n FROM jobs WHERE created >= ? GROUP BY status').all(now - DAY) as { status: string; n: number }[]).map((r) => [r.status, r.n])),
  };
}

export function listUsers(q: { search?: string | null; limit?: number; offset?: number }) {
  const where = q.search ? 'WHERE u.email LIKE :s OR u.name LIKE :s OR u.id = :exact' : '';
  const args = q.search ? { s: `%${q.search}%`, exact: q.search } : {};
  const items = db.prepare(`
    SELECT u.id, u.email, u.name, u.credits, u.role, u.disabled, u.created, u.last_login, u.plan, u.sub_status, u.source,
      (SELECT COUNT(*) FROM games g WHERE g.owner_id = u.id) AS games,
      (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id) AS jobs,
      (SELECT COALESCE(SUM(j.credits), 0) FROM jobs j WHERE j.user_id = u.id AND j.status = 'done') AS spent,
      (SELECT COALESCE(SUM(l.delta), 0) FROM credit_ledger l WHERE l.user_id = u.id AND l.kind = 'stripe_purchase') AS bought
    FROM users u ${where} ORDER BY u.created DESC LIMIT ${Math.max(1, Math.min(200, q.limit || 50))} OFFSET ${Math.max(0, q.offset || 0)}`).all(args as any);
  return { items, total: one(`SELECT COUNT(*) FROM users u ${where}`, args) };
}

/** A table's rows, or [] when this database doesn't have it (a module that isn't loaded: the admin page still works). */
const rows = (sql: string, ...args: any[]) => { try { return db.prepare(sql).all(...args) as any[]; } catch { return []; } };
const count = (sql: string, ...args: any[]) => { try { return one(sql, ...args); } catch { return 0; } };

export function userDetail(userId: string) {
  const u = getUser(userId);
  if (!u) throw new PortalError('No such account', { status: 404 });
  const x = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, any>;
  const now = Date.now();
  const referrer = x.referred_by ? getUser(String(x.referred_by)) : null;
  let look: { what?: string; name?: string } | null = null;
  try { const a = x.avatar ? JSON.parse(x.avatar) : null; if (a && typeof a === 'object') look = { what: a.what ? String(a.what) : undefined, name: a.name ? String(a.name) : undefined }; } catch { /* not ours to fix here */ }
  const purchases = rows("SELECT delta, created FROM credit_ledger WHERE user_id = ? AND kind = 'stripe_purchase'", userId);
  return {
    user: {
      ...toPublicUser(u), disabled: Boolean(u.disabled), stripe_customer_id: u.stripe_customer_id,
      sub_status: x.sub_status ?? null, period_end: x.period_end ?? null, cancel_at_period_end: Boolean(x.cancel_at_period_end),
      source: x.source ?? null, google: Boolean(x.google_sub), look,
      referrer: referrer ? { id: referrer.id, email: referrer.email } : null, referral_paid: Boolean(x.referral_paid),
    },
    // What they've done: money, credits, work, what they built and how they connect.
    stats: {
      paidCents: purchases.reduce((n, r) => n + centsFor(r.delta), 0),
      purchases: purchases.length,
      lastPurchase: purchases.reduce((t, r) => Math.max(t, r.created), 0) || null,
      bought: purchases.reduce((n, r) => n + r.delta, 0),
      granted: count("SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE user_id = ? AND delta > 0 AND kind != 'stripe_purchase' AND kind NOT LIKE '%refund%'", userId),
      spent: count("SELECT COALESCE(SUM(credits), 0) FROM jobs WHERE user_id = ? AND status = 'done'", userId),
      spent30d: count("SELECT COALESCE(SUM(credits), 0) FROM jobs WHERE user_id = ? AND status = 'done' AND created >= ?", userId, now - 30 * DAY),
      jobs: count('SELECT COUNT(*) FROM jobs WHERE user_id = ?', userId),
      failed: count("SELECT COUNT(*) FROM jobs WHERE user_id = ? AND status IN ('failed', 'cancelled')", userId),
      lastJob: count('SELECT COALESCE(MAX(created), 0) FROM jobs WHERE user_id = ?', userId) || null,
      sessions: count('SELECT COUNT(*) FROM sessions WHERE user_id = ? AND expires > ?', userId, now),
      invited: count('SELECT COUNT(*) FROM users WHERE referred_by = ?', userId),
      invitedBought: count('SELECT COUNT(*) FROM users WHERE referred_by = ? AND referral_paid = 1', userId),
      memberOf: count('SELECT COUNT(*) FROM game_members WHERE user_id = ?', userId),
      friends: count('SELECT COUNT(*) FROM friends WHERE user_id = ?', userId),
      shared: count('SELECT COUNT(*) FROM community_assets WHERE by_user = ?', userId),
      shareLinks: count('SELECT COUNT(*) FROM shares WHERE user_id = ?', userId),
    },
    tools: rows('SELECT tool, COUNT(*) AS n, COALESCE(SUM(credits), 0) AS credits FROM jobs WHERE user_id = ? GROUP BY tool ORDER BY n DESC LIMIT 6', userId),
    games: rows('SELECT id, slug, title, visibility, plays, created, updated, hidden FROM games WHERE owner_id = ? ORDER BY updated DESC LIMIT 20', userId),
    keys: rows('SELECT prefix, created, last_used, disabled FROM api_keys WHERE user_id = ? ORDER BY created DESC LIMIT 10', userId),
    connections: rows('SELECT name, daily_cap, created, last_used, revoked FROM connections WHERE user_id = ? ORDER BY created DESC LIMIT 10', userId),
    key: db.prepare('SELECT prefix, created, last_used FROM api_keys WHERE user_id = ? AND disabled = 0 ORDER BY created DESC LIMIT 1').get(userId) ?? null,
    ledger: db.prepare('SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY created DESC, rowid DESC LIMIT 200').all(userId),
    jobs: db.prepare('SELECT * FROM jobs WHERE user_id = ? ORDER BY created DESC LIMIT 100').all(userId),
  };
}

/** Adds (or, negative, takes) credits, with a note naming the admin. A balance never goes below zero. */
export function adjustCredits(admin: User, userId: string, delta: unknown, note: unknown) {
  const n = Math.round(Number(delta));
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 1_000_000) throw new PortalError('Credits: a whole number, not zero');
  const why = String(note ?? '').trim().slice(0, 200);
  if (!why) throw new PortalError('Say why (it goes in their ledger)');
  return tx(() => {
    const u = getUser(userId);
    if (!u) throw new PortalError('No such account', { status: 404 });
    const balance = u.credits + n;
    if (balance < 0) throw new PortalError(`They have ${u.credits} credits; can't take ${-n}`);
    db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(balance, userId);
    db.prepare('INSERT INTO credit_ledger (id, user_id, delta, balance_after, kind, detail, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id('tx_', 6), userId, n, balance, n > 0 ? 'admin_grant' : 'admin_debit', `${why} (by ${admin.email})`, Date.now());
    return { credits: balance };
  });
}

/** A gift: credits added (in their ledger as a gift, with the admin's message) and an email telling them. */
export function giftCredits(admin: User, userId: string, credits: unknown, message: unknown) {
  const n = Math.round(Number(credits));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) throw new PortalError('Gift: a whole number of credits, more than zero');
  const note = String(message ?? '').trim().slice(0, 500);
  const r = adjustCredits(admin, userId, n, note ? `Gift: ${note.slice(0, 180)}` : 'Gift');
  const u = getUser(userId)!;
  const emailed = sendGift(u.email, u.name, n, r.credits, note);
  return { ...r, emailed };
}

export function setDisabled(admin: User, userId: string, disabled: boolean) {
  if (userId === admin.id) throw new PortalError("You can't disable your own account");
  if (!getUser(userId)) throw new PortalError('No such account', { status: 404 });
  tx(() => {
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, userId);
    if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  });
  return userDetail(userId).user;
}

export function setRole(admin: User, userId: string, role: unknown) {
  if (role !== 'admin' && role !== 'customer') throw new PortalError('Role is admin or customer');
  if (userId === admin.id && role !== 'admin') throw new PortalError("You can't remove your own admin role");
  if (!getUser(userId)) throw new PortalError('No such account', { status: 404 });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  return userDetail(userId).user;
}

export const resetLink = (userId: string) => {
  if (!getUser(userId)) throw new PortalError('No such account', { status: 404 });
  return { url: passwordLink(userId, publicUrl()), expiresInHours: 24 };
};

export function recentJobs(limit = 100) {
  return db.prepare(`SELECT j.*, u.email FROM jobs j JOIN users u ON u.id = j.user_id ORDER BY j.created DESC LIMIT ${Math.max(1, Math.min(500, limit))}`).all();
}

export function purchases(limit = 100) {
  return (db.prepare(`SELECT l.created, l.delta, l.detail, l.stripe_session_id, u.email, u.id AS user_id FROM credit_ledger l JOIN users u ON u.id = l.user_id WHERE l.kind = 'stripe_purchase' ORDER BY l.created DESC LIMIT ${Math.max(1, Math.min(500, limit))}`).all() as any[])
    .map((r) => ({ ...r, cents: centsFor(r.delta) }));
}
