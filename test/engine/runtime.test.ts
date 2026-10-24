// The game engine itself (public/play), run in Node: Babylon's NullEngine, Havok's wasm and the same scripts a game page
// loads (test/engine/harness.ts). Each scenario builds a world from scene.json, steps it, and checks what happened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, world, sceneOf } from './harness.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const H = await load({ extra: [path.join(HERE, 'sample-module.js')] });
const floor = { type: 'box', shape: { size: [40, 1, 40] }, transform: { position: [0, -0.5, 0] } };

test('Havok runs the physics', () => {
  world(H, sceneOf({ floor }));
  assert.equal(H.physics.engine, 'havok');
  assert.ok(H.world.havok, 'the world has a Havok world');
});

test('things fall, land and stack; resting things sleep', () => {
  world(H, sceneOf({
    floor,
    a: { type: 'box', physics: 'dynamic', transform: { position: [0, 2, 0] } },
    b: { type: 'box', physics: 'dynamic', transform: { position: [0.1, 4, 0], rotation: [0, 30, 0] } },
    c: { type: 'box', physics: 'dynamic', transform: { position: [-0.1, 6, 0] } },
    ball: { type: 'sphere', physics: 'dynamic', shape: { radius: 0.5 }, transform: { position: [5, 3, 0] } },
  }));
  H.tick(4);
  const y = (id: string) => H.game.entity(id).y;
  assert.ok(Math.abs(y('a') - 0.5) < 0.05, `a rests on the floor (${y('a')})`);
  assert.ok(Math.abs(y('b') - 1.5) < 0.08, `b rests on a (${y('b')})`);
  assert.ok(Math.abs(y('c') - 2.5) < 0.12, `c rests on b (${y('c')})`);
  assert.ok(Math.abs(y('ball') - 0.5) < 0.05, `the ball rests on the floor (${y('ball')})`);
  assert.ok(H.game.entity('a').sleeping, 'a resting crate sleeps');
});

test('a bouncy ball bounces, a pushed crate slides and stops, a falling thing is caught', () => {
  world(H, sceneOf({
    floor,
    ball: { type: 'sphere', physics: 'dynamic', shape: { radius: 0.4 }, transform: { position: [0, 5, 0] }, body: { bounce: 0.9 } },
    crate: { type: 'box', physics: 'dynamic', transform: { position: [5, 0.5, 0] } },
    faller: { type: 'box', physics: 'dynamic', transform: { position: [100, 5, 0] } },
  }));
  let up = false;
  const ball = H.game.entity('ball');
  H.game.onUpdate(() => { if (ball.vy > 2 && ball.y < 3) up = true; });
  H.game.entity('crate').push([6, 0, 0]);
  H.tick(3);
  assert.ok(up, 'the ball came back up');
  const crate = H.game.entity('crate');
  assert.ok(crate.x > 5.5 && crate.x < 12, `the crate slid (${crate.x})`);
  assert.ok(Math.abs(crate.vx) < 0.2, 'and stopped');
  const f = H.game.entity('faller');
  H.tick(2);
  assert.ok(f.alive && f.y > -10, `the fallen crate came back where it was (${f.y})`);
});

test('the player stands, walks up a slope and climbs a step', () => {
  const ramp = { type: 'box', shape: { size: [4, 0.4, 12] }, transform: { position: [0, 2.2, 8], rotation: [-25, 0, 0] } };
  const step = { type: 'box', shape: { size: [4, 0.3, 4] }, transform: { position: [10, 0.15, 3] } };
  world(H, sceneOf({ floor, ramp, step, start: { type: 'spawn', transform: { position: [0, 0, 0] } } }), { game: { player: { speed: 5 } } });
  const p = H.game.player;
  H.tick(0.5);
  assert.ok(p.grounded, 'standing');
  assert.ok(Math.abs(p.bottom) < 0.1, `on the floor (${p.bottom})`);
  p.controls = false;
  let dir = { x: 0, z: 1 };
  H.game.onUpdate(() => p.walk(dir, 5));
  H.tick(3.2);
  assert.ok(p.bottom > 2.5, `walked up the slope (bottom ${p.bottom.toFixed(2)}, z ${p.z.toFixed(2)})`);
  // The step (30 cm).
  p.position = [10, 1, -1]; p.velocity = [0, 0, 0];
  let top = 0;
  for (let i = 0; i < 60; i++) { H.tick(1 / 30); if (p.z > 1.5 && p.z < 4.5) top = Math.max(top, p.bottom); }
  assert.ok(top > 0.25, `climbed onto the step (bottom ${top.toFixed(2)} on it)`);
});

test('the player rides a moving platform', () => {
  world(H, sceneOf({
    floor,
    lift: { type: 'box', shape: { size: [4, 0.4, 4] }, transform: { position: [0, 1, 0] }, physics: 'kinematic' },
    start: { type: 'spawn', transform: { position: [0, 1.3, 0] } },
  }));
  const p = H.game.player;
  const lift = H.game.entity('lift');
  // Moved by a script in game time (the patrol behavior uses the shared clock, which a test can't hurry).
  H.game.onUpdate((dt: number, t: number) => { lift.x = Math.sin(t * 0.8) * 3; });
  H.tick(0.3);
  let max = 0;
  for (let i = 0; i < 90; i++) { H.tick(1 / 60); max = Math.max(max, Math.abs(p.x - lift.x)); }
  assert.ok(p.bottom > 1.1, `still on the lift (${p.bottom})`);
  assert.ok(max < 1.2, `carried along (${max.toFixed(2)} m behind at most)`);
});

test('200 bodies fall and settle inside the frame budget', () => {
  const entities: Record<string, any> = { floor };
  for (let i = 0; i < 200; i++) entities[`c${i}`] = { type: i % 3 ? 'box' : 'sphere', physics: 'dynamic', shape: i % 3 ? { size: 0.8 } : { radius: 0.4 }, transform: { position: [(i % 10) * 1.2 - 6, 1 + Math.floor(i / 100) * 1.2, (Math.floor(i / 10) % 10) * 1.2 - 6] } };
  world(H, sceneOf(entities));
  H.tick(0.2);
  const times: number[] = [];
  for (let i = 0; i < 180; i++) { const t = performance.now(); H.tick(1 / 60); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(`200 bodies: ${avg.toFixed(2)} ms a step on average, ${p95.toFixed(2)} ms at the 95th percentile`);
  assert.ok(avg < 8, `a step takes ${avg.toFixed(2)} ms on average (budget 8 ms of a 16.7 ms frame)`);
  const fell = [...H.world.entities].filter((e: any) => e.sceneId && e.sceneId !== 'floor' && e.y < 0);
  assert.equal(fell.length, 0, 'nothing fell through the floor');
});

test('every kind in the registry builds from its spec', () => {
  world(H, sceneOf({ floor }), { mode: 'build' });
  const kinds = H.kinds.list();
  assert.ok(kinds.length >= 17, 'the 16 kinds and the sample module\'s');
  for (const k of kinds) {
    const spec = JSON.parse(JSON.stringify(k.codex && k.codex.spec ? k.codex.spec : { type: k.name }));
    if (spec.shape && /^https:/.test(String(spec.shape.asset))) spec.shape.asset = 'not-made-yet.glb';
    spec.id = `k_${k.name}`;
    const [e] = H.applyOps([{ op: 'create', entity: spec }]);
    assert.ok(e && e.alive, `${k.name} built`);
    assert.equal(e.kind, k.name);
    assert.equal(H.game.entity(spec.id), e);
  }
  H.tick(0.5);
  for (const k of kinds) H.applyOps([{ op: 'delete', id: `k_${k.name}` }]);
  for (const k of kinds) assert.equal(H.game.entity(`k_${k.name}`), null, `${k.name} goes`);
});

test('a module in its own file adds a kind, a tool and a controller (runtime.js untouched)', () => {
  const runtime = fs.readFileSync(path.join(HERE, '..', '..', 'public', 'play', 'runtime.js'), 'utf8');
  for (const word of ['beacon', 'crate-gun', 'hover']) assert.ok(!runtime.includes(word), `runtime.js knows nothing of ${word}`);
  world(H, sceneOf({ floor, b1: { type: 'beacon', transform: { position: [3, 1.25, 0] } } }));
  assert.equal(H.game.entity('b1').kind, 'beacon');
  const made = H.game.beacon({ x: -3, y: 1 });
  assert.equal(made.kind, 'beacon');
  const p = H.game.player;
  p.tool = 'crate-gun';
  H.tick(0.1);
  assert.equal(H.tools.held && H.tools.held.name, 'crate-gun');
  const crate = H.tools.held.def.fire(H.tools.held.ctx);
  H.tick(1);
  assert.equal(crate.tag, 'crate-gun');
  assert.ok(Math.abs(crate.bottom) < 0.1, `its crate landed (${crate.bottom})`);
  p.control('hover', { height: 2 });
  assert.equal(p.controller, 'hover');
  H.tick(2);
  assert.ok(Math.abs(p.bottom - 2) < 0.2, `hovering 2 m up (${p.bottom})`);
  p.control('walk');
  H.tick(1.5);
  assert.ok(p.bottom < 0.15, 'and back down walking');
});

test('world features: one config key each, applied, changed and removed', () => {
  const seen: string[] = [];
  H.features.register('testfog', {
    apply(v: any, ctx: any) { seen.push(`apply ${v.n}`); ctx.state.n = v.n; },
    change(v: any, old: any) { seen.push(`change ${old.n}>${v.n}`); },
    update(dt: number, ctx: any) { ctx.state.t = (ctx.state.t || 0) + dt; },
    dispose() { seen.push('dispose'); },
  });
  world(H, sceneOf({ floor }, { testfog: { n: 1 } }));
  H.tick(0.5);
  H.applyOps([{ op: 'config', patch: { testfog: { n: 2 } } }]);
  H.applyOps([{ op: 'config', patch: { testfog: null } }]);
  assert.deepEqual(seen, ['apply 1', 'change 1>2', 'dispose']);
});

test('forces, impulses, joints and a heightfield', () => {
  world(H, sceneOf({
    floor,
    rocket: { type: 'box', physics: 'dynamic', shape: { size: 0.5 }, transform: { position: [0, 0.25, 0] }, body: { mass: 2 } },
    door: { type: 'box', physics: 'dynamic', shape: { size: [2, 3, 0.2] }, transform: { position: [8, 1.6, 0] } },
    heavy: { type: 'box', physics: 'dynamic', transform: { position: [-6, 0.5, 0] }, body: { mass: 10 } },
    light: { type: 'box', physics: 'dynamic', transform: { position: [-6, 0.5, 4] }, body: { mass: 1 } },
    hills: { type: 'box', physics: 'static', transform: { position: [0, 0, 20] }, shape: { size: [1, 0.1, 1] } },
    drop: { type: 'sphere', physics: 'dynamic', shape: { radius: 0.3 }, transform: { position: [0, 8, 20] } },
  }));
  const rocket = H.game.entity('rocket');
  H.game.onUpdate(() => rocket.force([0, 2 * 40, 0])); // more than its weight (2 kg x 24)
  // The door swings on a hinge on its left edge.
  const door = H.game.entity('door');
  const hinge = H.physics.joint('hinge', door, null, { pivotA: [-1, 0, 0], axis: [0, 1, 0] });
  assert.ok(hinge && hinge.constraint, 'the hinge is made');
  door.impulse([0, 0, 3], [8.9, 1.6, 0]);
  // The same kick moves the light crate ten times as far as the heavy one.
  H.game.entity('heavy').impulse([5, 0, 0]);
  H.game.entity('light').impulse([5, 0, 0]);
  // Hills: a heightfield 10 x 10 m, 2 m up in the middle.
  const n = 11, heights: number[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) heights.push(2 - Math.hypot(r - 5, c - 5) * 0.3);
  H.physics.setShape(H.game.entity('hills'), H.physics.shapes.heightfield({ width: 10, depth: 10, rows: n, cols: n, heights }));
  H.tick(1);
  assert.ok(rocket.y > 3, `the rocket rose (${rocket.y.toFixed(2)})`);
  // Turned around its hinge (x 7): its middle is still 1 m from it, wherever it swung.
  assert.ok(Math.abs(Math.hypot(door.x - 7, door.z) - 1) < 0.1 && Math.abs(door.rotation) > 5, `the door turned on its hinge (${door.rotation.toFixed(1)}°, at ${door.x.toFixed(2)}, ${door.z.toFixed(2)})`);
  const dh = H.game.entity('heavy').x + 6, dl = H.game.entity('light').x + 6;
  assert.ok(dl > dh * 3, `the light one went farther (${dl.toFixed(2)} vs ${dh.toFixed(2)})`);
  const drop = H.game.entity('drop');
  H.tick(2);
  assert.ok(drop.y > 1.2 && drop.y < 3, `the ball stopped on the hill (${drop.y.toFixed(2)})`);
  hinge.remove();
});

test('hit and leave fire as before (triggers, collectibles, things touching)', () => {
  world(H, sceneOf({
    floor,
    zone: { type: 'trigger', shape: { size: [2, 2, 2] }, transform: { position: [0, 1, 4] } },
    coin: { type: 'cylinder', shape: { radius: 0.35, height: 0.08 }, transform: { position: [0, 1, 2], rotation: [90, 0, 0] }, behaviors: [{ use: 'collectible' }] },
    start: { type: 'spawn', transform: { position: [0, 0, 0] } },
  }));
  const events: string[] = [];
  const zone = H.game.entity('zone');
  zone.on('hit', (o: any) => { if (o.isPlayer) events.push(`in ${o.tag}`); });
  zone.on('leave', (o: any) => { if (o.isPlayer) events.push(`out ${o.tag}`); });
  const p = H.game.player;
  p.controls = false;
  H.game.onUpdate(() => p.walk({ x: 0, z: 1 }, 4));
  H.tick(3);
  assert.equal(H.game.state.score, 1, 'the coin was collected');
  assert.deepEqual(events, ['in player', 'out player']);
});

test('explosions throw things (mass-aware) and hurt what has health', () => {
  world(H, sceneOf({
    floor,
    near: { type: 'box', physics: 'dynamic', transform: { position: [1.5, 0.5, 0] } },
    far: { type: 'box', physics: 'dynamic', transform: { position: [10, 0.5, 0] } },
    bot: { type: 'capsule', physics: 'dynamic', transform: { position: [-1.5, 0.9, 0] }, behaviors: [{ use: 'health', hp: 50 }] },
  }));
  H.tick(0.5);
  const hit = H.physics.explode([0, 0.3, 0], { radius: 5, force: 14, damage: 30 });
  assert.ok(hit.length >= 2);
  H.tick(0.2);
  assert.ok(H.game.entity('near').x > 2.2, 'the near crate flew');
  assert.ok(Math.abs(H.game.entity('far').x - 10) < 0.01, 'the far one did not');
  assert.ok(H.game.entity('bot').hp < 50, 'the bot was hurt');
});
