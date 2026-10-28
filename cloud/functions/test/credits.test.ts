// Credits against the staging project's Firestore (no emulator on J's PC): a throwaway account, changed, charged twice
// under one `once` key, refused below zero, then deleted. GOOGLE_CLOUD_PROJECT must be hawkes-staging.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

if (process.env.GOOGLE_CLOUD_PROJECT !== 'hawkes-staging') throw new Error('run with GOOGLE_CLOUD_PROJECT=hawkes-staging');
const { db, users, ledgerOf, changeCredits, happened } = await import('../src/store.ts');

const uid = `ustg_test${Date.now().toString(16)}`;
const onceKeys: string[] = [];
after(async () => {
  for (const d of (await ledgerOf(uid).get()).docs) await d.ref.delete();
  await users().doc(uid).delete();
  for (const k of onceKeys) await db.collection('once').doc(k).delete();
});

test('credits change with a ledger row, once per key, never below zero', async () => {
  await users().doc(uid).create({ email: `${uid}@example.com`, credits: 10, project: uid, role: 'customer', created: Date.now(), last_login: null });
  const a = await changeCredits(uid, 25, { kind: 'test_add', detail: 'add' });
  assert.equal(a?.balance_after, 35);

  const key = `test:${uid}:charge`;
  onceKeys.push(key.replace(/\//g, '_'));
  const first = await changeCredits(uid, -5, { kind: 'test_charge' }, { once: key });
  const again = await changeCredits(uid, -5, { kind: 'test_charge' }, { once: key });
  assert.equal(first?.balance_after, 30);
  assert.equal(again, null, 'a second charge under the same key changes nothing');
  assert.equal(await happened(key), true);

  await assert.rejects(changeCredits(uid, -31, { kind: 'test_overdraw' }), (e: any) => e.status === 402);

  // Ten charges at once: the transaction keeps the balance and the ledger in step.
  await Promise.all(Array.from({ length: 10 }, () => changeCredits(uid, -1, { kind: 'test_burst' })));
  const u = await users().doc(uid).get();
  assert.equal(u.get('credits'), 20);
  const rows = (await ledgerOf(uid).get()).docs.map((d) => d.data());
  assert.equal(rows.reduce((s, r) => s + r.delta, 0), 10, 'the ledger adds up to the change in balance (10 to 20)');
});
