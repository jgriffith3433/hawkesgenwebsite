// Abilities (modules/abilities): any thing rides, flies, is carried and thrown, teleports, boosts, changes gravity; signals
// from buttons, levers and plates open doors and show hidden bridges, and rules hear them; the settings descriptions the
// build card draws; and the play kits, placed and working. In play and while building.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const g = globalThis as any;
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, 0] } };
const buttons = new Map<string, any>();
function key(type: 'keydown' | 'keyup', k: string) {
  let b = buttons.get(k);
  if (!b) { b = new g.HTMLElement('button'); H.bindTouchKey(b, k); buttons.set(k, b); }
  b.dispatch(type === 'keydown' ? 'pointerdown' : 'pointerup', { preventDefault() {}, stopPropagation() {} });
}
const steps = (s: number) => { for (let t = 0; t < s; t += 0.05) H.tick(0.05); };

test('signals: set, toggle, pulse, heard as game events and by rules; doors and hidden bridges answer them', async () => {
  world(H, sceneOf({ floor, start,
    gate: { type: 'box', name: 'Gate', shape: { size: [4, 3, 0.4] }, transform: { position: [0, 1.5, 8] }, behaviors: [{ use: 'opens', signal: 'gate', height: 3, speed: 6 }] },
    bridge: { type: 'box', name: 'Bridge', shape: { size: [2, 0.3, 6] }, transform: { position: [5, 0.2, 8] }, behaviors: [{ use: 'shows', signal: 'bridge' }] },
  }, { events: { vars: { opened: 0 }, rules: [{ id: 'count', when: { signal: 'gate' }, do: [{ var: 'opened', add: 1 }] }] } }));
  H.tick(0.3);
  const heard: string[] = [];
  H.game.on('signal', (d: any) => heard.push(`${d.name}:${d.on}`));
  const gate = H.game.entity('gate'), bridge = H.game.entity('bridge');
  steps(0.5);
  assert.equal(bridge.visible, false, 'hidden until its signal');
  assert.ok(Math.abs(gate.y - 1.5) < 0.05, 'the gate is shut');
  H.game.signal.set('gate', true);
  steps(1);
  assert.ok(gate.y > 4, `the gate rose (${gate.y.toFixed(2)})`);
  H.game.signal.toggle('gate');
  steps(1);
  assert.ok(gate.y < 1.6, 'and shut again');
  H.game.signal.set('bridge', true);
  steps(0.2);
  assert.equal(bridge.visible, true, 'the bridge appears');
  H.game.signal.pulse('ding', 0.05);
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(heard, ['gate:true', 'gate:false', 'bridge:true', 'ding:true', 'ding:false']);
  assert.equal(H.game.events.value('opened'), 1, 'the rule heard it turn on, once (not when it turned off)');
});

test('settings descriptions: every ability lists its settings, grouped, with presets', () => {
  world(H, sceneOf({ floor, start }));
  const all = H.abilities.list();
  const by = Object.fromEntries(all.map((a: any) => [a.name, a]));
  for (const n of ['seat', 'drivable', 'flyable', 'holdable', 'teleport', 'boost', 'cannon', 'gravity', 'button', 'lever', 'plate', 'shows', 'hill', 'opens', 'spin', 'patrol']) assert.ok(by[n], n);
  assert.equal(by.drivable.group, 'Riding');
  assert.deepEqual(by.drivable.settings.map((s: any) => s.key), ['speed', 'turn', 'hover', 'height']);
  assert.ok(by.drivable.presets['Sports car']);
  assert.ok(by.spin.settings.some((s: any) => s.key === 'speed'), 'older behaviors got settings too');
  assert.ok(by.opens.settings.some((s: any) => s.key === 'signal'), 'a door can wait for a signal');
});

test('ride: get on a couch, drive it with W and A, get off beside it; fly a carpet up with Space', () => {
  world(H, sceneOf({ floor, start,
    couch: { type: 'box', name: 'Couch', shape: { size: [2, 0.8, 1] }, physics: 'kinematic', transform: { position: [0, 0.4, 3] }, behaviors: [{ use: 'drivable', speed: 10 }] },
    carpet: { type: 'box', name: 'Carpet', shape: { size: [1.6, 0.1, 2.4] }, physics: 'kinematic', transform: { position: [8, 0.5, 3] }, behaviors: [{ use: 'flyable', lift: 6 }] },
  }));
  H.tick(0.3);
  const couch = H.game.entity('couch'), p = H.world.player;
  H.abilities.getOn(couch);
  assert.equal(H.abilities.riding.mode, 'drive');
  key('keydown', 'w');
  steps(2);
  key('keyup', 'w');
  assert.ok(couch.z > 10, `it drove forward (${couch.z.toFixed(1)})`);
  assert.ok(Math.abs(p.x - couch.x) < 0.2 && Math.abs(p.z - couch.z) < 0.2, 'the rider sits on it');
  key('keydown', 'w'); key('keydown', 'a');
  const yaw0 = couch.node.rotation.y;
  steps(1);
  key('keyup', 'a'); key('keyup', 'w');
  assert.ok(couch.node.rotation.y !== yaw0, 'and steered');
  H.abilities.getOff();
  assert.equal(H.abilities.riding, null);
  assert.ok(Math.hypot(p.x - couch.x, p.z - couch.z) > 1, 'got off beside it');
  assert.equal(p.controls, true);
  const carpet = H.game.entity('carpet');
  H.abilities.getOn(carpet);
  key('keydown', ' ');
  steps(2);
  key('keyup', ' ');
  assert.ok(carpet.y > 4, `it flew up (${carpet.y.toFixed(1)})`);
  H.abilities.getOff();
});

test('hands and moving you: pick up and throw; a teleporter; a speed pad; a low-gravity zone', () => {
  world(H, sceneOf({ floor, start,
    crate: { type: 'box', name: 'Crate', shape: { size: [0.8, 0.8, 0.8] }, physics: 'dynamic', transform: { position: [0, 0.4, 1.5] }, behaviors: [{ use: 'holdable', throw: 20 }] },
    padA: { type: 'box', name: 'Pad A', shape: { size: [2, 0.2, 2] }, transform: { position: [10, 0.1, 0] }, behaviors: [{ use: 'teleport', to: 'Pad B' }] },
    padB: { type: 'box', name: 'Pad B', shape: { size: [2, 0.2, 2] }, transform: { position: [60, 0.1, 0] }, behaviors: [{ use: 'teleport', to: 'Pad A' }] },
    moon: { type: 'box', name: 'Moon zone', shape: { size: [10, 10, 10] }, physics: 'none', transform: { position: [-30, 5, 0] }, behaviors: [{ use: 'gravity', factor: 0.2 }] },
  }));
  H.tick(0.3);
  const crate = H.game.entity('crate'), p = H.world.player;
  // Hands: E (the offer for the nearest thing with an ability) picks it up; F throws it.
  p.position = [0, 1, 0];
  H.world.player.node.rotation.y = 0;
  H.tick(0.05);
  const before = crate.y;
  const t = crate;
  key('keydown', 'e'); H.tick(1 / 60); key('keyup', 'e');
  steps(0.2);
  assert.equal(H.abilities.holding, t, 'E picked it up');
  assert.ok(t.y > before, 'held up in front');
  key('keydown', 'f'); H.tick(1 / 60); key('keyup', 'f');
  assert.equal(H.abilities.holding, null, 'F threw it');
  assert.ok(Math.hypot(t.vx, t.vz) > 10, `thrown hard (${Math.hypot(t.vx, t.vz).toFixed(1)} m/s)`);
  // Teleporter: step on pad A, come out at pad B (and not straight back).
  p.position = [10, 0.6, 0]; p.velocity = [0, 0, 0];
  steps(0.3);
  assert.ok(Math.abs(p.x - 60) < 4, `teleported to B (${p.x.toFixed(1)})`);
  steps(0.5);
  assert.ok(Math.abs(p.x - 60) < 4, 'and stayed there');
  // Low gravity inside the zone, back outside.
  const g0 = p.gravity;
  p.position = [-30, 1, 0];
  steps(0.2);
  assert.ok(Math.abs(p.gravity - g0 * 0.2) < 1e-6, `gravity × 0.2 inside (${p.gravity})`);
  p.position = [0, 1, 0];
  steps(0.2);
  assert.equal(p.gravity, g0, 'and normal again outside');
});

test('play kits: each builds things that exist in the engine, placed round the spot and turned to the player', () => {
  world(H, sceneOf({ floor, start }));
  H.tick(0.2);
  for (const k of H.kits.list()) {
    const specs = H.kits.build(k.id, [10, 0, 10], Math.PI / 2);
    assert.ok(specs.length > 0, k.id);
    for (const s of specs) {
      assert.ok(H.kinds.has(s.type), `${k.id}: kind ${s.type}`);
      for (const b of s.behaviors || []) assert.ok(H.behaviorDef(b.use), `${k.id}: ability ${b.use}`);
    }
    const made = specs.map((s: any, i: number) => H.fromSpec({ ...s, id: `${k.id}_${i}` }));
    assert.ok(made.every((e: any) => e && e.alive), `${k.id}: all built`);
    for (const e of made) e.destroy();
  }
  // Turned to the player: the obstacle course runs the way you face (+x for a quarter turn).
  const course = H.kits.build('obby', [0, 0, 0], Math.PI / 2);
  const finish = course.find((s: any) => s.name === 'Finish');
  assert.ok(finish.transform.position[0] > 20 && Math.abs(finish.transform.position[2]) < 4, `the course runs along +x (${finish.transform.position})`);
  // In the spawn wheel.
  assert.ok(H.spawn.all().some((i: any) => i.kit === 'obby'), 'in the wheel');
});

test('building: abilities still work (a lever and a gate), the hidden bridge shows so you can place it', () => {
  world(H, sceneOf({ floor, start,
    gate: { type: 'box', name: 'Gate', shape: { size: [4, 3, 0.4] }, transform: { position: [0, 1.5, 8] }, behaviors: [{ use: 'opens', signal: 'g2', height: 3, speed: 6 }] },
    bridge: { type: 'box', name: 'Bridge', shape: { size: [2, 0.3, 6] }, transform: { position: [5, 0.2, 8] }, behaviors: [{ use: 'shows', signal: 'b2' }] },
  }), { mode: 'build' });
  H.tick(0.3);
  steps(0.3);
  assert.equal(H.game.entity('bridge').visible, true, 'building: you see it to place it');
  H.game.signal.set('g2', true);
  steps(1);
  assert.ok(H.game.entity('gate').y > 4, 'the gate opens while building too');
});

test('swimming in the air: the air-swim mode floats you; space swims up, letting go drifts down slowly', () => {
  world(H, sceneOf({ floor, start }, { player: { mode: 'air-swim' } }));
  H.tick(0.3);
  const p = H.world.player;
  assert.equal(p.controller, 'air-swim');
  assert.equal(p._airSwim, true, 'the body swims');
  key('keydown', ' ');
  steps(1.5);
  key('keyup', ' ');
  const top = p.y;
  assert.ok(top > 4, `swam up (${top.toFixed(1)})`);
  steps(1);
  const coast = p.y;
  assert.ok(coast < top + 1.5, `the swim stops soon after letting go (${top.toFixed(1)} -> ${coast.toFixed(1)})`);
  steps(1.5);
  assert.ok(p.y < coast && p.y > coast - 2, `then drifts down slowly (${coast.toFixed(1)} -> ${p.y.toFixed(1)})`);
});

test('proportions: a look keeps headSize and bodySize, clamped', () => {
  const C = H.presence.core;
  const lk = C.cleanLook({ headSize: 2.2, bodySize: 0.6 });
  assert.equal(lk.headSize, 2.2);
  assert.equal(lk.bodySize, 0.6);
  assert.equal(C.cleanLook({ headSize: 9, bodySize: -1 }).headSize, 3);
  assert.equal(C.cleanLook({ bodySize: -1 }).bodySize, 0.3);
  assert.equal(C.cleanLook({}).headSize, 1, 'an old look: normal');
});
