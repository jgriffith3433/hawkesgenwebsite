#!/usr/bin/env node
// Stripe's live keys for everything that takes payments on the one Stripe account (from J's PC; docs/domain-move.md,
// "Stripe"): the portal (hawkes-prod's Secret Manager, through setup-secrets.mjs), Hawkes Gen (POST /v1/billing/config,
// owner key) and Hawkes Studio (POST /api/billing/config, owner key). Each product has its own webhook endpoint and acts
// only on its own events (metadata[product]). Nothing is printed but what was set.
//   node cloud/stripe-keys.mjs C:/Projects/stripe.txt
// The file, KEY=value lines (any may be left out; what's missing stays as it is):
//   STRIPE_SECRET_KEY=sk_live_...           all three
//   STRIPE_PUBLISHABLE_KEY=pk_live_...      Gen and Studio (the portal doesn't use it)
//   PORTAL_WEBHOOK_SECRET=whsec_...         https://hawkesgames.com/v1/billing/webhook (added beside the hawkesgen.ai one)
//   GEN_WEBHOOK_SECRET=whsec_...            https://gen.hawkesgen.ai/v1/billing/webhook
//   STUDIO_WEBHOOK_SECRET=whsec_...         https://studio.hawkesgen.ai/api/billing/webhook
// Gen and Studio are reached through ~/.hawkes/client.json (genUrl/genKey, studioUrl/studioKey).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const file = process.argv[2];
if (!file) { console.error('usage: node cloud/stripe-keys.mjs <file of KEY=value lines>'); process.exit(1); }
const keys = Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
  .map((l) => /^\s*([A-Z_]+)\s*[=:]\s*(\S+)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]));
const shape = { STRIPE_SECRET_KEY: /^(sk|rk)_live_/, STRIPE_PUBLISHABLE_KEY: /^pk_live_/, PORTAL_WEBHOOK_SECRET: /^whsec_/, GEN_WEBHOOK_SECRET: /^whsec_/, STUDIO_WEBHOOK_SECRET: /^whsec_/ };
for (const [k, re] of Object.entries(shape)) if (keys[k] && !re.test(keys[k])) throw new Error(`${k} doesn't look like a live Stripe value (${re})`);
const client = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hawkes', 'client.json'), 'utf8'));
const here = path.dirname(fileURLToPath(import.meta.url));

// The portal: a scratch file in the form setup-secrets.mjs --stripe reads, removed after.
if (keys.STRIPE_SECRET_KEY || keys.PORTAL_WEBHOOK_SECRET) {
  const tmp = path.join(os.tmpdir(), `portal-stripe-${process.pid}.txt`);
  fs.writeFileSync(tmp, [keys.STRIPE_SECRET_KEY && `STRIPE_SECRET_KEY=${keys.STRIPE_SECRET_KEY}`, keys.PORTAL_WEBHOOK_SECRET && `STRIPE_WEBHOOK_SECRET=${keys.PORTAL_WEBHOOK_SECRET}`].filter(Boolean).join('\n'), { mode: 0o600 });
  try {
    const r = spawnSync(process.execPath, [path.join(here, 'setup-secrets.mjs'), '--project', 'hawkes-prod', '--stripe', tmp], { encoding: 'utf8', windowsHide: true });
    console.log(`portal (hawkes-prod): ${(r.stdout || r.stderr).trim().split('\n').filter((l) => /STRIPE_/.test(l)).join('; ') || `failed (${r.status})`}`);
  } finally { fs.rmSync(tmp, { force: true }); }
}

async function post(name, url, key, body) {
  if (!Object.values(body).some(Boolean)) return;
  if (!url || !key) return console.log(`${name}: skipped (no address or key in ~/.hawkes/client.json)`);
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${String(key).trim()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, v]) => v))) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return console.log(`${name}: FAILED ${r.status} ${j.error ?? ''}`);
  console.log(`${name}: set (${Object.keys(body).filter((k) => body[k]).join(', ')})${j.mode ? `, mode ${j.mode}` : ''}${'configured' in j ? `, configured ${j.configured}` : ''}`);
}
await post('Gen', `${String(client.genUrl ?? 'https://gen.hawkesgen.ai').replace(/\/+$/, '')}/v1/billing/config`, client.genKey,
  { secretKey: keys.STRIPE_SECRET_KEY, publishableKey: keys.STRIPE_PUBLISHABLE_KEY, webhookSecret: keys.GEN_WEBHOOK_SECRET });
await post('Studio', `${String(client.studioUrl ?? 'https://studio.hawkesgen.ai').replace(/\/+$/, '')}/api/billing/config`, client.studioKey,
  { secretKey: keys.STRIPE_SECRET_KEY, publishableKey: keys.STRIPE_PUBLISHABLE_KEY, webhookSecret: keys.STUDIO_WEBHOOK_SECRET });
console.log('\nThe portal reads its secrets when it is deployed: the new ones apply from its next live deploy.');
