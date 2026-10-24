// Living things (public/play/modules/living): creatures, herds, brains, paths, riding and AI friends, run in the real
// engine in Node (test/engine/harness.ts: NullEngine + Havok). AI friends' words here are the free phrasebook (no
// server); src/companions.ts has its own test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const L = H.living;
const floor = { type: 'box', shape: { size: [60, 1, 60] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, -8] } };
const flat = (x: number) => Math.round(x * 100) / 100;

test('the grid finds a way around a wall (pure A*, no world)', () => {
  const g = L.nav.makeGrid(0, 0, 20, 20, 1);
  for (let z = 0; z < 16; z++) g.blocked[z * 20 + 10] = 1; // a wall at x = 10, open at the top (z >= 16)
  const r = L.nav.solve(g, 2 * 20 + 2, 2 * 20 + 18);
  assert.ok(r && !r.partial, 'a way was found');
  const cells = r.cells.map((i: number) => [i % 20, Math.floor(i / 20)]);
  assert.ok(cells.some(([x, z]: number[]) => x === 10 && z >= 16), 'it goes around the end of the wall');
  assert.ok(!cells.some(([x, z]: number[]) => x === 10 && z < 16), 'never through it');
  const s = L.nav.smooth(g, r.cells);
  assert.ok(s.length >= 3 && s.length < r.cells.length, `string pulling keeps the corners (${s.length} of ${r.cells.length})`);
  // Walled in: as close as it can get.
  for (let z = 0; z < 20; z++) g.blocked[z * 20 + 10] = 1;
  const p = L.nav.solve(g, 2 * 20 + 2, 2 * 20 + 18);
  assert.ok(p.partial, 'partial when the end is out of reach');
});

test('creatures, herds and friends build from scene.json and stand on the floor', () => {
  world(H, sceneOf({
    floor, start,
    daisy: { type: 'creature', name: 'Daisy', shape: { species: 'cow' }, transform: { position: [5, 1, 5] } },
    rex: { type: 'creature', name: 'Rex', shape: { species: 'trex' }, transform: { position: [-12, 2, 10] } },
    flock: { type: 'herd', name: 'Sheep', shape: { species: 'sheep', count: 30 }, transform: { position: [10, 0, -10] } },
    max: { type: 'friend', name: 'Max', shape: { personality: 'silly' }, transform: { position: [2, 1, -6] } },
  }));
  const daisy = H.game.entity('daisy');
  assert.equal(daisy.kind, 'creature');
  assert.equal(daisy.data.species, 'cow');
  assert.equal(H.game.entity('rex').data.species, 'dinosaur', 'words for a species work (trex)');
  assert.equal(H.game.entity('flock').members.length, 30);
  assert.equal(H.game.entity('max').kind, 'friend');
  assert.equal(L.count, 33);
  for (const sp of L.species.list()) assert.ok(L.spawn(sp, { x: 20, z: 20 }).alive, `${sp} builds`);
  H.tick(2);
  assert.ok(Math.abs(daisy.bottom) < 0.15, `the cow stands on the floor (${daisy.bottom})`);
  const sheep = H.game.entity('flock').members;
  assert.ok(sheep.every((s: any) => s.alive && s.bottom > -0.3), 'every sheep is on the floor');
});

test('a herd of 120 wanders, keeps together, and stays cheap', () => {
  world(H, sceneOf({ floor, start, cows: { type: 'herd', shape: { species: 'cow', count: 120 }, transform: { position: [0, 0, 6] } } }));
  const cows = H.game.entity('cows').members;
  const before = cows.map((c: any) => [c.x, c.z]);
  H.tick(1);
  const t0 = performance.now();
  H.tick(4);
  const ms = (performance.now() - t0) / 240;
  const moved = cows.filter((c: any, i: number) => Math.hypot(c.x - before[i][0], c.z - before[i][1]) > 0.5).length;
  assert.ok(moved > 20, `cows wander (${moved} moved)`);
  assert.ok(cows.every((c: any) => c.alive && Math.hypot(c.x, c.z - 6) < 28), 'and stay near home');
  assert.ok(ms < 25, `a step with 120 cows takes ${ms.toFixed(2)} ms`);
});

test('a rocket: close animals are thrown and tumble, get up, and the herd stampedes away (not off the world)', () => {
  world(H, sceneOf({ floor, start, cows: { type: 'herd', shape: { species: 'cow', count: 40 }, transform: { position: [0, 0, 10] } } }));
  const cows = H.game.entity('cows').members;
  H.tick(1);
  let knocked = 0;
  const seen = new Set();
  H.game.onUpdate(() => { for (const c of cows) if (c.alive && L.status(c).state === 'knocked') seen.add(c); });
  H.physics.explode([0, 0.3, 10], { radius: 5, force: 16, damage: 30 });
  H.tick(1);
  knocked = seen.size;
  assert.ok(knocked >= 2, `some were thrown (${knocked})`);
  const fleeing = cows.filter((c: any) => c.alive && L.status(c).act === 'flee').length;
  assert.ok(fleeing > 15, `the herd runs (${fleeing} fleeing)`);
  H.tick(8);
  const alive = cows.filter((c: any) => c.alive);
  assert.ok(alive.every((c: any) => L.status(c).state !== 'knocked'), 'everyone got back up');
  assert.ok(alive.length >= 36, `nobody ran off the edge of the world (${alive.length} of 40 left)`);
  assert.ok(alive.every((c: any) => c.upright !== false && c.y > -1), 'still standing on the world');
});

test('a dog follows its person, and finds its way around a wall', () => {
  world(H, sceneOf({
    floor, start,
    wall: { type: 'box', shape: { size: [14, 3, 1] }, transform: { position: [0, 1.5, 0] } },
    rex: { type: 'creature', name: 'Rex', shape: { species: 'dog', follow: 'player' }, transform: { position: [0, 0.5, -4] } },
  }));
  const p = H.game.player, dog = H.game.entity('rex');
  p.controls = false;
  H.tick(1);
  p.position = [0, 1, 6]; // behind the wall
  H.tick(12);
  const d = Math.hypot(dog.x - p.x, dog.z - p.z);
  assert.ok(d < 5, `the dog came around the wall to its person (${flat(d)} m away, at ${flat(dog.x)}, ${flat(dog.z)})`);
  const way = L.path([0, 0, -4], [0, 0, 6]);
  assert.ok(way && way.some(([x]: number[]) => Math.abs(x) > 7), 'the path goes around the end of the wall');
});

test('fetch: the dog brings the ball back', () => {
  world(H, sceneOf({ floor, start, rex: { type: 'creature', name: 'Rex', shape: { species: 'dog', follow: 'player' }, transform: { position: [1, 0.5, -7] } } }));
  const p = H.game.player, dog = H.game.entity('rex');
  p.controls = false;
  H.tick(0.5);
  const ball = H.game.sphere({ radius: 0.13, position: [6, 0.5, 4], physics: 'dynamic', tag: 'ball', name: 'Ball' });
  L.command(dog, 'fetch', { target: 'player' });
  let carried = false;
  H.game.onUpdate(() => { if (L.status(dog).carrying) carried = true; });
  H.tick(10);
  assert.ok(carried, 'it picked the ball up');
  assert.ok(Math.hypot(ball.x - p.x, ball.z - p.z) < 3.5, `and dropped it at their feet (${flat(Math.hypot(ball.x - p.x, ball.z - p.z))} m)`);
});

test('a wolf hunts a sheep; a bear fights back when hurt', () => {
  world(H, sceneOf({
    floor, start,
    wolf: { type: 'creature', shape: { species: 'wolf' }, transform: { position: [0, 0.5, 10] } },
    lamb: { type: 'creature', shape: { species: 'sheep' }, transform: { position: [6, 0.5, 10] } },
    bear: { type: 'creature', shape: { species: 'bear' }, transform: { position: [-10, 1, 0] } },
    dummy: { type: 'box', physics: 'dynamic', transform: { position: [-14, 0.5, 0] } },
  }));
  const wolf = H.game.entity('wolf'), lamb = H.game.entity('lamb'), bear = H.game.entity('bear');
  wolf.living.hunger = 0.9;
  H.tick(1);
  assert.equal(L.status(wolf).act, 'chase', 'the hungry wolf goes after the sheep');
  const hp = lamb.hp;
  H.tick(12);
  assert.ok(!lamb.alive || lamb.dead || lamb.hp < hp, 'the sheep got bitten');
  H.game.damage(bear, 5, H.game.entity('dummy'));
  H.tick(0.3);
  assert.equal(L.status(bear).act, 'chase', 'the bear turns on what hurt it');
});

test('riding a horse: E (or living.ride), WASD moves it, E gets off', () => {
  world(H, sceneOf({ floor, start, star: { type: 'creature', name: 'Star', shape: { species: 'horse' }, transform: { position: [0, 1, -6] } } }));
  const p = H.game.player, horse = H.game.entity('star');
  H.tick(0.5);
  L.ride(horse);
  H.tick(0.1);
  assert.equal(p.controller, 'ride');
  const z0 = horse.z, x0 = horse.x;
  H.input.held.add('w');
  H.tick(2);
  H.input.held.delete('w');
  assert.ok(Math.hypot(horse.x - x0, horse.z - z0) > 3, `the horse went (${flat(Math.hypot(horse.x - x0, horse.z - z0))} m)`);
  assert.ok(Math.hypot(p.x - horse.x, p.z - horse.z) < 0.5 && p.y > horse.y, 'with the player on its back');
  L.dismount();
  H.tick(0.5);
  assert.equal(p.controller, 'walk');
  assert.ok(!p.held && p.bottom < 0.4, `back on their feet (${flat(p.bottom)})`);
});

test('an AI friend without AI talk: understands plain words, follows, stays, builds a tower, dances', async () => {
  world(H, sceneOf({ floor, start, max: { type: 'friend', name: 'Max', shape: { personality: 'cheerful builder', follow: false }, transform: { position: [3, 1, -3] } } }));
  const max = H.game.entity('max'), p = H.game.player;
  p.controls = false;
  H.tick(0.5);
  assert.equal(L.understand('could you follow me?').action, 'follow');
  assert.equal(L.understand('build a big red tower').thing.kind, 'box');
  let r = await L.talk(max, 'Follow me!');
  assert.equal(r.action, 'follow');
  assert.ok(r.say.length > 0);
  p.position = [0, 1, 12];
  H.tick(8);
  assert.ok(Math.hypot(max.x - p.x, max.z - p.z) < 5, 'Max followed');
  r = await L.talk(max, 'stay here');
  H.tick(0.2);
  assert.equal(L.status(max).act, 'stay');
  await L.talk(max, 'build a blue tower');
  assert.equal(H.game.all('built').length, 5, 'a tower of five blocks');
  await L.talk(max, 'dance!');
  H.tick(0.2);
  assert.equal(L.status(max).state, 'dance');
  // Explosions scare friends too.
  H.physics.explode([max.x + 1, 0.5, max.z], { radius: 4, force: 8 });
  H.tick(0.2);
  assert.ok(['flee', 'knocked'].includes(L.status(max).act), `Max reacts (${L.status(max).act})`);
});

test('build mode: animals stand still where they were put', () => {
  world(H, sceneOf({ floor, start, daisy: { type: 'creature', shape: { species: 'cow' }, transform: { position: [5, 1, 5] } } }), { mode: 'build' });
  const daisy = H.game.entity('daisy');
  H.tick(5);
  assert.ok(Math.hypot(daisy.x - 5, daisy.z - 5) < 0.3, 'the cow stays put while building');
});
