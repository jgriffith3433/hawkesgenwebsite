// Puts the portal's secrets into a Google Cloud project's Secret Manager (from J's PC). Values travel on stdin and are
// never printed. Idempotent: an existing secret gets a new version only with --replace.
//   node cloud/setup-secrets.mjs --project hawkes-staging            beta: its own key on gen-beta (ustg_*), no Stripe
//   node cloud/setup-secrets.mjs --project hawkes-prod --from-box     live: the values the portal box has
//   node cloud/setup-secrets.mjs --project hawkes-prod --resend C:/Projects/resend.txt --replace   Resend's sending key from a file
//   node cloud/setup-secrets.mjs --project hawkes-staging --only PORTAL_PLATFORM_KEY   just the platform token's signing key
//   (staging gets RESEND_API_KEY "unset": it sends no mail)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? (process.argv[i + 1] ?? true) : undefined; };
const project = arg('project');
if (!project) throw new Error('usage: node cloud/setup-secrets.mjs --project <id> [--from-box] [--replace]');
const replace = Boolean(arg('replace'));
const gcloud = path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd');
// gcloud is a .cmd under "Cloud SDK" (a space): run it through cmd with the path quoted.
const run = (args, input) => spawnSync(`"${gcloud}"`, args, { input, encoding: 'utf8', shell: true, windowsHide: true });
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

function readBox() {
  const key = path.resolve(HERE, '..', '..', 'hawkesstudio', 'deploy', '.keys', 'gen_public_ed25519');
  // Git's ssh (Windows' own refuses keys whose file permissions it doesn't like, and asks about new hosts).
  const gitSsh = 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe';
  const ssh = fs.existsSync(gitSsh) ? gitSsh : 'ssh';
  const r = spawnSync(ssh, ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-i', key, 'ubuntu@34.181.136.216', 'sudo cat /srv/hawkes/hawkesgenwebsite/.env'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`could not read the portal box .env: ${(r.stderr || '').trim().split('\n').pop()}`);
  return Object.fromEntries(r.stdout.split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]));
}

async function genKeyFor(prefix) {
  // Beta never touches live: the staging project's key is made on gen-beta with the beta owner key (cloud/point-gen.mjs
  // does the same and also sets HAWKESGEN_URL).
  if (project === 'hawkes-prod') throw new Error('live takes its Gen key from the box (--from-box) or cloud/point-gen.mjs');
  const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hawkes', 'client.json'), 'utf8'));
  const gen = 'https://gen-beta.hawkesgen.ai';
  if (!c.genBetaKey) throw new Error('~/.hawkes/client.json has no genBetaKey');
  const r = await fetch(`${gen}/v1/clients`, { method: 'POST', headers: { Authorization: `Bearer ${String(c.genBetaKey).trim()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'portal (beta)', role: 'user', projects: [`${prefix}*`] }) });
  if (!r.ok) throw new Error(`Gen would not make the key: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).key;
}

const box = arg('from-box') ? readBox() : {};
const exists = (name) => run(['secrets', 'describe', name, '--project', project, '--format=value(name)']).status === 0;
const values = {
  HAWKESGEN_KEY: async () => box.HAWKESGEN_KEY ?? genKeyFor('ustg_'),
  STRIPE_SECRET_KEY: async () => box.STRIPE_SECRET_KEY ?? 'unset',
  STRIPE_WEBHOOK_SECRET: async () => box.STRIPE_WEBHOOK_SECRET ?? 'unset',
  GOOGLE_CLIENT_SECRET: async () => box.GOOGLE_CLIENT_SECRET ?? readBox().GOOGLE_CLIENT_SECRET,
  PORTAL_SIGNING_KEY: async () => crypto.randomBytes(32).toString('base64url'),
  // The platform token's Ed25519 key (functions/src/platform-token.ts), PKCS#8 PEM. To rotate: --replace with a new key
  // first and the old one after it in the same secret (both are published in the JWKS), then drop the old one.
  PORTAL_PLATFORM_KEY: async () => crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }),
  RESEND_API_KEY: async () => (arg('resend') ? fs.readFileSync(String(arg('resend')), 'utf8').trim().replace(/^[A-Za-z_ ]*[=:]\s*/, '') : 'unset'),
};
for (const [name, get] of Object.entries(values)) {
  const has = exists(name);
  // --replace with --resend only replaces the Resend key; --only NAME touches that one secret alone.
  if (arg('only') && name !== arg('only')) continue;
  if (has && (!replace || (arg('resend') && name !== 'RESEND_API_KEY'))) { console.log(`${name}: kept`); continue; }
  const v = await get();
  const r = has ? run(['secrets', 'versions', 'add', name, '--data-file=-', '--project', project], v) : run(['secrets', 'create', name, '--data-file=-', '--replication-policy=automatic', '--project', project], v);
  console.log(`${name}: ${r.status === 0 ? (has ? 'new version' : 'made') : 'FAILED ' + (r.stderr || '').trim().split('\n').pop()}`);
}
