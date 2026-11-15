// The Firebase Hosting deploy ships the playtest scripts (2026-11-02): firebase.json's `ignore` once listed `playtest/**`,
// so /playtest/portal.js was a 404 on beta and live and the playtest never found window.hawkesPlaytest. Reads only files:
//   node --test --disable-warning=ExperimentalWarning test/hosting.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const hosting = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8')).hosting;

// Firebase's ignore globs, enough of them for ours: `**` any depth, `*` within a name.
const globRe = (g: string) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '@DEEP@').replace(/\*\*/g, '@ANY@').replace(/\*/g, '[^/]*').replace(/@DEEP@/g, '(?:.*/)?').replace(/@ANY@/g, '.*') + '$');
const ignored: RegExp[] = (hosting.ignore as string[]).map(globRe);
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const deployed = new Set(walk(path.join(root, hosting.public)).map((f) => path.relative(path.join(root, hosting.public), f).split(path.sep).join('/'))
  .filter((f) => !ignored.some((re) => re.test(f))));

test('the deployed file list includes the playtest scripts', () => {
  for (const f of ['playtest/portal.js', 'playtest/hawkes-playtest.js', 'playtest/hawkes-perf.js']) assert.ok(deployed.has(f), `/${f} is not deployed (firebase.json hosting.ignore)`);
});

test('the ignore globs still leave out dotfiles and compressed copies', () => {
  assert.ok(ignored.some((re) => re.test('.hidden')));
  assert.ok(ignored.some((re) => re.test('vendor/x/a.js.br')));
  assert.ok(deployed.has('index.html'));
});
