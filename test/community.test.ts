// The community library against a fake Gen: the starter pack picked up from Gen's library, search by tags and words,
// using a thing in a game (from its owner's project, with a model's low-detail copy), sharing your own and taking it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const STARTER = 'usr_00000000000000c0';
const seen: { url: string; as?: string }[] = [];
// Assets by id: the project that owns each one.
const assets: Record<string, any> = {};
const put = (a: any) => (assets[a.id] = a);
const starterLabels = (kind: string, name: string, tags: string) => ({ pack: 'starter', community: true, kind, tag: tags.split(' ')[0], name, tags });
put({ id: 'a_b0', project: STARTER, tool: 'asset.make', job: 'j_ball', title: 'front', kind: 'image', mime: 'image/png', labels: starterLabels('model', 'Ball', 'toys ball sphere bouncy') });
put({ id: 'a_b1', project: STARTER, tool: 'asset.make', job: 'j_ball', title: 'cutout', kind: 'image', mime: 'image/png', labels: starterLabels('model', 'Ball', 'toys ball sphere bouncy') });
put({ id: 'a_b2', project: STARTER, tool: 'asset.make', job: 'j_ball', title: 'model.high', kind: 'mesh', mime: 'model/gltf-binary', bytes: 900_000, labels: starterLabels('model', 'Ball', 'toys ball sphere bouncy') });
put({ id: 'a_b3', project: STARTER, tool: 'asset.make', job: 'j_ball', title: 'model.lod1', kind: 'mesh', mime: 'model/gltf-binary', bytes: 90_000, labels: starterLabels('model', 'Ball', 'toys ball sphere bouncy') });
put({ id: 'a_c1', project: STARTER, tool: 'blender.character', job: 'j_child', title: 'high', kind: 'mesh', mime: 'model/gltf-binary', labels: starterLabels('model', 'Ball', 'toys') });
put({ id: 'a_r1', project: STARTER, tool: 'asset.make', job: 'j_rain', title: 'ambience', kind: 'audio', mime: 'audio/mpeg', labels: starterLabels('ambience', 'Rain', 'ambience rain weather storm') });
put({ id: 'a_g1', project: STARTER, tool: 'asset.make', job: 'j_grass', title: 'texture', kind: 'image', mime: 'image/png', labels: starterLabels('texture', 'Grass', 'ground grass lawn') });

const fakeGen = http.createServer((req, res) => {
  const as = req.headers['x-hawkesgen-project'] as string | undefined;
  seen.push({ url: req.url!, as });
  const url = new URL(req.url!, 'http://gen');
  const json = (status: number, b: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (url.pathname === '/v1/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hi\n\n'); return; }
  if (url.pathname === '/v1/assets') {
    // Like Gen: the caller's project, a tool and words filter, newest first, a page at a time.
    const tool = url.searchParams.get('tool');
    const q = url.searchParams.get('q');
    const all = Object.values(assets).filter((a) => a.project === as && (!tool || a.tool === tool) && (!q || JSON.stringify(a).includes(q)));
    const off = Number(url.searchParams.get('offset') ?? 0);
    return json(200, { items: all.slice(off, off + Math.min(500, Number(url.searchParams.get('limit') ?? 60))) });
  }
  let m = /^\/v1\/assets\/(a_[0-9a-f]+)$/.exec(url.pathname);
  if (m) return assets[m[1]] && assets[m[1]].project === as ? json(200, assets[m[1]]) : json(404, { error: 'no asset' });
  m = /^\/v1\/assets\/(a_[0-9a-f]+)\/file$/.exec(url.pathname);
  if (m && assets[m[1]]?.project === as) { res.writeHead(200, { 'Content-Type': assets[m[1]].mime }); return void res.end(`file ${m[1]}`); }
  return json(404, { error: 'not in the fake' });
});
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));

process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-community-'));
process.env.HAWKESGEN_URL = `http://127.0.0.1:${(fakeGen.address() as any).port}`;
process.env.HAWKESGEN_KEY = 'hg_test';
process.env.STARTER_CREDITS = '50';

const { handle } = await import('../src/server.ts');
const community = await import('../src/community.ts');
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
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
let n = 0;
async function account(name: string) {
  const r = await call('/v1/users/signup', { body: { email: `${name}-${++n}@example.test`, password: 'correct horse battery', name } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const me = await call('/v1/users/me', { cookie: r.cookie });
  return { cookie: r.cookie!, project: me.body.user.project as string };
}

test('the starter pack is picked up from Gen: one row per finished job, a model with its low copy and thumb', async () => {
  const r = await community.syncStarter();
  assert.equal(r.jobs, 3, "a step's own files (another tool) are not the pack's");
  assert.equal(r.things, 3);
  const ball = (await call('/v1/community?q=ball')).body.items;
  assert.equal(ball.length, 1);
  assert.equal(ball[0].id, 'a_b2', 'the bigger GLB is the model');
  assert.equal(ball[0].low, true);
  assert.equal(ball[0].thumb, '/v1/community/a_b1/file', 'the cut-out picture is its thumb');
  assert.equal(ball[0].by, 'Hawkes');
  // Again: nothing doubles.
  await community.syncStarter();
  assert.equal((await call('/v1/community')).body.total, 3);
});

test('search: tags and words, kinds that answer for each other, tags to browse', async () => {
  assert.deepEqual((await call('/v1/community?q=bouncy+toy')).body.items.map((x: any) => x.title), ['Ball']);
  assert.deepEqual((await call('/v1/community?q=rain+sounds&kind=sfx')).body.items.map((x: any) => x.title), ['Rain'], 'an ambience answers for a sound effect');
  assert.deepEqual((await call('/v1/community?q=grass&kind=model')).body.items, []);
  assert.equal((await call('/v1/community?q=dragon')).body.items.length, 0);
  const tags = (await call('/v1/community/tags')).body.tags.map((t: any) => t.tag);
  assert.ok(tags.includes('toys') && tags.includes('grass'));
  // Files of listed things (and their thumbs) come from the owner's project; anything else is not served.
  const f = await call('/v1/community/a_b1/file');
  assert.equal(f.body, 'file a_b1');
  assert.equal(seen.at(-1)!.as, STARTER);
  assert.equal((await call('/v1/community/a_b0/file')).status, 404, 'only the listed file, its thumb and low copy');
});

test('using a community thing in a game: the asset from its owner, under the name asked for, with its low copy', async () => {
  const me = await account('Builder');
  const g = (await call('/v1/games', { cookie: me.cookie, body: { title: 'Ball Pit' } })).body;
  const gid = g.id ?? g.game?.id;
  const r = await call(`/v1/games/${gid}/community`, { cookie: me.cookie, body: { id: 'a_b2', name: 'beach-ball' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.asset.name, 'beach-ball.glb');
  assert.equal(r.body.asset.project, STARTER);
  const bundle = (await call(`/v1/games/${gid}/bundle`, { cookie: me.cookie })).body;
  const names = (bundle.assets ? (Array.isArray(bundle.assets) ? bundle.assets.map((a: any) => a.name) : Object.keys(bundle.assets)) : []);
  assert.ok(names.includes('beach-ball.glb') && names.includes('beach-ball_low.glb'), JSON.stringify(names));
  assert.equal((await call('/v1/community?q=ball')).body.items[0].uses, 1);
  assert.equal((await call('/v1/community?q=ball')).body.items[0].likes, 1, 'a like: someone used it');
  // The same account using it again is not another like; someone else is.
  const g2 = (await call('/v1/games', { cookie: me.cookie, body: { title: 'Ball Pit 2' } })).body;
  await call(`/v1/games/${g2.id ?? g2.game?.id}/community`, { cookie: me.cookie, body: { id: 'a_b2' } });
  assert.equal((await call('/v1/community?q=ball')).body.items[0].likes, 1);
  // Sorting: most liked first by default; hidden gems (least used) first when asked.
  assert.deepEqual((await call('/v1/community?kind=model')).body.items.map((x: any) => x.title), ['Ball']);
  const all = (await call('/v1/community?sort=fresh')).body.items.map((x: any) => x.title);
  assert.equal(all.at(-1), 'Ball', 'the most used comes last for hidden gems');
  // Not a member: no.
  const other = await account('Stranger');
  assert.equal((await call(`/v1/games/${gid}/community`, { cookie: other.cookie, body: { id: 'a_b2' } })).status, 404, 'not their game');
});

test('sharing: only your own things, others find and use them, unsharing hides them', async () => {
  const maker = await account('Maker');
  put({ id: 'a_d1', project: maker.project, job: 'j_duck', title: 'duck', kind: 'mesh', mime: 'model/gltf-binary', labels: {} });
  const stranger = await account('Copycat');
  assert.equal((await call('/v1/community', { cookie: stranger.cookie, body: { asset: 'asset:a_d1', tags: 'duck' } })).status, 404, "someone else's asset");
  assert.equal((await call('/v1/community', { body: { asset: 'a_d1' } })).status, 401);
  const s = await call('/v1/community', { cookie: maker.cookie, body: { asset: 'asset:a_d1', title: 'Rubber duck', tags: 'Toys, duck  bath' } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual(s.body.tags, ['toys', 'duck', 'bath']);
  assert.equal(s.body.by, 'Maker');
  const found = (await call('/v1/community?q=duck')).body.items;
  assert.equal(found[0].id, 'a_d1');
  // Someone else uses it in their own game: the asset comes from the maker's project.
  const g = (await call('/v1/games', { cookie: stranger.cookie, body: { title: 'Bath' } })).body;
  const gid = g.id ?? g.game?.id;
  const u = await call(`/v1/games/${gid}/community`, { cookie: stranger.cookie, body: { id: 'a_d1' } });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(u.body.asset.project, maker.project);
  // Only the maker takes it back.
  assert.equal((await call('/v1/community/a_d1', { cookie: stranger.cookie, method: 'DELETE' })).status, 404);
  assert.equal((await call('/v1/community/a_d1', { cookie: maker.cookie, method: 'DELETE' })).status, 200);
  assert.equal((await call('/v1/community?q=duck')).body.items.length, 0);
  assert.equal((await call(`/v1/games/${gid}/community`, { cookie: stranger.cookie, body: { id: 'a_d1' } })).status, 404);
});
