// The Overseer at work (modules/overseer/work.js) in the real engine: asking starts it at once (beams on the spot, the
// selection, the pill), the server's events move it (plan, focus, beats, things arriving, a character's line), the end
// cleans up, nothing is stuck; and the terrain reshapes in steps while it works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, 0] } };
const ours = () => H.world.scene.meshes.filter((m: any) => /^ov-work/.test(m.name));

test('asking starts the show at once; events move it; the end cleans up', () => {
  world(H, sceneOf({ floor, start }));
  H.tick(0.3);
  const s0 = H.work.begin({ text: 'a helicopter war' });
  assert.ok(s0, 'it began');
  assert.ok(H.work.active);
  assert.equal(ours().length, 3, 'the selection: a disc, its edge, a scan ring');
  H.tick(0.2);
  assert.ok(H.work.state().beams >= 1, 'beams on the spot');
  // The director's plan, then the answer's focus: the area glides there and grows.
  H.work.handle({ k: 'plan', say: 'A war, then.', beats: ['Gunships arrive', 'They wake', 'Orders'], radius: 60, area: 'area' });
  H.work.handle({ k: 'focus', at: [30, 0, 40], radius: 50, area: 'area' });
  for (let t = 0; t < 4; t += 0.1) H.tick(0.1);
  const st = H.work.state();
  assert.ok(Math.hypot(st.at[0] - 30, st.at[2] - 40) < 3, `glided to the work (${st.at.map((v: number) => v.toFixed(1))})`);
  assert.ok(st.radius > 40, 'and grew');
  assert.ok(st.beams >= 3, 'more beams for a bigger area');
  assert.deepEqual(st.plan, ['Gunships arrive', 'They wake', 'Orders']);
  H.work.handle({ k: 'beat', title: 'Gunships arrive', n: 1 });
  H.work.handle({ k: 'op' });
  H.work.handle({ k: 'op' });
  H.work.handle({ k: 'beat', title: 'They wake', n: 2 });
  H.work.handle({ k: 'say', text: 'Bravo Two, on my wing!', who: 'Commander Hale' });
  assert.equal(H.work.state().beat, 2);
  assert.equal(H.work.state().ops, 2);
  assert.deepEqual(H.work.state().beats, ['Gunships arrive', 'They wake']);
  const events: string[] = [];
  H.game.on('workEnd', (d: any) => events.push(`end ${d.ok} ${d.ops}`));
  H.work.handle({ k: 'end', ok: true });
  assert.equal(H.work.active, false);
  assert.deepEqual(events, ['end true 2']);
  for (let t = 0; t < 2; t += 0.1) H.tick(0.1);
  assert.equal(H.work.state(), null, 'gone');
  assert.equal(ours().length, 0, 'nothing left behind');
});

test('beams never come down on the player, and a second ask while working keeps one show', () => {
  world(H, sceneOf({ floor, start }));
  H.tick(0.3);
  H.work.begin({ text: 'here', at: [0, 0, 0], local: true });
  H.work.focus({ at: [0, 0, 2], radius: 8, area: 'area', local: true });
  const before = H.world.scene.meshes.length;
  H.work.begin({ text: 'and here' });
  assert.equal(ours().length, 3, 'still one selection');
  for (let t = 0; t < 2; t += 0.1) H.tick(0.1);
  assert.ok(H.world.scene.meshes.length <= before + 2, 'no pile-up of meshes');
  H.work.end({ ok: false });
  for (let t = 0; t < 2; t += 0.1) H.tick(0.1);
  assert.equal(ours().length, 0);
});

test('an unfinished show ends itself after six minutes', () => {
  world(H, sceneOf({ floor, start }));
  H.tick(0.3);
  H.work.begin({ text: 'forever' });
  const s = H.work.state();
  assert.ok(s && !s.ended);
  // (Its clock is the real one: pretend six minutes went by.)
  const realNow = performance.now;
  const t0 = realNow.call(performance);
  (performance as any).now = () => t0 + 361_000;
  try { H.tick(0.1); } finally { (performance as any).now = realNow; }
  assert.equal(H.work.active, false, 'ended');
});

test('while the Overseer works, a new land shape rises in steps under it (not a snap); otherwise it is rebuilt as before', () => {
  const cfg = { shape: 'flat', size: 128, scatter: false, home: false };
  world(H, sceneOf({ start: { type: 'spawn', transform: { position: [0, 1, 0] } } }, { terrain: cfg }));
  H.tick(0.3);
  const T = H.terrain.core;
  const next = { ...cfg, shape: 'hills', height: 18, seed: 3 };
  const target = T.heightAt(T.generate(next), 30, 20);
  const before = H.terrain.heightAt(30, 20);
  assert.ok(Math.abs(target - before) > 1, 'the hills differ there');
  H.work.begin({ text: 'make it hilly', at: [30, 0, 20], local: true });
  const steps: number[] = [];
  H.game.on('terrainStep', (d: any) => steps.push(d.step));
  H.applyOps([{ op: 'config', patch: { terrain: next } }], { local: true });
  const seen: number[] = [];
  for (let t = 0; t < 8.5; t += 0.1) { H.tick(0.1); seen.push(H.terrain.heightAt(30, 20)); }
  assert.deepEqual(steps, [2, 3, 4], 'it moves in four steps');
  const k = (h: number) => (h - before) / (target - before);
  const at = (s: number) => k(seen[Math.round(s / 0.1) - 1]);
  assert.ok(at(1) > 0.05 && at(1) < 0.3, `a quarter after the first step (${at(1).toFixed(2)})`);
  assert.ok(Math.abs(at(1.9) - 0.25) < 0.03, `resting between steps (${at(1.9).toFixed(2)})`);
  assert.ok(Math.abs(at(8.4) - 1) < 0.02, `the whole new shape at the end (${at(8.4).toFixed(2)})`);
  H.work.end({ ok: true });
  // Not working: the same kind of change is rebuilt at once, as before.
  for (let t = 0; t < 2; t += 0.1) H.tick(0.1);
  H.applyOps([{ op: 'config', patch: { terrain: cfg } }], { local: true });
  H.tick(0.1);
  assert.ok(Math.abs(H.terrain.heightAt(30, 20) - before) < 0.05, 'snapped back');
});
