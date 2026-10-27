// A vehicle wearing a model: its built-in body (the stand-in) never flashes when the model is already at hand (a rebuild),
// and when the model takes a while, the stand-in turns into it over 1.5 s instead of switching in one frame. A model that
// fails leaves the built-in body as the vehicle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const B = (globalThis as any).BABYLON;
const glb = 'Z2xURg';
const floor = { type: 'box', shape: { size: [200, 1, 200] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-20, 0, 0] } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const v = (id: string) => H.game.entity(id).vehicle;
const standShown = (veh: any) => veh.parts.some((m: any) => !m.isDisposed() && m.isEnabled(false) && m.visibility > 0.01 && !veh.lampMeshes.includes(m));

function setup() {
  world(H, sceneOf({ floor, start }));
  H.setAssets({ 'heli.glb': { url: `data:model/gltf-binary;base64,${glb}`, mime: 'model/gltf-binary', id: 'a_heli', type: 'model', words: ['helicopter'] } });
  H.tick(0.2);
}
/** The model loader (the harness has no glTF loader): a box comes back after `ms` (the network), or a broken file fails. */
function loads(ms: number) {
  const real = B.SceneLoader.ImportMeshAsync;
  B.SceneLoader.ImportMeshAsync = async (_a: string, _b: string, url: string, scene: any) => {
    await sleep(ms);
    if (/AAAA$/.test(url)) throw new Error('not a model');
    const m = B.MeshBuilder.CreateBox('model-body', { width: 2, height: 2, depth: 8 }, scene);
    return { meshes: [m], transformNodes: [] };
  };
  return () => { B.SceneLoader.ImportMeshAsync = real; };
}

test('a model that arrives at once: the stand-in never shows', async () => {
  setup();
  const undo = loads(20);
  H.applyOps([{ op: 'create', entity: { id: 'h1', type: 'helicopter', shape: { model: 'a_heli' }, transform: { position: [0, 1.4, 0] } } }], { local: true });
  const veh = v('h1');
  assert.equal(standShown(veh), false, 'hidden while it loads');
  await H.game.entity('h1').ready;
  assert.equal(standShown(veh), false, 'and never shown');
  assert.ok(!veh.swap, 'no swap needed');
  undo();
});

test('a model that takes a while: the stand-in shows, then turns into the model over 1.5 s', async () => {
  setup();
  const undo = loads(400);
  try {
    H.applyOps([{ op: 'create', entity: { id: 'h2', type: 'helicopter', shape: { model: 'a_heli' }, material: { color: '#2b5fd9' }, transform: { position: [0, 1.4, 0] } } }], { local: true });
    const veh = v('h2');
    await sleep(260);
    assert.equal(standShown(veh), true, 'the built-in body stands in while it loads');
    await H.game.entity('h2').ready;
    assert.ok(veh.swap, 'a swap begins');
    for (let t = 0; t < 0.75; t += 0.05) H.tick(0.05);
    const mid = veh.parts.filter((m: any) => m.isEnabled(false) && !veh.lampMeshes.includes(m));
    assert.ok(mid.length && mid.every((m: any) => m.visibility > 0.2 && m.visibility < 0.8), `halfway: the stand-in half faded (${mid.map((m: any) => m.visibility.toFixed(2))})`);
    for (let t = 0; t < 0.85; t += 0.05) H.tick(0.05);
    assert.ok(!veh.swap, 'done after 1.5 s');
    assert.equal(standShown(veh), false, 'the stand-in is gone');
    assert.ok(veh.parts.every((m: any) => m.isDisposed() || m.visibility === 1), 'its visibility is back for next time');
  } finally { undo(); }
});

test('a model that fails: the built-in body is the vehicle', async () => {
  setup();
  const undo = loads(20);
  H.setAssets({ 'broken.glb': { url: 'data:model/gltf-binary;base64,AAAA', mime: 'model/gltf-binary', id: 'a_broken', type: 'model', words: [] } });
  H.applyOps([{ op: 'create', entity: { id: 'h3', type: 'helicopter', shape: { model: 'a_broken' }, transform: { position: [0, 1.4, 0] } } }], { local: true });
  await H.game.entity('h3').ready;
  assert.equal(standShown(v('h3')), true);
  undo();
});
