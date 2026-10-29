// Admin is J alone: a Google sign-in whose verified email is on PORTAL_ADMIN_EMAILS, checked on every request
// (accounts.ts adminFrom). Every admin route must answer 403 to a customer, to a customer whose stored role was set to
// "admin" by hand, to their API key or OAuth token, and to nobody signed in. No Firestore: the session check is faked
// (adminDeps), and the admin check runs before anything reads data. A new admin route with no case here fails the test.
//   node --test --disable-warning=ExperimentalWarning test/admin.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.PORTAL_ADMIN_EMAILS; // the default: J's address
process.env.PORTAL_PROJECT_PREFIX = 'ustg_';
await import('../src/index.ts');
const { handle, routeTable } = await import('../src/http.ts');
const { adminDeps, adminFrom, isAdmin, adminEmails, toPublicUser } = await import('../src/accounts.ts');

const J = 'piercehawkes3@gmail.com';
const google = (uid: string, email: string, extra: object = {}) => ({ uid, email, email_verified: true, firebase: { sign_in_provider: 'google.com' }, ...extra });
const account = (id: string, email: string, role: 'customer' | 'admin') => ({ id, email, name: null, project: id, credits: 0, role, created: 0, last_login: null });
// Session cookies the fake Firebase knows, and the accounts they map to.
const SESSIONS: Record<string, any> = {
  customer: google('uid-c', 'mallory@example.com'),
  stored: google('uid-s', 'eve@example.com'),
  j: google('uid-j', J),
};
const ACCOUNTS: Record<string, any> = {
  'uid-c': account('ustg_00000000000000c1', 'mallory@example.com', 'customer'),
  'uid-s': account('ustg_00000000000000c2', 'eve@example.com', 'admin'), // a role set by hand in Firestore
  'uid-j': account('ustg_00000000000000a1', J, 'customer'),
};
adminDeps.verify = async (c: string) => { if (!SESSIONS[c]) throw new Error('bad cookie'); return SESSIONS[c]; };
adminDeps.account = async (uid: string) => ACCOUNTS[uid] ?? null;

const req = (method: string, path: string, h: Record<string, string> = {}) => ({ method, originalUrl: path, url: path, headers: { 'content-type': 'application/json', ...h }, body: {}, rawBody: Buffer.from('{}'), ip: '203.0.113.9' }) as any;
async function call(method: string, path: string, h: Record<string, string> = {}) {
  const out = { status: 0, body: '' };
  const res: any = {
    headersSent: false,
    status(n: number) { out.status = n; return res; },
    set() { return res; },
    setHeader() { return res; },
    send(b: string) { out.body = b; res.headersSent = true; return res; },
    end() { res.headersSent = true; return res; },
  };
  await handle(req(method, path, h), res);
  return { status: out.status, body: out.body ? JSON.parse(out.body) : null };
}

const U = 'ustg_00000000000000c1';
// Every admin route, with a path that matches it.
const ADMIN_CALLS: [string, string][] = [
  ['GET', '/v1/admin/overview'],
  ['GET', '/v1/admin/users'],
  ['GET', '/v1/admin/jobs'],
  ['GET', '/v1/admin/purchases'],
  ['GET', `/v1/admin/users/${U}`],
  ...['credits', 'gift', 'disable', 'enable', 'role', 'password-link'].map((w): [string, string] => ['POST', `/v1/admin/users/${U}/${w}`]),
  ['GET', '/v1/admin/reports'],
  ['POST', '/v1/admin/games/g_0123abcd/hide'],
  ['POST', '/v1/admin/games/g_0123abcd/unhide'],
  ['POST', '/v1/admin/community/sync'],
  ['GET', '/v1/health/details'],
  ['POST', '/v1/orgs/org_0123456789abcdef/plan'],
];
const WHO: [string, Record<string, string>][] = [
  ['nobody signed in', {}],
  ['a customer', { cookie: '__session=customer' }],
  ['a customer with role "admin" set by hand', { cookie: '__session=stored' }],
  ['an API key', { authorization: 'Bearer hg_notarealkey' }],
  ['an OAuth token', { authorization: 'Bearer hgo_notarealtoken' }],
  ["J's own cookie under a bearer token", { cookie: '__session=j', authorization: 'Bearer hg_notarealkey' }],
];

test('every admin route answers 403 to everyone but J', async () => {
  for (const [method, path] of ADMIN_CALLS) {
    for (const [who, h] of WHO) {
      const r = await call(method, path, h);
      assert.equal(r.status, 403, `${method} ${path} as ${who}: ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body?.code, 'not_admin', `${method} ${path} as ${who}: refused by the admin check`);
    }
  }
});

test('the list above covers every admin route the API registers', () => {
  const admin = routeTable().filter((r) => /admin|health\\\/details|\\\/plan\$/.test(r.pattern.source) && !/billing/.test(r.pattern.source));
  assert.ok(admin.length >= 8, `found ${admin.length} admin routes`);
  for (const r of admin) {
    const hit = ADMIN_CALLS.some(([m, p]) => m === r.method && r.pattern.test(p));
    assert.ok(hit, `admin route ${r.method} ${r.pattern.source} has no case in admin.test.ts`);
  }
});

test("J's verified Google sign-in is the admin; a stored role, another provider or an unverified email is not", async () => {
  assert.deepEqual(adminEmails(), [J]);
  assert.equal((await adminFrom(req('GET', '/v1/admin/overview', { cookie: '__session=j' })))?.email, J);
  assert.equal(await adminFrom(req('GET', '/v1/admin/overview', { cookie: '__session=stored' })), null);
  const jAcct = ACCOUNTS['uid-j'];
  assert.equal(isAdmin(google('x', J), jAcct), true);
  assert.equal(isAdmin(google('x', J.toUpperCase()), jAcct), true, 'case does not matter');
  assert.equal(isAdmin(google('x', J, { email_verified: false }), jAcct), false);
  assert.equal(isAdmin(google('x', J, { firebase: { sign_in_provider: 'password' } }), jAcct), false);
  assert.equal(isAdmin(google('x', J), { ...jAcct, email: 'someone@example.com' }), false, "J's Google identity mapped to another account");
  assert.equal(isAdmin(google('x', J), { ...jAcct, disabled: true }), false);
  assert.equal(isAdmin(google('x', 'eve@example.com'), ACCOUNTS['uid-s']), false, 'role admin alone');
  assert.equal(isAdmin(google('x', J), jAcct, []), false, 'PORTAL_ADMIN_EMAILS set but empty: nobody');
  process.env.PORTAL_ADMIN_EMAILS = ' Ops@Example.com , piercehawkes3@gmail.com ';
  assert.deepEqual(adminEmails(), ['ops@example.com', J]);
  delete process.env.PORTAL_ADMIN_EMAILS;
});

test('/v1/users/me never shows a stored role as admin', () => {
  assert.equal(toPublicUser(ACCOUNTS['uid-s']).role, 'customer');
  assert.equal(toPublicUser(ACCOUNTS['uid-j'], true).role, 'admin');
});
