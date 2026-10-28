// Mood (modules/mood): a scary world (dark, fog, the flashlight), a stalker that comes only while you look away and
// gets you (a jump scare, hurt, back where it started), a place that scares you once, and a light that flickers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const steps = (s: number) => { for (let t = 0; t < s; t += 0.05) H.tick(0.05); };
const floor = { type: 'box', shape: { size: [200, 1, 200] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, 0] } };

test('a scary world: dark, fog close, a flashlight in hand', () => {
  world(H, sceneOf({ floor, start }, { mood: 'scary' }));
  H.tick(0.3);
  assert.ok(H.mood.on);
  const sc = H.world.scene;
  assert.equal(sc.fogMode, 3, 'linear fog'); // BABYLON.Scene.FOGMODE_LINEAR
  assert.ok(sc.fogEnd <= 60, `fog close (${sc.fogEnd})`);
  steps(0.2);
  assert.ok(sc.lights.some((l: any) => l.name === 'mood-torch' && l.isEnabled()), 'the flashlight is on');
  assert.ok(H.mood.flashlight);
  world(H, sceneOf({ floor, start }));
  H.tick(0.3);
  assert.equal(H.mood.on, false, 'a world without it is not scary');
});

test('the stalker comes while you look away, stops when you look, and gets you', () => {
  world(H, sceneOf({ floor, start,
    thing: { type: 'capsule', name: 'It', shape: { radius: 0.35, height: 1.9 }, physics: 'dynamic', transform: { position: [0, 1, 14] }, behaviors: [{ use: 'stalker', speed: 4, damage: 30, text: 'BOO' }] },
  }, { mood: 'scary' }));
  H.tick(0.3);
  const it = H.game.entity('thing'), p = H.world.player;
  H.world.camera.yaw = 0; H.world.camera.pitch = 0; // (looking at it: +z)
  steps(1.5);
  assert.ok(it.z > 13, `it waits while you look (${it.z.toFixed(1)})`);
  H.world.camera.yaw = Math.PI; // (turned away)
  steps(1.5);
  assert.ok(it.z < 10, `it came while you looked away (${it.z.toFixed(1)})`);
  const got: string[] = [];
  H.game.on('scare', (d: any) => got.push(d.text));
  H.game.on('caught', () => got.push('caught'));
  const hp = p.health;
  steps(4);
  assert.deepEqual(got.slice(0, 2), ['BOO', 'caught']);
  assert.ok(p.health < hp, 'it hurt');
  assert.ok(it.z > 12, 'and went back where it was');
});

test('a scare place goes off once; a light flickers', () => {
  world(H, sceneOf({ floor, start,
    zone: { type: 'box', name: 'Hall', shape: { size: [3, 3, 3] }, physics: 'none', transform: { position: [0, 1.5, 10] }, behaviors: [{ use: 'scare', text: 'Behind you' }] },
    lamp: { type: 'light', name: 'Lamp', light: { type: 'point', intensity: 1 }, transform: { position: [5, 3, 0] }, behaviors: [{ use: 'flicker', rate: 3 }] },
  }, { mood: 'eerie' }));
  H.tick(0.3);
  let n = 0;
  H.game.on('scare', () => n++);
  steps(1);
  const lamp = H.game.entity('lamp');
  const seen = new Set<number>();
  for (let i = 0; i < 40; i++) { H.tick(0.05); const l = H.world.scene.lights.find((x: any) => x === lamp.node || x.parent === lamp.node); if (l) seen.add(Math.round(l.intensity * 10)); }
  assert.ok(seen.size > 1, 'the light flickers');
  H.world.player.position = [0, 1, 10]; steps(0.5);
  H.world.player.position = [0, 1, 0]; steps(4);
  H.world.player.position = [0, 1, 10]; steps(0.5);
  assert.equal(n, 1, 'once');
});

test('the haunted house kit: a scary mood, a stalker, a scare, flickering lamps, a way out', () => {
  world(H, sceneOf({ floor }));
  H.tick(0.2);
  const specs = H.kits.build('haunted', [0, 0, 0], 0);
  for (const s of specs) { assert.ok(H.kinds.has(s.type), s.type); for (const b of s.behaviors || []) assert.ok(H.behaviorDef(b.use), b.use); }
  const uses = specs.flatMap((s: any) => (s.behaviors || []).map((b: any) => b.use));
  for (const u of ['stalker', 'scare', 'flicker', 'goal']) assert.ok(uses.includes(u), u);
  assert.equal(H.kits.config('haunted').mood, 'scary');
});
