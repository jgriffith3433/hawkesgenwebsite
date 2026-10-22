// On the box, as the service's user:
//   sudo -u hawkes node src/cli.ts admin <email> [name]     make (or promote) an admin; prints a one-time link to set the password
//   sudo -u hawkes node src/cli.ts password-link <email>    a one-time link to set a password (a customer locked out)
//   sudo -u hawkes node src/cli.ts grant <email> <credits> <why...>   add (or, negative, take) credits; the reason goes in their ledger
import { publicUrl } from './config.ts';
import { ensureAdmin, getUserByEmail, passwordLink, type User } from './users.ts';
import { adjustCredits } from './admin.ts';

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
} else {
  console.log('usage: node src/cli.ts admin <email> [name] | password-link <email> | grant <email> <credits> <why...>');
  process.exit(1);
}
