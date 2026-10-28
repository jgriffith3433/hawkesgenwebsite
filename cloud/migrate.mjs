#!/usr/bin/env node
// Copies the old portal's database (portal.db, SQLite) into a Firestore project (docs/cloud.md: Phase B).
//
//   node cloud/migrate.mjs <path/to/portal.db> --project <firebase project id>          dry run: reads, maps, prints counts
//   node cloud/migrate.mjs <path/to/portal.db> --project <firebase project id> --apply  writes (application default
//                                                                                       credentials: gcloud auth
//                                                                                       application-default login)
// Options: --only <collection,...> copies only those collections (e.g. --only users,apiKeys).
//
// The mapping is docs/cloud.md's convention: a table becomes a collection named after it in camelCase (api_keys ->
// apiKeys), its primary key the document id (a key of two or more columns: the values joined with ":"; a table with no
// key: "r<rowid>"), the same column names. Writes are `set` (whole documents), so running it again replaces what an
// earlier run wrote and adds nothing twice. What is special:
//   users            users/{usr_id}: no password_hash; avatar and overseer (JSON text) become maps; disabled,
//                    referral_paid, cancel_at_period_end become booleans; refCodes/{ref_code} = { user } for each code.
//                    No logins/{uid}: a Firebase user is linked to the account by its email at the first Google sign-in.
//   api_keys         apiKeys/{key_hash}, disabled a boolean (accounts.ts mintApiKey asks disabled == false).
//   credit_ledger    users/{user_id}/ledger/{id} (without user_id: the path holds it), and the unique indexes as
//                    once/{key} = { user, tx, at }: stripe:<stripe_session_id>, invoice:<stripe_invoice_id>,
//                    refund:<job_id> for each job_refund row, first_bonus:<user> for a first_purchase_bonus row.
//   jobs             jobs/{id} with hold: null (the old ledger rows are the record of what was taken).
//   friends          friends/{user_id}:{friend_id} (friends.ts: the unique pair is the key, not the old fr_ id).
//   friend_requests  friendRequests/{from_id}:{to_id} (presence.ts).
// Not copied: sessions and password_tokens (everyone signs in with Google again), and what only mattered for a moment
// on the box: upload_tokens, oauth_codes, locks, rate_hits, live_seq, demo_runs, play_seen.
// AREAS STILL BEING PORTED (games, community, kits, shares, OAuth, tasks, LODs, the assistant): their tables are mapped by
// the same convention here (games, gameMembers/{game_id}:{user_id}, gameInvites, gameFiles, gameAssets, gameReleases,
// gameChat, gamesReports, gameGen, communityAssets, communityUses, communityKits, shares, oauthClients, oauthTokens,
// connections, tasks, genLods). Each of those modules must agree with this (or change the mapping below), including
// which columns hold JSON text or 0/1 flags: they are copied as they are.
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !['--project', '--only'].includes(args[i - 1]));
const project = flag('--project');
const apply = args.includes('--apply');
const only = flag('--only') ? new Set(flag('--only').split(',').map((s) => s.trim()).filter(Boolean)) : null;
if (!file || !project) {
  console.error('Usage: node cloud/migrate.mjs <portal.db> --project <firebase project id> [--apply] [--only users,apiKeys]');
  process.exit(2);
}
if (!fs.existsSync(file)) { console.error(`No such file: ${file}`); process.exit(2); }

const sqlite = new DatabaseSync(file, { readOnly: true });

const SKIP = new Set(['sessions', 'password_tokens', 'upload_tokens', 'oauth_codes', 'locks', 'rate_hits', 'live_seq', 'demo_runs', 'play_seen']);
const camel = (t) => t.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const json = (v) => { if (typeof v !== 'string' || !v) return v ?? null; try { return JSON.parse(v); } catch { return null; } };
const bool = (v) => (v === null || v === undefined ? v : Boolean(Number(v)));
const safeId = (s) => String(s).replace(/\//g, '_');

const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const has = (t) => tables.includes(t);
const keyOf = (t) => sqlite.prepare(`PRAGMA table_info(${t})`).all().filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
const rowsOf = (t) => {
  const rowid = (() => { try { sqlite.prepare(`SELECT rowid FROM ${t} LIMIT 1`).all(); return true; } catch { return false; } })();
  return sqlite.prepare(`SELECT ${rowid ? 'rowid AS __rowid, ' : ''}* FROM ${t}`).all();
};

/** Every write as [path, data]. */
const writes = [];
const counts = new Map();
const put = (collectionLabel, path, data) => {
  if (only && !only.has(collectionLabel)) return;
  writes.push([path, data]);
  counts.set(collectionLabel, (counts.get(collectionLabel) ?? 0) + 1);
};
const strip = (r) => { const o = { ...r }; delete o.__rowid; return o; };

// ------------------------------------------------------------ users and their money

const userIds = new Set();
if (has('users')) {
  for (const r of rowsOf('users')) {
    const u = strip(r);
    delete u.password_hash;
    for (const k of ['avatar', 'overseer']) if (k in u) u[k] = json(u[k]);
    for (const k of ['disabled', 'referral_paid', 'cancel_at_period_end']) if (k in u) u[k] = bool(u[k]);
    u.disabled ??= false;
    u.plan ??= 'free';
    userIds.add(u.id);
    const id = u.id;
    delete u.id;
    put('users', `users/${safeId(id)}`, u);
    if (u.ref_code) put('refCodes', `refCodes/${safeId(u.ref_code)}`, { user: id });
  }
}

if (has('api_keys')) {
  for (const r of rowsOf('api_keys')) {
    const k = strip(r);
    k.disabled = bool(k.disabled) ?? false;
    put('apiKeys', `apiKeys/${safeId(k.key_hash)}`, k);
  }
}

let orphans = 0;
if (has('credit_ledger')) {
  for (const r of rowsOf('credit_ledger')) {
    const e = strip(r);
    if (!userIds.has(e.user_id)) { orphans++; continue; }
    const user = e.user_id, tx = e.id;
    delete e.user_id;
    delete e.id;
    put('users/*/ledger', `users/${safeId(user)}/ledger/${safeId(tx)}`, e);
    const once = (key) => put('once', `once/${safeId(key)}`, { user, tx, at: e.created });
    if (e.stripe_session_id) once(`stripe:${e.stripe_session_id}`);
    if (e.stripe_invoice_id) once(`invoice:${e.stripe_invoice_id}`);
    if (e.kind === 'job_refund' && e.job_id) once(`refund:${e.job_id}`);
    if (e.kind === 'first_purchase_bonus') once(`first_bonus:${user}`);
  }
}

let unsettled = 0;
if (has('jobs')) {
  for (const r of rowsOf('jobs')) {
    const j = strip(r);
    const id = j.id;
    delete j.id;
    j.hold = null;
    j.via ??= null;
    j.settled ??= null;
    if (j.settled === null) unsettled++;
    put('jobs', `jobs/${safeId(id)}`, j);
  }
}

// ------------------------------------------------------------ this area's own: friends and friend requests

if (has('friends')) for (const r of rowsOf('friends')) { const f = strip(r); put('friends', `friends/${safeId(`${f.user_id}:${f.friend_id}`)}`, f); }
if (has('friend_requests')) for (const r of rowsOf('friend_requests')) { const f = strip(r); put('friendRequests', `friendRequests/${safeId(`${f.from_id}:${f.to_id}`)}`, f); }

// ------------------------------------------------------------ every other table, by the convention

const DONE = new Set(['users', 'api_keys', 'credit_ledger', 'jobs', 'friends', 'friend_requests']);
const skipped = [];
for (const t of tables) {
  if (DONE.has(t)) continue;
  if (SKIP.has(t)) { skipped.push(`${t} (${sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n})`); continue; }
  const key = keyOf(t);
  const name = camel(t);
  for (const r of rowsOf(t)) {
    const id = key.length ? key.map((k) => r[k]).join(':') : `r${r.__rowid}`;
    const doc = strip(r);
    // A single text key is the document id and stays a field too (the SQLite row as it was).
    put(name, `${name}/${safeId(id)}`, doc);
  }
}

// ------------------------------------------------------------ report, then (with --apply) write

console.log(`${apply ? 'APPLY' : 'Dry run'}: ${file} -> Firestore project "${project}"${only ? ` (only ${[...only].join(', ')})` : ''}`);
for (const [c, n] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${c.padEnd(22)} ${n}`);
console.log(`  ${'(documents in all)'.padEnd(22)} ${writes.length}`);
if (skipped.length) console.log(`Not copied: ${skipped.join(', ')}`);
if (orphans) console.log(`Ledger rows of accounts that no longer exist (not copied): ${orphans}`);
if (unsettled) console.log(`Jobs not yet settled: ${unsettled}. They are copied with hold: null; jobs.ts settles them, but gives credits back only through a hold, so check them by hand after the move (GET /v1/admin/users/<id>).`);
if (!apply) { console.log('Nothing written. Add --apply to write.'); process.exit(0); }

const require = createRequire(new URL('./functions/package.json', import.meta.url));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: project });
const fdb = getFirestore();
fdb.settings({ ignoreUndefinedProperties: true });
let written = 0;
for (let i = 0; i < writes.length; i += 400) {
  const batch = fdb.batch();
  for (const [path, data] of writes.slice(i, i + 400)) batch.set(fdb.doc(path), data);
  await batch.commit();
  written += Math.min(400, writes.length - i);
  process.stdout.write(`\r  written ${written} / ${writes.length}`);
}
console.log('\nDone.');
