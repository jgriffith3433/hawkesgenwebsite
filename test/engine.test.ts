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
process.env.SIGNUPS_PER_HOUR = '100';

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

test('Overseer games use community things by id: /play/t/<id> loads them through the public route, a game made from one keeps them', async () => {
  const { db } = await import('../src/db.ts');
  await import('../src/community.ts'); // its table
  const { TEMPLATES } = await import('../src/templates.ts');
  for (const id of ['fps-arena', 'sky-racer', 'platform-run']) {
    const t = TEMPLATES.find((x) => x.id === id)!;
    assert.ok(Object.keys(t.assets ?? {}).length >= 15, `${id} lists its community things`);
    // Every id the world uses is one of its assets.
    const scene = t.files(t.name)['scene.json'];
    for (const a of new Set(scene.match(/a_[0-9a-f]{16}/g) ?? [])) assert.ok(Object.values(t.assets!).includes(a), `${id}: ${a} is in its assets`);
  }
  // With no library rows (a fresh portal) the game still plays, with no assets.
  assert.deepEqual((await call('/v1/play-template/sky-racer')).body.assets, {});
  const arena = TEMPLATES.find((x) => x.id === 'fps-arena')!;
  const now = Date.now();
  for (const [name, id] of Object.entries(arena.assets!)) {
    const kind = name.endsWith('.mp3') ? 'sfx' : name.endsWith('.png') ? 'texture' : 'model';
    const mime = kind === 'sfx' ? 'audio/mpeg' : kind === 'texture' ? 'image/png' : 'model/gltf-binary';
    db.prepare("INSERT OR IGNORE INTO community_assets (id, project, kind, mime, title, tags, source, created) VALUES (?, 'usr_00000000000000c0', ?, ?, ?, '', 'starter', ?)").run(id, kind, mime, name.replace(/\.\w+$/, ''), now);
  }
  db.prepare('UPDATE community_assets SET hidden = 1 WHERE id = ?').run(arena.assets!['alarm.mp3']);
  const b = (await call('/v1/play-template/fps-arena')).body;
  assert.equal(b.assets['robot.glb'].url, `/v1/community/${arena.assets!['robot.glb']}/file`);
  assert.equal(b.assets['robot.glb'].id, arena.assets!['robot.glb']);
  assert.equal(b.assets['robot.glb'].type, 'model');
  assert.equal(b.assets['battle-drive.mp3'].type, 'sound');
  assert.equal(b.assets['alarm.mp3'], undefined, 'a hidden library thing is left out');
  const maker = await account('Arena');
  const g = (await call('/v1/games', { cookie: maker, body: { title: 'My arena', template: 'fps-arena' } })).body;
  const assets = (await call(`/v1/games/${g.id}`, { cookie: maker })).body.assets;
  const robot = assets.find((a: any) => a.name === 'robot.glb');
  assert.ok(robot && robot.asset === arena.assets!['robot.glb'] && robot.project === 'usr_00000000000000c0', 'the game holds the library thing itself, nothing copied');
  assert.equal(assets.length, Object.keys(arena.assets!).length - 1);
});

test('Overseer games play without an account; remixing copies a game as it is (every game is live)', async () => {
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
  assert.equal((await call('/v1/remix', { cookie: fan, body: { slug: 'no-such-game' } })).status, 404);
  const copy = await call('/v1/remix', { cookie: fan, body: { slug: g.slug } });
  assert.equal(copy.status, 200);
  assert.equal(copy.body.role, 'owner');
  const files = (await call(`/v1/games/${copy.body.id}`, { cookie: fan })).body.files.map((f: any) => f.path);
  assert.ok(files.includes('scene.json'));
});

test('live games: play as it is now, saves and bringing one back, roles the owner sets, visitors who build, who is here', async () => {
  const owner = await account('Owner');
  const g = (await call('/v1/games', { cookie: owner, body: { title: 'Live One', template: 'blank' } })).body;
  // Live without publishing: the play bundle is the game now.
  let play = await call(`/v1/play/${g.slug}`);
  assert.equal(play.status, 200);
  assert.equal(play.body.live, true);
  assert.ok(play.body.files['scene.json']);
  // A world edit shows up in the live bundle at once.
  assert.equal((await call(`/v1/games/${g.id}/scene`, { cookie: owner, body: { ops: [{ op: 'create', entity: { id: 'live_box', type: 'box' } }] } })).status, 200);
  play = await call(`/v1/play/${g.slug}`);
  assert.ok(play.body.files['scene.json'].includes('live_box'));

  // Save, change, bring the save back (and what was there is saved first).
  const s1 = await call(`/v1/games/${g.id}/save`, { cookie: owner, body: { notes: 'with the box' } });
  assert.equal(s1.status, 200);
  await call(`/v1/games/${g.id}/scene`, { cookie: owner, body: { ops: [{ op: 'delete', id: 'live_box' }] } });
  assert.ok(!(await call(`/v1/play/${g.slug}`)).body.files['scene.json'].includes('live_box'));
  assert.equal((await call(`/v1/play/${g.slug}?v=${s1.body.version}`)).body.files['scene.json'].includes('live_box'), true, 'an old save plays');

  // People: an invite makes a builder; builders change the world, not code; the owner makes them an editor.
  const friend = await account('Friend');
  const inv = (await call(`/v1/games/${g.id}/invites`, { cookie: owner, body: {} })).body;
  await call(`/v1/invites/${inv.code}/accept`, { cookie: friend, body: {} });
  const friendId = (await call('/v1/users/me', { cookie: friend })).body.user.id;
  assert.equal((await call(`/v1/games/${g.id}/scene`, { cookie: friend, body: { ops: [{ op: 'create', entity: { id: 'friend_ball', type: 'sphere' } }] } })).status, 200);
  assert.equal((await call(`/v1/games/${g.id}/files`, { cookie: friend, method: 'PUT', body: { path: 'scripts/x.js', content: '//' } })).status, 403);
  assert.equal((await call(`/v1/games/${g.id}/releases/${s1.body.version}/restore`, { cookie: friend, body: {} })).status, 403, 'only the owner brings a save back');
  assert.equal((await call(`/v1/games/${g.id}/members/${friendId}`, { cookie: friend, body: { role: 'editor' } })).status, 403);
  assert.equal((await call(`/v1/games/${g.id}/members/${friendId}`, { cookie: owner, body: { role: 'editor' } })).status, 200);
  assert.equal((await call(`/v1/games/${g.id}/files`, { cookie: friend, method: 'PUT', body: { path: 'scripts/x.js', content: '//' } })).status, 200);
  assert.equal((await call(`/v1/games/${g.id}/members/${friendId}`, { cookie: owner, body: { role: 'player' } })).status, 200);
  assert.equal((await call(`/v1/games/${g.id}/scene`, { cookie: friend, body: { ops: [{ op: 'delete', id: 'friend_ball' }] } })).status, 403, 'players play');
  assert.equal((await call(`/v1/games/${g.id}`, { cookie: friend })).status, 200, 'players still open it');

  const back = await call(`/v1/games/${g.id}/releases/${s1.body.version}/restore`, { cookie: owner, body: {} });
  assert.equal(back.status, 200);
  const now = (await call(`/v1/play/${g.slug}`)).body.files['scene.json'];
  assert.ok(now.includes('live_box') && !now.includes('friend_ball'));
  const saves = (await call(`/v1/games/${g.id}/saves`, { cookie: owner })).body.saves;
  assert.ok(saves[0].notes.startsWith('Before bringing back'), 'a restore can be undone');

  // Visitors: play only until the owner opens it to builders.
  const visitor = await account('Visitor');
  assert.equal((await call(`/v1/play/${g.slug}/join`, { cookie: visitor, body: {} })).status, 403);
  assert.equal((await call(`/v1/games/${g.id}`, { cookie: friend, body: { visitors: 'build' } })).status, 403);
  assert.equal((await call(`/v1/games/${g.id}`, { cookie: owner, body: { visitors: 'build' } })).body.visitors, 'build');
  const joined = await call(`/v1/play/${g.slug}/join`, { cookie: visitor, body: {} });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.role, 'builder');

  // Who is here: play pages say so; the gallery and the game show it.
  await call(`/v1/play/${g.slug}/here`, { body: { s: 'tab-one' } });
  const c = await call(`/v1/play/${g.slug}/here`, { body: { s: 'tab-two' } });
  assert.equal(c.body.playing, 2);
  const gal = (await call('/v1/gallery')).body.games.find((x: any) => x.slug === g.slug);
  assert.equal(gal.playing, 2);
  assert.equal(gal.visitors, 'build');
});
