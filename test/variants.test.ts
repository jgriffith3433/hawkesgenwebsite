// Images' smaller copies (src/variants.ts) against a fake Gen: reading an image's size from its bytes, which sizes an
// image gets, the backfill of the library and of games, the copies made by image.transform as the image's own project
// (no credits), the bundle carrying them, the play-asset and community links serving them, the customer's own list
// leaving them out, and the day's cap for customers' images.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const STARTER = 'usr_00000000000000c0';
const seen: { method: string; url: string; as?: string; body?: any }[] = [];
const assets: Record<string, any> = {};
const jobs: Record<string, any> = {};
let nextId = 0x100;
const hex = () => (nextId++).toString(16).padStart(8, '0');

/** The first bytes of a PNG of this size (enough for the portal to read its size). */
function png(w: number, h: number) {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
const put = (a: any) => (assets[a.id] = { bytes: a.data ? a.data.length : 0, ...a });
const labels = (kind: string, name: string, tags: string) => ({ pack: 'starter', community: true, kind, tag: tags.split(' ')[0], name, tags, rev: 'v3' });
put({ id: 'a_51', project: STARTER, tool: 'asset.make', job: 'j_sky', title: 'sky', kind: 'image', mime: 'image/png', data: png(2048, 1024), labels: labels('sky', 'Sunset', 'day sunset') });
put({ id: 'a_52', project: STARTER, tool: 'asset.make', job: 'j_wood', title: 'texture', kind: 'image', mime: 'image/png', data: png(1024, 1024), labels: labels('texture', 'Oak', 'wood oak planks') });

const fakeGen = http.createServer(async (req, res) => {
  const as = req.headers['x-hawkesgen-project'] as string | undefined;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || 'null') : undefined;
  seen.push({ method: req.method!, url: req.url!, as, body });
  const url = new URL(req.url!, 'http://gen');
  const json = (status: number, b: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (url.pathname === '/v1/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hi\n\n'); return; }
  if (url.pathname === '/v1/assets' && req.method === 'GET') {
    const tool = url.searchParams.get('tool');
    const all = Object.values(assets).filter((a) => a.project === as && (!tool || a.tool === tool)).map(({ data, ...a }) => a);
    return json(200, { items: all, total: all.length });
  }
  let m = /^\/v1\/assets\/(a_[0-9a-f]+)$/.exec(url.pathname);
  if (m) { const a = assets[m[1]]; if (!a || a.project !== as) return json(404, { error: 'no asset' }); const { data, ...rest } = a; return json(200, rest); }
  m = /^\/v1\/assets\/(a_[0-9a-f]+)\/file$/.exec(url.pathname);
  if (m) { const a = assets[m[1]]; if (!a || a.project !== as) return json(404, { error: 'no asset' }); res.writeHead(200, { 'Content-Type': a.mime }); return void res.end(a.data ?? `file ${a.id}`); }
  if (url.pathname === '/v1/jobs' && req.method === 'POST') {
    // image.transform: one WebP out, in the caller's project, labelled as asked.
    const src = assets[String(body.inputs?.image ?? '').replace(/^asset:/, '')];
    if (!src || src.project !== as) return json(404, { error: 'input not in this project' });
    const op = body.params.ops[0];
    const w = op.op === 'resize' ? op.width : 0, h = op.op === 'resize' ? op.height : 0;
    const out = put({ id: `a_${hex()}`, project: as, tool: 'image.transform', kind: 'image', mime: 'image/webp', labels: body.labels, data: Buffer.from(`webp ${w}x${h}`) });
    const j = { id: `j_${hex()}`, status: 'done', tool: body.tool, outputs: [{ asset: out.id, mime: out.mime, bytes: out.bytes }], result: w ? { width: w, height: h } : {} };
    jobs[j.id] = j;
    return json(200, { jobs: [{ id: j.id, status: 'queued' }] });
  }
  m = /^\/v1\/jobs\/(j_[0-9a-f]+)$/.exec(url.pathname);
  if (m) return jobs[m[1]] ? json(200, jobs[m[1]]) : json(404, { error: 'no job' });
  return json(404, { error: 'not in the fake' });
});
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));

process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-variants-'));
process.env.HAWKESGEN_URL = `http://127.0.0.1:${(fakeGen.address() as any).port}`;
process.env.HAWKESGEN_KEY = 'hg_test';
process.env.VARIANTS_POLL_MS = '5';
process.env.VARIANTS_PER_DAY = '1';

const { handle } = await import('../src/server.ts');
const community = await import('../src/community.ts');
const V = await import('../src/variants.ts');
const { db } = await import('../src/db.ts');
const portal = http.createServer((req, res) => void handle(req, res));
await new Promise<void>((r) => portal.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(portal.address() as any).port}`;
test.after(() => { portal.closeAllConnections(); portal.close(); fakeGen.closeAllConnections(); fakeGen.close(); });

async function call(route: string, o: { body?: unknown; cookie?: string; method?: string } = {}) {
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.cookie) headers.Cookie = o.cookie;
  const r = await fetch(base + route, { method: o.method ?? (o.body !== undefined ? 'POST' : 'GET'), headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const text = await r.text();
  let b: any = text;
  try { b = JSON.parse(text); } catch {}
  return { status: r.status, body: b, headers: r.headers, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}

test('an image\'s size comes from its first bytes: PNG, JPEG, WebP (all three kinds) and GIF', () => {
  assert.deepEqual(V.imageSize(png(1024, 512)), { width: 1024, height: 512, type: 'png' });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x00, 0x03, 0x00, 0x03, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(V.imageSize(jpg), { width: 768, height: 512, type: 'jpeg' });
  const riff = (chunk: string, body: number[]) => { const b = Buffer.alloc(40); b.write('RIFF', 0); b.write('WEBP', 8); b.write(chunk, 12); Buffer.from(body).copy(b, 20); return b; };
  // VP8X: 24-bit sizes minus one at 24 and 27.
  const x = riff('VP8X', [0, 0, 0, 0, 0xff, 0x03, 0x00, 0xff, 0x01, 0x00]);
  assert.deepEqual(V.imageSize(x), { width: 1024, height: 512, type: 'webp' });
  const lossy = riff('VP8 ', [0, 0, 0, 0, 0, 0, 0x00, 0x04, 0x00, 0x02]);
  assert.deepEqual(V.imageSize(lossy), { width: 1024, height: 512, type: 'webp' });
  const v = (1023) | (511 << 14);
  const lossless = riff('VP8L', [0, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);
  assert.deepEqual(V.imageSize(lossless), { width: 1024, height: 512, type: 'webp' });
  const gif = Buffer.from('GIF89a\x40\x00\x20\x00', 'latin1');
  assert.deepEqual(V.imageSize(gif), { width: 64, height: 32, type: 'gif' });
  assert.equal(V.imageSize(Buffer.from('not an image at all, really')), null);
});

test('which copies an image gets: every size below its long side, then the full size as WebP (unless it is one)', () => {
  const sizes = (w: number, h: number, mime: string) => V.variantPlan(w, h, mime).map((s) => s.size);
  assert.deepEqual(sizes(1024, 1024, 'image/png'), [128, 256, 512, 1024]);
  assert.deepEqual(sizes(2048, 1024, 'image/png'), [128, 256, 512, 1024, 2048]);
  assert.deepEqual(sizes(1024, 1024, 'image/webp'), [128, 256, 512], 'a WebP is its own full size');
  assert.deepEqual(sizes(600, 500, 'image/png'), [128, 256, 512, 600]);
  assert.deepEqual(sizes(100, 80, 'image/png'), [], 'small already');
  const tall = V.variantPlan(500, 1000, 'image/png')[0];
  assert.deepEqual([tall.width, tall.height], [64, 128], 'the long side is the size; the aspect stays');
  assert.equal(tall.ops[0].op, 'resize');
  assert.equal(tall.ops[0].fit, 'stretch');
});

let user: { cookie: string; project: string };
let gameId = '';
test('the backfill queues the library\'s images and games\' images; the worker makes them as their own projects, free', async () => {
  await community.syncStarter();
  const r = await call('/v1/users/signup', { body: { email: 'v@example.test', password: 'correct horse battery', name: 'V' } });
  user = { cookie: r.cookie!, project: (await call('/v1/users/me', { cookie: r.cookie })).body.user.project };
  const credits = (await call('/v1/users/me', { cookie: user.cookie })).body.user.credits;
  put({ id: 'a_61', project: user.project, kind: 'image', mime: 'image/png', title: 'brick', data: png(1024, 1024) });
  put({ id: 'a_62', project: user.project, kind: 'image', mime: 'image/png', title: 'stone', data: png(512, 512) });
  gameId = (await call('/v1/games', { cookie: user.cookie, body: { title: 'Lods' } })).body.id;
  assert.equal((await call(`/v1/games/${gameId}/assets`, { cookie: user.cookie, body: { asset: 'asset:a_61', name: 'brick' } })).status, 200);
  assert.equal((await call(`/v1/games/${gameId}/assets`, { cookie: user.cookie, body: { asset: 'asset:a_62', name: 'stone' } })).status, 200);
  const b = V.backfillVariants();
  assert.equal(b.images.pending, 4, JSON.stringify(b));
  await V.drainVariants({ waitMs: 2000 });
  const sent = seen.filter((s) => s.url === '/v1/jobs');
  assert.ok(sent.every((s) => s.body.tool === 'image.transform' && s.body.params.format === 'webp'), 'only image.transform, as WebP');
  assert.ok(sent.filter((s) => s.body.inputs.image === 'asset:a_51').every((s) => s.as === STARTER), 'the library\'s as the starter project');
  assert.ok(sent.filter((s) => s.body.inputs.image === 'asset:a_61').every((s) => s.as === user.project), "a customer's as their own project");
  const sizes = (id: string) => (db.prepare('SELECT size FROM asset_variants WHERE asset = ? ORDER BY size').all(id) as { size: number }[]).map((x) => x.size);
  assert.deepEqual(sizes('a_51'), [128, 256, 512, 1024, 2048]);
  assert.deepEqual(sizes('a_52'), [128, 256, 512, 1024]);
  // The day's cap for customers' images is 1 here: one game image done, the other waits for tomorrow.
  const st = V.variantStatus();
  assert.equal(st.images.done, 3, JSON.stringify(st));
  assert.equal(st.images.pending, 1);
  assert.equal((await call('/v1/users/me', { cookie: user.cookie })).body.user.credits, credits, 'no credits taken');
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM jobs").get() as any).n), 0, 'not a paid job');
  // Nothing is made twice.
  const before = seen.filter((s) => s.url === '/v1/jobs').length;
  V.backfillVariants();
  process.env.VARIANTS_PER_DAY = '0';
  await V.drainVariants({ waitMs: 2000 });
  assert.equal(seen.filter((s) => s.url === '/v1/jobs').length, before);
  process.env.VARIANTS_PER_DAY = '10';
  await V.drainVariants({ waitMs: 2000 });
  assert.equal(V.variantStatus().images.done, 4, JSON.stringify(db.prepare('SELECT asset, state, tries, error FROM variant_sources').all()));
});

test('the bundle carries each image\'s copies, and the play link serves them (cached for good when named by id)', async () => {
  const b = (await call(`/v1/games/${gameId}/bundle`, { cookie: user.cookie })).body;
  const brick = b.assets['brick.png'];
  assert.deepEqual(brick.size, [1024, 1024]);
  assert.deepEqual(Object.keys(brick.variants), ['128', '256', '512', '1024']);
  const v256 = brick.variants['256'];
  assert.match(v256.url, /\?lod=256&v=a_[0-9a-f]+$/);
  assert.equal(v256.w, 256);
  const r = await fetch(base + v256.url);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'webp 256x256');
  assert.match(r.headers.get('cache-control') ?? '', /immutable/);
  // Without the id: the copy at that size, not cached for good (the name could point at another image later).
  const plain = await fetch(base + brick.url + '?lod=300');
  assert.equal(await plain.text(), 'webp 512x512', 'the next size up');
  assert.doesNotMatch(plain.headers.get('cache-control') ?? '', /immutable/);
  // Someone else's id is ignored.
  const other = await fetch(base + brick.url + '?lod=256&v=a_51');
  assert.equal(await other.text(), 'webp 256x256');
});

test('the community library lists each image\'s copies, its thumb is the 256 px one, and the copies are served', async () => {
  const sky = (await call('/v1/community?kind=sky')).body.items[0];
  assert.deepEqual(Object.keys(sky.variants), ['128', '256', '512', '1024', '2048']);
  assert.deepEqual(sky.size, [2048, 1024]);
  assert.equal(sky.thumb, sky.variants['256']);
  assert.equal(sky.thumbFull, sky.file);
  const f = await fetch(base + sky.variants['128']);
  assert.equal(f.status, 200);
  assert.equal(await f.text(), 'webp 128x64');
});

test('a customer\'s own library list leaves the copies out (they belong to their image)', async () => {
  const list = (await call('/v1/assets', { cookie: user.cookie })).body;
  assert.ok(list.items.some((a: any) => a.id === 'a_61'));
  assert.ok(!list.items.some((a: any) => a.labels && a.labels.lod), JSON.stringify(list.items.map((a: any) => a.id)));
});
