// Billing end to end in code: Stripe's signed webhook for packs and plans (each paid once, a retried delivery finishes
// what a stopped one left), plans read from the price, failed payments (the plan ends, the credits stay), and holds for
// Gen work given back once when a job fails or never started. The pure parts always run; the rest runs against the
// staging project's Firestore (no emulator on J's PC) with a throwaway account, deleted after:
//   GOOGLE_CLOUD_PROJECT=hawkes-staging node --test --disable-warning=ExperimentalWarning test/billing.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const ON = process.env.GOOGLE_CLOUD_PROJECT === 'hawkes-staging';
process.env.PORTAL_PROJECT_PREFIX = 'ustg_';
process.env.PUBLIC_URL = 'https://beta.hawkesgen.ai';
const WHSEC = `whsec_test_${crypto.randomBytes(8).toString('hex')}`;
process.env.STRIPE_WEBHOOK_SECRET = WHSEC; // defineSecret reads the environment
process.env.STRIPE_SECRET_KEY = 'unset'; // nothing here calls Stripe

const B = await import('../src/billing.ts');
const { planOfPrice } = await import('../src/plans.ts');

const signed = (event: unknown, secret = WHSEC, t = Math.floor(Date.now() / 1000)) => {
  const raw = Buffer.from(JSON.stringify(event));
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
  return { raw, header: `t=${t},v1=${v1}` };
};

test('a live Stripe key is never used on beta; "unset" is no key', () => {
  assert.equal(B.usableStripeKey('sk_live_abc', false), null);
  assert.equal(B.usableStripeKey('rk_live_abc', false), null);
  assert.equal(B.usableStripeKey('sk_test_abc', false), 'sk_test_abc');
  assert.equal(B.usableStripeKey('sk_live_abc', true), 'sk_live_abc');
  assert.equal(B.usableStripeKey('unset', true), null);
  assert.equal(B.usableStripeKey(undefined, true), null);
});

test("the webhook takes only Stripe's signature, within five minutes", () => {
  const s = signed({ type: 'x' });
  assert.doesNotThrow(() => B.verifyStripeSignature(s.raw, s.header, WHSEC));
  assert.throws(() => B.verifyStripeSignature(s.raw, signed({ type: 'x' }, 'whsec_other').header, WHSEC), /Invalid/);
  assert.throws(() => B.verifyStripeSignature(Buffer.from('{"type":"y"}'), s.header, WHSEC), /Invalid/);
  assert.throws(() => B.verifyStripeSignature(s.raw, signed({ type: 'x' }, WHSEC, Math.floor(Date.now() / 1000) - 600).header, WHSEC), /tolerance/);
  assert.throws(() => B.verifyStripeSignature(s.raw, 'garbage', WHSEC), /Malformed/);
});

test('a plan is read from its price (a change in Stripe\'s billing portal), checkout links the terms', () => {
  assert.equal(planOfPrice({ lookup_key: 'hg_plan_team_9900' }), 'team');
  assert.equal(planOfPrice({ lookup_key: 'other', metadata: { plan: 'pro' } }), 'pro');
  assert.equal(planOfPrice(null), null);
  assert.match(B.termsLine(), /\(https:\/\/beta\.hawkesgen\.ai\/terms\).*\(https:\/\/beta\.hawkesgen\.ai\/privacy\)/);
});

test('billing calls are limited per account', () => {
  const u = { id: `ustg_limit${Date.now()}` } as any;
  for (let i = 0; i < 10; i++) B.slowBilling(u);
  assert.throws(() => B.slowBilling(u), (e: any) => e.status === 429);
});

// ------------------------------------------------------------------ against staging

const hex = `feedb111${crypto.randomBytes(4).toString('hex')}`;
const uid = `ustg_${hex}`;
const onceKeys: string[] = [];
const docs: string[] = []; // collection/id

test('packs, plans, failed payments and holds on staging', { skip: !ON && 'set GOOGLE_CLOUD_PROJECT=hawkes-staging' }, async (t) => {
  const { db, users, ledgerOf } = await import('../src/store.ts');
  const { settle } = await import('../src/jobs.ts');
  const { getUser } = await import('../src/accounts.ts');
  after(async () => {
    for (const d of (await ledgerOf(uid).get()).docs) await d.ref.delete();
    await users().doc(uid).delete().catch(() => {});
    for (const k of onceKeys) await db.collection('once').doc(k).delete().catch(() => {});
    for (const p of docs) await db.doc(p).delete().catch(() => {});
    for (const c of ['holds']) for (const d of (await db.collection(c).where('user', '==', uid).get()).docs) await d.ref.delete();
    await db.collection('orgs').doc(`org_${hex}`).delete().catch(() => {});
    await db.collection('orgMembers').doc(`org_${hex}__${uid}`).delete().catch(() => {});
  });
  await users().doc(uid).create({ email: `${uid}@example.com`, name: 'billing test', project: uid, credits: 0, role: 'customer', plan: 'free', disabled: false, created: Date.now(), last_login: null });
  const hook = (event: any) => { const s = signed(event); return B.stripeWebhook(s.raw, s.header); };
  const balance = async () => (await getUser(uid))!.credits;
  const kinds = async (kind: string) => (await ledgerOf(uid).where('kind', '==', kind).get()).size;

  await t.test('a pack pays once, with the first-purchase bonus once', async () => {
    const sess = `cs_test_${hex}`;
    onceKeys.push(`stripe:${sess}`, `first_bonus:${uid}`);
    const event = { type: 'checkout.session.completed', data: { object: { id: sess, mode: 'payment', payment_status: 'paid', client_reference_id: uid, customer: `cus_${hex}`, metadata: { user_id: uid, pack_id: 'starter_10', credits: '1000' } } } };
    const a: any = await hook(event);
    assert.equal(a.creditsAdded, 1250);
    const b: any = await hook(event);
    assert.equal(b.duplicate, true);
    assert.equal(await balance(), 1250, 'a retried delivery adds nothing');
    assert.equal(await kinds('first_purchase_bonus'), 1);
    assert.equal((await getUser(uid))!.stripe_customer_id, `cus_${hex}`);
    const unpaid: any = await hook({ ...event, data: { object: { ...event.data.object, id: `${sess}x`, payment_status: 'unpaid' } } });
    assert.equal(unpaid.ignored, true, 'an unpaid (async) session gives nothing until async_payment_succeeded');
  });

  await t.test('a plan month pays once; a one-off invoice is not a month', async () => {
    const inv = `in_test_${hex}`;
    onceKeys.push(`invoice:${inv}`);
    const event = { type: 'invoice.paid', data: { object: { id: inv, customer: `cus_${hex}`, billing_reason: 'subscription_create', amount_paid: 2900, parent: { subscription_details: { subscription: `sub_${hex}`, metadata: { user_id: uid, plan: 'indie' } } }, lines: { data: [{ amount: 2900, price: { lookup_key: 'hg_plan_indie_2900' }, period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] } } } };
    const a: any = await hook(event);
    assert.equal(a.creditsAdded, 1500);
    const b: any = await hook(event);
    assert.equal(b.duplicate, true);
    assert.equal(await balance(), 2750);
    const u = (await getUser(uid))!;
    assert.equal(u.plan, 'indie');
    assert.equal(u.sub_status, 'active');
    const oneOff: any = await hook({ type: 'invoice.paid', data: { object: { id: `${inv}y`, customer: `cus_${hex}`, amount_paid: 5000, lines: { data: [] } } } });
    assert.equal(oneOff.ignored, true);
    assert.equal(await balance(), 2750);
  });

  await t.test('a failed payment, then the end of the subscription: back to free, credits kept', async () => {
    const sub = { id: `sub_${hex}`, customer: `cus_${hex}`, status: 'past_due', cancel_at_period_end: false, metadata: { user_id: uid, plan: 'indie' }, items: { data: [{ price: { lookup_key: 'hg_plan_indie_2900' } }] } };
    await hook({ type: 'customer.subscription.updated', data: { object: sub } });
    assert.equal((await getUser(uid))!.sub_status, 'past_due');
    await hook({ type: 'customer.subscription.deleted', data: { object: { ...sub, status: 'canceled' } } });
    const u = (await getUser(uid))!;
    assert.equal(u.plan, 'free');
    assert.equal(u.sub_status, 'canceled');
    assert.equal(u.credits, 2750, 'credits stay');
  });

  await t.test('a plan changed in the billing portal is read from the price', async () => {
    await hook({ type: 'customer.subscription.updated', data: { object: { id: `sub_${hex}`, customer: `cus_${hex}`, status: 'active', metadata: { user_id: uid, plan: 'indie' }, items: { data: [{ price: { lookup_key: 'hg_plan_team_9900' } }] } } } });
    assert.equal((await getUser(uid))!.plan, 'team');
  });

  await t.test('a failed job gives its credits back once; a hold with no job is given back after an hour', async () => {
    const before = await balance();
    const holdId = await B.hold(uid, 40, 'test hold');
    onceKeys.push(`reserve:${holdId}`, `refund:${holdId}`);
    const job = `j_test${hex}`;
    docs.push(`jobs/${job}`);
    await B.attach(holdId, job);
    await db.collection('jobs').doc(job).create({ user_id: uid, tool: 'test', credits: 40, status: 'running', created: Date.now(), via: null, hold: holdId, settled: null });
    assert.equal(await balance(), before - 40);
    await settle({ id: job, status: 'failed', error: 'test' });
    await settle({ id: job, status: 'failed', error: 'test' });
    assert.equal(await balance(), before, 'refunded once');
    assert.equal(await kinds('job_refund'), 1);
    assert.ok((await db.collection('jobs').doc(job).get()).get('settled'));

    const orphan = await B.hold(uid, 30, 'test orphan');
    onceKeys.push(`reserve:${orphan}`, `refund:${orphan}`);
    assert.equal(await B.releaseOrphanHolds(), 0, 'not before an hour');
    await db.collection('holds').doc(orphan).update({ created: Date.now() - 2 * 3600_000 });
    assert.ok((await B.releaseOrphanHolds()) >= 1);
    assert.equal(await B.releaseOrphanHolds(), 0, 'once');
    assert.equal(await balance(), before);
  });
});
