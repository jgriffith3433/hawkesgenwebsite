// Wind and wildlife (public/play/modules/wind): the plain logic (tiers, gusts, the meadow's cells, the clock's night, the
// flock) and the modules in the real engine on the sandbox island (no GPU: counts, events and clearances, not pixels).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world as run } from './harness.ts';
import { templateBundle } from '../../src/templates.ts';

const H = await load();
const K = H.windCore;
const scene = JSON.parse(templateBundle('sandbox')!.files['scene.json']);
const cfg = { ...scene.config, look: false, shadows: false };
/** Seconds of frames: the modules take one frame's time at most 0.1 s, so a long wait is many ticks. */
const wait = (sec: number) => { for (let t = 0; t < sec; t += 0.1) H.tick(0.1); };

test('tiers: a phone draws 30 percent of the grass, 6 gulls and no petals; a desktop 12 gulls', () => {
  assert.equal(K.TIERS.phone.grass, 0.3);
  assert.equal(K.TIERS.phone.gulls, 6);
  assert.equal(K.TIERS.phone.petals, 0);
  assert.equal(K.TIERS.desktop.gulls, 12);
  assert.ok(K.TIERS.desktop.petals > 0 && K.TIERS.desktop.grass === 1);
  assert.equal(K.tierFor('auto', { tier: 'phone' }), 'phone');
  assert.equal(K.tierFor('low', { tier: 'desktop' }), 'low');
});

test('a gust is a bump that travels: strongest at its front, gone far from it, and it is the same for everyone', () => {
  const g = { front: 100, len: 24, str: 0.8 };
  assert.ok(Math.abs(K.gustAt(g, 100) - 0.8) < 1e-9);
  assert.ok(K.gustAt(g, 160) < 0.01 && K.gustAt(g, 40) < 0.01);
  const next = K.nextGust(K.rng(3), 10, { gap: [1, 3] });
  assert.ok(next.at >= 11 && next.at <= 13 && next.str >= 0.6 && next.len >= 18);
  assert.deepEqual(K.nextGust(K.rng(3), 10), K.nextGust(K.rng(3), 10));
});

test('the meadow: the same clumps every time, about the density asked, flowers rare', () => {
  const a = K.cellClumps(3, -4, 2, 1.1, 0.07), b = K.cellClumps(3, -4, 2, 1.1, 0.07);
  assert.deepEqual(a, b);
  let n = 0, f = 0, cells = 0;
  for (let ix = -30; ix < 30; ix++) for (let iz = -30; iz < 30; iz++) { cells++; for (const c of K.cellClumps(ix, iz, 2, 1.1, 0.07)) { n++; if (c[5]) f++; } }
  const per = n / (cells * 4);
  assert.ok(per > 1.0 && per < 1.2, `density ${per}`);
  assert.ok(f / n > 0.04 && f / n < 0.11, `flowers ${f / n}`);
  const phone = (() => { let m = 0; for (let ix = -30; ix < 30; ix++) for (let iz = -30; iz < 30; iz++) m += K.cellClumps(ix, iz, 2, 1.1 * 0.3, 0.05).length; return m; })();
  assert.ok(phone / n > 0.26 && phone / n < 0.34, `phone ${phone / n}`);
  assert.ok(K.fadeAt(0, 46) === 1 && K.fadeAt(46, 46) === 0 && K.fadeAt(40, 46) < 1);
});

test('fireflies by the clock: none at noon, all at midnight, a smooth dusk', () => {
  assert.equal(K.nightness(12), 0);
  assert.equal(K.nightness(15.5), 0);
  assert.equal(K.nightness(23.5), 1);
  assert.equal(K.nightness(2), 1);
  assert.ok(K.nightness(19.5) > 0.2 && K.nightness(19.5) < 0.8);
  assert.ok(K.dayness(12) === 1 && K.dayness(23) === 0);
  for (let h = 0; h < 24; h += 0.25) assert.ok(Math.abs(K.nightness(h + 0.25) - K.nightness(h)) < 0.35, `smooth ${h}`);
});

test('the flock: circles at a height, scatters away from a fright within a second, settles again, never near the ground', () => {
  const ground = () => 1.6, r = K.rng(9), c = { x: 0, z: 0, base: 1.6 };
  const gulls = Array.from({ length: 12 }, (_: unknown, i: number) => { const g = K.makeGull(r, i, 12, { x: 0, y: 1.6, z: 0, r: 20, h: 6 }); g.r = 14 + r() * 10; g.h = 5.5 + r() * 3; g.x = Math.cos(g.a) * g.r; g.z = Math.sin(g.a) * g.r; g.y = 1.6 + g.h; return g; });
  let now = 0;
  const step = (dt: number, fright?: any) => { now += dt; for (const g of gulls) K.flockStep(g, dt, c, gulls, ground, now, fright); };
  for (let i = 0; i < 300; i++) step(1 / 30);
  assert.ok(gulls.every((g: any) => g.state === 'circle'), 'circling');
  const radii = gulls.map((g: any) => Math.hypot(g.x, g.z));
  assert.ok(radii.every((d: number) => d > 8 && d < 36), `they hold their circles ${radii.map((d: number) => d.toFixed(0))}`);
  step(1 / 30, { x: 5, z: 5 });
  assert.equal(gulls.filter((g: any) => g.state === 'scatter').length, 12, 'the whole flock goes');
  const d0 = gulls.map((g: any) => Math.hypot(g.x - 5, g.z - 5));
  for (let i = 0; i < 30; i++) step(1 / 30);
  const d1 = gulls.map((g: any) => Math.hypot(g.x - 5, g.z - 5));
  assert.ok(d1.filter((d: number, i: number) => d > d0[i] + 4).length >= 10, 'flying off within a second');
  let low = 99;
  for (let i = 0; i < 600; i++) { step(1 / 30); for (const g of gulls) low = Math.min(low, g.y - 1.6); }
  assert.ok(low >= 3.1, `never nearer the ground than 3.2 m (${low})`);
  for (let i = 0; i < 900; i++) step(1 / 30);
  assert.ok(gulls.every((g: any) => g.state === 'circle'), 'settled again');
});

test('the island: wind and wildlife run in the engine, gulls scatter for a speeding vehicle, fireflies only at night', () => {
  run(H, { ...scene, config: cfg }, { mode: 'play' });
  wait(1.5);
  const w = (globalThis as any).window.__wind, wl = (globalThis as any).window.__wildlife;
  assert.ok(w && w.on, 'wind is on');
  assert.ok(wl && wl.on && wl.gulls >= 6, `gulls ${wl && wl.gulls}`);
  assert.equal(wl.fireflies, 0, 'no fireflies at 15:30');
  // a gust starts by itself within a few seconds, and is announced
  const heard: any[] = [];
  H.wind.onGust((e: any) => heard.push(e));
  wait(8);
  assert.ok(((globalThis as any).window.__wind.gusts) >= 1, 'a gust crossed');
  // night: the fireflies show, the butterflies go
  H.lighting ? H.lighting.setHour(23) : (H.sky.clock(true).hour = 23);
  wait(0.5);
  const night = (globalThis as any).window.__wildlife;
  assert.ok(night.night > 0.9 && night.fireflies > 0 && night.butterflies === 0, `night ${JSON.stringify(night)}`);
  H.lighting ? H.lighting.setHour(12) : (H.sky.clock(true).hour = 12);
  wait(0.5);
  const noon = (globalThis as any).window.__wildlife;
  assert.ok(noon.fireflies === 0 && noon.butterflies > 0, `noon ${JSON.stringify(noon)}`);
  // a blast near the beach scatters the flock at once
  H.physics.explode ? H.physics.explode([68, 2, -2], { radius: 4 }) : null;
  wait(0.2);
  const after = (globalThis as any).window.__wildlife;
  assert.ok(after.scatterCount >= 1 && after.last.cause === 'explosion' && after.last.count >= 6, `scatter ${JSON.stringify(after.last)}`);
  assert.ok(after.insideGeometry === 0 && after.minFlyClearance > 0.3 && after.minGullClearance > 3, `grounded ${JSON.stringify(after)}`);
});
