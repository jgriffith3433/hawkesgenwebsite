// Credits (1 credit = $0.01): the packs, the ledger, Stripe Checkout and its webhook. Prices come from Gen
// (POST /v1/billing/quote: its cost estimate with the margin); what a customer holds and spends is kept here.
import crypto from 'node:crypto';
import { db, tx } from './db.ts';
import { env, publicUrl } from './config.ts';
import { getUser, type User } from './users.ts';
import { id, PortalError } from './util.ts';

export type Pack = { id: string; name: string; label: string; priceCents: number; priceUsd: number; credits: number; bonusPercent: number };

export const PACKS: Pack[] = [
  { id: 'starter_10', name: 'Starter Pack', label: 'Starter Pack — 1,000 Credits', priceCents: 1000, priceUsd: 10, credits: 1000, bonusPercent: 0 },
  { id: 'creator_25', name: 'Creator Pack', label: 'Creator Pack — 2,750 Credits · 10% Bonus', priceCents: 2500, priceUsd: 25, credits: 2750, bonusPercent: 10 },
  { id: 'studio_100', name: 'Studio Pack', label: 'Studio Pack — 12,000 Credits · 20% Bonus', priceCents: 10000, priceUsd: 100, credits: 12000, bonusPercent: 20 },
];

const stripeKeys = () => ({ secretKey: env('STRIPE_SECRET_KEY'), publishableKey: env('STRIPE_PUBLISHABLE_KEY'), webhookSecret: env('STRIPE_WEBHOOK_SECRET') });

export function stripeStatus() {
  const k = stripeKeys();
  const mode = [k.secretKey, k.publishableKey].some((x) => x?.includes('_live_')) ? 'live' : [k.secretKey, k.publishableKey].some((x) => x?.includes('_test_')) ? 'test' : null;
  return { configured: Boolean(k.secretKey && k.webhookSecret), publishableKey: k.publishableKey ?? null, mode };
}

type Entry = { id: string; user_id: string; delta: number; balance_after: number; kind: string; detail: string | null; job_id: string | null; stripe_session_id: string | null; created: number };

function add(userId: string, delta: number, kind: string, detail: string, extra: { jobId?: string | null; stripeSessionId?: string | null } = {}) {
  const user = getUser(userId);
  if (!user) throw new PortalError('Account not found', { status: 404 });
  const balance = user.credits + delta;
  if (balance < 0) throw new PortalError(`Not enough credits (this needs ${-delta}, you have ${user.credits}). Buy credits to run it.`, { status: 402 });
  db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(balance, userId);
  const txId = id('tx_', 6);
  db.prepare('INSERT INTO credit_ledger (id, user_id, delta, balance_after, kind, detail, job_id, stripe_session_id, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(txId, userId, delta, balance, kind, detail, extra.jobId ?? null, extra.stripeSessionId ?? null, Date.now());
  return db.prepare('SELECT * FROM credit_ledger WHERE id = ?').get(txId) as Entry;
}

/** Takes credits for work about to be sent to Gen, under a hold id; `attach` moves it to the job Gen gives back. */
export const hold = (userId: string, credits: number, detail: string) => {
  const holdId = id('hold_', 6);
  tx(() => add(userId, -Math.max(0, Math.round(credits)), 'job_reserve', detail, { jobId: holdId }));
  return holdId;
};

export const attach = (holdId: string, jobId: string) => db.prepare("UPDATE credit_ledger SET job_id = ? WHERE job_id = ? AND kind = 'job_reserve'").run(jobId, holdId);

/** Gives back what a job (or hold) took, once. */
export function refund(jobId: string, reason: string) {
  return tx(() => {
    const taken = db.prepare("SELECT * FROM credit_ledger WHERE job_id = ? AND kind = 'job_reserve'").get(jobId) as Entry | undefined;
    if (!taken || db.prepare("SELECT 1 FROM credit_ledger WHERE job_id = ? AND kind = 'job_refund'").get(jobId)) return null;
    return add(taken.user_id, -taken.delta, 'job_refund', reason, { jobId });
  });
}

export function ledger(userId: string, limit = 100) {
  const user = getUser(userId);
  if (!user) throw new PortalError('Account not found', { status: 404 });
  const entries = db.prepare('SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY created DESC, rowid DESC LIMIT ?').all(userId, Math.max(1, Math.min(500, limit || 100)));
  return { credits: user.credits, entries };
}

export async function checkout(user: User, body: { packId?: unknown; successUrl?: unknown; cancelUrl?: unknown }) {
  const pack = PACKS.find((p) => p.id === String(body.packId ?? ''));
  if (!pack) throw new PortalError(`Unknown credit pack. Choose one of: ${PACKS.map((p) => p.id).join(', ')}`);
  const { secretKey } = stripeKeys();
  if (!secretKey) throw new PortalError('Payments are not set up yet', { status: 503 });
  const site = publicUrl();
  const ours = (u: unknown) => typeof u === 'string' && u.startsWith(`${site}/`) ? u : null;
  const form = new URLSearchParams({
    mode: 'payment',
    client_reference_id: user.id,
    customer_email: user.email,
    success_url: ours(body.successUrl) ?? `${site}/app?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: ours(body.cancelUrl) ?? `${site}/app?billing=cancelled`,
    'metadata[user_id]': user.id,
    'metadata[pack_id]': pack.id,
    'metadata[credits]': String(pack.credits),
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(pack.priceCents),
    'line_items[0][price_data][product_data][name]': pack.label,
    'line_items[0][price_data][product_data][description]': `${pack.credits.toLocaleString('en-US')} Hawkes Gen generation credits`,
  });
  if (user.stripe_customer_id) {
    form.delete('customer_email');
    form.set('customer', user.stripe_customer_id);
  }
  const r = await fetch(`${(env('STRIPE_API_BASE') ?? 'https://api.stripe.com').replace(/\/+$/, '')}/v1/checkout/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new PortalError(data?.error?.message ?? `Stripe answered ${r.status}`, { status: 502 });
  return { url: data.url as string, sessionId: data.id as string, pack };
}

/** Stripe's signature: HMAC-SHA256 of "<t>.<body>" with the endpoint's secret, within 5 minutes. */
export function verifyStripeSignature(rawBody: Buffer | string, header: string, secret = stripeKeys().webhookSecret, toleranceSec = 300) {
  if (!secret) throw new PortalError('Payments are not set up yet', { status: 503 });
  let t = 0;
  const sigs: string[] = [];
  for (const part of String(header ?? '').split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't') t = Number(v);
    else if (k === 'v1' && v) sigs.push(v);
  }
  if (!t || !sigs.length) throw new PortalError('Malformed Stripe-Signature header');
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) throw new PortalError('Stripe webhook timestamp outside tolerance');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')}`, 'utf8').digest();
  const ok = sigs.some((s) => /^[0-9a-f]{64}$/i.test(s) && crypto.timingSafeEqual(Buffer.from(s, 'hex'), expected));
  if (!ok) throw new PortalError('Invalid Stripe webhook signature');
}

/** checkout.session.completed and paid: the pack's credits, once per session. */
export function stripeWebhook(rawBody: Buffer, header: string) {
  verifyStripeSignature(rawBody, header);
  let event: any;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new PortalError('Webhook body is not valid JSON');
  }
  const s = event?.data?.object ?? {};
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event?.type) || s.payment_status !== 'paid') return { ok: true, type: event?.type ?? 'unknown', ignored: true };
  const userId = String(s.metadata?.user_id ?? s.client_reference_id ?? '');
  const credits = Math.round(Number(s.metadata?.credits ?? 0));
  const sessionId = String(s.id ?? '');
  if (!userId || !sessionId || credits <= 0) throw new PortalError('Checkout session is missing user_id, credits or id');
  const pack = PACKS.find((p) => p.id === s.metadata?.pack_id);
  return tx(() => {
    const dup = db.prepare('SELECT * FROM credit_ledger WHERE stripe_session_id = ?').get(sessionId) as Entry | undefined;
    if (dup) return { ok: true, type: event.type, duplicate: true, creditsAdded: 0, balance: getUser(dup.user_id)?.credits ?? dup.balance_after };
    if (typeof s.customer === 'string') db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(s.customer, userId);
    const e = add(userId, credits, 'stripe_purchase', pack ? `Purchased ${pack.label}` : `Credit purchase (+${credits})`, { stripeSessionId: sessionId });
    return { ok: true, type: event.type, duplicate: false, creditsAdded: credits, balance: e.balance_after };
  });
}
