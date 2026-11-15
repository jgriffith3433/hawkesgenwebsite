// The Overseer's reactions (public/play/modules/overseer/reactions.js): varied, in character, never the same twice in a row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const R = H.reactions;
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };
let t = 0;
const heard: any[] = [];
function fresh() {
  t = 100;
  R.clock = () => t; H.lines.clock = () => t; H.speech.clock = () => t;
  H.speech.reset(); R.reset(); R.rand = Math.random;
  heard.length = 0;
  world(H, sceneOf({ floor, start }));
  H.tick(0.2);
  H.game.on('reaction', (d: any) => heard.push(d));
  t += 10;
}

test('at least ten variants for build, fail and idle, and a changing thinking line; calm, no exclamations', () => {
  for (const k of ['build', 'fail', 'idle']) {
    assert.ok(R.POOLS[k].length >= 10, k);
    assert.equal(new Set(R.POOLS[k]).size, R.POOLS[k].length, `${k}: no duplicates`);
    for (const x of R.POOLS[k]) assert.ok(x.length > 12 && x.length < 100 && !/[!]/.test(x) && !/error|loading|request|credit|system|AI\b/i.test(x), x);
  }
  assert.ok(R.POOLS.think.length >= 8);
});

test('never the same line twice in a row, across decks, and every line is used before one repeats', () => {
  fresh();
  for (const k of ['build', 'fail', 'idle', 'think']) {
    const n = R.POOLS[k].length;
    let prev = null;
    const seen = new Set();
    for (let i = 0; i < n * 6; i++) {
      const x = R.pick(k);
      assert.notEqual(x, prev, `${k} ${i}`);
      if (i < n) seen.add(x);
      prev = x;
    }
    assert.equal(seen.size, n, `${k}: the first deck uses every line`);
  }
  R.rand = () => 0; // the worst shuffle
  for (let i = 0; i < 60; i++) { const a = R.pick('build'); const b = R.pick('build'); assert.notEqual(a, b); }
});

test('a finished request is a build reaction, a failed one a fail reaction, each different from the last', () => {
  fresh();
  const texts: string[] = [];
  for (let i = 0; i < 6; i++) {
    H.game.emit('workEnd', { ok: true, ops: 3, beats: 2 }); t += 1; H.tick(0.05);
    t += 30; H.tick(0.05);
    H.game.emit('workEnd', { ok: false, ops: 0, beats: 0 }); t += 1; H.tick(0.05);
    t += 30; H.tick(0.05);
  }
  const b = heard.filter((x) => x.kind === 'build'), f = heard.filter((x) => x.kind === 'fail');
  assert.equal(b.length, 6); assert.equal(f.length, 6);
  for (const list of [b, f]) for (let i = 1; i < list.length; i++) assert.notEqual(list[i].text, list[i - 1].text);
  assert.ok(b.every((x) => R.POOLS.build.includes(x.text)) && f.every((x) => R.POOLS.fail.includes(x.text)));
  texts.push(...heard.map((x) => x.text));
});

test('an idle line after a quiet while, not while the player is busy, and not again at once', () => {
  fresh();
  t += R.IDLE_AFTER - 20; H.tick(0.05);
  H.game.emit('spawned', {}); // busy: the quiet starts over
  t += R.IDLE_AFTER - 5; H.tick(0.05);
  assert.equal(heard.filter((x) => x.kind === 'idle').length, 0);
  t += 10; H.tick(0.05);
  assert.equal(heard.filter((x) => x.kind === 'idle').length, 1);
  t += 30; H.tick(0.05);
  assert.equal(heard.filter((x) => x.kind === 'idle').length, 1, 'not again at once');
  t += R.IDLE_GAP + R.IDLE_AFTER; H.tick(0.05);
  const idle = heard.filter((x) => x.kind === 'idle');
  assert.equal(idle.length, 2);
  assert.notEqual(idle[0].text, idle[1].text);
});

test('while it works the pill\'s headline is a thinking line that changes', () => {
  fresh();
  const real = performance.now.bind(performance);
  let off = 0;
  performance.now = () => real() + off; // the pill counts real seconds
  H.work.begin({ text: 'a tower' });
  const heads = new Set<string>();
  for (let i = 0; i < 30; i++) { off += 1000; H.tick(0.1); const st = H.work.state(); if (st && st.headline) heads.add(st.headline); }
  assert.ok(heads.size >= 3, [...heads].join(' | '));
  assert.ok([...heads].every((x) => /…$/.test(String(x))), [...heads].join(" | "));
  H.work.end({ ok: true });
  performance.now = real;
});
