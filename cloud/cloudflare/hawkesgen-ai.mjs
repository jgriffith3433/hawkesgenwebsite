#!/usr/bin/env node
// hawkesgen.ai (bought at GoDaddy 2026-10-28 while hawkesgen.com is locked in the suspended AWS account): its DNS on
// Cloudflare (zone made already), the portal on Firebase Hosting (hawkes-prod) and Hawkes Net's VM. From J's PC:
//   node cloud/cloudflare/hawkesgen-ai.mjs            what it would do
//   node cloud/cloudflare/hawkesgen-ai.mjs --apply    do it (safe to run again; run it again until Firebase says ACTIVE)
// Needs: gcloud signed in as J, and the `cloudflare` CLI signed in (cloudflare auth login).
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const apply = process.argv.includes('--apply');
const DOMAIN = 'hawkesgen.ai';
const SITE = 'projects/hawkes-prod/sites/hawkes-prod';
const NET_IP = '34.86.89.28';
const sdk = path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Cloud SDK', 'google-cloud-sdk');
const gcloud = (...a) => spawnSync(path.join(sdk, 'platform', 'bundledpython', 'python.exe'), [path.join(sdk, 'lib', 'gcloud.py'), ...a], { encoding: 'utf8' });
// The CLI's own script through Node (no shell, so JSON arguments arrive intact on Windows).
const cfMain = path.join(spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout.trim(), 'cf', 'bin', 'cf');
const cf = (...a) => {
  const r = spawnSync(process.execPath, [cfMain, ...a], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cloudflare ${a.slice(0, 3).join(' ')}: ${(r.stderr || r.stdout).slice(-300)}`);
  try { return JSON.parse(r.stdout); } catch { return r.stdout; }
};
const token = gcloud('auth', 'print-access-token').stdout.trim();
if (!token) { console.error('gcloud is not signed in'); process.exit(1); }
const fb = async (method, p, body) => {
  const r = await fetch(`https://firebasehosting.googleapis.com/v1beta1/${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': 'hawkes-prod', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 404 && r.status !== 409) throw new Error(`Firebase ${method} ${p}: ${r.status} ${j.error?.message ?? ''}`);
  return { status: r.status, body: j };
};

// 1. Firebase: the apex and www as custom domains of the portal's site.
const wanted = [];
for (const host of [DOMAIN, `www.${DOMAIN}`]) {
  let cd = await fb('GET', `${SITE}/customDomains/${host}`);
  if (cd.status === 404) {
    console.log(`Firebase: add ${host}${apply ? '' : ' (dry run)'}`);
    if (!apply) continue;
    await fb('POST', `${SITE}/customDomains?customDomainId=${host}`, {});
    await new Promise((r) => setTimeout(r, 5000));
    cd = await fb('GET', `${SITE}/customDomains/${host}`);
  }
  const d = cd.body;
  console.log(`Firebase ${host}: host ${d.hostState ?? '?'}, ownership ${d.ownershipState ?? '?'}, certificate ${d.cert?.state ?? '?'}`);
  for (const set of d.requiredDnsUpdates?.desired ?? []) for (const r of set.records ?? []) wanted.push({ name: r.domainName ?? set.domainName, type: r.type, content: r.rdata });
  for (const set of d.cert?.verification?.dns?.desired ?? []) for (const r of set.records ?? []) wanted.push({ name: r.domainName ?? set.domainName, type: r.type, content: r.rdata });
}
// 2. Hawkes Net on its VM (its Caddy gets a certificate for this name once its config lists it).
wanted.push({ name: `net.${DOMAIN}`, type: 'A', content: NET_IP });

// 3. Cloudflare: each wanted record, DNS only, skipping ones already there.
const have = cf('dns', 'records', 'list', '-z', DOMAIN);
const rows = Array.isArray(have) ? have : have.result ?? [];
for (const w of wanted) {
  const name = w.name.replace(/\.$/, '');
  const content = String(w.content).replace(/\.$/, '');
  if (rows.some((r) => r.name === name && r.type === w.type && String(r.content).replace(/^"|"$/g, '') === content.replace(/^"|"$/g, ''))) { console.log(`Cloudflare: ${w.type} ${name} already there`); continue; }
  console.log(`Cloudflare: ${w.type} ${name} -> ${content}${apply ? '' : ' (dry run)'}`);
  if (apply) cf('dns', 'records', 'create', '-z', DOMAIN, '--body', JSON.stringify({ type: w.type, name, content, ttl: 300, proxied: false }));
}
console.log(apply ? '\nDone. Firebase checks the records by itself; run this again later to see the certificate go ACTIVE.' : '\nDry run: add --apply.');
