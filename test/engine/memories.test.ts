import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../../src/overseer-games/memories.js', import.meta.url), 'utf8');
const hash = (t: string) => { const s = t.trim().toLowerCase().replace(/\s+/g, ' '); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };

test('every memory has its recorded Overseer line, a short moment and two or three figures', () => {
  const index = JSON.parse(fs.readFileSync(new URL('../../public/play/audio/voice/index.json', import.meta.url), 'utf8')).clips as string[];
  const rows = [...src.matchAll(/^    (\w+): \{ hash: '(\w+)', text: '([^']+)'/gm)];
  assert.ok(rows.length >= 8, 'at least eight memories');
  for (const [, id, h, text] of rows) {
    assert.equal(hash(text), h, `${id}: the hash is the words'`);
    assert.ok(index.includes(`overseer-${h}`), `${id}: clip listed`);
    assert.ok(fs.existsSync(new URL(`../../public/play/audio/voice/overseer-${h}.mp3`, import.meta.url)), `${id}: clip file`);
  }
  const m = /const SECONDS = (\d+)/.exec(src);
  assert.ok(m && Number(m[1]) >= 6 && Number(m[1]) <= 12);
});
