// Gen's CDN links (src/lods.ts cdnOf, games.ts assetMap): a published game's bundle points at cdn.hawkesgen.com for every file
// Gen has backed up (originals and levels) and at the portal's own /play-asset links for the rest; the proxy still serves;
// a draft in the editor keeps its signed links; community rows and share pages use the CDN too; the play page's CSP names it.
// Against a fake Gen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const CDN = 'https://cdn.hawkesgen.com';
const STARTER = 'usr_00000000000000c0';
const calls: string[] = [];
const hash = (s: string) => s.padEnd(64, '0');
const lvl = (sha: string, level: number, cdn: boolean) => ({ level, bytes: level * 10, w: level, h: level / 2, sha: sha.slice(0, 16), inS3: cdn, ...(cdn ? { cdn: `${CDN}/sha256/${hash(sha)}` } : {}) });
// A picture backed up: its original and the 256 and 1024 levels are; the 128 level is not yet.
const grass = { kind: 'image', state: 'done', size: [1024, 512], bytes: 900_000, sha: 'aa00000000000000', inS3: true, cdn: `${CDN}/sha256/${hash('aa0')}`, levels: [lvl('aa128', 128, false), lvl('aa256', 256, true), lvl('aa1024', 1024, true)] };
// A model not backed up at all.
const chair = { kind: 'mesh', state: 'done', tris: 12000, tex: 2048, bytes: 3e6, sha: 'cafe000000000000', inS3: false, levels: [{ level: 1400, bytes: 90_000, tris: 1400, tex: 512, role: 'low', sha: 'beef140000000000', inS3: false }] };
const assets: Record<string, any> = {
  a_aa01: { id: 'a_aa01', title: 'grass', kind: 'image', mime: 'image/png', inS3: true, cdn: grass.cdn, lods: grass },
  a_bb02: { id: 'a_bb02', title: 'chair', kind: 'mesh', mime: 'model/gltf-binary', inS3: false, lods: chair },
  // A sound: no levels, but backed up.
  a_cc03: { id: 'a_cc03', title: 'boom', kind: 'sfx', mime: 'audio/mpeg', inS3: true, cdn: `${CDN}/sha256/${hash('cc3')}`, lods: null },
  // A link from a host the play page does not name: never put in a bundle.
  a_dd04: { id: 'a_dd04', title: 'wind', kind: 'sfx', mime: 'audio/mpeg', cdn: `https://evil.example/sha256/${hash('dd4')}`, lods: null },
  // The starter pack: a texture, backed up.
  a_ee05: { id: 'a_ee05', project: STARTER, tool: 'asset.make', job: 'j_t', title: 'texture', kind: 'image', mime: 'image/png', inS3: true, cdn: grass.cdn, labels: { pack: 'starter', community: true, kind: 'texture', tag: 'ground', name: 'Moss', tags: 'ground moss', rev: 'v3' }, lods: grass },
  // A player's photo for a share page.
  a_ff06: { id: 'a_ff06', title: 'photo', kind: 'image', mime: 'image/png', inS3: true, cdn: `${CDN}/sha256/${hash('ff6')}`, lods: null },
};
const fakeGen = http.createServer((req, res) => {
  calls.push(req.url!);
  const url = new URL(req.url!, 'http://gen');
  const json = (status: number, b: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (url.pathname === '/v1/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hi\n\n'); return; }
  if (url.pathname === '/v1/lods') return json(200, { lods: {}, queued: 0 });
  if (url.pathname === '/v1/assets') {
    const all = Object.values(assets).filter((a) => a.project === req.headers['x-hawkesgen-project'] && (!url.searchParams.get('tool') || a.tool === url.searchParams.get('tool')));
    return json(200, { items: Number(url.searchParams.get('offset')) ? [] : all });
  }
  let m = /^\/v1\/assets\/(a_[0-9a-f]+)$/.exec(url.pathname);
  if (m) return assets[m[1]] ? json(200, assets[m[1]]) : json(404, { error: 'no asset' });
  m = /^\/v1\/assets\/(a_[0-9a-f]+)\/file$/.exec(url.pathname);
  if (m && assets[m[1]]) { res.writeHead(200, { 'Content-Type': assets[m[1]].mime }); return void res.end(`file ${m[1]} ${url.searchParams.get('lod') ?? 'original'}`); }
  return json(404, { error: 'not in the fake' });
});
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));
process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-cdn-'));
process.env.HAWKESGEN_URL = `http://127.0.0.1:${(fakeGen.address() as any).port}`;
process.env.HAWKESGEN_KEY = 'hg_test';
process.env.PORTAL_DEV_OPEN_PLAY = '0';

const { handle } = await import('../src/server.ts');
const community = await import('../src/community.ts');
const portal = http.createServer((req, res) => void handle(req, res));
await new Promise<void>((r) => portal.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(portal.address() as any).port}`;
test.after(() => { portal.closeAllConnections(); portal.close(); fakeGen.closeAllConnections(); fakeGen.close(); });

async function call(route: string, o: { body?: unknown; cookie?: string } = {}) {
  const r = await fetch(base + route, { method: o.body !== undefined ? 'POST' : 'GET', headers: { ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(o.cookie ? { Cookie: o.cookie } : {}) }, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, headers: r.headers, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const signup = await call('/v1/users/signup', { body: { email: 'cdn@example.test', password: 'correct horse battery', name: 'Cdn' } });
const cookie = signup.cookie!;
const game = (await call('/v1/games', { body: { title: 'Cdn game' }, cookie })).body;
const gid = game.id ?? game.game?.id;
const slug = game.slug ?? game.game?.slug;
for (const id of ['a_aa01', 'a_bb02', 'a_cc03', 'a_dd04']) assert.equal((await call(`/v1/games/${gid}/assets`, { body: { asset: `asset:${id}` }, cookie })).status, 200);
const find = (b: any, id: string) => Object.values(b.assets).find((a: any) => a.id === id) as any;

test('a published game: backed-up files are on the CDN (originals and levels), the rest on the portal', async () => {
  const b = (await call(`/v1/play/${slug}`)).body;
  const g = find(b, 'a_aa01');
  assert.equal(g.url, `${CDN}/sha256/${hash('aa0')}`);
  assert.deepEqual(g.lods.levels.map((l: any) => l.url), [
    // (the 128 level isn't backed up yet: the portal's own link, which asks Gen)
    g.lods.levels[0].url, `${CDN}/sha256/${hash('aa256')}`, `${CDN}/sha256/${hash('aa1024')}`,
  ]);
  assert.match(g.lods.levels[0].url, /^\/play-asset\/[a-z0-9-]+\/live\/grass[^?]*\?lod=128&v=aa128$/);
  assert.equal(g.lods.levels[1].cdn, undefined);
  assert.equal(g.lods.levels[1].inS3, undefined);
  const sound = find(b, 'a_cc03');
  assert.equal(sound.url, `${CDN}/sha256/${hash('cc3')}`, 'a sound has no levels but is backed up');
  const c = find(b, 'a_bb02');
  assert.match(c.url, /^\/play-asset\/[a-z0-9-]+\/live\//, 'not backed up: through the site');
  assert.match(c.lods.levels[0].url, /^\/play-asset\/[a-z0-9-]+\/live\/.*\?lod=1400&v=beef140000000000$/);
  assert.match(find(b, 'a_dd04').url, /^\/play-asset\//, 'a link from a host the page does not name is never given out');
  for (const a of Object.values(b.assets) as any[]) assert.ok(a.url.startsWith('/play-asset/') || a.url.startsWith(`${CDN}/`));
});

test('the proxy still serves every file, backed up or not', async () => {
  const b = (await call(`/v1/play/${slug}`)).body;
  for (const id of ['a_aa01', 'a_bb02', 'a_cc03']) {
    const name = Object.entries(b.assets).find(([, a]: any) => a.id === id)![0];
    const r = await fetch(`${base}/play-asset/${slug}/live/${encodeURIComponent(name)}`);
    assert.equal(r.status, 200, name);
    assert.match(await r.text(), new RegExp(`file ${id}`));
  }
  const lowName = Object.entries(b.assets).find(([, a]: any) => a.id === 'a_aa01')![0];
  assert.equal(await (await fetch(`${base}${find(b, 'a_aa01').lods.levels[0].url}`)).text(), 'file a_aa01 128');
  assert.equal(await (await fetch(`${base}/play-asset/${slug}/live/${encodeURIComponent(lowName)}?lod=256`)).text(), 'file a_aa01 256');
});

test('a save carries CDN links too', async () => {
  assert.equal((await call(`/v1/games/${gid}/save`, { body: {}, cookie })).status, 200);
  const b = (await call(`/v1/play/${slug}?v=1`)).body;
  assert.equal(b.version, 1);
  assert.equal(find(b, 'a_aa01').url, `${CDN}/sha256/${hash('aa0')}`);
  assert.match(find(b, 'a_bb02').url, /^\/play-asset\/[a-z0-9-]+\/1\//);
});

test("a draft in the editor keeps its signed links: every asset loads through the portal", async () => {
  const b = (await call(`/v1/games/${gid}/bundle`, { cookie })).body;
  for (const id of ['a_aa01', 'a_bb02', 'a_cc03', 'a_dd04']) {
    const a = find(b, id);
    assert.match(a.url, /^\/play-asset\/d\//, id);
    assert.equal(a.url.includes('cdn.hawkesgen.com'), false);
    const r = await fetch(base + a.url);
    assert.equal(r.status, 200, id);
    await r.text();
  }
  assert.ok(find(b, 'a_aa01').lods.levels.every((l: any) => l.url.startsWith('/play-asset/d/')), 'levels too');
});

test('the community library: files and levels on the CDN when backed up', async () => {
  await community.syncStarter();
  const moss = (await call('/v1/community')).body.items.find((i: any) => i.id === 'a_ee05');
  assert.equal(moss.file, grass.cdn);
  assert.equal(moss.thumb, `${CDN}/sha256/${hash('aa256')}`, 'the thumb is the 256 level, on the CDN');
  assert.equal(moss.lods.levels[0].url.startsWith('/v1/community/a_ee05/file?lod=128'), true, 'a level not backed up: the portal');
  assert.equal(moss.lods.levels[2].url, `${CDN}/sha256/${hash('aa1024')}`);
  assert.equal(await (await fetch(`${base}/v1/community/a_ee05/file`)).text(), 'file a_ee05 original', 'the fallback route still serves');
});

test("a game's page may load from the CDN and nowhere else new", async () => {
  const r = await fetch(`${base}/play/${slug}`);
  const csp = r.headers.get('content-security-policy')!;
  for (const d of ['connect-src', 'img-src', 'media-src']) assert.match(csp, new RegExp(`${d}[^;]* ${CDN}`), d);
  assert.doesNotMatch(csp, /script-src[^;]*cdn\.hawkesgen\.com/);
  assert.doesNotMatch(csp, /evil\.example/);
});

test("a share page shows the photo from the CDN when it is backed up", async () => {
  const s = await call('/v1/shares', { body: { asset: 'a_ff06', title: 'Look' }, cookie });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const html = (await (await fetch(`${base}/s/${s.body.id}`)).text());
  assert.ok(html.includes(`src="${CDN}/sha256/${hash('ff6')}"`), 'the picture');
  assert.ok(html.includes(`/s/${s.body.id}/media`), 'the preview tags and the download stay on the share');
  assert.equal(await (await fetch(`${base}/s/${s.body.id}/media`)).text(), 'file a_ff06 original');
});
