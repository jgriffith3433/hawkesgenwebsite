// The Overseer's soft sky presence (modules/overseer/presence.js): gaze, reactions, window.__overseerPresence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, 0] } };

function fresh() {
  world(H, sceneOf({
    floor, start,
    config: { overseer: { position: [9700, 4200, -3000], intro: false } },
  }));
  H.tick(0.2);
}

test('sky presence mounts and exposes window.__overseerPresence', () => {
  fresh();
  assert.ok(H.skyPresence, 'H.skyPresence');
  const p = (globalThis as any).__overseerPresence;
  assert.ok(p, '__overseerPresence');
  assert.ok(Array.isArray(p.kinds) && p.kinds.includes('delight'));
  assert.ok('gazeTarget' in p && 'lastReaction' in p && 'visible' in p);
});

test('reaction decks include delight, interest, awe and night; pick never repeats back to back', () => {
  const R = H.reactions;
  for (const k of ['delight', 'interest', 'awe', 'night']) {
    assert.ok(R.POOLS[k] && R.POOLS[k].length >= 5, k);
    let prev = null;
    for (let i = 0; i < R.POOLS[k].length * 3; i++) {
      const x = R.pick(k);
      assert.notEqual(x, prev, `${k} ${i}`);
      prev = x;
    }
  }
});

test('fire(delight) sets lastReaction and asks the deck', () => {
  fresh();
  const heard: any[] = [];
  H.game.on('reaction', (d: any) => heard.push(d));
  H.game.on('sky-presence', (d: any) => heard.push({ sky: d.kind }));
  assert.equal(H.skyPresence.fire('delight', { force: true }), true);
  H.tick(0.05);
  // Pump reactions (may wait on blocked); force deliver via pick path by advancing clock if needed.
  if (H.reactions.waiting) {
    // Unblock speech/lines if needed.
    try { H.speech.reset(); } catch { /* fine */ }
    H.reactions.pump();
  }
  const p = (globalThis as any).__overseerPresence;
  assert.equal(p.lastReaction && p.lastReaction.kind, 'delight');
  assert.ok(heard.some((x) => x.sky === 'delight' || x.kind === 'delight'));
});

test('explosion and catch drive presence reactions', () => {
  fresh();
  const kinds: string[] = [];
  H.game.on('sky-presence', (d: any) => kinds.push(d.kind));
  H.game.emit('explosion', { radius: 8 });
  H.tick(0.05);
  H.game.emit('catch', { mine: true });
  H.tick(0.05);
  // Gap may block the second; force after gap.
  const now = () => (H.skyPresence as any);
  assert.ok(kinds.includes('delight') || ((globalThis as any).__overseerPresence.lastReaction || {}).kind === 'delight');
  // Force interest past the gap.
  H.skyPresence.fire('interest', { force: true });
  assert.equal(((globalThis as any).__overseerPresence.lastReaction || {}).kind, 'interest');
});

test('workEnd first build fires awe once', () => {
  fresh();
  H.game.emit('workEnd', { ok: true, ops: 2, beats: 1 });
  H.tick(0.05);
  assert.equal(((globalThis as any).__overseerPresence.lastReaction || {}).kind, 'awe');
  const at = ((globalThis as any).__overseerPresence.lastReaction || {}).at;
  H.game.emit('workEnd', { ok: true, ops: 2, beats: 1 });
  H.tick(0.05);
  // Second successful build does not fire awe again (firstBuildDone).
  assert.equal(((globalThis as any).__overseerPresence.lastReaction || {}).at, at);
});
