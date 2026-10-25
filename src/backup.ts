// Backups of .data/portal.db (accounts, credits, the ledger, Stripe records): a consistent copy while the server runs
// (VACUUM INTO on its own connection; WAL readers never block the server's writes), gzipped into .data/backups, pruned to
// 48 hourly and 30 daily, and, when PORTAL_BACKUP_BUCKET is set, the first copy of each UTC day uploaded to S3.
// Nothing here opens db.ts: restore must run with the database closed. No dependencies: the S3 PUT is signed with
// SigV4 from node:crypto using the instance role's credentials (IMDSv2).
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

export const KEEP_HOURLY = 48;
export const KEEP_DAILY = 30;
const NAME = /^portal-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db\.gz$/;

export const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

/** A consistent, gzipped copy of the database at `dir/portal-<UTC time>.db.gz`; returns its path. */
export function backup(dbFile: string, dir: string, now = new Date()): string {
  if (!fs.existsSync(dbFile)) throw new Error(`No database at ${dbFile}`);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `portal-${stamp(now)}.db.gz`);
  const tmp = path.join(dir, `.portal-${stamp(now)}.${process.pid}.db`);
  const src = new DatabaseSync(dbFile);
  try {
    src.exec('PRAGMA busy_timeout = 30000');
    src.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }
  try {
    fs.writeFileSync(`${out}.part`, zlib.gzipSync(fs.readFileSync(tmp)), { mode: 0o600 });
    fs.renameSync(`${out}.part`, out);
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(`${out}.part`, { force: true });
  }
  return out;
}

export const listBackups = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => NAME.test(f)).sort() : []);

/** Keeps the newest `hourly` copies and the newest copy of each of the last `daily` UTC days; removes the rest. */
export function prune(dir: string, hourly = KEEP_HOURLY, daily = KEEP_DAILY): string[] {
  const all = listBackups(dir).reverse(); // newest first
  const keep = new Set(all.slice(0, hourly));
  const days = new Set<string>();
  for (const f of all) {
    const day = f.slice(7, 15);
    if (days.has(day)) continue;
    if (days.size >= daily) break;
    days.add(day);
    keep.add(f);
  }
  const gone = all.filter((f) => !keep.has(f));
  for (const f of gone) fs.rmSync(path.join(dir, f), { force: true });
  return gone;
}

/** True when something listens on the portal's port (the server is up), so restoring would be unsafe. */
export const serverRunning = (port: number, host = '127.0.0.1') => new Promise<boolean>((resolve) => {
  const s = net.connect({ port, host });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
  s.setTimeout(1500, () => { s.destroy(); resolve(false); });
});

/** Puts a backup in place of the database; the current file stays beside it as portal.db.before-restore. */
export async function restore(file: string, dbFile: string, port: number): Promise<void> {
  if (await serverRunning(port)) throw new Error(`The portal is running on port ${port}: stop it first (sudo systemctl stop hawkesgen-portal), restore, then start it.`);
  const raw = fs.readFileSync(file);
  const data = file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw;
  if (data.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error(`${file} is not a SQLite database`);
  const tmp = `${dbFile}.restoring`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  const check = new DatabaseSync(tmp);
  try {
    const r = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (r.integrity_check !== 'ok') throw new Error(`${file} fails its integrity check: ${r.integrity_check}`);
  } finally {
    check.close();
  }
  if (fs.existsSync(dbFile)) fs.renameSync(dbFile, `${dbFile}.before-restore`);
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
  fs.renameSync(tmp, dbFile);
}

// ------------------------------------------------------------------ off the box: S3 with the instance role
const hmac = (key: crypto.BinaryLike, s: string) => crypto.createHmac('sha256', key).update(s).digest();
const sha = (b: crypto.BinaryLike) => crypto.createHash('sha256').update(b).digest('hex');

type Creds = { AccessKeyId: string; SecretAccessKey: string; Token: string };
const IMDS = 'http://169.254.169.254/latest';

async function roleCredentials(imds = IMDS): Promise<Creds> {
  const token = await (await fetch(`${imds}/api/token`, { method: 'PUT', headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '300' }, signal: AbortSignal.timeout(3000) })).text();
  const h = { 'X-aws-ec2-metadata-token': token };
  const base = `${imds}/meta-data/iam/security-credentials/`;
  const role = (await (await fetch(base, { headers: h, signal: AbortSignal.timeout(3000) })).text()).trim().split('\n')[0];
  if (!role) throw new Error('This box has no instance role (run deploy/backup-aws.mjs --apply)');
  return await (await fetch(base + role, { headers: h, signal: AbortSignal.timeout(3000) })).json() as Creds;
}

/** The headers of a SigV4-signed S3 PUT of `body` at `key` (exported for the test, which checks the signature shape). */
export function signPut(opts: { bucket: string; region: string; key: string; body: Buffer; creds: Creds; now?: Date; host?: string }) {
  const { bucket, region, key, body, creds } = opts;
  const host = opts.host ?? `${bucket}.s3.${region}.amazonaws.com`;
  const amz = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const date = amz.slice(0, 8);
  const uri = '/' + key.split('/').map((p) => encodeURIComponent(p)).join('/');
  const payload = sha(body);
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payload, 'x-amz-date': amz, 'x-amz-security-token': creds.Token, 'x-amz-server-side-encryption': 'AES256' };
  const names = Object.keys(headers).sort();
  const canonical = ['PUT', uri, '', ...names.map((n) => `${n}:${headers[n]}\n`), names.join(';'), payload].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha(canonical)].join('\n');
  const k = hmac(hmac(hmac(hmac(`AWS4${creds.SecretAccessKey}`, date), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', k).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${creds.AccessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return { url: `https://${host}${uri}`, headers, canonical };
}

export async function uploadToS3(file: string, key: string, bucket: string, region: string): Promise<void> {
  const creds = await roleCredentials();
  const body = fs.readFileSync(file);
  const { url, headers } = signPut({ bucket, region, key, body, creds });
  const { host: _h, ...send } = headers;
  const res = await fetch(url, { method: 'PUT', headers: send, body, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`S3 said ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** The first copy of each UTC day goes off the box (marker file `.uploaded` holds the last day sent). */
export async function uploadDaily(file: string, dir: string, bucket: string, region: string): Promise<string | null> {
  const day = path.basename(file).slice(7, 15);
  const marker = path.join(dir, '.uploaded');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() >= day) return null;
  const key = `portal/portal-${day}.db.gz`;
  await uploadToS3(file, key, bucket, region);
  fs.writeFileSync(marker, day + '\n');
  return key;
}
