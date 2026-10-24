// The core seams modules share (public/play: runtime.js, physics.js, net.js, use.js): H.hooks.game, the one
// 'explosion' event, H.use (E near things), H.audio, and physics details (velocities kept across a remade body, impact
// speed against fixed things, a rolled ball's box, shape keys). Runs the real engine in Node (harness.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', shape: { size: [60, 1, 60] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, -8] } };

test('H.hooks.game: modules add to every new game object before scripts run (no window.game wrappers)', () => {
  const seen: any[] = [];
  H.hooks.game.push((g: any) => { g.testThing = 42; seen.push(g); });
  world(H, sceneOf({ floor }), { scripts: { 'scripts/main.js': 'game.state.sawIt = game.testThing; game.state.mods = [typeof game.water, typeof game.spawnMany, typeof game.living, typeof game.terrain].join(",");' } });
  assert.equal(H.game.state.sawIt, 42, 'a script saw it');
  assert.equal(seen[seen.length - 1], H.game);
  assert.equal(H.game.state.mods.replace(/^function/, 'object'), 'object,function,object,object', 'water, mayhem, living and terrain are there for the first script line');
  const d = Object.getOwnPropertyDescriptor(globalThis, 'game');
  assert.ok(d && !d.get && !d.set, 'window.game is a plain value');
  H.hooks.game.pop();
});

test('one explosion event per blast: H.physics.explode, H.sync.explode, Mayhem and the launcher', () => {
  world(H, sceneOf({ floor, start }));
  H.tick(0.2);
  const events: any[] = [], mods: any[] = [];
  H.game.on('explosion', (d: any) => events.push(d));
  const off = H.physics.on('explosion', (d: any) => mods.push(d));
  H.physics.explode([0, 0.5, 0], { radius: 4, force: 10, damage: 5 });
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].position, events[0].radius, events[0].force, events[0].damage, events[0].authoritative], [[0, 0.5, 0], 4, 10, 5, true]);
  H.physics.explode([0, 0.5, 0], { radius: 4, force: 0, damage: 5, event: false });
  assert.equal(events.length, 1, 'a damage-only second call says nothing');
  H.sync.explode([3, 0.5, 0], { radius: 5, force: 12, damage: 20 });
  assert.equal(events.length, 2);
  assert.ok(events[1].authoritative && events[1].damage === 20, 'playing alone, this player decides');
  H.mayhem.explode([6, 0.5, 0], { radius: 3, force: 8, fire: true });
  assert.equal(events.length, 3, 'mayhem: one event');
  assert.ok(events[2].fire && events[2].mayhem, 'with its own fields');
  assert.equal(mods.length, 3, 'modules hear the same ones');
  off();
});

test('H.use: E does the best thing on offer (priority, then the nearest); offers can have their own key', () => {
  world(H, sceneOf({ floor, start, star: { type: 'creature', name: 'Star', shape: { species: 'horse' }, transform: { position: [0, 1, -6] } } }));
  const p = H.game.player;
  H.tick(0.5);
  let did = '';
  const offA = H.use.register('test:far', { near: () => ({ label: 'Far thing', distance: 9, act: () => { did = 'far'; } }) });
  const offB = H.use.register('test:key', { keys: ['k'], near: () => ({ label: 'Keyed', key: 'k', distance: 50, act: () => { did = 'key'; } }) });
  const horse = H.game.entity('star');
  horse.living.tame = true;
  p.position = [horse.x, 1, horse.z - 2.2];
  H.tick(1 / 60);
  assert.equal(H.use.offers()[0].label, 'Ride the horse', 'the horse is nearest');
  press('e');
  assert.equal(p.controller, 'ride', 'E rode it');
  assert.equal(H.use.offers()[0].label, 'Get off', 'riding: getting off comes first');
  press('e');
  assert.equal(p.controller, 'walk', 'E again: off (once per press, not straight back on)');
  press('k');
  assert.equal(did, 'key', 'an offer\'s own key');
  p.position = [20, 1, 20];
  H.tick(0.3);
  assert.equal(H.use.offers()[0].label, 'Far thing');
  offA(); offB();
  assert.ok(!H.use.list().includes('test:far'));
});
// A key press as the page makes one (a touch button: pressed for the next step, held until let go).
function press(k: string) {
  const b: any = { addEventListener(t: string, f: Function) { b[t] = f; }, style: {} };
  H.bindTouchKey(b, k);
  b.pointerdown({ preventDefault() {}, stopPropagation() {} });
  H.tick(1 / 60);
  b.pointerup();
  H.tick(0.1);
}

test('H.tick refreshes pressed keys like a frame does', () => {
  world(H, sceneOf({ floor, start }));
  let presses = 0, framePresses = 0;
  H.game.onUpdate(() => { if (H.game.input.pressed('j')) presses++; });
  H.hooks.frame.push((_dt: number, _r: boolean, pressed: Set<string>) => { if (pressed.has('j')) framePresses++; });
  const b: any = { addEventListener(t: string, f: Function) { b[t] = f; }, style: {} };
  H.bindTouchKey(b, 'j');
  b.pointerdown({ preventDefault() {}, stopPropagation() {} });
  H.tick(0.1);
  b.pointerup();
  assert.equal(presses, 1, 'pressed once in the steps');
  assert.equal(framePresses, 1, 'and in the frame (frame hooks and H.input.pressed see it)');
  H.tick(0.1);
  assert.equal(presses + framePresses, 2, 'and not again');
  H.hooks.frame.pop();
});

test('H.audio: one output for every sound (none in Node, and nothing breaks)', () => {
  world(H, sceneOf({ floor }));
  assert.equal(H.audio.context, null);
  assert.equal(H.audio.master, null);
  assert.equal(H.audio.effect('water', null), null);
  H.game.sound('nothing.mp3');
  H.mayhem.sound('boom');
  H.water.sound('splash');
});

test('physics: velocities survive a remade body; impact speed against fixed things; a rolled ball keeps its box', () => {
  world(H, sceneOf({ floor }));
  H.tick(0.2);
  const g = H.game;
  // Set in the same step the body is (re)made: new, reshaped, made dynamic, let go.
  const a = g.box({ x: 0, y: 3, z: 0, physics: 'dynamic' }); a.velocity = [10, 0, 0];
  const b = g.box({ x: 5, y: 3, z: 0, physics: 'dynamic' });
  const c = g.box({ x: -5, y: 3, z: 0, physics: 'static' });
  H.tick(0.1);
  H.physics.setShape(b, H.physics.shapes.sphere(0.5)); b.velocity = [10, 0, 0];
  c.physics = 'dynamic'; c.velocity = [10, 0, 0];
  H.tick(1 / 60);
  for (const [n, e] of [['new', a], ['reshaped', b], ['made dynamic', c]] as const) assert.ok(e.vx > 9, `${n}: ${e.vx}`);
  // A heavy crate dropped on the floor: the impact speed is how fast it fell, not that over the floor's "mass".
  const speeds: number[] = [];
  const off = H.physics.on('collision', ({ a: x, b: y, speed }: any) => { if (x === heavy || y === heavy) speeds.push(speed); });
  const heavy = g.box({ x: 10, y: 0.5 + 1.25, z: 10, physics: 'dynamic', mass: 200 });
  H.tick(1);
  off();
  const fall = Math.sqrt(2 * 24 * 1.25);
  assert.ok(speeds.length && Math.max(...speeds) < fall * 1.6 && Math.max(...speeds) > fall * 0.3, `impact ${Math.max(...speeds).toFixed(1)} m/s for a ${fall.toFixed(1)} m/s fall`);
  // A ball that rolled: its box is still the ball's.
  const ball = g.sphere({ x: -10, y: 0.6, z: -10, radius: 0.5, physics: 'dynamic' });
  H.tick(0.1);
  ball.velocity = [6, 0, 0];
  H.tick(1);
  assert.ok(Math.abs(ball.node.rotation.z) + Math.abs(ball.node.rotation.x) > 0.3, 'it rolled');
  assert.ok(ball.half.every((h: number) => Math.abs(h - 0.5) < 0.01), `its box: ${ball.half.map((h: number) => h.toFixed(2))}`);
});

test('physics: a heightfield with an id and version is not compared by its numbers', () => {
  world(H, sceneOf({ floor }));
  const e = H.game.box({ x: 0, y: -5, z: 0, physics: 'static' });
  const heights = new Float32Array(65 * 65);
  let calls = 0;
  const orig = JSON.stringify;
  (JSON as any).stringify = function (...args: any[]) { if (args[0] && args[0].heights === heights) calls++; return orig.apply(JSON, args as any); };
  try {
    H.physics.setShape(e, H.physics.shapes.heightfield({ width: 20, depth: 20, rows: 65, cols: 65, heights, id: 'hills', version: 1 }));
    H.tick(0.5);
  } finally { (JSON as any).stringify = orig; }
  assert.equal(calls, 0, 'never written out');
  const body = H.physics.bodyOf(e);
  H.tick(0.1);
  assert.equal(H.physics.bodyOf(e), body, 'the same body while the version stays');
  H.physics.setShape(e, H.physics.shapes.heightfield({ width: 20, depth: 20, rows: 65, cols: 65, heights, id: 'hills', version: 2 }));
  H.tick(1 / 60);
  assert.notEqual(H.physics.bodyOf(e), body, 'a new version: remade');
});

test('features can have a codex page (the codex shows world features)', () => {
  for (const key of ['terrain', 'water', 'weather', 'mayhem']) {
    const f = H.features.get(key);
    assert.ok(f && f.codex && f.codex.what && f.codex.value !== undefined, `${key} has a codex`);
  }
});

test('instanced copies don\'t set receiveShadows on instances (Babylon warns for each)', () => {
  world(H, sceneOf({ floor }, { shadows: true }));
  const warn = console.warn; const said: string[] = [];
  (console as any).warn = (...a: any[]) => { said.push(a.join(' ')); };
  const B = (globalThis as any).BABYLON;
  const log = B.Logger.Warn; B.Logger.Warn = (m: string) => said.push(m);
  try { H.game.many(20, (i: number) => ({ type: 'box', x: i, y: 0.5, z: 3, color: '#ff0000' })); H.tick(0.1); }
  finally { (console as any).warn = warn; B.Logger.Warn = log; }
  assert.ok(!said.some((s) => /receiveShadows/i.test(s)), said.join('\n'));
});
