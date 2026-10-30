// Subscriptions: a monthly plan comes with credits every paid month and room for more games and friends. Credits stay
// the currency (packs top up); a plan is a monthly pack plus limits. Stripe bills it: Checkout starts it, every paid
// invoice adds the month's credits once (`once` key invoice:<id>), and subscription events keep the plan and its state.
// The webhook itself is billing.ts's: this module registers its events on `subscriptionHandlers`.
import { db, users, changeCredits } from './store.ts';
import { env, publicUrl, studioPage } from './config.ts';
import { stripe, rewardReferrer, subscriptionHandlers, slowBilling, termsLine, PRODUCT, notOurs } from './billing.ts';
import { getUser, requireUser, type User } from './accounts.ts';
import { PortalError, route, json } from './http.ts';
import { PLANS, PAID_STATES, planOf, offeredPlans, type Plan } from './platform.ts';

// The plans themselves (prices, limits, entitlements per product) are platform.ts's, shared with games.ts and orgs.ts.
export { PLANS, planOf, type Plan, type PlanId } from './platform.ts';

/** The plans offered now (platform.ts offeredPlans; PORTAL_PLATFORM_PLANS=on offers the platform plans). */
export const offered = () => offeredPlans(env('PORTAL_PLATFORM_PLANS') === 'on');

/** What one message to the game assistant costs at least (src/gameai.ts AI_CREDITS; the same setting). */
export const AI_CREDITS = () => Math.max(1, Number(env('GAME_AI_CREDITS') ?? 8));

export async function subscription(user: User) {
  const fresh = (await getUser(user.id)) ?? user;
  return {
    plan: planOf(fresh),
    status: fresh.sub_status ?? null,
    periodEnd: fresh.period_end ?? null,
    cancelAtPeriodEnd: Boolean(fresh.cancel_at_period_end),
    plans: [...new Set([...offered(), planOf(fresh)])].sort((a, b) => a.priceCents - b.priceCents),
  };
}

/** The recurring Price for a plan: found by its lookup key (hg_plan_<id>_<cents>), else made once. A new price for a
 *  plan gets a new key, so existing subscribers keep theirs until they change plan. (The map is only a cache: a cold
 *  instance looks the price up again.) */
const priceIds = new Map<string, string>();
async function priceFor(plan: Plan) {
  const lookup = `hg_plan_${plan.id}_${plan.priceCents}`;
  if (priceIds.has(lookup)) return priceIds.get(lookup)!;
  const found = await stripe(`/v1/prices?active=true&lookup_keys[]=${lookup}`);
  let price = found?.data?.[0]?.id as string | undefined;
  if (!price) {
    const product = await stripe('/v1/products', new URLSearchParams({ name: plan.legacy ? `Hawkes Games ${plan.name}` : `Hawkes ${plan.name}`, description: `${plan.monthlyCredits.toLocaleString('en-US')} credits every month, up to ${plan.games} games` }));
    price = (await stripe('/v1/prices', new URLSearchParams({ product: product.id, currency: 'usd', unit_amount: String(plan.priceCents), 'recurring[interval]': 'month', lookup_key: lookup, 'metadata[plan]': plan.id }))).id as string;
  }
  priceIds.set(lookup, price);
  return price;
}

const paidPlan = (id: unknown) => {
  const plan = offered().find((p) => p.id === id && p.priceCents > 0);
  if (!plan) throw new PortalError(`Choose a plan: ${offered().filter((p) => p.priceCents).map((p) => p.id).join(', ')}`);
  return plan;
};

const isLive = (u: User) => PAID_STATES.includes(String(u.sub_status)) && Boolean(u.stripe_subscription_id);

async function fresh(user: User) {
  const u = await getUser(user.id);
  if (!u) throw new PortalError('Account not found', { status: 404 });
  return u;
}

/** Subscribe (Stripe Checkout), or move an existing subscription to another plan (charged the difference now; the
 *  difference's credits arrive with that invoice). */
export async function choosePlan(user: User, body: { plan?: unknown; successUrl?: unknown; cancelUrl?: unknown }) {
  const plan = paidPlan(body.plan);
  slowBilling(user);
  const u = await fresh(user);
  if (isLive(u)) {
    if (u.plan === plan.id && !u.cancel_at_period_end) return { changed: false, subscription: await subscription(u) };
    const sub = await stripe(`/v1/subscriptions/${u.stripe_subscription_id}`);
    const item = sub?.items?.data?.[0]?.id;
    if (!item) throw new PortalError('Could not read your subscription; try again or contact support@hawkesgen.ai', { status: 502 });
    const upgrade = plan.priceCents > (PLANS.find((p) => p.id === u.plan)?.priceCents ?? 0);
    const updated = await stripe(`/v1/subscriptions/${u.stripe_subscription_id}`, new URLSearchParams({
      'items[0][id]': item,
      'items[0][price]': await priceFor(plan),
      proration_behavior: upgrade ? 'always_invoice' : 'none',
      cancel_at_period_end: 'false',
      'metadata[product]': PRODUCT,
      'metadata[user_id]': u.id,
      'metadata[plan]': plan.id,
    }));
    await applySubscription(updated, u.id);
    return { changed: true, subscription: await subscription(u) };
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
    'metadata[product]': PRODUCT,
    'metadata[user_id]': u.id,
    'metadata[plan]': plan.id,
    'subscription_data[metadata][product]': PRODUCT,
    'subscription_data[metadata][user_id]': u.id,
    'subscription_data[metadata][plan]': plan.id,
    'custom_text[submit][message]': termsLine(),
  });
  if (u.stripe_customer_id) form.set('customer', u.stripe_customer_id);
  else form.set('customer_email', u.email);
  const s = await stripe('/v1/checkout/sessions', form);
  return { url: s.url as string, sessionId: s.id as string, plan };
}

/** Stops renewing at the end of the paid month (resume undoes it). Credits already given stay. */
export async function setCancel(user: User, cancel: boolean) {
  const u = await fresh(user);
  if (!isLive(u)) throw new PortalError('You have no subscription to change');
  slowBilling(user);
  const sub = await stripe(`/v1/subscriptions/${u.stripe_subscription_id}`, new URLSearchParams({ cancel_at_period_end: String(cancel) }));
  await applySubscription(sub, u.id);
  return subscription(u);
}

/** Stripe's own page for cards and invoices. */
export async function billingPortal(user: User) {
  const u = await fresh(user);
  if (!u.stripe_customer_id) throw new PortalError('Nothing to manage yet: you have not paid with a card here');
  slowBilling(user);
  const s = await stripe('/v1/billing_portal/sessions', new URLSearchParams({ customer: u.stripe_customer_id, return_url: `${publicUrl()}/app` }));
  return { url: s.url as string };
}

// ------------------------------------------------------------------ webhooks
const SUB_EVENTS = new Set(['invoice.paid', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);
export const isSubscriptionEvent = (event: any) => SUB_EVENTS.has(event?.type) || (event?.type === 'checkout.session.completed' && event?.data?.object?.mode === 'subscription');

async function userFor(meta: any, customer: unknown, subId?: unknown): Promise<User | null> {
  const byMeta = meta?.user_id ? await getUser(String(meta.user_id)) : null;
  if (byMeta) return byMeta;
  for (const [field, v] of [['stripe_subscription_id', subId], ['stripe_customer_id', customer]] as const) {
    if (!v || typeof v !== 'string') continue;
    const s = await users().where(field, '==', v).limit(1).get();
    if (!s.empty) return getUser(s.docs[0].id);
  }
  return null;
}

/** The plan a Stripe price is for: its lookup key, hg_plan_<id>_<cents> (priceFor). A plan changed in Stripe's own
 *  billing portal keeps the subscription's old metadata, so the price is what says which plan it is now. */
export const planOfPrice = (price: any): string | null => /^hg_plan_([a-z]+)_\d+$/.exec(String(price?.lookup_key ?? ''))?.[1] ?? (typeof price?.metadata?.plan === 'string' ? price.metadata.plan : null);

/** Keeps a subscription's plan, state and paid-until date on the account. */
async function applySubscription(sub: any, userId?: string) {
  const u = userId ? await getUser(userId) : await userFor(sub?.metadata, sub?.customer, sub?.id);
  if (!u) return null;
  const plan = PLANS.find((p) => p.id === planOfPrice(sub?.items?.data?.[0]?.price))?.id ?? PLANS.find((p) => p.id === sub?.metadata?.plan)?.id ?? (PLANS.find((p) => p.id === u.plan)?.id || 'free');
  const end = Number(sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? 0);
  const status = String(sub?.status ?? 'active');
  await users().doc(u.id).update({
    plan: status === 'canceled' ? 'free' : plan,
    sub_status: status,
    stripe_subscription_id: sub?.id ?? u.stripe_subscription_id ?? null,
    period_end: end ? end * 1000 : u.period_end ?? null,
    cancel_at_period_end: Boolean(sub?.cancel_at_period_end),
    ...(!u.stripe_customer_id && typeof sub?.customer === 'string' ? { stripe_customer_id: sub.customer } : {}),
  });
  return getUser(u.id);
}

/** A paid invoice: the month's credits (a new or renewed month), or an upgrade's share of them (what was paid, at the
 *  plan's rate), once per invoice. */
async function invoicePaid(inv: any) {
  const details = inv?.parent?.subscription_details ?? inv?.subscription_details ?? {};
  const meta = details.metadata ?? inv?.lines?.data?.[0]?.metadata ?? {};
  const subId = details.subscription ?? inv?.subscription ?? null;
  // Only a subscription's invoices carry a month's credits (a one-off invoice sent from Stripe is not a plan month).
  if (!subId) return { ok: true, type: 'invoice.paid', ignored: true };
  const u = await userFor(meta, inv?.customer, subId);
  if (!u) return notOurs({ type: 'invoice.paid' }, 'no such account');
  const line = inv?.lines?.data?.find((l: any) => Number(l?.amount ?? 0) > 0) ?? inv?.lines?.data?.[0];
  const plan = PLANS.find((p) => p.id === (planOfPrice(line?.price) ?? meta.plan ?? u.plan) && p.priceCents > 0);
  if (!plan || !inv?.id) return { ok: true, type: 'invoice.paid', ignored: true };
  const reason = String(inv.billing_reason ?? 'subscription_cycle');
  const paid = Math.max(0, Number(inv.amount_paid ?? 0));
  const credits = reason === 'subscription_update' ? Math.round((paid * plan.monthlyCredits) / plan.priceCents) : plan.monthlyCredits;
  const end = Number(inv?.lines?.data?.[0]?.period?.end ?? 0);
  const invoiceId = String(inv.id);
  const ref = users().doc(u.id);
  const out = await db.runTransaction(async (t) => {
    // Reads first (Firestore transactions): the account, then changeCredits reads the account and the once key.
    const cur = (await t.get(ref)).data() ?? {};
    let creditsAdded = 0;
    let balance = Number(cur.credits ?? 0);
    const onceRef = db.collection('once').doc(`invoice:${invoiceId}`.replace(/\//g, '_'));
    if (credits > 0) {
      const what = reason === 'subscription_update' ? `${plan.name} upgrade (+${credits} credits)` : reason === 'subscription_create' ? `${plan.name} plan: first month (+${credits} credits)` : `${plan.name} plan: new month (+${credits} credits)`;
      const e = await changeCredits(u.id, credits, { kind: 'subscription_credits', detail: what, stripe_invoice_id: invoiceId }, { once: `invoice:${invoiceId}`, t });
      if (!e) return null;
      creditsAdded = credits;
      balance = e.balance_after;
    } else {
      // No credits to give (a zero invoice): still once, so a retried event changes nothing twice.
      if ((await t.get(onceRef)).exists) return null;
      t.create(onceRef, { user: u.id, tx: null, at: Date.now() });
    }
    t.update(ref, {
      plan: plan.id,
      sub_status: ['active', 'trialing'].includes(String(cur.sub_status)) ? cur.sub_status : 'active',
      ...(subId ? { stripe_subscription_id: subId } : {}),
      ...(!cur.stripe_customer_id && typeof inv.customer === 'string' ? { stripe_customer_id: inv.customer } : {}),
      ...(end ? { period_end: end * 1000 } : {}),
      low_emailed: null,
    });
    return { creditsAdded, balance };
  });
  if (!out) return { ok: true, type: 'invoice.paid', duplicate: true, creditsAdded: 0 };
  if (paid > 0) await rewardReferrer(u.id);
  return { ok: true, type: 'invoice.paid', duplicate: false, creditsAdded: out.creditsAdded, balance: out.balance };
}

export async function subscriptionEvent(event: any) {
  const o = event.data?.object ?? {};
  if (event.type === 'invoice.paid') return invoicePaid(o);
  if (event.type === 'checkout.session.completed') {
    // The invoice brings the credits; this only ties the account to its Stripe customer and subscription.
    const u = await userFor(o.metadata, o.customer);
    if (!u) return { ok: true, type: event.type, ignored: true };
    const plan = PLANS.find((p) => p.id === o.metadata?.plan)?.id;
    await users().doc(u.id).update({
      ...(typeof o.customer === 'string' ? { stripe_customer_id: o.customer } : {}),
      ...(typeof o.subscription === 'string' ? { stripe_subscription_id: o.subscription } : {}),
      ...(plan ? { plan } : {}),
      ...(u.sub_status ? {} : { sub_status: 'active' }),
    });
    return { ok: true, type: event.type };
  }
  const u = await applySubscription(event.type === 'customer.subscription.deleted' ? { ...o, status: 'canceled' } : o);
  return { ok: true, type: event.type, user: u?.id ?? null };
}

subscriptionHandlers.push({ is: isSubscriptionEvent, handle: subscriptionEvent });

/** Admin numbers: subscribers per plan and the monthly revenue they make. */
export async function subscriptionStats() {
  const s = await users().where('sub_status', 'in', PAID_STATES).select('plan').get();
  const byPlan: Record<string, number> = {};
  for (const d of s.docs) { const p = String(d.get('plan') ?? 'free'); byPlan[p] = (byPlan[p] ?? 0) + 1; }
  const mrrCents = Object.entries(byPlan).reduce((sum, [p, n]) => sum + (PLANS.find((x) => x.id === p)?.priceCents ?? 0) * n, 0);
  return { byPlan, subscribers: s.size, mrrUsd: mrrCents / 100 };
}

// ------------------------------------------------------------------ routes

route('GET', '/v1/plans', () => ({ plans: offered(), aiCredits: AI_CREDITS(), studio: studioPage('/') }));
route('GET', '/v1/billing/subscription', async ({ req }) => subscription(await requireUser(req)));
route('POST', '/v1/billing/plan', async ({ req }) => choosePlan(await requireUser(req), json(req)));
route('POST', '/v1/billing/cancel', async ({ req }) => setCancel(await requireUser(req), json(req).cancel !== false));
route('POST', '/v1/billing/portal', async ({ req }) => billingPortal(await requireUser(req)));
