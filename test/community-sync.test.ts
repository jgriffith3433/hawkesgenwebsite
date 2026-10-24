// The starter pack's sync against a fake Gen shaped like the real one: asset.make files its saves as its own outputs
// (model.high and model.lod1; music.song when a step made several files), the asset list is newest first and at most
// 500 a page, a remade thing replaces its row, and every thing sits on its kind's category shelf. Also: the pack's data
// (community/starter.mjs) is sound, and its recipes are what tools/starter.mjs sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const STARTER = 'usr_00000000000000c0';
const assets: any[] = [];
let clock = 1_000;
const put = (a: any) => assets.unshift({ project: STARTER, tool: 'asset.make', created: ++clock, ...a });
const labels = (kind: string, tag: string, name: string, words = '') => ({ pack: 'starter', community: true, kind, tag, tags: `${tag} ${words}`.trim(), name, item: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), rev: kind === 'model' ? 'v4' : 'v3' });

// A model (concept, cutout, the raw mesh and the two exported GLBs), a song saved as several files, a sky, a texture.
const crate = labels('model', 'props', 'Wooden crate', 'box container');
put({ id: 'a_m1', job: 'j_crate', title: 'front', mime: 'image/png', labels: crate });
put({ id: 'a_m2', job: 'j_crate', title: 'cutout.cutout', mime: 'image/png', labels: crate });
put({ id: 'a_m2b', job: 'j_crate', title: 'cutout.mask', mime: 'image/png', labels: crate });
put({ id: 'a_m3', job: 'j_crate', title: 'raw.save-3d-advanced', mime: 'model/gltf-binary', bytes: 5_000_000, labels: crate });
put({ id: 'a_m4', job: 'j_crate', title: 'model.lod1', mime: 'model/gltf-binary', bytes: 80_000, labels: crate });
put({ id: 'a_m5', job: 'j_crate', title: 'model.high', mime: 'model/gltf-binary', bytes: 900_000, labels: crate });
const song = labels('music', 'calm', 'Meadow', 'explore');
put({ id: 'a_s1', job: 'j_song', title: 'music.song', mime: 'audio/mpeg', labels: song });
put({ id: 'a_s2', job: 'j_song', title: 'music.song-2', mime: 'audio/mpeg', labels: song });
put({ id: 'a_k1', job: 'j_sky', title: 'sky', mime: 'image/png', labels: labels('sky', 'night', 'Aurora', 'northern lights') });
put({ id: 'a_t1', job: 'j_tex', title: 'texture', mime: 'image/png', labels: labels('texture', 'ground', 'Grass', 'lawn') });
// A job whose saves aren't usable (no audio in an sfx): skipped, not a broken row.
put({ id: 'a_x1', job: 'j_bad', title: 'sfx', mime: 'image/png', labels: labels('sfx', 'ui', 'Click') });
// Lots of other starter files filed later, so the first ones are past the first page of 500.
for (let i = 0; i < 620; i++) put({ id: `a_f${i.toString(16).padStart(4, '0')}`, job: `j_f${i}`, title: 'sfx', mime: 'audio/mpeg', labels: labels('sfx', 'impacts', `Hit ${i}`, 'hit') });

const fakeGen = http.createServer((req, res) => {
  const as = req.headers['x-hawkesgen-project'];
  const url = new URL(req.url!, 'http://gen');
  const json = (status: number, b: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (url.pathname === '/v1/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hi\n\n'); return; }
  if (url.pathname === '/v1/assets') {
    const tool = url.searchParams.get('tool');
    const q = url.searchParams.get('q');
    const all = assets.filter((a) => a.project === as && (!tool || a.tool === tool) && (!q || JSON.stringify(a).includes(q)));
    const off = Number(url.searchParams.get('offset') ?? 0);
    return json(200, { items: all.slice(off, off + Math.min(500, Number(url.searchParams.get('limit') ?? 60))) });
  }
  return json(404, { error: 'not in the fake' });
});
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));
process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-sync-'));
process.env.HAWKESGEN_URL = `http://127.0.0.1:${(fakeGen.address() as any).port}`;
process.env.HAWKESGEN_KEY = 'hg_test';
const community = await import('../src/community.ts');
const { db } = await import('../src/db.ts');
test.after(() => { fakeGen.closeAllConnections(); fakeGen.close(); });

test('every page is read: things filed long ago are listed even past the first 500 files', async () => {
  const r = await community.syncStarter();
  assert.equal(r.things, 624);
  assert.equal(r.unusable, 1, 'the sfx with no audio');
  assert.equal(community.search({ q: 'crate' }).items[0]?.title, 'Wooden crate');
});

test('a model: the exported high GLB, its LOD as the low copy, the cut-out (not its mask) as its picture; never the raw mesh', () => {
  const crate = community.search({ q: 'crate' }).items[0];
  assert.equal(crate.id, 'a_m5');
  assert.equal(crate.low, true);
  assert.equal(crate.thumb, '/v1/community/a_m2/file');
  const row = db.prepare('SELECT low FROM community_assets WHERE id = ?').get('a_m5') as any;
  assert.equal(row.low, 'a_m4');
});

test('a step that made several files (music.song, music.song-2) still lists, once', () => {
  const songs = community.search({ kind: 'music', exact: true }).items;
  assert.equal(songs.length, 1);
  assert.equal(songs[0].title, 'Meadow');
  assert.ok(['a_s1', 'a_s2'].includes(songs[0].id));
});

test('categories: one shelf per kind and category, kept apart from the search words', () => {
  const crate = community.search({ q: 'crate' }).items[0];
  assert.equal(crate.category, 'props');
  assert.ok(crate.tags.includes('box'));
  assert.deepEqual(community.search({ kind: 'model', category: 'props', exact: true }).items.map((x) => x.title), ['Wooden crate']);
  assert.equal(community.search({ category: 'nature' }).total, 0);
  // The old tag filter still finds a category.
  assert.equal(community.search({ tag: 'night' }).items[0].title, 'Aurora');
  const shelves = community.categories();
  const sky = shelves.kinds.find((k) => k.kind === 'sky')!;
  assert.deepEqual(sky.categories, [{ category: 'night', count: 1 }]);
  assert.equal(shelves.total, 624);
  // The library page pages through a shelf.
  const a = community.search({ kind: 'sfx', exact: true, sort: 'name', limit: 10 });
  const b = community.search({ kind: 'sfx', exact: true, sort: 'name', limit: 10, offset: 10 });
  assert.equal(a.total, 620);
  assert.notEqual(a.items[0].id, b.items[0].id);
});

test('a remade thing replaces its row (the old one hidden), and a thing an admin hid stays hidden', async () => {
  const crate2 = labels('model', 'props', 'Wooden crate', 'box container');
  put({ id: 'a_n2', job: 'j_crate2', title: 'cutout', mime: 'image/png', labels: crate2 });
  put({ id: 'a_n5', job: 'j_crate2', title: 'model.high', mime: 'model/gltf-binary', bytes: 1_000_000, labels: crate2 });
  await community.syncStarter();
  const crates = community.search({ q: 'crate' }).items;
  assert.deepEqual(crates.map((x) => x.id), ['a_n5']);
  db.prepare('UPDATE community_assets SET hidden = 1 WHERE id = ?').run('a_k1');
  await community.syncStarter();
  assert.equal(community.search({ q: 'aurora' }).total, 0);
});

test('the pack itself: sound data, five in each category, and the recipes tools/starter.mjs sends', async () => {
  const { STARTER: PACK, paramsFor } = await import('../community/starter.mjs');
  const groups = PACK as { kind: string; tag: string; items: string[][] }[];
  for (const g of groups) if (g.kind !== 'voice') assert.equal(g.items.length, 5, `${g.kind}/${g.tag}`);
  for (const g of groups) assert.notEqual(g.tag, g.kind, `${g.kind}: a real category`);
  const names = groups.flatMap((g) => g.items.map((i) => `${g.kind}/${i[0].toLowerCase()}`));
  assert.equal(new Set(names).size, names.length, 'names are unique within a kind');
  // Pictures are best of three, judged against the pack's look; sounds are made once.
  const model = paramsFor('model', 'a crate');
  assert.equal(model.candidates, 3);
  assert.equal(model.pickAt, 1);
  assert.ok(model.style && model.pick);
  assert.equal(model.steps.at(-1).save, 'model');
  assert.equal(paramsFor('sfx', 'a click').candidates, undefined);
  assert.equal(paramsFor('music', 'calm piano').steps[0].tool, 'audio.music');
});

test('3D models from before the fixed recipe are never listed, and ones already listed are withdrawn', async () => {
  // A v2 model (built from the cut-out's mask, before Gen's views3d crop fix) that an older sync had listed.
  const old = { ...labels('model', 'nature', 'Old oak', 'tree'), rev: 'v2' };
  db.prepare("INSERT INTO community_assets (id, project, kind, mime, title, tags, category, item, source, created) VALUES ('a_old1', ?, 'model', 'model/gltf-binary', 'Old oak', 'tree', 'nature', 'model/old-oak', 'starter', 1)").run(STARTER);
  put({ id: 'a_old2', job: 'j_old', title: 'model.high', mime: 'model/gltf-binary', bytes: 500_000, labels: old });
  const r = await community.syncStarter();
  assert.ok(r.withdrawn >= 1);
  assert.equal(community.search({ q: 'old oak' }).total, 0, 'neither the listed one nor the new old-recipe one shows');
  assert.ok(community.search({ q: 'crate' }).total >= 1, 'v3 models stay');
  assert.equal(community.search({ kind: 'music', exact: true }).total, 1, 'other kinds are untouched');
});
