#!/usr/bin/env node
// Points the portal at its lane's Hawkes Gen (2026-10-28: Gen moved to Cloud Run with a new, empty key list, so the
// portal needs a new key and the new address). Beta never touches live (2026-10-29): hawkes-staging (the portal's beta)
// uses gen-beta, hawkes-prod (live) uses gen. From J's PC, after tools/gen-cloudrun/deploy.ps1 set ~/.hawkes/client.json:
//   node cloud/point-gen.mjs --project hawkes-staging     makes key "portal (beta)" on gen-beta for ustg_* projects
//                                                         (the owner key genBetaKey in client.json makes it)
//   node cloud/point-gen.mjs --project hawkes-prod        makes key "portal (live)" on gen for usr_* projects (genKey)
// Each: a user key on that Gen narrowed to the portal's customer projects, stored as the secret HAWKESGEN_KEY in that
// Firebase project (value on stdin, never printed), and HAWKESGEN_URL in cloud/functions/.env.<project>. The functions
// pick both up at their next deploy (beta push: staging; main: live): the running ones keep the version they were
// deployed with, so store the key first and push after. Without --apply it prints what it would do.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const project = arg('project');
const apply = process.argv.includes('--apply');
if (!['hawkes-staging', 'hawkes-prod'].includes(project)) { console.error('--project hawkes-staging | hawkes-prod'); process.exit(1); }
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const envFile = path.join(HERE, 'functions', `.env.${project}`);
const prefix = fs.readFileSync(envFile, 'utf8').match(/^PORTAL_PROJECT_PREFIX=(.+)$/m)?.[1]?.trim() ?? 'usr_';
const client = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hawkes', 'client.json'), 'utf8'));
const live = project === 'hawkes-prod';
// The lane's Gen: its public name (the Worker), not the run.app address client.json may hold for beta.
const genUrl = String(arg('gen-url', live ? 'https://hawkesgen.ai' : 'https://beta.hawkesgen.ai')).replace(/\/+$/, '');
const ownerKey = String((live ? client.genKey : client.genBetaKey) ?? '').trim();
const host = new URL(genUrl).host;
if (!/\.run\.app$|hawkesgen\.ai$/.test(host)) { console.error(`Unexpected Gen address ${genUrl}`); process.exit(1); }
// Beta never on live Gen, live never on beta Gen.
if (live === /beta/.test(host)) { console.error(`${project} must not use ${genUrl} (${live ? 'live uses live Gen' : 'beta uses gen-beta'})`); process.exit(1); }
if (!ownerKey) { console.error(`~/.hawkes/client.json has no ${live ? 'genKey' : 'genBetaKey'}`); process.exit(1); }
const name = live ? 'portal (live)' : 'portal (beta)';
console.log(`${project}: Gen ${genUrl}, key "${name}" for ${prefix}*`);

if (!apply) { console.log('Dry run: add --apply.'); process.exit(0); }
const auth = { Authorization: `Bearer ${ownerKey}`, 'Content-Type': 'application/json' };
const health = await fetch(`${genUrl}/v1/health`).then(async (r) => (r.ok ? r.json() : { status: r.status })).catch((e) => ({ status: e.message }));
if (!health.ok) { console.error(`Gen doesn't answer (${health.status})`); process.exit(1); }
// Gen says its own lane (HAWKESGEN_LANE): the key is made only on the lane this project belongs to.
if ((health.lane ?? 'live') !== (live ? 'live' : 'beta')) { console.error(`${genUrl} says it is the ${health.lane ?? 'live'} lane; ${project} needs ${live ? 'live' : 'beta'}`); process.exit(1); }
const made = await fetch(`${genUrl}/v1/clients`, { method: 'POST', headers: auth, body: JSON.stringify({ name, role: 'user', projects: [`${prefix}*`] }) });
if (!made.ok) { console.error(`Gen refused to make the key (${made.status}): ${(await made.text()).slice(0, 200)}`); process.exit(1); }
const { key } = await made.json();
if (!key) { console.error('Gen answered without a key'); process.exit(1); }

// The secret: a new version from stdin (gcloud through the SDK's own Python: no cmd.exe quoting).
const sdk = path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Cloud SDK', 'google-cloud-sdk');
const [bin, pre] = process.platform === 'win32' ? [path.join(sdk, 'platform', 'bundledpython', 'python.exe'), [path.join(sdk, 'lib', 'gcloud.py')]] : ['gcloud', []];
const r = spawnSync(bin, [...pre, 'secrets', 'versions', 'add', 'HAWKESGEN_KEY', '--data-file=-', `--project=${project}`], { input: key, encoding: 'utf8' });
if (r.status !== 0) { console.error(`Couldn't store HAWKESGEN_KEY: ${(r.stderr ?? '').slice(-300)}`); process.exit(1); }
console.log('  HAWKESGEN_KEY: new version stored');

const text = fs.readFileSync(envFile, 'utf8');
fs.writeFileSync(envFile, /^HAWKESGEN_URL=/m.test(text) ? text.replace(/^HAWKESGEN_URL=.*$/m, `HAWKESGEN_URL=${genUrl}`) : `${text.trimEnd()}\nHAWKESGEN_URL=${genUrl}\n`);
console.log(`  ${path.basename(envFile)}: HAWKESGEN_URL=${genUrl}`);
console.log('Done. Deploy the functions for it to take effect (staging: push beta; live: DEPLOY hawkesgenwebsite).');
