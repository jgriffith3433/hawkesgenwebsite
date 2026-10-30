#!/usr/bin/env node
// Stripe for the three products, both lanes, from the two secret keys alone (J, 2026-10-29: "do all these stripe settings
// for me"; docs/domain-move.md, "Stripe"). Through Stripe's API it:
//   1. makes the six webhook endpoints (or fixes the events of ones already there): live mode for live, the sandbox
//      (test mode) for beta, one per product;
//   2. takes each new endpoint's signing secret straight from Stripe and installs it with the keys, through
//      stripe-keys.mjs (the portal's Secret Manager, Gen's and Studio's owner-only config routes). Nothing is printed;
//   3. adds hawkesgames.com (and beta.hawkesgames.com in the sandbox) as payment method domains (Apple Pay, Google Pay).
// Stripe shows an endpoint's secret only when it is made: an endpoint already there keeps its secret where it is, unless
// the file has it (PORTAL_WEBHOOK_SECRET and the rest, as in stripe-keys.mjs) or --recreate makes it again.
//   node cloud/stripe-setup.mjs C:/Projects/stripe.txt                  what it would do (reads Stripe only)
//   node cloud/stripe-setup.mjs C:/Projects/stripe.txt --apply
//   ... --lane beta | live      one lane
//   ... --after-cutover         live Gen's endpoint at https://hawkesgen.ai/v1/billing/webhook. Until the live cutover that
//                               address is the live portal's, so without this flag it is kept (or made) as a portal endpoint
//                               (the portal's events, its secret beside hawkesgames.com's); with it, that one is deleted
//                               and Gen's is made
// Safe to run again: endpoints already there are kept (their events fixed), only missing ones are made. After
// stripe-clear.mjs every endpoint is new, and the portal keeps only the new secrets (--drop-old).
// The file: STRIPE_SECRET_KEY=sk_live_..., STRIPE_TEST_SECRET_KEY=sk_test_... (and optionally the publishable keys).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const file = args[0];
if (!file || file.startsWith('--')) { console.error('usage: node cloud/stripe-setup.mjs <stripe.txt> [--apply] [--lane live|beta] [--after-cutover] [--recreate]'); process.exit(1); }
const apply = args.includes('--apply');
const only = args.includes('--lane') ? args[args.indexOf('--lane') + 1] : null;
const afterCutover = args.includes('--after-cutover');
const recreate = args.includes('--recreate');
const keys = Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
  .map((l) => /^\s*([A-Z_]+)\s*[=:]\s*(\S+)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]));

const PORTAL_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'invoice.paid', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'];
const GEN_EVENTS = ['checkout.session.completed', 'invoice.paid', 'invoice.payment_failed', 'customer.subscription.updated', 'customer.subscription.deleted'];
const LANES = {
  live: {
    sk: 'STRIPE_SECRET_KEY', mode: 'live', hook: '_WEBHOOK_SECRET', domains: ['hawkesgames.com'],
    endpoints: [
      { product: 'PORTAL', url: 'https://hawkesgames.com/v1/billing/webhook', events: PORTAL_EVENTS, name: 'hawkesgames.com (portal)' },
      { product: 'GEN', url: 'https://hawkesgen.ai/v1/billing/webhook', events: GEN_EVENTS, name: 'HawkesGen.ai', cutover: true },
      { product: 'STUDIO', url: 'https://studio.hawkesgen.ai/api/billing/webhook', events: GEN_EVENTS, name: 'Hawkes Studio' },
    ],
  },
  beta: {
    sk: 'STRIPE_TEST_SECRET_KEY', mode: 'test', hook: '_BETA_WEBHOOK_SECRET', domains: ['hawkesgames.com', 'beta.hawkesgames.com'],
    endpoints: [
      { product: 'PORTAL', url: 'https://beta.hawkesgames.com/v1/billing/webhook', events: PORTAL_EVENTS, name: 'beta.hawkesgames.com (portal beta)' },
      { product: 'GEN', url: 'https://beta.hawkesgen.ai/v1/billing/webhook', events: GEN_EVENTS, name: 'HawkesGen.ai beta' },
      { product: 'STUDIO', url: 'https://studio-beta.hawkesgen.ai/api/billing/webhook', events: GEN_EVENTS, name: 'Hawkes Studio beta' },
    ],
  },
};

const stripe = async (sk, method, p, form) => {
  const r = await fetch(`https://api.stripe.com${p}`, { method, headers: { Authorization: `Bearer ${sk}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? form.toString() : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe ${method} ${p}: ${r.status} ${j.error?.message ?? ''}`);
  return j;
};
const eventsForm = (events, extra = {}) => { const f = new URLSearchParams(extra); for (const e of events) f.append('enabled_events[]', e); return f; };
const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

const out = {}; // KEY=value lines for stripe-keys.mjs: the keys, and each new endpoint's secret
const add = (k, v) => { out[k] = out[k] ? `${out[k]},${v}` : v; };
let portalKept = false; // a portal endpoint was kept (its secret not known here): the portal's old secrets must stay
for (const [lane, L] of Object.entries(LANES)) {
  if (only && only !== lane) continue;
  const sk = keys[L.sk];
  if (!sk) { console.log(`${lane}: no ${L.sk} in the file, skipped`); continue; }
  if (!new RegExp(`^(sk|rk)_${L.mode}_`).test(sk)) throw new Error(`${L.sk} is not a ${L.mode}-mode secret key`);
  const prefix = lane === 'live' ? 'STRIPE_' : 'STRIPE_TEST_';
  out[`${prefix}SECRET_KEY`] = sk;
  if (keys[`${prefix}PUBLISHABLE_KEY`]) out[`${prefix}PUBLISHABLE_KEY`] = keys[`${prefix}PUBLISHABLE_KEY`];
  console.log(`${lane} (Stripe ${L.mode} mode):`);
  const have = (await stripe(sk, 'GET', '/v1/webhook_endpoints?limit=100')).data ?? [];
  for (let E of L.endpoints) {
    if (E.cutover && !afterCutover) E = { ...E, product: 'PORTAL', events: PORTAL_EVENTS, name: 'hawkesgen.ai (the live portal until the cutover)', cutover: false };
    const name = `${E.product}${L.hook}`;
    const there = have.filter((w) => w.url === E.url);
    // The portal's old live endpoint lives at Gen's address: at the cutover it goes, and Gen's is made fresh there.
    const stale = E.cutover ? there.filter((w) => w.enabled_events?.includes('checkout.session.async_payment_succeeded')) : [];
    const keep = there.filter((w) => !stale.includes(w) && !recreate);
    for (const w of [...stale, ...(recreate ? there : [])]) {
      console.log(`  ${E.name}: delete ${w.id} at ${E.url}${stale.includes(w) ? ' (the portal\'s old endpoint)' : ''}${apply ? '' : ' (dry run)'}`);
      if (apply) await stripe(sk, 'DELETE', `/v1/webhook_endpoints/${w.id}`);
    }
    if (keep.length) {
      const w = keep[0];
      if (!same(w.enabled_events ?? [], E.events) || w.status !== 'enabled') {
        console.log(`  ${E.name}: fix events${w.status !== 'enabled' ? ' and enable' : ''} on ${w.id}${apply ? '' : ' (dry run)'}`);
        if (apply) await stripe(sk, 'POST', `/v1/webhook_endpoints/${w.id}`, eventsForm(E.events, { disabled: 'false' }));
      } else console.log(`  ${E.name}: ${w.id} already right`);
      if (keys[name]) add(name, keys[name]);
      else if (E.product === 'PORTAL') { portalKept = true; console.log(`  ${E.name}: kept; the portal keeps the secrets it has for it`); }
      else console.log(`  ${E.name}: Stripe shows its signing secret only when it is made: put it in the file as ${name}, or --recreate`);
      continue;
    }
    console.log(`  ${E.name}: make ${E.url} with ${E.events.length} events${apply ? '' : ' (dry run)'}`);
    if (apply) {
      const w = await stripe(sk, 'POST', '/v1/webhook_endpoints', eventsForm(E.events, { url: E.url, description: `${E.name} (stripe-setup.mjs)` }));
      add(name, w.secret);
    }
  }
  const domains = (await stripe(sk, 'GET', '/v1/payment_method_domains?limit=100')).data ?? [];
  for (const d of L.domains) {
    if (domains.some((x) => x.domain_name === d)) { console.log(`  payment method domain ${d}: already there`); continue; }
    console.log(`  payment method domain ${d}: add${apply ? '' : ' (dry run)'}`);
    if (apply) await stripe(sk, 'POST', '/v1/payment_method_domains', new URLSearchParams({ domain_name: d }));
  }
}

if (!apply) { console.log('\nDry run: add --apply.'); process.exit(0); }
// Install: the same file shape stripe-keys.mjs reads, in a scratch file removed after.
const tmp = path.join(os.tmpdir(), `stripe-setup-${process.pid}.txt`);
fs.writeFileSync(tmp, Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n'), { mode: 0o600 });
try {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const r = spawnSync(process.execPath, [path.join(here, 'stripe-keys.mjs'), tmp, ...(only ? ['--lane', only] : []), ...(portalKept ? [] : ['--drop-old'])], { encoding: 'utf8', windowsHide: true });
  console.log(`\n${(r.stdout || r.stderr).trim()}`);
} finally { fs.rmSync(tmp, { force: true }); }
