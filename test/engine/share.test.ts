// The share module (public/play/modules/share) in the real engine, headless: camera path math (eases, keyframe times,
// Catmull-Rom through every key, orbits, follow shots), the "clip that" ring of recorders, and cinematic state: shots
// take the camera and give it back, sequences cut, slow motion slows the world, autoplay plays at the start, scripts
// reach game.cinematic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const M = H.shareMath;
const S = H.share;
const errors: string[] = [];
const report = H.report;
H.report = (err: any, file?: string) => { errors.push(`${file || ''}: ${(err && err.message) || err}`); return report(err, file); };
const floor = { type: 'box', shape: { size: [200, 1, 200] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, 6] } };
const near = (a: number[], b: number[], eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) <= eps);
/** Runs frames (the frame hooks get real-time seconds; the world steps unless paused). */
const frames = (seconds: number, dt = 1 / 30) => { for (let t = 0; t < seconds - 1e-9; t += dt) H.tick(dt); };

test('easing: every curve starts at 0, ends at 1, and the words people use work', () => {
  for (const k of Object.keys(M.EASES)) { assert.equal(M.ease(k, 0), 0, k); assert.ok(Math.abs(M.ease(k, 1) - 1) < 1e-9, k); }
  assert.ok(M.ease('in', 0.5) < 0.5 && M.ease('out', 0.5) > 0.5);
  assert.equal(M.ease('ease-in-out', 0.5), M.ease('inOut', 0.5));
  assert.equal(M.ease('nonsense', 0.25), M.ease('inOut', 0.25));
  assert.equal(M.ease('linear', 2), 1, 'clamped');
});

test('a path gets keyframe times by distance, keeps given ones, and holds', () => {
  const p = M.normalizePath({ keys: [{ pos: [0, 0, 0] }, { pos: [10, 0, 0] }, { pos: [30, 0, 0] }], seconds: 6 });
  assert.deepEqual(p.keys.map((k: any) => +k.at.toFixed(6)), [0, 2, 6], 'an even speed: 10 m in 2 s, 20 m in 4 s');
  assert.equal(p.duration, 6);
  const q = M.normalizePath({ keys: [{ pos: [0, 0, 0] }, { pos: [5, 0, 0], at: 1 }, { pos: [10, 0, 0] }, { pos: [20, 0, 0], at: 7 }] });
  assert.equal(q.keys[1].at, 1);
  assert.ok(Math.abs(q.keys[2].at - 3) < 1e-9, 'between 1 s and 7 s by distance (5 m of 15)');
  const h = M.normalizePath({ keys: [{ pos: [0, 0, 0], hold: 1 }, { pos: [10, 0, 0] }], seconds: 3 });
  assert.equal(h.keys[1].at, 3);
  assert.deepEqual(M.samplePath(h, 0.5).pos, [0, 0, 0], 'held at the first key');
  // A key with nothing to look at looks at the next one.
  assert.deepEqual(p.keys[0].look, [10, 0, 0]);
  // Speed instead of seconds.
  assert.equal(M.normalizePath({ keys: [{ pos: [0, 0, 0] }, { pos: [0, 0, 20] }], speed: 5 }).duration, 4);
});

test('a path passes through every key, eases between them, and says when it is done', () => {
  const path = M.normalizePath({ keys: [{ pos: [0, 2, 0], look: [0, 0, 10] }, { pos: [10, 4, 0], look: [10, 0, 10], fov: 40 }, { pos: [10, 4, 10], look: [0, 0, 0], fov: 70 }], seconds: 8, ease: 'linear' });
  for (const k of path.keys) { const s = M.samplePath(path, k.at); assert.ok(near(s.pos, k.pos, 1e-6), `at ${k.at}`); assert.ok(near(s.look, k.look, 1e-6)); }
  const mid = M.samplePath(path, (path.keys[1].at + path.keys[2].at) / 2);
  assert.ok(Math.abs(mid.fov - 55) < 1e-6, 'the field of view blends');
  assert.equal(M.samplePath(path, 1).done, false);
  assert.equal(M.samplePath(path, 8.01).done, true);
  // Smooth: no jump anywhere (small steps in time, small steps in space).
  let prev = M.samplePath(path, 0).pos, worst = 0;
  for (let t = 0.01; t <= 8; t += 0.01) { const p = M.samplePath(path, t).pos; worst = Math.max(worst, M.dist(prev, p)); prev = p; }
  assert.ok(worst < 0.1, `largest step ${worst.toFixed(3)} m`);
  // Looping wraps around.
  const loop = M.normalizePath({ keys: path.keys, loop: true });
  assert.ok(near(M.samplePath(loop, loop.duration + 0.5).pos, M.samplePath(loop, 0.5).pos, 1e-6));
  assert.equal(M.samplePath(loop, 100).done, false);
});

test('orbits go round a point at the radius; follow shots sit behind, beside and ahead', () => {
  const o = { center: [5, 1, 5], radius: 10, height: 4, seconds: 8, degrees: 360 };
  for (const t of [0, 2, 4, 6]) {
    const s = M.orbitPose(o, t);
    assert.ok(Math.abs(Math.hypot(s.pos[0] - 5, s.pos[2] - 5) - 10) < 1e-9, 'on the circle');
    assert.equal(s.pos[1], 5);
    assert.deepEqual(s.look, [5, 1, 5]);
  }
  assert.ok(near(M.orbitPose(o, 0).pos, [5, 5, -5], 1e-9), 'starts south of it');
  assert.ok(near(M.orbitPose(o, 4).pos, [5, 5, 15], 1e-9), 'half way round at half time');
  assert.equal(M.orbitPose(o, 8).done, true);
  const f = M.followPose([0, 0, 0], 0, { distance: 8, height: 3, lead: 4 });
  assert.ok(near(f.pos, [0, 3, -8], 1e-9), 'behind (facing +z)');
  assert.ok(near(f.look, [0, 1, 4], 1e-9), 'looking ahead of it');
  const side = M.followPose([0, 0, 0], 0, { distance: 0, side: 6, height: 1 });
  assert.ok(near(side.pos, [6, 1, 0], 1e-9), 'a dolly alongside');
  const front = M.followPose([0, 0, 0], 0, { distance: 8, angle: 180, height: 2 });
  assert.ok(near(front.pos, [0, 2, 8], 1e-9), 'in front, looking back at it');
  // Smoothing doesn't depend on the frame rate.
  let a = 0, b = 0;
  for (let i = 0; i < 60; i++) a = M.damp(a, 10, 0.1, 1 / 60);
  for (let i = 0; i < 10; i++) b = M.damp(b, 10, 0.1, 1 / 10);
  assert.ok(Math.abs(a - b) < 1e-9 && Math.abs(a - 9) < 1e-9);
});

test('look angles and flying agree with each other', () => {
  const a = M.lookAngles([0, 0, 0], [10, 0, 10]);
  assert.ok(Math.abs(a.yaw - Math.PI / 4) < 1e-9 && Math.abs(a.pitch) < 1e-9);
  assert.ok(M.lookAngles([0, 0, 0], [0, -5, 5]).pitch > 0, 'looking down is a positive pitch (Babylon)');
  const p = M.ahead([1, 2, 3], a.yaw, 0, Math.SQRT2 * 10);
  assert.ok(near(p, [11, 2, 13], 1e-9));
  const f = M.flyStep({ pos: [0, 0, 0], yaw: 0, pitch: 0 }, { x: 1, y: 1, z: 1 }, 2, 0.5);
  assert.ok(near(f.pos, [1, 1, 1], 1e-9), 'forward is +z, right is +x, up is +y');
  assert.equal(M.letterbox(1920, 1080, 2.39), Math.round((1080 - 1920 / 2.39) / 2));
  assert.equal(M.letterbox(1000, 200), 0);
});

test('clip that: two recorders take turns so a press always holds the last 15 s, and memory stays bounded', () => {
  const plan = M.ringPlan(15);
  let ages: (number | null)[] = [null, null];
  let maxAge = 0, shortest = Infinity, worst = 0, last = -Infinity;
  const dt = 0.5;
  for (let t = 0; t < 600; t += dt) {
    for (const i of M.ringDue(ages, plan)) ages[i] = 0;
    // Someone presses "clip that" now and then (every 37 s), from 15 s in.
    if (t >= 15 && Math.round(t * 2) % 74 === 0) {
      const i = M.ringPick(ages);
      assert.ok(i >= 0);
      shortest = Math.min(shortest, ages[i] as number);
      ages[i] = 0; // restarted at once
      last = t;
    }
    ages = ages.map((a) => (a === null ? null : a + dt));
    maxAge = Math.max(maxAge, ...ages.map((a) => a ?? 0));
    if (t >= 15 && t - last >= 15) worst = Math.max(worst, 15 - Math.max(...ages.map((a) => a ?? 0)));
  }
  assert.ok(shortest >= 15, `every clip had at least 15 s (shortest ${shortest})`);
  assert.ok(maxAge <= plan.clip * 3, `no recording grows past 3 × the clip (${maxAge} s)`);
  assert.ok(worst <= 0, 'once warmed up (and 15 s after the last press), the oldest recorder always covers the clip');
  assert.deepEqual(M.ringDue([null, null], plan), [0], 'they start one at a time');
  assert.deepEqual(M.clipWindow(22, 15), { from: 7, to: 22 });
  assert.deepEqual(M.clipWindow(9, 15), { from: 0, to: 9 });
});

test('a cinematic takes the camera, hides the HUD, letterboxes, moves along its path, and gives everything back', async () => {
  world(H, sceneOf({ floor, start, volcano: { type: 'box', name: 'Volcano', shape: { size: [8, 10, 8] }, transform: { position: [30, 5, 30] } } }));
  H.tick(0.2);
  const scene = H.world.scene;
  const before = scene.activeCamera;
  const p = H.world.player;
  assert.ok(p && p.controls, 'the player is in control');
  const done = H.game.cinematic.path([{ pos: [0, 5, -10], look: [0, 0, 0] }, { pos: [10, 5, -10], look: [0, 0, 0] }], { seconds: 2 });
  assert.equal(H.game.cinematic.playing, true);
  assert.notEqual(scene.activeCamera, before, 'our camera');
  assert.ok(near([scene.activeCamera.position.x, scene.activeCamera.position.y, scene.activeCamera.position.z], [0, 5, -10], 1e-6), 'at the first key at once');
  assert.equal(p.controls, false, 'the player waits');
  assert.equal(S.letterboxOn, true);
  assert.ok(document.body.classList.contains('sh-clean'), 'no HUD');
  frames(1);
  const x = scene.activeCamera.position.x;
  assert.ok(x > 2 && x < 8, `half way along (${x.toFixed(2)})`);
  frames(1.2);
  const r = await done;
  assert.equal(r.done, true);
  assert.equal(H.game.cinematic.playing, false);
  assert.equal(scene.activeCamera, before, 'the game camera is back');
  assert.equal(p.controls, true);
  assert.equal(S.letterboxOn, false);
  assert.ok(!document.body.classList.contains('sh-clean'));
});

test('orbit around a thing by name; follow keeps the player in control; skipping ends it at once', async () => {
  world(H, sceneOf({ floor, start, volcano: { type: 'box', name: 'Volcano', shape: { size: [8, 10, 8] }, transform: { position: [30, 5, 30] } } }));
  H.tick(0.2);
  const cam = () => H.world.scene.activeCamera;
  const orbit = H.game.cinematic.orbit('Volcano', { seconds: 4, radius: 20, height: 6 });
  for (let i = 0; i < 4; i++) {
    frames(0.5);
    const c = cam().position;
    assert.ok(Math.abs(Math.hypot(c.x - 30, c.z - 30) - 20) < 0.01, 'circling the volcano');
  }
  H.game.cinematic.skip();
  assert.equal((await orbit).skipped, true);
  const p = H.world.player;
  const follow = H.game.cinematic.follow('player', { distance: 6, height: 2, seconds: 1 });
  assert.equal(p.controls, true, 'a follow shot lets you keep playing');
  frames(1.2);
  await follow;
  assert.equal(H.game.cinematic.playing, false);
  await assert.rejects(() => H.game.cinematic.play('nope'), /No camera shot called "nope"/);
});

test('sequences cut between shots; named shots come from config.cinematics; autoplay plays at the start', async () => {
  const cinematics = {
    intro: { type: 'sequence', autoplay: true, shots: [{ type: 'fixed', pos: [0, 10, -20], target: 'Volcano', seconds: 0.5 }, { type: 'orbit', target: 'Volcano', seconds: 0.5, radius: 15 }] },
    flyover: { keys: [{ pos: [-20, 15, -20] }, { pos: [20, 15, 20] }], seconds: 1, title: 'The island' },
  };
  world(H, sceneOf({ floor, start, volcano: { type: 'box', name: 'Volcano', shape: { size: [8, 10, 8] }, transform: { position: [30, 5, 30] } } }, { cinematics }));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(H.cinematic.current && H.cinematic.current.name, 'intro', 'the autoplay shot is playing');
  assert.deepEqual(H.game.cinematic.list().sort(), ['flyover', 'intro']);
  frames(0.3);
  const c1 = H.world.scene.activeCamera.position;
  assert.ok(near([c1.x, c1.y, c1.z], [0, 10, -20], 1e-6), 'the fixed shot first');
  frames(0.5);
  const c2 = H.world.scene.activeCamera.position;
  assert.ok(Math.abs(Math.hypot(c2.x - 30, c2.z - 30) - 15) < 0.01, 'then cut to the orbit');
  frames(0.6);
  assert.equal(H.game.cinematic.playing, false, 'the sequence ended');
  // A path's type is worked out from its keys; its title shows while it plays.
  const fly = H.game.cinematic.play('flyover');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(S.captionText && S.captionText.title, 'The island');
  frames(1.2);
  await fly;
  assert.equal(S.captionText, null);
  // Scripts can define shots of their own.
  H.game.cinematic.define('quick', { type: 'orbit', target: [0, 0, 0], seconds: 0.2 });
  const q = H.game.cinematic.play('quick');
  frames(0.3);
  assert.equal((await q).done, true);
});

test('slow motion slows the world; photo mode stops it and gives it back', async () => {
  world(H, sceneOf({ floor, start, ball: { type: 'sphere', physics: 'dynamic', transform: { position: [5, 30, 5] } } }));
  H.tick(0.1);
  const ball = H.game.find('ball') || [...H.world.entities].find((e: any) => e.kind === 'sphere');
  const y0 = ball.y;
  H.game.cinematic.slowmo(0.25);
  const t0 = H.world.time;
  frames(1, 1 / 20);
  const slowTime = H.world.time - t0;
  assert.ok(slowTime > 0.15 && slowTime < 0.4, `a quarter speed (${slowTime.toFixed(2)} s of game time in 1 s)`);
  H.game.cinematic.slowmo(1);
  frames(0.2);
  assert.equal(H.world.paused, false, 'back to full speed, not paused');
  const t1 = H.world.time;
  frames(0.5);
  assert.ok(H.world.time - t1 > 0.4, 'full speed again');
  assert.ok(ball.y < y0, 'the ball fell');
  // Photo mode: the world stops, the free camera moves, and Back puts it all back.
  const before = H.world.scene.activeCamera;
  S.photo.enter();
  assert.equal(S.photo.on, true);
  const t2 = H.world.time;
  frames(0.5);
  assert.equal(H.world.time, t2, 'stopped');
  assert.notEqual(H.world.scene.activeCamera, before);
  S.photo.exit();
  assert.equal(H.world.scene.activeCamera, before);
  frames(0.2);
  assert.ok(H.world.time > t2, 'running again');
  assert.deepEqual(errors, []);
});

test('looks change the picture and come off cleanly', () => {
  world(H, sceneOf({ floor, start }));
  const ip = H.world.scene.imageProcessingConfiguration;
  const contrast = ip.contrast;
  for (const l of S.LOOKS) assert.equal(S.look(l), l);
  assert.equal(S.look('noir'), 'noir');
  assert.equal(ip.colorCurves.globalSaturation, -100);
  S.look('none');
  assert.equal(ip.contrast, contrast);
  assert.equal(S.look('nope'), 'none');
});
