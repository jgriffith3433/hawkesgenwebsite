// The water module (public/play/modules/water) in the real engine: Babylon's NullEngine and Havok in Node, the same
// files the browser loads (test/engine/harness.ts). Worlds are built from scene.json and stepped with H.tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, world as run, sceneOf } from './harness.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'play', 'modules', 'water', 'module.json'), 'utf8'));
const H = await load();
const g = globalThis as any;
const errors: string[] = [];
H.report = (e: any, where?: string) => { errors.push(String(where || '') + ': ' + String((e && e.message) || e)); };
const errorBox = () => (g.document.getElementById('error').children as any[]).map((c) => c.textContent);
const floor = { type: 'box', name: 'Ground', shape: { size: [40, 1, 40] }, transform: { position: [0, -0.5, 0] } };

function world(config: any, entities: Record<string, any> = {}, mode: 'play' | 'build' = 'play') {
  errors.length = 0;
  run(H, sceneOf({ floor, ...entities }, config), { mode });
  return H.game;
}
// Keys, as the phone buttons press them (H.bindTouchKey): held while down, 'pressed' on the step it went down.
const buttons = new Map<string, any>();
function key(type: 'keydown' | 'keyup', k: string) {
  let b = buttons.get(k);
  if (!b) { b = new g.HTMLElement('button'); H.bindTouchKey(b, k); buttons.set(k, b); }
  b.dispatch(type === 'keydown' ? 'pointerdown' : 'pointerup', { preventDefault() {}, stopPropagation() {} });
}
function press(k: string) { key('keydown', k); H.tick(1 / 60); key('keyup', k); }
const clean = () => assert.deepEqual([...errors, ...errorBox()], []);
const near = (a: number, b: number, d: number, what: string) => assert.ok(Math.abs(a - b) <= d, `${what}: ${a.toFixed(2)} is not within ${d} of ${b}`);

// ------------------------------------------------------------------ the module is there
test('water: registers its kind, tools, controller, features and H.water', () => {
  world({});
  assert.ok(H.kinds.has('water'));
  for (const t of ['bucket', 'rod', 'fishing-rod']) assert.ok(H.tools.has(t), t);
  assert.equal(H.tools.get('fishing-rod').name, 'fishing-rod');
  assert.ok(H.controllers.has('swim'));
  assert.ok(H.features.has('water') && H.features.has('weather'));
  for (const f of ['surfaceAt', 'inWater', 'buoyancy', 'dump', 'wet', 'splash']) assert.equal(typeof H.water[f], 'function', f);
  assert.equal(typeof H.game.water, 'function', 'game.water');
  assert.equal(H.game.water.surfaceAt(0, 0), null, 'no water, no surface');
  assert.equal(H.game.water.inWater([0, -1, 0]), false);
  assert.equal(H.water.buoyancy(H.game.box({ physics: 'dynamic' }), {}), null);
});

test('water: the manifest loads the module, scenes may hold water, the docs have its sections', async () => {
  const { manifest, engineDoc } = await import('../../src/engine.ts');
  const m = manifest();
  assert.ok(m.kinds.includes('water'));
  for (const f of mod.scripts) assert.ok(m.scripts.some((s: string) => s.startsWith(`/play/modules/water/${f}?`)), f);
  assert.match(engineDoc('world'), /## Water/);
  assert.match(engineDoc('api'), /game\.water\.dump/);
});

// ------------------------------------------------------------------ the sea, floating and sinking
test('water: the sea has a surface with waves, and things float or sink by density', () => {
  const game = world({ water: { level: -1, waves: 0.2 } });
  const s = game.water.surfaceAt(30, 30);
  near(s, -1, 0.4, 'surface');
  assert.equal(game.water.inWater([30, -3, 30]), true);
  assert.equal(game.water.inWater([30, 2, 30]), false);
  const crate = game.box({ size: 1, x: 30, y: 3, z: 0, physics: 'dynamic', name: 'Crate' });
  const rock = game.sphere({ radius: 0.4, x: 33, y: 3, z: 0, physics: 'dynamic', name: 'Rock' });
  const heavy = game.box({ size: 1, x: 36, y: 3, z: 0, physics: 'dynamic', name: 'Thing', data: { density: 3 } });
  H.tick(8);
  near(crate.y, game.water.surfaceAt(crate.x, crate.z) - 0.1, 0.4, 'a crate floats a little under half in');
  assert.ok(Math.abs(crate.vy) < 1.5, `the crate settles (vy ${crate.vy})`);
  near(rock.bottom, -1 - 20, 0.2, 'a rock sinks to the sea floor');
  near(heavy.bottom, -21, 0.2, 'data.density over 1 sinks');
  clean();
});

test('water: buoyancy(entity, { density }) is what a boat calls each step (and the automatic pass leaves it alone)', () => {
  const game = world({ water: { level: 0, waves: 0 } });
  const boat = game.box({ size: [2, 1, 4], x: 25, y: 0.5, z: 0, physics: 'dynamic', name: 'Hull' });
  let r: any = null;
  const off = H.physics.beforeStep(() => { r = H.water.buoyancy(boat, { density: 0.3 }); });
  H.tick(6);
  off();
  assert.ok(r && r.submerged > 0.15 && r.submerged < 0.5, `submerged ${r && r.submerged}`);
  near(boat.bottom, -0.3, 0.15, 'density 0.3: 30% under');
});

test('water: on Havok, a tipped raft rights itself (lift at four points) and floats level', () => {
  const game = world({ water: { level: 0, waves: 0 } });
  assert.equal(H.physics.engine, 'havok');
  const raft = game.box({ size: [3, 0.5, 2], x: 28, y: 1.5, z: 0, rotation: [0, 0, 35], physics: 'dynamic', name: 'Raft' });
  H.tick(8);
  const roll = Math.abs(raft.rotation3[2]) % 180;
  assert.ok(Math.min(roll, 180 - roll) < 8, `the raft lies flat (roll ${raft.rotation3[2].toFixed(1)}°)`);
  near(raft.y, 0, 0.3, 'floating at the surface');
  clean();
});

// ------------------------------------------------------------------ the water kind
test('water: a pool from scene.json has a basin, a surface at its top, and stays out of the way', () => {
  const game = world({}, { pool: { id: 'pool', type: 'water', name: 'Pool', transform: { position: [5, 0.8, 5] }, shape: { size: [6, 1.6, 4], basin: true } } });
  const pool = game.entity('pool');
  assert.equal(pool.kind, 'water');
  assert.equal(pool.physics, 'none');
  near(game.water.surfaceAt(5, 5), 1.6, 0.1, 'surface at the top');
  assert.equal(game.water.surfaceAt(5, 8), null, 'outside the pool: none');
  const parts = [...H.world.entities].filter((e: any) => e.data && e.data.waterPart === pool);
  assert.equal(parts.length, 5, 'floor and four walls');
  const ball = game.sphere({ radius: 0.3, x: 5, y: 4, z: 5, physics: 'dynamic', name: 'Beach ball' });
  const splashes: any[] = [];
  game.on('splash', (d: any) => splashes.push(d));
  H.tick(5);
  assert.ok(splashes.length >= 1, 'it splashed going in');
  near(ball.y, 1.6, 0.35, 'a ball floats in the pool');
  // Moving the pool moves its walls.
  H.applyOps([{ op: 'update', id: 'pool', patch: { transform: { position: [9, 0.8, 5] } } }]);
  H.tick(0.1);
  assert.ok(parts.every((p: any) => p.x > 5), 'the walls followed');
  clean();
});

test('water: game.water(...) makes water from a script; deleting it takes its walls', () => {
  const game = world({});
  const tank = game.water({ size: [3, 2, 3], x: -5, y: 1, z: 0, basin: '#888888' });
  assert.equal(game.water.bodies().length, 1);
  tank.destroy();
  assert.equal(game.water.bodies().length, 0);
  assert.equal([...H.world.entities].filter((e: any) => e.data && e.data.waterPart).length, 0);
});

// ------------------------------------------------------------------ swimming
test('water: walking into deep water swims, C dives, breath runs out, standing again walks', () => {
  const game = world({ water: { level: 0, waves: 0, breath: 3 } });
  const p = game.player;
  p.position = [30, 1, 0];
  H.tick(1.5);
  assert.equal(p.controller, 'swim');
  near(p.bottom, -1.25, 0.3, 'floating with your head out');
  key('keydown', 'c');
  H.tick(1);
  key('keyup', 'c');
  assert.ok(p.bottom < -3, `dived (${p.bottom.toFixed(2)})`);
  const before = p.health;
  H.tick(4.5);
  assert.ok(p.health < before, 'out of air hurts');
  // Shallows: walk out.
  p.position = [0, 0.95, 0];
  H.tick(0.5);
  assert.equal(p.controller, 'walk');
  // Building never swims.
  const b = world({ water: { level: 0 } }, {}, 'build');
  b.player.position = [30, 1, 0];
  H.tick(1);
  assert.equal(b.player.controller, 'walk');
  world({}, {}, 'play');
});

// ------------------------------------------------------------------ the bucket
test('water: dumping water on someone splashes, knocks them over, soaks them, and puts out fire', () => {
  const game = world({});
  const p = game.player;
  p.position = [0, 0.95, 0];
  H.tick(0.3);
  const crate = game.box({ size: 0.8, x: 1.5, y: 0.4, z: 0, physics: 'dynamic', name: 'Crate' });
  H.tick(0.3);
  const seen: Record<string, any> = {};
  for (const n of ['soaked', 'extinguish', 'knocked', 'wet']) game.on(n, (d: any) => { if (n !== 'extinguish' || d.by === 'bucket') seen[n] = seen[n] || d; });
  let pushed = 0;
  game.on('soaked', () => { pushed = crate.vx; });
  game.water.dump('You', { volume: 4 });
  H.tick(0.8);
  assert.equal(p.controls, false, 'knocked down for a moment');
  H.tick(1.5);
  assert.ok(seen.soaked && seen.soaked.entities.includes(p), 'soaked you');
  assert.ok(seen.extinguish && seen.extinguish.radius > 1, 'extinguish');
  assert.ok(seen.knocked, 'knocked over');
  assert.ok(game.water.isWet(p) && game.water.isWet(crate));
  assert.ok(pushed > 0.5, `the crate was pushed away (${pushed})`);
  assert.equal(p.controls, true, 'back on your feet');
  assert.equal(game.water.dump('Nobody here'), null);
});

test('water: the bucket throws its water and refills', () => {
  const game = world({});
  const p = game.player;
  p.tool = { type: 'bucket', volume: 2 };
  H.tick(0.2);
  assert.equal(H.tools.held.name, 'bucket');
  const ev: string[] = [];
  game.on('bucket', () => ev.push('throw'));
  game.on('splash', (d: any) => { if (d.bucket) ev.push('splash'); });
  press('wateruse');
  H.tick(2);
  assert.deepEqual(ev, ['throw', 'splash']);
  assert.equal(H.tools.held.ctx.state.full, true, 'refilled');
  p.tool = null;
  H.tick(0.1);
});

// ------------------------------------------------------------------ fishing
test('water: fish live by water kind; custom species; a cast, a bite, the reel-in and a catch', () => {
  const game = world({ water: { level: -0.5, waves: 0.1 } }, { pool: { id: 'pool', type: 'water', name: 'Pool', transform: { position: [0, 0.8, 0] }, shape: { size: [4, 1.6, 4], basin: true } } });
  const sea = game.water.bodies().find((b: any) => b.kind === 'ocean');
  const pool = game.water.bodies().find((b: any) => b.kind === 'box');
  assert.ok(game.water.fish.in(sea).every((s: any) => s.water !== 'fresh'), 'salt water: no freshwater fish');
  assert.equal(game.water.fish.in(pool).length, 0, 'pools have no fish unless you say so');
  game.water.fish.add({ id: 'glowfin', name: 'Glowfin', rarity: 'rare', water: 'salt', kg: [1, 2] });
  assert.ok(game.water.fish.in(sea).some((s: any) => s.id === 'glowfin'));
  for (let i = 0; i < 30; i++) { const f = game.water.fish.roll(sea); assert.ok(f && f.weight > 0 && f.length > 0 && f.points >= 1); }
  game.water.fish.remove('glowfin');

  const p = game.player;
  p.position = [19, 0.95, 0];
  H.world.camera.yaw = Math.PI / 2;
  H.world.camera.pitch = -0.1;
  p.tool = 'fishing-rod';
  H.tick(0.3);
  const st = () => H.tools.held.ctx.state;
  const ev: string[] = [];
  let caught: any = null;
  for (const n of ['cast', 'bite', 'hooked']) game.on(n, () => ev.push(n));
  game.on('catch', (d: any) => { caught = d; });
  key('keydown', 'wateruse');
  H.tick(0.7);
  key('keyup', 'wateruse');
  H.tick(2.5);
  assert.equal(st().phase, 'waiting', `the bobber is in the water (${st().phase})`);
  assert.ok(game.water.inWater([st().bob.x, st().bob.y - 0.2, st().bob.z]));
  st().waited = st().wait;
  H.tick(1 / 60);
  assert.equal(st().phase, 'bite');
  press('wateruse');
  H.tick(1 / 60);
  assert.equal(st().phase, 'reel');
  for (let i = 0; i < 3000 && st().phase === 'reel'; i++) {
    const r = st().reel;
    if (r.tension > 0.65) key('keyup', 'wateruse'); else if (r.tension < 0.45) key('keydown', 'wateruse');
    H.tick(1 / 60);
  }
  key('keyup', 'wateruse');
  assert.equal(st().phase, 'show', 'landed it');
  assert.deepEqual(ev, ['cast', 'bite', 'hooked']);
  assert.ok(caught && caught.mine && caught.fish.weight > 0 && caught.fish.name);
  const j = game.water.fish.journal();
  assert.equal(j.total, 1);
  assert.equal(j.fish[caught.fish.id].count, 1);
  clean();
  p.tool = null;
  H.tick(0.1);
});

// ------------------------------------------------------------------ weather
test('water: rain turns on and off with config.weather', () => {
  const game = world({ water: { level: -1 }, weather: 'storm' });
  assert.equal(game.water.rain, 1);
  H.tick(2.5);
  H.applyOps([{ op: 'config', patch: { weather: 'drizzle' } }]);
  assert.ok(game.water.rain > 0 && game.water.rain < 0.5);
  H.applyOps([{ op: 'config', patch: { weather: null } }]);
  assert.equal(game.water.rain, 0);
  clean();
});

test('water: a world full of floating things keeps up', () => {
  const game = world({ water: { level: 0 } });
  for (let i = 0; i < 150; i++) game.box({ size: 0.6, x: 22 + (i % 10) * 1.2, y: 1 + Math.floor(i / 10) * 0.8, z: -6 + (i % 7), physics: 'dynamic', name: 'Crate' });
  const t0 = performance.now();
  H.tick(2);
  const ms = (performance.now() - t0) / 120;
  assert.ok(ms < 40, `a step with 150 floating crates took ${ms.toFixed(1)} ms`);
});
