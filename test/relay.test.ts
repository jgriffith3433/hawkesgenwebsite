// The room relay (src/relay.ts) on its own: who may say where things are, held things, what joiners get, and interest
// (near things at their full rate, far ones less often, important ones first, within a byte budget per player).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as relay from '../src/relay.ts';

function setup(n: number, v = 2) {
  const room = relay.newRoom('play:x:test', 'g');
  const got: any[][] = [];
  const conns = Array.from({ length: n }, (_, i) => {
    got[i] = [];
    const c = relay.newConn({ id: `c${i}`, name: `P${i}`, color: '#fff', user: null, v, now: i, send: (t) => got[i].push(JSON.parse(t)) });
    relay.join(room, c, i);
    return c;
  });
  return { room, conns, got };
}
const flat = (msgs: any[]) => msgs.flatMap((m) => (m.t === 'b' ? m.m : [m]));
const entries = (msgs: any[], id: string) => flat(msgs).filter((m) => m.t === 'xf').flatMap((m) => m.x).filter((x: any) => x[0] === id);
const send = (room: relay.Room, c: relay.Conn, m: any, now: number) => relay.receive(room, c, JSON.stringify(m), now);

test('only the one simulating a thing says where it is; held things stay with whoever holds them', () => {
  const { room, conns: [a, b, c], got } = setup(3);
  assert.equal(room.host, 'c0');
  send(room, b, { t: 'xf', at: 10, x: [['crate', 7, 1, 2, 3]] }, 10); // B doesn't own it: ignored
  relay.flush(room, 40);
  assert.equal(entries(got[2], 'crate').length, 0);
  send(room, a, { t: 'xf', at: 50, x: [['crate', 7, 1, 2, 3]] }, 50); // the host does
  relay.flush(room, 80);
  assert.deepEqual(entries(got[2], 'crate')[0], ['crate', 7, 1, 2, 3]);
  // B drives the car: held. C bumping into it can't take it, and is told who has it.
  send(room, b, { t: 'own', id: 'car', on: true, lock: 1 }, 100);
  send(room, c, { t: 'own', id: 'car', on: true }, 110);
  relay.flush(room, 120);
  assert.equal(room.owners.get('car'), 'c1');
  const toC = flat(got[2]).filter((m) => m.t === 'own' && m.id === 'car');
  assert.deepEqual(toC.map((m) => m.c), ['c1', 'c1'], 'C hears B took it, and that it stays B\'s');
  // B leaves: what B held is free, and the host simulates it.
  relay.leave(room, b);
  assert.equal(room.owners.has('car'), false);
  assert.equal(room.locks.has('car'), false);
});

test('a joiner gets the world as it is: the newest pose of moving things and every synced state', () => {
  const { room, conns: [a], got } = setup(1);
  send(room, a, { t: 'b', m: [
    { t: 'xf', at: 5, x: [['ball', 0b111, 4, 5, 6]] },
    { t: 'xf', at: 9, x: [['ball', 0b1, 7]] },
    { t: 'ev', name: '_s', data: { n: 'score', d: { red: 1, blue: 2 }, f: 1, at: 9 } },
    { t: 'ev', name: '_s', data: { n: 'score', d: { blue: 3 }, f: 0, at: 12 } },
  ] }, 12);
  const late = relay.newConn({ id: 'c9', name: 'Late', color: '#fff', user: null, v: 2, now: 20, send: (t) => got.push([JSON.parse(t)] as any) });
  const mine: any[] = [];
  late.send = (t) => mine.push(JSON.parse(t));
  relay.join(room, late, 20);
  relay.flush(room, 40);
  const ball = entries(mine, 'ball');
  assert.deepEqual(ball[0].slice(2), [7, 5, 6], 'the newest pose, all of it');
  const score = flat(mine).find((m) => m.t === 'ev' && m.name === '_s' && m.data.n === 'score');
  assert.deepEqual(score.data.d, { red: 1, blue: 3 });
  assert.equal(score.data.f, 1);
  assert.equal(mine[0].t, 'hello');
});

test('interest: near things at their full rate, far ones a few times a second, very far ones every few seconds', () => {
  const { room, conns: [host, near, far] } = setup(3);
  const counts = { near: { n: 0, f: 0, imp: 0 }, far: { n: 0, f: 0, imp: 0 } };
  near.send = (t) => { for (const x of entries([JSON.parse(t)], 'nearBall')) counts.near.n++; for (const x of entries([JSON.parse(t)], 'farBall')) counts.near.f++; };
  far.send = (t) => { const m = [JSON.parse(t)]; counts.far.n += entries(m, 'nearBall').length; counts.far.f += entries(m, 'farBall').length; counts.far.imp += entries(m, 'farCar').length; };
  send(room, near, { t: 'me', s: { p: [0, 0, 0] } }, 1);
  send(room, far, { t: 'me', s: { p: [1000, 0, 0] } }, 1);
  // 3 seconds of the host moving a ball by the near player, one by the far player, and a car (important) by the near one.
  for (let t = 0; t < 3000; t += 33) {
    if (t % 99 === 0) {
      const k = t / 1000;
      send(room, host, { t: 'xf', at: t, x: [['nearBall', 0b111000111, k, 1, 0, 1, 0, 0], ['farBall', 0b111000111, 1000 + k, 1, 0, 1, 0, 0], ['farCar', 0b111000111 | (1 << 12), k, 1, 2, 1, 0, 0]] }, t);
    }
    relay.flush(room, t);
  }
  assert.ok(counts.near.n >= 28, `the near player gets the ball near them every time (${counts.near.n} of 31)`);
  assert.ok(counts.far.n <= 2, `the player 1 km away gets it every few seconds (${counts.far.n})`);
  assert.ok(counts.near.f <= 2 && counts.far.f >= 28, 'and the other way round');
  assert.ok(counts.far.imp > counts.far.n, `important things far away come more often than others (${counts.far.imp} vs ${counts.far.n})`);
  assert.ok(far.stats.skipped > 0);
});

test('a byte budget per player: when too much moves at once, the most important goes first and nothing is lost', () => {
  const { room, conns: [host, watcher] } = setup(2);
  let bytes = 0;
  const last = new Map<string, number>();
  watcher.send = (t) => { bytes += t.length; for (const m of flat([JSON.parse(t)])) if (m.t === 'xf') for (const x of m.x) last.set(x[0], x[2]); };
  send(room, watcher, { t: 'me', s: { p: [0, 0, 0] } }, 1);
  // 3000 things all moving 10 times a second (far more than a budget's worth), and one important car.
  for (let t = 0; t < 3000; t += 33) {
    if (t % 99 === 0) {
      const x: any[] = [['car', 0b111000111 | (1 << 12), t / 100, 0, 0, 1, 0, 0]];
      for (let i = 0; i < 3000; i++) x.push([`b${i}`, 0b111000111, i % 40 + t / 1000, 0, Math.floor(i / 40), 1, 0, 0]);
      for (let i = 0; i < x.length; i += 500) send(room, host, { t: 'xf', at: t, x: x.slice(i, i + 500) }, t);
    }
    relay.flush(room, t);
  }
  const perSecond = bytes / 3;
  assert.ok(perSecond < relay.LIMITS.budget * 1.6, `about the budget (${Math.round(perSecond / 1024)} KB/s; budget ${relay.LIMITS.budget / 1024})`);
  assert.ok(Math.abs((last.get('car') ?? 0) - 29.7) < 0.5, `the car is always current (${last.get('car')})`);
  // Let it catch up: every thing ends at its newest place (latest wins; nothing is lost).
  for (let t = 3000; t < 9000; t += 33) relay.flush(room, t);
  const behind = [...Array(3000).keys()].filter((i) => Math.abs((last.get(`b${i}`) ?? -1) - (i % 40 + 2.97)) > 1e-6).length;
  assert.equal(behind, 0, 'every thing caught up to its newest place');
});

test('protocol 1 pages still get every message as it comes', () => {
  const room = relay.newRoom('play:x:old', 'g');
  const got: any[] = [];
  const a = relay.newConn({ id: 'a', name: 'A', color: '#fff', user: null, v: 2, now: 0, send: () => {} });
  const old = relay.newConn({ id: 'o', name: 'O', color: '#fff', user: null, v: 1, now: 1, send: (t) => got.push(JSON.parse(t)) });
  relay.join(room, a, 0); relay.join(room, old, 1);
  send(room, a, { t: 'xf', at: 3, x: [['ball', 1, 4]] }, 3);
  send(room, a, { t: 'ev', name: 'hello', data: 1 }, 3);
  assert.deepEqual(got.slice(1).map((m) => m.t), ['xf', 'ev'], 'at once, no bundles');
});

test('the host can tell the room to forget its poses (a reset or rewind); nobody else can', () => {
  const { room, conns: [a, b] } = setup(2);
  send(room, a, { t: 'xf', at: 1, x: [['ball', 1, 4]] }, 1);
  send(room, b, { t: 'clear' }, 2);
  assert.equal(room.ents.size, 1);
  send(room, a, { t: 'clear' }, 3);
  assert.equal(room.ents.size, 0);
});

test('message limits: 90 bundles a second', () => {
  const { room, conns: [a, b], got } = setup(2);
  for (let i = 0; i < 200; i++) send(room, a, { t: 'ev', name: 'x', data: i }, 500);
  relay.flush(room, 520);
  assert.equal(flat(got[1]).filter((m) => m.t === 'ev').length, relay.LIMITS.perSecond);
});
