// On the box, as the service's user:
//   sudo -u hawkes node src/cli.ts admin <email> [name]     make (or promote) an admin; prints a one-time link to set the password
//   sudo -u hawkes node src/cli.ts password-link <email>    a one-time link to set a password (a customer locked out)
//   sudo -u hawkes node src/cli.ts grant <email> <credits> <why...>   add (or, negative, take) credits; the reason goes in their ledger
//   sudo -u hawkes node src/cli.ts lods refresh             asks Gen now for the levels of detail of every community thing and
//                                     game asset (lods.ts; bundles otherwise ask for what they miss as they're played)
import { publicUrl } from './config.ts';
import { ensureAdmin, getUserByEmail, passwordLink, type User } from './users.ts';
import { adjustCredits } from './admin.ts';
import { db } from './db.ts';
import { refreshLods } from './lods.ts';

const [cmd, email, ...rest] = process.argv.slice(2);
if (cmd === 'admin' && email) {
  const u = ensureAdmin(email, rest.join(' '));
  console.log(`${u.email} is an admin (${u.id}).`);
  console.log(`Set the password (one use, 24 hours): ${passwordLink(u.id, publicUrl())}`);
} else if (cmd === 'password-link' && email) {
  const u = getUserByEmail(email);
  if (!u) throw new Error(`No account for ${email}`);
  console.log(`One use, 24 hours: ${passwordLink(u.id, publicUrl())}`);
} else if (cmd === 'grant' && email && rest.length >= 2) {
  const u = getUserByEmail(email);
  if (!u) throw new Error(`No account for ${email}`);
  const r = adjustCredits({ email: 'the CLI' } as User, u.id, rest[0], rest.slice(1).join(' '));
  console.log(`${u.email} now has ${r.credits} credits.`);
} else if (cmd === 'lods' && (email ?? 'refresh') === 'refresh') {
  const ids = new Set<string>();
  for (const r of db.prepare('SELECT id, thumb FROM community_assets WHERE hidden = 0').all() as { id: string; thumb: string | null }[]) { ids.add(r.id); if (r.thumb) ids.add(r.thumb); }
  for (const r of db.prepare("SELECT DISTINCT asset FROM game_assets WHERE mime LIKE 'image/%' OR mime = 'model/gltf-binary'").all() as { asset: string }[]) ids.add(r.asset);
  console.log(`${await refreshLods([...ids])} of ${ids.size} assets have levels of detail in Gen (the rest are being made, or have none).`);
} else {
  console.log('usage: node src/cli.ts admin <email> [name] | password-link <email> | grant <email> <credits> <why...> | lods refresh');
  process.exit(1);
}
