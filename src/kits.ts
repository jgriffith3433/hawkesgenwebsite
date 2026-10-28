// Shared kits (J, 2026-10-27: "kits you save and share"): a few things with their abilities, laid out round a spot, that
// a builder saves from their world and anyone can drop into theirs from the spawn wheel (🎲 Play kits > Shared). A kit is
// data (the things' specs, relative to its middle, and the world settings it needs), kept here, not in Gen: nothing to
// pay for. Listing is public; sharing needs an account; the sharer (or an admin) takes one back.
import { db } from './db.ts';
import { id, PortalError } from './util.ts';
import { getUser, type User } from './users.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS community_kits (
  id TEXT PRIMARY KEY,           -- k_...
  by_user TEXT NOT NULL,
  title TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '📦',
  things TEXT NOT NULL,          -- JSON: the specs, positions relative to the kit's middle (y from its floor)
  config TEXT,                   -- JSON: world settings it needs (a match, factions...), or null
  uses INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS community_kits_uses ON community_kits (hidden, uses);
`);

type Row = { id: string; by_user: string; title: string; about: string; icon: string; things: string; config: string | null; uses: number; created: number; hidden: number };
const MAX_THINGS = 120;
const MAX_BYTES = 60_000;
const MAX_CONFIG = 8_000;
const TYPE_RE = /^[a-z][a-z0-9-]{0,40}$/;

function view(r: Row, full = false) {
  const out: Record<string, unknown> = { id: r.id, title: r.title, about: r.about, icon: r.icon, by: getUser(r.by_user)?.name ?? 'Someone', uses: r.uses, created: r.created, count: (JSON.parse(r.things) as unknown[]).length };
  if (full) { out.things = JSON.parse(r.things); out.config = r.config ? JSON.parse(r.config) : null; }
  return out;
}

/** The things, made sound: objects with a type, no ids, positions kept, at most MAX_THINGS and MAX_BYTES. */
function cleanThings(v: unknown) {
  if (!Array.isArray(v) || !v.length) throw new PortalError('A kit needs things');
  if (v.length > MAX_THINGS) throw new PortalError(`A kit holds at most ${MAX_THINGS} things`);
  const out = v.map((s: any) => {
    if (!s || typeof s !== 'object' || Array.isArray(s) || typeof s.type !== 'string' || !TYPE_RE.test(s.type)) throw new PortalError('Each thing in a kit has a type');
    const c = JSON.parse(JSON.stringify(s));
    delete c.id; delete c.parent;
    return c;
  });
  if (JSON.stringify(out).length > MAX_BYTES) throw new PortalError('That kit is too big to share (fewer or simpler things)');
  return out;
}
function cleanConfig(v: unknown) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new PortalError('config is an object');
  const s = JSON.stringify(v);
  if (s.length > MAX_CONFIG) throw new PortalError('Its world settings are too big to share');
  return s;
}

/** A builder shares a kit. */
export function share(user: User, body: { title?: unknown; about?: unknown; icon?: unknown; things?: unknown; config?: unknown }) {
  const title = String(body.title ?? '').trim().slice(0, 60);
  if (!title) throw new PortalError('Give the kit a name');
  const things = cleanThings(body.things);
  const icon = [...String(body.icon ?? '📦').trim()].slice(0, 2).join('') || '📦';
  const row: Row = { id: id('k_', 8), by_user: user.id, title, about: String(body.about ?? '').trim().slice(0, 200), icon, things: JSON.stringify(things), config: cleanConfig(body.config), uses: 0, created: Date.now(), hidden: 0 };
  const mine = (db.prepare('SELECT COUNT(*) AS n FROM community_kits WHERE by_user = ? AND hidden = 0').get(user.id) as { n: number }).n;
  if (mine >= 200) throw new PortalError('You have shared 200 kits: take some back first', { status: 429 });
  db.prepare('INSERT INTO community_kits (id, by_user, title, about, icon, things, config, uses, created, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0)')
    .run(row.id, row.by_user, row.title, row.about, row.icon, row.things, row.config, row.created);
  return view(row, true);
}

/** Public: the kits, most used first (or newest), found by words. With full, each kit's things too (the spawn wheel). */
export function list(o: { q?: string | null; sort?: string | null; limit?: unknown; full?: boolean } = {}) {
  const limit = Math.max(1, Math.min(60, Number(o.limit) || 30));
  const words = String(o.q ?? '').toLowerCase().split(/\W+/).filter((w) => w.length > 1).slice(0, 6);
  const order = o.sort === 'new' ? 'created DESC' : 'uses DESC, created DESC';
  let rows = db.prepare(`SELECT * FROM community_kits WHERE hidden = 0 ORDER BY ${order} LIMIT 400`).all() as Row[];
  if (words.length) rows = rows.filter((r) => words.every((w) => `${r.title} ${r.about}`.toLowerCase().includes(w)));
  return { kits: rows.slice(0, limit).map((r) => view(r, Boolean(o.full))) };
}

/** Public: one kit with its things. */
export function get(kitId: string) {
  const r = db.prepare('SELECT * FROM community_kits WHERE id = ? AND hidden = 0').get(kitId) as Row | undefined;
  if (!r) throw new PortalError('That kit is no longer shared', { status: 404 });
  return view(r, true);
}

/** Someone dropped it into a world (counted once a call; it orders the list). */
export function used(kitId: string) {
  db.prepare('UPDATE community_kits SET uses = uses + 1 WHERE id = ? AND hidden = 0').run(kitId);
  return { ok: true };
}

/** The sharer (or an admin) takes it back. */
export function unshare(user: User, kitId: string) {
  const r = db.prepare('SELECT * FROM community_kits WHERE id = ?').get(kitId) as Row | undefined;
  if (!r || (r.by_user !== user.id && user.role !== 'admin')) throw new PortalError('Not one of yours', { status: 404 });
  db.prepare('UPDATE community_kits SET hidden = 1 WHERE id = ?').run(kitId);
  return { ok: true };
}

/** The kits a builder has shared. */
export function mine(user: User) {
  return { kits: (db.prepare('SELECT * FROM community_kits WHERE by_user = ? AND hidden = 0 ORDER BY created DESC').all(user.id) as Row[]).map((r) => view(r)) };
}
