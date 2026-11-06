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
  for (const f of ['portal.js', 'site-layout.js', 'avatar-animations.js', 'community-library.js', 'profile-page.js', 'server-limits.js', 'world-report.js', 'hawkes-playtest.js', 'hawkes-perf.js']) {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, 'public', 'playtest', f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('the scenarios are the ones AGENTS.md documents', () => {
  const src = read('public/playtest/portal.js');
  const agents = read('AGENTS.md');
  for (const id of ['smoke', 'sandbox-first-minutes', 'sandbox-chapter-one', 'island-race', 'island-journal', 'sandbox-progress', 'site-layout']) {
    assert.ok(src.includes(`id: '${id}'`) || (id === 'site-layout' && read('public/playtest/site-layout.js').includes(`id: '${id}'`)), `${id} is a scenario`);
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

test('site-layout: three sizes, the checklist in AGENTS.md, horizontal scroll, a clipped button, a card off the first screen or text over the Overseer fails the run', () => {
  const src = read('public/playtest/site-layout.js');
  for (const size of ['390x844', '768x1024', '1440x900']) assert.ok(src.includes(size), size);
  assert.match(src, /throw new Error\(`layout: /);
  for (const k of ['overseer-clear', 'layout-ok', 'lineRects', 'is clipped at', 'inside the first screen']) assert.ok(src.includes(k), k);
  assert.match(read('public/playtest/portal.js'), /runSiteLayout\(t, options\)/);
  assert.match(read('AGENTS.md'), /The landing page checklist/);
  assert.match(read('public/overseer-sky.js'), /hero\.dataset\.overseer/);
});

test('avatar-animations: a frame per class, the bone checks, the fallbacks and ten characters; documented in AGENTS.md', () => {
  const src = read('public/playtest/avatar-animations.js');
  for (const k of ['clip-file', 'clip-moments', 'bone-checks', 'prefixes-match', 'fallback-procedural', 'template-biped-animates', 'ten-characters', 'object-clips', 'toast-pops', 'volume-kept', 'no-clipping', 'object-loops-close', 'proportionate-motion', 'fish-keeps-gait', 'rollbot-keeps-roll', 'standin=mixamo', 'pose=walk&t=0.25']) assert.ok(src.includes(k), k);
  assert.match(read('public/playtest/portal.js'), /runAvatarAnimations\(t, options\)/);
  assert.match(read('AGENTS.md'), /avatar-animations/);
});
