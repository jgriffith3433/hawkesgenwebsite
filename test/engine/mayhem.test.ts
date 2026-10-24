// Mayhem (public/play/modules/mayhem): explosions, chain reactions, things that break and burn, critters, spawning a
// hundred of anything, and the tools, run in Node on the real engine (Havok) through test/engine/harness.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';
import { applyOps, emptyScene } from '../../src/scene.ts';

const H = await load();
const M = H.mayhemMath;
const floor = { type: 'box', shape: { size: [80, 1, 80] }, transform: { position: [0, -0.5, 0] } };
const spawn = { type: 'spawn', transform: { position: [0, 0, -20] } };
const log: string[] = [];
function play(entities: Record<string, any> = {}, config: Record<string, any> = {}) {
  world(H, sceneOf({ floor, spawn, ...entities }, config));
  log.length = 0;
  H.game.on('explosion', (d: any) => log.push(`boom:${d.position.map((v: number) => Math.round(v)).join(',')}`));
  H.game.on('break', () => log.push('break'));
  H.game.on('ignite', () => log.push('ignite'));
  return H.game;
}
const count = (what: string) => log.filter((x) => x.startsWith(what)).length;

test('the math: layouts, fractures, falloff, the same numbers for the same seed', () => {
  for (const pattern of M.PATTERNS) assert.equal(M.layout(37, { pattern, seed: 3 }).length, 37, pattern);
  assert.deepEqual(M.layout(1, { pattern: 'scatter' }), [[0, 0, 0]], 'one thing goes exactly where asked');
  assert.deepEqual(M.layout(20, { seed: 9 }), M.layout(20, { seed: 9 }), 'seeded: every player gets the same layout');
  const grid = M.layout(9, { pattern: 'grid', spacing: 2 });
  assert.deepEqual(grid[0], [-2, 0, -2]);
  const area = M.layout(200, { area: 10, seed: 1 });
  assert.ok(area.every((p: number[]) => Math.hypot(p[0], p[2]) <= 10.001), 'scatter stays in the area');
  const parts = M.fracture([2, 1, 1], 8, 5);
  assert.ok(parts.length >= 5 && parts.length <= 12, `about 8 pieces (${parts.length})`);
  const vol = parts.reduce((s: number, p: any) => s + p.size[0] * p.size[1] * p.size[2], 0);
  assert.ok(Math.abs(vol - 2) < 1e-6, 'the pieces fill the thing exactly');
  assert.equal(M.falloff(0, 5), 1);
  assert.equal(M.falloff(5, 5), 0);
  assert.ok(M.score('kill', 3) === 150 && M.score('hit', 1) === 10);
});

test('the kinds are in the world list and build from their specs', () => {
  const r = applyOps(emptyScene(), [
    { op: 'create', entity: { type: 'barrel' } }, { op: 'create', entity: { type: 'crate' } },
    { op: 'create', entity: { type: 'critter', shape: { species: 'pig' } } }, { op: 'create', entity: { type: 'tool-pickup', shape: { tool: 'lasso' } } },
  ]);
  assert.equal(r.errors.length, 0, r.errors.join('; '));
  const g = play({
    barrel: { type: 'barrel', transform: { position: [0, 0.6, 0] } },
    crate: { type: 'crate', transform: { position: [3, 0.5, 0] } },
    cow: { type: 'critter', shape: { species: 'cow' }, transform: { position: [-4, 1, 0] } },
    duck: { type: 'critter', shape: { species: 'duck', size: 0.6 }, transform: { position: [-7, 1, 0] } },
    wibble: { type: 'critter', shape: { species: 'wibble' }, transform: { position: [-10, 1, 0] } },
    pad: { type: 'tool-pickup', shape: { tool: 'gravity-gun' }, transform: { position: [8, 0.05, 0] } },
  });
  H.tick(1.5);
  assert.equal(g.entity('barrel').kind, 'barrel');
  assert.ok(g.entity('barrel').data.explosive && g.entity('barrel').hp === 20);
  assert.ok(g.entity('crate')._break, 'crates break');
  for (const id of ['cow', 'duck', 'wibble']) {
    const c = g.entity(id);
    assert.equal(c.kind, 'critter');
    assert.ok(Math.abs(c.bottom) < 0.15, `${id} stands on the floor (${c.bottom.toFixed(2)})`);
  }
  assert.ok(Math.abs(g.entity('duck').size[1] - 0.6) < 0.05, 'size is its height');
  assert.ok(typeof g.critter === 'function' && typeof g.barrel === 'function' && typeof g.spawnMany === 'function', 'makers and game.spawnMany');
  // Walking into a tool pickup puts it in your hands.
  g.player.position = [8, 1, 0];
  H.tick(0.3);
  assert.equal(g.player.tool, 'gravity-gun');
  assert.deepEqual(H.mayhem.belt, ['gravity-gun']);
});

test('spawn 100 cows: all of them, on the ground, smooth enough, and an explosion throws and spins them', () => {
  const g = play();
  const cows = g.spawnMany('cows', 100, { at: [0, 0, 0], area: 14 });
  assert.equal(cows.length, 100);
  assert.ok(cows.every((c: any) => c.kind === 'critter' && c.data.critter === 'cow' && c.temporary && c.sceneId));
  const t0 = performance.now();
  H.tick(2);
  const ms = (performance.now() - t0) / 120;
  assert.ok(ms < 40, `a step with 100 cows takes ${ms.toFixed(1)} ms`);
  const low = cows.filter((c: any) => c.bottom < 0.4 && c.bottom > -0.2).length;
  assert.ok(low > 80, `most cows stand on the floor (${low})`);
  const before = cows.map((c: any) => c.position);
  g.explode([0, 0.5, 0], { radius: 8, force: 25, damage: 0 });
  H.tick(0.4);
  const moved = cows.filter((c: any, i: number) => Math.hypot(c.x - before[i][0], c.z - before[i][2]) > 0.5).length;
  const turned = cows.filter((c: any) => Math.abs(c.node.rotation.x) + Math.abs(c.node.rotation.z) > 0.2).length;
  assert.ok(moved > 10, `the blast threw cows (${moved})`);
  assert.ok(turned > 3, `and they tumble (${turned})`);
  assert.equal(count('boom'), 1);
  H.tick(6);
  const up = cows.filter((c: any) => c.alive && Math.abs(c.node.rotation.x) + Math.abs(c.node.rotation.z) < 0.15).length;
  assert.ok(up > 85, `they get back on their feet (${up} of 100)`);
  // The budget: no more than maxSpawn at once.
  const more = g.spawnMany('box', 1000, { at: [20, 0, 20] });
  assert.ok(more.length <= H.mayhem.settings.maxSpawn && H.mayhem.spawned.length <= H.mayhem.settings.maxSpawn, 'spawning stays within the budget');
  g.mayhem.clear();
  assert.equal(H.mayhem.spawned.length, 0);
});

test('words become things: animals, kinds, shapes, models by name, stand-ins', () => {
  play();
  assert.equal(H.mayhem.specFor('penguins').type, 'critter');
  assert.equal(H.mayhem.specFor('penguins').shape.species, 'penguin');
  assert.equal(H.mayhem.specFor('barrels').type, 'barrel');
  assert.equal(H.mayhem.specFor('balls').type, 'sphere');
  assert.equal(H.mayhem.specFor('crates').type, 'crate');
  assert.equal(H.mayhem.specFor('tables').data.standIn, 'table');
  assert.equal(H.mayhem.specFor({ type: 'box', shape: { size: 2 } }).physics, 'dynamic');
});

test('a barrel goes off when shot and sets off the barrels next to it (a chain)', () => {
  const g = play({
    b1: { type: 'barrel', transform: { position: [0, 0.6, 0] } },
    b2: { type: 'barrel', transform: { position: [3, 0.6, 0] } },
    b3: { type: 'barrel', transform: { position: [6, 0.6, 0] } },
    far: { type: 'barrel', transform: { position: [30, 0.6, 0] } },
    crate: { type: 'box', physics: 'dynamic', transform: { position: [-2.5, 0.5, 0] } },
  });
  H.tick(0.5);
  g.damage(g.entity('b1'), 50);
  H.tick(2);
  assert.equal(count('boom'), 3, log.join(' '));
  assert.ok(!g.entity('b2').visible && !g.entity('b3').visible, 'the chain took them all');
  assert.ok(g.entity('far').visible, 'a barrel far away is fine');
  assert.ok(g.entity('crate').x < -3, `the blast threw the crate (${g.entity('crate').x.toFixed(2)})`);
});

test('a hard hit sets a barrel off; a crate dropped from high up breaks into pieces that fly and then go', () => {
  const g = play({
    barrel: { type: 'barrel', transform: { position: [0, 0.6, 0] } },
    wall: { type: 'box', shape: { size: [6, 4, 0.5] }, transform: { position: [0, 2, 10] } },
    crate: { type: 'crate', transform: { position: [-8, 12, 0] } },
    vase: { type: 'box', shape: { size: 0.5 }, physics: 'dynamic', behaviors: [{ use: 'breakable', strength: 6, pieces: 4 }], transform: { position: [8, 4, 0] } },
  });
  H.tick(0.4);
  g.entity('barrel').velocity = [0, 2, 26];
  H.tick(1.5);
  assert.equal(count('boom'), 1, `the barrel hit the wall and went off (${log.join(' ')})`);
  assert.ok(!g.entity('crate').visible, 'the crate broke on landing');
  assert.ok(!g.entity('vase').visible, 'the breakable behavior breaks a box');
  assert.ok(count('break') >= 2);
  const pieces = H.mayhem.debris;
  assert.ok(pieces.length >= 8, `pieces (${pieces.length})`);
  const spread = Math.max(...pieces.map((x: any) => Math.hypot(x.x - pieces[0].x, x.z - pieces[0].z)));
  assert.ok(spread > 1, `the pieces flew apart (${spread.toFixed(2)} m)`);
  H.tick(12);
  assert.equal(H.mayhem.debris.length, 0, 'the pieces go after a while');
});

test('fire: things catch, burn, spread it to their neighbours, burn down, and water would put them out', () => {
  const g = play({
    c1: { type: 'crate', transform: { position: [0, 0.5, 0] } },
    c2: { type: 'crate', transform: { position: [1.2, 0.5, 0] } },
    c3: { type: 'crate', transform: { position: [2.4, 0.5, 0] } },
    wall: { type: 'box', shape: { size: [4, 3, 0.3] }, transform: { position: [0, 1.5, 6] } },
  }, { mayhem: { burnSeconds: 20 } });
  H.tick(0.3);
  assert.equal(H.mayhem.ignite(g.entity('wall')), false, 'walls don\'t burn');
  assert.ok(H.mayhem.ignite(g.entity('c1')));
  assert.ok(g.entity('c1').burning);
  H.tick(6);
  assert.ok(count('ignite') >= 2, `the fire spread (${log.join(' ')})`);
  H.tick(10);
  assert.ok(!g.entity('c1').visible, 'it burnt down and broke');
  // Put out by hand.
  const c = g.crate({ x: -10, y: 0.5, z: 0 });
  H.mayhem.ignite(c);
  H.tick(0.2);
  assert.ok(H.mayhem.extinguish(c) && !c.burning);
});

test('the rope: a lassoed thing follows, and a thing tied to a post stays within reach of it', () => {
  const g = play({
    post: { type: 'cylinder', shape: { radius: 0.2, height: 3 }, transform: { position: [0, 1.5, 0] } },
    crate: { type: 'box', physics: 'dynamic', transform: { position: [3, 0.5, 0] } },
  });
  H.tick(0.3);
  const crate = g.entity('crate');
  H.mayhem.rope(crate, g.entity('post'), 3.2);
  crate.velocity = [30, 4, 0];
  H.tick(1.5);
  const d = Math.hypot(crate.x, crate.z);
  assert.ok(d < 4.2, `the rope held it (${d.toFixed(2)} m from the post)`);
  assert.equal(H.mayhem.cutRopes(true), 1);
  crate.velocity = [30, 4, 0];
  H.tick(1.5);
  assert.ok(Math.hypot(crate.x, crate.z) > 6, 'cut: it flies off');
});

// The tools, used as a player would: the crosshair on something, the trigger pulled.
function aimAt(g: any, at: number[]) {
  H.tick(1 / 60);
  const c = H.world.scene.activeCamera.position;
  const dx = at[0] - c.x, dy = at[1] - c.y, dz = at[2] - c.z;
  H.world.camera.yaw = Math.atan2(dx, dz);
  H.world.camera.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
  H.tick(1 / 60);
  H.world.scene.render();
}
function pull(hold = 1 / 60) {
  const m = H.input.mouse;
  m.down = true; m.pressed = true;
  H.tick(hold);
  m.down = false;
  H.tick(1 / 60);
}
test('tools: the rocket launcher, grenades, sticky bombs (R sets them off), the spawn gun, the gravity gun', () => {
  (globalThis as any).document.body.classList.add('soft-control');
  const g = play({ target: { type: 'crate', transform: { position: [0, 0.5, 0] } } });
  const p = g.player;
  p.position = [0, 1, -12];
  H.tick(0.3);
  p.tool = 'rocket-launcher';
  aimAt(g, [0, 0.5, 0]);
  pull();
  H.tick(1);
  assert.equal(count('boom'), 1, 'the rocket hit and blew up');
  assert.ok(!g.entity('target').visible, 'the crate is gone');

  p.tool = 'grenade';
  aimAt(g, [0, 3, 0]);
  pull(0.4);
  H.tick(0.5);
  const gr = H.mayhem.spawned.find((e: any) => e.data.grenade);
  assert.ok(gr && gr.z > -6, `a grenade flies (z ${gr && gr.z.toFixed(2)})`);
  H.tick(3);
  assert.equal(count('boom'), 2, 'and goes off after its fuse');

  p.tool = 'sticky-bomb';
  aimAt(g, [0, 0, -4]);
  pull();
  H.tick(1.2);
  const bomb = H.mayhem.spawned.find((e: any) => e.data.sticky);
  assert.ok(bomb && bomb._stuck, 'the sticky bomb stuck where it landed');
  H.input.held.add('r'); H.tick(1 / 60); H.input.held.delete('r'); H.tick(0.3);
  assert.equal(count('boom'), 3, 'R set it off');

  p.tool = 'spawn-gun';
  aimAt(g, [0, 0, -2]);
  pull();
  H.tick(0.2);
  assert.ok(H.mayhem.spawned.some((e: any) => e.data.critter === 'cow'), 'the spawn gun made a cow');

  const box = g.box({ x: 0, y: 0.5, z: -8, size: 0.8, physics: 'dynamic' });
  p.tool = 'gravity-gun';
  H.tick(0.4);
  aimAt(g, [0, 0.5, -8]);
  pull();
  aimAt(g, [0, 1.6, 0]);
  H.tick(0.4);
  assert.ok(box.held, 'the gravity gun holds it');
  assert.ok(box.y > 0.8, `up in the air (${box.y.toFixed(2)})`);
  // Thrown off to the side (the cow from the spawn gun is straight ahead).
  aimAt(g, [-20, 1.6, -12]);
  const from = box.position;
  pull();
  H.tick(0.2);
  assert.ok(!box.held && Math.hypot(...box.velocity) > 5, `and throws it (${box.velocity.map((v: number) => v.toFixed(1))})`);
  assert.ok(Math.hypot(box.x - from[0], box.z - from[2]) > 3, 'it flew');
  (globalThis as any).document.body.classList.remove('soft-control');
});

test('playing alone, an explosion is decided here: things are pushed and an explosion event says so', () => {
  play();
  let ev: any = null;
  H.game.on('explosion', (d: any) => { ev = d; });
  const crate = H.game.box({ x: 1, y: 0.5, z: 0, physics: 'dynamic' });
  H.tick(0.3);
  H.mayhem.explode([0, 0.3, 0], { radius: 4, force: 15 });
  H.tick(0.3);
  assert.ok(crate.x > 1.3, 'pushed');
  assert.ok(ev && ev.authoritative && ev.radius === 4 && Array.isArray(ev.position), 'the explosion event (for terrain craters and others)');
});
