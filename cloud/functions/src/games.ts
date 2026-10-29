// Games (src/games.ts on the old box), on Firestore. A game is scripts plus named assets from Gen's library, edited
// together by its members in real time (live.ts). Every game is live: /play/<slug> plays it as it is now; a save is a
// numbered copy (releases) the owner restores from, and /play/<slug>/v/<n> plays one.
//
//   games/{g_id}                  the game (the SQLite columns; plus files_count and files_bytes, kept with every file
//                                 write so the limits never read every file: worked out once if missing)
//   games/{g_id}/members/{usr}    game_id, user_id, role (owner, editor, builder, player), added
//   games/{g_id}/files/{path}     path (the id is encodeURIComponent(path)), content, rev, updated, updated_by
//   games/{g_id}/assets/{name}    name, asset, project, kind, mime, added_by, created, words (JSON text), title
//   games/{g_id}/releases/{n}     version, notes, created, created_by, files and assets (JSON text; over ~900 KB the
//                                 two go to releases/{n}/parts/{i} instead: a game's files may add up to 3 MB)
//   games/{g_id}/chat/{m_id}      id, game_id, user_id, role, text, data (JSON text), created
//   gameInvites/{code}            game_id, created_by, created, expires, revoked
//   gamesReports/{rp_id}          game_id, reason, note, reporter_id, ip, created
//   playSeen/{game}_{who}         a play counted once per player per game per hour (expires: TTL)
//   genLods/{a_id}                Gen's levels of detail per asset, as Gen answered (lods: a map, state, fetched, cdn)
//
// Who can do what (the owner sets it): owner (everything, people and restores), editor (the world, code, settings),
// builder (the world: placing, moving, the assistant, saving), player (plays it; a member who can't change it).
import crypto from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import { db, users, FieldValue } from './store.ts';
import { gen, genHeaders } from './gen.ts';
import { env, SECRETS, USER_ID } from './config.ts';
import { getUser, requireUser, type User } from './accounts.ts';
import { id, PortalError, route, send, json } from './http.ts';
import { applyOps, parseScene, sceneText } from './scene.ts';
import { wordsOf } from './words.ts';
import { templates, type Template } from './engine.ts';
import { tell, kick, liveCounts, allLiveCounts, join, setPresence } from './live.ts';
// Friends both ways, once, keyed friends/{user}:{friend} (friends.ts owns the key; areFriends reads it).
import { addFriend } from './friends.ts';

export type Game = { id: string; slug: string; title: string; description: string; owner_id: string; visibility: 'public' | 'unlisted'; visitors?: 'play' | 'build'; live_version: number | null; cover: string | null; plays: number; created: number; updated: number; hidden?: number; hidden_reason?: string | null; hidden_at?: number | null; hidden_by?: string | null; files_count?: number; files_bytes?: number };
export type Role = 'owner' | 'editor' | 'builder' | 'player';
export type FileRow = { path: string; content: string; rev: number; updated: number; updated_by: string | null };
export type AssetRow = { name: string; asset: string; project: string; kind: string | null; mime: string | null; added_by: string | null; created: number; words?: string[] | string | null; title?: string | null };

// Limits that keep one game a reasonable size for the browser and the database.
export const LIMITS = { files: 150, fileBytes: 256 * 1024, totalBytes: 3 * 1024 * 1024, assets: 300 };
const PATH_RE = /^(?:[a-z0-9_-]+\/){0,4}[a-z0-9_.-]+\.(js|json|md|txt|css)$/i;
const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;
const GAME_ID = /^g_[0-9a-f]+$/;

export const gamesCol = () => db.collection('games');
const gref = (gameId: string) => gamesCol().doc(gameId);
export const filesOf = (gameId: string) => gref(gameId).collection('files');
export const assetsOf = (gameId: string) => gref(gameId).collection('assets');
const membersOf = (gameId: string) => gref(gameId).collection('members');
const releasesOf = (gameId: string) => gref(gameId).collection('releases');
const chatOf = (gameId: string) => gref(gameId).collection('chat');
const fileKey = (path: string) => encodeURIComponent(path);
const assetKey = (name: string) => encodeURIComponent(name);

// ------------------------------------------------------------------ plans (src/plans.ts: what a plan allows here)
export { PLANS, planOf, type Plan } from './platform.ts';
import { planOf } from './platform.ts';

// ------------------------------------------------------------------ signed links (src/sign.ts's format, the portal's signing key)
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const signingKey = () => Buffer.from(SECRETS.signing.value());
const mac = (body: string) => crypto.createHmac('sha256', signingKey()).update(body).digest().subarray(0, 18);
/** A keyed digest (base64url): the same text always gives the same digest, which can't be turned back. */
export const digest = (text: string) => b64(crypto.createHmac('sha256', signingKey()).update(text).digest());
export function signToken(payload: Record<string, unknown>, ttlSeconds: number) {
  const body = b64(JSON.stringify({ ...payload, e: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${body}.${b64(mac(body))}`;
}
export function verifyToken<T = Record<string, any>>(token: string): (T & { e: number }) | null {
  const [body, sig] = String(token ?? '').split('.');
  if (!body || !sig) return null;
  const want = mac(body);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return v.e >= Date.now() / 1000 ? v : null;
  } catch { return null; }
}
/** The signed token the editor's room on Hawkes Net takes (rooms.ts editToken; hnet.ts ticket verifies it). */
export const editToken = (gameId: string, user: { id: string }) => signToken({ k: 'edit', g: gameId, u: user.id }, 12 * 3600);

// ------------------------------------------------------------------ Hawkes Net (src/hnet.ts publishOps / kick)
// Game rooms are Hawkes Net's (a function holds no sockets): world edits saved here are published to the game's rooms
// (g/<id>/*), and people put out of a game are kicked there. PORTAL_NET=local turns it off.
export const netUrl = () => (env('PORTAL_NET_URL') ?? 'https://net.hawkesgen.ai').replace(/\/+$/, '');
export const NET_PROJECT = 'hawkesgenwebsite';
async function netPublish(body: Record<string, unknown>) {
  if (env('PORTAL_NET') === 'local') return;
  try {
    const r = await fetch(`${netUrl()}/v1/net/publish`, { method: 'POST', headers: genHeaders(undefined, { 'Content-Type': 'application/json' }), body: JSON.stringify({ project: NET_PROJECT, ...body }), signal: AbortSignal.timeout(5000) });
    if (!r.ok) console.warn(`[portal] hawkes net publish answered ${r.status}`);
  } catch (e: any) { console.warn(`[portal] hawkes net publish: ${e.message}`); }
}
/** World edits this server saved: into the game's editor room and every play room of it (rooms.ts broadcastOps). */
export async function broadcastOps(gameId: string, ops: unknown[], by: string, fx: string | null = null, except?: string) {
  if (!ops.length || !gameId.startsWith('g_')) return;
  await netPublish({ room: `g/${gameId}/*`, ops, by, fx, except: except ?? null });
}
/** Puts people out of rooms under `room` (all, or those who joined as `sub`). */
export const netKick = (room: string, sub?: string) => netPublish({ room, kick: { sub: sub ?? null } });

// ------------------------------------------------------------------ levels of detail and CDN links (src/lods.ts, read side)
export type GenLevel = { level: number; bytes: number; w?: number; h?: number; tris?: number; tex?: number; role?: string; sha: string; inS3?: boolean; cdn?: string };
export type GenLods = { kind: 'image' | 'mesh'; state: string; size?: [number, number]; tris?: number; tex?: number; bytes: number; sha: string; inS3?: boolean; cdn?: string; levels: GenLevel[] };
export const cdnHosts = () => [...new Set(['https://cdn.hawkesgen.ai', ...(env('PORTAL_CDN_HOSTS') ?? '').split(',').map((h) => h.trim().replace(/\/+$/, '')).filter((h) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(h))])];
const CDN_URL = /^(https:\/\/[a-z0-9.-]+(?::\d+)?)\/sha256\/[0-9a-f]+$/;
const goodCdn = (x: unknown): string | null => { const m = typeof x === 'string' ? CDN_URL.exec(x) : null; return m && cdnHosts().includes(m[1]) ? (x as string) : null; };
const FRESH = { made: 24 * 3600_000, making: 60_000, none: 10 * 60_000, notBackedUp: 15 * 60_000 };
const lodsCol = () => db.collection('genLods');
const ASSET_ID = /^a_[0-9a-f]+$/;
const lodsValue = (v: unknown): GenLods | null => { if (!v) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } } return v as GenLods; };

/** Keeps what Gen said about an asset (its summary and CDN link). */
export async function rememberLods(asset: string, lods: GenLods | null | undefined, o: { asked?: boolean; cdn?: unknown } = {}) {
  if (!ASSET_ID.test(asset)) return;
  const cdn = goodCdn(lods?.cdn) ?? goodCdn(o.cdn);
  if (lods === undefined) { if (cdn) await lodsCol().doc(asset).set({ asset, cdn }, { merge: true }); return; }
  // A map, as lods.ts writes and reads it (community, gallery and shares read genLods through lods.ts).
  await lodsCol().doc(asset).set({ asset, lods: lods ?? null, state: lods?.state ?? null, fetched: lods || o.asked ? Date.now() : 0, ...(cdn ? { cdn } : {}) }, { merge: true });
}
export const rememberAsset = (a: { id?: string; lods?: GenLods | null; cdn?: unknown } | null | undefined) => (a?.id ? rememberLods(a.id, a.lods ?? null, { cdn: a.cdn }).catch(() => {}) : Promise.resolve());

async function lodRows(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => typeof x === 'string' && ASSET_ID.test(x)))];
  const out = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  for (let i = 0; i < list.length; i += 300) for (const s of await db.getAll(...list.slice(i, i + 300).map((a) => lodsCol().doc(a)))) out.set(s.id, s);
  return { list, rows: out };
}
/** Gen's CDN link per asset, for those it has backed up. */
export async function cdnOf(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const { rows } = await lodRows(ids);
  const out: Record<string, string> = {};
  for (const [a, s] of rows) if (s.exists && s.get('cdn')) out[a] = s.get('cdn');
  return out;
}
/** The summaries known for these assets. Unknown or stale ones are asked of Gen now (briefly: a slow Gen answers next time). */
export async function lodsOf(ids: (string | null | undefined)[]): Promise<Record<string, GenLods>> {
  const { list, rows } = await lodRows(ids);
  const out: Record<string, GenLods> = {};
  const wanted: string[] = [];
  const now = Date.now();
  for (const a of list) {
    const s = rows.get(a);
    if (!s?.exists) { wanted.push(a); continue; }
    const l = lodsValue(s.get('lods'));
    if (l?.levels?.length) out[a] = l;
    const state = s.get('state') as string | null;
    const made = state === 'done' || state === 'skipped';
    const age = now - Number(s.get('fetched') ?? 0);
    if (age > (made ? (s.get('cdn') || !l ? FRESH.made : FRESH.notBackedUp) : state ? FRESH.making : FRESH.none)) wanted.push(a);
  }
  if (wanted.length) {
    const asked = refreshLods(wanted).catch(() => 0);
    await Promise.race([asked, new Promise((r) => setTimeout(r, 1500))]);
  }
  return out;
}
export async function refreshLods(ids: string[]) {
  let known = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    let r: { lods: Record<string, GenLods> };
    try {
      r = await gen(`/v1/lods?ids=${chunk.join(',')}`, { signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      const batch = db.batch();
      for (const a of chunk) batch.set(lodsCol().doc(a), { asset: a, fetched: Date.now() }, { merge: true });
      await batch.commit().catch(() => {});
      throw e;
    }
    for (const a of chunk) { await rememberLods(a, r.lods?.[a] ?? null, { asked: true }); if (r.lods?.[a]) known++; }
  }
  return known;
}
/** A summary as the engine takes it: each level at `${url}?lod=<level>&v=<hash>`, or Gen's CDN link (public only). */
export function levelUrls(s: GenLods, url: string, o: { cdn?: boolean } = {}) {
  const j = url.includes('?') ? '&' : '?';
  return {
    kind: s.kind, ...(s.size ? { size: s.size } : {}), ...(s.tris ? { tris: s.tris, tex: s.tex ?? 0 } : {}), bytes: s.bytes,
    levels: s.levels.map(({ sha, cdn, inS3, ...l }) => ({ ...l, url: (o.cdn && goodCdn(cdn)) || `${url}${j}lod=${l.level}&v=${sha}` })),
  };
}

// ------------------------------------------------------------------ reading games
const asGame = (s: FirebaseFirestore.DocumentSnapshot): Game | null => (s.exists ? ({ ...(s.data() as Game), id: s.id }) : null);
export async function getGame(gameId: string): Promise<Game | null> {
  if (!GAME_ID.test(String(gameId))) return null;
  return asGame(await gref(gameId).get());
}
export async function gameBySlug(slug: string): Promise<Game | null> {
  const s = String(slug ?? '').toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(s)) return null;
  const q = await gamesCol().where('slug', '==', s).limit(1).get();
  return q.empty ? null : asGame(q.docs[0]);
}
async function roleOf(gameId: string, userId: string): Promise<Role | null> {
  const m = await membersOf(gameId).doc(userId).get();
  return m.exists ? (m.get('role') as Role) : null;
}
export const ROLES: Role[] = ['player', 'builder', 'editor', 'owner'];
const RANK: Record<Role, number> = { player: 0, builder: 1, editor: 2, owner: 3 };
const NEED: Record<Role, string> = { player: 'play it', builder: 'build in this game', editor: 'change code and settings', owner: 'do that (the owner only)' };

/** The game, if this customer is one of its members with at least `need` (else 404, or 403 when the role doesn't allow it). */
export async function memberGame(user: User, gameId: string, need: Role = 'builder') {
  const g = await getGame(gameId);
  const role = g ? await roleOf(g.id, user.id) : null;
  if (!g || !role) throw new PortalError('No such game', { status: 404 });
  if (RANK[role] < RANK[need]) throw new PortalError(need === 'owner' ? 'Only the owner can do that' : `The owner hasn't let you ${NEED[need]} yet`, { status: 403 });
  return { game: g, role };
}

const touch = (gameId: string) => gref(gameId).update({ updated: Date.now() }).catch(() => {});
export const nameOf = async (userId: string | null | undefined) => (userId ? (await getUser(userId))?.name ?? 'someone' : 'someone');
async function namesOf(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0))];
  const out = new Map<string, string | null>();
  for (let i = 0; i < list.length; i += 300) for (const s of await db.getAll(...list.slice(i, i + 300).map((u) => users().doc(u)))) if (s.exists) out.set(s.id, (s.get('name') ?? null) as string | null);
  return out;
}

async function slugFor(title: string) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'game';
  for (;;) {
    const slug = `${base}-${crypto.randomBytes(2).toString('hex')}`;
    if (!(await gameBySlug(slug))) return slug;
  }
}
function cleanTitle(t: unknown) {
  const s = String(t ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!s) throw new PortalError('Give the game a title');
  return s;
}
const ownedCount = async (userId: string) => (await gamesCol().where('owner_id', '==', userId).count().get()).data().count;

// ------------------------------------------------------------------ games
type Counts = (gameId: string) => { playing: number; building: number };
export async function summary(g: Game, userId?: string, counts?: Counts) {
  const ms = (await membersOf(g.id).get()).docs.map((d) => d.data()).sort((a, b) => Number(a.added) - Number(b.added));
  const names = await namesOf(ms.map((m) => m.user_id));
  return {
    id: g.id, slug: g.slug, title: g.title, description: g.description, visibility: g.visibility, visitors: g.visitors ?? 'play', lastSave: g.live_version ?? null, cover: g.cover ?? null, plays: g.plays ?? 0, created: g.created, updated: g.updated,
    ...(counts ? counts(g.id) : await liveCounts(g.id)),
    role: userId ? ((ms.find((m) => m.user_id === userId)?.role as Role | undefined) ?? null) : null,
    members: ms.filter((m) => names.has(m.user_id)).map((m) => ({ id: m.user_id as string, name: names.get(m.user_id) ?? null, role: m.role as Role })),
    playUrl: `/play/${g.slug}`,
    closed: g.hidden ? { reason: g.hidden_reason || 'It was reported and an admin closed it.', at: g.hidden_at ?? null } : null,
  };
}

export async function listGames(user: User) {
  const mine = await db.collectionGroup('members').where('user_id', '==', user.id).get();
  const ids = [...new Set(mine.docs.map((d) => d.ref.parent.parent?.id).filter((x): x is string => !!x))];
  const rows: Game[] = [];
  for (let i = 0; i < ids.length; i += 300) for (const s of await db.getAll(...ids.slice(i, i + 300).map((g) => gref(g)))) { const g = asGame(s); if (g) rows.push(g); }
  rows.sort((a, b) => b.updated - a.updated);
  const plan = planOf(await getUser(user.id));
  const owned = rows.filter((g) => g.owner_id === user.id).length;
  const counts = await allLiveCounts();
  const T = await templates();
  return { games: await Promise.all(rows.map((g) => summary(g, user.id, counts))), owned, limit: plan.games, templates: T.TEMPLATES.map(({ id: tid, name, blurb }) => ({ id: tid, name, blurb })) };
}

const fileDoc = (gameId: string, path: string, content: string, rev: number, now: number, by: string | null) => ({ game_id: gameId, path, content, rev, updated: now, updated_by: by });
const assetDoc = (gameId: string, a: AssetRow) => ({ game_id: gameId, name: a.name, asset: a.asset, project: a.project, kind: a.kind ?? null, mime: a.mime ?? null, added_by: a.added_by ?? null, created: a.created ?? Date.now(), words: JSON.stringify(wordList(a)), title: a.title ?? null });

/** Writes many documents in batches of 400 (Firestore's batch holds 500). */
async function writeAll(ops: ((b: FirebaseFirestore.WriteBatch) => void)[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    for (const op of ops.slice(i, i + 400)) op(b);
    await b.commit();
  }
}

/** A new game with these files and assets (the owner's first). */
async function makeGame(user: User, o: { title: string; description: string; files: Record<string, string>; assets: AssetRow[] }) {
  const now = Date.now();
  const gameId = id('g_', 8);
  const slug = await slugFor(o.title);
  const entries = Object.entries(o.files);
  const game: Omit<Game, 'id'> = { slug, title: o.title, description: o.description, owner_id: user.id, visibility: 'public', visitors: 'play', live_version: null, cover: null, plays: 0, created: now, updated: now, hidden: 0, hidden_reason: null, hidden_at: null, hidden_by: null, files_count: entries.length, files_bytes: entries.reduce((n, [, c]) => n + c.length, 0) };
  const seen = new Set<string>();
  // The game document goes first (alone), so the members, files and assets never exist without it.
  await gref(gameId).create(game);
  await writeAll([
    (b) => b.create(membersOf(gameId).doc(user.id), { game_id: gameId, user_id: user.id, role: 'owner', added: now }),
    ...entries.map(([path, content]) => (b: FirebaseFirestore.WriteBatch) => b.create(filesOf(gameId).doc(fileKey(path)), fileDoc(gameId, path, content, 1, now, user.id))),
    ...o.assets.filter((a) => !seen.has(a.name) && seen.add(a.name)).map((a) => (b: FirebaseFirestore.WriteBatch) => b.set(assetsOf(gameId).doc(assetKey(a.name)), assetDoc(gameId, { ...a, added_by: user.id, created: now }))),
  ]);
  return gameId;
}

export async function createGame(user: User, body: { title?: unknown; template?: unknown; description?: unknown }) {
  const plan = planOf(await getUser(user.id));
  if ((await ownedCount(user.id)) >= plan.games) throw new PortalError(`Your ${plan.name} plan has room for ${plan.games} games. Upgrade for more, or delete one.`, { status: 402 });
  const title = cleanTitle(body.title);
  const T = await templates();
  const template = T.TEMPLATES.find((t) => t.id === String(body.template ?? 'planet')) ?? T.TEMPLATES[0];
  // The community things it uses become the game's own (each still in its owner's project: nothing copied).
  const gameId = await makeGame(user, { title, description: String(body.description ?? template.blurb).slice(0, 400), files: template.files(title), assets: await templateAssetRows(template) });
  return summary((await getGame(gameId))!, user.id);
}

export async function updateGame(user: User, gameId: string, body: { title?: unknown; description?: unknown; visibility?: unknown; cover?: unknown; visitors?: unknown }) {
  const { game, role } = await memberGame(user, gameId, 'editor');
  const patch: Partial<Game> = {};
  if (body.title !== undefined) patch.title = cleanTitle(body.title);
  if (body.description !== undefined) patch.description = String(body.description ?? '').slice(0, 400);
  if (body.cover !== undefined) {
    const c = body.cover ? String(body.cover) : null;
    if (c && !(await assetsOf(game.id).doc(assetKey(c)).get()).exists) throw new PortalError(`No asset named ${c} in this game`);
    patch.cover = c;
  }
  if (body.visibility !== undefined) {
    if (role !== 'owner') throw new PortalError('Only the owner can change who sees the game', { status: 403 });
    if (!['public', 'unlisted'].includes(String(body.visibility))) throw new PortalError('visibility is public or unlisted');
    patch.visibility = body.visibility as Game['visibility'];
  }
  if (body.visitors !== undefined) {
    if (role !== 'owner') throw new PortalError('Only the owner decides what visitors can do', { status: 403 });
    if (!['play', 'build'].includes(String(body.visitors))) throw new PortalError('visitors is play or build');
    patch.visitors = body.visitors as Game['visitors'];
  }
  if (Object.keys(patch).length) await gref(game.id).update({ ...patch, updated: Date.now() });
  const out = await summary((await getGame(game.id))!, user.id);
  await tell(game.id, 'game', out);
  return out;
}

export async function deleteGame(user: User, gameId: string) {
  const { game } = await memberGame(user, gameId, 'owner');
  await tell(game.id, 'deleted', { id: game.id });
  // (The game and everything under it: members, files, assets, saves, chat, its live feed.)
  await db.recursiveDelete(gref(game.id));
  return { ok: true };
}

export const allFiles = async (gameId: string): Promise<FileRow[]> =>
  (await filesOf(gameId).get()).docs.map((d) => ({ path: d.get('path'), content: d.get('content'), rev: d.get('rev'), updated: d.get('updated'), updated_by: d.get('updated_by') ?? null })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
export const fileContent = async (gameId: string, path: string) => { const s = await filesOf(gameId).doc(fileKey(path)).get(); return s.exists ? (s.get('content') as string) : null; };

/** Everything the editor opens with: the game, its files, its assets, recent releases. */
export async function openGame(user: User, gameId: string) {
  const { game } = await memberGame(user, gameId, 'player');
  const [sum, files, assets, rel, owner] = await Promise.all([summary(game, user.id), allFiles(game.id), listAssets(game.id), releases(game.id), getUser(game.owner_id)]);
  return { game: sum, files, assets, releases: rel, plan: planOf(owner) };
}

// ------------------------------------------------------------------ members and invites
const invitesCol = () => db.collection('gameInvites');
export async function createInvite(user: User, gameId: string) {
  const { game } = await memberGame(user, gameId, 'editor');
  const code = crypto.randomBytes(9).toString('base64url');
  const now = Date.now();
  await invitesCol().doc(code).create({ code, game_id: game.id, created_by: user.id, created: now, expires: now + 7 * 24 * 3600_000, revoked: 0 });
  return { code, path: `/app/join/${code}`, expires: now + 7 * 24 * 3600_000 };
}

async function liveInvite(code: string) {
  const c = String(code ?? '');
  const inv = /^[\w-]{4,64}$/.test(c) ? await invitesCol().doc(c).get() : null;
  if (!inv?.exists || inv.get('revoked') || Number(inv.get('expires')) < Date.now()) throw new PortalError('This invite has expired. Ask for a new link.', { status: 410 });
  const game = await getGame(inv.get('game_id'));
  if (!game) throw new PortalError('That game no longer exists', { status: 410 });
  return { inv: { code: c, game_id: game.id, created_by: inv.get('created_by') as string }, game };
}

/** What an invite is for, before accepting it. */
export async function inviteInfo(code: string) {
  const { inv, game } = await liveInvite(code);
  return { game: { id: game.id, title: game.title, description: game.description }, from: await nameOf(inv.created_by) };
}


/** Adds a builder within the owner's plan's room for people (in one transaction: two can't both take the last place). */
async function addBuilder(game: Game, userId: string) {
  const plan = planOf(await getUser(game.owner_id));
  await db.runTransaction(async (t) => {
    const all = await t.get(membersOf(game.id));
    if (all.docs.some((d) => d.id === userId)) return;
    if (all.size >= plan.members) throw new PortalError(`This game is full: the owner's ${plan.name} plan allows ${plan.members} people per game.`, { status: 402 });
    // An invite makes a builder; the owner gives more (or less) from People.
    t.create(membersOf(game.id).doc(userId), { game_id: game.id, user_id: userId, role: 'builder', added: Date.now() });
  });
}

export async function acceptInvite(user: User, code: string) {
  const { inv, game } = await liveInvite(code);
  if (await roleOf(game.id, user.id)) return summary(game, user.id);
  await addBuilder(game, user.id);
  await addFriend(inv.created_by, user.id);
  const out = await summary(game, user.id);
  await tell(game.id, 'game', await summary(game));
  await systemNote(game.id, `${user.name ?? 'someone'} joined the game.`);
  return out;
}

/** A visitor helps build a live game the owner opened to visitors: they join as a builder. */
export async function joinToBuild(user: User, slug: string) {
  const game = await gameBySlug(slug);
  if (!game || game.hidden) throw new PortalError('No such game', { status: 404 });
  if (await roleOf(game.id, user.id)) return summary(game, user.id);
  if ((game.visitors ?? 'play') !== 'build') throw new PortalError('The owner builds this one with invited people only. Ask them for an invite.', { status: 403 });
  await addBuilder(game, user.id);
  await tell(game.id, 'game', await summary(game));
  await systemNote(game.id, `${user.name ?? 'someone'} came by and is helping build.`);
  return summary(game, user.id);
}

/** The owner sets what someone may do: player, builder or editor (one owner per game). */
export async function setMemberRole(user: User, gameId: string, memberId: string, role: unknown) {
  const { game } = await memberGame(user, gameId, 'owner');
  const r = String(role) as Role;
  if (!['player', 'builder', 'editor'].includes(r)) throw new PortalError('role is player, builder or editor');
  if (memberId === game.owner_id) throw new PortalError('The owner stays the owner');
  try { await membersOf(game.id).doc(memberId).update({ role: r }); }
  catch { throw new PortalError('Not in this game', { status: 404 }); }
  await tell(game.id, 'game', await summary(game));
  await tell(game.id, 'role', { user: memberId, role: r });
  await systemNote(game.id, `${user.name ?? 'someone'} made ${await nameOf(memberId)} ${r === 'editor' ? 'an editor' : `a ${r}`}.`);
  return summary(game, user.id);
}

export async function removeMember(user: User, gameId: string, memberId: string) {
  const { game, role } = await memberGame(user, gameId, 'player');
  // The owner removes anyone else; anyone may leave.
  if (memberId === game.owner_id) throw new PortalError('The owner cannot leave their own game; delete it instead');
  if (memberId !== user.id && role !== 'owner') throw new PortalError('Only the owner can remove people', { status: 403 });
  await membersOf(game.id).doc(memberId).delete();
  await tell(game.id, 'game', await summary(game));
  await tell(game.id, 'removed', { user: memberId });
  await kick(game.id, memberId);
  await netKick(`g/${game.id}/edit`, memberId);
  return { ok: true };
}

// ------------------------------------------------------------------ files
function checkPath(p: unknown) {
  const path = String(p ?? '').trim().replace(/^\/+/, '');
  if (!PATH_RE.test(path) || path.includes('..')) throw new PortalError('File names are letters, numbers, - _ . and folders, ending in .js, .json, .md, .txt or .css');
  return path;
}

/** A game's file totals (kept on the game; worked out once when missing). Inside a transaction. */
async function totals(t: Transaction, gameId: string) {
  const g = await t.get(gref(gameId));
  if (!g.exists) throw new PortalError('No such game', { status: 404 });
  let count = g.get('files_count') as number | undefined;
  let bytes = g.get('files_bytes') as number | undefined;
  if (typeof count !== 'number' || typeof bytes !== 'number') {
    const all = await t.get(filesOf(gameId));
    count = all.size;
    bytes = all.docs.reduce((n, d) => n + String(d.get('content') ?? '').length, 0);
  }
  return { count, bytes };
}

/** One file's write inside a transaction (writeFile and sceneOps): null when nothing changed. */
async function writeFileIn(t: Transaction, user: User | null, gameId: string, path: string, content: string, baseRev: unknown) {
  const ref = filesOf(gameId).doc(fileKey(path));
  const [tot, curSnap] = await Promise.all([totals(t, gameId), t.get(ref)]);
  const cur: FileRow | null = curSnap.exists ? { path, content: curSnap.get('content'), rev: curSnap.get('rev'), updated: curSnap.get('updated'), updated_by: curSnap.get('updated_by') ?? null } : null;
  if (cur && baseRev !== undefined && baseRev !== null && Number(baseRev) !== cur.rev) {
    const e = new PortalError(`${await nameOf(cur.updated_by)} changed ${path} while you were editing`, { status: 409 }) as PortalError & { file?: FileRow };
    e.file = cur;
    throw e;
  }
  if (cur && cur.content === content) return { file: cur, changed: false };
  const others = tot.count - (cur ? 1 : 0);
  const otherBytes = tot.bytes - (cur ? cur.content.length : 0);
  if (!cur && others >= LIMITS.files) throw new PortalError(`A game has up to ${LIMITS.files} files`, { status: 413 });
  if (otherBytes + content.length > LIMITS.totalBytes) throw new PortalError(`A game's files add up to at most ${LIMITS.totalBytes / 1024 / 1024} MB`, { status: 413 });
  const now = Date.now();
  const by = user?.id ?? null;
  const file: FileRow = { path, content, rev: (cur?.rev ?? 0) + 1, updated: now, updated_by: by };
  t.set(ref, fileDoc(gameId, path, content, file.rev, now, by));
  t.update(gref(gameId), { updated: now, files_count: others + 1, files_bytes: otherBytes + content.length });
  return { file, changed: true };
}

/** Saves a file. `baseRev` is the revision the editor started from: if someone saved since, the save is refused with
 *  the current file (409) so the editor can merge. Without it (new file, or the assistant) it overwrites. */
export async function writeFile(user: User | null, gameId: string, body: { path?: unknown; content?: unknown; baseRev?: unknown }, o: { by?: string; conn?: string; ops?: boolean } = {}) {
  const path = checkPath(body.path);
  const content = typeof body.content === 'string' ? body.content : '';
  if (Buffer.byteLength(content) > LIMITS.fileBytes) throw new PortalError(`Files up to ${LIMITS.fileBytes / 1024} KB`, { status: 413 });
  const r = await db.runTransaction((t) => writeFileIn(t, user, gameId, path, content, body.baseRev));
  // ops: true marks a scene.json saved from world edits, which the engines already have (they heard the ops).
  if (r.changed) await tell(gameId, 'file', { ...r.file, by: o.by ?? (user ? user.name ?? 'someone' : 'assistant'), conn: o.conn ?? null, ops: o.ops ?? false });
  return r.file;
}

export async function deleteFile(user: User, gameId: string, p: unknown, conn?: string) {
  await memberGame(user, gameId, 'editor');
  const path = checkPath(p);
  await db.runTransaction(async (t) => {
    const ref = filesOf(gameId).doc(fileKey(path));
    const [tot, cur] = await Promise.all([totals(t, gameId), t.get(ref)]);
    if (!cur.exists) throw new PortalError('No such file', { status: 404 });
    t.delete(ref);
    t.update(gref(gameId), { updated: Date.now(), files_count: Math.max(0, tot.count - 1), files_bytes: Math.max(0, tot.bytes - String(cur.get('content') ?? '').length) });
  });
  await tell(gameId, 'file-deleted', { path, by: user.name ?? 'someone', conn: conn ?? null });
  return { ok: true };
}

export async function renameFile(user: User, gameId: string, body: { from?: unknown; to?: unknown }, conn?: string) {
  await memberGame(user, gameId, 'editor');
  const from = checkPath(body.from);
  const to = checkPath(body.to);
  if (from === to) return { ok: true };
  const file = await db.runTransaction(async (t) => {
    const fromRef = filesOf(gameId).doc(fileKey(from));
    const toRef = filesOf(gameId).doc(fileKey(to));
    const [a, b] = await Promise.all([t.get(fromRef), t.get(toRef)]);
    if (b.exists) throw new PortalError(`${to} already exists`, { status: 409 });
    if (!a.exists) throw new PortalError('No such file', { status: 404 });
    const now = Date.now();
    const row: FileRow = { path: to, content: a.get('content'), rev: Number(a.get('rev')) + 1, updated: now, updated_by: user.id };
    t.delete(fromRef);
    t.create(toRef, fileDoc(gameId, to, row.content, row.rev, now, user.id));
    t.update(gref(gameId), { updated: now });
    return row;
  });
  await tell(gameId, 'file-renamed', { from, to, file, by: user.name ?? 'someone', conn: conn ?? null });
  return { ok: true, file };
}

// ------------------------------------------------------------------ assets
export async function listAssets(gameId: string) {
  const rows = (await assetsOf(gameId).get()).docs.map((d) => ({ name: d.get('name'), asset: d.get('asset'), project: d.get('project'), kind: d.get('kind') ?? null, mime: d.get('mime') ?? null, added_by: d.get('added_by') ?? null, created: d.get('created'), words: d.get('words'), title: d.get('title') ?? null }) as AssetRow);
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows.map((a) => ({ ...a, words: wordList(a) }));
}
/** An asset row's words (stored as JSON; old rows and old saves have none: then its name's). */
export function wordList(a: AssetRow): string[] {
  let w: unknown = a.words;
  if (typeof w === 'string') { try { w = JSON.parse(w); } catch { w = []; } }
  const list = Array.isArray(w) ? w.map(String) : [];
  return list.length ? list : wordsOf(a.name.replace(/_low\.glb$/, '.glb'));
}
/** What kind of file it is, for finding by word: model, image, sound, video (or null). */
export const typeOf = (mime: string | null | undefined) => { const m = String(mime ?? ''); return m === 'model/gltf-binary' || /gltf|glb/.test(m) ? 'model' : m.startsWith('image/') ? 'image' : m.startsWith('audio/') ? 'sound' : m.startsWith('video/') ? 'video' : null; };

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'model/gltf-binary': 'glb', 'video/mp4': 'mp4', 'video/webm': 'webm', 'application/json': 'json' };

/** A free asset name in this game, from a wanted one ("hero" -> "hero.png", or "hero-2.png" when taken). */
export async function freeName(gameId: string, wanted: string, mime?: string | null) {
  const taken = new Set((await assetsOf(gameId).select().get()).docs.map((d) => decodeURIComponent(d.id)));
  const ext = EXT[String(mime ?? '').split(';')[0]] ?? '';
  let base = String(wanted || 'asset').toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'asset';
  if (!/^[a-z0-9]/.test(base)) base = `a${base}`;
  const full = (n: number) => `${base}${n > 1 ? `-${n}` : ''}${ext ? `.${ext}` : ''}`;
  for (let n = 1; ; n++) if (!taken.has(full(n))) return full(n);
}

/** Puts an asset into the game: one of the member's own (their Gen project), under a name scripts use. */
export async function addAsset(user: User, gameId: string, body: { asset?: unknown; name?: unknown; words?: unknown; title?: unknown }, o: { project?: string; words?: unknown[]; title?: string | null } = {}) {
  await memberGame(user, gameId);
  const assetId = String(body.asset ?? '').replace(/^asset:/, '');
  if (!ASSET_ID.test(assetId)) throw new PortalError('asset is "asset:a_..." from your library');
  const project = o.project ?? user.project;
  const a: any = await gen(`/v1/assets/${assetId}`, { as: project }).catch(() => null);
  if (!a?.id) throw new PortalError('That asset is not in your library', { status: 404 });
  if ((await assetsOf(gameId).count().get()).data().count >= LIMITS.assets) throw new PortalError(`A game has up to ${LIMITS.assets} assets`, { status: 413 });
  const wanted = body.name ? String(body.name) : String(a.title ?? a.filename ?? a.tool ?? 'asset');
  if (body.name && !NAME_RE.test(String(body.name).replace(/\.[a-z0-9]{2,4}$/i, ''))) throw new PortalError('Asset names are letters, numbers, - and _');
  const title = String(o.title ?? body.title ?? a.title ?? '').slice(0, 120) || null;
  for (let tries = 0; ; tries++) {
    const name = await freeName(gameId, wanted, a.mime);
    const words = wordsOf(o.words ?? [], Array.isArray(body.words) ? body.words : [], wanted, name.replace(/_low\.glb$/, '.glb'));
    const row: AssetRow = { name, asset: assetId, project, kind: a.kind ?? null, mime: a.mime ?? null, added_by: user.id, created: Date.now(), words, title };
    try { await assetsOf(gameId).doc(assetKey(name)).create(assetDoc(gameId, row)); }
    catch (e: any) { if (e?.code === 6 && tries < 4) continue; throw e; } // (taken meanwhile: the next free name)
    await touch(gameId);
    // Its levels of detail, as Gen answered (Gen makes them itself), for the bundle.
    await rememberAsset(a);
    await tell(gameId, 'asset', { ...row, by: user.name ?? 'someone' });
    return row;
  }
}

export async function removeAsset(user: User, gameId: string, name: string) {
  await memberGame(user, gameId);
  const ref = assetsOf(gameId).doc(assetKey(name));
  if (!(await ref.get()).exists) throw new PortalError('No such asset', { status: 404 });
  await ref.delete();
  await touch(gameId);
  await tell(gameId, 'asset-removed', { name, by: user.name ?? 'someone' });
  return { ok: true };
}

/** Changes an asset's words (what it is: "cow", "spotted cow"): the engine finds it for those words. */
export async function setAssetWords(user: User, gameId: string, name: string, body: { words?: unknown; title?: unknown }) {
  await memberGame(user, gameId);
  const raw = Array.isArray(body.words) ? body.words : typeof body.words === 'string' ? String(body.words).split(',') : null;
  if (!raw) throw new PortalError('words is a list of words ("cow", "spotted cow")');
  const words = wordsOf(raw.map(String));
  const patch: Record<string, unknown> = { words: JSON.stringify(words) };
  if (body.title !== undefined) patch.title = String(body.title ?? '').slice(0, 120) || null;
  try { await assetsOf(gameId).doc(assetKey(name)).update(patch); }
  catch { throw new PortalError('No such asset', { status: 404 }); }
  await touch(gameId);
  await tell(gameId, 'asset-words', { name, words, by: user.name ?? 'someone' });
  return { ok: true, name, words };
}

export async function renameAsset(user: User, gameId: string, from: string, to: unknown) {
  await memberGame(user, gameId);
  const want = String(to ?? '').trim();
  if (!NAME_RE.test(want)) throw new PortalError('Asset names are letters, numbers, - _ and .');
  await db.runTransaction(async (t) => {
    const a = assetsOf(gameId).doc(assetKey(from));
    const b = assetsOf(gameId).doc(assetKey(want));
    const [x, y] = await Promise.all([t.get(a), t.get(b)]);
    if (y.exists) throw new PortalError(`${want} already exists`, { status: 409 });
    if (!x.exists) throw new PortalError('No such asset', { status: 404 });
    t.delete(a);
    t.create(b, { ...x.data(), name: want });
  });
  await touch(gameId);
  await tell(gameId, 'asset-renamed', { from, to: want, by: user.name ?? 'someone' });
  return { ok: true, name: want };
}

// ------------------------------------------------------------------ playing: bundles, releases, asset files
const draftAssetUrl = (gameId: string, a: AssetRow) => `/play-asset/d/${signToken({ g: gameId, a: a.asset, p: a.project }, 6 * 3600)}/${a.name}`;
const releaseAssetUrl = (g: Game, version: number, name: string) => `/play-asset/${g.slug}/${version}/${encodeURIComponent(name)}`;
export const liveAssetUrl = (g: Game, name: string) => `/play-asset/${g.slug}/live/${encodeURIComponent(name)}`;

/** The bundle's assets by name, each with its id, type, kind, title, words and levels of detail. A public bundle (live, a
 *  save, a template) points at Gen's CDN for what Gen has backed up; a draft's links are signed and never on the CDN. */
async function assetMap(rows: AssetRow[], url: (a: AssetRow) => string, o: { pub: boolean }) {
  const [lods, cdn] = await Promise.all([
    lodsOf(rows.filter((a) => typeOf(a.mime) === 'image' || typeOf(a.mime) === 'model').map((a) => a.asset)),
    o.pub ? cdnOf(rows.map((a) => a.asset)) : Promise.resolve({} as Record<string, string>),
  ]);
  return Object.fromEntries(rows.map((a) => {
    const u = url(a);
    const l = lods[a.asset];
    return [a.name, { url: cdn[a.asset] ?? u, mime: a.mime, kind: a.kind, id: a.asset, type: typeOf(a.mime), title: a.title ?? null, words: wordList(a), ...(l ? { lods: levelUrls(l, u, { cdn: o.pub }) } : {}) }];
  }));
}

/** A template's community things as asset rows, from the community library's rows (communityAssets/{a_}: one that's
 *  gone or hidden is left out: the template's scripts play on without it). */
export async function templateAssetRows(t: Template): Promise<AssetRow[]> {
  const entries = Object.entries(t.assets ?? {}).filter(([, a]) => ASSET_ID.test(a));
  if (!entries.length) return [];
  const snaps = await db.getAll(...entries.map(([, a]) => db.collection('communityAssets').doc(a)));
  const out: AssetRow[] = [];
  entries.forEach(([name, asset], i) => {
    const r = snaps[i];
    if (!r.exists || r.get('hidden')) return;
    const tags = String(r.get('tags') ?? '');
    out.push({ name, asset, project: r.get('project'), kind: r.get('kind'), mime: r.get('mime') ?? null, added_by: '', created: 0, title: r.get('title'), words: wordsOf(name, r.get('title'), r.get('category'), tags ? tags.split(' ') : []) });
  });
  return out;
}
/** /play/t/<id>'s assets: the template's community things, through the public community route, with their levels. */
export async function templateAssets(tid: string | null | undefined) {
  const t = (await templates()).TEMPLATES.find((x) => x.id === tid);
  return t ? assetMap(await templateAssetRows(t), (a) => `/v1/community/${a.asset}/file`, { pub: true }) : {};
}

const filesMap = async (gameId: string) => Object.fromEntries((await filesOf(gameId).get()).docs.map((d) => [d.get('path') as string, d.get('content') as string]));

/** The draft as the runtime takes it: every file, every asset with a link. Members only. */
export async function draftBundle(user: User, gameId: string) {
  const { game } = await memberGame(user, gameId, 'player');
  const [files, assets] = await Promise.all([filesMap(game.id), listAssets(game.id)]);
  return { id: game.id, title: game.title, version: null, files, assets: await assetMap(assets, (a) => draftAssetUrl(game.id, a), { pub: false }), net: { token: editToken(game.id, user) }, me: { id: user.id, name: user.name } };
}

// ------------------------------------------------------------------ the world (scene.json), changed by ops
/** Applies world edits (scene.ts ops) to the game's scene.json, in one transaction, and saves it. */
export async function sceneOps(user: User | null, gameId: string, ops: unknown, o: { by?: string; conn?: string } = {}) {
  if (user) await memberGame(user, gameId);
  const r = await db.runTransaction(async (t) => {
    const ref = filesOf(gameId).doc(fileKey('scene.json'));
    const cur = await t.get(ref);
    const res = applyOps(parseScene(cur.exists ? cur.get('content') : null), ops);
    let rev = cur.exists ? Number(cur.get('rev')) : 0;
    let file: FileRow | null = null;
    if (res.applied.length) {
      const content = sceneText(res.scene);
      if (Buffer.byteLength(content) > LIMITS.fileBytes) throw new PortalError(`Files up to ${LIMITS.fileBytes / 1024} KB`, { status: 413 });
      const w = await writeFileIn(t, user, gameId, 'scene.json', content, undefined);
      rev = w.file.rev;
      if (w.changed) file = w.file;
    }
    return { ...res, rev, file };
  });
  if (r.file) await tell(gameId, 'file', { ...r.file, by: o.by ?? (user ? user.name ?? 'someone' : 'Assistant'), conn: o.conn ?? null, ops: true });
  const { file: _f, ...out } = r;
  return out;
}

/** A copy of a published game (as it is now: files and assets) as a new game of this customer's. */
export async function remix(user: User, body: { slug?: unknown }) {
  const g = await gameBySlug(String(body.slug ?? ''));
  if (!g || (g.hidden && g.owner_id !== user.id)) throw new PortalError('No such game', { status: 404 });
  const plan = planOf(await getUser(user.id));
  if ((await ownedCount(user.id)) >= plan.games) throw new PortalError(`Your ${plan.name} plan has room for ${plan.games} games. Upgrade for more, or delete one.`, { status: 402 });
  const [files, assets] = await Promise.all([filesMap(g.id), listAssets(g.id)]);
  // The assets stay the original maker's files in Gen; the remix points at them, the way a release does.
  const gameId = await makeGame(user, { title: `${g.title} remix`.slice(0, 80), description: g.description, files, assets });
  await systemNote(gameId, `Remixed from "${g.title}" by ${await nameOf(g.owner_id)}.`);
  return summary((await getGame(gameId))!, user.id);
}

// Saves: the files and assets as JSON text, in the save's document when they fit, else in parts beside it.
const PART = 900_000;
async function writeRelease(t: Transaction, gameId: string, version: number, row: { notes: string; files: string; assets: string; created: number; created_by: string }) {
  const ref = releasesOf(gameId).doc(String(version));
  const big = row.files.length + row.assets.length > PART;
  if (!big) return void t.create(ref, { game_id: gameId, version, ...row, parts: 0 });
  const text = JSON.stringify({ files: row.files, assets: row.assets });
  const n = Math.ceil(text.length / PART);
  t.create(ref, { game_id: gameId, version, notes: row.notes, created: row.created, created_by: row.created_by, files: null, assets: null, parts: n });
  for (let i = 0; i < n; i++) t.create(ref.collection('parts').doc(String(i)), { i, text: text.slice(i * PART, (i + 1) * PART) });
}
async function readRelease(gameId: string, version: number) {
  const ref = releasesOf(gameId).doc(String(version));
  const s = await ref.get();
  if (!s.exists) return null;
  let files = s.get('files') as string | null;
  let assets = s.get('assets') as string | null;
  if (Number(s.get('parts') ?? 0) > 0) {
    const parts = (await ref.collection('parts').get()).docs.sort((a, b) => Number(a.get('i')) - Number(b.get('i'))).map((d) => d.get('text')).join('');
    const both = JSON.parse(parts);
    files = both.files;
    assets = both.assets;
  }
  return { version, created: Number(s.get('created')), files: JSON.parse(files ?? '{}') as Record<string, string>, assets: JSON.parse(assets ?? '[]') as AssetRow[] };
}

/** Save: a numbered copy of the game as it is now, in its history (the owner can bring any one back). */
export async function saveGame(user: User, gameId: string, body: { notes?: unknown; auto?: boolean } = {}) {
  const { game } = await memberGame(user, gameId);
  const [files, assetRows] = await Promise.all([filesMap(game.id), listAssets(game.id)]);
  const assets = assetRows.map(({ name, asset, project, kind, mime, words, title }) => ({ name, asset, project, kind, mime, words, title }));
  const version = await db.runTransaction(async (t) => {
    const top = await t.get(releasesOf(game.id).orderBy('version', 'desc').limit(1).select('version'));
    const v = (top.empty ? 0 : Number(top.docs[0].get('version'))) + 1;
    await writeRelease(t, game.id, v, { notes: String(body.notes ?? '').slice(0, 2000), files: JSON.stringify(files), assets: JSON.stringify(assets), created: Date.now(), created_by: user.id });
    t.update(gref(game.id), { live_version: v, updated: Date.now() });
    return v;
  });
  const out = { version, url: `/play/${game.slug}`, versionUrl: `/play/${game.slug}/v/${version}`, releases: await releases(game.id), saved: Date.now() };
  await tell(game.id, 'release', { ...out, by: user.name ?? 'someone' });
  if (!body.auto) await systemNote(game.id, `${user.name ?? 'someone'} saved (save ${version}).`);
  return out;
}
export const publish = saveGame;

/** Puts an earlier release back live (its files stay frozen; the draft is untouched). */
export async function setLive(user: User, gameId: string, version: unknown) {
  const { game } = await memberGame(user, gameId, 'owner');
  const v = version === null ? null : Number(version);
  if (v !== null && (!Number.isInteger(v) || !(await releasesOf(game.id).doc(String(v)).get()).exists)) throw new PortalError('No such release', { status: 404 });
  await gref(game.id).update({ live_version: v, updated: Date.now() });
  await tell(game.id, 'game', await summary((await getGame(game.id))!));
  return { ok: true, liveVersion: v };
}

/** The owner brings a save back: its files and assets become the live game. What was there is saved first, so a
 *  restore can itself be undone from the history. */
export async function restoreRelease(user: User, gameId: string, version: number) {
  const { game } = await memberGame(user, gameId, 'owner');
  const r = Number.isInteger(version) ? await readRelease(game.id, version) : null;
  if (!r) throw new PortalError('No such save', { status: 404 });
  const before = await saveGame(user, game.id, { notes: `Before bringing back save ${version}`, auto: true });
  const [oldFiles, oldAssets] = await Promise.all([filesOf(game.id).get(), assetsOf(game.id).select().get()]);
  // Revisions keep counting up, so an editor still holding an older one is told to merge.
  const revs = new Map(oldFiles.docs.map((d) => [d.get('path') as string, Number(d.get('rev'))]));
  const now = Date.now();
  const entries = Object.entries(r.files);
  await writeAll([
    ...oldAssets.docs.map((d) => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
    ...oldFiles.docs.map((d) => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
  ]);
  await writeAll([
    ...r.assets.map((a) => (b: FirebaseFirestore.WriteBatch) => b.set(assetsOf(game.id).doc(assetKey(a.name)), assetDoc(game.id, { ...a, added_by: a.added_by ?? user.id, created: a.created ?? now }))),
    ...entries.map(([path, content]) => (b: FirebaseFirestore.WriteBatch) => b.set(filesOf(game.id).doc(fileKey(path)), fileDoc(game.id, path, content, (revs.get(path) ?? 0) + 1, now, user.id))),
    (b) => b.update(gref(game.id), { updated: now, files_count: entries.length, files_bytes: entries.reduce((n, [, c]) => n + c.length, 0) }),
  ]);
  await tell(game.id, 'reload', { by: user.name ?? 'someone', reason: `brought back save ${version}` });
  await systemNote(game.id, `${user.name ?? 'someone'} brought back save ${version} (what was there is save ${before.version}).`);
  return openGame(user, game.id);
}

export async function releases(gameId: string) {
  const s = await releasesOf(gameId).orderBy('version', 'desc').limit(50).select('version', 'notes', 'created', 'created_by').get();
  const rows = s.docs.map((d) => ({ version: Number(d.get('version')), notes: String(d.get('notes') ?? ''), created: Number(d.get('created')), created_by: (d.get('created_by') ?? null) as string | null }));
  const names = await namesOf(rows.map((r) => r.created_by));
  return rows.map((r) => ({ ...r, by: (r.created_by && names.get(r.created_by)) || 'someone' }));
}

export const CLOSED = 'This world is closed';
/** Is this slug a game an admin has closed? */
export const isClosed = async (slug: string) => Boolean((await gameBySlug(slug))?.hidden);

export const REPORT_REASONS = { broken: 'Broken', scary: 'Scary or rude', scam: 'Scam', other: 'Other' } as const;
const reportsCol = () => db.collection('gamesReports');

/** A report of a live game, from anyone (signed in or not). The route limits how many an address may send. */
export async function reportGame(slug: string, body: { reason?: unknown; note?: unknown }, reporterId: string | null, ip: string) {
  const g = await gameBySlug(slug);
  if (!g) throw new PortalError('No such game', { status: 404 });
  const reason = String(body.reason ?? '');
  if (!(reason in REPORT_REASONS)) throw new PortalError('Pick a reason: broken, scary or rude, scam, or other');
  const note = String(body.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  // The same person (account or address) reporting the same game again for the same reason is one report.
  const rid = `rp_${crypto.createHash('sha256').update(`${g.id}|${reason}|${reporterId ?? `ip:${ip}`}`).digest('hex').slice(0, 12)}`;
  await reportsCol().doc(rid).create({ id: rid, game_id: g.id, reason, note, reporter_id: reporterId, ip, created: Date.now() }).catch((e) => { if (e?.code !== 6) throw e; });
  return { ok: true };
}

/** Admin: close a game (the owner is told why on their Games page) or open it again. */
export async function setHidden(adminName: string, gameId: string, hidden: boolean, reason?: unknown) {
  const g = await getGame(gameId);
  if (!g) throw new PortalError('No such game', { status: 404 });
  if (hidden) {
    const why = String(reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'It was reported and an admin closed it.';
    await gref(g.id).update({ hidden: 1, hidden_reason: why, hidden_at: Date.now(), hidden_by: adminName });
    await netKick(`g/${g.id}/p/*`);
  } else await gref(g.id).update({ hidden: 0, hidden_reason: null, hidden_at: null, hidden_by: null });
  return (await getGame(g.id))!;
}

/** Admin: games that have reports (or are closed), with the owner and the reports, most reported first. */
export async function reportedGames() {
  const [reps, closed] = await Promise.all([reportsCol().orderBy('created', 'desc').limit(5000).get(), gamesCol().where('hidden', '==', 1).limit(200).get()]);
  const byGame = new Map<string, any[]>();
  for (const d of reps.docs) { const r = d.data(); if (!byGame.has(r.game_id)) byGame.set(r.game_id, []); byGame.get(r.game_id)!.push(r); }
  const ids = [...new Set([...byGame.keys(), ...closed.docs.map((d) => d.id)])].filter((x) => GAME_ID.test(x));
  const gs: Game[] = [];
  for (let i = 0; i < ids.length; i += 300) for (const s of await db.getAll(...ids.slice(i, i + 300).map((g) => gref(g)))) { const g = asGame(s); if (g) gs.push(g); }
  const people = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  const want = [...new Set([...gs.map((g) => g.owner_id), ...reps.docs.map((d) => d.get('reporter_id')).filter(Boolean)])];
  for (let i = 0; i < want.length; i += 300) for (const s of await db.getAll(...want.slice(i, i + 300).map((u) => users().doc(u)))) if (s.exists) people.set(s.id, s);
  const rows = gs.map((g) => {
    const rs = byGame.get(g.id) ?? [];
    return { g, rs, last: rs.length ? Math.max(...rs.map((r) => Number(r.created))) : null };
  }).sort((a, b) => Number(Boolean(a.g.hidden)) - Number(Boolean(b.g.hidden)) || Number(b.last ?? 0) - Number(a.last ?? 0)).slice(0, 200);
  return {
    games: rows.map(({ g, rs, last }) => {
      const owner = people.get(g.owner_id);
      const byReason: Record<string, number> = {};
      for (const r of rs) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
      return {
        id: g.id, slug: g.slug, title: g.title, owner: { id: g.owner_id, name: owner?.get('name') ?? null, email: owner?.get('email') ?? null }, plays: g.plays ?? 0, url: `/play/${g.slug}`,
        hidden: Boolean(g.hidden), hiddenReason: g.hidden_reason ?? null, hiddenAt: g.hidden_at ?? null, hiddenBy: g.hidden_by ?? null, reports: rs.length, lastReport: last,
        byReason,
        recent: rs.slice(0, 10).map((r) => ({ reason: r.reason, note: r.note, created: r.created, by: (r.reporter_id && people.get(r.reporter_id)?.get('name')) ?? 'a visitor' })),
      };
    }),
  };
}

const PLAY_WINDOW_MS = 3600_000;
/** Counts a play of a game, once per player per hour (reloading is the same play). Returns whether it counted. */
export async function countPlay(gameId: string, player: string, now = Date.now()) {
  const ref = db.collection('playSeen').doc(`${gameId}_${crypto.createHash('sha256').update(player).digest('hex').slice(0, 24)}`);
  return db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (s.exists && Number(s.get('at')) > now - PLAY_WINDOW_MS) return false;
    t.set(ref, { game_id: gameId, who: player, at: now, expires: new Date(now + 2 * PLAY_WINDOW_MS) });
    t.update(gref(gameId), { plays: FieldValue.increment(1) });
    return true;
  });
}

/** What a player loads: the game as it is right now (every game is live), or a save when asked. Anyone with the link. */
export async function playBundle(slug: string, version?: number | null, player: string | null = null) {
  const g = await gameBySlug(slug);
  if (!g) throw new PortalError('No such game', { status: 404 });
  if (g.hidden) throw new PortalError(CLOSED, { status: 410 });
  const owner = await getUser(g.owner_id);
  if (player) await countPlay(g.id, player).catch((e) => console.warn(`[portal] count play: ${e.message}`));
  if (!version) {
    const [files, assets] = await Promise.all([filesMap(g.id), listAssets(g.id)]);
    return { id: g.id, slug: g.slug, title: g.title, description: g.description, by: owner?.name ?? null, version: null, live: true, visitors: g.visitors ?? 'play', updated: g.updated, files, assets: await assetMap(assets, (a) => liveAssetUrl(g, a.name), { pub: true }) };
  }
  const r = Number.isInteger(version) ? await readRelease(g.id, version) : null;
  if (!r) throw new PortalError('No such save', { status: 404 });
  return { id: g.id, slug: g.slug, title: g.title, description: g.description, by: owner?.name ?? null, version: r.version, published: r.created, files: r.files, assets: await assetMap(r.assets, (a) => releaseAssetUrl(g, r.version, a.name), { pub: true }) };
}

/** Which Gen file an asset link means: a release's (public with the game) or a signed draft link. */
export async function resolvePlayAsset(parts: { token?: string; slug?: string; version?: number | 'live'; name?: string }) {
  if (parts.token) {
    const t = verifyToken<{ g: string; a: string; p: string }>(parts.token);
    if (!t || !ASSET_ID.test(t.a)) throw new PortalError('This preview link has expired; reload the editor', { status: 410 });
    return { asset: t.a, project: t.p, immutable: false };
  }
  const g = await gameBySlug(String(parts.slug));
  if (!g || g.hidden) throw new PortalError('No such game', { status: 404 });
  if (parts.version === 'live') {
    const a = await assetsOf(g.id).doc(assetKey(String(parts.name))).get();
    if (!a.exists) throw new PortalError('No such asset', { status: 404 });
    return { asset: a.get('asset') as string, project: a.get('project') as string, immutable: false };
  }
  const v = Number(parts.version ?? 0);
  const r = Number.isInteger(v) && v > 0 ? await readRelease(g.id, v) : null;
  const a = r ? r.assets.find((x) => x.name === parts.name) : null;
  if (!a) throw new PortalError('No such asset', { status: 404 });
  return { asset: a.asset, project: a.project, immutable: true };
}

/** The public games, all live: most people in them right now first (then most played), or newest, or most played. */
export async function gallery(sort: 'live' | 'popular' | 'new' = 'live', limit = 60) {
  const [T, counts] = await Promise.all([templates(), allLiveCounts()]);
  const overseer = T.featured().map((t) => ({ ...t, ...counts(`t:${t.id}`) }));
  const q = await gamesCol().where('visibility', '==', 'public').where('hidden', '==', 0).orderBy(sort === 'new' ? 'updated' : 'plays', 'desc').limit(500).get();
  const rows = q.docs.map((d) => asGame(d)!);
  const names = await namesOf(rows.map((g) => g.owner_id));
  const covers = new Map<string, string>();
  await Promise.all(rows.filter((g) => g.cover).map(async (g) => { const a = await assetsOf(g.id).doc(assetKey(g.cover!)).get(); if (a.exists) covers.set(g.id, a.get('asset')); }));
  const cdn = await cdnOf([...covers.values()]);
  const list = rows.filter((g) => names.has(g.owner_id)).map((g) => {
    const cover = covers.get(g.id);
    return { slug: g.slug, title: g.title, description: g.description, by: names.get(g.owner_id) ?? null, plays: g.plays ?? 0, updated: g.updated, url: `/play/${g.slug}`, visitors: g.visitors ?? 'play', cover: cover ? cdn[cover] ?? liveAssetUrl(g, g.cover!) : null, ...counts(g.id) };
  });
  if (sort === 'live') list.sort((a, b) => b.playing + b.building - (a.playing + a.building) || b.plays - a.plays);
  return { featured: overseer, games: list.slice(0, Math.max(1, Math.min(200, limit))) };
}

// ------------------------------------------------------------------ chat
export type ChatRow = { id: string; game_id: string; user_id: string | null; role: 'user' | 'ai' | 'system'; text: string; data: any; created: number; name?: string | null };
const chatName = async (role: string, userId: string | null) => (role === 'ai' ? 'Assistant' : role === 'system' ? null : await nameOf(userId));

export async function chatMessage(gameId: string, userId: string | null, role: ChatRow['role'], text: string, data: unknown = null) {
  const row: ChatRow = { id: id('m_', 8), game_id: gameId, user_id: userId, role, text: text.slice(0, 20_000), data, created: Date.now() };
  await chatOf(gameId).doc(row.id).create({ ...row, data: data ? JSON.stringify(data) : null });
  const out = { ...row, name: await chatName(role, userId) };
  await tell(gameId, 'chat', out);
  return out;
}

export async function updateChatData(gameId: string, messageId: string, data: unknown) {
  const ref = chatOf(gameId).doc(messageId);
  await ref.update({ data: JSON.stringify(data) });
  const r = (await ref.get()).data() as any;
  if (r) await tell(gameId, 'chat', { ...r, data, name: await chatName(r.role, r.user_id) });
}
export async function chatData(gameId: string, messageId: string) {
  if (!/^m_[0-9a-f]+$/.test(messageId)) return null;
  const s = await chatOf(gameId).doc(messageId).get();
  const d = s.exists ? s.get('data') : null;
  return d ? JSON.parse(d) : null;
}

const systemNote = (gameId: string, text: string) => chatMessage(gameId, null, 'system', text).catch((e) => console.warn(`[portal] chat note: ${e.message}`));

/** The last messages (oldest first), for the editor and the assistant's context. */
export async function recentChat(gameId: string, limit: number) {
  const s = await chatOf(gameId).orderBy('created', 'desc').limit(limit).get();
  return s.docs.map((d) => d.data() as any).reverse();
}

export async function chatHistory(user: User, gameId: string, limit = 80) {
  await memberGame(user, gameId, 'player');
  const rows = await recentChat(gameId, Math.max(1, Math.min(300, limit)));
  const names = await namesOf(rows.map((r) => r.user_id));
  return { messages: rows.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null, name: r.role === 'ai' ? 'Assistant' : r.role === 'system' ? null : names.get(r.user_id) ?? 'someone' })) };
}

export async function postChat(user: User, gameId: string, text: unknown) {
  await memberGame(user, gameId, 'player');
  const t = String(text ?? '').trim();
  if (!t) throw new PortalError('Say something');
  return chatMessage(gameId, user.id, 'user', t);
}

// ------------------------------------------------------------------ routes (server.ts's, the same paths and answers)
const G = '(g_[0-9a-f]+)';
const body = (req: any) => json(req) ?? {};
const connOf = (req: any) => String(req.headers['x-conn'] ?? '') || undefined;

route('GET', '/v1/games', async ({ req }) => listGames(await requireUser(req)));
route('POST', '/v1/games', async ({ req }) => createGame(await requireUser(req), body(req)));
route('POST', '/v1/remix', async ({ req }) => remix(await requireUser(req), body(req)));
route('POST', /^\/v1\/play\/([a-z0-9-]+)\/join$/, async ({ req, params }) => joinToBuild(await requireUser(req), params[0]));
route('GET', /^\/v1\/invites\/([\w-]+)$/, ({ params }) => inviteInfo(params[0]));
route('POST', /^\/v1\/invites\/([\w-]+)\/accept$/, async ({ req, params }) => acceptInvite(await requireUser(req), params[0]));

route('PATCH', new RegExp(`^/v1/games/${G}$`), async ({ req, params }) => updateGame(await requireUser(req), params[0], body(req)));
route('POST', new RegExp(`^/v1/games/${G}$`), async ({ req, params }) => updateGame(await requireUser(req), params[0], body(req)));
route('DELETE', new RegExp(`^/v1/games/${G}$`), async ({ req, params }) => deleteGame(await requireUser(req), params[0]));
route('GET', new RegExp(`^/v1/games/${G}/live$`), async ({ req, res, url, params }) => {
  const user = await requireUser(req);
  await memberGame(user, params[0], 'player');
  const last = String(req.headers['last-event-id'] ?? url.searchParams.get('last') ?? '') || null;
  await join(params[0], user, req, res, last);
});
route('POST', new RegExp(`^/v1/games/${G}/presence$`), async ({ req, params }) => {
  const user = await requireUser(req);
  await memberGame(user, params[0], 'player');
  return setPresence(params[0], connOf(req) ?? '', user.id, body(req));
});
for (const m of ['PUT', 'POST']) {
  route(m, new RegExp(`^/v1/games/${G}/files$`), async ({ req, res, params }) => {
    const user = await requireUser(req);
    await memberGame(user, params[0], 'editor');
    try { return await writeFile(user, params[0], body(req), { conn: connOf(req) }); }
    catch (e: any) { if (e.status === 409 && e.file) return send(res, 409, { error: e.message, file: e.file }); throw e; }
  });
}
route('DELETE', new RegExp(`^/v1/games/${G}/files$`), async ({ req, url, params }) => deleteFile(await requireUser(req), params[0], url.searchParams.get('path'), connOf(req)));
route('POST', new RegExp(`^/v1/games/${G}/files/rename$`), async ({ req, params }) => renameFile(await requireUser(req), params[0], body(req), connOf(req)));
route('POST', new RegExp(`^/v1/games/${G}/assets$`), async ({ req, params }) => addAsset(await requireUser(req), params[0], body(req)));
route('DELETE', new RegExp(`^/v1/games/${G}/assets/([^/]+)$`), async ({ req, params }) => removeAsset(await requireUser(req), params[0], decodeURIComponent(params[1])));
route('POST', new RegExp(`^/v1/games/${G}/assets/([^/]+)/rename$`), async ({ req, params }) => renameAsset(await requireUser(req), params[0], decodeURIComponent(params[1]), body(req).name));
route('POST', new RegExp(`^/v1/games/${G}/assets/([^/]+)/words$`), async ({ req, params }) => setAssetWords(await requireUser(req), params[0], decodeURIComponent(params[1]), body(req)));
route('GET', new RegExp(`^/v1/games/${G}/bundle$`), async ({ req, params }) => draftBundle(await requireUser(req), params[0]));
route('POST', new RegExp(`^/v1/games/${G}/scene$`), async ({ req, params }) => {
  const user = await requireUser(req);
  const b = body(req);
  const conn = String(req.headers['x-room-conn'] ?? '') || undefined;
  const r = await sceneOps(user, params[0], b.ops, { by: user.name ?? undefined, conn });
  // X-Room-Conn: the sender's own engine already shows the change.
  if (r.applied.length) await broadcastOps(params[0], r.applied, user.name ?? 'Someone', typeof b.fx === 'string' ? b.fx.slice(0, 20) : null, conn);
  return { errors: r.errors, created: r.created, rev: r.rev };
});
for (const sub of ['save', 'publish']) route('POST', new RegExp(`^/v1/games/${G}/${sub}$`), async ({ req, params }) => saveGame(await requireUser(req), params[0], body(req)));
route('GET', new RegExp(`^/v1/games/${G}/saves$`), async ({ req, params }) => { await memberGame(await requireUser(req), params[0], 'player'); return { saves: await releases(params[0]) }; });
route('POST', new RegExp(`^/v1/games/${G}/live-version$`), async ({ req, params }) => setLive(await requireUser(req), params[0], body(req).version));
route('POST', new RegExp(`^/v1/games/${G}/releases/(\\d+)/restore$`), async ({ req, params }) => restoreRelease(await requireUser(req), params[0], Number(params[1])));
route('POST', new RegExp(`^/v1/games/${G}/invites$`), async ({ req, params }) => createInvite(await requireUser(req), params[0]));
route('POST', new RegExp(`^/v1/games/${G}/members/(${USER_ID})$`), async ({ req, params }) => setMemberRole(await requireUser(req), params[0], params[1], body(req).role));
route('DELETE', new RegExp(`^/v1/games/${G}/members/(${USER_ID})$`), async ({ req, params }) => removeMember(await requireUser(req), params[0], params[1]));
route('GET', new RegExp(`^/v1/games/${G}/chat$`), async ({ req, url, params }) => chatHistory(await requireUser(req), params[0], Number(url.searchParams.get('limit')) || 80));
route('POST', new RegExp(`^/v1/games/${G}/chat$`), async ({ req, params }) => postChat(await requireUser(req), params[0], body(req).text));

// Admin (reports and closing worlds): anyone else gets a 404, as /v1/admin/* does.
async function requireAdmin(req: any) {
  const u = await requireUser(req).catch(() => null);
  if (!u || u.role !== 'admin') throw new PortalError('Not found', { status: 404 });
  return u;
}
route('GET', '/v1/admin/reports', async ({ req }) => { await requireAdmin(req); return reportedGames(); });
route('POST', /^\/v1\/admin\/games\/(g_[\w-]+)\/(hide|unhide)$/, async ({ req, params }) => {
  const admin = await requireAdmin(req);
  return { game: await summary(await setHidden(admin.email, params[0], params[1] === 'hide', body(req).reason)) };
});
