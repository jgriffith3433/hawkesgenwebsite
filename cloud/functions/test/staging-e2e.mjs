// End-to-end on staging (https://hawkes-staging.web.app): a throwaway account with an API key made straight in
// Firestore (sign-in itself is Google's), then the signed-in API as a client uses it: the account, the ledger, a game
// (make, scene ops, save), a quote, and one real paid Gen job on the CPU (pixel art of a tiny PNG), checking the hold
// and that the job settles. Everything it made is deleted at the end. Needs gcloud application default credentials.
//   GOOGLE_CLOUD_PROJECT=hawkes-staging node test/staging-e2e.mjs
import crypto from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (process.env.GOOGLE_CLOUD_PROJECT !== 'hawkes-staging') throw new Error('GOOGLE_CLOUD_PROJECT=hawkes-staging');
initializeApp();
const db = getFirestore();
const BASE = process.env.BASE ?? 'https://hawkes-staging.web.app';
const id = `ustg_${crypto.randomBytes(8).toString('hex')}`;
const key = `hg_${crypto.randomBytes(24).toString('base64url')}`;
const keyHash = crypto.createHash('sha256').update(key).digest('hex');
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}`); if (!cond) failed++; };
const api = async (method, path, body, headers = {}) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${key}`, ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};

// A 2x2 PNG (red, green, blue, white).
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVQI12P4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64'));
const made = { game: null, job: null };

try {
  await db.collection('users').doc(id).create({ email: `${id}@example.com`, name: 'e2e', project: id, credits: 200, role: 'customer', disabled: false, plan: 'free', created: Date.now(), last_login: null });
  await db.collection('apiKeys').doc(keyHash).create({ id: 'k_e2e', user_id: id, prefix: key.slice(0, 7), created: Date.now(), last_used: null, disabled: false, daily_cap: null });

  let r = await api('GET', '/v1/users/me');
  ok('who am I', r.status === 200 && r.json?.user?.id === id, `${r.status} credits=${r.json?.user?.credits}`);

  r = await api('POST', '/v1/games', { title: 'E2E world' });
  made.game = r.json?.game?.id ?? r.json?.id ?? null;
  ok('make a game', r.status === 200 && Boolean(made.game), `${r.status} ${made.game ?? r.text.slice(0, 120)}`);
  if (made.game) {
    r = await api('POST', `/v1/games/${made.game}/scene`, { ops: [{ op: 'create', entity: { id: 'e2e-box', kind: 'box', position: [0, 1, 0] } }] });
    ok('scene op', r.status === 200, `${r.status} ${r.text.slice(0, 120)}`);
    r = await api('GET', `/v1/games/${made.game}`);
    ok('read the game', r.status === 200, `${r.status}`);
    r = await api('POST', `/v1/games/${made.game}/save`, { note: 'e2e' });
    ok('save', r.status === 200, `${r.status} ${r.text.slice(0, 120)}`);
    r = await api('GET', '/v1/games');
    ok('list my games', r.status === 200 && JSON.stringify(r.json).includes(made.game), `${r.status}`);
  }

  r = await api('POST', '/v1/assets', PNG, { 'Content-Type': 'image/png', 'X-Filename': 'e2e.png' });
  const asset = r.json?.id ?? r.json?.asset?.id ?? null;
  ok('upload to Gen', r.status === 200 && Boolean(asset), `${r.status} ${asset ?? r.text.slice(0, 120)}`);

  const spec = { tool: 'image.transform', inputs: { image: `asset:${asset}` }, params: { op: 'pixel', size: 2 } };
  r = await api('POST', '/v1/billing/quote', spec);
  ok('quote', r.status === 200 && Number.isFinite(r.json?.credits), `${r.status} credits=${r.json?.credits}`);
  const price = r.json?.credits ?? 0;

  r = await api('POST', '/v1/jobs', spec);
  made.job = r.json?.jobs?.[0]?.id ?? null;
  ok('submit a paid job', r.status === 200 && Boolean(made.job), `${r.status} ${made.job ?? r.text.slice(0, 160)}`);
  const after = (await db.collection('users').doc(id).get()).get('credits');
  ok('credits taken (hold)', after === 200 - price, `200 - ${price} = ${after}`);

  let status = '';
  for (let i = 0; i < 40 && made.job; i++) {
    r = await api('GET', `/v1/jobs/${made.job}`);
    status = r.json?.status;
    if (['done', 'failed', 'cancelled'].includes(status)) break;
    await new Promise((res) => setTimeout(res, 3000));
  }
  ok('job ended', ['done', 'failed', 'cancelled'].includes(status), status);
  const job = made.job ? await db.collection('jobs').doc(made.job).get() : null;
  ok('job settled once', Boolean(job?.get('settled')), `settled=${job?.get('settled')} status=${job?.get('status')}`);
  const final = (await db.collection('users').doc(id).get()).get('credits');
  ok(status === 'done' ? 'credits kept (done)' : 'credits returned (not done)', status === 'done' ? final === 200 - price : final === 200, `credits=${final}`);

  r = await api('GET', '/v1/billing/ledger');
  ok('ledger', r.status === 200 && Array.isArray(r.json?.entries), `${r.status} rows=${r.json?.entries?.length}`);
} finally {
  // Clean up everything made here.
  const del = async (ref) => { for (const c of await ref.listCollections()) for (const d of (await c.get()).docs) await del(d.ref); await ref.delete(); };
  if (made.game) await del(db.collection('games').doc(made.game)).catch(() => {});
  if (made.job) {
    const j = await db.collection('jobs').doc(made.job).get();
    if (j.exists && j.get('hold')) await db.collection('holds').doc(j.get('hold')).delete().catch(() => {});
    await j.ref.delete().catch(() => {});
  }
  for (const d of (await db.collection('once').where('user', '==', id).get()).docs) await d.ref.delete();
  await del(db.collection('users').doc(id)).catch(() => {});
  await db.collection('apiKeys').doc(keyHash).delete().catch(() => {});
  console.log(failed ? `${failed} FAILED` : 'all passed');
  process.exitCode = failed ? 1 : 0;
}
