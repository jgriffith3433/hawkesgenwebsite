// Contraptions (modules/abilities/contraptions.js): things joined by the physics engine: a door on a hinge swings and
// stops at its limit, a motor turns (and only while its signal is on), a ball hangs on a rope, two things glued move as
// one, a spring comes back, a piston slides out and back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const steps = (s: number) => { for (let t = 0; t < s; t += 1 / 60) H.tick(1 / 60); };
const floor = { type: 'box', shape: { size: [200, 1, 200] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, -20] } };
const deg = (r: number) => r * 180 / Math.PI;
const yaw = (e: any) => { const q = e.node.rotationQuaternion; if (q) { const v = q.toEulerAngles(); return deg(v.y); } return deg(e.node.rotation.y); };

test('a hinged door swings round its edge and stops at its limit; a motor turns, while its signal is on', () => {
  world(H, sceneOf({ floor, start,
    door: { type: 'box', name: 'Door', shape: { size: [2, 3, 0.2] }, physics: 'dynamic', transform: { position: [0, 1.6, 5] }, behaviors: [{ use: 'hinge', min: -60, max: 60 }] },
    table: { type: 'cylinder', name: 'Turntable', shape: { radius: 2, height: 0.3 }, physics: 'dynamic', transform: { position: [10, 0.4, 5] }, behaviors: [{ use: 'motor', speed: 90, signal: 'go' }] },
  }));
  steps(0.3);
  const door = H.game.entity('door');
  const hinge = [door.x - 1, door.z];
  door.angularVelocity = [0, 200, 0];
  door.velocity = [0, 0, -2];
  steps(1.5);
  const a = Math.abs(H.physics ? door.rotation3[1] : 0);
  assert.ok(a > 20, `it swung (${a.toFixed(0)}°)`);
  assert.ok(a < 70, `and stopped at the limit (${a.toFixed(0)}°)`);
  // The left edge stayed where the hinge is.
  const r = door.rotation3[1] * Math.PI / 180, edge = [door.x - Math.cos(r) * 1, door.z + Math.sin(r) * 1];
  assert.ok(Math.hypot(edge[0] - hinge[0], edge[1] - hinge[1]) < 0.3, `round its edge (${edge.map((v) => v.toFixed(2))} vs ${hinge})`);
  const tt = H.game.entity('table');
  const t0 = tt.rotation3[1];
  steps(1);
  assert.ok(Math.abs(tt.rotation3[1] - t0) < 3, 'no signal: still');
  H.signals.set('go', true);
  steps(1);
  assert.ok(Math.abs(tt.angularVelocity[1]) > 60, `turning (${tt.angularVelocity[1].toFixed(0)}°/s)`);
});

test('a rope holds a ball up and lets it swing; glue makes two things one; a spring comes back; a piston slides', () => {
  world(H, sceneOf({ floor, start,
    ball: { type: 'sphere', name: 'Ball', shape: { radius: 0.4 }, physics: 'dynamic', transform: { position: [0, 5, 0] }, behaviors: [{ use: 'rope', length: 3 }] },
    a: { type: 'box', name: 'Cart', shape: { size: [2, 0.5, 1] }, physics: 'dynamic', transform: { position: [10, 0.3, 0] } },
    b: { type: 'box', name: 'Mast', shape: { size: [0.2, 2, 0.2] }, physics: 'dynamic', transform: { position: [10, 1.6, 0] }, behaviors: [{ use: 'glue', to: 'Cart' }] },
    sp: { type: 'box', name: 'Bouncer', shape: { size: [1, 1, 1] }, physics: 'dynamic', transform: { position: [-10, 3, 0] }, behaviors: [{ use: 'spring', stiffness: 80, damping: 4 }] },
    pi: { type: 'box', name: 'Lift', shape: { size: [2, 0.3, 2] }, physics: 'dynamic', transform: { position: [-20, 1, 0] }, behaviors: [{ use: 'piston', axis: 'y', range: 2, speed: 2 }] },
  }));
  steps(0.2);
  const ball = H.game.entity('ball');
  ball.velocity = [3, 0, 0];
  steps(2);
  assert.ok(ball.y > 4, `held up by the rope (${ball.y.toFixed(2)})`);
  const knot = Math.hypot(ball.x - 0, ball.y + 0.4 - 8, ball.z);
  assert.ok(knot < 3.3, `no further than the rope (${knot.toFixed(2)})`);
  const cart = H.game.entity('a'), mast = H.game.entity('b');
  cart.velocity = [4, 0, 0];
  steps(1);
  assert.ok(Math.abs((mast.x - cart.x)) < 0.2, `the mast goes with the cart (${(mast.x - cart.x).toFixed(2)})`);
  const sp = H.game.entity('sp');
  sp.velocity = [0, 0, 6];
  steps(3);
  assert.ok(Math.abs(sp.z) < 0.4 && Math.abs(sp.y - 3) < 0.6, `the spring brought it back (${sp.z.toFixed(2)}, ${sp.y.toFixed(2)})`);
  const lift = H.game.entity('pi');
  let top = 0;
  for (let i = 0; i < 120; i++) { H.tick(1 / 60); top = Math.max(top, lift.y); }
  assert.ok(top > 2.5, `the piston went up (${top.toFixed(2)})`);
});

test('the workshop kit builds and its machines run', () => {
  world(H, sceneOf({ floor }));
  H.tick(0.2);
  const specs = H.kits.build('workshop', [0, 0, 0], 0);
  const things: Record<string, any> = { floor, start };
  specs.forEach((s: any, i: number) => { assert.ok(H.kinds.has(s.type), s.type); for (const b of s.behaviors || []) assert.ok(H.behaviorDef(b.use), b.use); things[`k${i}`] = s; });
  world(H, sceneOf(things));
  steps(1);
  const ball = [...H.world.entities].find((e: any) => e.name === 'Wrecking ball');
  assert.ok(ball.y > 2, `the wrecking ball hangs (${ball.y.toFixed(2)})`);
  H.signals.set('mill', true);
  steps(1);
  const sails = [...H.world.entities].find((e: any) => e.name === 'Windmill sails');
  assert.ok(Math.abs(sails.angularVelocity[2]) > 50, 'the lever starts the windmill');
});
