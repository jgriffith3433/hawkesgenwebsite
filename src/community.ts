// The community library: things anyone building a game can use. Hawkes' starter pack (made from community/starter.mjs
// into the starter project, picked up here by syncStarter) and whatever players share from their own library. A row
// only points at the asset in its owner's Gen project; using one puts that same asset in a game (games.ts addAsset with
// the owner's project), so nothing is copied and nothing is paid twice. Only rows marked community are ever listed.
import { db } from './db.ts';
import { gen, genFetch } from './gen.ts';
import { addAsset, freeName, memberGame } from './games.ts';
import { getUser, type User } from './users.ts';
import { PortalError } from './util.ts';

/** The Gen project Hawkes' own starter pack lives in. */
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
if (!(db.prepare('PRAGMA table_info(community_assets)').all() as { name: string }[]).some((c) => c.name === 'likes')) db.exec('ALTER TABLE community_assets ADD COLUMN likes INTEGER NOT NULL DEFAULT 0');

type Row = { id: string; project: string; kind: string; mime: string | null; title: string; tags: string; low: string | null; thumb: string | null; by_user: string | null; source: string; uses: number; likes: number; created: number; hidden: number };

const words = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s-]+/g, ' ').split(/[\s-]+/).filter((w) => w.length > 1);
const cleanTags = (t: unknown) => [...new Set((Array.isArray(t) ? t.join(' ') : String(t ?? '')).toLowerCase().split(/[\s,]+/).map((w) => w.replace(/[^a-z0-9-]/g, '')).filter(Boolean))].slice(0, 16).join(' ');

/** What the client sees of a row. Files come through /v1/community/<id>/file (and the thumb's own id). */
export function view(r: Row) {
  const file = (id: string | null) => (id ? `/v1/community/${id}/file` : null);
  return { id: r.id, kind: r.kind, mime: r.mime, title: r.title, tags: r.tags ? r.tags.split(' ') : [], file: file(r.id), thumb: file(r.thumb ?? (['texture', 'image', 'sprite', 'sky'].includes(r.kind) ? r.id : null)), low: Boolean(r.low), by: r.by_user ? getUser(r.by_user)?.name ?? 'A player' : 'Hawkes', source: r.source, uses: r.uses, likes: r.likes ?? 0, created: r.created };
}

/** Kinds that answer for a kind (a sound effect could be an ambience loop, an image could be a sprite). */
const RELATED: Record<string, string[]> = { image: ['image', 'sprite', 'texture'], sprite: ['sprite', 'image'], sfx: ['sfx', 'ambience'], ambience: ['ambience', 'sfx'] };

/**
 * Searches the community library: how well it matches (tags and title words), then the order asked for: 'liked' (most
 * other people used it, the default), 'new', or 'fresh' (the least used first, for a game that doesn't look like
 * every other one).
 */
export function search(o: { q?: unknown; kind?: unknown; tag?: unknown; limit?: unknown; sort?: unknown } = {}) {
  const sort = ['new', 'fresh'].includes(String(o.sort)) ? String(o.sort) : 'liked';
  const kind = String(o.kind ?? '');
  const kinds = kind ? RELATED[kind] ?? [kind] : null;
  const tag = String(o.tag ?? '').toLowerCase();
  const q = words(o.q);
  const limit = Math.max(1, Math.min(120, Number(o.limit) || 40));
  const rows = (kinds
    ? db.prepare(`SELECT * FROM community_assets WHERE hidden = 0 AND kind IN (${kinds.map(() => '?').join(',')})`).all(...kinds)
    : db.prepare('SELECT * FROM community_assets WHERE hidden = 0').all()) as Row[];
  const scored = rows
    .filter((r) => !tag || r.tags.split(' ').includes(tag))
    .map((r) => {
      const tags = r.tags.split(' ');
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
    .sort((a, b) => Math.round(b.s) - Math.round(a.s) || (sort === 'new' ? b.r.created - a.r.created : sort === 'fresh' ? a.r.likes - b.r.likes || b.r.created - a.r.created : b.r.likes - a.r.likes || b.r.uses - a.r.uses) || b.s - a.s);
  return { items: scored.slice(0, limit).map((x) => view(x.r)), total: scored.length };
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
export async function share(user: User, body: { asset?: unknown; title?: unknown; tags?: unknown; kind?: unknown; low?: unknown; thumb?: unknown }) {
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
  db.prepare(`INSERT INTO community_assets (id, project, kind, mime, title, tags, low, thumb, by_user, source, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'player', ?)
              ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, title = excluded.title, tags = excluded.tags, low = excluded.low, thumb = excluded.thumb, hidden = 0`)
    .run(id, user.project, kind, a.mime ?? null, title, tags, await own(body.low), await own(body.thumb), user.id, Date.now());
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

/**
 * Picks up the starter pack: every finished asset.make job in the starter project labelled pack=starter, community
 * true. A job's outputs are named by step (front, cutout, model...): the main file is the last step's, a model's
 * smaller GLB is its low-detail copy, and the cut-out picture is its thumb.
 */
export async function syncStarter() {
  const r: any = await gen(`/v1/assets?project=${STARTER_PROJECT}&q=starter&limit=500`, { as: STARTER_PROJECT });
  const byJob = new Map<string, any[]>();
  for (const a of r.items ?? []) {
    if (a.labels?.pack !== 'starter' || a.labels?.community === false || !a.job) continue;
    byJob.set(a.job, [...(byJob.get(a.job) ?? []), a]);
  }
  let added = 0;
  for (const outs of byJob.values()) {
    const l = outs[0].labels;
    const kind = String(l.kind ?? '');
    if (!COMMUNITY_KINDS.includes(kind as any)) continue;
    let main: any;
    let low: any = null;
    let thumb: any = null;
    if (kind === 'model') {
      const glbs = outs.filter((o) => o.mime === 'model/gltf-binary' && /^model/.test(String(o.title ?? ''))).sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
      [main, low] = [glbs[0], glbs.length > 1 ? glbs[glbs.length - 1] : null];
      thumb = outs.find((o) => o.title === 'cutout') ?? outs.find((o) => o.title === 'front');
    } else {
      main = outs.find((o) => o.title === kind) ?? null;
    }
    if (!main) continue;
    const res = db.prepare(`INSERT INTO community_assets (id, project, kind, mime, title, tags, low, thumb, by_user, source, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'starter', ?)
                ON CONFLICT(id) DO UPDATE SET title = excluded.title, tags = excluded.tags, low = excluded.low, thumb = excluded.thumb`)
      .run(main.id, STARTER_PROJECT, kind, main.mime ?? null, String(l.name ?? main.title ?? kind).slice(0, 80), cleanTags(l.tags ?? l.tag), low?.id ?? null, thumb?.id ?? null, Date.now());
    if (res.changes) added++;
  }
  return { jobs: byJob.size, rows: added };
}

/** Keeps the starter pack current (at start, then every few minutes); a Gen hiccup just waits for the next round. */
export function watchStarter(everyMs = 10 * 60_000) {
  const run = () => void syncStarter().catch((e) => console.warn('[portal] starter pack:', e.message));
  run();
  const t = setInterval(run, everyMs);
  t.unref();
  return () => clearInterval(t);
}
