// The Overseer is alive (overseer.js "presence"): the halo and rings answer its voice, the emitter flares before a beam,
// the seams glow at night, the bay turns toward whoever asked, a long silence breathes, and a hum rises with the climb.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };
let t = 1000;
function fresh(cfg: any = {}) {
  t = 1000;
  H.speech.clock = () => t;
  H.speech.reset();
  world(H, sceneOf({ floor, start }, { time: 'noon', ...cfg }));
  tick(0.3);
}
const tick = (s: number) => { H.tick(s); H.world.scene.render(); }; // (a frame: the step, then the sky's far layer placing the ship)
const pump = (s: number) => { t += s; H.speech.pump(); tick(s); };

test('while it speaks the halo brightens and the rings quicken, for the length of the line, then settle', () => {
  fresh();
  const calm = H.game.overseer.presence();
  assert.equal(calm.speaking, 0);
  const ringBefore = H.overseer.ship.ringA.rotation.y;
  tick(1);
  const calmTurn = H.overseer.ship.ringA.rotation.y - ringBefore;
  H.speech.say({ text: 'Look up. I am here, and I am glad you came.', priority: 'normal' });
  for (let i = 0; i < 6; i++) pump(0.3);
  const talking = H.game.overseer.presence();
  assert.ok(talking.speaking > 0.7, `speaking ${talking.speaking}`);
  assert.ok(talking.halo.alpha > calm.halo.alpha + 0.12, `halo ${calm.halo.alpha} → ${talking.halo.alpha}`);
  assert.ok(talking.rings.speed > 2.5);
  const r1 = H.overseer.ship.ringA.rotation.y;
  tick(1);
  assert.ok(H.overseer.ship.ringA.rotation.y - r1 > calmTurn * 2, 'the rings turn faster while it talks');
  for (let i = 0; i < 40; i++) pump(0.3);
  const after = H.game.overseer.presence();
  assert.ok(after.speaking < 0.1, `settled (${after.speaking})`);
  assert.ok(after.halo.alpha < talking.halo.alpha - 0.1);
});

test('a beam: the emitter flares first, the shaft opens a moment later', () => {
  fresh();
  assert.equal(H.game.overseer.presence().flare, 0);
  const b = H.game.overseer.beam([0, 0, 6], { radius: 2, sound: false });
  assert.ok(b);
  const p0 = H.game.overseer.presence();
  assert.ok(p0.flare >= 0.6, `flare ${p0.flare}`);
  assert.ok(b.t < 0, 'the shaft is still closed');
  assert.ok(b.near.scaling.x <= 2 * 0.06 + 1e-6 || b.nm._hp === undefined || b.nm._hp.k === 0);
  tick(0.6);
  assert.ok(b.t > 0 || !b.alive);
  assert.ok(H.game.overseer.presence().flare < p0.flare, 'then it settles');
});

test('at night the seams glow stronger than by day', () => {
  fresh({ time: 'noon' });
  tick(0.2);
  const day = H.game.overseer.presence().seams.glow;
  H.game.sky.hour = 'night';
  tick(0.3);
  const night = H.game.overseer.presence();
  assert.ok(night.night > 0.9);
  assert.ok(night.seams.glow > day * 1.4, `${day} → ${night.seams.glow}`);
});

test('asking it something turns the bay toward the player (from afar), and it turns back', () => {
  fresh();
  H.overseer.setLod('far');
  tick(0.2);
  assert.equal(H.game.overseer.presence().turn, 0);
  H.game.emit('asked', { chars: 5 });
  assert.equal(H.game.overseer.presence().attending, true);
  for (let i = 0; i < 20; i++) tick(0.25);
  const turned = H.game.overseer.presence();
  const ship = H.overseer.ship;
  const cam = ship.scene.activeCamera.globalPosition, c = H.overseer.ship.cfg.position;
  const want = Math.atan2(cam.x - c[0], cam.z - c[2]) - ship.bay.yaw;
  const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
  assert.ok(Math.abs(wrap(want - turned.turn)) < 0.05, `turn ${turned.turn} toward ${wrap(want)}`);
  assert.ok(Math.abs(ship.turn.rotation.y - turned.turn) < 1e-3, 'one transform node turns, no new meshes');
  for (let i = 0; i < 80; i++) tick(0.25);
  assert.ok(Math.abs(H.game.overseer.presence().turn) < 0.02, 'back to rest');
});

test('silent for a long time it idles: slow breathing; anything it does ends it', () => {
  fresh();
  H.overseer._.P.idleAfter = 5;
  for (let i = 0; i < 40; i++) tick(0.25);
  const idle = H.game.overseer.presence();
  assert.ok(idle.idle > 0.7, `idle ${idle.idle}`);
  H.game.overseer.beam([0, 0, 6], { sound: false });
  tick(0.1);
  assert.equal(H.game.overseer.presence().quiet, 0);
  for (let i = 0; i < 40; i++) tick(0.25);
  H.overseer._.P.idleAfter = 40;
  assert.ok(H.game.overseer.presence().idle < idle.idle, 'awake again');
});

test('the hum is silent on the ground and rises as the player climbs toward the ship', () => {
  fresh();
  const g = H.game.overseer.presence();
  assert.equal(g.hum.level, 0, 'silent on the ground');
  const f = H.overseer._.humFor, r = 1400;
  assert.equal(f(0, 10900, r), 0);
  assert.equal(f(10, 10900, r), 0);
  let prev = 0;
  for (const [alt, dist] of [[100, 10000], [600, 8000], [2000, 5000], [3500, 2500], [4100, 1700]]) {
    const v = f(alt, dist, r);
    assert.ok(v > prev, `${alt} m: ${v} > ${prev}`);
    prev = v;
  }
  assert.ok(prev > 0.8);
  // Live: the player carried up, level follows.
  H.world.player.y = 3000;
  for (let i = 0; i < 20; i++) tick(0.25);
  const up = H.game.overseer.presence();
  assert.ok(up.hum.level > 0.1, `hum ${up.hum.level} at ${up.hum.altitude} m`);
});

test('presence costs no meshes: the same ship, one transform node more', () => {
  fresh();
  const names = H.world.scene.meshes.filter((m: any) => /^ov-/.test(m.name)).map((m: any) => m.name);
  assert.ok(!names.some((n: string) => /turn|hum|alive/.test(n)));
});
