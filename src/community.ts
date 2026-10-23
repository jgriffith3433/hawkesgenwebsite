// The community library: things anyone building a game can use. Hawkes' starter pack (made from community/starter.mjs
// into the starter project, picked up here by syncStarter) and whatever players share from their own library. A row
// only points at the asset in its owner's Gen project; using one puts that same asset in a game (games.ts addAsset with
// the owner's project), so nothing is copied and nothing is paid twice. Only rows marked community are ever listed.
import { db } from './db.ts';
import { gen, genFetch } from './gen.ts';
import { addAsset, freeName, memberGame } from './games.ts';
import { getUser, type User } from './users.ts';
import { PortalError } from './util.ts';

/**
 * The Gen project Hawkes' own starter pack lives in. The same one for every copy of the portal (a beta portal with its
 * own PORTAL_PROJECT_PREFIX reads it too: its Gen key lists this project as well).
 */
export const STARTER_PROJECT = 'usr_00000000000000c0';
/** What a community thing can be (search filters, the assistant's kinds). */
export const COMMUNITY_KINDS = ['model', 'texture', 'image', 'sprite', 'sky', 'music', 'ambience', 'sfx', 'voice', 'video'] as const;

db.exec(`
CREATE TABLE IF NOT EXISTS community_assets (
  id TEXT PRIMARY KEY,          -- the Gen asset (a_...)
  project TEXT NOT NULL,        -- the Gen project it lives in (its owner's)
  kind TEXT NOT NULL,
  mime TEXT,
  title TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',-- lowercase words, space separated
  low TEXT,                     -- a model's low-detail copy (a_...), same project
  thumb TEXT,                   -- a picture of it (a_...), same project
  by_user TEXT,                 -- who shared it (null: Hawkes' starter pack)
  source TEXT NOT NULL,         -- 'starter' or 'player'
  uses INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS community_kind ON community_assets (kind, uses);
-- Who used what: a thing's likes are the other accounts that put it in a game (once each; never its own sharer).
CREATE TABLE IF NOT EXISTS community_uses (
  asset TEXT NOT NULL,
  user_id TEXT NOT NULL,
  game_id TEXT,
  created INTEGER NOT NULL,
  PRIMARY KEY (asset, user_id)
);
`);
{
  const cols = new Set((db.prepare('PRAGMA table_info(community_assets)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('likes')) db.exec('ALTER TABLE community_assets ADD COLUMN likes INTEGER NOT NULL DEFAULT 0');
  // category: one browsing shelf per kind (props, nature, ui...), kept apart from the search words in tags.
  if (!cols.has('category')) db.exec("ALTER TABLE community_assets ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  // item: a starter pack thing's stable name (kind/slug): a remade one replaces the row it had, never a second copy.
  if (!cols.has('item')) db.exec('ALTER TABLE community_assets ADD COLUMN item TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS community_item ON community_assets (item)');
}

type Row = { id: string; project: string; kind: string; mime: string | null; title: string; tags: string; category: string; item: string | null; low: string | null; thumb: string | null; by_user: string | null; source: string; uses: number; likes: number; created: number; hidden: number };

const words = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s-]+/g, ' ').split(/[\s-]+/).filter((w) => w.length > 1);
/** A category is one lowercase word or two (letters, digits, dashes). */
const cleanCategory = (c: unknown) => String(c ?? '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
const cleanTags = (t: unknown) => [...new Set((Array.isArray(t) ? t.join(' ') : String(t ?? '')).toLowerCase().split(/[\s,]+/).map((w) => w.replace(/[^a-z0-9-]/g, '')).filter(Boolean))].slice(0, 16).join(' ');

/** What the client sees of a row. Files come through /v1/community/<id>/file (and the thumb's own id). */
export function view(r: Row) {
  const file = (id: string | null) => (id ? `/v1/community/${id}/file` : null);
  return { id: r.id, kind: r.kind, mime: r.mime, title: r.title, category: r.category || null, tags: r.tags ? r.tags.split(' ') : [], file: file(r.id), thumb: file(r.thumb ?? (['texture', 'image', 'sprite', 'sky'].includes(r.kind) ? r.id : null)), low: Boolean(r.low), by: r.by_user ? getUser(r.by_user)?.name ?? 'A player' : 'Hawkes', source: r.source, uses: r.uses, likes: r.likes ?? 0, created: r.created };
}

/** Kinds that answer for a kind (a sound effect could be an ambience loop, an image could be a sprite). */
const RELATED: Record<string, string[]> = { image: ['image', 'sprite', 'texture'], sprite: ['sprite', 'image'], sfx: ['sfx', 'ambience'], ambience: ['ambience', 'sfx'] };

/**
 * Searches the community library: how well it matches (tags and title words), then the order asked for: 'liked' (most
 * other people used it, the default), 'new', or 'fresh' (the least used first, for a game that doesn't look like
 * every other one).
 */
export function search(o: { q?: unknown; kind?: unknown; tag?: unknown; category?: unknown; limit?: unknown; offset?: unknown; sort?: unknown; exact?: unknown } = {}) {
  const sort = ['new', 'fresh', 'name'].includes(String(o.sort)) ? String(o.sort) : 'liked';
  const kind = String(o.kind ?? '');
  // exact: only this kind (the library page's filter); otherwise kinds that answer for it too (the assistant's search).
  const kinds = kind ? (o.exact ? [kind] : RELATED[kind] ?? [kind]) : null;
  const tag = String(o.tag ?? '').toLowerCase();
  const category = cleanCategory(o.category);
  const q = words(o.q);
  const limit = Math.max(1, Math.min(120, Number(o.limit) || 40));
  const offset = Math.max(0, Number(o.offset) || 0);
  const rows = (kinds
    ? db.prepare(`SELECT * FROM community_assets WHERE hidden = 0 AND kind IN (${kinds.map(() => '?').join(',')})`).all(...kinds)
    : db.prepare('SELECT * FROM community_assets WHERE hidden = 0').all()) as Row[];
  const scored = rows
    .filter((r) => (!category || r.category === category) && (!tag || r.category === tag || r.tags.split(' ').includes(tag)))
    .map((r) => {
      const tags = [...r.tags.split(' '), ...(r.category ? [r.category] : [])];
      const title = words(r.title);
      let s = 0;
      for (const w of q) {
        if (tags.includes(w) || title.includes(w)) s += 3;
        else if (tags.some((t) => t.startsWith(w) || w.startsWith(t)) || title.some((t) => t.startsWith(w) || (t.length > 3 && w.startsWith(t)))) s += 1;
      }
      if (kinds && r.kind === kind) s += 0.5;
      return { r, s };
    })
    .filter((x) => !q.length || x.s >= 1)
    .sort((a, b) => Math.round(b.s) - Math.round(a.s) || (sort === 'new' ? b.r.created - a.r.created : sort === 'fresh' ? a.r.likes - b.r.likes || b.r.created - a.r.created : sort === 'name' ? a.r.title.localeCompare(b.r.title) : b.r.likes - a.r.likes || b.r.uses - a.r.uses) || b.s - a.s);
  return { items: scored.slice(offset, offset + limit).map((x) => view(x.r)), total: scored.length };
}

/** The shelves: every kind with its categories and how many things each has (the library page's browsing). */
export function categories() {
  const rows = db.prepare("SELECT kind, category, COUNT(*) AS n FROM community_assets WHERE hidden = 0 GROUP BY kind, category ORDER BY kind, n DESC, category").all() as { kind: string; category: string; n: number }[];
  const kinds: Record<string, { count: number; categories: { category: string; count: number }[] }> = {};
  for (const r of rows) {
    const k = (kinds[r.kind] ??= { count: 0, categories: [] });
    k.count += r.n;
    if (r.category) k.categories.push({ category: r.category, count: r.n });
  }
  return { kinds: COMMUNITY_KINDS.filter((k) => kinds[k]).map((k) => ({ kind: k, ...kinds[k] })), total: rows.reduce((s, r) => s + r.n, 0) };
}

/** The tags in use, with how many things each has (for browsing). */
export function tagCounts(kind?: string) {
  const rows = (kind ? db.prepare('SELECT tags FROM community_assets WHERE hidden = 0 AND kind = ?').all(kind) : db.prepare('SELECT tags FROM community_assets WHERE hidden = 0').all()) as { tags: string }[];
  const n = new Map<string, number>();
  for (const r of rows) for (const t of r.tags.split(' ').filter(Boolean)) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([tag, count]) => ({ tag, count }));
}

const KIND_OF_GEN: Record<string, string> = { mesh: 'model', image: 'image', audio: 'sfx', video: 'video' };

/** A player shares one of their own things with everyone (or updates its title and tags). */
export async function share(user: User, body: { asset?: unknown; title?: unknown; tags?: unknown; category?: unknown; kind?: unknown; low?: unknown; thumb?: unknown }) {
  const id = String(body.asset ?? '').replace(/^asset:/, '');
  if (!/^a_[0-9a-f]+$/.test(id)) throw new PortalError('asset is "asset:a_..." from your library');
  const a: any = await gen(`/v1/assets/${id}`, { as: user.project }).catch(() => null);
  if (!a?.id) throw new PortalError('That asset is not in your library', { status: 404 });
  const own = async (x: unknown) => {
    const v = String(x ?? '').replace(/^asset:/, '');
    if (!/^a_[0-9a-f]+$/.test(v)) return null;
    return (await gen(`/v1/assets/${v}`, { as: user.project }).catch(() => null))?.id ? v : null;
  };
  const kind = COMMUNITY_KINDS.includes(String(body.kind) as any) ? String(body.kind) : KIND_OF_GEN[a.kind] ?? 'image';
  const title = String(body.title ?? a.title ?? '').trim().slice(0, 80) || 'Untitled';
  const tags = cleanTags(body.tags) || words(title).join(' ');
  const was = db.prepare('SELECT * FROM community_assets WHERE id = ?').get(id) as Row | undefined;
  if (was && was.by_user !== user.id) throw new PortalError('Someone else shared that one', { status: 403 });
  db.prepare(`INSERT INTO community_assets (id, project, kind, mime, title, tags, category, low, thumb, by_user, source, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'player', ?)
              ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, title = excluded.title, tags = excluded.tags, category = excluded.category, low = excluded.low, thumb = excluded.thumb, hidden = 0`)
    .run(id, user.project, kind, a.mime ?? null, title, tags, cleanCategory(body.category), await own(body.low), await own(body.thumb), user.id, Date.now());
  return view(db.prepare('SELECT * FROM community_assets WHERE id = ?').get(id) as Row);
}

/** Stops sharing (games that already use it keep it). */
export function unshare(user: User, id: string) {
  const r = db.prepare('SELECT * FROM community_assets WHERE id = ?').get(id) as Row | undefined;
  if (!r || (r.by_user !== user.id && user.role !== 'admin')) throw new PortalError('Not one of yours', { status: 404 });
  db.prepare('UPDATE community_assets SET hidden = 1 WHERE id = ?').run(id);
  return { ok: true };
}

/** What the player has shared. */
export function mine(user: User) {
  return { items: (db.prepare('SELECT * FROM community_assets WHERE by_user = ? AND hidden = 0 ORDER BY created DESC').all(user.id) as Row[]).map(view) };
}

/** Puts a community thing in a game, under the name its scripts use (and a model's low-detail copy beside it). */
export async function useInGame(user: User, gameId: string, body: { id?: unknown; name?: unknown }) {
  memberGame(user, gameId);
  const r = db.prepare('SELECT * FROM community_assets WHERE id = ? AND hidden = 0').get(String(body.id ?? '')) as Row | undefined;
  if (!r) throw new PortalError('That is no longer in the community library', { status: 404 });
  const existing = db.prepare('SELECT * FROM game_assets WHERE game_id = ? AND asset = ?').get(gameId, r.id) as any;
  if (existing && !body.name) return { asset: existing, item: view(r) };
  const want = String(body.name ?? '').trim() || r.title;
  const row = await addAsset(user, gameId, { asset: r.id, name: freeName(gameId, want, r.mime) }, { project: r.project });
  if (r.low && row.name.endsWith('.glb')) await addAsset(user, gameId, { asset: r.low, name: row.name.replace(/\.glb$/, '_low.glb') }, { project: r.project }).catch(() => null);
  db.prepare('UPDATE community_assets SET uses = uses + 1 WHERE id = ?').run(r.id);
  // A like: someone else (once per account) found it good enough to use.
  if (r.by_user !== user.id && db.prepare('INSERT OR IGNORE INTO community_uses (asset, user_id, game_id, created) VALUES (?, ?, ?, ?)').run(r.id, user.id, gameId, Date.now()).changes)
    db.prepare('UPDATE community_assets SET likes = likes + 1 WHERE id = ?').run(r.id);
  return { asset: row, item: view(r) };
}

/** Streams a community file (a listed thing, its thumb or low copy), from its owner's project. */
export async function file(id: string) {
  const r = db.prepare('SELECT project FROM community_assets WHERE hidden = 0 AND (id = ? OR thumb = ? OR low = ?)').get(id, id, id) as { project: string } | undefined;
  if (!r) throw new PortalError('No such file', { status: 404 });
  return genFetch(`/v1/assets/${id}/file`, { as: r.project, signal: AbortSignal.timeout(120_000) });
}

/** The files a starter job saved under `name` (a step's one output is `name`, several are `name.<title>`). */
const saved = (outs: any[], name: string) => outs.filter((o) => { const t = String(o.title ?? ''); return t === name || t.startsWith(`${name}.`); });
const MIME_OF: Record<string, RegExp> = { model: /^model\/gltf-binary$/, texture: /^image\//, image: /^image\//, sprite: /^image\//, sky: /^image\//, music: /^audio\//, ambience: /^audio\//, sfx: /^audio\//, voice: /^audio\//, video: /^video\// };

/** One finished starter job's files as a library row: the main file, a model's low copy, a picture of it. Null: not usable. */
export function starterRow(outs: any[]) {
  const l = outs[0]?.labels ?? {};
  const kind = String(l.kind ?? '');
  if (!COMMUNITY_KINDS.includes(kind as any)) return null;
  let main: any = null;
  let low: any = null;
  let thumb: any = null;
  if (kind === 'model') {
    // The last step exports the model (model.high) and its lower-detail copy (model.lod1): the biggest GLB is the model.
    const glbs = saved(outs, 'model').filter((o) => MIME_OF.model.test(o.mime ?? '')).sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
    [main, low] = [glbs[0] ?? null, glbs.length > 1 ? glbs[glbs.length - 1] : null];
    thumb = saved(outs, 'cutout')[0] ?? saved(outs, 'front')[0] ?? null;
  } else {
    main = saved(outs, kind).find((o) => MIME_OF[kind].test(o.mime ?? '')) ?? null;
  }
  if (!main) return null;
  const name = String(l.name ?? main.title ?? kind).trim().slice(0, 80) || kind;
  return { main, low, thumb, kind, name, category: cleanCategory(l.tag), tags: cleanTags(l.tags ?? l.tag), item: `${kind}/${String(l.item ?? name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}` };
}

/**
 * Picks up the starter pack: every file a finished asset.make job in the starter project saved with the labels
 * pack=starter (tools/starter.mjs), page by page so none is missed however big the pack gets. One row per thing
 * (kind and name): a remade one replaces the old row, which is hidden (games that use it keep their copy).
 */
export async function syncStarter() {
  const PAGE = 500;
  const all: any[] = [];
  for (let offset = 0; offset < 100_000; offset += PAGE) {
    const r: any = await gen(`/v1/assets?project=${STARTER_PROJECT}&tool=asset.make&q=starter&limit=${PAGE}&offset=${offset}`, { as: STARTER_PROJECT });
    const page = r.items ?? [];
    all.push(...page);
    if (page.length < PAGE) break;
  }
  const byJob = new Map<string, any[]>();
  for (const a of all) {
    if (a.labels?.pack !== 'starter' || a.labels?.community === false || !a.job) continue;
    byJob.set(a.job, [...(byJob.get(a.job) ?? []), a]);
  }
  // The newest finished job wins for each thing.
  const best = new Map<string, NonNullable<ReturnType<typeof starterRow>> & { at: number }>();
  let unusable = 0;
  for (const outs of byJob.values()) {
    const row = starterRow(outs);
    if (!row) { unusable++; continue; }
    const at = Math.max(...outs.map((o) => Number(o.created) || 0));
    if ((best.get(row.item)?.at ?? -1) < at) best.set(row.item, { ...row, at });
  }
  let added = 0;
  const put = db.prepare(`INSERT INTO community_assets (id, project, kind, mime, title, tags, category, item, low, thumb, by_user, source, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'starter', ?)
              ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, title = excluded.title, tags = excluded.tags, category = excluded.category, item = excluded.item, low = excluded.low, thumb = excluded.thumb`);
  // (A row an admin hid stays hidden: the sync never brings it back.)
  const retire = db.prepare("UPDATE community_assets SET hidden = 1 WHERE source = 'starter' AND item = ? AND id != ? AND hidden = 0");
  for (const r of best.values()) {
    const before = db.prepare('SELECT 1 FROM community_assets WHERE id = ?').get(r.main.id);
    put.run(r.main.id, STARTER_PROJECT, r.kind, r.main.mime ?? null, r.name, r.tags, r.category, r.item, r.low?.id ?? null, r.thumb?.id ?? null, Date.now());
    retire.run(r.item, r.main.id);
    if (!before) added++;
  }
  return { jobs: byJob.size, things: best.size, added, unusable };
}

/** Keeps the starter pack current (at start, then every few minutes); a Gen hiccup just waits for the next round. */
export function watchStarter(everyMs = 10 * 60_000) {
  const run = () => void syncStarter().catch((e) => console.warn('[portal] starter pack:', e.message));
  run();
  const t = setInterval(run, everyMs);
  t.unref();
  return () => clearInterval(t);
}
