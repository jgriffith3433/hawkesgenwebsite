// The community library (src/community.ts on the old server): things anyone building a game can use. Hawkes' starter pack
// (made by community/starter.mjs into the starter project, picked up by the scheduled `syncStarter`) and whatever players
// share from their own library. A row only points at the asset in its owner's Gen project; nothing is copied or paid twice.
//
// Firestore:
//   communityAssets/{a_id}   the SQLite columns (project, kind, mime, title, tags (space separated), category, item, low,
//                            thumb, by_user, source, uses, likes, created, hidden 0/1) plus `words`: the lowercased words of
//                            the title, category and tags and their prefixes of 3+ letters (Firestore has no text search)
//   communityUses/{a_id}_{usr_id}   who used what (a like: once per account, never the sharer's own)
//
// Search, what changed: SQLite read every row and scored it in memory. Here a query narrows first (with words: the rows
// whose `words` contain any of the asked words or their prefixes, array-contains-any; without: by kind and category), at
// most SEARCH_CAP rows, and the same scoring and sorting run on those. A word that matches only inside another word in the
// middle (not as a prefix either way) no longer finds it, which the old scoring did not count either.
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import { onSchedule } from 'firebase-functions/scheduler';
import { db, FieldValue, users } from './store.ts';
import { gen, genFetch } from './gen.ts';
import { requireUser, requireAdmin, adminFrom, type User } from './accounts.ts';
import { PortalError, route } from './http.ts';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_PREFIX, SECRETS, isLive } from './config.ts';
import { ASSETS } from './engine.ts';
import { known, levelUrls, rememberAsset, rememberMany, type GenLods } from './lods.ts';

/** The Gen project Hawkes' own starter pack lives in (the same for every copy of the portal). */
export const STARTER_PROJECT = `${PROJECT_PREFIX}00000000000000c0`;
export const COMMUNITY_KINDS = ['model', 'texture', 'image', 'sprite', 'sky', 'music', 'ambience', 'sfx', 'voice', 'video'] as const;
const SEARCH_CAP = 3000;

export type Row = { id: string; project: string; kind: string; mime: string | null; title: string; tags: string; category: string; item: string | null; low: string | null; thumb: string | null; by_user: string | null; source: string; uses: number; likes: number; created: number; hidden: number; words?: string[]; gone?: Record<string, number>; seen?: Record<string, number> };

export const assets = () => db.collection('communityAssets');
const uses = () => db.collection('communityUses');
const rowOf = (d: FirebaseFirestore.DocumentSnapshot): Row => ({ id: d.id, ...(d.data() as Omit<Row, 'id'>) });

const words = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s-]+/g, ' ').split(/[\s-]+/).filter((w) => w.length > 1);
const cleanCategory = (c: unknown) => String(c ?? '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
const cleanTags = (t: unknown) => [...new Set((Array.isArray(t) ? t.join(' ') : String(t ?? '')).toLowerCase().split(/[\s,]+/).map((w) => w.replace(/[^a-z0-9-]/g, '')).filter(Boolean))].slice(0, 16).join(' ');
const prefixes = (w: string, min = 3) => Array.from({ length: Math.max(0, w.length - min + 1) }, (_, i) => w.slice(0, min + i));
/** The search words a row is found by (words, their prefixes of 3+ letters). */
export function wordsField(r: { title: string; category?: string; tags?: string }) {
  const all = new Set<string>();
  for (const w of [...words(r.title), ...(r.category ? [r.category, ...words(r.category)] : []), ...String(r.tags ?? '').split(' ').filter(Boolean)]) {
    all.add(w);
    for (const p of prefixes(w)) all.add(p);
  }
  return [...all].slice(0, 200);
}

/** How long a file Gen said it lacks stays out of the listing (beta's Gen may get the starter pack later). */
const GONE_FOR = 6 * 3600_000;
const IMAGE_KINDS = ['texture', 'image', 'sprite', 'sky'];
type Ctx = { lods: Record<string, GenLods>; cdn: Record<string, string>; names: Map<string, string | null> };
/** A thing whose own file Gen lately answered 404 for: it is not listed or counted (an empty card would read as broken). */
export const fileLost = (r: { id?: string; gone?: Record<string, number> }) => Boolean(r.id && Date.now() - Number(r.gone?.[r.id] ?? 0) < GONE_FOR);
const thumbIdOf = (r: Row) => r.thumb ?? (IMAGE_KINDS.includes(r.kind) ? r.id : null);

/** Everything the views of these rows need, read at once (levels, CDN links, sharers' names). */
async function context(rows: Row[]): Promise<Ctx> {
  const k = await known(rows.flatMap((r) => [IMAGE_KINDS.includes(r.kind) || r.kind === 'model' ? r.id : null, thumbIdOf(r), r.id]));
  const by = [...new Set(rows.map((r) => r.by_user).filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string | null>();
  for (let i = 0; i < by.length; i += 300) for (const s of await db.getAll(...by.slice(i, i + 300).map((u) => users().doc(u)))) names.set(s.id, s.exists ? (s.get('name') ?? null) : null);
  return { ...k, names };
}

/** What the client sees of a row (the same shape the old server answered). */
function view(r: Row, c: Ctx) {
  const proxy = (x: string | null) => (x ? `/v1/community/${x}/file` : null);
  const thumbId = thumbIdOf(r);
  const mine = IMAGE_KINDS.includes(r.kind) || r.kind === 'model' ? c.lods[r.id] : undefined;
  const t = thumbId ? c.lods[thumbId] : null;
  // A file Gen answered 404 for lately (`file()` notes it) is not offered again: the page shows a placeholder, no request.
  const lost = (x: string | null) => Boolean(x && Date.now() - Number(r.gone?.[x] ?? 0) < GONE_FOR);
  const file = (x: string | null) => (x && !lost(x) ? c.cdn[x] ?? proxy(x) : null);
  const small = t ? [...t.levels].reverse().find((l) => l.level <= 256) ?? t.levels[0] : null;
  const thumb = lost(thumbId) ? null : small ? levelUrls({ ...t!, levels: [small] }, proxy(thumbId)!, { cdn: true }).levels[0].url : file(thumbId);
  return {
    id: r.id, kind: r.kind, mime: r.mime ?? null, title: r.title, category: r.category || null, tags: r.tags ? r.tags.split(' ') : [], file: file(r.id),
    thumb, thumbFull: file(thumbId),
    ...(mine ? { lods: levelUrls(mine, proxy(r.id)!, { cdn: true }) } : {}),
    ...(lost(r.id) ? { gone: true } : {}),
    low: Boolean(r.low) || Boolean(mine?.levels.some((l) => l.role === 'low')), by: r.by_user ? c.names.get(r.by_user) ?? 'A player' : 'Hawkes', source: r.source, uses: r.uses ?? 0, likes: r.likes ?? 0, created: r.created,
  };
}
/**
 * Before a page of the library is listed: ask Gen once a day whether each thing's own file and its thumbnail exist, so
 * the page never offers one that is not there (a 404 is a console error, and a sound that won't play reads as broken).
 * Thumbnails only, before 2026-11-09: the starter pack's sounds and voices stayed listed after Gen lost them.
 */
const SEEN_FOR = 24 * 3600_000;
const filesToProbe = (r: Row) => [...new Set([r.id, thumbIdOf(r)].filter((x): x is string => Boolean(x)))];
async function probe(rows: Row[]) {
  const todo = rows.flatMap((r) => filesToProbe(r).filter((id) => Date.now() - Number(r.gone?.[id] ?? 0) >= GONE_FOR && Date.now() - Number(r.seen?.[id] ?? 0) >= SEEN_FOR).map((id) => ({ r, id })));
  for (let i = 0; i < todo.length; i += 12) {
    await Promise.all(todo.slice(i, i + 12).map(async ({ r, id }) => {
      try {
        // The file itself (one byte), not just the record: a record without its file is what the page would 404 on.
        const g = await genFetch(`/v1/assets/${id}/file`, { as: r.project, headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(8000) });
        await g.body?.cancel().catch(() => {});
        if (g.status === 404) { r.gone = { ...r.gone, [id]: Date.now() }; await assets().doc(r.id).update({ [`gone.${id}`]: Date.now() }); }
        else if (g.ok) { r.seen = { ...r.seen, [id]: Date.now() }; await assets().doc(r.id).update({ [`seen.${id}`]: Date.now() }); }
      } catch { /* Gen unreachable: list as it is */ }
    }));
  }
}
export async function views(rows: Row[]) {
  const c = await context(rows);
  return rows.map((r) => view(r, c));
}

const RELATED: Record<string, string[]> = { image: ['image', 'sprite', 'texture'], sprite: ['sprite', 'image'], sfx: ['sfx', 'ambience'], ambience: ['ambience', 'sfx'] };

/** Searches the library: how well it matches (tags and title words), then 'liked' (default), 'new', 'fresh' or 'name'. */
export async function search(o: { q?: unknown; kind?: unknown; tag?: unknown; category?: unknown; limit?: unknown; offset?: unknown; sort?: unknown; exact?: unknown; probe?: boolean } = {}) {
  const sort = ['new', 'fresh', 'name'].includes(String(o.sort)) ? String(o.sort) : 'liked';
  const kind = String(o.kind ?? '');
  const kinds = kind ? (o.exact ? [kind] : RELATED[kind] ?? [kind]) : null;
  const tag = String(o.tag ?? '').toLowerCase();
  const category = cleanCategory(o.category);
  const q = words(o.q);
  const limit = Math.max(1, Math.min(120, Number(o.limit) || 40));
  const offset = Math.max(0, Number(o.offset) || 0);
  let query: FirebaseFirestore.Query = assets().where('hidden', '==', 0);
  if (q.length) {
    // The asked words, then their prefixes (a row's word that is a prefix of an asked word: "barrels" finds "barrel").
    const any = [...new Set([...q, ...q.flatMap((w) => prefixes(w, 3).reverse())])].slice(0, 30);
    query = query.where('words', 'array-contains-any', any);
  } else {
    if (kinds) query = kinds.length === 1 ? query.where('kind', '==', kinds[0]) : query.where('kind', 'in', kinds);
    if (category) query = query.where('category', '==', category);
    else if (tag) query = query.where('words', 'array-contains', tag);
  }
  const rows = (await query.limit(SEARCH_CAP).get()).docs.map(rowOf);
  const scored = rows
    .filter((r) => !fileLost(r) && (!kinds || kinds.includes(r.kind)) && (!category || r.category === category) && (!tag || r.category === tag || r.tags.split(' ').includes(tag)))
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
    .sort((a, b) => Math.round(b.s) - Math.round(a.s) || (sort === 'new' ? b.r.created - a.r.created : sort === 'fresh' ? (a.r.likes ?? 0) - (b.r.likes ?? 0) || b.r.created - a.r.created : sort === 'name' ? a.r.title.localeCompare(b.r.title) : (b.r.likes ?? 0) - (a.r.likes ?? 0) || (b.r.uses ?? 0) - (a.r.uses ?? 0)) || b.s - a.s);
  const page = scored.slice(offset, offset + limit).map((x) => x.r);
  // (The Overseer passes probe: false: a player is waiting on its answer, and the listing pages probe for it.)
  if (o.probe !== false) await probe(page);
  // A thing the probe just found gone is left out now, not shown as an empty card until the next listing.
  const shown = page.filter((r) => !fileLost(r));
  return { items: await views(shown), total: scored.length - (page.length - shown.length) };
}

/** Listed rows' kind, category and tags only (shelves and tag counts read the whole list; select keeps it small). */
const listedFields = async (kind?: string) => {
  let q: FirebaseFirestore.Query = assets().where('hidden', '==', 0);
  if (kind) q = q.where('kind', '==', kind);
  return (await q.select('kind', 'category', 'tags', 'gone').get()).docs.map((d) => ({ id: d.id, ...(d.data() as { kind: string; category?: string; tags?: string; gone?: Record<string, number> }) })).filter((r) => !fileLost(r));
};

/** The shelves: every kind with its categories and how many things each has. */
export async function categories() {
  const n = new Map<string, Map<string, number>>();
  for (const r of await listedFields()) {
    const m = n.get(r.kind) ?? new Map<string, number>();
    m.set(r.category ?? '', (m.get(r.category ?? '') ?? 0) + 1);
    n.set(r.kind, m);
  }
  let total = 0;
  const kinds = COMMUNITY_KINDS.filter((k) => n.has(k)).map((k) => {
    const cats = [...n.get(k)!].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const count = cats.reduce((s, [, c]) => s + c, 0);
    total += count;
    return { kind: k, count, categories: cats.filter(([c]) => c).map(([category, c]) => ({ category, count: c })) };
  });
  // (The old answer counted kinds outside COMMUNITY_KINDS in total too.)
  for (const [k, m] of n) if (!COMMUNITY_KINDS.includes(k as any)) for (const c of m.values()) total += c;
  return { kinds, total };
}

/** The tags in use, with how many things each has. */
export async function tagCounts(kind?: string) {
  const n = new Map<string, number>();
  for (const r of await listedFields(kind)) for (const t of String(r.tags ?? '').split(' ').filter(Boolean)) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([tag, count]) => ({ tag, count }));
}

const KIND_OF_GEN: Record<string, string> = { mesh: 'model', image: 'image', audio: 'sfx', video: 'video' };

/** A player shares one of their own things with everyone (or updates its title and tags). */
export async function share(user: User, body: { asset?: unknown; title?: unknown; tags?: unknown; category?: unknown; kind?: unknown; low?: unknown; thumb?: unknown }) {
  const assetId = String(body.asset ?? '').replace(/^asset:/, '');
  if (!/^a_[0-9a-f]+$/.test(assetId)) throw new PortalError('asset is "asset:a_..." from your library');
  const a: any = await gen(`/v1/assets/${assetId}`, { as: user.project }).catch(() => null);
  if (!a?.id) throw new PortalError('That asset is not in your library', { status: 404 });
  const own = async (x: unknown) => {
    const v = String(x ?? '').replace(/^asset:/, '');
    if (!/^a_[0-9a-f]+$/.test(v)) return null;
    return (await gen(`/v1/assets/${v}`, { as: user.project }).catch(() => null))?.id ? v : null;
  };
  const kind = COMMUNITY_KINDS.includes(String(body.kind) as any) ? String(body.kind) : KIND_OF_GEN[a.kind] ?? 'image';
  const title = String(body.title ?? a.title ?? '').trim().slice(0, 80) || 'Untitled';
  const tags = cleanTags(body.tags) || words(title).join(' ');
  const category = cleanCategory(body.category);
  const [low, thumb] = [await own(body.low), await own(body.thumb)];
  const ref = assets().doc(assetId);
  await db.runTransaction(async (t) => {
    const was = await t.get(ref);
    if (was.exists && was.get('by_user') !== user.id) throw new PortalError('Someone else shared that one', { status: 403 });
    const fields = { kind, title, tags, category, low, thumb, hidden: 0, words: wordsField({ title, category, tags }) };
    if (was.exists) t.update(ref, fields);
    else t.create(ref, { ...fields, project: user.project, mime: a.mime ?? null, item: null, by_user: user.id, source: 'player', uses: 0, likes: 0, created: Date.now() });
  });
  await rememberAsset(a);
  return (await views([rowOf(await ref.get())]))[0];
}

/** Stops sharing (games that already use it keep it). */
export async function unshare(user: User, assetId: string, admin = false) {
  const s = await assets().doc(assetId).get();
  if (!s.exists || (s.get('by_user') !== user.id && !admin)) throw new PortalError('Not one of yours', { status: 404 });
  await s.ref.update({ hidden: 1 });
  return { ok: true };
}

/** What the player has shared. */
export async function mine(user: User) {
  const s = await assets().where('by_user', '==', user.id).where('hidden', '==', 0).orderBy('created', 'desc').limit(500).get();
  return { items: await views(s.docs.map(rowOf)) };
}

/** A listed row (for games' "use in a game": games.ts). */
export async function listedRow(assetId: string): Promise<Row | null> {
  const s = await assets().doc(String(assetId)).get();
  return s.exists && !s.get('hidden') ? rowOf(s) : null;
}
export const viewOne = async (r: Row) => (await views([r]))[0];

/**
 * The row to use for a row someone names by id: itself while it is listed and its file is there; for a starter thing that
 * was hidden or lost (Gen lost the pack with the AWS box, 2026-11), the listed row of the same thing (`item`) made since.
 * Null: hidden with nothing in its place. (Templates, the sandbox's voice lines and older games name starter things by id.)
 */
export async function currentOf(r: Row): Promise<Row | null> {
  if ((!r.hidden && !fileLost(r)) || !r.item || r.source !== 'starter') return r.hidden ? null : r;
  const s = await assets().where('item', '==', r.item).where('hidden', '==', 0).limit(5).get();
  const alt = s.docs.map(rowOf).find((x) => x.id !== r.id && x.source === 'starter' && !fileLost(x));
  return alt ?? (r.hidden ? null : r);
}

/**
 * Someone put a community thing in a game: one more use, and a like when it is someone else's (once per account).
 * The games area calls this from POST /v1/games/:id/community (the part of src/community.ts useInGame that is the library's).
 */
export async function recordUse(user: User, assetId: string, gameId: string) {
  const ref = assets().doc(assetId);
  const use = uses().doc(`${assetId}_${user.id}`);
  return db.runTransaction(async (t) => {
    const [r, u] = await Promise.all([t.get(ref), t.get(use)]);
    if (!r.exists) return { liked: false };
    const like = r.get('by_user') !== user.id && !u.exists;
    if (like) t.create(use, { asset: assetId, user_id: user.id, game_id: gameId, created: Date.now() });
    t.update(ref, { uses: FieldValue.increment(1), ...(like ? { likes: FieldValue.increment(1) } : {}) });
    return { liked: like };
  });
}

/** Streams Gen's answer to the client (status and the headers a file needs; HEAD sends none of the body). */
export async function streamFrom(gr: globalThis.Response, res: Response, method: string, extra: Record<string, string> = {}, pass = ['content-type', 'content-length', 'content-disposition', 'cache-control', 'etag', 'last-modified', 'accept-ranges', 'content-range']) {
  const headers: Record<string, string> = {};
  for (const h of pass) {
    const v = gr.headers.get(h);
    if (v) headers[h] = v;
  }
  res.status(gr.status).set({ ...headers, ...extra });
  if (method === 'HEAD' || !gr.body) { await gr.body?.cancel().catch(() => {}); return void res.end(); }
  await pipeline(Readable.fromWeb(gr.body as any), res).catch(() => {});
}

/** A community file (a listed thing, its thumb or low copy), from its owner's project; `lod` and `v` ask for a level. */
export async function file(assetId: string, o: { lod?: number; v?: string | null; etag?: string } = {}) {
  let r: { project: string; ref: FirebaseFirestore.DocumentReference } | null = null;
  const own = await assets().doc(assetId).get();
  // A starter thing that was made again has a new id; games and engine code that name the old one get the new one's file.
  const now = own.exists ? await currentOf(rowOf(own)) : null;
  if (now && now.id !== assetId) assetId = now.id;
  if (now) r = { project: now.project, ref: assets().doc(now.id) };
  if (!r) {
    for (const field of ['thumb', 'low']) {
      const s = await assets().where(field, '==', assetId).where('hidden', '==', 0).limit(1).get();
      if (!s.empty) { r = { project: s.docs[0].get('project'), ref: s.docs[0].ref }; break; }
    }
  }
  if (!r) throw new PortalError('No such file', { status: 404 });
  const q = new URLSearchParams();
  if (o.lod && o.lod > 0) q.set('lod', String(Math.round(o.lod)));
  if (o.v && /^[0-9a-f]{8,64}$/.test(o.v)) q.set('v', o.v);
  const gr = await genFetch(`/v1/assets/${assetId}/file${q.size ? `?${q}` : ''}`, { as: r.project, headers: o.etag ? { 'If-None-Match': o.etag } : {}, signal: AbortSignal.timeout(120_000) });
  // Listed but not in Gen (beta's Gen lacks the live starter pack): remember it, so the listing stops pointing at it.
  if (gr.status === 404) await r.ref.update({ [`gone.${assetId}`]: Date.now() }).catch(() => {});
  return gr;
}

// ------------------------------------------------------------ the starter pack

const saved = (outs: any[], name: string) => outs.filter((o) => { const t = String(o.title ?? ''); return t === name || t.startsWith(`${name}.`); });
const MIME_OF: Record<string, RegExp> = { model: /^model\/gltf-binary$/, texture: /^image\//, image: /^image\//, sprite: /^image\//, sky: /^image\//, music: /^audio\//, ambience: /^audio\//, sfx: /^audio\//, voice: /^audio\//, video: /^video\// };
/** The oldest recipe a starter thing of a kind may come from (tools/starter.mjs labels each job `rev`). */
export const MIN_REV: Record<string, number> = { model: 4 };
const revOf = (l: any) => Number(String(l?.rev ?? 'v1').replace(/^v/, '')) || 1;

/** One finished starter job's files as a library row: the main file, a model's low copy, a picture of it. Null: not usable. */
export function starterRow(outs: any[]) {
  const l = outs[0]?.labels ?? {};
  const kind = String(l.kind ?? '');
  if (!COMMUNITY_KINDS.includes(kind as any)) return null;
  if (revOf(l) < (MIN_REV[kind] ?? 0)) return null;
  let main: any = null;
  let low: any = null;
  let thumb: any = null;
  if (kind === 'model') {
    const glbs = saved(outs, 'model').filter((o) => MIME_OF.model.test(o.mime ?? '')).sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
    [main, low] = [glbs[0] ?? null, glbs.length > 1 ? glbs[glbs.length - 1] : null];
    const pics = saved(outs, 'cutout').filter((o) => !/mask/i.test(String(o.title ?? '')));
    thumb = pics.find((o) => /^cutout(\.cutout)?$/.test(String(o.title ?? ''))) ?? pics[0] ?? saved(outs, 'front')[0] ?? null;
  } else {
    main = saved(outs, kind).find((o) => MIME_OF[kind].test(o.mime ?? '')) ?? null;
  }
  if (!main) return null;
  const name = String(l.name ?? main.title ?? kind).trim().slice(0, 80) || kind;
  return { main, low, thumb, kind, name, category: cleanCategory(l.tag), tags: cleanTags(l.tags ?? l.tag), item: `${kind}/${String(l.item ?? name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}` };
}

/**
 * Picks up the starter pack: every file a finished asset.make job in the starter project saved with pack=starter, page by
 * page. One row per thing (kind and name): a remade one replaces the old row, which is hidden. A row an admin hid stays
 * hidden. Writes only what changed (it runs every 10 minutes).
 */
export async function syncStarterPack() {
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
  const best = new Map<string, NonNullable<ReturnType<typeof starterRow>> & { at: number }>();
  let unusable = 0;
  for (const outs of byJob.values()) {
    const row = starterRow(outs);
    if (!row) { unusable++; continue; }
    const at = Math.max(...outs.map((o) => Number(o.created) || 0));
    if ((best.get(row.item)?.at ?? -1) < at) best.set(row.item, { ...row, at });
  }
  const existing = new Map((await assets().where('source', '==', 'starter').get()).docs.map((d) => [d.id, rowOf(d)]));
  const writes: [string, Record<string, unknown>, boolean][] = [];
  let added = 0;
  const keepIds = new Set([...best.values()].map((r) => r.main.id));
  for (const r of best.values()) {
    const fields = { kind: r.kind, title: r.name, tags: r.tags, category: r.category, item: r.item, low: r.low?.id ?? null, thumb: r.thumb?.id ?? null, words: wordsField({ title: r.name, category: r.category, tags: r.tags }) };
    const was = existing.get(r.main.id);
    if (!was) {
      // (A player's row with this id is not touched: ids are Gen's, so the starter project's are its own.)
      if ((await assets().doc(r.main.id).get()).exists) continue;
      writes.push([r.main.id, { ...fields, project: STARTER_PROJECT, mime: r.main.mime ?? null, by_user: null, source: 'starter', uses: 0, likes: 0, created: Date.now(), hidden: 0 }, true]);
      added++;
    } else if ((Object.keys(fields) as (keyof typeof fields)[]).some((k) => JSON.stringify(was[k as keyof Row] ?? null) !== JSON.stringify(fields[k]))) {
      writes.push([r.main.id, fields, false]);
    }
  }
  // Retire: an older row of the same thing, and starter rows of a kind with a minimum recipe that aren't this round's.
  let withdrawn = 0;
  let lost = 0;
  const inGen = new Set(all.map((a) => String(a.id)));
  for (const was of existing.values()) {
    if (was.hidden || keepIds.has(was.id)) continue;
    const replaced = was.item && [...best.values()].some((r) => r.item === was.item);
    const belowRev = was.kind in MIN_REV;
    if (replaced || belowRev) { writes.push([was.id, { hidden: 1 }, false]); if (belowRev) withdrawn++; continue; }
    // Listed, but Gen no longer has it in the starter project at all (Gen lost the pack with the AWS box, 2026-11): not
    // offered (fileLost) until it comes back or is made again; the probe would only find it one page at a time.
    if (!inGen.has(was.id) && !fileLost(was)) { writes.push([was.id, { [`gone.${was.id}`]: Date.now() }, false]); lost++; }
  }
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const [docId, data, create] of writes.slice(i, i + 450)) create ? batch.create(assets().doc(docId), data) : batch.update(assets().doc(docId), data);
    await batch.commit();
  }
  // Each thing's levels of detail came with Gen's list: kept for the library and bundles.
  await rememberMany([...best.values()].flatMap((r) => [r.main, r.thumb, r.low].filter(Boolean).map((a: any) => ({ asset: a.id, lods: a.lods ?? null, cdn: a.cdn }))));
  return { jobs: byJob.size, things: best.size, added, unusable, withdrawn, lost, written: writes.length };
}

// ------------------------------------------------------------ the pack as defined, what is missing, and remaking it

type PackItem = { kind: string; tag: string; name: string; what: string; words: string; item: string };
type PackModule = { packItems: () => PackItem[]; paramsFor: (kind: string, what: string) => any; keyOf: (it: PackItem) => string; labelsOf: (it: PackItem) => Record<string, unknown> };
/** One lane's order to remake missing things (community/restore.json): J's yes, quoted; the kinds; a dollar cap. */
export type RestoreOrder = { approved: string; kinds: string[]; budgetUsd: number; first: string[] };

let packP: Promise<PackModule> | null = null;
/** community/starter.mjs as the function has it (tools/prebuild.mjs copies it into assets/). */
export function starterPack(): Promise<PackModule> {
  packP ??= (async () => {
    const file = path.join(ASSETS, 'community', 'starter.mjs');
    if (!fs.existsSync(file)) throw new PortalError('The starter pack is not on this server yet (run cloud/functions/tools/prebuild.mjs before deploying)', { status: 503 });
    return (await import(pathToFileURL(file).href)) as PackModule;
  })();
  packP.catch(() => { packP = null; });
  return packP;
}

/** This lane's restore order, if J gave one (community/restore.json `live` / `beta`). */
export function restoreOrder(): RestoreOrder | null {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(ASSETS, 'community', 'restore.json'), 'utf8'));
    const o = all?.[isLive() ? 'live' : 'beta'];
    if (!o || typeof o.approved !== 'string' || !o.approved.trim() || !Array.isArray(o.kinds) || !(Number(o.budgetUsd) > 0)) return null;
    return { approved: o.approved, kinds: o.kinds.map(String).filter((k: string) => COMMUNITY_KINDS.includes(k as any)), budgetUsd: Math.min(200, Number(o.budgetUsd)), first: Array.isArray(o.first) ? o.first.map(String) : [] };
  } catch { return null; }
}

/**
 * The pack against the library: how many things community/starter.mjs defines, how many are listed with their file in
 * Gen, and which are missing, per kind (GET /v1/community/health; the community-library playtest fails on a missing one).
 */
export async function packHealth(o: { jobs?: boolean } = {}) {
  const { packItems } = await starterPack();
  const pack = packItems();
  const listed = new Set((await assets().where('source', '==', 'starter').where('hidden', '==', 0).select('item', 'gone').get()).docs
    .map((d) => ({ id: d.id, item: d.get('item') as string | null, gone: d.get('gone') as Record<string, number> | undefined }))
    .filter((r) => r.item && !fileLost(r)).map((r) => r.item!));
  const byKind: Record<string, { pack: number; listed: number }> = {};
  const missing: string[] = [];
  for (const it of pack) {
    const k = (byKind[it.kind] ??= { pack: 0, listed: 0 });
    k.pack++;
    if (listed.has(it.item)) k.listed++;
    else missing.push(it.item);
  }
  const r = restoreOrder();
  // What remaking has cost so far (every order on this lane, as estimated when queued) and where this order stands.
  const orders = (await restores().get()).docs.map((d) => d.data());
  const spentUsd = Math.round(orders.reduce((s, o) => s + (Number(o.spentUsd) || 0), 0) * 100) / 100;
  const cur = r ? orders.find((o) => o.approved === r.approved) : undefined;
  const tries: Record<string, number> = cur?.tries ?? {};
  const missingSet = new Set(missing);
  const progress = cur ? { spentUsd: Number(cur.spentUsd) || 0, queued: Object.keys(tries).length, stillMissingAfterTwoTries: Object.entries(tries).filter(([it, n]) => n >= 2 && missingSet.has(it)).map(([it]) => it) } : null;
  return { pack: pack.length, listed: pack.length - missing.length, missing: missing.length, byKind, missingItems: missing, spentUsd, restore: r ? { approved: r.approved, kinds: r.kinds, budgetUsd: r.budgetUsd, ...progress, ...(o.jobs ? { jobs: await remakeJobs() } : {}) } : null };
}

/** Where Gen stands on the remake jobs (?jobs=1 on the health check): counts by status, and the newest few failures. */
async function remakeJobs() {
  try {
    const { jobs } = await gen<{ jobs: any[] }>(`/v1/jobs?project=${STARTER_PROJECT}&tool=asset.make&limit=300`, { as: STARTER_PROJECT });
    const mine = (jobs ?? []).filter((j) => typeof j.key === 'string' && j.key.includes('/remake/'));
    const byStatus: Record<string, number> = {};
    for (const j of mine) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
    const line = (j: any) => ({ item: `${j.labels?.kind}/${j.labels?.item}`, status: j.status, detail: String(j.detail ?? '').slice(0, 160), error: j.error ? String(j.error).slice(0, 300) : null, server: j.server ?? null, created: j.created, started: j.started ?? null, finished: j.finished ?? null });
    // The 3D step on its own (the model chain's mesh.views3d jobs): why the newest few ended, with Gen's last log lines.
    const mesh = await gen<{ jobs: any[] }>(`/v1/jobs?project=${STARTER_PROJECT}&tool=mesh.views3d&limit=5`, { as: STARTER_PROJECT })
      .then((r) => (r.jobs ?? []).map((j) => ({ status: j.status, error: j.error ? String(j.error).slice(0, 300) : null, created: j.created, finished: j.finished ?? null, log: (Array.isArray(j.log) ? j.log : []).slice(-6).map((l: unknown) => String(l).slice(0, 400)) })), (e) => [{ error: String(e?.message ?? e) }]);
    // Gen's GPU providers (the order, each one's cooldown and last error): why the 3D step finds no GPU.
    // This page is public: no hosts, prices or balance, only each provider's state.
    const gpu = await gen<any>('/v1/gpu/providers', { as: STARTER_PROJECT })
      .then((g) => ({
        order: g.order, familyOrder: g.familyOrder,
        providers: (g.providers ?? []).map((p: any) => ({ id: p.id, families: p.families, enabled: p.enabled, ready: p.ready, problem: p.problem ? String(p.problem).slice(0, 200) : null, down: p.health?.down ?? null, reason: p.health?.reason ? String(p.health.reason).slice(0, 200) : null, lastError: p.health?.lastError ? String(typeof p.health.lastError === 'string' ? p.health.lastError : JSON.stringify(p.health.lastError)).slice(0, 200) : null })),
      }), (e) => ({ error: String(e?.message ?? e).slice(0, 200) }));
    return { byStatus, failed: mine.filter((j) => j.status === 'failed').slice(0, 8).map(line), open: mine.filter((j) => j.status === 'queued' || j.status === 'running').slice(0, 8).map(line), mesh, gpu };
  } catch (e: any) { return { error: e.message }; }
}

const restores = () => db.collection('communityRestore');
/** Gen's words for a job it turned away without making anything: too many at once, Claude busy or at its limit, or no GPU free. */
export const wasTurnedAway = (text: string) => /a lot at once|wait \d+ seconds?, then try again|throttl|rate.?limit|\b429\b|overloaded|no gpu is available|nothing was charged/i.test(text);
/** A run Gen's RunPod worker stopped at its old 300 s graph limit (fixed in Gen #189): the try made nothing of its own. */
export const stoppedAtGenLimit = (text: string) => /runpod: ran past this service's 300 s limit/i.test(text);
const REMAKE_SCHEME = 2;
/**
 * Gen's key for one try at remaking a pack thing. Never the pack's own key: Gen hands back the job that key first made
 * (done, its files lost with the AWS box), so nothing would be made. One key per order and try: a repeat of the same
 * try gets the same job back, a second try is new work.
 */
export const remakeKey = (packKey: string, order: string, tryNo: number) =>
  `${packKey}/remake/${crypto.createHash('sha256').update(order).digest('hex').slice(0, 10)}/${tryNo}`;
/**
 * Remakes what the pack is missing, within this lane's restore order: the missing things of its kinds go to Gen as the
 * same asset.make jobs tools/starter.mjs queues (same key and labels, in this lane's starter project), priced by Gen's
 * estimate first, until what was queued under the order reaches its budget. A thing is tried at most twice (a failed job
 * frees its key in Gen). The next syncs list each one as it finishes. Nothing happens without an order: it spends money.
 */
export async function restoreStarter() {
  const order = restoreOrder();
  if (!order) return { order: false };
  const { packItems, paramsFor, keyOf, labelsOf } = await starterPack();
  const health = await packHealth();
  const missing = new Set(health.missingItems);
  const ref = restores().doc(order.approved.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 120) || 'order');
  // Tries kept before remakes had keys of their own (scheme 2) never reached Gen as new work: the pack's own key handed
  // back the original job, finished long ago with its files gone (beta, 2026-11-10). They count for nothing.
  const kept = (await ref.get()).data() ?? {};
  const state = kept.scheme === REMAKE_SCHEME ? kept : {};
  const tries: Record<string, number> = state.tries ?? {};
  const queuedAt: Record<string, number> = state.queuedAt ?? {};
  let spent = Number(state.spentUsd) || 0;
  // A thing queued in the last 2 hours is still being made (it lists when it finishes); after that it gets a second try
  // under a key of its own (each try's key hands back that try's job, so a repeat never pays twice).
  // The cheap kinds first, 3D models (most of the cost) last.
  // Things the worlds use (order.first) come before the rest of their kind.
  const rank = (it: { item: string; kind: string }) => Number(it.kind === 'model') * 2 + Number(!order.first.includes(it.item));
  // A try whose Gen job already failed is over: the second try needn't wait out the 2 hours.
  const failedJobs = await gen<{ jobs: any[] }>(`/v1/jobs?project=${STARTER_PROJECT}&tool=asset.make&status=failed&limit=500`, { as: STARTER_PROJECT })
    .then((r) => r.jobs ?? [], () => [] as any[]);
  const failedKeys = new Set(failedJobs.map((j) => String(j.key ?? '')));
  // A try Gen turned away for coming too fast (or Claude being busy) made nothing: it doesn't count as one of the two.
  // So is a 3D try Gen stopped at RunPod's old 300 s graph limit (Gen #189, 2026-11-10): Gen's limit, not the model.
  const turnedAway = new Set(failedJobs.filter((j) => wasTurnedAway(`${j.detail ?? ''} ${j.error ?? ''}`) || stoppedAtGenLimit(`${j.detail ?? ''} ${j.error ?? ''}`)).map((j) => String(j.key ?? '')));
  const allowed = (it: { item: string; kind: string; name: string }) => {
    let free = 0;
    for (let t = 1; t <= (tries[it.item] ?? 0); t++) if (turnedAway.has(remakeKey(keyOf(it as any), ref.id, t))) free++;
    // Up to 14 tries Gen turned away (no GPU, too fast) are free: the model gate stops after a broken 3D path. The crate
    // used 4 before Gen waited out a cold RunPod start (Gen #186) and 5 more before Gen let a 3D run outlast RunPod's
    // 300 s cap instead of sending it to the AWS fleet that is gone (Gen #188, 2026-11-10).
    return 2 + Math.min(free, 14);
  };
  const lastFailed = (it: { item: string; kind: string; name: string }) =>
    (tries[it.item] ?? 0) > 0 && failedKeys.has(remakeKey(keyOf(it as any), ref.id, tries[it.item]));
  const due = (it: { item: string; kind: string; name: string }) => (tries[it.item] ?? 0) < allowed(it) && (lastFailed(it) || Date.now() - (queuedAt[it.item] ?? 0) > 2 * 3600_000);
  let todo = packItems().filter((it) => missing.has(it.item) && order.kinds.includes(it.kind) && due(it)).sort((a, b) => rank(a) - rank(b));
  // 3D models are most of the cost and the longest recipe: until one has listed in this lane, one at a time; and none at
  // all once one has failed both its tries with none listed (Gen's 3D path is broken: nothing more is spent on it).
  if (!(health.byKind.model?.listed > 0)) {
    const models = packItems().filter((it) => it.kind === 'model' && missing.has(it.item));
    // Dead: a model whose tries are used up and whose last one failed (one still being made isn't).
    const dead = models.some((it) => (tries[it.item] ?? 0) >= allowed(it) && lastFailed(it));
    const making = models.some((it) => (tries[it.item] ?? 0) > 0 && !due(it));
    let room = dead || making ? 0 : 1;
    todo = todo.filter((it) => it.kind !== 'model' || room-- > 0);
  }
  // A few at a time: Gen turns away a burst, and each round is 10 minutes apart anyway.
  todo = todo.slice(0, 20);
  if (!todo.length) return { order: true, queued: 0, spentUsd: spent, budgetUsd: order.budgetUsd };
  // Priced per kind by Gen (each batch's own boots and model loads; the idle tail, once per server, is in the budget's
  // margin), then queued in order while the running total stays within the budget.
  const price: Record<string, number> = {};
  for (const kind of new Set(todo.map((it) => it.kind))) {
    const of = todo.filter((it) => it.kind === kind);
    const est: any = await gen('/v1/estimate', { method: 'POST', as: STARTER_PROJECT, body: { project: STARTER_PROJECT, items: of.map((it) => ({ tool: 'asset.make', params: paramsFor(it.kind, it.what), count: 1, label: it.item })) } });
    const total = Number(est?.cost?.total);
    if (!(total >= 0)) throw new PortalError(`Gen gave no price for ${kind}`, { status: 502 });
    price[kind] = total / of.length;
  }
  let queued = 0;
  for (const it of todo) {
    if (spent + price[it.kind] > order.budgetUsd) break;
    tries[it.item] = (tries[it.item] ?? 0) + 1;
    queuedAt[it.item] = Date.now();
    try {
      await gen('/v1/jobs', { method: 'POST', as: STARTER_PROJECT, body: { tool: 'asset.make', project: STARTER_PROJECT, params: paramsFor(it.kind, it.what), labels: labelsOf(it), key: remakeKey(keyOf(it), ref.id, tries[it.item]), reuse: true } });
      spent += price[it.kind];
      queued++;
    } catch (e: any) { console.warn(`[portal] starter restore: ${it.item}: ${e.message}`); }
  }
  await ref.set({ scheme: REMAKE_SCHEME, approved: order.approved, kinds: order.kinds, budgetUsd: order.budgetUsd, spentUsd: Math.round(spent * 100) / 100, tries, queuedAt, updated: Date.now() });
  return { order: true, queued, spentUsd: Math.round(spent * 100) / 100, budgetUsd: order.budgetUsd };
}

/** Keeps the starter pack current (and remakes what is missing when J ordered it); a Gen hiccup waits for the next round. */
export const syncStarter = onSchedule({ schedule: 'every 10 minutes', secrets: [SECRETS.genKey], timeoutSeconds: 300 }, async () => {
  try { console.log('[portal] starter pack:', JSON.stringify(await syncStarterPack())); } catch (e: any) { console.warn('[portal] starter pack:', e.message); }
  try { const r = await restoreStarter(); if (r.order) console.log('[portal] starter restore:', JSON.stringify(r)); } catch (e: any) { console.warn('[portal] starter restore:', e.message); }
});

// ------------------------------------------------------------ routes

const open = (res: Response) => void res.set('Access-Control-Allow-Origin', '*');

// Public, open CORS (the play sandbox has no origin).
route('GET', '/v1/community', async ({ res, url }) => {
  open(res);
  const p = (k: string) => url.searchParams.get(k) ?? undefined;
  return search({ q: p('q'), kind: p('kind'), tag: p('tag'), category: p('category'), limit: p('limit'), offset: p('offset'), sort: p('sort'), exact: p('exact') === '1' });
});
route('GET', '/v1/community/categories', async ({ res }) => { open(res); return categories(); });
// How complete the starter pack is (the community-library playtest fails while any of it is missing).
route('GET', '/v1/community/health', async ({ res, url }) => { open(res); res.set('Cache-Control', 'no-store'); return packHealth({ jobs: url.searchParams.get('jobs') === '1' }); });
route('GET', '/v1/community/tags', async ({ res, url }) => { open(res); return { tags: await tagCounts(url.searchParams.get('kind') ?? undefined) }; });
route('GET', /^\/v1\/community\/(a_[0-9a-f]+)\/file$/, async ({ req, res, url, params, method }) => {
  open(res);
  const gr = await file(params[0], { lod: Number(url.searchParams.get('lod')) || undefined, v: url.searchParams.get('v'), etag: req.headers['if-none-match'] ? String(req.headers['if-none-match']) : undefined });
  await streamFrom(gr, res, method);
});

// An account's own.
route('POST', '/v1/community', async ({ req }) => share(await requireUser(req), (req.body ?? {}) as any));
route('GET', '/v1/community/mine', async ({ req }) => mine(await requireUser(req)));
route('DELETE', /^\/v1\/community\/(a_[0-9a-f]+)$/, async ({ req, params }) => unshare(await requireUser(req), params[0], Boolean(await adminFrom(req))));

// An admin runs the starter sync now (anyone else: 403, like every admin route).
route('POST', '/v1/admin/community/sync', async ({ req }) => {
  await requireAdmin(req);
  const sync = await syncStarterPack();
  return { ...sync, restore: await restoreStarter() };
});
