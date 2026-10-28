// Credits (1 credit = $0.01): the packs, the ledger, holds for Gen work, Stripe Checkout and its webhook. Every change of
// a balance is a ledger row in the same transaction (store.ts changeCredits), and what may happen once (a Stripe session
// paid, a hold given back) is a `once` document created in that transaction.
import crypto from 'node:crypto';
import { db, users, ledgerOf, changeCredits, happened } from './store.ts';
import { env, publicUrl, SECRETS } from './config.ts';
import { getUser, requireUser, REFERRAL_REWARD, type User } from './accounts.ts';
import { id, PortalError, route, send } from './http.ts';

export type Pack = { id: string; name: string; label: string; priceCents: number; priceUsd: number; credits: number; bonusPercent: number };
export const PACKS: Pack[] = [
  { id: 'starter_10', name: 'Starter Pack', label: 'Starter Pack — 1,000 Credits', priceCents: 1000, priceUsd: 10, credits: 1000, bonusPercent: 0 },
  { id: 'creator_25', name: 'Creator Pack', label: 'Creator Pack — 2,750 Credits · 10% Bonus', priceCents: 2500, priceUsd: 25, credits: 2750, bonusPercent: 10 },
  { id: 'studio_100', name: 'Studio Pack', label: 'Studio Pack — 12,000 Credits · 20% Bonus', priceCents: 10000, priceUsd: 100, credits: 12000, bonusPercent: 20 },
];
/** A customer's first pack comes with this much more (percent), once. */
export const FIRST_PURCHASE_BONUS = 25;
export const LOW_BALANCE = 10;

const stripeSecret = () => { const k = SECRETS.stripeSecret.value(); return k && k !== 'unset' ? k : null; };
const webhookSecret = () => { const k = SECRETS.stripeWebhook.value(); return k && k !== 'unset' ? k : null; };
export const stripeBase = () => (env('STRIPE_API_BASE') ?? 'https://api.stripe.com').replace(/\/+$/, '');
export function stripeStatus() {
  const pk = env('STRIPE_PUBLISHABLE_KEY') ?? null;
  const sk = stripeSecret();
  const mode = [sk, pk].some((x) => x?.includes('_live_')) ? 'live' : [sk, pk].some((x) => x?.includes('_test_')) ? 'test' : null;
  return { configured: Boolean(sk && webhookSecret()), publishableKey: pk, mode };
}

export async function stripe(path: string, form?: URLSearchParams, method?: string) {
  const sk = stripeSecret();
  if (!sk) throw new PortalError('Payments are not set up yet', { status: 503 });
  const r = await fetch(`${stripeBase()}${path}`, {
    method: method ?? (form ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${sk}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form?.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new PortalError(data?.error?.message ?? `Stripe answered ${r.status}`, { status: 502 });
  return data;
}

export const hasBought = async (userId: string) => !(await ledgerOf(userId).where('kind', '==', 'stripe_purchase').limit(1).get()).empty;

// ------------------------------------------------------------ holds: credits taken for work sent to Gen

/** Takes credits for work about to be sent to Gen; `attach` names the job Gen gives back, `release` returns them. */
export async function hold(userId: string, credits: number, detail: string) {
  const holdId = id('hold_', 6);
  const n = Math.max(0, Math.round(credits));
  const e = await changeCredits(userId, -n, { kind: 'job_reserve', detail, job_id: holdId }, { once: `reserve:${holdId}` });
  await db.collection('holds').doc(holdId).create({ user: userId, credits: n, tx: e!.id, job: null, created: Date.now() });
  return holdId;
}
export async function attach(holdId: string, jobId: string) {
  const h = await db.collection('holds').doc(holdId).get();
  await Promise.all([h.ref.update({ job: jobId }), ledgerOf(h.get('user')).doc(h.get('tx')).update({ job_id: jobId })]);
}
/** Gives back what a hold (by its id, or the job it was attached to) took, once. */
export async function release(holdOrJob: string, reason: string) {
  let h = holdOrJob.startsWith('hold_') ? await db.collection('holds').doc(holdOrJob).get() : null;
  if (!h) {
    const q = await db.collection('holds').where('job', '==', holdOrJob).limit(1).get();
    h = q.empty ? null : q.docs[0];
  }
  if (!h?.exists || !h.get('credits')) return null;
  return changeCredits(h.get('user'), Number(h.get('credits')), { kind: 'job_refund', detail: reason, job_id: h.get('job') ?? h.id }, { once: `refund:${h.id}` });
}

export async function ledger(userId: string, limit = 100) {
  const user = await getUser(userId);
  if (!user) throw new PortalError('Account not found', { status: 404 });
  const s = await ledgerOf(userId).orderBy('created', 'desc').limit(Math.max(1, Math.min(500, limit || 100))).get();
  return { credits: user.credits, entries: s.docs.map((d) => ({ id: d.id, user_id: userId, ...d.data() })) };
}

// ------------------------------------------------------------ Stripe Checkout for packs

export async function checkout(user: User, body: { packId?: unknown; successUrl?: unknown; cancelUrl?: unknown }) {
  const pack = PACKS.find((p) => p.id === String(body.packId ?? ''));
  if (!pack) throw new PortalError(`Unknown credit pack. Choose one of: ${PACKS.map((p) => p.id).join(', ')}`);
  const site = publicUrl();
  const ours = (u: unknown) => (typeof u === 'string' && u.startsWith(`${site}/`) ? u : null);
  const form = new URLSearchParams({
    mode: 'payment', client_reference_id: user.id, customer_email: user.email,
    success_url: ours(body.successUrl) ?? `${site}/app?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: ours(body.cancelUrl) ?? `${site}/app?billing=cancelled`,
    'metadata[user_id]': user.id, 'metadata[pack_id]': pack.id, 'metadata[credits]': String(pack.credits),
    'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': String(pack.priceCents),
    'line_items[0][price_data][product_data][name]': pack.label,
    'line_items[0][price_data][product_data][description]': `${pack.credits.toLocaleString('en-US')} Hawkes Gen generation credits`,
  });
  if (user.stripe_customer_id) { form.delete('customer_email'); form.set('customer', user.stripe_customer_id); }
  const data = await stripe('/v1/checkout/sessions', form);
  return { url: data.url as string, sessionId: data.id as string, pack };
}

/** Stripe's signature: HMAC-SHA256 of "<t>.<body>" with the endpoint's secret, within 5 minutes. */
export function verifyStripeSignature(rawBody: Buffer, header: string, secret = webhookSecret(), toleranceSec = 300) {
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
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`, 'utf8').digest();
  if (!sigs.some((s) => /^[0-9a-f]{64}$/i.test(s) && crypto.timingSafeEqual(Buffer.from(s, 'hex'), expected))) throw new PortalError('Invalid Stripe webhook signature');
}

/** A friend's first purchase pays the customer who invited them, once. */
export async function rewardReferrer(userId: string) {
  const u = await getUser(userId);
  if (!u?.referred_by || u.referral_paid) return;
  await users().doc(userId).update({ referral_paid: true });
  if (await getUser(u.referred_by)) await changeCredits(u.referred_by, REFERRAL_REWARD, { kind: 'referral_reward', detail: `A friend you invited bought credits (+${REFERRAL_REWARD})` }, { once: `referral:${userId}` });
}

/** Subscription events are plans.ts's; it registers itself here. */
export const subscriptionHandlers: { is: (e: any) => boolean; handle: (e: any) => Promise<unknown> }[] = [];

/** checkout.session.completed and paid: the pack's credits, once per session (and the first pack's bonus, once). */
export async function stripeWebhook(rawBody: Buffer, header: string) {
  verifyStripeSignature(rawBody, header);
  let event: any;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw new PortalError('Webhook body is not valid JSON'); }
  const sub = subscriptionHandlers.find((h) => h.is(event));
  if (sub) return sub.handle(event);
  const s = event?.data?.object ?? {};
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event?.type) || s.payment_status !== 'paid') return { ok: true, type: event?.type ?? 'unknown', ignored: true };
  const userId = String(s.metadata?.user_id ?? s.client_reference_id ?? '');
  const credits = Math.round(Number(s.metadata?.credits ?? 0));
  const sessionId = String(s.id ?? '');
  if (!userId || !sessionId || credits <= 0) throw new PortalError('Checkout session is missing user_id, credits or id');
  const pack = PACKS.find((p) => p.id === s.metadata?.pack_id);
  const first = !(await hasBought(userId));
  const e = await changeCredits(userId, credits, { kind: 'stripe_purchase', detail: pack ? `Purchased ${pack.label}` : `Credit purchase (+${credits})`, stripe_session_id: sessionId }, { once: `stripe:${sessionId}` });
  if (!e) return { ok: true, type: event.type, duplicate: true, creditsAdded: 0, balance: (await getUser(userId))?.credits ?? null };
  const bonus = first ? Math.round((credits * FIRST_PURCHASE_BONUS) / 100) : 0;
  const after = bonus ? await changeCredits(userId, bonus, { kind: 'first_purchase_bonus', detail: `First purchase bonus (+${FIRST_PURCHASE_BONUS}%)` }, { once: `first_bonus:${userId}` }) : null;
  await users().doc(userId).update({ low_emailed: null, ...(typeof s.customer === 'string' ? { stripe_customer_id: s.customer } : {}) });
  await rewardReferrer(userId);
  return { ok: true, type: event.type, duplicate: false, creditsAdded: credits + (after ? bonus : 0), bonus: after ? bonus : 0, balance: (after ?? e).balance_after };
}

// ------------------------------------------------------------ routes

route('GET', '/v1/billing/packs', () => { const s = stripeStatus(); return { packs: PACKS, firstPurchaseBonus: FIRST_PURCHASE_BONUS, stripe: { configured: s.configured, publishableKey: s.publishableKey, mode: s.mode } }; });
route('GET', '/v1/billing/ledger', async ({ req, url }) => ledger((await requireUser(req)).id, Number(url.searchParams.get('limit')) || 100));
route('POST', '/v1/billing/checkout', async ({ req }) => checkout(await requireUser(req), (req.body ?? {}) as any));
route('POST', '/v1/billing/webhook', async ({ req, res }) => {
  try { send(res, 200, await stripeWebhook(req.rawBody, String(req.headers['stripe-signature'] ?? ''))); }
  catch (e: any) { send(res, Number(e?.status) || 400, { error: e.message }); }
});
export { happened };
