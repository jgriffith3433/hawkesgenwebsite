// On the box, as the service's user:
//   sudo -u hawkes node src/cli.ts admin <email> [name]     make (or promote) an admin; prints a one-time link to set the password
//   sudo -u hawkes node src/cli.ts password-link <email>    a one-time link to set a password (a customer locked out)
//   sudo -u hawkes node src/cli.ts grant <email> <credits> <why...>   add (or, negative, take) credits; the reason goes in their ledger
//   sudo -u hawkes node src/cli.ts lods refresh             asks Gen now for the levels of detail of every community thing and
//                                     game asset (lods.ts; bundles otherwise ask for what they miss as they're played)
//   sudo -u hawkes node src/cli.ts backup                   a consistent gzipped copy of portal.db in .data/backups (the server may be running);
//                                     prunes to 48 hourly + 30 daily; uploads the day's first copy when PORTAL_BACKUP_BUCKET is set
//   sudo -u hawkes node src/cli.ts restore <file>           puts a backup back (refuses while the server runs; keeps portal.db.before-restore)
import path from 'node:path';
import { DATA_DIR, PORT, env } from './config.ts';
import { backup, prune, restore, uploadDaily } from './backup.ts';

const [cmd, email, ...rest] = process.argv.slice(2);
const DB_FILE = path.join(DATA_DIR, 'portal.db');
const BACKUPS = path.join(DATA_DIR, 'backups');
if (cmd === 'backup') {
  const f = backup(DB_FILE, BACKUPS);
  console.log(`Backed up to ${f}`);
  const gone = prune(BACKUPS);
  if (gone.length) console.log(`Removed ${gone.length} old backup${gone.length === 1 ? '' : 's'}.`);
  const bucket = env('PORTAL_BACKUP_BUCKET');
  if (bucket) {
    try {
      const key = await uploadDaily(f, BACKUPS, bucket, env('PORTAL_BACKUP_REGION') ?? 'us-east-1');
      console.log(key ? `Uploaded to s3://${bucket}/${key}` : 'Today\'s copy is already in S3.');
    } catch (e) {
      console.error(`Upload to S3 failed: ${(e as Error).message}`); // the local copy stands; the next hour tries again
      process.exit(2);
    }
  }
} else if (cmd === 'restore' && email) {
  await restore(path.resolve(email), DB_FILE, PORT);
  console.log(`Restored ${email}. The old file is portal.db.before-restore; start the portal again.`);
} else if (cmd === 'admin' && email) {
  const { publicUrl } = await import('./config.ts');
  const { ensureAdmin, passwordLink } = await import('./users.ts');
  const u = ensureAdmin(email, rest.join(' '));
  console.log(`${u.email} is an admin (${u.id}).`);
  console.log(`Set the password (one use, 24 hours): ${passwordLink(u.id, publicUrl())}`);
} else if (cmd === 'password-link' && email) {
  const { publicUrl } = await import('./config.ts');
  const { getUserByEmail, passwordLink } = await import('./users.ts');
  const u = getUserByEmail(email);
  if (!u) throw new Error(`No account for ${email}`);
  console.log(`One use, 24 hours: ${passwordLink(u.id, publicUrl())}`);
} else if (cmd === 'grant' && email && rest.length >= 2) {
  const { getUserByEmail } = await import('./users.ts');
  const { adjustCredits } = await import('./admin.ts');
  const u = getUserByEmail(email);
  if (!u) throw new Error(`No account for ${email}`);
  const r = adjustCredits({ email: 'the CLI' } as any, u.id, rest[0], rest.slice(1).join(' '));
  console.log(`${u.email} now has ${r.credits} credits.`);
} else if (cmd === 'lods' && (email ?? 'refresh') === 'refresh') {
  const { db } = await import('./db.ts');
  const { refreshLods } = await import('./lods.ts');
  const ids = new Set<string>();
  for (const r of db.prepare('SELECT id, thumb FROM community_assets WHERE hidden = 0').all() as { id: string; thumb: string | null }[]) { ids.add(r.id); if (r.thumb) ids.add(r.thumb); }
  for (const r of db.prepare("SELECT DISTINCT asset FROM game_assets WHERE mime LIKE 'image/%' OR mime = 'model/gltf-binary'").all() as { asset: string }[]) ids.add(r.asset);
  console.log(`${await refreshLods([...ids])} of ${ids.size} assets have levels of detail in Gen (the rest are being made, or have none).`);
} else {
  console.log('usage: node src/cli.ts admin <email> [name] | password-link <email> | grant <email> <credits> <why...> | lods refresh | backup | restore <file>');
  process.exit(1);
}
