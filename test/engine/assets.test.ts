// Assets by id, with words as labels (public/play/assets.js, H.assets): the order a word finds them in, a seeded pick
// that stays the same, a herd mixing three cow models, specs keeping the id they got, names for old games, and a
// change of config.assets reaching the herd at once. Runs the real engine in Node (harness.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', shape: { size: [80, 1, 80] }, transform: { position: [0, -0.5, 0] } };
const glb = (id: string, words: string[], title?: string) => ({ url: `data:model/gltf-binary;base64,`, mime: 'model/gltf-binary', id, type: 'model', title: title ?? null, words });
const COWS = {
  'cow.glb': glb('a_1', ['cow', 'spotted cow', 'spotted'], 'Spotted cow'),
  'cow-2.glb': glb('a_2', ['cow', 'brown cow', 'brown'], 'Brown cow'),
  'highland.glb': glb('a_3', ['highland cow', 'highland', 'cow'], 'Highland cow'),
  'moo.mp3': { url: 'data:audio/mpeg;base64,', mime: 'audio/mpeg', id: 'a_9', type: 'sound', words: ['moo', 'cow'] },
  'pig.glb': { url: 'data:model/gltf-binary;base64,', mime: 'model/gltf-binary' }, // an old game's asset: a name only
};
function farm(config: Record<string, any> = {}, entities: Record<string, any> = {}) {
  world(H, sceneOf({ floor, ...entities }, config));
  H.setAssets(COWS);
}

test('H.assets.for: the world\'s choice first, then labelled assets, then names; of the kind asked', () => {
  farm({ assets: { cow: { ids: ['a_3', 'a_1'] } } });
  assert.deepEqual(H.assets.for('cow', { kind: 'model' }), ['a_3', 'a_1', 'a_2'], 'config order, then the other labelled one');
  assert.deepEqual(H.assets.for('cows', { kind: 'model' }), ['a_3', 'a_1', 'a_2'], 'plurals');
  assert.deepEqual(H.assets.for('cow', { kind: 'sound' }), ['a_9']);
  assert.deepEqual(H.assets.for('spotted cow'), ['a_1']);
  assert.deepEqual(H.assets.for('pig'), ['pig.glb'], 'a name (no id, no words) for old games');
  assert.deepEqual(H.assets.for('calf', { kind: 'model' }), ['a_3', 'a_1', 'a_2'], 'another word for it (Living things: calf -> cow)');
  assert.equal(H.assets.get('a_2').name, 'cow-2.glb');
  assert.equal(H.assets.url('cow-2.glb'), H.assets.url('a_2'));
  assert.ok(H.lib.hasAsset('a_2') && H.lib.assetUrl('a_2') === H.assets.url('a_2'), 'everything that loads assets takes an id');
  assert.equal(H.assets.pick('cow', { kind: 'model', seed: 'x' }), 'a_3', 'no mix: the default (the first)');
  assert.equal(H.game.assets, H.assets, 'game.assets for scripts');
});

test('a seeded pick stays the same; a herd of 30 mixes three cows; a reload gets the same cows', () => {
  const herd = { cows: { type: 'herd', shape: { species: 'cow', count: 30 }, transform: { position: [0, 0, 10] } } };
  farm({ assets: { cow: { ids: ['a_1', 'a_2', 'a_3'], mix: true } } }, herd);
  const a = H.assets.pick('cow', { kind: 'model', seed: 'cows:4' });
  for (let i = 0; i < 5; i++) assert.equal(H.assets.pick('cow', { kind: 'model', seed: 'cows:4' }), a);
  // (The herd was built before the assets arrived here: a config change or a replace rebuilds it with them.)
  H.applyOps([{ op: 'replace', entity: H.world.graph.entities.cows }]);
  const models = () => H.game.entity('cows').members.map((m: any) => m.living.rig.modelRef);
  const first = models();
  const counts = first.reduce((c: any, id: string) => ((c[id] = (c[id] || 0) + 1), c), {});
  assert.equal(Object.keys(counts).length, 3, `spread over three: ${JSON.stringify(counts)}`);
  assert.ok(Object.values(counts).every((n: any) => n >= 4), `fairly evenly: ${JSON.stringify(counts)}`);
  H.applyOps([{ op: 'replace', entity: H.world.graph.entities.cows }]);
  assert.deepEqual(models(), first, 'rebuilt (a reload): the same cow in the same place');
  // "Use only the brown cow": a config change reaches the herd at once.
  H.applyOps([{ op: 'config', patch: { assets: { cow: { ids: ['a_2'], mix: false } } } }]);
  assert.ok(models().every((id: string) => id === 'a_2'), `all brown now: ${models().join(' ')}`);
});

test('things spawned by word keep the id they got in their spec; a model named in a spec can be an id', () => {
  farm({ assets: { cow: { ids: ['a_1', 'a_2'], mix: true } } });
  const cows = H.game.spawnMany('cow', 6, { at: [0, 0, 0], area: 6 });
  assert.ok(cows.every((c: any) => ['a_1', 'a_2'].includes(c.spec.shape.model)), cows.map((c: any) => c.spec.shape.model).join(' '));
  const one = H.fromSpec({ id: 'daisy', type: 'creature', shape: { species: 'cow', model: 'a_3' }, transform: { position: [5, 1, 5] } });
  assert.equal(one.living.rig.modelRef, 'a_3');
  const box = H.game.model('a_2', { x: 3, z: 3 });
  assert.ok(box && box.alive, 'a model by id');
});
