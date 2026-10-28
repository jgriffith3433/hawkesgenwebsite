// Does a server-sent stream reach the browser as it is written, through Firebase Hosting and straight from the function?
// A throwaway account and game on staging, the editor's live feed for up to 100 s, each chunk timed; all deleted after.
//   GOOGLE_CLOUD_PROJECT=hawkes-staging WHICH=hosting|direct node test/stream-check.mjs
import crypto from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (process.env.GOOGLE_CLOUD_PROJECT !== 'hawkes-staging') throw new Error('GOOGLE_CLOUD_PROJECT=hawkes-staging');
initializeApp();
const db = getFirestore();
const SITE = 'https://hawkes-staging.web.app';
const DIRECT = process.env.DIRECT_URL ?? 'https://api-f6ruen5wfa-uk.a.run.app';
const base = process.env.WHICH === 'direct' ? DIRECT : SITE;
const id = `ustg_${crypto.randomBytes(8).toString('hex')}`;
const key = `hg_${crypto.randomBytes(24).toString('base64url')}`;
const kh = crypto.createHash('sha256').update(key).digest('hex');
await db.collection('users').doc(id).create({ email: `${id}@example.com`, name: 'stream', project: id, credits: 0, role: 'customer', disabled: false, plan: 'free', created: Date.now(), last_login: null });
await db.collection('apiKeys').doc(kh).create({ id: 'k_stream', user_id: id, prefix: 'hg_', created: Date.now(), last_used: null, disabled: false, daily_cap: null });
const auth = { Authorization: `Bearer ${key}` };
const g = await (await fetch(`${SITE}/v1/games`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'stream check' }) })).json();
const gid = g.game?.id ?? g.id;
const t0 = Date.now();
const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
try {
  const r = await fetch(`${base}/v1/games/${gid}/live`, { headers: { ...auth, Accept: 'text/event-stream' }, signal: AbortSignal.timeout(100_000) });
  console.log(`${process.env.WHICH}: status ${r.status} headers at ${at()} content-type=${r.headers.get('content-type')}`);
  const rd = r.body.getReader();
  let n = 0;
  for (;;) {
    const { value, done } = await rd.read();
    if (done) { console.log(`ended ${at()}`); break; }
    if (n++ < 8) console.log(`  ${at()} ${value.length} B: ${Buffer.from(value).toString().slice(0, 80).split('\n').join(' ')}`);
  }
} catch (e) {
  console.log(`${e.name} ${at()}`);
} finally {
  const del = async (ref) => { for (const c of await ref.listCollections()) for (const d of (await c.get()).docs) await del(d.ref); await ref.delete(); };
  await del(db.collection('games').doc(gid)).catch(() => {});
  await del(db.collection('users').doc(id)).catch(() => {});
  await db.collection('apiKeys').doc(kh).delete().catch(() => {});
}
