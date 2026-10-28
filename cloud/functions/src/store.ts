// Firestore: the portal's data (what portal.db held). Collections, by what the SQLite tables were:
//   users/{usr_id}                 the account (credits is the balance; uid links its Firebase Auth user)
//   users/{usr_id}/ledger/{tx_id}  every change of the balance, written in the same transaction as the balance
//   once/{key}                     "this happened once" (a Stripe session paid, a job charged or refunded): the unique
//                                  indexes of the ledger, as documents a transaction creates
//   apiKeys/{sha256 of the key}    personal keys (hg_...)
//   jobs/{j_id}                    Gen jobs a customer paid for, until settled
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Transaction, type DocumentReference } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { id, PortalError } from './http.ts';

if (!getApps().length) initializeApp();
export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
export const auth = getAuth();
export { FieldValue };

export const users = () => db.collection('users');
export const ledgerOf = (userId: string) => users().doc(userId).collection('ledger');

export type LedgerEntry = {
  delta: number;
  balance_after: number;
  kind: string;
  detail?: string | null;
  job_id?: string | null;
  stripe_session_id?: string | null;
  stripe_invoice_id?: string | null;
  created: number;
};

/**
 * Changes a balance by `delta` with its ledger row, in one transaction. `once` names what may happen only one time
 * (e.g. `stripe:<session>`, `job:<id>:charge`): a second call with the same key changes nothing and returns null.
 * A charge that would take the balance below zero is refused (402) unless `allowNegative`.
 */
export async function changeCredits(userId: string, delta: number, entry: Omit<LedgerEntry, 'delta' | 'balance_after' | 'created'>, o: { once?: string; allowNegative?: boolean; t?: Transaction } = {}) {
  const run = async (t: Transaction) => {
    const userRef = users().doc(userId);
    const onceRef = o.once ? db.collection('once').doc(o.once.replace(/\//g, '_')) : null;
    const [u, done] = await Promise.all([t.get(userRef), onceRef ? t.get(onceRef) : Promise.resolve(null)]);
    if (!u.exists) throw new PortalError('No such account', { status: 404 });
    if (done?.exists) return null;
    const balance = Number(u.get('credits') ?? 0) + delta;
    if (balance < 0 && !o.allowNegative) throw new PortalError('Not enough credits', { status: 402, code: 'no_credits' });
    const row: LedgerEntry = { delta, balance_after: balance, created: Date.now(), ...entry };
    const txId = id('tx_', 6);
    t.update(userRef, { credits: balance });
    t.create(ledgerOf(userId).doc(txId), row);
    if (onceRef) t.create(onceRef, { user: userId, tx: txId, at: row.created });
    return { id: txId, ...row };
  };
  return o.t ? run(o.t) : db.runTransaction(run);
}

/** Has `once` key happened? */
export const happened = async (key: string) => (await db.collection('once').doc(key.replace(/\//g, '_')).get()).exists;

/** The first document a query finds, or null. */
export async function first<T = any>(q: FirebaseFirestore.Query): Promise<(T & { id: string; ref: DocumentReference }) | null> {
  const s = await q.limit(1).get();
  return s.empty ? null : ({ id: s.docs[0].id, ref: s.docs[0].ref, ...(s.docs[0].data() as T) });
}
