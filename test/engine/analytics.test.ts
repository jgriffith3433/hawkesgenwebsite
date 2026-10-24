// play/analytics.js: the game tells Gen's player analytics what players do, once per kind a session, without any
// module sending its own events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', name: 'Ground', shape: { size: [60, 1, 60] }, transform: { position: [0, -0.5, 0] }, physics: 'static' };
const sent: { name: string; props: any }[] = [];
const ctx: Record<string, unknown> = {};
(globalThis as any).hawkesAnalytics = {
  track: (name: string, props: any) => sent.push({ name, props }),
  setContext: (patch: Record<string, unknown>) => Object.assign(ctx, patch),
};

test('ready once, the first fun once, each feature once a session, with the play context', () => {
  world(H, sceneOf({ floor }), { mode: 'play' });
  assert.equal(sent.filter((e) => e.name === 'game_ready').length, 1);
  assert.equal(ctx.mode, 'play');
  H.game.emit('explosion', { at: [0, 0, 0], radius: 4 });
  H.game.emit('explosion', { at: [0, 0, 0], radius: 4 });
  H.game.emit('spawn', { count: 10 });
  const features = sent.filter((e) => e.name === 'feature').map((e) => e.props.name);
  assert.deepEqual(features, ['explode', 'spawn_many']);
  const first = sent.filter((e) => e.name === 'first_fun');
  assert.equal(first.length, 1);
  assert.equal(first[0].props.what, 'explode');
  // A reload is the same session: still one ready, and an explosion isn't news again.
  world(H, sceneOf({ floor }), { mode: 'play' });
  H.game.emit('explosion', { at: [0, 0, 0], radius: 4 });
  assert.equal(sent.filter((e) => e.name === 'game_ready').length, 1);
  assert.equal(sent.filter((e) => e.name === 'feature' && e.props.name === 'explode').length, 1);
});

test('the codex sends nothing', () => {
  const before = sent.length;
  H.hooks.codex = true;
  try { H.track('feature', { name: 'x' }); } finally { H.hooks.codex = false; }
  assert.equal(sent.length, before);
});
