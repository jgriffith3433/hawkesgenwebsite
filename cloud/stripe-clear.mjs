#!/usr/bin/env node
// Deletes every webhook endpoint on the Stripe account, so stripe-setup.mjs starts from nothing (J, 2026-10-29: "clear
// all the webhooks in a separate script before we go"). Live mode with STRIPE_SECRET_KEY, the sandbox with
// STRIPE_TEST_SECRET_KEY, from the same file stripe-setup.mjs reads.
//   node cloud/stripe-clear.mjs C:/Projects/stripe.txt                    lists them (changes nothing)
//   node cloud/stripe-clear.mjs C:/Projects/stripe.txt --apply            deletes them all
//   ... --lane beta | live                                                one mode only
// Until stripe-setup.mjs runs, nothing hears Stripe: payments still go through, and Stripe retries each event for up to
// three days, so run setup right after. The live portal reads its webhook secret when it is deployed: the new live
// endpoint's secret works from its next live deploy, and the events in between arrive with Stripe's retries.
import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args[0];
if (!file || file.startsWith('--')) { console.error('usage: node cloud/stripe-clear.mjs <stripe.txt> [--apply] [--lane live|beta]'); process.exit(1); }
const apply = args.includes('--apply');
const only = args.includes('--lane') ? args[args.indexOf('--lane') + 1] : null;
const keys = Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
  .map((l) => /^\s*([A-Z_]+)\s*[=:]\s*(\S+)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]));
const LANES = { live: { sk: 'STRIPE_SECRET_KEY', mode: 'live' }, beta: { sk: 'STRIPE_TEST_SECRET_KEY', mode: 'test' } };

const stripe = async (sk, method, p) => {
  const r = await fetch(`https://api.stripe.com${p}`, { method, headers: { Authorization: `Bearer ${sk}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe ${method} ${p}: ${r.status} ${j.error?.message ?? ''}`);
  return j;
};

for (const [lane, L] of Object.entries(LANES)) {
  if (only && only !== lane) continue;
  const sk = keys[L.sk];
  if (!sk) { console.log(`${lane}: no ${L.sk} in the file, skipped`); continue; }
  if (!new RegExp(`^(sk|rk)_${L.mode}_`).test(sk)) throw new Error(`${L.sk} is not a ${L.mode}-mode secret key`);
  const all = [];
  for (let after = ''; ;) {
    const page = await stripe(sk, 'GET', `/v1/webhook_endpoints?limit=100${after ? `&starting_after=${after}` : ''}`);
    all.push(...(page.data ?? []));
    if (!page.has_more || !page.data?.length) break;
    after = page.data[page.data.length - 1].id;
  }
  console.log(`${lane} (Stripe ${L.mode} mode): ${all.length} endpoint(s)`);
  for (const w of all) {
    console.log(`  ${apply ? 'delete' : 'would delete'} ${w.id} ${w.url} (${w.status}, ${w.enabled_events?.length ?? 0} events)`);
    if (apply) await stripe(sk, 'DELETE', `/v1/webhook_endpoints/${w.id}`);
  }
}
if (!apply) console.log('\nDry run: add --apply. Then run stripe-setup.mjs --apply straight after.');
