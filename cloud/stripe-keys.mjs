#!/usr/bin/env node
// Stripe's keys for the three products on the one Stripe account, both lanes, from one file (J's PC; docs/domain-move.md,
// "Stripe"). Live is Stripe's live mode, beta its sandbox (test mode). Six webhook endpoints, one per product and lane; each
// acts only on its own product's events (metadata[product]: portal, gen, studio).
//   portal: Secret Manager of hawkes-prod / hawkes-staging (through setup-secrets.mjs; the portal applies them on its next deploy)
//   Gen:    POST /v1/billing/config with the owner key (gen / gen-beta)
//   Studio: POST /api/billing/config with the owner key (studio / studio-beta)
// Gen and Studio are reached through ~/.hawkes/client.json (genUrl/genKey, studioUrl/studioKey, and the ...Beta... pairs).
//   node cloud/stripe-keys.mjs C:/Projects/stripe.txt                 both lanes
//   node cloud/stripe-keys.mjs C:/Projects/stripe.txt --lane beta     one lane (live | beta)
//   ... --drop-old    the portal keeps only these webhook secrets (after stripe-clear.mjs; stripe-setup.mjs passes it)
// The file, KEY=value lines; any may be left out (what's missing stays as it is). Nothing is printed but what was set.
//   STRIPE_SECRET_KEY=sk_live_...              live: all three
//   STRIPE_PUBLISHABLE_KEY=pk_live_...         live: Gen and Studio
//   STRIPE_TEST_SECRET_KEY=sk_test_...         beta: all three
//   STRIPE_TEST_PUBLISHABLE_KEY=pk_test_...    beta: Gen and Studio
//   PORTAL_WEBHOOK_SECRET=whsec_...            https://hawkesgames.com/v1/billing/webhook (added beside the hawkesgen.ai one)
//   PORTAL_BETA_WEBHOOK_SECRET=whsec_...       https://beta.hawkesgames.com/v1/billing/webhook
//   GEN_WEBHOOK_SECRET=whsec_...               https://hawkesgen.ai/v1/billing/webhook (Gen from the cutover on)
//   GEN_BETA_WEBHOOK_SECRET=whsec_...          https://beta.hawkesgen.ai/v1/billing/webhook (Gen beta from the beta cutover on)
//   STUDIO_WEBHOOK_SECRET=whsec_...            https://studio.hawkesgen.ai/api/billing/webhook
//   STUDIO_BETA_WEBHOOK_SECRET=whsec_...       https://studio-beta.hawkesgen.ai/api/billing/webhook
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('usage: node cloud/stripe-keys.mjs <file of KEY=value lines> [--lane live|beta]'); process.exit(1); }
const only = process.argv.includes('--lane') ? process.argv[process.argv.indexOf('--lane') + 1] : null;
if (only && only !== 'live' && only !== 'beta') { console.error('--lane live | beta'); process.exit(1); }
const keys = Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
  .map((l) => /^\s*([A-Z_]+)\s*[=:]\s*(\S+)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]));
const client = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hawkes', 'client.json'), 'utf8'));
const here = path.dirname(fileURLToPath(import.meta.url));

const LANES = {
  live: {
    mode: 'live', project: 'hawkes-prod', secret: 'STRIPE_SECRET_KEY', publishable: 'STRIPE_PUBLISHABLE_KEY', hook: '_WEBHOOK_SECRET',
    gen: [client.genUrl ?? 'https://hawkesgen.ai', client.genKey], studio: [client.studioUrl ?? 'https://studio.hawkesgen.ai', client.studioKey],
  },
  beta: {
    mode: 'test', project: 'hawkes-staging', secret: 'STRIPE_TEST_SECRET_KEY', publishable: 'STRIPE_TEST_PUBLISHABLE_KEY', hook: '_BETA_WEBHOOK_SECRET',
    gen: [client.genBetaUrl ?? 'https://beta.hawkesgen.ai', client.genBetaKey], studio: [client.studioBetaUrl ?? 'https://studio-beta.hawkesgen.ai', client.studioBetaKey],
  },
};

// Every value has the shape its name says, before anything is sent anywhere.
for (const L of Object.values(LANES)) {
  const check = (name, re) => { if (keys[name] && !re.test(keys[name])) throw new Error(`${name} doesn't look right (expected ${re})`); };
  check(L.secret, new RegExp(`^(sk|rk)_${L.mode}_`));
  check(L.publishable, new RegExp(`^pk_${L.mode}_`));
  for (const p of ['PORTAL', 'GEN', 'STUDIO']) check(`${p}${L.hook}`, /^whsec_/);
}

async function post(name, [url, key], route, body) {
  if (!Object.values(body).some(Boolean)) return;
  if (!url || !key) return console.log(`  ${name}: skipped (no address or key in ~/.hawkes/client.json)`);
  const r = await fetch(`${String(url).replace(/\/+$/, '')}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${String(key).trim()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, v]) => v))) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return console.log(`  ${name}: FAILED ${r.status} ${j.error ?? ''}`);
  console.log(`  ${name}: set (${Object.keys(body).filter((k) => body[k]).join(', ')})${j.mode ? `, mode ${j.mode}` : ''}${'configured' in j ? `, configured ${j.configured}` : ''}`);
}

for (const [lane, L] of Object.entries(LANES)) {
  if (only && only !== lane) continue;
  const sk = keys[L.secret], pk = keys[L.publishable];
  const hook = (p) => keys[`${p}${L.hook}`];
  if (!sk && !pk && !hook('PORTAL') && !hook('GEN') && !hook('STUDIO')) { console.log(`${lane}: nothing in the file`); continue; }
  console.log(`${lane} (Stripe ${L.mode} mode):`);
  // The portal: a scratch file in the form setup-secrets.mjs --stripe reads, removed after.
  if (sk || hook('PORTAL')) {
    const tmp = path.join(os.tmpdir(), `portal-stripe-${process.pid}.txt`);
    fs.writeFileSync(tmp, [sk && `STRIPE_SECRET_KEY=${sk}`, hook('PORTAL') && `STRIPE_WEBHOOK_SECRET=${hook('PORTAL')}`].filter(Boolean).join('\n'), { mode: 0o600 });
    try {
      const r = spawnSync(process.execPath, [path.join(here, 'setup-secrets.mjs'), '--project', L.project, '--stripe', tmp, ...(process.argv.includes('--drop-old') ? ['--drop-old'] : [])], { encoding: 'utf8', windowsHide: true });
      console.log(`  portal (${L.project}): ${(r.stdout || r.stderr).trim().split('\n').filter((l) => /STRIPE_/.test(l)).join('; ') || `failed (${r.status})`}`);
    } finally { fs.rmSync(tmp, { force: true }); }
  }
  await post('Gen', L.gen, '/v1/billing/config', { secretKey: sk, publishableKey: pk, webhookSecret: hook('GEN') });
  await post('Studio', L.studio, '/api/billing/config', { secretKey: sk, publishableKey: pk, webhookSecret: hook('STUDIO') });
}
console.log('\nThe portal reads its secrets when it is deployed: the new ones apply from its next deploy on that lane.');
