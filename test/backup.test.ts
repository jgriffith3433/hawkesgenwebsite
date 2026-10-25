// Backups of portal.db: a copy while the server writes, a restore that brings back an account and its credits, pruning,
// the refusal while the server runs, the S3 signature's shape, and the AWS script's dry run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { backup, listBackups, prune, restore, signPut } from '../src/backup.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'portal-backup-'));
const SCHEMA = 'CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, credits INTEGER); CREATE TABLE credit_ledger (id INTEGER PRIMARY KEY, user_id TEXT, delta INTEGER, balance_after INTEGER);';
function makeDb(file: string) {
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL;');
  d.exec(SCHEMA);
  return d;
}

test('a backup made while the server writes restores a user and their credits', async () => {
  const dir = tmp();
  const dbFile = path.join(dir, 'portal.db');
  const live = makeDb(dbFile); // the "server": stays open and keeps writing
  live.prepare('INSERT INTO users VALUES (?, ?, ?)').run('usr_1', 'ada@example.com', 120);
  live.prepare('INSERT INTO credit_ledger (user_id, delta, balance_after) VALUES (?, ?, ?)').run('usr_1', 120, 120);
  let n = 0;
  const writer = setInterval(() => live.prepare('INSERT INTO credit_ledger (user_id, delta, balance_after) VALUES (?, 0, 120)').run('usr_1') && n++, 1);
  const file = backup(dbFile, path.join(dir, 'backups'), new Date('2026-10-25T10:00:00Z'));
  clearInterval(writer);
  assert.match(path.basename(file), /^portal-20261025T100000Z\.db\.gz$/);
  assert.equal(zlib.gunzipSync(fs.readFileSync(file)).subarray(0, 15).toString(), 'SQLite format 3');

  // disaster: the server's file is lost and replaced by something else
  live.prepare("UPDATE users SET credits = 0 WHERE id = 'usr_1'").run();
  live.close();
  fs.writeFileSync(dbFile, 'garbage');
  await restore(file, dbFile, 1); // port 1: nothing listens
  assert.equal(fs.readFileSync(`${dbFile}.before-restore`, 'utf8'), 'garbage');
  const back = new DatabaseSync(dbFile);
  assert.deepEqual({ ...(back.prepare("SELECT email, credits FROM users WHERE id = 'usr_1'").get() as object) }, { email: 'ada@example.com', credits: 120 });
  assert.ok((back.prepare("SELECT COUNT(*) AS c FROM credit_ledger WHERE user_id = 'usr_1'").get() as { c: number }).c >= 1);
  back.close();
});

test('restore refuses while the server runs, and refuses a file that is not a database', async () => {
  const dir = tmp();
  const dbFile = path.join(dir, 'portal.db');
  makeDb(dbFile).close();
  const file = backup(dbFile, path.join(dir, 'backups'));
  const srv = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const port = (srv.address() as net.AddressInfo).port;
  await assert.rejects(restore(file, dbFile, port), /running/);
  srv.close();
  const junk = path.join(dir, 'junk.db.gz');
  fs.writeFileSync(junk, zlib.gzipSync('not sqlite'));
  await assert.rejects(restore(junk, dbFile, 1), /not a SQLite database/);
  assert.ok(fs.existsSync(dbFile) && !fs.existsSync(`${dbFile}.before-restore`));
});

test('old backups are pruned: 48 hourly and 30 daily', () => {
  const dir = tmp();
  const put = (d: Date) => fs.writeFileSync(path.join(dir, `portal-${d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}.db.gz`), 'x');
  const end = Date.UTC(2026, 9, 25, 12);
  for (let h = 0; h < 24 * 40; h++) put(new Date(end - h * 3600_000)); // 40 days of hourly copies
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a backup');
  const gone = prune(dir);
  const kept = listBackups(dir);
  assert.equal(gone.length + kept.length, 960);
  assert.ok(kept.includes('portal-20261025T120000Z.db.gz'));
  assert.ok(kept.includes('portal-20261023T130000Z.db.gz')); // the 48th newest
  assert.ok(!kept.includes('portal-20261023T120000Z.db.gz')); // the 49th, and not its day's newest
  assert.ok(kept.includes('portal-20261022T230000Z.db.gz')); // a day's newest
  const days = new Set(kept.map((f) => f.slice(7, 15)));
  assert.equal(days.size, 30); // 30 days, no more
  assert.ok(!days.has('20260915')); // older than that: gone
  assert.equal(kept.length, 48 + 27); // the newest 48, plus the newest of each older day
  assert.ok(fs.existsSync(path.join(dir, 'notes.txt')));
  // pruning again removes nothing
  assert.deepEqual(prune(dir), []);
});

test('the S3 PUT is signed with SigV4 and the role token', () => {
  const s = signPut({ bucket: 'b', region: 'us-east-1', key: 'portal/x.db.gz', body: Buffer.from('hi'), creds: { AccessKeyId: 'AKIA', SecretAccessKey: 's', Token: 'tok' }, now: new Date('2026-10-25T10:00:00Z') });
  assert.equal(s.url, 'https://b.s3.us-east-1.amazonaws.com/portal/x.db.gz');
  assert.match(s.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIA\/20261025\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amz-server-side-encryption, Signature=[0-9a-f]{64}$/);
  assert.equal(s.headers['x-amz-security-token'], 'tok');
});

test('deploy/backup-aws.mjs without --apply prints the plan and changes nothing', () => {
  const bin = tmp(); // an `aws` that records any call; the dry run must not make one
  const log = path.join(bin, 'calls.log');
  fs.writeFileSync(path.join(bin, 'aws'), `#!/bin/sh\necho "$@" >> ${log}\nexit 1\n`, { mode: 0o755 });
  const r = spawnSync('node', ['deploy/backup-aws.mjs'], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN/);
  assert.match(r.stdout, /S3 bucket\s+s3:\/\/hawkes-portal-backups-/);
  assert.match(r.stdout, /s3:PutObject on arn:aws:s3:::hawkes-portal-backups-\d+\/portal\/\*/);
  assert.match(r.stdout, /daily 03:00 UTC, kept 14 days/);
  assert.equal(fs.existsSync(log), false);
});

test('node src/cli.ts backup copies the database of a data dir, and prunes', () => {
  const dir = tmp();
  makeDb(path.join(dir, 'portal.db')).close();
  const run = () => spawnSync('node', ['--disable-warning=ExperimentalWarning', 'src/cli.ts', 'backup'], { encoding: 'utf8', env: { ...process.env, PORTAL_DATA_DIR: dir, PORTAL_BACKUP_BUCKET: '' } });
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(listBackups(path.join(dir, 'backups')).length, 1);
});
