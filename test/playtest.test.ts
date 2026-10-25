// Studio's playtest scenarios (public/playtest/portal.js): the files parse, the contract's scenarios are named, the helper
// is the shared copy, and the pages only load the scenarios for a browser under automation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('the playtest files are valid modules', () => {
  for (const f of ['portal.js', 'hawkes-playtest.js', 'hawkes-perf.js']) {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, 'public', 'playtest', f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('the scenarios are the ones AGENTS.md documents', () => {
  const src = read('public/playtest/portal.js');
  const agents = read('AGENTS.md');
  for (const id of ['smoke', 'sandbox-first-minutes', 'island-race']) {
    assert.ok(src.includes(`id: '${id}'`), `${id} is a scenario`);
    assert.ok(agents.includes(id), `${id} is in AGENTS.md`);
  }
  assert.ok(src.includes("product: 'hawkesgenwebsite'"));
});

test('only automation loads the scenarios, on the landing page and the sandbox', () => {
  for (const f of ['public/index.html', 'public/play/guest.js']) {
    const s = read(f);
    assert.match(s, /navigator\.webdriver[^\n]*import\('\/playtest\/portal\.js'\)/, f);
  }
});

test('a playtest never signs up on live', () => {
  const src = read('public/playtest/portal.js');
  assert.match(src, /isLive\(\)/);
  assert.match(src, /health\.mail/);
});
