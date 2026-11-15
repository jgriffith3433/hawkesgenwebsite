// Side favours (src/overseer-games/favours.js): three two-step favours after the pier quest.
// Pure checks on the data and hashes; the playtest `side-stories` exercises the live path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

function lineHash(s: string) {
  let h = 2166136261 >>> 0;
  const t = String(s).toLowerCase();
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return ('00000000' + h.toString(16)).slice(-8);
}

test('favour ask and payoff lines hash to the cast.json keys', () => {
  const cast = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/play/audio/voice/cast.json'), 'utf8'));
  const src = fs.readFileSync(path.join(ROOT, 'src/overseer-games/favours.js'), 'utf8');
  const lines = [
    ['bobbin', 'The log needs a new name. Take the boat out, then catch me a fish. Salute optional.'],
    ['bobbin', 'Fleet of two. Logbook updated. Same boat, longer name. Carry on.'],
    ['ember', 'A letter for the beach, dear. Carry it to the chair, then a small boom so he notices. Sorry.'],
    ['ember', 'It reached him. Forecast: clear. Sorry. Take this stamp.'],
    ['rolo', 'huh. need scrap. drive the 4x4 to the barrels. then blow them. estimate: two wobbles.'],
    ['rolo', 'huh. that was a small tuesday. take this. mostly fine.'],
  ];
  for (const [who, text] of lines) {
    assert.ok(src.includes(text), `favours.js has ${who} line`);
    const key = `${who}-${lineHash(text)}`;
    const row = cast.lines.find((l: any) => l.key === key);
    assert.ok(row, `cast.json has ${key}`);
    assert.equal(row.text, text);
    assert.equal(row.speaker, who);
  }
});

test('sandbox script list includes favours.js after islanders', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/overseer-games/sandbox.ts'), 'utf8');
  assert.match(src, /'islanders\.js',\s*'favours\.js'/);
});

test('side-stories playtest is registered in portal.js', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/playtest/portal.js'), 'utf8');
  assert.ok(src.includes("from './side-stories.js'"));
  assert.ok(src.includes('SIDE_STORIES'));
  assert.ok(src.includes('sidestories'));
  assert.ok(src.includes("'side-stories'"));
});

test('story and world bible name the three favours', () => {
  const story = fs.readFileSync(path.join(ROOT, 'docs/story.md'), 'utf8');
  const bible = fs.readFileSync(path.join(ROOT, 'docs/world-bible.md'), 'utf8');
  assert.ok(story.includes('#### 5d. Side favours'));
  assert.ok(story.includes('Admiral Bobbin') && story.includes('Mrs Ember') && story.includes('Rolo'));
  assert.ok(bible.includes('## Characters'));
  for (const name of ['### Pip', '### Admiral Bobbin', '### Mrs Ember', '### Rolo', '### Dolores', '### Channel']) {
    assert.ok(bible.includes(name), name);
  }
  for (const field of ['Want:', 'Arc:', 'Moment:', 'Personality:', 'Voice:', 'Animations:']) {
    assert.ok(bible.includes(field), field);
  }
  assert.ok(bible.includes('gv_d11b25da2a8a8a60'));
  assert.ok(bible.includes('idle') && bible.includes('walk') && bible.includes('talk'));
});
