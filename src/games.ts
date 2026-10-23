// Games: what customers build here. A game is scripts (text files run by the Hawkes Play runtime, public/play/runtime.js,
// on top of Babylon.js) plus named assets from Gen's library, edited together by its members in real time (live.ts) and
// published as numbered releases anyone can play at /play/<slug>. A release is a frozen copy of the files and the asset
// list, so a published game never changes under its players.
import crypto from 'node:crypto';
import { db, tx } from './db.ts';
import { gen } from './gen.ts';
import { sign, verify } from './sign.ts';
import { planOf } from './plans.ts';
import { getUser, type User } from './users.ts';
import { id, PortalError } from './util.ts';
import { TEMPLATES, featured } from './templates.ts';
import { broadcast, kick } from './live.ts';
import { addFriend } from './friends.ts';
import { applyOps, parseScene, sceneText } from './scene.ts';
import { editToken, kickFromRooms } from './rooms.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'public',
  live_version INTEGER,
  cover TEXT,
  plays INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS games_owner ON games (owner_id);
CREATE TABLE IF NOT EXISTS game_members (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  added INTEGER NOT NULL,
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS game_members_user ON game_members (user_id);
CREATE TABLE IF NOT EXISTS game_invites (
  code TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS game_files (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  rev INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (game_id, path)
);
CREATE TABLE IF NOT EXISTS game_assets (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  asset TEXT NOT NULL,
  project TEXT NOT NULL,
  kind TEXT,
  mime TEXT,
  added_by TEXT,
  created INTEGER NOT NULL,
  PRIMARY KEY (game_id, name)
);
CREATE TABLE IF NOT EXISTS game_releases (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  files TEXT NOT NULL,
  assets TEXT NOT NULL,
  created INTEGER NOT NULL,
  created_by TEXT,
  PRIMARY KEY (game_id, version)
);
CREATE TABLE IF NOT EXISTS game_chat (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id TEXT,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  data TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS game_chat_game ON game_chat (game_id, created);
`);

export type Game = { id: string; slug: string; title: string; description: string; owner_id: string; visibility: 'public' | 'unlisted'; live_version: number | null; cover: string | null; plays: number; created: number; updated: number };
export type Role = 'owner' | 'editor';
export type FileRow = { path: string; content: string; rev: number; updated: number; updated_by: string | null };
export type AssetRow = { name: string; asset: string; project: string; kind: string | null; mime: string | null; added_by: string | null; created: number };

// Limits that keep one game a reasonable size for the browser and the database.
export const LIMITS = { files: 150, fileBytes: 256 * 1024, totalBytes: 3 * 1024 * 1024, assets: 300 };
const PATH_RE = /^(?:[a-z0-9_-]+\/){0,4}[a-z0-9_.-]+\.(js|json|md|txt|css)$/i;
const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;

export const getGame = (gameId: string) => (db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as Game | undefined) ?? null;
export const gameBySlug = (slug: string) => (db.prepare('SELECT * FROM games WHERE slug = ?').get(String(slug).toLowerCase()) as Game | undefined) ?? null;
const roleOf = (gameId: string, userId: string) => (db.prepare('SELECT role FROM game_members WHERE game_id = ? AND user_id = ?').get(gameId, userId) as { role: Role } | undefined)?.role ?? null;

/** The game, if this customer is one of its members (else 404: a game you're not in doesn't exist for you). */
export function memberGame(user: User, gameId: string, need: Role = 'editor') {
  const g = getGame(gameId);
  const role = g ? roleOf(g.id, user.id) : null;
  if (!g || !role) throw new PortalError('No such game', { status: 404 });
  if (need === 'owner' && role !== 'owner') throw new PortalError('Only the owner can do that', { status: 403 });
  return { game: g, role };
}

const touch = (gameId: string) => db.prepare('UPDATE games SET updated = ? WHERE id = ?').run(Date.now(), gameId);
const nameOf = (userId: string | null) => (userId ? getUser(userId)?.name ?? 'someone' : 'someone');

function slugFor(title: string) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'game';
  for (;;) {
    const slug = `${base}-${crypto.randomBytes(2).toString('hex')}`;
    if (!gameBySlug(slug)) return slug;
  }
}

function cleanTitle(t: unknown) {
  const s = String(t ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!s) throw new PortalError('Give the game a title');
  return s;
}

// ------------------------------------------------------------------ games
export function summary(g: Game, userId?: string) {
  const members = (db.prepare('SELECT m.user_id, m.role, u.name FROM game_members m JOIN users u ON u.id = m.user_id WHERE m.game_id = ? ORDER BY m.added').all(g.id) as { user_id: string; role: Role; name: string }[]).map((m) => ({ id: m.user_id, name: m.name, role: m.role }));
  return {
    id: g.id, slug: g.slug, title: g.title, description: g.description, visibility: g.visibility, liveVersion: g.live_version, cover: g.cover, plays: g.plays, created: g.created, updated: g.updated,
    role: userId ? roleOf(g.id, userId) : null,
    members,
    playUrl: `/play/${g.slug}`,
  };
}

export function listGames(user: User) {
  const rows = db.prepare('SELECT g.* FROM games g JOIN game_members m ON m.game_id = g.id WHERE m.user_id = ? ORDER BY g.updated DESC').all(user.id) as Game[];
  const plan = planOf(getUser(user.id));
  const owned = rows.filter((g) => g.owner_id === user.id).length;
  return { games: rows.map((g) => summary(g, user.id)), owned, limit: plan.games, templates: TEMPLATES.map(({ id, name, blurb }) => ({ id, name, blurb })) };
}

export function createGame(user: User, body: { title?: unknown; template?: unknown; description?: unknown }) {
  const plan = planOf(getUser(user.id));
  const owned = Number((db.prepare('SELECT COUNT(*) AS n FROM games WHERE owner_id = ?').get(user.id) as { n: number }).n);
  if (owned >= plan.games) throw new PortalError(`Your ${plan.name} plan has room for ${plan.games} games. Upgrade for more, or delete one.`, { status: 402 });
  const title = cleanTitle(body.title);
  const template = TEMPLATES.find((t) => t.id === String(body.template ?? 'blank')) ?? TEMPLATES[0];
  const now = Date.now();
  const gameId = id('g_', 8);
  tx(() => {
    db.prepare('INSERT INTO games (id, slug, title, description, owner_id, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)').run(gameId, slugFor(title), title, String(body.description ?? template.blurb).slice(0, 400), user.id, now, now);
    db.prepare("INSERT INTO game_members (game_id, user_id, role, added) VALUES (?, ?, 'owner', ?)").run(gameId, user.id, now);
    for (const [path, content] of Object.entries(template.files(title))) db.prepare('INSERT INTO game_files (game_id, path, content, rev, updated, updated_by) VALUES (?, ?, ?, 1, ?, ?)').run(gameId, path, content, now, user.id);
  });
  return summary(getGame(gameId)!, user.id);
}

export function updateGame(user: User, gameId: string, body: { title?: unknown; description?: unknown; visibility?: unknown; cover?: unknown }) {
  const { game } = memberGame(user, gameId);
  const patch: Partial<Game> = {};
  if (body.title !== undefined) patch.title = cleanTitle(body.title);
  if (body.description !== undefined) patch.description = String(body.description ?? '').slice(0, 400);
  if (body.cover !== undefined) {
    const c = body.cover ? String(body.cover) : null;
    if (c && !db.prepare('SELECT 1 FROM game_assets WHERE game_id = ? AND name = ?').get(game.id, c)) throw new PortalError(`No asset named ${c} in this game`);
    patch.cover = c;
  }
  if (body.visibility !== undefined) {
    if (roleOf(game.id, user.id) !== 'owner') throw new PortalError('Only the owner can change who sees the game', { status: 403 });
    if (!['public', 'unlisted'].includes(String(body.visibility))) throw new PortalError('visibility is public or unlisted');
    patch.visibility = body.visibility as Game['visibility'];
  }
  const keys = Object.keys(patch) as (keyof Game)[];
  if (keys.length) db.prepare(`UPDATE games SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated = ? WHERE id = ?`).run(...keys.map((k) => patch[k] as any), Date.now(), game.id);
  const out = summary(getGame(game.id)!, user.id);
  broadcast(game.id, 'game', out);
  return out;
}

export function deleteGame(user: User, gameId: string) {
  const { game } = memberGame(user, gameId, 'owner');
  db.prepare('DELETE FROM games WHERE id = ?').run(game.id);
  broadcast(game.id, 'deleted', { id: game.id });
  return { ok: true };
}

/** Everything the editor opens with: the game, its files, its assets, recent releases. */
export function openGame(user: User, gameId: string) {
  const { game } = memberGame(user, gameId);
  return {
    game: summary(game, user.id),
    files: db.prepare('SELECT path, content, rev, updated, updated_by FROM game_files WHERE game_id = ? ORDER BY path').all(game.id) as FileRow[],
    assets: listAssets(game.id),
    releases: releases(game.id),
    plan: planOf(getUser(game.owner_id)),
  };
}

// ------------------------------------------------------------------ members and invites
export function createInvite(user: User, gameId: string) {
  const { game } = memberGame(user, gameId);
  const code = crypto.randomBytes(9).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO game_invites (code, game_id, created_by, created, expires) VALUES (?, ?, ?, ?, ?)').run(code, game.id, user.id, now, now + 7 * 24 * 3600_000);
  return { code, path: `/app/join/${code}`, expires: now + 7 * 24 * 3600_000 };
}

const liveInvite = (code: string) => {
  const inv = db.prepare('SELECT * FROM game_invites WHERE code = ?').get(String(code)) as { code: string; game_id: string; created_by: string; expires: number; revoked: number } | undefined;
  if (!inv || inv.revoked || inv.expires < Date.now()) throw new PortalError('This invite has expired. Ask for a new link.', { status: 410 });
  const game = getGame(inv.game_id);
  if (!game) throw new PortalError('That game no longer exists', { status: 410 });
  return { inv, game };
};

/** What an invite is for, before accepting it. */
export function inviteInfo(code: string) {
  const { inv, game } = liveInvite(code);
  return { game: { id: game.id, title: game.title, description: game.description }, from: nameOf(inv.created_by) };
}

export function acceptInvite(user: User, code: string) {
  const { inv, game } = liveInvite(code);
  if (roleOf(game.id, user.id)) return summary(game, user.id);
  const plan = planOf(getUser(game.owner_id));
  const count = Number((db.prepare('SELECT COUNT(*) AS n FROM game_members WHERE game_id = ?').get(game.id) as { n: number }).n);
  if (count >= plan.members) throw new PortalError(`This game is full: the owner's ${plan.name} plan allows ${plan.members} people per game.`, { status: 402 });
  db.prepare("INSERT INTO game_members (game_id, user_id, role, added) VALUES (?, ?, 'editor', ?)").run(game.id, user.id, Date.now());
  addFriend(inv.created_by, user.id);
  const out = summary(game, user.id);
  broadcast(game.id, 'game', summary(game));
  systemNote(game.id, `${nameOf(user.id)} joined the game.`);
  return out;
}

export function removeMember(user: User, gameId: string, memberId: string) {
  const { game, role } = memberGame(user, gameId);
  // The owner removes anyone else; anyone may leave.
  if (memberId === game.owner_id) throw new PortalError('The owner cannot leave their own game; delete it instead');
  if (memberId !== user.id && role !== 'owner') throw new PortalError('Only the owner can remove people', { status: 403 });
  db.prepare('DELETE FROM game_members WHERE game_id = ? AND user_id = ?').run(game.id, memberId);
  broadcast(game.id, 'game', summary(game));
  broadcast(game.id, 'removed', { user: memberId });
  kick(game.id, memberId);
  kickFromRooms(game.id, memberId);
  return { ok: true };
}

// ------------------------------------------------------------------ files
function checkPath(p: unknown) {
  const path = String(p ?? '').trim().replace(/^\/+/, '');
  if (!PATH_RE.test(path) || path.includes('..')) throw new PortalError('File names are letters, numbers, - _ . and folders, ending in .js, .json, .md, .txt or .css');
  return path;
}

/** Saves a file. `baseRev` is the revision the editor started from: if someone saved since, the save is refused with
 *  the current file (409) so the editor can merge. Without it (new file, or the assistant) it overwrites. */
export function writeFile(user: User | null, gameId: string, body: { path?: unknown; content?: unknown; baseRev?: unknown }, o: { by?: string; conn?: string; ops?: boolean } = {}) {
  const path = checkPath(body.path);
  const content = typeof body.content === 'string' ? body.content : '';
  if (Buffer.byteLength(content) > LIMITS.fileBytes) throw new PortalError(`Files up to ${LIMITS.fileBytes / 1024} KB`, { status: 413 });
  return tx(() => {
    const cur = db.prepare('SELECT path, content, rev, updated, updated_by FROM game_files WHERE game_id = ? AND path = ?').get(gameId, path) as FileRow | undefined;
    if (cur && body.baseRev !== undefined && body.baseRev !== null && Number(body.baseRev) !== cur.rev) {
      const e = new PortalError(`${nameOf(cur.updated_by)} changed ${path} while you were editing`, { status: 409 }) as PortalError & { file?: FileRow };
      e.file = cur;
      throw e;
    }
    if (cur && cur.content === content) return cur;
    const stats = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)), 0) AS bytes FROM game_files WHERE game_id = ? AND path != ?').get(gameId, path) as { n: number; bytes: number };
    if (!cur && Number(stats.n) >= LIMITS.files) throw new PortalError(`A game has up to ${LIMITS.files} files`, { status: 413 });
    if (Number(stats.bytes) + content.length > LIMITS.totalBytes) throw new PortalError(`A game's files add up to at most ${LIMITS.totalBytes / 1024 / 1024} MB`, { status: 413 });
    const rev = (cur?.rev ?? 0) + 1;
    const now = Date.now();
    const by = user?.id ?? null;
    db.prepare('INSERT INTO game_files (game_id, path, content, rev, updated, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (game_id, path) DO UPDATE SET content = excluded.content, rev = excluded.rev, updated = excluded.updated, updated_by = excluded.updated_by')
      .run(gameId, path, content, rev, now, by);
    touch(gameId);
    const file: FileRow = { path, content, rev, updated: now, updated_by: by };
    // ops: true marks a scene.json saved from world edits, which the engines already have (rooms.ts sent them the ops).
    broadcast(gameId, 'file', { ...file, by: o.by ?? (user ? nameOf(user.id) : 'assistant'), conn: o.conn ?? null, ops: o.ops ?? false });
    return file;
  });
}

export function deleteFile(user: User, gameId: string, p: unknown, conn?: string) {
  memberGame(user, gameId);
  const path = checkPath(p);
  if (!db.prepare('DELETE FROM game_files WHERE game_id = ? AND path = ?').run(gameId, path).changes) throw new PortalError('No such file', { status: 404 });
  touch(gameId);
  broadcast(gameId, 'file-deleted', { path, by: nameOf(user.id), conn: conn ?? null });
  return { ok: true };
}

export function renameFile(user: User, gameId: string, body: { from?: unknown; to?: unknown }, conn?: string) {
  memberGame(user, gameId);
  const from = checkPath(body.from);
  const to = checkPath(body.to);
  if (from === to) return { ok: true };
  tx(() => {
    if (db.prepare('SELECT 1 FROM game_files WHERE game_id = ? AND path = ?').get(gameId, to)) throw new PortalError(`${to} already exists`, { status: 409 });
    if (!db.prepare('UPDATE game_files SET path = ?, rev = rev + 1, updated = ?, updated_by = ? WHERE game_id = ? AND path = ?').run(to, Date.now(), user.id, gameId, from).changes) throw new PortalError('No such file', { status: 404 });
  });
  touch(gameId);
  const file = db.prepare('SELECT path, content, rev, updated, updated_by FROM game_files WHERE game_id = ? AND path = ?').get(gameId, to) as FileRow;
  broadcast(gameId, 'file-renamed', { from, to, file, by: nameOf(user.id), conn: conn ?? null });
  return { ok: true, file };
}

// ------------------------------------------------------------------ assets
export const listAssets = (gameId: string) => db.prepare('SELECT name, asset, project, kind, mime, added_by, created FROM game_assets WHERE game_id = ? ORDER BY name').all(gameId) as AssetRow[];

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'model/gltf-binary': 'glb', 'video/mp4': 'mp4', 'video/webm': 'webm', 'application/json': 'json' };

/** A free asset name in this game, from a wanted one ("hero" -> "hero.png", or "hero-2.png" when taken). */
export function freeName(gameId: string, wanted: string, mime?: string | null) {
  const ext = EXT[String(mime ?? '').split(';')[0]] ?? '';
  let base = String(wanted || 'asset').toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'asset';
  if (!/^[a-z0-9]/.test(base)) base = `a${base}`;
  const full = (n: number) => `${base}${n > 1 ? `-${n}` : ''}${ext ? `.${ext}` : ''}`;
  for (let n = 1; ; n++) if (!db.prepare('SELECT 1 FROM game_assets WHERE game_id = ? AND name = ?').get(gameId, full(n))) return full(n);
}

/** Puts an asset into the game: one of the member's own (their Gen project), under a name scripts use. */
export async function addAsset(user: User, gameId: string, body: { asset?: unknown; name?: unknown }, o: { project?: string; quiet?: boolean } = {}) {
  memberGame(user, gameId);
  const assetId = String(body.asset ?? '').replace(/^asset:/, '');
  if (!/^a_[0-9a-f]+$/.test(assetId)) throw new PortalError('asset is "asset:a_..." from your library');
  const project = o.project ?? user.project;
  const a: any = await gen(`/v1/assets/${assetId}`, { as: project }).catch(() => null);
  if (!a?.id) throw new PortalError('That asset is not in your library', { status: 404 });
  if (Number((db.prepare('SELECT COUNT(*) AS n FROM game_assets WHERE game_id = ?').get(gameId) as { n: number }).n) >= LIMITS.assets) throw new PortalError(`A game has up to ${LIMITS.assets} assets`, { status: 413 });
  const wanted = body.name ? String(body.name) : String(a.title ?? a.filename ?? a.tool ?? 'asset');
  if (body.name && !NAME_RE.test(String(body.name).replace(/\.[a-z0-9]{2,4}$/i, ''))) throw new PortalError('Asset names are letters, numbers, - and _');
  const name = freeName(gameId, wanted, a.mime);
  const row: AssetRow = { name, asset: assetId, project, kind: a.kind ?? null, mime: a.mime ?? null, added_by: user.id, created: Date.now() };
  db.prepare('INSERT INTO game_assets (game_id, name, asset, project, kind, mime, added_by, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(gameId, row.name, row.asset, row.project, row.kind, row.mime, row.added_by, row.created);
  touch(gameId);
  broadcast(gameId, 'asset', { ...row, by: nameOf(user.id) });
  return row;
}

export function removeAsset(user: User, gameId: string, name: string) {
  memberGame(user, gameId);
  if (!db.prepare('DELETE FROM game_assets WHERE game_id = ? AND name = ?').run(gameId, name).changes) throw new PortalError('No such asset', { status: 404 });
  touch(gameId);
  broadcast(gameId, 'asset-removed', { name, by: nameOf(user.id) });
  return { ok: true };
}

export function renameAsset(user: User, gameId: string, from: string, to: unknown) {
  memberGame(user, gameId);
  const want = String(to ?? '').trim();
  if (!NAME_RE.test(want)) throw new PortalError('Asset names are letters, numbers, - _ and .');
  if (db.prepare('SELECT 1 FROM game_assets WHERE game_id = ? AND name = ?').get(gameId, want)) throw new PortalError(`${want} already exists`, { status: 409 });
  if (!db.prepare('UPDATE game_assets SET name = ? WHERE game_id = ? AND name = ?').run(want, gameId, from).changes) throw new PortalError('No such asset', { status: 404 });
  touch(gameId);
  broadcast(gameId, 'asset-renamed', { from, to: want, by: nameOf(user.id) });
  return { ok: true, name: want };
}

// ------------------------------------------------------------------ playing: bundles, releases, asset files
/** A short-lived link to one asset of a game's draft (the editor's preview runs in a sandbox without the cookie). */
const draftAssetUrl = (gameId: string, a: AssetRow) => `/play-asset/d/${sign({ g: gameId, a: a.asset, p: a.project }, 6 * 3600)}/${a.name}`;
const releaseAssetUrl = (g: Game, version: number, name: string) => `/play-asset/${g.slug}/${version}/${encodeURIComponent(name)}`;
const assetMap = (rows: AssetRow[], url: (a: AssetRow) => string) => Object.fromEntries(rows.map((a) => [a.name, { url: url(a), mime: a.mime, kind: a.kind }]));

/** The draft as the runtime takes it: every file, every asset with a link. Members only. */
export function draftBundle(user: User, gameId: string) {
  const { game } = memberGame(user, gameId);
  const files = Object.fromEntries((db.prepare('SELECT path, content FROM game_files WHERE game_id = ?').all(game.id) as { path: string; content: string }[]).map((f) => [f.path, f.content]));
  return { id: game.id, title: game.title, version: null, files, assets: assetMap(listAssets(game.id), (a) => draftAssetUrl(game.id, a)), net: { token: editToken(sign, game.id, user) }, me: { id: user.id, name: user.name } };
}

// ------------------------------------------------------------------ the world (scene.json), changed by ops
/** Applies world edits (scene.ts ops) to the game's scene.json, in one transaction, and saves it. */
export function sceneOps(user: User | null, gameId: string, ops: unknown, o: { by?: string } = {}) {
  if (user) memberGame(user, gameId);
  return tx(() => {
    const cur = db.prepare("SELECT content, rev FROM game_files WHERE game_id = ? AND path = 'scene.json'").get(gameId) as { content: string; rev: number } | undefined;
    const r = applyOps(parseScene(cur?.content), ops);
    let rev = cur?.rev ?? 0;
    if (r.applied.length) rev = writeFile(user, gameId, { path: 'scene.json', content: sceneText(r.scene) }, { by: o.by ?? (user ? nameOf(user.id) : 'Assistant'), ops: true }).rev;
    return { ...r, rev };
  });
}

/** A copy of a published game (its live version: files and assets) as a new game of this customer's. */
export function remix(user: User, body: { slug?: unknown }) {
  const g = gameBySlug(String(body.slug ?? ''));
  if (!g || !g.live_version) throw new PortalError('Only published games can be remixed', { status: 404 });
  const plan = planOf(getUser(user.id));
  const owned = Number((db.prepare('SELECT COUNT(*) AS n FROM games WHERE owner_id = ?').get(user.id) as { n: number }).n);
  if (owned >= plan.games) throw new PortalError(`Your ${plan.name} plan has room for ${plan.games} games. Upgrade for more, or delete one.`, { status: 402 });
  const r = db.prepare('SELECT files, assets FROM game_releases WHERE game_id = ? AND version = ?').get(g.id, g.live_version) as { files: string; assets: string };
  const files = JSON.parse(r.files) as Record<string, string>;
  const assets = JSON.parse(r.assets) as AssetRow[];
  const now = Date.now();
  const gameId = id('g_', 8);
  const title = `${g.title} remix`.slice(0, 80);
  tx(() => {
    db.prepare('INSERT INTO games (id, slug, title, description, owner_id, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)').run(gameId, slugFor(title), title, g.description, user.id, now, now);
    db.prepare("INSERT INTO game_members (game_id, user_id, role, added) VALUES (?, ?, 'owner', ?)").run(gameId, user.id, now);
    for (const [path, content] of Object.entries(files)) db.prepare('INSERT INTO game_files (game_id, path, content, rev, updated, updated_by) VALUES (?, ?, ?, 1, ?, ?)').run(gameId, path, content, now, user.id);
    // The assets stay the original maker's files in Gen; the remix points at them, the way a release does.
    for (const a of assets) db.prepare('INSERT OR IGNORE INTO game_assets (game_id, name, asset, project, kind, mime, added_by, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(gameId, a.name, a.asset, a.project, a.kind ?? null, a.mime ?? null, user.id, now);
  });
  systemNote(gameId, `Remixed from "${g.title}" by ${nameOf(g.owner_id)}.`);
  return summary(getGame(gameId)!, user.id);
}

export function publish(user: User, gameId: string, body: { notes?: unknown }) {
  const { game } = memberGame(user, gameId);
  const files = db.prepare('SELECT path, content FROM game_files WHERE game_id = ?').all(game.id) as { path: string; content: string }[];
  if (!files.some((f) => f.path.endsWith('.js'))) throw new PortalError('Add a script before publishing');
  const assets = listAssets(game.id).map(({ name, asset, project, kind, mime }) => ({ name, asset, project, kind, mime }));
  const version = tx(() => {
    const v = Number((db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM game_releases WHERE game_id = ?').get(game.id) as { v: number }).v) + 1;
    db.prepare('INSERT INTO game_releases (game_id, version, notes, files, assets, created, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(game.id, v, String(body.notes ?? '').slice(0, 2000), JSON.stringify(Object.fromEntries(files.map((f) => [f.path, f.content]))), JSON.stringify(assets), Date.now(), user.id);
    db.prepare('UPDATE games SET live_version = ?, updated = ? WHERE id = ?').run(v, Date.now(), game.id);
    return v;
  });
  const out = { version, url: `/play/${game.slug}`, versionUrl: `/play/${game.slug}/v/${version}`, releases: releases(game.id) };
  broadcast(game.id, 'release', { ...out, by: nameOf(user.id) });
  systemNote(game.id, `${nameOf(user.id)} published version ${version}.`);
  return out;
}

/** Puts an earlier release back live (its files stay frozen; the draft is untouched). */
export function setLive(user: User, gameId: string, version: unknown) {
  const { game } = memberGame(user, gameId);
  const v = version === null ? null : Number(version);
  if (v !== null && !db.prepare('SELECT 1 FROM game_releases WHERE game_id = ? AND version = ?').get(game.id, v)) throw new PortalError('No such release', { status: 404 });
  db.prepare('UPDATE games SET live_version = ?, updated = ? WHERE id = ?').run(v, Date.now(), game.id);
  broadcast(game.id, 'game', summary(getGame(game.id)!));
  return { ok: true, liveVersion: v };
}

/** Copies a release's files back into the draft (assets too, where the release still names them). */
export function restoreRelease(user: User, gameId: string, version: number) {
  const { game } = memberGame(user, gameId);
  const r = db.prepare('SELECT files FROM game_releases WHERE game_id = ? AND version = ?').get(game.id, version) as { files: string } | undefined;
  if (!r) throw new PortalError('No such release', { status: 404 });
  const files = JSON.parse(r.files) as Record<string, string>;
  tx(() => {
    // Revisions keep counting up, so an editor still holding an older one is told to merge.
    const revs = new Map((db.prepare('SELECT path, rev FROM game_files WHERE game_id = ?').all(game.id) as { path: string; rev: number }[]).map((f) => [f.path, f.rev]));
    db.prepare('DELETE FROM game_files WHERE game_id = ?').run(game.id);
    for (const [path, content] of Object.entries(files)) db.prepare('INSERT INTO game_files (game_id, path, content, rev, updated, updated_by) VALUES (?, ?, ?, ?, ?, ?)').run(game.id, path, content, (revs.get(path) ?? 0) + 1, Date.now(), user.id);
  });
  touch(game.id);
  broadcast(game.id, 'reload', { by: nameOf(user.id), reason: `restored version ${version}` });
  return openGame(user, game.id);
}

export const releases = (gameId: string) => (db.prepare('SELECT version, notes, created, created_by FROM game_releases WHERE game_id = ? ORDER BY version DESC LIMIT 50').all(gameId) as { version: number; notes: string; created: number; created_by: string | null }[]).map((r) => ({ ...r, by: nameOf(r.created_by) }));

/** What a player loads: a published version (the live one unless asked) as the runtime takes it. Anyone with the link. */
export function playBundle(slug: string, version?: number | null, count = true) {
  const g = gameBySlug(slug);
  if (!g) throw new PortalError('No such game', { status: 404 });
  const v = version ?? g.live_version;
  if (!v) throw new PortalError('This game has not been published yet', { status: 404 });
  const r = db.prepare('SELECT * FROM game_releases WHERE game_id = ? AND version = ?').get(g.id, v) as { version: number; files: string; assets: string; created: number } | undefined;
  if (!r) throw new PortalError('No such version', { status: 404 });
  if (count) db.prepare('UPDATE games SET plays = plays + 1 WHERE id = ?').run(g.id);
  const assets = JSON.parse(r.assets) as AssetRow[];
  const owner = getUser(g.owner_id);
  return { id: g.id, slug: g.slug, title: g.title, description: g.description, by: owner?.name ?? null, version: r.version, published: r.created, files: JSON.parse(r.files), assets: assetMap(assets, (a) => releaseAssetUrl(g, r.version, a.name)) };
}

/** Which Gen file an asset link means: a release's (public with the game) or a signed draft link. */
export function resolvePlayAsset(parts: { token?: string; slug?: string; version?: number; name?: string }) {
  if (parts.token) {
    const t = verify<{ g: string; a: string; p: string }>(parts.token);
    if (!t || !/^a_[0-9a-f]+$/.test(t.a)) throw new PortalError('This preview link has expired; reload the editor', { status: 410 });
    return { asset: t.a, project: t.p, immutable: false };
  }
  const g = gameBySlug(String(parts.slug));
  if (!g) throw new PortalError('No such game', { status: 404 });
  const r = db.prepare('SELECT assets FROM game_releases WHERE game_id = ? AND version = ?').get(g.id, Number(parts.version ?? 0)) as { assets: string } | undefined;
  const a = r ? (JSON.parse(r.assets) as AssetRow[]).find((x) => x.name === parts.name) : null;
  if (!a) throw new PortalError('No such asset', { status: 404 });
  return { asset: a.asset, project: a.project, immutable: true };
}

/** The public games: published, listed, most played first (or newest). */
export function gallery(sort: 'popular' | 'new' = 'popular', limit = 60) {
  const overseer = featured();
  const rows = db.prepare(`SELECT g.*, u.name AS owner_name FROM games g JOIN users u ON u.id = g.owner_id WHERE g.visibility = 'public' AND g.live_version IS NOT NULL ORDER BY ${sort === 'new' ? 'g.updated' : 'g.plays'} DESC LIMIT ?`).all(Math.max(1, Math.min(200, limit))) as (Game & { owner_name: string })[];
  return {
    featured: overseer,
    games: rows.map((g) => {
      const r = db.prepare('SELECT assets FROM game_releases WHERE game_id = ? AND version = ?').get(g.id, g.live_version) as { assets: string } | undefined;
      const hasCover = g.cover && r && (JSON.parse(r.assets) as AssetRow[]).some((a) => a.name === g.cover);
      return { slug: g.slug, title: g.title, description: g.description, by: g.owner_name, plays: g.plays, version: g.live_version, updated: g.updated, url: `/play/${g.slug}`, cover: hasCover ? releaseAssetUrl(g, g.live_version!, g.cover!) : null };
    }),
  };
}

// ------------------------------------------------------------------ chat
export type ChatRow = { id: string; game_id: string; user_id: string | null; role: 'user' | 'ai' | 'system'; text: string; data: any; created: number; name?: string };

export function chatMessage(gameId: string, userId: string | null, role: ChatRow['role'], text: string, data: unknown = null) {
  const row: ChatRow = { id: id('m_', 8), game_id: gameId, user_id: userId, role, text: text.slice(0, 20_000), data, created: Date.now() };
  db.prepare('INSERT INTO game_chat (id, game_id, user_id, role, text, data, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(row.id, gameId, userId, role, row.text, data ? JSON.stringify(data) : null, row.created);
  const out = { ...row, name: role === 'ai' ? 'Assistant' : role === 'system' ? null : nameOf(userId) };
  broadcast(gameId, 'chat', out);
  return out;
}

export function updateChatData(messageId: string, data: unknown) {
  db.prepare('UPDATE game_chat SET data = ? WHERE id = ?').run(JSON.stringify(data), messageId);
  const r = db.prepare('SELECT * FROM game_chat WHERE id = ?').get(messageId) as any;
  if (r) broadcast(r.game_id, 'chat', { ...r, data, name: r.role === 'ai' ? 'Assistant' : r.role === 'system' ? null : nameOf(r.user_id) });
}

const systemNote = (gameId: string, text: string) => chatMessage(gameId, null, 'system', text);

export function chatHistory(user: User, gameId: string, limit = 80) {
  memberGame(user, gameId);
  const rows = db.prepare('SELECT * FROM game_chat WHERE game_id = ? ORDER BY created DESC, rowid DESC LIMIT ?').all(gameId, Math.max(1, Math.min(300, limit))) as any[];
  return { messages: rows.reverse().map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null, name: r.role === 'ai' ? 'Assistant' : r.role === 'system' ? null : nameOf(r.user_id) })) };
}

export function postChat(user: User, gameId: string, text: unknown) {
  memberGame(user, gameId);
  const t = String(text ?? '').trim();
  if (!t) throw new PortalError('Say something');
  return chatMessage(gameId, user.id, 'user', t);
}
