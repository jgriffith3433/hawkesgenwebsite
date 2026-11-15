// The island's small props (public/play/modules/mayhem/mayhem-props.js): they break into 4+ pieces when a vehicle hits them
// over 4 m/s or a blast is close, topple in a weaker blast, are rebuilt at home after their time, and quest things never
// break. Run in Node on the real engine (Havok) through test/engine/harness.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', shape: { size: [120, 1, 120] }, transform: { position: [0, -0.5, 0] } };
const spawn = { type: 'spawn', transform: { position: [0, 0, -40] } };
const prop = (x: number, z: number, material = 'wood', extra: Record<string, any> = {}) => ({
  type: 'box', shape: { size: [2.4, 1.1, 0.2] }, physics: 'static', transform: { position: [x, 0.55, z] },
  behaviors: [{ use: 'breakable', strength: 4, pieces: 6, blast: 14 }], data: { color: '#b08a5a', prop: { material, rebuild: 120 } }, ...extra,
});
const play = (entities: Record<string, any>) => { world(H, sceneOf({ floor, spawn, ...entities }, {})); return H.game; };

test('a vehicle hit breaks a prop into 4 to 24 pieces, with the log the playtest reads', () => {
  const g = play({ fence: prop(0, 0) });
  H.tick(0.5);
  const e = g.entity('fence');
  assert.ok(e._break && e._break.blast === 14, 'the breakable has its blast threshold');
  const made = H.mayhem.shatterLocal(e, { at: [0, 0.5, -3], force: 6 });
  assert.ok(made.length >= 4 && made.length <= 24, `${made.length} pieces`);
  const log = (window as any).__props;
  assert.equal(log.counts.break, 1);
  assert.equal(log.log[0].id, 'fence');
  assert.ok(made.every((p: any) => p.data.density < 1), 'wooden pieces float');
});

test('quest things never break: the rod, lore objects, fuel barrels', () => {
  const g = play({
    rod: prop(0, 0), lore_rock: prop(4, 0), barrel_1: { ...prop(8, 0), data: { barrel: true, prop: { material: 'wood' } } },
  });
  H.tick(0.5);
  for (const id of ['rod', 'lore_rock', 'barrel_1']) {
    assert.deepEqual(H.mayhem.shatterLocal(g.entity(id), {}), [], id);
    assert.equal(g.entity(id)._shattered, undefined, id);
  }
});

test('a blast too weak to break a prop topples it; a close one breaks it; both come back after 2 minutes', () => {
  const g = play({ near: prop(1.5, 0), far: prop(5, 0), safe: prop(0, 30) });
  H.tick(0.5);
  g.explode([0, 0.5, 0], { radius: 6, force: 22, damage: 0 });
  H.tick(0.3);
  const log = (window as any).__props;
  assert.ok(g.entity('near')._shattered, 'within reach: broken');
  assert.ok(g.entity('far')._toppled && !g.entity('far')._shattered, 'further out: knocked over, not broken');
  assert.ok(!g.entity('safe')._toppled && !g.entity('safe')._shattered, 'out of range: untouched');
  assert.ok(log.counts.topple >= 1 && log.counts.break >= 1);
  H.tick(60);
  assert.ok(g.entity('far')._toppled, 'not back yet at a minute');
  H.tick(140);
  for (const id of ['near', 'far']) {
    const e = g.entity(id);
    assert.ok(!e._shattered && !e._toppled && e.visible !== false && !e.ghost, `${id} rebuilt`);
    assert.equal(e.physics, 'static', `${id} planted again`);
    assert.ok(Math.abs(e.y - 0.55) < 0.05, `${id} at home (${e.y})`);
  }
  assert.equal(log.counts.restore, 2);
});
