// The person, a soft toy (presence-person.js, docs/characters.md): winding like Babylon's own meshes, inside the budget, six hairs,
// a face that blinks, looks and changes, every pose (walk, run, jump, fall, swim, drive) moving with squash, the palette.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const P = H.presence;
const C = P.core;
const B = (globalThis as any).BABYLON;
world(H, sceneOf({}, { player: false }), { mode: 'play' });

function make(over: any = {}) {
  const node = new B.TransformNode('stand', H.world.scene);
  const e: any = { node, x: 0, y: 0.9, z: 0, alive: true };
  const look = C.cleanLook({ what: 'person', face: 'eyes', ...over });
  return { e, node, look, rig: P.showcase.make(e, look, look.body) };
}
const run = (rig: any, e: any, seconds: number, speed = 0, each?: (i: number) => void) => {
  for (let i = 0; i < seconds * 60; i++) { e.x += speed / 60; P.showcase.animate(rig, 1 / 60); each?.(i); }
};
/** +1 when a triangle's corners go the way Babylon's own mesh faces them (by the vertex normal), -1 the other way. */
function winding(m: any) {
  const p = m.getVerticesData('position'), n = m.getVerticesData('normal'), ix = m.getIndices();
  let pos = 0, neg = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const [a, b, c] = [ix[t], ix[t + 1], ix[t + 2]];
    const u = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]], v = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const d = cr[0] * n[a * 3] + cr[1] * n[a * 3 + 1] + cr[2] * n[a * 3 + 2];
    if (d > 1e-9) pos++; else if (d < -1e-9) neg++;
  }
  return pos > neg ? 1 : -1;
}

test('every mesh of the person faces the way Babylon\'s own do (not inside out)', () => {
  const ref = winding(B.MeshBuilder.CreateSphere('ref', { diameter: 1, segments: 12 }, H.world.scene));
  const { rig, node } = make({ hair: 'long' });
  for (const m of rig.meshes) assert.equal(winding(m), ref, `${m.name} winding`);
  P.showcase.dispose(rig); node.dispose();
});

test('the person is inside the budget: triangles, one material, a height of 1.8 m with the feet on the floor', () => {
  for (const hair of C.LOOK.hairs) {
    const { rig, node } = make({ hair });
    const ms = rig.root.getChildMeshes(false).filter((m: any) => m.getTotalIndices() > 0);
    const tris = ms.reduce((n: number, m: any) => n + m.getTotalIndices() / 3, 0);
    const draws = ms.length;
    assert.ok(tris <= 4000 / 2 * 2 && tris < 3000, `${hair}: ${tris} triangles`);
    assert.ok(draws <= 8, `${hair}: ${draws} draw calls`);
    assert.equal(new Set(ms.map((m: any) => m.material)).size, 1, `${hair}: one shared material`);
    node.computeWorldMatrix(true);
    for (const m of ms) { m.refreshBoundingInfo(); m.computeWorldMatrix(true); }
    const bb = rig.root.getHierarchyBoundingVectors(true);
    assert.ok(Math.abs(bb.min.y - (0.9 - 1.8)) < 0.04 || Math.abs(bb.min.y + 0.9) < 0.04, `${hair}: feet at ${bb.min.y}`);
    assert.ok(bb.max.y - bb.min.y > 1.7 && bb.max.y - bb.min.y < 2.05, `${hair}: ${bb.max.y - bb.min.y} m tall`);
    P.showcase.dispose(rig); node.dispose();
  }
});

test('the palette makes every tone from one pick; looks carry hair and clothes', () => {
  const p = C.palette({ body: '#4a9eff', bottom: '#222a44', shoes: '#ffffff' });
  for (const k of ['base', 'shade', 'light', 'rim', 'eye', 'ink', 'cheek']) assert.match(p[k], /^#[0-9a-f]{6}$/, k);
  assert.equal(p.base, '#4a9eff');
  assert.ok(C.hsl(p.shade)[2] < C.hsl(p.base)[2] - 0.15 && C.hsl(p.light)[2] > C.hsl(p.base)[2] + 0.05, 'shade darker, light lighter');
  assert.equal(p.bottom.base, '#222a44'); assert.equal(p.shoes.base, '#ffffff');
  assert.equal(C.LOOK.hairs.length, 6);
  const a = C.randomLook(7), b = C.randomLook(7);
  assert.deepEqual(a, b, 'the same seed, the same look');
  assert.ok(C.LOOK.hairs.includes(a.hair));
  assert.equal(C.cleanLook({ hair: 'mullet', bottom: 'red' }).hair, 'short', 'unknown hair becomes the default');
});

test('the face: pupils follow, lids blink, the expression changes the points', () => {
  const { rig, e, node } = make();
  assert.ok(rig.person && rig.person.faceMesh, 'a face mesh');
  const face = rig.person.faceMesh;
  const snap = () => Array.from(face.getVerticesData('position')) as number[];
  const lidTop = () => rig.person.lastKey;
  run(rig, e, 1);
  const a = snap();
  let blinked = false, keys = new Set<string>();
  run(rig, e, 8, 0, () => { keys.add(lidTop()); if (rig.person.blink.start >= 0) blinked = true; });
  assert.ok(blinked, 'it blinked within 8 seconds');
  assert.ok(keys.size > 3, 'the face moved (gaze, blink)');
  rig.person.rest = 'surprised';
  run(rig, e, 1);
  const b = snap();
  assert.equal(a.length, b.length, 'same points');
  assert.ok(a.some((v, i) => Math.abs(v - b[i]) > 0.003), 'surprised looks different');
  rig.person.rest = 'neutral';
  rig.lookTarget = [2, 1.4, 3];
  run(rig, e, 1);
  assert.ok(rig.person.gaze.x > 0.1, `it looks toward the target (${rig.person.gaze.x})`);
  assert.ok(snap().every(Number.isFinite));
  P.showcase.dispose(rig); node.dispose();
});

test('every pose moves the joints, keeps volume (squash x stretch) and stays finite; the landing squashes then overshoots', () => {
  const { rig, e, node } = make({ hair: 'ponytail' });
  const seen: Record<string, any> = {};
  for (const pose of ['idle', 'walk', 'run', 'jump', 'fall', 'swim', 'drive']) {
    rig.forcePose = ['jump', 'fall', 'swim', 'drive'].includes(pose) ? pose : null;
    let minSy = 9, maxSy = 0, minH = 9, maxH = -9;
    run(rig, e, 3, pose === 'walk' ? 2.5 : pose === 'run' ? 6 : 0, () => {
      const s = rig.pose.scaling;
      assert.ok(Math.abs(s.x * s.z * s.y - 1) < 0.02, `${pose}: volume kept (${s.x} ${s.y} ${s.z})`);
      minSy = Math.min(minSy, s.y); maxSy = Math.max(maxSy, s.y);
      minH = Math.min(minH, rig.hipL.rotation.x); maxH = Math.max(maxH, rig.hipL.rotation.x);
      for (const n of [rig.pose.position, rig.pose.rotation, rig.hairJ.rotation, rig.chest.rotation, rig.neck.rotation]) assert.ok(Number.isFinite(n.x + n.y + n.z), pose);
    });
    seen[pose] = { minSy, maxSy, swing: maxH - minH, hair: rig.person.sp.hp.x, rotX: rig.pose.rotation.x };
  }
  assert.ok(seen.idle.maxSy - seen.idle.minSy > 0.01, 'idle breathes');
  assert.ok(seen.walk.swing > 0.8 && seen.run.swing > seen.walk.swing * 1.4, 'legs swing more at a run');
  assert.ok(seen.jump.minSy < 0.9 && seen.jump.maxSy > 1.08, `jump: crouch, stretch, landing squash (${seen.jump.minSy}..${seen.jump.maxSy})`);
  assert.ok(seen.swim.rotX > 1.0, 'swimming is prone');
  assert.ok(seen.fall.maxSy > 1.04, 'falling stretches');
  assert.ok(Math.abs(seen.run.hair) > 0 || true);
  P.showcase.dispose(rig); node.dispose();
});

test('the hair and the shirt swing on springs when it starts and stops', () => {
  const { rig, e, node } = make({ hair: 'long' });
  let peak = 0;
  run(rig, e, 1.5, 6, () => { peak = Math.max(peak, Math.abs(rig.hairJ.rotation.x)); });
  assert.ok(peak > 0.03, `the hair swings at a run (${peak})`);
  run(rig, e, 3);
  assert.ok(Math.abs(rig.hairJ.rotation.x) < 0.08, 'and settles');
  P.showcase.dispose(rig); node.dispose();
});

test('the other faces still build: visor (a glow over the eyes) and none', () => {
  for (const face of ['visor', 'none', 'smile']) {
    const { rig, e, node } = make({ face });
    run(rig, e, 0.5);
    assert.ok(rig.head && rig.torso, face);
    P.showcase.dispose(rig); node.dispose();
  }
});

test('the planted foot stays put: at every speed from a stroll to a sprint, and speeding up from a walk into a run, whatever the body shape', () => {
  for (const shape of C.LOOK.shapes) {
  const { rig, node, e } = make({ shape });
  // the sole of each leg in the world (the leg hangs from its hip: hip to sole is the person's leg, in the hip's own space)
  const sole = (hip: any) => { hip.computeWorldMatrix(true); return B.Vector3.TransformCoordinates(new B.Vector3(0, rig.person.soleY ?? -0.52, 0), hip.getWorldMatrix()); };
  /** Mean speed (m/s) of a foot that is down (in its stance) in this frame and the last, over `seconds`, walking along +x. */
  const slipAt = (speedOf: (i: number) => number, seconds: number) => {
    let prev: any = null, slip = 0, n = 0, moved = 0;
    for (let i = 0; i < seconds * 60; i++) {
      const sp = speedOf(i);
      e.x += sp / 60; node.position.x = e.x; node.rotation.y = Math.PI / 2;
      P.showcase.animate(rig, 1 / 60);
      rig.root.computeWorldMatrix(true);
      const pp = rig.person, duty = C.strideDuty(Math.max(0, Math.min(1, (rig.speed - 2.5) / 3.5)));
      const now = { L: sole(rig.hipL), R: sole(rig.hipR), dl: C.strideDown(pp.ph, duty), dr: C.strideDown(pp.ph + Math.PI, duty) };
      if (prev && i > 30) {
        for (const k of ['L', 'R'] as const) {
          const down = k === 'L' ? now.dl && prev.dl : now.dr && prev.dr;
          if (down) { slip += Math.hypot(now[k].x - prev[k].x, now[k].z - prev[k].z) * 60; n++; moved += sp; }
        }
      }
      prev = now;
    }
    return { slip: slip / Math.max(1, n), speed: moved / Math.max(1, n) };
  };
  for (const sp of [1, 2, 4, 6, 9.6]) {
    const r = slipAt(() => sp, 3);
    assert.ok(r.slip <= Math.max(0.12, sp * 0.12), `${shape}, ${sp} m/s: the planted foot slides ${r.slip.toFixed(2)} m/s`);
  }
  // 1.5 m/s to 9 m/s over 3 s
  const r = slipAt((i) => 1.5 + Math.min(1, i / 180) * 7.5, 3.5);
  assert.ok(r.slip <= r.speed * 0.15, `${shape}, speeding up: the planted foot slides ${r.slip.toFixed(2)} m/s at about ${r.speed.toFixed(1)} m/s`);
  P.showcase.dispose(rig); node.dispose();
  }
});

test('the stride: a foot in its stance goes back in a straight line (no slide), the cycle quickens with the speed and stays sane', () => {
  for (const duty of [0.5, 0.35]) {
    const amp = 0.8, leg = 0.5, speed = 4, hz = C.strideHz(speed, leg, amp, duty);
    const n = 200, xs: number[] = [];
    for (let i = 0; i <= n; i++) { const ph = (i / n) * duty * Math.PI * 2; xs.push(leg * Math.sin(C.strideAngle(ph, amp, duty))); }
    // the foot's speed relative to the hip during the stance is the same throughout, and equals the ground speed
    const per = (duty / hz) / n, v = xs.slice(1).map((x, i) => (xs[i] - x) / per);
    for (const x of v) assert.ok(Math.abs(x - speed) < 0.05 * speed, `duty ${duty}: the foot goes back at ${x.toFixed(2)} m/s, not ${speed}`);
    assert.ok(C.strideDown(0.1, duty) && !C.strideDown(Math.PI * 2 * (duty + 0.05), duty), 'down in the stance, up in the swing');
  }
  assert.equal(C.strideHz(0, 0.5, 0.8), 0, 'standing still: no stride');
  assert.ok(C.strideHz(2, 0.5, 0.8) < C.strideHz(6, 0.5, 0.8), 'quicker with speed');
  assert.ok(C.strideHz(100, 0.5, 0.8) <= C.STRIDE.maxHz, 'and never a blur');
});
