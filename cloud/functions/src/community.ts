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
import { requireUser, type User } from './accounts.ts';
import { PortalError, route } from './http.ts';
import { SECRETS } from './config.ts';
import { known, levelUrls, rememberAsset, rememberMany, type GenLods } from './lods.ts';

/** The Gen project Hawkes' own starter pack lives in (the same for every copy of the portal). */
export const STARTER_PROJECT = 'usr_00000000000000c0';
export const COMMUNITY_KINDS = ['model', 'texture', 'image', 'sprite', 'sky', 'music', 'ambience', 'sfx', 'voice', 'video'] as const;
const SEARCH_CAP = 3000;

export type Row = { id: string; project: string; kind: string; mime: string | null; title: string; tags: string; category: string; item: string | null; low: string | null; thumb: string | null; by_user: string | null; source: string; uses: number; likes: number; created: number; hidden: number; words?: string[] };

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

const IMAGE_KINDS = ['texture', 'image', 'sprite', 'sky'];
type Ctx = { lods: Record<string, GenLods>; cdn: Record<string, string>; names: Map<string, string | null> };
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
  const file = (x: string | null) => (x ? c.cdn[x] ?? proxy(x) : null);
  const small = t ? [...t.levels].reverse().find((l) => l.level <= 256) ?? t.levels[0] : null;
  const thumb = small ? levelUrls({ ...t!, levels: [small] }, proxy(thumbId)!, { cdn: true }).levels[0].url : file(thumbId);
  return {
    id: r.id, kind: r.kind, mime: r.mime ?? null, title: r.title, category: r.category || null, tags: r.tags ? r.tags.split(' ') : [], file: file(r.id),
    thumb, thumbFull: file(thumbId),
    ...(mine ? { lods: levelUrls(mine, proxy(r.id)!, { cdn: true }) } : {}),
    low: Boolean(r.low) || Boolean(mine?.levels.some((l) => l.role === 'low')), by: r.by_user ? c.names.get(r.by_user) ?? 'A player' : 'Hawkes', source: r.source, uses: r.uses ?? 0, likes: r.likes ?? 0, created: r.created,
  };
}
export async function views(rows: Row[]) {
  const c = await context(rows);
  return rows.map((r) => view(r, c));
}

const RELATED: Record<string, string[]> = { image: ['image', 'sprite', 'texture'], sprite: ['sprite', 'image'], sfx: ['sfx', 'ambience'], ambience: ['ambience', 'sfx'] };

/** Searches the library: how well it matches (tags and title words), then 'liked' (default), 'new', 'fresh' or 'name'. */
export async function search(o: { q?: unknown; kind?: unknown; tag?: unknown; category?: unknown; limit?: unknown; offset?: unknown; sort?: unknown; exact?: unknown } = {}) {
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
    .filter((r) => (!kinds || kinds.includes(r.kind)) && (!category || r.category === category) && (!tag || r.category === tag || r.tags.split(' ').includes(tag)))
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
  return { items: await views(scored.slice(offset, offset + limit).map((x) => x.r)), total: scored.length };
}

/** Listed rows' kind, category and tags only (shelves and tag counts read the whole list; select keeps it small). */
const listedFields = async (kind?: string) => {
  let q: FirebaseFirestore.Query = assets().where('hidden', '==', 0);
  if (kind) q = q.where('kind', '==', kind);
  return (await q.select('kind', 'category', 'tags').get()).docs.map((d) => d.data() as { kind: string; category?: string; tags?: string });
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
export async function unshare(user: User, assetId: string) {
  const s = await assets().doc(assetId).get();
  if (!s.exists || (s.get('by_user') !== user.id && user.role !== 'admin')) throw new PortalError('Not one of yours', { status: 404 });
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
  let r: { project: string } | null = null;
  const own = await assets().doc(assetId).get();
  if (own.exists && !own.get('hidden')) r = { project: own.get('project') };
  if (!r) {
    for (const field of ['thumb', 'low']) {
      const s = await assets().where(field, '==', assetId).where('hidden', '==', 0).limit(1).get();
      if (!s.empty) { r = { project: s.docs[0].get('project') }; break; }
    }
  }
  if (!r) throw new PortalError('No such file', { status: 404 });
  const q = new URLSearchParams();
  if (o.lod && o.lod > 0) q.set('lod', String(Math.round(o.lod)));
  if (o.v && /^[0-9a-f]{8,64}$/.test(o.v)) q.set('v', o.v);
  return genFetch(`/v1/assets/${assetId}/file${q.size ? `?${q}` : ''}`, { as: r.project, headers: o.etag ? { 'If-None-Match': o.etag } : {}, signal: AbortSignal.timeout(120_000) });
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
  for (const was of existing.values()) {
    if (was.hidden || keepIds.has(was.id)) continue;
    const replaced = was.item && [...best.values()].some((r) => r.item === was.item);
    const belowRev = was.kind in MIN_REV;
    if (replaced || belowRev) { writes.push([was.id, { hidden: 1 }, false]); if (belowRev) withdrawn++; }
  }
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const [docId, data, create] of writes.slice(i, i + 450)) create ? batch.create(assets().doc(docId), data) : batch.update(assets().doc(docId), data);
    await batch.commit();
  }
  // Each thing's levels of detail came with Gen's list: kept for the library and bundles.
  await rememberMany([...best.values()].flatMap((r) => [r.main, r.thumb, r.low].filter(Boolean).map((a: any) => ({ asset: a.id, lods: a.lods ?? null, cdn: a.cdn }))));
  return { jobs: byJob.size, things: best.size, added, unusable, withdrawn, written: writes.length };
}

/** Keeps the starter pack current; a Gen hiccup just waits for the next round. */
export const syncStarter = onSchedule({ schedule: 'every 10 minutes', secrets: [SECRETS.genKey], timeoutSeconds: 300 }, async () => {
  try { console.log('[portal] starter pack:', JSON.stringify(await syncStarterPack())); } catch (e: any) { console.warn('[portal] starter pack:', e.message); }
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
route('GET', '/v1/community/tags', async ({ res, url }) => { open(res); return { tags: await tagCounts(url.searchParams.get('kind') ?? undefined) }; });
route('GET', /^\/v1\/community\/(a_[0-9a-f]+)\/file$/, async ({ req, res, url, params, method }) => {
  open(res);
  const gr = await file(params[0], { lod: Number(url.searchParams.get('lod')) || undefined, v: url.searchParams.get('v'), etag: req.headers['if-none-match'] ? String(req.headers['if-none-match']) : undefined });
  await streamFrom(gr, res, method);
});

// An account's own.
route('POST', '/v1/community', async ({ req }) => share(await requireUser(req), (req.body ?? {}) as any));
route('GET', '/v1/community/mine', async ({ req }) => mine(await requireUser(req)));
route('DELETE', /^\/v1\/community\/(a_[0-9a-f]+)$/, async ({ req, params }) => unshare(await requireUser(req), params[0]));

// An admin runs the starter sync now (anyone else: 404, like every admin route).
route('POST', '/v1/admin/community/sync', async ({ req }) => {
  const u = await requireUser(req).catch(() => null);
  if (u?.role !== 'admin') throw new PortalError('Not found', { status: 404 });
  return syncStarterPack();
});
