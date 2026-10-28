// Subscriptions: a monthly plan comes with credits every paid month and room for more games and friends. Credits stay
// the currency (packs top up); a plan is a monthly pack plus limits. Stripe bills it: Checkout starts it, every paid
// invoice adds the month's credits once (unique stripe_invoice_id), and subscription events keep the plan and its state.
import { db, tx } from './db.ts';
import { env, publicUrl } from './config.ts';
import { add, stripeKeys, rewardReferrer } from './billing.ts';
import { getUser, type User } from './users.ts';
import { PortalError } from './util.ts';

export type PlanId = 'free' | 'maker' | 'pro';
export type Plan = { id: PlanId; name: string; priceCents: number; priceUsd: number; monthlyCredits: number; games: number; members: number; blurb: string };

export const PLANS: Plan[] = [
  { id: 'free', name: 'Free', priceCents: 0, priceUsd: 0, monthlyCredits: 0, games: 3, members: 3, blurb: 'Build and publish small games. Starter credits to try the AI.' },
  { id: 'maker', name: 'Maker', priceCents: 1500, priceUsd: 15, monthlyCredits: 1500, games: 20, members: 8, blurb: '1,500 credits every month for AI help, art, models, sound and music.' },
  { id: 'pro', name: 'Pro', priceCents: 4000, priceUsd: 40, monthlyCredits: 4500, games: 100, members: 25, blurb: '4,500 credits every month, room for a whole crew and many games.' },
];

export const planOf = (u: Pick<User, 'plan' | 'sub_status'> | null | undefined): Plan => {
  // A plan counts while Stripe still calls it paid (active), or is retrying a card (past_due) for its grace period.
  const id = u && ['active', 'trialing', 'past_due'].includes(String(u.sub_status)) ? u.plan : 'free';
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
};

export function subscription(user: User) {
  const fresh = getUser(user.id) ?? user;
  return {
    plan: planOf(fresh),
    status: fresh.sub_status ?? null,
    periodEnd: fresh.period_end ?? null,
    cancelAtPeriodEnd: Boolean(fresh.cancel_at_period_end),
    plans: PLANS,
  };
}

// ------------------------------------------------------------------ Stripe calls
async function stripe(route: string, form?: URLSearchParams, method?: string) {
  const { secretKey } = stripeKeys();
  if (!secretKey) throw new PortalError('Payments are not set up yet', { status: 503 });
  const r = await fetch(`${(env('STRIPE_API_BASE') ?? 'https://api.stripe.com').replace(/\/+$/, '')}${route}`, {
    method: method ?? (form ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${secretKey}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form?.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new PortalError(data?.error?.message ?? `Stripe answered ${r.status}`, { status: 502 });
  return data;
}

/** The recurring Price for a plan: found by its lookup key (hg_plan_<id>_<cents>), else made once. A new price for a
 *  plan gets a new key, so existing subscribers keep theirs until they change plan. */
const priceIds = new Map<string, string>();
async function priceFor(plan: Plan) {
  const lookup = `hg_plan_${plan.id}_${plan.priceCents}`;
  if (priceIds.has(lookup)) return priceIds.get(lookup)!;
  const found = await stripe(`/v1/prices?active=true&lookup_keys[]=${lookup}`);
  let price = found?.data?.[0]?.id as string | undefined;
  if (!price) {
    const product = await stripe('/v1/products', new URLSearchParams({ name: `Hawkes Gen ${plan.name}`, description: `${plan.monthlyCredits.toLocaleString('en-US')} credits every month, up to ${plan.games} games` }));
    price = (await stripe('/v1/prices', new URLSearchParams({ product: product.id, currency: 'usd', unit_amount: String(plan.priceCents), 'recurring[interval]': 'month', lookup_key: lookup, 'metadata[plan]': plan.id }))).id as string;
  }
  priceIds.set(lookup, price);
  return price;
}

const paidPlan = (id: unknown) => {
  const plan = PLANS.find((p) => p.id === id && p.priceCents > 0);
  if (!plan) throw new PortalError(`Choose a plan: ${PLANS.filter((p) => p.priceCents).map((p) => p.id).join(', ')}`);
  return plan;
};

const isLive = (u: User) => ['active', 'trialing', 'past_due'].includes(String(u.sub_status)) && Boolean(u.stripe_subscription_id);

/** Subscribe (Stripe Checkout), or move an existing subscription to another plan (charged the difference now; the
 *  difference's credits arrive with that invoice). */
export async function choosePlan(user: User, body: { plan?: unknown; successUrl?: unknown; cancelUrl?: unknown }) {
  const plan = paidPlan(body.plan);
  const u = getUser(user.id)!;
  if (isLive(u)) {
    if (u.plan === plan.id && !u.cancel_at_period_end) return { changed: false, subscription: subscription(u) };
    const sub = await stripe(`/v1/subscriptions/${u.stripe_subscription_id}`);
    const item = sub?.items?.data?.[0]?.id;
    if (!item) throw new PortalError('Could not read your subscription; try again or contact support@hawkesgen.ai', { status: 502 });
    const upgrade = plan.priceCents > (PLANS.find((p) => p.id === u.plan)?.priceCents ?? 0);
    const updated = await stripe(`/v1/subscriptions/${u.stripe_subscription_id}`, new URLSearchParams({
      'items[0][id]': item,
      'items[0][price]': await priceFor(plan),
      proration_behavior: upgrade ? 'always_invoice' : 'none',
      cancel_at_period_end: 'false',
      'metadata[user_id]': u.id,
      'metadata[plan]': plan.id,
    }));
    applySubscription(updated, u.id);
    return { changed: true, subscription: subscription(u) };
  }
  const site = publicUrl();
  const ours = (x: unknown) => (typeof x === 'string' && x.startsWith(`${site}/`) ? x : null);
  const form = new URLSearchParams({
    mode: 'subscription',
    client_reference_id: u.id,
    success_url: ours(body.successUrl) ?? `${site}/app?plan=success`,
    cancel_url: ours(body.cancelUrl) ?? `${site}/app?plan=cancelled`,
    'line_items[0][price]': await priceFor(plan),
    'line_items[0][quantity]': '1',
    'metadata[user_id]': u.id,
    'metadata[plan]': plan.id,
    'subscription_data[metadata][user_id]': u.id,
    'subscription_data[metadata][plan]': plan.id,
  });
  if (u.stripe_customer_id) form.set('customer', u.stripe_customer_id);
  else form.set('customer_email', u.email);
  const s = await stripe('/v1/checkout/sessions', form);
  return { url: s.url as string, sessionId: s.id as string, plan };
}

/** Stops renewing at the end of the paid month (resume undoes it). Credits already given stay. */
export async function setCancel(user: User, cancel: boolean) {
  const u = getUser(user.id)!;
  if (!isLive(u)) throw new PortalError('You have no subscription to change');
  const sub = await stripe(`/v1/subscriptions/${u.stripe_subscription_id}`, new URLSearchParams({ cancel_at_period_end: String(cancel) }));
  applySubscription(sub, u.id);
  return subscription(u);
}

/** Stripe's own page for cards and invoices. */
export async function billingPortal(user: User) {
  const u = getUser(user.id)!;
  if (!u.stripe_customer_id) throw new PortalError('Nothing to manage yet: you have not paid with a card here');
  const s = await stripe('/v1/billing_portal/sessions', new URLSearchParams({ customer: u.stripe_customer_id, return_url: `${publicUrl()}/app` }));
  return { url: s.url as string };
}

// ------------------------------------------------------------------ webhooks
const SUB_EVENTS = new Set(['invoice.paid', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);
export const isSubscriptionEvent = (event: any) => SUB_EVENTS.has(event?.type) || (event?.type === 'checkout.session.completed' && event?.data?.object?.mode === 'subscription');

const userFor = (meta: any, customer: unknown, subId?: unknown) => {
  const byMeta = meta?.user_id ? getUser(String(meta.user_id)) : null;
  if (byMeta) return byMeta;
  const row = (subId && db.prepare('SELECT id FROM users WHERE stripe_subscription_id = ?').get(String(subId))) || (customer && db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(String(customer)));
  return row ? getUser((row as { id: string }).id) : null;
};

/** Keeps a subscription's plan, state and paid-until date on the account. */
function applySubscription(sub: any, userId?: string) {
  const u = userId ? getUser(userId) : userFor(sub?.metadata, sub?.customer, sub?.id);
  if (!u) return null;
  const plan = PLANS.find((p) => p.id === sub?.metadata?.plan)?.id ?? (PLANS.find((p) => p.id === u.plan)?.id || 'free');
  const end = Number(sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? 0);
  const status = String(sub?.status ?? 'active');
  db.prepare('UPDATE users SET plan = ?, sub_status = ?, stripe_subscription_id = ?, period_end = ?, cancel_at_period_end = ?, stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?')
    .run(status === 'canceled' ? 'free' : plan, status, sub?.id ?? u.stripe_subscription_id, end ? end * 1000 : u.period_end, sub?.cancel_at_period_end ? 1 : 0, typeof sub?.customer === 'string' ? sub.customer : null, u.id);
  return getUser(u.id);
}

/** A paid invoice: the month's credits (a new or renewed month), or an upgrade's share of them (what was paid, at the
 *  plan's rate), once per invoice. */
function invoicePaid(inv: any) {
  const details = inv?.parent?.subscription_details ?? inv?.subscription_details ?? {};
  const meta = details.metadata ?? inv?.lines?.data?.[0]?.metadata ?? {};
  const subId = details.subscription ?? inv?.subscription ?? null;
  const u = userFor(meta, inv?.customer, subId);
  if (!u) throw new PortalError('Invoice for an unknown customer');
  const plan = PLANS.find((p) => p.id === (meta.plan ?? u.plan) && p.priceCents > 0);
  if (!plan || !inv?.id) return { ok: true, type: 'invoice.paid', ignored: true };
  const reason = String(inv.billing_reason ?? 'subscription_cycle');
  const paid = Math.max(0, Number(inv.amount_paid ?? 0));
  const credits = reason === 'subscription_update' ? Math.round((paid * plan.monthlyCredits) / plan.priceCents) : plan.monthlyCredits;
  const end = Number(inv?.lines?.data?.[0]?.period?.end ?? 0);
  return tx(() => {
    if (db.prepare('SELECT 1 FROM credit_ledger WHERE stripe_invoice_id = ?').get(String(inv.id))) return { ok: true, type: 'invoice.paid', duplicate: true, creditsAdded: 0 };
    db.prepare("UPDATE users SET plan = ?, sub_status = CASE WHEN sub_status IN ('active', 'trialing') THEN sub_status ELSE 'active' END, stripe_subscription_id = COALESCE(?, stripe_subscription_id), stripe_customer_id = COALESCE(stripe_customer_id, ?), period_end = COALESCE(?, period_end), low_emailed = NULL WHERE id = ?")
      .run(plan.id, subId, typeof inv.customer === 'string' ? inv.customer : null, end ? end * 1000 : null, u.id);
    let creditsAdded = 0;
    if (credits > 0) {
      const what = reason === 'subscription_update' ? `${plan.name} upgrade (+${credits} credits)` : reason === 'subscription_create' ? `${plan.name} plan: first month (+${credits} credits)` : `${plan.name} plan: new month (+${credits} credits)`;
      add(u.id, credits, 'subscription_credits', what, { stripeInvoiceId: String(inv.id) });
      creditsAdded = credits;
    }
    if (paid > 0) rewardReferrer(u.id);
    return { ok: true, type: 'invoice.paid', duplicate: false, creditsAdded, balance: getUser(u.id)!.credits };
  });
}

export function subscriptionEvent(event: any) {
  const o = event.data?.object ?? {};
  if (event.type === 'invoice.paid') return invoicePaid(o);
  if (event.type === 'checkout.session.completed') {
    // The invoice brings the credits; this only ties the account to its Stripe customer and subscription.
    const u = userFor(o.metadata, o.customer);
    if (!u) return { ok: true, type: event.type, ignored: true };
    db.prepare("UPDATE users SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id), plan = COALESCE(?, plan), sub_status = COALESCE(sub_status, 'active') WHERE id = ?")
      .run(typeof o.customer === 'string' ? o.customer : null, typeof o.subscription === 'string' ? o.subscription : null, PLANS.find((p) => p.id === o.metadata?.plan)?.id ?? null, u.id);
    return { ok: true, type: event.type };
  }
  const u = applySubscription(event.type === 'customer.subscription.deleted' ? { ...o, status: 'canceled' } : o);
  return { ok: true, type: event.type, user: u?.id ?? null };
}

/** Admin numbers: subscribers per plan and the monthly revenue they make. */
export function subscriptionStats() {
  const rows = db.prepare("SELECT plan, COUNT(*) AS n FROM users WHERE sub_status IN ('active', 'trialing', 'past_due') GROUP BY plan").all() as { plan: string; n: number }[];
  const byPlan = Object.fromEntries(rows.map((r) => [r.plan, Number(r.n)]));
  const mrrCents = rows.reduce((s, r) => s + (PLANS.find((p) => p.id === r.plan)?.priceCents ?? 0) * Number(r.n), 0);
  return { byPlan, subscribers: rows.reduce((s, r) => s + Number(r.n), 0), mrrUsd: mrrCents / 100 };
}
