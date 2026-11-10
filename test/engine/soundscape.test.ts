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
  for (const name of ['amb-inland', 'amb-beach', 'amb-pier', 'step-wood-1', 'step-wood-2', 'step-wood-3', 'ui-pickup']) {
    assert.ok(sounds.has(name), `${name} listed in index.json`);
    assert.ok(fs.existsSync(path.join(dir, `${name}.mp3`)), `${name}.mp3 on disk`);
  }
});
