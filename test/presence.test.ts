// Presence on the platform (src/presence.ts): a player's look (users.avatar) through GET/POST /v1/users/me/avatar,
// signed badges (/v1/presence/who) and friend requests from inside a game (/v1/friends/request). The game is
// sandboxed, so each route also takes the editor's room token (`t`) instead of the cookie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const fakeGen = http.createServer((req, res) => { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"not in the fake"}'); });
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));
process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-presence-'));
process.env.HAWKESGEN_URL = `http://127.0.0.1:${(fakeGen.address() as any).port}`;
process.env.HAWKESGEN_KEY = 'hg_test';

const { handle } = await import('../src/server.ts');
const portal = http.createServer((req, res) => void handle(req, res));
await new Promise<void>((r) => portal.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(portal.address() as any).port}`;
test.after(() => { portal.close(); fakeGen.close(); });

async function call(route: string, o: { body?: unknown; cookie?: string; raw?: string } = {}) {
  const headers: Record<string, string> = {};
  const has = o.body !== undefined || o.raw !== undefined;
  if (has) headers['Content-Type'] = 'text/plain';
  if (o.cookie) headers.Cookie = o.cookie;
  const r = await fetch(base + route, { method: has ? 'POST' : 'GET', headers, body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, cookie: r.headers.get('set-cookie')?.split(';')[0], cors: r.headers.get('access-control-allow-origin') };
}
const signup = async (email: string, name: string) => {
  const r = await call('/v1/users/signup', { body: { email, password: 'correct horse battery', name } });
  return { cookie: r.cookie!, id: r.body.user.id as string };
};

test('a look is saved per player, validated and size-limited; the game reaches it with its room token', async () => {
  const sam = await signup('sam@example.test', 'Sam');
  const none = await call('/v1/users/me/avatar', { cookie: sam.cookie });
  assert.equal(none.status, 200);
  assert.equal(none.body.avatar, null, 'nobody has a look until they make one');
  assert.equal(none.body.user.id, sam.id);
  assert.ok(none.body.badge, 'and a badge to show the room who they are');
  assert.equal(none.cors, '*', 'open to the sandboxed game');

  const look = { body: '#22C55E', head: '#e0ac69', accent: '#ffffff', shape: 'tall', hat: 'crown', face: 'smile', extras: ['cape', 'cape', 'glasses'], model: null, extra: 'dropped' };
  const saved = await call('/v1/users/me/avatar', { cookie: sam.cookie, body: { avatar: look } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.avatar, { body: '#22c55e', head: '#e0ac69', accent: '#ffffff', shape: 'tall', hat: 'crown', face: 'smile', extras: ['cape', 'glasses'], model: null, what: 'person', name: null, hair: 'short', hairColor: '#4a3322', bottom: '#3b4a6b', shoes: '#f2f2ee', eyeColor: '#14161d', accessory: 'none', accessoryColor: '#ffffff' });
  // The mirror's eyes and accessory: kept (colors lowercased), and refused when they are not ours.
  const dressed = await call('/v1/users/me/avatar', { cookie: sam.cookie, body: { avatar: { ...saved.body.avatar, eyeColor: '#2F6FDB', accessory: 'headphones', accessoryColor: '#EF4444' } } });
  assert.equal(dressed.status, 200);
  assert.deepEqual([dressed.body.avatar.eyeColor, dressed.body.avatar.accessory, dressed.body.avatar.accessoryColor], ['#2f6fdb', 'headphones', '#ef4444']);
  assert.equal((await call('/v1/users/me/avatar', { cookie: sam.cookie })).body.avatar.accessory, 'headphones', 'it stays for the next visit');
  assert.equal((await call('/v1/users/me/avatar', { cookie: sam.cookie, body: { avatar: { ...saved.body.avatar, accessory: 'jetski' } } })).status, 400, 'an accessory we do not have');
  assert.equal((await call('/v1/users/me/avatar', { cookie: sam.cookie, body: { avatar: { ...saved.body.avatar, eyeColor: 'blue' } } })).status, 400, 'eyes are a #color');
  await call('/v1/users/me/avatar', { cookie: sam.cookie, body: { avatar: saved.body.avatar } });
  // What you are (the mirror) and your character's name: kept; a name is cleaned, never refused.
  const shoe = await call('/v1/users/me/avatar', { cookie: sam.cookie, body: { avatar: { ...saved.body.avatar, what: 'shoe', name: '  Sir <b>Laces</b>\n' + 'x'.repeat(40) } } });
  assert.equal(shoe.body.avatar.what, 'shoe');
  assert.ok(shoe.body.avatar.name.startsWith('Sir b Laces') && shoe.body.avatar.name.length <= 24 && !/[<>\n]/.test(shoe.body.avatar.name), shoe.body.avatar.name);
  await call('/v1/users/me/avatar', { cookie: sam.cookie, body: { avatar: saved.body.avatar } });
  assert.equal((await call('/v1/users/me/avatar', { cookie: sam.cookie })).body.avatar.hat, 'crown', 'it stays');

  for (const bad of [{ hat: 'sombrero-of-doom' }, { what: 'unicorn' }, { body: 'red' }, { extras: ['cape', 'wings', 'tail', 'scarf'] }, { model: 'https://evil.example/x.glb' }, ['not', 'an', 'object']]) {
    const r = await call('/v1/users/me/avatar', { cookie: sam.cookie, body: { avatar: bad } });
    assert.equal(r.status, 400, `refused: ${JSON.stringify(bad)} (${r.body.error})`);
  }
  const huge = await call('/v1/users/me/avatar', { cookie: sam.cookie, body: { avatar: { hat: 'cap', note: 'x'.repeat(2000) } } });
  assert.equal(huge.status, 413, 'too big');
  assert.equal((await call('/v1/users/me/avatar', { cookie: sam.cookie })).body.avatar.hat, 'crown', 'a refused look changes nothing');

  // From inside the game: the editor's bundle carries a signed room token instead of the cookie.
  const g = (await call('/v1/games', { cookie: sam.cookie, body: { title: 'Hangout', template: 'blank' } })).body;
  const bundle = (await call(`/v1/games/${g.id}/bundle`, { cookie: sam.cookie })).body;
  const t = bundle.net.token;
  const viaToken = await call(`/v1/users/me/avatar?t=${encodeURIComponent(t)}`);
  assert.equal(viaToken.status, 200);
  assert.equal(viaToken.body.avatar.hat, 'crown');
  const set = await call('/v1/users/me/avatar', { body: { t, avatar: { ...saved.body.avatar, hat: 'tophat' } } });
  assert.equal(set.body.avatar.hat, 'tophat');
  assert.equal((await call('/v1/users/me/avatar', { body: { t: 'forged.token', avatar: { hat: 'cap' } } })).status, 401, 'a made-up token is nobody');
  assert.equal((await call('/v1/users/me/avatar')).status, 401, 'guests keep their look on their own device');
  assert.equal((await call('/v1/users/me/avatar', { raw: 'not json' })).status, 400);
});

test('badges say who is in the room (and who is a friend); friend requests become friends when both ask', async () => {
  const ana = await signup('ana@example.test', 'Ana');
  const ben = await signup('ben@example.test', 'Ben');
  const aBadge = (await call('/v1/users/me/avatar', { cookie: ana.cookie })).body.badge;
  const bBadge = (await call('/v1/users/me/avatar', { cookie: ben.cookie })).body.badge;
  const who = await call('/v1/presence/who', { cookie: ana.cookie, body: { badges: [bBadge, 'nonsense', aBadge] } });
  assert.equal(who.status, 200);
  assert.deepEqual(who.body.who.map((w: any) => [w.i, w.name, w.friend]), [[0, 'Ben', false], [2, 'Ana', false]], 'only badges the server signed');
  assert.equal((await call('/v1/presence/who', { body: { badges: [bBadge] } })).body.who[0].user, ben.id, 'guests can see who people are too');

  const ask = await call('/v1/friends/request', { cookie: ana.cookie, body: { to: ben.id } });
  assert.deepEqual(ask.body, { status: 'requested' });
  assert.equal((await call('/v1/friends', { cookie: ana.cookie })).body.friends.length, 0, 'not friends until Ben asks too');
  const back = await call('/v1/friends/request', { cookie: ben.cookie, body: { to: ana.id } });
  assert.deepEqual(back.body, { status: 'friends' });
  assert.deepEqual((await call('/v1/friends', { cookie: ana.cookie })).body.friends.map((f: any) => f.name), ['Ben']);
  assert.equal((await call('/v1/presence/who', { cookie: ana.cookie, body: { badges: [bBadge] } })).body.who[0].friend, true, 'now marked as a friend');
  assert.equal((await call('/v1/users/me/avatar', { cookie: ana.cookie })).body.friends[0], ben.id);

  assert.equal((await call('/v1/friends/request', { cookie: ana.cookie, body: { to: ana.id } })).status, 400, "can't befriend yourself");
  assert.equal((await call('/v1/friends/request', { cookie: ana.cookie, body: { to: 'nobody' } })).status, 400);
  assert.equal((await call('/v1/friends/request', { body: { to: ben.id } })).status, 401, 'guests sign in first');
});

test('what the Overseer remembers is kept per account, cleaned and size-limited', async () => {
  const kim = await signup('kim@example.test', 'Kim');
  const none = await call('/v1/users/me/overseer', { cookie: kim.cookie });
  assert.equal(none.body.overseer, null, 'nothing on record until the game writes some');
  const rec = { visits: 3, firstAt: 1000, lastAt: 5000, name: '  Sir <b>Laces</b> ', what: 'shoe', last: { id: 'fish', at: 4000, visit: 3 }, n: { fish: 2, boom: 1, evil: 9 }, fish: { tuna: [2, 9000, 180], 'Bad Id': [1, 1, 1] }, fishPts: 50, driveS: 12, playS: 300, greet: { last: 'fish-a', recent: ['fish-a', 'Bad Id!'] }, secret: 'x' };
  const saved = await call('/v1/users/me/overseer', { cookie: kim.cookie, body: { overseer: rec } });
  assert.equal(saved.status, 200);
  const m = saved.body.overseer;
  assert.equal(m.visits, 3); assert.equal(m.what, 'shoe'); assert.equal(m.name, 'Sir b Laces /b');
  assert.deepEqual(m.last, { id: 'fish', at: 4000, visit: 3 });
  assert.deepEqual(m.fish, { tuna: [2, 9000, 180] }); assert.equal(m.fishPts, 50, 'the catch log is kept');
  assert.equal(m.n.fish, 2); assert.equal(m.n.evil, undefined); assert.equal(m.secret, undefined);
  assert.deepEqual(m.greet, { last: 'fish-a', recent: ['fish-a'] });
  assert.deepEqual((await call('/v1/users/me/overseer', { cookie: kim.cookie })).body.overseer, m, 'it stays');
  // The daily wish (modules/wish): the day of the last wish, its streak, today's progress; nothing else gets in.
  const w = await call('/v1/users/me/overseer', { cookie: kim.cookie, body: { overseer: { ...rec, wish: { last: '2026-10-24', st: 3, best: 5, day: '2026-10-25', n: 2, set: ['trout', 'Bad Id'], said: 1, secret: 1 } } } });
  assert.deepEqual(w.body.overseer.wish, { last: '2026-10-24', st: 3, best: 5, day: '2026-10-25', n: 2, set: ['trout'], said: 1 });
  assert.deepEqual((await call('/v1/users/me/overseer', { cookie: kim.cookie, body: { overseer: { ...rec, wish: { last: 'yesterday', st: 9, day: '2026-13-45' } } } })).body.overseer.wish, { last: null, st: 0, best: 0, day: null, n: 0, set: [], said: 0 }, 'a bad date is no date, and no date means no streak');
  assert.equal((await call('/v1/users/me/overseer', { body: { overseer: rec } })).status, 401, 'no account, no memory here (the device keeps it)');
  assert.equal((await call('/v1/users/me/overseer', { cookie: kim.cookie, body: { overseer: { ...rec, name: 'x'.repeat(5000) } } })).status, 413);
  assert.equal((await call('/v1/users/me/overseer', { cookie: kim.cookie, body: { overseer: { last: { id: 'spy' }, what: 'hacker' } } })).body.overseer.last, null, 'only in-game deeds');
  // Someone else's is theirs.
  const lee = await signup('lee@example.test', 'Lee');
  assert.equal((await call('/v1/users/me/overseer', { cookie: lee.cookie })).body.overseer, null);
});
