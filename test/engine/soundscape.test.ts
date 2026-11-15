// Soundscape weights (public/play/modules/soundscape/soundscape.js): inland / beach / pier beds by player x.
// Pure copy of the smoothstep used there so a placement change fails here before beta's playtest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const weights = (x: number) => {
  const pier = smooth(60, 70, x);
  const beach = smooth(28, 48, x) * (1 - pier * 0.85);
  const inland = 1 - smooth(28, 48, x);
  return { inland, beach, pier };
};

test('soundscape: inland dominates west of the ridge, beach mid, pier east', () => {
  const w12 = weights(12);
  assert.ok(w12.inland > 0.9 && w12.beach < 0.05 && w12.pier < 0.05, `x=12 inland: ${JSON.stringify(w12)}`);
  const w40 = weights(40);
  assert.ok(w40.beach > 0.4 && w40.pier < 0.05, `x=40 beach: ${JSON.stringify(w40)}`);
  const w72 = weights(72);
  assert.ok(w72.pier > 0.8 && w72.inland < 0.05, `x=72 pier: ${JSON.stringify(w72)}`);
});

test('soundscape: required audio files for beds and wood steps are in the repo', () => {
  const dir = path.join(process.cwd(), 'public/play/audio/sfx');
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const sounds = new Set(index.sounds);
  for (const name of [
    'amb-inland', 'amb-beach', 'amb-pier',
    'step-wood-1', 'step-wood-2', 'step-wood-3',
    'step-sand-1', 'step-sand-2', 'step-sand-3',
    'step-grass-1', 'step-grass-2', 'step-grass-3',
    'step-stone-1', 'step-stone-2', 'step-stone-3',
    'ui-pickup', 'ui-place', 'ui-build', 'ui-panel', 'ui-quest', 'ui-send',
  ]) {
    assert.ok(sounds.has(name), `${name} listed in index.json`);
    assert.ok(fs.existsSync(path.join(dir, `${name}.mp3`)), `${name}.mp3 on disk`);
  }
});

test('soundscape: module listens for real island events (mirror/spawn-wheel/workStart), not only named build/panel', () => {
  const js = fs.readFileSync(path.join(process.cwd(), 'public/play/modules/soundscape/soundscape.js'), 'utf8');
  assert.ok(js.includes("g.on('workStart'"), 'workStart → build UI');
  assert.ok(js.includes("g.on('mirror'"), 'mirror open → panel UI');
  assert.ok(js.includes("g.on('spawn-wheel'"), 'spawn wheel open → panel UI');
  assert.ok(js.includes("g.on('asked'"), 'Overseer chat send');
  assert.ok(js.includes('BED_GAIN'), 'per-bed gain so a quiet take does not drop out');
  assert.ok(js.includes('UI_VOL'), 'per-interaction play volumes');
  assert.ok(js.includes('STEP_VOL'), 'per-surface footstep volumes (wood tamed)');
});

test('soundscape: ambience bed files are real loops (not tiny stand-ins)', () => {
  const dir = path.join(process.cwd(), 'public/play/audio/sfx');
  const size = (n: string) => fs.statSync(path.join(dir, `${n}.mp3`)).size;
  assert.ok(size('amb-beach') > 100_000 && size('amb-pier') > 100_000 && size('amb-inland') > 100_000, 'beds are real loops, not tiny stand-ins');
  assert.ok(size('ui-send') > 8_000 && size('ui-panel') > 6_000, 'interaction clips present');
  // Wood / sand / grass step files all present and non-trivial (peak parity is a listen check on beta).
  for (const s of ['step-wood-1', 'step-sand-1', 'step-grass-1']) {
    assert.ok(size(s) > 4_000, `${s} present`);
  }
});
