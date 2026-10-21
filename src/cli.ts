// On the box, as the service's user:
//   sudo -u hawkes node src/cli.ts admin <email> [name]     make (or promote) an admin; prints a one-time link to set the password
//   sudo -u hawkes node src/cli.ts password-link <email>    a one-time link to set a password (a customer locked out)
import { publicUrl } from './config.ts';
import { ensureAdmin, getUserByEmail, passwordLink } from './users.ts';

const [cmd, email, ...rest] = process.argv.slice(2);
if (cmd === 'admin' && email) {
  const u = ensureAdmin(email, rest.join(' '));
  console.log(`${u.email} is an admin (${u.id}).`);
  console.log(`Set the password (one use, 24 hours): ${passwordLink(u.id, publicUrl())}`);
} else if (cmd === 'password-link' && email) {
  const u = getUserByEmail(email);
  if (!u) throw new Error(`No account for ${email}`);
  console.log(`One use, 24 hours: ${passwordLink(u.id, publicUrl())}`);
} else {
  console.log('usage: node src/cli.ts admin <email> [name] | password-link <email>');
  process.exit(1);
}
