// Sets up (or repairs) the portal box over SSH, from J's PC. Idempotent; secrets travel on stdin, never in arguments.
//   node deploy/setup.mjs --host 54.163.56.66 --key <ssh key> --env <server .env file>
// After this the box deploys itself from main (deploy/pull.mjs on a timer); run setup again only to change the .env,
// the units or the Caddyfile.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const host = arg('host');
const key = arg('key');
const envFile = arg('env');
if (!host || !key) throw new Error('usage: node deploy/setup.mjs --host <ip> --key <ssh key> [--env <server .env>]');
const DIR = '/srv/hawkes/hawkesgenwebsite';

function ssh(command, input) {
  const r = spawnSync('ssh', ['-i', key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', `ubuntu@${host}`, command], { input, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`ssh failed (${r.status}): ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ')}`);
  return r.stdout.trim();
}
const put = (file, dest, mode, owner = 'root:root') => ssh(`sudo install -m ${mode} -o ${owner.split(':')[0]} -g ${owner.split(':')[1]} /dev/stdin ${dest}`, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
const step = (s) => console.log(`[setup] ${s}`);

step('GitHub token for pulls (/etc/hawkes/github.env)');
ssh(`sudo mkdir -p /etc/hawkes && if ! sudo test -s /etc/hawkes/github.env; then sudo test -s /run/hawkes/github.env && sudo install -m 640 -o root -g hawkes /run/hawkes/github.env /etc/hawkes/github.env; fi; sudo test -s /etc/hawkes/github.env`);
ssh(`sudo install -m 755 /dev/stdin /usr/local/bin/git-credential-hawkes-portal`, '#!/bin/sh\n[ "$1" = get ] || exit 0\necho username=x-access-token\necho "password=$(sed -n \'s/^GITHUB_TOKEN=//p\' /etc/hawkes/github.env)"\n');
ssh(`sudo -u hawkes -H git config --global credential.https://github.com.helper /usr/local/bin/git-credential-hawkes-portal && sudo -u hawkes -H git config --global pull.ff only`);

step('code');
ssh(`sudo install -d -o hawkes -g hawkes /srv/hawkes && if [ -d ${DIR}/.git ]; then sudo -u hawkes -H git -C ${DIR} fetch -q origin main && sudo -u hawkes -H git -C ${DIR} merge --ff-only -q origin/main; else sudo -u hawkes -H git clone -q --branch main https://github.com/jgriffith3433/hawkesgenwebsite.git ${DIR}; fi && sudo install -d -m 700 -o hawkes -g hawkes ${DIR}/.data && sudo -u hawkes -H git -C ${DIR} log -1 --format='%h %s'`);

if (envFile) {
  step('.env');
  put(envFile, `${DIR}/.env`, 600, 'hawkes:hawkes');
}

step('services');
put(path.join(HERE, 'hawkesgen-portal.service'), '/etc/systemd/system/hawkesgen-portal.service', 644);
put(path.join(HERE, 'hawkesgen-portal-pull.service'), '/etc/systemd/system/hawkesgen-portal-pull.service', 644);
put(path.join(HERE, 'hawkesgen-portal-pull.timer'), '/etc/systemd/system/hawkesgen-portal-pull.timer', 644);
put(path.join(HERE, 'hawkesgen-portal-backup.service'), '/etc/systemd/system/hawkesgen-portal-backup.service', 644);
put(path.join(HERE, 'hawkesgen-portal-backup.timer'), '/etc/systemd/system/hawkesgen-portal-backup.timer', 644);
ssh('sudo systemctl daemon-reload && sudo systemctl enable -q hawkesgen-portal hawkesgen-portal-pull.timer hawkesgen-portal-backup.timer && sudo systemctl restart hawkesgen-portal && sudo systemctl start hawkesgen-portal-pull.timer hawkesgen-portal-backup.timer');
console.log(ssh('sleep 3; curl -s -m 5 http://127.0.0.1:8800/v1/health'));

step('Caddy');
put(path.join(HERE, 'Caddyfile'), '/tmp/Caddyfile.portal', 644);
ssh('sudo install -d -o caddy -g caddy /var/log/caddy && sudo touch /var/log/caddy/access.log && sudo chown caddy:caddy /var/log/caddy/access.log && sudo -u caddy caddy validate --config /tmp/Caddyfile.portal --adapter caddyfile >/dev/null 2>&1 && sudo install -m 644 /tmp/Caddyfile.portal /etc/caddy/Caddyfile && sudo rm /tmp/Caddyfile.portal && sudo systemctl reload-or-restart caddy && systemctl is-active caddy');
step('done');
