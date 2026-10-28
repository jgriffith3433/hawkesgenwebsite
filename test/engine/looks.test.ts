// Looks (modules/looks): where a thing's look lives and the ops that change it (looks-core.js), and in the real engine
// the chooser: only where looks can be chosen (building in the editor, or the player's island), a look shown on the
// thing at once and taken back on Cancel, kept on Keep (the island saves it), a plain shape becoming a model thing, and a
// new look from Hawkes Gen put on its thing when it's made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const C = H.looksCore;
const floor = { type: 'box', shape: { size: [200, 1, 200] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-10, 0, 0] } };
const panel = () => (globalThis as any).document.body.children.find((c: any) => c.className === 'lk') || null;

test('core: where the look lives, the ops, the words to search with', () => {
  const truck = { id: 'blue_truck', type: 'truck', name: 'Blue truck', shape: {} };
  assert.equal(C.field(truck, H.kinds.get('truck')), 'model');
  assert.equal(C.field({ id: 'm', type: 'model', shape: { asset: 'a_1' } }, H.kinds.get('model')), 'asset');
  assert.equal(C.field({ id: 'b', type: 'box' }, H.kinds.get('box')), null);
  assert.equal(C.field({ id: 'c', type: 'creature', shape: { species: 'cow' } }, H.kinds.get('creature')), 'model');
  assert.deepEqual(C.ops(truck, 'model', 'a_teapot'), [{ op: 'update', id: 'blue_truck', patch: { shape: { model: 'a_teapot' } } }]);
  assert.deepEqual(C.ops(truck, 'model', null), [{ op: 'update', id: 'blue_truck', patch: { shape: { model: null } } }], 'back to its own shape');
  const box = { id: 'crate', type: 'box', name: 'Crate', shape: { size: [1, 1, 1] }, material: { color: '#f00' }, physics: 'dynamic', transform: { position: [1, 2, 3] } };
  const [rep] = C.ops(box, null, 'a_barrel', { size: 1.2 });
  assert.equal(rep.op, 'replace');
  assert.deepEqual(rep.entity, { id: 'crate', type: 'model', name: 'Crate', physics: 'dynamic', transform: { position: [1, 2, 3] }, shape: { asset: 'a_barrel', size: 1.2 } }, 'a model thing where it was, moving as it did');
  assert.equal(C.words(truck), 'truck');
  assert.equal(C.words({ type: 'creature', name: 'Spotted cow', shape: { species: 'cow' } }), 'cow spotted');
  assert.equal(C.words({ type: 'box', name: 'Big red crate' }), 'crate');
});

test('the chooser opens only where looks can be chosen: not in a game being played', () => {
  world(H, sceneOf({ floor, start, blue_truck: { type: 'truck', name: 'Blue truck', transform: { position: [0, 1.2, 6] } } }));
  H.tick(0.3);
  delete (window as any).HawkesGuest;
  assert.equal(H.looks.allowed(), false);
  assert.equal(H.looks.open('blue_truck'), false);
  assert.equal(H.looks.offer({ id: 'blue_truck' }), false, "the Overseer's offer is ignored there");
  assert.equal(panel(), null);
});

test('on the island: a look shows at once, Cancel takes it back, Keep saves it, the camera and controls come back', async () => {
  world(H, sceneOf({ floor, start, blue_truck: { type: 'truck', name: 'Blue truck', material: { color: '#1f5fd6' }, transform: { position: [0, 1.2, 6] } } }));
  H.tick(0.3);
  const saved: any[] = [];
  (window as any).HawkesGuest = { looks: { save: async (ops: any[]) => { saved.push(...ops); H.applyOps(ops, { local: true }); }, useLibrary: async () => ({ ok: true }), generate: async () => ({ ok: true, row: { task_id: 't_1' } }) } };
  const p = H.world.player;
  assert.ok(H.looks.open('blue_truck'));
  assert.ok(panel(), 'the panel');
  assert.equal(p.controls, false, 'the player waits');
  for (let t = 0; t < 1; t += 0.1) H.tick(0.1);
  // A look (one of the game's: no library here), shown at once, here only.
  H.looks._.preview('a_teapot');
  assert.equal(H.world.graph.entities.blue_truck.shape.model, 'a_teapot');
  assert.equal(H.world.byId.get('blue_truck').vehicle !== undefined, true, 'still a truck');
  H.looks.close();
  assert.equal((H.world.graph.entities.blue_truck.shape || {}).model, undefined, 'Cancel: back to how it was');
  assert.equal(saved.length, 0, 'nothing saved');
  assert.equal(p.controls, true);
  // Again, and keep it.
  H.looks.open('blue_truck');
  H.looks._.preview('a_teapot');
  await H.looks._.keepChoice();
  assert.deepEqual(saved, [{ op: 'update', id: 'blue_truck', patch: { shape: { model: 'a_teapot' } } }]);
  assert.equal(H.looks.isOpen, false);
  assert.equal(panel(), null);
});

test('a new look from Hawkes Gen goes on its thing when it is made', async () => {
  world(H, sceneOf({ floor, start, crate: { type: 'box', name: 'Crate', shape: { size: [1, 1, 1] }, transform: { position: [0, 0.5, 6] } } }));
  H.tick(0.3);
  const saved: any[] = [];
  (window as any).HawkesGuest = { looks: { save: async (ops: any[]) => { saved.push(...ops); }, useLibrary: async () => ({ ok: true }), generate: async (prompt: string) => ({ ok: true, row: { task_id: `t_${prompt.length}` } }) } };
  H.looks.open('crate');
  await H.looks._.makeNew('a mossy wooden barrel');
  assert.equal(H.looks.isOpen, false, 'it closes while the look is made');
  assert.equal(H.looks._.pending.size, 1);
  H.setAssets({ 'barrel.glb': { url: 'data:model/gltf-binary;base64,', mime: 'model/gltf-binary', id: 'a_barrel1', type: 'model', words: ['barrel'] } });
  await H.looks.onGen({ task_id: 't_21', state: 'done', asset_name: 'barrel.glb' });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].op, 'replace', 'a plain box becomes a model thing');
  assert.deepEqual(saved[0].entity.shape, { asset: 'a_barrel1', size: 1 });
  delete (window as any).HawkesGuest;
});
