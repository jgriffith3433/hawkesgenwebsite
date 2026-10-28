#!/usr/bin/env node
// Copies the old portal's database (portal.db, SQLite) into a Firestore project (docs/cloud.md: Phase B).
//
//   node cloud/migrate.mjs <path/to/portal.db> --project <firebase project id>          dry run: reads, maps, prints counts
//   node cloud/migrate.mjs <path/to/portal.db> --project <firebase project id> --check  dry run, then checks every document
//                                                                                       against the shape its module reads
//                                                                                       (prints field names, never values)
//   node cloud/migrate.mjs <path/to/portal.db> --project <firebase project id> --apply  writes (application default
//                                                                                       credentials: gcloud auth
//                                                                                       application-default login)
// Options: --only <label,...> copies only those (a label as printed, e.g. users,apiKeys,games/*/files; a top-level name
// such as games takes everything under it).
//
// Run it from cloud/functions (node --disable-warning=ExperimentalWarning ../migrate.mjs ...): it reads
// functions/src/words.ts (type stripping) so asset words are made by the same code games.ts uses.
//
// Every table is mapped to exactly the documents the module that owns it now reads and writes (cloud/functions/src).
// Writes are `set` (whole documents), so running it again replaces what an earlier run wrote and adds nothing twice.
//
//   users            users/{usr_id} (accounts.ts): no password_hash; email lowercased; avatar and overseer (JSON text) become
//                    maps (presence.ts); disabled, referral_paid, cancel_at_period_end booleans; refCodes/{ref_code} =
//                    { user }; once/referral:<usr> for a friend whose inviter was already paid (billing.ts rewardReferrer).
//                    No logins/{uid}: a Firebase user is linked to the account by its email at the first Google sign-in.
//   api_keys         apiKeys/{key_hash} (accounts.ts), disabled a boolean (it asks disabled == false); key_hash is the id.
//   credit_ledger    users/{user_id}/ledger/{id}, and once/{key} = { user, tx, at } (store.ts changeCredits): stripe:<session>,
//                    invoice:<invoice>, refund:<job_id> for each job_refund, first_bonus:<user> for a first_purchase_bonus.
//   jobs             jobs/{id} (jobs.ts); one still running gets holds/hold_<job id> from its job_reserve row (billing.ts).
//   friends          friends/{user_id}:{friend_id} (friends.ts friendKey).
//   friend_requests  friendRequests/{from_id}:{to_id} (presence.ts).
//   games            games/{g_id} (games.ts): the columns but id, hidden 0/1 (the gallery asks hidden == 0), visitors, and
//                    files_count / files_bytes worked out from its files (as games.ts keeps them).
//   game_members     games/{g_id}/members/{user_id}.
//   game_files       games/{g_id}/files/{encodeURIComponent(path)}.
//   game_assets      games/{g_id}/assets/{encodeURIComponent(name)}, words as JSON text made by games.ts wordList.
//   game_releases    games/{g_id}/releases/{version} (files and assets JSON text, parts: 0), over 900,000 characters
//                    split into releases/{version}/parts/{i} as games.ts writeRelease does.
//   game_chat        games/{g_id}/chat/{m_id} (data stays JSON text).
//   game_invites     gameInvites/{code}.
//   games_reports    gamesReports/{rp_id}.
//   game_gen         gameGen/{task_id} (gameai.ts): the row plus its chain from the tasks row of the same id (title, steps,
//                    step, jobs, outputs, detail, error, credits), which gameai.ts now keeps in the same document. Those
//                    tasks rows are not copied to tasks/ (the MCP task runner would advance them a second time).
//   tasks            tasks/{task_id} (tasks.ts): via a map, jobs an array, steps and outputs JSON text; no lease.
//   community_assets communityAssets/{a_id} (community.ts) plus `words` (wordsField, the same rules as community.ts).
//   community_uses   communityUses/{a_id}_{usr_id}.
//   community_kits   communityKits/{k_id} (kits.ts), things and config JSON text.
//   shares           shares/{id} (shares.ts).
//   gen_lods         genLods/{a_id} (lods.ts): lods a map (or null), cdn null when none (its refresh asks cdn == null).
//   oauth_clients    oauthClients/{mcp_id} (oauth.ts): redirect_uris an array.
//   connections      connections/{conn_id}: revoked null or a time (listConnections asks revoked == null).
//   oauth_tokens     oauthTokens/{token_hash} (oauth.ts looks up sha256(token)); expired ones are left behind.
//   live_seq         liveSeq/{game} = { n, at } (live.ts), so event numbers keep rising for open editors.
// Not copied: sessions and password_tokens (everyone signs in with Google again), and what only mattered for a moment
// on the box: oauth_codes (five minutes), upload_tokens, locks, rate_hits, demo_runs (a day's tries), play_seen (an hour).
// A table not named here is not copied either, and the output says so.
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !['--project', '--only'].includes(args[i - 1]));
const project = flag('--project');
const apply = args.includes('--apply');
const check = args.includes('--check');
const only = flag('--only') ? new Set(flag('--only').split(',').map((s) => s.trim()).filter(Boolean)) : null;
if (!file || !project) {
  console.error('Usage: node cloud/migrate.mjs <portal.db> --project <firebase project id> [--check] [--apply] [--only users,apiKeys]');
  process.exit(2);
}
if (apply && check) { console.error('--check is a dry run; run it first, then --apply on its own.'); process.exit(2); }
if (!fs.existsSync(file)) { console.error(`No such file: ${file}`); process.exit(2); }

// The same word rules games.ts uses for asset words (wordsOf), from its own source.
const { wordsOf } = await import(new URL('./functions/src/words.ts', import.meta.url).href);

const sqlite = new DatabaseSync(file, { readOnly: true });

const json = (v, d = null) => { if (typeof v !== 'string' || !v) return v ?? d; try { return JSON.parse(v); } catch { return d; } };
const bool = (v) => (v === null || v === undefined ? v : Boolean(Number(v)));
const flag01 = (v) => (Number(v) ? 1 : 0);
const safeId = (s) => String(s).replace(/\//g, '_');

const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const has = (t) => tables.includes(t);
const rowsOf = (t) => (has(t) ? sqlite.prepare(`SELECT * FROM ${t}`).all() : []);
const countOf = (t) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

/** Every write as [label, path, data]. */
const writes = [];
const counts = new Map();
const notes = [];
const put = (label, path, data) => {
  if (only && !only.has(label) && !only.has(label.split('/')[0])) return;
  writes.push([label, path, data]);
  counts.set(label, (counts.get(label) ?? 0) + 1);
};
const omit = (r, ...keys) => { const o = { ...r }; for (const k of keys) delete o[k]; return o; };

// ------------------------------------------------------------ users and their money

const userIds = new Set(rowsOf('users').map((u) => u.id));
for (const r of rowsOf('users')) {
  const u = omit(r, 'id', 'password_hash');
  u.email = String(u.email ?? '').trim().toLowerCase();
  for (const k of ['avatar', 'overseer']) if (k in u) u[k] = json(u[k]);
  for (const k of ['disabled', 'referral_paid', 'cancel_at_period_end']) if (k in u) u[k] = bool(u[k]) ?? false;
  u.disabled ??= false;
  u.plan ??= 'free';
  u.role ??= 'customer';
  put('users', `users/${safeId(r.id)}`, u);
  if (u.ref_code) put('refCodes', `refCodes/${safeId(u.ref_code)}`, { user: r.id });
  if (u.referral_paid && u.referred_by) put('once', `once/${safeId(`referral:${r.id}`)}`, { user: u.referred_by, tx: null, at: u.created });
}

for (const r of rowsOf('api_keys')) {
  if (!userIds.has(r.user_id)) continue;
  const k = omit(r, 'key_hash');
  k.disabled = bool(k.disabled) ?? false;
  k.last_used ??= null;
  k.daily_cap ??= null;
  put('apiKeys', `apiKeys/${safeId(r.key_hash)}`, k);
}

let orphans = 0;
/** What each job took (its job_reserve row), so a job still running at the move keeps a hold billing.ts can give back. */
const reserves = new Map();
for (const r of rowsOf('credit_ledger')) {
  if (!userIds.has(r.user_id)) { orphans++; continue; }
  const user = r.user_id, tx = r.id;
  const e = omit(r, 'user_id', 'id');
  put('users/*/ledger', `users/${safeId(user)}/ledger/${safeId(tx)}`, e);
  const once = (key) => put('once', `once/${safeId(key)}`, { user, tx, at: e.created });
  if (e.stripe_session_id) once(`stripe:${e.stripe_session_id}`);
  if (e.stripe_invoice_id) once(`invoice:${e.stripe_invoice_id}`);
  if (e.kind === 'job_refund' && e.job_id) once(`refund:${e.job_id}`);
  if (e.kind === 'first_purchase_bonus') once(`first_bonus:${user}`);
  if (e.kind === 'job_reserve' && e.job_id) reserves.set(e.job_id, { user, tx, credits: -Number(e.delta) });
}

let unsettled = 0;
for (const r of rowsOf('jobs')) {
  const j = omit(r, 'id');
  j.via ??= null;
  j.settled ??= null;
  j.hold = null;
  const taken = reserves.get(r.id);
  if (j.settled === null && taken) {
    // Same shape billing.ts hold() makes; release() gives it back once (once key refund:<hold id>).
    j.hold = `hold_${r.id}`;
    put('holds', `holds/${safeId(j.hold)}`, { user: taken.user, credits: taken.credits, tx: taken.tx, job: r.id, created: j.created });
  } else if (j.settled === null) unsettled++;
  put('jobs', `jobs/${safeId(r.id)}`, j);
}

// ------------------------------------------------------------ friends

for (const f of rowsOf('friends')) put('friends', `friends/${safeId(`${f.user_id}:${f.friend_id}`)}`, { ...f });
for (const f of rowsOf('friend_requests')) put('friendRequests', `friendRequests/${safeId(`${f.from_id}:${f.to_id}`)}`, { ...f });

// ------------------------------------------------------------ games (games.ts)

const gameIds = new Set(rowsOf('games').map((g) => g.id));
const fileTotals = new Map();
for (const f of rowsOf('game_files')) {
  const t = fileTotals.get(f.game_id) ?? { count: 0, bytes: 0 };
  t.count++;
  t.bytes += String(f.content ?? '').length;
  fileTotals.set(f.game_id, t);
}
for (const r of rowsOf('games')) {
  const g = omit(r, 'id');
  g.slug = String(g.slug).toLowerCase();
  g.visitors ??= 'play';
  g.hidden = flag01(g.hidden);
  g.hidden_reason ??= null;
  g.hidden_at ??= null;
  g.hidden_by ??= null;
  g.live_version ??= null;
  g.cover ??= null;
  g.plays = Number(g.plays ?? 0);
  const t = fileTotals.get(r.id) ?? { count: 0, bytes: 0 };
  g.files_count = t.count;
  g.files_bytes = t.bytes;
  put('games', `games/${safeId(r.id)}`, g);
}
let lostGameRows = 0;
const inGame = (r) => (gameIds.has(r.game_id) ? true : (lostGameRows++, false));
const gpath = (gameId) => `games/${safeId(gameId)}`;

for (const m of rowsOf('game_members')) if (inGame(m)) put('games/*/members', `${gpath(m.game_id)}/members/${safeId(m.user_id)}`, { game_id: m.game_id, user_id: m.user_id, role: m.role, added: m.added });
for (const f of rowsOf('game_files')) if (inGame(f)) put('games/*/files', `${gpath(f.game_id)}/files/${encodeURIComponent(f.path)}`, { game_id: f.game_id, path: f.path, content: f.content, rev: f.rev, updated: f.updated, updated_by: f.updated_by ?? null });

/** games.ts wordList: the row's words (JSON text), else its name's. */
const wordList = (a) => {
  let w = a.words;
  if (typeof w === 'string') { try { w = JSON.parse(w); } catch { w = []; } }
  const list = Array.isArray(w) ? w.map(String) : [];
  return list.length ? list : wordsOf(a.name.replace(/_low\.glb$/, '.glb'));
};
for (const a of rowsOf('game_assets')) {
  if (!inGame(a)) continue;
  // games.ts assetDoc
  put('games/*/assets', `${gpath(a.game_id)}/assets/${encodeURIComponent(a.name)}`, { game_id: a.game_id, name: a.name, asset: a.asset, project: a.project, kind: a.kind ?? null, mime: a.mime ?? null, added_by: a.added_by ?? null, created: a.created, words: JSON.stringify(wordList(a)), title: a.title ?? null });
}

const PART = 900_000; // games.ts writeRelease
for (const r of rowsOf('game_releases')) {
  if (!inGame(r)) continue;
  const base = `${gpath(r.game_id)}/releases/${r.version}`;
  const row = { notes: r.notes ?? '', files: r.files, assets: r.assets, created: r.created, created_by: r.created_by ?? null };
  if (row.files.length + row.assets.length <= PART) { put('games/*/releases', base, { game_id: r.game_id, version: r.version, ...row, parts: 0 }); continue; }
  const text = JSON.stringify({ files: row.files, assets: row.assets });
  const n = Math.ceil(text.length / PART);
  put('games/*/releases', base, { game_id: r.game_id, version: r.version, notes: row.notes, created: row.created, created_by: row.created_by, files: null, assets: null, parts: n });
  for (let i = 0; i < n; i++) put('games/*/releases/*/parts', `${base}/parts/${i}`, { i, text: text.slice(i * PART, (i + 1) * PART) });
}

for (const c of rowsOf('game_chat')) if (inGame(c)) put('games/*/chat', `${gpath(c.game_id)}/chat/${safeId(c.id)}`, { id: c.id, game_id: c.game_id, user_id: c.user_id ?? null, role: c.role, text: c.text, data: c.data ?? null, created: c.created });
for (const i of rowsOf('game_invites')) if (inGame(i)) put('gameInvites', `gameInvites/${safeId(i.code)}`, { code: i.code, game_id: i.game_id, created_by: i.created_by, created: i.created, expires: i.expires, revoked: flag01(i.revoked) });
for (const r of rowsOf('games_reports')) if (inGame(r)) put('gamesReports', `gamesReports/${safeId(r.id)}`, { id: r.id, game_id: r.game_id, reason: r.reason, note: r.note ?? '', reporter_id: r.reporter_id ?? null, ip: r.ip ?? null, created: r.created });

for (const s of rowsOf('live_seq')) if (gameIds.has(s.game)) put('liveSeq', `liveSeq/${safeId(s.game)}`, { n: Number(s.n), at: Date.now() });

// ------------------------------------------------------------ the games' generations (gameai.ts) and tasks (tasks.ts)

const taskRows = new Map(rowsOf('tasks').map((t) => [t.id, t]));
const genTasks = new Set();
let gensWithoutTask = 0;
for (const g of rowsOf('game_gen')) {
  genTasks.add(g.task_id);
  const t = taskRows.get(g.task_id);
  const doc = { task_id: g.task_id, game_id: g.game_id, user_id: g.user_id, name: g.name, kind: g.kind, prompt: g.prompt, message_id: g.message_id ?? null, state: g.state, asset_name: g.asset_name ?? null, created: g.created };
  if (t) {
    Object.assign(doc, {
      title: t.name, steps: t.steps, step: Number(t.step ?? 0), jobs: json(t.jobs, []).map((j) => j || null), outputs: t.outputs ?? '[]',
      detail: t.detail ?? null, error: t.error ?? null, credits: Number(t.credits ?? 0), step_started: t.updated ?? g.created, frac: null, lease: 0, updated: t.updated ?? g.created,
    });
    // The chain ended on the box but the asset wasn't put in the game yet: the task's end is the generation's
    // (a done chain still `running` here is finished by gameai.ts advance, which adds the asset).
    if (doc.state === 'running' && ['failed', 'cancelled'].includes(t.state)) doc.state = t.state;
  } else {
    // Its chain is gone: nothing to resume.
    gensWithoutTask++;
    Object.assign(doc, { title: g.name, steps: '[]', step: 0, jobs: [], outputs: '[]', detail: null, error: doc.state === 'running' ? 'Lost in the move to the new servers' : null, credits: 0, step_started: g.created, frac: null, lease: 0, updated: g.created });
    if (doc.state === 'running') doc.state = 'failed';
  }
  put('gameGen', `gameGen/${safeId(g.task_id)}`, doc);
}
for (const t of taskRows.values()) {
  if (genTasks.has(t.id)) continue;
  if (!userIds.has(t.user_id)) continue;
  // tasks.ts start(): the same fields; no lease (a running one is picked up by advanceTasks).
  put('tasks', `tasks/${safeId(t.id)}`, {
    user_id: t.user_id, via: json(t.via), name: t.name, steps: t.steps, state: t.state, step: Number(t.step ?? 0), jobs: json(t.jobs, []).map((j) => j || null),
    outputs: t.outputs ?? '[]', detail: t.detail ?? null, error: t.error ?? null, credits: Number(t.credits ?? 0), created: t.created, updated: t.updated,
    step_started: t.updated ?? t.created, step_fraction: null, lease: null, lease_until: null,
  });
}

// ------------------------------------------------------------ the community library (community.ts, kits.ts)

// community.ts wordsField (kept in step with it: the search words a row is found by)
const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s-]+/g, ' ').split(/[\s-]+/).filter((w) => w.length > 1);
const prefixes = (w, min = 3) => Array.from({ length: Math.max(0, w.length - min + 1) }, (_, i) => w.slice(0, min + i));
function wordsField(r) {
  const all = new Set();
  for (const w of [...words(r.title), ...(r.category ? [r.category, ...words(r.category)] : []), ...String(r.tags ?? '').split(' ').filter(Boolean)]) {
    all.add(w);
    for (const p of prefixes(w)) all.add(p);
  }
  return [...all].slice(0, 200);
}
for (const r of rowsOf('community_assets')) {
  const a = omit(r, 'id');
  a.tags ??= '';
  a.category ??= '';
  a.item ??= null;
  a.low ??= null;
  a.thumb ??= null;
  a.by_user ??= null;
  a.mime ??= null;
  a.uses = Number(a.uses ?? 0);
  a.likes = Number(a.likes ?? 0);
  a.hidden = flag01(a.hidden);
  a.words = wordsField({ title: a.title, category: a.category, tags: a.tags });
  put('communityAssets', `communityAssets/${safeId(r.id)}`, a);
}
for (const u of rowsOf('community_uses')) put('communityUses', `communityUses/${safeId(`${u.asset}_${u.user_id}`)}`, { asset: u.asset, user_id: u.user_id, game_id: u.game_id ?? null, created: u.created });
for (const k of rowsOf('community_kits')) put('communityKits', `communityKits/${safeId(k.id)}`, { by_user: k.by_user, title: k.title, about: k.about ?? '', icon: k.icon ?? '📦', things: k.things, config: k.config ?? null, uses: Number(k.uses ?? 0), created: k.created, hidden: flag01(k.hidden) });

// ------------------------------------------------------------ share links (shares.ts) and levels of detail (lods.ts)

for (const s of rowsOf('shares')) {
  const d = omit(s, 'id');
  for (const k of ['thumb', 'game', 'game_title', 'width', 'height', 'seconds', 'moment', 'caption', 'who', 'what']) d[k] ??= null;
  d.views = Number(d.views ?? 0);
  d.hidden = flag01(d.hidden);
  put('shares', `shares/${safeId(s.id)}`, d);
}
for (const l of rowsOf('gen_lods')) put('genLods', `genLods/${safeId(l.asset)}`, { asset: l.asset, lods: json(l.lods), state: l.state ?? null, fetched: Number(l.fetched ?? 0), cdn: l.cdn ?? null });

// ------------------------------------------------------------ OAuth for MCP clients (oauth.ts)

for (const c of rowsOf('oauth_clients')) put('oauthClients', `oauthClients/${safeId(c.id)}`, { name: c.name, redirect_uris: json(c.redirect_uris, []), created: c.created });
const connIds = new Set();
for (const c of rowsOf('connections')) {
  if (!userIds.has(c.user_id)) continue;
  connIds.add(c.id);
  put('connections', `connections/${safeId(c.id)}`, { user_id: c.user_id, client_id: c.client_id, name: c.name, daily_cap: c.daily_cap ?? null, created: c.created, last_used: c.last_used ?? null, revoked: c.revoked ?? null });
}
let expiredTokens = 0;
const now = Date.now();
for (const t of rowsOf('oauth_tokens')) {
  if (!connIds.has(t.connection_id) || Number(t.expires) <= now) { expiredTokens++; continue; }
  put('oauthTokens', `oauthTokens/${safeId(t.token_hash)}`, { connection_id: t.connection_id, kind: t.kind, expires: t.expires });
}

// ------------------------------------------------------------ what is left behind

const DONE = new Set(['users', 'api_keys', 'credit_ledger', 'jobs', 'friends', 'friend_requests', 'games', 'game_members', 'game_files', 'game_assets', 'game_releases', 'game_chat', 'game_invites', 'games_reports', 'live_seq', 'game_gen', 'tasks', 'community_assets', 'community_uses', 'community_kits', 'shares', 'gen_lods', 'oauth_clients', 'connections', 'oauth_tokens']);
const SKIP = { sessions: 'Google sign-in now', password_tokens: 'Google sign-in now', oauth_codes: 'five minutes', upload_tokens: 'half an hour', locks: 'momentary', rate_hits: 'momentary', demo_runs: "a day's tries", play_seen: 'an hour' };
const skipped = [];
const unknown = [];
for (const t of tables) {
  if (DONE.has(t)) continue;
  if (t in SKIP) skipped.push(`${t} (${countOf(t)}: ${SKIP[t]})`);
  else unknown.push(`${t} (${countOf(t)})`);
}

// ------------------------------------------------------------ report

console.log(`${apply ? 'APPLY' : check ? 'Dry run with checks' : 'Dry run'}: ${file} -> Firestore project "${project}"${only ? ` (only ${[...only].join(', ')})` : ''}`);
for (const [c, n] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${c.padEnd(26)} ${n}`);
console.log(`  ${'(documents in all)'.padEnd(26)} ${writes.length}`);
if (skipped.length) console.log(`Not copied (no reader needs them): ${skipped.join(', ')}`);
if (unknown.length) console.log(`Not copied (no module reads this table any more): ${unknown.join(', ')}`);
if (orphans) console.log(`Ledger rows of accounts that no longer exist (not copied): ${orphans}`);
if (lostGameRows) console.log(`Rows of games that no longer exist (not copied): ${lostGameRows}`);
if (expiredTokens) console.log(`OAuth tokens expired or of a missing connection (not copied): ${expiredTokens}`);
if (gensWithoutTask) console.log(`Game generations whose task row is gone (copied as ended): ${gensWithoutTask}`);
if (unsettled) console.log(`Jobs not yet settled with no reserve row: ${unsettled}. They cannot be refunded automatically; check them by hand after the move (GET /v1/admin/users/<id>).`);

// ------------------------------------------------------------ --check: every document against what its module reads

if (check) {
  const fail = new Map();
  const bad = (label, why) => { const k = `${label}: ${why}`; fail.set(k, (fail.get(k) ?? 0) + 1); };
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const numOrNull = (v) => v === null || isNum(v);
  const strOrNull = (v) => v === null || typeof v === 'string';
  const jsonText = (v, shape) => { if (typeof v !== 'string') return false; try { const x = JSON.parse(v); return shape === 'array' ? Array.isArray(x) : shape === 'object' ? x !== null && typeof x === 'object' && !Array.isArray(x) : true; } catch { return false; } };
  const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  // What Firestore itself refuses: undefined, arrays directly in arrays, a document over 1 MiB, a bad id.
  const firestoreOk = (label, path, data) => {
    const walk = (v, inArray) => {
      if (v === undefined) return bad(label, 'an undefined value');
      if (typeof v === 'bigint') return bad(label, 'a bigint');
      if (Array.isArray(v)) { if (inArray) bad(label, 'an array inside an array'); for (const x of v) walk(x, true); return; }
      if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x, false);
    };
    walk(data, false);
    if (Buffer.byteLength(JSON.stringify(data)) + Buffer.byteLength(path) > 1_000_000) bad(label, 'over 1 MB');
    const parts = path.split('/');
    if (parts.length % 2) bad(label, 'a path that is not a document');
    for (const p of parts) if (!p || p === '.' || p === '..' || /^__.*__$/.test(p) || Buffer.byteLength(p) > 1500) bad(label, 'a bad id');
  };
  const SHAPE = {
    users: (d) => [typeof d.email === 'string' && d.email === d.email.toLowerCase() || 'email', typeof d.project === 'string' || 'project', isNum(d.credits) || 'credits', typeof d.disabled === 'boolean' || 'disabled', !('password_hash' in d) || 'password_hash', d.avatar == null || isMap(d.avatar) || 'avatar', d.overseer == null || isMap(d.overseer) || 'overseer', typeof (d.referral_paid ?? false) === 'boolean' || 'referral_paid', typeof (d.cancel_at_period_end ?? false) === 'boolean' || 'cancel_at_period_end'],
    refCodes: (d) => [typeof d.user === 'string' || 'user'],
    apiKeys: (d) => [typeof d.user_id === 'string' || 'user_id', typeof d.disabled === 'boolean' || 'disabled', typeof d.id === 'string' || 'id', !('key_hash' in d) || 'key_hash'],
    'users/*/ledger': (d) => [isNum(d.delta) || 'delta', isNum(d.balance_after) || 'balance_after', typeof d.kind === 'string' || 'kind', isNum(d.created) || 'created', !('user_id' in d) || 'user_id'],
    once: (d) => [typeof d.user === 'string' || 'user'],
    jobs: (d) => [typeof d.user_id === 'string' || 'user_id', isNum(d.credits) || 'credits', numOrNull(d.settled) || 'settled', strOrNull(d.via) || 'via', strOrNull(d.hold) || 'hold'],
    holds: (d) => [typeof d.user === 'string' || 'user', isNum(d.credits) || 'credits', typeof d.job === 'string' || 'job', typeof d.tx === 'string' || 'tx'],
    friends: (d, p) => [p.endsWith(`/${d.user_id}:${d.friend_id}`) || 'id is user:friend'],
    friendRequests: (d, p) => [p.endsWith(`/${d.from_id}:${d.to_id}`) || 'id is from:to', isNum(d.created) || 'created'],
    games: (d) => [/^[a-z0-9-]{1,80}$/.test(d.slug) || 'slug', ['public', 'unlisted'].includes(d.visibility) || 'visibility', d.hidden === 0 || d.hidden === 1 || 'hidden 0/1', isNum(d.files_count) || 'files_count', isNum(d.files_bytes) || 'files_bytes', typeof d.owner_id === 'string' || 'owner_id', isNum(d.plays) || 'plays', isNum(d.updated) || 'updated', !('id' in d) || 'id'],
    'games/*/members': (d, p) => [['owner', 'editor', 'builder', 'player'].includes(d.role) || 'role', p.endsWith(`/members/${d.user_id}`) || 'id is user_id', isNum(d.added) || 'added'],
    'games/*/files': (d, p) => [p.endsWith(`/files/${encodeURIComponent(d.path)}`) || 'id is encodeURIComponent(path)', typeof d.content === 'string' || 'content', isNum(d.rev) || 'rev'],
    'games/*/assets': (d, p) => [p.endsWith(`/assets/${encodeURIComponent(d.name)}`) || 'id is encodeURIComponent(name)', jsonText(d.words, 'array') && JSON.parse(d.words).every((w) => typeof w === 'string') || 'words', /^a_/.test(d.asset) || 'asset', typeof d.project === 'string' || 'project'],
    'games/*/releases': (d) => [isNum(d.version) || 'version', isNum(d.parts) || 'parts', d.parts > 0 || (jsonText(d.files, 'object') && jsonText(d.assets, 'array')) || 'files/assets'],
    'games/*/releases/*/parts': (d) => [isNum(d.i) || 'i', typeof d.text === 'string' || 'text'],
    'games/*/chat': (d) => [/^m_/.test(d.id) || 'id', ['user', 'ai', 'system'].includes(d.role) || 'role', d.data === null || jsonText(d.data) || 'data JSON text'],
    gameInvites: (d) => [typeof d.game_id === 'string' || 'game_id', d.revoked === 0 || d.revoked === 1 || 'revoked', isNum(d.expires) || 'expires'],
    gamesReports: (d) => [typeof d.game_id === 'string' || 'game_id', typeof d.reason === 'string' || 'reason'],
    liveSeq: (d) => [isNum(d.n) || 'n'],
    gameGen: (d) => [jsonText(d.steps, 'array') || 'steps', jsonText(d.outputs, 'array') || 'outputs', Array.isArray(d.jobs) || 'jobs', isNum(d.step) || 'step', isNum(d.lease) || 'lease', typeof d.title === 'string' || 'title', typeof d.state === 'string' || 'state', isNum(d.step_started) || 'step_started'],
    tasks: (d) => [jsonText(d.steps, 'array') || 'steps', jsonText(d.outputs, 'array') || 'outputs', Array.isArray(d.jobs) || 'jobs', d.via === null || isMap(d.via) || 'via', d.lease === null || 'lease'],
    communityAssets: (d) => [Array.isArray(d.words) && d.words.every((w) => typeof w === 'string') || 'words', typeof d.tags === 'string' || 'tags', typeof d.category === 'string' || 'category', d.hidden === 0 || d.hidden === 1 || 'hidden 0/1', isNum(d.uses) && isNum(d.likes) || 'uses/likes', typeof d.project === 'string' || 'project', !('id' in d) || 'id'],
    communityUses: (d, p) => [p.endsWith(`/${d.asset}_${d.user_id}`) || 'id is asset_user'],
    communityKits: (d) => [jsonText(d.things, 'array') || 'things', d.config === null || jsonText(d.config, 'object') || 'config', d.hidden === 0 || d.hidden === 1 || 'hidden 0/1', isNum(d.uses) || 'uses'],
    shares: (d) => [typeof d.user_id === 'string' || 'user_id', /^a_/.test(d.asset) || 'asset', d.hidden === 0 || d.hidden === 1 || 'hidden 0/1', isNum(d.views) || 'views', !('id' in d) || 'id'],
    genLods: (d) => [d.lods === null || (isMap(d.lods) && Array.isArray(d.lods.levels)) || 'lods map', strOrNull(d.cdn) || 'cdn', isNum(d.fetched) || 'fetched'],
    oauthClients: (d) => [Array.isArray(d.redirect_uris) && d.redirect_uris.length > 0 || 'redirect_uris', typeof d.name === 'string' || 'name'],
    connections: (d) => [typeof d.user_id === 'string' || 'user_id', numOrNull(d.revoked) || 'revoked', numOrNull(d.daily_cap) || 'daily_cap'],
    oauthTokens: (d, p) => [/\/[0-9a-f]{64}$/.test(p) || 'id is sha256 hex', ['access', 'refresh'].includes(d.kind) || 'kind', isNum(d.expires) || 'expires'],
  };
  const seen = new Map();
  for (const [label, path, data] of writes) {
    firestoreOk(label, path, data);
    const shape = SHAPE[label];
    if (!shape) { bad(label, 'no shape check'); continue; }
    for (const r of shape(data, path)) if (r !== true) bad(label, `field ${r}`);
    seen.set(label, (seen.get(label) ?? 0) + 1);
  }
  // A few documents built from fixed rows, so the rules above are seen to catch what they should.
  const self = [
    ['games/*/assets', 'games/g_1/assets/a%20b.png', { name: 'a b.png', asset: 'a_1', project: 'usr_1', words: JSON.stringify(wordList({ name: 'Spotted cows.png', words: '[]' })) }, true],
    ['communityAssets', 'communityAssets/a_1', { words: wordsField({ title: 'Oak tree', category: 'nature', tags: 'tree oak' }), tags: 'tree oak', category: 'nature', hidden: 0, uses: 0, likes: 0, project: 'usr_1' }, true],
    ['games', 'games/g_1', { slug: 'x-1', visibility: 'public', hidden: false, files_count: 0, files_bytes: 0, owner_id: 'u', plays: 0, updated: 1 }, false],
  ];
  let selfOk = JSON.stringify(wordList({ name: 'Spotted cows.png', words: '[]' })) === JSON.stringify(wordsOf('Spotted cows.png'))
    && wordsField({ title: 'Oak tree', category: 'nature', tags: 'tree' }).includes('oak') && wordsField({ title: 'Oak tree', category: '', tags: '' }).includes('tre');
  for (const [label, path, d, want] of self) if (SHAPE[label](d, path).every((r) => r === true) !== want) selfOk = false;
  console.log(`Checks: ${[...seen].map(([l, n]) => `${l} ${n}`).join(', ')}`);
  console.log(`Self-test of the checks: ${selfOk ? 'ok' : 'FAILED'}`);
  if (fail.size) {
    console.log('Problems (documents affected):');
    for (const [k, n] of [...fail].sort()) console.log(`  ${k}  (${n})`);
  } else console.log('Every document has the shape its module reads.');
  console.log('Nothing written.');
  process.exit(fail.size || !selfOk ? 1 : 0);
}

if (!apply) { console.log('Nothing written. Add --check to check every document, --apply to write.'); process.exit(0); }

// ------------------------------------------------------------ --apply

const require = createRequire(new URL('./functions/package.json', import.meta.url));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: project });
const fdb = getFirestore();
fdb.settings({ ignoreUndefinedProperties: true });
// Batches of at most 400 documents and about 8 MB (a game's files and saves are big; a request holds 10 MiB).
let written = 0;
for (let i = 0; i < writes.length;) {
  const batch = fdb.batch();
  let n = 0, bytes = 0;
  while (i < writes.length && n < 400) {
    const [, path, data] = writes[i];
    const size = Buffer.byteLength(JSON.stringify(data)) + 200;
    if (n && bytes + size > 8_000_000) break;
    batch.set(fdb.doc(path), data);
    n++; i++; bytes += size;
  }
  await batch.commit();
  written += n;
  process.stdout.write(`\r  written ${written} / ${writes.length}`);
}
console.log('\nDone.');
