// The vehicles module (public/play/modules/vehicles) in the real engine, headless (test/engine/harness.ts): every
// vehicle builds and settles on its wheels or hull, cars drive and steer, the 4x4 climbs, boats float, subs dive,
// planes take off, helicopters hover, crashes throw things, explosions throw vehicles, scripts drive them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const errors: string[] = [];
const report = H.report;
H.report = (err: any, file?: string) => { errors.push(`${file || ''}: ${(err && err.message) || err}`); return report(err, file); };
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const lake = { type: 'box', tag: 'water', physics: 'none', shape: { size: [120, 6, 120] }, transform: { position: [0, 3, 0] } };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };
const keys = () => H.input.held as Set<string>;
const hold = (k: string[], seconds: number) => { for (const x of k) keys().add(x); H.tick(seconds); for (const x of k) keys().delete(x); };
const TYPES = ['car', 'truck', 'bicycle', 'motorbike', 'boat', 'submarine', 'airplane', 'helicopter'];
const rest = (t: string) => H.vehicles.restHeight(H.vehicles.types[t]);

test('every vehicle is a kind the engine knows, with a maker and a codex page', () => {
  for (const t of [...TYPES, 'vehicle']) assert.ok(H.kinds.has(t), `${t} is registered`);
  world(H, sceneOf({ floor, start }));
  for (const t of TYPES) assert.equal(typeof H.game[t], 'function', `game.${t}()`);
  assert.ok(H.game.vehicles, 'game.vehicles is there for scripts');
  for (const t of TYPES) {
    const k = H.kinds.get(t);
    assert.equal(k.codex.group, 'Vehicles');
    assert.equal(k.codex.spec.type, t);
  }
});

test('each vehicle builds from scene.json and settles on its wheels (or hull), then sleeps', () => {
  const ents: Record<string, any> = { floor, start };
  TYPES.filter((t) => t !== 'boat' && t !== 'submarine').forEach((t, i) => { ents[t] = { type: t, transform: { position: [i * 12 - 30, rest(t) + 0.6, 20] } }; });
  ents.monster = { type: 'vehicle', shape: { vehicle: '4x4' }, transform: { position: [40, 2, 20], scale: 1.4 } };
  world(H, sceneOf(ents));
  H.tick(4);
  for (const t of TYPES.filter((x) => x !== 'boat' && x !== 'submarine')) {
    const e = H.game.entity(t);
    assert.ok(e && e.vehicle, `${t} built`);
    assert.ok(Math.abs(e.y - rest(t)) < 0.25, `${t} rests at its height (${e.y.toFixed(2)} vs ${rest(t).toFixed(2)})`);
    assert.ok(e.vehicle.up.y > 0.97, `${t} is upright`);
    assert.ok(e.speed < 0.3, `${t} is still (${e.speed.toFixed(2)})`);
  }
  const m = H.game.entity('monster');
  assert.equal(m.vehicle.type, 'truck');
  assert.ok(m.vehicle.def.scale === 1.4 && m.y > rest('truck'), 'a bigger 4x4 from the general vehicle kind');
});

test('a car: get in, drive, steer, brake, get out', () => {
  world(H, sceneOf({ floor, start, car: { type: 'car', transform: { position: [0, rest('car'), 4] } } }));
  const car = H.game.entity('car');
  let entered: any = null, exited: any = null;
  H.game.on('enter', (d: any) => { entered = d; });
  car.on('exit', (d: any) => { exited = d; });
  H.tick(0.5);
  assert.ok(H.game.vehicles.enter(car));
  H.tick(0.1);
  assert.equal(H.game.vehicles.current, car);
  assert.equal(H.world.player.controller, 'drive');
  assert.ok(entered && entered.vehicle === car && entered.driver && entered.me, "'enter' heard");
  hold(['w'], 3);
  assert.ok(car.speed > 15, `it drives (${car.speed.toFixed(1)} m/s)`);
  assert.ok(car.z > 25, `forward (+z) (${car.z.toFixed(1)})`);
  const yaw0 = car.rotation;
  hold(['w', 'd'], 1);
  assert.ok(car.rotation - yaw0 > 20, `D turns it right (${(car.rotation - yaw0).toFixed(1)}°)`);
  hold(['s'], 1.2);
  assert.ok(car.speed < 6, `S brakes (${car.speed.toFixed(1)})`);
  H.game.vehicles.exit();
  H.tick(0.3);
  assert.equal(H.game.vehicles.current, null);
  assert.equal(H.world.player.controller, 'walk');
  assert.ok(exited && exited.vehicle === car && exited.seat === 0, "'exit' heard on the car");
  assert.ok(H.world.player.distanceTo(car) < 5, 'out beside it');
});

test('the 4x4 climbs a steep ramp, and drives up a terrain hill (H.terrain)', () => {
  const ramp = { type: 'box', shape: { size: [8, 0.5, 30] }, transform: { position: [0, 6.2, 20], rotation: [-25, 0, 0] } };
  world(H, sceneOf({ floor, start, ramp, truck: { type: 'truck', transform: { position: [0, rest('truck'), -3] } } }));
  const t = H.game.entity('truck');
  H.game.vehicles.enter(t);
  let top = 0;
  for (let i = 0; i < 45; i++) { hold(['w'], 0.1); top = Math.max(top, t.y); }
  assert.ok(top > 9, `up the 25° ramp (top y ${top.toFixed(1)})`);
  // The Terrain module's contract: heights only (no collider needed for the wheels).
  H.terrain = { heightAt: (x: number, z: number) => (z > 0 ? Math.min(30, z * 0.45) : 0), normalAt: () => { const n = [0, 1, -0.45]; const l = Math.hypot(...n); return n.map((x) => x / l); } };
  try {
    world(H, sceneOf({ start, truck: { type: 'truck', transform: { position: [0, rest('truck') + 0.2, -5] } } }));
    const t2 = H.game.entity('truck');
    H.game.vehicles.enter(t2);
    hold(['w'], 5);
    assert.ok(t2.y > 10, `up the hill (y ${t2.y.toFixed(1)}, z ${t2.z.toFixed(1)})`);
  } finally { delete H.terrain; }
});

test('a 4x4 parked on a 20° slope settles and stays still (facing down it or across it, empty or with you in it)', () => {
  const low = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -20.5, 0] } };
  for (const [yaw, inside] of [[0, false], [90, false], [0, true], [90, true]] as const) {
    const slope = { type: 'box', shape: { size: [30, 1, 40] }, transform: { position: [0, 0, 0], rotation: [-20, 0, 0] } };
    world(H, sceneOf({ floor: low, start: { type: 'spawn', transform: { position: [-30, -20, 0] } }, slope, truck: { type: 'truck', transform: { position: [0, 0.55 + rest('truck') + 0.1, 0], rotation: [-20, yaw, 0] } } }));
    const t = H.game.entity('truck');
    if (inside) H.game.vehicles.enter(t);
    const what = `${yaw ? 'across' : 'down'} the slope, ${inside ? 'you in it' : 'empty'}`;
    H.tick(2.5);
    const at = [t.x, t.y, t.z];
    let ys = [Infinity, -Infinity];
    for (let i = 0; i < 180; i++) { H.tick(1 / 60); ys = [Math.min(ys[0], t.y), Math.max(ys[1], t.y)]; }
    const moved = Math.hypot(t.x - at[0], t.y - at[1], t.z - at[2]);
    assert.ok(moved < 0.03, `${what}: it stays where it stopped (moved ${moved.toFixed(3)} m in 3 s)`);
    assert.ok(ys[1] - ys[0] < 0.01, `${what}: no bouncing (${(ys[1] - ys[0]).toFixed(3)} m up and down)`);
    assert.ok(t.vehicle.wheels.every((w: any) => w.contact), `${what}: on all four wheels`);
    if (!inside) assert.ok(t.vehicle.sleeping, `${what}: and it sleeps`);
    else { assert.ok(t.vehicle.seats[0].who, 'you are at the wheel'); H.game.vehicles.exit(); }
  }
});

test('two wheels stay up; a bicycle hops', () => {
  world(H, sceneOf({ floor, start, bike: { type: 'bicycle', transform: { position: [0, rest('bicycle'), 3] } }, moto: { type: 'motorbike', transform: { position: [6, rest('motorbike'), 3] } } }));
  const bike = H.game.entity('bike');
  H.game.vehicles.enter(bike);
  hold(['w'], 2);
  hold(['w', 'a'], 1.5);
  assert.ok(bike.vehicle.up.y > 0.8, 'still up after turning');
  assert.ok(bike.speed > 5, 'pedalling');
  let top = 0;
  keys().add(' ');
  keys().add('space');
  for (let i = 0; i < 20; i++) { H.tick(1 / 30); top = Math.max(top, bike.y); }
  keys().delete('space');
  assert.ok(top > rest('bicycle') + 0.4, `space hops (${top.toFixed(2)})`);
  H.game.vehicles.exit();
  const moto = H.game.entity('moto');
  H.game.vehicles.enter(moto);
  hold(['w'], 3);
  assert.ok(moto.speed > 25 && moto.vehicle.up.y > 0.9, `the motorbike is fast and upright (${moto.speed.toFixed(1)})`);
});

test('crashing into loose things throws them; walls stop it', () => {
  const crates: Record<string, any> = {};
  for (let i = 0; i < 4; i++) crates[`crate${i}`] = { type: 'box', physics: 'dynamic', shape: { size: 1 }, transform: { position: [i * 1.1 - 1.6, 0.5, 25] } };
  const wall = { type: 'box', shape: { size: [20, 4, 1] }, transform: { position: [0, 2, 70] } };
  world(H, sceneOf({ floor, start, wall, ...crates, car: { type: 'car', transform: { position: [0, rest('car'), 0] } } }));
  const car = H.game.entity('car');
  H.game.vehicles.enter(car);
  let fastest = 0;
  for (let i = 0; i < 90; i++) { keys().add('w'); H.tick(1 / 30); for (let c = 0; c < 4; c++) fastest = Math.max(fastest, Math.hypot(...H.game.entity(`crate${c}`).velocity)); }
  assert.ok(fastest > 8, `crates flew (${fastest.toFixed(1)} m/s)`);
  hold(['w'], 4);
  assert.ok(car.z < 69.5, `the wall stopped it (z ${car.z.toFixed(1)})`);
  assert.ok(car.health < 100, `and it got hurt (${car.health})`);
});

test('a boat floats and drives on water; a submarine dives and comes back up', () => {
  world(H, sceneOf({ floor, start, lake, boat: { type: 'boat', transform: { position: [0, 7, 0] } }, sub: { type: 'submarine', transform: { position: [20, 6.5, 0] } } }));
  H.tick(4);
  const boat = H.game.entity('boat'), sub = H.game.entity('sub');
  assert.ok(boat.y > 5.2 && boat.y < 6.4, `the boat floats at the surface (y ${boat.y.toFixed(2)}, water at 6)`);
  assert.ok(sub.y > 4.5, `the submarine floats surfaced (y ${sub.y.toFixed(2)})`);
  H.game.vehicles.enter(boat);
  hold(['w'], 3);
  assert.ok(boat.speed > 12 && boat.y > 5, `it speeds over the water (${boat.speed.toFixed(1)} m/s)`);
  H.game.vehicles.exit();
  H.tick(0.2);
  H.game.vehicles.enter(sub);
  hold(['c'], 3);
  H.tick(2);
  assert.ok(sub.y < 3.5, `C dives (y ${sub.y.toFixed(2)})`);
  const deep = sub.y;
  H.tick(2);
  assert.ok(Math.abs(sub.y - deep) < 1.2, `let go and it holds its depth (${deep.toFixed(2)} → ${sub.y.toFixed(2)})`);
  hold(['space'], 3);
  H.tick(3);
  assert.ok(sub.y > 4.5, `space brings it back up (y ${sub.y.toFixed(2)})`);
});

test('an airplane takes off and flies; a helicopter climbs, hovers and lands', () => {
  world(H, sceneOf({ floor, start, plane: { type: 'airplane', transform: { position: [0, rest('airplane'), -150] } }, heli: { type: 'helicopter', transform: { position: [30, rest('helicopter'), 0] } } }));
  const plane = H.game.entity('plane');
  H.tick(1);
  H.game.vehicles.enter(plane);
  hold(['w'], 8);
  assert.ok(plane.speed > 24, `rolled to take-off speed (${plane.speed.toFixed(1)})`);
  hold(['s'], 1.5);
  H.tick(2);
  assert.ok(plane.y > 8, `it flies (altitude ${plane.y.toFixed(1)})`);
  assert.ok(!plane.vehicle.stalled, 'without stalling');
  H.game.vehicles.exit();
  const heli = H.game.entity('heli');
  heli.position = [30, rest('helicopter'), 0];
  H.game.vehicles.enter(heli);
  H.tick(1.5);
  hold(['space'], 2.5);
  const hi = heli.y;
  assert.ok(hi > 12, `space climbs (${hi.toFixed(1)})`);
  H.tick(2);
  const held = heli.y;
  H.tick(1);
  assert.ok(heli.y < held - 2, `let go, it coasts down (${held.toFixed(1)} → ${heli.y.toFixed(1)})`);
  hold(['w'], 2);
  assert.ok(heli.vehicle.vel.length() > 6, 'W flies it forward');
  hold(['c'], 4);
  H.tick(2);
  assert.ok(heli.y < rest('helicopter') + 0.6, `C brings it down (${heli.y.toFixed(2)})`);
});

test('explosions throw vehicles and hurt them; enough of them wrecks one and throws you out', () => {
  world(H, sceneOf({ floor, start, car: { type: 'car', transform: { position: [0, rest('car'), 5] } } }));
  const car = H.game.entity('car');
  H.tick(1);
  H.game.vehicles.enter(car);
  H.tick(0.2);
  H.physics.explode([1.5, 0, 5], { radius: 6, force: 20, damage: 60 });
  let top = 0;
  for (let i = 0; i < 30; i++) { H.tick(1 / 30); top = Math.max(top, car.y); }
  assert.ok(top > rest('car') + 0.8, `thrown up (${top.toFixed(2)})`);
  assert.ok(car.health < 70, `hurt (${car.health.toFixed(0)})`);
  H.physics.explode([car.x, car.y, car.z], { radius: 6, force: 5, damage: 120 });
  H.tick(0.5);
  assert.ok(car.wrecked, 'wrecked');
  assert.equal(H.game.vehicles.current, null, 'you were thrown out');
  H.tick(0.5);
  assert.ok(!H.game.vehicles.enter(car) || H.game.vehicles.current === null, 'a wreck takes no driver');
  car.repair();
  assert.ok(!car.wrecked && car.health === 100, 'repair() fixes it');
});

test('scripts: makers, make(), seats, passengers, NPC drivers and autopilot', () => {
  world(H, sceneOf({ floor, start }), {
    scripts: { 'scripts/v.js': "game.state.car = game.car({ x: 0, z: 6, color: '#3366ff', name: 'Blue' }); game.state.jeep = game.vehicles.make('4x4', { x: 8, z: 6 });" },
  });
  const car = H.game.state.car, jeep = H.game.state.jeep;
  assert.ok(car.vehicle && car.vehicle.type === 'car' && car.name === 'Blue');
  assert.equal(jeep.vehicle.type, 'truck');
  assert.throws(() => H.game.vehicles.make('zeppelin'), /No vehicle called/);
  H.tick(1);
  // An NPC drives; the player gets the passenger seat.
  const npc = H.game.capsule({ x: 3, y: 1, z: 6, physics: 'dynamic', name: 'Friend' });
  assert.ok(H.game.vehicles.board(jeep, npc, 0));
  assert.equal(jeep.driver, npc);
  H.game.vehicles.enter(jeep);
  H.tick(0.1);
  assert.equal(H.game.vehicles.seat, 1, 'a passenger next to the NPC');
  H.game.vehicles.drive(jeep, { speed: 8, steer: 0 });
  H.tick(3);
  assert.ok(jeep.speed > 5, `the NPC drives it (${jeep.speed.toFixed(1)})`);
  assert.ok(H.world.player.distanceTo(jeep) < 2.5, 'the passenger rides along');
  H.game.vehicles.drive(jeep, null);
  H.game.vehicles.exit();
  H.game.vehicles.unboard(npc);
  assert.ok(!npc._vehRider && npc.physics === 'dynamic', 'the NPC is out');
  // Autopilot circles (the codex shows each vehicle this way).
  car.autopilot = { speed: 6, steer: 1 };
  const a = car.rotation;
  H.tick(2);
  assert.ok(Math.abs(car.rotation - a) > 40, 'autopilot drives in a circle');
  assert.deepEqual(H.game.vehicles.list('car'), [car]);
});

test('the codex spec of every vehicle builds and runs cleanly', () => {
  for (const t of [...TYPES, 'vehicle']) {
    const spec = { id: 'thing', ...H.kinds.get(t).codex.spec };
    world(H, sceneOf({ floor, thing: spec }), { mode: 'build' });
    H.tick(1);
    assert.ok(H.game.entity('thing').vehicle, `${t} built`);
  }
});

test('with the Water module: boats float on its water (H.water.buoyancy), subs dive in it', () => {
  const pond = { type: 'water', name: 'Lake', shape: { size: [120, 8, 120] }, transform: { position: [0, 4, 0] } };
  world(H, sceneOf({ floor, start, pond, boat: { type: 'boat', transform: { position: [0, 9, 0] } }, sub: { type: 'submarine', transform: { position: [20, 8.5, 0] } } }));
  assert.ok(H.water && typeof H.water.buoyancy === 'function', 'the Water module is loaded');
  H.tick(5);
  const boat = H.game.entity('boat'), sub = H.game.entity('sub');
  const s = H.water.surfaceAt(boat.x, boat.z);
  assert.ok(Math.abs(boat.y - s) < 0.9, `the boat floats on its surface (y ${boat.y.toFixed(2)}, surface ${s.toFixed(2)})`);
  H.game.vehicles.enter(boat);
  hold(['w'], 3);
  assert.ok(boat.speed > 10 && Math.abs(boat.y - H.water.surfaceAt(boat.x, boat.z)) < 1.2, `it speeds over it (${boat.speed.toFixed(1)} m/s)`);
  H.game.vehicles.exit();
  H.tick(0.2);
  const top = sub.y;
  H.game.vehicles.enter(sub);
  hold(['c'], 3);
  H.tick(2);
  assert.ok(sub.y < top - 1.5, `C dives (${top.toFixed(2)} → ${sub.y.toFixed(2)})`);
  hold(['space'], 3);
  H.tick(4);
  assert.ok(sub.y > top - 1, `space surfaces (${sub.y.toFixed(2)})`);
});

test('for other modules: near, nearest (a point too), board with { driver }', () => {
  world(H, sceneOf({ floor, start, car: { type: 'car', transform: { position: [0, rest('car'), 6] } } }));
  H.tick(0.5);
  const car = H.game.entity('car');
  assert.equal(H.vehicles.near([0, 1, 8], 3), car);
  assert.equal(H.vehicles.nearest([0, 1, 30], 3), null);
  assert.equal(H.vehicles.nearest([0, 1, 30], 50), car);
  assert.ok(H.vehicles.kinds.includes('truck'));
  const friend = H.game.capsule({ x: 2, y: 1, z: 6, physics: 'dynamic', name: 'Max' });
  assert.ok(H.vehicles.board(car, friend, { driver: true }));
  assert.equal(car.driver, friend);
  const other = H.game.capsule({ x: 3, y: 1, z: 6, physics: 'dynamic', name: 'Sam' });
  assert.ok(H.vehicles.board(car, other, { driver: true }), 'a passenger when the wheel is taken');
  assert.notEqual(car.driver, other);
  assert.equal(H.vehicles.useOffer(H.game.player), null, 'too far to get in');
  H.game.player.position = [1.5, 1, 6];
  H.tick(0.1);
  const o2 = H.vehicles.useOffer(H.game.player);
  assert.ok(o2 && /Ride in the car/.test(o2.label), 'E offers a ride (the friend drives)');
});

test('no errors were reported along the way', () => {
  assert.deepEqual(errors, []);
});
