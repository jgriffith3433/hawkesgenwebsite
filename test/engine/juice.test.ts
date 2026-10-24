// Juice (public/play/modules/juice): sounds chosen by material and impulse, the voice budget, ragdolls made and getting
// back up, your own rocket launching you, hit-stop and slow-motion timing, levels and budgets, shake, marks. In Node on
// the real engine (Havok) through test/engine/harness.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const M = H.juiceMath;
const J = H.juice;
const errors: string[] = [];
const report = H.report;
H.report = (err: any, file?: string) => { errors.push(`${file || ''}: ${(err && err.message) || err}`); return report(err, file); };
const floor = { type: 'box', name: 'Floor', shape: { size: [120, 1, 120] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, -30] } };
function play(entities: Record<string, any> = {}, config: Record<string, any> = {}) {
  J.deviceLevel = 'full';
  J.feel.always = false;
  world(H, sceneOf({ floor, start, ...entities }, config));
  H.tick(0.5);
  return H.game;
}

test('the math: materials, impact sounds by material and how hard, levels', () => {
  assert.equal(M.materialOf({ living: {}, data: { species: 'cow' } }), 'flesh');
  assert.equal(M.materialOf({ living: {}, data: { species: 'robot' } }), 'metal');
  assert.equal(M.materialOf({ kind: 'barrel', data: { barrel: true } }), 'metal');
  assert.equal(M.materialOf({ kind: 'crate', data: { crate: true } }), 'wood');
  assert.equal(M.materialOf({ kind: 'box', physics: 'static', name: 'Floor', data: {} }), 'stone');
  assert.equal(M.materialOf({ kind: 'box', physics: 'dynamic', name: 'Window pane', data: {} }), 'glass');
  assert.equal(M.materialOf({ kind: 'sphere', physics: 'dynamic', data: {} }), 'plastic');
  assert.equal(M.materialOf({ kind: 'box', physics: 'dynamic', data: { material: 'metal' } }), 'metal', 'data.material wins');
  assert.equal(M.surfaceOf({ kind: 'box', name: 'Beach', data: {} }), 'sand');
  // Two materials: the louder one is what you hear; harder is louder and bigger; a touch is silent.
  const a = M.impactSound('flesh', 'metal', 0, { speed: 10, jitter: 0.5 });
  assert.equal(a.material, 'metal');
  assert.equal(a.other, 'flesh');
  assert.equal(a.size, 'knock');
  const soft = M.impactSound('wood', 'stone', 0, { speed: 3, jitter: 0.5 });
  const hard = M.impactSound('wood', 'stone', 0, { speed: 20, jitter: 0.5 });
  assert.equal(soft.material, 'wood');
  assert.ok(hard.loudness > soft.loudness && hard.size === 'crash' && soft.size === 'tap');
  assert.equal(M.impactSound('wood', 'stone', 0, { speed: 0.4 }), null, 'a touch makes no sound');
  // From an impulse: N·s over the mass (a 400 kg cow bumping is not a cannon).
  assert.equal(M.impactSound('flesh', 'stone', 300, { mass: 400 }), null);
  assert.ok(M.impactSound('flesh', 'stone', 4000, { mass: 400 }));
  assert.ok(M.impactSound('glass', 'stone', 0, { speed: 8 }).words.includes('glass knock'), 'asset words: "glass knock" first');
  const heavy = M.impactSound('stone', 'stone', 0, { speed: 8, mass: 500, jitter: 0.5 }), light = M.impactSound('stone', 'stone', 0, { speed: 8, mass: 1, jitter: 0.5 });
  assert.ok(heavy.pitch < light.pitch, 'heavier is lower');
  for (const m of M.MATERIALS) assert.ok(M.VOICE[m], `${m} has a synthesized voice`);
  assert.equal(M.lowerLevel('full', 'reduced'), 'reduced');
  assert.equal(M.lowerLevel('minimal', 'full'), 'minimal');
  assert.equal(M.levelOf('phone'), 'reduced');
  assert.ok(M.LEVELS.full.ragdolls > M.LEVELS.reduced.ragdolls && M.LEVELS.minimal.ragdolls === 0);
  assert.ok(M.blastShake(6, 2) > M.blastShake(6, 20) && M.blastShake(6, 200) === 0, 'shake falls off with distance');
  assert.ok(M.blastShake(12, 5) > M.blastShake(3, 5), 'and grows with size');
  assert.equal(M.slowmoFor(5, 0), null);
  assert.ok(M.slowmoFor(14, 0).scale < 0.35 && M.slowmoFor(3, 2), 'huge blasts and chains slow time');
  assert.ok(M.hitStopFor('kill') > 0 && M.hitStopFor('blast', 0.1) === 0 && M.hitStopFor('blast', 1) <= 0.12);
});

test('the voice budget: a fixed number of voices, the quietest give way, the same sound twice at once is one', () => {
  const b = new M.VoiceBudget(4);
  const got: any[] = [];
  for (let i = 0; i < 10; i++) got.push(b.request({ priority: 0.1, now: 0, until: 1 }));
  assert.equal(got.filter(Boolean).length, 4, 'four voices');
  assert.equal(b.stats.dropped, 6);
  let stolen = 0;
  for (const v of got) if (v) v.stop = () => { stolen++; };
  const loud = b.request({ priority: 0.9, now: 0.1, until: 1 });
  assert.ok(loud, 'a loud one takes the place of a quiet one');
  assert.equal(stolen, 1, 'the one it replaced is stopped');
  assert.equal(b.busy(0.1), 4);
  assert.equal(b.request({ priority: 0.05, now: 0.1, until: 1 }), null, 'a quieter one does not');
  assert.ok(b.request({ priority: 1, now: 2, until: 3 }), 'voices free up when their sound ends');
  const c = new M.VoiceBudget(8);
  assert.ok(c.request({ key: 'moo', priority: 1, now: 0, until: 1 }));
  assert.equal(c.request({ key: 'moo', priority: 1, now: 0.01, until: 1, gap: 0.05 }), null, 'merged');
  assert.ok(c.request({ key: 'moo', priority: 1, now: 0.2, until: 1, gap: 0.05 }));
  assert.ok(M.priorityOf(1, 0) > M.priorityOf(1, 30), 'closer matters more');
});

test('impacts make sounds from the physics; 100 cows dropped at once stay within the voice budget', () => {
  const g = play();
  const before = J.sound.played;
  const crate = g.box({ x: 0, y: 4, z: 0, size: 1, physics: 'dynamic', name: 'Crate' });
  H.tick(1.2);
  assert.ok(J.sound.played > before, 'the crate landing made a sound');
  assert.ok(crate.alive);
  const cows = g.spawnMany('cows', 100, { at: [0, 6, 10], area: 10 });
  assert.equal(cows.length, 100);
  let most = 0;
  g.onUpdate(() => { most = Math.max(most, J.sound.budget.busy(H.audio.context ? H.audio.context.currentTime : performance.now() / 1000)); });
  const d0 = J.sound.budget.stats.dropped + J.sound.budget.stats.merged;
  H.tick(2.5);
  assert.ok(most <= J.budget.voices, `never more than ${J.budget.voices} voices (${most})`);
  assert.ok(J.sound.budget.stats.dropped + J.sound.budget.stats.merged > d0, 'the rest were dropped or merged');
});

test('a blast throws close cows limp (a ragdoll of boxes on joints), and they get back up on the floor', () => {
  const g = play({ cow: { type: 'creature', shape: { species: 'cow' }, transform: { position: [0, 0.5, 0] } } });
  const cow = g.entity('cow');
  H.tick(1);
  const made = J.ragdoll.made;
  g.explode([1.2, 0.3, 0], { radius: 6, force: 22, damage: 0 });
  H.tick(0.1);
  assert.equal(J.ragdoll.made, made + 1, 'one ragdoll');
  assert.ok(J.ragdoll.is(cow), 'the cow is limp');
  const rag = cow._ragdoll;
  assert.equal(rag.parts.size, 6, 'a cow is six boxes');
  assert.equal(rag.joints.length, 5, 'on five joints');
  assert.ok(cow._tumble, 'Living things lets it lie');
  assert.ok(rag.hidden.every(([m]: any) => m.isVisible === false), 'its own body is hidden');
  H.tick(0.4);
  const torso = rag.torso;
  assert.ok(Math.hypot(torso.vx, torso.vy, torso.vz) > 1 || torso.y > 1, 'and it flies');
  assert.ok(Math.hypot(cow.x - torso.x, cow.z - torso.z) < 0.01, 'the cow follows its body (so it syncs)');
  H.tick(6);
  assert.equal(J.ragdoll.is(cow), false, 'back up');
  assert.ok(!torso.alive, 'the boxes are gone');
  assert.ok(rag.hidden.every(([m, v]: any) => m.isVisible === v), 'and its body shows again');
  H.tick(2.5);
  assert.ok(cow.alive && cow.y > 0 && cow.y < 3, `standing on the floor (y ${cow.y.toFixed(2)})`);
  assert.ok(Math.abs(cow.node.rotation.x) < 0.01 && Math.abs(cow.node.rotation.z) < 0.01, 'upright');
  assert.notEqual(H.living.status(cow).state, 'knocked', 'and on its feet again');
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('ragdolls have a budget, nearest first; minimal juice has none', () => {
  const ents: Record<string, any> = {};
  for (let i = 0; i < 16; i++) ents[`c${i}`] = { type: 'creature', shape: { species: 'sheep' }, transform: { position: [Math.cos(i) * 2.5, 0.4, -24 + Math.sin(i) * 2.5] } };
  const g = play(ents);
  H.tick(0.5);
  g.explode([0, 0.3, -24], { radius: 7, force: 22, damage: 0 });
  H.tick(0.1);
  assert.equal(J.ragdoll.count, J.budget.ragdolls, `as many as the budget (${J.budget.ragdolls})`);
  // The nearest to the camera got them.
  const cam = H.world.scene.activeCamera.position;
  const d = (e: any) => Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z);
  const sheep = Object.keys(ents).map((k) => g.entity(k));
  const limp = sheep.filter((s: any) => J.ragdoll.is(s)), not = sheep.filter((s: any) => !J.ragdoll.is(s));
  assert.ok(Math.max(...limp.map(d)) <= Math.min(...not.map(d)) + 1.5, 'the nearest first');
  H.tick(7);
  assert.equal(J.ragdoll.count, 0);
  J.deviceLevel = 'minimal';
  assert.equal(J.budget.ragdolls, 0);
  g.explode([0, 0.3, -24], { radius: 7, force: 22, damage: 0 });
  H.tick(0.1);
  assert.equal(J.ragdoll.count, 0, 'minimal: no ragdolls (they still tumble)');
  J.deviceLevel = 'reduced';
  assert.equal(J.level, 'reduced');
  assert.ok(J.budget.ragdolls > 0 && J.budget.ragdolls < M.LEVELS.full.ragdolls);
  J.deviceLevel = 'full';
  H.tick(7);
});

test('your own rocket launches you (a ragdoll, not a death), and you get back up and play on', () => {
  const g = play();
  const p = g.player;
  p.position = [0, 0.95, 0];
  H.tick(0.3);
  p.health = 30;
  let deaths = 0;
  g.on('death', () => deaths++);
  g.explode([0.8, 0.2, 0.4], { radius: 5, force: 20, damage: 80 });
  H.tick(0.05);
  assert.ok(J.ragdoll.is(p), 'you go limp');
  assert.equal(p.controls, false);
  H.tick(0.2);
  assert.equal(deaths, 0, 'not a death screen');
  assert.ok(p.health >= 1, `alive (${p.health})`);
  const rag = p._ragdoll;
  assert.ok(rag && rag.parts.size === 6, 'six boxes: the block avatar');
  H.tick(6);
  assert.equal(J.ragdoll.is(p), false, 'back up');
  assert.equal(p.controls, true, 'and in control');
  assert.equal(p.ghost, false);
  // Someone else's blast (or 'hurt') still hurts as before.
  H.features.get('juice').change({ selfBlast: 'hurt' });
  p.position = [0, 0.95, 0];
  H.tick(0.3);
  p.health = 10;
  g.explode([0.8, 0.2, 0.4], { radius: 5, force: 20, damage: 80 });
  H.tick(0.2);
  assert.equal(deaths, 1, 'with selfBlast: hurt it is a death');
  H.features.get('juice').change({});
  H.tick(6);
});

test('falling far: you land limp; a short hop is a dip of the view and a step sound', () => {
  const g = play();
  const p = g.player;
  H.tick(0.3);
  const steps = J.sound.steps;
  p.position = [0, 1.6, 4];
  p.velocity = [0, 0, 0];
  H.tick(1);
  assert.equal(J.ragdoll.is(p), false, 'a hop is nothing');
  assert.ok(J.sound.steps >= steps, 'a landing sound');
  p.position = [0, 22, 4];
  p.velocity = [0, 0, 0];
  const made = J.ragdoll.made;
  let landed: any = null;
  const off = J.feel.on('land', (d: any) => { landed = d; });
  H.tick(2.5);
  off();
  assert.ok(landed && landed.speed > 17, `landed hard (${landed && landed.speed.toFixed(1)} m/s)`);
  assert.equal(J.ragdoll.made, made + 1, 'and went limp');
  H.tick(6);
  assert.equal(J.ragdoll.is(p), false);
});

test('a car at speed knocks you over', () => {
  const g = play();
  const car = g.car({ x: 0, z: -10 });
  const p = g.player;
  H.tick(1);
  p.position = [car.x, 0.95, 12];
  H.tick(0.2);
  const made = J.ragdoll.made;
  g.vehicles.drive(car, { speed: 16, steer: 0 });
  let hit = false;
  for (let i = 0; i < 50 && !hit; i++) { H.tick(0.1); hit = J.ragdoll.is(p); }
  g.vehicles.drive(car, null);
  assert.ok(hit, `run over: limp (the car got to z ${car.z.toFixed(1)})`);
  assert.ok(J.ragdoll.made > made);
  const v = p._ragdoll.torso.velocity;
  assert.ok(v[2] > 4 || p._ragdoll.torso.z > 13, 'thrown the way the car was going');
  H.tick(6);
  assert.equal(J.ragdoll.is(p), false);
});

test('hit-stop and slow motion: how long they last (H.slow), and only when playing alone', () => {
  play();
  J.feel.always = true;
  assert.equal(J.hitStop(0.08), true);
  assert.equal(H.timeScale, 0, 'frozen');
  H.tick(0.05);
  assert.equal(H.timeScale, 0, 'still frozen');
  H.tick(0.05);
  assert.equal(H.timeScale, 1, 'and going again after 0.08 s');
  assert.equal(J.hitStop(0.05), false, 'not again straight after one (a beat, not a stutter)');
  H.tick(0.5);
  assert.equal(J.hitStop(5), true);
  H.tick(0.16);
  assert.equal(H.timeScale, 1, 'never more than 0.15 s');
  assert.equal(J.slowmo(0.3, 0.5), true);
  assert.equal(H.timeScale, 0.3);
  H.tick(0.4);
  assert.equal(H.timeScale, 0.3, 'slow for half a second');
  H.tick(0.2);
  assert.ok(H.timeScale > 0.3 && H.timeScale < 1, `easing back (${H.timeScale.toFixed(2)})`);
  H.tick(0.3);
  assert.equal(H.timeScale, 1, 'and back to normal');
  // A huge blast slows time by itself; a small one doesn't.
  H.game.explode([0, 0.5, 20], { radius: 4, force: 10, damage: 0 });
  H.tick(0.02);
  assert.ok(H.timeScale === 1 || H.timeScale === 0, 'a small blast: maybe a hit-stop, no slow motion');
  H.tick(0.2);
  H.game.explode([0, 0.5, 20], { radius: 14, force: 30, damage: 0 });
  H.tick(0.2);
  assert.ok(H.timeScale < 0.5, `a huge one: slow motion (${H.timeScale})`);
  H.tick(3);
  assert.equal(H.timeScale, 1);
  // Building never stops time; config.juice.slowmo: false turns it off.
  H.features.get('juice').change({ slowmo: false, hitstop: false });
  assert.equal(J.slowmo(0.3, 1), false);
  assert.equal(J.hitStop(0.1), false);
  H.features.get('juice').change({});
  J.feel.always = false;
  assert.equal(J.hitStop(0.1), false, 'a world stepped by H.tick (tests, tools) is never stopped unless asked');
});

test('shake: every game.camera.shake goes into it, it fades, and reduce motion turns it down', () => {
  const g = play();
  g.camera.shake(0.4, 0.3);
  assert.ok(J.feel.trauma > 0.3, `shaking (${J.feel.trauma.toFixed(2)})`);
  H.tick(1);
  assert.ok(J.feel.trauma < 0.05, 'and it fades');
  const t0 = J.feel.trauma;
  g.explode([0, 0.5, -26], { radius: 6, force: 18, damage: 0 });
  assert.ok(J.feel.trauma > t0 + 0.1, 'a blast close by shakes you');
  J.reduceMotion = true;
  assert.equal(J.motion, 0.2);
  J.reduceMotion = false;
  assert.equal(J.motion, 1);
  H.tick(1);
});

test('the view is level again after your own rocket: third person and first person, looking down at your feet', () => {
  const g = play();
  const w = H.world, B = (globalThis as any).BABYLON;
  // Drawn frames, as a browser runs them: the frame hooks (the shake goes on), then the picture (it comes off).
  const frame = (dt = 1 / 60) => { H.tick(dt); for (const f of H.hooks.frame) f(dt, true, new Set()); w.scene.render(); };
  const roll = () => { const c = w.scene.activeCamera; c.getViewMatrix(true); return Math.abs(c.getDirection(B.Axis.X).y); };
  J.feel.always = true;
  try {
    for (const view of ['third', 'fps']) {
      if (view === 'third') g.camera.thirdPerson(g.player); else g.camera.firstPerson(g.player);
      w.camera.pitch = 1;
      g.player.position = [0, 0.95, 0];
      for (let i = 0; i < 20; i++) frame();
      g.explode([0.8, 0.2, 0.4], { radius: 5, force: 20, damage: 0 });
      assert.ok(J.ragdoll.is(g.player), `${view}: you go limp`);
      // While it shakes, the drawn picture rolls (the up vector tilts), and the camera's own state stays level.
      let tilted = 0;
      for (let i = 0; i < 30; i++) {
        H.tick(1 / 60);
        for (const f of H.hooks.frame) f(1 / 60, true, new Set());
        const up = w.scene.activeCamera.upVector;
        tilted = Math.max(tilted, Math.hypot(up.x, up.z));
        w.scene.render();
        assert.ok(w.scene.activeCamera.upVector.equalsWithEpsilon(new B.Vector3(0, 1, 0), 1e-9), `${view}: level once drawn`);
      }
      assert.ok(tilted > 1e-4, `${view}: the shake rolls the view (${tilted.toFixed(4)})`);
      for (let i = 0; i < 400; i++) frame();
      assert.equal(J.ragdoll.is(g.player), false, `${view}: back up`);
      // Look around: the horizon stays level whichever way you turn.
      w.camera.pitch = 0.2;
      for (const yaw of [0, 1.5, 3, -2]) {
        w.camera.yaw = yaw;
        for (let i = 0; i < 5; i++) frame();
        assert.ok(roll() < 0.01, `${view}: level looking at yaw ${yaw} (roll ${roll().toFixed(3)})`);
      }
    }
  } finally { J.feel.always = false; }
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('a friend blasted by your rocket goes limp, gets back up on its feet, and follows you again', () => {
  const g = play({ pip: { type: 'friend', name: 'Pip', shape: { species: 'person' }, transform: { position: [0, 1, -27] } } });
  const pip = g.entity('pip'), p = g.player;
  H.tick(1);
  assert.equal(H.living.status(pip).following, 'player');
  // (A rocket: Mayhem tumbles what it throws, and Juice's ragdoll takes over.)
  g.explode([pip.x + 0.8, 0.3, pip.z + 0.3], { radius: 5, force: 20, damage: 0 });
  H.tick(0.1);
  assert.ok(J.ragdoll.is(pip), 'Pip goes limp');
  H.tick(5);
  assert.equal(J.ragdoll.is(pip), false, 'and gets back up');
  assert.equal(pip.upright, true, 'standing upright again (not a body that tips over)');
  p.position = [10, 0.95, -20];
  H.tick(6);
  const r = pip.node.rotation;
  assert.ok(Math.abs(r.x) < 0.02 && Math.abs(r.z) < 0.02, `on its feet while walking (tilt ${r.x.toFixed(2)}, ${r.z.toFixed(2)})`);
  assert.ok(!['knocked'].includes(H.living.status(pip).state), `not lying there (${H.living.status(pip).state})`);
  assert.equal(H.living.status(pip).following, 'player', 'following again');
  assert.ok(Math.hypot(pip.x - p.x, pip.z - p.z) < 5, `it caught up with you (${Math.hypot(pip.x - p.x, pip.z - p.z).toFixed(1)} m)`);
  // Anything else that leaves a creature tipped over (not upright, turned): it stands up by itself.
  pip.upright = false;
  pip.node.rotation.x = 1.2;
  H.tick(2);
  assert.ok(pip.upright && Math.abs(pip.node.rotation.x) < 0.02, 'a tipped-over friend stands back up');
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('marks and particles: a scorch under a blast, a budget for tire marks, bursts pooled', () => {
  const g = play();
  const s0 = J.fx.decalCount('scorch');
  g.explode([0, 0.4, 10], { radius: 5, force: 10, damage: 0 });
  H.tick(0.1);
  assert.equal(J.fx.decalCount('scorch'), s0 + 1, 'a scorch mark');
  for (let i = 0; i < 1000; i++) J.fx.decal('tire', [i * 0.1, 0, 0], { size: [0.2, 0.4] });
  assert.ok(J.fx.decalCount('tire') <= 400 && J.fx.decalCount('tire') > 100, `tire marks stay within their ring (${J.fx.decalCount('tire')})`);
  const b0 = J.fx.bursts;
  for (let i = 0; i < 100; i++) J.fx.burst('sparks', [0, 1, 0], { count: 20 });
  assert.ok(J.fx.bursts - b0 <= 12, `bursts a moment are limited (${J.fx.bursts - b0})`);
  const systems = H.world.scene.particleSystems.filter((p: any) => /^juice-/.test(p.name)).length;
  assert.ok(systems <= 6 * J.fx.KINDS.length, `pooled (${systems} systems)`);
  J.deviceLevel = 'minimal';
  assert.equal(J.fx.decal('scorch', [0, 0, 0], { size: 2 }), -1, 'minimal: no marks');
  J.deviceLevel = 'full';
  H.features.get('juice').change({ decals: false });
  assert.equal(J.fx.decal('scorch', [0, 0, 0], { size: 2 }), -1, 'config.juice.decals: false');
  H.features.get('juice').change({});
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('config.juice: false turns it all off', () => {
  const g = play({}, { juice: false });
  assert.equal(J.on, false);
  const made = J.ragdoll.made;
  g.player.position = [0, 0.95, 0];
  H.tick(0.2);
  g.explode([0.5, 0.2, 0], { radius: 5, force: 20, damage: 0 });
  H.tick(0.1);
  assert.equal(J.ragdoll.made, made, 'no ragdoll');
  world(H, sceneOf({ floor, start }));
  assert.equal(J.on, true);
});

test('on the codex (hooks.codex) nothing freezes, slows or flashes; the juice page has an example', () => {
  play();
  J.feel.always = true;
  H.hooks.codex = true;
  try {
    assert.equal(J.hitStop(0.1), false);
    assert.equal(J.slowmo(0.3, 1), false);
    assert.equal(J.rumble(1, 1, 100), false);
  } finally { H.hooks.codex = false; J.feel.always = false; }
  const f = H.features.get('juice');
  assert.ok(f.codex && f.codex.what && f.codex.value && f.codex.fields.length > 10);
});
