#!/usr/bin/env node
// The portal's beta at https://beta.hawkesgen.ai (2026-10-29: beta never touches live). Firebase project hawkes-staging
// already serves it at https://hawkes-staging.web.app; the name under hawkesgen.ai is what makes sign-in work for the
// beta Hawkes Net dashboard (https://hawkesnet.hawkesgen.ai reads the portal with the session cookie: same site under
// hawkesgen.ai, a third-party cookie from web.app that browsers block), and Hawkes analytics files it as beta, not live.
// From J's PC:
//   node cloud/cloudflare/beta-domain.mjs            what it would do (reads only)
//   node cloud/cloudflare/beta-domain.mjs --apply    do it (safe to run again; run it again until Firebase says ACTIVE)
// What it does: (1) beta.hawkesgen.ai as a custom domain of the hawkes-staging Hosting site, (2) the DNS records
// Firebase asks for in the hawkesgen.ai zone on Cloudflare (DNS only, no proxy), (3) beta.hawkesgen.ai in Firebase
// Auth's authorized domains of hawkes-staging. It prints the one step only the Google Cloud console can do: the OAuth
// client's redirect URI.
// Needs: gcloud signed in as J, and the `cf` CLI signed in (cf auth login), as cloud/cloudflare/hawkesgen-ai.mjs.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const apply = process.argv.includes('--apply');
const ZONE = 'hawkesgen.ai';
const HOST = `beta.${ZONE}`;
const PROJECT = 'hawkes-staging';
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
const token = gcloud('auth', 'print-access-token').stdout?.trim();
if (!token) { console.error('gcloud is not signed in'); process.exit(1); }
const google = async (method, url, body) => {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 404 && r.status !== 409) throw new Error(`${method} ${url}: ${r.status} ${j.error?.message ?? ''}`);
  return { status: r.status, body: j };
};
const fb = (method, p, body) => google(method, `https://firebasehosting.googleapis.com/v1beta1/${p}`, body);

// 1. Firebase Hosting: beta.hawkesgen.ai on the staging site.
const wanted = [];
let cd = await fb('GET', `${SITE}/customDomains/${HOST}`);
if (cd.status === 404) {
  console.log(`Firebase: add ${HOST} to ${SITE}${apply ? '' : ' (dry run)'}`);
  if (apply) {
    await fb('POST', `${SITE}/customDomains?customDomainId=${HOST}`, {});
    await new Promise((r) => setTimeout(r, 5000));
    cd = await fb('GET', `${SITE}/customDomains/${HOST}`);
  }
}
if (cd.status === 200) {
  const d = cd.body;
  console.log(`Firebase ${HOST}: host ${d.hostState ?? '?'}, ownership ${d.ownershipState ?? '?'}, certificate ${d.cert?.state ?? '?'}`);
  for (const set of d.requiredDnsUpdates?.desired ?? []) for (const r of set.records ?? []) wanted.push({ name: r.domainName ?? set.domainName, type: r.type, content: r.rdata });
  for (const set of d.cert?.verification?.dns?.desired ?? []) for (const r of set.records ?? []) wanted.push({ name: r.domainName ?? set.domainName, type: r.type, content: r.rdata });
} else if (!apply) {
  console.log(`Cloudflare: the records Firebase asks for once ${HOST} is added (an A record to Firebase Hosting and a TXT for ownership)`);
}

// 2. Cloudflare: each record Firebase wants, DNS only, skipping ones already there.
if (wanted.length) {
  const have = cf('dns', 'records', 'list', '-z', ZONE);
  const rows = Array.isArray(have) ? have : have.result ?? [];
  for (const w of wanted) {
    const name = w.name.replace(/\.$/, '');
    const content = String(w.content).replace(/\.$/, '');
    if (rows.some((r) => r.name === name && r.type === w.type && String(r.content).replace(/^"|"$/g, '') === content.replace(/^"|"$/g, ''))) { console.log(`Cloudflare: ${w.type} ${name} already there`); continue; }
    console.log(`Cloudflare: ${w.type} ${name} -> ${content}${apply ? '' : ' (dry run)'}`);
    if (apply) cf('dns', 'records', 'create', '-z', ZONE, '--body', JSON.stringify({ type: w.type, name, content, ttl: 300, proxied: false }));
  }
}

// 3. Firebase Auth: the portal signs Google identities in with requestUri = PUBLIC_URL (accounts.ts), on this host.
const cfg = await google('GET', `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`);
const domains = cfg.body.authorizedDomains ?? [];
if (domains.includes(HOST)) console.log(`Firebase Auth: ${HOST} already authorized`);
else {
  console.log(`Firebase Auth: authorize ${HOST}${apply ? '' : ' (dry run)'}`);
  if (apply) await google('PATCH', `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config?updateMask=authorizedDomains`, { authorizedDomains: [...domains, HOST] });
}
const idp = await google('GET', `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/defaultSupportedIdpConfigs/google.com`);
console.log(`Firebase Auth: Google sign-in ${idp.body.enabled ? 'on' : 'OFF'} (client ${idp.body.clientId === OAUTH_CLIENT ? 'the portal\'s' : idp.body.clientId ?? '?'})`);

// 4. The one step left for the console (Google has no API for an OAuth client's redirect URIs).
console.log(`
By hand, once: Google Cloud console > APIs & Services > Credentials > OAuth client ${OAUTH_CLIENT.split('-')[0]}-… >
  Authorized redirect URIs: add https://${HOST}/auth/google/callback  (keep https://hawkes-staging.web.app/auth/google/callback)
  (Authorized JavaScript origins are not needed: the portal signs in with a server-side code flow.)`);
console.log(apply ? '\nDone. Firebase checks the records by itself; run this again later to see the certificate go ACTIVE.' : '\nDry run: add --apply.');
