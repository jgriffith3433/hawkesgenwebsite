// Planets (modules/planets): more than one planet in a game: the others in the sky, travel (a warp) to one with its own
// look, gravity and things, the home planet's things put away and back, a gate that sends you, and when the panel opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const steps = (s: number) => { for (let t = 0; t < s; t += 0.05) H.tick(0.05); };
const floor = { type: 'box', shape: { size: [200, 1, 200] }, transform: { position: [0, -0.5, 0] } };
const planets = { list: [{ id: 'ember', name: 'Ember', biome: 'lava', gravity: 0.5, about: 'a hot one' }, { id: 'frost', name: 'Frost', biome: 'ice' }] };

test('travel to another planet: its look and gravity, its things, home put away; and back', () => {
  world(H, sceneOf({ floor, start: { type: 'spawn', transform: { position: [0, 0, 0] } },
    crate: { type: 'box', name: 'Home crate', shape: { size: [1, 1, 1] }, physics: 'static', transform: { position: [3, 0.5, 0] } },
    rock: { type: 'box', name: 'Ember rock', shape: { size: [1, 1, 1] }, physics: 'static', data: { planet: 'ember' }, transform: { position: [-3, 0.5, 0] } },
    efloor: { type: 'box', name: 'Ember floor', shape: { size: [200, 1, 200] }, physics: 'static', data: { planet: 'ember' }, transform: { position: [0, -0.5, 0] } },
  }, { planets: { ...planets, travel: 'anywhere' }, planet: { biome: 'earth' } }));
  H.tick(0.3);
  const crate = H.game.entity('crate'), rock = H.game.entity('rock');
  assert.equal(H.planets.here, 'home');
  assert.equal(rock.visible, false, "Ember's things aren't on the home planet");
  assert.equal(H.planets.list().length, 3);
  assert.ok(H.world.scene.meshes.filter((m: any) => m.name.startsWith('planet-')).length >= 2, 'the others hang in the sky');
  assert.ok(H.planets.canTravel);
  const heard: string[] = [];
  H.game.on('arrive', (d: any) => heard.push(d.planet));
  assert.ok(H.planets.travel('ember', { fx: false }));
  steps(0.2);
  assert.equal(H.planets.here, 'ember');
  assert.deepEqual(heard, ['ember']);
  assert.equal(crate.visible, false, 'home is put away');
  assert.equal(crate.physics, 'none');
  assert.equal(rock.visible, true);
  assert.equal(H.world.graph.config.planet.biome, 'lava');
  assert.equal(H.world.player.gravity, 0.5, "Ember's gravity");
  steps(1);
  assert.ok(H.world.player.y > -2, 'standing on Ember');
  H.planets.travel('home', { fx: false });
  steps(0.2);
  assert.equal(crate.visible, true);
  assert.equal(crate.physics, 'static');
  assert.equal(rock.visible, false);
  assert.equal(H.world.graph.config.planet.biome, 'earth');
  assert.equal(H.world.player.gravity, 1);
});

test('a warp gate sends you to the next planet; the panel opens only in space unless travel is anywhere', () => {
  world(H, sceneOf({ floor, start: { type: 'spawn', transform: { position: [0, 0, 0] } },
    gate: { type: 'box', name: 'Gate', shape: { size: [3, 3, 0.5] }, physics: 'trigger', transform: { position: [0, 1.5, 3] }, behaviors: [{ use: 'warp-gate', planet: 'frost' }] },
  }, { planets }));
  H.tick(0.3);
  assert.equal(H.planets.canTravel, false, 'on the ground: no panel');
  H.world.player.position = [0, 1, 3];
  steps(0.3);
  steps(2.5); // (the warp)
  assert.equal(H.planets.here, 'frost');
});

test('on a round planet: travel to a smaller one and stand on it; home again', () => {
  world(H, sceneOf({ start: { type: 'spawn', transform: { position: [0, 0, 0] } } },
    { planet: { sphere: true, radius: 50000 }, planets: { list: [{ id: 'moon', name: 'Moon', biome: 'ice', radius: 3000, gravity: 0.3 }], travel: 'anywhere' } }));
  H.tick(0.3);
  steps(0.5);
  assert.ok(H.planets.travel('moon', { fx: false }));
  steps(1.5);
  assert.equal(H.planet.config.radius, 3000);
  const h = H.planet.heightOf(H.world.player.position);
  assert.ok(h > -1 && h < 4, `standing on the moon (${h.toFixed(2)} m up)`);
  const back = H.planets.travel('home', { fx: false });
  steps(1.5);
  assert.ok(back);
  assert.equal(H.planet.config.radius, 50000);
  const h2 = H.planet.heightOf(H.world.player.position);
  assert.ok(h2 > -1 && h2 < 4, `home again on the ground (${h2.toFixed(2)})`);
});

test('the planet hop kit: planets in the settings, a gate, a ship', () => {
  world(H, sceneOf({ floor }));
  H.tick(0.2);
  const specs = H.kits.build('planets', [0, 0, 0], 0);
  for (const s of specs) { assert.ok(H.kinds.has(s.type), s.type); for (const b of s.behaviors || []) assert.ok(H.behaviorDef(b.use), b.use); }
  assert.equal(H.kits.config('planets').planets.list.length, 3);
});

test('a bare planet on a flat home world gets ground of its biome: you land on it', () => {
  world(H, sceneOf({ floor, start: { type: 'spawn', transform: { position: [0, 0, 0] } } }, { planet: false, planets: { list: [{ id: 'dust', name: 'Dust', biome: 'desert' }], travel: 'anywhere' } }));
  H.tick(0.3);
  H.planets.travel('dust', { fx: false });
  steps(2);
  assert.equal(H.world.graph.config.terrain.shape, 'dunes');
  assert.ok(H.world.player.y > -5, `standing, not falling (${H.world.player.y.toFixed(1)})`);
});
