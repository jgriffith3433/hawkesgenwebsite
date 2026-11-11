// Lighting (public/play/modules/lighting): the plain logic. Tiers follow the Graphics setting (Low cuts below the phone's),
// the four grades differ the way the picture should (dawn gold, noon neutral, dusk orange-magenta, night blue), the
// lookup table is a valid RGBA cube, exposure rises at night, and the sky the reflections are made from is bluer overhead
// by day and dark at night. The GPU parts are the island-look playtest's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const win: any = { };
vm.runInNewContext(fs.readFileSync(path.join(process.cwd(), 'public/play/modules/lighting/lighting-core.js'), 'utf8'), { window: win });
const C = win.HawkesLightingCore;
const grey = (h: number) => C.applyGrade([0.5, 0.5, 0.5], C.gradeAt(h));

test('tiers: Auto keeps the device, Low cuts below the phone, High is desktop', () => {
  assert.equal(C.tierFor('auto', { tier: 'phone' }), 'phone');
  assert.equal(C.tierFor('auto', { tier: 'desktop' }), 'desktop');
  assert.equal(C.tierFor('low', { tier: 'desktop' }), 'low');
  assert.equal(C.tierFor('high', { tier: 'phone' }), 'desktop');
  assert.equal(C.tierFor('medium', { tier: 'phone' }), 'tablet');
  const T = C.TIERS;
  assert.equal(T.desktop.cascades, 4);
  assert.equal(T.phone.cascades, 2);
  assert.ok(T.desktop.ssao && !T.phone.ssao && !T.tablet.ssao && !T.low.ssao, 'SSAO on desktop High only');
  assert.ok(T.phone.bloom && T.phone.bloomScale <= 0.5, 'phone: bloom at half resolution');
  assert.ok(T.low.shadowMap < T.phone.shadowMap && T.low.shadowRange < T.phone.shadowRange && !T.low.bloom, 'Low cuts further');
  assert.ok(T.phone.shadowRange < T.desktop.shadowRange);
});

test('the grades: dawn warm gold, noon neutral, dusk orange-magenta, night blue', () => {
  const dawn = grey(6.3), noon = grey(12), dusk = grey(18.6), night = grey(23);
  assert.ok(dawn[0] - dawn[2] > 0.1, `dawn warm ${dawn}`);
  assert.ok(Math.abs(noon[0] - noon[2]) < 0.04, `noon neutral ${noon}`);
  assert.ok(dusk[0] > dusk[1] + 0.15 && dusk[2] > dusk[1], `dusk orange-magenta ${dusk}`);
  assert.ok(night[2] - night[0] > 0.15, `night blue ${night}`);
  assert.deepEqual(['dawn', 'noon', 'dusk', 'night'].map((_, i) => C.gradeName([6.3, 12, 18.6, 23][i])), ['dawn', 'noon', 'dusk', 'night']);
  assert.equal(C.gradeName(0.5), 'night');
  assert.equal(C.gradeName(14), 'noon');
  // the hours between blend (no jump): half an hour apart is never a different world
  for (let h = 0; h < 24; h += 0.5) { const a = grey(h), b = grey(h + 0.5); assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.2, `smooth at ${h}`); }
});

test('the lookup table: an RGBA cube, identity-like at noon, black stays dark', () => {
  const size = 8, d = C.buildLut(size, C.gradeAt(12));
  assert.equal(d.length, size ** 3 * 4);
  assert.ok(d.every((_: number, i: number) => i % 4 !== 3 || d[i] === 255), 'alpha 255');
  assert.ok(d[0] < 12 && d[1] < 12 && d[2] < 12, 'black stays black');
  const hi = (size ** 3 - 1) * 4;
  assert.ok(d[hi] > 240 && d[hi + 1] > 240 && d[hi + 2] > 240, 'white stays white');
  const reuse = new Uint8Array(size ** 3 * 4);
  assert.equal(C.buildLut(size, C.gradeAt(23), reuse), reuse, 'writes into the array it is given');
});

test('exposure, sun and sky colours follow the hour', () => {
  assert.ok(C.exposureAt(23) > C.exposureAt(12) + 0.3, 'more exposure in the dark');
  const dawn = C.sunColorAt(6.3), noon = C.sunColorAt(12), night = C.sunColorAt(23);
  assert.ok(dawn[0] > dawn[2] + 0.3, 'a warm low sun'); assert.ok(noon[2] > 0.85, 'noon is near white'); assert.ok(night[2] > night[0], 'moonlight is blue');
  const up = C.skyAt([0, 1, 0], 12, [0, 1, 0]), dark = C.skyAt([0, 1, 0], 23, [0, -1, 0]);
  assert.ok(up[2] > up[0], 'a blue sky overhead by day'); assert.ok(dark[2] < up[2] * 0.6, 'dark at night');
  const face = C.skyFace(2, 8, 12, [0, 1, 0]);
  assert.equal(face.length, 8 * 8 * 4);
});

test('the module is wired: manifest, config, the island asks for it, the playtest is named', () => {
  const mod = JSON.parse(fs.readFileSync('public/play/modules/lighting/module.json', 'utf8'));
  assert.deepEqual(mod.scripts, ['lighting-core.js', 'lighting.js']);
  const run = fs.readFileSync('public/play/modules/lighting/lighting.js', 'utf8');
  for (const k of ['CascadedShadowGenerator', 'RawCubeTexture', 'TONEMAPPING_ACES', 'SSAO2RenderingPipeline', 'RawTexture3D', 'window.__look', 'H.setQuality']) assert.ok(run.includes(k), k);
  assert.ok(/!H\.touchUi/.test(run), 'never SSAO on a touch screen');
  assert.ok(fs.readFileSync('src/overseer-games/sandbox.ts', 'utf8').includes('lighting: { hour: 16.9 }'));
  assert.equal(fs.readFileSync('.hawkes/scenario.txt', 'utf8').trim().split('\n')[0], 'island-look');
});
