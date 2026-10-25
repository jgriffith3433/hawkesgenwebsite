// Share links (src/shares.ts) against a fake Gen: a signed-in player uploads a clip and its poster into their own
// project and makes a link; the page at /s/<id> has the preview tags Discord and X read; its media streams from Gen
// (ranges too) for anyone; nobody can share a file that isn't theirs; guests can't make links; owners take them down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// ------------------------------------------------------------------ a fake Gen that keeps uploaded files per project
const files = new Map<string, { project: string; mime: string; bytes: Buffer }>();
let n = 0;
const fakeGen = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const as = String(req.headers['x-hawkesgen-project'] ?? '');
  const url = new URL(req.url!, 'http://gen');
  const json = (status: number, b: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (url.pathname === '/v1/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hi\n\n'); return; }
  if (url.pathname === '/v1/assets' && req.method === 'POST') {
    const id = `a_${(++n).toString(16).padStart(6, '0')}`;
    const mime = String(req.headers['content-type'] ?? 'application/octet-stream');
    files.set(id, { project: url.searchParams.get('project') || as, mime, bytes: raw });
    return json(200, { id, project: as, mime, kind: mime.split('/')[0], size: raw.length });
  }
  let m = /^\/v1\/assets\/(a_[0-9a-f]+)$/.exec(url.pathname);
  if (m) { const f = files.get(m[1]); return f && f.project === as ? json(200, { id: m[1], project: f.project, mime: f.mime, kind: f.mime.split('/')[0] }) : json(404, { error: 'no such asset' }); }
  m = /^\/v1\/assets\/(a_[0-9a-f]+)\/file$/.exec(url.pathname);
  if (m) {
    const f = files.get(m[1]);
    if (!f || f.project !== as) return json(404, { error: 'no such asset' });
    const range = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? ''));
    if (range) {
      const a = Number(range[1]), b = range[2] ? Number(range[2]) : f.bytes.length - 1;
      res.writeHead(206, { 'Content-Type': f.mime, 'Content-Range': `bytes ${a}-${b}/${f.bytes.length}`, 'Content-Length': String(b - a + 1), 'Accept-Ranges': 'bytes' });
      return void res.end(f.bytes.subarray(a, b + 1));
    }
    res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': String(f.bytes.length), 'Accept-Ranges': 'bytes' });
    return void res.end(f.bytes);
  }
  return json(404, { error: 'not in the fake' });
});
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));

process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-shares-'));
process.env.HAWKESGEN_URL = `http://127.0.0.1:${(fakeGen.address() as any).port}`;
process.env.HAWKESGEN_KEY = 'hg_portal_test_key';
process.env.PUBLIC_URL = 'https://hawkesgen.test';
process.env.SIGNUPS_PER_HOUR = '100';

const { handle } = await import('../src/server.ts');
const games = await import('../src/games.ts');
const users = await import('../src/users.ts');
const portal = http.createServer((req, res) => void handle(req, res));
await new Promise<void>((r) => portal.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(portal.address() as any).port}`;
test.after(() => { portal.close(); fakeGen.close(); });

async function call(route: string, o: { body?: unknown; cookie?: string; method?: string; raw?: Buffer; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.cookie) headers.Cookie = o.cookie;
  const r = await fetch(base + route, { method: o.method ?? (o.body !== undefined || o.raw ? 'POST' : 'GET'), headers, body: o.raw ? new Uint8Array(o.raw) : o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const buf = Buffer.from(await r.arrayBuffer());
  let body: any = buf.toString('utf8');
  try { body = JSON.parse(body); } catch {}
  return { status: r.status, body, buf, headers: r.headers, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const signup = async (email: string) => (await call('/v1/users/signup', { body: { email, password: 'correct horse battery', name: email.split('@')[0] } })).cookie!;

const CLIP = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(4096, 7)]);
const POSTER = Buffer.from('\xff\xd8\xff\xe0fake jpeg', 'binary');

test('a player uploads a clip and its poster to their own project and gets a share page with preview tags', async () => {
  const cookie = await signup('ava@example.com');
  const me = (await call('/v1/users/me', { cookie })).body.user;
  const g = games.createGame(users.getUser(me.id)!, { title: 'Island Run' });
  const clip = await call('/v1/assets', { cookie, raw: CLIP, headers: { 'Content-Type': 'video/webm', 'X-Filename': 'clip.webm' } });
  assert.equal(clip.status, 200);
  assert.equal(files.get(clip.body.id)!.project, users.getUser(me.id)!.project, "into the player's own project");
  const poster = await call('/v1/assets', { cookie, raw: POSTER, headers: { 'Content-Type': 'image/jpeg', 'X-Filename': 'poster.jpg' } });
  // While building, the game page only knows the game's id: the link still goes to its play page.
  const made = await call('/v1/shares', { cookie, body: { asset: clip.body.id, thumb: poster.body.id, title: 'Jumped the <canyon>', game: g.id, width: 1280, height: 720, seconds: 15 } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const s = made.body;
  assert.equal(s.kind, 'clip');
  assert.match(s.url, /^https:\/\/hawkesgen\.test\/s\/[\w-]{8}$/);
  assert.equal(s.game.url, `https://hawkesgen.test/play/${g.slug}`);
  assert.equal(s.game.title, 'Island Run');

  const page = await call(`/s/${s.id}`);
  assert.equal(page.status, 200);
  const html = page.body as string;
  assert.ok(html.includes(`<meta property="og:video" content="https://hawkesgen.test/s/${s.id}/media">`), 'og:video');
  assert.ok(html.includes('<meta property="og:video:type" content="video/webm">'));
  assert.ok(html.includes(`<meta property="og:image" content="https://hawkesgen.test/s/${s.id}/image">`), 'og:image (the poster)');
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(html.includes('<meta property="og:title" content="Jumped the &lt;canyon&gt;">'), 'titles are escaped');
  assert.ok(!html.includes('<canyon>'));
  assert.ok(html.includes(`href="/play/${g.slug}"`) && html.includes('Play this game'));

  // The media streams for anyone (no cookie), ranges too, never as a page.
  const media = await call(`/s/${s.id}/media`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'video/webm');
  assert.equal(media.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(media.buf, CLIP);
  const part = await call(`/s/${s.id}/media`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(part.status, 206);
  assert.deepEqual([...part.buf], [0x1a, 0x45, 0xdf, 0xa3]);
  const img = await call(`/s/${s.id}/image`);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  // The share as JSON (open), counted views, and the player's list.
  const info = await call(`/v1/shares/${s.id}`);
  assert.equal(info.body.views, 1);
  assert.equal((await call('/v1/shares/mine', { cookie })).body.shares.length, 1);
});

test('a photo is its own card picture; an unknown game gets no Play button', async () => {
  const cookie = await signup('ben@example.com');
  const png = await call('/v1/assets', { cookie, raw: Buffer.from('\x89PNG fake', 'binary'), headers: { 'Content-Type': 'image/png' } });
  const s = (await call('/v1/shares', { cookie, body: { asset: png.body.id, game: 't/nope-not-a-template' } })).body;
  assert.equal(s.kind, 'photo');
  assert.equal(s.image, `https://hawkesgen.test/s/${s.id}/image`);
  assert.equal(s.game, null, 'an unknown game: no button to nowhere');
  assert.equal(s.title, 'A photo');
  const html = (await call(`/s/${s.id}`)).body as string;
  assert.ok(html.includes('<meta property="og:type" content="website">'));
  assert.ok(!html.includes('og:video'));
});

test("nobody shares a file that isn't theirs, guests can't make links, and owners take links down", async () => {
  const a = await signup('cat@example.com');
  const b = await signup('dan@example.com');
  const up = await call('/v1/assets', { cookie: a, raw: CLIP, headers: { 'Content-Type': 'video/mp4' } });
  const steal = await call('/v1/shares', { cookie: b, body: { asset: up.body.id } });
  assert.equal(steal.status, 404, 'Gen says it is not in their project');
  assert.equal((await call('/v1/shares', { body: { asset: up.body.id } })).status, 401, 'guests: sign up first');
  assert.equal((await call('/v1/shares', { cookie: a, body: { asset: 'nope' } })).status, 400);
  const txt = await call('/v1/assets', { cookie: a, raw: Buffer.from('hello'), headers: { 'Content-Type': 'text/plain' } });
  assert.equal((await call('/v1/shares', { cookie: a, body: { asset: txt.body.id } })).status, 400, 'only photos and clips');
  const s = (await call('/v1/shares', { cookie: a, body: { asset: up.body.id, title: 'mine' } })).body;
  assert.equal((await call(`/v1/shares/${s.id}`, { cookie: b, method: 'DELETE' })).status, 404, 'not theirs to take down');
  assert.equal((await call(`/v1/shares/${s.id}`, { cookie: a, method: 'DELETE' })).status, 200);
  const gone = await call(`/s/${s.id}`);
  assert.equal(gone.status, 404);
  assert.ok(String(gone.body).includes("isn't here any more"));
  assert.equal((await call(`/s/${s.id}/media`)).status, 404);
  assert.equal((await call('/s/../../etc')).status, 404);
});

test('the share window is served for games to open', async () => {
  const r = await call('/share/new');
  assert.equal(r.status, 200);
  assert.ok(String(r.body).includes('/share.js'));
  // It asks who's there without an error for guests (they can still download).
  const guest = await call('/v1/shares/session');
  assert.equal(guest.status, 200);
  assert.equal(guest.body.user, null);
  const cookie = await signup('eve@example.com');
  assert.equal((await call('/v1/shares/session', { cookie })).body.user.email, 'eve@example.com');
});

// ------------------------------------------------------------------ moments: the link and the card
const sharesMod = await import('../src/shares.ts');

test('a moment from the game: the character, the Overseer\'s line and the sky on the page, and a card with an image', async () => {
  const cookie = await signup('fay@example.com');
  const clip = await call('/v1/assets', { cookie, raw: CLIP, headers: { 'Content-Type': 'video/webm' } });
  const card = await call('/v1/assets', { cookie, raw: POSTER, headers: { 'Content-Type': 'image/jpeg' } });
  const made = await call('/v1/shares', { cookie, body: { asset: clip.body.id, thumb: card.body.id, game: 't/nope', width: 1280, height: 720, seconds: 8, moment: { kind: 'boom', caption: 'Destruction is a kind of freedom too.', who: 'Toasty <3', what: 'A toaster' } } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const s = made.body;
  assert.equal(s.title, 'Toasty 3 · A big explosion', 'no title sent: the name and the moment');
  assert.deepEqual(s.moment, { kind: 'boom', label: 'A big explosion', caption: 'Destruction is a kind of freedom too.', who: 'Toasty 3', what: 'A toaster' });
  assert.match(s.url, /^https:\/\/hawkesgen\.test\/s\/[\w-]{8}$/, 'the link is /s/<id> on the public address');
  const html = (await call(`/s/${s.id}`)).body as string;
  assert.ok(html.includes('class="sh-sky"') && html.includes('class="sh-pearl"'), "the Overseer's sphere in the sky");
  assert.ok(html.includes('class="sh-sea"'), 'the sea');
  assert.ok(html.includes('<b>Toasty 3</b><small>A toaster</small>'), 'the character on a name tag');
  assert.ok(html.includes('“Destruction is a kind of freedom too.”'), "the Overseer's caption under the picture");
  assert.ok(html.includes(`<meta property="og:image" content="https://hawkesgen.test/s/${s.id}/image">`), 'the card has an image');
  assert.ok(html.includes('<meta property="og:image:width" content="1280">') && html.includes('<meta property="og:image:height" content="720">'));
  assert.ok(html.includes('<meta property="og:title" content="Toasty 3 · A big explosion">'));
  assert.ok(html.includes('<meta property="og:description" content="“Destruction is a kind of freedom too.” Toasty 3, a big explosion.'), 'the description tells the moment');
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(html.includes('<meta name="twitter:image" content='), 'X gets the picture too');
  assert.ok(html.includes('og:image:alt" content="Toasty 3 · A big explosion: Destruction is a kind of freedom too."'));
  assert.equal((await call(`/s/${s.id}/image`)).headers.get('content-type'), 'image/jpeg', 'the card picture is served');
});

test('a share with no moment keeps the plain page; a made-up moment kind is dropped; markup is stripped', async () => {
  const cookie = await signup('gus@example.com');
  const png = await call('/v1/assets', { cookie, raw: Buffer.from('\x89PNG fake', 'binary'), headers: { 'Content-Type': 'image/png' } });
  const plain = (await call('/v1/shares', { cookie, body: { asset: png.body.id } })).body;
  assert.ok(!plain.moment, 'no moment');
  let html = (await call(`/s/${plain.id}`)).body as string;
  assert.ok(!html.includes('sh-sky"') && !html.includes('class="sh-caption"'), 'no sky, no caption on an ordinary photo');
  const odd = (await call('/v1/shares', { cookie, body: { asset: png.body.id, moment: { kind: 'win-the-lottery', caption: 'x' } } })).body;
  assert.ok(!odd.moment, 'no moment');
  const dock = (await call('/v1/shares', { cookie, body: { asset: png.body.id, moment: { kind: 'dock', caption: '<script>alert(1)</script>Welcome in.', who: '', what: '' } } })).body;
  assert.equal(dock.title, 'A dock');
  html = (await call(`/s/${dock.id}`)).body as string;
  assert.ok(!html.includes('<script>alert'), 'a caption cannot carry markup');
  assert.equal(sharesMod.cleanMoment({ kind: 'jump', caption: 'a'.repeat(300) })!.caption.length, 140);
  assert.equal(sharesMod.cleanMoment(null), null);
  assert.deepEqual(Object.keys(sharesMod.MOMENTS), ['boom', 'catch', 'jump', 'dock'], 'the same four the game offers (share-math.js MOMENTS)');
});
