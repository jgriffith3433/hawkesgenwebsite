#!/usr/bin/env node
// Makes a portal account an admin (users/<id>.role = "admin") in one Firebase project's Firestore. New accounts are
// "customer"; an admin sees the admin pages and, through the portal, Hawkes Net's dashboard as an admin (it takes Hawkes's
// own games into the account). Each lane has its own accounts: beta (hawkes-staging, beta.hawkesgen.ai) and live
// (hawkes-prod) are separate. Prints the matching accounts; changes them only with --apply. Uses gcloud's sign-in.
//
//   node cloud/make-admin.mjs --project hawkes-staging --email you@example.com [--apply]
import { spawnSync } from 'node:child_process';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const project = arg('project');
const email = arg('email')?.trim().toLowerCase();
const apply = process.argv.includes('--apply');
if (!project || !email) { console.error('usage: node cloud/make-admin.mjs --project <hawkes-staging|hawkes-prod> --email <address> [--apply]'); process.exit(2); }

const g = spawnSync(process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', shell: process.platform === 'win32' });
const token = g.stdout.trim();
if (!token) { console.error(`gcloud has no sign-in: ${g.stderr.trim()}`); process.exit(1); }
const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;

const q = await (await fetch(`${base}:runQuery`, { method: 'POST', headers: h, body: JSON.stringify({ structuredQuery: {
  from: [{ collectionId: 'users' }], where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } },
} }) })).json();
const docs = (Array.isArray(q) ? q : []).filter((x) => x.document).map((x) => x.document);
if (!docs.length) { console.log(`${project}: no account with ${email} (sign in there once first)`); process.exit(1); }
for (const d of docs) {
  const id = d.name.split('/').pop();
  const role = d.fields?.role?.stringValue ?? '(none)';
  if (role === 'admin') { console.log(`${project}: ${id} (${email}) is already an admin`); continue; }
  if (!apply) { console.log(`${project}: ${id} (${email}) is ${role}; --apply makes it an admin`); continue; }
  const r = await fetch(`https://firestore.googleapis.com/v1/${d.name}?updateMask.fieldPaths=role`, { method: 'PATCH', headers: h, body: JSON.stringify({ fields: { role: { stringValue: 'admin' } } }) });
  console.log(`${project}: ${id} (${email}) ${r.ok ? 'is now an admin' : `not changed (${r.status} ${(await r.text()).slice(0, 200)})`}`);
}
