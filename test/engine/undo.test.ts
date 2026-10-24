// Building's undo and redo (public/play/build.js): every kind of edit goes back and forward, and with others building
// at the same time you only ever undo your own changes (theirs since are kept).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, world, sceneOf } from './harness.ts';

// (build.js keeps a timer for press-and-hold: it mustn't keep the test running.)
const every = globalThis.setInterval;
(globalThis as any).setInterval = (...a: any[]) => { const t = (every as any)(...a); t.unref?.(); return t; };
const ROOT =path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = await load({ extra: [path.join(ROOT, 'public', 'play', 'build.js')], anyId: true });
const g = globalThis as any;
const sent: any[] = [];
H.post = (m: any) => { if (m && m.type === 'ops') sent.push(m); };
const B = () => g.HawkesBuild;
const spec = (id: string) => H.world.graph.entities[id];
const ground = { type: 'box', physics: 'static', shape: { size: [60, 1, 60] }, transform: { position: [0, -0.5, 0] } };
/** Another builder's change arriving from the room. */
const theirs = (ops: any[]) => H.applyOps(ops, { remote: true, by: 'Sam' });

test('undo and redo every kind of edit: add, change, move, remove (with what was inside), world settings', () => {
  world(H, sceneOf({ ground, crate: { type: 'box', name: 'Crate', shape: { size: [1, 1, 1] }, material: { color: '#ff0000' }, transform: { position: [0, 0.5, 0] } }, shelf: { type: 'box', name: 'Shelf' }, cup: { type: 'box', name: 'Cup', parent: 'shelf' } }), { mode: 'build' });
  B().edit([{ op: 'create', entity: { id: 'ball', type: 'sphere', name: 'Ball', transform: { position: [2, 1, 0] } } }], { label: 'adding a ball' });
  assert.ok(spec('ball'));
  B().edit([{ op: 'update', id: 'crate', patch: { material: { texture: 'wood.png' }, name: 'Box' } }], { label: 'texturing' });
  B().edit([{ op: 'update', id: 'crate', patch: { transform: { position: [5, 0.5, 5] } } }], { label: 'moving it' });
  B().edit([{ op: 'delete', id: 'shelf' }], { label: 'removing the shelf' });
  B().edit([{ op: 'config', patch: { sky: 'sunset', gravity: -12 } }], { label: 'the sky' });
  assert.equal(spec('cup'), undefined, 'the cup went with its shelf');
  B().undo();
  assert.equal(H.world.graph.config.sky, undefined, 'the sky is back as it was (not set)');
  assert.equal(H.world.graph.config.gravity, undefined);
  B().undo();
  assert.ok(spec('shelf') && spec('cup') && spec('cup').parent === 'shelf', 'the shelf and the cup on it are back');
  B().undo();
  assert.deepEqual(spec('crate').transform.position, [0, 0.5, 0]);
  B().undo();
  assert.equal(spec('crate').material.texture, undefined, 'the texture is gone again (not merged over)');
  assert.equal(spec('crate').material.color, '#ff0000');
  assert.equal(spec('crate').name, 'Crate');
  B().undo();
  assert.equal(spec('ball'), undefined);
  // And forward again.
  for (let i = 0; i < 5; i++) B().redo();
  assert.ok(spec('ball'));
  assert.equal(spec('crate').material.texture, 'wood.png');
  assert.deepEqual(spec('crate').transform.position, [5, 0.5, 5]);
  assert.equal(spec('shelf'), undefined);
  assert.equal(H.world.graph.config.sky, 'sunset');
  // Every step went to the server as ops, like any edit.
  assert.ok(sent.length >= 15);
  assert.ok(H.world.byId.get('ball') && H.world.byId.get('ball').alive, 'and the world shows it');
});

test('playing together you undo only your own edits: what someone changed since is kept', () => {
  world(H, sceneOf({ ground, crate: { type: 'box', name: 'Crate', material: { color: '#ff0000' }, transform: { position: [0, 0.5, 0] } } }), { mode: 'build' });
  // I paint it and move it; then Sam renames it and moves it somewhere else.
  B().edit([{ op: 'update', id: 'crate', patch: { material: { color: '#00ff00' }, transform: { position: [3, 0.5, 0] } } }], { label: 'painting' });
  theirs([{ op: 'update', id: 'crate', patch: { name: 'Sam\'s crate', transform: { position: [9, 0.5, 9] } } }]);
  B().undo();
  assert.equal(spec('crate').material.color, '#ff0000', 'my paint is undone');
  assert.deepEqual(spec('crate').transform.position, [9, 0.5, 9], 'Sam\'s move is kept (they moved it after me)');
  assert.equal(spec('crate').name, 'Sam\'s crate', 'and their name');
  B().redo();
  assert.equal(spec('crate').material.color, '#00ff00');
  assert.deepEqual(spec('crate').transform.position, [9, 0.5, 9], 'redo doesn\'t take Sam\'s move back either');
  // Something I added that Sam already removed: undo has nothing to do, and says so.
  B().edit([{ op: 'create', entity: { id: 'lamp', type: 'box', name: 'Lamp' } }], { label: 'adding a lamp' });
  theirs([{ op: 'delete', id: 'lamp' }]);
  const before = sent.length;
  B().undo();
  assert.equal(sent.length, before, 'nothing sent');
  // Something I removed that Sam put back already: not made twice.
  B().edit([{ op: 'delete', id: 'crate' }], { label: 'removing the crate' });
  theirs([{ op: 'create', entity: { id: 'crate', type: 'box', name: 'Crate again' } }]);
  B().undo();
  assert.equal(spec('crate').name, 'Crate again');
  // Their edits never go on my list.
  theirs([{ op: 'create', entity: { id: 'tree', type: 'box', name: 'Tree' } }]);
  B().undo(); B().undo(); B().undo();
  assert.ok(spec('tree'), 'their tree stays whatever I undo');
});

test('an edit the server refused is dropped from the list', () => {
  world(H, sceneOf({ ground }), { mode: 'build' });
  B().edit([{ op: 'create', entity: { id: 'a1', type: 'box', name: 'A' } }], { label: 'adding A' });
  B().edit([{ op: 'create', entity: { id: 'b1', type: 'box', name: 'B' } }], { label: 'adding B' });
  const bad = sent[sent.length - 1].seq;
  // The editor answers: B was refused.
  B().refused(bad);
  B().undo();
  assert.equal(spec('a1'), undefined, 'the undo went to A (B never happened)');
});
