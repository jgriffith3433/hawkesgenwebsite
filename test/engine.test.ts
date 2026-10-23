// The game engine's server side: world edits (scene ops) saved and shared, the realtime rooms (WebSocket), remixing,
// and the Overseer games anyone can play. None of it reaches Gen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-engine-'));
process.env.HAWKESGEN_URL = 'http://127.0.0.1:9';
process.env.HAWKESGEN_KEY = 'hg_test';
process.env.STARTER_CREDITS = '50';

const { handle, onUpgrade } = await import('../src/server.ts');
const { applyOps, parseScene, emptyScene } = await import('../src/scene.ts');
const portal = http.createServer((req, res) => void handle(req, res));
portal.on('upgrade', onUpgrade);
await new Promise<void>((r) => portal.listen(0, '127.0.0.1', () => r()));
const port = (portal.address() as any).port;
const base = `http://127.0.0.1:${port}`;
test.after(() => portal.close());

async function call(route: string, o: { body?: unknown; cookie?: string; method?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
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
  return r.cookie!;
}
function socket(url: string) {
  const ws = new WebSocket(url);
  const got: any[] = [];
  const waiters: [(m: any) => boolean, (m: any) => void][] = [];
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); got.push(m); for (const w of [...waiters]) if (w[0](m)) { waiters.splice(waiters.indexOf(w), 1); w[1](m); } };
  const next = (pred: (m: any) => boolean, ms = 3000) => new Promise<any>((ok, bad) => {
    const seen = got.find(pred);
    if (seen) return ok(seen);
    const t = setTimeout(() => bad(new Error('no message came')), ms);
    waiters.push([pred, (m) => { clearTimeout(t); ok(m); }]);
  });
  return { ws, got, next, open: new Promise<void>((ok, bad) => { ws.onopen = () => ok(); ws.onerror = () => bad(new Error('ws failed')); }) };
}

test('scene ops: create, update (merge), delete with children, config, and bad ops skipped', () => {
  let s = emptyScene();
  let r = applyOps(s, [
    { op: 'create', entity: { type: 'box', name: 'Crate', transform: { position: [0, 1, 0] }, material: { color: '#ff0000' } } },
    { op: 'create', entity: { id: 'lid', type: 'box', parent: 'crate' } },
    { op: 'create', entity: { type: 'dragon' } },
  ]);
  assert.deepEqual(r.created, ['crate', 'lid']);
  assert.equal(r.errors.length, 1);
  s = r.scene;
  r = applyOps(s, [{ op: 'update', id: 'crate', patch: { physics: 'dynamic', material: { emissive: '#110000' } } }, { op: 'config', patch: { background: '#000000' } }]);
  assert.equal(r.scene.entities.crate.material.color, '#ff0000');
  assert.equal(r.scene.entities.crate.material.emissive, '#110000');
  assert.equal(r.scene.config.background, '#000000');
  r = applyOps(r.scene, [{ op: 'update', id: 'crate', patch: { physics: 'wobbly' } }]);
  assert.match(r.errors[0], /physics/);
  r = applyOps(r.scene, [{ op: 'delete', id: 'crate' }]);
  assert.deepEqual(Object.keys(r.scene.entities), []);
  assert.deepEqual(parseScene('not json').entities, {});
});

test('world edits are saved to scene.json, and only members may make them', async () => {
  const owner = await account('Owner');
  const g = (await call('/v1/games', { cookie: owner, body: { title: 'World', template: 'blank' } })).body;
  const r = await call(`/v1/games/${g.id}/scene`, { cookie: owner, body: { ops: [{ op: 'create', entity: { id: 'spire', type: 'cylinder', name: 'Spire' } }, { op: 'update', id: 'ball', patch: { body: { bounce: 0.9 } } }] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.created, ['spire']);
  const files = (await call(`/v1/games/${g.id}`, { cookie: owner })).body.files;
  const scene = JSON.parse(files.find((f: any) => f.path === 'scene.json').content);
  assert.equal(scene.entities.spire.name, 'Spire');
  assert.equal(scene.entities.ball.body.bounce, 0.9);
  const stranger = await account('Stranger');
  assert.equal((await call(`/v1/games/${g.id}/scene`, { cookie: stranger, body: { ops: [{ op: 'delete', id: 'spire' }] } })).status, 404);
});

test('rooms: members meet, see each other move, and get world edits; a bad token is refused', async () => {
  const owner = await account('Host');
  const g = (await call('/v1/games', { cookie: owner, body: { title: 'Room', template: 'blank' } })).body;
  const bundle = (await call(`/v1/games/${g.id}/bundle`, { cookie: owner })).body;
  assert.ok(bundle.net.token);
  const url = `ws://127.0.0.1:${port}/v1/ws?t=${encodeURIComponent(bundle.net.token)}`;
  const a = socket(url);
  await a.open;
  const helloA = await a.next((m) => m.t === 'hello');
  assert.equal(helloA.host, helloA.you);
  const b = socket(url);
  await b.open;
  const helloB = await b.next((m) => m.t === 'hello');
  assert.equal(helloB.host, helloA.you);
  await a.next((m) => m.t === 'join' && m.c === helloB.you);
  b.ws.send(JSON.stringify({ t: 'me', s: { p: [1, 2, 3], y: 0.5 } }));
  const seen = await a.next((m) => m.t === 'me' && m.c === helloB.you);
  assert.deepEqual(seen.s.p, [1, 2, 3]);
  b.ws.send(JSON.stringify({ t: 'own', id: 'crate_1', on: true }));
  assert.equal((await a.next((m) => m.t === 'own' && m.id === 'crate_1')).c, helloB.you);
  // An edit made through the API reaches everyone but the connection that made it.
  await call(`/v1/games/${g.id}/scene`, { cookie: owner, body: { ops: [{ op: 'update', id: 'ball', patch: { name: 'Big ball' } }] }, headers: { 'X-Room-Conn': helloA.you } });
  const ops = await b.next((m) => m.t === 'ops');
  assert.equal(ops.ops[0].patch.name, 'Big ball');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(a.got.filter((m) => m.t === 'ops').length, 0);
  // The host leaving hands the world to the next one.
  a.ws.close();
  assert.equal((await b.next((m) => m.t === 'host')).c, helloB.you);
  b.ws.close();
  const bad = new WebSocket(`ws://127.0.0.1:${port}/v1/ws?t=nope.nope`);
  await new Promise<void>((ok) => { bad.onerror = () => ok(); bad.onclose = () => ok(); });
});

test('Overseer games play without an account; remixing copies a published game', async () => {
  const gal = (await call('/v1/gallery')).body;
  assert.ok(gal.featured.some((f: any) => f.id === 'fps-arena' && f.url === '/play/t/fps-arena'));
  const t = await call('/v1/play-template/fps-arena');
  assert.equal(t.status, 200);
  assert.ok(t.body.files['scene.json'] && t.body.files['scripts/arena.js']);
  assert.equal((await call('/v1/play-template/nope')).status, 404);
  assert.equal((await fetch(`${base}/play/t/fps-arena`)).status, 200);

  const maker = await account('Maker');
  const g = (await call('/v1/games', { cookie: maker, body: { title: 'Original', template: 'blank' } })).body;
  const fan = await account('Fan');
  assert.equal((await call('/v1/remix', { cookie: fan, body: { slug: g.slug } })).status, 404, 'unpublished games stay private');
  assert.equal((await call(`/v1/games/${g.id}/publish`, { cookie: maker, body: {} })).status, 200);
  const copy = await call('/v1/remix', { cookie: fan, body: { slug: g.slug } });
  assert.equal(copy.status, 200);
  assert.equal(copy.body.role, 'owner');
  const files = (await call(`/v1/games/${copy.body.id}`, { cookie: fan })).body.files.map((f: any) => f.path);
  assert.ok(files.includes('scene.json'));
});
