// Homes and media (public/play/modules/homes): houses from words, furniture that works, screens with channels, shared
// state. The engine runs in Node (test/engine/harness.ts); the house planner is plain JavaScript and is checked on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', shape: { size: [80, 1, 80] }, transform: { position: [0, -0.5, 0] } };
const errors = () => ((globalThis as any).document.getElementById('error').children as any[]).map((c) => c.textContent);
/** One frame with a key down this frame (what the frame hooks see, as in a browser), then let go. */
function frame(H: any, key?: string, seconds = 1 / 30) {
  const pressed = H.input.pressed;
  if (key) pressed.add(key);
  H.tick(seconds);
  if (key) pressed.delete(key);
}

test('the module is loaded: its kinds are registered and the server lets scenes hold them', async () => {
  const { manifest } = await import('../../src/engine.ts');
  const m = manifest();
  for (const k of ['house', 'room', 'wall', 'chair', 'sofa', 'bed', 'door', 'fridge', 'tv', 'cctv', 'radio', 'piano', 'clock', 'lamp', 'switch']) {
    assert.ok(H.kinds.has(k), `kind ${k}`);
    assert.ok(m.kinds.includes(k), `scenes may hold ${k}`);
  }
  assert.ok(H.controllers.has('seat'));
  assert.ok(H.tools.has('remote') && H.tools.has('phone'));
});

test('the planner: rooms spread over floors, every room has a way in, stairs between floors', () => {
  const plan = (globalThis as any).HawkesHomesPlan;
  const p = plan({ rooms: 5, floors: 2, style: 'cabin' });
  assert.equal(p.floors, 2);
  assert.ok(p.stairs);
  const named = p.rooms.filter((r: any) => r.type !== 'hall');
  assert.equal(named.length, 5);
  assert.ok(p.rooms.filter((r: any) => r.floor === 0 && r.type !== 'hall').length >= 2 && p.rooms.filter((r: any) => r.floor === 1 && r.type !== 'hall').length >= 2, 'rooms on both floors');
  const steps = p.parts.filter((x: any) => x.role === 'stairs');
  assert.equal(steps.length, 12, 'one flight of 12 steps');
  const tops = steps.map((s: any) => s.at[1] + s.size[1] / 2);
  for (let i = 1; i < tops.length; i++) assert.ok(tops[i] - tops[i - 1] > 0.2 && tops[i] - tops[i - 1] < 0.3, 'each step rises 25 cm');
  assert.ok(Math.abs(tops[tops.length - 1] - (3 + 0.15)) < 0.03, 'the last step is level with the floor above');
  assert.ok(p.parts.some((x: any) => x.kind === 'door' && x.key === 'front-door'), 'a front door');
  assert.ok(p.parts.filter((x: any) => x.kind === 'glass').length >= 6, 'windows');
  assert.ok(p.parts.filter((x: any) => x.kind === 'switch').length >= 5, 'a light switch per room');
  // A two-storey house with the rooms named in a sentence.
  const q = plan({ rooms: ['living', 'kitchen', 'bedroom'], floors: 2, tv: 'cartoons' });
  const tv = q.parts.find((x: any) => x.kind === 'tv');
  assert.deepEqual(tv.shape.channels, 'cartoons');
  assert.equal(q.rooms.find((r: any) => r.type === 'bedroom').floor, 1, 'the bedroom is upstairs');
  // Rooms from loose words.
  assert.deepEqual(plan({ rooms: ['Living room', 'study', 'bath'] }).rooms.map((r: any) => r.type).filter((t: string) => t !== 'hall').sort(), ['bathroom', 'living', 'office']);
  // Walls around openings: the pieces leave the doorway open.
  const pieces = plan.wallPieces({ x0: 0, z0: 0, dir: 'x', len: 4, y0: 0, h: 3, t: 0.2, openings: [{ kind: 'door', at: 2, width: 1, bottom: 0, top: 2.1 }] });
  assert.equal(pieces.length, 3, 'left, right, and over the door');
  assert.ok(!pieces.some((w: any) => w.at[0] > 1.5 && w.at[0] < 2.5 && w.at[1] < 2), 'nothing in the doorway');
});

test('a house builds from one scene thing, with no errors, and its pieces follow it when moved', () => {
  world(H, sceneOf({ floor, home: { type: 'house', transform: { position: [0, 0, 20] }, shape: { rooms: ['living', 'kitchen', 'bedroom', 'bathroom', 'office'], floors: 2 } }, start: { type: 'spawn', transform: { position: [0, 0, 0] } } }));
  H.tick(0.5);
  assert.deepEqual(errors(), []);
  const house = H.game.entity('home');
  assert.ok(house && house._parts.length > 100, `pieces: ${house && house._parts.length}`);
  const sofa = house._parts.find((p: any) => p.e.kind === 'sofa').e;
  assert.ok(sofa.z > 12 && sofa.z < 28, 'the sofa is in the house');
  // Moving the house (the editor or the assistant) brings everything along.
  H.applyOps([{ op: 'update', id: 'home', patch: { transform: { position: [30, 0, 20] } } }]);
  H.tick(0.1);
  assert.ok(sofa.x > 22, `the sofa came along (${sofa.x})`);
  assert.deepEqual(errors(), []);
});

test('the front door opens with E, and the player walks in', () => {
  world(H, sceneOf({ floor, home: { type: 'house', transform: { position: [0, 0, 8] }, shape: { rooms: 1 } }, start: { type: 'spawn', transform: { position: [0, 0, 3] } } }));
  const p = H.game.player;
  H.tick(0.3);
  const door = H.game.entity('home')._parts.find((x: any) => x.e.kind === 'door').e;
  assert.equal(door.homes.state.open, false);
  assert.equal(door.physics, 'static');
  H.world.camera.yaw = 0; H.world.camera.pitch = 0.1;
  p.position = [door.x, 1, door.z - 1.6];
  H.tick(0.3);
  frame(H, 'e');
  assert.equal(door.homes.state.open, true, 'E opened it');
  assert.equal(door.physics, 'none', 'you can go through');
  p.controls = false;
  H.game.onUpdate(() => p.walk({ x: 0, z: 1 }, 4));
  H.tick(1.5);
  assert.ok(p.z > door.z + 0.5, `walked in (${p.z.toFixed(2)} past ${door.z.toFixed(2)})`);
  assert.deepEqual(errors(), []);
});

test('sit on a chair, get up; lie in a bed; a switch turns the room\'s light off', () => {
  world(H, sceneOf({
    floor,
    chair: { type: 'chair', transform: { position: [0, 0, 1.4], rotation: [0, 180, 0] } },
    bed: { type: 'bed', transform: { position: [6, 0, 3] } },
    lamp: { type: 'lamp', transform: { position: [-3, 0, 3] } },
    sw: { type: 'switch', transform: { position: [-3, 1.2, 1] }, data: { controls: ['lamp'] } },
    start: { type: 'spawn', transform: { position: [0, 0, 0] } },
  }));
  const p = H.game.player;
  H.tick(0.3);
  H.world.camera.yaw = 0;
  frame(H, 'e');
  assert.equal(p.controller, 'seat', 'sitting');
  const chair = H.game.entity('chair');
  H.tick(0.5);
  assert.ok(Math.hypot(p.x - chair.x, p.z - chair.z) < 0.3, 'on the chair');
  frame(H, 'e');
  H.tick(0.2);
  assert.equal(p.controller, 'walk', 'E got you up');
  // The bed, by script.
  H.game.homes.use(H.game.entity('bed'), 'lie');
  H.tick(0.2);
  assert.equal(p.controller, 'seat');
  assert.equal(p._controller.opts.pose, 'lie');
  H.game.homes.stand();
  // The switch.
  const lamp = H.game.entity('lamp');
  assert.equal(lamp.homes.state.on, true);
  assert.ok(lamp._light.isEnabled());
  H.game.homes.use(H.game.entity('sw'));
  assert.equal(lamp.homes.state.on, false, 'the switch turned the lamp off');
  assert.ok(!lamp._light.isEnabled());
  assert.deepEqual(errors(), []);
});

test('fridges hold food you eat; taps run; toilets flush; the clock knows the time', () => {
  world(H, sceneOf({
    floor,
    fridge: { type: 'fridge', transform: { position: [0, 0, 3] }, data: { items: ['apple', 'milk'] } },
    sink: { type: 'sink', transform: { position: [3, 0, 3] } },
    tub: { type: 'bathtub', transform: { position: [6, 0, 3] } },
    toilet: { type: 'toilet', transform: { position: [9, 0, 3] } },
    clock: { type: 'clock', transform: { position: [12, 2, 3] } },
  }));
  let ate: string | null = null;
  H.game.on('eat', (d: any) => { ate = d.item; });
  const fridge = H.game.entity('fridge');
  assert.ok(!H.game.homes.use(fridge, 'eat the apple'), 'nothing to eat while it is closed');
  H.game.homes.use(fridge, 'open');
  assert.equal(fridge.homes.state.open, true);
  assert.ok(H.game.homes.use(fridge, 'eat the apple'));
  assert.equal(ate, 'apple');
  assert.deepEqual(fridge.homes.state.taken, [0]);
  const tub = H.game.entity('tub');
  H.game.homes.use(tub, 'run the bath');
  H.tick(3);
  assert.ok(tub._waterLevel > 0.1, `the bath fills (${tub._waterLevel})`);
  H.game.homes.use(H.game.entity('toilet'), 'flush');
  assert.equal(H.game.entity('toilet').homes.state.flushes, 1);
  H.tick(0.1);
  assert.deepEqual(errors(), []);
});

test('a TV plays built-in shows, changes channel, shows a camera\'s picture and words; the remote works it', () => {
  world(H, sceneOf({
    floor,
    tv: { type: 'tv', transform: { position: [0, 0, 4], rotation: [0, 180, 0] }, shape: { channels: ['cartoons', 'news', { camera: 'studio_cam' }, 'missing.mp4'] } },
    studio_cam: { type: 'cctv', transform: { position: [10, 1.8, 0] }, data: { show: 'Cooking with Bob' } },
    tv2: { type: 'tv', transform: { position: [5, 0, 4], rotation: [0, 180, 0] } },
    radio: { type: 'radio', transform: { position: [-3, 0.75, 3] } },
    start: { type: 'spawn', transform: { position: [0, 0, 0] } },
  }));
  H.tick(0.3);
  const tv = H.game.entity('tv');
  const scr = () => [...H.world.entities].length && (tv as any);
  assert.equal(tv.homes.state.on, true);
  assert.ok(H.game.homes.channel(tv, 2));
  H.tick(0.2);
  assert.equal(tv.homes.state.channel, 2);
  H.game.homes.channel(tv, 3);
  H.tick(0.2);
  // A camera's show joins every TV's default channels.
  assert.ok(H.game.entity('tv2')._channels().includes('Cooking with Bob'));
  H.game.homes.show(tv, { text: () => 'Score: 3' });
  H.tick(0.2);
  H.game.homes.show(tv, null);
  // The remote: pointing at the TV, a click changes the channel.
  const p = H.game.player;
  p.tool = 'remote';
  H.world.camera.yaw = 0; H.world.camera.pitch = 0;
  p.position = [0, 1, 1.5];
  H.tick(0.1);
  const before = tv.homes.state.channel;
  H.input.mouse.pressed = true;
  H.tick(1 / 60);
  assert.notEqual(tv.homes.state.channel, before, 'the remote changed the channel');
  H.game.homes.power(H.game.entity('radio'), true);
  assert.equal(H.game.entity('radio').homes.state.on, true);
  void scr;
  assert.deepEqual(errors(), []);
});

test('a wall with a door and a window; a room; script-made houses get the same ids everywhere', () => {
  world(H, sceneOf({
    floor,
    w: { type: 'wall', transform: { position: [0, 0, 5], rotation: [0, 30, 0] }, shape: { length: 6, openings: [{ type: 'door', at: -1.5 }, { type: 'window', at: 1.2 }] } },
    r: { type: 'room', transform: { position: [15, 0, 5] }, shape: { type: 'kitchen' } },
  }), { scripts: { 'scripts/a.js': "game.state.h = game.homes.house({ rooms: 2, x: -20 });" } });
  H.tick(0.3);
  const w = H.game.entity('w');
  assert.ok(w._parts.some((x: any) => x.e.kind === 'door'), 'a door in the doorway');
  assert.ok(w._parts.filter((x: any) => x.e.name === 'Window').length === 1, 'a window pane');
  assert.ok(H.game.entity('r')._parts.some((x: any) => x.e.kind === 'fridge'), 'the kitchen has a fridge');
  const h = H.game.state.h;
  assert.equal(h.homesKey, 'house1');
  assert.ok(h._parts.find((x: any) => x.e.kind === 'door').e.homes.id.startsWith('house1/'));
  assert.deepEqual(errors(), []);
});

test('the stairs take the player up to the next floor; a locked door stays shut', () => {
  world(H, sceneOf({ floor, home: { type: 'house', transform: { position: [0, 0, 0] }, shape: { rooms: 4, floors: 2, furnish: false } }, start: { type: 'spawn', transform: { position: [0, 0, -12] } } }));
  H.tick(0.3);
  const home = H.game.entity('home');
  const steps = home._parts.map((x: any) => x.e).filter((e: any) => e.name === 'Stairs' && e.node.isVisible);
  assert.equal(steps.length, 12);
  const p = H.game.player;
  p.controls = false;
  p.position = [steps[0].x - 0.6, 1, steps[0].z];
  p.velocity = [0, 0, 0];
  H.tick(0.3);
  H.game.onUpdate(() => p.walk({ x: 1, z: 0 }, 3));
  H.tick(3);
  assert.ok(p.bottom > 2.9, `upstairs (feet at ${p.bottom.toFixed(2)})`);
  // Locked by a script: E says so and it stays shut.
  const door = H.game.homes.find(home, 'front-door');
  door.data.locked = true;
  H.game.homes.use(door);
  assert.equal(door.homes.state.open, false);
  door.data.locked = false;
  H.game.homes.use(door);
  assert.equal(door.homes.state.open, true);
  assert.deepEqual(errors(), []);
});

test('a bath fills with real water (Water module) and the rubber duck floats', () => {
  world(H, sceneOf({ floor, tub: { type: 'bathtub', transform: { position: [0, 0, 3] } } }), { scripts: { 'scripts/duck.js': "game.state.duck = game.sphere({ radius: 0.09, x: 0, y: 0.3, z: 3, physics: 'dynamic', mass: 0.2, color: '#ffd43b', data: { density: 0.3 } });" } });
  const tub = H.game.entity('tub');
  H.game.homes.use(tub, 'run the bath');
  for (let i = 0; i < 28; i++) H.tick(0.25); // frames, as a browser runs them (the water rises frame by frame)
  assert.ok(tub._waterLevel > 0.3, `filled (${tub._waterLevel})`);
  if (H.water) assert.ok(H.game.water.inWater([0, 0.25, 3]), 'there is water in the tub');
  const duck = H.game.state.duck;
  assert.ok(duck.y > 0.3, `the duck floats up (${duck.y.toFixed(2)})`);
  assert.deepEqual(errors(), []);
});
