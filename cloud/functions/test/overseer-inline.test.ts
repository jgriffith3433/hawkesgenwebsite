// The Overseer's answer runs in the api service, which is already up, not only in the gameAssistant service, which can't
// start when the region's CPU quota is full (J, 2026-11-10: "it just thinks forever"). These check the parts that need no
// Firestore: the api's own address, and that the internal route takes only our own signed token.
//   node --test --disable-warning=ExperimentalWarning test/overseer-inline.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GCLOUD_PROJECT ??= 'demo-test';
process.env.PORTAL_SIGNING_KEY ??= 'test-signing-key';
const { runAppUrl } = await import('../src/gameai.ts');
const { handle } = await import('../src/http.ts');
const { sign } = await import('../src/sign.ts');

test("the api's own address is its run.app URL", () => {
  assert.equal(runAppUrl('api', '598611630218', 'us-east4'), 'https://api-598611630218.us-east4.run.app');
});

function call(path: string, headers: Record<string, string>) {
  const out: { status?: number; body?: string } = {};
  const res: any = {
    headersSent: false,
    status(n: number) { out.status = n; return res; },
    set() { return res; },
    send(b: string) { out.body = b; res.headersSent = true; return res; },
    end(b?: string) { out.body = b; res.headersSent = true; },
  };
  const req: any = { method: 'POST', url: path, originalUrl: path, headers };
  return handle(req, res).then(() => out);
}

test('the internal run route refuses a call without our token', async () => {
  const r = await call('/v1/internal/ai-runs/air_0123456789abcdef', {});
  assert.equal(r.status, 404);
});

test('the internal run route refuses a token for another run or of another kind', async () => {
  const other = await call('/v1/internal/ai-runs/air_0123456789abcdef', { 'x-hawkes-run': sign({ k: 'airun', run: 'air_ffffffffffffffff' }, 60) });
  assert.equal(other.status, 404);
  const kind = await call('/v1/internal/ai-runs/air_0123456789abcdef', { 'x-hawkes-run': sign({ k: 'edit', run: 'air_0123456789abcdef' }, 60) });
  assert.equal(kind.status, 404);
});
