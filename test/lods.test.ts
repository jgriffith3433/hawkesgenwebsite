// Levels of detail from Hawkes Gen (src/lods.ts): Gen makes them and keeps them with the asset; the portal remembers
// each asset's summary so a game's bundle and the community library carry it inline (no request per asset), asks Gen
// for many at once when it lacks some, and passes ?lod= through to Gen, cached for good when the link names the file.
// Against a fake Gen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const STARTER = 'usr_00000000000000c0';
const calls: string[] = [];
const img = (sha: string) => ({ kind: 'image', state: 'done', size: [1024, 512], bytes: 900_000, sha: `${sha}00000000`, levels: [128, 256, 512, 1024].map((l) => ({ level: l, bytes: l * 10, w: l, h: l / 2, sha: `${sha}${l}`.padEnd(16, '0') })) });
const mesh = { kind: 'mesh', state: 'done', tris: 12000, tex: 2048, bytes: 3e6, sha: 'cafe000000000000', levels: [{ level: 1400, bytes: 90_000, tris: 1400, tex: 512, role: 'low', sha: 'beef140000000000' }, { level: 4800, bytes: 400_000, tris: 4800, tex: 1024, role: 'mid', sha: 'beef480000000000' }] };
const assets: Record<string, any> = {
  a_aa01: { id: 'a_aa01', title: 'grass', kind: 'image', mime: 'image/png', lods: img('aa') },
  a_bb02: { id: 'a_bb02', title: 'chair', kind: 'mesh', mime: 'model/gltf-binary', lods: mesh },
  // Made before Gen had levels: Gen's /v1/assets answer has none; /v1/lods has them once made.
  a_cc03: { id: 'a_cc03', title: 'rock', kind: 'image', mime: 'image/png', lods: null },
  // The starter pack: a texture and a model with its picture.
  a_dd04: { id: 'a_dd04', project: STARTER, tool: 'asset.make', job: 'j_t', title: 'texture', kind: 'image', mime: 'image/png', labels: { pack: 'starter', community: true, kind: 'texture', tag: 'ground', name: 'Moss', tags: 'ground moss', rev: 'v3' }, lods: img('dd') },
  a_ee05: { id: 'a_ee05', project: STARTER, tool: 'asset.make', job: 'j_m', title: 'model.high', kind: 'mesh', mime: 'model/gltf-binary', bytes: 3e6, labels: { pack: 'starter', community: true, kind: 'model', tag: 'props', name: 'Chair', tags: 'chair', rev: 'v4' }, lods: mesh },
  a_ff06: { id: 'a_ff06', project: STARTER, tool: 'asset.make', job: 'j_m', title: 'cutout', kind: 'image', mime: 'image/png', labels: { pack: 'starter', community: true, kind: 'model', tag: 'props', name: 'Chair', tags: 'chair', rev: 'v4' }, lods: img('ff') },
};
const later: Record<string, any> = { a_cc03: img('cc') };

const fakeGen = http.createServer((req, res) => {
  calls.push(req.url!);
  const url = new URL(req.url!, 'http://gen');
  const json = (status: number, b: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (url.pathname === '/v1/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hi\n\n'); return; }
  if (url.pathname === '/v1/lods') {
    const ids = String(url.searchParams.get('ids')).split(',');
    return json(200, { lods: Object.fromEntries(ids.map((id) => [id, later[id] ?? assets[id]?.lods]).filter(([, l]) => l)), queued: 0 });
  }
  if (url.pathname === '/v1/assets') {
    const all = Object.values(assets).filter((a) => a.project === req.headers['x-hawkesgen-project'] && (!url.searchParams.get('tool') || a.tool === url.searchParams.get('tool')));
    return json(200, { items: Number(url.searchParams.get('offset')) ? [] : all });
  }
  let m = /^\/v1\/assets\/(a_[0-9a-f]+)$/.exec(url.pathname);
  if (m) return assets[m[1]] ? json(200, assets[m[1]]) : json(404, { error: 'no asset' });
  m = /^\/v1\/assets\/(a_[0-9a-f]+)\/file$/.exec(url.pathname);
  if (m && assets[m[1]]) {
    const lod = Number(url.searchParams.get('lod')) || 0;
    const l = lod ? [...(assets[m[1]].lods ?? later[m[1]])?.levels ?? []].reverse().find((x: any) => x.level <= lod) : null;
    res.writeHead(200, { 'Content-Type': l ? 'image/webp' : assets[m[1]].mime, ETag: `"${l ? l.sha : 'original'}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"`, ...(l ? { 'X-Lod-Level': String(l.level) } : {}) });
    return void res.end(`file ${m[1]} ${l ? l.level : 'original'}`);
  }
  return json(404, { error: 'not in the fake' });
});
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));
process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-lods-'));
process.env.HAWKESGEN_URL = `http://127.0.0.1:${(fakeGen.address() as any).port}`;
process.env.HAWKESGEN_KEY = 'hg_test';

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
const signup = await call('/v1/users/signup', { body: { email: 'lods@example.test', password: 'correct horse battery', name: 'Lods' } });
const cookie = signup.cookie!;
const game = (await call('/v1/games', { body: { title: 'Levels' }, cookie })).body;
const gid = game.id ?? game.game?.id;
const slug = game.slug ?? game.game?.slug;

test("a game's bundle carries each image's and model's levels inline, each a link that names its file", async () => {
  for (const id of ['a_aa01', 'a_bb02']) assert.equal((await call(`/v1/games/${gid}/assets`, { body: { asset: `asset:${id}` }, cookie })).status, 200);
  calls.length = 0;
  const b = (await call(`/v1/play/${slug}`)).body;
  assert.equal(calls.filter((u) => u.startsWith('/v1/lods') || u.startsWith('/v1/assets/')).length, 0, 'no request to Gen per asset: the levels came with the asset');
  const grass = Object.values(b.assets).find((a: any) => a.id === 'a_aa01') as any;
  assert.equal(grass.lods.kind, 'image');
  assert.deepEqual(grass.lods.size, [1024, 512]);
  assert.deepEqual(grass.lods.levels.map((l: any) => l.level), [128, 256, 512, 1024]);
  assert.equal(grass.lods.levels[1].url, `${grass.url}?lod=256&v=aa25600000000000`);
  assert.equal(grass.lods.levels[1].sha, undefined);
  const chair = Object.values(b.assets).find((a: any) => a.id === 'a_bb02') as any;
  assert.equal(chair.lods.kind, 'mesh');
  assert.equal(chair.lods.tris, 12000);
  assert.equal(chair.lods.levels[0].role, 'low');
  assert.equal(chair.lods.levels[0].tex, 512);
});

test('an asset whose levels the portal lacks: one request for all of them, and the next bundle has them', async () => {
  await call(`/v1/games/${gid}/assets`, { body: { asset: 'asset:a_cc03' }, cookie });
  calls.length = 0;
  let b = (await call(`/v1/play/${slug}`)).body;
  const rock = () => Object.values(b.assets).find((a: any) => a.id === 'a_cc03') as any;
  assert.equal(rock().lods, undefined, 'none known yet: the original');
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(calls.filter((u) => u.startsWith('/v1/lods?ids=')).length, 1, 'asked once, in the background');
  b = (await call(`/v1/play/${slug}`)).body;
  assert.deepEqual(rock().lods.levels.map((l: any) => l.level), [128, 256, 512, 1024]);
});

test('a level of a play asset: Gen picks it; cached for good when the link names the file', async () => {
  const b = (await call(`/v1/play/${slug}`)).body;
  const grass = Object.values(b.assets).find((a: any) => a.id === 'a_aa01') as any;
  let r = await fetch(base + grass.lods.levels[1].url);
  assert.equal(await r.text(), 'file a_aa01 256');
  assert.ok(calls.some((u) => u === '/v1/assets/a_aa01/file?lod=256'), 'Gen was asked for the level');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  r = await fetch(`${base}${grass.url}?lod=256`);
  await r.text();
  assert.equal(r.headers.get('cache-control'), 'private, max-age=3600', 'without the hash: not forever');
  r = await fetch(`${base}${grass.url}?lod=256&v=0123456789abcdef`);
  await r.text();
  assert.equal(r.headers.get('cache-control'), 'private, max-age=3600', 'a hash that is not the file: not forever');
});

test('the community library: rows carry their levels; the thumb is a small level of the picture', async () => {
  await community.syncStarter();
  const items = (await call('/v1/community')).body.items;
  const moss = items.find((i: any) => i.id === 'a_dd04');
  assert.match(moss.thumb, /^\/v1\/community\/a_dd04\/file\?lod=256&v=dd25600000000000$/);
  assert.equal(moss.lods.levels.length, 4);
  const chair = items.find((i: any) => i.id === 'a_ee05');
  assert.match(chair.thumb, /^\/v1\/community\/a_ff06\/file\?lod=256&v=/);
  assert.equal(chair.low, true, "the model's low level is its low copy");
  assert.equal(chair.lods.levels[0].url, '/v1/community/a_ee05/file?lod=1400&v=beef140000000000');
  // Its file at a level, through the community route.
  calls.length = 0;
  const r = await fetch(base + chair.lods.levels[0].url);
  await r.text();
  assert.ok(calls.includes('/v1/assets/a_ee05/file?lod=1400&v=beef140000000000'));
  // Using it in a game brings only the model: its low copy is one of its levels, not a second asset.
  assert.equal((await call(`/v1/games/${gid}/community`, { body: { id: 'a_ee05' }, cookie })).status, 200);
  const names = Object.keys((await call(`/v1/play/${slug}`)).body.assets);
  assert.ok(!names.some((n) => /_low\.glb$/.test(n)), names.join(', '));
});
