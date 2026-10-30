// Credits (1 credit = $0.01): the packs, the ledger, holds for Gen work, Stripe Checkout and its webhook. Every change of
// a balance is a ledger row in the same transaction (store.ts changeCredits), and what may happen once (a Stripe session
// paid, a hold given back) is a `once` document created in that transaction.
import crypto from 'node:crypto';
import { db, users, ledgerOf, changeCredits, happened } from './store.ts';
import { env, publicUrl, isLive, SECRETS } from './config.ts';
import { getUser, requireUser, REFERRAL_REWARD, type User } from './accounts.ts';
import { id, PortalError, route, send, Limiter } from './http.ts';
import { sendLowBalance } from './mail.ts';
import { grantNetLive } from './orgs.ts';

export type Pack = { id: string; name: string; label: string; priceCents: number; priceUsd: number; credits: number; bonusPercent: number };
export const PACKS: Pack[] = [
  { id: 'starter_10', name: 'Starter Pack', label: 'Starter Pack — 1,000 Credits', priceCents: 1000, priceUsd: 10, credits: 1000, bonusPercent: 0 },
  { id: 'creator_25', name: 'Creator Pack', label: 'Creator Pack — 2,750 Credits · 10% Bonus', priceCents: 2500, priceUsd: 25, credits: 2750, bonusPercent: 10 },
  { id: 'studio_100', name: 'Studio Pack', label: 'Studio Pack — 12,000 Credits · 20% Bonus', priceCents: 10000, priceUsd: 100, credits: 12000, bonusPercent: 20 },
];
/** A customer's first pack comes with this much more (percent), once. */
export const FIRST_PURCHASE_BONUS = 25;
export const LOW_BALANCE = 10;

/** The Stripe key this lane may use: none for "unset", and never a live key on beta (beta never touches live money). */
export function usableStripeKey(k: string | undefined | null, live = isLive()) {
  if (!k || k === 'unset') return null;
  if (!live && /_live_/.test(k)) { console.error('[portal] a live Stripe key on beta: refused'); return null; }
  return k;
}
const stripeSecret = () => usableStripeKey(SECRETS.stripeSecret.value());
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

/** Checkouts, plan changes and billing-portal links per account (each one is a call to Stripe). */
export const billingCalls = new Limiter(10, 10 * 60_000);
export const slowBilling = (user: User) => billingCalls.take(user.id, 'Too many payment pages at once; wait a few minutes');

/** The line above Stripe Checkout's pay button: what paying agrees to (the site's own pages). */
export const termsLine = () => `By paying you agree to our [Terms](${publicUrl()}/terms) and [Privacy Policy](${publicUrl()}/privacy). See also our [Refunds](${publicUrl()}/refunds) policy.`;

// One Stripe account serves the portal, Gen and Studio (J's decision), so every endpoint gets every product's events.
// Everything the portal makes carries metadata product=portal (a pack's session; a plan's session and subscription, so
// its invoices carry it too); an event tagged for another product is answered 200 and left alone, as is one for an
// account the portal doesn't have. Never a 4xx for those: Stripe retries, then turns the endpoint off.
export const PRODUCT = 'portal';
/** The product an event's object is tagged with: its own metadata, its subscription's (an invoice), or a line's. */
export function productOf(o: any): string | null {
  const metas = [o?.metadata, o?.parent?.subscription_details?.metadata, o?.subscription_details?.metadata, o?.subscription_data?.metadata, ...(Array.isArray(o?.lines?.data) ? o.lines.data.map((l: any) => l?.metadata) : [])];
  for (const m of metas) if (m && typeof m.product === 'string' && m.product) return m.product;
  return null;
}
/** The answer for an event that isn't the portal's. */
export const notOurs = (event: any, why: string) => ({ ok: true, type: event?.type ?? 'unknown', ignored: true, why });

export const hasBought = async (userId: string) => !(await ledgerOf(userId).where('kind', '==', 'stripe_purchase').limit(1).get()).empty;

// ------------------------------------------------------------ holds: credits taken for work sent to Gen

/** The low-balance email, once per drop: never again until they buy (a purchase clears low_emailed). */
async function lowBalance(userId: string) {
  const u = await getUser(userId);
  if (!u || u.credits >= LOW_BALANCE || u.low_emailed) return;
  await users().doc(userId).update({ low_emailed: Date.now() });
  await sendLowBalance(u.email, u.name, u.credits, (await hasBought(userId)) ? 0 : FIRST_PURCHASE_BONUS);
}

/** Takes credits for work about to be sent to Gen; `attach` names the job Gen gives back, `release` returns them. */
export async function hold(userId: string, credits: number, detail: string) {
  const holdId = id('hold_', 6);
  const n = Math.max(0, Math.round(credits));
  const e = await changeCredits(userId, -n, { kind: 'job_reserve', detail, job_id: holdId }, { once: `reserve:${holdId}` });
  await db.collection('holds').doc(holdId).create({ user: userId, credits: n, tx: e!.id, job: null, created: Date.now(), released: null });
  await lowBalance(userId);
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
  const e = await changeCredits(h.get('user'), Number(h.get('credits')), { kind: 'job_refund', detail: reason, job_id: h.get('job') ?? h.id }, { once: `refund:${h.id}` });
  await h.ref.update({ released: Date.now() }).catch(() => {});
  return e;
}

/** A hold's refund inside the caller's transaction (jobs.ts settle: a job's end and its refund are one write). It reads
 *  first, so call it before the transaction writes anything. */
export async function releaseIn(t: FirebaseFirestore.Transaction, holdId: string, reason: string) {
  const ref = db.collection('holds').doc(holdId);
  const h = await t.get(ref);
  if (!h.exists || !h.get('credits')) return null;
  const e = await changeCredits(h.get('user'), Number(h.get('credits')), { kind: 'job_refund', detail: reason, job_id: h.get('job') ?? h.id }, { once: `refund:${h.id}`, t });
  if (e) t.update(ref, { released: Date.now() });
  return e;
}

/** Holds no job was ever attached to (the function stopped between taking the credits and Gen's answer), after an
 *  hour: given back, once. The customer may have had that work free; they never pay for nothing. */
export async function releaseOrphanHolds(now = Date.now()) {
  const s = await db.collection('holds').where('job', '==', null).where('released', '==', null).limit(200).get();
  let n = 0;
  for (const d of s.docs) {
    if (Number(d.get('created')) > now - 3600_000) continue;
    if (await release(d.id, 'Not started: credits returned')) n++;
  }
  return n;
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
  slowBilling(user);
  const site = publicUrl();
  const ours = (u: unknown) => (typeof u === 'string' && u.startsWith(`${site}/`) ? u : null);
  const form = new URLSearchParams({
    mode: 'payment', client_reference_id: user.id, customer_email: user.email,
    success_url: ours(body.successUrl) ?? `${site}/app?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: ours(body.cancelUrl) ?? `${site}/app?billing=cancelled`,
    'metadata[product]': PRODUCT, 'metadata[user_id]': user.id, 'metadata[pack_id]': pack.id, 'metadata[credits]': String(pack.credits),
    'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': String(pack.priceCents),
    'line_items[0][price_data][product_data][name]': pack.label,
    'line_items[0][price_data][product_data][description]': `${pack.credits.toLocaleString('en-US')} Hawkes Games generation credits`,
    'custom_text[submit][message]': termsLine(),
  });
  if (user.stripe_customer_id) { form.delete('customer_email'); form.set('customer', user.stripe_customer_id); }
  const data = await stripe('/v1/checkout/sessions', form);
  return { url: data.url as string, sessionId: data.id as string, pack };
}

/** Stripe's signature: HMAC-SHA256 of "<t>.<body>" with the endpoint's secret, within 5 minutes. STRIPE_WEBHOOK_SECRET may
 *  hold several, comma-separated (one per endpoint: hawkesgen.ai's and hawkesgames.com's while the portal moves,
 *  docs/domain-move.md); a signature from any of them passes. Each payment is credited once whichever endpoint delivers it. */
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
  const signed = `${t}.${rawBody.toString('utf8')}`;
  const expected = secret.split(',').map((k) => k.trim()).filter(Boolean).map((k) => crypto.createHmac('sha256', k).update(signed, 'utf8').digest());
  if (!sigs.some((s) => /^[0-9a-f]{64}$/i.test(s) && expected.some((e) => crypto.timingSafeEqual(Buffer.from(s, 'hex'), e)))) throw new PortalError('Invalid Stripe webhook signature');
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
  const product = productOf(event?.data?.object);
  if (product && product !== PRODUCT) return notOurs(event, `product ${product}`);
  const sub = subscriptionHandlers.find((h) => h.is(event));
  if (sub) return sub.handle(event);
  const s = event?.data?.object ?? {};
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event?.type) || s.payment_status !== 'paid') return { ok: true, type: event?.type ?? 'unknown', ignored: true };
  const userId = String(s.metadata?.user_id ?? s.client_reference_id ?? '');
  const credits = Math.round(Number(s.metadata?.credits ?? 0));
  const sessionId = String(s.id ?? '');
  if (!userId || !sessionId || credits <= 0) return notOurs(event, 'not a portal pack');
  if (!(await getUser(userId))) return notOurs(event, 'no such account');
  const pack = PACKS.find((p) => p.id === s.metadata?.pack_id);
  const e = await changeCredits(userId, credits, { kind: 'stripe_purchase', detail: pack ? `Purchased ${pack.label}` : `Credit purchase (+${credits})`, stripe_session_id: sessionId }, { once: `stripe:${sessionId}` });
  // What follows the credits is idempotent, so a retried event (Stripe retries until we answer 200) finishes a delivery
  // that stopped half way. The first-purchase bonus is this session's when no other session ever paid.
  const bought = (await ledgerOf(userId).where('kind', '==', 'stripe_purchase').limit(2).get()).docs;
  const first = bought.every((d) => d.get('stripe_session_id') === sessionId);
  const bonus = first ? Math.round((credits * FIRST_PURCHASE_BONUS) / 100) : 0;
  const after = bonus ? await changeCredits(userId, bonus, { kind: 'first_purchase_bonus', detail: `First purchase bonus (+${FIRST_PURCHASE_BONUS}%)` }, { once: `first_bonus:${userId}` }) : null;
  await users().doc(userId).update({ low_emailed: null, ...(typeof s.customer === 'string' ? { stripe_customer_id: s.customer } : {}) });
  await rewardReferrer(userId);
  // Buying credits opens Hawkes Net's live rooms for the buyer's own games (orgs.ts grants; hnet.ts reads it).
  await grantNetLive(userId).catch((e) => console.error('[portal] net grant:', e));
  if (!e) return { ok: true, type: event.type, duplicate: true, creditsAdded: after ? bonus : 0, balance: (await getUser(userId))?.credits ?? null };
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
