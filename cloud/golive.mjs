// hawkesgen.com goes live on Firebase (docs/cloud.md). J runs it from his PC; every step says what it does and checks
// itself, and the old portal (the Google VM) is stopped, not deleted, so `rollback` is a DNS change and a restart.
//
//   node cloud/golive.mjs prepare [--no-deploy]   1. deploy to hawkes-prod (its own address; hawkesgen.com still points at the VM)
//                                    2. register hawkesgen.com and www with Firebase Hosting
//                                    3. add the verification and certificate records Firebase asks for (not the A records)
//                                    4. wait for the certificate (it can take a while: run `status` later)
//   node cloud/golive.mjs status     where the domains and their certificates stand
//   node cloud/golive.mjs switch     5. stop the VM portal (downtime starts), copy its database into Firestore
//                                    6. check the copy, point hawkesgen.com and www at Firebase, wait for https, check it
//   node cloud/golive.mjs rollback   DNS back to the VM, the VM portal started again (Firestore keeps what it had)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PROJECT = 'hawkes-prod';
const SITE = 'hawkes-prod';
const DOMAINS = ['hawkesgen.com', 'www.hawkesgen.com'];
const VM = '34.181.136.216';
const KEY = path.resolve(ROOT, '..', 'hawkesstudio', 'deploy', '.keys', 'gen_public_ed25519');
const GCLOUD = path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd');
const GIT_SSH = 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe';
const step = (s) => console.log(`\x1b[36m[golive] ${s}\x1b[0m`);
const fail = (s) => { console.error(`\x1b[31m[golive] ${s}\x1b[0m`); process.exit(1); };

function run(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { cwd: o.cwd ?? ROOT, encoding: 'utf8', shell: o.shell ?? false, stdio: o.quiet ? 'pipe' : ['pipe', 'inherit', 'inherit'], input: o.input, env: { ...process.env, ...(o.env ?? {}) } });
  if (r.status !== 0 && !o.ok) fail(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')} failed (${r.status})${o.quiet ? `: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}` : ''}`);
  return r;
}
const ssh = (command, o = {}) => run(fs.existsSync(GIT_SSH) ? GIT_SSH : 'ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-i', KEY, `ubuntu@${VM}`, command], o);
const dns = (...args) => run('py', ['-I', path.join(HERE, 'dns.py'), ...args]);
const token = () => run(`"${GCLOUD}"`, ['auth', 'print-access-token'], { shell: true, quiet: true }).stdout.trim();

async function hosting(method, p, body) {
  const r = await fetch(`https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT}/sites/${SITE}${p}`, {
    method, headers: { Authorization: `Bearer ${token()}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !(method === 'POST' && r.status === 409)) fail(`Firebase Hosting ${method} ${p}: ${r.status} ${j.error?.message ?? ''}`);
  return j;
}
const domain = (d) => hosting('GET', `/customDomains/${d}`);

/** The records Firebase wants for a domain: [{ name, type, value, action }]. */
function wanted(cd) {
  const out = [];
  for (const set of cd.requiredDnsUpdates?.desired ?? []) for (const r of set.records ?? []) out.push({ name: r.domainName ?? set.domainName, type: r.type, value: r.rdata, action: r.requiredAction });
  // The certificate's DNS check (_acme-challenge TXT): with it, the certificate is made before any traffic moves.
  for (const set of cd.cert?.verification?.dns?.desired ?? []) for (const r of set.records ?? []) out.push({ name: r.domainName ?? set.domainName, type: r.type, value: r.rdata, action: r.requiredAction ?? 'ADD' });
  return out;
}

async function status() {
  for (const d of DOMAINS) {
    const cd = await domain(d);
    console.log(`${d}: host ${cd.hostState ?? '?'}, ownership ${cd.ownershipState ?? '?'}, certificate ${cd.cert?.state ?? '?'}`);
    for (const r of wanted(cd)) console.log(`   ${r.action ?? ''} ${r.name} ${r.type} ${r.value}`);
  }
}

async function prepare() {
  step('1. deploy to hawkes-prod (https://hawkes-prod.web.app; hawkesgen.com is not touched)');
  if (process.argv.includes('--no-deploy')) console.log('    (skipped: --no-deploy)');
  else run('firebase', ['deploy', '--only', 'hosting,functions:portal,firestore', '--project', 'prod', '--non-interactive', '--force'], { shell: true });
  const h = await (await fetch('https://hawkes-prod.web.app/v1/health')).json().catch(() => null);
  if (!h?.ok) fail('hawkes-prod.web.app/v1/health is not ok');
  console.log('   ', JSON.stringify(h));

  step('2. register hawkesgen.com and www with Firebase Hosting');
  for (const d of DOMAINS) await hosting('POST', `/customDomains?customDomainId=${d}`, d.startsWith('www.') ? { redirectTarget: 'hawkesgen.com' } : {});
  await new Promise((r) => setTimeout(r, 15_000));

  step('3. the verification and certificate records (TXT, CNAME): A records wait for `switch`');
  for (const d of DOMAINS) {
    for (const r of wanted(await domain(d))) {
      // A, AAAA and a CNAME on the domain itself move its traffic: those wait for `switch`.
      if (r.action !== 'ADD' || ['A', 'AAAA'].includes(r.type) || (r.type === 'CNAME' && r.name.replace(/\.$/, '') === d)) continue;
      if (r.type === 'TXT') dns('add', r.name, 'TXT', r.value);
      else dns('set', r.name, r.type, r.value);
    }
  }
  step('4. Firebase checks those and makes the certificate (minutes, sometimes an hour). `status` shows it; `switch` when it says CERT_ACTIVE (or CERT_PROPAGATING).');
  await status();
}

async function switchOver() {
  for (const d of DOMAINS) {
    const s = (await domain(d)).cert?.state;
    if (!['CERT_ACTIVE', 'CERT_PROPAGATING'].includes(s) && !process.argv.includes('--force')) fail(`${d}: certificate ${s ?? 'unknown'}. Wait (run status), or switch with --force (https may fail for a few minutes).`);
  }
  const live = await (await fetch('https://hawkes-prod.web.app/v1/health')).json().catch(() => null);
  if (!live?.ok) fail('hawkes-prod.web.app is not healthy: run prepare first');

  step('5. stop the VM portal (downtime starts) and copy its database');
  ssh('sudo systemctl stop hawkesgen-portal-pull.timer hawkesgen-portal-backup.timer hawkesgen-portal; systemctl is-active hawkesgen-portal; true');
  const db = path.join(HERE, '.portal-final.db');
  const dump = ssh(`sudo -u hawkes node -e "const {DatabaseSync}=require('node:sqlite');require('fs').rmSync('/tmp/final.db',{force:true});new DatabaseSync('/srv/hawkes/hawkesgenwebsite/.data/portal.db',{readOnly:true}).exec(\\"VACUUM INTO '/tmp/final.db'\\")" && sudo base64 -w0 /tmp/final.db && sudo rm -f /tmp/final.db`, { quiet: true, ok: true });
  if (dump.status !== 0 || !dump.stdout) { step('could not copy the database: starting the VM portal again'); ssh('sudo systemctl start hawkesgen-portal hawkesgen-portal-pull.timer'); fail('database copy failed'); }
  fs.writeFileSync(db, Buffer.from(dump.stdout.trim(), 'base64'));
  try {
    const m = (extra) => run('node', ['--disable-warning=ExperimentalWarning', path.join(HERE, 'migrate.mjs'), db, '--project', PROJECT, ...extra], { cwd: path.join(HERE, 'functions'), env: { GOOGLE_CLOUD_PROJECT: PROJECT } });
    m(['--check']);
    m(['--apply']);
  } catch (e) {
    ssh('sudo systemctl start hawkesgen-portal hawkesgen-portal-pull.timer');
    throw e;
  } finally {
    fs.rmSync(db, { force: true });
  }

  step('6. hawkesgen.com and www -> Firebase');
  for (const d of DOMAINS) {
    const a = wanted(await domain(d)).filter((r) => r.type === 'A' && r.name.replace(/\.$/, '') === d).map((r) => r.value);
    const aaaa = wanted(await domain(d)).filter((r) => r.type === 'AAAA' && r.name.replace(/\.$/, '') === d).map((r) => r.value);
    const cname = wanted(await domain(d)).filter((r) => r.type === 'CNAME' && r.name.replace(/\.$/, '') === d);
    if (cname.length) dns('point', d, 'CNAME', cname[0].value);
    else {
      if (a.length) dns('point', d, 'A', ...a);
      if (aaaa.length) dns('set', d, 'AAAA', ...aaaa);
    }
  }
  step('waiting for https://hawkesgen.com to answer from Firebase');
  for (let i = 0; i < 60; i++) {
    const h = await fetch('https://hawkesgen.com/v1/health', { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
    if (h?.cloud === 'gcp') { console.log('   ', JSON.stringify(h)); break; }
    await new Promise((r) => setTimeout(r, 10_000));
    if (i === 59) step('not answering from Firebase yet (DNS caches, certificate): check again in a few minutes; `rollback` puts the VM back');
  }
  ssh('sudo systemctl disable -q hawkesgen-portal hawkesgen-portal-pull.timer; true');
  step('live on Firebase. The VM is stopped and kept (its database stays there). Next: sign in, buy nothing, run one job, look at /admin.');
}

async function rollback() {
  step('DNS back to the VM, and the VM portal started again');
  ssh('sudo systemctl enable -q hawkesgen-portal hawkesgen-portal-pull.timer; sudo systemctl start hawkesgen-portal hawkesgen-portal-pull.timer; sleep 3; curl -s -m 5 http://127.0.0.1:8800/v1/health');
  dns('point', 'hawkesgen.com', 'A', VM);
  dns('point', 'www.hawkesgen.com', 'A', VM);
  step('done. Anything made on Firebase since the switch stays in Firestore; tell Claude so it can be carried back.');
}

const what = process.argv[2];
if (what === 'prepare') await prepare();
else if (what === 'status') await status();
else if (what === 'switch') await switchOver();
else if (what === 'rollback') await rollback();
else fail('usage: node cloud/golive.mjs prepare | status | switch [--force] | rollback');
