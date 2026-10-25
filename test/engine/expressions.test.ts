// The shared expression system's state logic (presence-core.js): feelings from game events, the mood over time, who a face looks
// at, the blink, the hard-landing tracker, the per-body face spec and the six emotes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.ts';

const H = await load();
const C = H.presence.core;

test('the six faces exist and the six emotes lead the wheel', () => {
  for (const f of ['neutral', 'happy', 'surprised', 'scared', 'grumpy', 'sleepy']) assert.ok(C.EXPRESSIONS[f], f);
  assert.deepEqual(C.CORE_EMOTES, ['wave', 'laugh', 'cheer', 'shrug', 'dance', 'point']);
  assert.deepEqual(C.EMOTES.slice(0, 6).map((e: any) => e.name), C.CORE_EMOTES);
  for (const n of C.CORE_EMOTES) assert.ok(C.EMOTE_FACE[n], `${n} has a face`);
  assert.equal(C.emote('idk').name, 'shrug');
});

test('events become feelings: a hard landing, a blast, a hit, a catch, speaking', () => {
  assert.equal(C.feel('land', { speed: 6 }), null, 'a soft landing is nothing');
  assert.equal(C.feel('land', { speed: 11 }).face, 'surprised');
  assert.equal(C.feel('land', { speed: 20 }).face, 'scared');
  assert.equal(C.feel('explosion', { dist: 3, radius: 5 }).face, 'scared', 'close');
  assert.equal(C.feel('explosion', { dist: 14, radius: 5 }).face, 'surprised', 'farther');
  assert.equal(C.feel('explosion', { dist: 200, radius: 5 }), null, 'too far to care');
  assert.equal(C.feel('hurt', { amount: 3 }).face, 'grumpy');
  assert.equal(C.feel('hurt', { amount: 0 }), null);
  assert.equal(C.feel('catch', {}).face, 'happy');
  assert.ok(C.feel('talk', { seconds: 2 }).talk > 0);
  assert.equal(C.feel('nothing'), null);
  for (const e of ['land', 'explosion', 'hurt', 'catch']) { const f = C.feel(e, { speed: 20, dist: 1, radius: 5, amount: 2 }); assert.ok(C.EXPRESSIONS[f.face], `${e}'s face is a real expression`); }
});

test('a mood lasts its time, a stronger feeling replaces a weaker one and not the other way round', () => {
  const m = C.mood();
  assert.equal(m.face(), null);
  assert.ok(m.push('land', { speed: 11 }));
  assert.equal(m.face(), 'surprised');
  assert.ok(m.push('explosion', { dist: 2, radius: 5 }));
  assert.equal(m.face(), 'scared', 'the blast is stronger');
  assert.equal(m.push('catch', {}), false, 'a catch cannot cut a fright short');
  assert.equal(m.face(), 'scared');
  m.tick(1.9); assert.equal(m.face(), 'scared');
  m.tick(0.2); assert.equal(m.face(), null, 'settled after 2 s');
  assert.ok(m.push('catch', {}));
  assert.equal(m.face(), 'happy');
  m.clear(); assert.equal(m.face(), null);
});

test('speaking opens the mouth for as long as the line, without changing the face', () => {
  const m = C.mood();
  assert.equal(m.talking(), false);
  m.push('talk', { seconds: 1 });
  assert.equal(m.talking(), true);
  assert.equal(m.face(), null);
  m.tick(0.6); assert.equal(m.talking(), true);
  m.tick(0.6); assert.equal(m.talking(), false);
  for (let t = 0; t < 3; t += 0.05) { const o = C.talkOpen(t); assert.ok(o >= 0 && o <= 0.45, `open ${o}`); }
});

test('after a long stand the face is sleepy; moving about it keeps its own rest', () => {
  assert.equal(C.restFace('neutral', 5), 'neutral');
  assert.equal(C.restFace('happy', 30), 'sleepy');
});

test('who a face looks at: the Overseer while it speaks, a told point, the nearest player close by, else the camera', () => {
  const cam = [0, 2, 0], sky = [0, 400, 0];
  assert.equal(C.gazeTarget({ camera: cam }).kind, 'camera');
  assert.equal(C.gazeTarget({ camera: cam, others: [{ pos: [3, 1, 0], dist: 3 }, { pos: [2, 1, 0], dist: 2 }] }).pos[0], 2, 'the nearer player');
  assert.equal(C.gazeTarget({ camera: cam, others: [{ pos: [30, 1, 0], dist: 30 }] }).kind, 'camera', 'too far to watch');
  assert.equal(C.gazeTarget({ camera: cam, explicit: [5, 0, 5], others: [{ pos: [1, 1, 0], dist: 1 }] }).kind, 'point');
  assert.equal(C.gazeTarget({ camera: cam, explicit: [5, 0, 5], speaking: true, overseer: sky }).kind, 'overseer');
  assert.equal(C.gazeTarget({ camera: cam, speaking: true, overseer: null }).kind, 'camera', 'speaking with the ship unknown');
  assert.equal(C.gazeTarget({}), null);
});

test('the blink: shut in 80 ms, open by 230 ms, then the next one 2.5 to 6 s on; some come in pairs', () => {
  const B = { next: 1, start: -1, dbl: false };
  assert.equal(C.blinkStep(B, 0.5, () => 0.5), 0, 'not yet');
  assert.equal(C.blinkStep(B, 1.0, () => 0.5), 0, 'starts at once, lids still open');
  assert.ok(C.blinkStep(B, 1.04, () => 0.5) > 0.4);
  assert.equal(C.blinkStep(B, 1.09, () => 0.5), 1, 'shut');
  assert.ok(C.blinkStep(B, 1.17, () => 0.5) < 1);
  assert.equal(C.blinkStep(B, 1.3, () => 0.5), 0, 'open again');
  assert.ok(B.next >= 1.3 + 2.5 && B.next <= 1.3 + 6, `next at ${B.next}`);
  const D = { next: 0, start: -1, dbl: false };
  C.blinkStep(D, 0, () => 0.05); // dbl
  C.blinkStep(D, 0.3, () => 0.5);
  assert.ok(Math.abs(D.next - 0.42) < 1e-9, 'the second of a pair follows at once');
  // over a minute it blinks, but not constantly
  const S = { next: 1, start: -1, dbl: false }; let n = 0, was = 0;
  for (let t = 0; t < 60; t += 1 / 60) { const l = C.blinkStep(S, t); if (l > 0 && !was) n++; was = l; }
  assert.ok(n >= 8 && n <= 30, `${n} blinks in a minute`);
});

test('a hard landing is seen once, after enough air time and speed', () => {
  const L = C.landTracker();
  assert.equal(L.step(true, 0, 1 / 60), 0);
  let hits = 0;
  for (let i = 0; i < 40; i++) hits += L.step(false, -14, 1 / 60) ? 1 : 0;
  const hit = L.step(true, 0, 1 / 60);
  assert.equal(hit, 14);
  assert.equal(hits, 0);
  assert.equal(L.step(true, 0, 1 / 60), 0, 'only once');
  for (let i = 0; i < 4; i++) L.step(false, -20, 1 / 60); // a hop of 0.07 s
  assert.equal(L.step(true, 0, 1 / 60), 0, 'a hop is not a fall');
  for (let i = 0; i < 40; i++) L.step(false, -2, 1 / 60); // a slow step down
  assert.equal(L.step(true, 0, 1 / 60), 0, 'a gentle landing');
});

test('the per-body face spec scales an expression toward neutral and can turn blinking or talking off', () => {
  assert.equal(C.faceSpec('person').gain, 1);
  assert.equal(C.faceSpec('fish').blink, 0);
  assert.equal(C.faceSpec('fish').talk, 0);
  assert.equal(C.faceSpec('nobody-made-this').gain, 1);
  const half = C.shape(C.EXPRESSIONS.surprised, 0.5);
  assert.ok(Math.abs(half.open - (C.EXPRESSIONS.neutral.open + (C.EXPRESSIONS.surprised.open - C.EXPRESSIONS.neutral.open) / 2)) < 1e-9);
  assert.equal(C.shape(C.EXPRESSIONS.happy, 1), C.EXPRESSIONS.happy);
  for (const w of C.WHATS) { const g = C.faceSpec(w.id).gain; assert.ok(g > 0 && g <= 1.2, `${w.id} gain ${g}`); }
});

// ---- on a real body (the soft person) ----
import { world, sceneOf } from './harness.ts';
world(H, sceneOf({}, { player: false }), { mode: 'play' });
const B = (globalThis as any).BABYLON;
function stand() {
  const node = new B.TransformNode('stand', H.world.scene);
  const e: any = { node, x: 0, y: 0.9, z: 0, alive: true };
  const look = C.cleanLook({ what: 'person', face: 'eyes' });
  const rig = H.presence.showcase.make(e, look, look.body);
  rig.mood = C.mood();
  return { e, rig };
}
const step = (rig: any, s: number) => { for (let i = 0; i < s * 60; i++) H.presence.showcase.animate(rig, 1 / 60); };

test('a body blinks, looks at the Overseer while it speaks and goes back to the camera', () => {
  const { rig } = stand();
  step(rig, 8);
  assert.ok(rig.person.blinks >= 1, 'it blinked');
  assert.equal(rig.person.gazeKind, 'camera');
  const saved = { speech: H.speech, overseer: H.overseer };
  H.speech = { busy: true }; H.overseer = { position: [0, 400, 5] }; // the Overseer is speaking, high above
  step(rig, 0.5);
  assert.equal(rig.person.gazeKind, 'overseer');
  assert.ok(rig.person.gaze.y > 0.3, 'eyes up');
  H.speech = { busy: false };
  step(rig, 0.5);
  assert.equal(rig.person.gazeKind, 'camera');
  H.speech = saved.speech; H.overseer = saved.overseer;
});

test('a blast and a hit change the face and it settles back', () => {
  const { rig } = stand();
  step(rig, 1);
  const calm = rig.person.expr.open;
  rig.mood.push('explosion', { dist: 2, radius: 5 });
  step(rig, 0.6);
  assert.ok(rig.person.expr.open > calm + 0.3, 'mouth open in fright');
  assert.ok(rig.person.expr.raise > 0.7, 'brows up');
  step(rig, 3);
  assert.ok(Math.abs(rig.person.expr.open - calm) < 0.05, 'settled');
  rig.mood.push('hurt', { amount: 4 });
  step(rig, 0.6);
  assert.ok(rig.person.expr.tilt > 0.5, 'brows down and in');
});

test('a hard fall on a body shows surprise or fright on landing', () => {
  const { e, rig } = stand();
  step(rig, 0.5);
  e.grounded = true;
  e.grounded = false; e.vy = -16;
  step(rig, 0.5);
  e.grounded = true; e.vy = 0;
  step(rig, 0.1);
  assert.equal(rig.mood.face(), 'scared');
});

test('the player-facing API reports the face, and every one of the six emotes plays', () => {
  const { e, rig } = stand();
  H.presence._internal.rigs.set(e, rig);
  for (const name of C.CORE_EMOTES) {
    rig.emote = { def: C.emote(name), t0: rig.time || 0 };
    step(rig, 0.3);
    const f = H.presence.face(e);
    assert.equal(f.emote, name);
    assert.equal(f.shows, C.EMOTE_FACE[name]);
  }
  H.presence._internal.rigs.delete(e);
});
