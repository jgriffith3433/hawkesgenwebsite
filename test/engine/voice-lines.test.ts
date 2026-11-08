// Recorded lines (runtime.js recordedLine): a character's line, or the Overseer's, plays its own recording when the
// site has one (public/play/audio/voice/<speaker>-<hash>.mp3, listed in index.json), else the babble or words only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { load } from './harness.ts';

const H = await load();
const L = H.lib;

test('the hash of a line ignores case, outer space and doubled spaces, and matches the names of the files', () => {
  assert.equal(L.lineHash('Hey, you\'re back!'), L.lineHash('  hey,   YOU\'RE back! '));
  assert.notEqual(L.lineHash('Hey, you\'re back!'), L.lineHash('Hey, you\'re back.'));
  // FNV-1a 32: the same numbers the files were named with (tools: the voice-lines list).
  assert.equal(L.lineHash(''), '811c9dc5');
  assert.equal(L.lineHash('a'), 'e40c292c');
});

test('a line finds its recording by speaker and words, and nothing else does', () => {
  const key = `pip-${L.lineHash('Hey, you\'re back!')}`;
  assert.equal(L.recordedLine('pip', 'Hey, you\'re back!', [key]), `/play/audio/voice/${key}.mp3`);
  assert.equal(L.recordedLine('Pip', 'hey, you\'re back!', [key]), `/play/audio/voice/${key}.mp3`);
  assert.equal(L.recordedLine('bobbin', 'Hey, you\'re back!', [key]), null);
  assert.equal(L.recordedLine('pip', 'Something else.', [key]), null);
  assert.equal(L.recordedLine(null, 'Hey, you\'re back!', [key]), null);
});

test('every clip the index lists is a file of the site', () => {
  const dir = 'public/play/audio/voice';
  const index = JSON.parse(fs.readFileSync(`${dir}/index.json`, 'utf8'));
  assert.ok(Array.isArray(index.clips));
  for (const k of index.clips) {
    assert.match(k, /^[a-z]+-[0-9a-f]{8}$/);
    assert.ok(fs.existsSync(`${dir}/${k}.mp3`), `${k}.mp3 is missing`);
  }
});

test('a sound the site has is played by name, and one it lacks leaves the caller to make its own', () => {
  assert.equal(L.siteSound('duck-squeak', { index: ['duck-squeak'] }), true);
  assert.equal(L.siteSound('rubber-chicken', { index: ['duck-squeak'] }), false);
  // (No index loaded, as in a test or a file: nothing is claimed, so the synthesized sounds still play.)
  assert.equal(L.siteSound('duck-squeak'), false);
  const dir = 'public/play/audio/sfx';
  const index = JSON.parse(fs.readFileSync(`${dir}/index.json`, 'utf8'));
  assert.ok(Array.isArray(index.sounds));
  for (const k of index.sounds) assert.ok(fs.existsSync(`${dir}/${k}.mp3`), `${k}.mp3 is missing`);
});
