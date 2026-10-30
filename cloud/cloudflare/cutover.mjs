#!/usr/bin/env node
// The cutover (docs/domain-move.md, step 4 for beta, 5.4 for live): the portal's old names become Hawkes Gen's.
//   beta: beta.hawkesgen.ai leaves Firebase hawkes-staging and becomes gen-beta's Worker (hawkes-gen-edge-beta)
//   live: hawkesgen.ai and www.hawkesgen.ai leave Firebase hawkes-prod and become Gen's Worker (hawkes-gen-edge)
// From J's PC:
//   node cloud/cloudflare/cutover.mjs --lane beta            what it would do (reads only)
//   node cloud/cloudflare/cutover.mjs --lane beta --apply    do it
// Before: the portal answers on its new name (hawkesgames.com / beta.hawkesgames.com) and the gen-edge Worker is deployed
// with the routes for these names (hawkesgen server/gen-edge: npx wrangler deploy [--env beta]); this checks the first.
// What it does: (1) removes the names from the Firebase site's custom domains, (2) in the hawkesgen.ai zone, deletes their
// A / AAAA / CNAME records and Firebase's TXT records (hosting-site=..., _acme-challenge.<name>) and adds a proxied
// `AAAA <name> 100::` (the Worker's route then has it), (3) waits for the name to answer as Gen. Mail (MX, SPF, DKIM,
// Resend) is never touched. To undo: delete the AAAA, run portal-domain.mjs's sibling hawkesgen-ai.mjs / beta-domain.mjs
// (they add the names to Firebase again with their records).
// Needs: gcloud signed in as J, and the `cf` CLI signed in (cf auth login).
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const apply = process.argv.includes('--apply');
const laneName = process.argv.includes('--lane') ? process.argv[process.argv.indexOf('--lane') + 1] : '';
const LANES = {
  beta: { project: 'hawkes-staging', names: ['beta.hawkesgen.ai'], portal: 'https://beta.hawkesgames.com', lane: 'beta' },
  live: { project: 'hawkes-prod', names: ['hawkesgen.ai', 'www.hawkesgen.ai'], portal: 'https://hawkesgames.com', lane: 'live' },
};
const L = LANES[laneName];
if (!L) { console.error('--lane beta | live'); process.exit(1); }
const ZONE = 'hawkesgen.ai';
const SITE = `projects/${L.project}/sites/${L.project}`;
const sdk = path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Cloud SDK', 'google-cloud-sdk');
const gcloud = (...a) => (process.platform === 'win32'
  ? spawnSync(path.join(sdk, 'platform', 'bundledpython', 'python.exe'), [path.join(sdk, 'lib', 'gcloud.py'), ...a], { encoding: 'utf8' })
  : spawnSync('gcloud', a, { encoding: 'utf8' }));
const cfMain = path.join(spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout.trim(), 'cf', 'bin', 'cf');
const cf = (...a) => {
  const r = spawnSync(process.execPath, [cfMain, ...a], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cf ${a.slice(0, 3).join(' ')}: ${(r.stderr || r.stdout).slice(-300)}`);
  try { return JSON.parse(r.stdout); } catch { return r.stdout; }
};
const token = gcloud('auth', 'print-access-token').stdout?.trim();
if (!token) { console.error('gcloud is not signed in'); process.exit(1); }
const fb = async (method, p) => {
  const r = await fetch(`https://firebasehosting.googleapis.com/v1beta1/${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': L.project } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 404) throw new Error(`Firebase ${method} ${p}: ${r.status} ${j.error?.message ?? ''}`);
  return { status: r.status, body: j };
};
const health = async (url) => fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(15_000) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) })).catch((e) => ({ status: 0, body: { error: e.message } }));

// 0. The portal must already answer on its new name.
const p = await health(L.portal);
if (p.status !== 200 || p.body.service !== 'hawkesgen-portal') throw new Error(`${L.portal}/v1/health is not the portal (${p.status} ${JSON.stringify(p.body).slice(0, 120)}): finish steps 1-3 first`);
console.log(`Portal on ${L.portal}: ok`);

// 1. Firebase: the old names off the portal's site.
for (const name of L.names) {
  const cd = await fb('GET', `${SITE}/customDomains/${name}`);
  if (cd.status === 404) { console.log(`Firebase: ${name} already off ${SITE}`); continue; }
  console.log(`Firebase: remove ${name} from ${SITE}${apply ? '' : ' (dry run)'}`);
  if (apply) await fb('DELETE', `${SITE}/customDomains/${name}`);
}

// 2. Cloudflare: Firebase's records out, a proxied AAAA 100:: in (the Worker's route answers it).
const list = () => { const h = cf('dns', 'records', 'list', '-z', ZONE); return Array.isArray(h) ? h : h.result ?? []; };
const rows = list();
for (const name of L.names) {
  const firebase = rows.filter((r) => (r.name === name && (['A', 'AAAA', 'CNAME'].includes(r.type) || (r.type === 'TXT' && /hosting-site=/.test(String(r.content)))))
    || (r.name === `_acme-challenge.${name}` && r.type === 'TXT'));
  const edge = firebase.find((r) => r.type === 'AAAA' && r.content === '100::' && r.proxied);
  for (const r of firebase.filter((x) => x !== edge)) {
    console.log(`Cloudflare: delete ${r.type} ${r.name} -> ${String(r.content).slice(0, 60)}${apply ? '' : ' (dry run)'}`);
    if (apply) cf('dns', 'records', 'delete', '-z', ZONE, r.id);
  }
  if (edge) console.log(`Cloudflare: AAAA ${name} 100:: (proxied) already there`);
  else {
    console.log(`Cloudflare: add AAAA ${name} -> 100:: (proxied)${apply ? '' : ' (dry run)'}`);
    if (apply) cf('dns', 'records', 'create', '-z', ZONE, '--body', JSON.stringify({ type: 'AAAA', name, content: '100::', ttl: 1, proxied: true }));
  }
}

// 3. The names answer as Gen (Cloudflare picks the record up within a minute or two).
if (!apply) { console.log('\nDry run: add --apply.'); process.exit(0); }
for (const name of L.names) {
  let ok = false;
  for (let i = 0; i < 24 && !ok; i++) {
    const h = await health(`https://${name}`);
    ok = h.status === 200 && h.body.name === 'hawkesgen' && (h.body.lane ?? 'live') === L.lane;
    if (!ok) await new Promise((r) => setTimeout(r, 10_000));
  }
  console.log(`${name}: ${ok ? `Hawkes Gen (${L.lane})` : 'not answering as Gen yet: check the Worker route (npx wrangler deploy' + (L.lane === 'beta' ? ' --env beta' : '') + ') and run this again'}`);
}
