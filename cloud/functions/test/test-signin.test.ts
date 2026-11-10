// Beta's test sign-in for Studio's playtests (testsignin.ts). These check the parts that need no Firestore: it is off on
// live whatever the settings say, it asks only an allowlisted Studio, and it takes only a fresh token for our project.
//   node --test --disable-warning=ExperimentalWarning test/test-signin.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GCLOUD_PROJECT = 'hawkes-staging';
process.env.PORTAL_SIGNING_KEY ??= 'test-signing-key';
const T = await import('../src/testsignin.ts');
const { handle } = await import('../src/http.ts');
const { sign } = await import('../src/sign.ts');

const now = Date.now();
const token = (o: any = {}) => ({ project: 'hawkes-games', exp: Math.floor(now / 1000) + 300, nonce: 'abc123', sig: 'c2ln', issuer: 'https://studio.hawkesgen.ai/o/j-studio-4f12', ...o });
const studio = (ok: boolean, seen: string[] = []) => (async (url: any) => { seen.push(String(url)); return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 401 }); }) as typeof fetch;

test('on only on hawkes-staging with PORTAL_TEST_SIGNIN=on', () => {
  process.env.PORTAL_TEST_SIGNIN = 'on';
  assert.equal(T.testSignInOn(), true);
  process.env.GCLOUD_PROJECT = 'hawkes-prod';
  assert.equal(T.testSignInOn(), false);
  process.env.GCLOUD_PROJECT = 'hawkes-staging';
  delete process.env.PORTAL_TEST_SIGNIN;
  assert.equal(T.testSignInOn(), false);
});

test('only an allowlisted Studio, at its root or one cell', () => {
  assert.equal(T.allowedIssuer('https://studio.hawkesgen.ai'), 'https://studio.hawkesgen.ai');
  assert.equal(T.allowedIssuer('https://studio.hawkesgen.ai/o/j-studio-4f12'), 'https://studio.hawkesgen.ai/o/j-studio-4f12');
  assert.equal(T.allowedIssuer('https://evil.example/o/x'), null);
  assert.equal(T.allowedIssuer('http://studio.hawkesgen.ai'), null);
  assert.equal(T.allowedIssuer('https://studio.hawkesgen.ai/api/x'), null);
  assert.equal(T.allowedIssuer('https://a@studio.hawkesgen.ai'), null);
});

test('a token Studio vouches for passes, and Studio is asked at its verify address', async () => {
  const seen: string[] = [];
  await T.checkToken(token(), now, studio(true, seen));
  assert.deepEqual(seen, ['https://studio.hawkesgen.ai/o/j-studio-4f12/api/signin/verify']);
});

test('refused: Studio says no, expired, another project, an untrusted issuer', async () => {
  await assert.rejects(T.checkToken(token(), now, studio(false)), /refused/);
  await assert.rejects(T.checkToken(token({ exp: Math.floor(now / 1000) - 1 }), now, studio(true)), /expired/);
  await assert.rejects(T.checkToken(token({ exp: Math.floor(now / 1000) + 3600 }), now, studio(true)), /expired/);
  await assert.rejects(T.checkToken(token({ project: 'hawkes-studio' }), now, studio(true)), /Not a test/);
  const seen: string[] = [];
  await assert.rejects(T.checkToken(token({ issuer: 'https://evil.example' }), now, studio(true, seen)), /do not trust/);
  assert.deepEqual(seen, []);
});

test('a test cookie means nothing where test sign-in is off', async () => {
  delete process.env.PORTAL_TEST_SIGNIN;
  const c = `t.${sign({ k: 'test', u: 'ustg_x' }, 60)}`;
  const u = await T.fromTestCookie(c, async () => ({ id: 'ustg_x', email: T.TEST_EMAIL, test: true, disabled: false } as any));
  assert.equal(u, null);
});

test('a test cookie reads only as the test account, and only as a test token', async () => {
  process.env.PORTAL_TEST_SIGNIN = 'on';
  const acct = { id: 'ustg_x', email: T.TEST_EMAIL, test: true, disabled: false } as any;
  assert.equal((await T.fromTestCookie(`t.${sign({ k: 'test', u: 'ustg_x' }, 60)}`, async () => acct))?.id, 'ustg_x');
  assert.equal(await T.fromTestCookie(`t.${sign({ k: 'airun', u: 'ustg_x' }, 60)}`, async () => acct), null);
  assert.equal(await T.fromTestCookie(`t.${sign({ k: 'test', u: 'ustg_y' }, 60)}`, async () => ({ id: 'ustg_y', email: 'someone@example.com', disabled: false } as any)), null);
});

test('the route answers 404 where test sign-in is off', async () => {
  delete process.env.PORTAL_TEST_SIGNIN;
  const out: { status?: number } = {};
  const res: any = { headersSent: false, status(n: number) { out.status = n; return res; }, set() { return res; }, send() { res.headersSent = true; return res; }, setHeader() {}, end() {} };
  await handle({ method: 'POST', url: '/v1/test-signin', originalUrl: '/v1/test-signin', headers: {}, body: token() } as any, res);
  assert.equal(out.status, 404);
});
