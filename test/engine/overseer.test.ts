// The Overseer module: the sky (one clock, the light), the planet (the air thins, the world curves), the ship in the
// sky (on by default, off with config.overseer false), beams for whatever appears, flight ceilings, the rocket and the
// space ship, and docking in the hangar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const keys = () => H.input.held;
const hold = (k: string[], seconds: number) => { for (const x of k) keys().add(x); H.tick(seconds); for (const x of k) keys().delete(x); };
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };
const rest = (t: string) => H.vehicles.restHeight(H.vehicles.types[t]);

test('every game has the Overseer in its sky (config.overseer false: none)', () => {
  world(H, sceneOf({ floor, start }));
  H.tick(0.5);
  assert.ok(H.overseer.on, 'on by default');
  const [x, y, z] = H.overseer.position;
  assert.ok(y > 3000, `several km up (${y})`);
  assert.ok(Math.hypot(x, z) > 2000, 'off to one side, so it sits in the sky ahead');
  const parts = [...H.world.entities].filter((e: any) => e.tag === 'overseer');
  assert.equal(parts.length, 2, 'a solid hull and a hangar');
  assert.ok(parts.every((e: any) => e.physics === 'static' && !e.sceneId), 'not part of the saved world');
  assert.ok(H.game.overseer && H.game.overseer.position, 'game.overseer for scripts');
  world(H, sceneOf({ floor, start }, { overseer: false }));
  H.tick(0.2);
  assert.equal(H.overseer.on, false);
  assert.equal([...H.world.entities].filter((e: any) => e.tag === 'overseer').length, 0);
  world(H, sceneOf({ floor, start }, { overseer: { position: [100, 2500, 900], radius: 200 } }));
  H.tick(0.2);
  assert.deepEqual(H.overseer.position, [100, 2500, 900]);
  assert.equal(H.overseer.radius, 200);
});

test('one clock: config.time, the events clock and game.sky.hour; night is darker, the sun moves', () => {
  world(H, sceneOf({ floor, start }, { time: 'noon', background: '#8fd0f5' }));
  H.tick(0.2);
  assert.equal(H.sky.hour, 12);
  const day = H.world.scene.clearColor.r + H.world.scene.clearColor.g + H.world.scene.clearColor.b;
  const sunDay = H.world.sun.intensity;
  H.game.sky.hour = 'night';
  H.tick(0.2);
  const night = H.world.scene.clearColor.r + H.world.scene.clearColor.g + H.world.scene.clearColor.b;
  assert.ok(night < day * 0.5, `night is darker (${day.toFixed(2)} → ${night.toFixed(2)})`);
  assert.ok(H.world.sun.intensity < sunDay * 0.5, 'the sun is down');
  assert.ok(H.world.sun.direction.y < 0, 'its light still falls from above');
  // A running clock (12 minutes a day): it moves in play.
  world(H, sceneOf({ floor, start }, { time: { hour: 8, minutes: 1 } }));
  H.tick(5);
  assert.ok(H.sky.hour > 9.5 && H.sky.hour < 10.5, `a minute a day: 5 s is 2 hours (${H.sky.hour.toFixed(2)})`);
  // The events module's clock is the same clock.
  world(H, sceneOf({ floor, start }, { events: { clock: { hour: 20.5, day: 240 }, rules: [] } }));
  H.tick(0.5);
  assert.ok(Math.abs(H.sky.hour - H.game.events.hour) < 1e-9, 'events and the sky agree');
  H.game.sky.hour = 6;
  assert.equal(H.game.events.hour, 6);
});

test('the weather and the dark go through the sky, and leave the light as it was', () => {
  world(H, sceneOf({ floor, start }, { ambient: 0.7, sun: 0.9 }));
  H.tick(0.2);
  const base = H.world.hemi.intensity;
  H.sky.set('weather', { dark: 0.6, weather: true });
  H.tick(0.1);
  assert.ok(H.world.hemi.intensity < base * 0.8, 'rain darkens');
  H.sky.set('weather', null);
  H.tick(0.1);
  assert.ok(Math.abs(H.world.hemi.intensity - base) < 1e-6, 'and gives it back');
  // A script that sets the light keeps it (the sky works from what it set).
  H.world.hemi.intensity = 0.3;
  H.tick(0.1);
  assert.ok(Math.abs(H.world.hemi.intensity - 0.3) < 1e-6);
});

test('the planet: the air thins with height, space starts near 10 km, the world curves away', () => {
  world(H, sceneOf({ floor, start }, { water: { level: 0 } }));
  H.tick(0.2);
  const P = H.planet;
  assert.ok(P.on);
  assert.equal(P.air(0), 1);
  assert.equal(P.air(200), 1, 'full air near the ground');
  assert.ok(P.air(1500) > 0.45 && P.air(1500) < 0.65, `thinner at 1.5 km (${P.air(1500).toFixed(2)})`);
  assert.ok(P.air(5200) < 0.1, 'thin where the Overseer is');
  assert.ok(P.air(P.space) < 0.0045 && P.space > 8000 && P.space < 12000, `space at ${P.space.toFixed(0)} m`);
  assert.ok(P.drop(500) > 1 && P.drop(500) < 4, `500 m away looks ${P.drop(500).toFixed(2)} m lower`);
  // Above the air the sky is space.
  const p = H.world.player;
  p.gravity = 0; p.position = [0, 14000, 0]; p.velocity = [0, 0, 0];
  H.tick(0.2);
  assert.ok(H.sky.space > 0.9, `space (${H.sky.space.toFixed(2)})`);
  p.position = [0, 2, 0];
  H.tick(0.2);
  assert.ok(H.sky.space < 0.05, 'on the ground: the sky');
  world(H, sceneOf({ floor, start }, { planet: false }));
  H.tick(0.1);
  assert.equal(H.planet.air(9000), 1, 'no planet: no thin air');
  assert.equal(H.planet.drop(1000), 0);
  world(H, sceneOf({ floor, start }, { planet: 'desert' }));
  H.tick(0.1);
  assert.equal(H.planet.config.biome.name, 'desert');
});

test('beams: whatever appears is beamed in (the assistant, the hotbar, spawnMany as one beam), a few at a time', () => {
  world(H, sceneOf({ floor, start }));
  H.tick(0.5);
  const before = H.overseer.beams;
  H.applyOps([{ op: 'create', entity: { id: 'crate1', type: 'box', physics: 'dynamic', transform: { position: [0, 1, 6] } } }], { fx: 'materialize', remote: true, by: 'Assistant' });
  assert.equal(H.overseer.beams, before + 1, 'a beam for the new thing');
  H.game.spawnMany('crate', 30, { at: [10, 0, 10] });
  assert.equal(H.overseer.beams, before + 2, 'one wide beam for the batch');
  for (let i = 0; i < 20; i++) H.overseer.beam([i, 0, -10]);
  assert.ok(H.overseer.beams <= H.overseer.MAX_BEAMS, 'capped');
  H.tick(3);
  assert.equal(H.overseer.beams, 0, 'they fade away');
  const held = H.overseer.beam([0, 0, 3], { hold: true });
  H.tick(3);
  assert.equal(H.overseer.beams, 1, 'a held beam stays (the Gen beam while an asset is made)');
  held.end(true);
  H.tick(1);
  assert.equal(H.overseer.beams, 0);
  // The player is beamed in when they come back.
  H.respawn();
  assert.equal(H.overseer.beams, 1, 'respawning: beamed down');
  const e = H.world.byId.get('crate1');
  assert.ok(e && Math.abs(e.node.scaling.x - 1) < 1e-6, 'the beamed thing is full size');
});

test('flight is honest about air: a helicopter tops out low, a plane higher', () => {
  world(H, sceneOf({ floor, start, heli: { type: 'helicopter', transform: { position: [0, 300, 0] } }, heli2: { type: 'helicopter', transform: { position: [80, 2600, 0] } } }));
  const heli = H.game.entity('heli');
  H.game.vehicles.enter(heli);
  H.tick(2.5);
  hold(['space'], 3);
  assert.ok(heli.vehicle.vel.y > 4, `low down it climbs (${heli.vehicle.vel.y.toFixed(1)} m/s)`);
  H.game.vehicles.exit();
  const high = H.game.entity('heli2');
  high.position = [80, 2600, 0]; high.velocity = [0, 0, 0];
  H.game.vehicles.enter(high);
  H.tick(2.5);
  hold(['space'], 3);
  assert.ok(high.vehicle.vel.y < -2, `at 2.6 km the rotor can't hold it (${high.vehicle.vel.y.toFixed(1)} m/s)`);
  assert.ok(high.vehicle.ceiling, 'it knows it is at its ceiling');
  H.game.vehicles.exit();
  // A plane at full throttle, hands off: flies at 1 km, sinks at 4.5 km.
  world(H, sceneOf({ floor, start, plane: { type: 'airplane', transform: { position: [0, 1000, 0] } } }));
  const plane = H.game.entity('plane');
  const fly = (y: number) => {
    plane.position = [0, y, 0]; plane.rotation = 0; plane.velocity = [0, 0, 75];
    H.game.vehicles.enter(plane);
    plane.vehicle.throttle = 1;
    keys().add('space');
    const y0 = plane.y;
    H.tick(12);
    keys().delete('space');
    const dy = plane.y - y0;
    H.game.vehicles.exit();
    return dy;
  };
  const low = fly(1000), top = fly(4500);
  assert.ok(low > -20, `it holds its own at 1 km (${low.toFixed(0)} m)`);
  assert.ok(top < low - 60, `and can't at 4.5 km (${top.toFixed(0)} m vs ${low.toFixed(0)} m)`);
});

test('a rocket leaves the air: thrust in vacuum, fuel, out into space', () => {
  world(H, sceneOf({ floor, start, rocket: { type: 'rocket', transform: { position: [0, rest('rocket'), 20] } } }));
  const rocket = H.game.entity('rocket');
  H.tick(1);
  assert.ok(rocket.vehicle && rocket.vehicle.def.class === 'rocket');
  H.game.vehicles.enter(rocket);
  hold(['space'], 3);
  assert.ok(rocket.vehicle.throttle > 0.9, 'space opens the throttle');
  assert.ok(rocket.y > rest('rocket') + 5, `lift-off (${rocket.y.toFixed(1)})`);
  H.tick(100);
  assert.ok(rocket.y > H.planet.space, `space in under two minutes (${(rocket.y / 1000).toFixed(1)} km)`);
  assert.ok(rocket.vehicle.fuel < 150, 'it burned fuel');
  assert.ok(rocket.vehicle.vel.length() <= 200, 'within the engine\'s speed limit');
  H.game.vehicles.exit();
});

test('a space ship climbs, hovers by itself, and docks in the Overseer\'s hangar; you walk out into it', () => {
  world(H, sceneOf({ floor, start, ship: { type: 'spaceship', transform: { position: [10, rest('spaceship'), 10] } } }));
  const ship = H.game.entity('ship');
  H.tick(1);
  H.game.vehicles.enter(ship);
  hold(['space'], 5);
  assert.ok(ship.y > 200, `space climbs fast (${ship.y.toFixed(0)} m)`);
  H.tick(4);
  const y0 = ship.y;
  H.tick(4);
  assert.ok(Math.abs(ship.y - y0) < 3, `hands off it hovers (${y0.toFixed(1)} → ${ship.y.toFixed(1)})`);
  hold(['w'], 4);
  assert.ok(ship.vehicle.vel.length() > 40, 'W flies it');
  H.game.vehicles.exit();
  // Over the pad, then down onto it.
  const hg = H.overseer.hangar;
  assert.ok(hg && hg.pad[1] > 4000, 'the hangar is up there');
  ship.position = [hg.pad[0], hg.pad[1] + 8, hg.pad[2]]; ship.velocity = [0, 0, 0];
  H.world.player.position = [hg.pad[0] + 3, hg.pad[1] + 1, hg.pad[2]];
  H.tick(0.1);
  ship.repair(); // (the jump up there was a crash to it)
  H.game.vehicles.enter(ship);
  hold(['c'], 5);
  H.tick(1);
  assert.ok(Math.abs(ship.y - hg.floor - rest('spaceship')) < 0.6, `it sits on the pad (${(ship.y - hg.floor).toFixed(2)} above the floor)`);
  assert.ok(H.overseer.hangar.landed, 'Docked');
  assert.ok(Object.keys(H.overseer.docked).length === 1, 'you are docked');
  H.game.vehicles.exit();
  H.tick(2);
  const p = H.world.player;
  assert.ok(p.bottom > hg.floor - 0.3 && p.bottom - hg.floor < 3, `out in the hangar (${(p.bottom - hg.floor).toFixed(2)} above its floor)`);
  hold(['a'], 2);
  H.tick(1);
  assert.ok(p.bottom > hg.floor - 0.3 && p.bottom - hg.floor < 3 && H.overseer.inHangar(p.position), 'walking in the hangar');
  // The hull is solid: something dropped on its top lands on it.
  const [cx, cy, cz] = H.overseer.position;
  const ball = H.game.sphere({ x: cx, y: cy + H.overseer.radius + 6, z: cz, radius: 0.5, physics: 'dynamic' });
  H.tick(3);
  assert.ok(ball.y > cy + H.overseer.radius - 1, `it rests on the hull (${(ball.y - cy).toFixed(1)} above the middle)`);
});

test('the intro: never on its own without a screen, off with intro: false; the lines are J\'s', () => {
  world(H, sceneOf({ floor, start }));
  H.tick(0.2);
  assert.equal(H.overseer.introWanted(), false, 'no screen (tests): no intro');
  assert.deepEqual(H.overseer.INTRO_LINES, ['You found your way. Good.', 'I have given you the power of free will.', 'Do with it what you will.', 'Ask, and I will send it down.']);
  world(H, sceneOf({ floor, start }, { overseer: { intro: false } }));
  H.tick(0.2);
  assert.equal(H.overseer.config.intro, false);
});
