// The mix (public/play/modules/mix): decibels, placement and pan, the rooms' impulse responses, the zone blend, the
// BS.1770 loudness gates and the leveler; the module loads in the engine and exposes window.__mix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { load } from './harness.ts';

const H = await load();
const M = H.mixMath;

test('the duck is 8 dB on music and 4 dB on ambience, 150 ms down and 600 ms back', () => {
  assert.deepEqual(M.DUCK, { musicDb: 8, ambienceDb: 4, attack: 0.15, release: 0.6 });
  assert.ok(Math.abs(M.dbToGain(-8) - 0.398) < 0.001);
  assert.ok(Math.abs(M.dbToGain(-4) - 0.631) < 0.001);
  const src = fs.readFileSync('public/play/runtime.js', 'utf8');
  assert.ok(src.includes('DUCK_MUSIC_DB = 8, DUCK_AMB_DB = 4, DUCK_ATTACK = 0.15, DUCK_RELEASE = 0.6'));
});

test('placement: pan follows the side, gain falls with distance, far blasts are duller', () => {
  const L = { pos: [0, 0, 0], right: [1, 0, 0] };
  const right = M.place(L, [10, 0, 0]), left = M.place(L, [-10, 0, 0]), ahead = M.place(L, [0, 0, 10]);
  assert.ok(right.pan > 0.99 && left.pan < -0.99 && Math.abs(ahead.pan) < 0.01);
  assert.ok(Math.abs(right.left ** 2 + right.right ** 2 - 1) < 1e-9, 'equal power');
  assert.ok(M.place(L, [0, 0, 100]).gain < M.place(L, [0, 0, 10]).gain);
  assert.ok(M.cutoffFor(150, 2) < M.cutoffFor(20, 2) && M.cutoffFor(2) > 15000 && M.cutoffFor(500) >= 800);
  assert.equal(M.cutoffFor(300, 0), 20000);
});

test('impulse responses: four rooms, in order of length, unit energy, no dry sound, deterministic', () => {
  const len = (z: string) => M.impulse(z, 48000).left.length;
  assert.ok(len('open') < len('room') && len('room') < len('wood') && len('wood') < len('hall'));
  const ir = M.impulse('hall', 48000);
  let e = 0; for (const v of ir.left) e += v * v;
  assert.ok(Math.abs(e - 1) < 0.01);
  assert.equal(ir.left[0], 0);
  assert.deepEqual(Array.from(M.impulse('wood', 24000).right.slice(0, 50)), Array.from(M.impulse('wood', 24000).right.slice(0, 50)));
  assert.ok(M.impulse('hall', 48000, 0.55).left.length < ir.left.length * 0.6, 'the phone gets a shorter one');
});

test('zones: the blend sums to 1, the hangar wins inside, the pier is full underneath, no flicker on a line', () => {
  const w = M.blend({ hangar: 1 });
  assert.ok(Math.abs(Object.values(w).reduce((a: number, b: any) => a + b, 0) - 1) < 1e-9 && w.hall === 1);
  assert.equal(M.blend({}).open, 1);
  const c = [73, 0.95, 0], half = [16, 0.15, 1.6];
  assert.equal(M.pierWeight([70, 0, 0], c, half), 1, 'under the deck');
  assert.ok(M.pierWeight([70, 1.1, 3], c, half) > 0.3, 'beside it');
  assert.equal(M.pierWeight([20, 0, 0], c, half), 0, 'far inland');
  assert.equal(M.activeZone('open', { open: 0.45, hall: 0.55, wood: 0, room: 0 }), 'open', 'hysteresis');
  assert.equal(M.activeZone('open', { open: 0.1, hall: 0.9, wood: 0, room: 0 }), 'hall');
});

test('loudness: a steady -16 LUFS signal measures -16, silence is gated out, the leveler heads for the target', () => {
  const ms = Math.pow(10, (-16 + 0.691) / 10);
  const l = new M.Loudness();
  for (let i = 0; i < 600; i++) l.push(ms);
  assert.ok(Math.abs(l.integrated() + 16) < 0.01 && Math.abs(l.shortTerm() + 16) < 0.01);
  for (let i = 0; i < 200; i++) l.push(0); // silence does not drag it down (only the three blocks at the edge differ)
  assert.ok(Math.abs(l.integrated() + 16) < 0.2, `${l.integrated()}`);
  let mk = 3;
  for (let i = 0; i < 60; i++) mk = M.level(mk, -22, 1);
  assert.ok(mk > 3 && mk <= 9, `raised: ${mk}`);
  assert.equal(M.level(3, -70, 1), 3, 'a silent mix is left alone');
  mk = 3; for (let i = 0; i < 60; i++) mk = M.level(mk, -10, 1);
  assert.ok(mk < 3 && mk >= -9);
});

test('the module is in the engine: H.mix and window.__mix (no audio here: nothing throws)', () => {
  assert.ok(H.mix);
  assert.ok(typeof H.mix.lufs === 'function' && H.mix.zone === 'open' && H.mix.model);
  assert.equal(H.mix.lufs().clipped, 0);
});
