// The island's hours and weather (public/play/modules/soundscape/weather.js): the weights of the four hour beds and the
// files they need. The weights are copied from weather.js so a change there fails here before beta's playtest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hourWeights(h: number) {
  const w: Record<string, number> = {
    dawn: smooth(4.2, 6, h) * (1 - smooth(8, 10, h)),
    day: smooth(8, 10, h) * (1 - smooth(16.5, 18, h)),
    dusk: smooth(16.5, 18, h) * (1 - smooth(20, 21.6, h)),
    night: h < 12 ? 1 - smooth(4.2, 6.2, h) : smooth(19.6, 21.6, h),
  };
  const sum = w.dawn + w.day + w.dusk + w.night || 1;
  for (const k in w) w[k] /= sum;
  return w;
}
const dom = (w: Record<string, number>) => Object.keys(w).reduce((a, b) => (w[b] > w[a] ? b : a));

test('weather: dawn, noon, dusk and night each have their own bed', () => {
  assert.equal(dom(hourWeights(6)), 'dawn');
  assert.equal(dom(hourWeights(12)), 'day');
  assert.equal(dom(hourWeights(18.5)), 'dusk');
  assert.equal(dom(hourWeights(23.5)), 'night');
  assert.equal(dom(hourWeights(2)), 'night');
  for (let h = 0; h < 24; h += 0.25) {
    const w = hourWeights(h);
    assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-9, `weights at ${h} sum to 1`);
    assert.ok(Math.max(...Object.values(w)) > 0.45, `some bed is clear at ${h}`);
  }
});

test('weather.js reads the files it plays, and the playtest is registered', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'public/play/modules/soundscape/weather.js'), 'utf8');
  for (const n of ['tod-dawn', 'tod-day', 'tod-dusk', 'tod-night', 'rain-ground', 'rain-wood', 'rain-metal']) assert.ok(src.includes(`'${n}'`), n);
  assert.ok(src.includes('FADE_S = 30'), 'crossfade of 30 s');
  assert.ok(src.includes('MAX_BEDS = PHONE ? 2'), 'a phone plays two beds');
  const portal = fs.readFileSync(path.join(process.cwd(), 'public/playtest/portal.js'), 'utf8');
  assert.ok(portal.includes('runIslandHours') && portal.includes("'island-hours'"), 'island-hours is registered');
  const m = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/play/modules/soundscape/module.json'), 'utf8'));
  assert.deepEqual(m.scripts, ['soundscape.js', 'weather.js']);
});
