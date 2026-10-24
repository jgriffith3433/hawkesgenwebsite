// A round world (config.planet.sphere): gravity to the middle from anywhere, the player's up, flying where you look,
// placing things on the surface, the frame that follows you (positions stay precise far away), and flat worlds as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';
import { TEMPLATES } from '../../src/templates.ts';

const H = await load();
const R = 50000;
const start = { type: 'spawn', name: 'Start', transform: { position: [0, 0.05, 0] }, data: { role: 'player' } };
const round = (more: Record<string, any> = {}) => sceneOf({ start, ...more }, { planet: { sphere: true, radius: R }, overseer: { intro: false } });
const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
const norm = (v: number[]) => { const l = len(v) || 1; return v.map((x) => x / l); };
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The planet's up at a point on the planet (its own frame: the middle is [0, -R, 0]). */
const upAt = (pp: number[]) => norm([pp[0], pp[1] + R, pp[2]]);
/** A point `h` meters over the planet's surface, `deg` degrees round from the start (toward +x), on the planet. */
const onPlanet = (deg: number, h = 0, axis: 'x' | 'z' = 'x') => { const a = (deg * Math.PI) / 180, r = R + h; return axis === 'x' ? [Math.sin(a) * r, Math.cos(a) * r - R, 0] : [0, Math.cos(a) * r - R, Math.sin(a) * r]; };
const F = () => H.planet.frame;
/** Puts the player somewhere on the planet and lets the frame follow (and them land). */
function goTo(pp: number[], seconds = 1) {
  const p = H.world.player;
  p.position = F().toLocal(pp);
  p.velocity = [0, 0, 0];
  for (let t = 0; t < seconds; t += 1 / 60) H.tick(1 / 60);
}
function hold(k: string, seconds: number) {
  const b: any = { addEventListener(t: string, f: Function) { b[t] = f; }, style: {} };
  H.bindTouchKey(b, k);
  b.pointerdown({ preventDefault() {}, stopPropagation() {} });
  for (let t = 0; t < seconds; t += 1 / 60) H.tick(1 / 60);
  b.pointerup();
  H.tick(1 / 60);
}

test('a round world: the ground is the planet, the frame starts at the start', () => {
  world(H, round());
  assert.equal(H.planet.round, true);
  assert.equal(H.planet.radius, R);
  assert.ok(H.hooks.space, 'the frame is in use');
  H.tick(1);
  const g = [...H.world.entities].find((e: any) => e.kind === 'planet');
  assert.ok(g && g._pb, 'the ground has a collider');
  const p = H.world.player;
  assert.ok(p.grounded, 'the player stands on the planet');
  assert.ok(Math.abs(p.bottom) < 0.1, `on its surface (feet at ${p.bottom.toFixed(3)})`);
});

test('the frame turns: upright at a point points away from the middle', () => {
  world(H, round());
  for (const deg of [10, 90, 135, 179]) {
    const pp = onPlanet(deg);
    const q = F().upright(pp);
    const v = (globalThis as any).BABYLON.Vector3.Up().rotateByQuaternionToRef(q, new (globalThis as any).BABYLON.Vector3());
    assert.ok(dot([v.x, v.y, v.z], upAt(pp)) > 0.99999, `${deg}°`);
  }
});

test('gravity: a dropped box falls toward the middle, wherever you are on the planet', () => {
  world(H, round());
  H.tick(0.5);
  for (const [deg, axis] of [[0, 'x'], [60, 'x'], [120, 'z'], [178, 'x']] as const) {
    goTo(onPlanet(deg, 1, axis), 1);
    const p = H.world.player;
    // A box 6 m over the ground beside you, made here (as the spawn wheel does), and one 300 m off (still awake).
    const near = H.game.box({ position: [p.x + 2, p.bottom + 6, p.z], physics: 'dynamic', size: 1 });
    const off = H.game.box({ position: [p.x + 300, 4, p.z], physics: 'dynamic', size: 1 });
    off.y = -(300 * 300) / (2 * R) + 6; // 6 m over the curved ground out there
    const a0 = F().toPlanet(near.position), b0 = F().toPlanet(off.position);
    for (let t = 0; t < 0.4; t += 1 / 60) H.tick(1 / 60);
    const a1 = F().toPlanet(near.position), b1 = F().toPlanet(off.position);
    for (const [from, to, what] of [[a0, a1, 'beside you'], [b0, b1, '300 m off']] as const) {
      const fell = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      assert.ok(len(fell) > 1, `${what} at ${deg}°: it fell (${len(fell).toFixed(2)} m)`);
      assert.ok(dot(norm(fell), upAt(from).map((x) => -x)) > 0.999, `${what} at ${deg}°: straight toward the middle (${dot(norm(fell), upAt(from).map((x) => -x)).toFixed(5)})`);
    }
    // And it lands on the surface there.
    for (let t = 0; t < 1.5; t += 1 / 60) H.tick(1 / 60);
    const h = len([F().toPlanet(near.position)[0], F().toPlanet(near.position)[1] + R, F().toPlanet(near.position)[2]]) - R;
    assert.ok(Math.abs(h - 0.5) < 0.1, `${deg}°: resting on the ground (its middle ${h.toFixed(3)} m up)`);
    near.destroy(); off.destroy();
  }
});

test('the player: up is away from the middle anywhere, the frame follows, positions stay precise', () => {
  world(H, round());
  H.tick(0.5);
  const before = F().rebases;
  goTo(onPlanet(150, 1.5), 1.5);
  const p = H.world.player;
  assert.ok(F().rebases > before, 'the frame moved under the player');
  assert.ok(Math.hypot(p.x, p.z) < 1 && Math.abs(p.bottom) < 0.2, `near the frame's origin (${p.position.map((v: number) => v.toFixed(2))})`);
  assert.ok(p.grounded, 'standing on the far side');
  const up = H.planet.up(p.position);
  assert.ok(up[1] > 0.99999, 'its up is the frame\'s +y');
  assert.ok(dot(F().dirToPlanet([0, 1, 0]), upAt(onPlanet(150))) > 0.9999, 'which is away from the middle there');
  // Walk a few hundred meters: the frame keeps moving, the player stays near its origin.
  const r0 = F().rebases;
  H.world.camera.yaw = 0; H.world.camera.pitch = 0;
  // Every step on the way: feet on the ground (no hop when the frame moves).
  // (Measured against where the feet start: the character controller rests a few cm up after a fall, flat or round.)
  const h0 = H.planet.heightOf([p.x, p.bottom, p.z]);
  let worst = 0, at = '', n = 0;
  const watch = () => { n++; const h = Math.abs(H.planet.heightOf([p.x, p.bottom, p.z]) - h0); if (h > worst) { worst = h; at = `step ${n}, rebases ${F().rebases}`; } };
  H.hooks.afterStep.push(watch);
  hold('w', 30);
  H.hooks.afterStep.splice(H.hooks.afterStep.indexOf(watch), 1);
  assert.ok(worst < 0.03, `feet as high over the ground all the way, through every rebase (worst ${worst.toFixed(3)} m at ${at})`);
  const pp = F().toPlanet(p.position);
  const walked = Math.acos(dot(upAt(pp), upAt(onPlanet(150)))) * R;
  assert.ok(walked > 150, `walked ${walked.toFixed(0)} m`);
  assert.ok(F().rebases > r0 && F().rebases - r0 <= Math.ceil(walked / 100) + 1, `rebased on the way, once per ~100 m (${F().rebases - r0} for ${walked.toFixed(0)} m)`);
  assert.ok(Math.hypot(p.x, p.z) < 120, `still near the origin (${Math.hypot(p.x, p.z).toFixed(1)} m)`);
  assert.ok(p.grounded && Math.abs(H.planet.heightOf([p.x, p.bottom, p.z])) < 0.3, `on the ground all the way (feet ${H.planet.heightOf([p.x, p.bottom, p.z]).toFixed(3)} m up, grounded ${p.grounded})`);
});

test('flying where you look on the planet, faster high up; landing again', () => {
  world(H, round(), { mode: 'build' });
  H.tick(0.5);
  const p = H.world.player;
  p.flying = true;
  H.world.camera.yaw = 0;
  H.world.camera.pitch = -1.5; // straight up
  H.tick(1 / 60);
  hold('w', 6);
  const h = H.planet.heightOf(p.position);
  assert.ok(h > 2000, `climbed ${h.toFixed(0)} m in 6 s (the higher, the faster)`);
  // Level: forward goes round the planet (the frame follows), the height stays about the same.
  H.world.camera.pitch = 0;
  const pp0 = F().toPlanet(p.position);
  hold('w', 3);
  const pp1 = F().toPlanet(p.position);
  const round_ = Math.acos(Math.min(1, dot(upAt(pp0), upAt(pp1)))) * R;
  assert.ok(round_ > 2000, `went ${round_.toFixed(0)} m round`);
  assert.ok(Math.hypot(p.x, p.z) < 400, 'the frame kept up');
  // Down again: it slows as the ground comes near, and you can land.
  H.world.camera.pitch = 1.5;
  hold('w', 20);
  assert.ok(H.planet.heightOf([p.x, p.bottom, p.z]) < 1, `down (${H.planet.heightOf([p.x, p.bottom, p.z]).toFixed(2)} m)`);
});

test('placing on the surface far round: upright there, saved on the planet, still there when you come back', async () => {
  world(H, round(), { mode: 'build' });
  H.tick(0.5);
  goTo(onPlanet(100, 1, 'z'), 1);
  const it = H.spawn.pick('crate');
  assert.ok(it, 'the wheel has a crate');
  const r = await H.spawn.spawn(it, { count: 1 });
  assert.ok(r.ok, r.error);
  await new Promise((done) => setTimeout(done, 1300)); // (beamed in: it grows to its size first)
  const id = r.ids[0];
  const spec = H.world.graph.entities[id];
  const e = H.world.byId.get(id);
  // The world file: on the planet, at the ground there, standing up (a turn around its own up only).
  const pp = spec.transform.position;
  assert.ok(Math.abs(len([pp[0], pp[1] + R, pp[2]]) - R - 0.55) < 0.3, `on the surface (${(len([pp[0], pp[1] + R, pp[2]]) - R).toFixed(2)} m up)`);
  assert.ok(Math.abs(spec.transform.rotation[0]) < 0.2 && Math.abs(spec.transform.rotation[2]) < 0.2, `upright where it is (${spec.transform.rotation})`);
  // Around you: upright too.
  const q = (globalThis as any).BABYLON.Quaternion.FromEulerAngles(e.node.rotation.x, e.node.rotation.y, e.node.rotation.z);
  const u = (globalThis as any).BABYLON.Vector3.Up().rotateByQuaternionToRef(q, new (globalThis as any).BABYLON.Vector3());
  assert.ok(dot([u.x, u.y, u.z], H.planet.up(e.position)) > 0.9999, 'standing up around you');
  for (let t = 0; t < 1.5; t += 1 / 60) H.tick(1 / 60);
  const settled = F().toPlanet(e.position);
  // Go home and back: where it is on the planet hasn't moved (to the centimetre).
  goTo(onPlanet(0, 1), 1);
  assert.ok(len(e.position) > 50000, 'far away now');
  goTo(onPlanet(100, 1, 'z'), 1);
  const back = F().toPlanet(e.position);
  assert.ok(len([back[0] - settled[0], back[1] - settled[1], back[2] - settled[2]]) < 0.02, `same place (${len([back[0] - settled[0], back[1] - settled[1], back[2] - settled[2]]).toFixed(4)} m)`);
  // Reloaded from the world file around here: the same place too.
  const again = F().fromScene(spec.transform);
  const there = F().toPlanet(again.position);
  assert.ok(len([there[0] - pp[0], there[1] - pp[1], there[2] - pp[2]]) < 0.01, 'the world file says where it is');
});

test('flat worlds are as they were: no frame, things fall straight down, edits keep their numbers', () => {
  world(H, sceneOf({ floor: { type: 'box', shape: { size: [40, 1, 40] }, transform: { position: [0, -0.5, 0] }, physics: 'static' }, start: { ...start, transform: { position: [0, 0.05, 5] } }, crate: { type: 'box', shape: { size: 1 }, physics: 'dynamic', transform: { position: [8, 6, 3], rotation: [0, 30, 0] } } }));
  assert.equal(H.planet.round, false);
  assert.equal(H.hooks.space, null);
  assert.equal(H.world.round, null);
  assert.ok(!H.world.entities.has([...H.world.entities].find((e: any) => e.kind === 'planet')), 'no planet ground');
  const c = H.world.byId.get('crate');
  assert.ok(Math.abs(c.node.rotation.y - Math.PI / 6) < 1e-6);
  H.tick(1.5);
  assert.ok(Math.abs(c.x - 8) < 0.05 && Math.abs(c.z - 3) < 0.05 && Math.abs(c.y - 0.5) < 0.05, `straight down onto the floor (${c.position.map((v: number) => v.toFixed(3))})`);
  const ops = [{ op: 'update', id: 'crate', patch: { transform: { position: [1, 2, 3], rotation: [0, 45, 0] } } }];
  H.applyOps(ops, { local: true });
  assert.deepEqual(ops[0].patch.transform, { position: [1, 2, 3], rotation: [0, 45, 0] });
  assert.deepEqual(H.world.graph.entities.crate.transform.position, [1, 2, 3]);
});

test('the new game template: an empty round planet, the intro every time, the player standing on top', () => {
  const tpl = TEMPLATES.find((t) => t.id === 'planet')!;
  const scene = JSON.parse(tpl.files('Mine')['scene.json']);
  world(H, scene);
  assert.equal(H.planet.round, true);
  assert.equal(H.planet.radius, 50000);
  assert.equal(H.overseer.config.intro, 'always');
  assert.deepEqual([...H.world.entities].filter((e: any) => e.sceneId).map((e: any) => e.sceneId), ['start'], 'nothing in it but the start');
  H.tick(1);
  assert.ok(H.world.player.grounded, 'standing on the planet');
  // The Overseer hangs over its place on the planet, kilometres up.
  assert.ok(H.overseer.position[1] > 4000);
});
test('modules on the planet: a cow and a 4x4 from the wheel stand on the far side; a moving car keeps going through a rebase', async () => {
  world(H, round(), { mode: 'build' });
  H.tick(0.5);
  goTo(onPlanet(120, 1), 1);
  for (const word of ['cow', '4x4']) {
    const it = H.spawn.pick(word);
    assert.ok(it, `the wheel has ${word}`);
    if (it.lazy || /4x4|truck/.test(word)) await (globalThis as any).HawkesModules?.ensure?.('vehicles').catch(() => {});
    const r = await H.spawn.spawn(it, { count: 1 });
    assert.ok(r.ok, `${word}: ${r.error}`);
    await new Promise((done) => setTimeout(done, 1300));
    for (let t = 0; t < 2; t += 1 / 60) H.tick(1 / 60);
    const e = H.world.byId.get(r.ids[0]);
    const pp = F().toPlanet([e.x, e.bottom, e.z]);
    const h = len([pp[0], pp[1] + R, pp[2]]) - R;
    assert.ok(Math.abs(h) < 0.6, `${word} stands on the ground (its feet ${h.toFixed(2)} m up)`);
    const q = (globalThis as any).BABYLON.Quaternion.FromEulerAngles(e.node.rotation.x, e.node.rotation.y, e.node.rotation.z);
    const u = (globalThis as any).BABYLON.Vector3.Up().rotateByQuaternionToRef(q, new (globalThis as any).BABYLON.Vector3());
    assert.ok(dot([u.x, u.y, u.z], [0, 1, 0]) > 0.98, `${word} upright`);
  }
  // A 4x4 rolling when the frame moves: it keeps its speed (the vehicle's own state went with the frame).
  world(H, round({ jeep: { type: 'truck', name: '4x4', transform: { position: [0, 1.2, 12] } } }));
  H.tick(1.5);
  const c = H.world.byId.get('jeep');
  assert.ok(c && c.vehicle, 'a 4x4');
  c.velocity = [0, 0, 8];
  for (let t = 0; t < 0.2; t += 1 / 60) H.tick(1 / 60);
  const s0 = c.speed;
  H.planet.frame.rebase([c.x + 60, 0, c.z]);
  H.tick(1 / 60);
  const s1 = c.speed;
  assert.ok(s0 > 2 && Math.abs(s1 - s0) < 1.5, `still rolling (${s0.toFixed(2)} -> ${s1.toFixed(2)} m/s)`);
});