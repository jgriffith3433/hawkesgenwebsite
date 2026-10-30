#!/usr/bin/env node
// The portal on hawkesgames.com (docs/domain-move.md; J, 2026-10-29: hawkesgames.com is the portal, hawkesgen.ai becomes
// Hawkes Gen itself). Same steps as beta-domain.mjs, for either lane, in the hawkesgames.com zone on Cloudflare:
//   live: hawkesgames.com (+ www, redirected to it) on Firebase hawkes-prod, net.hawkesgames.com -> the live Net VM
//   beta: beta.hawkesgames.com on Firebase hawkes-staging, net-beta.hawkesgames.com -> the beta Net VM
// The Net dashboard has to be under the portal's own domain: it reads the portal with the session cookie, which a
// browser only sends to the same site.
// From J's PC:
//   node cloud/cloudflare/portal-domain.mjs --lane beta            what it would do (reads only)
//   node cloud/cloudflare/portal-domain.mjs --lane beta --apply    do it (safe to run again; again until Firebase says ACTIVE)
// What it does: (1) the host(s) as custom domains of the lane's Hosting site, (2) the DNS records Firebase asks for, DNS
// only, (3) the Net dashboard's name: an A record (DNS only: Caddy on the VM holds the certificate) with the address
// the lane's Net name already has in the hawkesgen.ai zone, (4) the host in Firebase Auth's authorized domains. It prints
// the steps only the Google Cloud console can do: the OAuth client's redirect URI and the consent screen's domains.
// Needs: gcloud signed in as J, and the `cf` CLI signed in (cf auth login), as cloud/cloudflare/hawkesgen-ai.mjs.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const apply = process.argv.includes('--apply');
const laneName = process.argv[process.argv.indexOf('--lane') + 1];
const LANES = {
  live: { project: 'hawkes-prod', hosts: ['hawkesgames.com', 'www.hawkesgames.com'], net: 'net.hawkesgames.com', netFrom: 'net.hawkesgen.ai' },
  beta: { project: 'hawkes-staging', hosts: ['beta.hawkesgames.com'], net: 'net-beta.hawkesgames.com', netFrom: 'hawkesnet.hawkesgen.ai' },
};
const lane = process.argv.includes('--lane') ? LANES[laneName] : null;
if (!lane) { console.error('--lane live | beta'); process.exit(1); }
const ZONE = 'hawkesgames.com';
const OLD_ZONE = 'hawkesgen.ai';
const HOST = lane.hosts[0];
const PROJECT = lane.project;
const SITE = `projects/${PROJECT}/sites/${PROJECT}`;
const OAUTH_CLIENT = '217916967472-pmv0599i956ljmq1lkube3vqtvcfb701.apps.googleusercontent.com';
const sdk = path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Cloud SDK', 'google-cloud-sdk');
const gcloud = (...a) => (process.platform === 'win32'
  ? spawnSync(path.join(sdk, 'platform', 'bundledpython', 'python.exe'), [path.join(sdk, 'lib', 'gcloud.py'), ...a], { encoding: 'utf8' })
  : spawnSync('gcloud', a, { encoding: 'utf8' }));
// The CLI's own script through Node (no shell, so JSON arguments arrive intact on Windows).
const cfMain = path.join(spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout.trim(), 'cf', 'bin', 'cf');
const cf = (...a) => {
  const r = spawnSync(process.execPath, [cfMain, ...a], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cf ${a.slice(0, 3).join(' ')}: ${(r.stderr || r.stdout).slice(-300)}`);
  try { return JSON.parse(r.stdout); } catch { return r.stdout; }
};
const rowsOf = (zone) => { const h = cf('dns', 'records', 'list', '-z', zone); return Array.isArray(h) ? h : h.result ?? []; };
const token = gcloud('auth', 'print-access-token').stdout?.trim();
if (!token) { console.error('gcloud is not signed in'); process.exit(1); }
const google = async (method, url, body) => {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 404 && r.status !== 409) throw new Error(`${method} ${url}: ${r.status} ${j.error?.message ?? ''}`);
  return { status: r.status, body: j };
};
const fb = (method, p, body) => google(method, `https://firebasehosting.googleapis.com/v1beta1/${p}`, body);

// 1. Firebase Hosting: the hosts on the lane's site (www redirects to the apex).
const wanted = [];
for (const host of lane.hosts) {
  let cd = await fb('GET', `${SITE}/customDomains/${host}`);
  if (cd.status === 404) {
    console.log(`Firebase: add ${host} to ${SITE}${host === HOST ? '' : ` (redirecting to ${HOST})`}${apply ? '' : ' (dry run)'}`);
    if (!apply) continue;
    await fb('POST', `${SITE}/customDomains?customDomainId=${host}`, host === HOST ? {} : { redirectTarget: HOST });
    await new Promise((r) => setTimeout(r, 5000));
    cd = await fb('GET', `${SITE}/customDomains/${host}`);
  }
  if (cd.status !== 200) continue;
  const d = cd.body;
  console.log(`Firebase ${host}: host ${d.hostState ?? '?'}, ownership ${d.ownershipState ?? '?'}, certificate ${d.cert?.state ?? '?'}`);
  for (const set of d.requiredDnsUpdates?.desired ?? []) for (const r of set.records ?? []) wanted.push({ name: r.domainName ?? set.domainName, type: r.type, content: r.rdata });
  for (const set of d.cert?.verification?.dns?.desired ?? []) for (const r of set.records ?? []) wanted.push({ name: r.domainName ?? set.domainName, type: r.type, content: r.rdata });
}
if (!wanted.length && !apply) console.log('Cloudflare: the records Firebase asks for once the hosts are added (A records to Firebase Hosting and TXT for ownership)');

// 2 and 3. Cloudflare: Firebase's records, and the Net dashboard's name, all DNS only, skipping ones already there.
const netIp = rowsOf(OLD_ZONE).find((r) => r.name === lane.netFrom && r.type === 'A')?.content;
if (netIp) wanted.push({ name: lane.net, type: 'A', content: netIp });
else console.log(`Cloudflare: no A record for ${lane.netFrom} to copy; add ${lane.net} -> the Net VM's address by hand`);
if (wanted.length) {
  const rows = rowsOf(ZONE);
  for (const w of wanted) {
    const name = w.name.replace(/\.$/, '');
    const content = String(w.content).replace(/\.$/, '');
    if (rows.some((r) => r.name === name && r.type === w.type && String(r.content).replace(/^"|"$/g, '') === content.replace(/^"|"$/g, ''))) { console.log(`Cloudflare: ${w.type} ${name} already there`); continue; }
    console.log(`Cloudflare: ${w.type} ${name} -> ${content}${apply ? '' : ' (dry run)'}`);
    if (apply) cf('dns', 'records', 'create', '-z', ZONE, '--body', JSON.stringify({ type: w.type, name, content, ttl: 300, proxied: false }));
  }
}

// 4. Firebase Auth: the portal signs Google identities in with requestUri = PUBLIC_URL (accounts.ts), on this host.
const cfg = await google('GET', `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`);
const domains = cfg.body.authorizedDomains ?? [];
if (domains.includes(HOST)) console.log(`Firebase Auth: ${HOST} already authorized`);
else {
  console.log(`Firebase Auth: authorize ${HOST}${apply ? '' : ' (dry run)'}`);
  if (apply) await google('PATCH', `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config?updateMask=authorizedDomains`, { authorizedDomains: [...domains, HOST] });
}

// 5. What only the console can do (Google has no API for an OAuth client's redirect URIs or the consent screen).
console.log(`
By hand, once: Google Cloud console > APIs & Services > Credentials > OAuth client ${OAUTH_CLIENT.split('-')[0]}-… >
  Authorized redirect URIs: add https://${HOST}/auth/google/callback  (keep the hawkesgen.ai one until the move is done)
  Google Auth Platform > Branding > Authorized domains: add ${ZONE} (Google may ask to verify it in Search Console)`);
console.log(apply ? '\nDone. Firebase checks the records by itself; run this again later to see the certificate go ACTIVE.' : '\nDry run: add --apply.');
