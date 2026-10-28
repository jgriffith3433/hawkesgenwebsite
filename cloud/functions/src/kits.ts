// Shared kits (src/kits.ts on the old server): a few things with their abilities, laid out round a spot, that a builder
// saves from their world and anyone can drop into theirs. A kit is data, kept here, not in Gen: nothing to pay for.
// Listing is public (open CORS: the play sandbox); sharing needs an account; the sharer (or an admin) takes one back.
//
// Firestore: communityKits/{k_id} with the SQLite columns. `things` and `config` stay JSON strings, as they were: a
// thing's spec may hold arrays of arrays (points, paths), which Firestore can't store as values.
import { db, users } from './store.ts';
import { requireUser, type User } from './accounts.ts';
import { id, PortalError, route } from './http.ts';

type Row = { id: string; by_user: string; title: string; about: string; icon: string; things: string; config: string | null; uses: number; created: number; hidden: number };
const kits = () => db.collection('communityKits');
const MAX_THINGS = 120;
const MAX_BYTES = 60_000;
const MAX_CONFIG = 8_000;
const TYPE_RE = /^[a-z][a-z0-9-]{0,40}$/;
const rowOf = (d: FirebaseFirestore.DocumentSnapshot): Row => ({ id: d.id, ...(d.data() as Omit<Row, 'id'>) });

async function names(rows: Row[]) {
  const ids = [...new Set(rows.map((r) => r.by_user))];
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 300) for (const s of await db.getAll(...ids.slice(i, i + 300).map((u) => users().doc(u)))) out.set(s.id, s.exists ? (s.get('name') ?? null) : null);
  return out;
}
async function views(rows: Row[], full = false) {
  const n = await names(rows);
  return rows.map((r) => {
    const out: Record<string, unknown> = { id: r.id, title: r.title, about: r.about, icon: r.icon, by: n.get(r.by_user) ?? 'Someone', uses: r.uses, created: r.created, count: (JSON.parse(r.things) as unknown[]).length };
    if (full) { out.things = JSON.parse(r.things); out.config = r.config ? JSON.parse(r.config) : null; }
    return out;
  });
}

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
export async function share(user: User, body: { title?: unknown; about?: unknown; icon?: unknown; things?: unknown; config?: unknown }) {
  const title = String(body.title ?? '').trim().slice(0, 60);
  if (!title) throw new PortalError('Give the kit a name');
  const things = cleanThings(body.things);
  const icon = [...String(body.icon ?? '📦').trim()].slice(0, 2).join('') || '📦';
  const row: Row = { id: id('k_', 8), by_user: user.id, title, about: String(body.about ?? '').trim().slice(0, 200), icon, things: JSON.stringify(things), config: cleanConfig(body.config), uses: 0, created: Date.now(), hidden: 0 };
  const mineCount = (await kits().where('by_user', '==', user.id).where('hidden', '==', 0).count().get()).data().count;
  if (mineCount >= 200) throw new PortalError('You have shared 200 kits: take some back first', { status: 429 });
  const { id: kitId, ...doc } = row;
  await kits().doc(kitId).create(doc);
  return (await views([row], true))[0];
}

/** Public: the kits, most used first (or newest), found by words. With full, each kit's things too. */
export async function list(o: { q?: string | null; sort?: string | null; limit?: unknown; full?: boolean } = {}) {
  const limit = Math.max(1, Math.min(60, Number(o.limit) || 30));
  const words = String(o.q ?? '').toLowerCase().split(/\W+/).filter((w) => w.length > 1).slice(0, 6);
  const q = kits().where('hidden', '==', 0);
  let rows = (await (o.sort === 'new' ? q.orderBy('created', 'desc') : q.orderBy('uses', 'desc').orderBy('created', 'desc')).limit(400).get()).docs.map(rowOf);
  if (words.length) rows = rows.filter((r) => words.every((w) => `${r.title} ${r.about}`.toLowerCase().includes(w)));
  return { kits: await views(rows.slice(0, limit), Boolean(o.full)) };
}

/** Public: one kit with its things. */
export async function get(kitId: string) {
  const s = await kits().doc(kitId).get();
  if (!s.exists || s.get('hidden')) throw new PortalError('That kit is no longer shared', { status: 404 });
  return (await views([rowOf(s)], true))[0];
}

/** Someone dropped it into a world (counted once a call; it orders the list). */
export async function used(kitId: string) {
  await db.runTransaction(async (t) => {
    const s = await t.get(kits().doc(kitId));
    if (s.exists && !s.get('hidden')) t.update(s.ref, { uses: Number(s.get('uses') ?? 0) + 1 });
  });
  return { ok: true };
}

/** The sharer (or an admin) takes it back. */
export async function unshare(user: User, kitId: string) {
  const s = await kits().doc(kitId).get();
  if (!s.exists || (s.get('by_user') !== user.id && user.role !== 'admin')) throw new PortalError('Not one of yours', { status: 404 });
  await s.ref.update({ hidden: 1 });
  return { ok: true };
}

/** The kits a builder has shared. */
export async function mine(user: User) {
  const s = await kits().where('by_user', '==', user.id).where('hidden', '==', 0).orderBy('created', 'desc').get();
  return { kits: await views(s.docs.map(rowOf)) };
}

const open = (res: any) => void res.set('Access-Control-Allow-Origin', '*');
route('GET', '/v1/community/kits', async ({ res, url }) => { open(res); const q = url.searchParams; return list({ q: q.get('q'), sort: q.get('sort'), limit: q.get('limit'), full: q.get('full') === '1' }); });
route('GET', '/v1/community/kits/mine', async ({ req }) => mine(await requireUser(req)));
route('POST', '/v1/community/kits', async ({ req }) => share(await requireUser(req), (req.body ?? {}) as any));
route('GET', /^\/v1\/community\/kits\/(k_[0-9a-f]+)$/, async ({ res, params }) => { open(res); return get(params[0]); });
route('POST', /^\/v1\/community\/kits\/(k_[0-9a-f]+)\/used$/, async ({ res, params }) => { open(res); return used(params[0]); });
route('DELETE', /^\/v1\/community\/kits\/(k_[0-9a-f]+)$/, async ({ req, params }) => unshare(await requireUser(req), params[0]));
