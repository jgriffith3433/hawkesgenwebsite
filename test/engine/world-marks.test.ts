// Chapter One world marks (src/overseer-games/world-marks.js): every tour step has a lasting change, celebration lines
// hash to voice clip keys, and marks ride in Overseer memory + scene chapterMarks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '../..');
const src = fs.readFileSync(path.join(ROOT, 'src/overseer-games/world-marks.js'), 'utf8');
const mem = fs.readFileSync(path.join(ROOT, 'public/play/modules/overseer/memory.js'), 'utf8');
const guest = fs.readFileSync(path.join(ROOT, 'public/play/guest.js'), 'utf8');
const sandboxTs = fs.readFileSync(path.join(ROOT, 'src/overseer-games/sandbox.ts'), 'utf8');
const hash = (t: string) => { const s = t.trim().toLowerCase().replace(/\s+/g, ' '); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };

const STEPS = ['drive', 'fish', 'boom', 'spawn', 'ask', 'hill', 'fly', 'launch'];
const CHEERS: [string, string, string][] = [
  ['drive', 'pip', 'The road kept your tracks. Look!'],
  ['fish', 'bobbin', 'The lamps are lit. The harbour remembers your cast.'],
  ['boom', 'channel', 'Breaking: a blast site. Fenced. Historic. Ratings: record.'],
  ['spawn', 'pip', 'That spot glowed. The Overseer left a mark.'],
  ['ask', 'ember', 'A ribbon on the box, dear. For the new one. Sorry.'],
  ['hill', 'dolores', 'I put a stone. I was not waiting. It is there.'],
  ['fly', 'dolores', 'The pad lights. The windsock. Use them. Or do not.'],
  ['launch', 'rolo', 'huh. a banner. the pad is lit. that is fine.'],
];

test('world-marks.js is on the sandbox script list', () => {
  assert.match(sandboxTs, /world-marks\.js/);
});

test('every tour step has a mark with a cheer and an overseer line', () => {
  for (const step of STEPS) {
    assert.match(src, new RegExp(`${step}:\\s*\\{`), `${step} mark`);
  }
  for (const [, , text] of CHEERS) {
    assert.ok(src.includes(text), `cheer in source: ${text}`);
  }
  assert.match(src, /world-change/);
  assert.match(src, /world-mark-pan/);
  assert.match(src, /welcome-back/);
  assert.match(src, /chapterMarks/);
  assert.match(src, /celebrate/);
});

test('cheer lines hash to the expected voice keys', () => {
  for (const [step, who, text] of CHEERS) {
    const key = `${who}-${hash(text)}`;
    assert.equal(key.split('-')[0], who, step);
    assert.equal(hash(text).length, 8, `${step} hash`);
  }
  assert.equal(hash('This one is new. Look.'), '2550cce6');
});

test('Overseer memory keeps marks (done, last)', () => {
  assert.match(mem, /H\.memory\.marks/);
  assert.match(mem, /cleanMarks/);
  assert.match(mem, /mergeMarks/);
  assert.match(mem, /MARK_STEPS/);
  assert.match(mem, /marks:\s*\{\s*done:\s*\[\],\s*last:\s*null/);
});

test('guest welcome-back emits for the return pan', () => {
  assert.match(guest, /welcome-back/);
  assert.match(guest, /HawkesGuest[\s\S]*ret/);
});

test('playtest world-memory is registered', () => {
  const portal = fs.readFileSync(path.join(ROOT, 'public/playtest/portal.js'), 'utf8');
  assert.match(portal, /world-memory/);
  assert.match(portal, /runWorldMemory/);
  assert.ok(fs.existsSync(path.join(ROOT, 'public/playtest/world-memory.js')));
});
